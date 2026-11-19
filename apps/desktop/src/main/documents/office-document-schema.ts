import { extname } from "node:path";
import { z } from "zod";
import { OFFICE_DESIGN_PRESETS } from "./office-visuals";

const MAX_PATH = 32_767;
const MAX_CELLS = 50_000;
const MAX_OPERATIONS = 500;
const MAX_TEXT = 100_000;
const ARGB = /^(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const A1_RANGE = /^\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6}(?::\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6})?$/i;

function hasUnsupportedControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if ((code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31))
      return true;
  }
  return false;
}

const pathSchema = z
  .string()
  .min(1)
  .max(MAX_PATH)
  .refine((value) => !value.includes("\0"), "路径无效。");
const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/, "SHA-256 格式无效。");
const textSchema = z
  .string()
  .max(MAX_TEXT)
  .refine((value) => !hasUnsupportedControlCharacter(value), "文字含控制字符。");
const colorSchema = z.string().regex(ARGB, "颜色必须是 RRGGBB 或 AARRGGBB。");
const rangeSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(A1_RANGE, "单元格范围必须是 A1 或 A1:C10 格式。");

const cellStyleSchema = z
  .object({
    font: z
      .object({
        name: z.string().min(1).max(120).optional(),
        size: z.number().finite().min(6).max(96).optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        underline: z.boolean().optional(),
        color: colorSchema.optional(),
      })
      .strict()
      .optional(),
    fill: colorSchema.optional(),
    border: z
      .object({
        color: colorSchema.optional(),
        style: z.enum(["thin", "medium", "thick", "dashed", "dotted", "double"]).optional(),
      })
      .strict()
      .optional(),
    alignment: z
      .object({
        horizontal: z.enum(["left", "center", "right", "justify"]).optional(),
        vertical: z.enum(["top", "middle", "bottom"]).optional(),
        wrap_text: z.boolean().optional(),
      })
      .strict()
      .optional(),
    number_format: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((style) => Object.keys(style).length > 0, "单元格样式不能为空。");

const scalarValueSchema = z.union([
  z.string().max(MAX_TEXT),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const officeCellValueSchema = z.union([
  scalarValueSchema,
  z
    .object({
      formula: z.string().min(1).max(8_192),
      result: scalarValueSchema.optional(),
    })
    .strict(),
]);

const cellSchema = z
  .object({
    row: z.number().int().min(1).max(1_048_576),
    column: z.number().int().min(1).max(16_384),
    value: officeCellValueSchema,
    style: cellStyleSchema.optional(),
  })
  .strict();

const spreadsheetThemeSchema = z
  .object({
    preset: z.enum(OFFICE_DESIGN_PRESETS).optional(),
    accent: colorSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "工作簿设计参数不能为空。");

const spreadsheetPresentationSchema = z
  .object({
    preset: z.enum(OFFICE_DESIGN_PRESETS).optional(),
    accent: colorSchema.optional(),
    title_range: rangeSchema.optional(),
    header_range: rangeSchema.optional(),
    body_range: rangeSchema.optional(),
    show_grid_lines: z.boolean().optional(),
    print_area: rangeSchema.optional(),
    print_titles_rows: z
      .string()
      .regex(/^[1-9][0-9]*:[1-9][0-9]*$/, "打印标题行必须使用 1:2 格式。")
      .optional(),
    orientation: z.enum(["portrait", "landscape"]).optional(),
    fit_to_page: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "工作表展示参数不能为空。");

const sheetSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(31)
      .refine((value) => !/[\\/?*[\]:]/.test(value), "工作表名称含 Excel 禁用字符。"),
    cells: z.array(cellSchema).max(MAX_CELLS).default([]),
    merges: z.array(rangeSchema).max(2_000).optional(),
    columns: z
      .array(
        z
          .object({
            index: z.number().int().min(1).max(16_384),
            width: z.number().finite().min(1).max(255),
            hidden: z.boolean().optional(),
          })
          .strict(),
      )
      .max(2_000)
      .optional(),
    freeze: z
      .object({
        row: z.number().int().min(0).max(1_048_575).default(0),
        column: z.number().int().min(0).max(16_383).default(0),
      })
      .strict()
      .optional(),
    filter: rangeSchema.optional(),
    tables: z
      .array(
        z
          .object({
            name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]{0,254}$/),
            range: rangeSchema,
            style: z
              .enum([
                "TableStyleLight1",
                "TableStyleLight9",
                "TableStyleMedium2",
                "TableStyleMedium4",
                "TableStyleMedium9",
                "TableStyleDark3",
              ])
              .optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    presentation: spreadsheetPresentationSchema.optional(),
  })
  .strict();

const spreadsheetOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_sheet"), name: z.string().min(1).max(31) }).strict(),
  z
    .object({
      type: z.literal("rename_sheet"),
      sheet: z.string().min(1).max(31),
      name: z.string().min(1).max(31),
    })
    .strict(),
  z.object({ type: z.literal("delete_sheet"), sheet: z.string().min(1).max(31) }).strict(),
  z
    .object({
      type: z.literal("set_cells"),
      sheet: z.string().min(1).max(31),
      cells: z.array(cellSchema).min(1).max(MAX_CELLS),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_range"),
      sheet: z.string().min(1).max(31),
      range: rangeSchema,
      rows: z.array(z.array(officeCellValueSchema).min(1)).min(1).max(10_000),
      style: cellStyleSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("append_rows"),
      sheet: z.string().min(1).max(31),
      rows: z.array(z.array(officeCellValueSchema).min(1)).min(1).max(10_000),
      style: cellStyleSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("style_range"),
      sheet: z.string().min(1).max(31),
      range: rangeSchema,
      style: cellStyleSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("merge_range"),
      sheet: z.string().min(1).max(31),
      range: rangeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("unmerge_range"),
      sheet: z.string().min(1).max(31),
      range: rangeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("set_columns"),
      sheet: z.string().min(1).max(31),
      start: z.number().int().min(1).max(16_384),
      end: z.number().int().min(1).max(16_384),
      width: z.number().finite().min(1).max(255),
      hidden: z.boolean().optional(),
    })
    .strict()
    .refine((operation) => operation.end >= operation.start, "结束列早于开始列。"),
  z
    .object({
      type: z.literal("freeze"),
      sheet: z.string().min(1).max(31),
      row: z.number().int().min(0).max(1_048_575),
      column: z.number().int().min(0).max(16_383),
    })
    .strict(),
  z
    .object({
      type: z.literal("filter"),
      sheet: z.string().min(1).max(31),
      range: rangeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("add_table"),
      sheet: z.string().min(1).max(31),
      name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]{0,254}$/),
      range: rangeSchema,
      style: z
        .enum([
          "TableStyleLight1",
          "TableStyleLight9",
          "TableStyleMedium2",
          "TableStyleMedium4",
          "TableStyleMedium9",
          "TableStyleDark3",
        ])
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("format_sheet"),
      sheet: z.string().min(1).max(31),
      presentation: spreadsheetPresentationSchema,
    })
    .strict(),
]);

const presentationOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("replace_shape_text"),
      slide: z.number().int().min(1).max(1_000),
      shape_id: z.number().int().min(1).max(2_147_483_647),
      old_text: z.string().min(1).max(MAX_TEXT),
      new_text: textSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("set_table_cell"),
      slide: z.number().int().min(1).max(1_000),
      table: z.number().int().min(1).max(1_000),
      row: z.number().int().min(1).max(1_000),
      column: z.number().int().min(1).max(1_000),
      text: textSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("replace_notes_text"),
      slide: z.number().int().min(1).max(1_000),
      old_text: z.string().min(1).max(MAX_TEXT),
      new_text: textSchema,
    })
    .strict(),
]);

export const officeDocumentSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("inspect"),
      path: pathSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("create_spreadsheet"),
      path: pathSchema,
      overwrite: z.boolean().default(false),
      workbook: z
        .object({
          design: spreadsheetThemeSchema.optional(),
          sheets: z.array(sheetSchema).min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("edit_spreadsheet"),
      path: pathSchema,
      overwrite: z.boolean().default(false),
      source: z.object({ path: pathSchema, expected_sha256: sha256Schema }).strict(),
      operations: z.array(spreadsheetOperationSchema).min(1).max(MAX_OPERATIONS),
    })
    .strict(),
  z
    .object({
      operation: z.literal("edit_presentation"),
      path: pathSchema,
      overwrite: z.boolean().default(false),
      source: z.object({ path: pathSchema, expected_sha256: sha256Schema }).strict(),
      operations: z.array(presentationOperationSchema).min(1).max(MAX_OPERATIONS),
    })
    .strict(),
  z
    .object({
      operation: z.literal("verify"),
      path: pathSchema,
      overwrite: z.boolean().default(false),
      render: z.boolean().default(true),
      recalculate: z.boolean().default(false),
      timeout_ms: z.number().int().min(5_000).max(180_000).default(60_000),
      render_path: pathSchema.optional(),
      output_path: pathSchema.optional(),
    })
    .strict()
    .refine((input) => !input.render_path || input.render, {
      message: "render_path 需要 render:true。",
      path: ["render_path"],
    })
    .refine((input) => !input.output_path || input.recalculate, {
      message: "output_path 需要 recalculate:true。",
      path: ["output_path"],
    }),
]);

export type OfficeDocumentInput = z.infer<typeof officeDocumentSchema>;
export type OfficeSpreadsheetSpec = z.infer<typeof sheetSchema>;
export type OfficeSpreadsheetTheme = z.infer<typeof spreadsheetThemeSchema>;
export type OfficeSpreadsheetPresentation = z.infer<typeof spreadsheetPresentationSchema>;
export type OfficeCellValue = z.infer<typeof officeCellValueSchema>;
export type OfficeCellStyle = z.infer<typeof cellStyleSchema>;

export function assertOfficeInputExtensions(input: OfficeDocumentInput): void {
  const target =
    input.operation === "inspect" || input.operation === "verify" ? input.path : input.path;
  const extension = extname(target).toLowerCase();
  if (input.operation === "create_spreadsheet" || input.operation === "edit_spreadsheet") {
    if (extension !== ".xlsx") throw new Error("电子表格操作只支持 .xlsx。");
  } else if (input.operation === "edit_presentation") {
    if (extension !== ".pptx") throw new Error("演示文稿编辑只支持 .pptx。");
  } else if (![".docx", ".xlsx", ".pptx"].includes(extension)) {
    throw new Error("Office 检查只支持 .docx、.xlsx 或 .pptx。");
  }
  if ("source" in input) {
    const sourceExtension = extname(input.source.path).toLowerCase();
    if (sourceExtension !== extension)
      throw new Error("源文件与输出文件必须使用同一种 Office 格式。");
  }
  if (input.operation === "verify") {
    if (input.render_path) {
      if (extname(input.render_path).toLowerCase() !== ".pdf")
        throw new Error("render_path 必须使用 .pdf 扩展名。");
      if (input.render_path.toLowerCase() === input.path.toLowerCase())
        throw new Error("render_path 不能覆盖待验证的 Office 源文件。");
    }
    if (input.output_path) {
      if (extension !== ".xlsx") throw new Error("output_path 只用于保存 XLSX 重算结果。");
      if (extname(input.output_path).toLowerCase() !== ".xlsx")
        throw new Error("output_path 必须使用 .xlsx 扩展名。");
      if (input.output_path.toLowerCase() === input.path.toLowerCase())
        throw new Error("output_path 不能覆盖待验证的 XLSX 源文件。");
    }
  }
}
