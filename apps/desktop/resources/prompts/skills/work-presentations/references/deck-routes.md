# Presentation routes

## Create

Use `create_document` with a `.pptx` path and `slides`. The current native generator
supports editable text, native tables, native charts, images, tables, speaker notes,
layout kinds, shared themes, and several designed slide patterns.

```json
{
  "path": "项目复盘.pptx",
  "title": "项目复盘",
  "footer": "内部资料",
  "design": {"preset": "consulting", "density": "airy"},
  "slides": [
    {"kind": "cover", "eyebrow": "项目复盘", "title": "从交付结果到下一轮决策"},
    {
      "kind": "data",
      "title": "三个关键指标均达到决策区间",
      "blocks": [{"type": "metric_grid", "columns": 3, "metrics": [
        {"value": "92%", "label": "准时交付", "detail": "高于计划2个百分点"},
        {"value": "18天", "label": "周期", "detail": "较计划少3天"},
        {"value": "4.6", "label": "质量分", "detail": "较计划高0.1"}
      ]}]
    },
    {
      "kind": "cards",
      "title": "下一轮优先项",
      "blocks": [{"type": "list", "items": ["修复关键依赖", "锁定负责人", "缩短验收回路"]}]
    }
  ]
}
```

Only use `metric_grid` for values present in the evidence. Titles should state a
supported message or a literal topic. Use a mixture of `cover`, `section`, `content`,
`statement`, `cards`, `timeline`, `data`, and `closing` when the story warrants it.

PPTX accepts plain-text table cells in this path. Rich table-cell blocks, DOCX
paragraph layout controls, DOCX formulas, Markdown, code, quotes, and TOCs are not
supported. Use a Word/PDF artifact for those structures.

## Narrative and visual direction

Before composing slides, define the audience, the decision or understanding the deck
must produce, the presentation duration, and the evidence that is safe to claim. Then
write the storyline:

- One slide carries one main message.
- Open with the conclusion or the minimum context needed to understand it.
- Order sections around the argument, not the order in which source files were found.
- Use section dividers only when they help navigation.
- End with the decision, owner, date, risk, or next action when the purpose calls for it.
- Prefer fewer, clearer slides over shrinking text to fit every detail. A live deck and
  a pre-read can use different density because they are read in different ways.

Choose a content-specific visual system before placing shapes:

- Use one dominant color family with a smaller support range and one functional accent.
- Reuse one meaningful motif, alignment system, and title position across comparable
  slides. Vary slide composition without changing the deck's grammar.
- Pick fonts with reliable Office availability and CJK/Latin coverage for the requested
  language. Keep body text readable at presentation size; never use tiny text or crop
  content to preserve an arbitrary slide count.
- Use a native chart when the data relationship is the message. Give the chart a
  declarative title, visible units, consistent labels, and a scale that does not
  exaggerate the difference.
- Use tables for exact comparison, diagrams for process or structure, and images for
  evidence or atmosphere that comes from a known source.

Avoid default blue placement, repeated identical card grids, decorative accent stripes,
unrelated stock imagery, invented metrics, and a different layout on every slide
without a narrative reason. Every visual element should help the viewer find, compare,
or remember information.

## Read and inspect an old deck

Use `read_document` for presentation text and any returned slide/page structure.
Use `office_document` with `"operation":"inspect"` for a SHA-bound inventory of slides,
shape IDs, tables, notes, warnings, and protected package features.

Capture the source SHA before every edit. Do not edit a shape by approximate position
when a stable shape ID is available. Report unsupported objects specifically.

## Edit an old deck

Create a new output file unless the user explicitly asked to replace the source:

```json
{
  "operation": "edit_presentation",
  "path": "项目复盘-修订.pptx",
  "source": {"path": "项目复盘.pptx", "expected_sha256": "<64-character SHA-256>"},
  "operations": [
    {"type": "replace_shape_text", "slide": 1, "shape_id": 8, "old_text": "旧标题", "new_text": "新标题"},
    {"type": "set_table_cell", "slide": 2, "table": 1, "row": 2, "column": 2, "text": "125"},
    {"type": "replace_notes_text", "slide": 2, "old_text": "旧备注", "new_text": "新备注"}
  ]
}
```

Supported operations preserve unmodified package parts, but do not promise arbitrary
layout changes, image replacement, SmartArt editing, animation editing, OLE, macros,
signatures, or protected deck editing. Use a narrower supported operation and explain
the boundary.

## Speaker notes

Speaker notes are spoken script, not a description of the slide. Write 2-4 natural
sentences unless the user asks for a verbatim script. Include transitions, timing,
evidence caveats, and the decision ask where relevant. Do not put secrets, internal
links, or unsupported claims in notes.

## Render and review

Run `office_document` with `"operation":"verify"` and `"render":true` when Office is
available and allowed. Export to a new `.pdf` path, read the PDF, and inspect every page
or slide image when the model accepts images.

Review:

- Opening, transitions, and closing as one story.
- Content completeness, typos, duplicate slides, and leftover placeholder text.
- Title wraps, text bounds, overlaps, image crop, chart labels, table density, footer,
  page number, and font substitution.
- Consistency of titles, chart labels, units, terminology, and visual motifs across
  comparable slides.
- Native editability of text, tables, and charts.
- The relationship between speaker notes and slide content.
- Whether a successful export is being confused with a visual pass.

When Office is missing, in use, blocked by policy, or times out, preserve the structural
result and mark rendering as unverified. Do not close an unrelated user Office process
or substitute LibreOffice.

## Native preview

The Mingshen right-side preview is not the source `pptx-viewer` plugin. Use actual
`read_document` output and returned rendered pages for factual or visual claims.
Opening the preview alone is not a slide-by-slide visual review.

## Source disposition

The additional user-supplied `WorkAgentSkill/pptx` package was audited as an independent
skill variant, not a duplicate of `presentations/0.2.2/skills/pptx`.

- Source size: 58 files, 1,197,213 bytes. Its `LICENSE.txt` is Apache-2.0.
- Compared with the active version, 2 relative paths overlap but 0 have the same
  SHA-256; the active directory has 2 files and the loose package is not a version copy.
- 51 files are byte-identical to shared Office validation/schema support elsewhere in
  the source archive. Seven files are unique, including `SKILL.md` and presentation
  inspection/thumbnail/theme helpers.
- Permissively licensed supporting files are bundled read-only under the standalone
  source entry's `references/source/`; Skill loading does not execute them. A conditional
  helper route requires an inspected workspace copy, existing dependencies and the
  normal approval/command gateway. The native route independently applies narrative
  structure, visual systems, content QA and slide-by-slide review through Mingshen's
  own tools, without claiming arbitrary OOXML edits are lossless.

`WorkAgentSkill/pptx/SKILL.md` SHA-256:
`3679488C7E497C9B2F14BF026F39624D4C45B9519D845BC08650CE31598B0D6A`.
