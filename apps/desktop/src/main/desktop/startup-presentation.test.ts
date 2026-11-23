import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  StartupPresentationLocale,
  StartupPresentationStage,
} from "../../shared/startup-presentation";
import {
  STARTUP_PRESENTATION_MAX_LIFETIME_MS,
  STARTUP_PRESENTATION_MIN_VISIBLE_MS,
  STARTUP_PRESENTATION_READY_DELAY_MS,
  STARTUP_PRESENTATION_READY_GRACE_MS,
  StartupPresentationController,
  type StartupPresentationSurface,
} from "./startup-presentation";

class FakeSurface implements StartupPresentationSurface {
  readonly senderId = 42;
  readonly stages: StartupPresentationStage[] = [];
  readonly locales: StartupPresentationLocale[] = [];
  shown = false;
  closed = false;
  private closedListener: (() => void) | null = null;
  loadPromise: Promise<void> = Promise.resolve();

  load(): Promise<void> {
    return this.loadPromise;
  }

  show(): void {
    this.shown = true;
  }

  close(): void {
    this.closed = true;
    this.closedListener?.();
  }

  sendStage(stage: StartupPresentationStage, locale: StartupPresentationLocale): void {
    this.stages.push(stage);
    this.locales.push(locale);
  }

  onClosed(listener: () => void): () => void {
    this.closedListener = listener;
    return () => {
      this.closedListener = null;
    };
  }
}

function createController(
  surface: FakeSurface,
  readEnabled: () => unknown | Promise<unknown> = () => true,
) {
  return new StartupPresentationController({
    readEnabled,
    createSurface: () => surface,
  });
}

async function flushSurfaceLoad(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("StartupPresentationController", () => {
  it("notifies optional work only after the startup surface is shown", async () => {
    const surface = new FakeSurface();
    const onPresentationShown = vi.fn(() => {
      expect(surface.shown).toBe(true);
      throw new Error("optional work failed");
    });
    const controller = new StartupPresentationController({
      readEnabled: () => true,
      createSurface: () => surface,
      onPresentationShown,
    });
    controller.start();
    await flushSurfaceLoad();
    expect(onPresentationShown).toHaveBeenCalledOnce();
    expect(controller.isPresenting()).toBe(true);
    controller.stop();

    const disabled = new StartupPresentationController({
      readEnabled: () => false,
      createSurface: () => new FakeSurface(),
      onPresentationShown,
    });
    disabled.start();
    await disabled.ready();
    expect(onPresentationShown).toHaveBeenCalledOnce();
  });

  it("loads, shows, and sends the latest real startup stage", async () => {
    const surface = new FakeSurface();
    const controller = createController(surface);

    controller.setStage("services");
    expect(controller.isPresenting()).toBe(false);
    controller.start();
    await vi.waitFor(() => expect(surface.shown).toBe(true));

    expect(surface.stages).toEqual(["services"]);
    expect(controller.isPresenting()).toBe(true);
    controller.stop();
    expect(surface.closed).toBe(true);
    expect(controller.isPresenting()).toBe(false);
    await controller.ready();
  });

  it("does not create a surface when startup animation is disabled", async () => {
    const surface = new FakeSurface();
    const createSurface = vi.fn(() => surface);
    const controller = new StartupPresentationController({
      readEnabled: () => false,
      createSurface,
    });

    controller.start();
    await controller.ready();

    expect(createSurface).not.toHaveBeenCalled();
    expect(surface.shown).toBe(false);
  });

  it("sends the saved language with the latest stage and defaults on a locale read error", async () => {
    const englishSurface = new FakeSurface();
    const english = new StartupPresentationController({
      readEnabled: () => true,
      readLocale: () => "en",
      createSurface: () => englishSurface,
    });
    english.start();
    await vi.waitFor(() => expect(englishSurface.shown).toBe(true));
    expect(englishSurface.locales).toEqual(["en"]);
    english.setStage("window");
    expect(englishSurface.locales).toEqual(["en", "en"]);
    english.stop();

    const fallbackSurface = new FakeSurface();
    const fallback = new StartupPresentationController({
      readEnabled: () => true,
      readLocale: () => {
        throw new Error("locale unavailable");
      },
      createSurface: () => fallbackSurface,
    });
    fallback.start();
    await vi.waitFor(() => expect(fallbackSurface.shown).toBe(true));
    expect(fallbackSurface.locales).toEqual(["zh-CN"]);
    fallback.stop();
  });

  it("fails open when preference reading throws", async () => {
    const surface = new FakeSurface();
    const createSurface = vi.fn(() => surface);
    const controller = new StartupPresentationController({
      readEnabled: () => {
        throw new Error("preference store unavailable");
      },
      createSurface,
    });

    controller.start();
    await expect(controller.ready()).resolves.toBeUndefined();
    expect(createSurface).not.toHaveBeenCalled();
  });

  it("fails open when the splash page fails to load", async () => {
    const surface = new FakeSurface();
    let rejectLoad: ((cause: Error) => void) | undefined;
    surface.loadPromise = new Promise<void>((_resolve, reject) => {
      rejectLoad = reject;
    });
    const controller = createController(surface);

    controller.start();
    await vi.waitFor(() => expect(controller.isTrustedSender(surface.senderId)).toBe(true));
    rejectLoad?.(new Error("renderer failed"));
    await expect(controller.ready()).resolves.toBeUndefined();
    expect(surface.shown).toBe(false);
    expect(surface.closed).toBe(true);
  });

  it("accepts skip only from the startup surface", async () => {
    const surface = new FakeSurface();
    const controller = createController(surface);
    controller.start();
    await vi.waitFor(() => expect(surface.shown).toBe(true));

    expect(controller.isTrustedSender(7)).toBe(false);
    expect(controller.handleSkip(7)).toBe(false);
    expect(surface.closed).toBe(false);
    expect(controller.handleSkip(surface.senderId)).toBe(true);
    await expect(controller.ready()).resolves.toBeUndefined();
    expect(surface.closed).toBe(true);
    expect(controller.handleSkip(surface.senderId)).toBe(false);
  });

  it("resolves ready once after the bounded exit transition", async () => {
    vi.useFakeTimers();
    expect(STARTUP_PRESENTATION_MIN_VISIBLE_MS).toBe(4_680);
    expect(STARTUP_PRESENTATION_READY_DELAY_MS).toBe(320);
    const surface = new FakeSurface();
    const controller = createController(surface);
    controller.start();
    await flushSurfaceLoad();
    expect(surface.shown).toBe(true);

    const first = controller.ready();
    const second = controller.ready();
    expect(second).toBe(first);
    expect(surface.stages.at(-1)).toBe("preparing");
    expect(surface.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(4_679);
    expect(surface.stages.at(-1)).toBe("preparing");
    await vi.advanceTimersByTimeAsync(1);
    expect(surface.stages.at(-1)).toBe("ready");
    await vi.advanceTimersByTimeAsync(319);
    expect(surface.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toBeUndefined();
    expect(surface.closed).toBe(true);
  });

  it("allows a promptly loading surface to show when the main window is already ready", async () => {
    vi.useFakeTimers();
    let releasePreference: ((enabled: boolean) => void) | undefined;
    let releaseLoad: (() => void) | undefined;
    const surface = new FakeSurface();
    surface.loadPromise = new Promise<void>((resolve) => (releaseLoad = resolve));
    const onLatePresentation = vi.fn();
    const controller = new StartupPresentationController({
      readEnabled: () => new Promise<boolean>((resolve) => (releasePreference = resolve)),
      createSurface: () => surface,
      onLatePresentation,
    });

    controller.setStage("window");
    expect(controller.isPresenting()).toBe(false);
    controller.start();
    const ready = controller.ready();
    await vi.advanceTimersByTimeAsync(100);
    releasePreference?.(true);
    await flushSurfaceLoad();
    releaseLoad?.();
    await flushSurfaceLoad();
    expect(surface.shown).toBe(true);
    expect(controller.isPresenting()).toBe(true);
    expect(onLatePresentation).toHaveBeenCalledOnce();
    expect(surface.stages).toEqual(["window"]);

    await vi.advanceTimersByTimeAsync(STARTUP_PRESENTATION_MIN_VISIBLE_MS);
    expect(surface.stages.at(-1)).toBe("ready");
    await vi.advanceTimersByTimeAsync(STARTUP_PRESENTATION_READY_DELAY_MS);
    await expect(ready).resolves.toBeUndefined();
    expect(surface.closed).toBe(true);
    expect(controller.isPresenting()).toBe(false);
  });

  it("does not hold a ready main window for a pending preference read beyond its grace period", async () => {
    vi.useFakeTimers();
    let releasePreference: ((enabled: boolean) => void) | undefined;
    const surface = new FakeSurface();
    const controller = createController(
      surface,
      () => new Promise<boolean>((resolve) => (releasePreference = resolve)),
    );

    controller.start();
    const ready = controller.ready();
    await vi.advanceTimersByTimeAsync(STARTUP_PRESENTATION_READY_GRACE_MS);
    await expect(ready).resolves.toBeUndefined();

    releasePreference?.(true);
    await Promise.resolve();
    expect(surface.shown).toBe(false);
    expect(surface.closed).toBe(false);
  });

  it("immediately releases a disabled animation even when ready arrives first", async () => {
    vi.useFakeTimers();
    const surface = new FakeSurface();
    const createSurface = vi.fn(() => surface);
    const controller = new StartupPresentationController({
      readEnabled: () => false,
      createSurface,
    });
    controller.start();
    const ready = controller.ready();
    await expect(ready).resolves.toBeUndefined();
    expect(createSurface).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes a slow loading surface after the grace period and never reopens it", async () => {
    vi.useFakeTimers();
    let releaseLoad: (() => void) | undefined;
    const surface = new FakeSurface();
    surface.loadPromise = new Promise<void>((resolve) => (releaseLoad = resolve));
    const controller = createController(surface);
    controller.start();
    await flushSurfaceLoad();

    const ready = controller.ready();
    await vi.advanceTimersByTimeAsync(STARTUP_PRESENTATION_READY_GRACE_MS);
    await expect(ready).resolves.toBeUndefined();
    expect(surface.closed).toBe(true);
    releaseLoad?.();
    await flushSurfaceLoad();
    expect(surface.shown).toBe(false);
  });

  it("allows a trusted skip while waiting for a surface to load", async () => {
    vi.useFakeTimers();
    let releaseLoad: (() => void) | undefined;
    const surface = new FakeSurface();
    surface.loadPromise = new Promise<void>((resolve) => (releaseLoad = resolve));
    const controller = createController(surface);
    controller.start();
    await flushSurfaceLoad();
    const ready = controller.ready();

    expect(controller.handleSkip(surface.senderId)).toBe(true);
    await expect(ready).resolves.toBeUndefined();
    releaseLoad?.();
    await flushSurfaceLoad();
    expect(surface.shown).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases startup when preparing the late presentation underlay fails", async () => {
    vi.useFakeTimers();
    let releaseLoad: (() => void) | undefined;
    const surface = new FakeSurface();
    surface.loadPromise = new Promise<void>((resolve) => (releaseLoad = resolve));
    const controller = new StartupPresentationController({
      readEnabled: () => true,
      createSurface: () => surface,
      onLatePresentation: () => {
        throw new Error("main window is unavailable");
      },
    });
    controller.start();
    await flushSurfaceLoad();
    const ready = controller.ready();
    releaseLoad?.();
    await expect(ready).resolves.toBeUndefined();
    expect(surface.closed).toBe(true);
    expect(controller.isPresenting()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("begins exit immediately when the minimum display time has already elapsed", async () => {
    vi.useFakeTimers();
    const surface = new FakeSurface();
    const controller = createController(surface);
    controller.start();
    await flushSurfaceLoad();
    await vi.advanceTimersByTimeAsync(STARTUP_PRESENTATION_MIN_VISIBLE_MS);

    const ready = controller.ready();
    expect(surface.stages.at(-1)).toBe("ready");
    await vi.advanceTimersByTimeAsync(STARTUP_PRESENTATION_READY_DELAY_MS);
    await expect(ready).resolves.toBeUndefined();
  });

  it("closes a splash at the global bound even before the main window is ready", async () => {
    vi.useFakeTimers();
    expect(STARTUP_PRESENTATION_MAX_LIFETIME_MS).toBe(8_000);
    const surface = new FakeSurface();
    surface.loadPromise = new Promise<void>(() => undefined);
    const controller = createController(surface);

    controller.start();
    await flushSurfaceLoad();
    expect(controller.isTrustedSender(surface.senderId)).toBe(true);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(surface.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(controller.ready()).resolves.toBeUndefined();
    expect(surface.closed).toBe(true);
  });

  it("stop settles an outstanding ready transition and closes its surface", async () => {
    vi.useFakeTimers();
    const surface = new FakeSurface();
    const controller = createController(surface);
    controller.start();
    await vi.waitFor(() => expect(surface.shown).toBe(true));

    const ready = controller.ready();
    controller.stop();

    await expect(ready).resolves.toBeUndefined();
    expect(surface.closed).toBe(true);
  });
});
