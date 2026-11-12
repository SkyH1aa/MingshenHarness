export function clipboardImages(data: DataTransfer): File[] {
  const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (files.length) return files;
  return Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function namedClipboardImage(file: File): File {
  const extension =
    /\.(png|jpe?g|webp|gif|bmp|avif|tiff?|svg|ico)$/i.exec(file.name)?.[1] ??
    ({
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
      "image/bmp": "bmp",
      "image/avif": "avif",
      "image/tiff": "tiff",
      "image/svg+xml": "svg",
    }[file.type] ||
      "png");
  return new File([file], `clipboard-${crypto.randomUUID()}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
