import type { AgentProfileRole } from "./domain";

export function supportsSubagentModel(role: AgentProfileRole): boolean {
  return role === "subagent" || role === "all";
}

export function resolveSubagentModelId(
  role: AgentProfileRole,
  profileModelId: string | null | undefined,
  parentModelId: string,
): string {
  return supportsSubagentModel(role) && profileModelId ? profileModelId : parentModelId;
}
