"use strict";

// Development-only batch renderer. It never changes the input MP4 files and
// does not ship or install FFmpeg. Run --help for the explicit tool paths.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { COMPANION_MOTION_IDS } = require("./package-desktop-surfaces.cjs");
const { removeBackdrop, removeKnownGroundDebris, bleedTransparentEdgeColors } = require("./companion-video-key.cjs");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE = path.join(ROOT, "36个桌宠动画");
const DEFAULT_OUTPUT = path.join(ROOT, "apps/desktop/src/renderer/companion-assets/motions");
const WIDTH = 720;
const HEIGHT = 720;
const FPS = 24;
const FRAME_BYTES = WIDTH * HEIGHT * 4;
const TRANSPARENT_EDGE_BLEED_RADIUS = 6;
const LOOP_IDS = new Set([
  "idle_breathe", "thinking_loop", "working_loop", "waiting", "sleep_loop", "drag_loop",
  "walk_left", "walk_right", "read_loop",
]);
const TRANSFORMS = Object.freeze({ 21: Object.freeze({ width: 512, height: 512, x: 101, y: 208 }) });
const children = new Set();

function usage() {
  return `Usage: node scripts/prepare-companion-motions.cjs --ffmpeg <path> --ffprobe <path> [options]

  --source <directory>  Input 1.mp4 ... 36.mp4 (default: workspace/36个桌宠动画)
  --output <directory>  Output motion directory (default: renderer companion assets)
  --qa <directory>      Write three keyed-frame thumbnails per motion and contact sheets
  --sample <1..36>      Render just one clip; requires an explicit, non-default --output
  --update <33>         Re-render only the source-matched clip 33; validates and preserves all other outputs
  --overwrite           Replace existing generated motion files and manifest
  --help                Print this message

The FFmpeg and FFprobe executables must be supplied by the developer; they are not copied.
Original videos are read-only. A sample run never writes a manifest.
`;
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set(["--ffmpeg", "--ffprobe", "--source", "--output", "--qa", "--sample", "--update"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") return { help: true };
    if (arg === "--overwrite") {
      values.overwrite = true;
      continue;
    }
    if (!allowed.has(arg) || !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw new Error(`Unknown option or missing value: ${arg}\n${usage()}`);
    }
    if (values[arg.slice(2)] !== undefined) throw new Error(`Duplicate option: ${arg}`);
    values[arg.slice(2)] = argv[++i];
  }
  if (!values.ffmpeg || !values.ffprobe) throw new Error(`Both --ffmpeg and --ffprobe are required.\n${usage()}`);
  const source = path.resolve(values.source || DEFAULT_SOURCE);
  const output = path.resolve(values.output || DEFAULT_OUTPUT);
  const qa = values.qa ? path.resolve(values.qa) : null;
  const sample = values.sample === undefined ? null : Number(values.sample);
  const update = values.update === undefined ? null : Number(values.update);
  if (sample !== null && (!Number.isInteger(sample) || sample < 1 || sample > 36)) {
    throw new Error("--sample must be an integer from 1 to 36");
  }
  if (sample !== null && (!values.output || output === path.resolve(DEFAULT_OUTPUT))) {
    throw new Error("A sample must use an explicit output directory outside the built-in motion directory");
  }
  if (update !== null && (update !== 33 || !Number.isInteger(update))) {
    throw new Error("--update currently accepts only clip 33");
  }
  if (sample !== null && update !== null) throw new Error("--sample and --update cannot be combined");
  if (update !== null && !values.overwrite) throw new Error("--update requires --overwrite");
  const isInside = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  if (isInside(source, output) || (qa && isInside(source, qa))) {
    throw new Error("Output and QA directories must not be inside the original source directory");
  }
  return { ...values, ffmpeg: path.resolve(values.ffmpeg), ffprobe: path.resolve(values.ffprobe), source, output, qa, sample, update };
}

function mergeUpdatedMotionManifest(existing, updatedMotion, processingOverride) {
  if (!existing || existing.version !== 1 || existing.canvas?.width !== WIDTH ||
      existing.canvas?.height !== HEIGHT || existing.fps !== FPS || !Array.isArray(existing.motions) ||
      existing.motions.length !== COMPANION_MOTION_IDS.length) {
    throw new Error("Existing manifest is incomplete or incompatible; refusing a partial update");
  }
  const motions = existing.motions.map((motion, index) => {
    if (motion.id !== COMPANION_MOTION_IDS[index] || motion.file !== `${COMPANION_MOTION_IDS[index]}.webm` ||
        motion.source !== `${index + 1}.mp4`) throw new Error("Existing manifest motion order or IDs are invalid");
    return motion;
  });
  const index = Number(updatedMotion.source.replace(/\.mp4$/i, "")) - 1;
  if (index !== 32 || updatedMotion.id !== COMPANION_MOTION_IDS[index] ||
      updatedMotion.sourceSha256 !== motions[index].sourceSha256 || updatedMotion.frames !== motions[index].frames) {
    throw new Error("Updated motion does not match the existing source identity for clip 33");
  }
  motions[index] = { ...updatedMotion, processing: processingOverride };
  return { ...existing, motions };
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function probe(ffprobe, file, countFrames = false) {
  const { stdout } = await execFileAsync(ffprobe, [
    "-v", "error", ...(countFrames ? ["-count_frames"] : []), "-select_streams", "v:0", "-show_entries",
    "stream=codec_name,width,height,avg_frame_rate,nb_frames,nb_read_frames,duration:stream_tags=alpha_mode:format=duration",
    "-of", "json", file,
  ], { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed.streams) || parsed.streams.length !== 1) throw new Error(`Expected one video stream: ${file}`);
  return { ...parsed.streams[0], formatDuration: Number(parsed.format?.duration) };
}

function fraction(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value || "");
  return match && Number(match[2]) ? Number(match[1]) / Number(match[2]) : NaN;
}

function startProcess(executable, args) {
  const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  children.add(child);
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-16_384); });
  const ended = new Promise((resolve) => {
    child.once("error", (error) => resolve({ error, stderr }));
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  }).finally(() => children.delete(child));
  return { child, ended };
}

function assertSuccess(result, name) {
  if (result.error || result.code !== 0) {
    throw new Error(`${name} failed (${result.error?.message || result.signal || result.code}): ${result.stderr}`);
  }
}

async function writeFrame(stream, frame) {
  if (stream.destroyed || !stream.writable) throw new Error("Encoder input is already closed");
  if (stream.write(frame)) return;
  await new Promise((resolve, reject) => {
    function cleanup() {
      stream.removeListener("drain", onDrain);
      stream.removeListener("error", onError);
      stream.removeListener("close", onClose);
    }
    function onDrain() { cleanup(); resolve(); }
    function onError(error) { cleanup(); reject(error); }
    function onClose() { cleanup(); reject(new Error("Encoder input closed before drain")); }
    stream.once("drain", onDrain);
    stream.once("error", onError);
    stream.once("close", onClose);
    if (stream.destroyed || !stream.writable) onClose();
  });
}

async function readEncodedSamples(options, video, frameCount) {
  const filter = [0, Math.floor((frameCount - 1) / 2), frameCount - 1]
    .map((index) => `eq(n\\,${index})`).join("+");
  // Native FFmpeg's VP9 decoder can ignore alpha; explicitly use libvpx-vp9.
  const { stdout } = await execFileAsync(options.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-c:v", "libvpx-vp9", "-i", video,
    "-vf", `select=${filter}`, "-fps_mode", "vfr", "-frames:v", "3",
    "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1",
  ], { timeout: 120_000, maxBuffer: FRAME_BYTES * 3 + 1024 * 1024, encoding: "buffer", windowsHide: true });
  if (stdout.length !== FRAME_BYTES * 3) throw new Error(`Expected exactly three decoded RGBA frames: ${video}`);
  const frames = [0, 1, 2].map((index) => stdout.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES));
  const alpha = frames.map((frame) => {
    let transparent = 0;
    let visible = 0;
    let partial = 0;
    for (let offset = 3; offset < frame.length; offset += 4) {
      const value = frame[offset];
      if (value === 0) transparent += 1;
      else {
        visible += 1;
        if (value !== 255) partial += 1;
      }
    }
    if (transparent < WIDTH * HEIGHT / 100 || visible < WIDTH * HEIGHT / 100) {
      throw new Error(`Decoded sample lacks a meaningful transparent background or visible character: ${video}`);
    }
    return { transparent, visible, partial };
  });
  return { frames, alpha };
}

async function createQa(sharp, options, sourceNumber, id, frames) {
  const directory = path.join(options.qa, "frames");
  await fsp.mkdir(directory, { recursive: true });
  const prefix = `${String(sourceNumber).padStart(2, "0")}-${id}`;
  const names = [1, 2, 3].map((index) => path.join(directory, `${prefix}-${index}.png`));
  for (const [index, name] of names.entries()) {
    await sharp(frames[index], { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toFile(name);
  }
  return { id, sourceNumber, frames: names };
}

async function renderOne(options, stage, number, sharp) {
  const id = COMPANION_MOTION_IDS[number - 1];
  const input = path.join(options.source, `${number}.mp4`);
  const temp = path.join(stage, `${id}.webm`);
  const metadata = await probe(options.ffprobe, input);
  const count = Number(metadata.nb_frames);
  if (metadata.width !== WIDTH || metadata.height !== HEIGHT || fraction(metadata.avg_frame_rate) !== FPS ||
      !Number.isSafeInteger(count) || count < 2 || count > 1000) {
    throw new Error(`Unexpected source dimensions, frame rate, or frame count for ${input}`);
  }
  const sourceSha256 = await sha256(input);
  const isKnownGroundSource = number === 33 && sourceSha256 === "523215fc123b00df6b8bb63108313a2a7f75a7182c99bbe366bb0b685e4cc272";
  const transform = TRANSFORMS[number] ?? null;
  const decode = startProcess(options.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-i", input, "-map", "0:v:0", "-an", "-sn",
    "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1",
  ]);
  const encode = startProcess(options.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", `${WIDTH}x${HEIGHT}`, "-framerate", String(FPS), "-i", "pipe:0", "-an",
    ...(transform ? ["-vf", `format=rgba,scale=${transform.width}:${transform.height}:flags=lanczos,pad=${WIDTH}:${HEIGHT}:${transform.x}:${transform.y}:color=black@0,format=yuva420p`] : []),
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-deadline", "good",
    "-cpu-used", "5", "-row-mt", "1", "-threads", "4", "-crf", "28", "-b:v", "0", "-f", "webm", temp,
  ]);
  decode.child.stdin.end();
  encode.child.stdout.resume();
  // Drain may not be pending when a failed encoder closes its input.
  encode.child.stdin.on("error", () => {});
  let frame = Buffer.allocUnsafe(FRAME_BYTES);
  let offset = 0;
  let frames = 0;
  let removed = 0;
  let removedIslands = 0;
  let feathered = 0;
  let removedGroundPixels = 0;
  let transparentEdgeRgbPixels = 0;
  let bleedVerifiedVisiblePixels = 0;
  const groundDebrisFrames = [];
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; decode.child.kill(); encode.child.kill(); }, 15 * 60_000);
  try {
    for await (const chunk of decode.child.stdout) {
      let from = 0;
      while (from < chunk.length) {
        const amount = Math.min(FRAME_BYTES - offset, chunk.length - from);
        chunk.copy(frame, offset, from, from + amount);
        offset += amount;
        from += amount;
        if (offset !== FRAME_BYTES) continue;
        const originalFrame = isKnownGroundSource ? Buffer.from(frame) : null;
        const stats = removeBackdrop(frame, WIDTH, HEIGHT);
        removed += stats.removed;
        removedIslands += stats.removedIslands;
        feathered += stats.feathered;
        if (originalFrame) {
          const ground = removeKnownGroundDebris(frame, originalFrame, WIDTH, HEIGHT, {
            sourceNumber: number,
            sourceSha256,
          });
          if (ground.removedPixels) {
            removedGroundPixels += ground.removedPixels;
            groundDebrisFrames.push({ frame: frames, removedPixels: ground.removedPixels, components: ground.removedComponents });
          }
        }
        const beforeBleed = options.qa ? Buffer.from(frame) : null;
        transparentEdgeRgbPixels += bleedTransparentEdgeColors(frame, WIDTH, HEIGHT, TRANSPARENT_EDGE_BLEED_RADIUS).changedPixels;
        if (beforeBleed) {
          for (let pixel = 0; pixel < FRAME_BYTES; pixel += 4) {
            if (frame[pixel + 3] !== beforeBleed[pixel + 3]) throw new Error(`${id}: transparent RGB bleed changed alpha`);
            if (beforeBleed[pixel + 3] === 0) continue;
            if (frame[pixel] !== beforeBleed[pixel] || frame[pixel + 1] !== beforeBleed[pixel + 1] || frame[pixel + 2] !== beforeBleed[pixel + 2]) {
              throw new Error(`${id}: transparent RGB bleed changed visible RGB`);
            }
            bleedVerifiedVisiblePixels += 1;
          }
        }
        await writeFrame(encode.child.stdin, frame);
        frames += 1;
        frame = Buffer.allocUnsafe(FRAME_BYTES);
        offset = 0;
      }
    }
    if (offset !== 0 || frames !== count) throw new Error(`${id}: decoded ${frames} complete frames, expected ${count}`);
    encode.child.stdin.end();
    const [decoderResult, encoderResult] = await Promise.all([decode.ended, encode.ended]);
    assertSuccess(decoderResult, `${id} decode`);
    assertSuccess(encoderResult, `${id} encode`);
  } catch (error) {
    decode.child.kill();
    encode.child.kill();
    await Promise.all([decode.ended, encode.ended]);
    if (timedOut) throw new Error(`${id}: rendering exceeded the 15-minute limit`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const output = await probe(options.ffprobe, temp, true);
  if (output.codec_name !== "vp9" || output.width !== WIDTH || output.height !== HEIGHT ||
      output.tags?.alpha_mode !== "1" || fraction(output.avg_frame_rate) !== FPS ||
      Number(output.nb_read_frames) !== frames || !Number.isFinite(output.formatDuration) ||
      Math.abs(output.formatDuration - frames / FPS) > 1 / FPS) {
    throw new Error(`${id}: invalid VP9 Alpha dimensions, frame count, frame rate, or duration`);
  }
  const stat = await fsp.stat(temp);
  const samples = await readEncodedSamples(options, temp, frames);
  const qa = options.qa ? await createQa(sharp, options, number, id, samples.frames) : null;
  return {
    motion: { id, source: `${number}.mp4`, sourceSha256, file: `${id}.webm`, bytes: stat.size,
      sha256: await sha256(temp), duration: output.formatDuration, loop: LOOP_IDS.has(id), frames,
      quality: {
        removedPixels: removed,
        removedIslands,
        featheredPixels: feathered,
        transparentEdgeRgbPixels,
        ...(options.qa ? { transparentEdgeSafety: {
          checkedFrames: frames,
          checkedNonzeroAlphaPixels: bleedVerifiedVisiblePixels,
          stage: "Immediately before/after transparent RGB bleed, before optional scaling/padding and VP9 encoding",
          allAlphaUnchanged: true,
          allNonzeroAlphaRgbaUnchanged: true,
        } } : {}),
        alphaSamples: samples.alpha,
        ...(isKnownGroundSource ? { groundDebris: { sourceSha256, removedPixels: removedGroundPixels, frames: groundDebrisFrames } } : {}),
      } }, qa,
  };
}

async function writeContactSheets(sharp, qa, clips) {
  const thumbs = [];
  for (const clip of clips) {
    for (const frame of clip.frames) {
      const raw = await sharp(frame).resize(160, 160).png().toBuffer();
      thumbs.push({ input: raw, clip: clip.sourceNumber });
    }
  }
  // Twelve numbered clips per page, three moments per clip, shown on both backgrounds.
  for (let page = 0; page * 12 < clips.length; page += 1) {
    const pageClips = clips.slice(page * 12, (page + 1) * 12);
    const overlays = [];
    for (let row = 0; row < pageClips.length; row += 1) {
      const label = Buffer.from(`<svg width="72" height="20"><text x="4" y="15" font-family="sans-serif" font-size="13" fill="#1c252d">${pageClips[row].sourceNumber}</text></svg>`);
      overlays.push({ input: label, left: 4, top: row * 180 + 1 });
      for (let n = 0; n < 3; n += 1) {
        const input = thumbs[(page * 12 + row) * 3 + n].input;
        for (let variant = 0; variant < 2; variant += 1) {
          const left = n * 320 + variant * 160;
          const top = row * 180 + 20;
          overlays.push({ input: { create: { width: 160, height: 160, channels: 4, background: variant ? "#111820" : "#ffffff" } }, left, top });
          overlays.push({ input, left, top });
        }
      }
    }
    const target = path.join(qa, `contact-${page + 1}.png`);
    await sharp({ create: { width: 960, height: pageClips.length * 180, channels: 4, background: "#edf1f4" } })
      .composite(overlays).png().toFile(target);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  const inputs = options.sample ? [options.sample] : options.update ? [options.update] : COMPANION_MOTION_IDS.map((_, index) => index + 1);
  const destinations = inputs.map((number) => path.join(options.output, `${COMPANION_MOTION_IDS[number - 1]}.webm`));
  if (!options.sample) destinations.push(path.join(options.output, "manifest.json"));
  if (!options.overwrite) {
    for (const destination of destinations) {
      if (fs.existsSync(destination)) throw new Error(`Output exists; pass --overwrite to replace it: ${destination}`);
    }
  }
  await fsp.mkdir(options.output, { recursive: true });
  if (options.qa) await fsp.mkdir(options.qa, { recursive: true });
  const sharp = options.qa ? require(require.resolve("sharp", { paths: [path.join(ROOT, "apps/desktop")] })) : null;
  const scriptHash = await sha256(__filename);
  const keyHash = await sha256(path.join(__dirname, "companion-video-key.cjs"));
  const { stdout: versionOutput } = await execFileAsync(options.ffmpeg, ["-version"], {
    timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  const ffmpegVersion = versionOutput.split(/\r?\n/, 1)[0];
  let existingManifest = null;
  let existingManifestSha = null;
  let preservedOutputHashes = null;
  let previousUpdatedMotion = null;
  const manifestPath = path.join(options.output, "manifest.json");
  if (options.update) {
    existingManifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    existingManifestSha = await sha256(manifestPath);
    // Validate the complete canonical manifest before accepting any file paths.
    mergeUpdatedMotionManifest(existingManifest, existingManifest.motions?.[32] || {}, {});
    if (existingManifest.motions?.[32]?.sourceSha256 !== await sha256(path.join(options.source, "33.mp4"))) {
      throw new Error("Clip 33 source does not match the existing manifest; no output was changed");
    }
    preservedOutputHashes = new Map();
    for (const [index, motion] of existingManifest.motions.entries()) {
      const file = path.join(options.output, motion.file);
      const stat = await fsp.stat(file);
      const digest = await sha256(file);
      if (stat.size !== motion.bytes || digest !== motion.sha256) {
        throw new Error(`Existing motion ${motion.file} does not match its manifest; no output was changed`);
      }
      if (index === 32) previousUpdatedMotion = motion;
      else preservedOutputHashes.set(motion.file, { bytes: stat.size, sha256: digest });
    }
  }
  const stage = await fsp.mkdtemp(path.join(options.output, ".mingshen-render-"));
  const results = [];
  const started = Date.now();
  for (const number of inputs) {
    console.log(`[${results.length + 1}/${inputs.length}] ${number}.mp4 -> ${COMPANION_MOTION_IDS[number - 1]}`);
    const result = await renderOne(options, stage, number, sharp);
    results.push(result);
    console.log(`  ${result.motion.frames} frames, ${result.motion.bytes} bytes, ${((Date.now() - started) / 1000).toFixed(1)}s elapsed`);
  }
  if (options.qa) await writeContactSheets(sharp, options.qa, results.map((result) => result.qa));
  if (scriptHash !== await sha256(__filename) || keyHash !== await sha256(path.join(__dirname, "companion-video-key.cjs"))) {
    throw new Error("Processing script or key algorithm changed during the render; outputs were not published");
  }
  let manifest = null;
  if (options.update) {
    if (existingManifestSha !== await sha256(manifestPath)) {
      throw new Error("Existing manifest changed during the render; update was not published");
    }
    for (const [file, previous] of preservedOutputHashes) {
      const destination = path.join(options.output, file);
      const stat = await fsp.stat(destination);
      if (stat.size !== previous.bytes || await sha256(destination) !== previous.sha256) {
        throw new Error(`Preserved motion ${file} changed during rendering; update was not published`);
      }
    }
    const updatedMotion = results[0].motion;
    const processingOverride = {
      scriptSha256: scriptHash,
      keySha256: keyHash,
      ffmpegVersion,
      codec: "libvpx-vp9",
      pixelFormat: "yuva420p",
      crf: 28,
      cpuUsed: 5,
      transform: TRANSFORMS[33] ?? null,
      previousOutputSha256: previousUpdatedMotion.sha256,
      previousBytes: previousUpdatedMotion.bytes,
      transparentEdgeColorBleed: { radius: TRANSPARENT_EDGE_BLEED_RADIUS, scope: "Only alpha=0 RGB changes in the pre-transform/pre-VP9 buffer" },
    };
    manifest = mergeUpdatedMotionManifest(existingManifest, updatedMotion, processingOverride);
    if (previousUpdatedMotion.sha256 !== await sha256(path.join(options.output, previousUpdatedMotion.file))) {
      throw new Error("Clip 33 output changed during rendering; update was not published");
    }
  }
  const manifestStage = path.join(stage, "manifest.json");
  if (!options.sample) {
    manifest ??= { version: 1, canvas: { width: WIDTH, height: HEIGHT }, fps: FPS,
      processing: { scriptSha256: scriptHash, keySha256: keyHash, ffmpegVersion,
        codec: "libvpx-vp9", pixelFormat: "yuva420p", crf: 28, cpuUsed: 5, transforms: TRANSFORMS,
        transparentEdgeColorBleed: { radius: TRANSPARENT_EDGE_BLEED_RADIUS, scope: "Only alpha=0 RGB changes in the pre-transform/pre-VP9 buffer" } },
      motions: results.map((result) => result.motion) };
    await fsp.writeFile(manifestStage, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  }
  for (const result of results) {
    await fsp.rename(path.join(stage, result.motion.file), path.join(options.output, result.motion.file));
  }
  if (!options.sample) await fsp.rename(manifestStage, path.join(options.output, "manifest.json"));
  // Only this run's now-empty staging directory is removed; input and prior output are preserved.
  await fsp.rmdir(stage);
  console.log(`Completed ${results.length} clip(s) in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

module.exports = { parseArgs, fraction, writeFrame, mergeUpdatedMotionManifest };
if (require.main === module) {
  process.once("SIGINT", () => { for (const child of children) child.kill(); process.exitCode = 130; });
  process.once("SIGTERM", () => { for (const child of children) child.kill(); process.exitCode = 143; });
  main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
}
