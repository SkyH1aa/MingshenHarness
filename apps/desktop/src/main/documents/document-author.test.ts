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
    const hugeDimensions = Buffer.from(onePixelPng);
    hugeDimensions.writeUInt32BE(65_535, 16);
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
});
