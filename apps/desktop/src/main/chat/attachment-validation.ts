import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_TOTAL_BYTES,
  MAX_CHAT_ATTACHMENTS,
  validateChatAttachmentBatch,
} from "../../shared/attachments";
import { validAttachmentBytes } from "../../shared/composer-draft";
import type { ChatAttachmentInput } from "../../shared/domain";

export {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_TOTAL_BYTES,
  MAX_CHAT_ATTACHMENTS,
  validateChatAttachmentBatch,
};

function payloadMimeType(dataUrl: string): string {
  return /^data:([^;,]*)/i.exec(dataUrl)?.[1]?.trim().toLowerCase() || "application/octet-stream";
}

export function validateChatAttachments(
  value: ChatAttachmentInput[] | undefined,
): ChatAttachmentInput[] {
  if (value === undefined) return [];
  validateChatAttachmentBatch(value);
  return value.map((attachment) => {
    if (!attachment || typeof attachment !== "object") throw new Error("附件格式无效。");
    const name = typeof attachment.name === "string" ? attachment.name.trim() : "";
    if (!name || name.length > 255) {
      throw new Error("附件名称长度必须为 1 到 255 个字符。");
    }
    const mimeType =
      typeof attachment.mimeType === "string" && attachment.mimeType.trim()
        ? attachment.mimeType.trim().toLowerCase()
        : "application/octet-stream";
    if (mimeType.length > 255) throw new Error(`附件「${name}」的 MIME 类型无效。`);
    if (
      !Number.isSafeInteger(attachment.size) ||
      attachment.size <= 0 ||
      attachment.size > MAX_CHAT_ATTACHMENT_BYTES
    ) {
      throw new Error(`附件「${name}」超过单文件 25 MiB 限制。`);
    }
    if (
      typeof attachment.dataUrl !== "string" ||
      attachment.dataUrl.length > Math.ceil((MAX_CHAT_ATTACHMENT_BYTES * 4) / 3) + 1024 ||
      !validAttachmentBytes(attachment.dataUrl, attachment.size)
    ) {
      throw new Error(`附件「${name}」内容与声明大小不符。请重新上传。`);
    }
    if (!["image", "audio", "video", "file"].includes(attachment.kind)) {
      throw new Error(`附件「${name}」的类型不受支持。`);
    }
    const dataMimeType = payloadMimeType(attachment.dataUrl);
    if (
      attachment.kind === "image" &&
      !mimeType.startsWith("image/") &&
      !dataMimeType.startsWith("image/")
    ) {
      throw new Error(`附件「${name}」不是有效的图片类型。`);
    }
    if (
      attachment.kind === "audio" &&
      mimeType !== "application/octet-stream" &&
      dataMimeType !== "application/octet-stream" &&
      (!mimeType.startsWith("audio/") || !dataMimeType.startsWith("audio/"))
    ) {
      throw new Error(`附件「${name}」不是有效的音频类型。`);
    }
    if (
      attachment.kind === "video" &&
      mimeType !== "application/octet-stream" &&
      dataMimeType !== "application/octet-stream" &&
      (!mimeType.startsWith("video/") || !dataMimeType.startsWith("video/"))
    ) {
      throw new Error(`附件「${name}」不是有效的视频类型。`);
    }
    if (
      attachment.path !== undefined &&
      (typeof attachment.path !== "string" || attachment.path.includes("\u0000"))
    ) {
      throw new Error(`附件「${name}」的路径无效。`);
    }
    return {
      size: attachment.size,
      kind: attachment.kind,
      dataUrl: attachment.dataUrl,
      ...(attachment.path ? { path: attachment.path } : {}),
      name,
      mimeType,
    };
  });
}
