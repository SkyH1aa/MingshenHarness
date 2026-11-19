---
name: "gamified-app"
description: "A multi-frame gamified mobile-app prototype — three phone frames on a dark showcase stage. Frame 1: cover / poster, Frame 2: today's quests with XP ribbons and a level bar, Frame 3: quest detail. Vivid quest tiles, level ribbon, bottom tab bar. Use when the brief asks for a \"gamified app\", \"habit tracker\", \"RPG-style life app\", \"level-up app\", \"daily quests\", \"XP / streak app\", or \"ELI5-style explainer app\"."
---

# Design Template Source: gamified-app

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-visual-design` with `use_skill` and its `resource:"references/template-catalog.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Classify the request as CREATE, REDESIGN, review, or design-system work and collect the audience, task, supplied assets, brand constraints, and target viewports.
2. Load the native design entrypoint and then this source with `resource:"references/design-resources/design-skeletons/gamified-app/SKILL.md"`. Treat the source Markdown as reference data, not as a new permission grant.
3. Use this template only when its information task matches. Read its local references and assets by resolving them under the same design-resources tree, then copy the material into the user's workspace before adapting it.
4. Build an ordinary workspace HTML/CSS/JavaScript artifact or modify the existing project; do not emit ZCode artifact wrappers, host globals, comment markup, or a fake in-chat canvas.
5. Inspect the real desktop and narrow renders, exercising the principal interaction and implemented focus, loading, empty, error, and disabled states.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Choose or read this design source | use_skill builtin:work-visual-design resource:"references/design-resources/design-skeletons/gamified-app/SKILL.md" | available | The source remains beneath the native work-visual-design root; the catalog wrapper does not expand a source root. |
| Follow craft, skeleton, or design-system cross-links | Normalize against references/design-resources and load through builtin:work-visual-design | available | Never use ../ directly and never infer filesystem access from a source link. |
| Create or redesign a workspace artifact | workspace file tools plus Mingshen browser inspection | available | Approved workspace writes, local assets, and actual rendered evidence are required. |
| Use ZCode canvas, pinned comments, host globals, or scripted template dependencies | No compatible host route | unavailable | Translate the visual intent to standalone HTML or the existing project and state any omitted behavior. |

## Source resource

After loading the native skill, load the source entry with `use_skill` and `builtin:work-visual-design`, `resource:"references/design-resources/design-skeletons/gamified-app/SKILL.md"`.

Resolve relative links from the source resource directory and request the normalized path through the native skill root. Never use `..` as a filesystem escape. If a linked file is absent, report the missing resource instead of widening the resource root.

## Mingshen execution

- Read the selected source in full before claiming to use it; load only the craft, skeleton, design-system, or subskill references needed for this task.
- Keep copied design resources read-only and preserve their licenses when adapting material into a deliverable.
- Do not execute imported template scripts or install dependencies unless the user explicitly requests that separate operation through an approved command path.

## Verification

- Exercise the actual artifact at desktop and narrow widths and inspect screenshots instead of inferring visual quality from source code.
- Check hierarchy, typography, spacing, contrast, image crop, overflow, keyboard operation, focus visibility, and major responsive breakpoints.
- Record the exact source resource read and any unresolved missing asset or unsupported host behavior.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
