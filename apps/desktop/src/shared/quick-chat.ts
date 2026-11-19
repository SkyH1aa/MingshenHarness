import type {
  ContextUsageView,
  ProviderView,
  SessionMessage,
  SessionRunState,
  SessionView,
} from "./domain";

export const QUICK_CHAT_TTL_MS = 10 * 60 * 1000;

export interface QuickChatState {
  session: SessionView | null;
  providers: ProviderView[];
  messages: SessionMessage[];
  runState: SessionRunState | null;
  context: ContextUsageView | null;
  expiresAt: number | null;
  pinned: boolean;
  error: string | null;
}

export type QuickChatAction =
  | "show"
  | "new"
  | "toggle"
  | "hide"
  | "open-main"
  | "configure"
  | "toggle-pin";

export interface DesktopShortcutSettings {
  quickChat: string;
  toggleMain: string;
}

export type DesktopShortcutName = keyof DesktopShortcutSettings;

export interface DesktopShortcutStatus {
  quickChat: boolean;
  toggleMain: boolean;
}

export type DesktopShortcutErrorCode =
  | "shortcut-missing-modifier"
  | "shortcut-missing-key"
  | "shortcut-invalid-key"
  | "shortcut-reserved"
  | "shortcut-duplicate"
  | "shortcut-occupied"
  | "shortcut-registration-failed"
  | "shortcut-persist-failed"
  | "shortcut-load-failed";

export interface DesktopShortcutError {
  code: DesktopShortcutErrorCode;
  message: string;
}

export type DesktopShortcutErrors = Partial<Record<DesktopShortcutName, DesktopShortcutError>>;

export interface DesktopShortcutState {
  settings: DesktopShortcutSettings;
  status: DesktopShortcutStatus;
  errors: DesktopShortcutErrors;
}

export interface DesktopShortcutUpdateResult extends DesktopShortcutState {
  ok: boolean;
}
