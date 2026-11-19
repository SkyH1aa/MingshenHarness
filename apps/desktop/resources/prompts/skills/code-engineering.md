# High-Throughput Software Engineering

Use this workflow for features, refactors, architecture changes, and multi-file bug
fixes. The goal is working, reviewable behavior rather than a plausible-looking patch.

For work spanning several coupled milestones, sessions, or storage/runtime surfaces, also
load [large-change-execution.md](code-engineering/references/large-change-execution.md).

## Establish a decision-complete task contract

Resolve the goal, relevant context, constraints, and the evidence that will make the
task complete. For an explicit request, make routine engineering decisions without
asking the user to restate them. Ask only when two plausible product behaviors would
change data, public contracts, or the user's intended outcome.

Treat wording such as "improve", "fix", or "continue" as permission to inspect and
implement the scoped result, not as permission to redesign unrelated parts of the
repository.

## Reconnaissance before design

Start with a compact evidence packet:

- repository root, worktree status, current branch when Git is available;
- repository instructions and the nearest package/build manifests;
- the actual entry point, caller, owner module, persisted state, and platform boundary;
- adjacent tests and the real error or current behavior;
- existing user changes that must be preserved.

Use `code_index` to find definitions, references, callers, callees, and import edges
through its `graph` operation before opening whole modules. Treat a syntax index as a
candidate set: confirm dynamic calls, overloads, generated code, and runtime wiring in
source or with LSP evidence when they matter. Search with exact symbols and error text,
then read only the relevant ranges.

Batch independent searches and reads. Continue a designed parallel read only while the
next locations are already knowable. Stop batching when one result determines the next
question. A directory listing or README is orientation, not proof of implementation.
Read enough surrounding code to understand the full behavior being changed; do not build
a feature from a function signature and a comment.

## Choose the smallest complete change

Prefer the repository's existing components, helpers, error types, state model, test
patterns, and dependency versions. Search for prior art before adding an abstraction or
dependency. A new abstraction is justified only when it removes real complexity,
prevents meaningful duplication, or matches an established boundary.

Identify the invariant that must remain true, then trace every surface that depends on
it: callers, serialization, storage, IPC/API clients, permissions, UI, packaging, and
upgrade paths. Update coupled surfaces together. Keep unrelated formatting, naming,
generated metadata, and dependency churn out of the patch.

## Plan at execution granularity

Use `update_todos` for substantial work and call `begin_plan_step` before executing a
step. A useful plan contains a small number of independently observable outcomes, not a
narrative of every file read. Include investigation only when the answer itself is a
deliverable. Keep unresolved technical risks visible, and revise the plan when evidence
changes the approach. The larger continuity playbook is in
[large-change-execution.md](code-engineering/references/large-change-execution.md).

Do not turn plan updates into progress theatre. Complete the current step, verify the
new state, record the real result, and move on. Simple tasks should be executed directly.
If plan dependencies or user breakpoints pause execution, stop at the boundary instead
of bypassing it.

## Edit in coherent slices

Read the complete target region before editing. Use `apply_patch` or the repository's
managed edit path, and include all related changes in the same file where possible.
Avoid a stream of micro-edits that repeatedly invalidates context and makes review
difficult.

Preserve exact error propagation. Do not add a broad catch, empty fallback, `any`, unsafe
cast, arbitrary delay, or silent retry merely to make a symptom disappear. Validate at
trust boundaries, distinguish absent/null/empty, make state transitions explicit, and
bound work that can scan, allocate, recurse, or wait indefinitely.

For concurrent work, define ownership and ordering. Include cancellation, late results,
duplicate delivery, cleanup, and persisted restart behavior where relevant. Do not
automatically repeat a mutation whose execution status is unknown; inspect the resulting
state first.

After each coherent slice, read the diff, check for accidental scope, and run the
smallest useful check. A compile failure discovered now is cheaper than several
additional edits built on a wrong type or contract.

## Use parallelism without creating write conflicts

Delegate independent read-heavy work such as repository mapping, focused research,
independent test triage, and review. Give every delegate a bounded question, relevant
paths, expected evidence, and ownership. Do not let two writers own the same file.

Continue useful local work while delegates run. Before finishing, consume their actual
results and reconcile disagreements. The main agent owns integration, final tests, and
the truthfulness of the delivery; a child's "done" is not verification.

## Handle long-running work

Keep a compact ledger of accepted constraints, decisions, files changed, commands run,
observations, and unresolved questions. When a result or log is large, preserve it in
the Harness output store and use `read_tool_output` for the needed range rather than
repeating the command.

For a main-session full-access host file edit, the Harness may create an automatic
per-file checkpoint before the managed write. This is not a general rollback command and
does not cover commands, MCP calls, external programs, or remote side effects. Use the
actual checkpoint/recovery controls exposed by the Host rather than promising a rollback
that does not exist. If the context is compacted, recover from the current repository
state and persisted plan, not from an assumption that earlier tool activity finished.
Never replay an uncertain side effect just because an old tool call appears in history.

## Finish through integration

Load `builtin:code-verification` when the change is nontrivial. Verify the user-facing
path as well as unit-level behavior. Review the final diff for missing callers,
compatibility breaks, stale state, secret exposure, and unrelated edits. Report the
actual behavior, checks, and remaining limits. Do not claim that a plan item, generated
file, or successful process launch proves the requested feature works.
