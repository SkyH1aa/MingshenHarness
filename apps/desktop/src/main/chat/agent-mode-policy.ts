import {
  attachmentDocumentName,
  isSupportedChatRasterImageMimeType,
} from "../../shared/attachments";
import type { ChatAttachmentInput, SessionView } from "../../shared/domain";

export const CHAT_TOOLS = new Set(["web_search", "web_fetch"]);
const CHAT_DOCUMENT_PATTERN = /\.(?:pdf|docx?|xlsx?|pptx)$/i;
const DATA_URL_PATTERN = /^data:([^;,]*);base64,/i;

export function isChatSession(session: Pick<SessionView, "agentMode">): boolean {
  return session.agentMode === "chat";
}

export function chatToolRejection(
  session: Pick<SessionView, "agentMode"> & Partial<Pick<SessionView, "chatNetworkEnabled">>,
  tool: string,
) {
  if (!isChatSession(session)) return null;
  if (CHAT_TOOLS.has(tool) && session.chatNetworkEnabled === false)
    return {
      output: `CHAT_NETWORK_DISABLED: ChatAgent internet access is disabled. ${tool} was not executed.`,
      isError: true,
    };
  return !CHAT_TOOLS.has(tool)
    ? {
        output: `CHAT_TOOL_DENIED: ChatAgent only permits web_search and web_fetch. ${tool} was not executed. Uploaded attachments are parsed from their bytes; local paths, commands, plugins, Skills and subagents are unavailable.`,
        isError: true,
      }
    : null;
}

function dataUrlMimeType(dataUrl: string): string {
  return DATA_URL_PATTERN.exec(dataUrl)?.[1]?.trim().toLowerCase() ?? "";
}

function ascii(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString("ascii");
}

function detectedRasterImageMimeType(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (buffer.length >= 6 && (ascii(buffer, 0, 6) === "GIF87a" || ascii(buffer, 0, 6) === "GIF89a"))
    return "image/gif";
  if (buffer.length >= 12 && ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP")
    return "image/webp";
  if (buffer.length >= 2 && ascii(buffer, 0, 2) === "BM") return "image/bmp";
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  )
    return "image/tiff";
  if (
    buffer.length >= 12 &&
    ascii(buffer, 4, 8) === "ftyp" &&
    /(?:avif|avis)/i.test(ascii(buffer, 8, Math.min(buffer.length, 40)))
  )
    return "image/avif";
  return null;
}

function normalizeChatImage<T extends ChatAttachmentInput>(attachment: T): T {
  const dataMimeType = dataUrlMimeType(attachment.dataUrl);
  const declaredMimeType = attachment.mimeType.trim().toLowerCase();
  if (
    (!isSupportedChatRasterImageMimeType(declaredMimeType) &&
      declaredMimeType !== "application/octet-stream") ||
    (dataMimeType && !isSupportedChatRasterImageMimeType(dataMimeType))
  ) {
    throw new Error(
      "CHAT_IMAGE_UNSUPPORTED: ChatAgent only supports raster PNG, JPEG, WebP, GIF, BMP, TIFF or AVIF images. SVG and executable/container image formats are not accepted.",
    );
  }
  const comma = attachment.dataUrl.indexOf(",");
  const header =
    comma >= 0
      ? Buffer.from(attachment.dataUrl.slice(comma + 1, comma + 129), "base64")
      : Buffer.alloc(0);
  const detectedMimeType = detectedRasterImageMimeType(header);
  if (!detectedMimeType) {
    throw new Error(
      "CHAT_IMAGE_SIGNATURE_MISMATCH: The uploaded image bytes do not match a supported raster image format.",
    );
  }
  if (
    (isSupportedChatRasterImageMimeType(declaredMimeType) &&
      declaredMimeType !== detectedMimeType) ||
    (isSupportedChatRasterImageMimeType(dataMimeType) && dataMimeType !== detectedMimeType)
  ) {
    throw new Error(
      "CHAT_IMAGE_SIGNATURE_MISMATCH: The declared image type does not match the uploaded bytes.",
    );
  }
  return {
    ...attachment,
    mimeType: detectedMimeType,
    dataUrl: `data:${detectedMimeType};base64,${attachment.dataUrl.slice(comma + 1)}`,
  };
}

export function chatUpload<T extends ChatAttachmentInput>(attachment: T): T {
  if (attachment.kind === "image") {
    const {
      path: _path,
      extractedContent: _extracted,
      documentPageImages: _images,
      ...uploaded
    } = normalizeChatImage(attachment);
    return uploaded as T;
  }
  if (/\.ppt$/i.test(attachment.name)) {
    throw new Error(
      "CHAT_LEGACY_PPT_UNSUPPORTED: Legacy binary .ppt files are not supported. Save the presentation as .pptx and upload it again.",
    );
  }
  const documentName = attachmentDocumentName(attachment.name, attachment.mimeType);
  if (
    attachment.kind !== "file" ||
    !documentName ||
    !CHAT_DOCUMENT_PATTERN.test(documentName) ||
    dataUrlMimeType(attachment.dataUrl).startsWith("image/") ||
    attachment.mimeType.trim().toLowerCase().startsWith("image/")
  )
    throw new Error(
      "CHAT_ATTACHMENT_UNSUPPORTED: ChatAgent supports uploaded raster images, PDF, DOC/DOCX, XLS/XLSX and PPTX files only.",
    );
  const {
    path: _path,
    extractedContent: _extracted,
    documentPageImages: _images,
    ...uploaded
  } = attachment;
  return uploaded as T;
}
