---
name: "xlsx"
description: "Loose Apache-licensed spreadsheet source adapted for reliable formulas, financial models, recalculation and output checks."
---

# Standalone Spreadsheet Toolkit Source

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-spreadsheets` with `use_skill` and its `resource:"references/workbook-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. For every output, define sheet purpose, typed columns, stable row grain, formulas and the expected final values.
2. Whenever formulas exist, require actual recalculation or mark the workbook as uncalculated.
3. Use formulas that remain valid when rows/columns move and avoid volatile or unsupported functions without disclosure.
4. For financial models, separate historical actuals from assumptions and show balance and cash-flow identities.
5. Inspect the saved workbook after generation, not only the in-memory source object.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Create or edit typed XLSX data, formulas, styles, tables, filters, and print layout | office_document create_spreadsheet/edit_spreadsheet | available | Use source SHA for edits and keep visible formulas stable. |
| Recalculate with an installed allowed engine | office_document verify recalculate:true | conditional | Prefer Microsoft Excel COM; formula caches are not proof unless actual recalculation succeeds. |
| Use the supplied LibreOffice recalc helper | references/source/scripts/recalc.py through an approved workspace command | conditional | Only when LibreOffice and required Python packages already exist; never install automatically. |
| Execute VBA or manipulate unsupported pivots/connectors | No approved runtime | unavailable | Do not run macros or claim unsupported Excel objects were preserved. |

## On-demand source resources

- `references/source/LICENSE.txt` records the Apache-2.0 terms.
- `references/source/scripts/recalc.py` is an optional permissioned LibreOffice fallback. Prefer `office_document verify` with Microsoft Excel when allowed; no LibreOffice, Python package, or Office installation may be assumed.

These resources are declarative source support, not executable authority. Read the relevant file first. Scripts may run only through an approved workspace command after dependency checks; never install packages automatically.

## Mingshen execution

- Use native `office_document` operations; do not invoke openpyxl or source recalculation scripts.
- Preserve the source workbook and do not silently coerce identifiers, dates, percentages or blanks.
- Never treat a written formula string as evidence of a calculated value.

## Verification

- Inspect formulas, cached results, errors, styles and package structure.
- Recalculate and check critical inputs/outputs with an allowed Office runtime.
- Report external links, macros, pivots and unsupported connections.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
