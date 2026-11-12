import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareAttachment } from "./attachment-content";
import { extractDocumentBuffer } from "./document-extractor";

const { scannedPdf } = createRequire(import.meta.url)(
  resolve("../../scripts/fixtures/document-fixtures.cjs"),
) as {
  scannedPdf: (options?: { pages?: number; mixed?: boolean; handwriting?: boolean }) => Buffer;
};
const attachment = (bytes: Buffer) => ({
  name: "scan.pdf",
  mimeType: "application/pdf",
  kind: "file" as const,
  size: bytes.length,
  dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
});

describe("PDF vision and bundled offline OCR", () => {
  it("reads a genuine legacy binary DOC, including Unicode, without Office", async () => {
    const bytes = await readFile(resolve("../../scripts/fixtures/legacy-word-test01.doc"));
    const result = await extractDocumentBuffer(bytes, "legacy.doc");
    expect(result.text).toContain("Unicode characters");
    expect(result.text).toContain("😀 ∀");
    expect(result.format).toBe("DOC");
  });
  it("recognizes scanned English and Chinese offline, including image pages with a text title", async () => {
    const result = await extractDocumentBuffer(scannedPdf({ mixed: true }), "mixed.pdf");
    expect(result.pdf?.ocrPages).toBe(1);
    expect(result.text).toContain("Mixed page digital title");
    expect(result.text).toMatch(/Offline PDF scan evidence 127/i);
    expect(result.text.replace(/\s/g, "")).toContain("中文扫描文档测试");
    expect(result.warnings.join(" ")).toContain("Handwriting");
  }, 30000);
  it("renders handwritten/scan pages as actual image bytes and caps partial visual coverage", async () => {
    const result = await extractDocumentBuffer(
      scannedPdf({ pages: 21, handwriting: true }),
      "handwriting.pdf",
      undefined,
      "vision",
    );
    expect(result.pageImages).toHaveLength(20);
    const image = Buffer.from(result.pageImages?.[0]?.dataUrl.split(",")[1] ?? "", "base64");
    expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(result.pdf?.totalPages).toBe(21);
    expect(result.warnings.join(" ")).toContain("20 of 21");
  }, 30000);
  it("regenerates derived content when switching from native PDF to vision or OCR", async () => {
    const original = attachment(scannedPdf());
    const native = await prepareAttachment(original, undefined, "native");
    expect(native.extractedContent?.pdf?.ocrPages).toBe(0);
    const vision = await prepareAttachment(native, undefined, "vision");
    expect(vision.documentPageImages).toHaveLength(1);
    const { documentPageImages: _images, ...saved } = vision;
    expect((await prepareAttachment(saved, undefined, "vision")).documentPageImages).toHaveLength(
      1,
    );
    const ocr = await prepareAttachment(vision, undefined, "ocr");
    expect(ocr.extractedContent?.text).toContain("Offline PDF");
    expect(ocr.documentPageImages).toBeUndefined();
  }, 30000);
  it("cancels parsing without returning or caching a partial result", async () => {
    const source = attachment(scannedPdf({ pages: 3 }));
    const controller = new AbortController();
    const pending = prepareAttachment(source, controller.signal, "ocr");
    setTimeout(() => controller.abort(new Error("Stop document processing")), 100);
    await expect(pending).rejects.toThrow("Stop document processing");
    expect(
      (await prepareAttachment(source, undefined, "native")).extractedContent?.error,
    ).toBeUndefined();
  }, 10000);
});
