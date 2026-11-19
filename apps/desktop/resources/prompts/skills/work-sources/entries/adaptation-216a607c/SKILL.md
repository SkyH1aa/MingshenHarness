---
name: "xlsx-viewer"
description: "Legacy 0.2.0 Excel viewer workflow adapted to sheet- and cell-grounded reading with explicit formula status. This adaptation may be shared by multiple source versions with identical bytes."
---

# Excel Viewer Source 0.2.0

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-spreadsheets` with `use_skill` and its `resource:"references/workbook-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Read the requested sheet or range and use only cell references returned by the tool.
2. Separate stored values, formulas, cached results and uncalculated formulas.
3. Quote only the relevant cells and include row/column context when interpreting a formula.
4. Use the native spreadsheet editor for requested changes and recalculation.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Read targeted sheets, ranges, formulas, and cached values | read_document plus office_document inspect | available | Keep sheet and cell coordinates and distinguish formula from cached result. |
| Recalculate or render for visual review | office_document verify | conditional | Requires allowed Microsoft Excel; otherwise formulas remain uncalculated and layout unverified. |
| Use the ZCode Spreadsheets panel or client-side formula engine | No compatible panel/runtime | unavailable | Use native structured tools and never invent recalculated values. |

## Mingshen execution

- Do not invent the ZCode Spreadsheets panel or a client-side formula engine.
- Legacy XLS, XLSM, CSV and TSV must use supported read paths rather than being mislabeled as XLSX preview.
- Do not paste whole sheets into chat.

## Verification

- Confirm sheet and range actually read.
- Check formula dependencies around the selected range.
- For displayed values, state whether they were cached in file or actually recalculated.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
