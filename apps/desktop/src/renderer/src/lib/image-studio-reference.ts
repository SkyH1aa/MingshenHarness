export function promoteImageStudioReferenceIds(
  selectedIds: readonly string[],
  importedIds: readonly string[],
  limit = 30,
): string[] {
  return [...new Set([...importedIds, ...selectedIds])].slice(0, Math.max(0, limit));
}
