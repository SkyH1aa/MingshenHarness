# Professional Word Documents

## Route

Classify the Word task before drafting. For create, template fill, old-draft edit,
read/review, PDF export, or native preview behavior, load
[document routes](work-word/references/document-routes.md) with
`resource:"references/document-routes.md"`. Use `create_document` for new DOCX and
supported edits, `read_document` for grounded readback and structure, and the
right-side document preview for visual inspection by the user. There is no ZCode Word
viewer plugin in this workflow.

## Brief and structure

Determine audience, purpose, document type, source material, required sections, length,
language and template/brand constraints. For reports use a decision-oriented hierarchy:
title, executive findings, evidence/analysis, recommendation, actions and references.
For policies/SOPs use scope, roles, prerequisites, numbered steps, exceptions and records.
For proposals use problem, approach, deliverables, schedule, assumptions and acceptance.
Use an outline before drafting a long document. Keep facts, interpretation and proposals
distinct; never invent citations, figures or decisions to fill a section.

For long reports, rewrites, proposals, policies or a requested design polish, load
[editorial quality](work-word/references/editorial-quality.md) before drafting. It contains
the content voice, table discipline, design rhythm and final editorial checks; use
`resource:"references/editorial-quality.md"`. Keep the conclusion supported and never invent
facts, citations, figures, owners or decisions.

## Inspect before editing

Use read_document structure:true for DOCX source SHA and body/paragraph indices. Existing
indices refer to one snapshot. Prefer unique replace_text for small wording changes,
replace_blocks for complete supported sections, and format_paragraph for layout only.
Preserve surrounding content and styles. Save a new output by default. Unsupported
bookmarks, fields, revisions, protected ranges or sections need a narrower edit, not a
whole-file reconstruction disguised as lossless editing.

## Typography and page system

Use named heading levels and a deliberate type scale. As a starting point for ordinary
business reports: body 10.5-12 pt, restrained headings 14-20 pt, title 22-28 pt, line
spacing 1.2-1.5, paragraph spacing 4-8 pt. Adapt to the user's template and language.
Avoid formatting with repeated spaces, blank paragraphs or manual line breaks. Use
keep-with-next for headings, keep-together for short callouts, and intentional page
breaks before major sections. Prevent orphan headings and split table captions.

Keep margins and content width consistent. Use real lists and native tables. Align
numeric columns, state units in headers and use consistent precision. Give tables useful
column proportions, repeat header rows and avoid dense prose in narrow cells. Use real
equations, captions, footnotes, hyperlinks and page numbers where appropriate. Native
editable OMML is preferred over a picture of an equation.

Use a restrained palette: a clear heading color, neutral body text and one functional
accent. Emphasis must reflect importance. Do not put every paragraph in a shaded box or
repeat oversized headings. Use approved local images only, preserve aspect ratio, and
give meaningful alternative text. A logo is an asset, not a repeated background texture.

## Verification and delivery

Check section completeness, numbers, cross-references, terminology, names and source
citations. Validate the Office package and inspect output with office_document verify.
When an installed Office renderer is available and allowed, export/inspect the rendered
pages. Read the returned PDF with the document tools; use page images when available.
Check every page for overflow, blank pages, widows/orphans, clipped tables and font
substitution. A semantic text preview is not a Word pagination check. State rendering,
field-update and compatibility checks that could not run.

