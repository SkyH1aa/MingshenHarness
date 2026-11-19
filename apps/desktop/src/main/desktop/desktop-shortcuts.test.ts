import { describe, expect, it, vi } from "vitest";
import { DESKTOP_SHORTCUTS, DesktopShortcuts } from "./desktop-shortcuts";

function registryFixture(occupied = new Set<string>()) {
  const callbacks = new Map<string, () => void>();
  return {
    callbacks,
    occupied,
    register: vi.fn((key: string, action: () => void) => {
      if (occupied.has(key) || callbacks.has(key)) return false;
      callbacks.set(key, action);
      return true;
    }),
    unregister: vi.fn((key: string) => callbacks.delete(key)),
  };
}

const handlers = () => ({ quickChat: vi.fn(), toggleMain: vi.fn() });

describe("desktop global shortcuts", () => {
  it("registers defaults once and releases only shortcuts owned by this controller", () => {
    const registry = registryFixture();
    const actions = handlers();
    const report = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, actions, report);
    expect(shortcuts.start()).toEqual({ quickChat: true, toggleMain: true });
    shortcuts.start();
    expect(registry.register).toHaveBeenCalledTimes(2);
    registry.callbacks.get(DESKTOP_SHORTCUTS.quickChat)?.();
    registry.callbacks.get(DESKTOP_SHORTCUTS.toggleMain)?.();
    expect(actions.quickChat).toHaveBeenCalledOnce();
    expect(actions.toggleMain).toHaveBeenCalledOnce();
    shortcuts.setCallbacksSuppressed(true);
    registry.callbacks.get(DESKTOP_SHORTCUTS.quickChat)?.();
    expect(actions.quickChat).toHaveBeenCalledOnce();
    shortcuts.setCallbacksSuppressed(false);
    registry.unregister.mockClear();
    expect(report).not.toHaveBeenCalled();
    registry.callbacks.set("Control+K", vi.fn());
    shortcuts.stop();
    shortcuts.stop();
    expect(registry.unregister.mock.calls).toEqual([["Control+M"], ["Control+Alt+L"]]);
    expect(registry.callbacks.has("Control+K")).toBe(true);
  });

  it("loads and normalizes saved bindings without writing them back", () => {
    const registry = registryFixture();
    const persist = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn(), {
      load: () => ({ quickChat: "ctrl+shift+k", toggleMain: "alt+f8" }),
      persist,
    });
    expect(shortcuts.start()).toEqual({ quickChat: true, toggleMain: true });
    expect(shortcuts.state()).toEqual({
      settings: { quickChat: "Control+Shift+K", toggleMain: "Alt+F8" },
      status: { quickChat: true, toggleMain: true },
      errors: {},
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("fills missing saved fields from defaults without persisting", () => {
    const registry = registryFixture();
    const persist = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn(), {
      load: () => ({ quickChat: "ctrl+k" }),
      persist,
    });
    shortcuts.start();
    expect(shortcuts.state().settings).toEqual({
      quickChat: "Control+K",
      toggleMain: DESKTOP_SHORTCUTS.toggleMain,
    });
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not register shortcuts when start is called during recording suppression", () => {
    const registry = registryFixture();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn());
    shortcuts.setCallbacksSuppressed(true);
    expect(shortcuts.start()).toEqual({ quickChat: false, toggleMain: false });
    expect(registry.register).not.toHaveBeenCalled();
    expect(shortcuts.setCallbacksSuppressed(false)).toEqual({
      settings: DESKTOP_SHORTCUTS,
      status: { quickChat: true, toggleMain: true },
      errors: {},
    });
  });

  it("temporarily releases owned bindings while recording and restores them afterward", () => {
    const registry = registryFixture();
    const actions = handlers();
    const shortcuts = new DesktopShortcuts(registry, actions, vi.fn());
    shortcuts.start();
    registry.callbacks.set("Control+K", vi.fn());
    expect(shortcuts.setCallbacksSuppressed(true)).toEqual({
      settings: DESKTOP_SHORTCUTS,
      status: { quickChat: false, toggleMain: false },
      errors: {},
    });
    expect(registry.callbacks.has(DESKTOP_SHORTCUTS.quickChat)).toBe(false);
    expect(registry.callbacks.has(DESKTOP_SHORTCUTS.toggleMain)).toBe(false);
    expect(registry.callbacks.has("Control+K")).toBe(true);
    expect(shortcuts.setCallbacksSuppressed(false)).toEqual({
      settings: DESKTOP_SHORTCUTS,
      status: { quickChat: true, toggleMain: true },
      errors: {},
    });
    registry.callbacks.get(DESKTOP_SHORTCUTS.quickChat)?.();
    registry.callbacks.get(DESKTOP_SHORTCUTS.toggleMain)?.();
    expect(actions.quickChat).toHaveBeenCalledOnce();
    expect(actions.toggleMain).toHaveBeenCalledOnce();
  });

  it("restores the current bindings before applying an update during recording", () => {
    const registry = registryFixture();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn());
    shortcuts.start();
    shortcuts.setCallbacksSuppressed(true);
    const result = shortcuts.update({
      quickChat: "Control+Shift+Q",
      toggleMain: "Alt+F9",
    });
    expect(result.ok).toBe(true);
    expect(result.status).toEqual({ quickChat: true, toggleMain: true });
    expect(registry.callbacks.has("Control+Shift+Q")).toBe(true);
    expect(registry.callbacks.has("Alt+F9")).toBe(true);
  });

  it("reports a real occupancy when restoring after recording", () => {
    const registry = registryFixture();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn());
    shortcuts.start();
    shortcuts.setCallbacksSuppressed(true);
    registry.occupied.add(DESKTOP_SHORTCUTS.quickChat);
    const restored = shortcuts.setCallbacksSuppressed(false);
    expect(restored.status).toEqual({ quickChat: false, toggleMain: true });
    expect(restored.errors.quickChat?.code).toBe("shortcut-occupied");
  });

  it("falls back to defaults for a bad saved configuration without overwriting it", () => {
    const registry = registryFixture();
    const persist = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn(), {
      load: () => ({ quickChat: "Control+M", toggleMain: "Control+M" }),
      persist,
    });
    expect(shortcuts.start()).toEqual({ quickChat: true, toggleMain: true });
    expect(shortcuts.state().settings).toEqual(DESKTOP_SHORTCUTS);
    expect(shortcuts.state().errors.quickChat?.code).toBe("shortcut-duplicate");
    expect(shortcuts.state().errors.toggleMain?.code).toBe("shortcut-duplicate");
    expect(persist).not.toHaveBeenCalled();
  });

  it("can repair a bad saved configuration by saving the same effective defaults", () => {
    const registry = registryFixture();
    const persist = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn(), {
      load: () => ({ quickChat: "Control+M", toggleMain: "Control+M" }),
      persist,
    });
    shortcuts.start();
    expect(shortcuts.state().errors.quickChat?.code).toBe("shortcut-duplicate");
    const result = shortcuts.update(DESKTOP_SHORTCUTS);
    expect(result).toEqual({
      ok: true,
      settings: DESKTOP_SHORTCUTS,
      status: { quickChat: true, toggleMain: true },
      errors: {},
    });
    expect(result).toEqual({ ok: true, ...shortcuts.state() });
    expect(persist).toHaveBeenCalledExactlyOnceWith(DESKTOP_SHORTCUTS);
  });

  it("updates both bindings transactionally and persists normalized values", () => {
    const registry = registryFixture();
    const actions = handlers();
    const persist = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, actions, vi.fn(), {
      persist,
    });
    shortcuts.start();
    registry.register.mockClear();
    registry.unregister.mockClear();
    const result = shortcuts.update({
      quickChat: "ctrl+shift+q",
      toggleMain: "alt+f9",
    });
    expect(result).toEqual({
      ok: true,
      settings: { quickChat: "Control+Shift+Q", toggleMain: "Alt+F9" },
      status: { quickChat: true, toggleMain: true },
      errors: {},
    });
    expect(persist).toHaveBeenCalledExactlyOnceWith(result.settings);
    expect(registry.unregister.mock.calls).toEqual([["Control+M"], ["Control+Alt+L"]]);
    registry.callbacks.get("Control+Shift+Q")?.();
    registry.callbacks.get("Alt+F9")?.();
    expect(actions.quickChat).toHaveBeenCalledOnce();
    expect(actions.toggleMain).toHaveBeenCalledOnce();
  });

  it("supports swapping the two internal bindings", () => {
    const registry = registryFixture();
    const actions = handlers();
    const shortcuts = new DesktopShortcuts(registry, actions, vi.fn());
    shortcuts.start();
    expect(
      shortcuts.update({
        quickChat: DESKTOP_SHORTCUTS.toggleMain,
        toggleMain: DESKTOP_SHORTCUTS.quickChat,
      }).ok,
    ).toBe(true);
    expect(shortcuts.state().settings).toEqual({
      quickChat: "Control+Alt+L",
      toggleMain: "Control+M",
    });
    registry.callbacks.get("Control+Alt+L")?.();
    registry.callbacks.get("Control+M")?.();
    expect(actions.quickChat).toHaveBeenCalledOnce();
    expect(actions.toggleMain).toHaveBeenCalledOnce();
  });

  it("keeps the previous working bindings when an occupied update fails", () => {
    const registry = registryFixture(new Set(["Control+N"]));
    const actions = handlers();
    const persist = vi.fn();
    const report = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, actions, report, { persist });
    shortcuts.start();
    const result = shortcuts.update({
      quickChat: "Control+N",
      toggleMain: DESKTOP_SHORTCUTS.toggleMain,
    });
    expect(result.ok).toBe(false);
    expect(result.settings).toEqual(DESKTOP_SHORTCUTS);
    expect(result.status).toEqual({ quickChat: true, toggleMain: true });
    expect(result.errors.quickChat?.code).toBe("shortcut-occupied");
    expect(persist).not.toHaveBeenCalled();
    registry.callbacks.get(DESKTOP_SHORTCUTS.quickChat)?.();
    registry.callbacks.get(DESKTOP_SHORTCUTS.toggleMain)?.();
    expect(actions.quickChat).toHaveBeenCalledOnce();
    expect(actions.toggleMain).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith("Control+N");
  });

  it("preserves the error for a binding that was already unregistered before rollback", () => {
    const registry = registryFixture(new Set([DESKTOP_SHORTCUTS.quickChat, "Control+N"]));
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn());
    shortcuts.start();
    expect(shortcuts.state().status).toEqual({
      quickChat: false,
      toggleMain: true,
    });
    expect(shortcuts.state().errors.quickChat?.code).toBe("shortcut-occupied");
    const result = shortcuts.update({
      quickChat: "Control+Q",
      toggleMain: "Control+N",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toEqual({ quickChat: false, toggleMain: true });
    expect(result.errors.quickChat?.code).toBe("shortcut-occupied");
    expect(result.errors.toggleMain?.code).toBe("shortcut-occupied");
    expect(result).toEqual({ ok: false, ...shortcuts.state() });
  });

  it("rolls back registration when persistence fails", () => {
    const registry = registryFixture();
    const actions = handlers();
    const shortcuts = new DesktopShortcuts(registry, actions, vi.fn(), {
      persist: () => {
        throw new Error("disk unavailable");
      },
    });
    shortcuts.start();
    const result = shortcuts.update({
      quickChat: "Control+Shift+Q",
      toggleMain: "Alt+F9",
    });
    expect(result.ok).toBe(false);
    expect(result.settings).toEqual(DESKTOP_SHORTCUTS);
    expect(result.status).toEqual({ quickChat: true, toggleMain: true });
    expect(result.errors.quickChat).toEqual({
      code: "shortcut-persist-failed",
      message: "Cannot save shortcut settings: disk unavailable",
    });
    expect(result.errors.toggleMain?.code).toBe("shortcut-persist-failed");
    expect(shortcuts.state().status).toEqual({
      quickChat: true,
      toggleMain: true,
    });
    expect(shortcuts.state().errors).toEqual(result.errors);
    registry.callbacks.get(DESKTOP_SHORTCUTS.quickChat)?.();
    registry.callbacks.get(DESKTOP_SHORTCUTS.toggleMain)?.();
    expect(actions.quickChat).toHaveBeenCalledOnce();
    expect(actions.toggleMain).toHaveBeenCalledOnce();
  });

  it("clears a stale persistence error after a later save succeeds", () => {
    const registry = registryFixture();
    const persist = vi.fn().mockImplementationOnce(() => {
      throw new Error("disk unavailable");
    });
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn(), { persist });
    shortcuts.start();

    const failed = shortcuts.update({
      quickChat: "Alt+F8",
      toggleMain: DESKTOP_SHORTCUTS.toggleMain,
    });
    expect(failed.ok).toBe(false);
    expect(failed.errors.quickChat?.code).toBe("shortcut-persist-failed");

    const saved = shortcuts.update({
      quickChat: DESKTOP_SHORTCUTS.quickChat,
      toggleMain: "Alt+F8",
    });
    expect(saved.ok).toBe(true);
    expect(saved.errors).toEqual({});
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("clears a stale persistence error without hiding an occupied binding", () => {
    const registry = registryFixture(new Set([DESKTOP_SHORTCUTS.toggleMain]));
    const persist = vi.fn().mockImplementationOnce(() => {
      throw new Error("disk unavailable");
    });
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn(), { persist });
    shortcuts.start();
    expect(shortcuts.state().errors.toggleMain?.code).toBe("shortcut-occupied");

    const update = {
      quickChat: "Control+Shift+Q",
      toggleMain: DESKTOP_SHORTCUTS.toggleMain,
    };
    const failed = shortcuts.update(update);
    expect(failed.ok).toBe(false);
    expect(failed.errors.quickChat?.code).toBe("shortcut-persist-failed");
    expect(failed.errors.toggleMain?.code).toBe("shortcut-occupied");

    const saved = shortcuts.update(update);
    expect(saved.ok).toBe(true);
    expect(saved.errors.quickChat).toBeUndefined();
    expect(saved.errors.toggleMain?.code).toBe("shortcut-occupied");
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("returns registration exceptions without throwing or losing old bindings", () => {
    const registry = registryFixture();
    const actions = handlers();
    const shortcuts = new DesktopShortcuts(registry, actions, vi.fn());
    shortcuts.start();
    registry.register.mockImplementationOnce(() => {
      throw new Error("native registration crashed");
    });
    const result = shortcuts.update({
      quickChat: "Control+Shift+Q",
      toggleMain: "Alt+F9",
    });
    expect(result.ok).toBe(false);
    expect(result.settings).toEqual(DESKTOP_SHORTCUTS);
    expect(result.status).toEqual({ quickChat: true, toggleMain: true });
    expect(result.errors.quickChat).toEqual({
      code: "shortcut-registration-failed",
      message: "Cannot register Control+Shift+Q: native registration crashed",
    });
    registry.callbacks.get(DESKTOP_SHORTCUTS.quickChat)?.();
    expect(actions.quickChat).toHaveBeenCalledOnce();
  });

  it("returns validation errors for duplicates and reserved shortcuts without registering", () => {
    const registry = registryFixture();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn());
    shortcuts.start();
    registry.register.mockClear();
    registry.unregister.mockClear();
    const duplicate = shortcuts.update({
      quickChat: "Control+M",
      toggleMain: "ctrl+m",
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.quickChat?.code).toBe("shortcut-duplicate");
    const reserved = shortcuts.update({
      quickChat: "Alt+F4",
      toggleMain: "Control+Alt+L",
    });
    expect(reserved.ok).toBe(false);
    expect(reserved.errors.quickChat?.code).toBe("shortcut-reserved");
    expect(registry.register).not.toHaveBeenCalled();
    expect(registry.unregister).not.toHaveBeenCalled();
    expect(shortcuts.state().settings).toEqual(DESKTOP_SHORTCUTS);
  });

  it("rejects missing fields and non-object updates without changing current bindings", () => {
    const registry = registryFixture();
    const persist = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn(), {
      persist,
    });
    shortcuts.start();
    registry.register.mockClear();
    registry.unregister.mockClear();
    const missing = shortcuts.update({
      quickChat: "Control+Shift+Q",
    } as never);
    expect(missing.ok).toBe(false);
    expect(missing.errors.toggleMain?.code).toBe("shortcut-invalid-key");
    const nonObject = shortcuts.update(null as never);
    expect(nonObject.ok).toBe(false);
    expect(nonObject.errors.quickChat?.code).toBe("shortcut-invalid-key");
    expect(shortcuts.state().settings).toEqual(DESKTOP_SHORTCUTS);
    expect(registry.register).not.toHaveBeenCalled();
    expect(registry.unregister).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("keeps the other default binding when one initial registration is occupied", () => {
    const registry = registryFixture(new Set(["Control+M"]));
    const report = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, handlers(), report);
    expect(shortcuts.start()).toEqual({ quickChat: false, toggleMain: true });
    expect(shortcuts.state().errors.quickChat?.code).toBe("shortcut-occupied");
    expect(report).toHaveBeenCalledWith("Control+M");
  });

  it("can change one binding without retrying an unrelated unavailable shortcut", () => {
    const registry = registryFixture(new Set([DESKTOP_SHORTCUTS.toggleMain]));
    const persist = vi.fn();
    const shortcuts = new DesktopShortcuts(registry, handlers(), vi.fn(), { persist });
    expect(shortcuts.start()).toEqual({ quickChat: true, toggleMain: false });

    const result = shortcuts.update({
      quickChat: "Control+Shift+1",
      toggleMain: DESKTOP_SHORTCUTS.toggleMain,
    });
    expect(result).toMatchObject({
      ok: true,
      settings: {
        quickChat: "Control+Shift+1",
        toggleMain: DESKTOP_SHORTCUTS.toggleMain,
      },
      status: { quickChat: true, toggleMain: false },
    });
    expect(result.errors.toggleMain?.code).toBe("shortcut-occupied");
    expect(persist).toHaveBeenCalledExactlyOnceWith(result.settings);
    expect(registry.callbacks.has("Control+Shift+1")).toBe(true);
  });
});
