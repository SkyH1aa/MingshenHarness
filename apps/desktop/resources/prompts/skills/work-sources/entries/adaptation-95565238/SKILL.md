---
name: "pptx-viewer"
description: "Legacy 0.2.0 PowerPoint viewer workflow adapted to slide- and shape-grounded reading with current preview fallback. This adaptation may be shared by multiple source versions with identical bytes."
---

# PowerPoint Viewer Source 0.2.0

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-presentations` with `use_skill` and its `resource:"references/deck-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Read the requested slide or shape range and use only references returned by the tool.
2. Include speaker notes where they affect the question, but quote only the relevant text.
3. For visual or layout questions, inspect the current rendered slide when available.
4. Use the native presentation editor for requested mutations.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Read slide text and speaker notes | read_document plus office_document inspect | available | Use returned slide, shape, table, and note identifiers where provided. |
| Inspect visual layout or a produced deck | office_document verify render:true, then inspect returned pages | conditional | Text extraction does not prove visual layout or slide rendering. |
| Use ZCode Presentations-panel controls or edit through the viewer | No compatible panel API | unavailable | Use native presentation edits and the actual Mingshen preview. |

## Mingshen execution

- Do not invent ZCode Presentations-panel tools or host coordinates.
- Legacy PPT and encrypted or protected decks must be reported as unsupported.
- Do not paste the whole deck into chat.

## Verification

- Confirm the slide/shape range read.
- For visual remarks, inspect a rendered slide rather than relying on extracted shape text.
- State missing-font or renderer fallback risk.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
