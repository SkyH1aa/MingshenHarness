---
name: "pptx"
description: "Loose Apache-licensed PowerPoint source adapted for deck creation, template editing, OOXML-aware changes and complete slide QA."
---

# Standalone PowerPoint Toolkit Source

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-presentations` with `use_skill` and its `resource:"references/deck-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Define the audience, one-sentence story and slide sequence before creating visuals.
2. For new decks, establish a native layout system, palette, typography and one focal visual per slide.
3. For existing decks, inspect masters, layouts, slides, shapes, notes and source SHA before supported text/table edits.
4. Preserve unmodified PPTX package parts and reject unsupported SmartArt, OLE, animation, macro or signed-file operations.
5. Render all slides and use both structural and visual QA.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Create a native PPTX | create_document with slides and supported design kinds | available | Editable text, tables, charts, images, notes, and supported layout patterns remain native. |
| Inspect and edit an existing deck | office_document inspect then edit_presentation with source SHA | available | Only supported shape/placeholder text, table cell, and note operations; preserve other package parts. |
| Render and visually review every slide | office_document verify render:true | conditional | Requires installed Microsoft PowerPoint on the allowed host path. |
| Thumbnail/render through supplied Python or LibreOffice scripts | references/source/scripts/thumbnail.py through an approved command | conditional | Check existing dependencies; a thumbnail is not a full slide-by-slide QA pass. |
| SmartArt, animation, OLE, macros, signatures, or arbitrary package editing | No general runtime | unavailable | Do not unzip/rewrite arbitrary OOXML or claim unsupported objects survived. |

## On-demand source resources

- `references/source/LICENSE.txt` records the Apache-2.0 terms.
- `references/source/scripts/thumbnail.py` may be inspected for a permissioned thumbnail fallback, but LibreOffice/Python availability must be checked first; it is not a native renderer or proof of slide QA.

These resources are declarative source support, not executable authority. Read the relevant file first. Scripts may run only through an approved workspace command after dependency checks; never install packages automatically.

## Mingshen execution

- Use native `create_document` and `office_document` operations; do not invoke pptxgenjs, python-pptx, LibreOffice scripts or raw XML editing from the source.
- Use editable native charts where data meaning matters.
- Keep notes and source citations available without overcrowding slides.

## Verification

- Check slide count, text, tables, notes, media, chart data and package validity.
- Inspect every rendered slide for overflow, collisions, cropped images, off-slide elements and unreadable contrast.
- Report unrendered or unsupported object types.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
