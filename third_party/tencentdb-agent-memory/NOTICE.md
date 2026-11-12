# TencentDB Agent Memory local L1 preset

Upstream: https://github.com/TencentCloud/TencentDB-Agent-Memory
Version: v2.0.3, commit 084bed45cad6bb7f877455082cee82835d65671a.
License: MIT; see LICENSE. Original TypeScript modules are preserved under src;
upstream.json records their SHA-256 hashes. build-tencent-memory.cjs verifies
and transpiles the dependency closure, without running upstream install hooks.

Harness embeds the upstream quality gate, candidate recall and conflict pipeline,
L1 record writer, SQLite FTS store and memory search. A host model runner uses the
pinned upstream generic conversation extraction and conflict prompts to produce
structured persona, episodic and instruction memories and store/skip/update/merge
decisions. Both system prompts and user templates are passed through byte-for-byte
as strings from the pinned upstream chat functions, without appended host rules
or primary Agent instructions. Host bounds, provenance and confirmed-memory
protection are enforced outside those prompts. Analysis models are configurable
per workspace; an unset primary uses
the current primary conversation model. An optional fallback restarts the whole
extraction/conflict operation after a failed call or invalid result. Valid empty
results do not trigger fallback. Strict result validation, cancellation and atomic
snapshot commits prevent partial writes; no raw-answer excerpt fallback is used.
Confirmed preferences are protected from automatic updates and merges. Host
adapters also provide editing, deletion, serialization and Chinese tokenization
using Intl.Segmenter/bigrams. Explicit backend switching retains both local
directories and activates only the selected backend, without data migration.
Generic-only prompt adapters retain the original conversation prompts and format
functions while omitting inactive Tencent team/work prompts from the runtime.
The conversation prompts, necessary conversation text and candidate memories are
sent to the configured analysis provider, and potentially its fallback provider,
using the user's model credentials and incurring API usage.
The SQLite loader permits only Node's built-in SQLite module and blocks optional
external vector-extension loading.
The host always supplies atomic snapshot storage. Upstream product storage
backends are replaced with an explicit error and are not shipped as entrypoints.
Original upstream source bytes and SHA-256 values remain unchanged. A separate
runtime.json records all distributed resource hashes, and packaging checks verify
their ESM dependency closure, source provenance and complete MIT license.
The OpenClaw runner fallback is replaced with an explicit error. No telemetry,
OpenClaw, cloud/team server, L0 transcript capture, L2/L3 consolidation, remote
storage, vector/embedding service or upstream postinstall is enabled.
SQLite FTS is reconstructed in memory from the authoritative local JSONL snapshot;
only current L1 records are persisted. Local candidate/decision intermediates are
not separately logged. Ordinary chat may include preferences and retrieved
excerpts in the user's configured model request. Local storage does not mean
offline model processing or guaranteed memory accuracy. This is an embedded L1
preset, not the complete upstream server.
