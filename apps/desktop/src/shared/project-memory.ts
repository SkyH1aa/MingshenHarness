import type { ModelReference } from "./domain";

export type MemoryDocument = "preferences" | "memory";
export type MemoryBackend = "native" | "tencentdb";
export interface ProjectMemorySelection {
  backend: MemoryBackend;
  locked: boolean;
}
export interface ProjectMemoryConfiguration extends ProjectMemorySelection {
  workspacePath: string;
  analysisModel: ModelReference | null;
  fallbackModel: ModelReference | null;
}
export type ProjectMemoryConfigurationInput = Omit<ProjectMemoryConfiguration, "locked">;
export interface ProjectMemoryView {
  backend?: MemoryBackend;
  frameworkVersion?: string;
  root: string;
  enabled: boolean;
  documents: Record<MemoryDocument | "index", string>;
  revisions: Record<MemoryDocument, string>;
  preferences: number;
  memories: number;
  archives: number;
  bytes: number;
}
export interface MemoryMatch {
  id: string;
  source: string;
  line: number;
  text: string;
}
export interface ProjectMemoryEdit {
  sessionId: string;
  document: MemoryDocument;
  content: string;
  revision: string;
}
