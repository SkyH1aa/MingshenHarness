---
name: "docx-viewer"
description: "Legacy 0.2.0 Word viewer workflow adapted to grounded reading and the current Mingshen document preview. This adaptation may be shared by multiple source versions with identical bytes."
---

# Word Viewer Source 0.2.0

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-word` with `use_skill` and its `resource:"references/document-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Read the document through `read_document` and use only paragraph, table, cell or cursor references returned by the tool.
2. Treat a user-supplied paragraph or table reference as a precise pointer; load the surrounding content before interpreting it.
3. Answer the specific question and quote only the shortest relevant passage instead of copying the whole document.
4. For layout, image or formatting questions, use the current right-side rendered preview when available.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Read paragraphs, tables, or a grounded location | read_document and the current preview | available | Only use anchors returned by the active tools. |
| Inspect visual layout | current preview plus office_document verify with render:true when allowed | conditional | A text extraction alone cannot prove pagination or visual layout. |
| Invoke ZCode viewer tools or edit through the viewer | No compatible tool | unavailable | Route all mutations through the native Word editor. |

## Mingshen execution

- The source ZCode Documents panel is not present; never invent `open_document`, `show_in_viewer`, `get_view` or `capture_view` calls.
- Use the current Mingshen preview route and real document tools only.
- Do not claim an edit through a viewer; route changes back through the Word editor workflow.

## Verification

- Confirm the source SHA and the location read before answering.
- If a visual preview is unavailable, state that the response is based on extracted structure only.
- Keep table values and formulas distinct from visual formatting conclusions.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
