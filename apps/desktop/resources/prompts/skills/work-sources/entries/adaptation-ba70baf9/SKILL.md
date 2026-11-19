---
name: "visualize"
description: "Visualize 0.1.0 source adapted from its inline host contract to standalone workspace HTML with accessible interaction and browser QA. This adaptation may be shared by multiple source versions with identical bytes."
---

# Visualize Source 0.1.0

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-visualization` with `use_skill` and its `resource:"references/standalone-html.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Decide whether the question needs a static table, simple SVG, standalone HTML explainer, simulation or map.
2. Start with the viewer's question and one primary visual, not a grid of decorative cards.
3. Translate the source inline-output idea into a real workspace HTML file with inline CSS, JavaScript and truthful data.
4. Use direct labels and visible interaction states; do not require hover to reveal essential information.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Build a standalone interactive visualization | workspace HTML/CSS/JavaScript plus browser inspection | available | Use truthful data and a primary visual rather than decorative filler. |
| Reuse supplied visualization examples or vendor assets | references/source/examples, widgets, and assets | available | Read the vendor manifest and preserve separate browser-library licenses. |
| Emit ZCode inline wrappers, runtime globals, or hidden host CSS | Translate to a normal workspace file | unavailable | Do not claim an inline visualization surface or host persistence API. |

## On-demand source resources

- `references/source/assets/vendor/manifest.json` records bundled browser-library licenses and versions.
- `references/source/examples/` and `references/source/widgets/` are optional HTML examples and components for an independently runnable workspace visualization.

These resources are declarative source support, not executable authority. Read the relevant file first. Scripts may run only through an approved workspace command after dependency checks; never install packages automatically.

## Mingshen execution

- Do not emit ZCode host wrappers, runtime globals, host CSS or private visualization references.
- Do not load unsupported remote chart libraries or expose tokens and private data.
- Open the real file in Mingshen's browser.

## Verification

- Exercise every control with pointer and keyboard input.
- Inspect desktop and narrow screenshots and the browser console.
- Verify rendered values against the source data.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
