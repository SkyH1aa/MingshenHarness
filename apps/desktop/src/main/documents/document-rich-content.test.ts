import { DOMParser } from "@xmldom/xmldom";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { authorOfficeDocument, renderDocumentHtml } from "./document-author";
import { documentAuthoringSchema } from "./document-authoring-schema";
import { extractDocumentBuffer } from "./document-extractor";
import { documentMarkdown, equationSource, nativeEquation } from "./document-rich-content";
import { validateTemplatePlaceholders } from "./document-template";
import { embedWorkbookInDocx, xlsxWithExternalLinkFixture } from "./office-package-test-fixtures";

const xml = (bytes: Buffer, path = "word/document.xml") =>
  strFromU8(unzipSync(bytes)[path] ?? new Uint8Array());
const generate = (blocks: unknown[], extras = {}) =>
  authorOfficeDocument(
    documentAuthoringSchema.parse({ path: "report.docx", blocks, ...extras }),
    new Map(),
  );

describe("expanded document authoring", () => {
  it("preserves repeatable defaults and exposes a JSON schema without template layout overrides", () => {
    const normal = documentAuthoringSchema.parse({
      path: "new.docx",
      blocks: [{ type: "paragraph", text: "Text" }],
    });
    expect(normal.page_size).toBe("Letter");
    expect(normal.orientation).toBe("portrait");
    expect(documentAuthoringSchema.parse(normal)).toEqual(normal);
    const template = documentAuthoringSchema.parse({
      path: "filled.docx",
      template: {
        path: "template.docx",
        replacements: [{ placeholder: "body", blocks: [{ type: "paragraph", text: "Text" }] }],
      },
    });
    expect(template.page_size).toBeUndefined();
    expect(template.orientation).toBeUndefined();
    expect(documentAuthoringSchema.parse(template)).toEqual(template);
    expect(() => z.toJSONSchema(documentAuthoringSchema, { target: "draft-7" })).not.toThrow();
    for (const layout of [{ page_size: "A4" }, { orientation: "landscape" }]) {
      expect(() => documentAuthoringSchema.parse({ ...template, ...layout })).toThrow(
        "模板保留原有版式",
      );
    }
  });

  it("fits template images and charts to the template body without changing section geometry", async () => {
    const template = await Packer.toBuffer(
      new Document({
        sections: [
          {
            properties: {
              page: {
                size: { width: 7200, height: 10080 },
                margin: { top: 720, bottom: 720, left: 720, right: 720, gutter: 360 },
              },
            },
            children: [
              new Paragraph("Keep before"),
              new Paragraph("{{body}}"),
              new Paragraph("Keep after"),
            ],
          },
        ],
      }),
    );
    const request = documentAuthoringSchema.parse({
      path: "filled.docx",
      template: {
        path: "template.docx",
        replacements: [
          {
            placeholder: "body",
            blocks: [
              { type: "image", path: "pixel.png" },
              {
                type: "chart",
                chart_type: "bar",
                categories: ["A", "B"],
                series: [{ name: "Value", values: [1, 2] }],
              },
            ],
          },
        ],
      },
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const output = await authorOfficeDocument(
      request,
      new Map([["pixel.png", png]]),
      undefined,
      template,
    );
    const content = xml(output);
    expect(content).toContain("Keep before");
    expect(content).toContain("Keep after");
    expect(content.match(/<w:pgSz[^>]+>/)?.[0]).toBe(xml(template).match(/<w:pgSz[^>]+>/)?.[0]);
    expect(content.match(/<w:pgMar[^>]+>/)?.[0]).toBe(xml(template).match(/<w:pgMar[^>]+>/)?.[0]);
    const parsed = new DOMParser().parseFromString(content, "text/xml");
    const extents = Array.from(
      parsed.getElementsByTagNameNS(
        "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        "extent",
      ),
    );
    expect(extents).toHaveLength(2);
    for (const extent of extents) {
      expect(Number(extent.getAttribute("cx"))).toBeLessThanOrEqual(3.75 * 914400);
      expect(Number(extent.getAttribute("cy"))).toBeLessThanOrEqual(5.7 * 914400);
    }
  });

  it.each(["table", "multiple-sections", "columns", "missing-size", "missing-margins"])(
    "rejects ambiguous media geometry in %s templates while allowing text",
    async (layout) => {
      const template = await Packer.toBuffer(
        new Document({
          sections: [{ children: [new Paragraph("{{body}}")] }],
        }),
      );
      const archive = unzipSync(template);
      let content = xml(template);
      if (layout === "table")
        content = content
          .replace("<w:p>", "<w:tbl><w:tr><w:tc><w:p>")
          .replace("</w:p>", "</w:p></w:tc></w:tr></w:tbl>");
      if (layout === "multiple-sections")
        content = content.replace("<w:body>", "<w:body><w:p><w:pPr><w:sectPr/></w:pPr></w:p>");
      if (layout === "columns")
        content = content.replace("<w:sectPr>", '<w:sectPr><w:cols w:num="2"/>');
      if (layout === "missing-size") content = content.replace(/<w:pgSz[^>]+\/>/, "");
      if (layout === "missing-margins") content = content.replace(/<w:pgMar[^>]+\/>/, "");
      archive["word/document.xml"] = strToU8(content);
      const bytes = Buffer.from(zipSync(archive));
      await expect(
        validateTemplatePlaceholders(bytes, ["body"], new Set(["body"])),
      ).rejects.toThrow("TEMPLATE_MEDIA_LAYOUT_UNSUPPORTED");
      await expect(validateTemplatePlaceholders(bytes, ["body"])).resolves.toEqual(new Map());
    },
  );

  it.each(["bookmarkStart", "sectPr", "fldSimple", "commentRangeStart"])(
    "preserves protected template structures by rejecting %s anchors",
    async (tag) => {
      const template = await Packer.toBuffer(
        new Document({ sections: [{ children: [new Paragraph("{{body}}")] }] }),
      );
      const archive = unzipSync(template);
      archive["word/document.xml"] = strToU8(xml(template).replace("<w:t", `<w:${tag}/><w:t`));
      await expect(
        validateTemplatePlaceholders(Buffer.from(zipSync(archive)), ["body"]),
      ).rejects.toThrow("TEMPLATE_PLACEHOLDER_INVALID");
    },
  );

  it("rejects a placeholder inside a tracked insertion ancestor", async () => {
    const template = await Packer.toBuffer(
      new Document({ sections: [{ children: [new Paragraph("{{body}}")] }] }),
    );
    const archive = unzipSync(template);
    archive["word/document.xml"] = strToU8(
      xml(template).replace("<w:body>", "<w:body><w:ins>").replace("</w:p>", "</w:p></w:ins>"),
    );
    await expect(
      validateTemplatePlaceholders(Buffer.from(zipSync(archive)), ["body"]),
    ).rejects.toThrow("TEMPLATE_PLACEHOLDER_INVALID");
  });
  it.each([
    String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}`,
    String.raw`\sum_{i=1}^{n} i^2`,
    String.raw`\int_0^1 x^2\,dx`,
    String.raw`A=\begin{pmatrix}1&2\\3&4\end{pmatrix}`,
    String.raw`\begin{cases}x&x\ge0\\-x&x<0\end{cases}`,
    String.raw`\begin{aligned}y&=mx+b\\y'&=m\end{aligned}`,
  ])("writes actual OMML, not images: %s", async (latex) => {
    const bytes = await generate([{ type: "equation", latex }]);
    const content = xml(bytes);
    expect(content).toContain("<m:oMath>");
    expect(content).not.toContain("<w:drawing");
    const parsed = new DOMParser().parseFromString(content, "text/xml");
    expect(parsed.getElementsByTagName("parsererror").length).toBe(0);
    const read = await extractDocumentBuffer(bytes, "report.docx");
    expect(read.text).toContain("Equation 1 (OMML");
  });

  it("supports all four math delimiters and leaves ordinary brackets intact", () => {
    for (const value of ["$x^2$", "$$x^2$$", String.raw`\(x^2\)`, String.raw`\[x^2\]`])
      expect(equationSource(value)).toBe("x^2");
    expect(equationSource("(x+1)")).toBe("(x+1)");
  });

  it("converts Markdown formatting, nested numbering, tables, links and inline math", async () => {
    const bytes = await generate([
      {
        type: "markdown",
        text: "# Report\n\n**Bold** and *italic* with $x^2$.\n\n1. First\n   1. Nested\n2. Second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[Source](https://example.com)\n\n```tex\n$literal$\n```\n\n> Quote\n",
      },
    ]);
    const content = xml(bytes);
    expect(content).toContain("<m:sSup>");
    expect(content).toContain("<w:numPr>");
    expect(content).toContain("<w:tbl>");
    expect(content).toContain("$literal$");
    expect(xml(bytes, "word/_rels/document.xml.rels")).toContain("https://example.com");
    expect((await extractDocumentBuffer(bytes, "report.docx")).text).toContain("Report");
    const parsed = new DOMParser().parseFromString(content, "text/xml");
    const paragraph = Array.from(parsed.getElementsByTagName("w:p")).find((item) =>
      item.textContent?.startsWith("Bold"),
    );
    expect(paragraph?.textContent).toBe("Bold and italic with x2.");
    const withText = Array.from(parsed.getElementsByTagName("w:t")).find(
      (item) => item.textContent === " with ",
    );
    expect(withText?.getAttribute("xml:space")).toBe("preserve");
  });

  it("writes native rich text, footnotes, TOC, headers, footer and page-number fields", async () => {
    const bytes = await generate(
      [
        { type: "table_of_contents" },
        { type: "heading", text: "Chapter", level: 1 },
        {
          type: "rich_paragraph",
          runs: [
            { type: "text", text: "Bold", bold: true, link: "https://example.com" },
            { type: "equation", latex: String.raw`\frac{1}{2}` },
            { type: "footnote", text: "Native note" },
          ],
        },
      ],
      {
        header: "Header",
        footer: "Footer",
        page_numbers: true,
        margins: { top: 0.8, bottom: 0.8, left: 0.7, right: 0.7 },
      },
    );
    expect(xml(bytes)).toContain("TOC");
    expect(xml(bytes, "word/footnotes.xml")).toContain("Native note");
    expect(xml(bytes, "word/header1.xml")).toContain("Header");
    const footer = xml(bytes, "word/footer1.xml");
    expect(footer).toContain("PAGE");
    expect(footer).toContain("NUMPAGES");
  });

  it.each(["docx", "pptx"])("writes a chart and embedded workbook in %s", async (format) => {
    const block = {
      type: "chart",
      chart_type: "bar",
      categories: ["Long label A", "B"],
      series: [{ name: "Values", values: [-2, 4] }],
    };
    const request = documentAuthoringSchema.parse({
      path: `chart.${format}`,
      ...(format === "docx" ? { blocks: [block] } : { slides: [{ blocks: [block] }] }),
    });
    const bytes = await authorOfficeDocument(request, new Map());
    const archive = unzipSync(bytes);
    expect(Object.keys(archive).some((path) => /charts\/chart.*\.xml$/.test(path))).toBe(true);
    expect(Object.keys(archive).some((path) => /embeddings\/.*\.xlsx$/.test(path))).toBe(true);
  });

  it.each(["docx", "pptx"])("includes zero on an all-negative bar chart in %s", async (format) => {
    const block = {
      type: "chart",
      chart_type: "bar",
      categories: ["A", "B"],
      series: [{ name: "Change", values: [-5, -2] }],
    };
    const request = documentAuthoringSchema.parse({
      path: `negative.${format}`,
      ...(format === "docx" ? { blocks: [block] } : { slides: [{ blocks: [block] }] }),
    });
    const archive = unzipSync(await authorOfficeDocument(request, new Map()));
    const chart = Object.entries(archive).find(([path]) => /charts\/chart.*\.xml$/.test(path));
    const content = strFromU8(chart?.[1] ?? new Uint8Array());
    expect(content).toContain('<c:min val="-5"/>');
    expect(content).toContain('<c:max val="0"/>');
  });

  it("fills a split-run template placeholder and preserves surrounding text", async () => {
    const template = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph("Keep before"),
              new Paragraph({ children: [new TextRun("{{bo"), new TextRun("dy}}")] }),
              new Paragraph("Keep after"),
            ],
          },
        ],
      }),
    );
    const request = documentAuthoringSchema.parse({
      path: "filled.docx",
      template: {
        path: "template.docx",
        replacements: [
          { placeholder: "body", blocks: [{ type: "equation", latex: String.raw`\sqrt{x}` }] },
        ],
      },
    });
    const output = await authorOfficeDocument(request, new Map(), undefined, template);
    expect(xml(output)).toContain("Keep before");
    expect(xml(output)).toContain("Keep after");
    expect(xml(output)).toContain("<m:rad>");
    expect(xml(output)).not.toContain("{{bo");
    const missing = documentAuthoringSchema.parse({
      ...request,
      template: {
        ...request.template,
        replacements: [{ placeholder: "missing", blocks: [{ type: "paragraph", text: "bad" }] }],
      },
    });
    await expect(authorOfficeDocument(missing, new Map(), undefined, template)).rejects.toThrow(
      "TEMPLATE_PLACEHOLDER_INVALID",
    );
  });

  it.each([
    {
      label: "external image relationship",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: "https://example.com/tracker.png",
      external: true,
      error: "DOCX_EXTERNAL_RELATIONSHIP_UNSUPPORTED",
    },
    {
      label: "external image with missing TargetMode",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: "https://example.com/tracker.png",
      external: false,
      error: "DOCX_EXTERNAL_RELATIONSHIP_UNSUPPORTED",
    },
    {
      label: "attached template relation",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate",
      target: "file:///C:/outside/template.docx",
      external: true,
      error: "DOCX_ACTIVE_CONTENT_UNSUPPORTED",
    },
    {
      label: "OLE package relation",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package",
      target: "embeddings/oleObject1.bin",
      external: false,
      error: "DOCX_ACTIVE_CONTENT_UNSUPPORTED",
    },
    {
      label: "altChunk relation",
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk",
      target: "afchunk.html",
      external: false,
      error: "DOCX_ACTIVE_CONTENT_UNSUPPORTED",
    },
  ])("rejects unsafe DOCX $label", async ({ type, target, external, error }) => {
    const archive = unzipSync(await generate([{ type: "paragraph", text: "{{body}}" }]));
    const relationshipPath = "word/_rels/document.xml.rels";
    const relationshipBytes = archive[relationshipPath];
    if (!relationshipBytes) throw new Error("Missing generated relationships.");
    const relationships = new DOMParser().parseFromString(strFromU8(relationshipBytes), "text/xml");
    const relationship = relationships.createElementNS(
      "http://schemas.openxmlformats.org/package/2006/relationships",
      "Relationship",
    );
    relationship.setAttribute("Id", "rIdUnsafeFixture");
    relationship.setAttribute("Type", type);
    relationship.setAttribute("Target", target);
    if (external) relationship.setAttribute("TargetMode", "External");
    relationships.documentElement.appendChild(relationship);
    archive[relationshipPath] = strToU8(relationships.toString());
    await expect(
      validateTemplatePlaceholders(Buffer.from(zipSync(archive)), ["body"]),
    ).rejects.toThrow(error);
  });

  it.each([
    ["OLE object element", "<w:p><w:r><w:object/></w:r></w:p>"],
    ["altChunk element", '<w:altChunk r:id="rIdUnsafeFixture"/>'],
    [
      "external-content field",
      '<w:p><w:fldSimple w:instr="INCLUDETEXT &quot;https://example.com/remote.doc&quot;"/></w:p>',
    ],
  ])("rejects DOCX %s outside editable paragraphs", async (_label, unsafeXml) => {
    const archive = unzipSync(await generate([{ type: "paragraph", text: "{{body}}" }]));
    const content = xml(Buffer.from(zipSync(archive)));
    archive["word/document.xml"] = strToU8(content.replace("</w:body>", `${unsafeXml}</w:body>`));
    await expect(
      validateTemplatePlaceholders(Buffer.from(zipSync(archive)), ["body"]),
    ).rejects.toThrow("DOCX_ACTIVE_");
  });

  it.each([
    ["INCLUDE", "TEXT"],
    ["INCLUDE", "PICTURE"],
    ["DDE", "AUTO"],
    ["DATA", "BASE"],
    ["LI", "NK"],
    ["EM", "BED"],
    ["MACRO", "BUTTON"],
  ])("rejects an active DOCX field split as %s%s across instruction runs", async (left, right) => {
    const archive = unzipSync(await generate([{ type: "paragraph", text: "{{body}}" }]));
    const content = xml(Buffer.from(zipSync(archive)));
    const splitField =
      "<w:p>" +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      `<w:r><w:instrText xml:space="preserve"> ${left}</w:instrText></w:r>` +
      `<w:r><w:instrText xml:space="preserve">${right} &quot;fixture&quot;</w:instrText></w:r>` +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      "<w:r><w:t>Field</w:t></w:r>" +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
      "</w:p>";
    archive["word/document.xml"] = strToU8(content.replace("</w:body>", `${splitField}</w:body>`));
    await expect(
      validateTemplatePlaceholders(Buffer.from(zipSync(archive)), ["body"]),
    ).rejects.toThrow("DOCX_ACTIVE_FIELD_UNSUPPORTED");
  });

  it.each([
    ["content-type", "application/vnd.ms-word.document.macroEnabled.main+xml"],
    ["content-type", "application/vnd.openxmlformats-package.digital-signature-xmlsignature+xml"],
    ["relationship", "http://schemas.microsoft.com/office/2006/relationships/vbaProject"],
    [
      "relationship",
      "http://schemas.openxmlformats.org/package/2006/relationships/digital-signature/signature",
    ],
  ])("rejects renamed protected template parts declared by %s: %s", async (kind, type) => {
    const archive = unzipSync(await generate([{ type: "paragraph", text: "{{body}}" }]));
    const isContentType = kind === "content-type";
    const path = isContentType ? "[Content_Types].xml" : "word/_rels/document.xml.rels";
    const namespace = isContentType
      ? "http://schemas.openxmlformats.org/package/2006/content-types"
      : "http://schemas.openxmlformats.org/package/2006/relationships";
    const part = archive[path];
    if (!part) throw new Error(`Missing generated template part: ${path}`);
    const parsed = new DOMParser().parseFromString(strFromU8(part), "text/xml");
    const declaration = parsed.createElementNS(
      namespace,
      isContentType ? "Override" : "Relationship",
    );
    declaration.setAttribute(isContentType ? "ContentType" : "Type", type);
    if (isContentType) declaration.setAttribute("PartName", "/word/custom.bin");
    else {
      declaration.setAttribute("Id", "rIdProtectedFixture");
      declaration.setAttribute("Target", "custom.bin");
    }
    parsed.documentElement.appendChild(declaration);
    archive[path] = strToU8(parsed.toString());
    archive["word/custom.bin"] = strToU8("Synthetic declaration fixture, no executable content.");
    await expect(
      validateTemplatePlaceholders(Buffer.from(zipSync(archive)), ["body"]),
    ).rejects.toThrow("Signed or macro-enabled templates");
  });

  it("rejects external-link workbooks before validating DOCX template placeholders", async () => {
    const template = embedWorkbookInDocx(
      await generate([{ type: "paragraph", text: "{{body}}" }]),
      xlsxWithExternalLinkFixture(),
    );
    await expect(validateTemplatePlaceholders(template, ["body"])).rejects.toThrow(
      "OFFICE_UNSUPPORTED_PART",
    );
  });

  it.each(["docx", "pptx"])("labels pie categories with a native legend in %s", async (format) => {
    const block = {
      type: "chart",
      chart_type: "pie",
      categories: ["Engineering", "Operations"],
      series: [{ name: "Budget", values: [2, 5] }],
    };
    const request = documentAuthoringSchema.parse({
      path: `pie.${format}`,
      ...(format === "docx" ? { blocks: [block] } : { slides: [{ blocks: [block] }] }),
    });
    const archive = unzipSync(await authorOfficeDocument(request, new Map()));
    const chart = Object.entries(archive).find(([path]) => /charts\/chart.*\.xml$/.test(path));
    expect(chart).toBeDefined();
    expect(strFromU8(chart?.[1] ?? new Uint8Array())).toContain("<c:legend>");
  });

  it("keeps template chart, workbook, hyperlink, footnote and numbering relationships", async () => {
    const template = await generate([
      { type: "paragraph", text: "Keep before" },
      { type: "paragraph", text: "{{body}}" },
      {
        type: "rich_paragraph",
        runs: [
          { type: "text", text: "Existing" },
          { type: "footnote", text: "Existing note" },
        ],
      },
    ]);
    const request = documentAuthoringSchema.parse({
      path: "filled.docx",
      template: {
        path: "template.docx",
        replacements: [
          {
            placeholder: "body",
            blocks: [
              {
                type: "chart",
                chart_type: "column",
                categories: ["A", "B"],
                series: [{ name: "Values", values: [2, 5] }],
              },
              {
                type: "rich_paragraph",
                runs: [
                  { type: "text", text: "Source", link: "https://example.com/new" },
                  { type: "footnote", text: "Added note" },
                ],
              },
              { type: "list", ordered: true, items: ["First", "Second"] },
            ],
          },
        ],
      },
    });
    const output = await authorOfficeDocument(request, new Map(), undefined, template);
    const archive = unzipSync(output);
    expect(xml(output)).toContain("Keep before");
    expect(xml(output)).toContain("<w:numPr>");
    expect(xml(output, "word/footnotes.xml")).toContain("Existing note");
    expect(xml(output, "word/footnotes.xml")).toContain("Added note");
    expect(xml(output, "word/_rels/document.xml.rels")).toContain("https://example.com/new");
    expect(Object.keys(archive).some((path) => /charts\/chart.*\.xml$/.test(path))).toBe(true);
    expect(Object.keys(archive).some((path) => /embeddings\/.*\.xlsx$/.test(path))).toBe(true);
    for (const [path, bytes] of Object.entries(archive).filter(([name]) =>
      name.endsWith(".rels"),
    )) {
      const parsed = new DOMParser().parseFromString(strFromU8(bytes), "text/xml");
      const ids = Array.from(parsed.getElementsByTagName("Relationship")).map((node) =>
        node.getAttribute("Id"),
      );
      expect(new Set(ids).size, path).toBe(ids.length);
    }
  });

  it("rejects empty rich paragraphs", () => {
    expect(() =>
      documentAuthoringSchema.parse({
        path: "empty.docx",
        blocks: [{ type: "rich_paragraph", runs: [{ type: "text", text: "  " }] }],
      }),
    ).toThrow();
  });

  it("renders offline PDF math as MathML and escapes active Markdown content", () => {
    const request = documentAuthoringSchema.parse({
      path: "math.pdf",
      blocks: [
        {
          type: "markdown",
          text: "# PDF\n\n$x^2$ and **bold**\n\n$$x^2$$\n\n<script>alert(1)</script>",
        },
        { type: "equation", latex: String.raw`\frac{1}{2}`, align: "left" },
      ],
    });
    const html = renderDocumentHtml(request, new Map());
    expect(html).toContain("<math");
    expect(html).toContain("<mfrac>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html.match(/class="document-equation"/g)).toHaveLength(2);
    expect(html).toContain('class="document-equation" style="text-align:left"');
    expect(html).toContain("break-inside: avoid");
  });

  it("fails clearly without rasterizing unsupported math or fetching Markdown resources", () => {
    expect(() => nativeEquation(String.raw`\unknowncommand{x}`)).toThrow(
      "NATIVE_EQUATION_UNSUPPORTED",
    );
    expect(() => nativeEquation(`${"{".repeat(65)}x${"}".repeat(65)}`)).toThrow("TOO_DEEP");
    expect(() => documentMarkdown("![remote](https://example.com/image.png)", "docx")).toThrow(
      "MARKDOWN_IMAGE",
    );
    expect(() => documentMarkdown("[active](javascript:alert(1))", "pdf")).toThrow("MARKDOWN_LINK");
    expect(() =>
      documentAuthoringSchema.parse({
        path: "a.pptx",
        slides: [{ blocks: [{ type: "equation", latex: "x^2" }] }],
      }),
    ).toThrow();
  });
});
