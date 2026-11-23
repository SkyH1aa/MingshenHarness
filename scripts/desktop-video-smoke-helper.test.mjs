import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { inspectCompanionVideos } from "./desktop-video-smoke-helper.mjs";

function fakeRenderer({ blank = false, tainted = false, noMetadata = false, staticFrame = false } = {}) {
  const created = [];
  class FakeVideo extends EventTarget {
    constructor() {
      super();
      this.duration = 2;
      this.videoWidth = 100;
      this.videoHeight = 100;
      this.readyState = 2;
      this._time = 0;
      this.src = "";
      this.removed = false;
      created.push(this);
    }
    set currentTime(value) {
      this._time = value;
      queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
    }
    get currentTime() { return this._time; }
    load() {
      if (this.src && !noMetadata) queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === "src") this.src = ""; }
    remove() { this.removed = true; }
  }
  class FakeCanvas {
    constructor() {
      this.removed = false;
      created.push(this);
      const canvas = this;
      this.context = {
        clearRect() {},
        drawImage(source) { if (source instanceof FakeVideo) this.source = source; },
        getImageData() {
          if (tainted) throw new Error("Canvas is tainted");
          const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          for (let pixel = 0; pixel < canvas.width * canvas.height; pixel += 1) {
            const offset = pixel * 4;
            if (!blank && pixel % 2) {
              data[offset] = staticFrame ? 40 : Math.round((this.source?.currentTime ?? 0) * 40) + 40;
              data[offset + 1] = 70;
              data[offset + 2] = 100;
              data[offset + 3] = 255;
            }
          }
          return { data };
        },
      };
    }
    getContext() { return this.context; }
    toDataURL() { return "data:image/png;base64,ZmFrZQ=="; }
    remove() { this.removed = true; }
  }
  const context = {
    location: { href: "file:///C:/fixture/companion.html", protocol: "file:", origin: "null" },
    document: { createElement: (kind) => kind === "video" ? new FakeVideo() : new FakeCanvas() },
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
    Uint8ClampedArray,
    URL,
    performance,
    setTimeout,
    clearTimeout,
  };
  return {
    created,
    evaluate: (expression) => vm.runInNewContext(expression, context),
  };
}

test("samples actual canvas RGBA for each explicit video and cleans up", async () => {
  const renderer = fakeRenderer();
  const frames = [];
  const clips = [{ id: "idle", url: "./motions/idle.webm" }, { id: "work", url: "./motions/work.webm" }];
  const results = await inspectCompanionVideos(renderer, clips, {
    expectedCount: 2,
    onFrame: (result, frame) => frames.push({ id: result.id, frame }),
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].samples.length, 3);
  assert.ok(results[0].samples.every((sample) => sample.transparent > 0 && sample.visible > 0));
  assert.ok(results[0].samples[1].changedFromPrevious > 0);
  assert.equal(frames.length, 2);
  assert.ok(renderer.created.every((element) => element.removed));
  assert.ok(renderer.created.filter((element) => "paused" in element).every((video) => video.paused && !video.src));
});

test("aggregates every blank or tainted clip without silently accepting either", async () => {
  const blank = fakeRenderer({ blank: true });
  const callbacks = [];
  await assert.rejects(
    inspectCompanionVideos(blank, [{ id: "one", url: "./one.webm" }, { id: "two", url: "./two.webm" }], {
      expectedCount: 2,
      onClip: (result) => callbacks.push(result),
    }),
    (error) => {
      assert.equal(error.results.length, 2);
      assert.match(error.message, /2\/2/);
      assert.ok(error.results.every((result) => !result.ok && /blank/.test(result.error)));
      return true;
    },
  );
  assert.equal(callbacks.length, 2);
  assert.ok(blank.created.every((element) => element.removed));

  const tainted = fakeRenderer({ tainted: true });
  await assert.rejects(
    inspectCompanionVideos(tainted, [{ id: "one", url: "./one.webm" }], { expectedCount: 1 }),
    (error) => /tainted/.test(error.results[0].error),
  );
  assert.ok(tainted.created.every((element) => element.removed));
});

test("bounds a stalled clip, rejects foreign origins, and releases resources", async () => {
  const stalled = fakeRenderer({ noMetadata: true });
  await assert.rejects(
    inspectCompanionVideos(stalled, [{ id: "stall", url: "./stall.webm" }], { expectedCount: 1, timeoutMs: 500 }),
    (error) => /Deadline reached/.test(error.results[0].error),
  );
  assert.ok(stalled.created.every((element) => element.removed));
  const foreign = fakeRenderer();
  await assert.rejects(
    inspectCompanionVideos(foreign, [{ id: "remote", url: "https://example.test/video.webm" }], { expectedCount: 1 }),
    (error) => /not a local file/.test(error.results[0].error),
  );
  assert.equal(foreign.created.length, 0);
});

test("rejects a completely static sampled clip and continues after callback errors", async () => {
  const fixed = fakeRenderer({ staticFrame: true });
  await assert.rejects(
    inspectCompanionVideos(fixed, [{ id: "fixed", url: "./fixed.webm" }], { expectedCount: 1 }),
    (error) => /No meaningful pixel change/.test(error.results[0].error),
  );
  assert.ok(fixed.created.every((element) => element.removed));

  const renderer = fakeRenderer();
  await assert.rejects(
    inspectCompanionVideos(renderer, [{ id: "one", url: "./one.webm" }, { id: "two", url: "./two.webm" }], {
      expectedCount: 2,
      onClip: (result) => { if (result.id === "one") throw new Error("fixture callback"); },
    }),
    (error) => error.results.length === 2 && /callback/.test(error.results[0].error) && error.results[1].ok,
  );
  assert.ok(renderer.created.every((element) => element.removed));
});

test("requires the exact count and unique ids and URLs", async () => {
  const renderer = fakeRenderer();
  await assert.rejects(inspectCompanionVideos(renderer, [], { expectedCount: 1 }), /Expected 1/);
  await assert.rejects(inspectCompanionVideos(renderer, [{ id: "a", url: "a" }, { id: "a", url: "b" }], { expectedCount: 2 }), /Duplicate video id/);
  await assert.rejects(inspectCompanionVideos(renderer, [{ id: "a", url: "a" }, { id: "b", url: "a" }], { expectedCount: 2 }), /Duplicate video URL/);
  assert.equal(renderer.created.length, 0);
});
