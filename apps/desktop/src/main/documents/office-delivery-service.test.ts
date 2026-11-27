import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OFFICE_DELIVERY_SETTINGS,
  MIGRATION_OFFICE_DELIVERY,
  normalizeOfficeDeliverySettings,
} from "../../shared/office-delivery";
import { authorOfficeDocument } from "./document-author";
import { documentAuthoringSchema } from "./document-authoring-schema";
import {
  OfficeDeliveryService,
  type OfficeDeliveryServiceOptions,
} from "./office-delivery-service";
import { executeOfficeDocument, type OfficeDocumentResult } from "./office-document";

const { scannedPdf } = createRequire(import.meta.url)(
  resolve("../../scripts/fixtures/document-fixtures.cjs"),
) as {
  scannedPdf: (options?: { pages?: number; mixed?: boolean; handwriting?: boolean }) => Buffer;
};

const temporaryDirectories: string[] = [];

async function fixture(overrides: Partial<OfficeDeliveryServiceOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), "mingshen-office-delivery-test-"));
  temporaryDirectories.push(root);
  const database = new DatabaseSync(":memory:");
  database.exec("create table sessions (id text primary key)");
  database.prepare("insert into sessions (id) values (?)").run("session");
  database.exec(MIGRATION_OFFICE_DELIVERY);
  const service = new OfficeDeliveryService({
    database,
    evidenceDirectory: join(root, "evidence"),
    libreOfficePath: null,
    platform: "win32",
    ...overrides,
  });
  return { root, database, service };
}

async function testDocx(text: string): Promise<Buffer> {
  return authorOfficeDocument(
    documentAuthoringSchema.parse({
      path: "report.docx",
      blocks: [{ type: "paragraph", text }],
    }),
    new Map(),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 3 })),
  );
});

describe("OfficeDeliveryService", () => {
  it("normalizes bounded Office delivery settings", () => {
    expect(normalizeOfficeDeliverySettings(null)).toEqual(DEFAULT_OFFICE_DELIVERY_SETTINGS);
    expect(
      normalizeOfficeDeliverySettings({
        visualEnabled: false,
        visionModelId: " vision ",
        maxRepairRounds: 99,
        batchPages: 99,
        batchMaxBytes: 100 * 1024 * 1024,
        maxPages: 999,
        maxImageBytes: 999 * 1024 * 1024,
      }),
    ).toEqual({
      visualEnabled: false,
      visionModelId: "vision",
      maxRepairRounds: 3,
      batchPages: 20,
      batchMaxBytes: 20 * 1024 * 1024,
      maxPages: 200,
      maxImageBytes: 200 * 1024 * 1024,
    });
  });

  it("binds a PDF receipt to its exact bytes and reports a stale external edit", async () => {
    const f = await fixture();
    const path = join(f.root, "report.pdf");
    await writeFile(path, scannedPdf({ pages: 1 }));
    const prepared = await f.service.prepare({
      sessionId: "session",
      runId: "run-1",
      path,
    });
    expect(prepared.receipt.fileName).toBe("report.pdf");
    expect(prepared.receipt.runId).toBe("run-1");
    expect(prepared.receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.receipt.status).toBe("unverified");
    expect(prepared.receipt.formulaCoverage).toBeNull();

    const duplicate = await f.service.prepare({
      sessionId: "session",
      runId: "run-1",
      path,
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.receipt.id).toBe(prepared.receipt.id);

    const nextRun = await f.service.prepare({
      sessionId: "session",
      runId: "run-2",
      path,
    });
    expect(nextRun.duplicate).toBe(false);
    expect(nextRun.receipt.id).not.toBe(prepared.receipt.id);
    expect(nextRun.receipt.runId).toBe("run-2");

    await writeFile(path, scannedPdf({ pages: 2 }));
    expect((await f.service.get(prepared.receipt.id)).status).toBe("stale");
    expect((await f.service.get(nextRun.receipt.id)).status).toBe("stale");
  });

  it("invalidates a receipt when its recorded source changes", async () => {
    const f = await fixture();
    const sourcePath = join(f.root, "source.pdf");
    const outputPath = join(f.root, "output.pdf");
    await writeFile(sourcePath, scannedPdf({ pages: 1 }));
    await writeFile(outputPath, scannedPdf({ pages: 2 }));
    const { receipt } = await f.service.prepare({
      sessionId: "session",
      path: outputPath,
      sourcePath,
    });
    expect(receipt.source?.fileName).toBe("source.pdf");
    await writeFile(sourcePath, scannedPdf({ pages: 3 }));
    expect((await f.service.get(receipt.id)).status).toBe("stale");
  });

  it("normalizes legacy receipts without formula coverage to null", async () => {
    const f = await fixture();
    const path = join(f.root, "legacy.pdf");
    await writeFile(path, scannedPdf({ pages: 1 }));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const legacy = JSON.parse(
      (
        f.database
          .prepare("select receipt_json from office_deliveries where id = ?")
          .get(receipt.id) as { receipt_json: string }
      ).receipt_json,
    ) as Record<string, unknown>;
    delete legacy.formulaCoverage;
    f.database
      .prepare("update office_deliveries set receipt_json = ? where id = ?")
      .run(JSON.stringify(legacy), receipt.id);

    expect((await f.service.get(receipt.id)).formulaCoverage).toBeNull();
  });

  it("keeps sampled structure and content partial independently from Office availability", async () => {
    const f = await fixture({
      executeOfficeDocument: async () => ({
        output: "DOCX 结构通过：内容抽样完成。",
        warnings: ["结构检查最多列出 2000 个非空单元格。"],
        verification: {
          status: "partial",
          render: "unavailable",
          recalculation: "not_requested",
        },
        structureCheck: {
          structure: "partial",
          content: "partial",
        },
      }),
    });
    const path = join(f.root, "report.docx");
    await writeFile(path, await testDocx("Sampled content."));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });

    const checked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: true,
      allowLibreOffice: false,
    });

    expect(checked.stages.structure).toBe("partial");
    expect(checked.stages.content).toBe("partial");
    expect(checked.status).toBe("partial");
  });

  it("rejects an artifact changed during the final visual inspection", async () => {
    let artifactPath = "";
    const replacement = await testDocx("Replacement during visual review.");
    const f = await fixture({
      executeOfficeDocument: async () => ({
        output: "DOCX 结构通过：一页正文。",
        warnings: [],
        verification: {
          status: "verified",
          render: "verified",
          recalculation: "not_requested",
        },
        structureCheck: {
          structure: "verified",
          content: "verified",
        },
        rendition: {
          extension: ".pdf",
          bytes: scannedPdf({ pages: 1 }),
          suggestedPath: "rendered.pdf",
        },
      }),
    });
    artifactPath = join(f.root, "report.docx");
    await writeFile(artifactPath, await testDocx("Original document."));
    const { receipt } = await f.service.prepare({ sessionId: "session", path: artifactPath });

    const checked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: true,
      allowLibreOffice: false,
      visualInspector: async (input) => {
        await writeFile(artifactPath, replacement);
        return input.pages.map((page) => ({
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          status: "pass" as const,
        }));
      },
    });

    expect(checked.status).toBe("stale");
    expect(
      checked.issues.some((issue) => issue.code === "OFFICE_DELIVERY_CHANGED_DURING_CHECK"),
    ).toBe(true);
  });

  it("rejects a recorded source changed during the final visual inspection", async () => {
    let sourcePath = "";
    const replacement = await testDocx("Replacement source during visual review.");
    const f = await fixture({
      executeOfficeDocument: async () => ({
        output: "DOCX 结构通过：一页正文。",
        warnings: [],
        verification: {
          status: "verified",
          render: "verified",
          recalculation: "not_requested",
        },
        structureCheck: {
          structure: "verified",
          content: "verified",
        },
        rendition: {
          extension: ".pdf",
          bytes: scannedPdf({ pages: 1 }),
          suggestedPath: "rendered.pdf",
        },
      }),
    });
    const artifactPath = join(f.root, "report.docx");
    sourcePath = join(f.root, "source.docx");
    await writeFile(artifactPath, await testDocx("Final artifact."));
    await writeFile(sourcePath, await testDocx("Original source."));
    const { receipt } = await f.service.prepare({
      sessionId: "session",
      path: artifactPath,
      sourcePath,
    });

    const checked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: true,
      allowLibreOffice: false,
      visualInspector: async (input) => {
        await writeFile(sourcePath, replacement);
        return input.pages.map((page) => ({
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          status: "pass" as const,
        }));
      },
    });

    expect(checked.status).toBe("stale");
    expect(
      checked.issues.some((issue) => issue.code === "OFFICE_DELIVERY_CHANGED_DURING_CHECK"),
    ).toBe(true);
  });

  it("does not claim visual approval without page-level evidence", async () => {
    const f = await fixture();
    const path = join(f.root, "report.pdf");
    await writeFile(path, scannedPdf({ pages: 2 }));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const checked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: false,
      allowLibreOffice: false,
    });
    expect(checked.status).toBe("unverified");
    expect(checked.engine).toBe("source_pdf");
    expect(checked.stages.render).toBe("verified");
    expect(checked.stages.visual).toBe("unavailable");
    expect(checked.unverified.join(" ")).toContain("Visual inspection");

    const blocked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: false,
      allowLibreOffice: false,
      requiredVisual: true,
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.issues.some((issue) => issue.code === "VISUAL_REVIEW_REQUIRED")).toBe(true);
  });

  it("accepts only the exact page IDs and pages requested for a visual batch", async () => {
    const f = await fixture();
    const path = join(f.root, "report.pdf");
    await writeFile(path, scannedPdf({ pages: 2 }));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const checked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: false,
      allowLibreOffice: false,
    });
    const batch = await f.service.createVisualBatch(checked.id, {
      startPage: 1,
      pageLimit: 2,
      maxImageBytes: 12 * 1024 * 1024,
    });
    expect(batch.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(new Set(batch.pages.map((page) => page.pageId)).size).toBe(2);

    await expect(
      f.service.recordVisualBatch(checked.id, {
        batchId: batch.batchId,
        pages: batch.pages.map((page) => ({
          pageNumber: page.pageNumber,
          pageId: `${page.pageId}-forged`,
          status: "pass" as const,
        })),
      }),
    ).rejects.toThrow("missing, duplicate or unrequested page");

    const verified = await f.service.recordVisualBatch(checked.id, {
      batchId: batch.batchId,
      pages: batch.pages.map((page) => ({
        pageNumber: page.pageNumber,
        pageId: page.pageId,
        status: "pass" as const,
      })),
    });
    expect(verified.status).toBe("verified");
    expect(verified.stages.render).toBe("verified");
    expect(verified.stages.visual).toBe("verified");
    expect(verified.visual.complete).toBe(true);
  });

  it("rejects substituted cached PDF evidence before visual rendering", async () => {
    const f = await fixture();
    const path = join(f.root, "report.pdf");
    await writeFile(path, scannedPdf({ pages: 2 }));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    await f.service.check(receipt.id, {
      allowMicrosoftOffice: false,
      allowLibreOffice: false,
    });
    const row = f.database
      .prepare("select evidence_path from office_deliveries where id = ?")
      .get(receipt.id) as { evidence_path: string };
    await writeFile(row.evidence_path, scannedPdf({ pages: 3 }));

    await expect(
      f.service.createVisualBatch(receipt.id, {
        startPage: 1,
        pageLimit: 1,
        maxImageBytes: 12 * 1024 * 1024,
      }),
    ).rejects.toThrow("size or SHA-256 integrity check");
  });

  it("renders only the requested PDF page range and rejects pages past the document", async () => {
    const f = await fixture();
    const path = join(f.root, "report.pdf");
    await writeFile(path, scannedPdf({ pages: 3 }));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const checked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: false,
      allowLibreOffice: false,
    });

    const batch = await f.service.createVisualBatch(checked.id, {
      startPage: 2,
      pageLimit: 2,
      maxImageBytes: 12 * 1024 * 1024,
    });
    expect(batch.pages.map((page) => page.pageNumber)).toEqual([2, 3]);
    expect(batch.pages.every((page) => page.pageId.startsWith("office-visual:"))).toBe(true);
    expect(batch.omittedPages).toEqual([]);

    const recorded = await f.service.recordVisualBatch(checked.id, {
      batchId: batch.batchId,
      pages: batch.pages.map((page) => ({
        pageNumber: page.pageNumber,
        pageId: page.pageId,
        status: "pass" as const,
      })),
    });
    expect(recorded.visual.totalPages).toBe(3);
    expect(recorded.visual.pageNumbers).toEqual([2, 3]);
    expect(recorded.visual.complete).toBe(false);
    expect(recorded.status).toBe("partial");

    await expect(
      f.service.createVisualBatch(checked.id, {
        startPage: 4,
        pageLimit: 1,
        maxImageBytes: 12 * 1024 * 1024,
      }),
    ).rejects.toThrow("No pages could be rendered for the requested visual batch");
    expect((await f.service.get(checked.id)).visual.pageNumbers).toEqual([2, 3]);
  });

  it("runs a bounded visual inspector over exact rendered pages and records layout issues", async () => {
    const f = await fixture();
    const path = join(f.root, "report.pdf");
    await writeFile(path, scannedPdf({ pages: 3 }));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const inspectedPages: number[][] = [];
    const checked = await f.service.check(
      receipt.id,
      {
        allowMicrosoftOffice: false,
        allowLibreOffice: false,
        settings: { batchPages: 2 },
        visualInspector: async (input) => {
          inspectedPages.push(input.pages.map((page) => page.pageNumber));
          return input.pages.map((page) => ({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            status: page.pageNumber === 2 ? ("issue" as const) : ("pass" as const),
            ...(page.pageNumber === 2
              ? { severity: "warning" as const, issues: ["Text overlaps the footer."] }
              : {}),
          }));
        },
      },
      undefined,
    );
    expect(inspectedPages).toEqual([[1, 2], [3]]);
    expect(checked.visual.complete).toBe(true);
    expect(checked.stages.visual).toBe("partial");
    expect(checked.status).toBe("partial");
    expect(checked.repairSuggestions.join(" ")).toContain("page 2");
  });

  it("rechecks management policy before each visual renderer and model stage", async () => {
    const f = await fixture();
    const path = join(f.root, "policy-report.pdf");
    await writeFile(path, scannedPdf({ pages: 3 }));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const stages: string[] = [];
    await expect(
      f.service.check(receipt.id, {
        allowMicrosoftOffice: false,
        allowLibreOffice: false,
        settings: { batchPages: 2 },
        beforeStage: (stage) => {
          stages.push(stage);
          if (stage === "visual" && stages.filter((item) => item === "visual").length === 3)
            throw Object.assign(new Error("POLICY_TEST_REVOKED"), { code: "POLICY_TEST_REVOKED" });
        },
        visualInspector: async (input) =>
          input.pages.map((page) => ({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            status: "pass" as const,
          })),
      }),
    ).rejects.toMatchObject({ code: "POLICY_TEST_REVOKED" });
    expect(stages).toEqual(["visual", "visual", "visual"]);
  });

  it("propagates cancellation instead of persisting a degraded Office receipt", async () => {
    let officeStarted: () => void = () => undefined;
    const started = new Promise<void>((resolveStarted) => {
      officeStarted = resolveStarted;
    });
    const f = await fixture({
      executeOfficeDocument: async (_input, _files, signal) => {
        officeStarted();
        await new Promise<void>((resolveAbort) => {
          if (signal?.aborted) resolveAbort();
          else signal?.addEventListener("abort", () => resolveAbort(), { once: true });
        });
        return {
          output: "Office verification was interrupted.",
          warnings: [],
          verification: {
            status: "failed",
            render: "unavailable",
            recalculation: "unavailable",
          },
        };
      },
    });
    const path = join(f.root, "cancel.docx");
    await writeFile(path, await testDocx("Cancellation must not be persisted."));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const controller = new AbortController();
    const pending = f.service.check(
      receipt.id,
      {
        allowMicrosoftOffice: true,
        allowLibreOffice: false,
      },
      controller.signal,
    );
    await started;
    controller.abort(new Error("Test cancellation."));
    await expect(pending).rejects.toThrow("Test cancellation.");
    const unchanged = await f.service.get(receipt.id);
    expect(unchanged.status).toBe("unverified");
    expect(unchanged.revision).toBe(0);
    expect(unchanged.issues).toEqual([]);
  });

  it("blocks damaged Office packages instead of treating structure success as delivery", async () => {
    const f = await fixture();
    const path = join(f.root, "broken.docx");
    await writeFile(path, Buffer.from("not an office package"));
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const checked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: false,
      allowLibreOffice: false,
    });
    expect(checked.status).toBe("blocked");
    expect(checked.stages.package).toBe("blocked");
  });

  it.each([
    {
      label: "partial cache",
      warning: "FORMULA_CACHE_INCOMPLETE: Office reported a partial formula cache.",
      expectedStatus: "partial" as const,
    },
    {
      label: "formula failure",
      warning: "FORMULA_ERRORS: Office reported formula errors.",
      expectedStatus: "failed" as const,
    },
  ])(
    "records independent formula coverage even when Office already reports a $label",
    async ({ warning, expectedStatus }) => {
      const authored = await executeOfficeDocument({
        operation: "create_spreadsheet",
        path: "formula-report.xlsx",
        workbook: {
          sheets: [
            {
              name: "Metrics",
              cells: [
                { row: 1, column: 1, value: "Revenue" },
                { row: 1, column: 2, value: 1200 },
                { row: 2, column: 1, value: "Cost" },
                { row: 2, column: 2, value: 700 },
                {
                  row: 3,
                  column: 1,
                  value: "Margin",
                },
                {
                  row: 3,
                  column: 2,
                  value: { formula: "B1-B2", result: 500 },
                },
              ],
            },
          ],
        },
      });
      const bytes = authored.bytes;
      expect(bytes).toBeDefined();
      const f = await fixture({
        executeOfficeDocument: async () => ({
          output: "XLSX 结构通过：公式缓存待复核。",
          warnings: [warning],
          verification: {
            status: "partial",
            render: "unavailable",
            recalculation: "partial",
          },
          structureCheck: {
            structure: "verified",
            content: "verified",
          },
        }),
      });
      const path = join(f.root, "formula-report.xlsx");
      await writeFile(path, bytes ?? Buffer.alloc(0));
      const { receipt } = await f.service.prepare({ sessionId: "session", path });

      const checked = await f.service.check(receipt.id, {
        allowMicrosoftOffice: true,
        allowLibreOffice: false,
      });

      expect(checked.stages.formula).toBe(expectedStatus);
      expect(checked.formulaCoverage).toMatchObject({
        complete: true,
        formulas: 1,
        uncachedFormulas: 0,
        errors: 0,
      });
      expect(checked.formulaCoverage?.samples).toEqual([
        expect.objectContaining({
          sheet: "Metrics",
          cell: "B3",
          formula: "B1-B2",
          cached: true,
          result: "500",
        }),
      ]);
    },
  );

  it("keeps Microsoft Office rendering separate from final visual acceptance", async () => {
    let officeCalls = 0;
    const f = await fixture({
      executeOfficeDocument: async () => {
        officeCalls += 1;
        return {
          output: "DOCX 结构通过：一页正文。",
          warnings: [],
          verification: {
            status: "verified",
            render: "verified",
            recalculation: "not_requested",
          },
          rendition: {
            extension: ".pdf",
            bytes: scannedPdf({ pages: 1 }),
            suggestedPath: "rendered.pdf",
          },
        } satisfies OfficeDocumentResult;
      },
    });
    const path = join(f.root, "report.docx");
    await writeFile(
      path,
      await authorOfficeDocument(
        documentAuthoringSchema.parse({
          path: "report.docx",
          blocks: [{ type: "paragraph", text: "A rendered report." }],
        }),
        new Map(),
      ),
    );
    const { receipt } = await f.service.prepare({ sessionId: "session", path });
    const checked = await f.service.check(receipt.id, {
      allowMicrosoftOffice: true,
      allowLibreOffice: false,
    });
    expect(officeCalls).toBe(1);
    expect(checked.engine).toBe("microsoft_office");
    expect(checked.stages.render).toBe("verified");
    expect(checked.stages.visual).toBe("unavailable");
    expect(checked.status).toBe("unverified");
  });

  it.runIf(
    process.platform === "win32" &&
      existsSync("C:\\Program Files\\LibreOffice\\program\\soffice.exe"),
  )(
    "falls back to an isolated LibreOffice render without changing the source",
    async () => {
      const f = await fixture({
        libreOfficePath: "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      });
      const path = join(f.root, "report.docx");
      const source = await authorOfficeDocument(
        documentAuthoringSchema.parse({
          path: "report.docx",
          title: "LibreOffice fallback",
          blocks: [{ type: "paragraph", text: "Rendered through an isolated profile." }],
        }),
        new Map(),
      );
      await writeFile(path, source);
      const { receipt } = await f.service.prepare({ sessionId: "session", path });
      const checked = await f.service.check(
        receipt.id,
        {
          allowMicrosoftOffice: false,
          allowLibreOffice: true,
        },
        undefined,
      );
      expect(checked.engine).toBe("libreoffice");
      expect(checked.stages.render).toBe("verified");
      expect(checked.status).toBe("unverified");
      expect((await f.service.get(receipt.id)).status).toBe("unverified");
      expect((await readFile(path)).equals(source)).toBe(true);
    },
    120_000,
  );
});
