export interface CompactionSummarySegment {
  id: string;
  summary: string;
  createdAt: string;
}

export interface SummaryCheckpoint extends CompactionSummarySegment {
  segments?: CompactionSummarySegment[];
}

export const MAX_SUMMARY_SEGMENTS = 8;

/** Old checkpoints remain one segment; malformed new metadata never hides their summary. */
export function summarySegments(checkpoint: SummaryCheckpoint): CompactionSummarySegment[] {
  const segments = checkpoint.segments;
  if (
    !Array.isArray(segments) ||
    !segments.length ||
    segments.length > MAX_SUMMARY_SEGMENTS ||
    segments.some(
      (segment) =>
        !segment ||
        typeof segment.id !== "string" ||
        !segment.id ||
        typeof segment.summary !== "string" ||
        !segment.summary.trim() ||
        typeof segment.createdAt !== "string",
    ) ||
    new Set(segments.map((segment) => segment.id)).size !== segments.length ||
    segments.map((segment) => segment.summary).join("\n\n") !== checkpoint.summary
  )
    return [{ id: checkpoint.id, summary: checkpoint.summary, createdAt: checkpoint.createdAt }];
  return segments;
}

export function summarySegmentBudget(contextWindow: number): number {
  return Math.floor(contextWindow * 0.15);
}
