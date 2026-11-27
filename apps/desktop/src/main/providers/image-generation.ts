import {
  IMAGE_STUDIO_MAX_GENERATED_COUNT,
  IMAGE_STUDIO_MAX_GENERATION_BYTES,
  IMAGE_STUDIO_MAX_SINGLE_BYTES,
  type ImageStudioAsset,
} from "../../shared/image-studio";
import type { ImageGenerationRemotePayload } from "./image-result-download";
import { detectImage } from "./image-validation";

const MAX_BASE64_CHARACTERS = Math.ceil((IMAGE_STUDIO_MAX_SINGLE_BYTES * 4) / 3) + 8;

export type { ImageGenerationRemotePayload } from "./image-result-download";

export interface ImageGenerationPayload {
  base64: string;
  mimeType: ImageStudioAsset["mimeType"];
  byteLength: number;
  revisedPrompt: string | null;
  width: number;
  height: number;
  extension: string;
}

export type ImageGenerationCandidateWarningCode =
  | "invalid_result"
  | "invalid_base64"
  | "invalid_image"
  | "url_too_long"
  | "base64_budget_exceeded";

export interface ImageGenerationCandidateWarning {
  imageIndex: number;
  code: ImageGenerationCandidateWarningCode;
  message: string;
}

export interface ImageGenerationCandidateParseResult {
  resultCount: number;
  candidates: Array<ImageGenerationPayload | ImageGenerationRemotePayload>;
  warnings: ImageGenerationCandidateWarning[];
}

const MAX_GENERATION_BYTES = IMAGE_STUDIO_MAX_GENERATION_BYTES;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function decodeStrictBase64Image(value: string): Buffer {
  const encoded = value.replace(/\s+/g, "");
  if (!encoded || encoded.length > MAX_BASE64_CHARACTERS) {
    throw new Error("供应商返回的 Base64 图片为空或超过 25 MiB。");
  }
  const unpadded = encoded.replace(/=+$/, "");
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    !/^[A-Za-z0-9+/]*$/.test(unpadded) ||
    unpadded.length % 4 === 1 ||
    (encoded.includes("=") &&
      (encoded.length % 4 !== 0 ||
        encoded.length - unpadded.length !== (4 - (unpadded.length % 4)) % 4))
  ) {
    throw new Error("供应商返回的 Base64 图片格式无效。");
  }
  const canonicalInput = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
  const bytes = Buffer.from(canonicalInput, "base64");
  if (
    !bytes.length ||
    bytes.length > IMAGE_STUDIO_MAX_SINGLE_BYTES ||
    bytes.toString("base64").replace(/=+$/, "") !== unpadded
  ) {
    throw new Error("供应商返回的 Base64 图片为空、格式无效或超过 25 MiB。");
  }
  return bytes;
}

export async function parseImageGenerationResponse(
  payload: unknown,
): Promise<ImageGenerationPayload> {
  const images = await parseImageGenerationResponses(payload);
  const first = images[0];
  if (!first) throw new Error("图片供应商没有返回图片。");
  return first;
}

export async function parseImageGenerationResponses(
  payload: unknown,
): Promise<ImageGenerationPayload[]> {
  const record = asRecord(payload);
  if (!Array.isArray(record?.data) || record.data.length === 0) {
    throw new Error(
      "供应商没有返回 Base64 图片。为避免主进程访问任意远程地址，不接受仅返回 URL 的响应。",
    );
  }
  if (record.data.length > IMAGE_STUDIO_MAX_GENERATED_COUNT)
    throw new Error(`供应商返回的图片数量超过 ${IMAGE_STUDIO_MAX_GENERATED_COUNT} 张上限。`);

  const results: ImageGenerationPayload[] = [];
  let totalBytes = 0;
  for (const value of record.data) {
    const item = asRecord(value);
    if (typeof item?.b64_json !== "string" || !item.b64_json.trim()) {
      throw new Error(
        "供应商返回的图片中包含非 Base64 结果。为避免主进程访问任意远程地址，不接受仅返回 URL 的响应。",
      );
    }
    const bytes = decodeStrictBase64Image(item.b64_json);
    totalBytes += bytes.length;
    if (totalBytes > MAX_GENERATION_BYTES)
      throw new Error("供应商返回图片的合计大小超过 100 MiB 安全上限。");
    const image = await detectImage(bytes);
    results.push({
      base64: bytes.toString("base64"),
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      extension: image.extension,
      byteLength: bytes.length,
      revisedPrompt:
        typeof item.revised_prompt === "string" ? item.revised_prompt.slice(0, 8_000) : null,
    });
  }
  return results;
}

export async function parseImageGenerationCandidates(
  payload: unknown,
): Promise<Array<ImageGenerationPayload | ImageGenerationRemotePayload>> {
  return (await parseImageGenerationCandidatesDetailed(payload)).candidates;
}

export async function parseImageGenerationCandidatesDetailed(
  payload: unknown,
): Promise<ImageGenerationCandidateParseResult> {
  const record = asRecord(payload);
  if (!Array.isArray(record?.data) || record.data.length === 0)
    throw new Error("供应商没有返回图片结果。");
  if (record.data.length > IMAGE_STUDIO_MAX_GENERATED_COUNT)
    throw new Error(`供应商返回的图片数量超过 ${IMAGE_STUDIO_MAX_GENERATED_COUNT} 张上限。`);

  const candidates: Array<ImageGenerationPayload | ImageGenerationRemotePayload> = [];
  const warnings: ImageGenerationCandidateWarning[] = [];
  let totalBase64Bytes = 0;
  for (const [index, value] of record.data.entries()) {
    const imageIndex = index + 1;
    const item = asRecord(value);
    if (!item) {
      warnings.push({
        imageIndex,
        code: "invalid_result",
        message: `第 ${imageIndex} 个图片结果格式无效，已跳过。`,
      });
      continue;
    }
    const revisedPrompt =
      typeof item.revised_prompt === "string" ? item.revised_prompt.slice(0, 8_000) : null;
    let base64Failure: ImageGenerationCandidateWarning | null = null;
    if (typeof item.b64_json === "string" && item.b64_json.trim()) {
      let bytes: Buffer | null = null;
      try {
        bytes = decodeStrictBase64Image(item.b64_json);
      } catch {
        base64Failure = {
          imageIndex,
          code: "invalid_base64",
          message: `第 ${imageIndex} 个图片结果的 Base64 格式无效，已跳过该结果。`,
        };
      }
      if (bytes) {
        if (totalBase64Bytes + bytes.length <= MAX_GENERATION_BYTES) {
          try {
            const image = await detectImage(bytes);
            totalBase64Bytes += bytes.length;
            candidates.push({
              base64: bytes.toString("base64"),
              mimeType: image.mimeType,
              width: image.width,
              height: image.height,
              extension: image.extension,
              byteLength: bytes.length,
              revisedPrompt,
            });
            continue;
          } catch {
            base64Failure = {
              imageIndex,
              code: "invalid_image",
              message: `第 ${imageIndex} 个图片结果的图片内容无效，已跳过该结果。`,
            };
          }
        } else {
          base64Failure = {
            imageIndex,
            code: "base64_budget_exceeded",
            message: `第 ${imageIndex} 个图片结果会使 Base64 合计大小超过 100 MiB，已跳过。`,
          };
        }
      }
    }

    if (typeof item.url === "string" && item.url.trim()) {
      if (item.url.length <= 8_192) {
        if (base64Failure) warnings.push(base64Failure);
        candidates.push({
          url: item.url,
          revisedPrompt,
        });
        continue;
      }
      if (base64Failure) warnings.push(base64Failure);
      warnings.push({
        imageIndex,
        code: "url_too_long",
        message: `第 ${imageIndex} 个图片结果的 URL 过长，无法安全预览，已跳过。`,
      });
      continue;
    }

    warnings.push(
      base64Failure ?? {
        imageIndex,
        code: "invalid_result",
        message: `第 ${imageIndex} 个图片结果既没有有效 Base64，也没有可预览的 URL，已跳过。`,
      },
    );
  }
  return {
    resultCount: record.data.length,
    candidates,
    warnings,
  };
}
