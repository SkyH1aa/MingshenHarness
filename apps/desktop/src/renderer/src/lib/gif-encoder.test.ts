import { loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  encodeGif,
  GIF_MAX_FRAMES,
  GIF_MAX_OUTPUT_BYTES,
  GIF_MAX_OUTPUT_DIMENSION,
  GIF_MAX_OUTPUT_PIXELS,
  GIF_MAX_SOURCE_DIMENSION,
  GIF_MAX_TOTAL_RGBA_BYTES,
  type GifEncodeOptions,
  type GifFrame,
} from "./gif-encoder";

interface ParsedControl {
  delay: number;
  disposal: number;
  transparent: boolean;
  transparentIndex: number;
}

interface ParsedFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  control: ParsedControl | null;
  indices: number[];
  clearCount: number;
}

interface ParsedGif {
  width: number;
  height: number;
  palette: Uint8Array;
  loop: number | null;
  graphicControlCount: number;
  frames: ParsedFrame[];
}

function byteAt(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset];
  if (value === undefined) throw new Error(`Unexpected end of GIF at byte ${offset}.`);
  return value;
}

function uint16At(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(byteAt(bytes, offset + index));
  }
  return value;
}

function readSubBlocks(bytes: Uint8Array, start: number): { data: Uint8Array; next: number } {
  const chunks: number[] = [];
  let offset = start;
  while (true) {
    const length = byteAt(bytes, offset);
    offset += 1;
    if (length === 0) break;
    for (let index = 0; index < length; index += 1) {
      chunks.push(byteAt(bytes, offset + index));
    }
    offset += length;
  }
  return { data: Uint8Array.from(chunks), next: offset };
}

class LsbBitReader {
  private bitBuffer = 0;
  private bitCount = 0;
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  read(size: number): number {
    while (this.bitCount < size) {
      if (this.offset >= this.data.length) throw new Error("Truncated LZW stream.");
      this.bitBuffer |= byteAt(this.data, this.offset) << this.bitCount;
      this.offset += 1;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << size) - 1);
    this.bitBuffer >>>= size;
    this.bitCount -= size;
    return value;
  }
}

function decodeLzw(
  compressed: Uint8Array,
  minimumCodeSize: number,
  expectedPixels: number,
): { indices: number[]; clearCount: number } {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  const reader = new LsbBitReader(compressed);
  const output: number[] = [];
  let dictionary: Array<number[] | undefined> = [];
  let codeSize = minimumCodeSize + 1;
  let nextCode = endCode + 1;
  let previous: number[] | null = null;
  let clearCount = 0;

  const reset = (): void => {
    dictionary = new Array<number[] | undefined>(4_096);
    for (let code = 0; code < clearCode; code += 1) dictionary[code] = [code];
    codeSize = minimumCodeSize + 1;
    nextCode = endCode + 1;
    previous = null;
  };

  reset();
  let ended = false;
  while (!ended) {
    const code = reader.read(codeSize);
    if (code === clearCode) {
      clearCount += 1;
      reset();
      continue;
    }
    if (code === endCode) {
      ended = true;
      continue;
    }

    let entry: number[] | undefined = dictionary[code];
    if (!entry && previous && code === nextCode) {
      const first: number | undefined = previous[0];
      if (first === undefined) throw new Error("Invalid LZW prefix.");
      entry = [...previous, first];
    }
    if (!entry) throw new Error(`Invalid LZW code ${code}.`);

    for (const index of entry) output.push(index);
    if (output.length > expectedPixels) throw new Error("LZW output is too long.");
    if (previous && nextCode < 4_096) {
      const first = entry[0];
      if (first === undefined) throw new Error("Invalid empty LZW entry.");
      dictionary[nextCode] = [...previous, first];
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }

  if (output.length !== expectedPixels) {
    throw new Error(`LZW decoded ${output.length} pixels, expected ${expectedPixels}.`);
  }
  return { indices: output, clearCount };
}

function parseGif(bytes: Uint8Array): ParsedGif {
  if (asciiAt(bytes, 0, 6) !== "GIF89a") throw new Error("Missing GIF89a header.");
  const width = uint16At(bytes, 6);
  const height = uint16At(bytes, 8);
  const packed = byteAt(bytes, 10);
  if ((packed & 0x80) === 0) throw new Error("Missing global color table.");
  const colorCount = 1 << ((packed & 0x07) + 1);
  let offset = 13;
  const palette = bytes.slice(offset, offset + colorCount * 3);
  offset += colorCount * 3;
  let loop: number | null = null;
  let graphicControlCount = 0;
  let pendingControl: ParsedControl | null = null;
  const frames: ParsedFrame[] = [];

  while (offset < bytes.length) {
    const marker = byteAt(bytes, offset);
    offset += 1;
    if (marker === 0x3b) {
      if (offset !== bytes.length) throw new Error("Trailing bytes after GIF trailer.");
      return { width, height, palette, loop, graphicControlCount, frames };
    }
    if (marker === 0x21) {
      const label = byteAt(bytes, offset);
      offset += 1;
      if (label === 0xf9) {
        const size = byteAt(bytes, offset);
        offset += 1;
        if (size !== 4) throw new Error("Invalid graphic control block size.");
        const controlPacked = byteAt(bytes, offset);
        const delay = uint16At(bytes, offset + 1);
        pendingControl = {
          delay,
          disposal: (controlPacked >> 2) & 0x07,
          transparent: (controlPacked & 1) === 1,
          transparentIndex: byteAt(bytes, offset + 3),
        };
        graphicControlCount += 1;
        offset += 4;
        if (byteAt(bytes, offset) !== 0) throw new Error("Invalid graphic control terminator.");
        offset += 1;
        continue;
      }
      if (label === 0xff) {
        const identifierLength = byteAt(bytes, offset);
        offset += 1;
        const identifier = asciiAt(bytes, offset, identifierLength);
        offset += identifierLength;
        const subBlocks = readSubBlocks(bytes, offset);
        offset = subBlocks.next;
        if (identifier === "NETSCAPE2.0" && subBlocks.data[0] === 1 && subBlocks.data.length >= 3) {
          loop = (subBlocks.data[1] ?? 0) | ((subBlocks.data[2] ?? 0) << 8);
        }
        continue;
      }
      const skipped = readSubBlocks(bytes, offset);
      offset = skipped.next;
      continue;
    }
    if (marker !== 0x2c) throw new Error(`Unknown GIF block marker 0x${marker.toString(16)}.`);

    const left = uint16At(bytes, offset);
    const top = uint16At(bytes, offset + 2);
    const frameWidth = uint16At(bytes, offset + 4);
    const frameHeight = uint16At(bytes, offset + 6);
    const imagePacked = byteAt(bytes, offset + 8);
    offset += 9;
    if ((imagePacked & 0x80) !== 0) {
      const localColors = 1 << ((imagePacked & 0x07) + 1);
      offset += localColors * 3;
    }
    const minimumCodeSize = byteAt(bytes, offset);
    offset += 1;
    const compressed = readSubBlocks(bytes, offset);
    offset = compressed.next;
    const decoded = decodeLzw(compressed.data, minimumCodeSize, frameWidth * frameHeight);
    frames.push({
      left,
      top,
      width: frameWidth,
      height: frameHeight,
      control: pendingControl,
      indices: decoded.indices,
      clearCount: decoded.clearCount,
    });
    pendingControl = null;
  }
  throw new Error("Missing GIF trailer.");
}

function rgba(...pixels: Array<[number, number, number, number?]>): Uint8ClampedArray {
  return new Uint8ClampedArray(
    pixels.flatMap(([red, green, blue, alpha = 255]) => [red, green, blue, alpha]),
  );
}

function paletteColor(palette: Uint8Array, index: number): number[] {
  return [
    byteAt(palette, index * 3),
    byteAt(palette, index * 3 + 1),
    byteAt(palette, index * 3 + 2),
  ];
}

describe("GIF encoder", () => {
  it("writes a decodable GIF89a animation with dimensions, loop, delays and transparency", () => {
    const bytes = encodeGif(
      [
        {
          rgba: rgba([255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]),
          delayMs: 100,
        },
        {
          rgba: rgba([255, 255, 0], [128, 128, 128], [0, 0, 0], [12, 34, 56, 0]),
          delayMs: 260,
        },
      ],
      2,
      2,
      { loop: 3 },
    );

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)).toBe(
      true,
    );
    const parsed = parseGif(bytes);
    expect(parsed.width).toBe(2);
    expect(parsed.height).toBe(2);
    expect(parsed.palette).toHaveLength(256 * 3);
    expect(parsed.loop).toBe(3);
    expect(parsed.graphicControlCount).toBe(2);
    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames.map((frame) => frame.control?.delay)).toEqual([10, 26]);
    expect(parsed.frames.map((frame) => frame.control?.transparent)).toEqual([true, true]);
    expect(parsed.frames.map((frame) => frame.control?.transparentIndex)).toEqual([255, 255]);
    expect(parsed.frames.map((frame) => frame.control?.disposal)).toEqual([2, 2]);
    expect(parsed.frames.map((frame) => frame.indices)).toEqual([
      [180, 30, 5, 254],
      [210, 235, 216, 255],
    ]);
    expect(paletteColor(parsed.palette, 180)).toEqual([255, 0, 0]);
    expect(paletteColor(parsed.palette, 235)).toEqual([128, 128, 128]);
  });

  it("scales frames with nearest-neighbor sampling and defaults to an infinite loop", () => {
    const parsed = parseGif(
      encodeGif(
        [
          {
            rgba: rgba([255, 0, 0], [0, 0, 255]),
            delayMs: 40,
            sourceWidth: 2,
            sourceHeight: 1,
          },
        ],
        4,
        2,
      ),
    );

    expect(parsed.loop).toBe(0);
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]?.indices).toEqual([180, 180, 5, 5, 180, 180, 5, 5]);
  });

  it("encodes through LZW code-width growth and dictionary resets", () => {
    const width = 256;
    const height = 256;
    const pixels = new Uint8ClampedArray(width * height * 4);
    let state = 0x12345678;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      const offset = pixel * 4;
      pixels[offset] = state & 0xff;
      pixels[offset + 1] = (state >>> 8) & 0xff;
      pixels[offset + 2] = (state >>> 16) & 0xff;
      pixels[offset + 3] = 255;
    }

    const parsed = parseGif(encodeGif([{ rgba: pixels, delayMs: 10 }], width, height));
    expect(parsed.frames[0]?.indices).toHaveLength(width * height);
    expect(parsed.frames[0]?.clearCount).toBeGreaterThan(1);
  });

  it("supports opaque output without a transparent index", () => {
    const parsed = parseGif(
      encodeGif([{ rgba: rgba([0, 0, 0, 0]), delayMs: 0 }], 1, 1, {
        transparent: false,
        loop: 1,
      }),
    );
    expect(parsed.loop).toBe(1);
    expect(parsed.frames[0]?.control?.transparent).toBe(false);
    expect(parsed.frames[0]?.control?.transparentIndex).toBe(0);
    expect(parsed.frames[0]?.indices).toEqual([216]);
  });

  it("produces a file accepted by an independent native GIF decoder", async () => {
    const bytes = encodeGif(
      [
        {
          rgba: rgba([255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]),
          delayMs: 100,
        },
      ],
      2,
      2,
    );
    const image = await loadImage(bytes);
    expect(image.naturalWidth).toBe(2);
    expect(image.naturalHeight).toBe(2);
  });

  it("enforces size, frame, delay, loop and input-shape limits", () => {
    const frame: GifFrame = { rgba: rgba([0, 0, 0]), delayMs: 10 };

    expect(GIF_MAX_OUTPUT_DIMENSION).toBeLessThanOrEqual(4_096);
    expect(GIF_MAX_OUTPUT_PIXELS).toBeLessThan(GIF_MAX_OUTPUT_DIMENSION ** 2);
    expect(GIF_MAX_FRAMES).toBeLessThanOrEqual(30);
    expect(GIF_MAX_TOTAL_RGBA_BYTES).toBeLessThan(GIF_MAX_OUTPUT_BYTES);
    expect(() => encodeGif([], 1, 1)).toThrow(/GIF_FRAME_COUNT/);
    expect(() =>
      encodeGif(
        Array.from({ length: GIF_MAX_FRAMES + 1 }, () => frame),
        1,
        1,
      ),
    ).toThrow(/GIF_FRAME_COUNT/);
    expect(() => encodeGif([frame], 0, 1)).toThrow(/GIF_DIMENSION_LIMIT/);
    expect(() => encodeGif([frame], GIF_MAX_OUTPUT_DIMENSION + 1, 1)).toThrow(
      /GIF_DIMENSION_LIMIT/,
    );
    expect(() => encodeGif([frame], GIF_MAX_OUTPUT_DIMENSION, 2_048)).toThrow(/GIF_PIXEL_LIMIT/);
    expect(() => encodeGif([{ rgba: new Uint8ClampedArray(3), delayMs: 10 }], 1, 1)).toThrow(
      /GIF_RGBA_SIZE/,
    );
    expect(() =>
      encodeGif(
        [
          {
            rgba: rgba([0, 0, 0]),
            delayMs: 10,
            sourceWidth: 1,
          },
        ],
        1,
        1,
      ),
    ).toThrow(/GIF_RGBA_SIZE/);
    expect(() =>
      encodeGif(
        [
          {
            rgba: new Uint8ClampedArray(4),
            delayMs: 10,
            sourceWidth: GIF_MAX_SOURCE_DIMENSION + 1,
            sourceHeight: 1,
          },
        ],
        1,
        1,
      ),
    ).toThrow(/GIF_DIMENSION_LIMIT/);
    expect(() => encodeGif([{ ...frame, delayMs: -1 }], 1, 1)).toThrow(/GIF_DELAY_LIMIT/);
    expect(() => encodeGif([frame], 1, 1, { loop: -1 })).toThrow(/GIF_LOOP_LIMIT/);
    expect(() => encodeGif([frame], 1, 1, { loop: 65_536 })).toThrow(/GIF_LOOP_LIMIT/);
    expect(() =>
      encodeGif([frame], 1, 1, {
        transparent: "yes",
      } as unknown as GifEncodeOptions),
    ).toThrow(/GIF_TRANSPARENT_OPTION/);
  });
});
