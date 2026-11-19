# Presentation Storytelling and PowerPoint Craft

## Route

Before creating a deck, editing an existing PPTX, writing speaker notes, reading a
presentation, or relying on a preview, load
[deck routes](work-presentations/references/deck-routes.md) with
`resource:"references/deck-routes.md"`. Use `create_document` for new editable PPTX,
`office_document` for supported old-deck inspection/editing and Office rendering, and
the right-side preview for user inspection. Do not claim the ZCode `pptx-viewer` plugin.

## Define the story

Determine audience, decision/action, speaking time, context, source evidence and brand
constraints. Read references and extract the claim/evidence before composing slides.
Create a short storyboard: slide purpose, assertion title, supporting evidence, visual
form and speaker note. An executive sequence often follows situation, finding, cause,
options, recommendation, implementation and decision. A training deck follows objective,
mental model, demonstration, guided example, practice and recap. Adapt the structure to
the user's purpose rather than filling a fixed template.

Each slide has one primary message. Titles should make a supported assertion or name a
literal topic when no conclusion is established. Put nuance and sources in notes or a
small readable footer, not a dense wall of text. Do not invent statistics or citations.
Use the original language and terminology consistently. Decide what belongs in appendix.

For a new deck, an executive or sales storyline, a significant rewrite or a layout upgrade,
load [story and layout](work-presentations/references/story-and-layout.md) before creating
the storyboard; use `resource:"references/story-and-layout.md"`. It contains tone selection,
narrative patterns and detailed visual grammars.

## Design system

Use native editable PPTX text, shapes, tables and charts. For a 16:9 13.333 x 7.5 inch
canvas establish a grid with about 0.6 inch outer margins, aligned title/footer baselines
and consistent content gutters. Set an actual palette and font family; preserve user
templates and supplied assets. Use a contrast-rich background/text pair plus two
functional accents rather than many unrelated colors. Keep chart series colors stable.

Starting type scale: title 28-36 pt, body 18-24 pt, chart labels 12-16 pt and sources
10-12 pt, adjusted to actual audience and room. Do not squeeze a paragraph into tiny
text. Edit the content or split the slide when it does not fit. Use short paragraphs,
parallel labels and intentional line breaks. Avoid indiscriminate bold and all-caps.

## Compose with variety and discipline

Choose the layout for the evidence:

- Opening: name/topic and a concise context statement, relevant real visual if available.
- Key finding: one assertion with a large chart or proof, a brief explanatory annotation.
- Comparison: two or three aligned options using the same dimensions and criteria.
- Process: a few labeled steps with clear reading order and consistent connectors.
- Timeline/roadmap: time-scaled milestones, owners and dependency or phase markers.
- Quantitative story: native chart, unit/period labels, honest baseline and highlighted
  relevant series. Pie only for a simple meaningful whole; line for ordered time data.
- Recommendation: action, rationale, expected effect, tradeoff and next owner/date.
- Detail/appendix: more information with smaller type, clear navigation and source context.

Maintain rhythm across the deck; do not make every slide the same title-plus-bullets.
Use asymmetry only with a clear alignment grid. Avoid decorative cards around all
content, excessive rounded rectangles, stock atmosphere images, repeated icons as filler
and chart screenshots when native charts are supported. Pictures must clarify the actual
subject. Preserve aspect ratio and sufficient resolution; use approved local assets.
Reserve whitespace deliberately and align captions. Avoid a title colliding with an
image, chart labels outside the plot, cramped legends or footer overlap.

## Existing decks

Inspect PPTX shape/table/notes anchors and SHA before edits. Use controlled text/table/
notes operations for the supported objects; preserve untouched package parts. Keep
master, theme, layout and style information. Do not promise lossless editing of SmartArt,
OLE, custom animations, macros or protected/signed files. If a requested operation is
unsupported, explain the specific object and offer a supported scope.

## Render and revise

Run office_document verify with rendering when an installed Office renderer is allowed.
Read the returned PDF and inspect every slide visually when page images are available.
Check text overflow, bounds, line breaks, image crop, table legibility, chart data/labels,
contrast, alignment, native editability and speaker notes. Check the opening, section
transitions and ending as a coherent sequence, then inspect detail slides too. Correct
the source and render again after visual changes. Structural validity and estimated text
bounds alone do not certify PowerPoint layout. Report absent rendering and unresolved
font or compatibility warnings honestly.

