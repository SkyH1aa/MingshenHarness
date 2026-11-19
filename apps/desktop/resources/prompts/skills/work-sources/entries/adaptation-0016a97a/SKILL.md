---
name: "pdf"
description: "Professional PDF production source adapted for report, creative, academic, resume and existing-file routes with print preflight. This adaptation may be shared by multiple source versions with identical bytes."
---

# PDF Production Source

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

1. Triage the task as report, creative layout, academic/math, resume, conversion, or an existing-PDF operation with a bounded supported scope.
2. Record audience, page size, language, required fonts, citations, brand assets and whether text must remain selectable.
3. Choose the native document structure by content job; use real page geometry, figures, tables and captions rather than decorative bands.
4. For Office conversion, distinguish a rendered export from a rebuilt PDF and preserve the source Office file.
5. Run structural readback and page-by-page render inspection before delivery.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Create a report, poster, resume, academic, or one-page PDF | create_document with a .pdf path | available | Use native selectable text, supported tables/equations/images, and explicit page geometry. |
| Read, review, extract, or visually inspect a PDF | read_document with line/character cursors; render:true returns bounded page images | available | Built-in OCR is used for scanned pages where the reader supports it; handwriting remains uncertain. |
| Export DOCX/XLSX/PPTX to PDF with visual evidence | office_document verify with render:true and a new render_path | conditional | Requires installed Microsoft Office on the allowed host path; unavailable/in-use results must not be called verified. |
| Merge, split, rotate, crop, watermark, fill forms, redact, sign, encrypt, or losslessly edit PDFs | No native PDF mutation operation | unavailable | Explain the exact missing operation; do not fake it through create_document or a viewer. |

## Mingshen execution

- Use `create_document`, `read_document` and supported `office_document verify` operations; never call source Python, LaTeX, Playwright, OCR or signing scripts.
- Declare unsupported merge, split, rotate, arbitrary PDF editing, signing, redaction and encryption instead of faking them.
- Use only approved local images and verify aspect ratio, resolution and rights.

## Verification

- Check page count, searchable text, headings, tables, links, fonts and package metadata.
- Inspect every available page image for clipping, orphan headings, blank pages, image crop and unreadable contrast.
- State structural success and visual success separately.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
