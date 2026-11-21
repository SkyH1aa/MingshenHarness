import type { ImageStudioCanvas } from "../../../shared/image-studio";

export interface RenderedGifFrame {
  rgba: Uint8ClampedArray;
  delayMs: number;
}

export interface RenderedGifSource {
  width: number;
  height: number;
  frames: RenderedGifFrame[];
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function safeFilename(input: string): string {
  return (
    input
      .trim()
      .replace(/[<>:"/\\|?*\p{Cc}]/gu, "_")
      .replace(/\s+/g, "-")
      .slice(0, 80) || "image-studio"
  );
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片素材无法解码。"));
    image.src = dataUrl;
  });
  try {
    if (typeof image.decode === "function") await image.decode();
  } catch (error) {
    image.src = "";
    throw error;
  }
  return image;
}

export async function renderCanvasPng(
  canvas: ImageStudioCanvas,
  loadAssetUrl: (assetId: string) => Promise<string>,
): Promise<Blob> {
  const surface = document.createElement("canvas");
  surface.width = Math.max(1, Math.round(canvas.width));
  surface.height = Math.max(1, Math.round(canvas.height));
  const context = surface.getContext("2d");
  if (!context) throw new Error("无法创建画布导出上下文。");
  context.fillStyle = canvas.background;
  context.fillRect(0, 0, surface.width, surface.height);

  for (const layer of [...canvas.layers].sort((a, b) => a.zIndex - b.zIndex)) {
    const image = await loadImage(await loadAssetUrl(layer.assetId));
    try {
      context.save();
      context.globalAlpha = layer.opacity;
      context.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
      context.rotate((layer.rotation * Math.PI) / 180);
      context.drawImage(image, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      context.restore();
    } finally {
      image.src = "";
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => surface.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("生成 PNG 失败。");
  return blob;
}

export function downloadCanvasPng(blob: Blob, canvas: ImageStudioCanvas): void {
  downloadBlob(blob, `${safeFilename(canvas.name)}.png`);
}

export async function renderGifSource(
  assetIds: readonly string[],
  delayMs: number,
  loadAssetUrl: (assetId: string) => Promise<string>,
): Promise<RenderedGifSource> {
  if (assetIds.length < 2) throw new Error("请至少按顺序选择两帧图片。");
  const firstId = assetIds[0];
  if (!firstId) throw new Error("没有可用的动图帧。");
  const first = await loadImage(await loadAssetUrl(firstId));
  const ratio = first.naturalWidth / Math.max(1, first.naturalHeight);
  const width = ratio >= 1 ? 640 : Math.max(64, Math.round(640 * ratio));
  const height = ratio >= 1 ? Math.max(64, Math.round(640 / ratio)) : 640;
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d", { willReadFrequently: true });
  if (!context) {
    first.src = "";
    throw new Error("无法创建 GIF 渲染上下文。");
  }
  const frames: RenderedGifFrame[] = [];

  for (const [index, id] of assetIds.entries()) {
    const image = index === 0 ? first : await loadImage(await loadAssetUrl(id));
    try {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#101619";
      context.fillRect(0, 0, width, height);
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      context.drawImage(
        image,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      frames.push({
        rgba: context.getImageData(0, 0, width, height).data,
        delayMs,
      });
    } finally {
      image.src = "";
    }
  }

  return { width, height, frames };
}

export function safeExportName(input: string): string {
  return safeFilename(input);
}
