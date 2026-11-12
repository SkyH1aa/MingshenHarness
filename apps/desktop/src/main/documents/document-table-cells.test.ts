import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { authorOfficeDocument, renderDocumentHtml } from "./document-author";
import { documentAuthoringSchema } from "./document-authoring-schema";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

const paragraph = (text: string) => ({ type: "paragraph", text });
const table = (rows: unknown[][], header = false) => ({ type: "table", rows, header });
const generate = (blocks: unknown[], extras = {}) =>
  authorOfficeDocument(
    documentAuthoringSchema.parse({ path: "cells.docx", blocks, ...extras }),
    new Map(),
  );
const partXml = (bytes: Buffer, path = "word/document.xml") => {
  const part = unzipSync(bytes)[path];
  if (!part) throw new Error(`Missing document part: ${path}`);
  return strFromU8(part);
};
const parseXml = (source: string) => new DOMParser().parseFromString(source, "text/xml");
const parseDocument = (bytes: Buffer) => parseXml(partXml(bytes));
const asRequest = (blocks: unknown[], template = false) =>
  template
    ? {
        path: "filled.docx",
        template: {
          path: "template.docx",
          replacements: [{ placeholder: "body", blocks }],
        },
      }
    : { path: "cells.docx", blocks };

function expectValidNoteReferences(bytes: Buffer, expectedCount: number): void {
  const references = Array.from(
    parseDocument(bytes).getElementsByTagNameNS(WORD_NS, "footnoteReference"),
  ).map((node) => node.getAttributeNS(WORD_NS, "id"));
  const notes = Array.from(
    parseXml(partXml(bytes, "word/footnotes.xml")).getElementsByTagNameNS(WORD_NS, "footnote"),
  ).map((node) => node.getAttributeNS(WORD_NS, "id"));
  expect(references).toHaveLength(expectedCount);
  expect(new Set(references).size).toBe(expectedCount);
  expect(new Set(notes).size).toBe(notes.length);
  for (const id of references) expect(notes).toContain(id);
}

function expectValidHyperlinks(bytes: Buffer, targets: Record<string, string>): void {
  const archive = unzipSync(bytes);
  for (const [path, part] of Object.entries(archive)) {
    if (!path.endsWith(".rels")) continue;
    const ids = Array.from(
      parseXml(strFromU8(part)).getElementsByTagNameNS(PACKAGE_REL_NS, "Relationship"),
    ).map((node) => node.getAttribute("Id"));
    expect(new Set(ids).size, path).toBe(ids.length);
  }
  const relationships = new Map(
    Array.from(
      parseXml(partXml(bytes, "word/_rels/document.xml.rels")).getElementsByTagNameNS(
        PACKAGE_REL_NS,
        "Relationship",
      ),
    ).map((node) => [node.getAttribute("Id"), node]),
  );
  const hyperlinks = Array.from(parseDocument(bytes).getElementsByTagNameNS(WORD_NS, "hyperlink"));
  expect(hyperlinks).toHaveLength(Object.keys(targets).length);
  for (const hyperlink of hyperlinks) {
    const relationship = relationships.get(hyperlink.getAttributeNS(OFFICE_REL_NS, "id"));
    expect(relationship?.getAttribute("Type")).toBe(`${OFFICE_REL_NS}/hyperlink`);
    expect(relationship?.getAttribute("TargetMode")).toBe("External");
    expect(relationship?.getAttribute("Target")).toBe(targets[hyperlink.textContent ?? ""]);
  }
}

describe("document table rich cells", () => {
  it("writes fractions, boxes, cases, integrals, dot notation and Chinese as OMML inside cells", async () => {
    const formulas = [
      String.raw`\frac{1}{2}`,
      String.raw`\boxed{x^2+1}`,
      String.raw`\begin{cases}x&x\ge0\\-x&x<0\end{cases}`,
      String.raw`\int_0^1 x^2\,dx`,
      String.raw`\dot{x}`,
      String.raw`\text{中文}+x`,
    ];
    const bytes = await generate([
      table(
        formulas.map((latex, index) => [
          `Formula ${index + 1}`,
          { blocks: [{ type: "equation", latex }] },
        ]),
      ),
    ]);
    const document = parseDocument(bytes);
    const mathCells = Array.from(document.getElementsByTagNameNS(WORD_NS, "tc")).filter(
      (cell) => cell.getElementsByTagNameNS(MATH_NS, "oMath").length > 0,
    );
    expect(mathCells).toHaveLength(formulas.length);
    expect(document.getElementsByTagNameNS(MATH_NS, "oMath").length).toBe(formulas.length);
    expect(document.getElementsByTagNameNS(MATH_NS, "f").length).toBeGreaterThan(0);
    expect(document.getElementsByTagNameNS(WORD_NS, "drawing").length).toBe(0);
    expect(document.documentElement.textContent).toContain("中文");
    expect(partXml(bytes)).not.toContain("\\frac");
  });

  it("preserves literal string cells and the original header formatting", async () => {
    const literal = String.raw`$x^2$ \frac{1}{2}`;
    const bytes = await generate([
      table(
        [
          [
            literal,
            {
              blocks: [
                {
                  type: "rich_paragraph",
                  runs: [{ type: "text", text: "Explicit plain header", bold: false }],
                },
              ],
            },
          ],
          ["$literal$", { blocks: [paragraph("Body")] }],
        ],
        true,
      ),
    ]);
    const document = parseDocument(bytes);
    const cells = Array.from(document.getElementsByTagNameNS(WORD_NS, "tc"));
    expect(cells[0]?.textContent).toBe(literal);
    expect(cells[2]?.textContent).toBe("$literal$");
    expect(document.getElementsByTagNameNS(MATH_NS, "oMath").length).toBe(0);
    expect(document.getElementsByTagNameNS(WORD_NS, "tblHeader").length).toBe(1);
    expect(cells[0]?.getElementsByTagNameNS(WORD_NS, "b").length).toBe(1);
    expect(
      cells[1]?.getElementsByTagNameNS(WORD_NS, "b").item(0)?.getAttributeNS(WORD_NS, "val"),
    ).toBe("false");
    for (const cell of cells.slice(0, 2))
      expect(
        cell.getElementsByTagNameNS(WORD_NS, "shd").item(0)?.getAttributeNS(WORD_NS, "fill"),
      ).toBe("EAF0F6");
  });

  it("keeps inline math, styles, links, multiple paragraphs, lists, code and quotes in one cell", async () => {
    const bytes = await generate([
      table([
        [
          {
            blocks: [
              {
                type: "rich_paragraph",
                runs: [
                  { type: "text", text: "Before ", bold: true },
                  { type: "equation", latex: String.raw`\frac{x}{y}` },
                  {
                    type: "text",
                    text: " after",
                    italic: true,
                    underline: true,
                    link: "https://example.com/cell",
                  },
                ],
              },
              { type: "paragraph", text: "Second paragraph", align: "right", color: "#112233" },
              { type: "list", ordered: true, items: ["First item", "Second item"] },
              { type: "code", text: "$literal$\n\\frac{1}{2}", language: "tex" },
              { type: "quote", text: "Quoted text" },
            ],
          },
        ],
      ]),
    ]);
    const document = parseDocument(bytes);
    const cell = document.getElementsByTagNameNS(WORD_NS, "tc").item(0);
    expect(cell?.getElementsByTagNameNS(MATH_NS, "f").length).toBe(1);
    expect(cell?.getElementsByTagNameNS(WORD_NS, "p").length).toBeGreaterThanOrEqual(6);
    expect(cell?.getElementsByTagNameNS(WORD_NS, "numPr").length).toBe(2);
    expect(cell?.getElementsByTagNameNS(WORD_NS, "hyperlink").length).toBe(1);
    expect(cell?.getElementsByTagNameNS(WORD_NS, "u").length).toBe(1);
    expect(cell?.textContent).toContain("Second paragraph");
    expect(cell?.textContent).toContain("$literal$");
    expect(cell?.textContent).toContain("\\frac{1}{2}");
    expect(cell?.textContent).toContain("Quoted text");
    expect(partXml(bytes)).toContain('w:ascii="Consolas"');
    expect(partXml(bytes)).toContain('w:val="112233"');
    expectValidHyperlinks(bytes, { " after": "https://example.com/cell" });
  });

  it("retains native math and links in a Markdown table nested inside a cell", async () => {
    const bytes = await generate([
      table([
        [
          {
            blocks: [
              {
                type: "markdown",
                text: [
                  "1. First item",
                  "2. Second item",
                  "",
                  "| Symbol | Formula |",
                  "| --- | --- |",
                  "| [Reference](https://example.com/math) | $\\frac{1}{2}$ |",
                ].join("\n"),
              },
            ],
          },
        ],
      ]),
    ]);
    const document = parseDocument(bytes);
    const tables = Array.from(document.getElementsByTagNameNS(WORD_NS, "tbl"));
    expect(tables).toHaveLength(2);
    expect(tables[1]?.getElementsByTagNameNS(MATH_NS, "f").length).toBe(1);
    expect(tables[1]?.getElementsByTagNameNS(WORD_NS, "hyperlink").length).toBe(1);
    expect(tables[0]?.getElementsByTagNameNS(WORD_NS, "numPr").length).toBe(2);
    for (const cell of Array.from(document.getElementsByTagNameNS(WORD_NS, "tc")))
      expect(cell.lastChild?.nodeName).toBe("w:p");
    expectValidHyperlinks(bytes, { Reference: "https://example.com/math" });
  });

  it("assigns valid footnotes and relationships across body text and several cells", async () => {
    const bytes = await generate([
      {
        type: "rich_paragraph",
        runs: [
          { type: "text", text: "Body source", link: "https://example.com/body" },
          { type: "footnote", text: "Body note" },
        ],
      },
      table([
        ["A", "B"].map((name) => ({
          blocks: [
            {
              type: "rich_paragraph",
              runs: [
                { type: "text", text: `Cell ${name}`, link: "https://example.com/shared" },
                { type: "footnote", text: `Note ${name}` },
              ],
            },
          ],
        })),
      ]),
    ]);
    expectValidNoteReferences(bytes, 3);
    expectValidHyperlinks(bytes, {
      "Body source": "https://example.com/body",
      "Cell A": "https://example.com/shared",
      "Cell B": "https://example.com/shared",
    });
    for (const note of ["Body note", "Note A", "Note B"])
      expect(partXml(bytes, "word/footnotes.xml")).toContain(note);
  });

  it("adds table formulas and notes to templates without colliding with existing IDs or geometry", async () => {
    const templateBytes = await generate(
      [
        {
          type: "rich_paragraph",
          runs: [
            { type: "text", text: "Existing source", link: "https://example.com/existing" },
            { type: "footnote", text: "Existing note" },
          ],
        },
        paragraph("{{body}}"),
        paragraph("{{other}}"),
        paragraph("Keep after"),
      ],
      {
        page_size: "A4",
        orientation: "landscape",
        margins: { top: 0.7, bottom: 0.8, left: 0.9, right: 1 },
      },
    );
    const request = documentAuthoringSchema.parse({
      path: "filled.docx",
      template: {
        path: "template.docx",
        replacements: [
          {
            placeholder: "body",
            blocks: [
              table([
                ["A", "B"].map((name) => ({
                  blocks: [
                    {
                      type: "rich_paragraph",
                      runs: [
                        { type: "text", text: `Added ${name}`, link: "https://example.com/shared" },
                        { type: "equation", latex: String.raw`\frac{1}{2}` },
                        { type: "footnote", text: `Added note ${name}` },
                      ],
                    },
                  ],
                })),
              ]),
            ],
          },
          {
            placeholder: "other",
            blocks: [
              {
                type: "rich_paragraph",
                runs: [
                  { type: "text", text: "New body source", link: "https://example.com/new-body" },
                  { type: "footnote", text: "Added body note" },
                ],
              },
            ],
          },
        ],
      },
    });
    const output = await authorOfficeDocument(request, new Map(), undefined, templateBytes);
    const content = partXml(output);
    expectValidNoteReferences(output, 4);
    expectValidHyperlinks(output, {
      "Existing source": "https://example.com/existing",
      "Added A": "https://example.com/shared",
      "Added B": "https://example.com/shared",
      "New body source": "https://example.com/new-body",
    });
    const cells = Array.from(parseDocument(output).getElementsByTagNameNS(WORD_NS, "tc"));
    expect(cells).toHaveLength(2);
    for (const cell of cells) expect(cell.getElementsByTagNameNS(MATH_NS, "f").length).toBe(1);
    for (const tag of ["pgSz", "pgMar"]) {
      const pattern = new RegExp(`<w:${tag}[^>]+>`);
      expect(content.match(pattern)?.[0]).toBe(partXml(templateBytes).match(pattern)?.[0]);
    }
    for (const note of ["Existing note", "Added note A", "Added note B", "Added body note"])
      expect(partXml(output, "word/footnotes.xml")).toContain(note);
    expect(content).toContain("Keep after");
    expect(content).not.toContain("{{body}}");
    expect(content).not.toContain("{{other}}");
  });

  it("renders cell math as offline PDF MathML while escaping text and Markdown HTML", () => {
    const request = documentAuthoringSchema.parse({
      path: "cells.pdf",
      blocks: [
        table(
          [
            [
              "$literal$ <script>plain</script>",
              {
                blocks: [
                  {
                    type: "rich_paragraph",
                    runs: [
                      { type: "text", text: "A < B & C", bold: true },
                      { type: "equation", latex: String.raw`\frac{1}{2}` },
                    ],
                  },
                  {
                    type: "markdown",
                    text: '**Bold** and $x^2$\n\n<img src="https://example.com/remote.png">',
                  },
                  { type: "equation", latex: String.raw`\int_0^1 x\,dx`, align: "right" },
                ],
              },
            ],
          ],
          true,
        ),
      ],
    });
    const html = renderDocumentHtml(request, new Map());
    expect(html).toContain("<thead><tr><th>");
    expect(html).toContain('<th class="document-rich-cell">');
    expect(html).toContain("th.document-rich-cell { font-weight: 400; }");
    expect(html).toContain("<mfrac>");
    expect(html).toContain("<msup>");
    expect(html).toContain("<strong>A &lt; B &amp; C</strong>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("$literal$ &lt;script&gt;plain&lt;/script&gt;");
    expect(html).toContain("&lt;img src=");
    expect(html).not.toContain("<img ");
    expect(html).not.toContain("<script>");
    expect(html).toContain('class="document-equation" style="text-align:right"');
    expect(html).toContain("default-src 'none'");
  });

  it("rejects unsupported math inside cells without a text or image fallback", async () => {
    const blocks = [
      table([[{ blocks: [{ type: "equation", latex: String.raw`\unknowncommand{x}` }] }]]),
    ];
    await expect(generate(blocks)).rejects.toThrow("NATIVE_EQUATION_UNSUPPORTED");
    expect(() =>
      renderDocumentHtml(
        documentAuthoringSchema.parse({ path: "unsupported.pdf", blocks }),
        new Map(),
      ),
    ).toThrow();
  });

  it("rejects Markdown image fetches inside cells in both output formats", async () => {
    const blocks = [
      table([
        [
          {
            blocks: [{ type: "markdown", text: "![remote](https://example.com/remote-image.png)" }],
          },
        ],
      ]),
    ];
    await expect(generate(blocks)).rejects.toThrow("MARKDOWN_IMAGE");
    expect(() =>
      renderDocumentHtml(documentAuthoringSchema.parse({ path: "image.pdf", blocks }), new Map()),
    ).toThrow("MARKDOWN_IMAGE");
  });

  it("recognizes equation-only table content and rejects entirely empty structured content", () => {
    expect(
      documentAuthoringSchema.safeParse(
        asRequest([table([[{ blocks: [{ type: "equation", latex: "x^2" }] }]])]),
      ).success,
    ).toBe(true);
    for (const cell of [
      { blocks: [] },
      { blocks: [{ type: "rich_paragraph", runs: [{ type: "text", text: " \n\t " }] }] },
    ]) {
      expect(documentAuthoringSchema.safeParse(asRequest([table([["", cell]])])).success).toBe(
        false,
      );
    }
  });

  it("limits each cell to fifty content blocks", () => {
    const blocks = Array.from({ length: 50 }, () => paragraph("x"));
    expect(documentAuthoringSchema.safeParse(asRequest([table([[{ blocks }]])])).success).toBe(
      true,
    );
    expect(
      documentAuthoringSchema.safeParse(
        asRequest([table([[{ blocks: [...blocks, paragraph("extra")] }]])]),
      ).success,
    ).toBe(false);
  });

  it("counts paragraph, inline math and footnote text toward the cell character limit", () => {
    const blocks = [
      paragraph("a".repeat(10_000)),
      {
        type: "rich_paragraph",
        runs: [
          { type: "text", text: "b".repeat(9_998) },
          { type: "equation", latex: "x" },
          { type: "footnote", text: "n" },
        ],
      },
    ];
    expect(documentAuthoringSchema.safeParse(asRequest([table([[{ blocks }]])])).success).toBe(
      true,
    );
    expect(() =>
      documentAuthoringSchema.parse(
        asRequest([table([[{ blocks: [...blocks, paragraph("extra")] }]])]),
      ),
    ).toThrow("表格单元格文字不能超过 20000");
  });

  it("counts cell text toward the global limit in documents and template replacements", () => {
    const cells = Array.from({ length: 25 }, () => ({
      blocks: [paragraph("a".repeat(20_000))],
    }));
    for (const template of [false, true]) {
      expect(documentAuthoringSchema.safeParse(asRequest([table([cells])], template)).success).toBe(
        true,
      );
      expect(() =>
        documentAuthoringSchema.parse(
          asRequest([table([[...cells, { blocks: [paragraph("x")] }]])], template),
        ),
      ).toThrow("文档文字不能超过 500000");
    }
  });

  it("counts nested blocks toward the global block limit in documents and templates", () => {
    const fullCell = { blocks: Array.from({ length: 50 }, () => paragraph("x")) };
    const cells = [
      ...Array.from({ length: 19 }, () => fullCell),
      { blocks: fullCell.blocks.slice(1) },
    ];
    for (const template of [false, true]) {
      expect(documentAuthoringSchema.safeParse(asRequest([table([cells])], template)).success).toBe(
        true,
      );
      expect(() =>
        documentAuthoringSchema.parse(
          asRequest([table([[...cells.slice(0, 19), fullCell]])], template),
        ),
      ).toThrow("内容块不能超过 1000");
    }
  });

  it("preserves the global twenty-thousand-cell limit with mixed cell types", () => {
    const rows: unknown[][] = Array.from({ length: 100 }, (_, rowIndex) =>
      Array.from({ length: 200 }, (_, cellIndex) =>
        rowIndex === 0 && cellIndex === 0 ? { blocks: [paragraph("Content")] } : "",
      ),
    );
    expect(documentAuthoringSchema.safeParse(asRequest([table(rows)])).success).toBe(true);
    expect(() =>
      documentAuthoringSchema.parse(
        asRequest([table([...rows, Array.from({ length: 200 }, () => "")])]),
      ),
    ).toThrow("表格单元格不能超过 20000");
  });

  it("rejects recursive tables, media, page breaks and positioning in structured cells", () => {
    for (const block of [
      table([["nested"]]),
      { type: "image", path: "unapproved.png" },
      {
        type: "chart",
        chart_type: "bar",
        categories: ["A"],
        series: [{ name: "Value", values: [1] }],
      },
      { type: "page_break" },
      { type: "table_of_contents" },
    ]) {
      expect(
        documentAuthoringSchema.safeParse(asRequest([table([[{ blocks: [block] }]])])).success,
      ).toBe(false);
    }
    for (const path of ["cells.docx", "cells.pdf"]) {
      expect(() =>
        documentAuthoringSchema.parse({
          path,
          blocks: [
            table([
              [
                {
                  blocks: [
                    {
                      type: "equation",
                      latex: "x^2",
                      position: { x: 0, y: 0, w: 2, h: 1 },
                    },
                  ],
                },
              ],
            ]),
          ],
        }),
      ).toThrow("不能设置 position");
    }
  });

  it("rejects footnotes nested in PDF cells and all structured PPTX cells", () => {
    const footnoteTable = table([
      [{ blocks: [{ type: "rich_paragraph", runs: [{ type: "footnote", text: "Note" }] }] }],
    ]);
    expect(
      documentAuthoringSchema.safeParse({ path: "notes.docx", blocks: [footnoteTable] }).success,
    ).toBe(true);
    expect(() =>
      documentAuthoringSchema.parse({ path: "notes.pdf", blocks: [footnoteTable] }),
    ).toThrow("PDF 不支持这些结构块");
    for (const block of [
      paragraph("Plain"),
      { type: "equation", latex: "x^2" },
      { type: "markdown", text: "**Bold**" },
    ]) {
      expect(() =>
        documentAuthoringSchema.parse({
          path: "slides.pptx",
          slides: [{ blocks: [table([[{ blocks: [block] }]])] }],
        }),
      ).toThrow("PPTX 表格单元格请使用纯文本");
    }
  });
});
