import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { authorOfficeDocument } from "./document-author";
import { documentAuthoringSchema } from "./document-authoring-schema";
import {
  executeOfficeDocument,
  formatOfficeComDiagnostic,
  inspectOfficeComPackageBoundary,
  officeComStageLabel,
  officeDocumentAssets,
  officeDocumentSourcePath,
  officeProcessOwnerMatches,
  parseA1Range,
  parseOfficeComStage,
  parseOfficeProcessOwner,
  verifyWithMicrosoftOffice,
} from "./office-document";
import { assertOfficeInputExtensions, officeDocumentSchema } from "./office-document-schema";

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

  it("rejects non-hyperlink external relationships and split automatic fields for Word COM only", async () => {
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
    expect(inspectOfficeComPackageBoundary(splitInclude, ".docx").reasons).toContain(
      "DOCX_AUTOMATIC_FIELD_INCLUDETEXT",
    );
    for (const field of ["INCLUDEPICTURE", "LINK", "DDE", "DDEAUTO", "DATABASE"]) {
      const source = docxFixture(
        `<w:p><w:fldSimple w:instr=" ${field} &quot;fixture&quot; "><w:r><w:t>Field</w:t></w:r></w:fldSimple></w:p>`,
      );
      expect(inspectOfficeComPackageBoundary(source, ".docx").reasons).toContain(
        `DOCX_AUTOMATIC_FIELD_${field}`,
      );
    }

    const result = await executeOfficeDocument(
      { operation: "verify", path: "automatic-field.docx", render: true },
      new Map([["automatic-field.docx", splitInclude]]),
      undefined,
      { canUseOffice: true },
    );
    expect(result.output).toContain("Microsoft Office 验证：unavailable");
    expect(result.output).toContain("自动字段 INCLUDETEXT");
    expect(result.warnings.join("\n")).toContain("未启动 Office");
    expect(result.rendition).toBeUndefined();
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
