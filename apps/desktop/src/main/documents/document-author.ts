import { Buffer } from "node:buffer";
import { createCanvas } from "@napi-rs/canvas";
import {
  AlignmentType,
  BorderStyle,
  BuilderElement,
  Document,
  ExternalHyperlink,
  type FileChild,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  type IParagraphOptions,
  LineRuleType,
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
  TableLayoutType,
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
  type DocumentSlide,
  type DocumentTableCell,
  documentAuthoringSchema,
  documentExtension,
  MAX_AUTHORED_DOCUMENT_BYTES,
  MAX_AUTHORING_IMAGE_BYTES,
  type ParagraphLayout,
  PRESENTATION_HEIGHT_INCHES,
  PRESENTATION_WIDTH_INCHES,
} from "./document-authoring-schema";
import { prepareDocxEdit, preserveUneditedDocxParts } from "./document-edit";
import { documentMarkdown, equationHtml, nativeEquation } from "./document-rich-content";
import { type TemplateMediaBounds, validateTemplatePlaceholders } from "./document-template";
import {
  type OfficeDesignDensity,
  type OfficePalette,
  officePaletteCss,
  type ResolvedOfficeVisual,
  resolveOfficeVisual,
} from "./office-visuals";

const DEFAULT_FONT = "Microsoft YaHei";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const SLIDE_MARGIN = 0.6;
const SLIDE_BOTTOM = PRESENTATION_HEIGHT_INCHES - 0.55;
const SLIDE_AUTO_BAND_BOTTOM = PRESENTATION_HEIGHT_INCHES - 1.35;
const textMeasurement = createCanvas(1, 1).getContext("2d");
const DEFAULT_VISUAL = resolveOfficeVisual();

type ImageAsset = {
  buffer: Buffer;
  kind: "png" | "jpg";
  width: number;
  height: number;
  dataUrl: string;
};

type PptxPresentationKind = NonNullable<DocumentSlide["kind"]>;
type ResolvedPptxPresentationKind = Exclude<PptxPresentationKind, "auto">;
type PptxRhythm = {
  chromeRuleY: number;
  contentTop: number;
  contentKickerY: number;
  contentTitleY: number;
  contentTitleHeight: number;
  blockGap: number;
  bodyLineSpacing: number;
  listLineSpacing: number;
  paragraphSpaceAfter: number;
  listSpaceAfter: number;
  tableRowPadding: number;
  cardGap: number;
  cardMaxHeight: number;
  cardMinHeight: number;
  cardTextTop: number;
  metricGap: number;
  metricMaxHeight: number;
  metricMinHeight: number;
  calloutPadding: number;
  calloutTextGap: number;
  timelineLabelOffset: number;
};

const PPTX_RHYTHMS: Record<OfficeDesignDensity, PptxRhythm> = {
  airy: {
    chromeRuleY: 1.24,
    contentTop: 1.48,
    contentKickerY: 0.26,
    contentTitleY: 0.58,
    contentTitleHeight: 0.56,
    blockGap: 0.22,
    bodyLineSpacing: 1.22,
    listLineSpacing: 1.24,
    paragraphSpaceAfter: 7,
    listSpaceAfter: 10,
    tableRowPadding: 0.11,
    cardGap: 0.22,
    cardMaxHeight: 2.65,
    cardMinHeight: 0.98,
    cardTextTop: 0.64,
    metricGap: 0.2,
    metricMaxHeight: 2.65,
    metricMinHeight: 1.24,
    calloutPadding: 0.18,
    calloutTextGap: 0.1,
    timelineLabelOffset: 0.82,
  },
  balanced: {
    chromeRuleY: 1.17,
    contentTop: 1.36,
    contentKickerY: 0.28,
    contentTitleY: 0.5,
    contentTitleHeight: 0.55,
    blockGap: 0.12,
    bodyLineSpacing: 1.16,
    listLineSpacing: 1.18,
    paragraphSpaceAfter: 4,
    listSpaceAfter: 8,
    tableRowPadding: 0.08,
    cardGap: 0.18,
    cardMaxHeight: 2.45,
    cardMinHeight: 0.9,
    cardTextTop: 0.62,
    metricGap: 0.16,
    metricMaxHeight: 2.45,
    metricMinHeight: 1.24,
    calloutPadding: 0.12,
    calloutTextGap: 0.08,
    timelineLabelOffset: 0.78,
  },
  compact: {
    chromeRuleY: 1.1,
    contentTop: 1.27,
    contentKickerY: 0.22,
    contentTitleY: 0.42,
    contentTitleHeight: 0.5,
    blockGap: 0.08,
    bodyLineSpacing: 1.12,
    listLineSpacing: 1.14,
    paragraphSpaceAfter: 2,
    listSpaceAfter: 5,
    tableRowPadding: 0.05,
    cardGap: 0.12,
    cardMaxHeight: 2.15,
    cardMinHeight: 0.8,
    cardTextTop: 0.58,
    metricGap: 0.12,
    metricMaxHeight: 2.15,
    metricMinHeight: 1.24,
    calloutPadding: 0.09,
    calloutTextGap: 0.05,
    timelineLabelOffset: 0.72,
  },
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
  const visual = resolveOfficeVisual({
    preset: request.design?.preset,
    density: request.design?.density,
    accent: request.design?.accent,
    coverPage: request.design?.cover_page ?? (request.blocks?.length ?? 0) >= 4,
  });
  const palette = officePaletteCss(visual.palette);
  const imageAssets = loadImageAssets(request, assets);
  const pageSize = `${request.page_size ?? "Letter"} ${request.orientation ?? "portrait"}`;
  const font = cssFont(request.font || DEFAULT_FONT);
  const title = escapeHtml(request.title ?? "Mingshen document");
  const author = request.author
    ? `<meta name="author" content="${escapeHtml(request.author)}">`
    : "";
  const blocks = (request.blocks ?? [])
    .map((block) => renderHtmlBlock(block, imageAssets, request.font, visual.palette))
    .join("\n");
  const pageHeight = pageDimensions(request).height;
  const margin = request.margins
    ? `${request.margins.top}in ${request.margins.right}in ${request.margins.bottom}in ${request.margins.left}in`
    : "18mm 16mm";
  const cover =
    visual.coverPage && request.title
      ? `<section class="cover">
<div class="cover-rule"></div>
<h1 class="cover-title">${escapeHtml(request.title)}</h1>
${request.author ? `<p class="cover-meta">${escapeHtml(request.author)}</p>` : ""}
</section><div class="page-break"></div>`
      : request.title
        ? `<h1 class="document-title">${escapeHtml(request.title)}</h1>`
        : "";
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
body { color: ${palette.ink}; font-family: ${font}, sans-serif; font-size: 10.5pt; line-height: 1.55; }
h1, h2, h3 { color: ${palette.ink}; line-height: 1.2; margin: 0 0 0.45em; break-after: avoid; }
h1 { color: ${palette.accent}; font-size: 20pt; } h2 { font-size: 15pt; } h3 { font-size: 12.5pt; }
p, li { margin: 0 0 0.55em; white-space: pre-wrap; overflow-wrap: anywhere; }
ul, ol { margin: 0 0 0.65em 1.4em; padding: 0; }
table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0.6em 0 1em; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border-bottom: 0.75pt solid ${palette.line}; padding: 6pt 7pt; vertical-align: middle; text-align: left; overflow-wrap: anywhere; white-space: pre-wrap; }
th { background: ${palette.accent}; color: ${palette.white}; font-weight: 700; }
th.document-rich-cell { font-weight: 400; }
img { display: block; max-width: 100%; max-height: ${Math.max(1, pageHeight - (request.margins ? request.margins.top + request.margins.bottom + 0.3 : 1.75))}in; object-fit: contain; margin: 0.55em 0; }
.page-break { break-before: page; height: 0; }
.document-title { font-size: 26pt; font-weight: 700; color: ${palette.ink}; border-bottom: 2pt solid ${palette.accent}; padding-bottom: 10pt; margin-bottom: 18pt; }
.cover { min-height: calc(100vh - 2px); display: flex; flex-direction: column; justify-content: center; padding: 8% 2%; break-after: page; }
.cover-rule { width: 0.9in; height: 4pt; background: ${palette.secondary}; margin-bottom: 22pt; }
.cover-title { color: ${palette.ink}; font-size: 32pt; line-height: 1.15; max-width: 85%; margin: 0; }
.cover-meta { color: ${palette.muted}; font-size: 11pt; margin-top: 24pt; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 10pt Consolas, monospace; padding: 8pt; background: ${palette.accentSoft}; border-left: 2pt solid ${palette.accent}; }
blockquote { border-left: 3pt solid ${palette.secondary}; margin-left: 0; padding: 7pt 12pt; color: ${palette.muted}; background: ${palette.canvas}; }
.document-callout { break-inside: avoid; margin: 10pt 0 14pt; padding: 10pt 12pt; border-left: 4pt solid ${palette.accent}; background: ${palette.accentSoft}; }
.document-callout.warning { border-left-color: ${palette.warning}; background: ${palette.canvas}; }
.document-callout.positive { border-left-color: ${palette.positive}; }
.document-callout.neutral { border-left-color: ${palette.muted}; }
.document-callout strong { display: block; margin-bottom: 4pt; color: ${palette.ink}; }
.document-callout p { margin: 0; }
math { font-family: "Cambria Math", math; }
math mtext { font-family: ${font}, sans-serif; }
math menclose[notation~="box"] { border: 0.06em solid currentColor; padding: 0.2em 0.3em; }
.document-equation { margin: 1.2em 0; padding: 0.2em 0; break-inside: avoid; }
.document-equation math[display="block"] { display: inline math; margin: 0; }
</style>
</head>
<body>
${cover}
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
  if (request.edit) {
    if (!templateBytes) throw new Error("Source bytes were not provided through the read gateway.");
    const prepared = await prepareDocxEdit(templateBytes, request.edit, signal);
    if (!prepared.replacements.length) return prepared.bytes;
    const patched = await authorDocx(
      {
        ...request,
        edit: undefined,
        template: { path: request.edit.path, replacements: prepared.replacements },
      },
      imageAssets,
      signal,
      prepared.bytes,
    );
    return preserveUneditedDocxParts(templateBytes, patched);
  }
  if (request.template) {
    if (!templateBytes)
      throw new Error("Template bytes were not provided through the read gateway.");
    const mediaBounds = await validateTemplatePlaceholders(
      templateBytes,
      request.template.replacements.map((item) => item.placeholder),
      new Set(
        request.template.replacements
          .filter((item) =>
            item.blocks.some(
              (block) =>
                block.type === "image" ||
                block.type === "chart" ||
                (block.type === "table" && block.column_widths !== undefined),
            ),
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
            docxBlocks(block, request, imageAssets, undefined, mediaBounds.get(item.placeholder)),
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
  const contentBlocks = request.blocks ?? [];
  const visual = resolveOfficeVisual({
    preset: request.design?.preset,
    density: request.design?.density,
    accent: request.design?.accent,
    coverPage: request.design?.cover_page ?? contentBlocks.length >= 4,
  });
  const palette = visual.palette;
  const children: FileChild[] = [];
  if (request.title && visual.coverPage) {
    children.push(
      new Paragraph({
        spacing: { before: 2600, after: 240 },
        children: [
          new TextRun({
            text: request.title,
            bold: true,
            color: palette.ink,
            font: request.font,
            size: 64,
          }),
        ],
      }),
      new Paragraph({
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 12,
            color: palette.secondary,
            space: 1,
          },
        },
        spacing: { after: 300 },
        children: [],
      }),
    );
    if (request.author) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: request.author,
              color: palette.muted,
              font: request.font,
              size: 22,
            }),
          ],
          spacing: { after: 240 },
        }),
      );
    }
    children.push(new Paragraph({ children: [new PageBreak()] }));
  } else if (request.title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [
          new TextRun({
            text: request.title,
            bold: true,
            color: palette.ink,
            font: request.font,
            size: 54,
          }),
        ],
        spacing: { after: 180 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 8,
            color: palette.accent,
            space: 5,
          },
        },
      }),
    );
  }
  for (const block of contentBlocks) {
    signal?.throwIfAborted();
    children.push(...docxBlocks(block, request, imageAssets, visual));
  }
  const document = new Document({
    creator: request.author ?? "Mingshen",
    title: request.title ?? "Mingshen document",
    description: "Created by Mingshen Harness",
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: request.font || DEFAULT_FONT, size: 21, color: palette.ink },
        },
      },
    },
    sections: [
      {
        ...(request.header
          ? {
              headers: {
                default: new Header({
                  children: [
                    new Paragraph({
                      border: {
                        bottom: {
                          style: BorderStyle.SINGLE,
                          size: 4,
                          color: palette.line,
                          space: 4,
                        },
                      },
                      children: [
                        new TextRun({
                          text: request.header,
                          color: palette.muted,
                          font: request.font,
                          size: 18,
                        }),
                      ],
                    }),
                  ],
                }),
              },
            }
          : {}),
        ...(request.footer || request.page_numbers
          ? {
              footers: {
                default: new Footer({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new TextRun({
                          text: request.footer ?? "",
                          color: palette.muted,
                          font: request.font,
                          size: 17,
                        }),
                        ...(request.page_numbers
                          ? [
                              new TextRun({
                                children: ["  ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                                color: palette.accent,
                                bold: true,
                                font: request.font,
                                size: 17,
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
  visual?: ResolvedOfficeVisual,
  mediaBounds?: TemplateMediaBounds,
): FileChild[] {
  const font = request.font;
  const palette = visual?.palette ?? DEFAULT_VISUAL.palette;
  switch (block.type) {
    case "equation":
      return [
        new DisplayEquationParagraph(block.latex, block.layout?.align ?? block.align ?? "center", {
          alignment: block.align ?? AlignmentType.CENTER,
          spacing: { after: 120 },
          ...docxLayout(block.layout, { after: 120 }),
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
          ...docxLayout(block.layout, { after: 120 }),
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
          shading: { fill: palette.accentSoft },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              size: 8,
              color: palette.accent,
              space: 6,
            },
          },
          spacing: { after: 120 },
        }),
      ];
    case "quote":
      return [
        new Paragraph({
          children: [new TextRun({ text: block.text, italics: true, font })],
          indent: { left: 360 },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              size: 12,
              color: palette.secondary,
              space: 8,
            },
          },
          shading: { fill: palette.canvas },
          spacing: { after: 140 },
        }),
      ];
    case "callout": {
      const toneColor =
        block.tone === "positive"
          ? palette.positive
          : block.tone === "warning"
            ? palette.warning
            : block.tone === "neutral"
              ? palette.muted
              : palette.accent;
      const fill = block.tone === "warning" ? palette.canvas : palette.accentSoft;
      return [
        ...(block.title
          ? [
              new Paragraph({
                children: [
                  new TextRun({
                    text: block.title,
                    bold: true,
                    color: toneColor,
                    font,
                    size: 22,
                  }),
                ],
                shading: { fill },
                border: {
                  left: {
                    style: BorderStyle.SINGLE,
                    size: 16,
                    color: toneColor,
                    space: 8,
                  },
                },
                indent: { left: 180, right: 120 },
                keepNext: true,
                spacing: { before: 100, after: 60 },
              }),
            ]
          : []),
        new Paragraph({
          children: [
            new TextRun({
              text: block.text,
              color: palette.ink,
              font,
              size: 21,
            }),
          ],
          shading: { fill },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              size: 16,
              color: toneColor,
              space: 8,
            },
          },
          indent: { left: 180, right: 120 },
          spacing: { before: block.title ? 0 : 100, after: 160 },
        }),
      ];
    }
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
                  [palette.accent, palette.secondary, palette.positive, palette.muted][index % 4] ??
                  palette.accent,
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
              color: block.color?.slice(1) ?? (block.level === 1 ? palette.accent : palette.ink),
              font,
              size: block.level === 1 ? 30 : block.level === 3 ? 22 : 26,
            }),
          ],
          keepNext: true,
          spacing: {
            before: visual?.density === "compact" ? 160 : visual?.density === "airy" ? 300 : 220,
            after: 90,
            line: 300,
            lineRule: LineRuleType.AUTO,
          },
          ...docxLayout(block.layout, { before: 180, after: 100 }),
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
          spacing: {
            after: visual?.density === "compact" ? 100 : 140,
            line: visual?.density === "airy" ? 360 : 330,
            lineRule: LineRuleType.AUTO,
          },
          ...docxLayout(block.layout, { after: 120 }),
        }),
      ];
    case "list":
      return [
        ...htmlToContent(
          `<${block.ordered ? "ol" : "ul"}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`,
        ),
      ];
    case "table": {
      const width =
        (mediaBounds?.width ??
          pageDimensions(request).width -
            (request.margins ? request.margins.left + request.margins.right : 1.4)) * 1440;
      const totalWeight = block.column_widths?.reduce((total, value) => total + value, 0) ?? 1;
      const columnWidths = block.column_widths?.map((value) =>
        Math.round((value / totalWeight) * width),
      );
      if (columnWidths?.some((value) => value < 120))
        throw new Error(
          "DOCUMENT_TABLE_COLUMN_TOO_NARROW: increase small column weights or reduce columns.",
        );
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          ...(columnWidths ? { columnWidths, layout: TableLayoutType.FIXED } : {}),
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: palette.line },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: palette.line },
            left: { style: BorderStyle.SINGLE, size: 4, color: palette.line },
            right: { style: BorderStyle.SINGLE, size: 4, color: palette.line },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: palette.line },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: palette.line },
          },
          rows: block.rows.map(
            (row, rowIndex) =>
              new TableRow({
                ...(block.header && rowIndex === 0 ? { tableHeader: true } : {}),
                children: row.map((cell, columnIndex) => {
                  const cellWidth = columnWidths?.[columnIndex];
                  return new TableCell({
                    ...(cellWidth !== undefined
                      ? { width: { size: cellWidth, type: WidthType.DXA } }
                      : {}),
                    ...(block.header && rowIndex === 0
                      ? { shading: { fill: palette.accent } }
                      : rowIndex % 2 === 0
                        ? { shading: { fill: palette.canvas } }
                        : {}),
                    margins: { top: 90, bottom: 90, left: 100, right: 100 },
                    verticalAlign: VerticalAlignTable.CENTER,
                    children: docxCellContent(
                      cell,
                      request,
                      imageAssets,
                      visual,
                      !!block.header && rowIndex === 0,
                      palette,
                    ),
                  });
                }),
              }),
          ),
        }),
      ];
    }
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
    case "metric_grid":
      throw new Error("metric_grid 只能用于 PPTX；DOCX/PDF 请使用表格。");
  }
}

// Word uses math paragraph justification independently of the enclosing text paragraph.
class DisplayEquationParagraph extends Paragraph {
  constructor(source: string, align: string, options: IParagraphOptions) {
    super(options);
    this.root.push(
      new BuilderElement({
        name: "m:oMathPara",
        children: [
          new BuilderElement({
            name: "m:oMathParaPr",
            children: [
              new BuilderElement({
                name: "m:jc",
                attributes: { val: { key: "m:val", value: align === "justify" ? "left" : align } },
              }),
            ],
          }),
          nativeEquation(source),
        ],
      }),
    );
  }
}

function docxLayout(
  layout: ParagraphLayout | undefined,
  spacing: { before?: number; after?: number },
): Partial<IParagraphOptions> {
  if (!layout) return {};
  return {
    ...(layout.align
      ? { alignment: layout.align === "justify" ? AlignmentType.JUSTIFIED : layout.align }
      : {}),
    spacing: {
      ...spacing,
      ...(layout.space_before !== undefined
        ? { before: Math.round(layout.space_before * 20) }
        : {}),
      ...(layout.space_after !== undefined ? { after: Math.round(layout.space_after * 20) } : {}),
      ...(layout.line_spacing !== undefined
        ? { line: Math.round(layout.line_spacing * 240), lineRule: LineRuleType.AUTO }
        : {}),
    },
    indent: {
      ...(layout.first_line_indent !== undefined
        ? { firstLine: Math.round(layout.first_line_indent * 1440) }
        : {}),
      ...(layout.indent_left !== undefined ? { left: Math.round(layout.indent_left * 1440) } : {}),
      ...(layout.indent_right !== undefined
        ? { right: Math.round(layout.indent_right * 1440) }
        : {}),
    },
    ...(layout.keep_with_next !== undefined ? { keepNext: layout.keep_with_next } : {}),
    ...(layout.keep_together !== undefined ? { keepLines: layout.keep_together } : {}),
    ...(layout.page_break_before !== undefined
      ? { pageBreakBefore: layout.page_break_before }
      : {}),
  };
}

function docxCellContent(
  cell: DocumentTableCell,
  request: DocumentAuthoringRequest,
  imageAssets: Map<string, ImageAsset>,
  visual: ResolvedOfficeVisual | undefined,
  header: boolean,
  palette: OfficePalette,
): (Paragraph | Table)[] {
  if (typeof cell === "string")
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: cell,
            ...(header ? { bold: true, color: palette.white } : {}),
            font: request.font,
          }),
        ],
      }),
    ];
  const children = cell.blocks.flatMap((block) =>
    docxBlocks(block, request, imageAssets, visual).map((child) => {
      if (child instanceof Paragraph || child instanceof Table) return child;
      throw new Error("Unsupported content in a document table cell.");
    }),
  );
  // Word cells must end with a paragraph, including cells ending in a Markdown table.
  if (!(children.at(-1) instanceof Paragraph)) children.push(new Paragraph(""));
  return children;
}

function pptxColor(value: string): string {
  return value.replace(/^#/, "").toUpperCase();
}

function pptxContrastColor(background: string, palette: OfficePalette): string {
  const normalized = pptxColor(background);
  if (!/^[0-9A-F]{6}$/.test(normalized)) return palette.ink;
  const [red, green, blue] = [0, 2, 4].map(
    (offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  );
  const linear = [red, green, blue].map((value) =>
    value !== undefined && value <= 0.03928 ? value / 12.92 : ((value ?? 0) + 0.055) / 1.055 ** 2.4,
  );
  const luminance =
    (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
  return luminance < 0.38 ? palette.white : palette.ink;
}

function addPptxChrome(input: {
  pptx: PptxGenJS;
  slide: ReturnType<PptxGenJS["addSlide"]>;
  title: string;
  eyebrow: string;
  author: string;
  footer: string;
  page: number;
  cover: boolean;
  textColor: string;
  font: string;
  palette: OfficePalette;
  presentationKind: ResolvedPptxPresentationKind;
  ruleY: number;
}): void {
  const { pptx, slide, cover, textColor, palette, presentationKind } = input;
  const width = PRESENTATION_WIDTH_INCHES;
  const height = PRESENTATION_HEIGHT_INCHES;
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.08,
    h: height,
    line: { color: pptxColor(palette.accent), transparency: 100 },
    fill: { color: pptxColor(palette.accent) },
  });
  if (cover) {
    if (input.eyebrow) {
      slide.addText(input.eyebrow, {
        x: 0.86,
        y: 1.04,
        w: width - 1.72,
        h: 0.24,
        fontFace: input.font,
        fontSize: 9,
        bold: true,
        color: pptxColor(palette.secondary),
        margin: 0,
        charSpacing: 1.4,
        fit: "shrink",
      });
    }
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.86,
      y: 1.52,
      w: 0.9,
      h: 0.045,
      line: { color: pptxColor(palette.secondary), transparency: 100 },
      fill: { color: pptxColor(palette.secondary) },
    });
    slide.addText(input.title, {
      x: 0.86,
      y: 1.78,
      w: width - 1.72,
      h: 1.42,
      fontFace: input.font,
      fontSize: 38,
      bold: true,
      color: textColor,
      breakLine: false,
      margin: 0,
      valign: "middle",
      fit: "shrink",
    });
    if (input.footer) {
      slide.addText(input.footer, {
        x: 0.86,
        y: 5.9,
        w: width - 2.4,
        h: 0.36,
        fontFace: input.font,
        fontSize: 11,
        color: pptxColor(palette.line),
        margin: 0,
        charSpacing: 1.2,
      });
    }
    if (input.author) {
      slide.addText(input.author, {
        x: 0.86,
        y: 5.52,
        w: width - 2.4,
        h: 0.3,
        fontFace: input.font,
        fontSize: 10,
        color: pptxColor(palette.line),
        margin: 0,
        charSpacing: 0.6,
      });
    }
    return;
  }
  if (presentationKind === "section" || presentationKind === "closing") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.86,
      y: 1.5,
      w: 0.9,
      h: 0.045,
      line: { color: pptxColor(palette.secondary), transparency: 100 },
      fill: { color: pptxColor(palette.secondary) },
    });
    if (input.footer) {
      slide.addText(input.footer, {
        x: 0.86,
        y: 6.55,
        w: width - 2.4,
        h: 0.3,
        fontFace: input.font,
        fontSize: 9,
        color: pptxColor(palette.line),
        margin: 0,
        charSpacing: 0.8,
      });
    }
    return;
  }
  slide.addShape(pptx.ShapeType.rect, {
    x: SLIDE_MARGIN,
    y: input.ruleY,
    w: width - SLIDE_MARGIN * 2,
    h: 0.012,
    line: { color: pptxColor(palette.line), transparency: 100 },
    fill: { color: pptxColor(palette.line) },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: SLIDE_MARGIN,
    y: height - 0.42,
    w: width - SLIDE_MARGIN * 2,
    h: 0.01,
    line: { color: pptxColor(palette.line), transparency: 100 },
    fill: { color: pptxColor(palette.line) },
  });
  slide.addText(input.footer || input.title, {
    x: SLIDE_MARGIN,
    y: height - 0.31,
    w: width - 2.1,
    h: 0.2,
    fontFace: input.font,
    fontSize: 8,
    color: pptxColor(palette.muted),
    margin: 0,
    charSpacing: 0.5,
  });
  slide.addText(String(input.page).padStart(2, "0"), {
    x: width - 1.12,
    y: height - 0.32,
    w: 0.5,
    h: 0.2,
    fontFace: input.font,
    fontSize: 8,
    bold: true,
    color: pptxColor(palette.accent),
    align: "right",
    margin: 0,
  });
}

function inferPptxKind(
  slide: DocumentSlide,
  index: number,
  total: number,
): ResolvedPptxPresentationKind {
  if (slide.kind && slide.kind !== "auto") return slide.kind;
  if (index === 0 && slide.title?.trim() && slide.blocks.length === 0) return "cover";
  if (index === total - 1 && total > 1 && slide.title?.trim() && slide.blocks.length === 0)
    return "closing";
  if (slide.blocks.length === 1) {
    const block = slide.blocks[0];
    if (block?.type === "metric_grid") return "data";
    if (block?.type === "chart" || block?.type === "table") return "data";
    if (block?.type === "list" && block.items.length >= 3 && block.items.length <= 6)
      return block.ordered ? "timeline" : "cards";
    if (block?.type === "paragraph" || block?.type === "quote") return "statement";
  }
  return "content";
}

function resolvePptxContentStart(input: {
  slide: DocumentSlide;
  presentationKind: ResolvedPptxPresentationKind;
  font: string;
  imageAssets: Map<string, ImageAsset>;
  rhythm: PptxRhythm;
  initialContentTop: number;
}): number {
  const blocks = input.slide.blocks.filter(
    (block) => !("position" in block) || block.position === undefined,
  );
  if (blocks.length === 0) return input.initialContentTop;
  const width =
    input.presentationKind === "statement"
      ? PRESENTATION_WIDTH_INCHES - 2.1
      : PRESENTATION_WIDTH_INCHES - SLIDE_MARGIN * 2;
  const contentHeight =
    blocks.reduce(
      (sum, block) =>
        sum +
        estimatePptxBlockHeight(
          block,
          width,
          input.font,
          input.imageAssets,
          input.rhythm,
          input.presentationKind,
        ),
      0,
    ) +
    Math.max(0, blocks.length - 1) * input.rhythm.blockGap;
  const availableHeight = SLIDE_AUTO_BAND_BOTTOM - input.initialContentTop;
  return (
    input.initialContentTop +
    Math.max(0, Math.min(availableHeight, (availableHeight - contentHeight) / 2))
  );
}

function estimatePptxBlockHeight(
  block: DocumentBlock,
  width: number,
  font: string,
  imageAssets: Map<string, ImageAsset>,
  rhythm: PptxRhythm,
  presentationKind: ResolvedPptxPresentationKind,
): number {
  if (block.type === "page_break") return 0;
  if (block.type === "chart") return 3.5;
  if (block.type === "heading" || block.type === "paragraph") {
    const fontSize =
      presentationKind === "statement" && block.type === "paragraph"
        ? 23
        : block.type === "heading"
          ? block.level === 1
            ? 22
            : block.level === 3
              ? 16
              : 19
          : (block.font_size ?? 16);
    return textHeight(block.text, width, fontSize, font, block.type === "heading" || !!block.bold);
  }
  if (block.type === "callout") {
    return (
      textHeight(block.text, width - 0.5, 15, font) +
      (block.title ? textHeight(block.title, width - 0.5, 17, font, true) : 0) +
      rhythm.calloutPadding * 2 +
      (block.title ? rhythm.calloutTextGap : 0)
    );
  }
  if (block.type === "list") {
    if (presentationKind === "cards") {
      const columns = block.items.length <= 3 ? block.items.length : 2;
      const rows = Math.ceil(block.items.length / columns);
      const gap = rhythm.cardGap;
      const cardWidth = (width - gap * (columns - 1)) / columns;
      const minimumCardHeight = Math.max(
        rhythm.cardMinHeight,
        rhythm.cardTextTop +
          Math.max(
            ...block.items.map((item) =>
              textHeight(item, cardWidth - 0.36, item.length > 60 ? 13 : 15, font),
            ),
          ) +
          0.14,
      );
      const availableHeight = SLIDE_AUTO_BAND_BOTTOM - rhythm.contentTop;
      const cardHeight = Math.max(
        minimumCardHeight,
        Math.min(rhythm.cardMaxHeight, (availableHeight - gap * (rows - 1)) / rows),
      );
      return rows * cardHeight + (rows - 1) * gap;
    }
    if (presentationKind === "timeline") {
      const segment = width / block.items.length;
      const labelWidth = Math.max(0.9, segment - 0.22);
      const labelHeight = Math.max(
        0.55,
        ...block.items.map((item) => textHeight(item, labelWidth, 12, font, true)),
      );
      return rhythm.timelineLabelOffset + labelHeight + 0.12;
    }
    return (
      block.items.reduce((sum, item) => sum + textHeight(item, width - 0.35, 18, font), 0) +
      Math.max(0, block.items.length - 1) * (rhythm.listSpaceAfter / 72)
    );
  }
  if (block.type === "metric_grid") {
    const columns = block.columns ?? Math.min(3, block.metrics.length);
    const rows = Math.ceil(block.metrics.length / columns);
    const gap = rhythm.metricGap;
    const availableHeight = SLIDE_AUTO_BAND_BOTTOM - rhythm.contentTop;
    const cardHeight = Math.max(
      rhythm.metricMinHeight,
      Math.min(rhythm.metricMaxHeight, (availableHeight - gap * (rows - 1)) / rows),
    );
    return rows * cardHeight + (rows - 1) * gap;
  }
  if (block.type === "table") {
    const columns = block.rows[0]?.length ?? 1;
    return block.rows.reduce(
      (sum, row, index) =>
        sum +
        Math.max(
          0.34,
          ...row.map((cell) => {
            if (typeof cell !== "string")
              throw new Error(
                "PPTX table cells require plain text. Use DOCX for native equations.",
              );
            return (
              textHeight(cell, width / columns - 0.16, 12, font, !!block.header && index === 0) +
              rhythm.tableRowPadding
            );
          }),
        ),
      0,
    );
  }
  if (block.type === "image") {
    const image = imageAssets.get(block.path);
    if (!image) throw new Error(`图片未提供给作者：${block.path}`);
    const maxWidth = Math.min(block.width ?? 6, width);
    const maxHeight = block.height ?? 4;
    return Math.min(maxHeight, (maxWidth / image.width) * image.height);
  }
  return 0;
}

async function authorPptx(
  request: DocumentAuthoringRequest,
  imageAssets: Map<string, ImageAsset>,
  signal?: AbortSignal,
): Promise<Buffer> {
  const visual = resolveOfficeVisual({
    preset: request.design?.preset,
    density: request.design?.density,
    accent: request.design?.accent,
  });
  const palette = visual.palette;
  const rhythm = PPTX_RHYTHMS[visual.density];
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

  const font = request.font || DEFAULT_FONT;
  const slides = request.slides ?? [];
  for (const [slideIndex, sourceSlide] of slides.entries()) {
    signal?.throwIfAborted();
    const slide = pptx.addSlide();
    const presentationKind = inferPptxKind(sourceSlide, slideIndex, slides.length);
    const cover = presentationKind === "cover";
    const darkSlide = cover || presentationKind === "section" || presentationKind === "closing";
    const background = sourceSlide.background
      ? sourceSlide.background.slice(1)
      : darkSlide
        ? palette.dark
        : palette.canvas;
    slide.background = { color: pptxColor(background) };
    if (sourceSlide.notes) slide.addNotes(sourceSlide.notes);
    const textColor = pptxContrastColor(background, palette);
    addPptxChrome({
      pptx,
      slide,
      title: sourceSlide.title?.trim() || request.title || "Mingshen",
      eyebrow: sourceSlide.eyebrow?.trim() || "",
      author: request.author?.trim() || "",
      footer: request.footer || request.title || "",
      page: slideIndex + 1,
      cover,
      textColor,
      font,
      palette,
      presentationKind,
      ruleY: rhythm.chromeRuleY,
    });
    const initialContentTop =
      presentationKind === "cover"
        ? 3.3
        : presentationKind === "section" || presentationKind === "closing"
          ? 2.55
          : rhythm.contentTop;
    let cursorY =
      presentationKind === "statement" ||
      presentationKind === "cards" ||
      presentationKind === "timeline" ||
      presentationKind === "data"
        ? resolvePptxContentStart({
            slide: sourceSlide,
            presentationKind,
            font,
            imageAssets,
            rhythm,
            initialContentTop,
          })
        : initialContentTop;
    if (!cover && sourceSlide.title?.trim()) {
      const kicker = (sourceSlide.eyebrow || request.title || "").trim();
      if (kicker && kicker !== sourceSlide.title.trim()) {
        slide.addText(kicker, {
          x: SLIDE_MARGIN,
          y:
            presentationKind === "section" || presentationKind === "closing"
              ? 1.7
              : rhythm.contentKickerY,
          w: PRESENTATION_WIDTH_INCHES - SLIDE_MARGIN * 2,
          h: 0.2,
          fontFace: font,
          fontSize: 8,
          bold: true,
          color: pptxColor(darkSlide ? palette.secondary : palette.accent),
          margin: 0,
          charSpacing: 1.1,
          fit: "shrink",
        });
      }
      slide.addText(sourceSlide.title, {
        x: SLIDE_MARGIN,
        y:
          presentationKind === "section" || presentationKind === "closing"
            ? 1.95
            : rhythm.contentTitleY,
        w: PRESENTATION_WIDTH_INCHES - SLIDE_MARGIN * 2,
        h:
          presentationKind === "section" || presentationKind === "closing"
            ? 1.05
            : rhythm.contentTitleHeight,
        fontFace: font,
        fontSize:
          presentationKind === "section" || presentationKind === "closing"
            ? 32
            : presentationKind === "statement"
              ? 30
              : 25,
        bold: true,
        color: pptxColor(textColor),
        margin: 0,
        breakLine: false,
        valign: "middle",
        fit: "shrink",
      });
    }
    for (const block of sourceSlide.blocks) {
      signal?.throwIfAborted();
      cursorY = addPptxBlock(
        pptx,
        slide,
        block,
        font,
        imageAssets,
        cursorY,
        palette,
        presentationKind,
        rhythm,
      );
    }
  }
  const output = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return Buffer.from(output);
}

function addPptxBlock(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS["addSlide"]>,
  block: DocumentBlock,
  font: string,
  imageAssets: Map<string, ImageAsset>,
  cursorY: number,
  palette: OfficePalette,
  presentationKind: ResolvedPptxPresentationKind,
  rhythm: PptxRhythm,
): number {
  if (block.type === "page_break") return cursorY;
  const position = "position" in block ? block.position : undefined;
  const x = position?.x ?? (presentationKind === "statement" ? 1.05 : SLIDE_MARGIN);
  const y = position?.y ?? cursorY;
  const w =
    position?.w ??
    (presentationKind === "statement"
      ? PRESENTATION_WIDTH_INCHES - 2.1
      : PRESENTATION_WIDTH_INCHES - SLIDE_MARGIN * 2);
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
        catAxisLabelFontSize: 10,
        valAxisLabelFontSize: 10,
        catAxisLabelColor: palette.muted,
        valAxisLabelColor: palette.muted,
        catAxisLineShow: true,
        catAxisLineColor: palette.line,
        valGridLine: { color: palette.line, style: "dash", size: 1 },
        showTitle: !!block.title,
        ...(block.title
          ? {
              title: block.title,
              titleColor: palette.ink,
              titleFontFace: font,
              titleFontSize: 13,
            }
          : {}),
        showLegend: block.chart_type === "pie" || block.series.length > 1,
        legendPos: "b",
        legendColor: palette.muted,
        legendFontFace: font,
        legendFontSize: 9,
        chartColors: block.series.map(
          (series, index) =>
            series.color?.slice(1) ??
            [palette.accent, palette.secondary, palette.positive, palette.muted][index % 4] ??
            palette.accent,
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
    return position ? cursorY : y + h + rhythm.blockGap;
  }
  if (block.type === "heading" || block.type === "paragraph") {
    const fontSize =
      presentationKind === "statement" && block.type === "paragraph"
        ? 23
        : block.type === "heading"
          ? block.level === 1
            ? 22
            : block.level === 3
              ? 16
              : 19
          : (block.font_size ?? 16);
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
      color: (block.color ?? `#${palette.ink}`).slice(1),
      align:
        presentationKind === "statement" && block.type === "paragraph"
          ? "center"
          : block.type === "paragraph"
            ? (block.align ?? "left")
            : "left",
      breakLine: false,
      margin: 2,
      valign: "top",
      lineSpacingMultiple:
        block.type === "heading"
          ? Math.min(1.14, rhythm.bodyLineSpacing)
          : presentationKind === "statement"
            ? Math.max(1.22, rhythm.bodyLineSpacing)
            : rhythm.bodyLineSpacing,
      paraSpaceAfter: block.type === "heading" ? rhythm.listSpaceAfter : rhythm.paragraphSpaceAfter,
      fit: "shrink",
    });
    return position ? cursorY : y + h + rhythm.blockGap;
  }
  if (block.type === "callout") {
    const toneColor =
      block.tone === "positive"
        ? palette.positive
        : block.tone === "warning"
          ? palette.warning
          : block.tone === "neutral"
            ? palette.muted
            : palette.accent;
    const titleHeight = block.title ? textHeight(block.title, w - 0.5, 17, font, true) : 0;
    const bodyHeight = textHeight(block.text, w - 0.5, 15, font);
    const h = boxHeight(
      titleHeight +
        bodyHeight +
        rhythm.calloutPadding * 2 +
        (block.title ? rhythm.calloutTextGap : 0),
    );
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w,
      h,
      line: { color: palette.line, width: 0.75 },
      fill: { color: block.tone === "warning" ? palette.canvas : palette.accentSoft },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w: 0.07,
      h,
      line: { color: toneColor, transparency: 100 },
      fill: { color: toneColor },
    });
    if (block.title) {
      slide.addText(block.title, {
        x: x + 0.22,
        y: y + rhythm.calloutPadding,
        w: w - 0.4,
        h: titleHeight,
        fontFace: font,
        fontSize: 17,
        bold: true,
        color: toneColor,
        margin: 0,
        valign: "top",
        fit: "shrink",
      });
    }
    slide.addText(block.text, {
      x: x + 0.22,
      y: y + rhythm.calloutPadding + titleHeight + (block.title ? rhythm.calloutTextGap : 0),
      w: w - 0.4,
      h: bodyHeight,
      fontFace: font,
      fontSize: 15,
      color: palette.ink,
      margin: 0,
      valign: "top",
      breakLine: false,
      fit: "shrink",
      lineSpacingMultiple: rhythm.bodyLineSpacing,
    });
    return position ? cursorY : y + h + rhythm.blockGap;
  }
  if (block.type === "list") {
    if (presentationKind === "cards")
      return addPptxCards(
        pptx,
        slide,
        block.items,
        x,
        y,
        w,
        font,
        palette,
        position,
        cursorY,
        rhythm,
      );
    if (presentationKind === "timeline")
      return addPptxTimeline(
        pptx,
        slide,
        block.items,
        x,
        y,
        w,
        font,
        palette,
        position,
        cursorY,
        rhythm,
      );
    const h = boxHeight(
      block.items.reduce((sum, item) => sum + textHeight(item, w - 0.35, 18, font), 0),
    );
    slide.addText(block.items.join("\n"), {
      x,
      y,
      w,
      h,
      fontFace: font,
      fontSize: 16,
      lang: "zh-CN",
      color: palette.ink,
      margin: 2,
      valign: "top",
      breakLine: false,
      bullet: block.ordered
        ? { type: "number", numberType: "arabicPeriod", indent: 18 }
        : { indent: 18 },
      paraSpaceAfter: rhythm.listSpaceAfter,
      lineSpacingMultiple: rhythm.listLineSpacing,
      fit: "shrink",
    });
    return position ? cursorY : y + h + rhythm.blockGap;
  }
  if (block.type === "metric_grid")
    return addPptxMetricGrid(
      pptx,
      slide,
      block.metrics,
      block.columns,
      x,
      y,
      w,
      font,
      palette,
      position,
      cursorY,
      rhythm,
    );
  if (block.type === "table") {
    const textRows = block.rows.map((row) =>
      row.map((cell) => {
        if (typeof cell !== "string")
          throw new Error("PPTX table cells require plain text. Use DOCX for native equations.");
        return cell;
      }),
    );
    const rows = textRows.map((row, rowIndex) =>
      row.map((cell) => ({
        text: cell,
        options:
          block.header && rowIndex === 0
            ? {
                bold: true,
                color: palette.white,
                fill: { color: palette.accent },
                breakLine: false,
              }
            : {
                color: palette.ink,
                fill: {
                  color:
                    rowIndex % 2 === (block.header ? 0 : 1) ? palette.accentSoft : palette.panel,
                },
                breakLine: false,
              },
      })),
    );
    const columns = textRows[0]?.length ?? 1;
    const rowHeights = textRows.map((row, index) =>
      Math.max(
        0.34,
        ...row.map(
          (cell) =>
            textHeight(cell, w / columns - 0.16, 12, font, !!block.header && index === 0) +
            rhythm.tableRowPadding,
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
      fontSize: 12,
      lang: "zh-CN",
      color: palette.ink,
      border: { type: "solid", color: palette.line, pt: 0.75 },
      margin: 0.07,
      valign: "middle",
      bold: false,
      fill: { color: palette.panel },
      autoPage: false,
    });
    return position ? cursorY : y + h + rhythm.blockGap;
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
    return position ? cursorY : y + height + rhythm.blockGap;
  }
  return cursorY;
}

type PptxPosition = { x: number; y: number; w: number; h: number };

function addPptxCards(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS["addSlide"]>,
  items: string[],
  x: number,
  y: number,
  width: number,
  font: string,
  palette: OfficePalette,
  position: PptxPosition | undefined,
  cursorY: number,
  rhythm: PptxRhythm,
): number {
  if (items.length < 2 || items.length > 6)
    throw new Error("PPTX cards 布局需要 2 至 6 个列表项。");
  const columns = items.length <= 3 ? items.length : 2;
  const rows = Math.ceil(items.length / columns);
  const gap = rhythm.cardGap;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const availableHeight = (position ? y + position.h : SLIDE_BOTTOM) - y;
  const textHeights = items.map((item) =>
    textHeight(item, cardWidth - 0.36, item.length > 60 ? 13 : 15, font),
  );
  const minimumCardHeight = Math.max(
    rhythm.cardMinHeight,
    rhythm.cardTextTop + Math.max(...textHeights) + 0.14,
  );
  const cardHeight = Math.min(rhythm.cardMaxHeight, (availableHeight - gap * (rows - 1)) / rows);
  if (cardHeight < minimumCardHeight)
    throw new Error("PPTX cards 布局空间不足，请减少列表项或拆分幻灯片。");
  for (const [index, item] of items.entries()) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cardX = x + column * (cardWidth + gap);
    const cardY = y + row * (cardHeight + gap);
    slide.addShape(pptx.ShapeType.rect, {
      x: cardX,
      y: cardY,
      w: cardWidth,
      h: cardHeight,
      line: { color: palette.line, width: 0.75 },
      fill: { color: palette.panel },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: cardX,
      y: cardY,
      w: 0.06,
      h: cardHeight,
      line: { color: palette.accent, transparency: 100 },
      fill: { color: palette.accent },
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: cardX + 0.18,
      y: cardY + 0.18,
      w: 0.32,
      h: 0.32,
      line: { color: palette.accent, transparency: 100 },
      fill: { color: palette.accentSoft },
    });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: cardX + 0.18,
      y: cardY + 0.22,
      w: 0.32,
      h: 0.18,
      fontFace: font,
      fontSize: 9,
      bold: true,
      color: palette.accent,
      align: "center",
      valign: "middle",
      margin: 0,
    });
    slide.addText(item, {
      x: cardX + 0.18,
      y: cardY + rhythm.cardTextTop,
      w: cardWidth - 0.36,
      h: cardHeight - rhythm.cardTextTop - 0.14,
      fontFace: font,
      fontSize: item.length > 60 ? 13 : 15,
      color: palette.ink,
      margin: 0,
      valign: "top",
      breakLine: false,
      fit: "shrink",
      lineSpacingMultiple: rhythm.bodyLineSpacing,
    });
  }
  return position ? cursorY : y + rows * cardHeight + (rows - 1) * gap + rhythm.blockGap;
}

function addPptxTimeline(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS["addSlide"]>,
  items: string[],
  x: number,
  y: number,
  width: number,
  font: string,
  palette: OfficePalette,
  position: PptxPosition | undefined,
  cursorY: number,
  rhythm: PptxRhythm,
): number {
  if (items.length < 3 || items.length > 6)
    throw new Error("PPTX timeline 布局需要 3 至 6 个有序列表项。");
  const availableHeight = (position ? y + position.h : SLIDE_BOTTOM) - y;
  if (availableHeight < 1.2) throw new Error("PPTX timeline 布局空间不足，请拆分幻灯片。");
  const segment = width / items.length;
  slide.addShape(pptx.ShapeType.rect, {
    x,
    y: y + 0.38,
    w: width,
    h: 0.025,
    line: { color: palette.line, transparency: 100 },
    fill: { color: palette.line },
  });
  const labelWidth = Math.max(0.9, segment - 0.22);
  const labelHeight = Math.max(
    0.55,
    ...items.map((item) => textHeight(item, labelWidth, 12, font, true)),
  );
  for (const [index, item] of items.entries()) {
    const center = x + segment * index + segment / 2;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: center - 0.2,
      y: y + 0.2,
      w: 0.4,
      h: 0.4,
      line: { color: palette.accent, width: 1.25 },
      fill: { color: palette.accent },
    });
    slide.addText(String(index + 1), {
      x: center - 0.2,
      y: y + 0.29,
      w: 0.4,
      h: 0.18,
      fontFace: font,
      fontSize: 9,
      bold: true,
      color: palette.white,
      align: "center",
      valign: "middle",
      margin: 0,
    });
    slide.addText(item, {
      x: center - labelWidth / 2,
      y: y + rhythm.timelineLabelOffset,
      w: labelWidth,
      h: Math.min(labelHeight + 0.2, availableHeight - rhythm.timelineLabelOffset - 0.12),
      fontFace: font,
      fontSize: 12,
      bold: true,
      color: palette.ink,
      align: "center",
      valign: "top",
      margin: 0,
      breakLine: false,
      fit: "shrink",
      lineSpacingMultiple: rhythm.bodyLineSpacing,
    });
  }
  return position
    ? cursorY
    : y +
        Math.min(availableHeight, rhythm.timelineLabelOffset + labelHeight + 0.12) +
        rhythm.blockGap;
}

function addPptxMetricGrid(
  pptx: PptxGenJS,
  slide: ReturnType<PptxGenJS["addSlide"]>,
  metrics: Extract<DocumentBlock, { type: "metric_grid" }>["metrics"],
  requestedColumns: number | undefined,
  x: number,
  y: number,
  width: number,
  font: string,
  palette: OfficePalette,
  position: PptxPosition | undefined,
  cursorY: number,
  rhythm: PptxRhythm,
): number {
  const columns = requestedColumns ?? Math.min(3, metrics.length);
  const rows = Math.ceil(metrics.length / columns);
  const gap = rhythm.metricGap;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const availableHeight = (position ? y + position.h : SLIDE_BOTTOM) - y;
  const cardHeight = Math.min(rhythm.metricMaxHeight, (availableHeight - gap * (rows - 1)) / rows);
  if (cardHeight < rhythm.metricMinHeight)
    throw new Error("PPTX 指标卡空间不足，请减少指标、增加定位框高度或拆分幻灯片。");
  for (const [index, metric] of metrics.entries()) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cardX = x + column * (cardWidth + gap);
    const cardY = y + row * (cardHeight + gap);
    slide.addShape(pptx.ShapeType.rect, {
      x: cardX,
      y: cardY,
      w: cardWidth,
      h: cardHeight,
      line: { color: palette.line, width: 0.75 },
      fill: { color: palette.panel },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: cardX,
      y: cardY,
      w: cardWidth,
      h: 0.055,
      line: { color: palette.accent, transparency: 100 },
      fill: { color: palette.accent },
    });
    slide.addText(metric.value, {
      x: cardX + 0.2,
      y: cardY + 0.2,
      w: cardWidth - 0.4,
      h: 0.52,
      fontFace: font,
      fontSize: metric.value.length > 14 ? 22 : 28,
      bold: true,
      color: palette.accent,
      margin: 0,
      valign: "middle",
      breakLine: false,
      fit: "shrink",
    });
    slide.addText(metric.label, {
      x: cardX + 0.2,
      y: cardY + 0.78,
      w: cardWidth - 0.4,
      h: 0.3,
      fontFace: font,
      fontSize: 12,
      bold: true,
      color: palette.ink,
      margin: 0,
      valign: "top",
      breakLine: false,
      fit: "shrink",
    });
    if (metric.detail) {
      slide.addText(metric.detail, {
        x: cardX + 0.2,
        y: cardY + 1.08,
        w: cardWidth - 0.4,
        h: Math.max(0.16, cardHeight - 1.22),
        fontFace: font,
        fontSize: 9,
        color: palette.muted,
        margin: 0,
        valign: "top",
        breakLine: false,
        fit: "shrink",
      });
    }
  }
  return position ? cursorY : y + rows * cardHeight + (rows - 1) * gap + rhythm.blockGap;
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
    ...(request.edit?.operations.flatMap((item) =>
      item.type === "replace_blocks" ? item.blocks : [],
    ) ?? []),
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
  palette: OfficePalette,
): string {
  if (block.type === "equation")
    return equationHtml(
      block.latex,
      true,
      "pdf",
      block.layout?.align ?? block.align,
      htmlLayout(block.layout),
    );
  if (block.type === "markdown") return documentMarkdown(block.text, "pdf");
  if (block.type === "code") return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
  if (block.type === "quote") return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
  if (block.type === "callout") {
    const tone = block.tone && block.tone !== "accent" ? ` ${block.tone}` : "";
    return `<aside class="document-callout${tone}">${block.title ? `<strong>${escapeHtml(block.title)}</strong>` : ""}<p>${escapeHtml(block.text)}</p></aside>`;
  }
  if (block.type === "rich_paragraph")
    return `<p style="text-align:${block.align ?? "left"};${htmlLayout(block.layout)}">${block.runs
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
    const color = block.color ?? `#${level === 1 ? palette.accent : palette.ink}`;
    return `<h${level} style="color:${color};font-family:${escapeHtml(cssFont(font))};${htmlLayout(block.layout)}">${escapeHtml(block.text)}</h${level}>`;
  }
  if (block.type === "paragraph") {
    const style = [
      `font-family:${escapeHtml(cssFont(font))}`,
      `text-align:${block.align ?? "left"}`,
      `color:${block.color ?? `#${palette.ink}`}`,
      block.bold ? "font-weight:700" : "",
      block.italic ? "font-style:italic" : "",
      block.font_size ? `font-size:${block.font_size}pt` : "",
      htmlLayout(block.layout),
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
            : `<${cellTag} class="document-rich-cell">${cell.blocks.map((item) => renderHtmlBlock(item, assets, font, palette)).join("")}</${cellTag}>`,
        )
        .join("")}</tr>`;
    });
    const header = block.header ? `<thead>${rows.shift() ?? ""}</thead>` : "";
    const total = block.column_widths?.reduce((sum, value) => sum + value, 0) ?? 1;
    const columns = block.column_widths
      ? `<colgroup>${block.column_widths.map((value) => `<col style="width:${(value / total) * 100}%">`).join("")}</colgroup>`
      : "";
    return `<table>${columns}${header}<tbody>${rows.join("")}</tbody></table>`;
  }
  if (block.type === "image") {
    const image = assets.get(block.path);
    if (!image) throw new Error(`图片未提供给作者：${block.path}`);
    const maxWidth = block.width ?? 6.25;
    const maxHeight = block.height ?? 8;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    return `<img src="${image.dataUrl}" alt="${escapeHtml(block.alt ?? "Image")}" style="width:${image.width * scale}in;height:${image.height * scale}in;">`;
  }
  if (block.type === "metric_grid") throw new Error("metric_grid 只能用于 PPTX；PDF 请使用表格。");
  return "";
}

function htmlLayout(layout?: ParagraphLayout): string {
  if (!layout) return "";
  return [
    layout.align ? `text-align:${layout.align}` : "",
    layout.space_before !== undefined ? `margin-top:${layout.space_before}pt` : "",
    layout.space_after !== undefined ? `margin-bottom:${layout.space_after}pt` : "",
    layout.line_spacing !== undefined ? `line-height:${layout.line_spacing}` : "",
    layout.first_line_indent !== undefined ? `text-indent:${layout.first_line_indent}in` : "",
    layout.indent_left !== undefined ? `margin-left:${layout.indent_left}in` : "",
    layout.indent_right !== undefined ? `margin-right:${layout.indent_right}in` : "",
    layout.keep_with_next !== undefined
      ? `break-after:${layout.keep_with_next ? "avoid" : "auto"}`
      : "",
    layout.keep_together !== undefined
      ? `break-inside:${layout.keep_together ? "avoid" : "auto"}`
      : "",
    layout.page_break_before !== undefined
      ? `break-before:${layout.page_break_before ? "page" : "auto"}`
      : "",
  ]
    .filter(Boolean)
    .join(";");
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
