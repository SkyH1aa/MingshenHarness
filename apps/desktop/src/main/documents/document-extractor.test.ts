import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractDocumentText, validateDocumentArchive } from "./document-extractor";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeTempFile(name: string, data: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mingshen-doc-test-"));
  tempDirectories.push(directory);
  const path = join(directory, name);
  await writeFile(path, data);
  return path;
}

describe("extractDocumentText", () => {
  it("extracts DOCX text without PowerShell or external tools", async () => {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Hello DOCX extraction</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const docx = zipSync({
      "[Content_Types].xml": strToU8(`<?xml version="1.0"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        </Types>`),
      "_rels/.rels": strToU8(`<?xml version="1.0"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
        </Relationships>`),
      "word/document.xml": strToU8(documentXml),
    });
    const path = await makeTempFile("sample.docx", docx);

    const result = await extractDocumentText(path);
    expect(result.format).toBe("DOCX");
    expect(result.text).toContain("Hello DOCX extraction");
  });

  it("extracts PPTX slide text from the built-in ZIP reader", async () => {
    const pptx = zipSync({
      "ppt/presentation.xml": strToU8(
        '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
      ),
      "ppt/slides/slide1.xml": strToU8(`<?xml version="1.0"?>
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree><p:sp><p:txBody><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:r><a:t>Slide extraction works</a:t></a:r>
          </a:p></p:txBody></p:sp></p:spTree></p:cSld>
        </p:sld>`),
    });
    const path = await makeTempFile("sample.pptx", pptx);

    const result = await extractDocumentText(path);
    expect(result.text).toContain("Slide extraction works");
  });

  it("rejects a ZIP renamed as PPTX when no presentation or slides exist", async () => {
    const path = await makeTempFile(
      "not-a-presentation.pptx",
      zipSync({ mimetype: strToU8("application/zip") }),
    );
    await expect(extractDocumentText(path)).rejects.toThrow("Invalid PPTX");
  });

  it("extracts spreadsheet text through the bounded document worker", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Metric", "Value"],
        ["Revenue", 127],
      ]),
      "Summary",
    );
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const path = await makeTempFile("sample.xlsx", bytes);
    const result = await extractDocumentText(path);
    expect(result.format).toBe("XLSX");
    expect(result.text).toContain("Revenue");
    expect(result.text).toContain("127");
  });

  it("extracts ODT content through the bounded document worker", async () => {
    const bytes = zipSync({
      mimetype: strToU8("application/vnd.oasis.opendocument.text"),
      "content.xml": strToU8(
        '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>ODT worker evidence</text:p></office:text></office:body></office:document-content>',
      ),
    });
    const path = await makeTempFile("sample.odt", bytes);
    const result = await extractDocumentText(path);
    expect(result.format).toBe("ODT");
    expect(result.text).toContain("ODT worker evidence");
  });

  it("rejects archive entries that can escape a consumer extraction directory", async () => {
    const original = Buffer.from("0123456789.xml");
    const unsafeName = Buffer.from("../outside.xml");
    const archive = Buffer.from(zipSync({ [original.toString()]: strToU8("<root/>") }));
    let offset = archive.indexOf(original);
    while (offset >= 0) {
      unsafeName.copy(archive, offset);
      offset = archive.indexOf(original, offset + original.length);
    }
    await expect(validateDocumentArchive(archive)).rejects.toThrow(
      /invalid relative path|unsafe or duplicate entry path/,
    );
  });
});
