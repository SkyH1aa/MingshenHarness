---
name: "pdf-viewer"
description: "Current PDF viewer source adapted for precise page reading, scanned-page fallback and downstream content extraction. This adaptation may be shared by multiple source versions with identical bytes."
---

# PDF Viewer Source 0.2.2/0.2.3

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

1. Determine whether the request is page discussion, extraction for another task, or a visual check of a newly produced PDF.
2. Read relevant line windows with `char_offset`, retain returned `[Page N]` labels and the continuation cursor, and use `render:true` when exact page images are required.
3. When it is a scanned or visual PDF, use the current rendered preview/page image path instead of pretending extracted text is complete.
4. For downstream work, preserve page numbers and source identity with extracted text, tables or figure notes.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Discuss or extract exact pages | read_document with line windows, char_offset and render:true for page images | available | Keep returned `[Page N]` and image labels with the continuation cursor and source identity. |
| Check scanned pages, charts, forms, or produced PDF layout | read_document render:true and returned page images | conditional | Visual claims require page images; native OCR does not guarantee handwriting or form semantics. |
| Use show_in_viewer, get_view, capture_view, or ZCode panel controls | No Mingshen equivalent | unavailable | Never invent panel tools or treat the right-side preview as model-visible evidence. |

## Mingshen execution

- Use current Mingshen read and preview capabilities; the ZCode side-panel contract is not available.
- Do not claim encryption, OCR or form completion unless a real tool performed it.
- Do not rewrite the PDF merely to answer a reading question.

## Verification

- Check extracted content against representative page images.
- For visual checks, inspect the rendered page rather than only metadata.
- Report unreadable, encrypted or omitted pages.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
