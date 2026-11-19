---
name: "pdf-reading"
description: "Independent PDF reading workflow covering content inventory, text and table extraction, page rendering, forms and scanned documents without copying the proprietary source."
---

# PDF Reading and Inspection

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-pdf` with `use_skill` and its `resource:"references/pdf-viewer.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## PDF reader contract

read_document accepts path plus start_line, end_line, limit, char_offset and max_chars for bounded extracted text. Retain returned [Page N] markers and continuation cursors for citations. It has no page, pages or page_range argument.
For visual evidence use render:true and inspect only returned page images. Text cursors cannot select arbitrary PDF pages, render later pages or recover content omitted by extraction/image budgets. Report the actual coverage and every limit warning.

## Source-specific workflow

1. Inventory page count, text layer, metadata, embedded attachments, form fields and representative visual pages.
2. Sample selectable text and detect scanned pages early; never infer that an empty text extraction means an empty page.
3. Read bounded line windows and continue with `char_offset`; preserve `[Page N]` labels, page-image labels and cursor boundaries for long documents.
4. For tables, inspect spatial alignment and nearby headings instead of flattening every number into one line.
5. For forms or embedded files, report whether the current tool can inspect them and avoid destructive changes.
6. Use page rendering for layout, charts, stamps, handwriting and scan fidelity.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Content inventory and text extraction | read_document with line windows, char_offset, and render:true for page images | available | Use returned `[Page N]` and image labels; report missing text layers, encoding loss, and omitted pages. |
| Scanned-page and visual inspection | read_document with render:true; built-in OCR where supported | conditional | OCR is offline Chinese/English and may be inaccurate; handwriting and complex tables need visual confirmation. |
| Form fields, attachments, or embedded-media inventory | Only if the current readback proves the object | conditional | Do not assume Poppler, pypdf, pdfplumber, or attachment extraction is installed. |
| Mutation or proprietary PDF-reading runtime | No compatible source runtime | unavailable | The source is reference-only; its prose, scripts, and private runtime are not redistributed. |

## Mingshen execution

- This adaptation is independently written after reviewing capability requirements; no proprietary source body, code or assets are redistributed.
- Use current `read_document` and preview tools only; do not assume Poppler, OCR, pdfplumber or attachment extraction is installed.
- Keep upload-only Chat constraints separate from WorkAgent filesystem access.

## Verification

- Reconcile extracted text with page images for representative and high-risk pages.
- Identify missing text layers, tables that cross pages, form values and unreadable regions.
- State whether the result came from text extraction, rendered visual inspection, or both.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
