export type ToolOutcomeStatus =
  | "success"
  | "partial"
  | "failed"
  | "denied"
  | "cancelled"
  | "unverified";

export type ToolEffectState = "none" | "confirmed" | "uncertain";

export type ToolOutputValidationStatus = "validated" | "not_declared" | "invalid" | "unverified";

export interface ToolOutputValidation {
  status: ToolOutputValidationStatus;
  source: "builtin" | "mcp" | "custom" | null;
  error?: string | undefined;
}

export interface ToolOutcomeEvidence {
  kind: "tool-envelope" | "output-schema" | "side-effect" | "artifact-hash" | "recovery";
  summary: string;
  digest?: string | undefined;
}

export interface ToolOutcome {
  output: string;
  isError: boolean;
  status: ToolOutcomeStatus;
  effect: ToolEffectState;
  retryable: boolean;
  codes: string[];
  validation: ToolOutputValidation;
  evidence: ToolOutcomeEvidence[];
}

export interface NormalizedToolResult extends ToolOutcome {
  /** Trusted normalization reused by the host settlement and plugin hooks. */
  outcome: ToolOutcome;
}

export interface ToolOutcomeCompatibilityResult {
  output: string;
  isError: boolean;
  outcome?: ToolOutcome;
  status?: ToolOutcomeStatus | undefined;
  effect?: ToolEffectState | undefined;
  retryable?: boolean | undefined;
  codes?: string[] | undefined;
  validation?: ToolOutputValidation | undefined;
  evidence?: ToolOutcomeEvidence[] | undefined;
}

export function successfulToolOutcome(outcome: ToolOutcome): boolean {
  return !outcome.isError && (outcome.status === "success" || outcome.status === "partial");
}

export function withToolOutcome(outcome: ToolOutcome): NormalizedToolResult {
  return { ...outcome, outcome };
}
