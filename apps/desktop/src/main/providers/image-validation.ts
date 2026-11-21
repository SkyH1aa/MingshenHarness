import sharp from "sharp";
import { IMAGE_STUDIO_MAX_SINGLE_BYTES, type ImageStudioAsset } from "../../shared/image-studio";

const MAX_IMAGE_DIMENSION = 16_384;
const MAX_DECODED_PIXELS = 40_000_000;
const MAX_IMAGE_FRAMES = 100;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DetectedImage {
  mimeType: ImageStudioAsset["mimeType"];
  width: number;
  height: number;
  extension: string;
}

interface ImageFrames extends DetectedImage {
  frames: { bytes: Buffer; width: number; height: number }[];
}

function invalidImage(): never {
  throw new Error("图片内容损坏、不完整或格式不受支持。");
}

function checkDimensions(width: number, height: number, frames = 1): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    frames > MAX_IMAGE_FRAMES ||
    width * height * frames > MAX_DECODED_PIXELS
  ) {
    throw new Error("图片超过尺寸、帧数或解码内存上限（160 MB）。");
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Buffer): ImageFrames {
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasData = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) invalidImage();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) invalidImage();
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) invalidImage();
      width = bytes.readUInt32BE(start);
      height = bytes.readUInt32BE(start + 4);
      checkDimensions(width, height);
    } else if (type === "IHDR" || type === "acTL" || type === "fcTL" || type === "fdAT") {
      // The decoder does not expose APNG frames for independent validation.
      invalidImage();
    } else if (type === "IDAT") {
      hasData = true;
    } else if (type === "IEND") {
      if (length !== 0 || end + 4 !== bytes.length) invalidImage();
      ended = true;
      break;
    }
    offset = end + 4;
  }
  if (!ended || !hasData) invalidImage();
  return {
    mimeType: "image/png",
    width,
    height,
    extension: ".png",
    frames: [{ bytes, width, height }],
  };
}

function inspectJpeg(bytes: Buffer): ImageFrames {
  let offset = 2;
  let width = 0;
  let height = 0;
  let hasScan = false;
  let ended = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) invalidImage();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) invalidImage();
    if (marker === 0xd9) {
      ended = offset === bytes.length;
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > bytes.length) invalidImage();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) invalidImage();
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 8) invalidImage();
      height = bytes.readUInt16BE(offset + 3);
      width = bytes.readUInt16BE(offset + 5);
      checkDimensions(width, height);
    }
    offset += length;
    if (marker !== 0xda) continue;
    hasScan = true;
    while (offset + 1 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const next = bytes[offset + 1] ?? 0;
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        offset += 2;
        continue;
      }
      break;
    }
  }
  if (!ended || !hasScan || !width || !height) invalidImage();
  return {
    mimeType: "image/jpeg",
    width,
    height,
    extension: ".jpg",
    frames: [{ bytes, width, height }],
  };
}

function skipGifSubBlocks(bytes: Buffer, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    const length = bytes[offset++] ?? 0;
    if (length === 0) return offset;
    if (offset + length > bytes.length) invalidImage();
    offset += length;
  }
  return invalidImage();
}

function inspectGif(bytes: Buffer): ImageFrames {
  if (bytes.length < 13) invalidImage();
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  checkDimensions(width, height);
  const packed = bytes[10] ?? 0;
  const globalSize = packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0;
  const headerEnd = 13 + globalSize;
  if (headerEnd > bytes.length) invalidImage();
  const frames: ImageFrames["frames"] = [];
  let offset = headerEnd;
  let ended = false;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) {
      ended = offset === bytes.length;
      break;
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) invalidImage();
      offset = skipGifSubBlocks(bytes, offset + 1);
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) invalidImage();
    const descriptorStart = offset - 1;
    const left = bytes.readUInt16LE(offset);
    const top = bytes.readUInt16LE(offset + 2);
    const frameWidth = bytes.readUInt16LE(offset + 4);
    const frameHeight = bytes.readUInt16LE(offset + 6);
    const framePacked = bytes[offset + 8] ?? 0;
    if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height)
      invalidImage();
    checkDimensions(width, height, frames.length + 1);
    offset += 9;
    if (framePacked & 0x80) offset += 3 * 2 ** ((framePacked & 7) + 1);
    if (offset >= bytes.length) invalidImage();
    offset = skipGifSubBlocks(bytes, offset + 1);
    const header = Buffer.from(bytes.subarray(0, headerEnd));
    header.writeUInt16LE(frameWidth, 6);
    header.writeUInt16LE(frameHeight, 8);
    const frame = Buffer.from(bytes.subarray(descriptorStart, offset));
    frame.writeUInt16LE(0, 1);
    frame.writeUInt16LE(0, 3);
    frames.push({
      bytes: Buffer.concat([header, frame, Buffer.from([0x3b])]),
      width: frameWidth,
      height: frameHeight,
    });
  }
  if (!ended || frames.length === 0) invalidImage();
  return { mimeType: "image/gif", width, height, extension: ".gif", frames };
}

function uint24le(bytes: Buffer, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function webpBitstreamDimensions(bytes: Buffer, type: string, start: number, end: number) {
  if (type === "VP8L" && end - start >= 5 && bytes[start] === 0x2f) {
    const bits = bytes.readUInt32LE(start + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (
    type === "VP8 " &&
    end - start >= 10 &&
    bytes[start + 3] === 0x9d &&
    bytes[start + 4] === 0x01 &&
    bytes[start + 5] === 0x2a
  ) {
    return {
      width: bytes.readUInt16LE(start + 6) & 0x3fff,
      height: bytes.readUInt16LE(start + 8) & 0x3fff,
    };
  }
  return invalidImage();
}

function riffChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, ...(data.length % 2 ? [Buffer.alloc(1)] : [])]);
}

function inspectWebp(bytes: Buffer): ImageFrames {
  if (bytes.length < 20 || bytes.readUInt32LE(4) !== bytes.length - 8) invalidImage();
  let width = 0;
  let height = 0;
  let animated = false;
  let hasAnimationHeader = false;
  let staticImage = false;
  const frames: ImageFrames["frames"] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end + (length % 2) > bytes.length) invalidImage();
    if (type === "VP8X") {
      if (length !== 10 || width || height) invalidImage();
      animated = ((bytes[start] ?? 0) & 0x02) !== 0;
      width = uint24le(bytes, start + 4) + 1;
      height = uint24le(bytes, start + 7) + 1;
      checkDimensions(width, height);
    } else if (type === "ANIM") {
      if (!animated || length !== 6 || hasAnimationHeader) invalidImage();
      hasAnimationHeader = true;
    } else if (type === "ANMF") {
      if (!animated || !hasAnimationHeader || length < 24) invalidImage();
      const left = uint24le(bytes, start) * 2;
      const top = uint24le(bytes, start + 3) * 2;
      const frameWidth = uint24le(bytes, start + 6) + 1;
      const frameHeight = uint24le(bytes, start + 9) + 1;
      if (left + frameWidth > width || top + frameHeight > height) invalidImage();
      checkDimensions(width, height, frames.length + 1);
      let child = start + 16;
      let foundImage = false;
      let hasAlpha = false;
      while (child + 8 <= end) {
        const childType = bytes.toString("ascii", child, child + 4);
        const childLength = bytes.readUInt32LE(child + 4);
        const childStart = child + 8;
        const childEnd = childStart + childLength;
        if (childEnd + (childLength % 2) > end) invalidImage();
        if (childType === "ALPH") hasAlpha = true;
        if (childType === "VP8 " || childType === "VP8L") {
          if (foundImage) invalidImage();
          const dimensions = webpBitstreamDimensions(bytes, childType, childStart, childEnd);
          if (dimensions.width !== frameWidth || dimensions.height !== frameHeight) invalidImage();
          foundImage = true;
        }
        child = childEnd + (childLength % 2);
      }
      if (!foundImage || child !== end) invalidImage();
      const extended = Buffer.alloc(10);
      if (hasAlpha) extended[0] = 0x10;
      extended.writeUIntLE(frameWidth - 1, 4, 3);
      extended.writeUIntLE(frameHeight - 1, 7, 3);
      const content = Buffer.concat([
        Buffer.from("WEBP"),
        riffChunk("VP8X", extended),
        bytes.subarray(start + 16, end),
      ]);
      const riff = Buffer.alloc(8);
      riff.write("RIFF", 0, "ascii");
      riff.writeUInt32LE(content.length, 4);
      frames.push({
        bytes: Buffer.concat([riff, content]),
        width: frameWidth,
        height: frameHeight,
      });
    } else if (type === "VP8 " || type === "VP8L") {
      if (animated || staticImage) invalidImage();
      const dimensions = webpBitstreamDimensions(bytes, type, start, end);
      if (width && (width !== dimensions.width || height !== dimensions.height)) invalidImage();
      ({ width, height } = dimensions);
      checkDimensions(width, height);
      staticImage = true;
    }
    offset = end + (length % 2);
  }
  if (offset !== bytes.length || (animated ? !frames.length : !staticImage)) invalidImage();
  if (!animated) frames.push({ bytes, width, height });
  return { mimeType: "image/webp", width, height, extension: ".webp", frames };
}

let decodeQueue: Promise<void> = Promise.resolve();

export async function detectImage(
  data: Uint8Array,
  declaredMimeType?: string,
): Promise<DetectedImage> {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!bytes.length || bytes.length > IMAGE_STUDIO_MAX_SINGLE_BYTES) invalidImage();
  let image: ImageFrames;
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) image = inspectPng(bytes);
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) image = inspectJpeg(bytes);
  else if (bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a")
    image = inspectGif(bytes);
  else if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
    image = inspectWebp(bytes);
  else return invalidImage();
  if (declaredMimeType && declaredMimeType.split(";")[0]?.trim().toLowerCase() !== image.mimeType)
    throw new Error("图片内容与声明的文件类型不匹配。");

  const validation = decodeQueue.then(async () => {
    for (const frame of image.frames) {
      const decoded = await sharp(frame.bytes, {
        failOn: "warning",
        limitInputPixels: MAX_DECODED_PIXELS,
        sequentialRead: true,
      })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        decoded.info.width !== frame.width ||
        decoded.info.height !== frame.height ||
        decoded.data.length !== frame.width * frame.height * 4
      )
        invalidImage();
    }
  });
  decodeQueue = validation.then(
    () => undefined,
    () => undefined,
  );
  try {
    await validation;
  } catch {
    invalidImage();
  }
  return {
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    extension: image.extension,
  };
}
