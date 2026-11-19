# CodeAgent Capability Research and Implementation (1.3.3)

Research date: 2026-11-17. Scope: understand why OpenAI Codex can remain efficient when
using the same or similar model, then strengthen Mingshen Harness CodeAgent without
copying private instructions, increasing the product version, or replacing the existing
execution engine.

## Conclusion

The useful difference is not a single hidden prompt. Codex combines several reinforcing
harness behaviors:

1. A task contract states the goal, relevant context, constraints, and observable done
   condition.
2. Durable repository rules and current worktree facts are loaded before implementation.
3. Repository exploration is optimized around symbols, target ranges, and bounded
   parallel reads instead of repeatedly loading whole files.
4. Substantial work uses an execution plan with real status changes, while simple work is
   handled directly.
5. The agent performs coherent edits, tests the relevant behavior, reviews the diff, and
   repairs failures rather than stopping at plausible code.
6. Tool output, command lifetime, native response state, compaction, and recovery are
   first-class harness concerns, so a long task does not degrade into lost context or
   repeated side effects.
7. Independent exploration, test triage, and review can be delegated while the main thread
   retains requirements, integration, and final verification.

These mechanisms reduce four common sources of apparent model weakness:

- missing or polluted context;
- premature implementation without a real reproduction;
- fragile or repetitive tool use;
- an unearned completion claim.

## Public sources

The following sources were actually fetched and read during this review.

| Source | Mechanism used |
| --- | --- |
| [Codex best practices](https://learn.chatgpt.com/guides/best-practices.md) | Goal/context/constraints/done framing; plan for difficult work; durable `AGENTS.md`; testing and review loop; one coherent chat per outcome |
| [Prompting guide](https://learn.chatgpt.com/docs/prompting.md) | Codex recipes for codebase explanation, bug reproduction, tests, UI inspection, reviews, and documentation; concrete verification prompts |
| [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide.md) | Persistence, code implementation, exploration batching, plan closure, apply-patch and terminal tooling, output truncation, commentary/final phase persistence. The page is marked archived, so model-specific statements were treated as historical integration guidance rather than current model recommendations |
| [Using PLANS.md](https://developers.openai.com/cookbook/articles/codex_exec_plans.md) | Self-contained living plans, observable outcomes, progress/discovery/decision logs, recovery and validation boundaries. The recipe is archived; only durable planning principles were retained |
| [OpenAI Codex repository](https://github.com/openai/codex) and its [Core prompt sources](https://github.com/openai/codex/tree/main/codex-rs/core) | Apache-2.0 public implementation used to cross-check repository guidance, plans, tool lifecycle, native state, and delivery behavior. No upstream prompt text or implementation was copied into Mingshen resource files |

The broad, current self-knowledge manual was fetched through the bundled `openai-docs`
helper. The exact pages above were then read for the material claims used here.

## Harness mechanisms already present

Mingshen already contains the foundation needed for a high-throughput loop:

- `code_index`, LSP, targeted file reads, and bounded parallel read batches;
- structured plans, `begin_plan_step`, dependencies, checkpoints, and persisted
  continuation state;
- managed command sessions with `write_stdin`, cancellation, and cleanup tracking;
- repeated-failure guarding, bounded tool output, and session-scoped
  `read_tool_output` recovery;
- Responses-native state with persisted commentary/final `phase`, encrypted reasoning
  where supported, and a continuation guard for commentary-only output;
- compaction, context restoration, checkpoints, subagents, explicit code verification,
  diff review, and risk-based delivery reporting.

Local file checkpoints are automatic for the main-session full-access host managed writes
under the configured budget. They are not a universal rollback mechanism for terminal
commands, MCP calls, external programs, or remote side effects.

The improvement therefore belongs in two places: make these mechanisms easier for the
model to apply consistently, and let the normal engine continue enforcing them. Adding a
second planner or tool executor would duplicate behavior and increase drift.

## Built-in skill changes

The five packaged CodeAgent workflows were replaced with focused operational playbooks:

| Skill | Improvement |
| --- | --- |
| `code-engineering` | Decision-complete task contract, repository reconnaissance, AST/index usage, concurrent-read rules, coherent edits, write ownership, context recovery, integration closure |
| `code-debugging` | Falsifiable reproduction, actual-path tracing, hypothesis ladder, failure taxonomy, root-owner repair, race/performance discipline, repeated-failure and uncertain-side-effect recovery |
| `code-verification` | Evidence matrix, check escalation order, command-session handling, failure classification, final diff review, user-visible and packaged acceptance, precise status language |
| `code-frontend` | Existing design-system grounding, state model, semantic/accessibility controls, resilient layout, meaningful motion, stale-state handling, real desktop/narrow/theme screenshot acceptance |
| `code-platform` | Service/data contracts, additive migration history, bounded side effects, supply chain, Windows/package separation, observability, recovery and deployment evidence |

The five entry files remain at `skills/<id>.md`. Conditional deep procedures use the
shared read-only layout `skills/<id>/references/<file>.md`:

- `code-engineering/references/large-change-execution.md`
- `code-debugging/references/failure-forensics.md`
- `code-verification/references/test-design.md`
- `code-frontend/references/visual-acceptance.md`
- `code-platform/references/release-safety.md`

Each entry links only to the reference it may need. The content follows the skill-creator
principles of task-specific guidance, low-cost discovery, and progressive disclosure.
References are Markdown only; they do not execute scripts or grant permissions.

## Deliberate boundaries

- No OpenAI prompt text, private instructions, local Office skills, or unrestricted
  upstream runtime was copied.
- No new dependency, model call, database schema, version bump, or execution-engine
  duplication was introduced by this CodeAgent resource pass.
- The workflows preserve the existing sandbox, approval, file ownership, recovery,
  output-retention, and verification enforcement. Instructions do not grant tools or
  permissions.
- A repository cannot become fully autonomous from prose alone. Automatic Skill/Plugin
  discovery and routing remains an engine responsibility; these resources improve the
  quality of the workflow after the relevant built-in skill is selected.
- `phase` and native Responses state were verified in current source and tests, not assumed
  from the archived cookbook.

## Verification plan

For this resource-only change, verification must establish that:

- every catalogued CodeAgent skill still loads through the existing 32,000-character
  built-in path;
- all five files contain real, non-placeholder instructions and valid local tool names;
- the catalog remains Code-only and Chat cannot load these skills;
- production resources still pass the package preflight;
- independent scenario review finds the workflows actionable rather than generic.

This is not a model-quality A/B experiment. Proving that one model using Mingshen now
matches or exceeds Codex requires a controlled live evaluation with the same provider,
model, reasoning level, task fixtures, permissions, and cost envelope. The offline
`scripts/harness-eval.mjs` baseline validates grading and tool observations only; it is
not evidence of model capability.

## Current verification

- `pnpm --filter @mingshen/desktop exec vitest run src/main/chat/agent-specialization.test.ts`
  passed 1 file / 8 tests, including mode-scoped catalog loading and all twelve skill
  bodies.
- A resource validator passed all five entry files and five references for relative-link
  resolution, 32,000-character loading, 2 MiB maximum resource size, Markdown-only
  references, balanced fences, no scaffold placeholders, and reviewed tool contracts.
- `pnpm package:check` passed the existing 48-resource manifest, production dependencies,
  and version 1.3.3. The integration owner still needs to add the five reference paths to
  the explicit package-resource allowlist/count.
- An earlier Node/web TypeScript check passed. A later rerun during concurrent integration
  failed on unfinished quick-chat shortcut wiring and Office craft fixtures outside this
  resource ownership; this pass does not claim a final repository-wide typecheck.
- An independent read-only forward review exercised state-race, migration/IPC, and
  responsive/async UI scenarios. It found no P0/P1 issue and identified five contract
  details: terminal failure limit semantics, `code_index.graph` import edges, checkpoint
  scope, embedded-browser versus Electron-shell capture, and intermittent-failure
  acceptance. All five were corrected before the final resource checks.
- Repository-wide `pnpm lint` currently reports eight existing Biome formatting/import
  errors in desktop shortcut and Office visual source files outside this ownership; the
  Markdown skills and references are not implicated. They remain for the owning
  integration pass.

No live provider/model A/B was run, so this pass claims stronger packaged workflows and
contract correctness, not a measured parity or superiority result against Codex.

## Integration follow-up, 2026-11-18

The earlier owner-boundary failures above are historical. The integration pass added all
five Code references and four Office references to the explicit packaging checks. Source
preflight now passes 57 resources, production dependencies and version 1.3.3. Node/web
TypeScript, repository Biome and the production build also pass. Exact whole-suite,
desktop, Office rendering, failure and dependency-audit results are maintained in
[the 1.3.3 validation record](VALIDATION_1.3.3.md); this resource review does not replace
those results or add a model-quality comparison.
