import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const SAFE_XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const serializer = new XMLSerializer();

export function xlsxWithExternalLinkFixture(): Buffer {
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        `<Types xmlns="${CONTENT_TYPES_NS}">` +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/>' +
          "</Types>",
      ),
      "_rels/.rels": strToU8(
        `<Relationships xmlns="${RELATIONSHIPS_NS}">` +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ),
      "xl/workbook.xml": strToU8(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>' +
          '<externalReferences><externalReference r:id="rIdExternal"/></externalReferences>' +
          "</workbook>",
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<Relationships xmlns="${RELATIONSHIPS_NS}">` +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/>' +
          "</Relationships>",
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
      ),
      "xl/externalLinks/externalLink1.xml": strToU8(
        '<externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<externalBook r:id="rId1"/>' +
          "</externalLink>",
      ),
      "xl/externalLinks/_rels/externalLink1.xml.rels": strToU8(
        `<Relationships xmlns="${RELATIONSHIPS_NS}">` +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="https://attacker.invalid/book.xlsx" TargetMode="External"/>' +
          "</Relationships>",
      ),
    }),
  );
}

export function embedWorkbookInDocx(
  source: Buffer,
  workbook: Buffer,
  options: {
    includeContentType?: boolean;
    includeRelationship?: boolean;
    duplicateRelationship?: boolean;
    contentType?: string;
    relationshipTarget?: string;
  } = {},
): Buffer {
  const archive = unzipSync(source);
  archive["word/embeddings/item1.xlsx"] = new Uint8Array(workbook);

  if (options.includeContentType !== false) {
    const contentTypes = new DOMParser().parseFromString(
      strFromU8(archive["[Content_Types].xml"] ?? new Uint8Array()),
      "text/xml",
    );
    const override = contentTypes.createElementNS(CONTENT_TYPES_NS, "Override");
    override.setAttribute("PartName", "/word/embeddings/item1.xlsx");
    override.setAttribute("ContentType", options.contentType ?? SAFE_XLSX_CONTENT_TYPE);
    contentTypes.documentElement.appendChild(override);
    archive["[Content_Types].xml"] = strToU8(serializer.serializeToString(contentTypes));
  }

  if (options.includeRelationship !== false) {
    const relationships = new DOMParser().parseFromString(
      strFromU8(archive["word/_rels/document.xml.rels"] ?? new Uint8Array()),
      "text/xml",
    );
    const appendRelationship = (id: string) => {
      const relationship = relationships.createElementNS(RELATIONSHIPS_NS, "Relationship");
      relationship.setAttribute("Id", id);
      relationship.setAttribute(
        "Type",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package",
      );
      relationship.setAttribute("Target", options.relationshipTarget ?? "embeddings/item1.xlsx");
      relationships.documentElement.appendChild(relationship);
    };
    appendRelationship("rIdEmbeddedXlsx");
    if (options.duplicateRelationship) appendRelationship("rIdEmbeddedXlsxDuplicate");
    archive["word/_rels/document.xml.rels"] = strToU8(serializer.serializeToString(relationships));
  }

  return Buffer.from(zipSync(archive));
}

export function embedWorkbookInXlsx(
  source: Buffer,
  workbook: Buffer,
  options: {
    includeContentType?: boolean;
    includeRelationship?: boolean;
    duplicateRelationship?: boolean;
    contentType?: string;
    relationshipTarget?: string;
    partName?: string;
  } = {},
): Buffer {
  const archive = unzipSync(source);
  const partName = options.partName ?? "xl/embeddings/item1.xlsx";
  archive[partName] = new Uint8Array(workbook);

  if (options.includeContentType !== false) {
    const contentTypes = new DOMParser().parseFromString(
      strFromU8(archive["[Content_Types].xml"] ?? new Uint8Array()),
      "text/xml",
    );
    const override = contentTypes.createElementNS(CONTENT_TYPES_NS, "Override");
    override.setAttribute("PartName", `/${partName}`);
    override.setAttribute("ContentType", options.contentType ?? SAFE_XLSX_CONTENT_TYPE);
    contentTypes.documentElement.appendChild(override);
    archive["[Content_Types].xml"] = strToU8(serializer.serializeToString(contentTypes));
  }

  if (options.includeRelationship !== false) {
    const relationships = new DOMParser().parseFromString(
      strFromU8(archive["xl/_rels/workbook.xml.rels"] ?? new Uint8Array()),
      "text/xml",
    );
    const appendRelationship = (id: string) => {
      const relationship = relationships.createElementNS(RELATIONSHIPS_NS, "Relationship");
      relationship.setAttribute("Id", id);
      relationship.setAttribute(
        "Type",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package",
      );
      relationship.setAttribute(
        "Target",
        options.relationshipTarget ?? partName.replace(/^xl\//, ""),
      );
      relationships.documentElement.appendChild(relationship);
    };
    const relationshipId = `rIdEmbeddedXlsxFixture_${partName.replace(/[^a-z0-9]/gi, "")}`;
    appendRelationship(relationshipId);
    if (options.duplicateRelationship) appendRelationship(`${relationshipId}Duplicate`);
    archive["xl/_rels/workbook.xml.rels"] = strToU8(serializer.serializeToString(relationships));
  }

  return Buffer.from(zipSync(archive));
}
