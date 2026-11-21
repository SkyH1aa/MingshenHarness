import { posix } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, type Unzipped, unzipSync } from "fflate";
import { fromBuffer } from "yauzl";
import { validateDocumentArchive } from "./document-extractor";
import { officeFormulaIsUnsafe } from "./office-document-schema";

const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const SAFE_XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SAFE_XLSX_WORKBOOK_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const MAX_EMBEDDED_ARCHIVE_DEPTH = 4;
const MAX_EMBEDDED_ARCHIVES = 64;
const MAX_EMBEDDED_ARCHIVE_ENTRIES = 4_000;
const MAX_EMBEDDED_ARCHIVE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_EMBEDDED_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024;
const SPREADSHEET_FORMULA_PARTS = /^(?:xl\/workbook\.xml|xl\/(?:worksheets|tables)\/[^/]+\.xml)$/i;
const SPREADSHEET_FORMULA_ELEMENTS = new Set([
  "f",
  "formula",
  "formula1",
  "formula2",
  "calculatedcolumnformula",
  "definedname",
]);
const UNSAFE_PACKAGE_PART =
  /(?:vbaProject|_xmlsignatures|digital-signature|activeX|externalLinks\/|pivotCache\/|slicer|webextensions|oleObject[^/]*\.(?:bin|exe|dll))/i;
const UNSAFE_SPREADSHEET_CONNECTION_PART = /(?:connections\.xml|queryTables\/|model\/)/i;
const UNSAFE_CONTENT_TYPE =
  /macroenabled|vba|digital-signature|oleobject|activex|externallink|altchunk/i;
const UNSAFE_RELATIONSHIP_TYPE =
  /(?:externalLink|oleObject|activeX|attachedTemplate|subDocument|afChunk|digital-signature)/i;

interface EmbeddedArchiveBudget {
  archives: number;
  entries: number;
  uncompressedBytes: number;
}

type ContentTypeRegistry = {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
};

function parseSecurityXml(bytes: Uint8Array, label: string): Document {
  const source = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error(`OFFICE_UNSUPPORTED_PART: ${label} 含不受支持的 XML 声明。`);
  const document = new DOMParser().parseFromString(source, "text/xml");
  if (document.getElementsByTagName("parsererror").length)
    throw new Error(`OFFICE_PACKAGE_INVALID: ${label} 不是可解析的 OOXML。`);
  return document;
}

function normalizedPartName(value: string): string {
  const normalized = posix.normalize(value.replace(/^\/+/, ""));
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\\") ||
    normalized.includes("\0")
  )
    throw new Error(`OFFICE_PACKAGE_INVALID: 非法 OOXML 部件路径 ${value}。`);
  return normalized;
}

function relationshipTarget(sourcePart: string, target: string): string {
  if (!target || /[?#]/.test(target) || /^(?:[a-z][a-z0-9+.-]*:|\\\\|\/\/)/i.test(target))
    throw new Error(`OFFICE_PACKAGE_INVALID: ${sourcePart} 的包关系目标不是内部 OOXML 部件。`);
  if (target.startsWith("/")) return normalizedPartName(target);
  const relationshipDirectory = posix.dirname(sourcePart);
  const sourceDirectory =
    posix.basename(relationshipDirectory) === "_rels"
      ? posix.dirname(relationshipDirectory)
      : relationshipDirectory;
  return normalizedPartName(posix.join(sourceDirectory, target));
}

function contentTypes(archive: Unzipped): ContentTypeRegistry {
  const bytes = archive["[Content_Types].xml"];
  if (!bytes) throw new Error("OFFICE_PACKAGE_INVALID: OOXML 包缺少 [Content_Types].xml。");
  const document = parseSecurityXml(bytes, "[Content_Types].xml");
  if (
    document.documentElement.namespaceURI !== CONTENT_TYPES_NS ||
    document.documentElement.localName !== "Types"
  )
    throw new Error("OFFICE_PACKAGE_INVALID: [Content_Types].xml 命名空间或根元素无效。");
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element.namespaceURI !== CONTENT_TYPES_NS) continue;
    const contentType = element.getAttribute("ContentType")?.trim() ?? "";
    if (element.localName === "Default") {
      const extension = element.getAttribute("Extension")?.trim().toLowerCase() ?? "";
      if (!extension || !contentType)
        throw new Error("OFFICE_PACKAGE_INVALID: Content_Types Default 条目缺少字段。");
      if (defaults.has(extension))
        throw new Error(`OFFICE_PACKAGE_DUPLICATE: Content_Types 重复扩展名 ${extension}。`);
      defaults.set(extension, contentType);
    } else if (element.localName === "Override") {
      const partName = normalizedPartName(element.getAttribute("PartName") ?? "");
      if (!contentType) throw new Error(`OFFICE_PACKAGE_INVALID: ${partName} 缺少内容类型。`);
      if (overrides.has(partName))
        throw new Error(`OFFICE_PACKAGE_DUPLICATE: Content_Types 重复部件 ${partName}。`);
      overrides.set(partName, contentType);
    }
  }
  return { defaults, overrides };
}

function contentTypeFor(partName: string, registry: ContentTypeRegistry): string | undefined {
  return (
    registry.overrides.get(partName) ??
    registry.defaults.get(posix.extname(partName).slice(1).toLowerCase())
  );
}

function assertNoUnsafePackageParts(archive: Unzipped): void {
  const unsafePath = Object.keys(archive).find((name) => UNSAFE_PACKAGE_PART.test(name));
  if (unsafePath)
    throw new Error(
      `OFFICE_UNSUPPORTED_PART: 检测到宏、签名、OLE、外部连接、数据透视或扩展部件 ${unsafePath}。`,
    );

  const registry = contentTypes(archive);
  for (const [extension, contentType] of registry.defaults)
    if (UNSAFE_CONTENT_TYPE.test(contentType))
      throw new Error(
        `OFFICE_UNSUPPORTED_PART: Content_Types 的 ${extension} 声明了主动内容 ${contentType}。`,
      );
  for (const [partName, contentType] of registry.overrides)
    if (UNSAFE_CONTENT_TYPE.test(contentType))
      throw new Error(`OFFICE_UNSUPPORTED_PART: ${partName} 声明了主动内容 ${contentType}。`);
}

function assertNoUnsafeSpreadsheetConnectionParts(archive: Unzipped): void {
  const unsafePath = Object.keys(archive).find((name) =>
    UNSAFE_SPREADSHEET_CONNECTION_PART.test(name),
  );
  if (unsafePath)
    throw new Error(
      `OFFICE_UNSUPPORTED_PART: 嵌入工作簿含不受支持的数据连接或模型部件 ${unsafePath}。`,
    );
}

function assertSafeRelationships(archive: Unzipped): Map<string, string[]> {
  const packageTargets = new Map<string, string[]>();
  for (const [path, bytes] of Object.entries(archive)) {
    if (!path.toLowerCase().endsWith(".rels")) continue;
    const document = parseSecurityXml(bytes, path);
    if (
      document.documentElement.namespaceURI !== RELATIONSHIPS_NS ||
      document.documentElement.localName !== "Relationships"
    )
      throw new Error(`OFFICE_PACKAGE_INVALID: ${path} 的关系命名空间或根元素无效。`);
    const ids = new Set<string>();
    for (const element of Array.from(document.getElementsByTagName("*"))) {
      if (element.namespaceURI !== RELATIONSHIPS_NS || element.localName !== "Relationship")
        continue;
      const id = element.getAttribute("Id")?.trim() ?? "";
      const type = element.getAttribute("Type")?.trim() ?? "";
      const target = element.getAttribute("Target")?.trim() ?? "";
      if (!id || !type || !target)
        throw new Error(`OFFICE_PACKAGE_INVALID: ${path} 含字段不完整的关系。`);
      if (ids.has(id)) throw new Error(`OFFICE_PACKAGE_DUPLICATE: ${path} 重复关系 Id ${id}。`);
      ids.add(id);
      const external = element.getAttribute("TargetMode")?.trim().toLowerCase() === "external";
      if (external) {
        if (!/\/hyperlink\/?$/i.test(type))
          throw new Error(`OFFICE_UNSUPPORTED_PART: ${path} 的关系 ${id} 指向外部资源 ${target}。`);
        continue;
      }
      if (UNSAFE_RELATIONSHIP_TYPE.test(type))
        throw new Error(
          `OFFICE_UNSUPPORTED_PART: ${path} 的关系 ${id} 使用了不受支持的主动类型 ${type}。`,
        );
      if (/\/package\/?$/i.test(type)) {
        const resolved = relationshipTarget(path, target);
        const references = packageTargets.get(resolved) ?? [];
        references.push(`${path}#${id}`);
        packageTargets.set(resolved, references);
      }
    }
  }
  return packageTargets;
}

function assertEmbeddedPackageAssociations(
  archive: Unzipped,
  packageTargets: Map<string, string[]>,
): void {
  const registry = contentTypes(archive);
  const embedded = Object.keys(archive).filter(
    (name) => /(?:^|\/)embeddings\//i.test(name) && !name.endsWith("/"),
  );
  const embeddedSet = new Set(embedded);
  for (const partName of embedded) {
    if (!/\.xlsx$/i.test(partName))
      throw new Error(`OFFICE_UNSUPPORTED_PART: 嵌入部件 ${partName} 不是受控的 XLSX 数据工作簿。`);
    const contentType = contentTypeFor(partName, registry);
    if (contentType !== SAFE_XLSX_CONTENT_TYPE)
      throw new Error(
        `OFFICE_PACKAGE_INVALID: 嵌入部件 ${partName} 的内容类型与安全 XLSX 不一致。`,
      );
  }
  for (const [partName, references] of packageTargets) {
    if (!embeddedSet.has(partName) || !/\.xlsx$/i.test(partName))
      throw new Error(
        `OFFICE_PACKAGE_INVALID: package 关系目标 ${partName} 不是已声明的嵌入 XLSX。`,
      );
    if (references.length !== 1)
      throw new Error(
        `OFFICE_PACKAGE_DUPLICATE: 嵌入 XLSX ${partName} 被 ${references.length} 个 package 关系重复引用。`,
      );
  }
  for (const partName of embedded) {
    if (packageTargets.get(partName)?.length !== 1)
      throw new Error(`OFFICE_PACKAGE_INVALID: 嵌入 XLSX ${partName} 缺少唯一的 package 关系。`);
  }
  for (const [partName] of registry.overrides) {
    if (/(?:^|\/)embeddings\//i.test(partName) && !embeddedSet.has(partName))
      throw new Error(`OFFICE_PACKAGE_INVALID: Content_Types 引用了不存在的嵌入部件 ${partName}。`);
  }
}

function assertSpreadsheetFormulas(archive: Unzipped, context: string): void {
  for (const [name, bytes] of Object.entries(archive)) {
    if (!SPREADSHEET_FORMULA_PARTS.test(name)) continue;
    const document = parseSecurityXml(bytes, `${context}/${name}`);
    for (const element of Array.from(document.getElementsByTagName("*"))) {
      const localName = element.localName?.toLowerCase();
      if (!localName || !SPREADSHEET_FORMULA_ELEMENTS.has(localName)) continue;
      if (!officeFormulaIsUnsafe(element.textContent ?? "")) continue;
      throw new Error(
        `OFFICE_UNSAFE_FORMULA: ${context}/${name} 含 WEBSERVICE、RTD、DDE/EXEC 或外部工作簿/URL 引用。`,
      );
    }
  }
}

async function reserveEmbeddedArchiveBudget(
  bytes: Buffer,
  context: string,
  budget: EmbeddedArchiveBudget,
): Promise<void> {
  if (budget.archives >= MAX_EMBEDDED_ARCHIVES)
    throw new Error(
      `OFFICE_EMBEDDED_BUDGET: 嵌入工作簿数量超过单次请求的 ${MAX_EMBEDDED_ARCHIVES} 个上限。`,
    );
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let entryCount = 0;
    let uncompressedBytes = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else {
        budget.archives += 1;
        budget.entries += entryCount;
        budget.uncompressedBytes += uncompressedBytes;
        resolve();
      }
    };
    const unsafe = (reason: string) =>
      finish(new Error(`OFFICE_EMBEDDED_BUDGET: 嵌入工作簿 ${context} ${reason}`));
    fromBuffer(bytes, { lazyEntries: true, autoClose: true }, (error, archive) => {
      if (error || !archive) {
        finish(
          new Error(`OFFICE_EMBEDDED_INVALID: 嵌入工作簿 ${context} 的 ZIP 中央目录无法校验。`),
        );
        return;
      }
      archive.on("error", () =>
        finish(
          new Error(`OFFICE_EMBEDDED_INVALID: 嵌入工作簿 ${context} 的 ZIP 中央目录读取失败。`),
        ),
      );
      archive.on("end", () => finish());
      archive.on("entry", (entry) => {
        entryCount += 1;
        uncompressedBytes += entry.uncompressedSize;
        if (entry.uncompressedSize > MAX_EMBEDDED_ARCHIVE_ENTRY_BYTES) {
          archive.close();
          unsafe(
            `条目 ${entry.fileName} 声明解压后超过 ${MAX_EMBEDDED_ARCHIVE_ENTRY_BYTES} 字节。`,
          );
          return;
        }
        if (budget.entries + entryCount > MAX_EMBEDDED_ARCHIVE_ENTRIES) {
          archive.close();
          unsafe(`累计 ZIP 条目超过单次请求的 ${MAX_EMBEDDED_ARCHIVE_ENTRIES} 个上限。`);
          return;
        }
        if (
          budget.uncompressedBytes + uncompressedBytes >
          MAX_EMBEDDED_ARCHIVE_UNCOMPRESSED_BYTES
        ) {
          archive.close();
          unsafe(
            `累计声明解压大小超过单次请求的 ${MAX_EMBEDDED_ARCHIVE_UNCOMPRESSED_BYTES} 字节上限。`,
          );
          return;
        }
        archive.readEntry();
      });
      archive.readEntry();
    });
  });
}

function assertXlsxPackageStructure(archive: Unzipped, context: string): void {
  if (!archive["[Content_Types].xml"] || !archive["_rels/.rels"] || !archive["xl/workbook.xml"])
    throw new Error(`OFFICE_EMBEDDED_INVALID: 嵌入工作簿 ${context} 缺少必要 XLSX 部件。`);
  const registry = contentTypes(archive);
  if (contentTypeFor("xl/workbook.xml", registry) !== SAFE_XLSX_WORKBOOK_CONTENT_TYPE)
    throw new Error(`OFFICE_EMBEDDED_INVALID: 嵌入工作簿 ${context} 的 workbook 内容类型无效。`);
  const rootRelationships = parseSecurityXml(archive["_rels/.rels"], `${context}/_rels/.rels`);
  const targets = Array.from(rootRelationships.getElementsByTagName("*")).flatMap((element) => {
    if (element.localName !== "Relationship") return [];
    const type = element.getAttribute("Type") ?? "";
    const target = element.getAttribute("Target") ?? "";
    return /\/officeDocument\/?$/i.test(type) && target
      ? [relationshipTarget("_rels/.rels", target)]
      : [];
  });
  if (!targets.includes("xl/workbook.xml"))
    throw new Error(`OFFICE_EMBEDDED_INVALID: 嵌入工作簿 ${context} 的根关系未指向 workbook。`);
}

async function inspectEmbeddedSpreadsheet(
  bytes: Buffer,
  context: string,
  budget: EmbeddedArchiveBudget,
  depth: number,
): Promise<void> {
  if (depth > MAX_EMBEDDED_ARCHIVE_DEPTH)
    throw new Error(
      `OFFICE_EMBEDDED_BUDGET: 嵌入工作簿 ${context} 递归深度超过 ${MAX_EMBEDDED_ARCHIVE_DEPTH} 层上限。`,
    );
  await reserveEmbeddedArchiveBudget(bytes, context, budget);
  let archive: Unzipped;
  try {
    await validateDocumentArchive(bytes);
    archive = unzipSync(bytes);
  } catch {
    throw new Error(`OFFICE_EMBEDDED_INVALID: 嵌入工作簿 ${context} 无法安全解压。`);
  }
  assertXlsxPackageStructure(archive, context);
  assertNoUnsafePackageParts(archive);
  assertNoUnsafeSpreadsheetConnectionParts(archive);
  const packageTargets = assertSafeRelationships(archive);
  assertEmbeddedPackageAssociations(archive, packageTargets);
  assertSpreadsheetFormulas(archive, context);
  for (const [name, nested] of Object.entries(archive)) {
    if (!/(?:^|\/)embeddings\//i.test(name) || name.endsWith("/")) continue;
    if (!/\.xlsx$/i.test(name))
      throw new Error(
        `OFFICE_UNSUPPORTED_PART: 嵌入工作簿 ${context} 中的 ${name} 不是受控 XLSX。`,
      );
    await inspectEmbeddedSpreadsheet(Buffer.from(nested), `${context}/${name}`, budget, depth + 1);
  }
}

export async function assertSafeOfficePackageParts(
  archive: Unzipped,
  extension: ".docx" | ".xlsx" | ".pptx",
): Promise<void> {
  assertNoUnsafePackageParts(archive);
  const packageTargets = assertSafeRelationships(archive);
  assertEmbeddedPackageAssociations(archive, packageTargets);
  if (extension === ".xlsx") assertSpreadsheetFormulas(archive, extension);
  const budget: EmbeddedArchiveBudget = {
    archives: 0,
    entries: 0,
    uncompressedBytes: 0,
  };
  for (const [name, bytes] of Object.entries(archive)) {
    if (!/(?:^|\/)embeddings\//i.test(name) || name.endsWith("/")) continue;
    if (!/\.xlsx$/i.test(name))
      throw new Error(
        `OFFICE_UNSUPPORTED_PART: 嵌入部件 ${name} 不是受控的 XLSX 数据工作簿，已拒绝处理。`,
      );
    await inspectEmbeddedSpreadsheet(Buffer.from(bytes), name, budget, 1);
  }
}
