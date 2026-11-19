# PDF production routes

## Contents

- Intake and evidence
- Reports and proposals
- Posters and visual one-pagers
- Resumes and CVs
- Conversion and existing files
- Typography and pagination

## Intake and evidence

Choose the route from the artifact and reader, not from a keyword alone. Record:

1. Audience and decision or task.
2. Exact deliverable, page size, orientation, page limit, and output language.
3. Source files, facts, figures, quotations, citations, brand assets, and restricted
   content.
4. Required sections and their order. Treat a user-provided outline as a constraint.
5. Reading context: screen, print, presentation handout, application portal, or archive.
6. Verification available for this run.

Normalize units, dates, names, and currency before layout. Keep source IDs and a
source ledger for researched claims. Mark unknowns and assumptions instead of filling
them with polished prose.

## Reports and proposals

A decision report normally follows:

1. Cover with accurate title, subtitle, date, and owner.
2. Executive conclusion with the recommendation and material caveat.
3. Evidence and analysis organized by the decision, not by source chronology.
4. Options or implications with consistent comparison dimensions.
5. Recommendation, risks, owners, dates, and next actions.
6. Sources and appendix.

A proposal adds problem, proposed approach, scope, deliverables, schedule,
assumptions, acceptance criteria, and exclusions. A policy or SOP adds scope, roles,
prerequisites, steps, exceptions, records, and review cadence.

Use assertion headings when the evidence supports them. Keep interpretations visibly
distinct from facts. Tables are appropriate for comparisons, responsibilities, and
quantities; they are not a way to avoid writing a coherent argument.

## Posters and visual one-pagers

Start with one action or idea the viewer must retain. Establish:

- Primary headline at final print size.
- One dominant image, diagram, number, or typographic gesture.
- A short evidence layer.
- A clear source, date, and call to action or contact route.

Build a reading path before adding decoration. Keep the headline and body at final
output scale; a layout that only works zoomed in is not a poster. Use high-resolution
local assets with known usage rights. Do not cover text with decorative translucency,
or use an asset merely because it is available.

For a one-page summary, use no more than three information zones and one repeated
alignment system. Avoid turning all information into equal rounded cards.

## Resumes and CVs

Optimize for quick scanning:

- Name and target role at the top.
- Concise profile only when it adds positioning.
- Experience ordered for the target reader.
- Achievement lines that name scope, action, result, and evidence.
- Skills grouped by meaning rather than a keyword cloud.
- Education, credentials, publications, or portfolio as relevant.

Preserve the candidate's facts. Do not invent metrics, seniority, dates, tools, or
employment scope. Keep ATS-sensitive content as selectable text and avoid critical
information in images. Check date chronology, tense, capitalization, contact details,
and consistent bullet punctuation.

## Conversion and existing files

There are three different jobs:

1. **Read**: extract or answer from an existing PDF without changing it.
2. **Rebuild**: create a new PDF from supplied content and a new design.
3. **Export**: ask allowed Microsoft Office automation to render a DOCX/XLSX/PPTX copy
   into a new PDF.

Use `read_document` or `read_file` for step 1 and `create_document` for step 2. For
step 3, first inspect the Office source and then call `office_document` with
`"operation":"verify"`, `"render":true`, and a new `render_path`. This path requires
Windows, full-access host execution, WorkAgent, a non-subagent session, and an
installed compatible Office application. Existing Office processes or policy blocks
must degrade honestly.

The current generic tools do not promise PDF merge, split, page reorder, crop, form
fill, watermark, encryption, redaction, digital signature, OCR cleanup, arbitrary PDF
editing, or lossless PDF→Office conversion. Do not hide an unsupported step inside a
large command or install a converter without authorization.

## Typography and pagination

For A4 business reports, a safe starting point is 10.5–12 pt body text, 14–20 pt
section headings, 22–28 pt title, 1.25–1.5 line spacing, and 4–8 pt paragraph spacing.
Adjust to the specified template, language, audience, and output size.

Use:

- One body family with reliable CJK and Latin coverage.
- Semantic heading levels and short paragraphs.
- Keep-with-next behavior for headings and table titles where the document schema
  exposes it.
- Space above a section heading that is visibly greater than below it.
- Page breaks before a major section, not as a substitute for layout.
- Stable table columns, repeated headers, visible units, and aligned numbers.
- Captions directly associated with figures.

Avoid tiny type, rivers of centered text, oversized decorative covers, fake charts
made of colored text boxes, and multiple accents competing for attention.

## Source disposition

Two additional user-supplied PDF packages were audited independently from
`pdf-1/0.2.3/skills/pdf`.

### `WorkAgentSkill/pdf`

- 12 files, 68,603 bytes; `LICENSE.txt` is Apache-2.0.
- Compared with the active PDF package, 2 relative paths overlap but 0 have the same
  SHA-256. Eleven files are unique in the supplied inventory and only the standard
  license text has an exact external copy.
- The package covers general PDF library examples and an eight-script form workflow.
  Permissively licensed supporting files are bundled read-only under that source
  entry's `references/source/`. Loading them does not execute scripts or add native
  merge, split, form-fill, watermark, encryption or page-mutation operations. A
  conditional helper route requires an inspected workspace copy, existing dependencies
  and the normal approval/command gateway; no dependency is installed automatically.
- The native route adopts only independently written intake, reading-strategy,
  structural-versus-visual validation, and unsupported-operation disclosure. Reading
  guidance is in `pdf-viewer.md`.

`SKILL.md` SHA-256:
`D1C7CAF5F35EB7D37877DD7FC33A095037BE2B34FB5D2F7F4D43BDE3165BB4EE`.

### `WorkAgentSkill/pdf-reading`

- 3 files, 18,284 bytes. All 3 files are unique in the supplied inventory.
- `LICENSE.txt` explicitly describes proprietary terms and forbids retaining,
  reproducing, creating derivative works from, or distributing the materials outside
  the applicable service. No source prose, script, or asset is copied into Mingshen.
- The package was used only as a capability checklist. The reading strategy in
  `pdf-viewer.md` is independently authored against capabilities that the native tools
  actually expose, with explicit fallback when text, OCR, fields, or rendered pages are
  unavailable.

`SKILL.md` SHA-256:
`E2081F071B4F56FB0FD994DAD13C3B7B1DC35D7F3655707AE38CCAF230B787B6`.
