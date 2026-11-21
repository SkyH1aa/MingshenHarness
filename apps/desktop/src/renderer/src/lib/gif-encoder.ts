import { GIFEncoder } from "gifenc";

export interface GifFrame {
  rgba: Uint8ClampedArray;
  delayMs: number;
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface GifEncodeOptions {
  loop?: number;
  transparent?: boolean;
}

export const GIF_MAX_OUTPUT_DIMENSION = 4_096;
export const GIF_MAX_OUTPUT_PIXELS = 4_194_304;
export const GIF_MAX_SOURCE_DIMENSION = 8_192;
export const GIF_MAX_FRAMES = 30;
export const GIF_MAX_FRAME_DELAY_MS = 655_350;
export const GIF_MAX_TOTAL_RGBA_BYTES = 128 * 1024 * 1024;
export const GIF_MAX_OUTPUT_BYTES = 192 * 1024 * 1024;

function fail(code: string, message: string): never {
  throw new RangeError(`${code}: ${message}`);
}

function dimension(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    fail("GIF_DIMENSION_LIMIT", `Dimensions must be integers from 1 to ${maximum}.`);
  return value;
}

// A stable palette prevents color flicker between adjacent animation frames.
const palette: number[][] = [];
for (let red = 0; red < 6; red += 1)
  for (let green = 0; green < 6; green += 1)
    for (let blue = 0; blue < 6; blue += 1) palette.push([red * 51, green * 51, blue * 51]);
for (let gray = 0; gray < 39; gray += 1) {
  const value = Math.round((gray * 255) / 38);
  palette.push([value, value, value]);
}
palette.push([0, 0, 0]);

function indexFrame(
  frame: GifFrame,
  width: number,
  height: number,
  transparent: boolean,
): Uint8Array {
  const sourceWidth = frame.sourceWidth ?? width;
  const sourceHeight = frame.sourceHeight ?? height;
  const indexed = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height)) * sourceWidth;
    for (let x = 0; x < width; x += 1) {
      const offset = (row + Math.floor((x * sourceWidth) / width)) * 4;
      const red = frame.rgba[offset] ?? 0;
      const green = frame.rgba[offset + 1] ?? 0;
      const blue = frame.rgba[offset + 2] ?? 0;
      indexed[y * width + x] =
        transparent && (frame.rgba[offset + 3] ?? 255) < 128
          ? 255
          : Math.max(red, green, blue) - Math.min(red, green, blue) <= 12
            ? 216 +
              Math.round((Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722) * 38) / 255)
            : (Math.round(red / 51) * 6 + Math.round(green / 51)) * 6 + Math.round(blue / 51);
    }
  }
  return indexed;
}

export function encodeGif(
  frames: readonly GifFrame[],
  width: number,
  height: number,
  options: GifEncodeOptions = {},
): Uint8Array<ArrayBuffer> {
  dimension(width, GIF_MAX_OUTPUT_DIMENSION);
  dimension(height, GIF_MAX_OUTPUT_DIMENSION);
  if (width * height > GIF_MAX_OUTPUT_PIXELS)
    fail("GIF_PIXEL_LIMIT", "Output pixel limit exceeded.");
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > GIF_MAX_FRAMES)
    fail("GIF_FRAME_COUNT", `Provide 1 to ${GIF_MAX_FRAMES} frames.`);
  const loop = options.loop ?? 0;
  if (!Number.isSafeInteger(loop) || loop < 0 || loop > 65_535)
    fail("GIF_LOOP_LIMIT", "The loop count must be an integer from 0 to 65535.");
  const transparent = options.transparent ?? true;
  if (typeof transparent !== "boolean") fail("GIF_TRANSPARENT_OPTION", "Expected a boolean.");
  // 12-bit LZW, sub-blocks and metadata fit within this conservative bound.
  if (width * height * frames.length * 2 + frames.length * 2_048 > GIF_MAX_OUTPUT_BYTES)
    fail("GIF_MEMORY_LIMIT", "Scaled animation exceeds the encoded output budget.");
  let totalBytes = 0;
  for (const frame of frames) {
    if (!frame || !(frame.rgba instanceof Uint8ClampedArray))
      fail("GIF_RGBA_SIZE", "Each frame requires RGBA pixel data.");
    if ((frame.sourceWidth === undefined) !== (frame.sourceHeight === undefined))
      fail("GIF_RGBA_SIZE", "Provide both source dimensions.");
    const sourceWidth = dimension(frame.sourceWidth ?? width, GIF_MAX_SOURCE_DIMENSION);
    const sourceHeight = dimension(frame.sourceHeight ?? height, GIF_MAX_SOURCE_DIMENSION);
    if (frame.rgba.byteLength !== sourceWidth * sourceHeight * 4)
      fail("GIF_RGBA_SIZE", "Pixel data does not match its source dimensions.");
    totalBytes += frame.rgba.byteLength;
    if (totalBytes > GIF_MAX_TOTAL_RGBA_BYTES)
      fail("GIF_MEMORY_LIMIT", "Input pixel budget exceeded.");
    if (
      !Number.isFinite(frame.delayMs) ||
      frame.delayMs < 0 ||
      frame.delayMs > GIF_MAX_FRAME_DELAY_MS
    )
      fail("GIF_DELAY_LIMIT", "Frame delay is outside the supported range.");
  }

  const encoder = GIFEncoder();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (!frame) continue;
    encoder.writeFrame(indexFrame(frame, width, height, transparent), width, height, {
      ...(index === 0 ? { palette } : {}),
      delay: frame.delayMs === 0 ? 0 : Math.max(10, Math.round(frame.delayMs / 10) * 10),
      repeat: loop,
      transparent,
      transparentIndex: transparent ? 255 : 0,
      dispose: transparent ? 2 : 1,
    });
    if (encoder.bytesView().byteLength > GIF_MAX_OUTPUT_BYTES)
      fail("GIF_MEMORY_LIMIT", "Encoded output budget exceeded.");
  }
  encoder.finish();
  return Uint8Array.from(encoder.bytesView());
}
