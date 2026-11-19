import { createHash, randomUUID } from "node:crypto";
import { XMLSerializer } from "@xmldom/xmldom";
import { strToU8, unzipSync, zipSync } from "fflate";
import type {
  DocumentAuthoringRequest,
  DocumentBlock,
  ParagraphLayout,
} from "./document-authoring-schema";
import { openEditableDocx } from "./document-template";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const M = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const XML = "http://www.w3.org/XML/1998/namespace";
const protectedTags = new Set([
  "sectPr",
  "ins",
  "del",
  "moveFrom",
  "moveTo",
  "moveFromRangeStart",
  "moveFromRangeEnd",
  "moveToRangeStart",
  "moveToRangeEnd",
  "bookmarkStart",
  "bookmarkEnd",
  "commentRangeStart",
  "commentRangeEnd",
  "commentReference",
  "footnoteReference",
  "endnoteReference",
  "fldChar",
  "fldSimple",
  "instrText",
  "sdt",
  "customXml",
  "altChunk",
  "object",
  "pPrChange",
  "rPrChange",
  "tblPrChange",
  "tcPrChange",
  "trPrChange",
  "cellIns",
  "cellDel",
  "cellMerge",
  "permStart",
  "permEnd",
  "customXmlInsRangeStart",
  "customXmlInsRangeEnd",
  "customXmlDelRangeStart",
  "customXmlDelRangeEnd",
  "customXmlMoveFromRangeStart",
  "customXmlMoveFromRangeEnd",
  "customXmlMoveToRangeStart",
  "customXmlMoveToRangeEnd",
]);
const simpleTextTags = new Set(["p", "pPr", "r", "rPr", "t", "hyperlink", "proofErr"]);
const serializer = new XMLSerializer();
const paragraphPropertyOrder = [
  "pStyle",
  "keepNext",
  "keepLines",
  "pageBreakBefore",
  "framePr",
  "widowControl",
  "numPr",
  "suppressLineNumbers",
  "pBdr",
  "shd",
  "tabs",
  "suppressAutoHyphens",
  "kinsoku",
  "wordWrap",
  "overflowPunct",
  "topLinePunct",
  "autoSpaceDE",
  "autoSpaceDN",
  "bidi",
  "adjustRightInd",
  "snapToGrid",
  "spacing",
  "ind",
  "contextualSpacing",
  "mirrorIndents",
  "suppressOverlap",
  "jc",
  "textDirection",
  "textAlignment",
  "textboxTightWrap",
  "outlineLvl",
  "divId",
  "cnfStyle",
  "rPr",
  "sectPr",
  "pPrChange",
];

function elements(node: Element): Element[] {
  return Array.from(node.getElementsByTagName("*"));
}

function children(node: Element): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function direct(node: Element, name: string): Element | undefined {
  return children(node).find((child) => child.namespaceURI === W && child.localName === name);
}

function text(node: Element): string {
  // Text boxes, deleted revisions and nested tables are not flattened into an editable paragraph.
  const walk = (element: Element): string => {
    if (element.namespaceURI === M && element.localName === "t") return element.textContent ?? "";
    if (element.namespaceURI === W) {
      if (element.localName === "t") return element.textContent ?? "";
      if (element.localName === "tab") return "\t";
      if (element.localName === "br" || element.localName === "cr") return "\n";
      if (["del", "moveFrom", "drawing", "pict"].includes(element.localName)) return "";
    }
    return children(element).map(walk).join("");
  };
  return walk(node);
}

function indexDocument(document: Document) {
  const body = document.getElementsByTagNameNS(W, "body").item(0);
  if (!body) throw new Error("DOCX body missing.");
  const blocks = children(body).filter(
    (node) => !(node.namespaceURI === W && node.localName === "sectPr"),
  );
  const paragraphs = Array.from(body.getElementsByTagNameNS(W, "p"));
  if (blocks.length > 100_000 || paragraphs.length > 100_000)
    throw new Error("DOCX structure exceeds 100000 blocks or paragraphs.");
  const ranges = protectedRanges(body);
  return { body, blocks, paragraphs, ranges };
}

// Range markers and complex fields can start before the selected paragraph and end after it.
function protectedRanges(body: Element): Map<Element, string> {
  const reasons = new Map<Element, string>();
  const active = new Map<string, string>();
  let fields = 0;
  const walk = (node: Element) => {
    if (node.namespaceURI === W) {
      const name = node.localName;
      if (name === "fldChar") {
        const type = node.getAttributeNS(W, "fldCharType");
        if (type === "begin") fields++;
        else if (type === "end") fields = Math.max(0, fields - 1);
      }
      const isStart = protectedTags.has(name) && /Start$/.test(name);
      const isEnd = protectedTags.has(name) && /End$/.test(name);
      const key = `${name.replace(/Start$|End$/, "")}:${node.getAttributeNS(W, "id")}`;
      if (isStart) active.set(key, name);
      if (isEnd) active.delete(key);
      if (fields || active.size) {
        const reason = fields ? "fldChar" : (active.values().next().value ?? "protectedRange");
        for (let parent: Node | null = node; parent && parent !== body; parent = parent.parentNode)
          if (parent.nodeType === 1) reasons.set(parent as Element, reason);
      }
    }
    for (const child of children(node)) walk(child);
  };
  walk(body);
  return reasons;
}

function blockOf(node: Element, body: Element): Element {
  let current = node;
  while (current.parentNode && current.parentNode !== body) {
    current = current.parentNode as Element;
  }
  return current;
}

function protectedReason(node: Element): string | undefined {
  for (let parent = node.parentNode; parent && parent.nodeType === 1; parent = parent.parentNode) {
    const element = parent as Element;
    if (element.namespaceURI === W && protectedTags.has(element.localName))
      return element.localName;
    if (element.namespaceURI === W && element.localName === "body") break;
    if (element.namespaceURI !== W) return element.localName;
  }
  return [node, ...elements(node)].find(
    (element) => element.namespaceURI === W && protectedTags.has(element.localName),
  )?.localName;
}

function simpleParagraph(node: Element): boolean {
  if (protectedReason(node)) return false;
  const walk = (element: Element): boolean => {
    if (element.namespaceURI !== W || !simpleTextTags.has(element.localName)) return false;
    if (element.localName === "pPr" || element.localName === "rPr") return true;
    return children(element).every(walk);
  };
  return walk(node);
}

export async function readDocxStructure(bytes: Buffer): Promise<{ sha256: string; text: string }> {
  const { document } = await openEditableDocx(bytes);
  const { body, blocks, paragraphs, ranges } = indexDocument(document);
  const blockIndices = new Map(blocks.map((node, index) => [node, index + 1]));
  const records = [
    "Indices refer to this source SHA-256. Use edit.expected_sha256; never reuse indices after edits.",
    "Blocks are direct body elements; paragraphs include table cells. Section properties are never selectable.",
    ...blocks.map((node, index) =>
      JSON.stringify({
        block: index + 1,
        type: node.localName,
        protected: protectedReason(node) ?? ranges.get(node) ?? null,
      }),
    ),
    ...paragraphs.map((node, index) => {
      const properties = direct(node, "pPr");
      return JSON.stringify({
        paragraph: index + 1,
        block: blockIndices.get(blockOf(node, body)),
        text: text(node),
        style: properties ? (direct(properties, "pStyle")?.getAttributeNS(W, "val") ?? null) : null,
        replace_text: simpleParagraph(node) && !ranges.has(node),
        protected: protectedReason(node) ?? ranges.get(node) ?? null,
      });
    }),
  ];
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    text: records.join("\n"),
  };
}

export type PreparedDocxEdit = {
  bytes: Buffer;
  replacements: Array<{ placeholder: string; blocks: DocumentBlock[] }>;
};

export async function prepareDocxEdit(
  bytes: Buffer,
  edit: NonNullable<DocumentAuthoringRequest["edit"]>,
  signal?: AbortSignal,
): Promise<PreparedDocxEdit> {
  signal?.throwIfAborted();
  if (createHash("sha256").update(bytes).digest("hex") !== edit.expected_sha256.toLowerCase())
    throw new Error("DOCUMENT_SOURCE_CHANGED: source SHA-256 differs. Read its structure again.");
  const { archive, document } = await openEditableDocx(bytes);
  // The dependency's template patcher addresses canonical w: element names.
  if (
    edit.operations.some(
      (operation) => operation.type === "replace_blocks" && operation.blocks.length,
    ) &&
    document.documentElement.prefix !== "w"
  )
    throw new Error(
      "DOCUMENT_NAMESPACE_UNSUPPORTED: block insertion requires the canonical w: prefix; inline edits remain available.",
    );
  const { body, blocks, paragraphs, ranges } = indexDocument(document);
  const claimed = new Set<Element>();
  const replacements: PreparedDocxEdit["replacements"] = [];
  // Resolve and reserve the original nodes before any mutation; overlapping edits are ambiguous.
  const operations = edit.operations.map((operation) => {
    const nodes =
      operation.type === "replace_blocks"
        ? blocks.slice(operation.start_block - 1, operation.end_block)
        : [paragraphs[operation.paragraph - 1]];
    if (
      nodes.some((node) => !node) ||
      (operation.type === "replace_blocks" &&
        nodes.length !== operation.end_block - operation.start_block + 1)
    )
      throw new Error("DOCUMENT_ANCHOR_INVALID: block or paragraph index is out of range.");
    const resolved = nodes as Element[];
    for (const node of resolved) {
      if (
        [...claimed].some(
          (other) => other === node || isAncestor(other, node) || isAncestor(node, other),
        )
      )
        throw new Error("DOCUMENT_EDIT_OVERLAP: operations must target disjoint original nodes.");
      claimed.add(node);
      const reason = protectedReason(node) ?? ranges.get(node);
      if (reason)
        throw new Error(
          `DOCUMENT_RANGE_PROTECTED: ${reason}; split the edit around this structure.`,
        );
      if (
        operation.type === "replace_blocks" &&
        (node.namespaceURI !== W || !["p", "tbl"].includes(node.localName))
      )
        throw new Error(
          "DOCUMENT_RANGE_PROTECTED: only complete body paragraphs and tables can be replaced.",
        );
      if (operation.type === "replace_text" && !simpleParagraph(node))
        throw new Error(
          "DOCUMENT_TEXT_PROTECTED: use a plain paragraph without math, fields or drawings.",
        );
    }
    return { operation, nodes: resolved };
  });
  for (const { operation, nodes } of operations) {
    signal?.throwIfAborted();
    const first = nodes[0];
    if (!first) throw new Error("DOCUMENT_ANCHOR_INVALID: selected range is empty.");
    if (operation.type === "replace_text") {
      replaceText(first, operation.old_text, operation.new_text);
    } else if (operation.type === "format_paragraph") {
      applyParagraphLayout(first, operation.layout);
    } else {
      if (operation.blocks.length) {
        const placeholder = `msh_edit_${randomUUID().replaceAll("-", "")}`;
        const anchor = document.createElementNS(W, "w:p");
        const run = document.createElementNS(W, "w:r");
        const value = document.createElementNS(W, "w:t");
        value.textContent = `{{${placeholder}}}`;
        run.appendChild(value);
        anchor.appendChild(run);
        body.insertBefore(anchor, first);
        replacements.push({ placeholder, blocks: operation.blocks });
      }
      for (const node of nodes) body.removeChild(node);
    }
  }
  if (!children(body).some((node) => node.namespaceURI !== W || node.localName !== "sectPr"))
    body.insertBefore(document.createElementNS(W, "w:p"), direct(body, "sectPr") ?? null);
  // Keep unrelated package parts as their original byte arrays; never rebuild an old draft from extracted text.
  archive["word/document.xml"] = strToU8(serializer.serializeToString(document));
  return { bytes: Buffer.from(zipSync(archive)), replacements };
}

export function preserveUneditedDocxParts(source: Buffer, patched: Buffer): Buffer {
  const original = unzipSync(source);
  const output = unzipSync(patched);
  const mutable = new Set([
    "word/document.xml",
    "word/_rels/document.xml.rels",
    "word/styles.xml",
    "word/numbering.xml",
    "word/footnotes.xml",
    "word/_rels/footnotes.xml.rels",
    "word/endnotes.xml",
    "word/_rels/endnotes.xml.rels",
    "[Content_Types].xml",
  ]);
  for (const [path, content] of Object.entries(original))
    if (!mutable.has(path)) output[path] = content;
  return Buffer.from(zipSync(output));
}

function isAncestor(ancestor: Element, node: Element): boolean {
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    if (parent === ancestor) return true;
  }
  return false;
}

function replaceText(paragraph: Element, oldText: string, newText: string): void {
  if (/[\r\n\t]/.test(oldText) || /[\r\n\t]/.test(newText))
    throw new Error(
      "DOCUMENT_TEXT_MULTILINE: replace_text accepts inline text; use replace_blocks for paragraphs.",
    );
  const nodes = Array.from(paragraph.getElementsByTagNameNS(W, "t"));
  const original = nodes.map((node) => node.textContent ?? "").join("");
  const start = original.indexOf(oldText);
  if (start < 0 || original.indexOf(oldText, start + 1) >= 0)
    throw new Error(
      "DOCUMENT_TEXT_NOT_UNIQUE: old_text must occur exactly once in the selected paragraph.",
    );
  const end = start + oldText.length;
  let offset = 0;
  for (const node of nodes) {
    const value = node.textContent ?? "";
    const next = offset + value.length;
    if (offset < end && next > start) {
      node.textContent =
        value.slice(0, Math.max(0, start - offset)) +
        (start >= offset ? newText : "") +
        value.slice(Math.max(0, end - offset));
      node.setAttributeNS(XML, "xml:space", "preserve");
    }
    offset = next;
  }
}

function applyParagraphLayout(paragraph: Element, layout: ParagraphLayout): void {
  const document = paragraph.ownerDocument;
  if (!document) throw new Error("DOCX paragraph has no owner document.");
  const originalProperties = direct(paragraph, "pPr");
  const properties = originalProperties ?? document.createElementNS(W, "w:pPr");
  if (!originalProperties) paragraph.insertBefore(properties, paragraph.firstChild);
  const property = (name: string): Element => {
    let element = direct(properties, name);
    if (!element) {
      element = document.createElementNS(W, `w:${name}`);
      const following = children(properties).find(
        (child) =>
          child.namespaceURI === W &&
          paragraphPropertyOrder.indexOf(child.localName) > paragraphPropertyOrder.indexOf(name),
      );
      properties.insertBefore(element, following ?? null);
    }
    return element;
  };
  const set = (element: Element, name: string, value: string | number) =>
    element.setAttributeNS(W, `w:${name}`, String(value));
  if (layout.align !== undefined) {
    set(property("jc"), "val", layout.align === "justify" ? "both" : layout.align);
    const content = children(paragraph).filter((node) => node !== properties);
    const only = content[0];
    if (content.length === 1 && only?.namespaceURI === M && only.localName === "oMath") {
      const mathParagraph = document.createElementNS(M, "m:oMathPara");
      paragraph.replaceChild(mathParagraph, only);
      mathParagraph.appendChild(only);
    }
    for (const mathParagraph of children(paragraph).filter(
      (node) => node.namespaceURI === M && node.localName === "oMathPara",
    )) {
      let mathProperties = children(mathParagraph).find(
        (node) => node.namespaceURI === M && node.localName === "oMathParaPr",
      );
      if (!mathProperties) {
        mathProperties = document.createElementNS(M, "m:oMathParaPr");
        mathParagraph.insertBefore(mathProperties, mathParagraph.firstChild);
      }
      let justification = children(mathProperties).find(
        (node) => node.namespaceURI === M && node.localName === "jc",
      );
      if (!justification) {
        justification = document.createElementNS(M, "m:jc");
        mathProperties.insertBefore(justification, mathProperties.firstChild);
      }
      justification.setAttributeNS(M, "m:val", layout.align === "justify" ? "left" : layout.align);
    }
  }
  if (layout.space_before !== undefined) {
    const spacing = property("spacing");
    set(spacing, "before", Math.round(layout.space_before * 20));
    spacing.removeAttributeNS(W, "beforeLines");
    spacing.removeAttributeNS(W, "beforeAutospacing");
  }
  if (layout.space_after !== undefined) {
    const spacing = property("spacing");
    set(spacing, "after", Math.round(layout.space_after * 20));
    spacing.removeAttributeNS(W, "afterLines");
    spacing.removeAttributeNS(W, "afterAutospacing");
  }
  if (layout.line_spacing !== undefined) {
    set(property("spacing"), "line", Math.round(layout.line_spacing * 240));
    set(property("spacing"), "lineRule", "auto");
  }
  for (const [key, attribute] of [
    ["first_line_indent", "firstLine"],
    ["indent_left", "left"],
    ["indent_right", "right"],
  ] as const) {
    if (layout[key] === undefined) continue;
    const indent = property("ind");
    set(indent, attribute, Math.round(layout[key] * 1440));
    indent.removeAttributeNS(W, `${attribute}Chars`);
    if (key === "first_line_indent") {
      indent.removeAttributeNS(W, "hanging");
      indent.removeAttributeNS(W, "hangingChars");
    }
  }
  for (const [key, tag] of [
    ["keep_with_next", "keepNext"],
    ["keep_together", "keepLines"],
    ["page_break_before", "pageBreakBefore"],
  ] as const)
    if (layout[key] !== undefined) set(property(tag), "val", layout[key] ? "1" : "0");
}
