import { IMAGE_STUDIO_MAX_SINGLE_BYTES, type ImageStudioAsset } from "../../shared/image-studio";
import { detectImage } from "./image-validation";

const MAX_BASE64_CHARACTERS = Math.ceil((IMAGE_STUDIO_MAX_SINGLE_BYTES * 4) / 3) + 8;

export interface ImageGenerationPayload {
  base64: string;
  mimeType: ImageStudioAsset["mimeType"];
  byteLength: number;
  revisedPrompt: string | null;
  width: number;
  height: number;
  extension: string;
}

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
  const record = asRecord(payload);
  const first = asRecord(Array.isArray(record?.data) ? record.data[0] : null);
  if (typeof first?.b64_json !== "string" || !first.b64_json.trim()) {
    throw new Error(
      "供应商没有返回 Base64 图片。为避免主进程访问任意远程地址，不接受仅返回 URL 的响应。",
    );
  }

  const bytes = decodeStrictBase64Image(first.b64_json);
  const image = await detectImage(bytes);

  return {
    base64: bytes.toString("base64"),
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    extension: image.extension,
    byteLength: bytes.length,
    revisedPrompt:
      typeof first.revised_prompt === "string" ? first.revised_prompt.slice(0, 8_000) : null,
  };
}
