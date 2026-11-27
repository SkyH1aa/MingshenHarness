import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_OFFICE_DELIVERY_SETTINGS,
  MAX_OFFICE_RENDER_OUTPUT_BYTES,
  normalizeOfficeDeliverySettings,
  type OfficeDeliveryCheckOptions,
  type OfficeDeliveryEngine,
  type OfficeDeliveryFormat,
  type OfficeDeliveryFormulaCoverage,
  type OfficeDeliveryIssue,
  type OfficeDeliveryReceipt,
  type OfficeDeliverySettings,
  type OfficeDeliveryStageName,
  type OfficeDeliveryStageStatus,
  type OfficeDocumentFormat,
  type OfficeVisualBatch,
  type OfficeVisualPageAssessment,
} from "../../shared/office-delivery";
import { extractDocumentBuffer, validateDocumentArchive } from "./document-extractor";
import { readBoundedOfficeFile as readBoundedFile } from "./office-bounded-file";
import {
  executeOfficeDocument,
  inspectSpreadsheetFormulaCoverage,
  type OfficeDocumentResult,
} from "./office-document";

const MAX_DELIVERY_BYTES = 25 * 1024 * 1024;
const EVIDENCE_TTL_MS = 24 * 60 * 60 * 1_000;
const EVIDENCE_CACHE_BYTES = 512 * 1024 * 1024;
const HARD_BATCH_PAGES = 20;
const HARD_BATCH_BYTES = 20 * 1024 * 1024;
const HARD_VISUAL_PAGE_RECORDS = 2_000;
const HARD_VISUAL_BYTES = 200 * 1024 * 1024;
const MAX_RENDER_OUTPUT = 256 * 1024;
const MAX_VISUAL_EVIDENCE_BYTES = MAX_OFFICE_RENDER_OUTPUT_BYTES;
const LIBREOFFICE_TIMEOUT_MS = 90_000;
const PROCESS_TERMINATION_TIMEOUT_MS = 10_000;
const PROCESS_CLOSE_TIMEOUT_MS = 10_000;

const STAGE_NAMES: OfficeDeliveryStageName[] = [
  "package",
  "structure",
  "content",
  "formula",
  "recalculation",
  "render",
  "visual",
];

interface DeliveryRow {
  id: string;
  session_id: string;
  run_id: string | null;
  artifact_path: string;
  source_path: string | null;
  evidence_path: string | null;
  evidence_expires_at: string | null;
  pending_batch_json: string | null;
  receipt_json: string;
  created_at: string;
  updated_at: string;
}

interface PendingVisualBatch {
  batchId: string;
  expected: Array<{ pageNumber: number; pageId: string }>;
  createdAt: string;
}

interface LibreOfficeRenderResult {
  status: "verified" | "unavailable" | "failed";
  message: string;
  pdf?: Buffer;
}

export interface OfficeDeliveryServiceOptions {
  database: DatabaseSync;
  evidenceDirectory: string;
  platform?: NodeJS.Platform;
  libreOfficePath?: string | null;
  now?: () => Date;
  executeOfficeDocument?: typeof executeOfficeDocument;
}

export interface OfficeDeliveryPrepareInput {
  sessionId: string;
  runId?: string | null;
  path: string;
  sourcePath?: string | null;
}

export interface OfficeDeliveryPrepareResult {
  receipt: OfficeDeliveryReceipt;
  duplicate: boolean;
}

export interface OfficeVisualBatchOptions {
  startPage?: number;
  pageLimit?: number;
  maxImageBytes?: number;
}

export interface OfficeVisualBatchRecordInput {
  batchId: string;
  pages: readonly OfficeVisualPageAssessment[];
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function nowIso(now: () => Date): string {
  return now().toISOString();
}

function emptyStages(): Record<OfficeDeliveryStageName, OfficeDeliveryStageStatus> {
  return Object.fromEntries(STAGE_NAMES.map((name) => [name, "not_requested"] as const)) as Record<
    OfficeDeliveryStageName,
    OfficeDeliveryStageStatus
  >;
}

function formatForPath(filePath: string): {
  extension: OfficeDeliveryFormat;
  format: OfficeDocumentFormat;
} {
  const extension = extname(filePath).toLowerCase() as OfficeDeliveryFormat;
  if (![".docx", ".xlsx", ".pptx", ".pdf"].includes(extension))
    throw new Error("Office delivery only supports DOCX, XLSX, PPTX and PDF.");
  return {
    extension,
    format:
      extension === ".docx"
        ? "DOCX"
        : extension === ".xlsx"
          ? "XLSX"
          : extension === ".pptx"
            ? "PPTX"
            : "PDF",
  };
}

function rowToDelivery(row: DeliveryRow | undefined): DeliveryRow {
  if (!row) throw new Error("Office delivery receipt was not found.");
  return row;
}

function parseReceipt(row: DeliveryRow): OfficeDeliveryReceipt {
  const receipt = JSON.parse(row.receipt_json) as OfficeDeliveryReceipt;
  return {
    ...receipt,
    formulaCoverage: receipt.formulaCoverage ?? null,
  };
}

function uniqueIssues(issues: readonly OfficeDeliveryIssue[]): OfficeDeliveryIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\0${issue.stage}\0${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function deriveDeliveryStatus(receipt: OfficeDeliveryReceipt): OfficeDeliveryReceipt["status"] {
  const stages = Object.values(receipt.stages);
  if (stages.includes("blocked")) return "blocked";
  if (receipt.issues.some((issue) => issue.severity === "blocking")) return "blocked";
  if (stages.includes("failed")) return "unverified";
  if (receipt.stages.visual === "partial" || stages.includes("partial")) return "partial";
  if (stages.includes("unavailable") || receipt.stages.visual === "not_requested")
    return "unverified";
  if (
    receipt.stages.package === "verified" &&
    receipt.stages.structure === "verified" &&
    receipt.stages.render === "verified" &&
    receipt.stages.visual === "verified"
  )
    return "verified";
  return "unverified";
}

function strongerFormulaStatus(
  current: OfficeDeliveryStageStatus,
  candidate: OfficeDeliveryStageStatus,
): OfficeDeliveryStageStatus {
  const rank: Record<OfficeDeliveryStageStatus, number> = {
    not_requested: 0,
    verified: 1,
    partial: 2,
    unavailable: 3,
    failed: 4,
    blocked: 5,
  };
  return rank[candidate] > rank[current] ? candidate : current;
}

function isManagedPolicyFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    String(candidate.code ?? "").startsWith("POLICY_") ||
    (typeof candidate.message === "string" && candidate.message.startsWith("POLICY_"))
  );
}

function boundedText(value: string, max = 2_000): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function taskkillExecutable(): string {
  return join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
}

async function terminateOwnedProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) throw new Error("The LibreOffice process did not expose a process ID.");
  const streamsClosed = child.stdout?.closed !== false && child.stderr?.closed !== false;
  if ((child.exitCode !== null || child.signalCode !== null) && streamsClosed) return;
  try {
    if (process.platform === "win32") {
      await new Promise<void>((resolveTermination, rejectTermination) => {
        execFile(
          taskkillExecutable(),
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, timeout: PROCESS_TERMINATION_TIMEOUT_MS },
          (error, _stdout, stderr) => {
            if (error)
              rejectTermination(
                new Error(String(stderr || error.message || error).trim() || "taskkill failed."),
              );
            else resolveTermination();
          },
        );
      });
      return;
    }
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
}

function waitForChildClose(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null && child.stdout?.closed && child.stderr?.closed)
    return Promise.resolve();
  return new Promise((resolveClose, rejectClose) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (timer) clearTimeout(timer);
      child.removeListener("close", onClose);
      if (error) rejectClose(error);
      else resolveClose();
    };
    const onClose = () => finish();
    timer = setTimeout(
      () => finish(new Error(`The LibreOffice process did not close within ${timeoutMs} ms.`)),
      timeoutMs,
    );
    child.once("close", onClose);
  });
}

function detectLibreOfficePath(
  platform: NodeJS.Platform,
  suppliedPath?: string | null,
): string | null {
  if (suppliedPath !== undefined)
    return suppliedPath && existsSync(suppliedPath) ? suppliedPath : null;
  const candidates =
    platform === "win32"
      ? [
          process.env.ProgramFiles
            ? join(process.env.ProgramFiles, "LibreOffice", "program", "soffice.exe")
            : null,
          process.env["ProgramFiles(x86)"]
            ? join(process.env["ProgramFiles(x86)"], "LibreOffice", "program", "soffice.exe")
            : null,
          ...(process.env.PATH ?? "")
            .split(delimiter)
            .filter(Boolean)
            .map((directory) => join(directory, "soffice.exe")),
        ]
      : platform === "darwin"
        ? [
            "/Applications/LibreOffice.app/Contents/MacOS/soffice",
            ...(process.env.PATH ?? "")
              .split(delimiter)
              .filter(Boolean)
              .map((directory) => join(directory, "soffice")),
          ]
        : [
            "/usr/bin/libreoffice",
            "/usr/bin/soffice",
            ...(process.env.PATH ?? "")
              .split(delimiter)
              .filter(Boolean)
              .map((directory) => join(directory, "soffice")),
          ];
  return (
    candidates.find((candidate): candidate is string =>
      Boolean(candidate && existsSync(candidate)),
    ) ?? null
  );
}

async function runLibreOffice(
  executable: string,
  bytes: Buffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<LibreOfficeRenderResult> {
  const root = join(tmpdir(), `mingshen-libreoffice-${randomUUID()}`);
  const inputDirectory = join(root, "input");
  const outputDirectory = join(root, "output");
  const profileDirectory = join(root, "profile");
  mkdirSync(inputDirectory, { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  mkdirSync(profileDirectory, { recursive: true });
  const extension = extname(fileName).toLowerCase();
  const inputPath = join(inputDirectory, `source${extension}`);
  const profileUri = pathToFileURL(profileDirectory).href;
  let child: ChildProcess | null = null;
  let output = "";
  let result: LibreOfficeRenderResult | null = null;
  let thrown: unknown;
  const cleanupDiagnostics: string[] = [];
  const addCleanupDiagnostic = (code: string, error: unknown) => {
    const detail = boundedText(error instanceof Error ? error.message : String(error), 1_000);
    cleanupDiagnostics.push(`${code}: ${detail}`);
  };
  try {
    await writeFile(inputPath, bytes);
    signal?.throwIfAborted();
    const consoleExecutable =
      process.platform === "win32" && basename(executable).toLowerCase() === "soffice.exe"
        ? join(dirname(executable), "soffice.com")
        : executable;
    child = spawn(
      existsSync(consoleExecutable) ? consoleExecutable : executable,
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
        `-env:UserInstallation=${profileUri}`,
        "--convert-to",
        "pdf",
        "--outdir",
        outputDirectory,
        inputPath,
      ],
      {
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          SAL_USE_VCLPLUGIN: "svp",
        },
      },
    );
    const spawned = child;
    const append = (chunk: Buffer) => {
      if (output.length < MAX_RENDER_OUTPUT) output += chunk.toString("utf8");
    };
    spawned.stdout?.on("data", append);
    spawned.stderr?.on("data", append);
    const exit = await new Promise<{ code: number | null; error?: Error }>((done) => {
      let settled = false;
      let stopping = false;
      let resolveClosed: () => void = () => undefined;
      const closedPromise = new Promise<void>((resolveClose) => {
        resolveClosed = resolveClose;
      });
      const finish = (result: { code: number | null; error?: Error }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        done(result);
      };
      const stop = (error: Error) => {
        if (stopping || settled) return;
        stopping = true;
        void (async () => {
          try {
            await terminateOwnedProcessTree(spawned);
            let closeTimer: ReturnType<typeof setTimeout> | undefined;
            try {
              await Promise.race([
                closedPromise,
                new Promise<void>((_resolveTimeout, rejectTimeout) => {
                  closeTimer = setTimeout(
                    () =>
                      rejectTimeout(
                        new Error(
                          `LibreOffice did not close within ${PROCESS_CLOSE_TIMEOUT_MS} ms after process-tree termination.`,
                        ),
                      ),
                    PROCESS_CLOSE_TIMEOUT_MS,
                  );
                }),
              ]);
            } finally {
              if (closeTimer) clearTimeout(closeTimer);
            }
          } catch (cleanupError) {
            addCleanupDiagnostic("LIBREOFFICE_CLEANUP_UNCONFIRMED", cleanupError);
          }
          finish({ code: null, error });
        })();
      };
      const abort = () =>
        stop(signal?.reason instanceof Error ? signal.reason : new Error("Office 验证已取消。"));
      const timer = setTimeout(() => {
        stop(new Error("LibreOffice rendering timed out."));
      }, LIBREOFFICE_TIMEOUT_MS);
      spawned.once("error", (error) => finish({ code: null, error }));
      spawned.once("close", (code) => {
        resolveClosed();
        if (!stopping) finish({ code });
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    if (signal?.aborted)
      throw signal.reason instanceof Error ? signal.reason : new Error("Office 验证已取消。");
    if (exit.error || exit.code !== 0) {
      result = {
        status: exit.error ? "unavailable" : "failed",
        message: boundedText(
          `LibreOffice did not complete PDF rendering: ${
            exit.error?.message ?? `exit code ${exit.code ?? "unknown"}`
          }. ${output}`,
        ),
      };
    } else {
      const pdfName = (await readdir(outputDirectory)).find((name) =>
        name.toLowerCase().endsWith(".pdf"),
      );
      if (!pdfName) {
        result = {
          status: "failed",
          message: boundedText(`LibreOffice did not produce a PDF. ${output}`),
        };
      } else {
        const pdf = await readBoundedFile(
          join(outputDirectory, pdfName),
          "LibreOffice PDF render",
          MAX_VISUAL_EVIDENCE_BYTES,
        );
        if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
          result = { status: "failed", message: "LibreOffice output was not a valid PDF." };
        } else {
          result = {
            status: "verified",
            message: "LibreOffice rendered an isolated temporary copy to PDF.",
            pdf,
          };
        }
      }
    }
  } catch (error) {
    if (signal?.aborted) thrown = signal.reason ?? error;
    else
      result = {
        status: "failed",
        message: boundedText(
          `LibreOffice rendering failed before returning a result: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        await terminateOwnedProcessTree(child);
        await waitForChildClose(child, PROCESS_CLOSE_TIMEOUT_MS);
      } catch (error) {
        addCleanupDiagnostic("LIBREOFFICE_CLEANUP_UNCONFIRMED", error);
      }
    }
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(
      (error) => addCleanupDiagnostic("LIBREOFFICE_TEMP_CLEANUP_UNCONFIRMED", error),
    );
  }
  if (thrown) throw thrown;
  if (!result) {
    return {
      status: "failed",
      message: "LibreOffice rendering did not produce a result.",
    };
  }
  if (cleanupDiagnostics.length) {
    return {
      status: "unavailable",
      message: boundedText(
        `${result.message} ${cleanupDiagnostics.join("; ")}. Inspect and stop the owned LibreOffice process before retrying.`,
        4_000,
      ),
    };
  }
  return result;
}

export class OfficeDeliveryService {
  private readonly database: DatabaseSync;
  private readonly evidenceDirectory: string;
  private readonly platform: NodeJS.Platform;
  private readonly libreOfficePath: string | null;
  private readonly now: () => Date;
  private readonly executeOffice: typeof executeOfficeDocument;

  constructor(options: OfficeDeliveryServiceOptions) {
    this.database = options.database;
    this.evidenceDirectory = resolve(options.evidenceDirectory);
    this.platform = options.platform ?? process.platform;
    this.libreOfficePath = detectLibreOfficePath(this.platform, options.libreOfficePath);
    this.now = options.now ?? (() => new Date());
    this.executeOffice = options.executeOfficeDocument ?? executeOfficeDocument;
    mkdirSync(join(this.evidenceDirectory, "pdf"), { recursive: true });
  }

  async prepare(input: OfficeDeliveryPrepareInput): Promise<OfficeDeliveryPrepareResult> {
    const session = this.database
      .prepare("select 1 from sessions where id = ?")
      .get(input.sessionId);
    if (!session) throw new Error("Office delivery session does not exist.");
    const artifactPath = resolve(input.path);
    const { format } = formatForPath(artifactPath);
    const metadata = await stat(artifactPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error("Office delivery artifact does not exist.");
      throw error;
    });
    if (!metadata.isFile()) throw new Error("Office delivery artifact is not a regular file.");
    if (metadata.size > MAX_DELIVERY_BYTES)
      throw new Error("Office delivery artifacts are limited to 25 MiB.");
    const bytes = await readBoundedFile(
      artifactPath,
      "Office delivery artifact",
      MAX_DELIVERY_BYTES,
    );
    const artifactSha = sha256(bytes);
    const sourcePath = input.sourcePath ? resolve(input.sourcePath) : null;
    if (sourcePath) {
      const sourceMetadata = await stat(sourcePath);
      if (!sourceMetadata.isFile() || sourceMetadata.size > MAX_DELIVERY_BYTES)
        throw new Error("Office delivery source is not a supported regular file.");
    }
    const idempotencySuffix = `${input.sessionId}\0${input.runId ?? ""}\0${artifactPath}\0${sourcePath ?? ""}\0${artifactSha}`;
    const id = createHash("sha256").update(idempotencySuffix).digest("hex");
    const existing = this.database
      .prepare("select * from office_deliveries where id = ?")
      .get(id) as DeliveryRow | undefined;
    if (existing) {
      const receipt = parseReceipt(rowToDelivery(existing));
      return { receipt: await this.withCurrentStatus(existing, receipt), duplicate: true };
    }
    const sourceBytes = sourcePath
      ? await readBoundedFile(sourcePath, "Office delivery source", MAX_DELIVERY_BYTES)
      : null;
    const timestamp = nowIso(this.now);
    const receipt: OfficeDeliveryReceipt = {
      id,
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      fileName: basename(artifactPath),
      format,
      size: bytes.length,
      sha256: artifactSha,
      source:
        sourcePath && sourceBytes
          ? {
              fileName: basename(sourcePath),
              size: sourceBytes.length,
              sha256: sha256(sourceBytes),
            }
          : null,
      status: "unverified",
      stages: emptyStages(),
      engine: "none",
      structuralSummary: "",
      formulaCoverage: null,
      issues: [],
      unverified: ["Office delivery has not been checked."],
      repairSuggestions: [],
      visual: {
        totalPages: null,
        inspectedPages: 0,
        complete: false,
        batchCount: 0,
        pageNumbers: [],
        modelId: null,
      },
      evidence: { pdfSha256: null, pdfBytes: 0, cachedUntil: null },
      checkedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 0,
    };
    this.database
      .prepare(
        `insert into office_deliveries (
          id, session_id, run_id, artifact_path, source_path, receipt_json, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.runId ?? null,
        artifactPath,
        sourcePath,
        JSON.stringify(receipt),
        timestamp,
        timestamp,
      );
    return { receipt, duplicate: false };
  }

  async check(
    deliveryId: string,
    options: OfficeDeliveryCheckOptions,
    signal?: AbortSignal,
  ): Promise<OfficeDeliveryReceipt> {
    const row = this.getRow(deliveryId);
    const receipt = parseReceipt(row);
    const bytes = await this.readCurrentArtifact(row, receipt);
    if (!bytes) return this.withCurrentStatus(row, receipt);
    const settings = normalizeOfficeDeliverySettings({
      ...DEFAULT_OFFICE_DELIVERY_SETTINGS,
      ...options.settings,
    });
    const continuation = (options.visualStartPage ?? 1) > 1;
    if (!continuation) {
      receipt.stages = emptyStages();
      receipt.engine = "none";
      receipt.structuralSummary = "";
      receipt.formulaCoverage = null;
      receipt.issues = [];
      receipt.unverified = [];
      receipt.repairSuggestions = [];
      receipt.visual = {
        totalPages: null,
        inspectedPages: 0,
        complete: false,
        batchCount: 0,
        pageNumbers: [],
        modelId: null,
      };
      receipt.evidence = { pdfSha256: null, pdfBytes: 0, cachedUntil: null };
      row.evidence_path = null;
      row.evidence_expires_at = null;
      row.pending_batch_json = null;
    }
    receipt.visual.modelId = settings.visionModelId;
    receipt.checkedAt = nowIso(this.now);

    const { extension, format } = formatForPath(row.artifact_path);
    let renderedPdf: Buffer | null = null;
    let renderEngine: OfficeDeliveryEngine = "none";

    if (extension === ".pdf") {
      try {
        await this.inspectPdf(bytes, row.artifact_path, receipt, signal);
        renderedPdf = bytes;
        renderEngine = "source_pdf";
        receipt.stages.render = "verified";
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        this.block(receipt, "PDF_PACKAGE_INVALID", "package", error);
        return await this.persistAfterCurrentRecheck(row, receipt, null);
      }
    } else {
      try {
        await validateDocumentArchive(bytes);
        receipt.stages.package = "verified";
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        this.block(receipt, "OFFICE_PACKAGE_INVALID", "package", error);
        return await this.persistAfterCurrentRecheck(row, receipt, null);
      }

      let officeResult: OfficeDocumentResult | null = null;
      try {
        if (options.allowMicrosoftOffice) await options.beforeStage?.("microsoft_office");
        signal?.throwIfAborted();
        officeResult = await this.executeOffice(
          {
            operation: "verify",
            path: basename(row.artifact_path),
            render: true,
            recalculate: extension === ".xlsx",
            timeout_ms: 90_000,
          },
          new Map([[basename(row.artifact_path), bytes]]),
          signal,
          { canUseOffice: options.allowMicrosoftOffice },
        );
        signal?.throwIfAborted();
        const structureVerified = officeResult.output.includes("结构通过");
        receipt.stages.structure =
          officeResult.structureCheck?.structure ??
          (structureVerified
            ? officeResult.verification?.status === "partial"
              ? "partial"
              : "verified"
            : "failed");
        receipt.stages.content =
          officeResult.structureCheck?.content ?? (structureVerified ? "verified" : "unavailable");
        receipt.structuralSummary = boundedText(officeResult.output, 8_000);
        for (const warning of officeResult.warnings) {
          const reps = this.classifyWarning(warning);
          receipt.issues.push(...reps.issues);
          receipt.repairSuggestions.push(...reps.repairs);
          if (warning.startsWith("FORMULA_ERRORS:")) receipt.stages.formula = "failed";
          else if (
            warning.startsWith("FORMULA_CACHE_INCOMPLETE:") ||
            warning.startsWith("FORMULA_VERIFICATION_PARTIAL:")
          )
            receipt.stages.formula = "partial";
        }
        if (extension === ".xlsx") {
          const formulaCoverage = await inspectSpreadsheetFormulaCoverage(bytes);
          const recalculationVerified = officeResult?.verification?.recalculation === "verified";
          const receiptFormulaCoverage: OfficeDeliveryFormulaCoverage = {
            complete: formulaCoverage.complete,
            inspectedCells: formulaCoverage.inspectedCells,
            formulas: formulaCoverage.formulas,
            uncachedFormulas: formulaCoverage.uncachedFormulas,
            errors: formulaCoverage.errors,
            sampleLimit: formulaCoverage.sampleLimit,
            samples: formulaCoverage.samples,
          };
          receipt.formulaCoverage = receiptFormulaCoverage;
          const coverageStatus: OfficeDeliveryStageStatus =
            formulaCoverage.errors > 0
              ? "failed"
              : formulaCoverage.uncachedFormulas > 0 || !formulaCoverage.complete
                ? "partial"
                : recalculationVerified
                  ? "verified"
                  : formulaCoverage.formulas > 0
                    ? "partial"
                    : "verified";
          receipt.stages.formula = strongerFormulaStatus(receipt.stages.formula, coverageStatus);
          if (
            formulaCoverage.formulas > 0 &&
            formulaCoverage.errors === 0 &&
            !recalculationVerified
          )
            receipt.unverified.push(
              "Workbook formula caches were inspected but not proven to come from a full calculation engine.",
            );
          if (!formulaCoverage.complete)
            receipt.issues.push({
              code: "FORMULA_SCAN_BUDGET_REACHED",
              stage: "formula",
              severity: "warning",
              message: `Formula scanning reached the ${formulaCoverage.inspectedCells}-cell safety budget.`,
              repairable: false,
            });
        }
        receipt.stages.recalculation =
          extension === ".xlsx"
            ? (officeResult.verification?.recalculation ?? "unavailable")
            : "not_requested";
        if (officeResult.rendition?.bytes) {
          renderedPdf = officeResult.rendition.bytes;
          renderEngine = "microsoft_office";
          receipt.stages.render = "verified";
        } else {
          receipt.stages.render = "unavailable";
          if (officeResult.warnings.some((warning) => /Office|COM|隔离|权限/i.test(warning)))
            receipt.unverified.push(
              "Microsoft Office did not return PDF render evidence; no visual approval is implied.",
            );
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (isManagedPolicyFailure(error)) throw error;
        this.block(receipt, "OFFICE_STRUCTURE_INVALID", "structure", error);
        return await this.persistAfterCurrentRecheck(row, receipt, null);
      }

      if (!renderedPdf && options.allowLibreOffice && this.libreOfficePath) {
        await options.beforeStage?.("libreoffice");
        signal?.throwIfAborted();
        const libre = await runLibreOffice(
          this.libreOfficePath,
          bytes,
          basename(row.artifact_path),
          signal,
        );
        if (libre.status === "verified" && libre.pdf) {
          renderedPdf = libre.pdf;
          renderEngine = "libreoffice";
          receipt.stages.render = "verified";
          receipt.stages.recalculation = extension === ".xlsx" ? "unavailable" : "not_requested";
          receipt.unverified.push(
            extension === ".xlsx"
              ? "LibreOffice rendered the workbook, but Microsoft Excel parity and cached formula results were not verified."
              : "LibreOffice rendered the document, but Microsoft Office layout parity was not verified.",
          );
        } else {
          receipt.issues.push({
            code: "LIBREOFFICE_RENDER_UNAVAILABLE",
            stage: "render",
            severity: "warning",
            message: libre.message,
            repairable: false,
          });
        }
      }
      if (format === "XLSX" && receipt.stages.formula === "not_requested")
        receipt.stages.formula = "unavailable";
    }

    if (!renderedPdf && options.requiredRender) {
      receipt.stages.render = "blocked";
      receipt.issues.push({
        code: "RENDER_REQUIRED",
        stage: "render",
        severity: "blocking",
        message:
          "This policy requires rendered PDF evidence, but no supported renderer produced it.",
        repairable: false,
      });
    }

    signal?.throwIfAborted();
    receipt.engine = renderEngine;
    if (renderedPdf) {
      row.evidence_path = await this.cachePdf(deliveryId, renderedPdf);
      const expiresAt = new Date(this.now().getTime() + EVIDENCE_TTL_MS).toISOString();
      row.evidence_expires_at = expiresAt;
      receipt.evidence = {
        pdfSha256: sha256(renderedPdf),
        pdfBytes: renderedPdf.length,
        cachedUntil: expiresAt,
      };
      await this.pruneEvidenceCache();
      Object.assign(
        receipt,
        await this.persistAfterCurrentRecheck(row, receipt, row.evidence_path),
      );
      if (receipt.status === "stale") return receipt;
    } else {
      row.evidence_path = null;
      row.evidence_expires_at = null;
      receipt.evidence = { pdfSha256: null, pdfBytes: 0, cachedUntil: null };
      receipt.stages.visual = "unavailable";
      receipt.unverified.push("No rendered PDF evidence is available for visual inspection.");
    }

    if (
      renderedPdf &&
      settings.visualEnabled &&
      options.visualInspector &&
      (receipt.stages.render === "verified" || receipt.engine === "source_pdf")
    ) {
      await this.runVisualInspection(
        receipt,
        settings,
        options.visualInspector,
        options.visualStartPage ?? 1,
        signal,
        options.beforeStage,
      );
    } else if (renderedPdf) {
      receipt.stages.visual = "unavailable";
      receipt.unverified.push(
        settings.visualEnabled
          ? "Visual inspection was not run because no vision-capable inspector was available."
          : "Visual inspection is disabled in Office delivery settings.",
      );
    }

    if (options.requiredVisual && receipt.stages.visual !== "verified") {
      receipt.stages.visual = "blocked";
      receipt.issues.push({
        code: "VISUAL_REVIEW_REQUIRED",
        stage: "visual",
        severity: "blocking",
        message: "This policy requires complete page-level visual evidence.",
        repairable: false,
      });
    }
    signal?.throwIfAborted();
    if (receipt.stages.formula === "failed")
      receipt.repairSuggestions.push(
        "Fix workbook formulas or referenced inputs, then verify again.",
      );
    if (receipt.stages.recalculation === "failed")
      receipt.repairSuggestions.push(
        "Repair formula calculation failures and recalculate an isolated copy.",
      );
    receipt.issues = uniqueIssues(receipt.issues);
    receipt.unverified = uniqueStrings(receipt.unverified);
    receipt.repairSuggestions = uniqueStrings(receipt.repairSuggestions);
    receipt.visual.complete =
      receipt.visual.totalPages !== null &&
      receipt.visual.totalPages > 0 &&
      receipt.visual.pageNumbers.length === receipt.visual.totalPages &&
      receipt.visual.inspectedPages === receipt.visual.totalPages;
    receipt.status = deriveDeliveryStatus(receipt);
    return await this.persistAfterCurrentRecheck(
      row,
      receipt,
      renderedPdf ? row.evidence_path : null,
    );
  }

  async createVisualBatch(
    deliveryId: string,
    options: OfficeVisualBatchOptions = {},
    signal?: AbortSignal,
  ): Promise<OfficeVisualBatch> {
    const row = this.getRow(deliveryId);
    const receipt = parseReceipt(row);
    if (!(await this.readCurrentArtifact(row, receipt)))
      throw new Error(
        "Office delivery artifact changed; prepare a new receipt before visual review.",
      );
    if (!row.evidence_path || !existsSync(row.evidence_path))
      throw new Error("Rendered PDF evidence is unavailable. Run Office delivery checks again.");
    if (row.evidence_expires_at && Date.parse(row.evidence_expires_at) <= this.now().getTime())
      throw new Error("Rendered PDF evidence expired. Run Office delivery checks again.");
    const startPage = Math.max(1, Math.floor(options.startPage ?? 1));
    const pageLimit = Math.max(1, Math.min(HARD_BATCH_PAGES, Math.floor(options.pageLimit ?? 12)));
    const maxImageBytes = Math.max(
      1,
      Math.min(HARD_BATCH_BYTES, Math.floor(options.maxImageBytes ?? 12 * 1024 * 1024)),
    );
    const pdf = await readBoundedFile(
      row.evidence_path,
      "Cached Office delivery PDF evidence",
      MAX_VISUAL_EVIDENCE_BYTES,
    );
    if (
      !receipt.evidence.pdfSha256 ||
      receipt.evidence.pdfBytes !== pdf.length ||
      sha256(pdf) !== receipt.evidence.pdfSha256
    )
      throw new Error(
        "Cached Office delivery PDF evidence failed its size or SHA-256 integrity check.",
      );
    const result = await extractDocumentBuffer(pdf, "office-delivery.pdf", signal, "vision", {
      startPage,
      pageLimit,
      maxImageBytes,
    });
    const pages = (result.pageImages ?? []).flatMap((page) =>
      page.pageId && typeof page.bytes === "number"
        ? [
            {
              pageNumber: page.page,
              pageId: page.pageId,
              dataUrl: page.dataUrl,
              bytes: page.bytes,
            },
          ]
        : [],
    );
    if (!pages.length)
      throw new Error("No pages could be rendered for the requested visual batch.");
    const totalPages = result.pdf?.totalPages ?? null;
    const lastRequested = totalPages
      ? Math.min(totalPages, startPage + pageLimit - 1)
      : startPage + pageLimit - 1;
    const renderedNumbers = new Set(pages.map((page) => page.pageNumber));
    const omittedPages = [];
    for (let pageNumber = startPage; pageNumber <= lastRequested; pageNumber++)
      if (!renderedNumbers.has(pageNumber))
        omittedPages.push({
          pageNumber,
          reason: boundedText(
            result.warnings.find((warning) => warning.includes(`page ${pageNumber}`)) ??
              "Page image was omitted by the bounded renderer budget.",
            400,
          ),
        });
    for (const omitted of omittedPages)
      receipt.issues.push({
        code: "OFFICE_VISUAL_PAGE_OMITTED",
        stage: "visual",
        severity: "warning",
        message: `Page ${omitted.pageNumber} was not rendered: ${omitted.reason}`,
        repairable: false,
      });
    if (omittedPages.length) receipt.stages.visual = "partial";
    const batchId = randomUUID();
    const pending: PendingVisualBatch = {
      batchId,
      expected: pages.map(({ pageNumber, pageId }) => ({ pageNumber, pageId })),
      createdAt: nowIso(this.now),
    };
    row.pending_batch_json = JSON.stringify(pending);
    receipt.visual.totalPages = totalPages;
    receipt.revision += 1;
    receipt.updatedAt = nowIso(this.now);
    const persisted = await this.persistAfterCurrentRecheck(row, receipt, row.evidence_path);
    if (persisted.status === "stale")
      throw new Error("Office delivery artifact changed while rendering the visual batch.");
    return {
      batchId,
      deliveryId,
      artifactSha256: receipt.sha256,
      pages,
      omittedPages,
    };
  }

  async recordVisualBatch(
    deliveryId: string,
    input: OfficeVisualBatchRecordInput,
  ): Promise<OfficeDeliveryReceipt> {
    const row = this.getRow(deliveryId);
    const receipt = parseReceipt(row);
    if (!(await this.readCurrentArtifact(row, receipt)))
      throw new Error("Office delivery artifact changed; visual results are stale.");
    const pending = row.pending_batch_json
      ? (JSON.parse(row.pending_batch_json) as PendingVisualBatch)
      : null;
    if (!pending || pending.batchId !== input.batchId)
      throw new Error("The visual batch is missing or no longer pending.");
    const expected = new Map(pending.expected.map((page) => [page.pageNumber, page.pageId]));
    if (input.pages.length !== expected.size)
      throw new Error("Visual results must cover every requested page exactly once.");
    const seen = new Set<number>();
    for (const page of input.pages) {
      if (
        !Number.isInteger(page.pageNumber) ||
        !expected.has(page.pageNumber) ||
        expected.get(page.pageNumber) !== page.pageId ||
        seen.has(page.pageNumber)
      )
        throw new Error("Visual results contain a missing, duplicate or unrequested page.");
      if (!["pass", "issue", "inconclusive"].includes(page.status))
        throw new Error("Visual result contains an unsupported page status.");
      if ((page.issues?.length ?? 0) > 30 || (page.summary?.length ?? 0) > 2_000)
        throw new Error("Visual result exceeds the bounded evidence schema.");
      seen.add(page.pageNumber);
    }
    const pageNumbers = new Set(receipt.visual.pageNumbers);
    for (const page of input.pages) {
      pageNumbers.add(page.pageNumber);
      if (page.status === "issue") {
        receipt.issues.push({
          code: "OFFICE_VISUAL_ISSUE",
          stage: "visual",
          severity: page.severity === "error" ? "error" : "warning",
          message: boundedText(
            `Page ${page.pageNumber}: ${
              page.issues?.join("; ") || page.summary || "Visual issue reported."
            }`,
          ),
          repairable: true,
        });
        receipt.repairSuggestions.push(
          `Repair the reported layout, overflow, clipping or content issue on page ${page.pageNumber}, then verify a new artifact.`,
        );
      } else if (page.status === "inconclusive") {
        receipt.issues.push({
          code: "OFFICE_VISUAL_INCONCLUSIVE",
          stage: "visual",
          severity: "warning",
          message: boundedText(
            `Page ${page.pageNumber}: ${page.summary || "Visual result was inconclusive."}`,
          ),
          repairable: false,
        });
      }
    }
    receipt.visual.pageNumbers = [...pageNumbers].sort((a, b) => a - b);
    receipt.visual.inspectedPages = receipt.visual.pageNumbers.length;
    receipt.visual.batchCount += 1;
    receipt.visual.complete =
      receipt.visual.totalPages !== null &&
      receipt.visual.totalPages > 0 &&
      receipt.visual.inspectedPages === receipt.visual.totalPages;
    if (receipt.visual.complete)
      receipt.issues = receipt.issues.filter(
        (issue) => issue.code !== "OFFICE_VISUAL_PAGE_OMITTED",
      );
    const hasIssue =
      input.pages.some((page) => page.status !== "pass") ||
      receipt.issues.some(
        (issue) =>
          issue.stage === "visual" &&
          (issue.code === "OFFICE_VISUAL_ISSUE" || issue.code === "OFFICE_VISUAL_INCONCLUSIVE"),
      );
    receipt.stages.render = "verified";
    receipt.stages.visual = receipt.visual.complete
      ? hasIssue
        ? "partial"
        : "verified"
      : "partial";
    receipt.status = deriveDeliveryStatus(receipt);
    receipt.issues = uniqueIssues(receipt.issues);
    receipt.repairSuggestions = uniqueStrings(receipt.repairSuggestions);
    row.pending_batch_json = null;
    const persisted = await this.persistAfterCurrentRecheck(row, receipt, row.evidence_path);
    if (persisted.status === "stale")
      throw new Error("Office delivery artifact changed while recording visual results.");
    return persisted;
  }

  async get(deliveryId: string): Promise<OfficeDeliveryReceipt> {
    const row = this.getRow(deliveryId);
    return this.withCurrentStatus(row, parseReceipt(row));
  }

  async list(sessionId: string, limit = 20): Promise<OfficeDeliveryReceipt[]> {
    const rows = this.database
      .prepare(
        "select * from office_deliveries where session_id = ? order by updated_at desc limit ?",
      )
      .all(sessionId, Math.max(1, Math.min(100, Math.floor(limit)))) as unknown as DeliveryRow[];
    return Promise.all(rows.map((row) => this.withCurrentStatus(row, parseReceipt(row))));
  }

  async cleanupEvidenceCache(): Promise<void> {
    await this.pruneEvidenceCache();
  }

  private getRow(deliveryId: string): DeliveryRow {
    return rowToDelivery(
      this.database.prepare("select * from office_deliveries where id = ?").get(deliveryId) as
        | DeliveryRow
        | undefined,
    );
  }

  private async readCurrentArtifact(
    row: DeliveryRow,
    receipt: OfficeDeliveryReceipt,
  ): Promise<Buffer | null> {
    try {
      const bytes = await readBoundedFile(
        row.artifact_path,
        "Office delivery artifact",
        MAX_DELIVERY_BYTES,
      );
      if (sha256(bytes) !== receipt.sha256) return null;
      if (row.source_path && receipt.source) {
        const source = await readBoundedFile(
          row.source_path,
          "Office delivery source",
          MAX_DELIVERY_BYTES,
        );
        if (source.length !== receipt.source.size || sha256(source) !== receipt.source.sha256)
          return null;
      }
      return bytes;
    } catch {
      return null;
    }
  }

  private async withCurrentStatus(
    row: DeliveryRow,
    receipt: OfficeDeliveryReceipt,
  ): Promise<OfficeDeliveryReceipt> {
    if (await this.readCurrentArtifact(row, receipt)) return receipt;
    return {
      ...receipt,
      status: "stale",
      unverified: uniqueStrings([
        ...receipt.unverified,
        "The artifact or receipt changed after verification; run a new delivery check.",
      ]),
    };
  }

  private async inspectPdf(
    bytes: Buffer,
    filePath: string,
    receipt: OfficeDeliveryReceipt,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new Error("PDF signature is missing.");
    const result = await extractDocumentBuffer(bytes, filePath, signal, "native");
    if (!result.pdf) throw new Error("PDF parser did not return page metadata.");
    receipt.stages.package = "verified";
    receipt.stages.structure = "verified";
    receipt.stages.content = result.warnings.some((warning) => /truncated|covers/i.test(warning))
      ? "partial"
      : "verified";
    receipt.stages.formula = "not_requested";
    receipt.stages.recalculation = "not_requested";
    receipt.visual.totalPages = result.pdf.totalPages;
    receipt.structuralSummary = `PDF structure parsed: ${result.pdf.totalPages} pages; text inspection covered ${result.pdf.inspectedPages} pages.`;
    for (const warning of result.warnings)
      receipt.issues.push({
        code: "PDF_CONTENT_PARTIAL",
        stage: "content",
        severity: "warning",
        message: boundedText(warning),
        repairable: false,
      });
  }

  private block(
    receipt: OfficeDeliveryReceipt,
    code: string,
    stage: OfficeDeliveryStageName,
    error: unknown,
  ): void {
    receipt.status = "blocked";
    receipt.stages[stage] = "blocked";
    receipt.issues.push({
      code,
      stage,
      severity: "blocking",
      message: boundedText(error instanceof Error ? error.message : String(error)),
      repairable: false,
    });
    receipt.unverified = uniqueStrings([
      ...receipt.unverified,
      "A damaged, unsafe or unparseable artifact was not accepted as delivered.",
    ]);
  }

  private classifyWarning(warning: string): {
    issues: OfficeDeliveryIssue[];
    repairs: string[];
  } {
    if (warning.startsWith("FORMULA_ERRORS:"))
      return {
        issues: [
          {
            code: "FORMULA_ERRORS",
            stage: "formula",
            severity: "error",
            message: boundedText(warning),
            repairable: true,
          },
        ],
        repairs: ["Repair formula error values and recalculate the workbook."],
      };
    if (
      warning.startsWith("FORMULA_CACHE_INCOMPLETE:") ||
      warning.startsWith("FORMULA_VERIFICATION_PARTIAL:")
    )
      return {
        issues: [
          {
            code: "FORMULA_VERIFICATION_PARTIAL",
            stage: "formula",
            severity: "warning",
            message: boundedText(warning),
            repairable: false,
          },
        ],
        repairs: [],
      };
    return { issues: [], repairs: [] };
  }

  private async cachePdf(deliveryId: string, pdf: Buffer): Promise<string> {
    if (pdf.length > MAX_VISUAL_EVIDENCE_BYTES)
      throw new Error(
        `Rendered PDF evidence exceeds the ${MAX_VISUAL_EVIDENCE_BYTES}-byte read limit.`,
      );
    const pdfSha = sha256(pdf);
    const destination = join(this.evidenceDirectory, "pdf", `${deliveryId}-${pdfSha}.pdf`);
    if (!existsSync(destination)) {
      const temporary = `${destination}.writing-${randomUUID()}`;
      await writeFile(temporary, pdf);
      await rename(temporary, destination).catch(async (error) => {
        await unlink(temporary).catch(() => undefined);
        if (!existsSync(destination)) throw error;
      });
    }
    return destination;
  }

  private async pruneEvidenceCache(): Promise<void> {
    const directory = join(this.evidenceDirectory, "pdf");
    const entries = await readdir(directory).catch(() => []);
    const files = (
      await Promise.all(
        entries.map(async (name) => {
          const path = join(directory, name);
          const metadata = await stat(path).catch(() => null);
          return metadata?.isFile()
            ? { path, size: metadata.size, modified: metadata.mtimeMs }
            : null;
        }),
      )
    ).filter((entry): entry is { path: string; size: number; modified: number } => Boolean(entry));
    const cutoff = this.now().getTime() - EVIDENCE_TTL_MS;
    for (const file of files.filter((entry) => entry.modified < cutoff))
      await unlink(file.path).catch(() => undefined);
    const retained = files
      .filter((entry) => entry.modified >= cutoff)
      .sort((left, right) => right.modified - left.modified);
    let total = 0;
    for (const file of retained) {
      total += file.size;
      if (total > EVIDENCE_CACHE_BYTES) await unlink(file.path).catch(() => undefined);
    }
  }

  private async runVisualInspection(
    receipt: OfficeDeliveryReceipt,
    settings: OfficeDeliverySettings,
    inspector: NonNullable<OfficeDeliveryCheckOptions["visualInspector"]>,
    requestedStart: number,
    signal?: AbortSignal,
    beforeStage?: OfficeDeliveryCheckOptions["beforeStage"],
  ): Promise<void> {
    let totalPages = receipt.visual.totalPages;
    const start = Math.max(
      1,
      totalPages ? Math.min(totalPages, Math.floor(requestedStart)) : Math.floor(requestedStart),
    );
    const pageWindowEnd = start + settings.maxPages - 1;
    let nextPage = start;
    const imageBudget = Math.min(settings.maxImageBytes, HARD_VISUAL_BYTES);
    let imageBytes = 0;
    try {
      while (totalPages === null || nextPage <= Math.min(totalPages, pageWindowEnd)) {
        signal?.throwIfAborted();
        await beforeStage?.("visual");
        signal?.throwIfAborted();
        const remainingPages =
          totalPages === null
            ? settings.batchPages
            : Math.min(settings.batchPages, Math.min(totalPages, pageWindowEnd) - nextPage + 1);
        const batch = await this.createVisualBatch(
          receipt.id,
          {
            startPage: nextPage,
            pageLimit: remainingPages,
            maxImageBytes: Math.min(settings.batchMaxBytes, imageBudget - imageBytes),
          },
          signal,
        );
        const refreshed = await this.get(receipt.id);
        totalPages = refreshed.visual.totalPages;
        Object.assign(receipt, refreshed);
        if (!totalPages) {
          receipt.stages.visual = "unavailable";
          receipt.unverified.push("Rendered PDF page count is unavailable.");
          return;
        }
        imageBytes += batch.pages.reduce((sum, item) => sum + item.bytes, 0);
        await beforeStage?.("visual");
        signal?.throwIfAborted();
        const assessments = await inspector(
          {
            deliveryId: receipt.id,
            artifactSha256: receipt.sha256,
            fileName: receipt.fileName,
            format: receipt.format,
            batchId: batch.batchId,
            pages: batch.pages,
          },
          signal,
        );
        const updated = await this.recordVisualBatch(receipt.id, {
          batchId: batch.batchId,
          pages: assessments,
        });
        Object.assign(receipt, updated);
        if (imageBytes >= imageBudget) {
          receipt.issues.push({
            code: "VISUAL_IMAGE_BUDGET_REACHED",
            stage: "visual",
            severity: "warning",
            message:
              "The per-file rendered-image budget was reached; later pages remain unverified.",
            repairable: false,
          });
          receipt.stages.visual = "partial";
          break;
        }
        nextPage += settings.batchPages;
      }
      receipt.visual.complete =
        receipt.visual.inspectedPages === totalPages &&
        receipt.visual.pageNumbers.length === totalPages;
      if (!receipt.visual.complete)
        receipt.unverified.push(
          `Visual review covered ${receipt.visual.inspectedPages} of ${totalPages} pages.`,
        );
    } catch (error) {
      if (isManagedPolicyFailure(error)) throw error;
      if (signal?.aborted) throw signal.reason ?? error;
      receipt.stages.visual = "partial";
      receipt.issues.push({
        code: "VISUAL_INSPECTION_FAILED",
        stage: "visual",
        severity: "warning",
        message: boundedText(error instanceof Error ? error.message : String(error)),
        repairable: false,
      });
      receipt.unverified.push("Visual review did not finish for every requested page.");
    }
  }

  private staleDeliveryReceipt(
    receipt: OfficeDeliveryReceipt,
    message = "The artifact or recorded source changed during Office delivery verification.",
  ): OfficeDeliveryReceipt {
    return {
      ...receipt,
      status: "stale",
      issues: uniqueIssues([
        ...receipt.issues,
        {
          code: "OFFICE_DELIVERY_CHANGED_DURING_CHECK",
          stage: "package",
          severity: "blocking",
          message,
          repairable: false,
        },
      ]),
      unverified: uniqueStrings([
        ...receipt.unverified,
        "No verification result was accepted for the changed artifact or source.",
      ]),
    };
  }

  private async persistAfterCurrentRecheck(
    row: DeliveryRow,
    receipt: OfficeDeliveryReceipt,
    evidencePath: string | null,
  ): Promise<OfficeDeliveryReceipt> {
    if (!(await this.readCurrentArtifact(row, receipt))) return this.staleDeliveryReceipt(receipt);
    const persisted = this.persist(row, receipt, evidencePath);
    return (await this.readCurrentArtifact(row, persisted))
      ? persisted
      : this.staleDeliveryReceipt(
          persisted,
          "The artifact or recorded source changed while the Office delivery result was being persisted.",
        );
  }

  private persist(
    row: DeliveryRow,
    receipt: OfficeDeliveryReceipt,
    evidencePath: string | null,
  ): OfficeDeliveryReceipt {
    const timestamp = nowIso(this.now);
    const pageNumbers = [...new Set(receipt.visual.pageNumbers)]
      .sort((left, right) => left - right)
      .slice(0, HARD_VISUAL_PAGE_RECORDS);
    const next = {
      ...receipt,
      updatedAt: timestamp,
      revision: receipt.revision + 1,
      visual: {
        ...receipt.visual,
        pageNumbers,
        complete:
          receipt.visual.totalPages !== null &&
          receipt.visual.totalPages > 0 &&
          pageNumbers.length === receipt.visual.totalPages,
      },
      issues: uniqueIssues(receipt.issues),
      unverified: uniqueStrings(receipt.unverified),
      repairSuggestions: uniqueStrings(receipt.repairSuggestions),
    };
    next.status = deriveDeliveryStatus(next);
    this.database
      .prepare(
        `update office_deliveries set
          run_id = ?, source_path = ?, evidence_path = ?, evidence_expires_at = ?,
          pending_batch_json = ?, receipt_json = ?, updated_at = ?
        where id = ?`,
      )
      .run(
        next.runId,
        row.source_path,
        evidencePath ?? row.evidence_path,
        row.evidence_expires_at,
        row.pending_batch_json,
        JSON.stringify(next),
        timestamp,
        next.id,
      );
    row.receipt_json = JSON.stringify(next);
    row.updated_at = timestamp;
    row.pending_batch_json =
      row.pending_batch_json && receipt.status !== "stale" ? row.pending_batch_json : null;
    row.evidence_path = evidencePath ?? row.evidence_path;
    return next;
  }
}
