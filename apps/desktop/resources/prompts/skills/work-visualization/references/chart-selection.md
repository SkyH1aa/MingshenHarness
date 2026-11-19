# Chart selection

## Match the question

| Question | Default mark | Avoid |
| --- | --- | --- |
| Ranking | Horizontal bar, sorted | Rotated labels, 3D bars |
| Change over time | Line or connected dot series | Unordered bars |
| Comparison across categories | Bar or dot plot | Pie with many slices |
| Part of a single whole | Stacked bar or a few-slice donut | Multiple pies |
| Distribution | Histogram, box, strip, or density | A single average |
| Relationship | Scatter with meaningful scales | Two unrelated trend lines |
| Composition over time | Stacked area or aligned small multiples | Area charts hiding series |
| Flow or conversion | Adjacent stages or Sankey only with accurate link values | Decorative arrows |
| Process | Ordered steps or swimlane | Arbitrary circular diagram |
| Geography | Published projection plus sourced geometry | Hand-drawn country outlines |

Ask whether a table is clearer. Exact values, many dimensions, and editing needs often
favor a table.

## Axes and scales

- Bar charts start at zero when length encodes magnitude.
- Line charts may use a nonzero baseline only when change, not absolute magnitude, is
  the question; show the range and label the axis.
- Do not truncate axes to dramatize a small change without explicit disclosure.
- Use consistent units and scales across comparable facets.
- Sort when rank is the message; preserve chronological order when time is the message.
- Avoid log scales unless the audience understands them and the transformation is
  necessary.
- Do not use two y axes without a clear, disclosed reason.

## Color and labels

Colors should reflect stable series identity, not decorate unrelated categories. Use
one accent plus neutrals where possible and a small categorical palette when categories
are genuinely persistent. Pair color with labels, shape, dash, or position.

Prefer direct labels for endpoints, key values, and thresholds. Keep labels in the
foreground color, not the series color. Legends are supporting material, not a
substitute for readable labels.

## Annotation discipline

Annotate:

- The decision-relevant peak, trough, crossing, uncertainty band, or threshold.
- Short context needed to avoid a false interpretation.
- Source and period.

Do not add callouts to every point or repeat the title in multiple summary cards.

## Uncertainty

Show bands, error bars, ranges, or scenario lines when the source supports them. If the
data contains no uncertainty information, do not compute a false confidence interval.
Explicitly distinguish observed values from forecast or assumption-driven values.
