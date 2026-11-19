# Work design resource provenance

## Active source

The active reference is the user-supplied `WorkAgentSkill/design-1/0.7.2` plugin.
Its complete `skills/design/design-resources` tree was copied unchanged into:

`work-visual-design/references/design-resources/`

Copy result:

- 361 files.
- 4,809,702 bytes.
- 291 design-skeleton files under `design-skeletons`.
- 24 design-system files under `design-systems`.
- 11 craft-baseline files under `craft`.
- 32 subordinate-skill files under `skills`.
- 3 root license/NOTICE files.
- 74 design-skeleton `SKILL.md` entries.
- 8 subordinate design `SKILL.md` entries.
- All source `LICENSE`, `NOTICE`, per-template license, disclaimers, examples, and
  supporting text assets preserved.

The top-level resource catalog was copied from the source's
`skills/design/references/catalog.md` to `template-catalog.md`. Only the title,
source banner, Mingshen resource-path instructions, and bulk-read warning were adapted.
The template bodies were not executed.

`design-entry-manifest.json` is generated from the copied `SKILL.md` paths. It records
all 82 design-resource entries (74 skeletons and 8 subordinate skills) with exact
Mingshen `use_skill` resource paths.

## Active versions

| Plugin | Versions present | Active |
| --- | --- | --- |
| design | 0.7.2 | 0.7.2 |
| documents | 0.1.7, 0.1.8, 0.2.0, 0.2.1, 0.2.2 | 0.2.2 |
| image-search | 0.1.1 | 0.1.1 |
| pdf | 0.1.7, 0.1.8, 0.2.1, 0.2.2, 0.2.3 | 0.2.3 |
| presentations | 0.1.7, 0.1.8, 0.2.0, 0.2.1, 0.2.2 | 0.2.2 |
| spreadsheets | 0.1.7, 0.1.8, 0.2.0, 0.2.1, 0.2.2 | 0.2.2 |
| visualize | 0.1.0, 0.1.1, 0.1.2 | 0.1.2 |

All versions and loose candidates are represented in the generated
`work-sources/catalog.json` and remain independently discoverable on demand. The native
workflow remains the execution contract; catalog presence does not inject every source
body into a system prompt or create competing default instructions. The source archive
`WorkAgentSkill.7z` has SHA-256
`D7AEAEE62CF99E3E49391A581B16C8F4E1091A6D9DCB46FB20E9F83769FD9A17`.

The source root also contains six loose, non-versioned candidates: `docx`, `xlsx`,
`pptx`, `pdf`, `pdf-reading`, and `frontend-design`. They are not additional releases of
the versioned plugin families. Their exact file and license disposition is recorded
below.

## Source disposition

The supplied archive contains 124 physical `SKILL.md` files. Every physical path has a
catalog entry with an ID ending in its source SHA-8, while identical bodies may share a
loadable adaptation directory:

- 124 physical `SKILL.md` sources.
- 104 unique source bodies by SHA-256.
- 93 unique frontmatter `name` values.
- 82 design-resource sources copied byte-for-byte beneath
  `references/design-resources`.
- 42 other physical sources represented by 21 shared adapted non-design bodies plus the
  primary design workflow. The primary design wrapper uses the real native
  `references/template-catalog.md` route and does not claim a nonexistent copied source
  file.
- 22 unique source-body adaptation classes in the generator.

The 82 copied design entries are independent discoverable catalog records. Their adapted
wrappers direct the model to `builtin:work-visual-design` with the exact
`references/design-resources/...` path. Cross-links such as `../craft` and
`design-systems/...` are normalized beneath the native skill root; no `../` escape or
widened catalog resource root is allowed.

Historical Office and PDF versions remain separately discoverable even when their source
body is byte-identical to another version. The current native tools remain the execution
contract.

| Loose candidate | Files / bytes | Native route | Disposition |
| --- | ---: | --- | --- |
| `docx` | 61 / 1,163,554 | `builtin:work-word` | Independent Apache-2.0 variant; adapted workflow plus licensed on-demand comment/revision helpers and license. |
| `xlsx` | 53 / 1,161,335 | `builtin:work-spreadsheets` | Independent Apache-2.0 variant; adapted workflow plus the licensed optional recalculation helper and license. |
| `pptx` | 58 / 1,197,213 | `builtin:work-presentations` | Independent Apache-2.0 variant; adapted workflow plus licensed on-demand slide/thumbnail helpers and license. |
| `pdf` | 12 / 68,603 | `builtin:work-pdf` | Independent Apache-2.0 form/general-PDF package; adapted workflow plus licensed FORMS/REFERENCE and form/image helper resources. |
| `pdf-reading` | 3 / 18,284 | `builtin:work-pdf` | Unique reading capability under an explicitly proprietary license; independently adapted from capability boundaries, with no source prose, scripts, or runtime copied. |
| `frontend-design` | 2 / 19,564 | `builtin:work-visual-design` | Apache-2.0 variant of the already active subordinate skill; one license copy matches by SHA, the 9,390-byte body differs, and its specificity-review gate was independently folded into `design-brief.md`. |

The physical total is therefore 124. Mingshen's registry retains 19 original domain
workflow entry points across Code and Work, with all source variants mapped onto the
appropriate native Work routes and loadable source entries. The 124 catalog records do
not inject all bodies into the system prompt and do not create competing default
instructions.

The visual-design description itself announces that 74 skeletons and 8 subordinate
skills are available on demand. Loading the template catalog exposes their names,
purposes, defaults, and resource paths without placing every body in the system prompt.
The source inventory at `work-sources/inventory.md` lists all 124 physical paths, IDs,
source hashes, entries, adaptation status, and license dispositions.

## PDF source families

The PDF inventory contains 10 physical `SKILL.md` sources but five unique source
bodies. Four functional roles cover production, viewing, reading, and general
processing:

| Role | Physical source | Unique body / disposition |
| --- | --- | --- |
| Production | `pdf-1/0.1.7`, `0.1.8`, `0.2.1`, `0.2.2`, `0.2.3` `skills/pdf/SKILL.md` | `0016a97a...`, reference-only adaptation |
| Viewer current | `pdf-1/0.2.2` and `0.2.3` `skills/pdf-viewer/SKILL.md` | `7552e6cc...`, reference-only adaptation |
| Reading | `pdf-reading/SKILL.md` | `e2081f07...`, reference-only independent adaptation; no source expression copied |
| General processing | `pdf/SKILL.md` | `d1c7caf5...`, Apache-2.0 adapted with licensed on-demand form/image resources |
| Viewer historical | `pdf-1/0.2.1/skills/pdf-viewer/SKILL.md` | `430308a5...`, reference-only; kept separate rather than collapsed into current viewer |

Native PDF text/page rendering uses `read_document`; new PDF creation uses
`create_document`; Office-to-PDF visual export uses the optional
`office_document verify` path. Merge, split, rotate, forms, images, encryption, and OCR
must use a proven native operation or an already-installed, explicitly approved
workspace script. Absent runtime is reported as unavailable.

## Licenses

- Design plugin `package.json`: Apache-2.0.
- Open Design resource core: Apache-2.0, Copyright 2026 Open Design contributors.
- `html-ppt` skeleton family: MIT, Copyright 2026 lewis.
- Zhangzara HTML deck templates: MIT, Copyright 2026 Zara Zhang; each directory keeps
  its license.
- Anthropic brand/frontend-design subskills: Apache-2.0.
- Taste skill and selected gstack-derived subskills: MIT; each directory keeps its
  notice.
- Loose `docx`, `xlsx`, `pptx`, `pdf`, and `frontend-design` package license files are
  Apache-2.0. The loose `pdf-reading` `LICENSE.txt` is explicitly proprietary and is not
  redistributed.
- The latest versioned Office/PDF families contain an Apache-2.0 license file while
  several `SKILL.md` frontmatter entries describe the content as proprietary. Mingshen
  therefore does not mechanically copy those professional bodies, scripts, or runtimes.
- Some design-system files describe third-party brands. Their disclaimer does not grant
  trademark or font rights.

The preserved `design-resources/NOTICE.md`, `LICENSE.md`, `LICENSE-html-ppt`, and
per-directory licenses are authoritative for the copied templates.

## Excluded and adapted material

- ZCode hook scripts, `.zcode-plugin` metadata, JWT authentication, viewer routes, and
  ZCode host APIs are not shipped or invoked.
- `design/scripts/adapt-canvas.mjs` was not copied because the native Mingshen skill
  describes ordinary workspace output and does not claim host canvas integration.
- The visualize plugin's vendor bundles and `::visualize` host contract are not copied
  into this design resource tree. The native visualization skill uses ordinary HTML
  and Mingshen browser inspection.
- Office and PDF production scripts, including loose comment, recalculation,
  presentation, and form-filling helpers, are retained only as declarative on-demand
  resources under the matching adaptation's `references/source` tree with their
  licenses. They are not executed, dependency-installed, or treated as native runtime.
  Mingshen uses original native instructions against its own `create_document`,
  `read_document`, and `office_document` tools.
- The loose `pdf-reading` material is excluded entirely because its license restricts
  retention, reproduction, derivative works, and redistribution. Mingshen's PDF reading
  strategy is independently authored against native capabilities.
- The loose `frontend-design` body was not inserted as another duplicate resource. Its
  useful decision framing was reduced to an original specificity-review gate in
  `design-brief.md`; the active copied subordinate skill remains the resource entry.
