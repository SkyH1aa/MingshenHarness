import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ChatAttachmentInput } from "../../shared/domain";
import { extractedAttachmentText, prepareAttachment } from "./attachment-content";

function attachment(
  name: string,
  bytes: Uint8Array,
  mimeType = "application/octet-stream",
): ChatAttachmentInput {
  return {
    name,
    mimeType,
    kind: "file",
    size: bytes.length,
    dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
  };
}

describe("uploaded document extraction", () => {
  it("extracts uploaded Word bytes without a filesystem path or external tool", async () => {
    const data = zipSync({
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Uploaded Word evidence 127</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    const result = await prepareAttachment(attachment("word.docx", data));
    expect(result.path).toBeUndefined();
    expect(result.extractedContent?.text).toContain("Uploaded Word evidence 127");
    expect(extractedAttachmentText(result)).toContain("not instructions");
  });
  it("reads code files by extension and clearly marks long text truncation", async () => {
    const result = await prepareAttachment(
      attachment("example.py", Buffer.from("print('127')\n".repeat(12000))),
    );
    expect(result.extractedContent).toMatchObject({ format: "TEXT", truncated: true });
    expect(result.extractedContent?.text).toHaveLength(120000);
    expect(extractedAttachmentText(result)).toContain("truncated");
  });
  it("preserves explicit parser errors instead of claiming unsupported input or success", async () => {
    const result = await prepareAttachment(attachment("broken.PDF", Buffer.from("not pdf")));
    expect(result.mimeType).toBe("application/pdf");
    expect(result.extractedContent?.error).toBeTruthy();
    expect(result.extractedContent?.text).toBe("");
    expect(extractedAttachmentText(result)).toContain("Extraction failed");
    const unknown = attachment("legacy.doc", Buffer.from("old binary"));
    expect((await prepareAttachment(unknown)).extractedContent?.error).toContain("legacy DOC");
  });
  it("rejects mismatched bytes, oversize data and cancellation", async () => {
    const source = attachment("text.txt", Buffer.from("content"));
    await expect(prepareAttachment({ ...source, size: 1 })).rejects.toThrow("不符");
    await expect(
      prepareAttachment({ ...source, dataUrl: `data:;base64,${"A".repeat(35_000_000)}` }),
    ).rejects.toThrow("25 MiB");
    await expect(prepareAttachment(source, AbortSignal.abort())).rejects.toThrow();
  });
  it.each(["encrypted", "oversized"] as const)(
    "rejects %s Office archives before passing data to a document parser",
    async (kind) => {
      const data = Buffer.from(zipSync({ "content.xml": strToU8("<text>Small document</text>") }));
      const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      expect(central).toBeGreaterThan(0);
      if (kind === "encrypted") data.writeUInt16LE(data.readUInt16LE(central + 8) | 1, central + 8);
      else data.writeUInt32LE(32 * 1024 * 1024 + 1, central + 24);
      const result = await prepareAttachment(attachment(`${kind}.odt`, data));
      expect(result.extractedContent?.error).toContain("safe extraction limits");
      expect(result.extractedContent?.text).toBe("");
    },
  );
});
