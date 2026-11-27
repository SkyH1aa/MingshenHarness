export const OFFICE_DELIVERY_FORMATS = [".docx", ".xlsx", ".pptx", ".pdf"] as const;

export type OfficeDeliveryFormat = (typeof OFFICE_DELIVERY_FORMATS)[number];
export type OfficeDocumentFormat = "DOCX" | "XLSX" | "PPTX" | "PDF";

export type OfficeDeliveryStatus = "verified" | "partial" | "unverified" | "blocked" | "stale";

export type OfficeDeliveryStageName =
  | "package"
  | "structure"
  | "content"
  | "formula"
  | "recalculation"
  | "render"
  | "visual";

export type OfficeDeliveryStageStatus =
  | "verified"
  | "partial"
  | "unavailable"
  | "failed"
  | "not_requested"
  | "blocked";

export type OfficeDeliveryEngine = "microsoft_office" | "libreoffice" | "source_pdf" | "none";

export const MAX_OFFICE_RENDER_OUTPUT_BYTES = 256 * 1024 * 1024;

export interface OfficeDeliveryIssue {
  code: string;
  stage: OfficeDeliveryStageName;
  severity: "info" | "warning" | "error" | "blocking";
  message: string;
  repairable: boolean;
}

export interface OfficeDeliveryEvidence {
  pdfSha256: string | null;
  pdfBytes: number;
  cachedUntil: string | null;
}

export interface OfficeDeliveryVisualCoverage {
  totalPages: number | null;
  inspectedPages: number;
  complete: boolean;
  batchCount: number;
  pageNumbers: number[];
  modelId: string | null;
}

export interface OfficeDeliveryFormulaSample {
  sheet: string;
  cell: string;
  formula: string;
  cached: boolean;
  result: string | null;
}

export interface OfficeDeliveryFormulaCoverage {
  complete: boolean;
  inspectedCells: number;
  formulas: number;
  uncachedFormulas: number;
  errors: number;
  sampleLimit: number;
  samples: OfficeDeliveryFormulaSample[];
}

export interface OfficeDeliveryReceipt {
  id: string;
  sessionId: string;
  runId: string | null;
  fileName: string;
  format: OfficeDocumentFormat;
  size: number;
  sha256: string;
  source: {
    fileName: string;
    size: number;
    sha256: string;
  } | null;
  status: OfficeDeliveryStatus;
  stages: Record<OfficeDeliveryStageName, OfficeDeliveryStageStatus>;
  engine: OfficeDeliveryEngine;
  structuralSummary: string;
  formulaCoverage?: OfficeDeliveryFormulaCoverage | null;
  issues: OfficeDeliveryIssue[];
  unverified: string[];
  repairSuggestions: string[];
  visual: OfficeDeliveryVisualCoverage;
  evidence: OfficeDeliveryEvidence;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface OfficeVisualPageAssessment {
  pageNumber: number;
  pageId: string;
  status: "pass" | "issue" | "inconclusive";
  severity?: "warning" | "error";
  issues?: string[];
  summary?: string;
}

export interface OfficeVisualBatchPage {
  pageNumber: number;
  pageId: string;
  dataUrl: string;
  bytes: number;
}

export interface OfficeVisualBatch {
  batchId: string;
  deliveryId: string;
  artifactSha256: string;
  pages: OfficeVisualBatchPage[];
  omittedPages: Array<{ pageNumber: number; reason: string }>;
}

export interface OfficeVisualInspectorInput {
  deliveryId: string;
  artifactSha256: string;
  fileName: string;
  format: OfficeDocumentFormat;
  batchId: string;
  pages: OfficeVisualBatchPage[];
}

export type OfficeVisualInspector = (
  input: OfficeVisualInspectorInput,
  signal?: AbortSignal,
) => Promise<readonly OfficeVisualPageAssessment[]>;

export interface OfficeDeliverySettings {
  visualEnabled: boolean;
  visionModelId: string | null;
  maxRepairRounds: number;
  batchPages: number;
  batchMaxBytes: number;
  maxPages: number;
  maxImageBytes: number;
}

export const OFFICE_DELIVERY_SETTINGS_KEY = ["office", "delivery.v1"].join(".");
export const DEFAULT_OFFICE_DELIVERY_SETTINGS: Readonly<OfficeDeliverySettings> = {
  visualEnabled: true,
  visionModelId: null,
  maxRepairRounds: 3,
  batchPages: 12,
  batchMaxBytes: 12 * 1024 * 1024,
  maxPages: 200,
  maxImageBytes: 200 * 1024 * 1024,
};

export function normalizeOfficeDeliverySettings(value: unknown): OfficeDeliverySettings {
  const source =
    value && typeof value === "object" ? (value as Partial<OfficeDeliverySettings>) : {};
  const visionModelId =
    typeof source.visionModelId === "string" && source.visionModelId.trim()
      ? source.visionModelId.trim()
      : null;
  return {
    visualEnabled: source.visualEnabled !== false,
    visionModelId,
    maxRepairRounds:
      Number.isInteger(source.maxRepairRounds) && Number(source.maxRepairRounds) >= 0
        ? Math.min(3, Number(source.maxRepairRounds))
        : DEFAULT_OFFICE_DELIVERY_SETTINGS.maxRepairRounds,
    batchPages:
      Number.isInteger(source.batchPages) && Number(source.batchPages) > 0
        ? Math.min(20, Number(source.batchPages))
        : DEFAULT_OFFICE_DELIVERY_SETTINGS.batchPages,
    batchMaxBytes:
      Number.isInteger(source.batchMaxBytes) && Number(source.batchMaxBytes) > 0
        ? Math.min(20 * 1024 * 1024, Number(source.batchMaxBytes))
        : DEFAULT_OFFICE_DELIVERY_SETTINGS.batchMaxBytes,
    maxPages:
      Number.isInteger(source.maxPages) && Number(source.maxPages) > 0
        ? Math.min(200, Number(source.maxPages))
        : DEFAULT_OFFICE_DELIVERY_SETTINGS.maxPages,
    maxImageBytes:
      Number.isInteger(source.maxImageBytes) && Number(source.maxImageBytes) > 0
        ? Math.min(200 * 1024 * 1024, Number(source.maxImageBytes))
        : DEFAULT_OFFICE_DELIVERY_SETTINGS.maxImageBytes,
  };
}

export interface OfficeDeliveryCheckOptions {
  allowMicrosoftOffice: boolean;
  allowLibreOffice: boolean;
  requiredRender?: boolean;
  requiredVisual?: boolean;
  visualInspector?: OfficeVisualInspector;
  /**
   * Re-evaluates host policy immediately before each renderer or visual-model
   * stage. Policy failures abort the check instead of degrading to a partial
   * document-validation result.
   */
  beforeStage?: (stage: "microsoft_office" | "libreoffice" | "visual") => void | Promise<void>;
  settings?: Partial<OfficeDeliverySettings>;
  visualStartPage?: number;
}

export const MIGRATION_OFFICE_DELIVERY = `
  create table if not exists office_deliveries (
    id text primary key,
    session_id text not null references sessions(id) on delete cascade,
    run_id text,
    artifact_path text not null,
    source_path text,
    evidence_path text,
    evidence_expires_at text,
    pending_batch_json text,
    receipt_json text not null,
    created_at text not null,
    updated_at text not null
  );

  create index if not exists office_deliveries_session_idx
    on office_deliveries(session_id, updated_at desc);
`;
