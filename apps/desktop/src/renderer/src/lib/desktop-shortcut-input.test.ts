import { describe, expect, it } from "vitest";
import { captureDesktopShortcut } from "./desktop-shortcut-input";

function event(key: string, options: Partial<Parameters<typeof captureDesktopShortcut>[0]> = {}) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...options,
  };
}

describe("desktop shortcut recording", () => {
  it("prefers the typed letter while recovering shifted digits from their physical key", () => {
    expect(
      captureDesktopShortcut(
        event("!", {
          code: "Digit1",
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toEqual({ kind: "complete", accelerator: "Control+Shift+1" });
    expect(
      captureDesktopShortcut(
        event("Z", {
          code: "KeyY",
          ctrlKey: true,
        }),
      ),
    ).toEqual({ kind: "complete", accelerator: "Control+Z" });
    expect(
      captureDesktopShortcut(
        event("m", {
          code: "KeyQ",
          ctrlKey: true,
        }),
      ),
    ).toEqual({ kind: "complete", accelerator: "Control+M" });
  });

  it("accepts shifted function keys and rejects numpad keys", () => {
    expect(
      captureDesktopShortcut(
        event("F10", {
          code: "F10",
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toEqual({ kind: "complete", accelerator: "Control+Shift+F10" });
    expect(
      captureDesktopShortcut(
        event("F11", {
          code: "F11",
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
        }),
      ),
    ).toEqual({ kind: "complete", accelerator: "Control+Alt+Shift+F11" });
    expect(
      captureDesktopShortcut(
        event("1", {
          code: "Numpad1",
          ctrlKey: true,
        }),
      ),
    ).toEqual({
      kind: "invalid",
      preview: "Control+1",
      code: "shortcut-invalid-key",
    });
  });

  it("accepts a real Windows Ctrl+Alt report even when Chromium marks it as AltGraph", () => {
    expect(
      captureDesktopShortcut(
        event("M", {
          code: "KeyM",
          ctrlKey: true,
          altKey: true,
          altGraph: true,
        }),
      ),
    ).toEqual({ kind: "complete", accelerator: "Control+Alt+M" });
    expect(
      captureDesktopShortcut(
        event("F12", {
          code: "F12",
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
          altGraph: true,
        }),
      ),
    ).toEqual({ kind: "complete", accelerator: "Control+Alt+Shift+F12" });
  });

  it("keeps the existing two-key shortcut behavior while accepting three and four keys", () => {
    expect(
      captureDesktopShortcut(
        event("K", {
          code: "KeyK",
          ctrlKey: true,
        }),
      ),
    ).toEqual({ kind: "complete", accelerator: "Control+K" });
  });

  it("keeps waiting for modifier-only, IME, repeat and unsupported Windows combinations", () => {
    expect(
      captureDesktopShortcut(event("Control", { code: "ControlLeft", ctrlKey: true })),
    ).toEqual({ kind: "pending", preview: "Control" });
    for (const options of [{ isComposing: true }, { repeat: true }, { metaKey: true }]) {
      expect(
        captureDesktopShortcut(
          event("M", {
            code: "KeyM",
            ctrlKey: true,
            ...options,
          }),
        ),
      ).toMatchObject({ kind: "pending" });
    }
    expect(
      captureDesktopShortcut(
        event("M", {
          code: "KeyM",
          ctrlKey: true,
          altGraph: true,
        }),
      ),
    ).toMatchObject({ kind: "pending" });
  });

  it("cancels unmodified Escape or Tab and validates modified keys", () => {
    expect(captureDesktopShortcut(event("Escape", { code: "Escape" }))).toEqual({ kind: "cancel" });
    expect(captureDesktopShortcut(event("Tab", { code: "Tab", shiftKey: true }))).toEqual({
      kind: "cancel",
    });
    expect(
      captureDesktopShortcut(
        event("Escape", {
          code: "Escape",
          ctrlKey: true,
        }),
      ),
    ).toEqual({
      kind: "invalid",
      preview: "Control+Escape",
      code: "shortcut-reserved",
    });
  });

  it("reports missing modifiers without pretending the recording completed", () => {
    expect(captureDesktopShortcut(event("K", { code: "KeyK" }))).toEqual({
      kind: "invalid",
      preview: "K",
      code: "shortcut-missing-modifier",
    });
  });
});
