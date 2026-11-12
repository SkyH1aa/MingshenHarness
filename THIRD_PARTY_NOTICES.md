# Third-party software and runtime distributions

Mingshen Harness 1.3.2 retains third-party rights. A source license selected for this
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
| unpdf | MIT and PDF.js component notices; https://github.com/unjs/unpdf |
| word-extractor 1.0.4 | MIT; https://github.com/morungos/node-word-extractor |
| @napi-rs/canvas 1.1.0 | MIT and Skia component notices; https://github.com/Brooooooklyn/canvas |
| Tesseract.js / Tesseract.js-core 7 | Apache-2.0 and bundled engine notices; https://github.com/naptha/tesseract.js |
| @tesseract.js-data/eng and chi_sim 1.0.0 | MIT package / upstream Tesseract traineddata Apache-2.0; https://github.com/naptha/tessdata |
| SheetJS CE 0.20.3 | Apache-2.0; official distribution https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz |
| YAML | ISC; https://github.com/eemeli/yaml |
| Zod | MIT; https://github.com/colinhacks/zod |
| cross-spawn | MIT; https://github.com/moxystudio/node-cross-spawn |
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
