import { isSupportedChatRasterImageFile } from "../../../shared/attachments";
import type { AgentMode, AgentProfileView } from "../../../shared/domain";

export type WorkspaceAgentMode = Exclude<AgentMode, "chat">;

export const WORKSPACE_AGENT_MODES: WorkspaceAgentMode[] = ["code", "work"];

const CHAT_ATTACHMENT_PATTERN = /\.(?:pdf|docx?|xlsx?|pptx)$/i;

export function updateSessionLockSet(
  current: ReadonlySet<string>,
  sessionId: string,
  locked: boolean,
): ReadonlySet<string> {
  if (current.has(sessionId) === locked) return current;
  const next = new Set(current);
  if (locked) next.add(sessionId);
  else next.delete(sessionId);
  return next;
}

export function profileApplicableModes(
  profile: Pick<AgentProfileView, "applicableModes">,
): WorkspaceAgentMode[] {
  return profile.applicableModes?.length ? profile.applicableModes : WORKSPACE_AGENT_MODES;
}

export function profileSupportsAgentMode(
  profile: Pick<AgentProfileView, "applicableModes">,
  mode: WorkspaceAgentMode,
): boolean {
  return profileApplicableModes(profile).includes(mode);
}

export function isAllowedChatAttachment(file: Pick<File, "name" | "type">): boolean {
  return (
    isSupportedChatRasterImageFile(file.name, file.type) || CHAT_ATTACHMENT_PATTERN.test(file.name)
  );
}
