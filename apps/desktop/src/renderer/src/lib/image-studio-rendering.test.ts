import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageStudioCanvas } from "../../../shared/image-studio";
import { renderCanvasPng, renderGifSource } from "./image-studio-rendering";

afterEach(() => vi.unstubAllGlobals());

function mockCanvas() {
  let liveImages = 0;
  let maxLiveImages = 0;
  const events: string[] = [];
  class FakeImage {
    decoding = "";
    naturalWidth = 100;
    naturalHeight = 50;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private value = "";

    set src(value: string) {
      if (this.value && !value) {
        liveImages -= 1;
        events.push(`released:${this.value}`);
      } else if (!this.value && value) {
        liveImages += 1;
        maxLiveImages = Math.max(maxLiveImages, liveImages);
        events.push(`load:${value}`);
        queueMicrotask(() => this.onload?.());
      }
      this.value = value;
    }

    async decode() {
      events.push(`decoded:${this.value}`);
    }
  }
  const context = {
    fillStyle: "",
    globalAlpha: 1,
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(() => events.push("draw")),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  };
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["png"])),
    }),
  });
  return { context, events, maxLiveImages: () => maxLiveImages, liveImages: () => liveImages };
}

const canvas: ImageStudioCanvas = {
  id: "canvas",
  name: "Canvas",
  width: 100,
  height: 100,
  background: "#000000",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  layers: [
    {
      id: "one",
      assetId: "a",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
    },
    {
      id: "two",
      assetId: "b",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
    },
  ],
};

describe("image studio rendering", () => {
  it("decodes and releases GIF frames one at a time", async () => {
    const mock = mockCanvas();
    const load = vi.fn(async (id: string) => id);
    const result = await renderGifSource(["a", "b", "c"], 350, load);
    expect(result.frames).toHaveLength(3);
    expect(mock.maxLiveImages()).toBe(1);
    expect(mock.liveImages()).toBe(0);
    expect(mock.events).toEqual([
      "load:a",
      "decoded:a",
      "draw",
      "released:a",
      "load:b",
      "decoded:b",
      "draw",
      "released:b",
      "load:c",
      "decoded:c",
      "draw",
      "released:c",
    ]);
  });

  it("decodes PNG layers and rejects an unavailable asset", async () => {
    const mock = mockCanvas();
    await expect(
      renderCanvasPng(canvas, async (id) => {
        if (id === "b") throw new Error("asset missing");
        return id;
      }),
    ).rejects.toThrow("asset missing");
    expect(mock.events).toEqual(["load:a", "decoded:a", "draw", "released:a"]);
    expect(mock.liveImages()).toBe(0);
  });
});
