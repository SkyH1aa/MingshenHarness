export interface RuntimeLogBreakdown {
  name: string;
  errors: number;
  warnings: number;
}

/** Counts describe retained records, not deduplicated incidents or all-time totals. */
export interface RuntimeLogStatistics {
  errors: number;
  warnings: number;
  omitted: { errors: number; warnings: number; unknown: number };
  damaged: number;
  bySource: RuntimeLogBreakdown[];
  byOperation: RuntimeLogBreakdown[];
}

export interface RuntimeLogStatus {
  directory: string;
  files: number;
  bytes: number;
  retentionDays: number;
  maxBytes: number;
  lastError: string | null;
  statistics: RuntimeLogStatistics;
}

export interface RendererErrorReport {
  source: "window" | "promise" | "react";
  message: string;
  stack?: string;
}
