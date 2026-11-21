const DOCUMENT_MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.oasis.opendocument.text": ".odt",
};

export const MAX_CHAT_ATTACHMENTS = 10;
export const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024;

/**
 * Checks only the batch declaration. Callers can run this before reading file
 * bytes or parsing base64 payloads.
 */
export function validateChatAttachmentBatch(value: unknown): number {
  if (!Array.isArray(value)) throw new Error("附件列表格式无效。");
  if (value.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`一次最多发送 ${MAX_CHAT_ATTACHMENTS} 个附件。`);
  }
  let totalBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("附件格式无效。");
    const size = (item as { size?: unknown }).size;
    const name =
      typeof (item as { name?: unknown }).name === "string"
        ? String((item as { name: string }).name).trim()
        : "";
    if (!Number.isSafeInteger(size) || (size as number) <= 0) {
      throw new Error(name ? `附件「${name}」的声明大小无效。` : "附件声明大小无效。");
    }
    if ((size as number) > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new Error(
        name ? `附件「${name}」超过单文件 25 MiB 限制。` : "附件超过单文件 25 MiB 限制。",
      );
    }
    totalBytes += size as number;
    if (totalBytes > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) {
      throw new Error("附件总大小不能超过 50 MiB。");
    }
  }
  return totalBytes;
}

const CHAT_RASTER_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/avif",
]);

const CHAT_RASTER_IMAGE_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;

export function isSupportedChatRasterImageMimeType(mimeType: string): boolean {
  return CHAT_RASTER_IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function isSupportedChatRasterImageFile(name: string, mimeType: string): boolean {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  return normalizedMimeType
    ? isSupportedChatRasterImageMimeType(normalizedMimeType)
    : CHAT_RASTER_IMAGE_EXTENSIONS.test(name);
}

export function attachmentDocumentName(name: string, mimeType: string): string | null {
  if (/\.(?:pdf|doc|docx|xlsx|xls|pptx|odt)$/i.test(name)) return name;
  const extension = DOCUMENT_MIME_EXTENSIONS[mimeType.toLowerCase()];
  return extension ? `attachment${extension}` : null;
}

export function isTextAttachment(name: string, mimeType: string): boolean {
  return (
    /^(?:text\/|application\/(?:json|xml|javascript|x-yaml))/.test(mimeType) ||
    /\.(?:txt|md|mdx|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|cfg|log|js|jsx|ts|tsx|mjs|cjs|py|pyi|go|rs|java|c|cpp|cc|h|hpp|cs|css|scss|html|htm|vue|svelte|sql|sh|ps1|bat|cmd|rb|php|swift|kt|kts|r|tex)$/i.test(
      name,
    )
  );
}

export function canExtractAttachment(name: string, mimeType: string): boolean {
  return Boolean(attachmentDocumentName(name, mimeType)) || isTextAttachment(name, mimeType);
}
