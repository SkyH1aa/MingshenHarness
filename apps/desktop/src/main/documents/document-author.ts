import { Buffer } from "node:buffer";
import { createCanvas } from "@napi-rs/canvas";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  type FileChild,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  type ParagraphChild,
  PatchType,
  patchDocument,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from "docx";
import { ChartRun } from "docx/charts";
import { htmlToContent } from "docx/html";
import PptxGenJS from "pptxgenjs";
import {
  type DocumentAuthoringRequest,
  type DocumentBlock,
  type DocumentTableCell,
  documentAuthoringSchema,
  documentExtension,
  MAX_AUTHORED_DOCUMENT_BYTES,
  MAX_AUTHORING_IMAGE_BYTES,
  PRESENTATION_HEIGHT_INCHES,
  PRESENTATION_WIDTH_INCHES,
} from "./document-authoring-schema";
import { documentMarkdown, equationHtml, nativeEquation } from "./document-rich-content";
import { type TemplateMediaBounds, validateTemplatePlaceholders } from "./document-template";

const DEFAULT_FONT = "Microsoft YaHei";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const SLIDE_MARGIN = 0.6;
const SLIDE_BOTTOM = PRESENTATION_HEIGHT_INCHES - 0.35;
const textMeasurement = createCanvas(1, 1).getContext("2d");

type ImageAsset = {
  buffer: Buffer;
  kind: "png" | "jpg";
  width: number;
  height: number;
  dataUrl: string;
};

export async function authorOfficeDocument(
  rawRequest: DocumentAuthoringRequest,
  assets: Map<string, Buffer>,
  signal?: AbortSignal,
  templateBytes?: Buffer,
): Promise<Buffer> {
  signal?.throwIfAborted();
  const request = documentAuthoringSchema.parse(rawRequest);
  const extension = documentExtension(request);
  if (extension === ".pdf")
    throw new Error("PDF 使用 renderDocumentHtml 后由 Electron printToPDF 生成。");
  const imageAssets = loadImageAssets(request, assets);
  signal?.throwIfAborted();
  const result =
    extension === ".docx"
      ? await authorDocx(request, imageAssets, signal, templateBytes)
      : await authorPptx(request, imageAssets, signal);
  signal?.throwIfAborted();
  ensureOutputSize(result);
  return result;
}

export function renderDocumentHtml(
  rawRequest: DocumentAuthoringRequest,
  assets: Map<string, Buffer>,
): string {
  const request = documentAuthoringSchema.parse(rawRequest);
  if (documentExtension(request) !== ".pdf") {
    throw new Error("renderDocumentHtml 只接受 .pdf 输出。");
  }
  const imageAssets = loadImageAssets(request, assets);
  const pageSize = `${request.page_size ?? "Letter"} ${request.orientation ?? "portrait"}`;
  const font = cssFont(request.font || DEFAULT_FONT);
  const title = escapeHtml(request.title ?? "Mingshen document");
  const author = request.author
    ? `<meta name="author" content="${escapeHtml(request.author)}">`
    : "";
  const blocks = (request.blocks ?? [])
    .map((block) => renderHtmlBlock(block, imageAssets, request.font))
    .join("\n");
  const pageHeight = pageDimensions(request).height;
  const margin = request.margins
    ? `${request.margins.top}in ${request.margins.right}in ${request.margins.bottom}in ${request.margins.left}in`
    : "18mm 16mm";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
<title>${title}</title>
${author}
<style>
@page { size: ${pageSize}; margin: ${margin}; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { color: #111111; font-family: ${font}, sans-serif; font-size: 11pt; line-height: 1.55; }
h1, h2, h3 { color: #000000; line-height: 1.25; margin: 0 0 0.45em; break-after: avoid; }
h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
p, li { margin: 0 0 0.55em; white-space: pre-wrap; overflow-wrap: anywhere; }
ul, ol { margin: 0 0 0.65em 1.4em; padding: 0; }
table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0.6em 0 1em; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 1px solid #D9D9D9; padding: 6pt 7pt; vertical-align: middle; text-align: left; overflow-wrap: anywhere; white-space: pre-wrap; }
th { background: #EAF0F6; color: #000000; }
th.document-rich-cell { font-weight: 400; }
img { display: block; max-width: 100%; max-height: ${Math.max(1, pageHeight - (request.margins ? request.margins.top + request.margins.bottom + 0.3 : 1.75))}in; object-fit: contain; margin: 0.55em 0; }
.page-break { break-before: page; height: 0; }
.document-title { font-size: 26pt; font-weight: 700; margin-bottom: 0.2em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 10pt Consolas, monospace; padding: 8pt; background: #f3f4f6; }
blockquote { border-left: 2pt solid #b8bec5; margin-left: 0; padding-left: 12pt; }
math { font-family: "Cambria Math", math; }
math mtext { font-family: ${font}, sans-serif; }
math menclose[notation~="box"] { border: 0.06em solid currentColor; padding: 0.2em 0.3em; }
.document-equation { margin: 1.2em 0; padding: 0.2em 0; break-inside: avoid; }
.document-equation math[display="block"] { display: inline math; margin: 0; }
</style>
</head>
<body>
${request.title ? `<h1 class="document-title">${escapeHtml(request.title)}</h1>` : ""}
${blocks}
</body>
</html>`;
}

async function authorDocx(
  request: DocumentAuthoringRequest,
  imageAssets: Map<string, ImageAsset>,
  signal?: AbortSignal,
  templateBytes?: Buffer,
): Promise<Buffer> {
  if (request.template) {
    if (!templateBytes)
      throw new Error("Template bytes were not provided through the read gateway.");
    const mediaBounds = await validateTemplatePlaceholders(
      templateBytes,
      request.template.replacements.map((item) => item.placeholder),
      new Set(
        request.template.replacements
          .filter((item) =>
            item.blocks.some((block) => block.type === "image" || block.type === "chart"),
          )
          .map((item) => item.placeholder),
      ),
    );
    signal?.throwIfAborted();
    const patches = Object.fromEntries(
      request.template.replacements.map((item) => [
        item.placeholder,
        {
          type: PatchType.DOCUMENT,
          children: item.blocks.flatMap((block) =>
            docxBlocks(block, request, imageAssets, mediaBounds.get(item.placeholder)),
          ),
        },
      ]),
    );
    return Buffer.from(
      await patchDocument({
        outputType: "nodebuffer",
        data: templateBytes,
        patches,
        keepOriginalStyles: true,
        recursive: false,
      }),
    );
  }
  const children: FileChild[] = [];
  if (request.title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [
          new TextRun({ text: request.title, bold: true, color: "000000", font: request.font }),
        ],
        spacing: { after: 180 },
      }),
    );
  }
  for (const block of request.blocks ?? []) {
    signal?.throwIfAborted();
    children.push(...docxBlocks(block, request, imageAssets));
  }
  const document = new Document({
    creator: request.author ?? "Mingshen",
    title: request.title ?? "Mingshen document",
    description: "Created by Mingshen Harness",
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: request.font || DEFAULT_FONT, size: 22, color: "111111" },
        },
      },
    },
    sections: [
      {
        ...(request.header
          ? { headers: { default: new Header({ children: [new Paragraph(request.header)] }) } }
          : {}),
        ...(request.footer || request.page_numbers
          ? {
              footers: {
                default: new Footer({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun(request.footer ?? ""),
                        ...(request.page_numbers
                          ? [
                              new TextRun({
                                children: ["  ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                              }),
                            ]
                          : []),
                      ],
                    }),
                  ],
                }),
              },
            }
          : {}),
        properties: {
          page: {
            size: {
              width: request.page_size === "A4" ? 11906 : 12240,
              height: request.page_size === "A4" ? 16838 : 15840,
              orientation:
                request.orientation === "landscape"
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
            },
            margin: {
              top: request.margins ? Math.round(request.margins.top * 1440) : 1134,
              bottom: request.margins ? Math.round(request.margins.bottom * 1440) : 1134,
              left: request.margins ? Math.round(request.margins.left * 1440) : 1008,
              right: request.margins ? Math.round(request.margins.right * 1440) : 1008,
            },
          },
        },
        children,
      },
    ],
  });
  return await Packer.toBuffer(document);
}

function docxBlocks(
  block: DocumentBlock,
  request: DocumentAuthoringRequest,
  imageAssets: Map<string, ImageAsset>,
  mediaBounds?: TemplateMediaBounds,
): FileChild[] {
  const font = request.font;
  switch (block.type) {
    case "equation":
      return [
        new Paragraph({
          alignment: block.align ?? AlignmentType.CENTER,
          children: [nativeEquation(block.latex)],
          spacing: { after: 120 },
        }),
      ];
    case "rich_paragraph":
      return [
        new Paragraph({
          alignment: block.align ?? AlignmentType.LEFT,
          children: block.runs.map((run): ParagraphChild => {
            if (run.type === "equation") return nativeEquation(run.latex);
            if (run.type === "footnote")
              return new FootnoteReferenceRun({ children: [new Paragraph(run.text)] });
            const text = new TextRun({
              text: run.text,
              ...(run.bold !== undefined ? { bold: run.bold } : {}),
              ...(run.italic !== undefined ? { italics: run.italic } : {}),
              ...(run.underline ? { underline: {} } : {}),
              ...(run.strike !== undefined ? { strike: run.strike } : {}),
              font: run.code ? "Consolas" : font,
            });
            return run.link ? new ExternalHyperlink({ link: run.link, children: [text] }) : text;
          }),
          spacing: { after: 120 },
        }),
      ];
    case "markdown":
      return [
        ...htmlToContent(documentMarkdown(block.text, "docx"), {
          onWarning(warning) {
            throw new Error(`MARKDOWN_CONVERSION: ${warning.message}`);
          },
        }),
      ];
    case "code":
      return [
        new Paragraph({
          children: block.text.split(/\r?\n/).map(
            (line, index) =>
              new TextRun({
                text: line,
                font: "Consolas",
                size: 20,
                ...(index ? { break: 1 } : {}),
              }),
          ),
          shading: { fill: "F3F4F6" },
          spacing: { after: 120 },
        }),
      ];
    case "quote":
      return [
        new Paragraph({
          children: [new TextRun({ text: block.text, italics: true, font })],
          indent: { left: 360 },
          spacing: { after: 120 },
        }),
      ];
    case "table_of_contents":
      return [
        new TableOfContents(block.title ?? "Contents", {
          hyperlink: true,
          headingStyleRange: "1-3",
        }),
      ];
    case "chart": {
      const width = Math.min(
        6,
        mediaBounds?.width ??
          pageDimensions(request).width -
            (request.margins ? request.margins.left + request.margins.right : 1.4),
      );
      return [
        new Paragraph({
          children: [
            new ChartRun({
              type: block.chart_type,
              ...(block.title ? { title: block.title } : {}),
              categories: block.categories,
              series: block.series.map((series, index) => ({
                ...series,
                color:
                  series.color?.slice(1) ??
                  ["167D8D", "C45858", "8072AA", "679C50"][index % 4] ??
                  "167D8D",
              })),
              legend:
                block.chart_type === "pie" || block.series.length > 1
                  ? { position: "bottom" }
                  : false,
              font: { name: font },
              transformation: {
                width: width * 96,
                height: Math.min(320, (mediaBounds?.height ?? 4) * 96),
              },
              ...(["bar", "column"].includes(block.chart_type)
                ? {
                    valueAxis: {
                      minimum: Math.min(0, ...block.series.flatMap((series) => series.values)),
                      ...(block.series.every((series) => series.values.every((value) => value < 0))
                        ? { maximum: 0 }
                        : {}),
                    },
                  }
                : {}),
            }),
          ],
        }),
      ];
    }
    case "heading":
      return [
        new Paragraph({
          heading:
            block.level === 1
              ? HeadingLevel.HEADING_1
              : block.level === 3
                ? HeadingLevel.HEADING_3
                : HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: block.text,
              bold: true,
              color: block.color?.slice(1) ?? "000000",
              font,
            }),
          ],
          keepNext: true,
          spacing: { before: 180, after: 100 },
        }),
      ];
    case "paragraph":
      return [
        new Paragraph({
          alignment: block.align ?? AlignmentType.LEFT,
          children: [
            new TextRun({
              text: block.text,
              ...(block.bold !== undefined ? { bold: block.bold } : {}),
              ...(block.italic !== undefined ? { italics: block.italic } : {}),
              ...(block.color ? { color: block.color.slice(1) } : {}),
              ...(block.font_size ? { size: Math.round(block.font_size * 2) } : {}),
              font,
            }),
          ],
          spacing: { after: 120 },
        }),
      ];
    case "list":
      return [
        ...htmlToContent(
          `<${block.ordered ? "ol" : "ul"}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`,
        ),
      ];
    case "table":
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
            left: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
            right: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
          },
          rows: block.rows.map(
            (row, rowIndex) =>
              new TableRow({
                ...(block.header && rowIndex === 0 ? { tableHeader: true } : {}),
                children: row.map(
                  (cell) =>
                    new TableCell({
                      ...(block.header && rowIndex === 0 ? { shading: { fill: "EAF0F6" } } : {}),
                      margins: { top: 90, bottom: 90, left: 100, right: 100 },
                      verticalAlign: VerticalAlignTable.CENTER,
                      children: docxCellContent(
                        cell,
                        request,
                        imageAssets,
                        !!block.header && rowIndex === 0,
                      ),
                    }),
                ),
              }),
          ),
        }),
      ];
    case "image": {
      const image = imageAssets.get(block.path);
      if (!image) throw new Error(`图片未提供给作者：${block.path}`);
      const page = pageDimensions(request);
      const contentWidth =
        mediaBounds?.width ??
        page.width - (request.margins ? request.margins.left + request.margins.right : 1.4);
      const contentHeight =
        mediaBounds?.height ??
        page.height - (request.margins ? request.margins.top + request.margins.bottom + 0.3 : 1.9);
      const maxWidth = Math.min(block.width ?? contentWidth, contentWidth) * 96;
      const maxHeight = Math.min(block.height ?? contentHeight, contentHeight) * 96;
      const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
      const width = Math.max(1, Math.floor(image.width * ratio));
      const height = Math.max(1, Math.floor(image.height * ratio));
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: image.kind,
              data: image.buffer,
              transformation: { width, height },
              altText: {
                title: block.alt ?? "Image",
                description: block.alt ?? "Image",
                name: "image",
              },
            }),
          ],
          spacing: { after: 150 },
        }),
      ];
    }
    case "page_break":
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

function docxCellContent(
  cell: DocumentTableCell,
  request: DocumentAuthoringRequest,
  imageAssets: Map<string, ImageAsset>,
  header: boolean,
): (Paragraph | Table)[] {
  if (typeof cell === "string")
    return [
      new Paragraph({
        children: [
          new TextRun({ text: cell, ...(header ? { bold: true } : {}), font: request.font }),
        ],
      }),
    ];
  const children = cell.blocks.flatMap((block) =>
    docxBlocks(block, request, imageAssets).map((child) => {
      if (child instanceof Paragraph || child instanceof Table) return child;
      throw new Error("Unsupported content in a document table cell.");
    }),
  );
  // Word cells must end with a paragraph, including cells ending in a Markdown table.
  if (!(children.at(-1) instanceof Paragraph)) children.push(new Paragraph(""));
  return children;
}

async function authorPptx(
  request: DocumentAuthoringRequest,
  imageAssets: Map<string, ImageAsset>,
  signal?: AbortSignal,
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = request.author ?? "Mingshen";
  pptx.company = "Mingshen Harness";
  pptx.subject = request.title ?? "Mingshen document";
  pptx.title = request.title ?? "Mingshen document";
  pptx.theme = {
    headFontFace: request.font || DEFAULT_FONT,
    bodyFontFace: request.font || DEFAULT_FONT,
  };

  for (const sourceSlide of request.slides ?? []) {
    signal?.throwIfAborted();
    const slide = pptx.addSlide();
    if (sourceSlide.background) slide.background = { color: sourceSlide.background.slice(1) };
    if (sourceSlide.notes) slide.addNotes(sourceSlide.notes);
    let cursorY = 0.42;
    if (sourceSlide.title?.trim()) {
      cursorY = addPptxBlock(
        slide,
        { type: "heading", text: sourceSlide.title, level: 1 },
        request.font,
        imageAssets,
        cursorY,
      );
    }
    for (const block of sourceSlide.blocks) {
      signal?.throwIfAborted();
      cursorY = addPptxBlock(slide, block, request.font, imageAssets, cursorY);
    }
  }
  const output = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return Buffer.from(output);
}

function addPptxBlock(
  slide: ReturnType<PptxGenJS["addSlide"]>,
  block: DocumentBlock,
  font: string,
  imageAssets: Map<string, ImageAsset>,
  cursorY: number,
): number {
  if (block.type === "page_break") return cursorY;
  const position = "position" in block ? block.position : undefined;
  const x = position?.x ?? SLIDE_MARGIN;
  const y = position?.y ?? cursorY;
  const w = position?.w ?? PRESENTATION_WIDTH_INCHES - SLIDE_MARGIN * 2;
  const boxHeight = (minimum: number): number => {
    const h = position?.h ?? minimum;
    if (minimum > h + 0.001) {
      throw new Error("幻灯片定位框无法容纳文字或表格，请增加框高、减少内容或拆分 slides。");
    }
    if (
      x + w > PRESENTATION_WIDTH_INCHES + 0.000001 ||
      y + h > (position ? PRESENTATION_HEIGHT_INCHES : SLIDE_BOTTOM) + 0.001
    ) {
      throw new Error("幻灯片内容超出画布，请减少内容或拆分为更多 slides。");
    }
    return h;
  };
  if (block.type === "chart") {
    const h = boxHeight(3.5);
    slide.addChart(
      block.chart_type === "column" ? "bar" : block.chart_type,
      block.series.map((series) => ({
        name: series.name,
        labels: block.categories,
        values: series.values,
      })),
      {
        x,
        y,
        w,
        h,
        catAxisLabelFontFace: font,
        valAxisLabelFontFace: font,
        catAxisLabelFontSize: 11,
        valAxisLabelFontSize: 11,
        showTitle: !!block.title,
        ...(block.title ? { title: block.title } : {}),
        showLegend: block.chart_type === "pie" || block.series.length > 1,
        legendPos: "b",
        chartColors: block.series.map(
          (series, index) =>
            series.color?.slice(1) ??
            ["167D8D", "C45858", "8072AA", "679C50"][index % 4] ??
            "167D8D",
        ),
        ...(block.chart_type === "bar" || block.chart_type === "column"
          ? {
              barDir: block.chart_type === "bar" ? "bar" : "col",
              valAxisMinVal: Math.min(0, ...block.series.flatMap((series) => series.values)),
              ...(block.series.every((series) => series.values.every((value) => value < 0))
                ? { valAxisMaxVal: 0 }
                : {}),
            }
          : {}),
      },
    );
    return position ? cursorY : y + h + 0.12;
  }
  if (block.type === "heading" || block.type === "paragraph") {
    const fontSize =
      block.type === "heading"
        ? block.level === 1
          ? 30
          : block.level === 3
            ? 19
            : 24
        : (block.font_size ?? 18);
    const bold = block.type === "heading" || !!block.bold;
    const h = boxHeight(textHeight(block.text, w, fontSize, font, bold));
    slide.addText(block.text, {
      x,
      y,
      w,
      h,
      fontFace: font,
      fontSize,
      lang: "zh-CN",
      ...(block.type === "heading"
        ? { bold: true }
        : block.bold !== undefined
          ? { bold: block.bold }
          : {}),
      ...(block.type === "paragraph" && block.italic !== undefined ? { italic: block.italic } : {}),
      color: (block.color ?? "#111111").slice(1),
      align: block.type === "paragraph" ? (block.align ?? "left") : "left",
      breakLine: false,
      margin: 3,
      valign: "top",
      lineSpacingMultiple: 1.2,
    });
    return position ? cursorY : y + h + 0.12;
  }
  if (block.type === "list") {
    const h = boxHeight(
      block.items.reduce((sum, item) => sum + textHeight(item, w - 0.35, 18, font), 0),
    );
    slide.addText(block.items.join("\n"), {
      x,
      y,
      w,
      h,
      fontFace: font,
      fontSize: 18,
      lang: "zh-CN",
      color: "111111",
      margin: 3,
      valign: "top",
      breakLine: false,
      bullet: block.ordered
        ? { type: "number", numberType: "arabicPeriod", indent: 18 }
        : { indent: 18 },
      paraSpaceAfter: 4,
      lineSpacingMultiple: 1.2,
    });
    return position ? cursorY : y + h + 0.12;
  }
  if (block.type === "table") {
    const textRows = block.rows.map((row) =>
      row.map((cell) => {
        if (typeof cell !== "string")
          throw new Error("PPTX table cells require plain text. Use DOCX for native equations.");
        return cell;
      }),
    );
    const rows = textRows.map((row, rowIndex) =>
      row.map((cell) =>
        block.header && rowIndex === 0
          ? { text: cell, options: { bold: true, color: "000000", fill: { color: "EAF0F6" } } }
          : { text: cell },
      ),
    );
    const columns = textRows[0]?.length ?? 1;
    const rowHeights = textRows.map((row, index) =>
      Math.max(
        0.34,
        ...row.map(
          (cell) =>
            textHeight(cell, w / columns - 0.16, 14, font, !!block.header && index === 0) + 0.08,
        ),
      ),
    );
    const minimumHeight = rowHeights.reduce((sum, height) => sum + height, 0);
    const h = boxHeight(minimumHeight);
    slide.addTable(rows, {
      x,
      y,
      w,
      h,
      colW: w / columns,
      rowH: rowHeights.map((height) => (height * h) / minimumHeight),
      fontFace: font,
      fontSize: 14,
      lang: "zh-CN",
      color: "111111",
      border: { type: "solid", color: "D9D9D9", pt: 1 },
      margin: 0.08,
      valign: "middle",
      autoPage: false,
    });
    return position ? cursorY : y + h + 0.12;
  }
  if (block.type === "image") {
    const image = imageAssets.get(block.path);
    if (!image) throw new Error(`图片未提供给作者：${block.path}`);
    const maxWidth = Math.min(position?.w ?? block.width ?? 6, w);
    const maxHeight = Math.min(
      position?.h ?? block.height ?? 4,
      (position ? PRESENTATION_HEIGHT_INCHES : SLIDE_BOTTOM) - y,
    );
    if (maxHeight <= 0) throw new Error("幻灯片没有空间放置图片，请拆分 slides。");
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    slide.addImage({
      data: image.dataUrl,
      x: x + (position ? (maxWidth - width) / 2 : 0),
      y: y + (position ? (maxHeight - height) / 2 : 0),
      w: width,
      h: height,
      altText: block.alt ?? "Image",
    });
    return position ? cursorY : y + height + 0.12;
  }
  return cursorY;
}

function loadImageAssets(
  request: DocumentAuthoringRequest,
  assets: Map<string, Buffer>,
): Map<string, ImageAsset> {
  const loaded = new Map<string, ImageAsset>();
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const block of [
    ...(request.blocks ?? []),
    ...(request.template?.replacements.flatMap((item) => item.blocks) ?? []),
    ...(request.slides?.flatMap((slide) => slide.blocks) ?? []),
  ]) {
    if (block.type !== "image" || paths.has(block.path)) continue;
    paths.add(block.path);
    const source = assets.get(block.path);
    if (!source) throw new Error(`图片未提供给作者：${block.path}`);
    totalBytes += source.length;
    if (source.length === 0 || totalBytes > MAX_AUTHORING_IMAGE_BYTES) {
      throw new Error(`文档图片总大小超过 20 MiB 或图片为空：${block.path}`);
    }
    const buffer = Buffer.from(source);
    const image = identifyImage(buffer, block.path);
    if (
      image.width > MAX_IMAGE_DIMENSION ||
      image.height > MAX_IMAGE_DIMENSION ||
      image.width * image.height > MAX_IMAGE_PIXELS
    ) {
      throw new Error(`图片尺寸超过 16384 像素单边或 4000 万像素：${block.path}`);
    }
    loaded.set(block.path, {
      buffer,
      kind: image.kind,
      width: image.width,
      height: image.height,
      dataUrl: `data:image/${image.kind === "jpg" ? "jpeg" : "png"};base64,${buffer.toString("base64")}`,
    });
  }
  return loaded;
}

function identifyImage(
  buffer: Buffer,
  path: string,
): { kind: "png" | "jpg"; width: number; height: number } {
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    if (buffer.length < 24) throw new Error(`PNG 图片损坏：${path}`);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height) throw new Error(`PNG 图片尺寸无效：${path}`);
    return { kind: "png", width, height };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const dimensions = jpegDimensions(buffer);
    if (!dimensions) throw new Error(`JPEG 图片尺寸无效：${path}`);
    return { kind: "jpg", ...dimensions };
  }
  throw new Error(`只支持 PNG 或 JPEG 图片：${path}`);
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isFrame && offset + 7 <= buffer.length) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return width && height ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

function renderHtmlBlock(
  block: DocumentBlock,
  assets: Map<string, ImageAsset>,
  font: string,
): string {
  if (block.type === "equation") return equationHtml(block.latex, true, "pdf", block.align);
  if (block.type === "markdown") return documentMarkdown(block.text, "pdf");
  if (block.type === "code") return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
  if (block.type === "quote") return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
  if (block.type === "rich_paragraph")
    return `<p style="text-align:${block.align ?? "left"}">${block.runs
      .map((run) => {
        if (run.type === "equation") return equationHtml(run.latex, false, "pdf");
        if (run.type === "footnote") throw new Error("PDF footnotes are not supported. Use DOCX.");
        let html = escapeHtml(run.text);
        for (const [enabled, tag] of [
          [run.bold, "strong"],
          [run.italic, "em"],
          [run.underline, "u"],
          [run.strike, "s"],
          [run.code, "code"],
        ] as const)
          if (enabled) html = `<${tag}>${html}</${tag}>`;
        return run.link ? `<a href="${escapeHtml(run.link)}">${html}</a>` : html;
      })
      .join("")}</p>`;
  if (block.type === "page_break") return '<div class="page-break"></div>';
  if (block.type === "heading") {
    const level = block.level ?? 2;
    const color = block.color ?? "#000000";
    return `<h${level} style="color:${color};font-family:${escapeHtml(cssFont(font))};">${escapeHtml(block.text)}</h${level}>`;
  }
  if (block.type === "paragraph") {
    const style = [
      `font-family:${escapeHtml(cssFont(font))}`,
      `text-align:${block.align ?? "left"}`,
      `color:${block.color ?? "#111111"}`,
      block.bold ? "font-weight:700" : "",
      block.italic ? "font-style:italic" : "",
      block.font_size ? `font-size:${block.font_size}pt` : "",
    ]
      .filter(Boolean)
      .join(";");
    return `<p style="${style}">${escapeHtml(block.text)}</p>`;
  }
  if (block.type === "list") {
    const tag = block.ordered ? "ol" : "ul";
    return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "table") {
    const rows = block.rows.map((row, rowIndex) => {
      const cellTag = block.header && rowIndex === 0 ? "th" : "td";
      return `<tr>${row
        .map((cell) =>
          typeof cell === "string"
            ? `<${cellTag}>${escapeHtml(cell)}</${cellTag}>`
            : `<${cellTag} class="document-rich-cell">${cell.blocks.map((item) => renderHtmlBlock(item, assets, font)).join("")}</${cellTag}>`,
        )
        .join("")}</tr>`;
    });
    const header = block.header ? `<thead>${rows.shift() ?? ""}</thead>` : "";
    return `<table>${header}<tbody>${rows.join("")}</tbody></table>`;
  }
  if (block.type === "image") {
    const image = assets.get(block.path);
    if (!image) throw new Error(`图片未提供给作者：${block.path}`);
    const maxWidth = block.width ?? 6.25;
    const maxHeight = block.height ?? 8;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    return `<img src="${image.dataUrl}" alt="${escapeHtml(block.alt ?? "Image")}" style="width:${image.width * scale}in;height:${image.height * scale}in;">`;
  }
  return "";
}

function textHeight(
  text: string,
  width: number,
  fontSize: number,
  font: string,
  bold = false,
): number {
  if (width <= 0.08) throw new Error("幻灯片文字或表格列宽过窄，请加宽或减少列数。");
  textMeasurement.font = `${bold ? "bold " : ""}${(fontSize * 96) / 72}px ${cssFont(font)}`;
  const usableWidth = Math.max(1, width * 96 - 8);
  const lines = text
    .split(/\r?\n/)
    .reduce(
      (sum, line) =>
        sum +
        Math.max(1, Math.ceil((textMeasurement.measureText(line).width * 1.12) / usableWidth)),
      0,
    );
  return Math.max(0.3, lines * (fontSize / 72) * 1.35 + 0.12);
}

function pageDimensions(request: DocumentAuthoringRequest): { width: number; height: number } {
  const dimensions =
    request.page_size === "A4"
      ? { width: 210 / 25.4, height: 297 / 25.4 }
      : { width: 8.5, height: 11 };
  return request.orientation === "landscape"
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

function cssFont(font: string): string {
  return `"${font.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function ensureOutputSize(buffer: Buffer): void {
  if (buffer.length > MAX_AUTHORED_DOCUMENT_BYTES) {
    throw new Error("生成文档超过 25 MiB 限制。");
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
