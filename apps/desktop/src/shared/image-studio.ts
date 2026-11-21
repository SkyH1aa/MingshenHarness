import type { ModelReference } from "./domain";

export const IMAGE_STUDIO_MAX_ASSETS = 200;
export const IMAGE_STUDIO_MAX_DOCUMENTS = 40;
export const IMAGE_STUDIO_MAX_LAYERS = 120;
export const IMAGE_STUDIO_MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const IMAGE_STUDIO_MAX_SINGLE_BYTES = 25 * 1024 * 1024;
export const IMAGE_STUDIO_MAX_GIF_FRAMES = 30;

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

export interface ImageStudioWorkspace {
  version: 1;
  activeDocumentId: string | null;
  imageModel: ModelReference | null;
  textModel: ModelReference | null;
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
  size: string;
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

export interface ImageStudioGenerateResult {
  asset: ImageStudioAsset;
  dataUrl: string;
  revisedPrompt: string | null;
  workspace: ImageStudioWorkspace;
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
    prompt: "",
    negativePrompt: "",
    selectedAssetIds: [],
    documents: [],
    assets: [],
  };
}

export function normalizeImageSize(input: string): string {
  const allowed = new Set([
    "auto",
    "256x256",
    "512x512",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "1792x1024",
    "1024x1792",
  ]);
  return allowed.has(input) ? input : "1024x1024";
}
