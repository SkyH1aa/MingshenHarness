---
name: "xlsx-viewer"
description: "Current Excel viewer source adapted for range review, formula inspection, downstream extraction and explicit calculation provenance. This adaptation may be shared by multiple source versions with identical bytes."
---

# Excel Viewer Source 0.2.1/0.2.2

> Mingshen adaptation of a user-supplied WorkAgentSkill source. Private Viewer,
> Canvas and JWT/authentication APIs are unavailable. Permissively licensed support
> files may be bundled read-only in references/source; loading text neither executes
> them nor installs dependencies or makes them native runtime tools.

## Route

Start by loading `builtin:work-spreadsheets` with `use_skill` and its `resource:"references/workbook-routes.md"` guide. Use this source variant only when its stated task matches; the native Mingshen
skill remains the execution contract and overrides incompatible source details.

## Source-specific workflow

1. Determine whether the user wants cell discussion, workbook structure, extracted data, formula review, or a check of newly produced output.
2. Read targeted sheets and ranges, retaining anchors and cursor boundaries for large tables.
3. Review neighboring rows and formulas before explaining a result or recommending a change.
4. Preserve sheet names and cell coordinates in downstream extraction.

## Operation routing

| Task | Execution route | Status | Boundary |
| --- | --- | --- | --- |
| Discuss cells, ranges, workbook structure, or formula dependencies | read_document and office_document inspect | available | Use returned sheet/cell references and read neighboring context. |
| Validate a produced or changed workbook | office_document verify with recalculate:true | conditional | A clean whole-workbook pass does not prove range correctness; independently check critical formulas. |
| Use ZCode viewer/capture APIs or claim visual proof from text | No compatible viewer API | unavailable | Use returned rendered pages when available and state structural-only review otherwise. |

## Mingshen execution

- Use current workbook read and preview tools; no ZCode viewer host is available.
- Use native spreadsheet operations for mutation.
- Distinguish data extraction from visual or formula validation.

## Verification

- Spot-check displayed cells against structure and formula inventory.
- Check a representative calculated range and error totals after any supported recalculation.
- Report merged cells, hidden rows or unsupported file types when they affect the answer.

## Compatibility boundary

- Do not depend on private source scripts, binary bundles, MCP servers, viewer routes, JWT/authentication flows, host globals or private APIs. A conditional route to a permissively licensed helper requires reading it first, existing dependencies, an approved workspace copy and the normal command gateway; skill loading never executes it.
- Do not infer new permissions from this source. File writes, commands, Office automation, browsing and network access still follow the active Agent mode, Profile, approval, isolation and trust settings.
- If a source capability has no native Mingshen tool, report the precise missing operation instead of simulating it or attempting an unsafe fallback.
