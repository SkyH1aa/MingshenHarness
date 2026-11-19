import type {
  DesktopShortcutError,
  DesktopShortcutErrors,
  DesktopShortcutName,
  DesktopShortcutSettings,
} from "./quick-chat";

export const DEFAULT_DESKTOP_SHORTCUTS: DesktopShortcutSettings = {
  quickChat: "Control+M",
  toggleMain: "Control+Alt+L",
};

export interface DesktopShortcutRecording {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

export type DesktopShortcutInput = string | DesktopShortcutRecording;

export type DesktopShortcutParseResult =
  | { ok: true; accelerator: string }
  | { ok: false; error: DesktopShortcutError };

export type DesktopShortcutSettingsResult =
  | { ok: true; settings: DesktopShortcutSettings }
  | { ok: false; errors: DesktopShortcutErrors };

const MODIFIERS = ["Control", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIERS)[number];

const MODIFIER_ALIASES = new Map<string, Modifier>([
  ["control", "Control"],
  ["ctrl", "Control"],
  ["alt", "Alt"],
  ["shift", "Shift"],
]);

const NAMED_KEYS = new Map<string, string>([
  ["space", "Space"],
  ["spacebar", "Space"],
  ["tab", "Tab"],
  ["enter", "Enter"],
  ["return", "Enter"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["del", "Delete"],
  ["insert", "Insert"],
  ["ins", "Insert"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
  ["arrowup", "Up"],
  ["arrowdown", "Down"],
  ["arrowleft", "Left"],
  ["arrowright", "Right"],
  ["up", "Up"],
  ["down", "Down"],
  ["left", "Left"],
  ["right", "Right"],
  ["escape", "Escape"],
  ["esc", "Escape"],
]);

const RESERVED_SHORTCUTS = new Set([
  "Alt+F4",
  "Alt+Tab",
  "Alt+Escape",
  "Alt+Space",
  "Control+Escape",
  "Control+Alt+Delete",
  "Control+Shift+Escape",
]);

const MODIFIER_KEYS = new Set([
  "alt",
  "control",
  "ctrl",
  "shift",
  "meta",
  "command",
  "cmd",
  "win",
  "windows",
]);

function error(code: DesktopShortcutError["code"], message: string): DesktopShortcutError {
  return { code, message };
}

function normalizeKey(value: string): string | null {
  if (value === " ") return "Space";
  const key = value.trim();
  if (!key) return null;
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  const functionKey = /^f(?:[1-9]|1\d|2[0-4])$/i.exec(key);
  if (functionKey) return `F${functionKey[0].slice(1)}`;
  return NAMED_KEYS.get(key.toLocaleLowerCase("en-US")) ?? null;
}

function normalizeInput(input: unknown): DesktopShortcutParseResult {
  const modifiers = new Set<Modifier>();
  let key: string | null = null;

  if (typeof input === "string") {
    const parts = input
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length)
      return {
        ok: false,
        error: error("shortcut-missing-key", "Shortcut key is required."),
      };
    for (const part of parts) {
      const modifier = MODIFIER_ALIASES.get(part.toLocaleLowerCase("en-US"));
      if (modifier) {
        if (modifiers.has(modifier))
          return {
            ok: false,
            error: error(
              "shortcut-invalid-key",
              `Modifier ${modifier} is specified more than once.`,
            ),
          };
        modifiers.add(modifier);
        continue;
      }
      if (key !== null)
        return {
          ok: false,
          error: error(
            "shortcut-invalid-key",
            "A shortcut must contain exactly one non-modifier key.",
          ),
        };
      key = normalizeKey(part);
      if (!key)
        return {
          ok: false,
          error: error("shortcut-invalid-key", `Unsupported shortcut key: ${part}.`),
        };
    }
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    const recording = input as Record<string, unknown>;
    if (recording.metaKey === true)
      return {
        ok: false,
        error: error(
          "shortcut-invalid-key",
          "Meta, Command and Windows modifiers are not supported.",
        ),
      };
    if (recording.ctrlKey === true) modifiers.add("Control");
    if (recording.altKey === true) modifiers.add("Alt");
    if (recording.shiftKey === true) modifiers.add("Shift");
    if (typeof recording.key !== "string")
      return {
        ok: false,
        error: error("shortcut-invalid-key", "Shortcut recording must include a string key."),
      };
    const rawKey = recording.key.trim().toLocaleLowerCase("en-US");
    if (MODIFIER_KEYS.has(rawKey))
      return {
        ok: false,
        error: error("shortcut-missing-key", "Press a non-modifier key after the modifiers."),
      };
    key = normalizeKey(recording.key);
    if (!key)
      return {
        ok: false,
        error: error(
          "shortcut-invalid-key",
          `Unsupported shortcut key: ${recording.key || "unknown"}.`,
        ),
      };
  } else
    return {
      ok: false,
      error: error("shortcut-invalid-key", "Shortcut input must be a string or recording object."),
    };

  if (!modifiers.size)
    return {
      ok: false,
      error: error("shortcut-missing-modifier", "Use at least one of Control, Alt or Shift."),
    };
  if (!key)
    return {
      ok: false,
      error: error("shortcut-missing-key", "Shortcut key is required."),
    };

  const accelerator = [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join("+");
  if (RESERVED_SHORTCUTS.has(accelerator))
    return {
      ok: false,
      error: error("shortcut-reserved", `${accelerator} is reserved by the operating system.`),
    };
  return { ok: true, accelerator };
}

export function parseDesktopShortcut(input: unknown): DesktopShortcutParseResult {
  return normalizeInput(input);
}

function normalizeSettings(input: unknown, allowMissing: boolean): DesktopShortcutSettingsResult {
  const errors: DesktopShortcutErrors = {};
  const settings = {} as DesktopShortcutSettings;
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;
  if (!record && input != null)
    return {
      ok: false,
      errors: {
        quickChat: error("shortcut-invalid-key", "Shortcut settings must be an object."),
        toggleMain: error("shortcut-invalid-key", "Shortcut settings must be an object."),
      },
    };
  if (!record && !allowMissing)
    return {
      ok: false,
      errors: {
        quickChat: error("shortcut-invalid-key", "Shortcut settings must be an object."),
        toggleMain: error("shortcut-invalid-key", "Shortcut settings must be an object."),
      },
    };
  for (const name of Object.keys(DEFAULT_DESKTOP_SHORTCUTS) as DesktopShortcutName[]) {
    const value = record?.[name];
    if (value === undefined && !allowMissing) {
      errors[name] = error("shortcut-invalid-key", `Shortcut setting ${name} is required.`);
      continue;
    }
    if (value !== undefined && typeof value !== "string") {
      errors[name] = error("shortcut-invalid-key", "Shortcut value must be a string.");
      continue;
    }
    const parsed = normalizeInput(value ?? DEFAULT_DESKTOP_SHORTCUTS[name]);
    if (parsed.ok) settings[name] = parsed.accelerator;
    else errors[name] = parsed.error;
  }
  if (!errors.quickChat && !errors.toggleMain) {
    if (
      settings.quickChat.toLocaleLowerCase("en-US") ===
      settings.toggleMain.toLocaleLowerCase("en-US")
    ) {
      const duplicate = error(
        "shortcut-duplicate",
        "Quick Chat and Show/Hide Mingshen cannot use the same shortcut.",
      );
      errors.quickChat = duplicate;
      errors.toggleMain = duplicate;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings };
}

export function validateDesktopShortcutSettings(input: unknown): DesktopShortcutSettingsResult {
  return normalizeSettings(input, false);
}

export function loadDesktopShortcutSettings(input: unknown): DesktopShortcutSettingsResult {
  return normalizeSettings(input, true);
}

export function desktopShortcutDisplayParts(accelerator: string): string[] {
  return accelerator
    .split("+")
    .filter(Boolean)
    .map((part) => (part.toLocaleLowerCase("en-US") === "control" ? "Ctrl" : part));
}

export function formatDesktopShortcut(accelerator: string): string {
  return desktopShortcutDisplayParts(accelerator).join("+");
}
