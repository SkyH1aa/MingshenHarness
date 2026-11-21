import { createCanvas, GifEncoder } from "@napi-rs/canvas";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectImage } from "./image-validation";

function pngWithUpdatedCrc(bytes: Buffer, width: number, height: number): Buffer {
  const result = Buffer.from(bytes);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  updatePngCrc(result, 8);
  return result;
}

function updatePngCrc(bytes: Buffer, chunkOffset: number): void {
  const end = chunkOffset + 8 + bytes.readUInt32BE(chunkOffset);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(chunkOffset + 4, end)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, end);
}

function corruptPngPixels(bytes: Buffer): Buffer {
  const result = Buffer.from(bytes);
  let offset = 8;
  while (offset + 12 <= result.length) {
    const length = result.readUInt32BE(offset);
    if (result.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      result.fill(0, offset + 8, offset + 8 + length);
      updatePngCrc(result, offset);
      return result;
    }
    offset += length + 12;
  }
  throw new Error("Fixture is missing IDAT");
}

function corruptJpegPixels(bytes: Buffer): Buffer {
  const result = Buffer.from(bytes);
  let offset = 2;
  while (offset + 4 < result.length) {
    if (result[offset] !== 0xff) throw new Error("Unexpected JPEG fixture marker");
    const marker = result[offset + 1];
    const length = result.readUInt16BE(offset + 2);
    if (marker === 0xda) {
      result.fill(1, offset + 2 + length, result.length - 2);
      return result;
    }
    offset += 2 + length;
  }
  throw new Error("Fixture is missing JPEG scan");
}

function addApngHeader(bytes: Buffer): Buffer {
  const animation = Buffer.alloc(20);
  animation.writeUInt32BE(8, 0);
  animation.write("acTL", 4, "ascii");
  animation.writeUInt32BE(2, 8);
  updatePngCrc(animation, 0);
  const endOfHeader = 8 + 12 + bytes.readUInt32BE(8);
  return Buffer.concat([bytes.subarray(0, endOfHeader), animation, bytes.subarray(endOfHeader)]);
}

function animatedGif(): Buffer {
  const encoder = new GifEncoder(2, 2);
  encoder.addFrame(new Uint8Array(16).fill(255), 2, 2);
  encoder.addFrame(new Uint8Array(16).fill(128), 2, 2);
  return encoder.finish();
}

function corruptLastGifFrame(bytes: Buffer): Buffer {
  const result = Buffer.from(bytes);
  let offset = 13 + ((result[10] ?? 0) & 0x80 ? 3 * 2 ** (((result[10] ?? 0) & 7) + 1) : 0);
  const starts: number[] = [];
  const skipBlocks = (): void => {
    while (true) {
      const length = result[offset++] ?? 0;
      if (!length) return;
      offset += length;
    }
  };
  while (offset < result.length) {
    const marker = result[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset++;
      skipBlocks();
    } else if (marker === 0x2c) {
      const packed = result[offset + 8] ?? 0;
      offset += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      offset++;
      starts.push(offset);
      skipBlocks();
    } else {
      throw new Error("Unexpected GIF fixture block");
    }
  }
  const block = starts.at(-1);
  if (block === undefined || starts.length !== 2) throw new Error("Missing second GIF frame");
  const length = result[block] ?? 0;
  result.fill(0xff, block + 1, block + 1 + length);
  return result;
}

async function animatedWebp(): Promise<Buffer> {
  const pixels = Buffer.alloc(32, 255);
  pixels.fill(0, 16, 24);
  return sharp(pixels, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } })
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer();
}

function corruptLastWebpFrame(bytes: Buffer): Buffer {
  const result = Buffer.from(bytes);
  let offset = 12;
  const frames: { start: number; end: number }[] = [];
  while (offset + 8 <= result.length) {
    const type = result.toString("ascii", offset, offset + 4);
    const length = result.readUInt32LE(offset + 4);
    if (type === "ANMF") frames.push({ start: offset + 8, end: offset + 8 + length });
    offset += 8 + length + (length % 2);
  }
  const frame = frames.at(-1);
  if (!frame || frames.length < 2) throw new Error("Missing second WebP frame");
  let child = frame.start + 16;
  while (child + 8 <= frame.end) {
    const type = result.toString("ascii", child, child + 4);
    const length = result.readUInt32LE(child + 4);
    if (type === "VP8 " || type === "VP8L") {
      result.fill(0xff, child + 8 + (type === "VP8 " ? 10 : 5), child + 8 + length);
      return result;
    }
    child += 8 + length + (length % 2);
  }
  throw new Error("Missing WebP bitstream");
}

describe("bounded image validation", () => {
  it("decodes real PNG, JPEG, WebP and every frame of a GIF", async () => {
    const canvas = createCanvas(2, 2);
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    for (const [mime, bytes] of [
      ["image/png", canvas.toBuffer("image/png")],
      ["image/jpeg", canvas.toBuffer("image/jpeg")],
      ["image/webp", canvas.toBuffer("image/webp")],
      ["image/gif", animatedGif()],
      ["image/webp", await animatedWebp()],
    ] as const) {
      await expect(detectImage(bytes, mime)).resolves.toMatchObject({
        mimeType: mime,
        width: 2,
        height: 2,
      });
    }
  });

  it("rejects header-only, truncated, mismatched and oversized images", async () => {
    const png = createCanvas(2, 2).toBuffer("image/png");
    await expect(detectImage(png.subarray(0, 24))).rejects.toThrow();
    await expect(detectImage(png.subarray(0, png.length - 1))).rejects.toThrow();
    await expect(detectImage(png, "image/jpeg")).rejects.toThrow("类型不匹配");
    await expect(detectImage(pngWithUpdatedCrc(png, 8_000, 8_000))).rejects.toThrow("上限");
    const gif = animatedGif();
    gif.writeUInt16LE(16_384, 6);
    gif.writeUInt16LE(16_384, 8);
    await expect(detectImage(gif)).rejects.toThrow("上限");
  });

  it("rejects damaged compressed pixels even when PNG chunk checksums are valid", async () => {
    const png = createCanvas(2, 2).toBuffer("image/png");
    await expect(detectImage(corruptPngPixels(png))).rejects.toThrow();
  });

  it("rejects damaged JPEG pixels despite a complete header and end marker", async () => {
    const jpeg = createCanvas(16, 16).toBuffer("image/jpeg");
    await expect(detectImage(corruptJpegPixels(jpeg))).rejects.toThrow();
  });

  it("rejects APNG instead of accepting only its first frame", async () => {
    const png = createCanvas(2, 2).toBuffer("image/png");
    await expect(detectImage(addApngHeader(png))).rejects.toThrow();
  });

  it("rejects corruption in a later GIF frame", async () => {
    await expect(detectImage(corruptLastGifFrame(animatedGif()))).rejects.toThrow();
  });

  it("rejects corruption in a later animated WebP frame", async () => {
    await expect(detectImage(corruptLastWebpFrame(await animatedWebp()))).rejects.toThrow();
  });
});
