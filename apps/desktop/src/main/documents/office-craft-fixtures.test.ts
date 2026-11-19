import type { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { authorOfficeDocument } from "./document-author";
import { documentAuthoringSchema } from "./document-authoring-schema";
import { executeOfficeDocument, verifyWithMicrosoftOffice } from "./office-document";

const evidenceDirectory = process.env.OFFICE_CRAFT_EVIDENCE
  ? resolve(process.env.OFFICE_CRAFT_EVIDENCE)
  : undefined;

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("office craft fixtures", () => {
  it(
    "produces a designed Word brief, workbook and presentation for render inspection",
    async () => {
      const documentRequest = documentAuthoringSchema.parse({
        path: "board-decision-brief.docx",
        title: "Board decision brief",
        author: "Strategy Office",
        design: {
          preset: "executive" as const,
          density: "balanced" as const,
          cover_page: true,
        },
        page_numbers: true,
        footer: "Confidential | Decision draft",
        blocks: [
          { type: "heading" as const, text: "Decision", level: 1 as const },
          {
            type: "paragraph" as const,
            text: "Approve the focused rollout after the pilot met the agreed adoption, quality and operating-cost thresholds.",
          },
          {
            type: "table" as const,
            header: true,
            column_widths: [1.2, 1, 2.8],
            rows: [
              ["Option", "Evidence", "Implication"],
              [
                "Focused rollout",
                "Pilot stayed within the approved risk band.",
                "Proceed in two waves.",
              ],
              [
                "Hold",
                "No new evidence addresses the bottleneck.",
                "Delays the decision without reducing risk.",
              ],
            ],
          },
          { type: "heading" as const, text: "Why now", level: 2 as const },
          {
            type: "paragraph" as const,
            text: "The pilot produced enough evidence to make a bounded decision. Approval remains subject to the owner and date stated below.",
          },
          {
            type: "callout" as const,
            title: "Decision guardrail",
            text: "Scale only after the second-wave acceptance checks are complete.",
            tone: "warning" as const,
          },
          { type: "heading" as const, text: "Next actions", level: 2 as const },
          {
            type: "list" as const,
            ordered: true,
            items: [
              "Confirm the second-wave owner and acceptance date.",
              "Publish the quality baseline before launch.",
              "Review adoption and cost after the first operating cycle.",
            ],
          },
        ],
      });
      const documentBytes = await authorOfficeDocument(documentRequest, new Map());
      const documentInspection = await executeOfficeDocument(
        { operation: "inspect", path: documentRequest.path },
        new Map([[documentRequest.path, documentBytes]]),
      );

      const workbookSpec = {
        operation: "create_spreadsheet" as const,
        path: "operating-review.xlsx",
        workbook: {
          design: { preset: "consulting" as const, accent: "1F4E78" },
          sheets: [
            {
              name: "Operating review",
              columns: [
                { index: 1, width: 28 },
                { index: 2, width: 17 },
                { index: 3, width: 17 },
                { index: 4, width: 35 },
              ],
              cells: [
                { row: 1, column: 1, value: "Operating review | Q4" },
                { row: 2, column: 1, value: "Metric" },
                { row: 2, column: 2, value: "Actual" },
                { row: 2, column: 3, value: "Plan" },
                { row: 2, column: 4, value: "Decision signal" },
                { row: 3, column: 1, value: "On-time delivery" },
                { row: 3, column: 2, value: 0.92 },
                { row: 3, column: 3, value: 0.9 },
                { row: 3, column: 4, value: "Above threshold" },
                {
                  row: 3,
                  column: 2,
                  value: 0.92,
                  style: { number_format: "0.0%" },
                },
                {
                  row: 3,
                  column: 3,
                  value: 0.9,
                  style: { number_format: "0.0%" },
                },
                { row: 4, column: 1, value: "Cycle time (days)" },
                { row: 4, column: 2, value: 18 },
                { row: 4, column: 3, value: 21 },
                { row: 4, column: 4, value: "Improving" },
                { row: 5, column: 1, value: "Quality score" },
                { row: 5, column: 2, value: 4.6 },
                { row: 5, column: 3, value: 4.5 },
                { row: 5, column: 4, value: "Stable" },
              ],
              presentation: {
                title_range: "A1:D1",
                header_range: "A2:D2",
                body_range: "A3:D5",
                show_grid_lines: false,
                print_area: "A1:D5",
                print_titles_rows: "2:2",
                orientation: "landscape" as const,
                fit_to_page: true,
              },
            },
          ],
        },
      };
      const workbookResult = await executeOfficeDocument(workbookSpec, new Map());
      expect(workbookResult.bytes).toBeDefined();
      const workbookInspection = await executeOfficeDocument(
        { operation: "inspect", path: workbookSpec.path },
        new Map([[workbookSpec.path, workbookResult.bytes as Buffer]]),
      );

      const presentationRequest = documentAuthoringSchema.parse({
        path: "operating-review.pptx",
        title: "Operating review",
        author: "Strategy Office",
        footer: "Confidential | Operating review",
        design: { preset: "consulting" as const, density: "airy" as const },
        slides: [
          {
            kind: "cover" as const,
            eyebrow: "Q4 operating review",
            title: "Decide the next wave",
          },
          {
            kind: "statement" as const,
            eyebrow: "Recommendation",
            title: "The pilot is ready for a bounded second wave",
            blocks: [
              {
                type: "paragraph" as const,
                text: "Proceed in two waves while the operating owner closes the remaining readiness checks.",
              },
            ],
          },
          {
            kind: "data" as const,
            eyebrow: "Evidence and guardrail",
            title: "Volume is improving without opening the risk boundary",
            blocks: [
              {
                type: "chart" as const,
                title: "Weekly completed cases",
                chart_type: "column" as const,
                categories: ["Week 1", "Week 2", "Week 3", "Week 4"],
                series: [
                  { name: "Actual", values: [18, 22, 27, 31] },
                  { name: "Plan", values: [20, 21, 23, 25] },
                ],
                position: { x: 0.6, y: 1.72, w: 6.1, h: 4.12 },
              },
              {
                type: "callout" as const,
                title: "Decision boundary",
                text: "The quality score must stay at or above 4.5 during the next two operating cycles.",
                tone: "warning" as const,
                position: { x: 7, y: 1.72, w: 5.73, h: 2.05 },
              },
              {
                type: "list" as const,
                items: [
                  "Keep the exception queue at or below the agreed threshold.",
                  "Review the second-wave gate after two complete cycles.",
                ],
                position: { x: 7, y: 4.05, w: 5.73, h: 1.85 },
              },
            ],
          },
          {
            kind: "cards" as const,
            eyebrow: "Readiness",
            title: "Three conditions support the decision",
            blocks: [
              {
                type: "list" as const,
                items: [
                  "Adoption met the agreed threshold",
                  "Quality remained inside the control band",
                  "Operating cost did not exceed the plan",
                ],
              },
            ],
          },
          {
            kind: "timeline" as const,
            eyebrow: "Next 30 days",
            title: "Sequence the rollout around evidence",
            blocks: [
              {
                type: "list" as const,
                ordered: true,
                items: ["Confirm owner", "Publish baseline", "Launch wave one", "Review evidence"],
              },
            ],
          },
          {
            kind: "data" as const,
            eyebrow: "Scorecard",
            title: "All three operating signals are within the decision range",
            blocks: [
              {
                type: "metric_grid" as const,
                columns: 3,
                metrics: [
                  { value: "92%", label: "On-time delivery", detail: "+2 pts vs plan" },
                  { value: "18d", label: "Cycle time", detail: "3 days better than plan" },
                  { value: "4.6", label: "Quality score", detail: "+0.1 vs plan" },
                ],
              },
            ],
            notes:
              "The decision compares actual results with the pre-agreed operating thresholds. It does not extrapolate from the pilot.",
          },
          {
            kind: "closing" as const,
            eyebrow: "Decision requested",
            title: "Approve wave one and the second-wave gate",
          },
        ],
      });
      const presentationBytes = await authorOfficeDocument(presentationRequest, new Map());
      const presentationInspection = await executeOfficeDocument(
        { operation: "inspect", path: presentationRequest.path },
        new Map([[presentationRequest.path, presentationBytes]]),
      );
      const presentationArchive = unzipSync(new Uint8Array(presentationBytes));
      const mixedSlide = strFromU8(
        presentationArchive["ppt/slides/slide3.xml"] ?? new Uint8Array(),
      );
      const mixedChart = strFromU8(
        presentationArchive["ppt/charts/chart1.xml"] ?? new Uint8Array(),
      );
      const mixedFrames = (presentationRequest.slides?.[2]?.blocks ?? []).flatMap((block) =>
        "position" in block && block.position ? [block.position] : [],
      );
      const mixedFramesOverlap = mixedFrames.some((left, leftIndex) =>
        mixedFrames.some(
          (right, rightIndex) =>
            leftIndex < rightIndex &&
            left.x < right.x + right.w &&
            right.x < left.x + left.w &&
            left.y < right.y + right.h &&
            right.y < left.y + left.h,
        ),
      );

      expect(documentBytes.length).toBeGreaterThan(2_000);
      expect(workbookResult.bytes?.length).toBeGreaterThan(2_000);
      expect(presentationBytes.length).toBeGreaterThan(10_000);
      expect(documentInspection.output).toContain("DOCX");
      expect(workbookInspection.output).toContain("XLSX");
      expect(presentationInspection.output).toContain("PPTX");
      expect(mixedFrames).toHaveLength(3);
      expect(mixedFramesOverlap).toBe(false);
      expect(mixedChart).toContain("Weekly completed cases");
      expect(mixedSlide).toContain("Decision boundary");
      expect(mixedSlide).toContain("Keep the exception queue");
      expect(mixedSlide).toContain("<c:chart");

      if (evidenceDirectory) {
        await mkdir(evidenceDirectory, { recursive: true });
        await Promise.all([
          writeFile(join(evidenceDirectory, documentRequest.path), documentBytes),
          writeFile(join(evidenceDirectory, workbookSpec.path), workbookResult.bytes as Buffer),
          writeFile(join(evidenceDirectory, presentationRequest.path), presentationBytes),
          writeFile(
            join(evidenceDirectory, "fixture-result.json"),
            JSON.stringify(
              {
                version: "1.3.3",
                generatedAt: new Date().toISOString(),
                files: {
                  [documentRequest.path]: {
                    bytes: documentBytes.length,
                    sha256: digest(documentBytes),
                  },
                  [workbookSpec.path]: {
                    bytes: workbookResult.bytes?.length,
                    sha256: digest(workbookResult.bytes as Buffer),
                  },
                  [presentationRequest.path]: {
                    bytes: presentationBytes.length,
                    sha256: digest(presentationBytes),
                  },
                },
                verification: {
                  pptxDesigns: presentationRequest.slides?.map((slide) => slide.kind) ?? [],
                  workbookSurface: "title / header / body / print-area / hidden-gridlines",
                  wordSurface: "cover / hierarchy / native-table / callout / ordered-actions",
                  mixedSlide: {
                    frames: mixedFrames,
                    overlap: mixedFramesOverlap,
                    nativeChart: true,
                    callout: "Decision boundary",
                    rightColumn: "guardrail / actions",
                  },
                  structuralInspection: {
                    docx: documentInspection.output,
                    xlsx: workbookInspection.output,
                    pptx: presentationInspection.output,
                  },
                  nativeRendering: "not performed by this test",
                },
              },
              null,
              2,
            ),
          ),
        ]);
      }

      if (process.env.OFFICE_CRAFT_RENDER === "1") {
        if (!evidenceDirectory)
          throw new Error("OFFICE_CRAFT_RENDER=1 requires OFFICE_CRAFT_EVIDENCE.");

        const renderTargets = [
          {
            name: documentRequest.path,
            bytes: documentBytes,
            recalculate: false,
          },
          {
            name: workbookSpec.path,
            bytes: workbookResult.bytes as Buffer,
            recalculate: true,
          },
          {
            name: presentationRequest.path,
            bytes: presentationBytes,
            recalculate: false,
          },
        ];
        const receipts: Array<Record<string, unknown>> = [];
        const writeRenderSummary = () =>
          writeFile(
            join(evidenceDirectory, "render-receipts.json"),
            JSON.stringify(
              {
                generatedAt: new Date().toISOString(),
                officeTimeoutMsPerFile: 30_000,
                receipts,
                note: "unavailable/failed/threw is recorded without turning native rendering into an expected pass",
              },
              null,
              2,
            ),
          );
        try {
          for (const target of renderTargets) {
            const sourceHash = digest(target.bytes);
            let result: Awaited<ReturnType<typeof verifyWithMicrosoftOffice>>;
            try {
              result = await verifyWithMicrosoftOffice(
                target.bytes,
                target.name,
                30_000,
                undefined,
                true,
                target.recalculate,
              );
            } catch (error) {
              const receipt = {
                file: target.name,
                status: "threw",
                message: error instanceof Error ? error.message : String(error),
                sourceHash,
                sourceUnchanged: digest(target.bytes) === sourceHash,
                pdf: null,
                recalculatedWorkbook: null,
              };
              receipts.push(receipt);
              await writeFile(
                join(evidenceDirectory, `${target.name}.render-receipt.json`),
                JSON.stringify(receipt, null, 2),
              );
              throw error;
            }
            const sourceUnchanged = digest(target.bytes) === sourceHash;
            const pdfHeader = result.renderedPdf?.subarray(0, 5).toString("ascii") ?? "";
            const receipt = {
              file: target.name,
              status: result.status,
              message: result.message,
              sourceHash,
              sourceUnchanged,
              pdf: result.renderedPdf
                ? {
                    bytes: result.renderedPdf.length,
                    header: pdfHeader,
                  }
                : null,
              recalculatedWorkbook: result.recalculatedBytes
                ? {
                    bytes: result.recalculatedBytes.length,
                    sha256: digest(result.recalculatedBytes),
                  }
                : null,
            };
            receipts.push(receipt);
            await writeFile(
              join(evidenceDirectory, `${target.name}.render-receipt.json`),
              JSON.stringify(receipt, null, 2),
            );
            expect(sourceUnchanged).toBe(true);
            if (result.status === "verified") {
              expect(pdfHeader).toBe("%PDF-");
              await writeFile(
                join(evidenceDirectory, `${target.name}.rendered.pdf`),
                result.renderedPdf as Buffer,
              );
              if (target.recalculate) {
                expect(result.recalculatedBytes).toBeDefined();
                await writeFile(
                  join(evidenceDirectory, target.name.replace(/\.xlsx$/i, "-recalculated.xlsx")),
                  result.recalculatedBytes as Buffer,
                );
              }
            }
          }
        } finally {
          await writeRenderSummary();
        }
      }
    },
    process.env.OFFICE_CRAFT_RENDER === "1" ? 180_000 : 30_000,
  );
});
