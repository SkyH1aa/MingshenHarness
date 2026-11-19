const DOCUMENT_MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.oasis.opendocument.text": ".odt",
};

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
