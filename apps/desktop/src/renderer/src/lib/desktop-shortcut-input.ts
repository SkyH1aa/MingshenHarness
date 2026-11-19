import { parseDesktopShortcut } from "../../../shared/desktop-shortcuts";
import type { DesktopShortcutErrorCode } from "../../../shared/quick-chat";

export type ShortcutCaptureEvent = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  altGraph?: boolean;
};

export type ShortcutCapture =
  | { kind: "cancel" }
  | { kind: "pending"; preview: string }
  | { kind: "complete"; accelerator: string }
  | { kind: "invalid"; preview: string; code: DesktopShortcutErrorCode };

const MODIFIER_KEYS = new Set(["control", "ctrl", "alt", "shift", "meta", "os", "altgraph"]);

function keyFromEvent(event: ShortcutCaptureEvent): string {
  const code = event.code ?? "";
  const key = event.key;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();

  const shiftedDigit = /^Digit([0-9])$/.exec(code)?.[1];
  if (event.shiftKey && shiftedDigit && key.length === 1 && !/^[a-z0-9]$/i.test(key))
    return shiftedDigit;

  const functionKey = /^F(?:[1-9]|1\d|2[0-4])$/i.exec(key);
  if (functionKey) return functionKey[0].toUpperCase();

  const named: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    Enter: "Enter",
    NumpadEnter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Escape",
  };
  return named[code] ?? key;
}

export function captureDesktopShortcut(event: ShortcutCaptureEvent): ShortcutCapture {
  const modifiers = [
    ...(event.ctrlKey ? ["Control"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
  ];
  const key = keyFromEvent(event);
  const normalizedKey = key.trim().toLocaleLowerCase("en-US");
  const preview = [...modifiers, key.trim()].filter(Boolean).join("+");

  if (normalizedKey === "escape" && !modifiers.length) return { kind: "cancel" };
  if (normalizedKey === "tab" && !event.ctrlKey && !event.altKey) return { kind: "cancel" };
  // Windows Chromium reports Ctrl+Alt as AltGraph even for an ordinary two-modifier chord.
  const actualAltGraph = event.altGraph && (!event.ctrlKey || !event.altKey);
  if (event.isComposing || event.repeat || event.metaKey || actualAltGraph)
    return { kind: "pending", preview };
  if (!normalizedKey || MODIFIER_KEYS.has(normalizedKey))
    return { kind: "pending", preview: modifiers.join("+") };
  if (event.code?.startsWith("Numpad"))
    return { kind: "invalid", preview, code: "shortcut-invalid-key" };
  const parsed = parseDesktopShortcut({
    key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  });
  return parsed.ok
    ? { kind: "complete", accelerator: parsed.accelerator }
    : { kind: "invalid", preview, code: parsed.error.code };
}

export function shortcutParts(accelerator: string): string[] {
  return accelerator.split("+").filter(Boolean);
}
