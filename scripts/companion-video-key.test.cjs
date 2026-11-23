"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { isRedBackdrop, removeBackdrop, removeKnownGroundDebris, bleedTransparentEdgeColors } = require("./companion-video-key.cjs");

const groundSource = "523215fc123b00df6b8bb63108313a2a7f75a7182c99bbe366bb0b685e4cc272";

function image(width, height, color) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) pixels.set([...color, 255], i * 4);
  return pixels;
}

function put(pixels, width, x, y, color) {
  pixels.set([...color, 255], (y * width + x) * 4);
}

function pixel(pixels, width, x, y) {
  return Array.from(pixels.slice((y * width + x) * 4, (y * width + x + 1) * 4));
}

function transparentImage(width, height, color) {
  const pixels = image(width, height, color);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
  return pixels;
}

function stamp(pixels, width, left, top, right, bottom, color) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) put(pixels, width, x, y, color);
  }
}

function groundFixture() {
  const width = 720;
  const height = 720;
  const raw = image(width, height, [211, 126, 122]);
  const keyed = transparentImage(width, height, [211, 126, 122]);
  stamp(keyed, width, 300, 500, 399, 699, [18, 23, 27]);
  stamp(raw, width, 200, 656, 207, 672, [209, 135, 130]);
  stamp(keyed, width, 200, 656, 207, 672, [209, 135, 130]);
  return { raw, keyed, width, height };
}

const groundProvenance = { sourceNumber: 33, sourceSha256: groundSource };

test("classifies sampled red backdrops without classifying skin or cyan clothing", () => {
  assert.equal(isRedBackdrop(205, 108, 107), true);
  assert.equal(isRedBackdrop(180, 88, 103), true);
  assert.equal(isRedBackdrop(220, 177, 171), false);
  assert.equal(isRedBackdrop(48, 172, 185), false);
  assert.equal(isRedBackdrop(18, 23, 27), false);
});

test("removes connected gradient backgrounds and retains enclosed red detail", () => {
  const width = 15;
  const height = 15;
  const pixels = image(width, height, [205, 108, 107]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > 7) put(pixels, width, x, y, [180, 88, 103]);
    }
  }
  for (let y = 4; y <= 10; y += 1) {
    for (let x = 4; x <= 10; x += 1) put(pixels, width, x, y, [18, 23, 27]);
  }
  put(pixels, width, 7, 7, [205, 108, 107]);
  const stats = removeBackdrop(pixels, width, height);
  assert.ok(stats.removed > 100);
  assert.equal(pixel(pixels, width, 1, 1)[3], 0);
  assert.equal(pixel(pixels, width, 13, 13)[3], 0);
  assert.deepEqual(pixel(pixels, width, 7, 7), [205, 108, 107, 255]);
  assert.deepEqual(pixel(pixels, width, 6, 7), [18, 23, 27, 255]);
});

test("preserves a warm hand and cyan garment while removing adjacent connected red", () => {
  const width = 15;
  const pixels = image(width, 15, [205, 108, 107]);
  for (let y = 4; y <= 10; y += 1) {
    for (let x = 5; x <= 10; x += 1) put(pixels, width, x, y, [18, 23, 27]);
  }
  for (let y = 6; y <= 8; y += 1) {
    for (let x = 2; x <= 6; x += 1) put(pixels, width, x, y, [220, 177, 171]);
  }
  put(pixels, width, 8, 7, [48, 172, 185]);
  removeBackdrop(pixels, width, 15);
  assert.equal(pixel(pixels, width, 2, 5)[3], 0);
  assert.ok(pixel(pixels, width, 2, 7)[3] > 0);
  assert.deepEqual(pixel(pixels, width, 4, 7), [220, 177, 171, 255]);
  assert.deepEqual(pixel(pixels, width, 8, 7), [48, 172, 185, 255]);
});

test("preserves bright pink skin at the red-screen boundary without retaining nearby backdrop", () => {
  const width = 15;
  const pixels = image(width, width, [211, 145, 150]);
  stamp(pixels, width, 5, 5, 10, 10, [18, 23, 27]);
  put(pixels, width, 4, 6, [255, 204, 207]);
  put(pixels, width, 4, 7, [250, 190, 197]);
  assert.equal(isRedBackdrop(255, 204, 207), true);
  assert.equal(isRedBackdrop(211, 145, 150), true);

  const stats = removeBackdrop(pixels, width, width);

  assert.ok(stats.removed > 0);
  assert.deepEqual(pixel(pixels, width, 3, 6), [211, 145, 150, 0]);
  assert.deepEqual(pixel(pixels, width, 4, 6), [255, 204, 207, 255]);
  assert.deepEqual(pixel(pixels, width, 4, 7), [250, 190, 197, 255]);
});

test("does not feather lower-brightness warm skin beside a removed backdrop", () => {
  const width = 30;
  const pixels = image(width, width, [205, 108, 107]);
  stamp(pixels, width, 1, 1, width - 2, width - 2, [18, 23, 27]);
  put(pixels, width, 1, 15, [190, 170, 150]);

  removeBackdrop(pixels, width, width);

  assert.deepEqual(pixel(pixels, width, 1, 15), [190, 170, 150, 255]);
  assert.equal(pixel(pixels, width, 0, 15)[3], 0);
});

test("removes a large screen-colored island near the exterior while retaining skin and fingers", () => {
  const width = 70;
  const pixels = image(width, width, [192, 79, 114]);
  for (let y = 10; y < 60; y += 1) {
    for (let x = 10; x < 60; x += 1) put(pixels, width, x, y, [18, 23, 27]);
  }
  for (let y = 20; y < 30; y += 1) {
    for (let x = 12; x < 22; x += 1) put(pixels, width, x, y, [175, 85, 110]);
  }
  for (let y = 14; y < 24; y += 1) {
    for (let x = 24; x < 28; x += 1) put(pixels, width, x, y, [220, 177, 171]);
  }
  const stats = removeBackdrop(pixels, width, width);
  assert.equal(stats.removedIslands, 1);
  assert.equal(pixel(pixels, width, 16, 24)[3], 0);
  assert.deepEqual(pixel(pixels, width, 25, 18), [220, 177, 171, 255]);
  assert.deepEqual(pixel(pixels, width, 33, 33), [18, 23, 27, 255]);
});

test("excludes protected warm skin from enclosed screen-island removal", () => {
  const width = 100;
  const pixels = image(width, width, [192, 130, 143]);
  stamp(pixels, width, 2, 2, width - 3, width - 3, [18, 23, 27]);
  stamp(pixels, width, 4, 40, 13, 49, [220, 160, 170]);

  const stats = removeBackdrop(pixels, width, width);

  assert.equal(stats.removedIslands, 0);
  assert.deepEqual(pixel(pixels, width, 8, 44), [220, 160, 170, 255]);
  assert.deepEqual(pixel(pixels, width, 30, 30), [18, 23, 27, 255]);
});

test("retains small warm details and screen-colored details far inside the character", () => {
  const width = 100;
  const pixels = image(width, width, [192, 79, 114]);
  for (let y = 5; y < 95; y += 1) {
    for (let x = 5; x < 95; x += 1) put(pixels, width, x, y, [18, 23, 27]);
  }
  for (let y = 40; y < 50; y += 1) {
    for (let x = 40; x < 50; x += 1) put(pixels, width, x, y, [192, 79, 114]);
  }
  for (let y = 20; y < 24; y += 1) {
    for (let x = 7; x < 11; x += 1) put(pixels, width, x, y, [192, 79, 114]);
  }
  const stats = removeBackdrop(pixels, width, width);
  assert.equal(stats.removedIslands, 0);
  assert.deepEqual(pixel(pixels, width, 45, 45), [192, 79, 114, 255]);
  assert.deepEqual(pixel(pixels, width, 8, 21), [192, 79, 114, 255]);
});

test("finds a broad background gap even when a thicker foreground contour encloses it", () => {
  const width = 100;
  const pixels = image(width, width, [192, 79, 114]);
  for (let y = 5; y < 95; y += 1) {
    for (let x = 5; x < 95; x += 1) put(pixels, width, x, y, [18, 23, 27]);
  }
  for (let y = 30; y < 45; y += 1) {
    for (let x = 15; x < 30; x += 1) put(pixels, width, x, y, [175, 85, 110]);
  }
  const stats = removeBackdrop(pixels, width, width);
  assert.equal(stats.removedIslands, 1);
  assert.equal(pixel(pixels, width, 22, 36)[3], 0);
  assert.deepEqual(pixel(pixels, width, 50, 50), [18, 23, 27, 255]);
});

test("does not infer enclosed background from an unrepresentative frame border", () => {
  const width = 30;
  const pixels = image(width, width, [18, 23, 27]);
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) put(pixels, width, x, y, [192, 79, 114]);
  }
  for (let y = 14; y < 24; y += 1) {
    for (let x = 14; x < 24; x += 1) put(pixels, width, x, y, [192, 79, 114]);
  }
  const stats = removeBackdrop(pixels, width, width);
  assert.equal(stats.removedIslands, 0);
  assert.deepEqual(pixel(pixels, width, 18, 18), [192, 79, 114, 255]);
});

test("rejects incomplete RGBA data and invalid dimensions", () => {
  assert.throws(() => removeBackdrop(new Uint8Array(3), 1, 1), /RGBA/);
  assert.throws(() => removeBackdrop(new Uint8Array(4), 0, 1), /RGBA/);
  assert.throws(() => removeBackdrop(new Uint8Array(4), -1, -1), /RGBA/);
  assert.throws(() => removeBackdrop(new Uint8Array(4), 0.5, 2), /RGBA/);
  assert.throws(() => removeBackdrop(new Uint8Array(4), Number.NaN, 1), /RGBA/);
});

test("independent identical frames receive identical fixed-pixel results", () => {
  const first = image(4, 4, [205, 108, 107]);
  put(first, 4, 2, 2, [48, 172, 185]);
  const second = first.slice();
  removeBackdrop(first, 4, 4);
  removeBackdrop(second, 4, 4);
  assert.deepEqual(first, second);
});

test("removes only the small source-matched red ground island inside the protected ROI", () => {
  const { raw, keyed, width, height } = groundFixture();
  const before = keyed.slice();
  const result = removeKnownGroundDebris(keyed, raw, width, height, groundProvenance);
  assert.equal(result.removedPixels, 136);
  assert.equal(result.removedComponents.length, 1);
  assert.deepEqual(result.removedComponents[0].bounds, [200, 656, 207, 672]);
  assert.ok(result.removedComponents[0].screenMatchRatio >= 0.9);
  for (let index = 0; index < keyed.length; index += 1) {
    const pixelIndex = Math.floor(index / 4);
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (index % 4 === 3 && x >= 200 && x <= 207 && y >= 656 && y <= 672) continue;
    assert.equal(keyed[index], before[index]);
  }
  assert.equal(pixel(keyed, width, 203, 660)[3], 0);
  assert.equal(pixel(keyed, width, 320, 540)[3], 255);
});

test("leaves a 257-pixel screen-colored component untouched", () => {
  const { raw, keyed, width, height } = groundFixture();
  stamp(raw, width, 180, 640, 195, 655, [209, 135, 130]);
  stamp(keyed, width, 180, 640, 195, 655, [209, 135, 130]);
  put(raw, width, 196, 655, [209, 135, 130]);
  put(keyed, width, 196, 655, [209, 135, 130]);
  const result = removeKnownGroundDebris(keyed, raw, width, height, groundProvenance);
  assert.equal(result.removedPixels, 136);
  for (let y = 640; y <= 655; y += 1) {
    for (let x = 180; x <= 195; x += 1) assert.equal(pixel(keyed, width, x, y)[3], 255);
  }
  assert.equal(pixel(keyed, width, 196, 655)[3], 255);
  assert.equal(pixel(keyed, width, 203, 660)[3], 0);
});

test("preserves warm skin, a non-background red prop, and debris touching character pixels", () => {
  const { raw, keyed, width, height } = groundFixture();
  stamp(raw, width, 180, 660, 187, 667, [220, 177, 171]);
  stamp(keyed, width, 180, 660, 187, 667, [220, 177, 171]);
  stamp(raw, width, 190, 680, 197, 687, [180, 55, 92]);
  stamp(keyed, width, 190, 680, 197, 687, [180, 55, 92]);
  stamp(raw, width, 210, 640, 270, 699, [18, 23, 27]);
  stamp(keyed, width, 210, 640, 270, 699, [18, 23, 27]);
  const before = keyed.slice();
  const result = removeKnownGroundDebris(keyed, raw, width, height, groundProvenance);
  assert.equal(result.removedPixels, 0);
  assert.deepEqual(keyed, before);
});

test("requires the whole component to remain inside the evidenced bottom-left ROI", () => {
  const { raw, keyed, width, height } = groundFixture();
  for (let y = 656; y <= 672; y += 1) {
    for (let x = 200; x <= 207; x += 1) keyed[(y * width + x) * 4 + 3] = 0;
  }
  stamp(raw, width, 200, 635, 207, 651, [209, 135, 130]);
  stamp(keyed, width, 200, 635, 207, 651, [209, 135, 130]);
  stamp(raw, width, 230, 656, 237, 672, [209, 135, 130]);
  stamp(keyed, width, 230, 656, 237, 672, [209, 135, 130]);
  const before = keyed.slice();
  const result = removeKnownGroundDebris(keyed, raw, width, height, groundProvenance);
  assert.equal(result.removedPixels, 0);
  assert.deepEqual(keyed, before);
});

test("requires the exact source identity, clip number, and dimensions", () => {
  const { raw, keyed, width, height } = groundFixture();
  const before = keyed.slice();
  for (const provenance of [
    { sourceNumber: 32, sourceSha256: groundSource },
    { sourceNumber: 33, sourceSha256: "0".repeat(64) },
  ]) {
    assert.deepEqual(removeKnownGroundDebris(keyed, raw, width, height, provenance), {
      removedComponents: [], removedPixels: 0,
    });
    assert.deepEqual(keyed, before);
  }
  assert.deepEqual(removeKnownGroundDebris(keyed, raw, width - 1, height, groundProvenance), {
    removedComponents: [], removedPixels: 0,
  });
  assert.deepEqual(keyed, before);
});

function tinyGroundFixture(characterBottom = 699) {
  const width = 720;
  const height = 720;
  const raw = image(width, height, [214, 133, 131]);
  const keyed = transparentImage(width, height, [214, 133, 131]);
  stamp(raw, width, 300, 500, 320, characterBottom, [18, 23, 27]);
  stamp(keyed, width, 300, 500, 320, characterBottom, [18, 23, 27]);
  return { raw, keyed, width, height };
}

test("removes source-matched 56, 40 and 21-pixel foot specks without changing character or RGB", () => {
  const { raw, keyed, width, height } = tinyGroundFixture();
  const patches = [[336, 632, 342, 639], [475, 632, 479, 639], [433, 677, 439, 679]];
  for (const [x, y, right, bottom] of patches) {
    stamp(raw, width, x, y, right, bottom, [210, 136, 131]);
    stamp(keyed, width, x, y, right, bottom, [210, 136, 131]);
  }
  const before = keyed.slice();
  const result = removeKnownGroundDebris(keyed, raw, width, height, groundProvenance);
  assert.equal(result.removedPixels, 117);
  assert.deepEqual(result.removedComponents.map((entry) => entry.area), [56, 40, 21]);
  for (let offset = 0; offset < keyed.length; offset += 4) {
    assert.deepEqual(keyed.subarray(offset, offset + 3), before.subarray(offset, offset + 3));
    if (before[offset + 3] !== keyed[offset + 3]) assert.equal(keyed[offset + 3], 0);
  }
  assert.deepEqual(pixel(keyed, width, 310, 635), [18, 23, 27, 255]);
});

test("tiny specks require every pixel to match the local red screen and reject warm or colored details", () => {
  const { raw, keyed, width, height } = tinyGroundFixture();
  const protectedColors = [[48, 172, 185], [18, 23, 27], [140, 140, 140], [255, 204, 207], [250, 180, 175], [190, 170, 150], [180, 55, 92]];
  for (const [index, color] of protectedColors.entries()) {
    const x = 350 + index * 20;
    stamp(raw, width, x, 640, x + 3, 643, [210, 136, 131]);
    stamp(keyed, width, x, 640, x + 3, 643, [210, 136, 131]);
    put(raw, width, x, 640, color);
    put(keyed, width, x, 640, color);
  }
  const before = keyed.slice();
  assert.equal(removeKnownGroundDebris(keyed, raw, width, height, groundProvenance).removedPixels, 0);
  assert.deepEqual(keyed, before);
});

test("tiny cleanup preserves a diagonal shoe connection while clearing an isolated nearby screen-only island", () => {
  const { raw, keyed, width, height } = tinyGroundFixture(629);
  stamp(raw, width, 321, 630, 327, 637, [210, 136, 131]);
  stamp(keyed, width, 321, 630, 327, 637, [210, 136, 131]);
  stamp(raw, width, 317, 632, 318, 639, [210, 136, 131]);
  stamp(keyed, width, 317, 632, 318, 639, [210, 136, 131]);
  const before = keyed.slice();
  assert.equal(removeKnownGroundDebris(keyed, raw, width, height, groundProvenance).removedPixels, 16);
  for (let y = 630; y <= 637; y += 1) for (let x = 321; x <= 327; x += 1) {
    assert.equal(pixel(keyed, width, x, y)[3], before[(y * width + x) * 4 + 3]);
  }
  assert.equal(pixel(keyed, width, 317, 638)[3], 0);
});

test("tiny cleanup requires the whole component inside its foot ROI and at most 63 pixels", () => {
  const { raw, keyed, width, height } = tinyGroundFixture();
  for (const [left, top, right, bottom] of [[179, 650, 182, 653], [538, 650, 541, 653], [350, 619, 353, 622], [350, 698, 353, 701], [400, 640, 407, 647]]) {
    stamp(raw, width, left, top, right, bottom, [210, 136, 131]);
    stamp(keyed, width, left, top, right, bottom, [210, 136, 131]);
  }
  const before = keyed.slice();
  assert.equal(removeKnownGroundDebris(keyed, raw, width, height, groundProvenance).removedPixels, 0);
  assert.deepEqual(keyed, before);
});

test("tiny cleanup accepts a three-pixel gap but does not use opaque red neighbors as background evidence", () => {
  const { raw, keyed, width, height } = tinyGroundFixture();
  stamp(raw, width, 323, 640, 326, 643, [210, 136, 131]);
  stamp(keyed, width, 323, 640, 326, 643, [210, 136, 131]);
  assert.equal(removeKnownGroundDebris(keyed, raw, width, height, groundProvenance).removedPixels, 16);
  assert.equal(pixel(keyed, width, 323, 640)[3], 0);
  const second = tinyGroundFixture();
  stamp(second.raw, width, 350, 650, 353, 653, [210, 136, 131]);
  stamp(second.keyed, width, 350, 650, 353, 653, [210, 136, 131]);
  stamp(second.raw, width, 344, 644, 359, 659, [18, 23, 27]);
  stamp(second.raw, width, 350, 650, 353, 653, [210, 136, 131]);
  assert.equal(removeKnownGroundDebris(second.keyed, second.raw, width, height, groundProvenance).removedPixels, 0);
});

test("a low-alpha diagonal bridge still connects tiny red to the character and protects it", () => {
  const { raw, keyed, width, height } = tinyGroundFixture(629);
  stamp(raw, width, 321, 630, 327, 637, [210, 136, 131]);
  stamp(keyed, width, 321, 630, 327, 637, [210, 136, 131]);
  put(keyed, width, 321, 630, [210, 136, 131]);
  keyed[(630 * width + 321) * 4 + 3] = 1;
  assert.equal(removeKnownGroundDebris(keyed, raw, width, height, groundProvenance).removedPixels, 0);
  assert.equal(pixel(keyed, width, 321, 630)[3], 1);
});

test("tiny cleanup accepts a local screen difference of 14 but preserves any pixel with a 15-channel difference", () => {
  const { raw, keyed, width, height } = tinyGroundFixture();
  stamp(raw, width, 350, 640, 353, 643, [200, 133, 131]);
  stamp(keyed, width, 350, 640, 353, 643, [200, 133, 131]);
  stamp(raw, width, 380, 640, 383, 643, [210, 136, 131]);
  stamp(keyed, width, 380, 640, 383, 643, [210, 136, 131]);
  put(raw, width, 380, 640, [199, 133, 131]);
  put(keyed, width, 380, 640, [199, 133, 131]);
  const before = keyed.slice();
  assert.equal(removeKnownGroundDebris(keyed, raw, width, height, groundProvenance).removedPixels, 16);
  assert.equal(pixel(keyed, width, 350, 640)[3], 0);
  for (let y = 640; y <= 643; y += 1) for (let x = 380; x <= 383; x += 1) {
    assert.deepEqual(pixel(keyed, width, x, y), pixel(before, width, x, y));
  }
});

test("transparent RGB bleed preserves every alpha and every nonzero-alpha RGBA including skin and red props", () => {
  const width = 13;
  const pixels = transparentImage(width, width, [205, 108, 107]);
  for (const [x, color, alpha] of [[3, [250, 180, 175], 255], [6, [180, 55, 92], 144], [9, [18, 23, 27], 1]]) {
    put(pixels, width, x, 6, color);
    pixels[(6 * width + x) * 4 + 3] = alpha;
  }
  const before = pixels.slice();
  assert.ok(bleedTransparentEdgeColors(pixels, width, width).changedPixels > 0);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    assert.equal(pixels[offset + 3], before[offset + 3]);
    if (before[offset + 3] > 0) assert.deepEqual(pixels.subarray(offset, offset + 4), before.subarray(offset, offset + 4));
    for (const background of [[255, 255, 255], [17, 24, 32], [35, 170, 200]]) {
      for (let channel = 0; channel < 3; channel += 1) {
        const alpha = before[offset + 3] / 255;
        assert.equal(pixels[offset + channel] * alpha + background[channel] * (1 - alpha),
          before[offset + channel] * alpha + background[channel] * (1 - alpha));
      }
    }
  }
});

test("transparent RGB bleed is bounded, uses the closest nonzero-alpha edge color, and handles diagonal pixels", () => {
  const pixels = transparentImage(11, 11, [205, 108, 107]);
  put(pixels, 11, 5, 5, [48, 172, 185]);
  const result = bleedTransparentEdgeColors(pixels, 11, 11, 2);
  assert.equal(result.changedPixels, 24);
  assert.deepEqual(pixel(pixels, 11, 3, 3), [48, 172, 185, 0]);
  assert.deepEqual(pixel(pixels, 11, 2, 5), [205, 108, 107, 0]);
  assert.deepEqual(pixel(pixels, 11, 5, 5), [48, 172, 185, 255]);
});

test("transparent RGB bleed leaves fully opaque and fully transparent frames untouched and validates limits", () => {
  for (const pixels of [image(3, 3, [250, 180, 175]), transparentImage(3, 3, [205, 108, 107])]) {
    const before = pixels.slice();
    assert.equal(bleedTransparentEdgeColors(pixels, 3, 3).changedPixels, 0);
    assert.deepEqual(pixels, before);
  }
  for (const radius of [0, -1, 17, 1.5, NaN]) assert.throws(() => bleedTransparentEdgeColors(new Uint8Array(4), 1, 1, radius), /RGBA.*radius/);
  assert.throws(() => bleedTransparentEdgeColors(new Uint8Array(3), 1, 1), /RGBA/);
});
