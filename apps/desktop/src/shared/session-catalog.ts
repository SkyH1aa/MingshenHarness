import type { AgentMode, SessionView } from "./domain";

export type SessionBatchTarget = Pick<
  SessionView,
  "id" | "parentSessionId" | "workspacePath" | "archived"
>;

export interface SessionPageInput {
  query?: string;
  agentMode?: AgentMode | "workspace";
  chatGroupId?: string | null;
  workspacePath?: string | null;
  parentId?: string | null;
  limit?: number;
  cursor?: string | null;
  archived?: boolean;
}
export interface SessionPage {
  sessions: SessionView[];
  nextCursor: string | null;
  total: number;
  revision: number;
}
export interface SessionCatalogDelta {
  revision: number;
  reset: boolean;
  sessions: SessionView[];
  removed: string[];
}
export interface SessionWorkspaceGroup {
  path: string | null;
  total: number;
  latest: string;
  children: number;
}
