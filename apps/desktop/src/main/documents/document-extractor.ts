import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { fromBuffer } from "yauzl";

const DOCUMENT_EXTENSIONS = new Set([".doc", ".docx", ".pdf", ".xlsx", ".xls", ".pptx", ".odt"]);

export type PdfReadMode = "native" | "vision" | "ocr";

export interface DocumentExtractionResult {
  format: string;
  text: string;
  warnings: string[];
  pdf?: { totalPages: number; inspectedPages: number; ocrPages: number };
  pageImages?: Array<{ page: number; dataUrl: string }>;
}

export function isDocumentPath(filePath: string): boolean {
  return DOCUMENT_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function extractXmlText(xml: string, elementName: string): string {
  const expression = new RegExp(`<${elementName}(?:\\s[^>]*)?>([\\s\\S]*?)</${elementName}>`, "g");
  const values = [...xml.matchAll(expression)].map((match) =>
    decodeXmlEntities(
      (match[1] ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );
  return values.filter(Boolean).join("\n");
}

async function extractDocx(buffer: Buffer): Promise<DocumentExtractionResult> {
  const result = await mammoth.extractRawText({ buffer });
  const archive = unzipSync(buffer, { filter: (entry) => entry.name === "word/document.xml" });
  const xml = strFromU8(archive["word/document.xml"] ?? new Uint8Array());
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Document XML declarations are not supported.");
  const document = new DOMParser().parseFromString(xml, "text/xml");
  const equations = Array.from(
    document.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/math",
      "oMath",
    ),
  );
  const mathSummary = equations
    .slice(0, 128)
    .map(
      (equation, index) =>
        `Equation ${index + 1} (OMML, linear text only): ${equation.textContent ?? ""}`,
    )
    .join("\n");
  return {
    format: "DOCX",
    text: result.value + (mathSummary ? `\n\n${mathSummary}` : ""),
    warnings: [
      ...result.messages.map((message) => message.message),
      ...(equations.length
        ? [
            `${equations.length} native editable equations; linear extraction does not preserve fraction/script layout. Inspect the DOCX visually.`,
            ...(equations.length > 128
              ? ["Equation text limited to the first 128 equations."]
              : []),
          ]
        : []),
    ],
  };
}

let activeWorkers = 0;
const waiters = new Set<() => void>();

async function extractInWorker(
  bytes: Buffer,
  extension: string,
  signal?: AbortSignal,
  mode: PdfReadMode = "ocr",
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
        workerData: { bytes, extension, mode, moduleBase, languageDirectory },
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

async function extractSpreadsheet(
  buffer: Buffer,
  filePath: string,
): Promise<DocumentExtractionResult> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const text = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const content = sheet ? XLSX.utils.sheet_to_csv(sheet) : "";
    return `# ${name}\n${content}`;
  }).join("\n\n");

  return {
    format: extname(filePath).slice(1).toUpperCase(),
    text,
    warnings: [],
  };
}

async function extractPptx(buffer: Buffer): Promise<DocumentExtractionResult> {
  const archive = unzipSync(new Uint8Array(buffer));
  const slideNames = Object.keys(archive)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => {
      const leftNumber = Number(left.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      const rightNumber = Number(right.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
      return leftNumber - rightNumber;
    });

  const slides = slideNames.flatMap((name, index) => {
    const data = archive[name];
    if (!data) {
      return [];
    }
    const xml = strFromU8(data);
    return [`# 幻灯片 ${index + 1}\n${extractXmlText(xml, "a:t")}`];
  });

  return {
    format: "PPTX",
    text: slides.join("\n\n"),
    warnings: [],
  };
}

async function extractOdt(buffer: Buffer): Promise<DocumentExtractionResult> {
  const archive = unzipSync(new Uint8Array(buffer));
  const content = archive["content.xml"];
  if (!content) {
    throw new Error("ODT 文件缺少 content.xml。");
  }
  return {
    format: "ODT",
    text: decodeXmlEntities(
      strFromU8(content)
        .replace(/<text:line-break\/>/g, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s+/g, "\n")
        .trim(),
    ),
    warnings: [],
  };
}

export async function extractDocumentText(
  filePath: string,
  signal?: AbortSignal,
): Promise<DocumentExtractionResult> {
  return extractDocumentBuffer(await readFile(filePath), filePath, signal);
}

export async function extractDocumentBuffer(
  buffer: Buffer,
  filePath: string,
  signal?: AbortSignal,
  pdfMode: PdfReadMode = "ocr",
): Promise<DocumentExtractionResult> {
  signal?.throwIfAborted();
  if (buffer.length > 25 * 1024 * 1024) throw new Error("Document exceeds the 25 MiB limit.");
  const extension = extname(filePath).toLowerCase();
  if ([".docx", ".xlsx", ".pptx", ".odt"].includes(extension))
    await validateDocumentArchive(buffer);

  switch (extension) {
    case ".docx":
      return await extractDocx(buffer);
    case ".pdf":
    case ".doc":
      return await extractInWorker(buffer, extension, signal, pdfMode);
    case ".xlsx":
    case ".xls":
      return await extractSpreadsheet(buffer, filePath);
    case ".pptx":
      return await extractPptx(buffer);
    case ".odt":
      return await extractOdt(buffer);
    default:
      throw new Error(`不支持的文档格式：${extension || "未知"}`);
  }
}

export async function validateDocumentArchive(buffer: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, autoClose: true }, (error, archive) => {
      if (error || !archive) {
        reject(error ?? new Error("Invalid document archive."));
        return;
      }
      let count = 0;
      let total = 0;
      archive.on("error", reject);
      archive.on("end", resolve);
      archive.on("entry", (entry) => {
        total += entry.uncompressedSize;
        if (
          ++count > 4000 ||
          total > 100 * 1024 * 1024 ||
          entry.uncompressedSize > 32 * 1024 * 1024 ||
          entry.generalPurposeBitFlag & 1
        ) {
          archive.close();
          reject(
            new Error(
              "Document archive is encrypted or exceeds safe extraction limits (4,000 entries / 100 MiB total / 32 MiB per entry).",
            ),
          );
          return;
        }
        archive.readEntry();
      });
      archive.readEntry();
    });
  });
}
