import {
  CONFLICT_DETECTION_SYSTEM_PROMPT,
  formatBatchConflictPrompt,
} from "mingshen-original:l1-dedup";

export { formatBatchConflictPrompt };

export function getConflictDetectionSystemPrompt() {
  return CONFLICT_DETECTION_SYSTEM_PROMPT;
}
