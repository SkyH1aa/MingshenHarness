---
name: "docx-viewer"
description: "Current Word viewer source adapted for grounded extraction, downstream reuse and graceful fallback without the ZCode panel. This adaptation may be shared by multiple source versions with identical bytes."
---

# Word Viewer Source 0.2.1/0.2.2

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-word` with `use_skill` and its `resource:"references/document-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Establish whether the task is viewing, asking about a location, extracting content for downstream work, or checking a file just produced.
2. Read the requested paragraphs or tables and retain returned anchors/cursors as the only valid location references.
3. For extraction, preserve headings, lists, tables, notes and source identity in a structured result suitable for the next task.
4. Open the current Mingshen document preview for visual questions when available; otherwise continue with grounded readback and clearly label the missing render.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Read bounded or structured Word document content | read_document with structure:true | available | Retain returned structural anchors and cursor boundaries for long content. |
| Check a newly generated DOCX | read_document plus office_document verify with render:true | conditional | Rendering and visual inspection are distinct from successful package readback. |
| Use selection, scroll, or capture APIs from the ZCode panel | No Mingshen equivalent | unavailable | Use the actual right-side preview for the user and never infer unseen pixels. |

## Mingshen execution

- Use `read_document` and current preview capabilities; the source panel and ZCode local-workspace restriction are not runtime dependencies.
- Do not paste whole documents into chat or make unsupported claims about pagination.
- Use the native editor route for any requested mutation.

## Verification

- Reconcile extracted text with tables and section structure.
- Check that no visual conclusion was inferred from plain text extraction.
- Report any missing content, encrypted portions or unsupported objects.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
