import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { ModelConfig, ModelReference, ProviderView } from "../../shared/domain";
import {
  emptyImageStudioWorkspace,
  IMAGE_STUDIO_MAX_ASSETS,
  IMAGE_STUDIO_MAX_DOCUMENTS,
  IMAGE_STUDIO_MAX_IMPORT_BYTES,
  IMAGE_STUDIO_MAX_LAYERS,
  IMAGE_STUDIO_MAX_SINGLE_BYTES,
  type ImageStudioAsset,
  type ImageStudioAssetData,
  type ImageStudioCanvas,
  type ImageStudioGenerateInput,
  type ImageStudioGenerateResult,
  type ImageStudioImportFile,
  type ImageStudioLayer,
  type ImageStudioPolishInput,
  type ImageStudioReversePromptInput,
  type ImageStudioServiceResult,
  type ImageStudioWorkspace,
  normalizeImageSize,
} from "../../shared/image-studio";
import {
  isImageOutputModel,
  isTextModel,
  isVisionTextModel,
} from "../../shared/model-capabilities";
import {
  decodeStrictBase64Image,
  parseImageGenerationResponse,
} from "../providers/image-generation";
import { detectImage } from "../providers/image-validation";
import type { ProviderService } from "../providers/provider-service";
import { buildAuthHeaders } from "../providers/provider-service";
import type { Repository } from "../storage/repository";

const WORKSPACE_KEY = ["image", "studio", "workspace", "v1"].join(".");
const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_CHARS = 4_000;
const MAX_RESPONSE_BYTES = Math.ceil((IMAGE_STUDIO_MAX_SINGLE_BYTES * 4) / 3) + 64 * 1024;
const TEXT_HTTP_TIMEOUT_MS = 120_000;
const IMAGE_HTTP_TIMEOUT_MS = 180_000;
const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
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

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
    throw new Error("供应商响应超过安全上限。");
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESPONSE_BYTES) throw new Error("供应商响应超过安全上限。");
    return bytes.toString("utf8");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
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

function promptWithNegative(prompt: string, negativePrompt: unknown): string {
  if (typeof negativePrompt !== "string" || !negativePrompt.trim()) return prompt;
  const negative = negativePrompt.trim().slice(0, 2_000);
  return `${prompt}\n\nAvoid these elements: ${negative}`;
}

function imageMimeFromDataUrl(dataUrl: string): string {
  return /^data:([^;]+);base64,/.exec(dataUrl)?.[1] ?? "image/png";
}

function base64FromDataUrl(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

export class ImageStudioService {
  private readonly assetDirectory: string;
  private readonly activeRequests = new Map<string, AbortController>();
  private readonly operations = new Set<Promise<unknown>>();
  private assetReadQueue: Promise<void> = Promise.resolve();
  private closing = false;
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly repository: Repository,
    private readonly providerService: ProviderService,
    userDataDirectory: string,
  ) {
    this.assetDirectory = join(userDataDirectory, "image-studio", "assets");
  }

  private async initialize(): Promise<void> {
    await mkdir(this.assetDirectory, { recursive: true });
  }

  getWorkspace(): ImageStudioWorkspace {
    this.assertOpen();
    return this.normalizeWorkspace(this.repository.getSetting(WORKSPACE_KEY), this.assets());
  }

  saveWorkspace(input: unknown): ImageStudioWorkspace {
    this.assertOpen();
    return this.commitWorkspace(input, this.assets());
  }

  private commitWorkspace(input: unknown, assets: ImageStudioAsset[]): ImageStudioWorkspace {
    this.assertOpen();
    const workspace = this.normalizeWorkspace(input, assets);
    const serialized = JSON.stringify(workspace);
    if (Buffer.byteLength(serialized) > MAX_WORKSPACE_BYTES)
      throw new Error("画布工程超过 2 MiB，请减少图层数量或拆分项目。");
    this.repository.setSetting(WORKSPACE_KEY, workspace);
    return workspace;
  }

  getAssetData(assetId: unknown): Promise<ImageStudioAssetData> {
    return this.trackOperation(() => this.queueAssetRead(assetId));
  }

  private queueAssetRead(assetId: unknown, signal?: AbortSignal): Promise<ImageStudioAssetData> {
    const reading = this.assetReadQueue.then(() => this.readAssetData(assetId, signal));
    this.assetReadQueue = reading.then(
      () => undefined,
      () => undefined,
    );
    return reading;
  }

  private async readAssetData(
    assetId: unknown,
    signal?: AbortSignal,
  ): Promise<ImageStudioAssetData> {
    this.assertOpen();
    signal?.throwIfAborted();
    if (typeof assetId !== "string") throw new Error("图片素材标识无效。");
    const asset = this.assets().find((item) => item.id === assetId);
    if (!asset) throw new Error("图片素材不存在。");
    const file = await open(this.assetPath(asset), "r");
    let bytes: Buffer;
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
      dataUrl: `data:${asset.mimeType};base64,${bytes.toString("base64")}`,
    };
  }

  importAssets(input: unknown): Promise<ImageStudioWorkspace> {
    return this.trackOperation(() => this.importAssetsInternal(input));
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
    if (total > IMAGE_STUDIO_MAX_IMPORT_BYTES)
      throw new Error("本次导入图片合计不能超过 100 MiB。");

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
          source: file.source === "paste" || file.source === "generated" ? file.source : "imported",
          createdAt: new Date().toISOString(),
          prompt: null,
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
    return this.trackOperation(() => this.removeAssetInternal(assetId));
  }

  private async removeAssetInternal(assetId: unknown): Promise<ImageStudioWorkspace> {
    if (typeof assetId !== "string") throw new Error("图片素材标识无效。");
    const workspace = this.getWorkspace();
    const asset = workspace.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error("图片素材不存在。");
    const next: ImageStudioWorkspace = {
      ...workspace,
      assets: workspace.assets.filter((item) => item.id !== assetId),
      selectedAssetIds: workspace.selectedAssetIds.filter((id) => id !== assetId),
      documents: workspace.documents.map((document) => ({
        ...document,
        layers: document.layers
          .filter((layer) => layer.assetId !== assetId)
          .map((layer, index) => ({ ...layer, zIndex: index })),
        updatedAt: new Date().toISOString(),
      })),
    };
    this.commitWorkspace(next, next.assets);
    await unlink(this.assetPath(asset)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return this.getWorkspace();
  }

  generate(input: ImageStudioGenerateInput): Promise<ImageStudioGenerateResult> {
    return this.trackOperation(() => this.generateInternal(input));
  }

  private async generateInternal(
    input: ImageStudioGenerateInput,
  ): Promise<ImageStudioGenerateResult> {
    const modelReference = optionalModelReference(input.model);
    if (!modelReference) throw new Error("请选择图片生成模型。");
    const prompt = promptWithNegative(validateTextPrompt(input.prompt), input.negativePrompt);
    const { provider, model } = this.resolveModel(modelReference);
    if (!isImageOutputModel(model))
      throw new Error("所选模型不是仅图片生成模型，请到设置中启用“图片生成模型”。");
    if (provider.protocol !== "openai_chat_completions" && provider.protocol !== "openai_responses")
      throw new Error(
        "内置生图使用 OpenAI Images 兼容协议。请新建一个 OpenAI Chat Completions 兼容供应商，Base URL 以 /v1 结尾。",
      );

    const apiKey = this.providerService.getActiveApiKey(provider.id);
    const url = `${provider.baseUrl}/images/generations`;
    const body = {
      model: model.modelId,
      prompt,
      n: 1,
      size: normalizeImageSize(input.size),
      response_format: "b64_json",
    };
    return this.withRequest(input.requestId, IMAGE_HTTP_TIMEOUT_MS, async (signal) => {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: buildAuthHeaders({
          baseUrl: provider.baseUrl,
          protocol: provider.protocol,
          authMode: provider.authMode,
          customHeaderName: provider.customHeaderName,
          apiKey,
        }),
        body: JSON.stringify(body),
        signal,
      });
      const raw = await boundedResponseText(response);
      if (!response.ok)
        throw new Error(fetchErrorMessage(response.status, response.statusText, raw, apiKey));
      let payload: unknown;
      try {
        payload = JSON.parse(raw) as unknown;
      } catch {
        throw new Error("图片供应商返回的不是有效 JSON。");
      }
      const generated = await parseImageGenerationResponse(payload);
      signal.throwIfAborted();
      this.assertOpen();
      const dataUrl = `data:${generated.mimeType};base64,${generated.base64}`;
      const workspace = await this.importGeneratedAsset({
        dataUrl,
        detected: generated,
        prompt,
        model: modelReference,
        revisedPrompt: generated.revisedPrompt,
        addToActiveCanvas: input.addToActiveCanvas === true,
        signal,
      });
      const asset = workspace.assets.at(-1);
      if (!asset) throw new Error("保存生成图片失败。");
      return { asset, dataUrl, revisedPrompt: generated.revisedPrompt, workspace };
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

  private async importGeneratedAsset(input: {
    dataUrl: string;
    detected: {
      mimeType: ImageStudioAsset["mimeType"];
      width: number;
      height: number;
      extension: string;
    };
    prompt: string;
    model: ModelReference;
    revisedPrompt: string | null;
    addToActiveCanvas: boolean;
    signal: AbortSignal;
  }): Promise<ImageStudioWorkspace> {
    const bytes = parseDataUrl(input.dataUrl).bytes;
    const detected = input.detected;
    const id = randomUUID();
    const asset: ImageStudioAsset = {
      id,
      name: `generated-${new Date().toISOString().replace(/[:.]/g, "-")}${detected.extension}`,
      mimeType: detected.mimeType,
      size: bytes.length,
      width: detected.width,
      height: detected.height,
      source: "generated",
      createdAt: new Date().toISOString(),
      prompt: input.revisedPrompt || input.prompt,
      model: input.model,
    };
    await this.initialize();
    input.signal.throwIfAborted();
    this.assertOpen();
    const path = this.assetPath(asset);
    const temporary = `${path}.${randomUUID()}.tmp`;
    let workspaceSaved = false;
    try {
      await writeFile(temporary, bytes, { flag: "wx" });
      input.signal.throwIfAborted();
      this.assertOpen();
      await rename(temporary, path);
      input.signal.throwIfAborted();
      this.assertOpen();

      const now = new Date().toISOString();
      const previous = this.getWorkspace();
      if (previous.assets.length >= IMAGE_STUDIO_MAX_ASSETS)
        throw new Error(`图片素材库已达到 ${IMAGE_STUDIO_MAX_ASSETS} 张上限。`);
      let documents = previous.documents;
      if (input.addToActiveCanvas && previous.activeDocumentId) {
        documents = documents.map((document) => {
          if (document.id !== previous.activeDocumentId) return document;
          const scale = Math.min(
            (document.width * 0.72) / detected.width,
            (document.height * 0.72) / detected.height,
            1,
          );
          const width = Math.max(16, detected.width * scale);
          const height = Math.max(16, detected.height * scale);
          const layer: ImageStudioLayer = {
            id: randomUUID(),
            assetId: asset.id,
            x: (document.width - width) / 2,
            y: (document.height - height) / 2,
            width,
            height,
            rotation: 0,
            opacity: 1,
            zIndex: document.layers.length,
          };
          return {
            ...document,
            layers: [...document.layers, layer].slice(-IMAGE_STUDIO_MAX_LAYERS),
            updatedAt: now,
          };
        });
      }
      const workspace: ImageStudioWorkspace = {
        ...previous,
        assets: [...previous.assets, asset],
        documents,
        prompt: input.prompt,
      };
      this.commitWorkspace(workspace, workspace.assets);
      workspaceSaved = true;
      return this.getWorkspace();
    } catch (error) {
      if (!workspaceSaved) {
        await Promise.all([
          unlink(temporary).catch(() => undefined),
          unlink(path).catch(() => undefined),
        ]);
      }
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
        prompt: typeof record.prompt === "string" ? record.prompt.slice(0, 8_000) : null,
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
          .slice(0, 30)
      : [];
    return {
      version: 1,
      activeDocumentId,
      imageModel: optionalModelReference(record.imageModel),
      textModel: optionalModelReference(record.textModel),
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
