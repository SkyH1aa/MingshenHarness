---
name: "xlsx"
description: "Professional spreadsheet source adapted for typed data, live formulas, report surfaces, financial models and verified recalculation. This adaptation may be shared by multiple source versions with identical bytes."
---

# Spreadsheet Production Source

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-spreadsheets` with `use_skill` and its `resource:"references/workbook-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Establish row grain, units, keys, assumptions, outputs and intended decisions before creating a workbook.
2. Separate inputs, calculations and reports; preserve identifiers and use typed cells and native tables.
3. Keep derivations as visible formulas that reference assumption cells and remain stable when rows move.
4. Choose formatting, number formats, column widths, freeze panes, filters and print setup for the actual reading task.
5. For financial models reconcile movement, balances, signs and scenario assumptions.
6. Recalculate with an allowed Office runtime and inspect formulas and critical outputs.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Create a typed workbook with formulas, tables, styling, and print surfaces | office_document create_spreadsheet | available | Separate inputs, calculations, and reports; never store numeric identities as text accidentally. |
| Inspect and edit an existing workbook | office_document inspect then edit_spreadsheet with source SHA | available | Use the smallest supported operation set and preserve unsupported package features. |
| Recalculate formulas and export a review PDF | office_document verify with recalculate/render/output_path | conditional | Only installed Microsoft Excel on the allowed host proves recalculation; ExcelJS formula strings are not calculated results. |
| Charts, pivots, Power Query, VBA, ActiveX, external connections, or slicers inside XLSX | No general workbook operation | unavailable | Create a native chart in PPTX when appropriate or state the missing XLSX capability. |

## Mingshen execution

- Use `office_document` and current spreadsheet capabilities; do not invoke source setup, chart, VBA or LibreOffice scripts.
- Do not recreate a complex workbook from a CSV extraction.
- Avoid 3D charts, hidden hard-coded factors and error suppression that conceals bad inputs.

## Verification

- Check dimensions, sheet roles, formulas, cached values, errors, number formats and print areas.
- Reconcile totals and critical identities after actual recalculation.
- When recalculation is unavailable, mark formulas not calculated instead of asserting cached results are current.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
