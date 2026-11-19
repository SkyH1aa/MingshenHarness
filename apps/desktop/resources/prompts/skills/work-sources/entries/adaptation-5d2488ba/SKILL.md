---
name: "visualize"
description: "Current Visualize 0.1.2 source adapted to standalone HTML, exportable artifacts, host fallback and complete visual/data verification. This adaptation may be shared by multiple source versions with identical bytes."
---

# Visualize Source 0.1.2

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-visualization` with `use_skill` and its `resource:"references/standalone-html.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Select the smallest useful visualization form and define the exact question it must answer.
2. Profile the data, units and uncertainty before encoding it; never invent missing values.
3. Build a self-contained workspace artifact with direct labels, deliberate annotation and accessible controls.
4. Provide a clear export or reuse path if the source requested one, using workspace files rather than a hidden host runtime.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Select and build a small useful visualization | workspace artifact with local reviewed dependencies | available | Profile data first and make the first render useful without host-only behavior. |
| Export or reuse visualization assets | copy reviewed source assets into the workspace and inspect the result | available | Preserve vendor licenses and avoid network-only rendering. |
| Claim an inline chat widget or ZCode canvas | No compatible inline host | unavailable | Deliver a real local HTML/path or modify the existing project instead. |

## On-demand source resources

- `references/source/assets/vendor/manifest.json` records bundled browser-library licenses and versions.
- `references/source/examples/` and `references/source/widgets/` are optional HTML examples and components for an independently runnable workspace visualization.

These resources are declarative source support, not executable authority. Read the relevant file first. Scripts may run only through an approved workspace command after dependency checks; never install packages automatically.

## Mingshen execution

- The latest source's host compatibility layer is translated to current Mingshen browser behavior.
- Inline only reviewed dependencies and local assets; avoid network-only rendering.
- Do not claim an inline chat widget when the output is a local HTML file.

## Verification

- Inspect the actual rendered artifact at desktop and mobile sizes.
- Exercise primary and edge-state interactions and inspect returned screenshots.
- Verify labels, axes, aggregation, legends and responsive readability against the data.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
