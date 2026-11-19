# Workbook routes

## Inspect

Always inspect a source workbook before editing it:

```json
{"operation":"inspect","path":"经营分析.xlsx"}
```

Use the returned SHA-256, sheet names, dimensions, formulas, styles, tables, warnings,
and bounded cell inventory. The inventory is structural evidence, not a screenshot of
the worksheet and not a complete calculation audit.

For a new workbook, define:

1. Reporting period, audience, currency, units, and row grain.
2. Inputs, assumptions, calculations, outputs, and quality checks.
3. Sheet order and named ranges or repeatable formulas.
4. Which cells are editable inputs and which are locked calculations.
5. Print area and report surface when the workbook is meant to be read as a report.

## Create

Use `office_document` with `"operation":"create_spreadsheet"` and a `.xlsx` output.

```json
{
  "operation": "create_spreadsheet",
  "path": "月度经营看板.xlsx",
  "workbook": {
    "design": {"preset": "executive", "accent": "0F766E"},
    "sheets": [{
      "name": "汇总",
      "columns": [{"index": 1, "width": 24}, {"index": 2, "width": 16}],
      "cells": [
        {"row": 1, "column": 1, "value": "指标"},
        {"row": 1, "column": 2, "value": "本期"},
        {"row": 2, "column": 1, "value": "收入"},
        {"row": 2, "column": 2, "value": 1200},
        {"row": 3, "column": 1, "value": "成本"},
        {"row": 3, "column": 2, "value": 700},
        {"row": 4, "column": 1, "value": "差额"},
        {"row": 4, "column": 2, "value": {"formula": "B2-B3"}}
      ],
      "presentation": {
        "title_range": "A1:B1",
        "header_range": "A1:B1",
        "body_range": "A2:B4",
        "show_grid_lines": false,
        "print_area": "A1:B4"
      }
    }]
  }
}
```

Use typed values. Dates should remain dates, numbers should not be stored as formatted
text, identifiers with leading zeros should be text, and blank cells should remain
deliberately blank. Keep source data separate from derived formulas. Use formula cells
for calculations rather than pasting a result that will become stale.

For every formula-driven workbook:

- Put each assumption in a visible, label-adjacent cell and reference it from formulas.
- Keep relative/absolute references consistent across rows, columns, and forecast
  periods; a lone edited formula in a copied range needs explicit review.
- Assign number formats deliberately. Dates, percentages, currency, multiples, and
  integers should remain typed values with formats, not text that resembles a number.
- Preserve leading-zero identifiers as text and keep missing values distinct from zero.
- Guard divisions and lookups deliberately. Do not wrap every calculation in an error
  handler, because doing so can hide broken inputs or mismatched ranges.
- Record functions or external references that the allowed verifier cannot evaluate.
  A successful save does not mean those formulas have current cached values.

For a model meant to be edited by another person, use a consistent visual convention:
make hard-coded inputs visibly different from calculated cells, label linked ranges,
and identify key assumptions without relying on color alone. A legend belongs near the
report surface or input area, not in an unrelated documentation sheet.

The design presets are `executive`, `consulting`, `editorial`, and `minimal`. A report
surface can set a title/header/body range, hide gridlines, define print area and titles,
set orientation, and fit width. Do not style an empty range or hide source rows to make a
report look cleaner.

## Edit

Inspect first, then create a new output with SHA-bound source:

```json
{
  "operation": "edit_spreadsheet",
  "path": "经营分析-修订.xlsx",
  "source": {"path": "经营分析.xlsx", "expected_sha256": "<64-character SHA-256>"},
  "operations": [
    {"type": "set_cells", "sheet": "汇总", "cells": [
      {"row": 5, "column": 1, "value": "备注"},
      {"row": 5, "column": 2, "value": "已复核"}
    ]},
    {"type": "format_sheet", "sheet": "汇总", "presentation": {
      "preset": "consulting",
      "title_range": "A1:B1",
      "header_range": "A2:B2",
      "body_range": "A3:B5",
      "show_grid_lines": false
    }}
  ]
}
```

Supported edits include cell/range values, append rows, styles, merges, widths,
freeze panes, filters, native tables, sheet lifecycle, and report formatting. Use the
minimum operation set and fresh SHA for each edit. Do not recreate a complex workbook
from CSV.

## Recalculate and verify

Call `office_document` with `"operation":"verify"`:

```json
{
  "operation": "verify",
  "path": "经营分析-修订.xlsx",
  "render": true,
  "recalculate": true,
  "render_path": "经营分析-检查.pdf",
  "output_path": "经营分析-重算.xlsx",
  "timeout_ms": 60000
}
```

Only a compatible installed Microsoft Excel instance on the allowed Windows host path
can prove recalculation. ExcelJS writes formulas, not calculated values. Check formula
errors, cached/missing values, total identities, and key output cells after actual
recalculation. The render PDF still requires page-by-page visual inspection.

A clean recalculation proves that formulas evaluated; it does not prove that the ranges
or references are correct. For a new or materially changed model, choose two or three
critical formulas, compare them with independently checked values or a simple
recalculation, and only then trust a clean whole-workbook pass. Record formulas that
remain unsupported, external, or not computed rather than describing the workbook as
fully verified.

## Charts, pivot tables, and advanced Excel objects

The current `office_document` contract creates and edits typed data, formulas, native
tables, formatting, filters, freeze panes, and print surfaces. Do not claim it creates
or edits Excel charts, pivot tables, VBA, ActiveX, OLE, external connections, slicers,
Power Query, or web extensions unless a specific tool operation proves otherwise.

When a chart is required:

- Use the workbook as the evidence source.
- If the deliverable is a native PPTX chart, use `create_document` with a supported
  PPTX chart block.
- If the user requires the chart inside the workbook itself, state that the current
  XLSX tool path does not provide that operation rather than embedding a screenshot.

## Preview and readback

Use `read_document` to confirm saved content and the app's right-side preview for user
inspection. The preview is not the ZCode `xlsx-viewer` and does not itself calculate
formulas or prove print layout. State whether the workbook was structurally inspected,
actually recalculated, rendered, and visually reviewed as separate facts.

## Source disposition

The additional user-supplied `WorkAgentSkill/xlsx` package was audited as an independent
skill variant, not a duplicate of `spreadsheets/0.2.2/skills/xlsx`.

- Source size: 53 files, 1,161,335 bytes. Its `LICENSE.txt` is Apache-2.0.
- Compared with the active version, 2 relative paths overlap but 0 have the same
  SHA-256; the active directory has 26 files and the loose package is not a version copy.
- 51 files are byte-identical to shared Office validation/schema support elsewhere in
  the source archive. Only `SKILL.md` and `scripts/recalc.py` are unique files.
- Permissively licensed supporting files are bundled read-only under the standalone
  source entry's `references/source/`. They do not execute or install LibreOffice or
  openpyxl on Skill load. Any conditional helper route requires an inspected workspace
  copy, existing dependencies and the normal approval/command gateway. Native
  calculation-integrity, formula-review, typed-value and reporting checks continue
  through `office_document` and the allowed Microsoft Excel COM verification path.

`WorkAgentSkill/xlsx/SKILL.md` SHA-256:
`F32B1C2B5D5D31E02964DF110D6489613D9345F86830C118CFE24159D8448CE6`.
