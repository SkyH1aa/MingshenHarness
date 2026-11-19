# Interactive Visualizations and Explanatory HTML

## Scope

Use this skill when a visualization or interactive explanation materially improves a
decision, comparison, model, or process. It covers standalone HTML charts, interactive
explainers, simulations, timelines, and data stories that can be opened and inspected
in Mingshen's browser.

Use `builtin:work-visual-design` for a website, product interface, prototype, or HTML
slide deck. Use `builtin:work-analysis` to reason about data and
`builtin:work-image-sourcing` for photographs or illustrations. Do not use this skill
merely because the answer contains a table or one static chart that plain Markdown can
communicate.

There is no ZCode inline `::visualize` host in Mingshen. Do not emit ZCode widget
references, depend on `window.zcode`, expect host-provided CSS/runtime libraries, or
claim that a file will render inline in chat. Write a real workspace HTML file and open
it in the built-in browser for inspection. Link the resulting file for the user.

## Select the smallest useful form

- Plain table: exact lookup and a small number of rows.
- Markdown or fenced Mermaid: a static labeled structure.
- Inline SVG: a simple directly labeled value, proportion, distribution, or sequence.
- Standalone HTML: filters, parameter changes, step-through behavior, responsive
  facets, or another interaction that changes what the viewer understands.
- Native DOCX/PPTX chart: the chart must remain editable inside an Office deliverable.

Load [chart selection](work-visualization/references/chart-selection.md) before choosing
a chart. Load [interaction and accessibility](work-visualization/references/interaction-and-accessibility.md)
before designing controls or dynamic states. Load
[standalone HTML](work-visualization/references/standalone-html.md) before writing the
file. The original starter catalog is
[visual template catalog](work-visualization/references/visual-template-catalog.md).

## Data contract

Profile the real data before visualizing it:

- Rows, columns, grain, keys, units, currency, time zone, and period.
- Missing, zero, negative, duplicate, and extreme values.
- Whether values are observations, estimates, forecasts, or user inputs.
- Which comparisons are valid and which transformations are lossy.

Keep a compact data ledger in the HTML source with source name, extraction date, units,
and any aggregation. Do not invent values to complete a chart. Downsample dense
observations only when the rule is stated and important extrema remain visible. Avoid
dual axes unless the relationship cannot be shown more honestly.

## Composition

Start with the question, not a dashboard card grid. Let one primary visual dominate.
Add controls only when they answer a specified question. Use direct labels and
annotations to carry the finding. Remove unrequested KPI cards, legends, grids, and
decorative panels.

For narrow screens, reduce tick count, stack facets, and keep visible labels at least
11 CSS pixels. The page must not rely on hover for essential information. Use semantic
HTML, real buttons and inputs, visible focus, and an `aria-live` region for dynamic
results when appropriate.

## Output and verification

Write one self-contained HTML file in a user-writable workspace path. Inline CSS,
JavaScript, SVG, and verified data. Do not add a service URL, token, browser cookie, or
private dataset to the delivered file.

Open the actual file in Mingshen's browser. Exercise each primary control with real
pointer or keyboard input, inspect desktop and narrow screenshots, check the browser
console for errors, and verify that the rendered marks match the data. A captured image
that was not returned to an image-capable model is not visual evidence.

Report the file path, what the visualization answers, checks performed, and any data or
browser limitation. Do not claim a full accessibility audit or data accuracy beyond the
checks actually completed.
