export interface RuntimeLogStatus {
  directory: string;
  files: number;
  bytes: number;
  retentionDays: number;
  maxBytes: number;
  lastError: string | null;
}

export interface RendererErrorReport {
  source: "window" | "promise" | "react";
  message: string;
  stack?: string;
}
