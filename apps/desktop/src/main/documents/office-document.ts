import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import ExcelJS from "exceljs";
import { strFromU8, strToU8, type Unzipped, unzipSync, zipSync } from "fflate";
import { readDocxStructure } from "./document-edit";
import { validateDocumentArchive } from "./document-extractor";
import {
  assertOfficeInputExtensions,
  type OfficeCellStyle,
  type OfficeCellValue,
  type OfficeDocumentInput,
  type OfficeSpreadsheetPresentation,
  type OfficeSpreadsheetSpec,
  type OfficeSpreadsheetTheme,
  officeDocumentSchema,
} from "./office-document-schema";
import { type OfficePalette, resolveOfficeVisual } from "./office-visuals";

const MAX_OFFICE_BYTES = 25 * 1024 * 1024;
const MAX_INSPECT_CELLS = 2_000;
const MAX_INSPECT_OBJECTS = 2_000;
const MAX_COM_OUTPUT = 64 * 1024;
const OFFICE_OWNER_FILE = "office-owner.json";
const OFFICE_CLEANUP_TIMEOUT_MS = 10_000;
const EXCEL_MUTABLE = [
  /^\[Content_Types\]\.xml$/i,
  /^_rels\/\.rels$/i,
  /^docProps\/(?:core|app)\.xml$/i,
  /^xl\/workbook\.xml$/i,
  /^xl\/_rels\/workbook\.xml\.rels$/i,
  /^xl\/styles\.xml$/i,
  /^xl\/sharedStrings\.xml$/i,
  /^xl\/calcChain\.xml$/i,
  /^xl\/worksheets\/sheet\d+\.xml$/i,
  /^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/i,
  /^xl\/tables\/table\d+\.xml$/i,
];
const PPT_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const PPT_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PPT_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WORD_AUTOMATIC_FIELD = /^\s*(INCLUDETEXT|INCLUDEPICTURE|LINK|DDE|DDEAUTO|DATABASE)\b/i;
const serializer = new XMLSerializer();
type ExcelTableTheme =
  | "TableStyleLight1"
  | "TableStyleLight9"
  | "TableStyleMedium2"
  | "TableStyleMedium4"
  | "TableStyleMedium9"
  | "TableStyleDark3";

export interface OfficeDocumentResult {
  output: string;
  warnings: string[];
  bytes?: Buffer;
  rendition?: {
    extension: ".pdf";
    bytes: Buffer;
    suggestedPath: string;
  };
  recalculatedBytes?: Buffer;
}

export interface OfficeComVerification {
  status: "verified" | "unavailable" | "failed" | "skipped";
  message: string;
  renderedPdf?: Buffer;
  recalculatedBytes?: Buffer;
}

export interface OfficeProcessOwner {
  pid: number;
  name: "WINWORD.EXE" | "EXCEL.EXE" | "POWERPNT.EXE";
  executablePath: string;
  creationTimeUtc: string;
  commandLine: string;
}

export interface OfficeComPackageBoundary {
  safe: boolean;
  reasons: string[];
}

export type OfficeComStage =
  | "startup"
  | "validate-input"
  | "check-office-process"
  | "create-application"
  | "resolve-owner"
  | "verify-empty-instance"
  | "record-owner"
  | "configure-application"
  | "open-document"
  | "render-document"
  | "recalculate-document"
  | "save-document"
  | "verify-output"
  | "close-document"
  | "quit-application"
  | "completed";

const OFFICE_COM_STAGES = new Set<OfficeComStage>([
  "startup",
  "validate-input",
  "check-office-process",
  "create-application",
  "resolve-owner",
  "verify-empty-instance",
  "record-owner",
  "configure-application",
  "open-document",
  "render-document",
  "recalculate-document",
  "save-document",
  "verify-output",
  "close-document",
  "quit-application",
  "completed",
]);

const OFFICE_COM_STAGE_LABELS: Record<OfficeComStage, string> = {
  startup: "启动",
  "validate-input": "检查输入",
  "check-office-process": "检查 Office 进程",
  "create-application": "创建 Office 实例",
  "resolve-owner": "确认实例身份",
  "verify-empty-instance": "确认空实例",
  "record-owner": "登记可清理实例",
  "configure-application": "配置隐藏实例",
  "open-document": "打开文档",
  "render-document": "导出 PDF",
  "recalculate-document": "计算公式",
  "save-document": "保存结果",
  "verify-output": "检查输出",
  "close-document": "关闭文档",
  "quit-application": "退出 Office 实例",
  completed: "完成",
};

type A1Range = {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
};

type PresentationStructure = {
  sha256: string;
  text: string;
  slideNames: string[];
  archive: Unzipped;
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ensureOfficePackage(bytes: Buffer, extension: string): void {
  if (bytes.length > MAX_OFFICE_BYTES) throw new Error("Office 文件超过 25 MiB 的受控编辑限制。");
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error("Office 文件不是有效的 ZIP/Open XML 包。");
  if (![".docx", ".xlsx", ".pptx"].includes(extension.toLowerCase()))
    throw new Error("Office 编辑只支持 OOXML 格式。");
}

function rejectDangerousPackageParts(archive: Unzipped): void {
  const unsafe = Object.keys(archive).find((name) =>
    /(?:vbaProject|_xmlsignatures|activeX|externalLinks\/|pivotCache\/|slicer|webextensions)/i.test(
      name,
    ),
  );
  if (unsafe)
    throw new Error(
      `OFFICE_UNSUPPORTED_PART: 检测到宏、签名、OLE、外部连接、数据透视或扩展部件 ${unsafe}；为避免破坏，已拒绝编辑。`,
    );
  for (const [name, bytes] of Object.entries(archive)) {
    if (!/embeddings\//i.test(name)) continue;
    if (name.endsWith("/")) continue;
    if (!/\.xlsx$/i.test(name))
      throw new Error(
        `OFFICE_UNSUPPORTED_PART: 嵌入部件 ${name} 不是受控的 XLSX 数据工作簿，已拒绝编辑。`,
      );
    let embedded: Unzipped;
    try {
      embedded = unzipSync(bytes);
    } catch {
      throw new Error(`OFFICE_UNSUPPORTED_PART: 嵌入工作簿 ${name} 无法校验。`);
    }
    if (
      Object.keys(embedded).some((entry) =>
        /(?:vbaProject|externalLinks\/|_xmlsignatures|activeX)/i.test(entry),
      )
    )
      throw new Error(`OFFICE_UNSUPPORTED_PART: 嵌入工作簿 ${name} 含不受支持部件。`);
  }
  for (const [name, bytes] of Object.entries(archive)) {
    if (!/\.(?:xml|rels)$/i.test(name)) continue;
    const xml = strFromU8(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("Office XML declarations are not supported.");
    if (
      /externalLink|oleObject|pivotTable|activeXControl|digital-signature|macroEnabled/i.test(
        xml,
      ) &&
      /\[Content_Types\]\.xml$|\.rels$/i.test(name)
    )
      throw new Error(`OFFICE_UNSUPPORTED_PART: ${name} 引用了不受支持的外部或可执行部件。`);
  }
}

function normalizeArgb(value: string): string {
  return value.length === 6 ? `FF${value.toUpperCase()}` : value.toUpperCase();
}

function applyCellStyle(cell: ExcelJS.Cell, style: OfficeCellStyle): void {
  if (style.font) {
    cell.font = {
      ...(style.font.name ? { name: style.font.name } : {}),
      ...(style.font.size ? { size: style.font.size } : {}),
      ...(style.font.bold !== undefined ? { bold: style.font.bold } : {}),
      ...(style.font.italic !== undefined ? { italic: style.font.italic } : {}),
      ...(style.font.underline !== undefined ? { underline: style.font.underline } : {}),
      ...(style.font.color ? { color: { argb: normalizeArgb(style.font.color) } } : {}),
    };
  }
  if (style.fill) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: normalizeArgb(style.fill) },
    };
  }
  if (style.border) {
    const borderStyle = style.border.style ?? "thin";
    const side = {
      style: borderStyle,
      color: { argb: normalizeArgb(style.border.color ?? "FFD0D7DE") },
    };
    cell.border = { top: side, left: side, bottom: side, right: side };
  }
  if (style.alignment) {
    cell.alignment = {
      ...(style.alignment.horizontal ? { horizontal: style.alignment.horizontal } : {}),
      ...(style.alignment.vertical ? { vertical: style.alignment.vertical } : {}),
      ...(style.alignment.wrap_text !== undefined ? { wrapText: style.alignment.wrap_text } : {}),
    };
  }
  if (style.number_format) cell.numFmt = style.number_format;
}

function spreadsheetPalette(
  theme?: OfficeSpreadsheetTheme,
  presentation?: OfficeSpreadsheetPresentation,
): OfficePalette {
  return resolveOfficeVisual({
    preset: presentation?.preset ?? theme?.preset,
    accent: presentation?.accent ?? theme?.accent,
  }).palette;
}

function eachRangeCell(
  sheet: ExcelJS.Worksheet,
  range: string,
  action: (cell: ExcelJS.Cell, row: number, column: number) => void,
): void {
  const parsed = parseA1Range(range);
  for (let row = parsed.startRow; row <= parsed.endRow; row++) {
    for (let column = parsed.startColumn; column <= parsed.endColumn; column++) {
      action(sheet.getCell(row, column), row, column);
    }
  }
}

function applySpreadsheetPresentation(
  sheet: ExcelJS.Worksheet,
  presentation: OfficeSpreadsheetPresentation,
  theme?: OfficeSpreadsheetTheme,
): void {
  const palette = spreadsheetPalette(theme, presentation);
  if (presentation.title_range) {
    eachRangeCell(sheet, presentation.title_range, (cell) => {
      cell.font = {
        ...cell.font,
        name: cell.font?.name ?? "Microsoft YaHei",
        size: 18,
        bold: true,
        color: { argb: normalizeArgb(palette.ink) },
      };
      cell.alignment = {
        ...cell.alignment,
        horizontal: "left",
        vertical: "middle",
      };
      cell.border = {
        ...cell.border,
        bottom: {
          style: "medium",
          color: { argb: normalizeArgb(palette.accent) },
        },
      };
    });
    const title = parseA1Range(presentation.title_range);
    for (let row = title.startRow; row <= title.endRow; row++) {
      const target = sheet.getRow(row);
      target.height = Math.max(target.height ?? 0, 27);
    }
  }
  if (presentation.header_range) {
    eachRangeCell(sheet, presentation.header_range, (cell) => {
      cell.font = {
        ...cell.font,
        name: cell.font?.name ?? "Microsoft YaHei",
        size: 10.5,
        bold: true,
        color: { argb: normalizeArgb(palette.white) },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: normalizeArgb(palette.accent) },
      };
      cell.alignment = {
        ...cell.alignment,
        horizontal: cell.alignment?.horizontal ?? "left",
        vertical: "middle",
        wrapText: true,
      };
    });
    const header = parseA1Range(presentation.header_range);
    for (let row = header.startRow; row <= header.endRow; row++) {
      const target = sheet.getRow(row);
      target.height = Math.max(target.height ?? 0, 23);
    }
  }
  if (presentation.body_range) {
    eachRangeCell(sheet, presentation.body_range, (cell) => {
      cell.font = {
        ...cell.font,
        name: cell.font?.name ?? "Microsoft YaHei",
        size: cell.font?.size ?? 10.5,
        color: { argb: normalizeArgb(palette.ink) },
      };
      cell.alignment = {
        ...cell.alignment,
        horizontal:
          cell.alignment?.horizontal ?? (typeof cell.value === "number" ? "right" : "left"),
        vertical: "middle",
        wrapText: cell.alignment?.wrapText ?? true,
      };
      cell.border = {
        ...cell.border,
        bottom: {
          style: "hair",
          color: { argb: normalizeArgb(palette.line) },
        },
      };
    });
  }
  if (presentation.show_grid_lines !== undefined) {
    const current = sheet.views?.[0];
    sheet.views = [
      {
        ...(current ?? { state: "normal" }),
        showGridLines: presentation.show_grid_lines,
      },
    ];
  }
  if (presentation.print_area) sheet.pageSetup.printArea = presentation.print_area;
  if (presentation.print_titles_rows)
    sheet.pageSetup.printTitlesRow = presentation.print_titles_rows;
  if (presentation.orientation)
    sheet.pageSetup.orientation =
      presentation.orientation === "portrait" ? "portrait" : "landscape";
  if (presentation.fit_to_page) {
    sheet.pageSetup.fitToPage = true;
    sheet.pageSetup.fitToWidth = 1;
    sheet.pageSetup.fitToHeight = 0;
  }
}

function setCellValue(cell: ExcelJS.Cell, value: OfficeCellValue): void {
  if (value && typeof value === "object" && "formula" in value) {
    cell.value =
      value.result === undefined || value.result === null
        ? { formula: value.formula }
        : { formula: value.formula, result: value.result };
    return;
  }
  cell.value = value as ExcelJS.CellValue;
}

function applyCell(
  sheet: ExcelJS.Worksheet,
  cell: {
    row: number;
    column: number;
    value: OfficeCellValue;
    style?: OfficeCellStyle | undefined;
  },
): void {
  const target = sheet.getCell(cell.row, cell.column);
  setCellValue(target, cell.value);
  if (cell.style) applyCellStyle(target, cell.style);
}

function decodeColumn(value: string): number {
  let result = 0;
  for (const character of value.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

export function parseA1Range(value: string): A1Range {
  const normalized = value.replaceAll("$", "").toUpperCase();
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})(?::([A-Z]{1,3})([1-9][0-9]{0,6}))?$/.exec(
    normalized,
  );
  if (!match?.[1] || !match[2]) throw new Error("A1_RANGE_INVALID: 请使用 A1 或 A1:C10 格式。");
  const startColumn = decodeColumn(match[1]);
  const startRow = Number(match[2]);
  const endColumn = match[3] ? decodeColumn(match[3]) : startColumn;
  const endRow = match[4] ? Number(match[4]) : startRow;
  if (startColumn > 16_384 || endColumn > 16_384 || startRow > 1_048_576 || endRow > 1_048_576)
    throw new Error("A1_RANGE_LIMIT: 单元格超出 Excel 行列上限。");
  if (endColumn < startColumn || endRow < startRow)
    throw new Error("A1_RANGE_ORDER: 范围结束位置早于开始位置。");
  if ((endRow - startRow + 1) * (endColumn - startColumn + 1) > MAX_INSPECT_CELLS * 100)
    throw new Error("A1_RANGE_LIMIT: 单次范围不得超过 200000 个单元格。");
  return { startRow, startColumn, endRow, endColumn };
}

function createSheet(
  workbook: ExcelJS.Workbook,
  spec: OfficeSpreadsheetSpec,
  theme?: OfficeSpreadsheetTheme,
): void {
  if (workbook.getWorksheet(spec.name)) throw new Error(`工作表名称重复：${spec.name}`);
  const sheet = workbook.addWorksheet(spec.name, {
    ...(spec.freeze
      ? {
          views: [
            {
              state: "frozen",
              xSplit: spec.freeze.column,
              ySplit: spec.freeze.row,
            },
          ],
        }
      : {}),
  });
  for (const column of spec.columns ?? []) {
    const target = sheet.getColumn(column.index);
    target.width = column.width;
    if (column.hidden !== undefined) target.hidden = column.hidden;
  }
  for (const cell of spec.cells) applyCell(sheet, cell);
  for (const range of spec.merges ?? []) sheet.mergeCells(range);
  for (const table of spec.tables ?? []) {
    addTable(sheet, table.name, table.range, table.style ?? "TableStyleMedium2");
  }
  if (spec.filter) sheet.autoFilter = spec.filter;
  if (spec.presentation) applySpreadsheetPresentation(sheet, spec.presentation, theme);
}

function addTable(
  sheet: ExcelJS.Worksheet,
  name: string,
  range: string,
  style: ExcelTableTheme = "TableStyleMedium2",
): void {
  const parsed = parseA1Range(range);
  const headerRow = sheet.getRow(parsed.startRow);
  const columns = Array.from({ length: parsed.endColumn - parsed.startColumn + 1 }, (_, index) => {
    const cell = headerRow.getCell(parsed.startColumn + index);
    const displayed = cell.text.trim() || `Column${index + 1}`;
    return { name: displayed, filterButton: true };
  });
  if (new Set(columns.map((column) => column.name)).size !== columns.length)
    throw new Error(`表格 ${name} 的表头不能重复。`);
  sheet.addTable({
    name,
    ref: range,
    headerRow: true,
    totalsRow: false,
    style: { theme: style, showRowStripes: true },
    columns,
    rows: [],
  });
}

async function createSpreadsheet(
  input: Extract<OfficeDocumentInput, { operation: "create_spreadsheet" }>,
  signal?: AbortSignal,
): Promise<OfficeDocumentResult> {
  signal?.throwIfAborted();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mingshen Harness";
  workbook.created = new Date();
  workbook.modified = new Date();
  for (const spec of input.workbook.sheets) createSheet(workbook, spec, input.workbook.design);
  workbook.calcProperties.fullCalcOnLoad = true;
  signal?.throwIfAborted();
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  ensureOfficePackage(bytes, ".xlsx");
  return {
    output: `已生成 XLSX：${input.path}（${input.workbook.sheets.length} 个工作表，${bytes.length} bytes）。公式已写入，但未执行重算；可用 office_document verify 检查缓存结果。`,
    warnings: [
      "公式计算状态：尚未由真实 Excel 计算器重算。调用者提供的 formula.result 只会写入文件缓存，不能作为重算证明。",
    ],
    bytes,
  };
}

async function loadWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

function mutableExcelPart(name: string): boolean {
  return EXCEL_MUTABLE.some((pattern) => pattern.test(name));
}

function preserveXlsxParts(source: Unzipped, output: Unzipped): void {
  for (const [name, bytes] of Object.entries(source)) {
    if (!mutableExcelPart(name)) output[name] = bytes;
  }
}

function applySpreadsheetOperation(
  workbook: ExcelJS.Workbook,
  operation: Extract<OfficeDocumentInput, { operation: "edit_spreadsheet" }>["operations"][number],
): void {
  if (operation.type === "add_sheet") {
    if (workbook.getWorksheet(operation.name)) throw new Error(`工作表已存在：${operation.name}`);
    workbook.addWorksheet(operation.name);
    return;
  }
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`工作表不存在：${operation.sheet}`);
  switch (operation.type) {
    case "rename_sheet":
      sheet.name = operation.name;
      return;
    case "delete_sheet": {
      if (workbook.worksheets.length <= 1) throw new Error("不能删除最后一个工作表。");
      workbook.removeWorksheet(sheet.id);
      return;
    }
    case "set_cells":
      for (const cell of operation.cells) applyCell(sheet, cell);
      return;
    case "set_range": {
      const range = parseA1Range(operation.range);
      if (
        operation.rows.length !== range.endRow - range.startRow + 1 ||
        operation.rows.some((row) => row.length !== range.endColumn - range.startColumn + 1)
      )
        throw new Error("set_range 的 rows 尺寸必须与 A1 范围完全一致。");
      for (const [rowOffset, row] of operation.rows.entries()) {
        for (const [columnOffset, value] of row.entries()) {
          const cell = sheet.getCell(range.startRow + rowOffset, range.startColumn + columnOffset);
          setCellValue(cell, value);
          if (operation.style) applyCellStyle(cell, operation.style);
        }
      }
      return;
    }
    case "append_rows":
      for (const row of operation.rows) {
        const rowNumber = sheet.rowCount + 1;
        for (const [columnIndex, value] of row.entries()) {
          const cell = sheet.getCell(rowNumber, columnIndex + 1);
          setCellValue(cell, value);
          if (operation.style) applyCellStyle(cell, operation.style);
        }
      }
      return;
    case "style_range": {
      const range = parseA1Range(operation.range);
      for (let row = range.startRow; row <= range.endRow; row++) {
        for (let column = range.startColumn; column <= range.endColumn; column++) {
          applyCellStyle(sheet.getCell(row, column), operation.style);
        }
      }
      return;
    }
    case "merge_range":
      sheet.mergeCells(operation.range);
      return;
    case "unmerge_range":
      sheet.unMergeCells(operation.range);
      return;
    case "set_columns":
      for (let index = operation.start; index <= operation.end; index++) {
        const column = sheet.getColumn(index);
        column.width = operation.width;
        if (operation.hidden !== undefined) column.hidden = operation.hidden;
      }
      return;
    case "freeze":
      sheet.views = [
        {
          state: operation.row === 0 && operation.column === 0 ? "normal" : "frozen",
          xSplit: operation.column,
          ySplit: operation.row,
        },
      ];
      return;
    case "filter":
      sheet.autoFilter = operation.range;
      return;
    case "add_table":
      addTable(sheet, operation.name, operation.range, operation.style ?? "TableStyleMedium2");
      return;
    case "format_sheet":
      applySpreadsheetPresentation(sheet, operation.presentation);
      return;
  }
}

async function editSpreadsheet(
  input: Extract<OfficeDocumentInput, { operation: "edit_spreadsheet" }>,
  source: Buffer,
  signal?: AbortSignal,
): Promise<OfficeDocumentResult> {
  ensureOfficePackage(source, ".xlsx");
  await validateDocumentArchive(source);
  const sourceArchive = unzipSync(source);
  rejectDangerousPackageParts(sourceArchive);
  const actual = sha256(source);
  if (actual !== input.source.expected_sha256.toLowerCase())
    throw new Error("DOCUMENT_SOURCE_CHANGED: XLSX 源 SHA-256 与读取时不一致，请重新检查。");
  const workbook = await loadWorkbook(source);
  for (const operation of input.operations) {
    signal?.throwIfAborted();
    applySpreadsheetOperation(workbook, operation);
  }
  workbook.calcProperties.fullCalcOnLoad = true;
  signal?.throwIfAborted();
  const outputBytes = Buffer.from(await workbook.xlsx.writeBuffer());
  ensureOfficePackage(outputBytes, ".xlsx");
  const outputArchive = unzipSync(outputBytes);
  preserveXlsxParts(sourceArchive, outputArchive);
  const bytes = Buffer.from(zipSync(outputArchive));
  return {
    output: `已编辑 XLSX：${input.path}（${input.operations.length} 项操作，${bytes.length} bytes）。未修改的非可编辑 OOXML 部件按源字节保留；公式需真实 Excel 才能执行重算。`,
    warnings: [
      "公式状态：已写入但未由 Microsoft Excel 计算；ExcelJS 不是公式计算引擎，调用者提供的 formula.result 也不能证明公式正确。",
      "复杂图片、SmartArt、ActiveX、OLE、透视表、切片器、外部连接和签名未改写，受保护包会在编辑前拒绝。",
    ],
    bytes,
  };
}

function displayCellValue(cell: ExcelJS.Cell, calculatedByOffice: boolean): unknown {
  if (cell.formula !== undefined) {
    return {
      formula: cell.formula,
      result: cell.result ?? null,
      cached: cell.result !== undefined,
      calculation_verified_by_microsoft_excel: calculatedByOffice,
    };
  }
  const value = cell.value;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("error" in value) return { error: String(value.error) };
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("hyperlink" in value) {
      const link = value as { text?: unknown; hyperlink: unknown };
      return { text: String(link.text ?? ""), hyperlink: link.hyperlink };
    }
  }
  return String(value);
}

async function inspectSpreadsheet(
  bytes: Buffer,
  options: { calculatedByMicrosoftExcel?: boolean } = {},
): Promise<{
  text: string;
  warnings: string[];
  formulas: number;
  uncachedFormulas: number;
  errors: number;
}> {
  const calculatedByOffice = options.calculatedByMicrosoftExcel ?? false;
  const workbook = await loadWorkbook(bytes);
  let inspected = 0;
  let formulas = 0;
  let uncachedFormulas = 0;
  let errors = 0;
  const lines = workbook.worksheets.map((sheet) => {
    const records: unknown[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (inspected++ >= MAX_INSPECT_CELLS) return;
        if (cell.formula !== undefined) {
          formulas += 1;
          if (cell.result === undefined) uncachedFormulas += 1;
        }
        const value = displayCellValue(cell, calculatedByOffice);
        if (
          (value && typeof value === "object" && "error" in value) ||
          /^#(?:N\/A|VALUE!|REF!|DIV\/0!|NUM!|NAME\?|NULL!)$/.test(String(cell.result ?? ""))
        )
          errors += 1;
        records.push({ cell: cell.address, value });
      });
    });
    return JSON.stringify({
      sheet: sheet.name,
      rows: sheet.rowCount,
      columns: sheet.columnCount,
      selected_cells: records,
      selected_cells_truncated: inspected >= MAX_INSPECT_CELLS,
    });
  });
  return {
    text: lines.join("\n"),
    warnings: [
      ...(inspected >= MAX_INSPECT_CELLS
        ? [`结构检查最多列出 ${MAX_INSPECT_CELLS} 个非空单元格。`]
        : []),
      ...(uncachedFormulas
        ? [`${uncachedFormulas} 个公式没有缓存结果；这不等于公式错误，需用真实 Excel 重算。`]
        : []),
      ...(formulas > uncachedFormulas && !calculatedByOffice
        ? [
            `${formulas - uncachedFormulas} 个公式带有文件内缓存结果；结构检查不能证明这些结果来自 Microsoft Excel 重算。`,
          ]
        : []),
      ...(errors ? [`检测到 ${errors} 个公式错误值。`] : []),
    ],
    formulas,
    uncachedFormulas,
    errors,
  };
}

function parseXml(bytes: Uint8Array, label: string): Document {
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error(`${label} 含不支持的 XML 声明。`);
  return new DOMParser().parseFromString(source, "text/xml");
}

function parseOfficeComXml(bytes: Uint8Array, label: string): Document {
  const document = parseXml(bytes, label);
  if (document.getElementsByTagName("parsererror").length)
    throw new Error(`${label} 不是可解析的 OOXML。`);
  return document;
}

function wordAttribute(element: Element, name: string): string | null {
  return (
    element.getAttributeNS(WORD, name) ??
    element.getAttribute(`w:${name}`) ??
    element.getAttribute(name)
  );
}

function wordFieldIssues(document: Document): Set<string> {
  const issues = new Set<string>();
  const activeFields: string[] = [];
  const inspectInstruction = (instruction: string) => {
    const match = instruction.match(WORD_AUTOMATIC_FIELD);
    if (match?.[1]) issues.add(`DOCX_AUTOMATIC_FIELD_${match[1].toUpperCase()}`);
  };
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element.namespaceURI !== WORD) continue;
    if (element.localName === "fldSimple") {
      inspectInstruction(wordAttribute(element, "instr") ?? "");
    } else if (element.localName === "fldChar") {
      const type = wordAttribute(element, "fldCharType");
      if (type === "begin") activeFields.push("");
      else if (type === "end") {
        const instruction = activeFields.pop();
        if (instruction) inspectInstruction(instruction);
      }
    } else if (element.localName === "instrText" && activeFields.length) {
      activeFields[activeFields.length - 1] += element.textContent ?? "";
    }
  }
  for (const instruction of activeFields) inspectInstruction(instruction);
  return issues;
}

export function inspectOfficeComPackageBoundary(
  bytes: Buffer,
  extension: ".docx" | ".xlsx" | ".pptx",
): OfficeComPackageBoundary {
  const archive = unzipSync(bytes);
  const issues = new Set<string>();
  for (const [name, content] of Object.entries(archive)) {
    if (!name.toLowerCase().endsWith(".rels")) continue;
    const relationships = parseOfficeComXml(content, name);
    for (const element of Array.from(relationships.getElementsByTagName("*"))) {
      if (element.localName !== "Relationship") continue;
      if (element.getAttribute("TargetMode")?.trim().toLowerCase() !== "external") continue;
      const type = element.getAttribute("Type") ?? "";
      // Plain hyperlinks remain allowed; other external relationships can make Office resolve data.
      if (/\/hyperlink\/?$/i.test(type)) continue;
      issues.add("OOXML_EXTERNAL_NON_HYPERLINK_RELATIONSHIP");
    }
  }
  if (extension === ".docx") {
    if (!archive["word/document.xml"]) issues.add("DOCX_DOCUMENT_XML_MISSING");
    for (const [name, content] of Object.entries(archive)) {
      if (!/^word\/.*\.xml$/i.test(name)) continue;
      for (const issue of wordFieldIssues(parseOfficeComXml(content, name))) issues.add(issue);
    }
  } else if (extension === ".xlsx") {
    for (const name of Object.keys(archive)) {
      if (
        /^(?:xl\/connections\.xml|xl\/queryTables\/|xl\/externalLinks\/|xl\/pivotCache\/|xl\/model\/)/i.test(
          name,
        )
      )
        issues.add("XLSX_COM_DATA_CONNECTION_PART");
    }
  }
  return { safe: issues.size === 0, reasons: [...issues].sort() };
}

function relationshipTarget(sourcePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const relationshipDirectory = posix.dirname(sourcePart);
  const sourceDirectory =
    posix.basename(relationshipDirectory) === "_rels"
      ? posix.dirname(relationshipDirectory)
      : relationshipDirectory;
  return posix.normalize(posix.join(sourceDirectory, target));
}

function relationshipMap(
  archive: Unzipped,
  relationshipPart: string,
): Map<string, { type: string; target: string }> {
  const bytes = archive[relationshipPart];
  if (!bytes) return new Map();
  const document = parseXml(bytes, relationshipPart);
  return new Map(
    Array.from(document.getElementsByTagNameNS(RELATIONSHIPS, "Relationship")).flatMap((node) => {
      const id = node.getAttribute("Id");
      const target = node.getAttribute("Target");
      const type = node.getAttribute("Type");
      return id && target && type
        ? [[id, { type, target: relationshipTarget(relationshipPart, target) }] as const]
        : [];
    }),
  );
}

function orderedSlideParts(archive: Unzipped): string[] {
  const presentationBytes = archive["ppt/presentation.xml"];
  if (presentationBytes) {
    const presentation = parseXml(presentationBytes, "ppt/presentation.xml");
    const relationships = relationshipMap(archive, "ppt/_rels/presentation.xml.rels");
    const ordered = Array.from(presentation.getElementsByTagNameNS(PPT_P, "sldId")).flatMap(
      (node) => {
        const id = node.getAttributeNS(PPT_R, "id") ?? node.getAttribute("r:id");
        const relationship = id ? relationships.get(id) : undefined;
        return relationship?.target && archive[relationship.target] ? [relationship.target] : [];
      },
    );
    if (ordered.length) return ordered;
  }
  return Object.keys(archive)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(
      (left, right) =>
        Number(left.match(/slide(\d+)\.xml$/i)?.[1] ?? 0) -
        Number(right.match(/slide(\d+)\.xml$/i)?.[1] ?? 0),
    );
}

function directChild(node: Element, localName: string, namespace?: string): Element | undefined {
  return Array.from(node.childNodes).find(
    (child): child is Element =>
      child.nodeType === 1 &&
      (child as Element).localName === localName &&
      (!namespace || (child as Element).namespaceURI === namespace),
  );
}

function textNodes(root: Element): Element[] {
  return Array.from(root.getElementsByTagNameNS(PPT_A, "t"));
}

function joinedText(nodes: Element[]): string {
  return nodes.map((node) => node.textContent ?? "").join("");
}

function shapeId(shape: Element): number {
  const properties = shape.getElementsByTagNameNS(PPT_P, "cNvPr").item(0);
  return Number(properties?.getAttribute("id") ?? 0);
}

function replaceAcrossTextNodes(nodes: Element[], oldText: string, newText: string): void {
  if (/[\r\n\t]/.test(oldText) || /[\r\n\t]/.test(newText))
    throw new Error("PPTX 行内文字替换不接受换行或制表符；请保持单段文字。");
  const original = joinedText(nodes);
  const start = original.indexOf(oldText);
  if (start < 0 || original.indexOf(oldText, start + 1) >= 0)
    throw new Error(
      "PPTX_TEXT_NOT_UNIQUE: old_text 必须在目标文本框内恰好出现一次；请先检查结构。",
    );
  const end = start + oldText.length;
  let offset = 0;
  for (const node of nodes) {
    const value = node.textContent ?? "";
    const next = offset + value.length;
    if (offset < end && next > start) {
      node.textContent =
        value.slice(0, Math.max(0, start - offset)) +
        (start >= offset ? newText : "") +
        value.slice(Math.max(0, end - offset));
    }
    offset = next;
  }
}

function slideNotesPart(archive: Unzipped, slidePart: string): string | null {
  const fileName = posix.basename(slidePart);
  const relationshipPart = `${posix.dirname(slidePart)}/_rels/${fileName}.rels`;
  const relationships = relationshipMap(archive, relationshipPart);
  return (
    [...relationships.values()].find((relationship) => /\/notesSlide$/i.test(relationship.type))
      ?.target ?? null
  );
}

function notesBodyTextNodes(notes: Document): Element[] {
  return Array.from(notes.getElementsByTagNameNS(PPT_P, "sp")).flatMap((shape) => {
    const placeholderType =
      shape.getElementsByTagNameNS(PPT_P, "ph").item(0)?.getAttribute("type") ?? "body";
    if (["sldImg", "sldNum", "hdr", "ftr", "dt"].includes(placeholderType)) return [];
    const body = directChild(shape, "txBody", PPT_P);
    return body ? textNodes(body) : [];
  });
}

function presentationStructure(input: { archive: Unzipped; bytes: Buffer }): PresentationStructure {
  const slideNames = orderedSlideParts(input.archive);
  if (!slideNames.length) throw new Error("PPTX 中没有可读取的幻灯片。");
  let objectCount = 0;
  const records: unknown[] = [];
  for (const [slideIndex, slideName] of slideNames.entries()) {
    const bytes = input.archive[slideName];
    if (!bytes) continue;
    const slide = parseXml(bytes, slideName);
    for (const shape of Array.from(slide.getElementsByTagNameNS(PPT_P, "sp"))) {
      if (objectCount++ >= MAX_INSPECT_OBJECTS) break;
      const body = directChild(shape, "txBody", PPT_P);
      if (!body) continue;
      records.push({
        slide: slideIndex + 1,
        kind: "shape",
        shape_id: shapeId(shape),
        text: joinedText(textNodes(body)),
      });
    }
    const tables = Array.from(slide.getElementsByTagNameNS(PPT_A, "tbl"));
    for (const [tableIndex, table] of tables.entries()) {
      if (objectCount++ >= MAX_INSPECT_OBJECTS) break;
      const rows = Array.from(table.getElementsByTagNameNS(PPT_A, "tr"));
      const frame = table.parentNode?.parentNode;
      records.push({
        slide: slideIndex + 1,
        kind: "table",
        table: tableIndex + 1,
        shape_id: frame?.nodeType === 1 ? shapeId(frame as Element) : null,
        rows: rows.map((row) =>
          Array.from(row.getElementsByTagNameNS(PPT_A, "tc")).map((cell) =>
            joinedText(textNodes(cell)),
          ),
        ),
      });
    }
    const notesName = slideNotesPart(input.archive, slideName);
    const notesBytes = notesName ? input.archive[notesName] : undefined;
    if (notesBytes) {
      const notes = parseXml(notesBytes, notesName ?? "notes");
      records.push({
        slide: slideIndex + 1,
        kind: "notes",
        text: joinedText(notesBodyTextNodes(notes)),
      });
    }
  }
  return {
    sha256: sha256(input.bytes),
    text: records.map((record) => JSON.stringify(record)).join("\n"),
    slideNames,
    archive: input.archive,
  };
}

async function inspectPresentation(bytes: Buffer): Promise<{
  text: string;
  warnings: string[];
}> {
  await validateDocumentArchive(bytes);
  const archive = unzipSync(bytes);
  rejectDangerousPackageParts(archive);
  const structure = presentationStructure({ archive, bytes });
  return {
    text: structure.text,
    warnings: [
      "PPTX 结构编号绑定源 SHA-256；修改后必须重新检查。",
      "替换只修改受支持形状、表格单元格或备注中的文字，未改 OOXML 部件按源字节保留。",
    ],
  };
}

async function editPresentation(
  input: Extract<OfficeDocumentInput, { operation: "edit_presentation" }>,
  source: Buffer,
  signal?: AbortSignal,
): Promise<OfficeDocumentResult> {
  ensureOfficePackage(source, ".pptx");
  await validateDocumentArchive(source);
  const archive = unzipSync(source);
  rejectDangerousPackageParts(archive);
  const structure = presentationStructure({ archive, bytes: source });
  if (structure.sha256 !== input.source.expected_sha256.toLowerCase())
    throw new Error("DOCUMENT_SOURCE_CHANGED: PPTX 源 SHA-256 与读取时不一致，请重新检查。");
  const changedParts = new Set<string>();
  for (const operation of input.operations) {
    signal?.throwIfAborted();
    const slideName = structure.slideNames[operation.slide - 1];
    if (!slideName) throw new Error(`幻灯片 ${operation.slide} 不存在。`);
    if (operation.type === "replace_notes_text") {
      const notesName = slideNotesPart(archive, slideName);
      if (!notesName || !archive[notesName])
        throw new Error(`幻灯片 ${operation.slide} 没有可编辑的备注页。`);
      const notes = parseXml(archive[notesName], notesName);
      replaceAcrossTextNodes(notesBodyTextNodes(notes), operation.old_text, operation.new_text);
      archive[notesName] = strToU8(serializer.serializeToString(notes));
      changedParts.add(notesName);
      continue;
    }
    const slide = parseXml(archive[slideName] ?? new Uint8Array(), slideName);
    if (operation.type === "replace_shape_text") {
      const shape = Array.from(slide.getElementsByTagNameNS(PPT_P, "sp")).find(
        (candidate) => shapeId(candidate) === operation.shape_id,
      );
      if (!shape) throw new Error(`幻灯片 ${operation.slide} 中找不到形状 ${operation.shape_id}。`);
      replaceAcrossTextNodes(textNodes(shape), operation.old_text, operation.new_text);
    } else {
      const table = Array.from(slide.getElementsByTagNameNS(PPT_A, "tbl"))[operation.table - 1];
      if (!table) throw new Error(`幻灯片 ${operation.slide} 中找不到表格 ${operation.table}。`);
      const row = Array.from(table.getElementsByTagNameNS(PPT_A, "tr"))[operation.row - 1];
      const cell = row
        ? Array.from(row.getElementsByTagNameNS(PPT_A, "tc"))[operation.column - 1]
        : undefined;
      if (!cell)
        throw new Error(
          `PPTX 表格单元格不存在：第 ${operation.row} 行，第 ${operation.column} 列。`,
        );
      const nodes = textNodes(cell);
      if (!nodes.length) throw new Error("目标表格单元格没有可编辑文字。");
      const first = nodes[0];
      if (!first) throw new Error("目标表格单元格没有可编辑文字。");
      first.textContent = operation.text;
      for (const node of nodes.slice(1)) node.textContent = "";
    }
    archive[slideName] = strToU8(serializer.serializeToString(slide));
    changedParts.add(slideName);
  }
  signal?.throwIfAborted();
  const bytes = Buffer.from(zipSync(archive));
  ensureOfficePackage(bytes, ".pptx");
  return {
    output: `已编辑 PPTX：${input.path}（${input.operations.length} 项操作，修改 ${changedParts.size} 个 XML 部件，${bytes.length} bytes）。未改部件按源字节保留。`,
    warnings: [
      "当前受控编辑支持形状/占位符文字、表格单元格和备注文字；图片替换、SmartArt、动画、OLE、宏和签名不在承诺范围。",
      "结构编辑不保证复杂母版、自动字体重排或所有 PowerPoint 版本视觉一致；交付前必须渲染检查。",
    ],
    bytes,
  };
}

async function inspectDocx(bytes: Buffer): Promise<{ text: string; warnings: string[] }> {
  await validateDocumentArchive(bytes);
  const structure = await readDocxStructure(bytes);
  return {
    text: `Source SHA-256: ${structure.sha256}\n${structure.text}`,
    warnings: ["DOCX 结构编号绑定源 SHA-256；局部编辑只覆盖已支持的正文范围。"],
  };
}

async function inspectOffice(
  input: Extract<OfficeDocumentInput, { operation: "inspect" }>,
  bytes: Buffer,
): Promise<OfficeDocumentResult> {
  const extension = extname(input.path).toLowerCase();
  ensureOfficePackage(bytes, extension);
  if (extension === ".xlsx") {
    await validateDocumentArchive(bytes);
    rejectDangerousPackageParts(unzipSync(bytes));
    const inspection = await inspectSpreadsheet(bytes);
    return {
      output: [
        `XLSX 结构：${input.path}`,
        `Source SHA-256: ${sha256(bytes)}`,
        `公式：${inspection.formulas}，无缓存结果：${inspection.uncachedFormulas}，错误值：${inspection.errors}`,
        inspection.text,
      ].join("\n"),
      warnings: inspection.warnings,
    };
  }
  if (extension === ".pptx") {
    const inspection = await inspectPresentation(bytes);
    return {
      output: [
        `PPTX 结构：${input.path}`,
        `Source SHA-256: ${sha256(bytes)}`,
        inspection.text,
      ].join("\n"),
      warnings: inspection.warnings,
    };
  }
  const inspection = await inspectDocx(bytes);
  return {
    output: `DOCX 结构：${input.path}\n${inspection.text}`,
    warnings: inspection.warnings,
  };
}

async function structuralVerification(
  bytes: Buffer,
  path: string,
): Promise<{ text: string; warnings: string[] }> {
  const extension = extname(path).toLowerCase();
  ensureOfficePackage(bytes, extension);
  if (extension === ".xlsx") {
    await validateDocumentArchive(bytes);
    rejectDangerousPackageParts(unzipSync(bytes));
    const result = await inspectSpreadsheet(bytes);
    return {
      text: `XLSX 结构通过：${result.formulas} 个公式，${result.uncachedFormulas} 个缺少缓存结果，${result.errors} 个错误值。SHA-256 ${sha256(bytes)}。`,
      warnings: result.warnings,
    };
  }
  if (extension === ".pptx") {
    const result = await inspectPresentation(bytes);
    return {
      text: `PPTX 结构通过：${result.text.split("\n").length} 个可索引对象。SHA-256 ${sha256(bytes)}。`,
      warnings: result.warnings,
    };
  }
  const result = await inspectDocx(bytes);
  return {
    text: `DOCX 结构通过：${result.text.split("\n").length} 条结构记录。SHA-256 ${sha256(bytes)}。`,
    warnings: result.warnings,
  };
}

function comScriptPath(): string | null {
  const currentFile = fileURLToPath(import.meta.url);
  const roots =
    process.resourcesPath && existsSync(join(process.resourcesPath, "app.asar"))
      ? [join(process.resourcesPath, "documents")]
      : [
          resolve(currentFile, "../../resources/documents"),
          resolve(currentFile, "../../../resources/documents"),
          resolve(currentFile, "../../../../resources/documents"),
        ];
  return roots.map((root) => join(root, "office-com-verify.ps1")).find(existsSync) ?? null;
}

export function parseOfficeProcessOwner(raw: string): OfficeProcessOwner | null {
  try {
    const value = JSON.parse(raw) as Partial<OfficeProcessOwner> | null;
    if (
      !value ||
      !Number.isInteger(value.pid) ||
      (value.pid ?? 0) <= 0 ||
      !["WINWORD.EXE", "EXCEL.EXE", "POWERPNT.EXE"].includes(value.name ?? "") ||
      typeof value.executablePath !== "string" ||
      !value.executablePath ||
      typeof value.creationTimeUtc !== "string" ||
      !Number.isFinite(Date.parse(value.creationTimeUtc)) ||
      typeof value.commandLine !== "string"
    )
      return null;
    return value as OfficeProcessOwner;
  } catch {
    return null;
  }
}

export function officeProcessOwnerMatches(
  owner: OfficeProcessOwner,
  current: OfficeProcessOwner,
): boolean {
  const automation = /(?:^|\s)\/Automation(?:\s|$)/i.test(current.commandLine);
  const embedding = /(?:^|\s)-Embedding(?:\s|$)/i.test(current.commandLine);
  return (
    owner.pid === current.pid &&
    owner.name.toUpperCase() === current.name.toUpperCase() &&
    owner.executablePath.toLowerCase() === current.executablePath.toLowerCase() &&
    owner.creationTimeUtc.toLowerCase() === current.creationTimeUtc.toLowerCase() &&
    automation &&
    embedding
  );
}

export function parseOfficeComStage(stdout: string): OfficeComStage | null {
  let stage: OfficeComStage | null = null;
  for (const line of stdout.trim().split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line) as { stage?: unknown };
      if (typeof parsed.stage === "string" && OFFICE_COM_STAGES.has(parsed.stage as OfficeComStage))
        stage = parsed.stage as OfficeComStage;
    } catch {
      // Ignore host diagnostics and partial lines.
    }
  }
  return stage;
}

export function officeComStageLabel(stage: OfficeComStage): string {
  return OFFICE_COM_STAGE_LABELS[stage];
}

function parseComResult(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed as { event?: unknown }).event !== "office-stage"
      )
        return parsed as Record<string, unknown>;
    } catch {
      // Ignore host diagnostics and use the final JSON object.
    }
  }
  return null;
}

export function formatOfficeComDiagnostic(
  message: string,
  stage: OfficeComStage | null,
  privatePaths: string[] = [],
): string {
  let safe = message.trim() || "Microsoft Office 未返回诊断信息。";
  for (const path of [...privatePaths]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)) {
    safe = safe.replaceAll(path, "<隔离路径>");
  }
  safe = safe.replace(
    /[A-Za-z]:\\[^\r\n"'<>]*?mingshen-office-verify-[^\r\n"'<>]*/gi,
    "<隔离路径>",
  );
  return stage ? `${safe}（最后阶段：${officeComStageLabel(stage)}）` : safe;
}

class OfficePowerShellTimeoutError extends Error {
  constructor(readonly stage: OfficeComStage | null) {
    super("Microsoft Office 未在限定时间内返回，验证已停止。");
    this.name = "OfficePowerShellTimeoutError";
  }
}

function runPowerShellProcess(
  script: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const powershell = process.env.SystemRoot
    ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  return new Promise((done, reject) => {
    const child = spawn(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        ...args,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutStage: OfficeComStage | null = null;
    let timeoutFallback: NodeJS.Timeout | undefined;
    const finish = (error?: unknown, result?: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timeoutFallback) clearTimeout(timeoutFallback);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (result) done(result);
    };
    const abort = () => {
      child.kill();
      finish(signal?.reason ?? new Error("Office 验证已取消。"));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      timeoutStage = parseOfficeComStage(stdout);
      child.kill();
      timeoutFallback = setTimeout(() => {
        finish(new OfficePowerShellTimeoutError(parseOfficeComStage(stdout) ?? timeoutStage));
      }, 1_000);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_COM_OUTPUT) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_COM_OUTPUT) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (timedOut) {
        finish(new OfficePowerShellTimeoutError(parseOfficeComStage(stdout) ?? timeoutStage));
      } else {
        finish(undefined, { code: code ?? -1, stdout, stderr });
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function cleanupRecordedOfficeProcess(script: string, pidFile: string): Promise<void> {
  if (!existsSync(pidFile)) return;
  try {
    const owner = parseOfficeProcessOwner(await readFile(pidFile, "utf8"));
    if (!owner) return;
    await runPowerShellProcess(
      script,
      ["-Cleanup", "-CleanupPidFile", pidFile],
      OFFICE_CLEANUP_TIMEOUT_MS,
    );
  } catch {
    // Cleanup is best effort after the verification child has exited or has been cancelled.
  }
}

async function runPowerShell(
  script: string,
  args: string[],
  timeoutMs: number,
  pidFile: string,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    return await runPowerShellProcess(script, args, timeoutMs, signal);
  } finally {
    await cleanupRecordedOfficeProcess(script, pidFile);
  }
}

export async function verifyWithMicrosoftOffice(
  bytes: Buffer,
  path: string,
  timeoutMs: number,
  signal?: AbortSignal,
  render = false,
  recalculate = false,
): Promise<OfficeComVerification> {
  if (process.platform !== "win32")
    return { status: "skipped", message: "Office COM 验证只在 Windows 可用。" };
  const script = comScriptPath();
  if (!script)
    return {
      status: "unavailable",
      message: "Office COM 验证脚本未随应用资源提供，已降级为结构检查。",
    };
  const root = await mkdtemp(join(tmpdir(), "mingshen-office-verify-"));
  const extension = extname(path).toLowerCase();
  const inputPath = join(root, `input${extension}`);
  const outputPath = join(root, "rendered.pdf");
  const pidFile = join(root, OFFICE_OWNER_FILE);
  try {
    await writeFile(inputPath, bytes);
    const result = await runPowerShell(
      script,
      [
        "-InputPath",
        inputPath,
        "-Kind",
        extension.slice(1),
        "-TimeoutSeconds",
        String(Math.max(5, Math.ceil(timeoutMs / 1000))),
        "-PidFile",
        pidFile,
        ...(render ? ["-Render", "-OutputPath", outputPath] : []),
        ...(recalculate ? ["-Recalculate"] : []),
      ],
      timeoutMs + 5_000,
      pidFile,
      signal,
    );
    const stage = parseOfficeComStage(result.stdout);
    const parsed = parseComResult(result.stdout);
    const status = String(parsed?.status ?? (result.code === 0 ? "verified" : "failed"));
    if (status !== "verified")
      return {
        status:
          status === "unavailable" ? "unavailable" : status === "skipped" ? "skipped" : "failed",
        message: formatOfficeComDiagnostic(
          String(parsed?.message ?? result.stderr.trim()) ||
            `Office COM 返回退出码 ${result.code}。`,
          stage,
          [root, inputPath, outputPath],
        ),
      };
    const renderedPdf = render && existsSync(outputPath) ? await readFile(outputPath) : undefined;
    const recalculatedBytes =
      recalculate && extension === ".xlsx" && existsSync(inputPath)
        ? await readFile(inputPath)
        : undefined;
    return {
      status: "verified",
      message: String(parsed?.message ?? "Microsoft Office 重算或导出完成。"),
      ...(renderedPdf ? { renderedPdf } : {}),
      ...(recalculatedBytes ? { recalculatedBytes } : {}),
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new Error("Office 验证已取消。");
    return {
      status: "failed",
      message: formatOfficeComDiagnostic(
        `Office COM 验证失败：${error instanceof Error ? error.message : String(error)}。已保留结构检查结果。`,
        error instanceof OfficePowerShellTimeoutError ? error.stage : null,
        [root, inputPath, outputPath],
      ),
    };
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(
      () => undefined,
    );
  }
}

async function verifyOffice(
  input: Extract<OfficeDocumentInput, { operation: "verify" }>,
  bytes: Buffer,
  signal?: AbortSignal,
  canUseOffice = false,
): Promise<OfficeDocumentResult> {
  const structural = await structuralVerification(bytes, input.path);
  if ((!input.render && !input.recalculate) || !canUseOffice) {
    return {
      output: structural.text,
      warnings: [
        ...structural.warnings,
        (input.render || input.recalculate) && !canUseOffice
          ? "当前执行策略不允许启用宿主 Microsoft Office；仅完成结构检查，未重算、未渲染。"
          : "已按请求跳过 Microsoft Office 重算和渲染。",
      ],
    };
  }
  signal?.throwIfAborted();
  const extension = extname(input.path).toLowerCase() as ".docx" | ".xlsx" | ".pptx";
  let boundary: OfficeComPackageBoundary;
  try {
    boundary = inspectOfficeComPackageBoundary(bytes, extension);
  } catch {
    boundary = { safe: false, reasons: ["OFFICE_COM_PREFLIGHT_UNVERIFIED"] };
  }
  if (!boundary.safe) {
    const details = boundary.reasons.map((reason) => {
      if (reason.startsWith("DOCX_AUTOMATIC_FIELD_"))
        return `Word 自动字段 ${reason.slice("DOCX_AUTOMATIC_FIELD_".length)}`;
      if (reason === "OOXML_EXTERNAL_NON_HYPERLINK_RELATIONSHIP") return "hyperlink 之外的外部关系";
      if (reason === "XLSX_COM_DATA_CONNECTION_PART") return "Excel 外部数据连接部件";
      return "Office COM 包预检无法确认安全性";
    });
    const message = `Microsoft Office COM 验证已降级为 unavailable：${details.join("；")}；未启动 Office。普通 hyperlink 与纯内部字段不受此限制，旧稿 inspect/edit 路径也未因此改变。`;
    return {
      output: `${structural.text}\nMicrosoft Office 验证：unavailable。${message}`,
      warnings: [...structural.warnings, message],
    };
  }
  const rendered = await verifyWithMicrosoftOffice(
    bytes,
    input.path,
    input.timeout_ms,
    signal,
    input.render,
    input.recalculate,
  );
  const warnings = [...structural.warnings];
  if (rendered.status !== "verified") warnings.push(rendered.message);
  let recalculationText = "";
  if (rendered.status === "verified" && input.recalculate && rendered.recalculatedBytes) {
    const recalculatedStructure = await structuralVerification(
      rendered.recalculatedBytes,
      input.path,
    );
    const recalculatedInspection = await inspectSpreadsheet(rendered.recalculatedBytes, {
      calculatedByMicrosoftExcel: true,
    });
    const formulaStatus =
      recalculatedInspection.errors > 0
        ? `failed: 重算后发现 ${recalculatedInspection.errors} 个公式错误值`
        : recalculatedInspection.uncachedFormulas > 0
          ? `incomplete: 重算后仍有 ${recalculatedInspection.uncachedFormulas} 个公式缺少缓存结果`
          : "verified: 重算后所有已检查公式均有缓存结果且未发现错误值";
    recalculationText = [
      `Excel 重算结果复核：${formulaStatus}。`,
      `重算工作簿结构：${recalculatedStructure.text}`,
    ].join("\n");
    warnings.push(...recalculatedStructure.warnings);
    if (recalculatedInspection.errors > 0)
      warnings.push(
        `FORMULA_ERRORS: Microsoft Excel 重算后发现 ${recalculatedInspection.errors} 个错误值；不得把该工作簿报告为公式验证通过。`,
      );
    else if (recalculatedInspection.uncachedFormulas > 0)
      warnings.push(
        `FORMULA_CACHE_INCOMPLETE: Microsoft Excel 重算后仍有 ${recalculatedInspection.uncachedFormulas} 个公式缺少缓存结果。`,
      );
  } else if (rendered.status === "verified" && input.recalculate && !rendered.recalculatedBytes) {
    warnings.push(
      "FORMULA_RECALCULATION_UNVERIFIED: Excel COM 没有返回可重新检查的重算工作簿；不得把打开工作簿等同于公式已验证。",
    );
  }
  const renderOutput =
    rendered.status === "verified" && input.render_path && rendered.renderedPdf
      ? rendered.renderedPdf
      : undefined;
  const recalculatedOutput =
    rendered.status === "verified" &&
    input.output_path &&
    input.recalculate &&
    rendered.recalculatedBytes
      ? rendered.recalculatedBytes
      : undefined;
  if (rendered.status === "verified" && input.render && !rendered.renderedPdf)
    warnings.push(
      "PDF_RENDER_UNVERIFIED: Microsoft Office 未返回可用的 PDF 文件；不得把命令成功等同于渲染检查通过。",
    );
  return {
    output: [
      structural.text,
      `Microsoft Office 验证：${rendered.status}。${rendered.message}`,
      recalculationText,
      rendered.status === "verified" && input.render && rendered.renderedPdf
        ? input.render_path
          ? `已导出 PDF，返回给写入网关保存到 ${input.render_path}；仍需由视觉能力逐页检查布局。`
          : "已导出 PDF 完成渲染验证；未提供 render_path，因此不返回 PDF 输出。"
        : "",
      recalculatedOutput
        ? `已生成带公式缓存的重算工作簿，返回给写入网关保存到 ${input.output_path}；源文件未被修改。`
        : input.output_path && rendered.status === "verified"
          ? "Excel 未返回可持久化的重算工作簿；不得把公式已打开等同于缓存已验证。"
          : "",
    ]
      .filter(Boolean)
      .join("\n"),
    warnings,
    ...(renderOutput
      ? {
          rendition: {
            extension: ".pdf" as const,
            bytes: renderOutput,
            suggestedPath: input.render_path as string,
          },
        }
      : {}),
    ...(recalculatedOutput ? { recalculatedBytes: recalculatedOutput } : {}),
  };
}

export async function executeOfficeDocument(
  rawInput: unknown,
  assets: Map<string, Buffer> = new Map(),
  signal?: AbortSignal,
  options: { canUseOffice?: boolean } = {},
): Promise<OfficeDocumentResult> {
  signal?.throwIfAborted();
  const input = officeDocumentSchema.parse(rawInput);
  assertOfficeInputExtensions(input);
  switch (input.operation) {
    case "create_spreadsheet":
      return createSpreadsheet(input, signal);
    case "edit_spreadsheet": {
      const source = assets.get(input.source.path);
      if (!source) throw new Error("XLSX 编辑缺少经读取网关提供的源字节。");
      return editSpreadsheet(input, source, signal);
    }
    case "edit_presentation": {
      const source = assets.get(input.source.path);
      if (!source) throw new Error("PPTX 编辑缺少经读取网关提供的源字节。");
      return editPresentation(input, source, signal);
    }
    case "inspect": {
      const source = assets.get(input.path);
      if (!source) throw new Error("Office 结构检查缺少经读取网关提供的源字节。");
      return inspectOffice(input, source);
    }
    case "verify": {
      const source = assets.get(input.path);
      if (!source) throw new Error("Office 验证缺少经读取网关提供的源字节。");
      return verifyOffice(input, source, signal, options.canUseOffice ?? false);
    }
  }
}

export function officeDocumentSourcePath(input: OfficeDocumentInput): string | null {
  return "source" in input ? input.source.path : null;
}

export function officeDocumentAssets(input: OfficeDocumentInput): string[] {
  return "source" in input
    ? [input.source.path]
    : input.operation === "inspect" || input.operation === "verify"
      ? [input.path]
      : [];
}
