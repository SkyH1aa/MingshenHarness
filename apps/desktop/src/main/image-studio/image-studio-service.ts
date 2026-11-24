import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Zip, ZipPassThrough } from "fflate";
import sharp from "sharp";
import type { ModelConfig, ModelReference, ProviderView } from "../../shared/domain";
import {
  emptyImageStudioWorkspace,
  IMAGE_STUDIO_MAX_ASSETS,
  IMAGE_STUDIO_MAX_DOCUMENTS,
  IMAGE_STUDIO_MAX_EXPORT_BYTES,
  IMAGE_STUDIO_MAX_GENERATED_COUNT,
  IMAGE_STUDIO_MAX_GENERATION_BYTES,
  IMAGE_STUDIO_MAX_IMPORT_BYTES,
  IMAGE_STUDIO_MAX_LAYERS,
  IMAGE_STUDIO_MAX_SINGLE_BYTES,
  type ImageStudioAsset,
  type ImageStudioAssetData,
  type ImageStudioAssetRemovalResult,
  type ImageStudioCanvas,
  type ImageStudioCanvasSummary,
  type ImageStudioExportProgress,
  type ImageStudioGenerateInput,
  type ImageStudioGenerateResult,
  type ImageStudioImportFile,
  type ImageStudioLayer,
  type ImageStudioPolishInput,
  type ImageStudioReversePromptInput,
  type ImageStudioServiceResult,
  type ImageStudioWorkspace,
  imageStudioApiParameters,
  normalizeImageStudioAssetPromptMetadata,
  normalizeImageStudioGenerationSettings,
  selectImageStudioReferenceIds,
  validateImageStudioGenerationSettings,
  withinImageStudioByteBudget,
} from "../../shared/image-studio";
import {
  isImageOutputModel,
  isTextModel,
  isVisionTextModel,
} from "../../shared/model-capabilities";
import {
  decodeStrictBase64Image,
  parseImageGenerationResponse,
  parseImageGenerationResponses,
} from "../providers/image-generation";
import { detectImage } from "../providers/image-validation";
import type { ProviderService } from "../providers/provider-service";
import { buildAuthHeaders } from "../providers/provider-service";
import type { Repository } from "../storage/repository";

const WORKSPACE_KEY = ["image", "studio", "workspace", "v1"].join(".");
const LEGACY_WORKSPACE_BACKUP_KEY = `${WORKSPACE_KEY}.canvas-library-backup`;
const CANVAS_MIGRATION_KEY = `${WORKSPACE_KEY}.canvas-library-migrated`;
const CANVAS_PROJECT_FORMAT = "mingshen.image-studio.canvas";
const CANVAS_PROJECT_VERSION = 1;
const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;
const MAX_CANVAS_PROJECT_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_CHARS = 4_000;
const MAX_TEXT_RESPONSE_BYTES = Math.ceil((IMAGE_STUDIO_MAX_SINGLE_BYTES * 4) / 3) + 64 * 1024;
const MAX_IMAGE_RESPONSE_BYTES =
  Math.ceil((IMAGE_STUDIO_MAX_GENERATION_BYTES * 4) / 3) + 1024 * 1024;
const TEXT_HTTP_TIMEOUT_MS = 120_000;
const IMAGE_HTTP_TIMEOUT_MS = 180_000;
const MAX_BATCH_ASSETS = IMAGE_STUDIO_MAX_ASSETS;
const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_CANVAS_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

interface CanvasProjectFile {
  format: string;
  version: number;
  canvas: ImageStudioCanvas;
  assets: ImageStudioAsset[];
}
interface CanvasFileChange {
  path: string;
  previous: Buffer | null;
}
class CanvasRecoveryError extends Error {}
class CanvasProjectNotFoundError extends Error {}
class CanvasTrashRecoveryError extends Error {}

interface TextModelResult {
  text: string;
  body: Record<string, unknown>;
  url: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function boundedString(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function stripControlCharacters(value: string, replacement = ""): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f ? replacement : character;
    })
    .join("");
}

function isPathInside(root: string, candidate: string): boolean {
  const scoped = relative(root, candidate);
  return Boolean(
    scoped && scoped !== ".." && !scoped.startsWith(`..${sep}`) && !isAbsolute(scoped),
  );
}

function optionalModelReference(value: unknown): ModelReference | null {
  const record = asRecord(value);
  if (
    !record ||
    typeof record.providerId !== "string" ||
    !record.providerId ||
    typeof record.modelId !== "string" ||
    !record.modelId
  )
    return null;
  return {
    providerId: record.providerId.slice(0, 128),
    modelId: record.modelId.slice(0, 128),
  };
}

function parseDataUrl(value: unknown): { mimeType: string; bytes: Uint8Array; dataUrl: string } {
  if (typeof value !== "string" || value.length > IMAGE_STUDIO_MAX_SINGLE_BYTES * 2)
    throw new Error("图片数据无效或超过单文件 25 MiB 限制。");
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(value);
  if (!match) throw new Error("只接受 PNG、JPEG、WebP 或 GIF 的本地图片数据。");
  const mimeType = (match[1] ?? "image/png").toLowerCase();
  const bytes = decodeStrictBase64Image(match[2] ?? "");
  return {
    mimeType,
    bytes: new Uint8Array(bytes),
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };
}

function safeAssetName(value: unknown, fallbackExtension: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = stripControlCharacters(raw, "_")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  if (!normalized) return `image${fallbackExtension}`;
  return extname(normalized) ? normalized : `${normalized}${fallbackExtension}`;
}

function normalizeBatchAssetIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_ASSETS)
    throw new Error(`每次请选择 1 到 ${MAX_BATCH_ASSETS} 张图片。`);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || !SAFE_ASSET_ID.test(id)) throw new Error("图片素材标识无效。");
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) throw new Error(`每次请选择 1 到 ${MAX_BATCH_ASSETS} 张图片。`);
  return ids;
}

function archiveExtensionForAsset(asset: ImageStudioAsset): string {
  if (asset.mimeType === "image/jpeg") return ".jpg";
  return `.${asset.mimeType.slice("image/".length)}`;
}

function uniqueArchiveEntryName(asset: ImageStudioAsset, used: Set<string>): string {
  const extension = archiveExtensionForAsset(asset);
  const safeName = safeAssetName(asset.name, extension);
  const stem = safeName
    .replace(/\.[^.]*$/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 100);
  const base = stem || "image";
  for (let sequence = 1; ; sequence += 1) {
    const candidate = `${base}${sequence === 1 ? "" : ` (${sequence})`}${extension}`;
    const key = candidate.toLocaleLowerCase("en-US");
    if (used.has(key)) continue;
    used.add(key);
    return candidate;
  }
}

function fetchErrorMessage(
  status: number,
  statusText: string,
  body: string,
  apiKey: string,
): string {
  const redacted = apiKey ? body.replaceAll(apiKey, "[REDACTED]") : body;
  const safe = stripControlCharacters(redacted).slice(0, 2_000);
  return `HTTP ${status} ${statusText}${safe ? `\n${safe}` : ""}`.trim();
}

async function boundedResponseText(
  response: Response,
  maxBytes = MAX_TEXT_RESPONSE_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
    throw new Error("供应商响应超过安全上限。");
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("供应商响应超过安全上限。");
    return bytes.toString("utf8");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("供应商响应超过安全上限。");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function parseTextResponse(payload: unknown): string {
  const record = asRecord(payload);
  if (!record) return "";

  if (Array.isArray(record.content)) {
    const value = record.content
      .map((item) => asRecord(item))
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => String(item?.text ?? ""))
      .join("\n")
      .trim();
    if (value) return value;
  }

  if (Array.isArray(record.candidates)) {
    const candidate = asRecord(record.candidates[0]);
    const content = asRecord(candidate?.content);
    if (Array.isArray(content?.parts)) {
      const value = content.parts
        .map((item) => asRecord(item))
        .filter((item) => item?.thought !== true && typeof item?.text === "string")
        .map((item) => String(item?.text ?? ""))
        .join("")
        .trim();
      if (value) return value;
    }
  }

  if (Array.isArray(record.output)) {
    const value = record.output
      .flatMap((item) => {
        const output = asRecord(item);
        return Array.isArray(output?.content) ? output.content : [];
      })
      .map((item) => asRecord(item))
      .filter((item) => item?.type === "output_text" && typeof item.text === "string")
      .map((item) => String(item?.text ?? ""))
      .join("\n")
      .trim();
    if (value) return value;
  }

  if (Array.isArray(record.choices)) {
    const choice = asRecord(record.choices[0]);
    const message = asRecord(choice?.message);
    if (typeof message?.content === "string") return message.content.trim();
    if (typeof choice?.text === "string") return choice.text.trim();
  }

  if (typeof record.output_text === "string") return record.output_text.trim();
  return "";
}

function validateTextTerminal(protocol: ProviderView["protocol"], payload: unknown): void {
  const record = asRecord(payload);
  if (!record) throw new Error("语言模型响应不是有效 JSON 对象。");
  if (protocol === "openai_chat_completions") {
    const choice = asRecord(Array.isArray(record.choices) ? record.choices[0] : null);
    if (typeof choice?.finish_reason !== "string" || !choice.finish_reason)
      throw new Error("语言模型未返回正式 finish_reason，已拒绝截断或未完成响应。");
    return;
  }
  if (protocol === "openai_responses") {
    if (record.status !== "completed")
      throw new Error(
        `语言模型未以 completed 状态结束（当前：${String(record.status ?? "missing")}）。`,
      );
    return;
  }
  if (protocol === "anthropic_messages") {
    if (typeof record.stop_reason !== "string" || !record.stop_reason)
      throw new Error("Anthropic 响应未返回 stop_reason，已拒绝未完成结果。");
    return;
  }
  const candidate = asRecord(Array.isArray(record.candidates) ? record.candidates[0] : null);
  if (candidate?.finishReason !== "STOP")
    throw new Error(
      `Gemini 响应未以 STOP 结束（当前：${String(candidate?.finishReason ?? "missing")}）。`,
    );
}

export { parseImageGenerationResponse };

function validateTextPrompt(prompt: unknown): string {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("提示词不能为空。");
  if (prompt.length > MAX_PROMPT_CHARS)
    throw new Error(`提示词不能超过 ${MAX_PROMPT_CHARS} 个字符。`);
  return prompt.trim();
}

function normalizeNegativePrompt(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 2_000) : "";
}

function promptWithNegative(prompt: string, negativePrompt: string | null): string {
  return negativePrompt ? `${prompt}\n\nAvoid these elements: ${negativePrompt}` : prompt;
}

function imageMimeFromDataUrl(dataUrl: string): string {
  return /^data:([^;]+);base64,/.exec(dataUrl)?.[1] ?? "image/png";
}

function base64FromDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

export class ImageStudioService {
  private readonly studioDirectory: string;
  private readonly assetDirectory: string;
  private readonly canvasDirectory: string;
  private readonly canvasTrashDirectory: string;
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly operations = new Set<Promise<unknown>>();
  private assetReadQueue: Promise<void> = Promise.resolve();
  private canvasOperationQueue: Promise<void> = Promise.resolve();
  private closing = false;
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly repository: Repository,
    private readonly providerService: ProviderService,
    userDataDirectory: string,
  ) {
    this.studioDirectory = join(userDataDirectory, "image-studio");
    this.assetDirectory = join(this.studioDirectory, "assets");
    this.canvasDirectory = join(this.studioDirectory, "canvases");
    this.canvasTrashDirectory = join(this.canvasDirectory, ".trash");
  }

  private async initialize(): Promise<void> {
    await mkdir(this.studioDirectory, { recursive: true });
    await this.assertStorageDirectory(this.studioDirectory);
    await Promise.all([
      mkdir(this.assetDirectory, { recursive: true }),
      mkdir(this.canvasDirectory, { recursive: true }),
    ]);
    await Promise.all([
      this.assertStorageDirectory(this.assetDirectory),
      this.assertStorageDirectory(this.canvasDirectory),
    ]);
    await mkdir(this.canvasTrashDirectory, { recursive: true });
    await this.assertStorageDirectory(this.canvasTrashDirectory);
  }

  private async cleanCanvasTrash(): Promise<void> {
    const entries = await readdir(this.canvasTrashDirectory, { withFileTypes: true });
    const referencedCanvasIds = new Set(this.getWorkspace().documents.map((canvas) => canvas.id));
    for (const entry of entries) {
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.[0-9a-f-]{36}\.json$/i.exec(entry.name);
      if (!match) continue;
      const path = join(this.canvasTrashDirectory, entry.name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("画布回收区包含非普通文件，素材删除已取消。");
      try {
        this.assertOpen();
        const canvasId = match[1];
        if (canvasId && referencedCanvasIds.has(canvasId)) {
          const source = this.canvasPath(canvasId);
          let sourceInfo: Awaited<ReturnType<typeof lstat>> | null = null;
          try {
            sourceInfo = await lstat(source);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
              throw new CanvasTrashRecoveryError(
                `无法确认画布「${canvasId}」的恢复目标，已保留回收文件：${this.errorMessage(error)}`,
                { cause: error },
              );
          }
          if (!sourceInfo) {
            try {
              this.assertOpen();
              await rename(path, source);
            } catch (error) {
              throw new CanvasTrashRecoveryError(
                `无法恢复仍被工作区引用的画布「${canvasId}」，工程仍保留在回收区：${path}`,
                { cause: error },
              );
            }
            continue;
          }
          if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink())
            throw new CanvasTrashRecoveryError(
              `画布「${canvasId}」的恢复目标不是普通文件，已保留回收文件：${path}`,
            );
        }
        await unlink(path);
      } catch (error) {
        if (error instanceof CanvasTrashRecoveryError) throw error;
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error(`无法清理画布回收区文件，素材删除已取消：${this.errorMessage(error)}`, {
            cause: error,
          });
      }
    }
  }

  getCanvasDirectoryPath(): string {
    return this.canvasDirectory;
  }

  async loadWorkspace(): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        try {
          await this.cleanCanvasTrash();
        } catch (error) {
          if (error instanceof CanvasTrashRecoveryError) throw error;
          // A locked trash file must not prevent the current workspace from opening.
        }
        await this.ensureCanvasLibrary();
        const workspace = await this.loadWorkspaceFromProjects();
        const loaded = this.commitWorkspace(workspace, workspace.assets);
        this.backfillLegacyWorkspaceBackup(loaded);
        return loaded;
      }),
    );
  }

  getWorkspace(): ImageStudioWorkspace {
    this.assertOpen();
    return this.normalizeWorkspace(this.repository.getSetting(WORKSPACE_KEY), this.assets());
  }

  saveWorkspace(input: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        const workspace = this.normalizeWorkspaceForSave(input);
        return this.persistAndCommitWorkspace(workspace);
      }),
    );
  }

  listCanvases(): Promise<ImageStudioCanvasSummary[]> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        return this.listCanvasProjects();
      }),
    );
  }

  openCanvas(canvasId: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        const project = await this.readCanvasProject(canvasId);
        const current = await this.loadWorkspaceFromProjects();
        if (current.documents.some((document) => document.id === project.canvas.id))
          return this.commitWorkspace(
            { ...current, activeDocumentId: project.canvas.id },
            current.assets,
          );
        if (current.documents.length >= IMAGE_STUDIO_MAX_DOCUMENTS)
          throw new Error(`最多同时打开 ${IMAGE_STUDIO_MAX_DOCUMENTS} 张画布，请先关闭一个标签。`);
        const assets = this.mergeCanvasAssets(current.assets, project.assets);
        return this.commitWorkspace(
          {
            ...current,
            assets,
            activeDocumentId: project.canvas.id,
            documents: [...current.documents, project.canvas],
          },
          assets,
        );
      }),
    );
  }

  closeCanvas(canvasId: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        const id = this.validCanvasId(canvasId);
        await this.ensureCanvasLibrary();
        const current = await this.loadWorkspaceFromProjects();
        const documents = current.documents.filter((document) => document.id !== id);
        if (documents.length === current.documents.length) return current;
        return this.commitWorkspace(
          {
            ...current,
            documents,
            activeDocumentId:
              current.activeDocumentId === id
                ? (documents.at(-1)?.id ?? null)
                : current.activeDocumentId,
          },
          current.assets,
        );
      }),
    );
  }

  renameCanvas(canvasId: unknown, name: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        const project = await this.readCanvasProject(canvasId);
        if (typeof name !== "string") throw new Error("画布名称无效。");
        const cleanName = stripControlCharacters(name).trim().slice(0, 120);
        if (!cleanName) throw new Error("画布名称不能为空。");
        const current = await this.loadWorkspaceFromProjects();
        const updatedAt = new Date().toISOString();
        const canvas = { ...project.canvas, name: cleanName, updatedAt };
        const workspace = {
          ...current,
          documents: current.documents.map((document) =>
            document.id === canvas.id ? canvas : document,
          ),
        };
        const previous = this.createCanvasProject(project.canvas, project.assets);
        await this.writeCanvasProject(canvas, project.assets);
        try {
          return this.commitWorkspace(workspace, workspace.assets);
        } catch (error) {
          try {
            await this.writeCanvasProject(previous.canvas, previous.assets);
          } catch (restoreError) {
            throw new Error(
              `重命名失败，且无法恢复原画布文件：${this.errorMessage(restoreError)}`,
              { cause: error },
            );
          }
          throw error;
        }
      }),
    );
  }

  duplicateCanvas(canvasId: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        const project = await this.readCanvasProject(canvasId);
        const current = await this.loadWorkspaceFromProjects();
        if (current.documents.length >= IMAGE_STUDIO_MAX_DOCUMENTS)
          throw new Error(`最多同时打开 ${IMAGE_STUDIO_MAX_DOCUMENTS} 张画布，请先关闭一个标签。`);
        const now = new Date().toISOString();
        const canvas: ImageStudioCanvas = {
          ...project.canvas,
          id: randomUUID(),
          name: `${project.canvas.name}（副本）`.slice(0, 120),
          layers: project.canvas.layers.map((layer) => ({ ...layer, id: randomUUID() })),
          createdAt: now,
          updatedAt: now,
        };
        const assets = this.mergeCanvasAssets(current.assets, project.assets);
        await this.writeCanvasProject(canvas, project.assets);
        try {
          return this.commitWorkspace(
            {
              ...current,
              assets,
              activeDocumentId: canvas.id,
              documents: [...current.documents, canvas],
            },
            assets,
          );
        } catch (error) {
          try {
            await unlink(this.canvasPath(canvas.id));
          } catch (cleanupError) {
            if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT")
              throw new Error(
                `复制画布未完成，且无法清理副本文件：${this.errorMessage(cleanupError)}`,
                { cause: error },
              );
          }
          throw error;
        }
      }),
    );
  }

  deleteCanvas(canvasId: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        const id = this.validCanvasId(canvasId);
        await this.ensureCanvasLibrary();
        const loaded = await this.loadWorkspaceFromProjects(id);
        const source = this.canvasPath(id);
        const trash = join(this.canvasTrashDirectory, `${id}.${randomUUID()}.json`);
        await rename(source, trash);
        try {
          const workspace = this.commitWorkspace(loaded, loaded.assets);
          await unlink(trash).catch(() => {
            // Keep the recoverable trash entry; asset deletion retries cleanup before removing prompts.
          });
          return workspace;
        } catch (error) {
          try {
            await rename(trash, source);
          } catch (restoreError) {
            throw new Error(
              `删除画布失败，且无法自动恢复项目文件。回收区文件：${trash}；恢复错误：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
              { cause: error },
            );
          }
          throw error;
        }
      }),
    );
  }

  private commitWorkspace(input: unknown, assets: ImageStudioAsset[]): ImageStudioWorkspace {
    const workspace = this.prepareWorkspaceForCommit(input, assets);
    this.repository.setSetting(WORKSPACE_KEY, workspace);
    return workspace;
  }

  private prepareWorkspaceForCommit(
    input: unknown,
    assets: ImageStudioAsset[],
  ): ImageStudioWorkspace {
    this.assertOpen();
    this.assertWorkspaceLimits(input);
    const workspace = this.normalizeWorkspace(input, assets);
    const serialized = JSON.stringify(workspace);
    if (Buffer.byteLength(serialized) > MAX_WORKSPACE_BYTES)
      throw new Error("画布工程超过 2 MiB，请减少图层数量或拆分项目。");
    return workspace;
  }

  private async persistAndCommitWorkspace(
    workspace: ImageStudioWorkspace,
  ): Promise<ImageStudioWorkspace> {
    const changes = await this.persistWorkspaceCanvases(workspace);
    try {
      return this.commitWorkspace(workspace, workspace.assets);
    } catch (error) {
      await this.restoreCanvasFiles(changes, error);
      throw error;
    }
  }

  private normalizeWorkspaceForSave(value: unknown): ImageStudioWorkspace {
    const record = asRecord(value);
    if (!record || !Array.isArray(record.documents) || !Array.isArray(record.assets))
      throw new Error("画布工作区数据格式无效。");
    if (record.assets.length > IMAGE_STUDIO_MAX_ASSETS)
      throw new Error(`素材库最多保存 ${IMAGE_STUDIO_MAX_ASSETS} 张图片。`);
    this.assertWorkspaceLimits(value);

    const rawDocuments = record.documents;
    const canvasIds = new Set<string>();
    for (const rawDocument of rawDocuments) {
      const document = asRecord(rawDocument);
      if (
        !document ||
        typeof document.id !== "string" ||
        !SAFE_CANVAS_ID.test(document.id) ||
        !Array.isArray(document.layers)
      )
        throw new Error("工作区包含无效的画布记录。");
      if (canvasIds.has(document.id)) throw new Error("工作区包含重复的画布标识。");
      canvasIds.add(document.id);
      const layerIds = new Set<string>();
      for (const rawLayer of document.layers) {
        const layer = asRecord(rawLayer);
        if (
          !layer ||
          typeof layer.id !== "string" ||
          !SAFE_CANVAS_ID.test(layer.id) ||
          typeof layer.assetId !== "string" ||
          !SAFE_ASSET_ID.test(layer.assetId)
        )
          throw new Error("工作区包含无效图层记录。");
        if (layerIds.has(layer.id)) throw new Error("工作区包含重复的图层标识。");
        layerIds.add(layer.id);
      }
    }

    // Asset metadata is owned by the main process; stale renderer snapshots may reference removed assets.
    const assets = this.assets();
    const workspace = this.normalizeWorkspace(record, assets);
    this.assertWorkspaceCanvasesPreserved(record, workspace, "保存画布");
    return workspace;
  }

  private trackCanvasOperation<T>(run: () => Promise<T>): Promise<T> {
    const operation = this.canvasOperationQueue.then(run, run);
    this.canvasOperationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async ensureCanvasLibrary(): Promise<void> {
    await this.initialize();
    this.assertOpen();
    if (this.repository.getSetting(CANVAS_MIGRATION_KEY) === true) return;
    const original = this.repository.getSetting(WORKSPACE_KEY);
    const workspace = this.normalizeWorkspace(original, this.assets());
    for (const canvas of workspace.documents) {
      const path = this.canvasPath(canvas.id);
      try {
        await lstat(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await this.writeCanvasProject(canvas, workspace.assets);
      }
    }
    if (
      this.repository.hasSetting(WORKSPACE_KEY) &&
      !this.repository.hasSetting(LEGACY_WORKSPACE_BACKUP_KEY)
    )
      this.repository.setSetting(LEGACY_WORKSPACE_BACKUP_KEY, original);
    this.repository.setSetting(CANVAS_MIGRATION_KEY, true);
  }

  private backfillLegacyWorkspaceBackup(workspace: ImageStudioWorkspace): void {
    this.assertOpen();
    if (
      this.repository.getSetting(CANVAS_MIGRATION_KEY) === true &&
      this.repository.hasSetting(WORKSPACE_KEY) &&
      !this.repository.hasSetting(LEGACY_WORKSPACE_BACKUP_KEY)
    )
      this.repository.setSetting(LEGACY_WORKSPACE_BACKUP_KEY, workspace);
  }

  private async loadWorkspaceFromProjects(
    excludedCanvasId?: string,
  ): Promise<ImageStudioWorkspace> {
    const snapshot = this.getWorkspace();
    let assets = snapshot.assets;
    const documents: ImageStudioCanvas[] = [];
    for (const document of snapshot.documents) {
      if (document.id === excludedCanvasId) continue;
      this.assertOpen();
      try {
        const project = await this.readCanvasProject(document.id);
        assets = this.mergeCanvasAssets(assets, project.assets);
        documents.push(project.canvas);
      } catch (error) {
        if (error instanceof CanvasProjectNotFoundError) {
          try {
            await lstat(this.canvasPath(document.id));
          } catch (projectError) {
            if ((projectError as NodeJS.ErrnoException).code === "ENOENT") {
              await this.writeCanvasProject(document, snapshot.assets);
              documents.push(document);
            }
          }
        }
        // Invalid or unavailable projects remain visible in the library for recovery/deletion.
      }
    }
    const activeDocumentId = documents.some((document) => document.id === snapshot.activeDocumentId)
      ? snapshot.activeDocumentId
      : (documents.at(-1)?.id ?? null);
    const candidate = { ...snapshot, assets, documents, activeDocumentId };
    const workspace = this.normalizeWorkspace(candidate, assets);
    this.assertWorkspaceCanvasesPreserved(candidate, workspace, "加载画布");
    return workspace;
  }

  private async persistWorkspaceCanvases(
    workspace: ImageStudioWorkspace,
  ): Promise<CanvasFileChange[]> {
    const changes: CanvasFileChange[] = [];
    try {
      for (const canvas of workspace.documents) {
        this.assertOpen();
        const expected = this.createCanvasProject(canvas, workspace.assets);
        try {
          const current = await this.readCanvasProject(canvas.id);
          if (JSON.stringify(current) === JSON.stringify(expected)) continue;
        } catch (error) {
          if (!(error instanceof CanvasProjectNotFoundError)) throw error;
        }
        const path = this.canvasPath(canvas.id);
        let previous: Buffer | null = null;
        try {
          previous = await readFile(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await this.writeCanvasProject(canvas, workspace.assets);
        changes.push({ path, previous });
      }
      return changes;
    } catch (error) {
      await this.restoreCanvasFiles(changes, error);
      throw error;
    }
  }

  private async restoreCanvasFiles(changes: CanvasFileChange[], cause: unknown): Promise<void> {
    const failures: string[] = [];
    for (const change of [...changes].reverse()) {
      try {
        if (change.previous === null) {
          await unlink(change.path).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        } else {
          await this.writeCanvasBytes(change.path, change.previous);
        }
      } catch (error) {
        failures.push(`${change.path}: ${this.errorMessage(error)}`);
      }
    }
    if (failures.length)
      throw new CanvasRecoveryError(
        `画布保存失败，且无法完整恢复先前文件：${failures.join("；")}`,
        {
          cause,
        },
      );
  }

  private async writeCanvasBytes(destination: string, bytes: Uint8Array): Promise<void> {
    this.assertLexicalPathInside(this.canvasDirectory, destination, "画布写入位置");
    await this.assertStorageDirectory(this.canvasDirectory);
    const temporary = join(this.canvasDirectory, `.${randomUUID()}.tmp`);
    let file: Awaited<ReturnType<typeof open>> | null = null;
    try {
      file = await open(temporary, "wx");
      await file.writeFile(bytes);
      await file.sync();
      await file.close();
      file = null;
      await rename(temporary, destination);
    } catch (error) {
      await file?.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async listCanvasProjects(): Promise<ImageStudioCanvasSummary[]> {
    const entries = await readdir(this.canvasDirectory, { withFileTypes: true });
    const summaries: ImageStudioCanvasSummary[] = [];
    for (const entry of entries) {
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.mingcanvas\.json$/.exec(entry.name);
      if (!entry.isFile() || !match?.[1]) continue;
      try {
        const project = await this.readCanvasProject(match[1]);
        summaries.push({
          id: project.canvas.id,
          name: project.canvas.name,
          width: project.canvas.width,
          height: project.canvas.height,
          updatedAt: project.canvas.updatedAt,
          layerCount: project.canvas.layers.length,
          referencedAssetIds: [...new Set(project.canvas.layers.map((layer) => layer.assetId))],
          available: true,
          error: null,
        });
      } catch (error) {
        const id = match[1];
        let updatedAt = new Date(0).toISOString();
        try {
          updatedAt = (await lstat(join(this.canvasDirectory, entry.name))).mtime.toISOString();
        } catch {
          // The entry can disappear while the library is being refreshed.
        }
        summaries.push({
          id,
          name: id,
          width: 0,
          height: 0,
          updatedAt,
          layerCount: 0,
          referencedAssetIds: [],
          available: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async readCanvasProject(canvasId: unknown): Promise<CanvasProjectFile> {
    const id = this.validCanvasId(canvasId);
    const path = this.canvasPath(id);
    let guarded: Awaited<ReturnType<typeof this.resolveGuardedFile>>;
    try {
      guarded = await this.resolveGuardedFile(this.canvasDirectory, path, "画布项目");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new CanvasProjectNotFoundError(`画布工程不存在：${id}`);
      throw error;
    }
    const linkInfo = guarded.stat;
    if (
      !linkInfo.isFile() ||
      linkInfo.isSymbolicLink() ||
      linkInfo.size < 1 ||
      linkInfo.size > MAX_CANVAS_PROJECT_BYTES
    )
      throw new Error("画布项目文件无效或超过 2 MiB 上限。");
    const file = await open(guarded.path, "r");
    let raw: string;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== linkInfo.size || stat.size > MAX_CANVAS_PROJECT_BYTES)
        throw new Error("画布项目文件在读取前发生变化。");
      const buffer = Buffer.allocUnsafe(stat.size);
      const { bytesRead } = await file.read(buffer, 0, stat.size, 0);
      if (bytesRead !== stat.size) throw new Error("画布项目文件读取不完整。");
      raw = buffer.toString("utf8");
    } finally {
      await file.close();
    }
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error("画布项目 JSON 已损坏。");
    }
    const record = asRecord(value);
    const canvasRecord = asRecord(record?.canvas);
    if (
      record?.format !== CANVAS_PROJECT_FORMAT ||
      record.version !== CANVAS_PROJECT_VERSION ||
      !canvasRecord ||
      canvasRecord.id !== id ||
      !Array.isArray(record.assets)
    )
      throw new Error("画布项目格式或标识无效。");
    const assets = this.normalizeAssets(record.assets);
    if (assets.length !== record.assets.length)
      throw new Error("畫布工程包含無效或重複的素材記錄。");
    const assetIds = new Set(assets.map((asset) => asset.id));
    const rawLayers = Array.isArray(canvasRecord.layers) ? canvasRecord.layers : [];
    if (
      rawLayers.length > IMAGE_STUDIO_MAX_LAYERS ||
      rawLayers.some((layer) => {
        const record = asRecord(layer);
        return !record || typeof record.assetId !== "string" || !assetIds.has(record.assetId);
      })
    )
      throw new Error("畫布工程包含缺失的素材引用或超出圖層上限。");
    const workspace = this.normalizeWorkspace(
      { ...emptyImageStudioWorkspace(), documents: [canvasRecord] },
      assets,
    );
    const canvas = workspace.documents[0];
    if (!canvas || canvas.id !== id || canvas.layers.length !== rawLayers.length)
      throw new Error("画布项目内容无效，部分图层无法通过校验。");
    await this.assertProjectAssetsPresent(assets);
    return { format: CANVAS_PROJECT_FORMAT, version: CANVAS_PROJECT_VERSION, canvas, assets };
  }

  private async writeCanvasProject(
    canvas: ImageStudioCanvas,
    allAssets: ImageStudioAsset[],
  ): Promise<void> {
    const id = this.validCanvasId(canvas.id);
    const payload = this.createCanvasProject(canvas, allAssets);
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > MAX_CANVAS_PROJECT_BYTES)
      throw new Error("单张画布项目超过 2 MiB 限制。");
    const destination = this.canvasPath(id);
    await this.writeCanvasBytes(destination, Buffer.from(serialized, "utf8"));
  }

  private createCanvasProject(
    canvas: ImageStudioCanvas,
    allAssets: ImageStudioAsset[],
  ): CanvasProjectFile {
    const assetIds = new Set(canvas.layers.map((layer) => layer.assetId));
    const assets = allAssets.filter((asset) => assetIds.has(asset.id));
    const workspace = this.normalizeWorkspace(
      { ...emptyImageStudioWorkspace(), documents: [canvas] },
      assets,
    );
    const normalizedCanvas = workspace.documents[0];
    if (!normalizedCanvas || normalizedCanvas.layers.length !== canvas.layers.length)
      throw new Error("无法保存包含无效图层引用的画布。");
    return {
      format: CANVAS_PROJECT_FORMAT,
      version: CANVAS_PROJECT_VERSION,
      canvas: normalizedCanvas,
      assets: workspace.assets,
    };
  }

  private async assertProjectAssetsPresent(assets: ImageStudioAsset[]): Promise<void> {
    for (const asset of assets) {
      const path = this.assetPath(asset);
      let guarded: Awaited<ReturnType<typeof this.resolveGuardedFile>>;
      try {
        guarded = await this.resolveGuardedFile(this.assetDirectory, path, "图片素材");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new Error(`画布引用的素材文件缺失：${asset.name}`, { cause: error });
        throw error;
      }
      if (guarded.stat.size !== asset.size)
        throw new Error(`画布引用的素材文件缺失或已变化：${asset.name}`);
    }
  }

  private mergeCanvasAssets(
    current: ImageStudioAsset[],
    project: ImageStudioAsset[],
  ): ImageStudioAsset[] {
    const merged = new Map(current.map((asset) => [asset.id, asset]));
    for (const asset of project) {
      const existing = merged.get(asset.id);
      if (existing && !this.sameCanvasAsset(existing, asset))
        throw new Error(`画布素材元数据冲突：${asset.name}`);
      if (!existing) merged.set(asset.id, asset);
    }
    if (merged.size > IMAGE_STUDIO_MAX_ASSETS)
      throw new Error("打开此画布将超过素材库上限，请先清理未使用的素材。");
    const normalized = this.normalizeAssets([...merged.values()]);
    if (normalized.length !== merged.size) throw new Error("画布素材元数据无效，读取已取消。");
    return normalized;
  }

  private sameCanvasAsset(left: ImageStudioAsset, right: ImageStudioAsset): boolean {
    return (
      left.mimeType === right.mimeType &&
      left.size === right.size &&
      left.width === right.width &&
      left.height === right.height &&
      this.assetPath(left) === this.assetPath(right)
    );
  }

  private assertWorkspaceCanvasesPreserved(
    value: unknown,
    workspace: ImageStudioWorkspace,
    action: string,
  ): void {
    const record = asRecord(value);
    const rawDocuments = Array.isArray(record?.documents) ? record.documents : [];
    if (rawDocuments.length !== workspace.documents.length)
      throw new Error(`${action}会丢失画布，操作已取消。`);
    const normalized = new Map(workspace.documents.map((document) => [document.id, document]));
    for (const rawDocument of rawDocuments) {
      const document = asRecord(rawDocument);
      if (!document || typeof document.id !== "string")
        throw new Error(`${action}包含无效画布，操作已取消。`);
      const current = normalized.get(document.id);
      const rawLayers = Array.isArray(document.layers) ? document.layers : [];
      if (!current || current.layers.length !== rawLayers.length)
        throw new Error(`画布「${document.name ?? document.id}」的图层会丢失，${action}已取消。`);
    }
  }

  private async assertStorageDirectory(directory: string): Promise<void> {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`图片工作台存储目录不安全：${directory}`);
  }

  private assertLexicalPathInside(root: string, candidate: string, label: string): void {
    const relativePath = relative(root, candidate);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    )
      throw new Error(`${label}无效。`);
  }

  private async resolveGuardedFile(
    root: string,
    candidate: string,
    label: string,
  ): Promise<{ path: string; stat: Awaited<ReturnType<typeof lstat>> }> {
    this.assertLexicalPathInside(root, candidate, label);
    await this.assertStorageDirectory(root);
    const linkStat = await lstat(candidate);
    if (!linkStat.isFile() || linkStat.isSymbolicLink())
      throw new Error(`${label}必须是普通文件。`);
    const canonicalRoot = await realpath(root);
    const canonicalCandidate = await realpath(candidate);
    if (!isPathInside(canonicalRoot, canonicalCandidate))
      throw new Error(`${label}超出图片工作台目录。`);
    const stat = await lstat(canonicalCandidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label}必须是普通文件。`);
    return { path: canonicalCandidate, stat };
  }

  private assertWorkspaceLimits(value: unknown): void {
    const record = asRecord(value);
    if (!record || !Array.isArray(record.documents)) return;
    if (record.documents.length > IMAGE_STUDIO_MAX_DOCUMENTS)
      throw new Error(`最多同时打开 ${IMAGE_STUDIO_MAX_DOCUMENTS} 张画布。`);
    for (const item of record.documents) {
      const document = asRecord(item);
      if (Array.isArray(document?.layers) && document.layers.length > IMAGE_STUDIO_MAX_LAYERS)
        throw new Error(`每张画布最多 ${IMAGE_STUDIO_MAX_LAYERS} 个图层。`);
    }
  }

  private validCanvasId(value: unknown): string {
    if (typeof value !== "string" || !SAFE_CANVAS_ID.test(value)) throw new Error("画布标识无效。");
    return value;
  }

  private canvasPath(canvasId: unknown): string {
    return join(this.canvasDirectory, `${this.validCanvasId(canvasId)}.mingcanvas.json`);
  }

  getAssetData(assetId: unknown): Promise<ImageStudioAssetData> {
    return this.trackOperation(() => this.queueAssetRead(assetId));
  }

  exportAssets(
    assetIds: unknown,
    destination: string,
    onProgress?: (progress: ImageStudioExportProgress) => void,
    requestId: string = randomUUID(),
  ): Promise<void> {
    return this.trackOperation(async () => {
      if (
        typeof destination !== "string" ||
        !destination.trim() ||
        destination.length > 32_768 ||
        !isAbsolute(destination)
      )
        throw new Error("ZIP 导出位置无效。");
      const resolvedDestination = resolve(destination);
      const [imageStudioDirectory, destinationParent] = await Promise.all([
        realpath(this.studioDirectory),
        realpath(dirname(resolvedDestination)),
      ]);
      const canonicalDestination = join(destinationParent, basename(resolvedDestination));
      if (
        canonicalDestination === imageStudioDirectory ||
        isPathInside(imageStudioDirectory, canonicalDestination)
      )
        throw new Error("ZIP 不能导出到生图工作台数据目录或覆盖内部素材。");
      const ids = normalizeBatchAssetIds(assetIds);
      const byId = new Map(this.assets().map((asset) => [asset.id, asset]));
      const selected: ImageStudioAsset[] = [];
      for (const id of ids) {
        const asset = byId.get(id);
        if (!asset) throw new Error("图片素材不存在。");
        selected.push(asset);
      }
      const totalBytes = selected.reduce((sum, asset) => sum + asset.size, 0);
      if (!withinImageStudioByteBudget(totalBytes, IMAGE_STUDIO_MAX_EXPORT_BYTES))
        throw new Error("本次 ZIP 导出的图片合计不能超过 500 MiB。");

      const reportProgress = (
        completedAssets: number,
        completedBytes: number,
        phase: ImageStudioExportProgress["phase"],
      ) => {
        try {
          onProgress?.({
            requestId,
            completedAssets,
            totalAssets: selected.length,
            completedBytes,
            totalBytes,
            phase,
          });
        } catch {
          // Renderer progress reporting must not interrupt a file export.
        }
      };

      const temporaryPath = join(dirname(destination), `.mingshen-images-${randomUUID()}.zip.tmp`);
      let file: Awaited<ReturnType<typeof open>> | null = null;
      let completed = false;
      try {
        reportProgress(0, 0, "packing");
        file = await open(temporaryPath, "wx", 0o600);
        let writeFailure: Error | null = null;
        let writeTail: Promise<void> = Promise.resolve();
        let finalSeen = false;
        const zip = new Zip((error, chunk, final) => {
          if (error) {
            writeFailure ??=
              error instanceof Error ? error : new Error(`ZIP 生成失败：${String(error)}`);
            return;
          }
          if (chunk?.length) {
            const bytes = Uint8Array.from(chunk);
            writeTail = writeTail
              .then(async () => {
                if (!file || writeFailure) return;
                await file.writeFile(bytes);
              })
              .catch((cause: unknown) => {
                writeFailure ??=
                  cause instanceof Error ? cause : new Error(`ZIP 写入失败：${String(cause)}`);
              });
          }
          if (final) finalSeen = true;
        });
        const usedNames = new Set<string>();
        let completedBytes = 0;
        for (const [index, asset] of selected.entries()) {
          this.assertOpen();
          const data = await this.queueAssetBytes(asset.id);
          if (writeFailure) break;
          const entry = new ZipPassThrough(uniqueArchiveEntryName(asset, usedNames));
          zip.add(entry);
          entry.push(data.bytes, true);
          await writeTail;
          if (writeFailure) break;
          completedBytes += data.bytes.length;
          reportProgress(index + 1, completedBytes, "packing");
        }
        if (writeFailure) throw writeFailure;
        zip.end();
        await writeTail;
        if (writeFailure) throw writeFailure;
        if (!finalSeen) throw new Error("ZIP 输出未完整结束。");
        reportProgress(selected.length, completedBytes, "finalizing");
        this.assertOpen();
        await file.sync();
        await file.close();
        file = null;
        await rename(temporaryPath, destination);
        completed = true;
        reportProgress(selected.length, completedBytes, "complete");
      } finally {
        await file?.close().catch(() => undefined);
        if (!completed) await unlink(temporaryPath).catch(() => undefined);
      }
    });
  }

  exportAsset(assetId: unknown, destinationPath: unknown): Promise<void> {
    return this.trackOperation(async () => {
      if (
        typeof destinationPath !== "string" ||
        !destinationPath.trim() ||
        destinationPath.length > 32_768 ||
        !isAbsolute(destinationPath)
      )
        throw new Error("图片导出位置无效。");
      const data = await this.queueAssetRead(assetId);
      this.assertOpen();
      const base64 = data.dataUrl.replace(/^data:[^;]+;base64,/, "");
      const bytes = decodeStrictBase64Image(base64);
      await writeFile(destinationPath, bytes, { flag: "w" });
    });
  }

  private queueAssetRead(assetId: unknown, signal?: AbortSignal): Promise<ImageStudioAssetData> {
    return this.queueAssetBytes(assetId, signal).then((data) => ({
      id: data.id,
      dataUrl: `data:${data.mimeType};base64,${data.bytes.toString("base64")}`,
    }));
  }

  private queueAssetBytes(assetId: unknown, signal?: AbortSignal) {
    const reading = this.assetReadQueue.then(() => this.readAssetBytes(assetId, signal));
    this.assetReadQueue = reading.then(
      () => undefined,
      () => undefined,
    );
    return reading;
  }

  private async readAssetBytes(
    assetId: unknown,
    signal?: AbortSignal,
  ): Promise<{ id: string; mimeType: ImageStudioAsset["mimeType"]; bytes: Buffer<ArrayBuffer> }> {
    this.assertOpen();
    signal?.throwIfAborted();
    if (typeof assetId !== "string") throw new Error("图片素材标识无效。");
    const asset = this.assets().find((item) => item.id === assetId);
    if (!asset) throw new Error("图片素材不存在。");
    const guarded = await this.resolveGuardedFile(
      this.assetDirectory,
      this.assetPath(asset),
      "图片素材",
    );
    signal?.throwIfAborted();
    const file = await open(guarded.path, "r");
    let bytes: Buffer<ArrayBuffer>;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > IMAGE_STUDIO_MAX_SINGLE_BYTES)
        throw new Error("图片素材无效或超过读取上限。");
      const buffer = Buffer.allocUnsafe(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await file.read(buffer, length, buffer.length - length, length);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (length !== stat.size || length !== asset.size) throw new Error("图片素材已变化或损坏。");
      bytes = buffer.subarray(0, length);
    } finally {
      await file.close();
    }
    this.assertOpen();
    signal?.throwIfAborted();
    const detected = await detectImage(bytes, asset.mimeType);
    this.assertOpen();
    signal?.throwIfAborted();
    if (detected.width !== asset.width || detected.height !== asset.height)
      throw new Error("图片素材尺寸与保存的记录不一致。");
    return {
      id: asset.id,
      mimeType: asset.mimeType,
      bytes,
    };
  }

  importAssets(input: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        return this.importAssetsInternal(input);
      }),
    );
  }

  private async importAssetsInternal(input: unknown): Promise<ImageStudioWorkspace> {
    if (!Array.isArray(input) || input.length === 0 || input.length > 20)
      throw new Error("每次请选择 1 到 20 张图片。");
    const parsed = input.map((value) => {
      const file = asRecord(value) as ImageStudioImportFile | null;
      if (!file) throw new Error("图片导入参数无效。");
      const data = parseDataUrl(file.dataUrl);
      return { file, data };
    });
    const total = parsed.reduce((sum, item) => sum + item.data.bytes.length, 0);
    if (!withinImageStudioByteBudget(total, IMAGE_STUDIO_MAX_IMPORT_BYTES))
      throw new Error("本次导入图片合计不能超过 500 MiB。");

    const written: string[] = [];
    const temporaryFiles: string[] = [];
    const added: ImageStudioAsset[] = [];
    let workspaceSaved = false;
    try {
      await this.initialize();
      this.assertOpen();
      for (const { file, data } of parsed) {
        const detected = await detectImage(data.bytes, data.mimeType);
        this.assertOpen();
        const id = randomUUID();
        const asset: ImageStudioAsset = {
          id,
          name: safeAssetName(file.name, detected.extension),
          mimeType: detected.mimeType,
          size: data.bytes.length,
          width: detected.width,
          height: detected.height,
          source: file.source === "paste" ? "paste" : "imported",
          createdAt: new Date().toISOString(),
          prompt: null,
          negativePrompt: null,
          revisedPrompt: null,
          promptOrigin: null,
          promptMetadataVersion: null,
          model: null,
        };
        const path = this.assetPath(asset);
        const temporary = `${path}.${randomUUID()}.tmp`;
        temporaryFiles.push(temporary);
        await writeFile(temporary, data.bytes, { flag: "wx" });
        this.assertOpen();
        await rename(temporary, path);
        temporaryFiles.pop();
        written.push(path);
        this.assertOpen();
        added.push(asset);
      }
      const current = this.getWorkspace();
      if (current.assets.length + added.length > IMAGE_STUDIO_MAX_ASSETS)
        throw new Error(`图片素材库最多保存 ${IMAGE_STUDIO_MAX_ASSETS} 张图片。`);
      const assets = [...current.assets, ...added];
      this.commitWorkspace(current, assets);
      workspaceSaved = true;
      return this.getWorkspace();
    } catch (error) {
      if (!workspaceSaved) {
        await Promise.all([
          ...written.map((path) => unlink(path).catch(() => undefined)),
          ...temporaryFiles.map((path) => unlink(path).catch(() => undefined)),
        ]);
      }
      throw error;
    }
  }

  removeAsset(assetId: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        const result = await this.removeAssetsInternal([assetId]);
        return result.workspace;
      }),
    );
  }

  removeAssets(assetIds: unknown): Promise<ImageStudioAssetRemovalResult> {
    return this.trackOperation(() =>
      this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        return this.removeAssetsInternal(assetIds);
      }),
    );
  }

  private async removeAssetsInternal(assetIds: unknown): Promise<ImageStudioAssetRemovalResult> {
    const ids = normalizeBatchAssetIds(assetIds);
    await this.cleanCanvasTrash();
    const workspace = this.getWorkspace();
    const assetsById = new Map(workspace.assets.map((asset) => [asset.id, asset]));
    const selected = ids.map((id) => assetsById.get(id));
    if (selected.some((asset) => !asset)) throw new Error("图片素材不存在。");
    const assets = selected as ImageStudioAsset[];
    const targetIds = new Set(ids);

    const projects = await this.listCanvasProjects();
    const unreadable = projects.find((project) => !project.available);
    if (unreadable)
      throw new Error(`无法确认素材引用，因为画布「${unreadable.name}」不可读取；删除已取消。`);
    const projectIds = new Set(projects.map((project) => project.id));
    const missingOpenProject = workspace.documents.find((document) => !projectIds.has(document.id));
    if (missingOpenProject)
      throw new Error(
        `无法确认素材引用，因为画布「${missingOpenProject.name}」的工程文件不可读取；删除已取消。`,
      );
    const referencing = projects.find((project) =>
      project.referencedAssetIds.some((id) => targetIds.has(id)),
    );
    if (referencing) throw new Error(`图片仍被画布「${referencing.name}」引用；批量删除已取消。`);
    const pendingReference = workspace.documents.find((document) =>
      document.layers.some((layer) => targetIds.has(layer.assetId)),
    );
    if (pendingReference)
      throw new Error(`图片仍被画布「${pendingReference.name}」引用；批量删除已取消。`);

    const next: ImageStudioWorkspace = {
      ...workspace,
      assets: workspace.assets.filter((asset) => !targetIds.has(asset.id)),
      selectedAssetIds: workspace.selectedAssetIds.filter((id) => !targetIds.has(id)),
    };
    const committed = this.prepareWorkspaceForCommit(next, next.assets);
    const legacyBackup = this.removeAssetsFromLegacyBackup(targetIds);
    this.repository.runInSavepoint(() => {
      this.repository.setSetting(WORKSPACE_KEY, committed);
      if (legacyBackup.found)
        this.repository.setSetting(LEGACY_WORKSPACE_BACKUP_KEY, legacyBackup.value);
    });

    const warnings: string[] = [];
    for (const asset of assets) {
      try {
        await unlink(this.assetPath(asset));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          warnings.push(
            `素材「${asset.name}」已从素材库移除，但磁盘文件清理失败：${this.errorMessage(error)}`,
          );
        }
      }
    }
    return {
      workspace: this.getWorkspace(),
      removedAssetIds: ids,
      warnings,
    };
  }

  private removeAssetsFromLegacyBackup(
    targetIds: Set<string>,
  ): { found: false } | { found: true; value: unknown } {
    if (!this.repository.hasSetting(LEGACY_WORKSPACE_BACKUP_KEY)) return { found: false };
    const stored = this.repository.getSetting(LEGACY_WORKSPACE_BACKUP_KEY);
    if (stored === null) return { found: true, value: null };
    const backup = asRecord(stored);
    if (!backup || !Array.isArray(backup.assets))
      throw new Error("无法核实旧版素材备份中的提示词，删除已取消。");
    const documents = Array.isArray(backup.documents)
      ? backup.documents.map((value) => {
          const document = asRecord(value);
          if (!document || !Array.isArray(document.layers)) return value;
          return {
            ...document,
            layers: document.layers.filter((value) => {
              const layer = asRecord(value);
              return !(typeof layer?.assetId === "string" && targetIds.has(layer.assetId));
            }),
          };
        })
      : backup.documents;
    const selectedAssetIds = Array.isArray(backup.selectedAssetIds)
      ? backup.selectedAssetIds.filter((id) => typeof id !== "string" || !targetIds.has(id))
      : backup.selectedAssetIds;
    return {
      found: true,
      value: {
        ...backup,
        assets: backup.assets.filter((value) => {
          const asset = asRecord(value);
          return !(typeof asset?.id === "string" && targetIds.has(asset.id));
        }),
        selectedAssetIds,
        documents,
      },
    };
  }

  generate(input: ImageStudioGenerateInput): Promise<ImageStudioGenerateResult> {
    return this.trackOperation(() => this.generateInternal(input));
  }

  private async generateInternal(
    input: ImageStudioGenerateInput,
  ): Promise<ImageStudioGenerateResult> {
    const modelReference = optionalModelReference(input.model);
    if (!modelReference) throw new Error("请选择图片生成模型。");
    const generation = validateImageStudioGenerationSettings(input.generation);
    const referenceIds = generation.referenceEnabled
      ? selectImageStudioReferenceIds(input.referenceAssetIds)
      : [];
    if (generation.referenceEnabled && referenceIds.length === 0)
      throw new Error("请先勾选素材或上传参考图，或关闭“使用参考图”。");
    const workspacePrompt = validateTextPrompt(input.prompt);
    const workspaceNegativePrompt = normalizeNegativePrompt(input.negativePrompt);
    const prompt = promptWithNegative(workspacePrompt, workspaceNegativePrompt);
    const { provider, model } = this.resolveModel(modelReference);
    if (!isImageOutputModel(model))
      throw new Error("所选模型不是仅图片生成模型，请到设置中启用“图片生成模型”。");
    if (provider.protocol !== "openai_chat_completions" && provider.protocol !== "openai_responses")
      throw new Error(
        "内置生图使用 OpenAI Images 兼容协议。请新建一个 OpenAI Chat Completions 兼容供应商，Base URL 以 /v1 结尾。",
      );

    const apiKey = this.providerService.getActiveApiKey(provider.id);
    const url = `${provider.baseUrl}/images/${referenceIds.length ? "edits" : "generations"}`;
    const body = {
      model: model.modelId,
      prompt,
      ...imageStudioApiParameters(generation),
    };
    return this.withRequest(input.requestId, IMAGE_HTTP_TIMEOUT_MS, async (signal) => {
      const headers = buildAuthHeaders({
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        authMode: provider.authMode,
        customHeaderName: provider.customHeaderName,
        apiKey,
      });
      let requestBody: string | FormData = JSON.stringify(body);
      if (referenceIds.length) {
        const form = new FormData();
        for (const [key, value] of Object.entries(body)) form.set(key, String(value));
        for (const [index, id] of referenceIds.entries()) {
          const data = await this.queueAssetBytes(id, signal);
          let bytes: Uint8Array<ArrayBufferLike> = data.bytes;
          let mimeType = data.mimeType;
          if (mimeType === "image/gif" || mimeType === "image/webp") {
            bytes = await sharp(bytes, {
              failOn: "warning",
              limitInputPixels: 40_000_000,
              sequentialRead: true,
              page: 0,
              pages: 1,
            })
              .png()
              .toBuffer();
            if (bytes.byteLength > IMAGE_STUDIO_MAX_SINGLE_BYTES)
              throw new Error("参考图转换为 PNG 后超过单图 25 MiB 限制，请缩小图片后重试。");
            await detectImage(bytes, "image/png");
            mimeType = "image/png";
          }
          signal.throwIfAborted();
          this.assertOpen();
          const extension = mimeType === "image/jpeg" ? "jpg" : "png";
          form.append(
            referenceIds.length === 1 ? "image" : "image[]",
            new Blob(
              [new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)],
              { type: mimeType },
            ),
            `reference-${index + 1}.${extension}`,
          );
        }
        // Fetch supplies the multipart boundary; the JSON content type would discard the images.
        delete headers["content-type"];
        requestBody = form;
      }
      signal.throwIfAborted();
      this.assertOpen();
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers,
        body: requestBody,
        signal,
      });
      const raw = await boundedResponseText(response, MAX_IMAGE_RESPONSE_BYTES);
      if (!response.ok)
        throw new Error(fetchErrorMessage(response.status, response.statusText, raw, apiKey));
      let payload: unknown;
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        throw new Error("图片供应商返回的不是有效 JSON。");
      }
      const generated = await parseImageGenerationResponses(payload);
      signal.throwIfAborted();
      this.assertOpen();
      if (generated.length > generation.imageCount)
        throw new Error("供应商返回的图片数量超过本次请求数量，已拒绝保存异常结果。");
      const warnings = generated.flatMap((image, index) =>
        generation.resolution !== "auto" &&
        (image.width !== generation.width || image.height !== generation.height)
          ? [
              {
                code: "size_mismatch" as const,
                imageIndex: index + 1,
                requestedWidth: generation.width,
                requestedHeight: generation.height,
                actualWidth: image.width,
                actualHeight: image.height,
              },
            ]
          : [],
      );
      if (
        generation.transparentBackground &&
        generated.some((image) => image.mimeType !== "image/png" && image.mimeType !== "image/webp")
      )
        throw new Error("透明背景请求必须返回 PNG 或 WebP，供应商结果未保存。");
      signal.throwIfAborted();
      this.assertOpen();
      const workspace = await this.trackCanvasOperation(async () => {
        await this.ensureCanvasLibrary();
        return this.importGeneratedAssets({
          generated,
          workspacePrompt,
          workspaceNegativePrompt,
          model: modelReference,
          addToActiveCanvas: input.addToActiveCanvas === true,
          signal,
        });
      });
      return {
        generatedAssets: workspace.assets.slice(-generated.length),
        workspace,
        warnings,
      };
    });
  }

  polishPrompt(input: ImageStudioPolishInput): Promise<ImageStudioServiceResult> {
    return this.trackOperation(() => this.polishPromptInternal(input));
  }

  private async polishPromptInternal(
    input: ImageStudioPolishInput,
  ): Promise<ImageStudioServiceResult> {
    const reference = optionalModelReference(input.model);
    if (!reference) throw new Error("请选择用于润色的语言模型。");
    const prompt = validateTextPrompt(input.prompt);
    const direction = boundedString(input.direction, 1_000);
    const request = [
      "你是视觉创意总监。请把用户的初步画面想法润色成一段可直接发送给生图模型的高质量提示词。",
      "保留用户意图和主体事实，增强构图、镜头、光线、材质、色彩、空间层次与风格描述。",
      "不要解释，不要使用 Markdown，不要编造品牌或真实人物身份。",
      direction ? `额外方向：${direction}` : "",
      `用户初稿：${prompt}`,
    ]
      .filter(Boolean)
      .join("\n");
    const result = await this.withRequest(input.requestId, TEXT_HTTP_TIMEOUT_MS, (signal) =>
      this.callTextModel(reference, request, null, signal),
    );
    return { text: result.text, model: reference };
  }

  reversePrompt(input: ImageStudioReversePromptInput): Promise<ImageStudioServiceResult> {
    return this.trackOperation(() => this.reversePromptInternal(input));
  }

  private async reversePromptInternal(
    input: ImageStudioReversePromptInput,
  ): Promise<ImageStudioServiceResult> {
    const reference = optionalModelReference(input.model);
    if (!reference) throw new Error("请选择支持图片输入的语言模型。");
    const { model } = this.resolveModel(reference);
    if (!isVisionTextModel(model))
      throw new Error("所选语言模型未启用图片输入，请到设置中开启视觉输入。");
    return this.withRequest(input.requestId, TEXT_HTTP_TIMEOUT_MS, async (signal) => {
      const assetData = await this.queueAssetRead(input.assetId, signal);
      signal.throwIfAborted();
      const instruction =
        boundedString(input.instruction, 1_000) ||
        "描述主体、构图、镜头、光线、材质、色彩、空间层次和可复现风格。";
      const prompt = [
        "你是专业视觉提示词分析师。请根据图片反推一段可直接用于图生图或文生图的提示词。",
        instruction,
        "只输出提示词正文，不要解释，不要提及你看到了图片或使用 Markdown。",
      ].join("\n");
      const result = await this.callTextModel(reference, prompt, assetData.dataUrl, signal);
      return { text: result.text, model: reference };
    });
  }

  cancelRequest(requestId: unknown): void {
    if (typeof requestId !== "string" || !requestId) throw new Error("生图请求标识无效。");
    this.activeRequests.get(requestId)?.abort();
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closing = true;
    for (const controller of this.activeRequests.values()) controller.abort();
    this.disposal = Promise.allSettled([...this.operations]).then(() => undefined);
    return this.disposal;
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("图片工作台正在关闭。");
  }

  private trackOperation<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("图片工作台正在关闭。"));
    const operation = Promise.resolve().then(() => {
      this.assertOpen();
      return run();
    });
    this.operations.add(operation);
    void operation.then(
      () => this.operations.delete(operation),
      () => this.operations.delete(operation),
    );
    return operation;
  }

  private async importGeneratedAssets(input: {
    generated: Array<{
      base64: string;
      byteLength: number;
      mimeType: ImageStudioAsset["mimeType"];
      width: number;
      height: number;
      extension: string;
      revisedPrompt: string | null;
    }>;
    workspacePrompt: string;
    workspaceNegativePrompt: string;
    model: ModelReference;
    addToActiveCanvas: boolean;
    signal: AbortSignal;
  }): Promise<ImageStudioWorkspace> {
    if (!input.generated.length || input.generated.length > IMAGE_STUDIO_MAX_GENERATED_COUNT)
      throw new Error("供应商返回的图片数量无效。");
    const previous = this.getWorkspace();
    if (previous.assets.length + input.generated.length > IMAGE_STUDIO_MAX_ASSETS)
      throw new Error(`图片素材库最多保存 ${IMAGE_STUDIO_MAX_ASSETS} 张图片，请先删除部分素材。`);
    await this.initialize();
    input.signal.throwIfAborted();
    this.assertOpen();
    const now = new Date().toISOString();
    const stamp = now.replace(/[:.]/g, "-");
    const assets: ImageStudioAsset[] = [];
    const temporaryFiles: string[] = [];
    const writtenFiles: string[] = [];
    let workspaceSaved = false;
    try {
      for (const [index, generated] of input.generated.entries()) {
        input.signal.throwIfAborted();
        this.assertOpen();
        const bytes = decodeStrictBase64Image(generated.base64);
        if (bytes.length !== generated.byteLength)
          throw new Error("供应商返回图片的大小校验失败。");
        const asset: ImageStudioAsset = {
          id: randomUUID(),
          name: `generated-${stamp}-${index + 1}${generated.extension}`,
          mimeType: generated.mimeType,
          size: bytes.length,
          width: generated.width,
          height: generated.height,
          source: "generated",
          createdAt: now,
          prompt: input.workspacePrompt,
          negativePrompt: input.workspaceNegativePrompt,
          revisedPrompt: generated.revisedPrompt?.trim().slice(0, 8_000) || null,
          promptOrigin: "mingshen_generated",
          promptMetadataVersion: 1,
          model: input.model,
        };
        const path = this.assetPath(asset);
        const temporary = `${path}.${randomUUID()}.tmp`;
        temporaryFiles.push(temporary);
        await writeFile(temporary, bytes, { flag: "wx" });
        input.signal.throwIfAborted();
        this.assertOpen();
        await rename(temporary, path);
        temporaryFiles.pop();
        writtenFiles.push(path);
        assets.push(asset);
      }

      let documents = previous.documents;
      if (input.addToActiveCanvas && previous.activeDocumentId) {
        const columns = Math.ceil(Math.sqrt(assets.length));
        const rows = Math.ceil(assets.length / columns);
        documents = documents.map((document) => {
          if (document.id !== previous.activeDocumentId) return document;
          const layers = [...document.layers];
          assets.forEach((asset, index) => {
            if (layers.length >= IMAGE_STUDIO_MAX_LAYERS) return;
            const cellWidth = document.width / columns;
            const cellHeight = document.height / rows;
            const scale = Math.min(
              (assets.length === 1 ? document.width * 0.72 : cellWidth * 0.82) / asset.width,
              (assets.length === 1 ? document.height * 0.72 : cellHeight * 0.82) / asset.height,
              1,
            );
            const width = Math.max(16, asset.width * scale);
            const height = Math.max(16, asset.height * scale);
            const column = index % columns;
            const row = Math.floor(index / columns);
            layers.push({
              id: randomUUID(),
              assetId: asset.id,
              x:
                assets.length === 1
                  ? (document.width - width) / 2
                  : column * cellWidth + (cellWidth - width) / 2,
              y:
                assets.length === 1
                  ? (document.height - height) / 2
                  : row * cellHeight + (cellHeight - height) / 2,
              width,
              height,
              rotation: 0,
              opacity: 1,
              zIndex: layers.length,
            });
          });
          return {
            ...document,
            layers,
            updatedAt: now,
          };
        });
      }
      const workspace: ImageStudioWorkspace = {
        ...previous,
        assets: [...previous.assets, ...assets],
        documents,
        prompt: input.workspacePrompt,
      };
      const changes = await this.persistWorkspaceCanvases(workspace);
      try {
        input.signal.throwIfAborted();
        const saved = this.commitWorkspace(workspace, workspace.assets);
        workspaceSaved = true;
        return saved;
      } catch (error) {
        await this.restoreCanvasFiles(changes, error);
        throw error;
      }
    } catch (error) {
      if (!workspaceSaved) {
        await Promise.all([
          ...temporaryFiles.map((path) => unlink(path).catch(() => undefined)),
          ...(error instanceof CanvasRecoveryError
            ? []
            : writtenFiles.map((path) => unlink(path).catch(() => undefined))),
        ]);
      }
      if (error instanceof CanvasRecoveryError)
        throw new Error(`${error.message}。本轮新素材已保留，可能需要人工恢复画布。`, {
          cause: error,
        });
      throw error;
    }
  }

  private async callTextModel(
    reference: ModelReference,
    prompt: string,
    imageDataUrl: string | null,
    signal: AbortSignal,
  ): Promise<TextModelResult> {
    const { provider, model } = this.resolveModel(reference);
    if (!isTextModel(model)) throw new Error("所选模型不是文本输出模型，请选择视觉语言模型。");
    const apiKey = this.providerService.getActiveApiKey(provider.id);
    const request = this.buildTextRequest(provider, model, prompt, imageDataUrl);
    const response = await fetch(`${provider.baseUrl}${request.path}`, {
      method: "POST",
      redirect: "error",
      headers: buildAuthHeaders({
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        authMode: provider.authMode,
        customHeaderName: provider.customHeaderName,
        apiKey,
      }),
      body: JSON.stringify(request.body),
      signal,
    });
    const raw = await boundedResponseText(response);
    if (!response.ok)
      throw new Error(fetchErrorMessage(response.status, response.statusText, raw, apiKey));
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new Error("语言模型供应商返回的不是有效 JSON。");
    }
    validateTextTerminal(provider.protocol, payload);
    const text = parseTextResponse(payload).trim();
    if (!text) throw new Error("语言模型没有返回可用文本。");
    return { text: text.slice(0, 20_000), body: request.body, url: request.path };
  }

  private buildTextRequest(
    provider: ProviderView,
    model: ModelConfig,
    prompt: string,
    imageDataUrl: string | null,
  ): { path: string; body: Record<string, unknown> } {
    const maxOutputTokens = Math.min(2_048, Math.max(1, model.maxOutputTokens));
    switch (provider.protocol) {
      case "openai_chat_completions":
        return {
          path: "/chat/completions",
          body: {
            model: model.modelId,
            messages: [
              {
                role: "user",
                content: imageDataUrl
                  ? [
                      { type: "text", text: prompt },
                      { type: "image_url", image_url: { url: imageDataUrl } },
                    ]
                  : prompt,
              },
            ],
            max_tokens: maxOutputTokens,
          },
        };
      case "openai_responses":
        return {
          path: "/responses",
          body: {
            model: model.modelId,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: prompt },
                  ...(imageDataUrl ? [{ type: "input_image", image_url: imageDataUrl }] : []),
                ],
              },
            ],
            max_output_tokens: maxOutputTokens,
          },
        };
      case "anthropic_messages":
        return {
          path: "/messages",
          body: {
            model: model.modelId,
            max_tokens: maxOutputTokens,
            messages: [
              {
                role: "user",
                content: [
                  ...(imageDataUrl
                    ? [
                        {
                          type: "image",
                          source: {
                            type: "base64",
                            media_type: imageMimeFromDataUrl(imageDataUrl),
                            data: base64FromDataUrl(imageDataUrl),
                          },
                        },
                      ]
                    : []),
                  { type: "text", text: prompt },
                ],
              },
            ],
          },
        };
      case "gemini_generate_content":
        return {
          path: `/models/${encodeURIComponent(model.modelId)}:generateContent`,
          body: {
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  ...(imageDataUrl
                    ? [
                        {
                          inlineData: {
                            mimeType: imageMimeFromDataUrl(imageDataUrl),
                            data: base64FromDataUrl(imageDataUrl),
                          },
                        },
                      ]
                    : []),
                ],
              },
            ],
            generationConfig: { maxOutputTokens },
          },
        };
    }
  }

  private resolveModel(reference: ModelReference): {
    provider: ProviderView;
    model: ModelConfig;
  } {
    const provider = this.providerService.getProvider(reference.providerId);
    const model = this.repository.getModel(reference.modelId);
    if (!model?.enabled || model.providerId !== provider.id)
      throw new Error("所选模型不存在、已停用或不属于该供应商。");
    return { provider, model };
  }

  private assets(): ImageStudioAsset[] {
    const stored = asRecord(this.repository.getSetting(WORKSPACE_KEY));
    return Array.isArray(stored?.assets) ? this.normalizeAssets(stored.assets) : [];
  }

  private normalizeAssets(value: unknown[]): ImageStudioAsset[] {
    const result: ImageStudioAsset[] = [];
    const seen = new Set<string>();
    for (const raw of value.slice(0, IMAGE_STUDIO_MAX_ASSETS)) {
      const record = asRecord(raw);
      if (!record || typeof record.id !== "string") continue;
      const id = record.id.slice(0, 128);
      if (!SAFE_ASSET_ID.test(id) || seen.has(id)) continue;
      const mimeType = record.mimeType;
      if (
        mimeType !== "image/png" &&
        mimeType !== "image/jpeg" &&
        mimeType !== "image/webp" &&
        mimeType !== "image/gif"
      )
        continue;
      seen.add(id);
      const prompt = typeof record.prompt === "string" ? record.prompt.slice(0, 8_000) : null;
      const negativePrompt =
        typeof record.negativePrompt === "string" ? record.negativePrompt.slice(0, 2_000) : null;
      const promptMetadata = normalizeImageStudioAssetPromptMetadata({
        version: record.promptMetadataVersion,
        origin: record.promptOrigin,
        prompt,
        negativePrompt,
      });
      result.push({
        id,
        name: safeAssetName(
          record.name,
          mimeType === "image/jpeg" ? ".jpg" : `.${mimeType.slice(6)}`,
        ),
        mimeType,
        size: finite(record.size, 0, 0, IMAGE_STUDIO_MAX_SINGLE_BYTES),
        width: Math.round(finite(record.width, 1, 1, 32_768)),
        height: Math.round(finite(record.height, 1, 1, 32_768)),
        source:
          record.source === "generated" || record.source === "paste" ? record.source : "imported",
        createdAt: boundedString(record.createdAt, 64, new Date(0).toISOString()),
        prompt,
        negativePrompt: promptMetadata?.negativePrompt ?? negativePrompt,
        revisedPrompt:
          typeof record.revisedPrompt === "string" ? record.revisedPrompt.slice(0, 8_000) : null,
        promptOrigin: promptMetadata?.origin ?? null,
        promptMetadataVersion: promptMetadata?.version ?? null,
        model: optionalModelReference(record.model),
      });
    }
    return result;
  }

  private normalizeWorkspace(value: unknown, assets: ImageStudioAsset[]): ImageStudioWorkspace {
    const record = asRecord(value);
    if (!record) return { ...emptyImageStudioWorkspace(), assets };
    const assetIds = new Set(assets.map((asset) => asset.id));
    const documents: ImageStudioCanvas[] = [];
    const documentIds = new Set<string>();

    for (const rawDocument of Array.isArray(record.documents)
      ? record.documents.slice(0, IMAGE_STUDIO_MAX_DOCUMENTS)
      : []) {
      const document = asRecord(rawDocument);
      if (!document || typeof document.id !== "string" || documentIds.has(document.id)) continue;
      documentIds.add(document.id);
      const layers: ImageStudioLayer[] = [];
      const layerIds = new Set<string>();
      for (const rawLayer of Array.isArray(document.layers)
        ? document.layers.slice(0, IMAGE_STUDIO_MAX_LAYERS)
        : []) {
        const layer = asRecord(rawLayer);
        if (
          !layer ||
          typeof layer.id !== "string" ||
          typeof layer.assetId !== "string" ||
          !assetIds.has(layer.assetId) ||
          layerIds.has(layer.id)
        )
          continue;
        layerIds.add(layer.id);
        layers.push({
          id: layer.id.slice(0, 128),
          assetId: layer.assetId,
          x: finite(layer.x, 0, -1_000_000, 1_000_000),
          y: finite(layer.y, 0, -1_000_000, 1_000_000),
          width: finite(layer.width, 256, 8, 32_768),
          height: finite(layer.height, 256, 8, 32_768),
          rotation: finite(layer.rotation, 0, -360, 360),
          opacity: finite(layer.opacity, 1, 0, 1),
          zIndex: Math.round(finite(layer.zIndex, layers.length, 0, IMAGE_STUDIO_MAX_LAYERS)),
        });
      }
      layers
        .sort((a, b) => a.zIndex - b.zIndex)
        .forEach((layer, index) => {
          layer.zIndex = index;
        });
      documents.push({
        id: document.id.slice(0, 128),
        name: boundedString(document.name, 120, "未命名画布").trim() || "未命名画布",
        width: Math.round(finite(document.width, 1_600, 64, 8_192)),
        height: Math.round(finite(document.height, 1_000, 64, 8_192)),
        background: /^#[0-9a-f]{6}$/i.test(String(document.background ?? ""))
          ? String(document.background)
          : "#101619",
        zoom: finite(document.zoom, 0.7, 0.12, 4),
        offsetX: finite(document.offsetX, 32, -100_000, 100_000),
        offsetY: finite(document.offsetY, 32, -100_000, 100_000),
        layers,
        createdAt: boundedString(document.createdAt, 64, new Date(0).toISOString()),
        updatedAt: boundedString(document.updatedAt, 64, new Date(0).toISOString()),
      });
    }

    const activeDocumentId =
      typeof record.activeDocumentId === "string" && documentIds.has(record.activeDocumentId)
        ? record.activeDocumentId
        : (documents[0]?.id ?? null);
    const selectedAssetIds = Array.isArray(record.selectedAssetIds)
      ? record.selectedAssetIds
          .filter((id): id is string => typeof id === "string" && assetIds.has(id))
          .slice(0, IMAGE_STUDIO_MAX_ASSETS)
      : [];
    return {
      version: 1,
      activeDocumentId,
      imageModel: optionalModelReference(record.imageModel),
      textModel: optionalModelReference(record.textModel),
      generation: normalizeImageStudioGenerationSettings(record.generation),
      prompt: boundedString(record.prompt, MAX_PROMPT_CHARS),
      negativePrompt: boundedString(record.negativePrompt, 2_000),
      selectedAssetIds: [...new Set(selectedAssetIds)],
      documents,
      assets,
    };
  }

  private assetPath(asset: ImageStudioAsset): string {
    if (!SAFE_ASSET_ID.test(asset.id)) throw new Error("图片素材标识格式无效。");
    const extension = extname(asset.name).toLowerCase();
    const safeExtension = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)
      ? extension
      : asset.mimeType === "image/jpeg"
        ? ".jpg"
        : `.${asset.mimeType.slice(6)}`;
    return join(this.assetDirectory, `${asset.id}${safeExtension}`);
  }

  private async withRequest<T>(
    requestId: string,
    timeoutMs: number,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new Error("生图请求标识格式无效。");
    if (this.activeRequests.has(requestId)) throw new Error("该生图请求正在运行，请勿重复提交。");
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([controller.signal, timeout]);
    this.activeRequests.set(requestId, controller);
    try {
      const result = await run(signal);
      signal.throwIfAborted();
      this.assertOpen();
      return result;
    } catch (cause) {
      if (controller.signal.aborted) throw new Error("请求已取消。");
      if (timeout.aborted)
        throw new Error(`请求超过 ${Math.round(timeoutMs / 1_000)} 秒，已自动终止。`);
      throw cause;
    } finally {
      if (this.activeRequests.get(requestId) === controller) this.activeRequests.delete(requestId);
    }
  }
}
