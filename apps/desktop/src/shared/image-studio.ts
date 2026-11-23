import type { ModelReference } from "./domain";

export const IMAGE_STUDIO_MAX_ASSETS = 200;
export const IMAGE_STUDIO_MAX_DOCUMENTS = 40;
export const IMAGE_STUDIO_MAX_LAYERS = 120;
export const IMAGE_STUDIO_MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const IMAGE_STUDIO_MAX_SINGLE_BYTES = 25 * 1024 * 1024;
export const IMAGE_STUDIO_MAX_GIF_FRAMES = 30;
export const IMAGE_STUDIO_MAX_GENERATED_COUNT = 10;
export const IMAGE_STUDIO_MIN_DIMENSION = 256;
export const IMAGE_STUDIO_MAX_DIMENSION = 3_840;

export type ImageStudioQuality = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type ImageStudioResolution = "auto" | "1k" | "2k" | "4k" | "custom";
export type ImageStudioAspectRatio =
  | "auto"
  | "1:1"
  | "2:3"
  | "3:2"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "21:9"
  | "9:21"
  | "custom";

export interface ImageStudioGenerationSettings {
  quality: ImageStudioQuality;
  width: number;
  height: number;
  alignTo16: boolean;
  resolution: ImageStudioResolution;
  aspectRatio: ImageStudioAspectRatio;
  transparentBackground: boolean;
  imageCount: number;
}

export const DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS: ImageStudioGenerationSettings = {
  quality: "auto",
  width: 1_024,
  height: 1_024,
  alignTo16: true,
  resolution: "1k",
  aspectRatio: "1:1",
  transparentBackground: false,
  imageCount: 1,
};

const IMAGE_QUALITIES: readonly ImageStudioQuality[] = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
const IMAGE_RESOLUTIONS: readonly ImageStudioResolution[] = ["auto", "1k", "2k", "4k", "custom"];
const IMAGE_ASPECT_RATIOS: readonly ImageStudioAspectRatio[] = [
  "auto",
  "1:1",
  "2:3",
  "3:2",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "21:9",
  "9:21",
  "custom",
];

export type ImageStudioAssetSource = "generated" | "imported" | "paste";

export interface ImageStudioAsset {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  size: number;
  width: number;
  height: number;
  source: ImageStudioAssetSource;
  createdAt: string;
  prompt: string | null;
  model: ModelReference | null;
}

export interface ImageStudioLayer {
  id: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
}

export interface ImageStudioCanvas {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
  layers: ImageStudioLayer[];
  createdAt: string;
  updatedAt: string;
}

export interface ImageStudioCanvasSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: string;
  layerCount: number;
  referencedAssetIds: string[];
  available: boolean;
  error: string | null;
}

export interface ImageStudioWorkspace {
  version: 1;
  activeDocumentId: string | null;
  imageModel: ModelReference | null;
  textModel: ModelReference | null;
  generation: ImageStudioGenerationSettings;
  prompt: string;
  negativePrompt: string;
  selectedAssetIds: string[];
  documents: ImageStudioCanvas[];
  assets: ImageStudioAsset[];
}

export interface ImageStudioAssetData {
  id: string;
  dataUrl: string;
}

export interface ImageStudioImportFile {
  name: string;
  dataUrl: string;
  source?: ImageStudioAssetSource;
}

export interface ImageStudioGenerateInput {
  requestId: string;
  model: ModelReference;
  prompt: string;
  negativePrompt?: string;
  generation: ImageStudioGenerationSettings;
  addToActiveCanvas?: boolean;
}

export interface ImageStudioPolishInput {
  requestId: string;
  model: ModelReference;
  prompt: string;
  direction?: string;
}

export interface ImageStudioReversePromptInput {
  requestId: string;
  model: ModelReference;
  assetId: string;
  instruction?: string;
}

export interface ImageStudioGenerationWarning {
  code: "size_mismatch";
  imageIndex: number;
  requestedWidth: number;
  requestedHeight: number;
  actualWidth: number;
  actualHeight: number;
}

export interface ImageStudioGenerateResult {
  generatedAssets: ImageStudioAsset[];
  workspace: ImageStudioWorkspace;
  warnings: ImageStudioGenerationWarning[];
}

export interface ImageStudioServiceResult {
  text: string;
  model: ModelReference;
}

export function emptyImageStudioWorkspace(): ImageStudioWorkspace {
  return {
    version: 1,
    activeDocumentId: null,
    imageModel: null,
    textModel: null,
    generation: { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS },
    prompt: "",
    negativePrompt: "",
    selectedAssetIds: [],
    documents: [],
    assets: [],
  };
}

export function normalizeImageStudioGenerationSettings(
  value: unknown,
): ImageStudioGenerationSettings {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const defaults = DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS;
  const boundedDimension = (input: unknown, fallback: number) =>
    typeof input === "number" && Number.isFinite(input)
      ? Math.min(
          IMAGE_STUDIO_MAX_DIMENSION,
          Math.max(IMAGE_STUDIO_MIN_DIMENSION, Math.round(input)),
        )
      : fallback;
  const width = boundedDimension(record.width, defaults.width);
  const height = boundedDimension(record.height, defaults.height);
  const alignTo16 = typeof record.alignTo16 === "boolean" ? record.alignTo16 : defaults.alignTo16;
  return {
    quality: IMAGE_QUALITIES.includes(record.quality as ImageStudioQuality)
      ? (record.quality as ImageStudioQuality)
      : defaults.quality,
    width: alignTo16 ? alignImageStudioDimension(width) : width,
    height: alignTo16 ? alignImageStudioDimension(height) : height,
    alignTo16,
    resolution: IMAGE_RESOLUTIONS.includes(record.resolution as ImageStudioResolution)
      ? (record.resolution as ImageStudioResolution)
      : defaults.resolution,
    aspectRatio: IMAGE_ASPECT_RATIOS.includes(record.aspectRatio as ImageStudioAspectRatio)
      ? (record.aspectRatio as ImageStudioAspectRatio)
      : defaults.aspectRatio,
    transparentBackground:
      typeof record.transparentBackground === "boolean"
        ? record.transparentBackground
        : defaults.transparentBackground,
    imageCount:
      typeof record.imageCount === "number" && Number.isFinite(record.imageCount)
        ? Math.min(IMAGE_STUDIO_MAX_GENERATED_COUNT, Math.max(1, Math.round(record.imageCount)))
        : defaults.imageCount,
  };
}

export function validateImageStudioGenerationSettings(
  value: unknown,
): ImageStudioGenerationSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("生图参数无效。");
  const record = value as Record<string, unknown>;
  const settings = normalizeImageStudioGenerationSettings(value);
  if (
    !IMAGE_QUALITIES.includes(record.quality as ImageStudioQuality) ||
    !IMAGE_RESOLUTIONS.includes(record.resolution as ImageStudioResolution) ||
    !IMAGE_ASPECT_RATIOS.includes(record.aspectRatio as ImageStudioAspectRatio) ||
    typeof record.alignTo16 !== "boolean" ||
    typeof record.transparentBackground !== "boolean" ||
    !Number.isInteger(record.width) ||
    !Number.isInteger(record.height) ||
    !Number.isInteger(record.imageCount) ||
    Number(record.width) < IMAGE_STUDIO_MIN_DIMENSION ||
    Number(record.width) > IMAGE_STUDIO_MAX_DIMENSION ||
    Number(record.height) < IMAGE_STUDIO_MIN_DIMENSION ||
    Number(record.height) > IMAGE_STUDIO_MAX_DIMENSION ||
    Number(record.imageCount) < 1 ||
    Number(record.imageCount) > IMAGE_STUDIO_MAX_GENERATED_COUNT
  )
    throw new Error("生图参数超出允许范围。");
  if (settings.alignTo16 && (Number(record.width) % 16 !== 0 || Number(record.height) % 16 !== 0))
    throw new Error("已开启 16 倍数对齐，宽度和高度必须是 16 的倍数。");
  if (settings.resolution === "auto" && settings.aspectRatio !== "auto")
    throw new Error("自动分辨率必须同时使用自动画面比例。");
  if (settings.aspectRatio !== "auto" && settings.aspectRatio !== "custom") {
    const [widthPart, heightPart] = settings.aspectRatio.split(":").map(Number);
    const requestedRatio = settings.width / settings.height;
    const selectedRatio = Number(widthPart) / Number(heightPart);
    if (Math.abs(requestedRatio - selectedRatio) > 0.015)
      throw new Error("宽高尺寸与所选画面比例不一致。");
  }
  const aspectRatio = settings.width / settings.height;
  if (settings.resolution !== "auto" && (aspectRatio < 1 / 3 || aspectRatio > 3))
    throw new Error("宽高比例必须介于 1:3 和 3:1 之间。");
  return settings;
}

export function alignImageStudioDimension(value: number): number {
  const bounded = Math.min(
    IMAGE_STUDIO_MAX_DIMENSION,
    Math.max(IMAGE_STUDIO_MIN_DIMENSION, Math.round(value)),
  );
  return Math.min(
    IMAGE_STUDIO_MAX_DIMENSION,
    Math.max(IMAGE_STUDIO_MIN_DIMENSION, Math.round(bounded / 16) * 16),
  );
}

export function imageStudioPresetDimensions(
  resolution: Exclude<ImageStudioResolution, "auto" | "custom">,
  aspectRatio: Exclude<ImageStudioAspectRatio, "auto" | "custom">,
  alignTo16: boolean,
): { width: number; height: number } {
  const longEdge = resolution === "1k" ? 1_024 : resolution === "2k" ? 2_048 : 3_840;
  const [widthPart, heightPart] = aspectRatio.split(":").map(Number);
  if (!widthPart || !heightPart) throw new Error("画面比例无效。");
  const scale = longEdge / Math.max(widthPart, heightPart);
  const width = Math.round(widthPart * scale);
  const height = Math.round(heightPart * scale);
  return {
    width: alignTo16 ? alignImageStudioDimension(width) : width,
    height: alignTo16 ? alignImageStudioDimension(height) : height,
  };
}

export function imageStudioApiParameters(value: unknown): {
  n: number;
  size: string;
  quality: ImageStudioQuality;
  background?: "transparent";
  output_format?: "png";
} {
  const settings = validateImageStudioGenerationSettings(value);
  return {
    n: settings.imageCount,
    size: settings.resolution === "auto" ? "auto" : `${settings.width}x${settings.height}`,
    quality: settings.quality,
    ...(settings.transparentBackground
      ? { background: "transparent" as const, output_format: "png" as const }
      : {}),
  };
}
