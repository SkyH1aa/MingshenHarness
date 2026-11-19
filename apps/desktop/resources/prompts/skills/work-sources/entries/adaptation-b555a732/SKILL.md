---
name: "docx"
description: "Loose Apache-licensed Word source adapted for reliable DOCX creation, OOXML-aware edits, comments and post-generation checks."
---

# Standalone Word Toolkit Source

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-word` with `use_skill` and its `resource:"references/document-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Start from the real document or template and determine whether a fresh generation or a surgical edit is safer.
2. Treat DOCX as a package: preserve untouched parts and never pretty-print or rewrite unrelated OOXML merely to make an edit.
3. Use native tables, images, styles, section settings, comments and tracked-change support only where the current editor actually supports them.
4. Run structural readback and render the document when possible before delivery.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Generate or template a DOCX | create_document | available | Use native OOXML generation and preserve the requested layout. |
| Surgical edits and source-bound verification | read_document structure plus create_document.edit and office_document | available | Never unzip/repack or rewrite unrelated OOXML parts. |
| Accept revisions, author comments, or run supplied Python helpers | references/source/scripts through an approved workspace command | conditional | Check Python packages and source licensing first; native unsupported behavior remains visible. |
| Arbitrary tracked changes, mail merge, or macro execution | No general runtime | unavailable | Do not claim lossless preservation or execute Office macros. |

## On-demand source resources

- `references/source/LICENSE.txt` records the Apache-2.0 terms.
- `references/source/scripts/comment.py` and `accept_changes.py` are optional permissioned fallbacks for comment or revision tasks; inspect dependencies first and never execute them through the native skill loader.

These resources are declarative source support, not executable authority. Read the relevant file first. Scripts may run only through an approved workspace command after dependency checks; never install packages automatically.

## Mingshen execution

- Do not invoke source `docx-js` or unpack/repack scripts; use native Mingshen document tools.
- Keep original and updated paths explicit, and avoid in-place writes unless requested.
- Preserve template relationships and avoid duplicate media parts.

## Verification

- Inspect valid Office packaging, paragraph/table count, image dimensions and source/output SHAs.
- Check comments or revisions in the actual format rather than assuming they survived.
- Verify page layout through a renderer when available.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
