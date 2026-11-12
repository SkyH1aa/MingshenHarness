import {
  EXTRACT_MEMORIES_SYSTEM_PROMPT,
  formatExtractionPrompt,
} from "mingshen-original:l1-extraction";

export { formatExtractionPrompt };

export function getExtractMemoriesSystemPrompt() {
  return EXTRACT_MEMORIES_SYSTEM_PROMPT;
}
