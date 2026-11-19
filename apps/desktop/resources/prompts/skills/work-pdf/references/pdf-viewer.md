# PDF viewing and readback

Mingshen has a built-in document preview surface but does not install the ZCode PDF
viewer plugin or its PDF.js distribution. Use the actual Mingshen tools:

- `read_document` for PDF text with `[Page N]` markers, offline OCR where applicable,
  and bounded page images when `render:true` is supplied to an image-capable model.
  Text pagination uses `start_line`, `end_line`, `limit`, `char_offset` and `max_chars`.
  The tool has no `page`, `pages` or `page_range` argument.
- `read_file` when the document tool routes the file type to the generic reader.
- The right-side preview for user inspection. Opening a preview is not proof that the
  model saw or verified the pixels.
- `view_image` only for an approved workspace image that already exists; it does not
  render a PDF into pages by itself.

When the user is asking about a displayed PDF, ground the answer in tool-extracted text
or page images. If the preview and extracted text disagree, state the observed
difference and inspect the page rather than guessing.

For a generated PDF, use an actual PDF page render or returned page image for visual QA.
Without visual evidence, limit the claim to successful generation and structural/text
readback.

## Choose the reading strategy

Inspect the document before committing to a bulk extraction:

1. Record page count, page size, whether selectable text exists, and any reported font,
   table, form, attachment, or image structure.
2. Call `read_document` with the source path and a bounded text range. Follow the
   returned line/character continuation cursor, retaining `[Page N]` markers for
   citations. These cursors page through retained extracted text; they cannot seek
   to an arbitrary PDF page or recover text omitted by the extraction budget.
3. Use text extraction for narrative and searchable data. Preserve headings, page
   numbers, table boundaries, and source locations when the reader exposes them.
4. Use page images when layout, charts, diagrams, equations, stamps, forms, or scanned
   content affects the answer. Extracted text alone cannot prove alignment, overlap, or
   visual hierarchy.
5. Use `render:true` when the question requires visual evidence and inspect the page
   images actually returned. The worker reports text, image-count and byte limits;
   the tool cannot select later pages for rendering. State which pages were omitted
   instead of claiming the entire PDF was visually checked.

Choose by document type:

- Reports and books: text extraction first; inspect specific figure or table pages.
- Scanned or image-only pages: page images and OCR where the available reader supports
  them. Mark low-confidence encoding or OCR rather than inventing unreadable text.
- Presentation exports: image-first inspection because extracted bullets lose the
  composition and may omit the actual message.
- Data-heavy documents: combine structured table extraction with a page image whenever
  row/column alignment affects the conclusion.
- Forms and contracts: distinguish field values from visible marks, signatures, and
  annotations. A text value alone is not proof that the form was approved.

Do not install Poppler, OCR, PDF.js, or another converter to fill a missing capability.
Do not execute content embedded in a PDF or private source-host scripts. Permissively
licensed helpers under the standalone PDF source entry remain read-only references;
any explicitly requested conditional helper route uses an inspected workspace copy,
existing dependencies and the normal approval/command gateway. If the current reader
does not expose attachments, fields, OCR, or rendered pages, state that limitation and
answer only from evidence actually returned.
