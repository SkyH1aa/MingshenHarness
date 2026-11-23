"use strict";

const KNOWN_GROUND_SOURCE = "523215fc123b00df6b8bb63108313a2a7f75a7182c99bbe366bb0b685e4cc272";

function median(values) {
  if (!values.length) return NaN;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function isScreenRed(r, g, b) {
  return r - g >= 65 && r - b >= 40 && g - b <= 11;
}

function isWarmSkin(r, g, b) {
  return r >= 220 && g >= 160 && b >= 155 && Math.abs(g - b) <= 18;
}

function removeKnownGroundDebris(pixels, originalPixels, width, height, provenance = {}) {
  if (
    provenance.sourceNumber !== 33 || provenance.sourceSha256 !== KNOWN_GROUND_SOURCE ||
    width !== 720 || height !== 720 || pixels.length !== width * height * 4 ||
    !originalPixels || originalPixels.length !== pixels.length
  ) return { removedComponents: [], removedPixels: 0 };

  const count = width * height;
  const labels = new Uint32Array(count);
  const queue = new Int32Array(count);
  const components = [];
  const largeForeground = new Uint8Array(count);
  let nextLabel = 1;

  for (let start = 0; start < count; start += 1) {
    if (pixels[start * 4 + 3] === 0 || labels[start] !== 0) continue;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    const label = nextLabel++;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const neighbor = yy * width + xx;
          if (labels[neighbor] !== 0 || pixels[neighbor * 4 + 3] === 0) continue;
          labels[neighbor] = label;
          queue[tail++] = neighbor;
        }
      }
    }
    if (tail > 256) {
      for (let i = 0; i < tail; i += 1) largeForeground[queue[i]] = 1;
    } else {
      components.push({ label, area: tail, minX, minY, maxX, maxY, indices: queue.slice(0, tail) });
    }
  }

  const removedComponents = [];
  let removedPixels = 0;
  for (const component of components) {
    const tinyDebris = component.area < 64;
    if (component.minX < 180 || component.maxX > (tinyDebris ? 540 : 235) ||
        component.minY < (tinyDebris ? 620 : 640) || component.maxY > (tinyDebris ? 700 : 719)) continue;

    let protectedByCharacter = false;
    const protectionRadius = tinyDebris ? 0 : 3;
    for (const index of component.indices) {
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -protectionRadius; dy <= protectionRadius && !protectedByCharacter; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -protectionRadius; dx <= protectionRadius; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && largeForeground[yy * width + xx] !== 0) {
            protectedByCharacter = true;
            break;
          }
        }
      }
      if (protectedByCharacter) break;
    }
    if (protectedByCharacter) continue;

    const ring = { r: [], g: [], b: [] };
    const ringMinX = Math.max(0, component.minX - 6);
    const ringMaxX = Math.min(width - 1, component.maxX + 6);
    const ringMinY = Math.max(0, component.minY - 6);
    const ringMaxY = Math.min(height - 1, component.maxY + 6);
    for (let y = ringMinY; y <= ringMaxY; y += 1) {
      for (let x = ringMinX; x <= ringMaxX; x += 1) {
        if (x >= component.minX && x <= component.maxX && y >= component.minY && y <= component.maxY) continue;
        const offset = (y * width + x) * 4;
        const r = originalPixels[offset];
        const g = originalPixels[offset + 1];
        const b = originalPixels[offset + 2];
        if (!isScreenRed(r, g, b) || (tinyDebris && pixels[offset + 3] !== 0)) continue;
        ring.r.push(r);
        ring.g.push(g);
        ring.b.push(b);
      }
    }
    if (ring.r.length < 24) continue;
    const background = [median(ring.r), median(ring.g), median(ring.b)];
    let screenMatches = 0;
    for (const index of component.indices) {
      const offset = index * 4;
      const r = originalPixels[offset];
      const g = originalPixels[offset + 1];
      const b = originalPixels[offset + 2];
      const warmSkin = g - b > 11 && r >= 145 && g >= 110;
      if (
        !warmSkin && !isWarmSkin(r, g, b) && isScreenRed(r, g, b) &&
        Math.abs(r - background[0]) <= (tinyDebris ? 14 : 28) &&
        Math.abs(g - background[1]) <= (tinyDebris ? 14 : 24) &&
        Math.abs(b - background[2]) <= (tinyDebris ? 14 : 24)
      ) screenMatches += 1;
    }
    // Tiny detached specks need an exact local-screen match; one clothing,
    // accessory or skin pixel protects the entire component.
    if (screenMatches < component.area * (tinyDebris ? 1 : 0.9)) continue;

    for (const index of component.indices) pixels[index * 4 + 3] = 0;
    removedPixels += component.area;
    removedComponents.push({
      area: component.area,
      bounds: [component.minX, component.minY, component.maxX, component.maxY],
      screenMatchRatio: Number((screenMatches / component.area).toFixed(4)),
    });
  }
  return { removedComponents, removedPixels };
}

// Pink skin inside the character must not be erased just because it is warm.
function isRedBackdrop(r, g, b) {
  const warmSkin = r >= 165 && g >= 135 && g - b >= 4;
  return !warmSkin && r >= 65 && r - g >= 18 && r - b >= 12 && b - g >= -13 && r >= g * 1.16;
}

function removeBackdrop(pixels, width, height) {
  const count = width * height;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(count) || count <= 0 || pixels.length !== count * 4) {
    throw new Error("Expected a complete RGBA frame");
  }

  const mask = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  let borderCount = 0;
  let borderR = 0;
  let borderG = 0;
  let borderB = 0;

  function enqueue(index) {
    if (mask[index] !== 0) return;
    const offset = index * 4;
    if (
      !isRedBackdrop(pixels[offset], pixels[offset + 1], pixels[offset + 2]) ||
      isWarmSkin(pixels[offset], pixels[offset + 1], pixels[offset + 2])
    )
      return;
    mask[index] = 1;
    queue[tail++] = index;
  }

  function sampleBorder(index) {
    const offset = index * 4;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    if (!isRedBackdrop(r, g, b)) return;
    borderCount += 1;
    borderR += r;
    borderG += g;
    borderB += b;
    enqueue(index);
  }

  for (let x = 0; x < width; x += 1) {
    sampleBorder(x);
    if (height > 1) sampleBorder((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sampleBorder(y * width);
    if (width > 1) sampleBorder(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index + width < count) enqueue(index + width);
  }

  let removed = tail;
  let removedIslands = 0;
  const perimeter = width === 1 ? height : height === 1 ? width : 2 * width + 2 * height - 4;
  // Only use a representative red screen to identify enclosed regions. A
  // region also needs sufficient area and proximity to the exterior: small
  // warm details and isolated fingers must not be treated as background.
  if (borderCount >= perimeter * 0.8) {
    const background = [borderR / borderCount, borderG / borderCount, borderB / borderCount];
    const exterior = mask.slice();
    for (let start = 0; start < count; start += 1) {
      if (mask[start]) continue;
      const offset = start * 4;
      if (
        !isRedBackdrop(pixels[offset], pixels[offset + 1], pixels[offset + 2]) ||
        isWarmSkin(pixels[offset], pixels[offset + 1], pixels[offset + 2])
      ) continue;

      let componentHead = 0;
      let componentTail = 0;
      let similar = 0;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      function visit(index) {
        if (mask[index]) return;
        const p = index * 4;
        if (
          !isRedBackdrop(pixels[p], pixels[p + 1], pixels[p + 2]) ||
          isWarmSkin(pixels[p], pixels[p + 1], pixels[p + 2])
        ) return;
        mask[index] = 2;
        queue[componentTail++] = index;
      }
      visit(start);
      while (componentHead < componentTail) {
        const index = queue[componentHead++];
        const x = index % width;
        const y = Math.floor(index / width);
        const p = index * 4;
        if (Math.abs(pixels[p] - background[0]) <= 35 &&
            Math.abs(pixels[p + 1] - background[1]) <= 30 &&
            Math.abs(pixels[p + 2] - background[2]) <= 30) similar += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (x > 0) visit(index - 1);
        if (x + 1 < width) visit(index + 1);
        if (y > 0) visit(index - width);
        if (y + 1 < height) visit(index + width);
      }
      if (componentTail < 64 || maxX - minX < 3 || maxY - minY < 3 || similar < componentTail * 0.65) continue;
      const maxDistance = componentTail >= 200 ? 22 : 5;
      let nearExterior = false;
      for (let i = 0; i < componentTail && !nearExterior; i += 1) {
        const x = queue[i] % width;
        const y = Math.floor(queue[i] / width);
        for (let dy = -maxDistance; dy <= maxDistance && !nearExterior; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          const reach = maxDistance - Math.abs(dy);
          for (let dx = -reach; dx <= reach; dx += 1) {
            const xx = x + dx;
            if (xx >= 0 && xx < width && exterior[yy * width + xx]) { nearExterior = true; break; }
          }
        }
      }
      if (!nearExterior) continue;
      for (let i = 0; i < componentTail; i += 1) mask[queue[i]] = 1;
      removed += componentTail;
      removedIslands += 1;
    }
  }

  let feathered = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    if (mask[index] === 1) {
      pixels[offset + 3] = 0;
      continue;
    }
    const x = index % width;
    let neighbors = 0;
    if (x > 0 && mask[index - 1] === 1) neighbors += 1;
    if (x + 1 < width && mask[index + 1] === 1) neighbors += 1;
    if (index >= width && mask[index - width] === 1) neighbors += 1;
    if (index + width < count && mask[index + width] === 1) neighbors += 1;
    if (!neighbors) continue;

    // A single-pixel contour feather avoids a jagged halo; never remap or
    // rescale a frame, which would move the character between video frames.
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    const looksWarmSkin = isWarmSkin(r, g, b) || (g - b > 11 && r > 145 && g >= 110);
    if (looksWarmSkin) continue;
    pixels[offset + 3] = neighbors >= 3 ? 144 : neighbors === 2 ? 190 : 225;
    if (r > g + 12 && r > b + 10) {
      pixels[offset] = Math.min(r, Math.max(g, b) + 12);
    }
    feathered += 1;
  }

  return { removed, feathered, removedIslands };
}

function bleedTransparentEdgeColors(pixels, width, height, radius = 6) {
  const count = width * height;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(count) || pixels.length !== count * 4 ||
      !Number.isInteger(radius) || radius < 1 || radius > 16) {
    throw new Error("Expected a complete RGBA frame and a bleed radius from 1 to 16");
  }
  const queue = new Int32Array(count);
  const distance = new Uint8Array(count);
  const donor = new Int32Array(count);
  donor.fill(-1);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < count; index += 1) {
    if (pixels[index * 4 + 3] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    let boundary = false;
    for (let dy = -1; dy <= 1 && !boundary; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        if (pixels[(yy * width + xx) * 4 + 3] === 0) { boundary = true; break; }
      }
    }
    if (boundary) { donor[index] = index; queue[tail++] = index; }
  }

  let changedPixels = 0;
  // VP9 4:2:0 samples RGB even where alpha is zero. Extend nearby foreground
  // colors into that invisible strip without changing any alpha or visible RGB.
  while (head < tail) {
    const index = queue[head++];
    if (distance[index] >= radius) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const next = yy * width + xx;
        const offset = next * 4;
        if (donor[next] !== -1 || pixels[offset + 3] !== 0) continue;
        donor[next] = donor[index];
        distance[next] = distance[index] + 1;
        queue[tail++] = next;
        const source = donor[index] * 4;
        if (pixels[offset] !== pixels[source] || pixels[offset + 1] !== pixels[source + 1] ||
            pixels[offset + 2] !== pixels[source + 2]) changedPixels += 1;
        pixels[offset] = pixels[source];
        pixels[offset + 1] = pixels[source + 1];
        pixels[offset + 2] = pixels[source + 2];
      }
    }
  }
  return { changedPixels };
}

module.exports = { isRedBackdrop, removeBackdrop, removeKnownGroundDebris, bleedTransparentEdgeColors };
