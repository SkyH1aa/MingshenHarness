import { extname } from "node:path";
import { z } from "zod";
import { OFFICE_DESIGN_DENSITIES, OFFICE_DESIGN_PRESETS } from "./office-visuals";

const MAX_TEXT_LENGTH = 500_000;
const MAX_BLOCKS = 500;
const MAX_SLIDES = 100;
const MAX_TOTAL_BLOCKS = 1_000;
const MAX_TABLE_CELLS = 20_000;
const MAX_SPEC_BYTES = 1 * 1024 * 1024;
const MAX_IMAGE_PATH = 32_767;
const MAX_POSITION = 40;

export const PRESENTATION_WIDTH_INCHES = 13.333333;
export const PRESENTATION_HEIGHT_INCHES = 7.5;
export const MAX_AUTHORING_IMAGE_BYTES = 20 * 1024 * 1024;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色必须是 #RRGGBB。");
export const documentDesignSchema = z
  .object({
    preset: z.enum(OFFICE_DESIGN_PRESETS).optional(),
    density: z.enum(OFFICE_DESIGN_DENSITIES).optional(),
    accent: colorSchema.optional(),
    cover_page: z.boolean().optional(),
  })
  .strict()
  .refine((design) => Object.keys(design).length > 0, "设计参数不能为空。");
const safeText = (label: string, max = 100_000) =>
  z
    .string()
    .min(1, `${label}不能为空。`)
    .max(max, `${label}过长。`)
    .refine((value) => value.trim().length > 0, `${label}不能只有空白。`)
    .refine(hasValidXmlCharacters, `${label}含有不可写入文档的控制字符。`);
const optionalText = (label: string, max = 100_000) =>
  z
    .string()
    .max(max, `${label}过长。`)
    .refine(hasValidXmlCharacters, `${label}含有不可写入文档的控制字符。`);

const positionSchema = z
  .object({
    x: z.number().finite().min(0).max(MAX_POSITION),
    y: z.number().finite().min(0).max(MAX_POSITION),
    w: z.number().finite().positive().max(MAX_POSITION),
    h: z.number().finite().positive().max(MAX_POSITION),
  })
  .strict()
  .refine(
    (position) =>
      position.x + position.w <= PRESENTATION_WIDTH_INCHES + 0.000001 &&
      position.y + position.h <= PRESENTATION_HEIGHT_INCHES,
    "定位块超出 13.333 × 7.5 英寸幻灯片画布。",
  );

const blockBase = z.object({ position: positionSchema.optional() }).strict();
export const paragraphLayoutSchema = z
  .object({
    align: z.enum(["left", "center", "right", "justify"]).optional(),
    space_before: z.number().finite().min(0).max(144).optional(),
    space_after: z.number().finite().min(0).max(144).optional(),
    line_spacing: z.number().finite().min(0.8).max(3).optional(),
    first_line_indent: z.number().finite().min(0).max(2).optional(),
    indent_left: z.number().finite().min(0).max(3).optional(),
    indent_right: z.number().finite().min(0).max(3).optional(),
    keep_with_next: z.boolean().optional(),
    keep_together: z.boolean().optional(),
    page_break_before: z.boolean().optional(),
  })
  .strict()
  .refine((layout) => Object.keys(layout).length > 0, "排版参数不能为空。");
const linkSchema = z
  .string()
  .max(4000)
  .url()
  .refine((value) => /^(https?:|mailto:)/i.test(value), "链接仅支持 HTTPS、HTTP 或 mailto。");
const inlineSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: optionalText("文字"),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      underline: z.boolean().optional(),
      strike: z.boolean().optional(),
      code: z.boolean().optional(),
      link: linkSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("equation"), latex: safeText("LaTeX", 10000) }).strict(),
  z.object({ type: z.literal("footnote"), text: safeText("脚注", 10000) }).strict(),
]);
const richParagraphSchema = blockBase
  .extend({
    type: z.literal("rich_paragraph"),
    runs: z.array(inlineSchema).min(1).max(500),
    align: z.enum(["left", "center", "right"]).optional(),
    layout: paragraphLayoutSchema.optional(),
  })
  .strict();
const equationSchema = blockBase
  .extend({
    type: z.literal("equation"),
    latex: safeText("LaTeX", 10000),
    align: z.enum(["left", "center", "right"]).optional(),
    layout: paragraphLayoutSchema.optional(),
  })
  .strict();
const markdownSchema = z
  .object({ type: z.literal("markdown"), text: safeText("Markdown", 100000) })
  .strict();
const codeSchema = z
  .object({
    type: z.literal("code"),
    text: safeText("代码"),
    language: optionalText("语言", 100).optional(),
  })
  .strict();
const quoteSchema = z.object({ type: z.literal("quote"), text: safeText("引用") }).strict();
const calloutSchema = blockBase
  .extend({
    type: z.literal("callout"),
    title: optionalText("提示标题", 500).optional(),
    text: safeText("提示内容", 20_000),
    tone: z.enum(["accent", "positive", "warning", "neutral"]).optional(),
  })
  .strict();
const tocSchema = z
  .object({ type: z.literal("table_of_contents"), title: optionalText("目录标题", 100).optional() })
  .strict();
const chartSchema = blockBase
  .extend({
    type: z.literal("chart"),
    chart_type: z.enum(["bar", "column", "line", "pie"]),
    title: optionalText("图表标题", 1000).optional(),
    categories: z.array(safeText("图表类别", 200)).min(1).max(100),
    series: z
      .array(
        z
          .object({
            name: safeText("序列名称", 200),
            values: z.array(z.number().finite()).min(1).max(100),
            color: colorSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .superRefine((chart, ctx) => {
    if (chart.series.some((series) => series.values.length !== chart.categories.length))
      ctx.addIssue({ code: "custom", message: "每个图表序列必须与类别数量一致。" });
    if (
      chart.chart_type === "pie" &&
      (chart.series.length !== 1 ||
        chart.series[0]?.values.some((value) => value < 0) ||
        !chart.series[0]?.values.some((value) => value > 0))
    )
      ctx.addIssue({ code: "custom", message: "饼图需要一个非负且非全零的序列。" });
  });

const metricSchema = z
  .object({
    value: safeText("指标值", 200),
    label: safeText("指标名称", 500),
    detail: optionalText("指标说明", 2_000).optional(),
  })
  .strict();

const metricGridSchema = blockBase
  .extend({
    type: z.literal("metric_grid"),
    metrics: z.array(metricSchema).min(2).max(6),
    columns: z.number().int().min(2).max(3).optional(),
  })
  .strict();

const headingBlockSchema = blockBase
  .extend({
    type: z.literal("heading"),
    text: safeText("标题", 20_000),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    color: colorSchema.optional(),
    layout: paragraphLayoutSchema.optional(),
  })
  .strict();

const paragraphBlockSchema = blockBase
  .extend({
    type: z.literal("paragraph"),
    text: safeText("段落", 100_000),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    font_size: z.number().finite().positive().max(96).optional(),
    color: colorSchema.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    layout: paragraphLayoutSchema.optional(),
  })
  .strict();

const listBlockSchema = blockBase
  .extend({
    type: z.literal("list"),
    items: z.array(safeText("列表项", 20_000)).min(1, "列表至少需要一项。").max(500),
    ordered: z.boolean().optional(),
  })
  .strict();

const tableCellBlockSchema = z.discriminatedUnion("type", [
  paragraphBlockSchema,
  richParagraphSchema,
  equationSchema,
  markdownSchema,
  listBlockSchema,
  codeSchema,
  quoteSchema,
]);

const tableCellSchema = z.union([
  optionalText("表格单元格", 20_000),
  z
    .object({ blocks: z.array(tableCellBlockSchema).min(1).max(50) })
    .strict()
    .superRefine((cell, ctx) => {
      if (collectText(cell).length > 20_000)
        ctx.addIssue({ code: "custom", message: "表格单元格文字不能超过 20000 个字符。" });
      if (cell.blocks.some((block) => "position" in block && block.position !== undefined))
        ctx.addIssue({ code: "custom", message: "表格单元格使用自动排版，不能设置 position。" });
    }),
]);

const tableBlockSchema = blockBase
  .extend({
    type: z.literal("table"),
    rows: z
      .array(z.array(tableCellSchema).min(1).max(200))
      .min(1)
      .max(500)
      .refine(
        (rows) => rows.every((row) => row.length === rows[0]?.length),
        "表格各行必须有相同的列数。",
      ),
    header: z.boolean().optional(),
    column_widths: z.array(z.number().finite().positive().max(100)).min(1).max(200).optional(),
  })
  .strict();

const imageBlockSchema = blockBase
  .extend({
    type: z.literal("image"),
    path: z.string().min(1).max(MAX_IMAGE_PATH).refine(noNullCharacter, "图片路径无效。"),
    width: z.number().finite().positive().max(MAX_POSITION).optional(),
    height: z.number().finite().positive().max(MAX_POSITION).optional(),
    alt: optionalText("图片替代文本", 2_000).optional(),
  })
  .strict();

const pageBreakBlockSchema = z
  .object({
    type: z.literal("page_break"),
  })
  .strict();

export const documentBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  listBlockSchema,
  tableBlockSchema,
  imageBlockSchema,
  pageBreakBlockSchema,
  richParagraphSchema,
  equationSchema,
  markdownSchema,
  codeSchema,
  quoteSchema,
  calloutSchema,
  tocSchema,
  chartSchema,
  metricGridSchema,
]);

const documentEditOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("replace_text"),
      paragraph: z.number().int().positive().max(100_000),
      old_text: safeText("待替换文字"),
      new_text: optionalText("替换文字"),
    })
    .strict(),
  z
    .object({
      type: z.literal("replace_blocks"),
      start_block: z.number().int().positive().max(100_000),
      end_block: z.number().int().positive().max(100_000),
      blocks: z.array(documentBlockSchema).max(MAX_BLOCKS),
    })
    .strict()
    .refine(
      (operation) => operation.end_block >= operation.start_block,
      "区段结束位置早于开始位置。",
    ),
  z
    .object({
      type: z.literal("format_paragraph"),
      paragraph: z.number().int().positive().max(100_000),
      layout: paragraphLayoutSchema,
    })
    .strict(),
]);

const slideSchema = z
  .object({
    title: optionalText("幻灯片标题", 20_000).optional(),
    eyebrow: optionalText("幻灯片眉题", 500).optional(),
    kind: z
      .enum([
        "auto",
        "cover",
        "section",
        "content",
        "statement",
        "cards",
        "timeline",
        "data",
        "closing",
      ])
      .optional(),
    notes: optionalText("演讲者备注", 50_000).optional(),
    background: colorSchema.optional(),
    blocks: z.array(documentBlockSchema).max(MAX_BLOCKS).default([]),
  })
  .strict();

export const documentAuthoringSchema = z
  .object({
    path: z
      .string()
      .min(1, "输出路径不能为空。")
      .max(MAX_IMAGE_PATH, "输出路径过长。")
      .refine(noNullCharacter, "输出路径无效。"),
    title: optionalText("文档标题", 20_000).optional(),
    author: optionalText("作者", 1_000).optional(),
    header: optionalText("页眉", 2000).optional(),
    footer: optionalText("页脚", 2000).optional(),
    page_numbers: z.boolean().optional(),
    margins: z
      .object({
        top: z.number().min(0.3).max(2),
        bottom: z.number().min(0.3).max(2),
        left: z.number().min(0.3).max(2),
        right: z.number().min(0.3).max(2),
      })
      .strict()
      .optional(),
    template: z
      .object({
        path: z.string().min(1).max(MAX_IMAGE_PATH).refine(noNullCharacter),
        replacements: z
          .array(
            z
              .object({
                placeholder: safeText("占位符名称", 200).refine((v) => !/[{}]/.test(v)),
                blocks: z.array(documentBlockSchema).min(1).max(MAX_BLOCKS),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .optional(),
    edit: z
      .object({
        path: z.string().min(1).max(MAX_IMAGE_PATH).refine(noNullCharacter),
        expected_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
        operations: z.array(documentEditOperationSchema).min(1).max(100),
      })
      .strict()
      .optional(),
    overwrite: z.boolean().default(false),
    page_size: z.enum(["A4", "Letter"]).optional(),
    orientation: z.enum(["portrait", "landscape"]).optional(),
    design: documentDesignSchema.optional(),
    font: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\p{L}\p{N} .,'()_-]+$/u, "字体名称含有不支持的字符。")
      .default("Microsoft YaHei"),
    blocks: z.array(documentBlockSchema).max(MAX_BLOCKS).optional(),
    slides: z.array(slideSchema).max(MAX_SLIDES).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    const extension = extname(request.path).toLowerCase();
    const blocks =
      request.blocks ??
      request.template?.replacements.flatMap((item) => item.blocks) ??
      request.edit?.operations.flatMap((item) =>
        item.type === "replace_blocks" ? item.blocks : [],
      ) ??
      [];
    const slides = request.slides ?? [];
    const topLevelBlocks = [...blocks, ...slides.flatMap((slide) => slide.blocks)];
    const allBlocks = topLevelBlocks.flatMap<DocumentBlock>((block) =>
      block.type === "table"
        ? [
            block,
            ...block.rows.flatMap((row) =>
              row.flatMap((cell) => (typeof cell === "string" ? [] : cell.blocks)),
            ),
          ]
        : [block],
    );
    const totalBlocks = allBlocks.length;
    const tableCells = topLevelBlocks
      .filter((block): block is z.infer<typeof tableBlockSchema> => block.type === "table")
      .reduce(
        (total, table) => total + table.rows.reduce((rowTotal, row) => rowTotal + row.length, 0),
        0,
      );
    const textSize = collectText(request).length;
    const source = request.template ?? request.edit;
    if (source) {
      if (
        extension !== ".docx" ||
        extname(source.path).toLowerCase() !== ".docx" ||
        (request.template !== undefined && request.edit !== undefined) ||
        request.blocks !== undefined ||
        request.slides !== undefined ||
        request.title !== undefined ||
        request.author !== undefined ||
        request.header !== undefined ||
        request.footer !== undefined ||
        request.page_numbers !== undefined ||
        request.margins !== undefined ||
        request.page_size !== undefined ||
        request.orientation !== undefined ||
        request.design !== undefined
      )
        ctx.addIssue({
          code: "custom",
          message:
            "模板或旧稿编辑仅支持 DOCX，二者互斥，不同时传 blocks/slides 或文档级标题、作者、页眉页脚、页码、边距、纸张、方向或设计参数。模板保留原有版式，旧稿保留未选区段。",
        });
      if (
        request.template &&
        new Set(request.template.replacements.map((item) => item.placeholder)).size !==
          request.template.replacements.length
      )
        ctx.addIssue({ code: "custom", message: "模板占位符名称不能重复。" });
      if (allBlocks.some((block) => block.type === "table_of_contents"))
        ctx.addIssue({ code: "custom", message: "模板填充或旧稿编辑不新增目录字段。" });
    }
    if (
      extension === ".pptx" &&
      (request.header !== undefined ||
        request.page_numbers !== undefined ||
        request.margins !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "PPTX 不使用文档页眉、页码和页边距；footer 可作为母版页脚文字。",
      });
    for (const block of allBlocks) {
      if (
        block.type === "table" &&
        block.column_widths &&
        block.column_widths.length !== block.rows[0]?.length
      )
        ctx.addIssue({ code: "custom", message: "column_widths 数量必须与表格列数一致。" });
      if (
        extension === ".pptx" &&
        (("layout" in block && block.layout !== undefined) ||
          (block.type === "table" && block.column_widths !== undefined))
      )
        ctx.addIssue({ code: "custom", message: "layout 和 column_widths 目前仅支持 DOCX/PDF。" });
      if (
        extension === ".pptx" &&
        block.type === "table" &&
        block.rows.some((row) => row.some((cell) => typeof cell !== "string"))
      )
        ctx.addIssue({
          code: "custom",
          message: "富文本和公式表格单元格仅用于 DOCX/PDF；PPTX 表格单元格请使用纯文本。",
        });
      if (
        extension === ".pptx" &&
        ["equation", "markdown", "code", "quote", "table_of_contents", "rich_paragraph"].includes(
          block.type,
        )
      )
        ctx.addIssue({
          code: "custom",
          message:
            "此富文本/公式块用于 DOCX/PDF；原生可编辑公式请输出 DOCX，PPTX 不会静默转换为图片。",
        });
      if (extension !== ".pptx" && block.type === "metric_grid")
        ctx.addIssue({
          code: "custom",
          message: "metric_grid 是原生 PowerPoint 指标卡布局；DOCX/PDF 请使用表格。",
        });
      if (
        extension === ".pdf" &&
        (block.type === "chart" ||
          block.type === "table_of_contents" ||
          (block.type === "rich_paragraph" && block.runs.some((run) => run.type === "footnote")))
      )
        ctx.addIssue({
          code: "custom",
          message: "原生图表、自动目录和脚注请输出 DOCX；PDF 不支持这些结构块。",
        });
    }

    if (![".docx", ".pptx", ".pdf"].includes(extension)) {
      ctx.addIssue({
        code: "custom",
        path: ["path"],
        message: "只支持 .docx、.pptx 或 .pdf 输出。",
      });
    }
    if (extension === ".pptx") {
      if (slides.length === 0) {
        ctx.addIssue({ code: "custom", path: ["slides"], message: "PPTX 至少需要一张幻灯片。" });
      }
      if (request.design?.cover_page !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["design", "cover_page"],
          message: "PPTX 请使用 slide.kind=cover，不使用 design.cover_page。",
        });
      }
      if (request.blocks !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks"],
          message: "PPTX 只能使用 slides，不能同时传 blocks。",
        });
      }
      for (const [index, slide] of slides.entries()) {
        if (!slide.title?.trim() && !slide.blocks.some(hasContent)) {
          ctx.addIssue({
            code: "custom",
            path: ["slides", index, "blocks"],
            message: "幻灯片需要标题，或非空文字、表格、图片等内容。",
          });
        }
        if (slide.blocks.some((block) => block.type === "page_break")) {
          ctx.addIssue({
            code: "custom",
            path: ["slides", index, "blocks"],
            message: "PPTX 请使用独立 slides 分页，不能使用 page_break。",
          });
        }
      }
    } else {
      if (blocks.length === 0 && !request.edit) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks"],
          message: "DOCX/PDF 至少需要一个内容块。",
        });
      }
      if (request.slides !== undefined) {
        ctx.addIssue({ code: "custom", path: ["slides"], message: "DOCX/PDF 不能使用 slides。" });
      }
      if (!blocks.some(hasContent) && !request.edit) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks"],
          message: "文档需要非空文字、表格或图片，不能只有分页或空白。",
        });
      }
      if (allBlocks.some((block) => "position" in block && block.position !== undefined)) {
        ctx.addIssue({
          code: "custom",
          path: ["blocks"],
          message: "position 仅适用于 PPTX；DOCX/PDF 使用自动分页。",
        });
      }
    }
    if (totalBlocks > MAX_TOTAL_BLOCKS) {
      ctx.addIssue({ code: "custom", message: `内容块不能超过 ${MAX_TOTAL_BLOCKS} 个。` });
    }
    if (tableCells > MAX_TABLE_CELLS) {
      ctx.addIssue({ code: "custom", message: `表格单元格不能超过 ${MAX_TABLE_CELLS} 个。` });
    }
    if (textSize > MAX_TEXT_LENGTH) {
      ctx.addIssue({ code: "custom", message: `文档文字不能超过 ${MAX_TEXT_LENGTH} 个字符。` });
    }
    try {
      const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
      if (bytes > MAX_SPEC_BYTES) {
        ctx.addIssue({ code: "custom", message: "文档生成参数超过 1 MiB。" });
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "文档生成参数无法序列化。" });
    }
  })
  .overwrite((request) =>
    request.template || request.edit
      ? request
      : {
          ...request,
          page_size: request.page_size ?? "Letter",
          orientation: request.orientation ?? "portrait",
        },
  );

export type DocumentAuthoringRequest = z.infer<typeof documentAuthoringSchema>;
export type DocumentBlock = z.infer<typeof documentBlockSchema>;
export type DocumentTableCell = z.infer<typeof tableCellSchema>;
export type DocumentSlide = z.infer<typeof slideSchema>;
export type DocumentDesign = z.infer<typeof documentDesignSchema>;
export type ParagraphLayout = z.infer<typeof paragraphLayoutSchema>;
export type DocumentEditOperation = z.infer<typeof documentEditOperationSchema>;

export const MAX_AUTHORED_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function documentAssetPaths(request: DocumentAuthoringRequest): string[] {
  const paths = new Set<string>();
  for (const block of [
    ...(request.blocks ?? []),
    ...(request.template?.replacements.flatMap((item) => item.blocks) ?? []),
    ...(request.edit?.operations.flatMap((item) =>
      item.type === "replace_blocks" ? item.blocks : [],
    ) ?? []),
    ...(request.slides?.flatMap((slide) => slide.blocks) ?? []),
  ]) {
    if (block.type === "image") paths.add(block.path);
  }
  return [...paths];
}

export function documentExtension(request: DocumentAuthoringRequest): ".docx" | ".pptx" | ".pdf" {
  const extension = extname(request.path).toLowerCase();
  if (extension !== ".docx" && extension !== ".pptx" && extension !== ".pdf") {
    throw new Error("只支持 .docx、.pptx 或 .pdf 输出。");
  }
  return extension;
}

export function hasValidXmlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code !== 0x09 &&
      code !== 0x0a &&
      code !== 0x0d &&
      ((code >= 0 && code < 0x20) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        code === 0xfffe ||
        code === 0xffff)
    ) {
      return false;
    }
  }
  return true;
}

function noNullCharacter(value: string): boolean {
  return !value.includes("\0");
}

function hasContent(block: DocumentBlock): boolean {
  if (block.type === "rich_paragraph")
    return block.runs.some((run) => run.type === "equation" || run.text.trim().length > 0);
  if (["equation", "markdown", "code", "quote", "callout", "chart"].includes(block.type))
    return true;
  if (block.type === "image") return true;
  if (block.type === "metric_grid") return block.metrics.some((metric) => metric.value.trim());
  if (block.type === "heading" || block.type === "paragraph") return block.text.trim().length > 0;
  if (block.type === "list") return block.items.some((item) => item.trim().length > 0);
  if (block.type === "table")
    return block.rows.some((row) =>
      row.some((cell) =>
        typeof cell === "string" ? cell.trim().length > 0 : cell.blocks.some(hasContent),
      ),
    );
  return false;
}

function collectText(request: unknown): string {
  if (!request || typeof request !== "object") return "";
  const source = request as Record<string, unknown>;
  const values: string[] = [];
  const collectBlock = (block: unknown) => {
    if (!block || typeof block !== "object") return;
    const value = block as Record<string, unknown>;
    for (const key of ["text", "alt", "latex", "title"])
      if (typeof value[key] === "string") values.push(value[key] as string);
    if (Array.isArray(value.items))
      values.push(...value.items.filter((item): item is string => typeof item === "string"));
    if (Array.isArray(value.rows)) {
      for (const row of value.rows)
        if (Array.isArray(row))
          for (const cell of row) {
            if (typeof cell === "string") values.push(cell);
            else if (cell && typeof cell === "object" && Array.isArray(cell.blocks))
              cell.blocks.forEach(collectBlock);
          }
    }
    if (Array.isArray(value.runs)) value.runs.forEach(collectBlock);
    if (Array.isArray(value.series))
      for (const series of value.series)
        if (series && typeof series.name === "string") values.push(series.name);
    if (Array.isArray(value.categories))
      values.push(...value.categories.filter((item): item is string => typeof item === "string"));
    if (Array.isArray(value.metrics)) {
      for (const metric of value.metrics) {
        if (!metric || typeof metric !== "object") continue;
        for (const key of ["value", "label", "detail"])
          if (typeof metric[key] === "string") values.push(metric[key]);
      }
    }
  };
  for (const key of ["title", "author", "header", "footer"])
    if (typeof source[key] === "string") values.push(source[key]);
  if (Array.isArray(source.blocks)) source.blocks.forEach(collectBlock);
  if (source.template && typeof source.template === "object") {
    const replacements = (source.template as { replacements?: Array<{ blocks?: unknown[] }> })
      .replacements;
    replacements?.forEach((item) => {
      item.blocks?.forEach(collectBlock);
    });
  }
  if (source.edit && typeof source.edit === "object") {
    const operations = (source.edit as { operations?: Array<Record<string, unknown>> }).operations;
    for (const operation of operations ?? []) {
      if (Array.isArray(operation.blocks)) operation.blocks.forEach(collectBlock);
      for (const key of ["old_text", "new_text"])
        if (typeof operation[key] === "string") values.push(operation[key]);
    }
  }
  if (Array.isArray(source.slides)) {
    for (const slide of source.slides) {
      if (slide && typeof slide === "object") {
        const value = slide as Record<string, unknown>;
        for (const key of ["title", "notes"])
          if (typeof value[key] === "string") values.push(value[key] as string);
        if (typeof value.eyebrow === "string") values.push(value.eyebrow);
        if (Array.isArray(value.blocks)) value.blocks.forEach(collectBlock);
      }
    }
  }
  return values.join("");
}
