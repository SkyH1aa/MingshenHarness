import type { FileDiff, FileDiffLine } from "../../shared/domain";

const CONTEXT_LINES = 3;
const MAX_CHANGED_LINES_PER_SIDE = 120;

function splitLines(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

export function createFileDiff(
  before: string,
  after: string,
): { additions: number; deletions: number; diff: FileDiff | null } {
  if (before === after) {
    return { additions: 0, deletions: 0, diff: null };
  }

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeSuffix = beforeLines.length - 1;
  let afterSuffix = afterLines.length - 1;
  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    beforeLines[beforeSuffix] === afterLines[afterSuffix]
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }

  const additions = Math.max(0, afterSuffix - prefix + 1);
  const deletions = Math.max(0, beforeSuffix - prefix + 1);
  const lines: FileDiffLine[] = [];
  const contextStart = Math.max(0, prefix - CONTEXT_LINES);

  for (let index = contextStart; index < prefix; index += 1) {
    lines.push({
      type: "context",
      oldLine: index + 1,
      newLine: index + 1,
      text: beforeLines[index] ?? "",
    });
  }

  const removedEnd = Math.min(beforeSuffix + 1, prefix + MAX_CHANGED_LINES_PER_SIDE);
  for (let index = prefix; index < removedEnd; index += 1) {
    lines.push({
      type: "removed",
      oldLine: index + 1,
      newLine: null,
      text: beforeLines[index] ?? "",
    });
  }

  const addedEnd = Math.min(afterSuffix + 1, prefix + MAX_CHANGED_LINES_PER_SIDE);
  for (let index = prefix; index < addedEnd; index += 1) {
    lines.push({
      type: "added",
      oldLine: null,
      newLine: index + 1,
      text: afterLines[index] ?? "",
    });
  }

  const suffixContext = Math.min(
    CONTEXT_LINES,
    Math.max(0, beforeSuffix + 1),
    Math.max(0, afterSuffix + 1),
  );
  const beforeSuffixStart = beforeLines.length - suffixContext;
  const afterSuffixStart = afterLines.length - suffixContext;
  for (let offset = 0; offset < suffixContext; offset += 1) {
    lines.push({
      type: "context",
      oldLine: beforeSuffixStart + offset + 1,
      newLine: afterSuffixStart + offset + 1,
      text: afterLines[afterSuffixStart + offset] ?? "",
    });
  }

  return {
    additions,
    deletions,
    diff: {
      lines,
      truncated: additions > MAX_CHANGED_LINES_PER_SIDE || deletions > MAX_CHANGED_LINES_PER_SIDE,
    },
  };
}
