import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { authorOfficeDocument, renderDocumentHtml } from "./document-author";
import { documentAuthoringSchema } from "./document-authoring-schema";
import { prepareDocxEdit, readDocxStructure } from "./document-edit";
import { embedWorkbookInDocx, xlsxWithExternalLinkFixture } from "./office-package-test-fixtures";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Required fixture value is missing.");
  return value;
};
const part = (bytes: Buffer, name = "word/document.xml") =>
  strFromU8(unzipSync(bytes)[name] ?? new Uint8Array());
const parse = (bytes: Buffer) => new DOMParser().parseFromString(part(bytes), "text/xml");
const generate = (request: unknown, source?: Buffer) =>
  authorOfficeDocument(documentAuthoringSchema.parse(request), new Map(), undefined, source);
const fixture = () =>
  generate({
    path: "old.docx",
    header: "UNCHANGED HEADER",
    footer: "UNCHANGED FOOTER",
    page_numbers: true,
    page_size: "A4",
    blocks: [
      { type: "heading", text: "Original report", level: 1 },
      {
        type: "rich_paragraph",
        runs: [
          { type: "text", text: "Before " },
          { type: "text", text: "old ", bold: true },
          { type: "text", text: "draft", italic: true },
          { type: "text", text: " after." },
        ],
      },
      { type: "paragraph", text: "Replace this section" },
      { type: "paragraph", text: "Remove this paragraph" },
      {
        type: "table",
        rows: [["Cell target", { blocks: [{ type: "equation", latex: "\\frac{1}{2}" }] }]],
      },
      { type: "paragraph", text: "Keep final paragraph" },
    ],
  });
const editSpec = (bytes: Buffer, operations: unknown[]) => ({
  path: "revised.docx",
  edit: { path: "old.docx", expected_sha256: hash(bytes), operations },
});

describe("localized DOCX editing", () => {
  it("indexes original body blocks and table-cell paragraphs with a source digest", async () => {
    const bytes = await fixture();
    const structure = await readDocxStructure(bytes);
    expect(structure.sha256).toBe(hash(bytes));
    const records = structure.text
      .split("\n")
      .slice(2)
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.block && !record.paragraph)).toHaveLength(6);
    expect(records.find((record) => record.text === "Cell target")).toMatchObject({
      paragraph: 5,
      block: 5,
      replace_text: true,
    });
    expect(records.find((record) => record.paragraph === 6)?.replace_text).toBe(false);
  });

  it("replaces split runs and table-cell text while retaining surrounding run formats and all other parts", async () => {
    const original = await fixture();
    const output = await generate(
      editSpec(original, [
        { type: "replace_text", paragraph: 2, old_text: "old draft", new_text: "revised" },
        { type: "replace_text", paragraph: 5, old_text: "target", new_text: "updated" },
      ]),
      original,
    );
    const document = parse(output);
    const paragraphs = Array.from(document.getElementsByTagNameNS(W, "p"));
    expect(paragraphs[1]?.textContent).toBe("Before revised after.");
    const boldRun = Array.from(required(paragraphs[1]).getElementsByTagNameNS(W, "r")).find(
      (run) => run.textContent === "revised",
    );
    expect(boldRun?.getElementsByTagNameNS(W, "b").length).toBe(1);
    expect(paragraphs[4]?.textContent).toBe("Cell updated");
    expect(document.getElementsByTagName("m:f").length).toBe(1);
    const archive = unzipSync(original);
    for (const [name, bytes] of Object.entries(archive))
      if (name !== "word/document.xml") expect(unzipSync(output)[name], name).toEqual(bytes);
    expect(part(original)).toContain("old ");
  });

  it("replaces an unmarked body section with rich content and preserves untouched headers and page geometry", async () => {
    const original = await fixture();
    const output = await generate(
      editSpec(original, [
        {
          type: "replace_blocks",
          start_block: 3,
          end_block: 4,
          blocks: [
            { type: "heading", text: "New section", level: 2 },
            { type: "equation", latex: "x^2+1" },
            { type: "table", column_widths: [1, 3], rows: [["Key", "Value"]] },
          ],
        },
      ]),
      original,
    );
    expect(part(output)).toContain("New section");
    expect(part(output)).not.toContain("Replace this section");
    expect(part(output)).not.toContain("Remove this paragraph");
    expect(part(output)).toContain("Keep final paragraph");
    expect(parse(output).getElementsByTagName("m:oMath").length).toBe(2);
    expect(part(output).match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0]).toBe(
      part(original).match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0],
    );
    const sourceArchive = unzipSync(original);
    const outputArchive = unzipSync(output);
    for (const name of Object.keys(sourceArchive).filter((name) =>
      /header|footer|docProps/.test(name),
    ))
      expect(outputArchive[name], name).toEqual(sourceArchive[name]);
  });

  it("deletes a complete body range and adjusts layout without touching run contents", async () => {
    const original = await fixture();
    const output = await generate(
      editSpec(original, [
        { type: "replace_blocks", start_block: 3, end_block: 4, blocks: [] },
        {
          type: "format_paragraph",
          paragraph: 2,
          layout: {
            align: "justify",
            space_before: 4,
            space_after: 8,
            line_spacing: 1.5,
            first_line_indent: 0.25,
            keep_together: true,
            keep_with_next: false,
            page_break_before: false,
          },
        },
      ]),
      original,
    );
    const paragraph = required(parse(output).getElementsByTagNameNS(W, "p").item(1));
    expect(paragraph.textContent).toBe("Before old draft after.");
    expect(paragraph.getElementsByTagNameNS(W, "spacing").item(0)?.getAttributeNS(W, "line")).toBe(
      "360",
    );
    expect(paragraph.getElementsByTagNameNS(W, "ind").item(0)?.getAttributeNS(W, "firstLine")).toBe(
      "360",
    );
    expect(paragraph.getElementsByTagNameNS(W, "keepNext").item(0)?.getAttributeNS(W, "val")).toBe(
      "0",
    );
    expect(part(output)).not.toContain("Remove this paragraph");
  });

  it("keeps existing charts and notes while adding new media and relationships", async () => {
    const chart = {
      type: "chart",
      chart_type: "column",
      categories: ["A", "B"],
      series: [{ name: "Values", values: [2, 5] }],
    };
    const original = await generate({
      path: "old.docx",
      blocks: [
        {
          type: "rich_paragraph",
          runs: [
            { type: "text", text: "Original note" },
            { type: "footnote", text: "KEEP_NOTE" },
          ],
        },
        chart,
        { type: "paragraph", text: "Replace here" },
      ],
    });
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const request = documentAuthoringSchema.parse(
      editSpec(original, [
        {
          type: "replace_blocks",
          start_block: 3,
          end_block: 3,
          blocks: [
            { type: "image", path: "pixel.png", width: 1 },
            chart,
            {
              type: "rich_paragraph",
              runs: [
                { type: "text", text: "Added note" },
                { type: "footnote", text: "NEW_NOTE" },
              ],
            },
          ],
        },
      ]),
    );
    const output = await authorOfficeDocument(
      request,
      new Map([["pixel.png", pixel]]),
      undefined,
      original,
    );
    const source = unzipSync(original);
    const archive = unzipSync(output);
    for (const name of Object.keys(source).filter((name) => /charts\/|embeddings\//.test(name)))
      expect(archive[name], name).toEqual(source[name]);
    expect(
      Object.keys(archive).filter((name) => /^word\/charts\/[^/]+\.xml$/.test(name)),
    ).toHaveLength(2);
    expect(Object.keys(archive).filter((name) => name.endsWith(".xlsx"))).toHaveLength(2);
    expect(
      Object.entries(archive).some(
        ([name, bytes]) => name.startsWith("word/media/") && Buffer.from(bytes).equals(pixel),
      ),
    ).toBe(true);
    expect(part(output, "word/footnotes.xml")).toContain("KEEP_NOTE");
    expect(part(output, "word/footnotes.xml")).toContain("NEW_NOTE");
  });

  it("rejects external-link workbooks before preparing an old DOCX edit", async () => {
    const source = embedWorkbookInDocx(await fixture(), xlsxWithExternalLinkFixture());
    const spec = documentAuthoringSchema.parse(
      editSpec(source, [
        { type: "replace_text", paragraph: 2, old_text: "old draft", new_text: "new draft" },
      ]),
    );
    await expect(prepareDocxEdit(source, required(spec.edit))).rejects.toThrow(
      "OFFICE_UNSUPPORTED_PART",
    );
  });

  it("rejects external-link workbooks through authorOfficeDocument edit", async () => {
    const source = embedWorkbookInDocx(await fixture(), xlsxWithExternalLinkFixture());
    await expect(
      generate(
        editSpec(source, [
          { type: "replace_text", paragraph: 2, old_text: "old draft", new_text: "new draft" },
        ]),
        source,
      ),
    ).rejects.toThrow("OFFICE_UNSUPPORTED_PART");
  });

  it.each([
    ["missing package relationship", { includeRelationship: false }, "OFFICE_PACKAGE_INVALID"],
    ["missing content type", { includeContentType: false }, "OFFICE_PACKAGE_INVALID"],
    ["duplicate package relationship", { duplicateRelationship: true }, "OFFICE_PACKAGE_DUPLICATE"],
    [
      "missing relationship target",
      { relationshipTarget: "embeddings/missing.xlsx" },
      "OFFICE_PACKAGE_INVALID",
    ],
    [
      "macro-enabled content type",
      {
        contentType: "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
      },
      "Signed or macro-enabled templates",
    ],
  ])("rejects embedded XLSX with %s", async (_label, options, error) => {
    const source = embedWorkbookInDocx(await fixture(), xlsxWithExternalLinkFixture(), options);
    const spec = documentAuthoringSchema.parse(
      editSpec(source, [{ type: "format_paragraph", paragraph: 1, layout: { align: "left" } }]),
    );
    await expect(prepareDocxEdit(source, required(spec.edit))).rejects.toThrow(error);
  });

  it("rejects ambiguous repeated text", async () => {
    const original = await generate({
      path: "old.docx",
      blocks: [{ type: "paragraph", text: "same same" }],
    });
    await expect(
      generate(
        editSpec(original, [
          { type: "replace_text", paragraph: 1, old_text: "same", new_text: "new" },
        ]),
        original,
      ),
    ).rejects.toThrow("DOCUMENT_TEXT_NOT_UNIQUE");
  });

  it.each(["bookmark", "commentRange", "moveFromRange", "perm", "field"])(
    "protects paragraphs inside a cross-paragraph %s range",
    async (kind) => {
      const archive = unzipSync(await fixture());
      const start =
        kind === "field" ? '<w:fldChar w:fldCharType="begin"/>' : `<w:${kind}Start w:id="7"/>`;
      const end =
        kind === "field" ? '<w:fldChar w:fldCharType="end"/>' : `<w:${kind}End w:id="7"/>`;
      archive["word/document.xml"] = strToU8(
        part(Buffer.from(zipSync(archive)))
          .replace("Original report", `${start}Original report`)
          .replace("Remove this paragraph", `Remove this paragraph${end}`),
      );
      const bytes = Buffer.from(zipSync(archive));
      expect((await readDocxStructure(bytes)).text).toContain('"replace_text":false');
      await expect(
        generate(
          editSpec(bytes, [
            { type: "replace_text", paragraph: 2, old_text: "old", new_text: "new" },
          ]),
          bytes,
        ),
      ).rejects.toThrow("DOCUMENT_RANGE_PROTECTED");
    },
  );

  it("supports alternate Word prefixes for inline text and paragraph layout", async () => {
    const archive = unzipSync(await fixture());
    archive["word/document.xml"] = strToU8(
      strFromU8(required(archive["word/document.xml"]))
        .replaceAll("xmlns:w=", "xmlns:word=")
        .replaceAll("w:", "word:"),
    );
    const original = Buffer.from(zipSync(archive));
    const output = await generate(
      editSpec(original, [
        { type: "replace_text", paragraph: 2, old_text: "old", new_text: "new" },
        {
          type: "format_paragraph",
          paragraph: 1,
          layout: { space_after: 10, keep_with_next: true },
        },
      ]),
      original,
    );
    expect(parse(output).getElementsByTagNameNS(W, "p").item(1)?.textContent).toBe(
      "Before new draft after.",
    );
    expect(
      parse(output).getElementsByTagNameNS(W, "spacing").item(0)?.getAttributeNS(W, "after"),
    ).toBe("200");
  });

  it("leaves a valid empty paragraph when deleting the entire body", async () => {
    const original = await generate({
      path: "old.docx",
      blocks: [{ type: "paragraph", text: "Delete" }],
    });
    const output = await generate(
      editSpec(original, [{ type: "replace_blocks", start_block: 1, end_block: 1, blocks: [] }]),
      original,
    );
    expect(parse(output).getElementsByTagNameNS(W, "p").length).toBe(1);
    expect(parse(output).getElementsByTagNameNS(W, "sectPr").length).toBe(1);
  });

  it.each([
    [
      { type: "replace_text", paragraph: 999, old_text: "x", new_text: "y" },
      "DOCUMENT_ANCHOR_INVALID",
    ],
    [
      { type: "replace_text", paragraph: 2, old_text: "missing", new_text: "y" },
      "DOCUMENT_TEXT_NOT_UNIQUE",
    ],
    [
      { type: "replace_text", paragraph: 2, old_text: "old", new_text: "new\nparagraph" },
      "DOCUMENT_TEXT_MULTILINE",
    ],
    [
      { type: "replace_text", paragraph: 6, old_text: "1", new_text: "2" },
      "DOCUMENT_TEXT_PROTECTED",
    ],
    [
      { type: "replace_blocks", start_block: 2, end_block: 999, blocks: [] },
      "DOCUMENT_ANCHOR_INVALID",
    ],
  ])(
    "rejects unsupported or stale anchors without changing input: %s",
    async (operation, error) => {
      const original = await fixture();
      const digest = hash(original);
      await expect(generate(editSpec(original, [operation]), original)).rejects.toThrow(error);
      expect(hash(original)).toBe(digest);
    },
  );

  it("rejects stale digests and overlapping operations", async () => {
    const original = await fixture();
    const spec = documentAuthoringSchema.parse(
      editSpec(original, [
        { type: "replace_text", paragraph: 2, old_text: "old", new_text: "new" },
      ]),
    );
    required(spec.edit).expected_sha256 = "0".repeat(64);
    await expect(authorOfficeDocument(spec, new Map(), undefined, original)).rejects.toThrow(
      "DOCUMENT_SOURCE_CHANGED",
    );
    await expect(
      generate(
        editSpec(original, [
          { type: "replace_blocks", start_block: 5, end_block: 5, blocks: [] },
          { type: "replace_text", paragraph: 5, old_text: "target", new_text: "new" },
        ]),
        original,
      ),
    ).rejects.toThrow("DOCUMENT_EDIT_OVERLAP");
  });

  it.each(["bookmarkStart", "commentRangeStart", "fldChar", "sectPr", "ins", "sdt", "pPrChange"])(
    "refuses protected %s ranges",
    async (tag) => {
      const archive = unzipSync(await fixture());
      archive["word/document.xml"] = strToU8(
        strFromU8(required(archive["word/document.xml"])).replace(
          "Replace this section",
          `Replace<w:${tag}/> this section`,
        ),
      );
      const bytes = Buffer.from(zipSync(archive));
      await expect(
        generate(
          editSpec(bytes, [{ type: "replace_blocks", start_block: 3, end_block: 3, blocks: [] }]),
          bytes,
        ),
      ).rejects.toThrow("DOCUMENT_RANGE_PROTECTED");
    },
  );

  it("rejects paragraphs nested inside tracked insertions", async () => {
    const archive = unzipSync(await fixture());
    archive["word/document.xml"] = strToU8(
      strFromU8(required(archive["word/document.xml"]))
        .replace("<w:body>", "<w:body><w:ins>")
        .replace("</w:p>", "</w:p></w:ins>"),
    );
    const bytes = Buffer.from(zipSync(archive));
    await expect(
      generate(
        editSpec(bytes, [
          { type: "replace_text", paragraph: 1, old_text: "Original", new_text: "New" },
        ]),
        bytes,
      ),
    ).rejects.toThrow("DOCUMENT_RANGE_PROTECTED");
  });

  it("supports cancellation before preparing a patch", async () => {
    const original = await fixture();
    const spec = documentAuthoringSchema.parse(
      editSpec(original, [{ type: "replace_blocks", start_block: 3, end_block: 3, blocks: [] }]),
    );
    const controller = new AbortController();
    controller.abort(new Error("Stop editing"));
    await expect(prepareDocxEdit(original, required(spec.edit), controller.signal)).rejects.toThrow(
      "Stop editing",
    );
  });
  it("changes display math justification while retaining the native formula", async () => {
    const original = await generate({
      path: "math.docx",
      blocks: [{ type: "equation", latex: "\\frac{1}{2}", align: "right" }],
    });
    const output = await generate(
      editSpec(original, [
        { type: "format_paragraph", paragraph: 1, layout: { align: "left", space_after: 10 } },
      ]),
      original,
    );
    const math = "http://schemas.openxmlformats.org/officeDocument/2006/math";
    expect(
      parse(original).getElementsByTagNameNS(math, "jc").item(0)?.getAttributeNS(math, "val"),
    ).toBe("right");
    expect(
      parse(output).getElementsByTagNameNS(math, "jc").item(0)?.getAttributeNS(math, "val"),
    ).toBe("left");
    expect(parse(output).getElementsByTagNameNS(math, "f").length).toBe(1);
    expect(part(output)).toContain('w:after="200"');
  });
});

describe("document layout controls", () => {
  const blocks = [
    {
      type: "heading",
      text: "Layout report",
      level: 1,
      layout: { keep_with_next: true, space_before: 12 },
    },
    {
      type: "paragraph",
      text: "Body text",
      layout: {
        align: "justify",
        line_spacing: 1.5,
        first_line_indent: 0.25,
        space_after: 8,
        keep_together: true,
      },
    },
    {
      type: "table",
      header: true,
      column_widths: [1, 3],
      rows: [
        ["Key", "Description"],
        ["One", "More detail"],
      ],
    },
  ];
  it("writes actual DOCX paragraph and weighted table properties", async () => {
    const bytes = await generate({ path: "layout.docx", blocks });
    const document = parse(bytes);
    expect(part(bytes)).toContain('w:line="360"');
    expect(part(bytes)).toContain('w:firstLine="360"');
    expect(part(bytes)).toContain('w:val="both"');
    const widths = Array.from(document.getElementsByTagNameNS(W, "gridCol")).map((node) =>
      Number(node.getAttributeNS(W, "w")),
    );
    expect(widths).toHaveLength(2);
    expect(required(widths[1]) / required(widths[0])).toBeCloseTo(3, 2);
    expect(part(bytes)).toContain('w:type="fixed"');
    expect(part(bytes)).toContain("w:tblHeader");
  });
  it("uses equivalent PDF spacing, indentation, pagination and table widths", () => {
    const request = documentAuthoringSchema.parse({ path: "layout.pdf", blocks });
    const html = renderDocumentHtml(request, new Map());
    expect(html).toContain("line-height:1.5");
    expect(html).toContain("text-indent:0.25in");
    expect(html).toContain("margin-bottom:8pt");
    expect(html).toContain("break-inside:avoid");
    expect(html).toContain('<col style="width:25%"><col style="width:75%">');
  });
  it("rejects mismatched columns, invalid layout and unsupported PPTX layout", () => {
    expect(
      documentAuthoringSchema.safeParse({
        path: "bad.docx",
        blocks: [{ type: "table", rows: [["a", "b"]], column_widths: [1] }],
      }).success,
    ).toBe(false);
    expect(
      documentAuthoringSchema.safeParse({
        path: "bad.docx",
        blocks: [{ type: "paragraph", text: "x", layout: { line_spacing: 0 } }],
      }).success,
    ).toBe(false);
    expect(
      documentAuthoringSchema.safeParse({ path: "bad.pptx", slides: [{ blocks }] }).success,
    ).toBe(false);
  });
  it("counts edit replacement content against text and block limits", () => {
    const spec = editSpec(Buffer.from("fixture"), [
      {
        type: "replace_blocks",
        start_block: 1,
        end_block: 1,
        blocks: Array.from({ length: 6 }, () => ({ type: "paragraph", text: "x".repeat(90_000) })),
      },
    ]);
    expect(documentAuthoringSchema.safeParse(spec).success).toBe(false);
  });
});
