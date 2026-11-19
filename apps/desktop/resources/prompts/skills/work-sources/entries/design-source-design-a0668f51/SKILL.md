---
name: "design"
description: "设计工作流：交付物是写入工作区的 HTML 设计稿、可交互原型或 HTML 演示稿时使用，覆盖输入理解、新建与改版、品牌配色、视觉探索与审查。不负责对话内的交互视图 / mockup / 变体对比（用 visualize 插件），也不直接生成 .pptx 文件（需要 pptx 时调用 presentations 插件）。Design workflow for workspace deliverables: HTML design files, interactive prototypes and HTML slide decks, including UI/UX, color, brand and design review...."
---

# Design Source Entry

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-visual-design` with `use_skill` and its `resource:"references/template-catalog.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Classify the request as CREATE, REDESIGN, review, or design-system work and collect the audience, task, supplied assets, brand constraints, and target viewports.
2. Use the native work-visual-design workflow and its `resource:"references/template-catalog.md"` route as the execution contract. This catalog wrapper records the primary source version without presenting a nonexistent copied source file.
3. Use the source as the overall design router, but follow the current Mingshen design skill for CREATE, REDESIGN, review, design-system, output, and quality-check behavior.
4. Build an ordinary workspace HTML/CSS/JavaScript artifact or modify the existing project; do not emit ZCode artifact wrappers, host globals, comment markup, or a fake in-chat canvas.
5. Inspect the real desktop and narrow renders, exercising the principal interaction and implemented focus, loading, empty, error, and disabled states.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Route the primary design source | use_skill builtin:work-visual-design resource:"references/template-catalog.md" | available | The primary source is represented by this adapter and the native work-visual-design workflow; it has no standalone copied source file. |
| Follow craft, skeleton, or design-system cross-links | Normalize against references/design-resources and load through builtin:work-visual-design | available | Never use ../ directly and never infer filesystem access from a source link. |
| Create or redesign a workspace artifact | workspace file tools plus Mingshen browser inspection | available | Approved workspace writes, local assets, and actual rendered evidence are required. |
| Use ZCode canvas, pinned comments, host globals, or scripted template dependencies | No compatible host route | unavailable | Translate the visual intent to standalone HTML or the existing project and state any omitted behavior. |

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
