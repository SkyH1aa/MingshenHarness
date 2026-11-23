import assert from "node:assert/strict";

// This function is serialized into the already-isolated companion renderer.
// It must not rely on Node globals or change the app's CSP/security settings.
async function probeVideoInRenderer(clip, options) {
  const started = performance.now();
  const deadline = started + options.timeoutMs;
  const samples = [];
  let video = null;
  let canvas = null;
  let sheet = null;
  let sheetContext = null;
  let previousPixels = null;
  let sheetDataUrl = null;

  function waitForMediaEvent(name) {
    return new Promise((resolve, reject) => {
      const remaining = Math.max(0, deadline - performance.now());
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener(name, onSuccess);
        video.removeEventListener("error", onError);
      };
      const onSuccess = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        const error = video.error;
        cleanup();
        reject(new Error(`Media error while waiting for ${name}: ${error?.code ?? "unknown"} ${error?.message ?? ""}`));
      };
      video.addEventListener(name, onSuccess, { once: true });
      video.addEventListener("error", onError, { once: true });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Deadline reached waiting for ${name}`));
      }, remaining);
    });
  }

  try {
    const url = new URL(clip.url, location.href);
    const permitted = location.protocol === "file:"
      ? url.protocol === "file:"
      : url.origin === location.origin && (url.protocol === "http:" || url.protocol === "https:");
    if (!permitted) throw new Error("Clip URL is not a local file or the renderer's own origin");

    video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const metadataReady = waitForMediaEvent("loadedmetadata");
    video.src = url.href;
    video.load();
    await metadataReady;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
      throw new Error(`Invalid media metadata: ${video.videoWidth}x${video.videoHeight}, duration=${video.duration}`);
    }

    const scale = Math.min(1, options.maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Unable to create a canvas 2D context");
    if (options.captureFrames) {
      sheet = document.createElement("canvas");
      sheet.width = width * options.samplePoints.length;
      sheet.height = height;
      sheetContext = sheet.getContext("2d");
      if (!sheetContext) throw new Error("Unable to create the contact-sheet canvas");
    }

    for (let sampleIndex = 0; sampleIndex < options.samplePoints.length; sampleIndex += 1) {
      const time = Math.min(video.duration - Math.min(0.001, video.duration / 100), video.duration * options.samplePoints[sampleIndex]);
      const seeked = waitForMediaEvent("seeked");
      video.currentTime = time;
      await seeked;
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await waitForMediaEvent("loadeddata");
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(video, 0, 0, width, height);
      // getImageData must succeed on the real renderer origin. A tainted
      // canvas is a failure, not a reason to relax CSP or replace the decoder.
      const pixels = context.getImageData(0, 0, width, height).data;
      let transparent = 0;
      let visible = 0;
      let nonBlack = 0;
      let partialAlpha = 0;
      let changed = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3];
        if (alpha <= 8) transparent += 1;
        if (alpha > 8 && alpha < 247) partialAlpha += 1;
        if (alpha >= 32) {
          visible += 1;
          if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 12) nonBlack += 1;
        }
        if (previousPixels && (
          Math.abs(pixels[i] - previousPixels[i]) > 8 ||
          Math.abs(pixels[i + 1] - previousPixels[i + 1]) > 8 ||
          Math.abs(pixels[i + 2] - previousPixels[i + 2]) > 8 ||
          Math.abs(alpha - previousPixels[i + 3]) > 8
        )) changed += 1;
      }
      const minimumPixels = Math.max(8, Math.ceil(width * height / 10000));
      const sample = {
        requestedTime: time,
        decodedTime: video.currentTime,
        transparent,
        visible,
        nonBlack,
        partialAlpha,
        changedFromPrevious: previousPixels ? changed : null,
        minimumPixels,
      };
      samples.push(sample);
      sheetContext?.drawImage(canvas, sampleIndex * width, 0);
      if (transparent < minimumPixels || visible < minimumPixels || nonBlack < minimumPixels) {
        throw new Error(`Frame ${sampleIndex + 1} is blank or lacks transparent/visible pixels: ${JSON.stringify(sample)}`);
      }
      previousPixels = new Uint8ClampedArray(pixels);
    }

    if (sheet) sheetDataUrl = sheet.toDataURL("image/png");
    if (options.requireMotion && !samples.slice(1).some((sample) =>
      sample.changedFromPrevious >= sample.minimumPixels)) {
      throw new Error("No meaningful pixel change was found between sampled frames");
    }
    return {
      id: clip.id,
      url: url.href,
      ok: true,
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      sampleWidth: width,
      sampleHeight: height,
      samples,
      elapsedMs: Math.round(performance.now() - started),
      sheetDataUrl,
    };
  } catch (cause) {
    if (sheet && samples.length) {
      try { sheetDataUrl = sheet.toDataURL("image/png"); } catch { /* Preserve the original failure. */ }
    }
    return {
      id: clip.id,
      url: clip.url,
      ok: false,
      duration: Number.isFinite(video?.duration) ? video.duration : null,
      videoWidth: video?.videoWidth ?? null,
      videoHeight: video?.videoHeight ?? null,
      samples,
      elapsedMs: Math.round(performance.now() - started),
      error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
      sheetDataUrl,
    };
  } finally {
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    }
    canvas?.remove();
    sheet?.remove();
  }
}

export function buildCompanionVideoProbeExpression(clip, options) {
  return `(${probeVideoInRenderer.toString()})(${JSON.stringify(clip)},${JSON.stringify(options)})`;
}

/**
 * Decode each explicit compiled asset in the companion renderer itself.
 * The caller resolves the production manifest to URLs; no filesystem or
 * product-only test hook is required in the renderer.
 */
export async function inspectCompanionVideos(connection, clips, {
  expectedCount = 36,
  timeoutMs = 10_000,
  maxDimension = 180,
  samplePoints = [0.1, 0.5, 0.85],
  requireMotion = true,
  onClip = () => {},
  onFrame = null,
} = {}) {
  assert.equal(typeof connection?.evaluate, "function", "A companion renderer connection is required");
  assert.ok(Array.isArray(clips), "Video clips must be an array");
  assert.equal(clips.length, expectedCount, `Expected ${expectedCount} explicit video clips`);
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 500 && timeoutMs <= 30_000, "Invalid video deadline");
  assert.ok(Number.isInteger(maxDimension) && maxDimension >= 32 && maxDimension <= 720, "Invalid canvas dimension");
  assert.ok(Array.isArray(samplePoints) && samplePoints.length >= 1 && samplePoints.length <= 5 &&
    samplePoints.every((point, index) => Number.isFinite(point) && point > 0 && point < 1 &&
      (index === 0 || point > samplePoints[index - 1])), "Sample points must be increasing fractions in (0, 1)");
  assert.equal(typeof requireMotion, "boolean", "requireMotion must be boolean");
  assert.ok(!requireMotion || samplePoints.length >= 2, "Motion checks require at least two sample points");
  assert.equal(typeof onClip, "function", "onClip must be a function");
  assert.ok(onFrame === null || typeof onFrame === "function", "onFrame must be a function or null");
  const ids = new Set();
  const urls = new Set();
  for (const clip of clips) {
    assert.ok(clip && typeof clip.id === "string" && clip.id && typeof clip.url === "string" && clip.url,
      "Each clip must have a nonempty id and compiled URL");
    assert.ok(!ids.has(clip.id), `Duplicate video id: ${clip.id}`);
    assert.ok(!urls.has(clip.url), `Duplicate video URL: ${clip.url}`);
    ids.add(clip.id);
    urls.add(clip.url);
  }

  const options = { timeoutMs, maxDimension, samplePoints, requireMotion, captureFrames: Boolean(onFrame) };
  const results = [];
  for (const clip of clips) {
    let result;
    try {
      result = await connection.evaluate(buildCompanionVideoProbeExpression(clip, options));
      if (!result || result.id !== clip.id || typeof result.ok !== "boolean") {
        throw new Error("Invalid renderer probe response");
      }
    } catch (cause) {
      result = { id: clip.id, url: clip.url, ok: false, samples: [], error: String(cause) };
    }
    const dataUrl = result.sheetDataUrl;
    delete result.sheetDataUrl;
    if (dataUrl && onFrame) {
      try {
        await onFrame(result, dataUrl);
      } catch (cause) {
        result.ok = false;
        result.error = [result.error, `Evidence write failed: ${String(cause)}`].filter(Boolean).join("; ");
      }
    }
    results.push(result);
    try {
      await onClip(result);
    } catch (cause) {
      result.ok = false;
      result.error = [result.error, `Result callback failed: ${String(cause)}`].filter(Boolean).join("; ");
    }
  }
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    const error = new Error(`${failures.length}/${clips.length} companion video clips failed: ${failures.map((item) => `${item.id}: ${item.error}`).join("; ")}`);
    error.results = results;
    throw error;
  }
  return results;
}
