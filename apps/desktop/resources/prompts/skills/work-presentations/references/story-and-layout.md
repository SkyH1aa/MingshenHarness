# Story, Tone and Layout for Presentations

## Build the spoken argument

Write the spoken argument before the slide text. For each slide, name the audience question it
answers, the evidence that changes the answer and the implication. Prefer a concrete assertion
such as "Pilot cut cycle time by nine days" over a label such as "Pilot Results". When a
conclusion is not established, use an honest topic title instead of manufacturing one.

Use active, specific verbs and short parallel labels. Remove generic openers, repeated agenda
pages, slogans, decorative adjective stacks and conclusions that merely restate the title. The
last line of a slide should advance the argument, not repeat it.

Choose a tone for the setting:

- Board/executive: direct, financially literate, explicit about the decision and tradeoffs.
- Strategy: compare options against the same criteria and make the recommendation traceable.
- Training: explain one mental model at a time with a demonstration and guided practice.
- Sales: connect evidence to customer value without overclaiming or universalizing a pilot.
- Operations reporting: prioritize sequence, owners, constraints and evidence.

Preserve the user's terminology. The titles alone should form a defensible story.

## Native composition system

Set a `design.preset` for the deck: `executive` for operating reviews, `consulting` for
analytical storylines, `editorial` for narrative or public-facing ideas, and `minimal` for
technical and data-dense material. Use `slide.eyebrow` for a restrained section cue and
`slide.kind` for the actual composition: `cover`, `section`, `content`, `statement`, `cards`,
`timeline`, `data` and `closing`.

Set `design.density` as part of the narrative cadence: `airy` gives executive statements more
breathing room, `balanced` is the default, and `compact` fits evidence-dense operating pages.
Density changes the title origin, block spacing and the rhythm of cards, timelines and KPI
grids; do not use `compact` merely to cram an overloaded slide.

A deck should normally include a cover, at least one section or statement transition, varied
evidence layouts and a decisive close. Use `cards` for 3-6 priorities, `timeline` for 3-6
ordered stages, `metric_grid` for 2-6 real KPIs, `data` for a dominant chart or table and
`statement` for one consequential sentence. Do not use a layout that implies evidence or
metrics the content does not contain.

Use one `callout` block for a guardrail, risk or decision-critical implication. `accent`,
`positive`, `warning` and `neutral` tones should reflect meaning, not decorate the slide.

## Repeatable visual grammars

- Assertion + annotated chart: title states the finding; one chart dominates; annotation
  explains the cause or consequence; source and period sit below.
- Comparison: two or three equal columns with identical criteria, concise headings and a
  visible recommendation or criterion.
- KPI row: 2-6 comparable values with one unit and period convention; value first, label
  second, detail only where it changes interpretation.
- Roadmap: milestones on one time axis with owner, dependency or decision markers only when
  known. Do not invent dates to make the line look complete.
- Recommendation: decision, reason, expected effect, tradeoff and next owner/date in that
  order. If effect is uncertain, label it as a hypothesis or scenario.
- Section transition: one clear change of subject, question or decision, not a decorative
  quote page.

Use no more than two type families, one dominant accent, one secondary signal color and a
consistent grid. Do not put every content group in a bordered card, repeat the same icon on
every item or use a photograph as a substitute for evidence. A visual should make the
argument easier to verify, not merely fill the right side of the canvas.

## Editorial and visual pass

Present the deck mentally without speaker notes, then read the notes aloud. Notes should add
explanation rather than repeat slide text. Check that every visual has a grammatical role
(evidence, comparison, sequence, relationship or decision), and that there is no slide whose
only purpose is visual decoration.

Inspect each slide for overflow, clipped objects, source collisions, inconsistent grid
positions, chart label errors, weak contrast and accidental layout drift. A structural pass
does not prove that the slide is readable or persuasive.
