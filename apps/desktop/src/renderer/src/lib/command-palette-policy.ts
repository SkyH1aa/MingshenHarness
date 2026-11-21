import type { SessionView } from "../../../shared/domain";

const APP_COMMAND_IDS = new Set([
  "settings",
  "new-session",
  "terminal",
  "files",
  "review",
  "workstation",
  "image-studio",
]);
const SLASH_COMMAND_IDS = new Set([
  "rename",
  "compact",
  "archive",
  "fork",
  "skills",
  "plugins",
  "status",
  "plan",
  "mcp",
  "remember",
  "forget",
  "memory",
]);
const SAFE_SESSION_COMMANDS = new Set(["rename", "compact", "archive", "status"]);

export function currentPaletteSession(
  session: SessionView | null,
  sessionId: string | null | undefined,
): SessionView | null {
  return session && session.id === sessionId ? session : null;
}

export function paletteSearchScopeMatches(
  scope: { sessionId: string | null | undefined; query: string },
  sessionId: string | null | undefined,
  query: string,
): boolean {
  return scope.sessionId === sessionId && scope.query === query.trim();
}

export function commandPaletteCommandAvailable(
  commandId: string,
  session: SessionView | null,
): boolean {
  if (commandId === "settings") return true;
  if (commandId === "new-session") return !session?.parentSessionId;
  if (commandId.startsWith("custom:"))
    return Boolean(
      session && session.agentMode !== "chat" && !session.parentSessionId && session.workspacePath,
    );
  if (session?.agentMode === "chat") return false;
  if (APP_COMMAND_IDS.has(commandId))
    return Boolean(session && !session.parentSessionId && session.workspacePath);
  if (!session || !SLASH_COMMAND_IDS.has(commandId)) return false;
  if (SAFE_SESSION_COMMANDS.has(commandId)) return true;
  return !session.parentSessionId && Boolean(session.workspacePath);
}
