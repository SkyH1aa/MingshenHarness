import { describe, expect, it } from "vitest";
import { clipboardImages, namedClipboardImage } from "./clipboard-images";

function transfer(files: File[], items: Partial<DataTransferItem>[] = []): DataTransfer {
  return { files, items } as unknown as DataTransfer;
}

describe("composer clipboard images", () => {
  it("extracts all images once when files and items expose the same clipboard image", () => {
    const image = new File(["png bytes"], "image.png", { type: "image/png" });
    const other = new File(["text"], "notes.txt", { type: "text/plain" });
    expect(
      clipboardImages(
        transfer([image, other], [{ kind: "file", type: "image/png", getAsFile: () => image }]),
      ),
    ).toEqual([image]);
  });
  it("falls back to clipboard items and ignores strings, non-images and unavailable files", () => {
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.jpg", { type: "image/jpeg" });
    expect(
      clipboardImages(
        transfer(
          [],
          [
            { kind: "string", type: "text/html" },
            { kind: "file", type: "application/pdf", getAsFile: () => null },
            { kind: "file", type: "image/png", getAsFile: () => first },
            { kind: "file", type: "image/jpeg", getAsFile: () => second },
            { kind: "file", type: "image/png", getAsFile: () => null },
          ],
        ),
      ),
    ).toEqual([first, second]);
    expect(clipboardImages(transfer([]))).toEqual([]);
  });
  it("gives separate pasted images distinct names without changing their bytes or media type", async () => {
    const image = new File([new Uint8Array([1, 2, 3])], "image.png", {
      type: "image/png",
      lastModified: 123,
    });
    const first = namedClipboardImage(image);
    const second = namedClipboardImage(image);
    expect(first.name).toMatch(/^clipboard-[\da-f-]+\.png$/);
    expect(second.name).not.toBe(first.name);
    expect(first.type).toBe("image/png");
    expect(first.size).toBe(3);
    expect(first.lastModified).toBe(123);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("infers a missing image extension without reading or resizing the image", () => {
    const image = namedClipboardImage(new File(["jpeg"], "", { type: "image/jpeg" }));
    expect(image.name).toMatch(/\.jpg$/);
    expect(image.type).toBe("image/jpeg");
  });
});
