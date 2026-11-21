import type { FileDiff } from "./domain";

export type LocalReviewScope = "git" | "branch" | "session" | "previous";

export interface LocalReviewRequest {
  sessionId: string;
  scope: LocalReviewScope;
  baseRef?: string | null;
}

export interface LocalReviewFile {
  path: string;
  absolutePath: string;
  changeType: "created" | "modified" | "deleted";
  additions: number;
  deletions: number;
  diff: FileDiff | null;
  version: string;
}

export interface LocalReviewSnapshot {
  sessionId: string;
  scope: LocalReviewScope;
  workspacePath: string;
  root: string;
  isRepository: boolean;
  currentBranch: string | null;
  baseRef: string | null;
  branches: string[];
  generatedAt: string;
  files: LocalReviewFile[];
  warnings: string[];
  truncated: boolean;
  runId: string | null;
}

export interface LocalReviewCommentDraft {
  path: string;
  version: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  text: string;
}

export interface LocalReviewCommentsInput {
  request: LocalReviewRequest;
  comments: LocalReviewCommentDraft[];
}

export interface LocalReviewCommentsResult {
  ok: boolean;
  staleFiles: string[];
  formattedText: string | null;
}
