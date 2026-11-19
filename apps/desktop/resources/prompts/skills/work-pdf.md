# Professional PDF Production

## Route before drafting

Classify the job before choosing a layout:

- New report, proposal, white paper, brief, policy, resume, or handbook: build an
  evidence-led `create_document` PDF with native selectable text.
- Poster, one-pager, cover, invitation, certificate, or visual summary: use a
  print-first composition with one message, one strong visual anchor, and explicit
  reading order.
- Existing PDF question or extraction: read the actual pages with `read_document` or
  `read_file`; do not regenerate the file just to answer a question.
- DOCX/XLSX/PPTX to PDF: distinguish a visual export from a rebuilt document. Use
  `office_document verify` with `render:true` and a new `render_path` only when the
  optional host Office path is allowed.
- Merge, split, rotate, crop, fill forms, redact, sign, encrypt, or losslessly edit an
  existing PDF: current tools do not provide these arbitrary operations. Explain the
  specific missing capability and offer extraction, read-only review, or a new PDF.

For substantial production, load [PDF production](work-pdf/references/pdf-production.md)
with `resource:"references/pdf-production.md"`. Before delivery load
[PDF preflight](work-pdf/references/pdf-preflight.md) with
`resource:"references/pdf-preflight.md"`. When the user asks how preview behaves, load
[PDF viewer](work-pdf/references/pdf-viewer.md).

## Production brief

Record the audience, decision, page count or range, language, paper size, brand assets,
required sources, delivery context, and what must remain selectable or accessible.
Resolve supplied content before styling it. Do not invent statistics, quotations,
citations, approvals, signatures, or visual evidence.

Use a compact outline before a long PDF. Each section needs a job in the argument.
Reports should separate evidence, interpretation, recommendation, and caveats. Resumes
should optimize for the hiring reader and keep role chronology clear. Posters should
use one dominant statement and only the supporting detail needed for the intended
action.

## Native creation

Use `create_document`; the `.pdf` extension selects PDF output. A representative
report call is:

```json
{
  "path": "季度经营复盘.pdf",
  "title": "季度经营复盘",
  "page_size": "A4",
  "page_numbers": true,
  "design": {
    "preset": "executive",
    "density": "balanced",
    "cover_page": true
  },
  "blocks": [
    {"type": "heading", "text": "结论", "level": 1},
    {"type": "paragraph", "text": "以已核对事实开头，不用空泛背景占用首页。"},
    {"type": "table", "header": true, "rows": [["指标", "本期", "变化"], ["收入", "1200 万", "+8%"]]},
    {"type": "heading", "text": "证据与建议", "level": 1},
    {"type": "list", "ordered": true, "items": ["给出证据", "说明取舍", "明确下一步"]}
  ]
}
```

Supported structure includes headings, paragraphs, lists, tables, quotes, code,
callouts, local PNG/JPEG images, page breaks, rich paragraphs, equations, footnotes,
and Markdown conversion. PDF equations are typeset output, not editable Word formulas.
PDF `chart` blocks are not supported; use a supported native table or create the chart
in DOCX/PPTX when editable chart semantics matter.

Use real page geometry rather than compensating with blank lines. Keep margins,
headers, footers, captions, and footnotes on one system. Set `overwrite:true` only when
the user explicitly requested replacing the output and the source and destination
roles are unambiguous.

## Visual system

Select one existing preset deliberately: `executive` for decision-first management
material, `consulting` for comparisons and evidence-heavy analysis, `editorial` for
narrative or thought leadership, and `minimal` for dense technical or operational
reference material. Match density to the reading channel. A cover is useful for a
substantial report, not for a one-page memo.

Use a small type scale, stable baselines, deliberate whitespace, and one functional
accent. Do not turn every paragraph into a card or every heading into a full-width
band. Tables must use meaningful column widths, right-aligned numbers, units in
headers, and concise cells. Figures require captions and permission-cleared local
assets. Keep image aspect ratios and meaningful alternative text.

## Verify the delivered file

After generation, read the real output with `read_document`. Confirm page count,
searchable text, headings, tables, links, and required content. When rendered page
images or PDF pages are available to an image-capable model, inspect every page for
overflow, clipping, unintended blank pages, orphan headings, broken tables, image
cropping, font substitution, and unreadable contrast. A successful file write or text
extraction is not visual QA.

State separately what was structurally read, what was visually inspected, and what
could not be checked. Never describe a PDF as signed, redacted, editable, or
`lossless` unless a tool actually performed that operation.
