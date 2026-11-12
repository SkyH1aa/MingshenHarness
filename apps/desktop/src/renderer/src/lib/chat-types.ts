export interface LiveRun {
  runId: string;
  text: string;
  reasoning: string;
  startedAt: number;
}

export interface SessionUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}
