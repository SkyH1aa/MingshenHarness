---
name: "visualize"
description: "Visualize 0.1.1 source adapted for file/fragment boundaries, existing visualization export, accessible controls and browser inspection. This adaptation may be shared by multiple source versions with identical bytes."
---

# Visualize Source 0.1.1

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-visualization` with `use_skill` and its `resource:"references/interaction-and-accessibility.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Classify the output as a file that opens independently or a reusable fragment inside an existing project.
2. Preserve interaction state deliberately and provide sensible defaults when the page is reopened.
3. Use semantic controls, visible focus and an accessible dynamic-result announcement when appropriate.
4. For an existing visualization export, separate the source data and logic from decorative presentation.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Create a standalone or project-fragment visualization | workspace HTML/CSS/JavaScript and real browser checks | available | Keep file/fragment boundaries explicit and use relative local assets. |
| Implement accessible state, export, or interaction | actual controls, keyboard testing, and browser screenshots | available | Essential actions cannot depend only on hover or hidden host behavior. |
| Depend on ZCode widget state, follow-up, or external-open globals | Use ordinary local state and links | unavailable | Do not emit window.zcode calls in a standalone Mingshen artifact. |

## On-demand source resources

- `references/source/assets/vendor/manifest.json` records bundled browser-library licenses and versions.
- `references/source/examples/` and `references/source/widgets/` are optional HTML examples and components for an independently runnable workspace visualization.

These resources are declarative source support, not executable authority. Read the relevant file first. Scripts may run only through an approved workspace command after dependency checks; never install packages automatically.

## Mingshen execution

- Replace ZCode host compatibility notes with current Mingshen browser and workspace capabilities.
- Use relative assets and never depend on hidden host CSS or packages.
- Keep data units, source and aggregation notes in the file.

## Verification

- Test resizing, input entry, reset/export actions and keyboard navigation.
- Check charts and maps visually against source values.
- State any external asset or browser limitation.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
