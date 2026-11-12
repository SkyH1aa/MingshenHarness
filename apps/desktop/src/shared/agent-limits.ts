export const DEFAULT_TOOL_ROUNDS = 750;
export const MAX_TOOL_ROUNDS = 10_000;

export function toolRoundLimit(configured: number | null | undefined): number {
  return configured != null && Number.isFinite(configured)
    ? Math.max(1, Math.min(Math.floor(configured), MAX_TOOL_ROUNDS))
    : DEFAULT_TOOL_ROUNDS;
}
