# Interaction and accessibility

## Design controls around questions

Add a control only if a user needs to change a parameter, focus a subset, compare a
scenario, or move through time/steps. Use the native control that fits the input:

- Segmented control for two or three mutually exclusive modes.
- Select for a longer option list.
- Slider or number input for a continuous parameter.
- Checkbox/switch for a binary setting.
- Tabs for peer views.
- Button for one clear action.

Do not add search, filter, reset, legend toggles, and download controls merely because
a dashboard commonly has them.

## Behavior

- Controls update one coherent visual state.
- State transitions preserve context and stable colors.
- Reset behavior, active value, units, and range are visible.
- Keyboard operation works.
- The visual does not rely on hover to expose essential meaning.
- The primary calculation or comparison runs locally and deterministically.
- Invalid input produces a visible, associated message.

## Accessibility

- Use semantic landmarks and headings.
- Give every control an accessible name and visible label.
- Preserve visible focus.
- Use `aria-live="polite"` for result summaries, not every animation frame.
- For SVG, include a concise role, accessible name/description, and readable fallback
  text.
- Pair color with labels or shape.
- Maintain readable contrast against light and dark surfaces.
- Support touch targets of roughly 44 by 44 CSS pixels where practical.
- Respect `prefers-reduced-motion`.

## Responsive behavior

Measure the chart from its actual container, not a fixed viewport. Redraw SVG when its
container changes width. At narrow widths:

- Reduce ticks and optional annotations.
- Move legends into wrapping text.
- Stack facets instead of squeezing them side by side.
- Keep labels at least 11 CSS pixels.
- Avoid horizontal page scroll.

Long labels should wrap, move, or use a larger margin. Never rotate them to the point
that they become unreadable.

## Motion

Use transitions only to show state change, relationship, or process. Animate transform
and opacity. Avoid initial decorative cascades, indefinite loops, or motion that delays
access to the result. Reduced-motion mode should remove nonessential animation while
keeping the final state.
