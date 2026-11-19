# Responsive layout, accessibility, and motion

## Layout

Define stable responsive rules:

- Use `minmax`, grid tracks, aspect ratios, `clamp()` for containers, and sensible
  min/max dimensions.
- Do not scale font size with viewport width.
- Keep body copy readable; do not let a long word force horizontal overflow.
- Move labels to another line when a control cannot grow.
- Stack low-priority columns before compressing every control.
- Make touch targets usable without shrinking text.
- Avoid long text inside compact icon buttons; use an icon plus an accessible name.

For dashboards and operational products, prioritize dense scanning, comparison, and
repeat action. Keep navigation predictable. For editorial or campaign work, allow a
stronger visual composition while preserving a clear reading order.

## Accessibility

- Use semantic landmarks, headings, lists, tables, buttons, links, and form labels.
- Preserve visible keyboard focus.
- Keep text and essential symbols above readable contrast.
- Do not encode state by color alone; pair it with text, shape, or icon.
- Provide accessible names for icon controls and meaningful image alternatives.
- Associate validation errors with the relevant field.
- Maintain logical DOM and tab order.
- Respect `prefers-reduced-motion`.
- Ensure critical content remains available without hover.

## Controls and states

Cover the states the delivered surface actually supports:

- Default, hover, pressed, selected, focus, disabled, loading, success, warning, error.
- Empty and no-results behavior.
- Long content, missing data, extreme values, and permission-limited states.

Do not add controls solely to demonstrate a component. Every visible action should
serve the task.

## Motion

Motion must clarify state or spatial change. Prefer opacity and transform. Avoid looping
animation that does not communicate progress, `transition:all`, decorative motion on
every element, and motion that blocks input.

Use short durations for direct controls and longer transitions only for meaningful
context changes. Check that:

- Entering and exiting states remain visually connected.
- Text does not jump between layouts.
- A reduced-motion preference removes nonessential movement.
- Animation does not hide, clip, or overlap content.

## Visual assets

Use the actual product, object, place, person, or state when the user needs to inspect
it. Avoid dark, blurred, stock-like imagery that adds atmosphere but no information.
Preserve aspect ratio, supply useful alternative text, and record source/license for
external assets. Icons must use one coherent family and optical size.

Do not use an SVG illustration as a substitute for a required real hero image. Do not
embed service tokens, cookies, or credentials in browser-delivered files.
