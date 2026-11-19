# Excel Modeling and Spreadsheet Production

## Route

Before creating, editing, reading, formatting, validating, or opening a workbook,
load [workbook routes](work-spreadsheets/references/workbook-routes.md) with
`resource:"references/workbook-routes.md"`. Use `office_document` for native XLSX
inspection, creation, supported edits, and optional recalculation; use
`read_document` for grounded readback and the right-side preview for user inspection.
Do not claim to install or invoke the source `xlsx-viewer` plugin.

## Establish data meaning

Identify sources, reporting period, units/currency, row grain, keys, assumptions, output
metrics and intended user decisions. Inspect workbooks with office_document inspect;
retain sheet names, dimensions, formulas, number formats, source SHA and warnings. Never
mistake a CSV extraction for a complete description of workbook behavior or formatting.

Separate raw inputs, assumptions, calculations and report outputs into named sheets or
clearly marked sections. Preserve source rows and identifiers. Use dates as real dates,
numbers as numbers, identifiers as text and blanks deliberately. Do not silently coerce
leading zeros, ambiguous dates, percentages, missing data or "N/A" into numeric zero.

## Build native workbooks

Use office_document create_spreadsheet/edit_spreadsheet for typed cells, ranges,
formulas, formatting, tables, column widths, merges, frozen headers and filters. Apply
operations in batches and use the inspected SHA when editing. Keep an original copy;
unsupported macros, connections, pivots and external links need an explicit preservation
or rejection strategy. Never recreate a complex old workbook from CSV.

When the workbook is a report, dashboard or print artifact, load
[report surfaces](work-spreadsheets/references/report-surfaces.md) before choosing ranges,
formats or page setup; use `resource:"references/report-surfaces.md"`.

Prefer formulas for derivations. Keep assumptions in cells and reference them, instead
of repeating hidden hard-coded factors. Use clear names, consistent absolute/relative
references and matching range boundaries. Guard division by zero deliberately; do not
wrap every error in IFERROR to hide incorrect inputs. Separate forecast assumptions from
historical actuals and show the calculation logic.

For financial models distinguish income, balance, cash flow, opening/closing balances,
timing and signs. Reconcile cash movement and balance identities. For operational tables
reconcile counts/sums by period/category and inspect duplicates/missing keys. For scenario
workbook inputs state base/upside/downside assumptions and compare like-for-like periods.

## Visual and interaction quality

Provide a short title with period and units. Use a consistent header fill, readable font,
aligned numeric columns and meaningful number formats: currency, percentage, integer,
date and decimals. Keep input cells visually identifiable and legend any convention.
Freeze labels, set practical column widths and wrap long labels. Prefer filters and
native tables over decorative merged grids. Merge only titles, never source data areas.
Choose chart type by the question; avoid 3D, unjustified dual axes and misleading scales.

## Verify formulas and final output

Inspect the saved workbook, formula inventory, critical cells and warnings. Check
dimensions, sheets, ranges, totals, number formats and input-output identities. A written
formula is not a computed value. SheetJS/ExcelJS do not supply a calculation engine.
office_document verify may use installed Excel COM when allowed; otherwise mark formulas
not evaluated and avoid a claim that cached values are current. Verify key outputs and
errors after actual recalculation. Disclose unsupported functions, external dependencies
and visual checks that could not run. Deliver the editable XLSX with a concise account
of inputs, assumptions, calculated versus uncalculated status and remaining limitations.

