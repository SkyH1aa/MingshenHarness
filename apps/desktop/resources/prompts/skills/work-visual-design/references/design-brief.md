# Design brief and redesign boundaries

## CREATE

Read the full request, supplied content, existing product context, and recoverable
constraints. Do not search unrelated projects to invent requirements.

Record:

- Artifact: landing page, app screen, dashboard, prototype, HTML deck, document shell,
  or design system.
- Audience and primary task.
- Required content and actions.
- Real product name, offer, place, object, or subject that must be visible in the first
  viewport.
- Platform and browser constraints.
- Brand assets, fonts, colors, imagery, legal text, and voice.
- Delivery path and whether the file is standalone or part of the existing project.

Then choose one clear composition. A page should have a recognizable subject in the
first screen, a dominant visual anchor, and enough of the next section visible to imply
continuation. For an app, the working interface itself is the first screen.

## Specificity review

Before implementation, turn the brief into a compact direction the design can be judged
against: four to six named color roles, a display/body type pairing, one layout concept,
and the few principles that make this artifact particular to its subject.

Then review that direction before writing the interface:

- Could the same palette, type, and composition be pasted into an unrelated product
  without changing meaning? If so, the direction is still too generic.
- Does the dominant visual come from the actual product, place, object, content, or
  workflow rather than a decorative trend?
- Is every structural device carrying information? Numbering needs an actual sequence;
  borders need a grouping role; motion needs a state change or focus reason.
- Are common defaults being used as decisions rather than habits: cream/serif/warm-clay
  editorial styling, near-black with an acid accent, repeated rounded cards, identical
  soft shadows, tracked all-caps labels, or decorative gradients?
- Is there one memorable move, with the surrounding hierarchy quiet enough to let it
  work? Remove one accessory before adding another element.

Keep the design direction and revision notes in the working artifact when that helps the
next pass. This is a self-critique gate, not an instruction to produce several unrelated
variants when the user asked for one answer.

## REDESIGN

Inspect the actual current state before changing it:

1. Source files and framework.
2. Routes, core flows, and navigation.
3. Component and design-token structure.
4. Existing content, states, imagery, and accessibility behavior.
5. The single biggest reason the interface feels weak, generic, dated, or inefficient.

State four boundaries before implementation:

- Must preserve.
- May restructure.
- Must not change.
- Evidence that will prove the redesign works.

Choose the least invasive mode that solves the real problem:

- `refinement`: keep structure; improve type, color, spacing, surfaces, imagery, states.
- `layout`: keep goals and flows; change information hierarchy and composition.
- `rebuild`: preserve essential identity and function; replace the visual system.

Continue the current source path unless the user asked for a separate version. Do not
copy every iteration into V2, V3, and V4 folders. When several explicit directions are
requested, use separate stable paths and shared content.

## Design system extraction

Create tokens only when the project benefits from reuse:

- Color roles, not a flat list of hex values.
- Type roles and scale.
- Spacing and layout grid.
- Radius, border, and elevation conventions.
- Control heights, icon sizes, and focus behavior.
- Motion durations and easing, with reduced-motion behavior.
- Component states and content rules.

Use existing variables and components first. Do not introduce a parallel token system
that conflicts with the application.

## Facts and placeholders

Use real supplied content. Demo data must be labelled as demo data in source or screen
copy where confusion is possible. Never invent testimonials, customers, logos,
security claims, uptime, performance percentages, or financial metrics.

If content is missing and does not block the layout, use clearly non-production sample
text internal to the prototype and call it out. Do not fill the screen with `Lorem
ipsum`, repeated feature cards, or meaningless labels.
