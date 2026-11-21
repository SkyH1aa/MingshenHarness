# Third-party software and runtime distributions

Mingshen Harness 1.3.4 retains third-party rights. A source license selected for this
project does not relicense third-party components, names or logos. This document is
a distribution inventory, not a replacement for the licenses shipped by dependencies.

## Application dependencies

| Component | License / source |
| --- | --- |
| Electron | MIT and bundled Chromium/Node notices; https://www.electronjs.org/ |
| React / React DOM | MIT; https://github.com/facebook/react |
| BrowserDo 0.9.3 | Apache-2.0; https://github.com/zhaijunlong/browserdo |
| Lucide | ISC; https://github.com/lucide-icons/lucide |
| KaTeX | MIT; https://github.com/KaTeX/KaTeX (chat/composer rendering and offline document MathML) |
| DOMPurify | Apache-2.0 OR MPL-2.0; https://github.com/cure53/DOMPurify |
| Marked | MIT; https://github.com/markedjs/marked (chat/composer and document Markdown conversion) |
| fflate | MIT; https://github.com/101arrowz/fflate |
| yauzl 3.4.0 / pend | MIT; https://github.com/thejoshwolfe/yauzl (streaming update ZIP extraction) |
| Mammoth | BSD-2-Clause; https://github.com/mwilliamson/mammoth.js |
| docx 9.15.3 | MIT; https://github.com/dolanmiu/docx (DOCX authoring, native OMML, HTML conversion, charts and template patcher) |
| @xmldom/xmldom 0.8.15 | MIT; https://github.com/xmldom/xmldom (bounded DOCX template XML inspection) |
| PptxGenJS 4.0.1 | MIT; https://github.com/gitbrent/PptxGenJS (editable PPTX authoring) |
| ExcelJS 4.4.0 | MIT; https://github.com/exceljs/exceljs (native XLSX cells, styles, formulas and tables; no built-in calculation engine) |
| unpdf | MIT and PDF.js component notices; https://github.com/unjs/unpdf |
| word-extractor 1.0.4 | MIT; https://github.com/morungos/node-word-extractor |
| @napi-rs/canvas 1.1.0 | MIT and Skia component notices; https://github.com/Brooooooklyn/canvas |
| sharp 0.35.5 / Windows libvips 8.18.7 | Apache-2.0 and LGPL-3.0-or-later; https://github.com/lovell/sharp (bounded image validation; packaging is configured to retain the native package's component license summary separately, with redistribution obligations still requiring review) |
| Tesseract.js / Tesseract.js-core 7 | Apache-2.0 and bundled engine notices; https://github.com/naptha/tesseract.js |
| @tesseract.js-data/eng and chi_sim 1.0.0 | MIT package / upstream Tesseract traineddata Apache-2.0; https://github.com/naptha/tessdata |
| SheetJS CE 0.20.3 | Apache-2.0; official distribution https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz |
| YAML | ISC; https://github.com/eemeli/yaml |
| Zod | MIT; https://github.com/colinhacks/zod |
| cross-spawn | MIT; https://github.com/moxystudio/node-cross-spawn |
| diff 9.0.0 | BSD-3-Clause; https://github.com/kpdecker/jsdiff (bounded, in-memory line comparison for local review) |
| node-pty 1.1.0 | MIT; https://github.com/microsoft/node-pty (user-created interactive Shell / Windows ConPTY; verified upstream Windows x64 Node-API prebuilds, notices and native runtime files are retained) |
| @xterm/xterm 6.0.0 / @xterm/addon-fit 0.11.0 | MIT; https://github.com/xtermjs/xterm.js (terminal rendering and viewport fitting) |
| gifenc 1.0.3 | MIT; https://github.com/mattdesl/gifenc (GIF encoding for user-selected image frames) |
| TypeScript | Apache-2.0; https://github.com/microsoft/TypeScript |
| TypeScript Language Server | MIT; https://github.com/typescript-language-server/typescript-language-server |
| TanStack Virtual / React Virtual 3.13.12 | MIT; https://github.com/TanStack/virtual |
| ast-grep N-API 0.51.1 | MIT; https://github.com/ast-grep/ast-grep |
| ast-grep language wrappers (Python/Go/C/C++/C# 0.0.6, Java/Rust 0.0.7) | ISC; https://github.com/ast-grep/ast-grep-nursery |
| Bundled tree-sitter language grammars | MIT upstream grammar licenses: https://github.com/tree-sitter/tree-sitter-python, https://github.com/tree-sitter/tree-sitter-go, https://github.com/tree-sitter/tree-sitter-rust, https://github.com/tree-sitter/tree-sitter-java, https://github.com/tree-sitter/tree-sitter-c, https://github.com/tree-sitter/tree-sitter-cpp, https://github.com/tree-sitter/tree-sitter-c-sharp |
| TencentDB Agent Memory 2.0.3 local L1 subset | MIT; Copyright (C) 2026 Tencent. All rights reserved. https://github.com/TencentCloud/TencentDB-Agent-Memory, pinned commit `084bed45cad6bb7f877455082cee82835d65671a`; original license, subset notice and hashes are retained under `third_party/tencentdb-agent-memory/` and copied into the runtime resource |

Retain dependency LICENSE/NOTICE files, Chromium notices and Electron license files
when preparing a redistributable. The present task does not create an installer or
certify that a future package has preserved every required notice.

## jsdiff license

BSD 3-Clause License

Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Creative templates and image services

The 780 built-in creative workflow templates are authored in this repository as
65 task structures, each with 12 family-specific scenarios. Each scenario offers
brief and detailed prompts, counted once in the catalog. They contain domain
methods, outlines, audience guidance, acceptance criteria, delivery steps and
recommendations for existing Skills. Public design references are recorded in
`docs/WORKSTATION_TEMPLATE_RESEARCH_1.3.4.md`; no private prompts or third-party
Office binary template collection is redistributed. The user-provided WorkAgent
Skill resources below retain their separate provenance and licensing.

Image generation uses the user's configured OpenAI Images-compatible provider.
Prompt refinement and reverse prompting use the selected text or vision model.
No third-party studio account, private token, authenticated webpage, image library
or model weights are bundled. Generated assets remain subject to the provider's
terms and any source-material rights. GIF output combines selected local image
frames with the listed encoder; it does not include a video-generation service.

## TencentDB local memory algorithm preset

Original TypeScript dependency-closure modules are retained in
`third_party/tencentdb-agent-memory/src/`, with original SHA-256 values in
`upstream.json`. The complete upstream MIT text, including Tencent's 2026 copyright
and permission notice, is in `third_party/tencentdb-agent-memory/LICENSE`;
`NOTICE.md` identifies the pinned source and host modifications. The license,
notice and source manifest ship under `resources/tencentdb-memory/` with the
transpiled runtime; original TypeScript remains in the vendored source tree. The build
script verifies source hashes before bundling; ordinary builds do not prune or
rewrite original source. `runtime.json` records hashes for distributed runtime and
notice files. Packaging preflight and afterPack verify source/runtime/license
hashes, the complete MIT text and the emitted ESM dependency closure; missing or
inconsistent files fail validation. Updating upstream requires reviewing source,
hashes and notices together rather than changing a version string alone.

The embedded subset provides local L1 extraction, quality filtering, conflict
deduplication, writing and full-text retrieval. Generic-only prompt adapters retain
the conversation prompts and omit inactive Tencent work/team prompts from the
runtime. Mingshen host adapters provide a configured model runner, bounds,
cancellation, Chinese tokenization, atomic JSONL
snapshots and editing. The pinned extraction scheduling, quality filtering,
deduplication/writer and retrieval code remains in use; the host model runner
executes the original generic conversation extraction and conflict prompts with
both system text and user templates passed through unchanged, without appended
host rules or primary Agent instructions. Bounds, provenance and confirmed-memory
protection remain host-side validation. The runner accepts strictly validated
`store/skip/update/merge` decisions. Primary and fallback
analysis models are configurable per workspace, with an unset primary using the
current primary conversation model. A failed call or invalid result restarts the
whole operation with the fallback; valid empty results do not trigger fallback,
and no raw-answer excerpt fallback is used. Necessary conversation text and
candidate memories are sent to the configured model providers using user
credentials and incurring API usage. Local storage does not imply offline model
processing or guaranteed semantic quality.
Host snapshots are authoritative;
upstream product-storage fallback is disabled. SQLite FTS is reconstructed in
memory through Node's built-in SQLite without optional external vector extensions.
Automatic extraction can produce `persona`, `episodic` and `instruction` records.
Confirmed preferences remain protected from automatic updates and merges, while
automatic analysis records may change. Explicit backend switching retains both
local directories and activates only the selected backend without migration.
Tencent/OpenClaw business adapters and runtime, cloud/team services, telemetry,
L0 raw-transcript capture, the full L0–L3 pipeline and vector/embedding services are
not enabled. This is a local algorithm preset, not the complete upstream product,
an official Tencent service integration or an endorsement. Tencent's MIT grant
applies to its retained code only and does not change this application's current
`UNLICENSED` project setting or grant rights to third-party marks.

## WorkAgent visual-design resource pack

The WorkAgent visual-design catalog includes a copied, license-preserving subset
of the user-supplied `WorkAgentSkill.7z` archive. The archive is 23,456,637 bytes
with SHA-256
`D7AEAEE62CF99E3E49391A581B16C8F4E1091A6D9DCB46FB20E9F83769FD9A17`.
The active source package versions are:

| Package | Active version |
| --- | --- |
| design | 0.7.2 |
| documents | 0.2.2 |
| image-search | 0.1.1 |
| pdf | 0.2.3 |
| presentations | 0.2.2 |
| spreadsheets | 0.2.2 |
| visualize | 0.1.2 |

From the design package, 361 files totaling 4,809,702 bytes were copied unchanged
under
`apps/desktop/resources/prompts/skills/work-visual-design/references/design-resources/`.
The source inventory contains 124 physical `SKILL.md` paths across the active
package versions, retained historical versions and loose candidates. They resolve
to 104 unique source-body SHA values and 93 unique frontmatter names. The copied
design catalog contains 74 design-skeleton `SKILL.md` files and 8 subordinate
design `SKILL.md` files. Their 82 original resource bodies are preserved byte for
byte; `design-entry-manifest.json` and the work-source catalog use wrapper
remappings rather than treating the wrapper itself as the copied resource. The
other 22 unique bodies are original Mingshen
adaptations for the primary design source and non-design Word, PDF, spreadsheet,
presentation and visualization material. The remaining physical paths preserve
historical aliases or reuse an adapted body by source SHA rather than becoming
124 independently authored workflows.

`apps/desktop/resources/prompts/skills/work-sources/catalog.json` records every
physical source path, its source SHA value and its loadable host-relative entry.
WorkAgent exposes 98 current source entries as discoverable, on-demand resources.
For a matching source and full path with only the version directory removed,
semantic-version selection hides 26 historical entries in nine groups from both
discovery and manual selection. Different sources or workflow variants remain
separate, and all 124 physical records and source files remain for provenance.
The resources are not injected wholesale into the default prompt. A source SHA identifies source
material and is not a promise that an adapted host-authored body is byte-identical
to the source. Only the 82 design resources described above are copied unchanged.
PDF-related material totals ten physical sources and five unique source-body SHA
values. It covers four workflow roles: production, viewer, reading and loose
general-purpose PDF handling. The additional body is the retained historical
Viewer 0.2.1 source, not a fifth workflow role.

Licensing and provenance:

- The design package declares Apache-2.0. Its primary Open Design resources are
  Apache-2.0, Copyright 2026 Open Design contributors. The preserved
  `design-resources/LICENSE.md` and `NOTICE.md` identify the upstream snapshot,
  local path mapping, modifications and brand disclaimers.
- The retained html-ppt family is MIT, Copyright 2026 lewis. Zhangzara template
  directories retain their MIT notices. Anthropic brand/frontend-design resources
  retain Apache-2.0; taste and selected gstack-derived resources retain MIT and
  their per-directory license/notice files.
- Design-system documents may describe third-party brands for style reference.
  Those names, trademarks, fonts and design languages remain with their owners and
  do not imply affiliation or a trademark license.
- Office/PDF production scripts, source application bundles, JWT/authentication
  flows and competitor viewer/canvas integrations are not shipped or executed as
  part of this adaptation. Some source Office/PDF skill frontmatter labels content
  proprietary even though its package contains an Apache-2.0 file; Mingshen
  therefore uses original host instructions and its own document tools rather than
  mechanically redistributing those bodies or scripts. The `pdf-reading` material
  is retained only as a capability reference where its restrictive licence
  prevents copying.

The preserved license and notice files under `design-resources/` are authoritative
for the copied resource families. Packaging checks enumerate the design manifest
targets and verify the copied Skill tree rather than treating the top-level Skill
as a substitute license inventory.

## PPT Master and ASD-STE100 WorkAgent skills

`work-ppt-master` packages PPT Master 6.9.0 as a WorkAgent-only on-demand skill.
The source is Copyright (c) 2025-2026 Hugo He and licensed under MIT. The packaged
snapshot contains 13,089 files totaling 39,892,466 bytes under
`apps/desktop/resources/prompts/skills/work-ppt-master/references/source/`. Its
deterministic tree SHA-256 is
`6e8023b4b8ab81e0fb4cffb71c1dcea8dd4f6f6abca490395c21fb273bfe473c`.
The local provider configuration template is excluded. The upstream MIT text,
icon notices and sound notices remain in that directory. The 12,027 icons retain
their CC BY 4.0, MIT, CC0, and brand-trademark boundaries. The 186 WAV assets are
documented CC0 copies. Mingshen does not install or execute the packaged Python
helpers, and optional dependencies retain their own licenses. SVG icons can be
read as text resources by the skill runtime. Binary WAV files, scripts and
optional runtime dependencies are packaged references only: `use_skill` does not
return, play or execute them, and using them requires an authorized workspace copy
through the normal tools and approvals.

`work-asd-ste100` packages the ASD-STE100 skill 0.4.0 as a WorkAgent-only on-demand
skill. The source is Copyright (c) 2026 Dustin Yuchen Teng and licensed under MIT.
The packaged snapshot contains nine files totaling 231,661 bytes under
`apps/desktop/resources/prompts/skills/work-asd-ste100/references/source/`. Its
deterministic tree SHA-256 is
`0886b021b0f18d8997736af0a3b51a3492dd2c3b378ebb7484bead7803e04930`.
It contains a paraphrased rule summary and a structural linter, not ASD's official
approved-word dictionary. It is a general controlled-language aid, not an official
ASD certification product.

The full `SOURCE.md`, MIT license and third-party notices are packaged with each
skill. Packaging preflight verifies both snapshots against their file count, byte
count, deterministic tree hash and repository source when building from a checkout.

## Separately installed runtimes

- OpenAI Codex 0.166.0 Windows executable is bundled solely as an MXC process
  sandbox launcher under Apache-2.0. Source, archive/executable hashes and original
  LICENSE/NOTICE are in `apps/desktop/resources/native/`. A separate CODEX_HOME and
  sanitized environment prevent reuse of the user's Codex account. No Codex model
  service is invoked. The binary is ignored in Git due to its size; cloning requires
  running the pinned integrity-verified provisioning script before building.

- Docker Desktop is downloaded from https://desktop.docker.com/ and installed by its
  official signed installer. Docker's subscription terms and Windows prerequisites
  apply. It is not a vendored Mingshen runtime, and commercial use may need a paid
  subscription. See https://www.docker.com/legal/docker-subscription-service-agreement/.
- The default PowerShell image is published by Microsoft at
  `mcr.microsoft.com/powershell:lts-alpine`; image content retains its component
  licenses. Mutable tags can change. Pin a tested digest for controlled deployments.
- Embiody is separately licensed: https://embiody.com/eula. The reviewed EULA does
  not authorize redistribution. Mingshen downloads its official installer rather
  than embedding or rehosting its binary. BrowserDo's Apache license does not grant
  rights to redistribute Embiody.
- GitHub, Notion, Browserbase and other MCP services retain their service terms.
  MCP packages fetched using npx may download executable code; enabling a server is
  a trust decision, not a security certification.
- Skills downloaded from GitHub retain each repository's license and notices.
  Market listing does not imply an audit, endorsement or permission to redistribute
  every included asset.

## Release checklist

Before distributing an installer: select the project's LICENSE, retain the exact
lockfile, collect transitive notices, verify runtime rights, review signatures and
hashes, and test the resulting package on clean supported Windows machines.
