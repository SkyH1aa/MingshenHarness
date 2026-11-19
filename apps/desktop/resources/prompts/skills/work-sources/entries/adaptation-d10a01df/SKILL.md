---
name: "docx"
description: "Professional Word editor source adapted for creation, controlled edits, formatting, comments, readback and conversion decisions. This adaptation may be shared by multiple source versions with identical bytes."
---

# Word Editor Source

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-word` with `use_skill` and its `resource:"references/document-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Identify create, template, edit, review, analyze, or export intent and inspect the supplied document before changing it.
2. Preserve the input by default; choose a new output path and use source SHA plus paragraph/table anchors for controlled edits.
3. Build a real heading hierarchy, native lists and tables, consistent typography, headers/footers and deliberate pagination.
4. For existing files, prefer bounded text, block, paragraph-format or table operations and preserve unsupported fields or parts.
5. When an Office renderer is available and allowed, render the result and inspect page-level layout rather than relying only on extracted text.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Create a Word document or fill a supported template | create_document | available | Use native headings, lists, tables, sections, formulas, images, and the requested template. |
| Inspect or read an existing DOCX | read_document with structure:true | available | Capture the source SHA and paragraph/block indices before editing. |
| Controlled old-draft text/block/paragraph/table edits | create_document.edit with expected_sha256 | available | Write a new output by default and preserve unsupported package parts. |
| Track changes, comments, mail merge, arbitrary headers/footers, or macros | No general native operation | unavailable | State the missing operation; do not simulate revisions with visible text markers. |
| Export or render for visual inspection | office_document inspect, then verify with render:true | conditional | Requires an allowed WorkAgent, installed Microsoft Office, and a host path; in-use or policy failure must remain unverified. |

## Mingshen execution

- Use `create_document`, `read_document` and supported `office_document` operations; do not invoke source setup or Python scripts.
- Keep citations and numbers grounded; never fill missing content with invented facts.
- Respect the user's template before applying a default visual system.

## Verification

- Check document structure, formulas/fields, tables, cross-references, styles, page count and source/output hashes.
- Inspect rendered pages for clipping, overflow, orphan headings, blank pages and font substitution when rendering is available.
- State unsupported revisions, comments, macros, linked fields or protected sections explicitly.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
