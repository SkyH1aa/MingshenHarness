import type { ChatAttachmentInput } from "./domain";

export interface ComposerDraftAttachment extends ChatAttachmentInput {
  id: string;
}

export interface ComposerDraft {
  sessionId: string;
  revision: string;
  text: string;
  formatted: boolean;
  attachments: ComposerDraftAttachment[];
  notificationDraftIds: string[];
}

export interface SaveComposerDraftInput {
  sessionId: string;
  revision: string;
  text: string;
  formatted: boolean;
  attachmentIds: string[];
  addedAttachments?: ComposerDraftAttachment[];
  notificationDraftIds: string[];
}

export const MAX_COMPOSER_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_COMPOSER_NOTIFICATION_IDS = 128;

function validAttachmentBytes(dataUrl: string, size: number): boolean {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || comma > 1024 || !/^data:[^,\s]*;base64$/i.test(dataUrl.slice(0, comma)))
    return false;
  const encoded = dataUrl.slice(comma + 1);
  if (encoded.length !== Math.ceil(size / 3) * 4) return false;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if ((encoded.length / 4) * 3 - padding !== size) return false;
  const contentEnd = encoded.length - padding;
  for (let index = 0; index < contentEnd; index++) {
    const code = encoded.charCodeAt(index);
    if (
      !(
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 43 ||
        code === 47
      )
    )
      return false;
  }
  if (padding) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const last = alphabet.indexOf(encoded[contentEnd - 1] ?? "");
    if (last < 0 || (last & (padding === 2 ? 15 : 3)) !== 0) return false;
  }
  return true;
}

export function validateComposerDraftId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 200 ||
    /\s/.test(value) ||
    value.includes("\u0000")
  )
    throw new Error("Invalid composer draft ID.");
}

export function validateComposerDraftInput(input: SaveComposerDraftInput): void {
  if (!input || typeof input !== "object") throw new Error("Invalid composer draft.");
  validateComposerDraftId(input.sessionId);
  validateComposerDraftId(input.revision);
  if (typeof input.text !== "string" || typeof input.formatted !== "boolean")
    throw new Error("Invalid composer draft content.");
  for (const ids of [input.attachmentIds, input.notificationDraftIds]) {
    if (!Array.isArray(ids)) throw new Error("Invalid composer draft references.");
    ids.forEach(validateComposerDraftId);
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate composer draft references.");
  }
  if (input.notificationDraftIds.length > MAX_COMPOSER_NOTIFICATION_IDS)
    throw new Error("Too many composer notification references.");
  if (input.addedAttachments !== undefined && !Array.isArray(input.addedAttachments))
    throw new Error("Invalid composer draft attachments.");
}

export function validateComposerDraftAttachment(
  attachment: ComposerDraftAttachment,
): ComposerDraftAttachment {
  if (!attachment || typeof attachment !== "object")
    throw new Error("Invalid composer draft attachment.");
  validateComposerDraftId(attachment.id);
  if (
    typeof attachment.name !== "string" ||
    !attachment.name.trim() ||
    attachment.name.length > 255 ||
    typeof attachment.mimeType !== "string" ||
    attachment.mimeType.length > 255 ||
    !Number.isSafeInteger(attachment.size) ||
    attachment.size < 0 ||
    attachment.size > MAX_COMPOSER_ATTACHMENT_BYTES ||
    typeof attachment.dataUrl !== "string" ||
    !attachment.dataUrl.startsWith("data:") ||
    attachment.dataUrl.length > Math.ceil((MAX_COMPOSER_ATTACHMENT_BYTES * 4) / 3) + 1024 ||
    !["image", "audio", "video", "file"].includes(attachment.kind) ||
    (attachment.path !== undefined &&
      (typeof attachment.path !== "string" || attachment.path.includes("\u0000")))
  )
    throw new Error("Invalid composer draft attachment.");
  if (!validAttachmentBytes(attachment.dataUrl, attachment.size))
    throw new Error("Composer attachment content does not match its declared size.");
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    dataUrl: attachment.dataUrl,
    ...(attachment.path ? { path: attachment.path } : {}),
  };
}
