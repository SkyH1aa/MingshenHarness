import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { extractDocumentText } from "./document-extractor";

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
});
