import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, type Unzipped, unzipSync } from "fflate";
import { validateDocumentArchive } from "./document-extractor";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const unsupportedPackageType = /macroenabled|vba|digital-signature/i;
const unsafeElements = new Set([
  "drawing",
  "pict",
  "object",
  "fldChar",
  "fldSimple",
  "instrText",
  "del",
  "ins",
  "moveFrom",
  "moveTo",
  "sectPr",
  "sdt",
  "bookmarkStart",
  "bookmarkEnd",
  "commentRangeStart",
  "commentRangeEnd",
  "commentReference",
  "footnoteReference",
  "endnoteReference",
]);

export type TemplateMediaBounds = { width: number; height: number };

export async function openEditableDocx(
  bytes: Buffer,
): Promise<{ archive: Unzipped; document: Document }> {
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Template exceeds 25 MiB.");
  await validateDocumentArchive(bytes);
  const archive = unzipSync(bytes);
  if (!archive["word/document.xml"]) throw new Error("Template must be a DOCX document.");
  for (const [path, content] of Object.entries(archive)) {
    if (/vbaProject|digital-signature|_xmlsignatures/i.test(path))
      throw new Error("Signed or macro-enabled templates are not supported.");
    if (path === "[Content_Types].xml" || path.endsWith(".rels")) {
      const doc = parseTemplateXml(strFromU8(content));
      const declarations =
        path === "[Content_Types].xml"
          ? doc.getElementsByTagNameNS(CONTENT_TYPES_NS, "*")
          : doc.getElementsByTagNameNS(RELATIONSHIPS_NS, "Relationship");
      const attribute = path === "[Content_Types].xml" ? "ContentType" : "Type";
      if (
        Array.from(declarations).some((node) =>
          unsupportedPackageType.test(node.getAttribute(attribute) ?? ""),
        )
      )
        throw new Error("Signed or macro-enabled templates are not supported.");
    }
  }
  const document = parseTemplateXml(strFromU8(archive["word/document.xml"]));
  if (
    document.documentElement.namespaceURI !== WORD_NS ||
    document.documentElement.localName !== "document" ||
    document.getElementsByTagNameNS(WORD_NS, "body").length !== 1
  )
    throw new Error("Invalid DOCX document body or namespace.");
  return { archive, document };
}

export async function validateTemplatePlaceholders(
  bytes: Buffer,
  names: string[],
  mediaNames: ReadonlySet<string> = new Set(),
): Promise<Map<string, TemplateMediaBounds>> {
  const { archive } = await openEditableDocx(bytes);
  const matches = new Map(names.map((name) => [name, { count: 0, standalone: true }]));
  const mediaBounds = new Map<string, TemplateMediaBounds>();
  for (const [path, content] of Object.entries(archive)) {
    if (!path.startsWith("word/") || !path.endsWith(".xml")) continue;
    const doc = parseTemplateXml(strFromU8(content));
    for (const paragraph of Array.from(doc.getElementsByTagNameNS(WORD_NS, "p"))) {
      const text = Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "t"))
        .map((node) => node.textContent)
        .join("");
      for (const [name, result] of matches) {
        const marker = `{{${name}}}`;
        const count = text.split(marker).length - 1;
        if (!count) continue;
        result.count += count;
        let protectedAncestor = false;
        for (let node = paragraph.parentNode; node; node = node.parentNode) {
          if (
            node.nodeType === 1 &&
            "localName" in node &&
            typeof node.localName === "string" &&
            unsafeElements.has(node.localName)
          )
            protectedAncestor = true;
        }
        result.standalone &&=
          text === marker &&
          !protectedAncestor &&
          !Array.from(paragraph.getElementsByTagName("*")).some(
            (node) => unsafeElements.has(node.localName ?? "") || node.namespaceURI !== WORD_NS,
          );
        if (mediaNames.has(name)) {
          if (path !== "word/document.xml")
            throw new Error(
              "TEMPLATE_MEDIA_LAYOUT_UNSUPPORTED: images, charts and fixed-width tables require a body paragraph.",
            );
          mediaBounds.set(name, readMediaBounds(doc, paragraph));
        }
      }
    }
  }
  for (const [name, result] of matches) {
    if (result.count !== 1 || !result.standalone)
      throw new Error(
        `TEMPLATE_PLACEHOLDER_INVALID: {{${name}}} must occur exactly once as an entire plain paragraph, without fields, drawings or tracked changes.`,
      );
  }
  return mediaBounds;
}

function parseTemplateXml(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Template XML declarations are not supported.");
  const fail = (message: string) => {
    throw new Error(`Invalid template XML: ${message}`);
  };
  return new DOMParser({
    errorHandler: { warning: fail, error: fail, fatalError: fail },
  }).parseFromString(xml, "text/xml");
}

function readMediaBounds(document: Document, paragraph: Element): TemplateMediaBounds {
  const fail = (): never => {
    throw new Error(
      "TEMPLATE_MEDIA_LAYOUT_UNSUPPORTED: images, charts and fixed-width tables require a direct body placeholder in a single-column, single-section template with explicit page size and margins. Use a plain body placeholder or fill with text/formulas.",
    );
  };
  const bodies = document.getElementsByTagNameNS(WORD_NS, "body");
  const sections = document.getElementsByTagNameNS(WORD_NS, "sectPr");
  const body = bodies.item(0);
  const section = sections.item(0);
  if (
    bodies.length !== 1 ||
    sections.length !== 1 ||
    !body ||
    !section ||
    paragraph.parentNode !== body ||
    section.parentNode !== body
  )
    return fail();
  const columns = section.getElementsByTagNameNS(WORD_NS, "cols");
  if (
    Array.from(columns).some(
      (column) =>
        (column.hasAttributeNS(WORD_NS, "num") && column.getAttributeNS(WORD_NS, "num") !== "1") ||
        column.getElementsByTagNameNS(WORD_NS, "col").length > 0,
    )
  )
    return fail();
  const sizes = section.getElementsByTagNameNS(WORD_NS, "pgSz");
  const margins = section.getElementsByTagNameNS(WORD_NS, "pgMar");
  const size = sizes.item(0);
  const margin = margins.item(0);
  if (sizes.length !== 1 || margins.length !== 1 || !size || !margin) return fail();
  const twips = (element: Element, name: string, optional = false): number => {
    const raw = element.getAttributeNS(WORD_NS, name);
    if ((raw === null || raw === "") && optional) return 0;
    if (!raw || !/^\d+$/.test(raw)) return fail();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > 31680) return fail();
    return value;
  };
  const width =
    (twips(size, "w") -
      twips(margin, "left") -
      twips(margin, "right") -
      twips(margin, "gutter", true)) /
    1440;
  // Leave room for the drawing paragraph's line and after-spacing.
  const height = (twips(size, "h") - twips(margin, "top") - twips(margin, "bottom")) / 1440 - 0.3;
  if (width < 1 || height < 0.5) return fail();
  return { width, height };
}
