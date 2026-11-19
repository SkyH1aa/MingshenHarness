# Artifact Quality and Final Acceptance

Review an artifact along four separate dimensions:

1. Content: purpose fulfilled, required sections present, supported claims, accurate
   names/dates/numbers, consistent definitions, valid sources and actionable conclusions.
2. Structure: valid native package, readable hierarchy, native editable objects, formula
   and reference integrity, preserved source content and supported feature scope.
3. Presentation: professional type/spacing, aligned objects, meaningful color, legible
   charts/tables, no clipping/overlap, sensible pagination and accessible alternatives.
4. Verification: actual checks, renderer/calculator used, coverage, failures and explicit
   unverified areas. Keep these distinct from model confidence.

For Office outputs run structural validation and render when an allowed installed
renderer exists. Inspect every page/slide at a useful scale; check spreadsheet critical
ranges, formulas and recalculated outputs. Fix the source and repeat the affected check.
Do not claim a text extraction or HTML approximation proves native Office layout.

For a final content/design review or an artifact that must be presentation-ready, load
[format acceptance](artifact-quality/references/format-acceptance.md). It separates editorial
and visual review and provides Word/PDF, XLSX and PPTX acceptance checks; use
`resource:"references/format-acceptance.md"`.

Preserve source files and untouched objects. Use source hashes for controlled edits,
normal write approval/isolation and atomic commits. An error/cancellation must not replace
an existing output with a half-created file. Treat external-change warnings as requiring
fresh inspection, and never bypass protection to complete a document.

At delivery identify the editable artifact, its inputs/assumptions and material limits.
Explain formula/render status plainly. Do not overstate compatibility, losslessness,
statistical certainty, publication or external delivery. A failed or unavailable renderer is
an explicit verification gap, not a silent pass.
