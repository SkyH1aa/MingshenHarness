import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { fromBuffer } from "yauzl";

const DOCUMENT_EXTENSIONS = new Set([".doc", ".docx", ".pdf", ".xlsx", ".xls", ".pptx", ".odt"]);
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 4_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024;

export type PdfReadMode = "native" | "vision" | "ocr";

export interface PdfExtractionOptions {
  startPage?: number;
  pageLimit?: number;
  maxImageBytes?: number;
}

export interface DocumentExtractionResult {
  format: string;
  text: string;
  warnings: string[];
  pdf?: {
    totalPages: number;
    inspectedPages: number;
    ocrPages: number;
    firstPage?: number;
    lastPage?: number;
  };
  pageImages?: Array<{ page: number; pageId?: string; bytes?: number; dataUrl: string }>;
}

export function isDocumentPath(filePath: string): boolean {
  return DOCUMENT_EXTENSIONS.has(extname(filePath).toLowerCase());
}

let activeWorkers = 0;
const waiters = new Set<() => void>();

async function extractInWorker(
  bytes: Buffer,
  extension: string,
  signal?: AbortSignal,
  mode: PdfReadMode = "ocr",
  pdfOptions: PdfExtractionOptions = {},
): Promise<DocumentExtractionResult> {
  signal?.throwIfAborted();
  while (activeWorkers >= 2) {
    await new Promise<void>((done, reject) => {
      const wake = () => {
        cleanup();
        done();
      };
      const abort = () => {
        cleanup();
        reject(signal?.reason);
      };
      const cleanup = () => {
        waiters.delete(wake);
        signal?.removeEventListener("abort", abort);
      };
      waiters.add(wake);
      signal?.addEventListener("abort", abort, { once: true });
    });
    signal?.throwIfAborted();
  }
  activeWorkers++;
  let languageDirectory: string | undefined;
  try {
    if (extension === ".pdf" && mode === "ocr")
      languageDirectory = await mkdtemp(join(tmpdir(), "mingshen-ocr-languages-"));
    signal?.throwIfAborted();
    const currentFile = fileURLToPath(import.meta.url);
    const roots =
      process.resourcesPath && existsSync(join(process.resourcesPath, "app.asar"))
        ? [join(process.resourcesPath, "documents")]
        : [
            resolve(currentFile, "../../resources/documents"),
            resolve(currentFile, "../../../resources/documents"),
            resolve(currentFile, "../../../../resources/documents"),
          ];
    const script = roots.map((root) => join(root, "document-worker.cjs")).find(existsSync);
    if (!script) throw new Error("Bundled document worker is missing. Reinstall the application.");
    const appRequire = createRequire(import.meta.url);
    const moduleBase = appRequire.resolve("mammoth/package.json");
    return await new Promise<DocumentExtractionResult>((done, reject) => {
      const worker = new Worker(script, {
        workerData: {
          bytes,
          extension,
          mode,
          moduleBase,
          languageDirectory,
          pdfStartPage: pdfOptions.startPage,
          pdfPageLimit: pdfOptions.pageLimit,
          pdfMaxImageBytes: pdfOptions.maxImageBytes,
        },
        resourceLimits: { maxOldGenerationSizeMb: 384 },
      });
      let settled = false;
      const finish = async (result?: DocumentExtractionResult, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        try {
          await worker.terminate();
        } catch {
          /* Already exited. */
        }
        if (error) reject(error);
        else if (result) done(result);
      };
      const abort = () => {
        void finish(undefined, signal?.reason ?? new Error("Document parsing cancelled."));
      };
      const timer = setTimeout(() => {
        void finish(
          undefined,
          new Error(
            "Document parsing exceeded 180 seconds. Split the document into smaller files.",
          ),
        );
      }, 180_000);
      worker.once("message", (message) => {
        void finish(message.result, message.error ? new Error(message.error) : undefined);
      });
      worker.once("error", (error) => {
        void finish(undefined, error);
      });
      worker.once("exit", () => {
        if (!settled)
          void finish(undefined, new Error("Document worker exited before returning a result."));
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  } finally {
    try {
      if (languageDirectory)
        await rm(languageDirectory, { recursive: true, force: true, maxRetries: 3 });
    } finally {
      activeWorkers--;
      for (const wake of [...waiters]) wake();
    }
  }
}

export async function extractDocumentText(
  filePath: string,
  signal?: AbortSignal,
): Promise<DocumentExtractionResult> {
  const metadata = await stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("Document file does not exist.");
    throw error;
  });
  if (!metadata.isFile()) throw new Error("Document path is not a regular file.");
  if (metadata.size > MAX_DOCUMENT_BYTES) throw new Error("Document exceeds the 25 MiB limit.");
  return extractDocumentBuffer(await readFile(filePath), filePath, signal);
}

export async function extractDocumentBuffer(
  buffer: Buffer,
  filePath: string,
  signal?: AbortSignal,
  pdfMode: PdfReadMode = "ocr",
  pdfOptions: PdfExtractionOptions = {},
): Promise<DocumentExtractionResult> {
  signal?.throwIfAborted();
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error("Document exceeds the 25 MiB limit.");
  const extension = extname(filePath).toLowerCase();
  if ([".docx", ".xlsx", ".pptx", ".odt"].includes(extension))
    await validateDocumentArchive(buffer);

  switch (extension) {
    case ".docx":
    case ".xlsx":
    case ".xls":
    case ".pptx":
    case ".odt":
      return await extractInWorker(buffer, extension, signal, pdfMode);
    case ".pdf":
      return await extractInWorker(buffer, extension, signal, pdfMode, pdfOptions);
    case ".doc":
      return await extractInWorker(buffer, extension, signal, pdfMode);
    default:
      throw new Error(`不支持的文档格式：${extension || "未知"}`);
  }
}

export async function extractPdfPageBatch(
  buffer: Buffer,
  filePath: string,
  options: PdfExtractionOptions = {},
  signal?: AbortSignal,
): Promise<DocumentExtractionResult> {
  const startPage =
    Number.isInteger(options.startPage) && Number(options.startPage) > 0
      ? Number(options.startPage)
      : 1;
  const pageLimit =
    Number.isInteger(options.pageLimit) && Number(options.pageLimit) > 0
      ? Math.min(20, Number(options.pageLimit))
      : 12;
  const maxImageBytes =
    Number.isInteger(options.maxImageBytes) && Number(options.maxImageBytes) > 0
      ? Math.min(20 * 1024 * 1024, Number(options.maxImageBytes))
      : 12 * 1024 * 1024;
  return extractDocumentBuffer(buffer, filePath, signal, "vision", {
    startPage,
    pageLimit,
    maxImageBytes,
  });
}

export async function validateDocumentArchive(buffer: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const unsafe = (message: string) =>
      finish(
        new Error(
          `${message} Document archive is encrypted or exceeds safe extraction limits (4,000 entries / 100 MiB total / 32 MiB per entry).`,
        ),
      );
    fromBuffer(buffer, { lazyEntries: true, autoClose: true }, (error, archive) => {
      if (error || !archive) {
        finish(error ?? new Error("Invalid document archive."));
        return;
      }
      let count = 0;
      let total = 0;
      const names = new Set<string>();
      archive.on("error", finish);
      archive.on("end", () => finish());
      archive.on("entry", (entry) => {
        const normalizedName = entry.fileName.normalize("NFC");
        const lowerName = normalizedName.toLowerCase();
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const segments: string[] = normalizedName.split("/");
        const pathSegments = normalizedName.endsWith("/") ? segments.slice(0, -1) : segments;
        if (
          normalizedName.includes("\\") ||
          normalizedName.includes("\0") ||
          normalizedName.includes(":") ||
          normalizedName.startsWith("/") ||
          pathSegments.some(
            (segment: string) => segment === "." || segment === ".." || segment === "",
          ) ||
          names.has(lowerName) ||
          (unixMode & 0o170000) === 0o120000
        ) {
          archive.close();
          unsafe("Document archive contains an unsafe or duplicate entry path.");
          return;
        }
        names.add(lowerName);
        total += entry.uncompressedSize;
        if (
          ++count > MAX_ARCHIVE_ENTRIES ||
          total > MAX_ARCHIVE_UNCOMPRESSED_BYTES ||
          entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES ||
          entry.generalPurposeBitFlag & 1
        ) {
          archive.close();
          unsafe("Document archive is encrypted or exceeds safe extraction limits.");
          return;
        }
        archive.readEntry();
      });
      archive.readEntry();
    });
  });
}
