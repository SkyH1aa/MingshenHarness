#!/usr/bin/env node

/**
 * Prepare the supplied companion artwork for the transparent companion window.
 *
 * The source artwork uses a solid near-black backdrop. We remove only the
 * connected backdrop pixels, rather than globally keying a colour, so dark
 * clothing remains intact. The script is intentionally deterministic and
 * takes explicit input/output paths so the source image never becomes a
 * runtime dependency.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

(async () => {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: prepare-companion-asset.cjs <input.png> <output.png>");
    process.exit(2);
  }

  const source = path.resolve(input);
  const target = path.resolve(output);
  const { data: pixels, info } = await sharp(source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const width = info.width;
const height = info.height;
const channels = info.channels;
const pixelCount = width * height;

// Use a small corner sample to avoid a stray edge pixel influencing the key.
const cornerSamples = [];
for (const [x0, y0] of [
  [0, 0],
  [width - 1, 0],
  [0, height - 1],
  [width - 1, height - 1],
]) {
  for (let dy = 0; dy < 8; dy += 1) {
    for (let dx = 0; dx < 8; dx += 1) {
      const x = Math.min(width - 1, Math.max(0, x0 === 0 ? dx : x0 - dx));
      const y = Math.min(height - 1, Math.max(0, y0 === 0 ? dy : y0 - dy));
      const offset = (y * width + x) * channels;
      cornerSamples.push([pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
    }
  }
}

const background = cornerSamples
  .reduce(
    (sum, sample) => [sum[0] + sample[0], sum[1] + sample[1], sum[2] + sample[2]],
    [0, 0, 0],
  )
  .map((value) => Math.round(value / cornerSamples.length));

// The key is deliberately conservative. The source background is near-black,
// while the character's dark fabric is separated from it by a visible edge.
const keyThreshold = 19;
const backgroundMask = new Uint8Array(pixelCount);
const visited = new Uint8Array(pixelCount);
const queue = new Int32Array(pixelCount);
let queueHead = 0;
let queueTail = 0;

function distanceAt(index) {
  const offset = index * channels;
  return Math.hypot(
    pixels[offset] - background[0],
    pixels[offset + 1] - background[1],
    pixels[offset + 2] - background[2],
  );
}

function enqueue(index) {
  if (visited[index] || distanceAt(index) > keyThreshold) return;
  visited[index] = 1;
  queue[queueTail] = index;
  queueTail += 1;
}

for (let x = 0; x < width; x += 1) {
  enqueue(x);
  enqueue((height - 1) * width + x);
}
for (let y = 1; y < height - 1; y += 1) {
  enqueue(y * width);
  enqueue(y * width + width - 1);
}

while (queueHead < queueTail) {
  const index = queue[queueHead];
  queueHead += 1;
  backgroundMask[index] = 1;
  const x = index % width;
  const y = (index - x) / width;
  if (x > 0) enqueue(index - 1);
  if (x + 1 < width) enqueue(index + 1);
  if (y > 0) enqueue(index - width);
  if (y + 1 < height) enqueue(index + width);
}

let minX = width;
let minY = height;
let maxX = -1;
let maxY = -1;
for (let index = 0; index < pixelCount; index += 1) {
  const offset = index * channels;
  if (backgroundMask[index]) {
    pixels[offset + 3] = 0;
    continue;
  }
  minX = Math.min(minX, index % width);
  minY = Math.min(minY, Math.floor(index / width));
  maxX = Math.max(maxX, index % width);
  maxY = Math.max(maxY, Math.floor(index / width));
}

if (maxX < minX || maxY < minY) {
  throw new Error("The source artwork became fully transparent during backdrop removal");
}

// Keep a modest breathing room around the character for the renderer's glow
// and pointer interaction, while avoiding a large transparent hit area.
const padding = 26;
const left = Math.max(0, minX - padding);
const top = Math.max(0, minY - padding);
const right = Math.min(width - 1, maxX + padding);
const bottom = Math.min(height - 1, maxY + padding);
const cropped = Buffer.alloc((right - left + 1) * (bottom - top + 1) * channels);
for (let y = top; y <= bottom; y += 1) {
  const sourceOffset = (y * width + left) * channels;
  const destinationOffset = (y - top) * (right - left + 1) * channels;
  pixels.copy(cropped, destinationOffset, sourceOffset, sourceOffset + (right - left + 1) * channels);
}

await fs.mkdir(path.dirname(target), { recursive: true });
await sharp(cropped, {
  raw: {
    width: right - left + 1,
    height: bottom - top + 1,
    channels,
  },
})
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(target);

  console.log(
    JSON.stringify(
      {
        source,
        target,
        background,
        bounds: { left, top, right, bottom },
        width: right - left + 1,
        height: bottom - top + 1,
        transparentPixels: backgroundMask.reduce((count, value) => count + value, 0),
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
