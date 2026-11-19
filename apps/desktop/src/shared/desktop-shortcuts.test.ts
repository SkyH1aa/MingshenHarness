import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_SHORTCUTS,
  desktopShortcutDisplayParts,
  formatDesktopShortcut,
  loadDesktopShortcutSettings,
  parseDesktopShortcut,
  validateDesktopShortcutSettings,
} from "./desktop-shortcuts";

describe("desktop shortcut parsing", () => {
  it("normalizes recorded modifiers and common keys", () => {
    expect(parseDesktopShortcut({ key: "m", ctrlKey: true, shiftKey: true })).toEqual({
      ok: true,
      accelerator: "Control+Shift+M",
    });
    expect(parseDesktopShortcut("alt+f8")).toEqual({
      ok: true,
      accelerator: "Alt+F8",
    });
    expect(parseDesktopShortcut("Shift+PageDown")).toEqual({
      ok: true,
      accelerator: "Shift+PageDown",
    });
    expect(parseDesktopShortcut({ key: " ", ctrlKey: true })).toEqual({
      ok: true,
      accelerator: "Control+Space",
    });
  });

  it("rejects incomplete, unsupported and reserved shortcuts with stable codes", () => {
    expect(parseDesktopShortcut("M")).toMatchObject({
      ok: false,
      error: { code: "shortcut-missing-modifier" },
    });
    expect(parseDesktopShortcut({ key: "Control", ctrlKey: true })).toMatchObject({
      ok: false,
      error: { code: "shortcut-missing-key" },
    });
    expect(parseDesktopShortcut("Control+F25")).toMatchObject({
      ok: false,
      error: { code: "shortcut-invalid-key" },
    });
    expect(parseDesktopShortcut("Alt+F4")).toMatchObject({
      ok: false,
      error: { code: "shortcut-reserved" },
    });
    expect(parseDesktopShortcut({ key: "K", ctrlKey: true, metaKey: true })).toMatchObject({
      ok: false,
      error: { code: "shortcut-invalid-key" },
    });
  });

  it("returns validation results instead of throwing for unknown input", () => {
    for (const input of [null, undefined, 42, [], { key: 42 }]) {
      expect(parseDesktopShortcut(input)).toMatchObject({
        ok: false,
        error: { code: "shortcut-invalid-key" },
      });
    }
  });

  it("separates strict updates from tolerant configuration loading", () => {
    expect(validateDesktopShortcutSettings({ quickChat: "ctrl+k" })).toMatchObject({
      ok: false,
      errors: {
        toggleMain: { code: "shortcut-invalid-key" },
      },
    });
    expect(validateDesktopShortcutSettings(null)).toMatchObject({
      ok: false,
      errors: {
        quickChat: { code: "shortcut-invalid-key" },
        toggleMain: { code: "shortcut-invalid-key" },
      },
    });
    expect(loadDesktopShortcutSettings({ quickChat: "ctrl+k" })).toEqual({
      ok: true,
      settings: {
        quickChat: "Control+K",
        toggleMain: DEFAULT_DESKTOP_SHORTCUTS.toggleMain,
      },
    });
    expect(
      validateDesktopShortcutSettings({
        quickChat: "Control+M",
        toggleMain: "ctrl+m",
      }),
    ).toMatchObject({
      ok: false,
      errors: {
        quickChat: { code: "shortcut-duplicate" },
        toggleMain: { code: "shortcut-duplicate" },
      },
    });
    expect(loadDesktopShortcutSettings(null)).toEqual({
      ok: true,
      settings: DEFAULT_DESKTOP_SHORTCUTS,
    });
    expect(loadDesktopShortcutSettings("bad configuration")).toMatchObject({
      ok: false,
      errors: {
        quickChat: { code: "shortcut-invalid-key" },
        toggleMain: { code: "shortcut-invalid-key" },
      },
    });
  });

  it("formats accelerators consistently for the titlebar and keycaps", () => {
    expect(formatDesktopShortcut("Control+Alt+L")).toBe("Ctrl+Alt+L");
    expect(desktopShortcutDisplayParts("Control+Shift+PageDown")).toEqual([
      "Ctrl",
      "Shift",
      "PageDown",
    ]);
  });

  it("keeps two-key defaults and existing bindings while accepting longer combinations", () => {
    expect(
      validateDesktopShortcutSettings({
        quickChat: "Control+Shift+M",
        toggleMain: "Control+Alt+L",
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateDesktopShortcutSettings({
        quickChat: "Control+Alt+Shift+F12",
        toggleMain: "Control+Alt+L",
      }),
    ).toMatchObject({ ok: true });
    expect(loadDesktopShortcutSettings({ quickChat: "Control+K" })).toEqual({
      ok: true,
      settings: {
        quickChat: "Control+K",
        toggleMain: "Control+Alt+L",
      },
    });
  });
});
