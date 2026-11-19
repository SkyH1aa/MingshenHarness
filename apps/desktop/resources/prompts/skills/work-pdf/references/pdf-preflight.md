# PDF preflight

Run this after the PDF exists. Do not mark a check as passed because the generator
returned success.

## Content

- Every requested section, page, name, date, number, unit, citation, and appendix is
  present.
- The title and executive conclusion agree.
- Tables reconcile to their source and arithmetic checks.
- Assumptions, unknowns, and proposals are not presented as verified facts.
- Headers, footers, page numbers, labels, and cross-references use consistent terms.

## Structure

- `read_document` returns the expected file and page count.
- Text is searchable and in the expected reading order where the extractor supports it.
- No placeholder tokens, raw Markdown syntax, broken links, or missing image warnings
  remain.
- The output file has a new path unless replacement was explicitly authorized.

## Visual review

Use actual page images or PDF page rendering when available. For each page inspect:

- Clipping at margins and page edges.
- Text overflow through cards, tables, headers, and footers.
- Blank pages, stranded headings, broken table rows, and missing captions.
- Image crop, resolution, aspect ratio, and overlap.
- Font substitution, missing glyphs, and unreadable small type.
- Table columns that collapse, wrap word-by-word, or hide units.
- Contrast and hierarchy at final page size.
- Cover and closing page quality.

Read the pages in sequence to check narrative pacing and section transitions. Zooming
into one home-page screenshot is not enough.

## Honest status

Report three buckets:

1. Verified: structural and visual checks actually completed.
2. Unverified: rendering, font, field, print, or compatibility checks that could not run.
3. Not supported: operations requested but outside the current tool contract.

Never write that a PDF is print-ready, accessible, signed, or legally redacted merely
because it opens successfully.
