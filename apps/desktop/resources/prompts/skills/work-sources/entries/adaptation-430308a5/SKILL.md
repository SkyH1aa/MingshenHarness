---
name: "pdf-viewer"
description: "Legacy 0.2.1 PDF viewer workflow adapted to page-grounded reading and the current Mingshen preview. This adaptation may be shared by multiple source versions with identical bytes."
---

# PDF Viewer Source 0.2.1

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

1. Use `read_document` with bounded line windows and `char_offset`; retain `[Page N]` labels and the continuation cursor as the only grounded locations.
2. Request `render:true` when the answer depends on an actual page image rather than extracted text.
3. When text extraction is empty, inspect a rendered page before concluding that the PDF has no content.
4. Quote only the relevant passage and route creation or mutation to the native PDF production workflow.
5. Open the current Mingshen PDF preview when the user needs to inspect a location visually.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Read PDF text or obtain a requested page image | read_document with line windows/char_offset or render:true | available | Use only `[Page N]` labels, page-image labels, line windows and cursors actually returned by the tool. |
| Visual inspection or scanned-page fallback | read_document with render:true | available | Distinguish returned page images from text extraction and report unreadable pages. |
| Open or animate the ZCode PDF side panel | No compatible panel API | unavailable | Use the actual Mingshen preview and never claim an unobserved selection or capture. |

## Mingshen execution

- Do not invent ZCode viewer controls or claim a file was edited through a viewer.
- Encrypted or unreadable pages must be reported as unavailable.
- Keep page references in the order used by the answer.

## Verification

- Confirm which `[Page N]` labels, line windows and rendered page images were actually returned.
- For visual questions, distinguish rendered inspection from extracted text.
- State when only a semantic text fallback was available.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
