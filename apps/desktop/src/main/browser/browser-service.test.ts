import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserService } from "./browser-service";

const mocks = vi.hoisted(() => ({
  fromId: vi.fn(),
  afterWrite: null as (() => void) | null,
}));

vi.mock("electron", () => ({
  webContents: { fromId: mocks.fromId },
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    writeFile: vi.fn(async (...args: Parameters<typeof fs.writeFile>) => {
      await fs.writeFile(...args);
      mocks.afterWrite?.();
    }),
  };
});

interface ImageFixture {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toPNG(): Buffer;
  resize(options: { width: number; height: number; quality: string }): ImageFixture;
}

function imageFixture(
  size = { width: 800, height: 600 },
  png = Buffer.from("mock PNG bytes"),
): ImageFixture {
  return {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => size),
    toPNG: vi.fn(() => png),
    resize: vi.fn((options) => imageFixture({ width: options.width, height: options.height }, png)),
  };
}

function guestFixture(image: ImageFixture) {
  return {
    id: 23,
    getType: vi.fn(() => "webview"),
    isDestroyed: vi.fn(() => false),
    getURL: vi.fn(() => "https://example.test/screenshot"),
    getTitle: vi.fn(() => "Screenshot fixture"),
    executeJavaScript: vi.fn(async () => "complete"),
    on: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
    capturePage: vi.fn(async () => image),
  };
}

describe("browser screenshot tool results", () => {
  let root: string;
  let service: BrowserService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mingshen-browser-screenshot-test-"));
    service = new BrowserService(root, vi.fn());
    mocks.afterWrite = null;
    mocks.fromId.mockReset();
  });

  afterEach(async () => {
    service.dispose();
    mocks.afterWrite = null;
    await rm(root, { recursive: true, force: true });
  });

  async function register(image = imageFixture()) {
    const guest = guestFixture(image);
    mocks.fromId.mockReturnValue(guest);
    await service.register("session", "edge", guest.id);
    return guest;
  }

  it("saves PNG bytes and returns pixels as a tool image", async () => {
    const png = Buffer.from("exact screenshot bytes");
    const image = imageFixture({ width: 800, height: 600 }, png);
    await register(image);

    const result = await service.execute("session", "browser_screenshot", {});
    expect(result).toMatchObject({
      isError: false,
      images: [
        {
          dataUrl: `data:image/png;base64,${png.toString("base64")}`,
          mimeType: "image/png",
          alt: "Browser screenshot",
        },
      ],
    });
    expect(result.output).toContain("800 × 600");
    expect(image.resize).not.toHaveBeenCalled();
    const files = await readdir(root);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^browser-[\da-f-]+\.png$/);
    expect(await readFile(join(root, files[0] ?? ""))).toEqual(png);
    expect(result.output).toContain(join(root, files[0] ?? ""));
  });

  it.each([
    [
      { width: 4096, height: 2000 },
      { width: 2048, height: 1000 },
    ],
    [
      { width: 100, height: 4096 },
      { width: 50, height: 2048 },
    ],
  ])("preserves aspect ratio while bounding a large capture: %o", async (size, expected) => {
    const image = imageFixture(size);
    await register(image);

    const result = await service.execute("session", "browser_screenshot", {});
    expect(result.isError).toBe(false);
    expect(image.resize).toHaveBeenCalledExactlyOnceWith({ ...expected, quality: "best" });
    expect(result.output).toContain(`${expected.width} × ${expected.height}`);
    expect(result.images).toHaveLength(1);
  });

  it("rejects an empty NativeImage without creating a file", async () => {
    const image = imageFixture();
    vi.mocked(image.isEmpty).mockReturnValue(true);
    await register(image);

    const result = await service.execute("session", "browser_screenshot", {});
    expect(result.isError).toBe(true);
    expect(result.output).toContain("有效截图");
    expect(result.images).toBeUndefined();
    expect(image.toPNG).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it.each([0, 8 * 1024 * 1024 + 1])(
    "rejects invalid encoded screenshot size %i without a partial file",
    async (bytes) => {
      await register(imageFixture(undefined, Buffer.alloc(bytes)));

      const result = await service.execute("session", "browser_screenshot", {});
      expect(result.isError).toBe(true);
      expect(result.output).toContain("8 MiB");
      expect(result.images).toBeUndefined();
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("accepts the 8 MiB encoded size boundary", async () => {
    const png = Buffer.alloc(8 * 1024 * 1024);
    await register(imageFixture(undefined, png));

    const result = await service.execute("session", "browser_screenshot", {});
    expect(result.isError).toBe(false);
    expect(result.images?.[0]?.dataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(await readdir(root)).toHaveLength(1);
  });

  it("does not capture when the request was already cancelled", async () => {
    const guest = await register();
    const controller = new AbortController();
    controller.abort(new Error("cancelled before capture"));

    const result = await service.execute("session", "browser_screenshot", {}, controller.signal);
    expect(result).toEqual({ isError: true, output: "cancelled before capture" });
    expect(guest.capturePage).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it("does not encode or save a capture completed after cancellation", async () => {
    const image = imageFixture();
    const guest = await register(image);
    const controller = new AbortController();
    guest.capturePage.mockImplementation(async () => {
      controller.abort(new Error("cancelled during capture"));
      return image;
    });

    const result = await service.execute("session", "browser_screenshot", {}, controller.signal);
    expect(result).toEqual({ isError: true, output: "cancelled during capture" });
    expect(image.toPNG).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it("removes its newly written screenshot when cancellation arrives after the write", async () => {
    await register();
    const controller = new AbortController();
    mocks.afterWrite = () => controller.abort(new Error("cancelled after write"));

    const result = await service.execute("session", "browser_screenshot", {}, controller.signal);
    expect(result).toEqual({ isError: true, output: "cancelled after write" });
    expect(await readdir(root)).toEqual([]);
  });

  it("requires a live registered webview", async () => {
    const result = await service.execute("unknown", "browser_screenshot", {});
    expect(result.isError).toBe(true);
    expect(result.images).toBeUndefined();
    expect(await readdir(root)).toEqual([]);

    const guest = guestFixture(imageFixture());
    guest.getType.mockReturnValue("window");
    mocks.fromId.mockReturnValue(guest);
    await expect(service.register("invalid", "edge", guest.id)).rejects.toThrow("WebContents");
    expect(guest.capturePage).not.toHaveBeenCalled();
  });
});
