# Visual design quality review

## Evidence before opinion

Open the real artifact. Record:

- Source file and entry command or URL.
- Viewports checked.
- Image-capable model received each screenshot.
- Interactions exercised with real pointer or keyboard input.
- Console or runtime errors.
- Checks not possible in this environment.

A screenshot file on disk is not evidence until its pixels were actually inspected.

## First look

Before the detailed checklist, name:

1. What the surface communicates.
2. The first three things the eye lands on.
3. Whether those three match the intended hierarchy.
4. One-word quality verdict.

If the first visual anchors are not the brand, product, primary content, or primary
action, fix hierarchy before polishing.

## Checklist

### Content and trust

- Observable subject appears in the first viewport.
- Headlines identify the product, place, person, offer, or task.
- Copy is specific and supported; no invented metrics or claims.
- Empty and demo content cannot be confused with production facts.
- Labels, dates, units, currencies, and names are consistent.

### Typography

- Clear hierarchy at desktop and mobile sizes.
- No clipping, abnormal wrapping, overlap, or text under controls.
- Body line length is readable.
- Heading levels are semantic.
- Important actions remain visible and understandable.

### Color and surfaces

- Palette roles are intentional and not dominated by one hue family by accident.
- Contrast is sufficient for text, controls, charts, and focus indicators.
- Borders, shadows, and radii follow a coherent system.
- Cards are not nested or used as the default page-section wrapper.

### Layout

- Alignment follows a shared grid or baseline.
- Spacing above a heading is greater than below it.
- Dense tables and toolbars do not collide with adjacent content.
- Long strings and localized text fit.
- Mobile reflows rather than shrinking the desktop composition.

### Interaction

- Main action can be completed.
- Hover, focus, pressed, disabled, loading, error, and empty states are appropriate.
- Keyboard focus order is logical.
- Controls do not move or resize unpredictably on state changes.
- No invisible overlay blocks a real click.

### Motion

- Motion has a functional purpose.
- Text and layout do not jump or occlude.
- Reduced motion is honored.
- Animation does not loop without purpose.

## Responsive inspection

At minimum inspect:

- A desktop viewport appropriate to the artifact.
- A 390 px mobile viewport for responsive pages.
- One intermediate width when the layout has multiple breakpoints.

Check for horizontal overflow and content pressed against the page edge. Use browser
evaluation when available to find elements whose visual bounds cross the intended
gutter. Then look at the screenshot; measurements alone do not establish visual quality.

## Repair and report

Prioritize systemic fixes over one-off pixel patches. After changing the source, refresh
and repeat the same inspection. Report:

- Artifact path.
- Main design decisions.
- Checks actually passed.
- Remaining visual, browser, asset, or compatibility gaps.

Do not claim a full responsive or accessibility audit unless those workflows were run.
