# Visual Design for Work Deliberables

## Choose the correct output

Use this skill when the requested artifact is a workspace design deliverable:
responsive web page, product interface prototype, dashboard, HTML presentation,
portal, campaign page, or a redesign of an existing interface. A request for an
editable PowerPoint belongs to `builtin:work-presentations`. A Word/PDF report belongs
to `builtin:work-word` or `builtin:work-pdf`. An ephemeral visual used only to explain
or explore information in the conversation belongs to `builtin:work-visualization`.

Do not promise Figma layers, a ZCode design surface, pinned ZCode comments, a
`data-zcode-design` review mode, or host-only infinite-canvas actions. Produce ordinary
HTML/CSS/JavaScript or modify the real project, then inspect it in Mingshen's browser.

## Route

- CREATE: nothing existing must be carried forward. Load the template catalog, choose
  one skeleton by audience and information task, read that skeleton, then read only the
  craft files it recommends.
- REDESIGN: an existing page, codebase, screenshot, or product must be preserved in
  identity or behavior. Inspect the current state first and follow
  [design brief](work-visual-design/references/design-brief.md).
- REVIEW: report problems and evidence without changing files unless implementation
  was also requested.
- DESIGN SYSTEM: extract or apply reusable tokens, type, spacing, surfaces, control
  states, and component rules before composing page-level work.

Before a CREATE task, load [template catalog](work-visual-design/references/template-catalog.md)
with `resource:"references/template-catalog.md"`. The catalog exposes 74 template
skeletons, 8 subordinate design skills, craft baselines, and design-system references.
For machine-readable discovery of every copied design entry, load
`references/design-entry-manifest.json`; it contains exact source and target resource
paths without injecting template bodies.
When accessibility, responsive behavior, or motion matter, load
[responsive and motion](work-visual-design/references/responsive-and-motion.md).
Before delivery, load [quality review](work-visual-design/references/quality-review.md).

## Brief before pixels

Write a compact direction statement:

> Design this as a [artifact type] for [audience], using [visual tone], centered on
> [the one problem the interface must solve].

Identify:

1. Primary user task and success state.
2. Information hierarchy and required content.
3. Product or brand constraints and supplied assets.
4. Platform, input modes, viewports, language, and accessibility needs.
5. Whether the task is CREATE, REDESIGN, review, or a scoped iteration.
6. What must be preserved and what may change.

For vague high-impact redesigns, use distinct directions only when the request genuinely
supports alternatives. Do not spend the run generating arbitrary variations instead of
solving the supplied task.

## Build the real experience

Write a runnable source file directly in the workspace. For a web app or prototype,
start with the actual working screen, not a marketing landing page around it. Prefer the
existing stack and components for a real project. A standalone file must open locally,
use relative asset paths, and avoid hidden network dependencies.

Use semantic HTML and familiar native controls. CSS custom properties may define the
token layer. Stable controls, boards, toolbars, and media need responsive dimensions so
hover, labels, loading, and dynamic content cannot shift the layout. Use cards only for
repeated items, modals, or genuinely framed tools; never place cards inside cards or
turn entire page sections into floating panels.

Use icons for familiar tools when an icon library exists, with accessible labels and
tooltips for unfamiliar actions. No emoji as production icons. Use real relevant media
or approved local assets instead of generic decorative gradients. If an image must be
sourced, use `builtin:work-image-sourcing` and record its usage rights.

Typography, color, density, imagery, and motion must follow the subject. Avoid the
default AI look: repeated rounded cards, purple-blue gradients, ornamental blobs,
invented metrics, arbitrary three-column feature blocks, and filler copy. A restrained
operational tool should prioritize scanning and repeated action; a game or expressive
portfolio may carry more visual energy.

## Use the imported design resources correctly

The copied catalog and templates are read-only references under
`references/design-resources/`. They may be adapted into the user's workspace, but:

- Do not execute imported scripts or install their dependencies.
- Do not copy template attribution or license files away from the resource tree.
- Do not claim a template, font, image, or component was used unless its file was read.
- Do not use templates that require missing assets as if they were complete.
- Preserve per-directory licenses for HTML deck and sub-skill sources.
- This Mingshen entrypoint overrides host-specific source markers. If a copied template
  mentions `<artifact>`, `data-od-id`, comment mode, ZCode APIs, `::visualize`, remote
  Google Fonts, Tailwind compilation, or a package manager setup that Mingshen did not
  perform, translate the visual idea into a runnable workspace file and do not emit or
  claim that host behavior.

The source inventory, historical versions, exclusions, and license summary are in
[source provenance](work-visual-design/references/source-provenance.md).

## Inspect and revise

Run or open the actual artifact. Use `browser_open` on a local HTTP entry when needed,
then `browser_snapshot`, `browser_click`, `browser_type`, `browser_press_key`, and
`browser_screenshot`. A screenshot becomes visual evidence only if it is returned to an
image-capable model and actually inspected.

Check desktop and mobile, plus the key intermediate width for complex screens. Test the
main interaction with real pointer or keyboard input and verify loading, empty, error,
disabled, selected, and focus states that the artifact implements. Repair hierarchy,
overflow, clipping, contrast, misleading copy, and interaction failures before
delivery. State any rendering or interaction check that could not run.
