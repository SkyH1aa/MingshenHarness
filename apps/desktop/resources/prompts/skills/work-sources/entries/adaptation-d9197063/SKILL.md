---
name: "frontend-design"
description: "Loose frontend-design source adapted for subject-led visual direction, intentional typography, implementation and self-critique."
---

# Frontend Design Source

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-visual-design` with `use_skill` and its `resource:"references/design-brief.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Ground the visual direction in the actual subject, audience and content rather than choosing a generic trend.
2. Plan hierarchy, typography, spacing, color, imagery and interaction before writing page-level styles.
3. Review the plan against the brief, implement the real experience, then critique the rendered result.
4. Use restraint: every visual choice should clarify hierarchy or meaning.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Create a subject-led page or component | workspace file tools, native design resources, browser screenshots | available | Inspect the actual implementation and require real content and assets. |
| Critique and revise a rendered interface | browser inspection plus a screenshot-and-fix loop | available | Visual conclusions require readable rendered evidence. |
| Use ZCode-only design canvas or host APIs | No compatible host route | unavailable | Produce ordinary standalone HTML or modify the user's real project. |

## Mingshen execution

- Load the current template catalog only when a starting skeleton helps the task.
- Prefer real content and relevant local media; do not manufacture decorative filler.
- Use current browser inspection rather than a ZCode design surface.

## Verification

- Inspect desktop and mobile layouts and all primary interaction states.
- Check hierarchy, readability, contrast, focus visibility, overflow and unsupported claims.
- Revise the actual artifact after reviewing screenshots and interactions.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
