import { describe, expect, it } from "vitest";
import type { OfficeDeliveryReceipt } from "../../../shared/office-delivery";
import { canContinueOfficeDelivery, firstUninspectedOfficePage } from "./office-delivery-panel";

function receipt(overrides: Partial<OfficeDeliveryReceipt> = {}): OfficeDeliveryReceipt {
  return {
    id: "delivery-1",
    sessionId: "session-1",
    runId: "run-1",
    fileName: "report.docx",
    format: "DOCX",
    size: 1024,
    sha256: "a".repeat(64),
    source: null,
    status: "partial",
    stages: {
      package: "verified",
      structure: "verified",
      content: "verified",
      formula: "not_requested",
      recalculation: "not_requested",
      render: "verified",
      visual: "partial",
    },
    engine: "libreoffice",
    structuralSummary: "12 pages",
    issues: [],
    unverified: ["Pages 2-4 remain to be inspected."],
    repairSuggestions: [],
    visual: {
      totalPages: 4,
      inspectedPages: 1,
      complete: false,
      batchCount: 1,
      pageNumbers: [1],
      modelId: "vision-model",
    },
    evidence: {
      pdfSha256: "b".repeat(64),
      pdfBytes: 2048,
      cachedUntil: null,
    },
    checkedAt: "2026-11-27T00:00:00.000Z",
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
    revision: 2,
    ...overrides,
  };
}

describe("office delivery continuation", () => {
  it("finds the lowest page that has not been inspected", () => {
    expect(
      firstUninspectedOfficePage(
        receipt({
          visual: {
            ...receipt().visual,
            pageNumbers: [1, 3, 7],
            inspectedPages: 3,
          },
        }),
      ),
    ).toBe(2);
  });

  it("allows continuation only for a current, structurally rendered partial receipt", () => {
    expect(canContinueOfficeDelivery(receipt())).toBe(true);
    expect(canContinueOfficeDelivery(receipt({ status: "stale" }))).toBe(false);
    expect(canContinueOfficeDelivery(receipt({ status: "blocked" }))).toBe(false);
    expect(
      canContinueOfficeDelivery(
        receipt({
          stages: { ...receipt().stages, render: "failed" },
        }),
      ),
    ).toBe(false);
  });

  it("does not offer continuation when every page has an assessment", () => {
    const complete = receipt({
      visual: {
        ...receipt().visual,
        inspectedPages: 4,
        complete: true,
        pageNumbers: [1, 2, 3, 4],
      },
    });
    expect(firstUninspectedOfficePage(complete)).toBeNull();
    expect(canContinueOfficeDelivery(complete)).toBe(false);
  });
});
