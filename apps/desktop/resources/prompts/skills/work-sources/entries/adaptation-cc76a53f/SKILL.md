---
name: "pptx"
description: "Professional presentation source adapted for narrative hierarchy, visual composition, charting, template fidelity and rendered-slide review. This adaptation may be shared by multiple source versions with identical bytes."
---

# Presentation Production Source

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-presentations` with `use_skill` and its `resource:"references/story-and-layout.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Build a storyboard with one message per slide and a deliberate opening, evidence sequence, recommendation and close.
2. Choose a topic-specific color system with one dominant tone, supporting neutrals and a restrained functional accent.
3. Use a consistent grid, type scale, margin system and visual motif; vary layouts according to the evidence.
4. Prefer native editable charts and diagrams to screenshots or generic card grids.
5. For existing decks, preserve master/layout identity and use sourced SHA-bound supported edits.
6. Render every slide and revise the actual source after inspection.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Research story, audience, and slide sequence | web research plus native presentation and artifact-quality skills | available | Use grounded facts, one message per slide, and a deliberate opening/evidence/close. |
| Build a designed deck | create_document with native slide kinds, charts, tables, images, and notes | available | Use topic-specific palette, stable grid, and evidence-led visual choices. |
| Edit an existing deck by stable IDs | office_document inspect/edit_presentation | available | Preserve source SHA and unsupported package parts. |
| Render every slide for layout proof | office_document verify render:true | conditional | Office availability and one-owned-instance cleanup rules apply; otherwise mark rendering unverified. |

## Mingshen execution

- Use `create_document` and supported `office_document` operations; never invoke source pptxgenjs, python-pptx or LibreOffice commands.
- Use relevant approved media and preserve aspect ratio and rights.
- Do not invent metrics, quotes, images or citations to complete a composition.

## Verification

- Check narrative order, factual consistency, pacing, source notes and editability.
- Inspect all slides for overflow, collisions, chart legibility, footer alignment and font substitution.
- Report structural rendering separately from full visual review.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
