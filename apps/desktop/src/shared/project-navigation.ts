export interface SessionProjectContext {
  sessionId: string;
  workspacePath: string;
  branch: string | null;
  worktree: boolean;
  recordedAt: string;
}

export interface SessionProjectContexts {
  contexts: Record<string, SessionProjectContext | null>;
}

export interface WorkspaceFileSearchInput {
  sessionId: string;
  query: string;
  limit?: number;
}

export interface WorkspaceFileSearchItem {
  name: string;
  path: string;
  relativePath: string;
}

export interface WorkspaceFileSearchResult {
  items: WorkspaceFileSearchItem[];
  root: string;
  truncated: boolean;
}
