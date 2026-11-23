"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { parseArgs, fraction, writeFrame, mergeUpdatedMotionManifest } = require("./prepare-companion-motions.cjs");
const { COMPANION_MOTION_IDS } = require("./package-desktop-surfaces.cjs");

class FakeEncoder extends EventEmitter {
  constructor(accept = false) {
    super();
    this.accept = accept;
    this.destroyed = false;
    this.writable = true;
  }
  write() { return this.accept; }
}

test("requires explicit executable paths and confines sample output", () => {
  assert.throws(() => parseArgs([]), /Both --ffmpeg and --ffprobe/);
  assert.throws(() => parseArgs(["--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe", "--sample", "1"]), /explicit output/);
  assert.throws(() => parseArgs(["--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe", "--sample", "37", "--output", "elsewhere"]), /integer from 1 to 36/);
  assert.throws(() => parseArgs(["--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe", "--source", "input", "--output", "input/render"]), /must not be inside/);
  assert.equal(parseArgs(["--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe", "--sample", "1", "--output", "elsewhere"]).sample, 1);
  assert.throws(() => parseArgs(["--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe", "--update", "33"]), /requires --overwrite/);
  assert.throws(() => parseArgs(["--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe", "--update", "32", "--overwrite"]), /only clip 33/);
  assert.throws(() => parseArgs(["--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe", "--sample", "1", "--update", "33", "--overwrite", "--output", "elsewhere"]), /cannot be combined/);
  assert.equal(parseArgs(["--ffmpeg", "ffmpeg", "--ffprobe", "ffprobe", "--update", "33", "--overwrite"]).update, 33);
  assert.equal(fraction("24/1"), 24);
  assert.ok(Number.isNaN(fraction("24/0")));
});

test("partial manifest merge preserves all other motions and records the prior output", () => {
  const motions = Array.from({ length: 36 }, (_, index) => ({
    id: COMPANION_MOTION_IDS[index],
    source: `${index + 1}.mp4`,
    sourceSha256: `${index + 1}`.padStart(64, "0"),
    file: `${COMPANION_MOTION_IDS[index]}.webm`,
    bytes: index + 100,
    sha256: `a${index}`.padEnd(64, "0"),
    frames: 121,
  }));
  const manifest = { version: 1, canvas: { width: 720, height: 720 }, fps: 24, processing: { scriptSha256: "baseline" }, motions };
  const updated = { ...motions[32], bytes: 999, sha256: "b".repeat(64), duration: 5.04 };
  const override = { scriptSha256: "new", previousOutputSha256: motions[32].sha256, previousBytes: motions[32].bytes };
  const merged = mergeUpdatedMotionManifest(manifest, updated, override);
  assert.equal(merged.processing, manifest.processing);
  assert.deepEqual(merged.motions.slice(0, 32), motions.slice(0, 32));
  assert.deepEqual(merged.motions.slice(33), motions.slice(33));
  assert.equal(merged.motions[32].sha256, updated.sha256);
  assert.deepEqual(merged.motions[32].processing, override);
  assert.throws(() => mergeUpdatedMotionManifest(manifest, { ...updated, sourceSha256: "0".repeat(64) }, override), /source identity/);
  assert.throws(() => mergeUpdatedMotionManifest({ ...manifest, motions: motions.slice(1) }, updated, override), /incomplete or incompatible/);
});

test("encoder backpressure resumes on drain and removes its listeners", async () => {
  const stream = new FakeEncoder();
  const result = writeFrame(stream, Buffer.alloc(1));
  stream.emit("drain");
  await result;
  assert.equal(stream.listenerCount("drain"), 0);
  assert.equal(stream.listenerCount("close"), 0);
  assert.equal(stream.listenerCount("error"), 0);
});

test("encoder close before drain rejects instead of hanging", async () => {
  const stream = new FakeEncoder();
  const result = writeFrame(stream, Buffer.alloc(1));
  stream.emit("close");
  await assert.rejects(result, /closed before drain/);
  assert.equal(stream.listenerCount("drain"), 0);
});

test("encoder error before drain propagates and removes listeners", async () => {
  const stream = new FakeEncoder();
  const result = writeFrame(stream, Buffer.alloc(1));
  stream.emit("error", new Error("broken pipe"));
  await assert.rejects(result, /broken pipe/);
  assert.equal(stream.listenerCount("drain"), 0);
  assert.equal(stream.listenerCount("close"), 0);
});

test("rejects an already-destroyed encoder input", async () => {
  const stream = new FakeEncoder();
  stream.destroyed = true;
  await assert.rejects(writeFrame(stream, Buffer.alloc(1)), /already closed/);
});
