# Presentation-Ready Excel Reports

## Sheet architecture

The first screen is usually a report, not a raw data dump: short title with period and units,
the decision or question, a small set of headline values, then one clearly bounded table.
Keep detailed inputs and calculations on separate sheets. A dashboard sheet should point to
source/calculation sheets rather than hiding assumptions behind pasted values.

Separate raw inputs, assumptions, calculations and outputs by named sheets or unmistakable
sections. Never put a derivation in the report layer that cannot be traced to a source or
calculation cell. Preserve identifiers and source row counts.

## Native report surface

Use `workbook.design` once for a consistent workbook preset and a sheet `presentation` for
each user-facing report surface. Supply actual non-overlapping `title_range`, `header_range`
and `body_range`. Existing workbooks can apply the same treatment with the `format_sheet`
operation. Do not select a range merely to decorate blank cells.

The report surface can hide gridlines when borders and bands already provide structure, set a
real print area and repeating header rows, choose portrait/landscape orientation and fit the
print width to one page. Print settings must match the actual used range and expected paper.

Use the presets coherently:

- `executive`: operating and board packs with teal/charcoal hierarchy.
- `consulting`: analysis and options with navy/slate contrast.
- `editorial`: survey and narrative data with warm neutral surfaces.
- `minimal`: operational trackers and dense reference tables.

Use one header band, not a different color for every column. Fill should encode a real group,
input/output convention or status. Input cells should be identifiable and any convention
should be explained without becoming a decorative legend.

## Tables, numbers and charts

Provide a short title with period and units. Use a consistent header fill, readable font,
aligned numeric columns and meaningful number formats: currency, percentage, integer, date
and decimals. Number formats must match the unit and precision in the header. Do not show
incompatible precision across a comparison or use visual formatting to hide uncertain data.

Freeze labels, set practical column widths and wrap long labels. Prefer filters and native
tables over decorative merged grids. Merge only titles, never source data areas. Keep row
height sufficient for wrapped text and repeat table headers.

Choose charts by the question: bars for category comparison, lines for ordered time,
scatter for relationships and a concise table for exact lookup. Label units and periods,
avoid 3D and unjustified dual axes, and preserve a zero baseline for magnitude bars.

Check pagination so columns do not split, header rows remain visible and page one carries both
title and decision context. Review the workbook in four passes: source integrity, calculation
integrity, visual hierarchy and print/viewport behavior.
