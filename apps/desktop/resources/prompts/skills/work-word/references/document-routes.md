# Word document routes

## Create

Use `create_document` with a `.docx` path and `blocks`. Establish the audience, document
type, publisher voice, title, sections, tables, figures, page geometry, and source
appendix before generation.

A representative call:

```json
{
  "path": "员工手册-初稿.docx",
  "title": "员工手册",
  "page_numbers": true,
  "design": {"preset": "minimal", "density": "balanced", "cover_page": true},
  "blocks": [
    {"type": "heading", "text": "适用范围", "level": 1},
    {"type": "paragraph", "text": "说明适用对象、生效日期和例外。"},
    {"type": "heading", "text": "流程", "level": 2},
    {"type": "list", "ordered": true, "items": ["确认输入", "提交审批", "归档记录"]}
  ]
}
```

Use real heading levels, native lists, real tables, native equations, captions, and
footnotes. Use Markdown only when its supported conversion is the clearest way to express
the block. Use local PNG/JPEG assets with known rights; `create_document` does not load
remote image URLs as if they were approved workspace files.

## Fill a template

Inspect the template first. A supported placeholder must be unique, occupy its own
normal paragraph, and avoid revisions, bookmarks, comments, fields, drawings, content
controls, and section properties. Provide an output path separate from the source.

```json
{
  "path": "合同-已填充.docx",
  "template": {
    "path": "合同模板.docx",
    "replacements": [{
      "placeholder": "body",
      "blocks": [{"type": "paragraph", "text": "替换为已核对条款"}]
    }]
  }
}
```

Templates preserve their surrounding layout but do not promise lossless editing of
third-party extensions, macros, signatures, or complex objects.

## Professional authoring controls

Treat structure as part of the document's meaning:

- Use native heading levels, real lists, and actual tables. Do not imitate a list with
  bullet glyphs, a table with runs of spaces, or page breaks with repeated blank lines.
- Style each heading level consistently and make titles descriptive enough to support
  navigation and a table of contents. Use a TOC only when the generated headings have
  usable outline semantics.
- Give every table a clear purpose and stable column widths that sum to the usable text
  width. Repeat header rows where supported, align quantities consistently, and keep
  units in or next to the column heading.
- Keep one paragraph element per logical paragraph. Do not use literal line-break
  characters, dotted leaders, repeated underscores, or oversized whitespace to fake
  layout controls that the document schema exposes directly.
- Use images with a supported MIME type, correct aspect ratio, meaningful caption, and
  known usage rights. Do not add decorative images that compete with the document's
  reading order.
- Keep typography subordinate to the supplied brand or template. When no system is
  supplied, use one coherent heading/body pairing, a restrained type scale, and CJK/Latin
  coverage appropriate to the output language.

## Edit an existing draft

1. Read with `read_document` and `"structure":true`.
2. Record the full SHA-256 and the one-based block/paragraph indices.
3. Choose only the smallest supported operations.
4. Pass the expected SHA into `create_document.edit`.
5. Re-read the saved output; do not reuse the old indices as if they remained stable.

```json
{
  "path": "报告-修订.docx",
  "edit": {
    "path": "报告.docx",
    "expected_sha256": "<64-character source SHA-256>",
    "operations": [
      {"type": "replace_text", "paragraph": 8, "old_text": "旧表述", "new_text": "新表述"}
    ]
  }
}
```

Inspect the document schema or tool error for the currently supported operation names
and required fields. Prefer `replace_text` for unique local wording,
`replace_blocks` for complete supported sections, and `format_paragraph` for layout.
Keep an untouched source copy unless the user explicitly requested in-place replacement.
Do not manually unzip, rewrite, reorder, or repack the OOXML package as a substitute for
an unsupported native operation. Do not promise lossless replacement of arbitrary
headers, footers, comments, tracked changes, content controls, fields, equations,
drawings, or protected sections.

When the user asks for tracked changes, comments, redlining, mail merge, or arbitrary
header/footer editing, state that the current native edit contract does not provide that
operation. Do not simulate it by inserting visible brackets, comments in body text, or
replacing the whole document. Offer a narrower edit, a proposal copy, or an explicitly
unsupported deliverable instead.

## Read and review

Use `read_document` for text, tables, structure, formulas, and page-aware results that
the parser exposes. The right-side preview is useful for the user but does not by itself
prove that the model saw the rendered page. For visual review, export or render through
the allowed Office verification path and inspect actual page images when the active
model supports them.

Review distinct layers:

- Substance: facts, completeness, logic, decision value.
- Language: terminology, concision, consistency, tone.
- Structure: heading hierarchy, reading order, tables, appendices.
- Composition: margins, type, spacing, pagination, captions.

A successful text extraction cannot detect widows, clipped tables, or visual overlaps.

## Convert to PDF

Do not reconstruct an existing Word file from extracted text and call it a conversion.
When the request is a visual export and Mingshen's optional Office path is allowed:

1. `office_document` with `"operation":"inspect"` and the DOCX path.
2. `office_document` with `"operation":"verify"`, `"render":true`, and a new
   `render_path` ending in `.pdf`.
3. Open/read the rendered PDF and inspect its actual pages.

This requires a compatible installed Microsoft Office, Windows, full-access host mode,
WorkAgent, and a non-subagent session. If Office is absent, already in use, blocked by a
security boundary, or times out, report that the PDF export was not verified. Do not
install Office or substitute a bundled converter.

## Native preview and unsupported operations

Mingshen's document preview is the application surface. Do not claim to have installed
the source `docx-viewer` plugin. Always ground content answers in `read_document` or
other actual tool output.

Current native tools do not promise arbitrary Word track changes, comment authoring,
redlining, header/footer editing by index, remote image loading, macro execution,
signature preservation after edits, automated mail merge, or lossless formatting of
every old document. State the specific unsupported step and use a narrower supported
operation.

## Source disposition

The additional user-supplied `WorkAgentSkill/docx` package was audited as an independent
skill variant, not treated as another version of `documents-1/0.2.2/skills/docx`.

- Source size: 61 files, 1,163,554 bytes. Its `LICENSE.txt` is Apache-2.0.
- Compared with the active version, 8 relative paths overlap but 0 have the same
  SHA-256; the active directory has 41 files and the loose package is not a duplicate.
- 51 files are byte-identical to shared Office validation/schema support elsewhere in
  the source archive. Ten files, including `SKILL.md`, comment helpers, run-merging, and
  comment templates, are unique in the supplied inventory.
- Permissively licensed supporting files are bundled read-only under the standalone
  source entry's `references/source/`; they are not native tools and do not execute
  when a Skill loads. A conditional helper route requires reading the helper, an
  approved workspace copy, existing dependencies and the normal command gateway.
  The native route independently applies review, structure, validation, tracked-change
  limitations and comment safety through `create_document`, `read_document` and
  `office_document`, without treating manual OOXML repacking as a lossless native edit.

`WorkAgentSkill/docx/SKILL.md` SHA-256:
`B555A732276BBA637440D124C1E1A3F8A322AD0441AE885A611C82083441CAB7`.
