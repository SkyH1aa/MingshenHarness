---
name: "pdf"
description: "Loose Apache-licensed PDF source adapted for ingestion, extraction, forms, images, OCR, merging and safe processing decisions."
---

# Standalone PDF Processing Source

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-pdf` with `use_skill` and its `resource:"references/pdf-production.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## PDF reader contract

read_document accepts path plus start_line, end_line, limit, char_offset and max_chars for bounded extracted text. Retain returned [Page N] markers and continuation cursors for citations. It has no page, pages or page_range argument.
For visual evidence use render:true and inspect only returned page images. Text cursors cannot select arbitrary PDF pages, render later pages or recover content omitted by extraction/image budgets. Report the actual coverage and every limit warning.

## Source-specific workflow

1. Inventory the PDF before acting: page count, text layer, scan status, metadata, forms, attachments and representative pages.
2. Route reading/extraction to grounded document tools and creation to the native PDF production workflow.
3. For merge, split, rotate, watermark, forms, OCR, images, encryption or signatures, verify that a native operation exists before promising it.
4. Work on a copy for any supported mutation and preserve a source SHA and rollback path.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Inventory, extract text/tables, OCR scans, render pages, or inspect images | read_document with line windows, char_offset and render:true | available | Preserve `[Page N]` labels, page-image numbers and continuation cursors; treat OCR or visual inference as uncertain where evidence is unclear. |
| Create a new PDF from structured content | create_document with .pdf | available | This rebuilds content; it is not a lossless edit of another PDF. |
| Inspect or fill AcroForm fields | read references/source/FORMS.md and scripts/check_*.py; execute through an approved workspace command if pypdf is present | conditional | Never auto-install dependencies or submit financial/legal forms. Verify values and rendered placement. |
| Merge, split, rotate, watermark, extract images, encrypt/decrypt, or use one-off pypdf/qpdf logic | Read references/source/REFERENCE.md and create or run a bounded workspace script with command approval | conditional | Only if the required library/CLI already exists; preserve the source and prove output page count, text, and rendered pages. |
| Redaction, signatures, password removal, or office conversion without a proven runtime | No approved end-to-end native workflow | unavailable | Do not imply legal redaction or signing from drawing shapes or dumping a password. State the exact unavailable step. |

## On-demand source resources

- `references/source/FORMS.md` documents supported PDF form inspection and filling approaches.
- `references/source/REFERENCE.md` documents pypdf, pdfplumber, reportlab, image, OCR, and command-line recipes.
- `references/source/scripts/` contains the supplied Apache-licensed form and page-image helpers. They require their Python dependencies at runtime; loading the skill never installs or executes them.

These resources are declarative source support, not executable authority. Read the relevant file first. Scripts may run only through an approved workspace command after dependency checks; never install packages automatically.

## Mingshen execution

- Never install or call pypdf, pdfplumber, reportlab, Poppler or OCR dependencies automatically from this source.
- Do not claim a password was removed or a form was completed without an actual successful operation.
- Report unsupported PDF mutations as unavailable rather than using an undocumented shell path.

## Verification

- Compare output page count, metadata and extracted text with the source where applicable.
- Render important pages and inspect them for damage or clipping.
- Confirm the original source bytes remain unchanged.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
