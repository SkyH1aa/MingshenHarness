import { Buffer } from "node:buffer";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { authorOfficeDocument, renderDocumentHtml } from "./document-author";
import {
  documentAssetPaths,
  documentAuthoringSchema,
  MAX_AUTHORED_DOCUMENT_BYTES,
  MAX_AUTHORING_IMAGE_BYTES,
} from "./document-authoring-schema";
import { extractDocumentBuffer } from "./document-extractor";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const minimalJpeg = Buffer.from(
  "ffd8ffc00011080001000103011100021100031100ffda000c03010002110311003f0000ffd9",
  "hex",
);

function pngWithDimensions(width: number, height: number): Buffer {
  const image = Buffer.from(onePixelPng);
  image.writeUInt32BE(width, 16);
  image.writeUInt32BE(height, 20);
  image.writeUInt32BE(pngCrc32(image.subarray(12, 29)), 29);
  return image;
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("document authoring", () => {
  it("validates mutually exclusive document shapes and bounded input", () => {
    const docx = documentAuthoringSchema.parse({
      path: "report.docx",
      blocks: [{ type: "paragraph", text: "正文" }],
    });
    expect(docx.page_size).toBe("Letter");
    expect(docx.font).toBe("Microsoft YaHei");
    expect(() =>
      documentAuthoringSchema.parse({
        path: "slides.pptx",
        blocks: [{ type: "paragraph", text: "wrong" }],
        slides: [{ blocks: [{ type: "paragraph", text: "ok" }] }],
      }),
    ).toThrow();
    expect(() =>
      documentAuthoringSchema.parse({
        path: "report.pdf",
        blocks: [{ type: "paragraph", text: "bad\u0001text" }],
      }),
    ).toThrow();
  });

  it.each([
    { path: "blank.docx", blocks: [{ type: "paragraph", text: " \n\t " }] },
    { path: "break.pdf", blocks: [{ type: "page_break" }] },
    { path: "table.docx", blocks: [{ type: "table", rows: [["one", "two"], ["one"]] }] },
    { path: "empty-table.pdf", blocks: [{ type: "table", rows: [["", " "]] }] },
    {
      path: "position.docx",
      blocks: [{ type: "paragraph", text: "text", position: { x: 1, y: 1, w: 2, h: 1 } }],
    },
    { path: "break.pptx", slides: [{ blocks: [{ type: "page_break" }] }] },
    {
      path: "outside.pptx",
      slides: [
        { blocks: [{ type: "paragraph", text: "text", position: { x: 13, y: 1, w: 2, h: 1 } }] },
      ],
    },
  ])("rejects empty, ambiguous or unsupported document structures %#", (request) => {
    expect(() => documentAuthoringSchema.parse(request)).toThrow();
  });

  it("collects unique image assets without reading paths", () => {
    const request = documentAuthoringSchema.parse({
      path: "slides.pptx",
      slides: [
        {
          blocks: [
            { type: "image", path: "images/a.png" },
            { type: "image", path: "images/a.png" },
          ],
        },
      ],
    });
    expect(documentAssetPaths(request)).toEqual(["images/a.png"]);
  });

  it("renders escaped PDF HTML with a restrictive CSP and inline image bytes", () => {
    const request = documentAuthoringSchema.parse({
      path: "report.pdf",
      title: "<unsafe>",
      orientation: "landscape",
      blocks: [
        { type: "heading", text: "标题 & 章节" },
        { type: "paragraph", text: `<script>alert("x")</script>` },
        { type: "image", path: "pixel.png", alt: `"image"`, width: 2, height: 1 },
        { type: "table", header: true, rows: [["Header"], ["Body"]] },
        { type: "page_break" },
      ],
    });
    const html = renderDocumentHtml(request, new Map([["pixel.png", onePixelPng]]));
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("break-before: page");
    expect(html).toContain("@page { size: Letter landscape;");
    expect(html).toContain('style="width:1in;height:1in;"');
    expect(html).toContain("<thead><tr><th>Header</th></tr></thead>");
    expect(html).toContain("<tbody><tr><td>Body</td></tr></tbody>");
    expect(html).not.toContain('width="2in"');
    expect(html).not.toContain("table { break-inside: avoid");
  });

  it("creates editable DOCX content that the built-in extractor can read", async () => {
    const request = documentAuthoringSchema.parse({
      path: "report.docx",
      title: "生成报告",
      author: "Mingshen",
      blocks: [
        { type: "heading", text: "摘要", level: 1 },
        { type: "paragraph", text: "中文段落与可编辑文字。" },
        { type: "list", ordered: true, items: ["第一项", "第二项"] },
        {
          type: "table",
          header: true,
          rows: [
            ["字段", "值"],
            ["状态", "通过"],
          ],
        },
        { type: "page_break" },
        { type: "paragraph", text: "第二页" },
      ],
    });
    const output = await authorOfficeDocument(request, new Map());
    expect(output.length).toBeGreaterThan(2_000);
    expect(output.length).toBeLessThan(MAX_AUTHORED_DOCUMENT_BYTES);
    const extracted = await extractDocumentBuffer(output, "report.docx");
    expect(extracted.text).toContain("生成报告");
    expect(extracted.text).toContain("中文段落与可编辑文字");
    expect(extracted.text).toContain("第二页");
    const archive = unzipSync(new Uint8Array(output));
    expect(strFromU8(archive["word/document.xml"] ?? new Uint8Array())).toContain("tblHeader");
  });

  it("creates PPTX slides with text, tables, notes and inline images", async () => {
    const request = documentAuthoringSchema.parse({
      path: "deck.pptx",
      title: "演示文稿",
      slides: [
        {
          title: "第一张",
          notes: "讲者备注",
          background: "#F5F7FA",
          blocks: [
            { type: "heading", text: "可编辑标题", level: 1 },
            { type: "paragraph", text: "可编辑正文。" },
            {
              type: "table",
              header: true,
              rows: [
                ["A", "B"],
                ["1", "2"],
              ],
            },
            { type: "image", path: "pixel.png", width: 1, height: 1 },
          ],
        },
      ],
    });
    const output = await authorOfficeDocument(request, new Map([["pixel.png", onePixelPng]]));
    const archive = unzipSync(new Uint8Array(output));
    const slideXml = strFromU8(archive["ppt/slides/slide1.xml"] ?? new Uint8Array());
    expect(slideXml).toContain("可编辑标题");
    expect(slideXml).toContain("可编辑正文");
    expect(slideXml).toContain("第一张");
    const notes = Object.entries(archive).filter(([name]) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name),
    );
    expect(notes.some(([, bytes]) => strFromU8(bytes).includes("讲者备注"))).toBe(true);
    expect(Object.keys(archive).some((name) => name.startsWith("ppt/media/"))).toBe(true);
  });

  it("applies a native editable presentation system with cover, hierarchy and page chrome", async () => {
    const request = documentAuthoringSchema.parse({
      path: "designed.pptx",
      title: "Operations review",
      footer: "Mingshen Harness | Internal",
      slides: [
        { title: "Quarterly operations review", blocks: [] },
        {
          title: "What changed",
          blocks: [
            { type: "heading", text: "Revenue quality", level: 2 },
            { type: "paragraph", text: "Editable executive summary with a clear reading order." },
            {
              type: "table",
              header: true,
              rows: [
                ["Metric", "Plan", "Actual"],
                ["Revenue", "1.0M", "1.1M"],
                ["Margin", "18%", "21%"],
              ],
            },
          ],
        },
        {
          title: "Next decisions",
          blocks: [{ type: "list", ordered: true, items: ["Confirm owner", "Approve budget"] }],
        },
      ],
    });
    const output = await authorOfficeDocument(request, new Map());
    const archive = unzipSync(new Uint8Array(output));
    const cover = strFromU8(archive["ppt/slides/slide1.xml"] ?? new Uint8Array());
    const content = strFromU8(archive["ppt/slides/slide2.xml"] ?? new Uint8Array());
    const finalSlide = strFromU8(archive["ppt/slides/slide3.xml"] ?? new Uint8Array());
    expect(cover).toContain("10242B");
    expect(cover).toContain("Quarterly operations review");
    expect(content).toContain("F5F7F6");
    expect(content).toContain("0F6F78");
    expect(content).toContain("What changed");
    expect(content.split("Revenue quality")).toHaveLength(2);
    expect(content).toContain("Mingshen Harness | Internal");
    expect(content).toContain(">02<");
    expect(finalSlide).toContain("buAutoNum");
    expect(finalSlide).toContain(">03<");
    expect(output.length).toBeLessThan(MAX_AUTHORED_DOCUMENT_BYTES);
  });

  it("creates varied native slide compositions with cards, a timeline and KPI cards", async () => {
    const request = documentAuthoringSchema.parse({
      path: "story.pptx",
      title: "Operating plan",
      author: "Strategy Office",
      footer: "Confidential | Operations",
      design: { preset: "consulting", density: "airy" },
      slides: [
        { kind: "cover", title: "Operating plan", eyebrow: "FY27" },
        {
          kind: "cards",
          title: "Three priorities",
          eyebrow: "Focus",
          blocks: [
            {
              type: "list",
              items: ["Improve retention", "Shorten delivery time", "Build accountable owners"],
            },
          ],
        },
        {
          kind: "timeline",
          title: "Thirty-day sequence",
          blocks: [
            {
              type: "list",
              ordered: true,
              items: ["Diagnose", "Pilot", "Scale"],
            },
          ],
        },
        {
          kind: "data",
          title: "Operating scorecard",
          blocks: [
            {
              type: "metric_grid",
              columns: 3,
              metrics: [
                { value: "92%", label: "On-time delivery", detail: "+6 pts" },
                { value: "18d", label: "Cycle time", detail: "-3 days" },
                { value: "4.6", label: "Quality score", detail: "out of 5" },
              ],
            },
          ],
        },
      ],
    });
    const output = await authorOfficeDocument(request, new Map());
    const archive = unzipSync(new Uint8Array(output));
    const cover = strFromU8(archive["ppt/slides/slide1.xml"] ?? new Uint8Array());
    const cards = strFromU8(archive["ppt/slides/slide2.xml"] ?? new Uint8Array());
    const timeline = strFromU8(archive["ppt/slides/slide3.xml"] ?? new Uint8Array());
    const metrics = strFromU8(archive["ppt/slides/slide4.xml"] ?? new Uint8Array());
    expect(cover).toContain("15233B");
    expect(cover).toContain("FY27");
    expect(cover).toContain("Strategy Office");
    expect(cards).toContain("Improve retention");
    expect(cards).toContain("Shorten delivery time");
    expect(timeline).toContain("Diagnose");
    expect(timeline).toContain("Pilot");
    expect(metrics).toContain("Operating scorecard");
    expect(metrics).toContain("92%");
    expect(metrics).toContain("On-time delivery");
  });

  it("applies slide density rhythm and renders callouts as native editable shapes", async () => {
    const createDeck = async (density: "airy" | "compact") =>
      documentAuthoringSchema.parse({
        path: `${density}-callout.pptx`,
        title: "Decision review",
        design: { preset: "executive", density },
        slides: [
          {
            kind: "content",
            eyebrow: "Recommendation",
            title: "Keep the rollout bounded",
            blocks: [
              {
                type: "callout",
                title: "Decision guardrail",
                text: "Scale only after the second-wave acceptance checks are complete.",
                tone: "warning",
              },
            ],
          },
        ],
      });
    const [airyOutput, compactOutput] = await Promise.all([
      createDeck("airy").then((request) => authorOfficeDocument(request, new Map())),
      createDeck("compact").then((request) => authorOfficeDocument(request, new Map())),
    ]);
    const slideXml = (output: Buffer) =>
      strFromU8(unzipSync(output)["ppt/slides/slide1.xml"] ?? new Uint8Array());
    const airy = slideXml(airyOutput);
    const compact = slideXml(compactOutput);
    const yOffsets = (xml: string) =>
      [...xml.matchAll(/<a:off x="\d+" y="(\d+)"\s*\/>/g)].map((match) =>
        Number.parseInt(match[1] ?? "0", 10),
      );
    const hasInchOffset = (xml: string, inches: number) =>
      yOffsets(xml).some((offset) => Math.abs(offset - inches * 914_400) < 2);

    expect(hasInchOffset(airy, 1.48)).toBe(true);
    expect(hasInchOffset(compact, 1.27)).toBe(true);
    expect(airy).not.toBe(compact);
    expect((airy.match(/prst="rect"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(airy).toContain("Decision guardrail");
    expect(airy).toContain("Scale only after the second-wave acceptance checks are complete.");
    expect(airy).toContain("B7791F");
  });

  it("centers sparse automatic slide types in the main reading band", async () => {
    const request = documentAuthoringSchema.parse({
      path: "centered-layouts.pptx",
      title: "Operating review",
      slides: [
        {
          kind: "statement",
          title: "The pilot supports a bounded rollout",
          blocks: [
            {
              type: "paragraph",
              text: "Proceed in two waves while the operating owner closes the remaining checks.",
            },
          ],
        },
        {
          kind: "cards",
          title: "Three conditions support the decision",
          blocks: [
            {
              type: "list",
              items: ["Improve retention", "Shorten delivery time", "Build accountable owners"],
            },
          ],
        },
        {
          kind: "timeline",
          title: "Sequence the rollout around evidence",
          blocks: [
            {
              type: "list",
              ordered: true,
              items: ["Diagnose", "Pilot", "Scale"],
            },
          ],
        },
        {
          kind: "data",
          title: "Operating scorecard",
          blocks: [
            {
              type: "metric_grid",
              columns: 3,
              metrics: [
                { value: "92%", label: "On-time delivery", detail: "+6 pts" },
                { value: "18d", label: "Cycle time", detail: "-3 days" },
                { value: "4.6", label: "Quality score", detail: "out of 5" },
              ],
            },
          ],
        },
      ],
    });
    const archive = unzipSync(new Uint8Array(await authorOfficeDocument(request, new Map())));
    const slideXml = (index: number) =>
      strFromU8(archive[`ppt/slides/slide${index}.xml`] ?? new Uint8Array());
    const shapeY = (xml: string, text: string) => {
      const shape = (xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []).find((candidate) =>
        candidate.includes(text),
      );
      const offset = shape?.match(/<a:off x="\d+" y="(\d+)"\s*\/>/);
      return Number.parseInt(offset?.[1] ?? "0", 10);
    };
    const inches = 914_400;

    const statementY = shapeY(slideXml(1), "Proceed in two waves") / inches;
    const cardsY = shapeY(slideXml(2), "Improve retention") / inches;
    const timelineY = shapeY(slideXml(3), "Diagnose") / inches;
    const metricsY = shapeY(slideXml(4), "92%") / inches;
    expect(statementY).toBeGreaterThan(2.4);
    expect(statementY).toBeLessThan(4.2);
    expect(cardsY).toBeGreaterThan(2.7);
    expect(cardsY).toBeLessThan(4.2);
    expect(timelineY).toBeGreaterThan(3.5);
    expect(timelineY).toBeLessThan(4.8);
    expect(metricsY).toBeGreaterThan(2.7);
    expect(metricsY).toBeLessThan(4.2);
  });

  it("applies a document design system, cover page and accessible table styling", async () => {
    const request = documentAuthoringSchema.parse({
      path: "editorial.docx",
      title: "Board decision brief",
      author: "Strategy Office",
      design: { preset: "editorial", density: "balanced", cover_page: true },
      blocks: [
        { type: "heading", text: "Recommendation", level: 1 },
        { type: "paragraph", text: "Approve the staged rollout." },
        {
          type: "table",
          header: true,
          column_widths: [1, 3],
          rows: [
            ["Decision", "Evidence"],
            ["Proceed", "Pilot reached the agreed threshold."],
          ],
        },
        { type: "quote", text: "Preserve the operating baseline while scaling." },
        {
          type: "callout",
          title: "Decision guardrail",
          text: "Scale only after the second-wave acceptance checks are complete.",
          tone: "warning",
        },
      ],
    });
    const output = await authorOfficeDocument(request, new Map());
    const xml = strFromU8(unzipSync(output)["word/document.xml"] ?? new Uint8Array());
    expect(xml).toContain("Board decision brief");
    expect(xml).toContain("Strategy Office");
    expect(xml).toContain("8B4034");
    expect(xml).toContain("E2D9CF");
    expect(xml).toContain("tblHeader");
    expect(xml).toContain("Decision guardrail");
    const html = renderDocumentHtml(
      documentAuthoringSchema.parse({
        path: "editorial.pdf",
        title: "Board decision brief",
        design: { preset: "editorial", cover_page: true },
        blocks: [
          { type: "paragraph", text: "Decision" },
          {
            type: "callout",
            title: "Guardrail",
            text: "Review the second-wave evidence.",
            tone: "positive",
          },
        ],
      }),
      new Map(),
    );
    expect(html).toContain('class="cover"');
    expect(html).toContain("#8B4034");
    expect(html).toContain("document-callout positive");
  });

  it("rejects Office-only visual blocks outside PowerPoint", () => {
    const parsed = documentAuthoringSchema.safeParse({
      path: "metrics.docx",
      design: { preset: "minimal" },
      blocks: [
        {
          type: "metric_grid",
          metrics: [
            { value: "1", label: "First" },
            { value: "2", label: "Second" },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.map((issue) => issue.message).join("\n")).toContain("PowerPoint");
  });

  it("uses actual text width for slide flow and rejects overflowing explicit frames", async () => {
    const normal = documentAuthoringSchema.parse({
      path: "flow.pptx",
      slides: [
        {
          title: "项目进度",
          blocks: [
            {
              type: "paragraph",
              text: "This full-width paragraph contains enough ordinary text to exceed a thirteen-character heuristic, while fitting naturally within a single presentation slide.",
            },
            { type: "list", ordered: true, items: ["First editable item", "Second editable item"] },
            { type: "image", path: "pixel.png", width: 2, height: 1 },
          ],
        },
      ],
    });
    const archive = unzipSync(
      new Uint8Array(await authorOfficeDocument(normal, new Map([["pixel.png", onePixelPng]]))),
    );
    const slideXml = strFromU8(archive["ppt/slides/slide1.xml"] ?? new Uint8Array());
    const picture = slideXml.match(/<p:pic>[\s\S]*?<\/p:pic>/)?.[0] ?? "";
    expect(picture).toContain('cx="914400" cy="914400"');
    expect(slideXml).toContain("buAutoNum");
    const overflow = documentAuthoringSchema.parse({
      path: "overflow.pptx",
      slides: [
        {
          blocks: [
            {
              type: "paragraph",
              text: "A narrow fixed frame cannot contain this long paragraph without overflowing.",
              position: { x: 0.5, y: 0.5, w: 1, h: 0.3 },
            },
          ],
        },
      ],
    });
    await expect(authorOfficeDocument(overflow, new Map())).rejects.toThrow("定位框");
  });

  it("bounds total image bytes and decoded dimensions before authoring", async () => {
    const request = documentAuthoringSchema.parse({
      path: "images.docx",
      blocks: [{ type: "image", path: "large.png" }],
    });
    const hugeFile = Buffer.alloc(MAX_AUTHORING_IMAGE_BYTES + 1);
    onePixelPng.copy(hugeFile);
    await expect(authorOfficeDocument(request, new Map([["large.png", hugeFile]]))).rejects.toThrow(
      "总大小",
    );
    const hugeDimensions = pngWithDimensions(65_535, 1);
    await expect(
      authorOfficeDocument(request, new Map([["large.png", hugeDimensions]])),
    ).rejects.toThrow("图片尺寸");
  });

  it("fits images within custom page margins", async () => {
    const request = documentAuthoringSchema.parse({
      path: "margins.docx",
      margins: { top: 2, bottom: 2, left: 2, right: 2 },
      blocks: [{ type: "image", path: "pixel.png", width: 8, height: 8 }],
    });
    const output = await authorOfficeDocument(request, new Map([["pixel.png", onePixelPng]]));
    const xml = strFromU8(unzipSync(output)["word/document.xml"] ?? new Uint8Array());
    const extent = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    expect(extent).not.toBeNull();
    expect(Number(extent?.[1])).toBeLessThanOrEqual(4.5 * 914400);
    expect(Number(extent?.[2])).toBeLessThanOrEqual(6.7 * 914400);
    const html = renderDocumentHtml(
      { ...request, path: "margins.pdf" },
      new Map([["pixel.png", onePixelPng]]),
    );
    expect(html).toContain("max-height: 6.7in");
  });

  it("stops before authoring when cancelled and rejects invalid image bytes", async () => {
    const request = documentAuthoringSchema.parse({
      path: "deck.pptx",
      slides: [{ blocks: [{ type: "image", path: "bad.png" }] }],
    });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      authorOfficeDocument(request, new Map([["bad.png", Buffer.from("bad")]]), controller.signal),
    ).rejects.toThrow("cancelled");
    await expect(
      authorOfficeDocument(request, new Map([["bad.png", Buffer.from("bad")]])).then(
        () => undefined,
      ),
    ).rejects.toThrow("只支持 PNG 或 JPEG");
  });

  it("rejects truncated or corrupt PNG/JPEG bytes before authoring", async () => {
    const request = documentAuthoringSchema.parse({
      path: "images.pdf",
      blocks: [{ type: "image", path: "image.png" }],
    });
    expect(() => renderDocumentHtml(request, new Map([["image.png", minimalJpeg]]))).not.toThrow();
    expect(() =>
      renderDocumentHtml(
        request,
        new Map([["image.png", minimalJpeg.subarray(0, minimalJpeg.length - 2)]]),
      ),
    ).toThrow("JPEG 图片损坏");
    expect(() =>
      renderDocumentHtml(
        request,
        new Map([["image.png", onePixelPng.subarray(0, onePixelPng.length - 12)]]),
      ),
    ).toThrow("PNG 图片损坏");
    const corruptCrc = Buffer.from(onePixelPng);
    const crcByte = corruptCrc[29] ?? 0;
    corruptCrc[29] = crcByte ^ 0xff;
    expect(() => renderDocumentHtml(request, new Map([["image.png", corruptCrc]]))).toThrow(
      "PNG 图片损坏",
    );
  });
});
