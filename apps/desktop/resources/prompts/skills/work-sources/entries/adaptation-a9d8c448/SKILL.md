---
name: "pptx-viewer"
description: "Current PowerPoint viewer source adapted for slide reading, note extraction, downstream reuse and graceful preview fallback. This adaptation may be shared by multiple source versions with identical bytes."
---

# PowerPoint Viewer Source 0.2.1/0.2.2

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-presentations` with `use_skill` and its `resource:"references/deck-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Determine whether the user wants to discuss a slide, extract deck content, compare elements, or check a newly created deck.
2. Read the requested slides and notes, preserving returned slide and shape anchors.
3. Use the current Mingshen rendered preview for layout or chart questions; if unavailable, continue with structure and label the limitation.
4. Route extraction into downstream Word, PDF or analysis work with slide references intact.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Read a slide range, shape text, tables, or notes | read_document and office_document inspect | available | Preserve slide references and inspect complete relevant slides. |
| Visual review of charts, overflow, collisions, or generated slides | office_document verify with render:true plus returned page-image inspection | conditional | Rendering success is separate from actually seeing and approving every slide. |
| ZCode selection or capture APIs | No Mingshen equivalent | unavailable | Do not infer unseen slide pixels or host coordinates. |

## Mingshen execution

- Use current read and preview tools only; there is no ZCode side panel.
- Do not use the viewer to claim that a deck was edited.
- Report unsupported embedded objects and font assumptions.

## Verification

- Reconcile extracted text and notes with the relevant slide range.
- Use actual rendered slides for visual evidence.
- Report missing images, charts, notes or unsupported objects.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
