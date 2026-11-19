# Large-Change Execution Ledger

Use this reference when work spans several coupled milestones, crosses sessions, changes
storage plus runtime surfaces, or cannot be safely reconstructed from the current turn.
It adds continuity discipline; it does not replace the main engineering workflow.

## Define milestones with observable exits

Each milestone should leave the repository in a state that can be inspected and tested.
State:

- the user-visible or contract-level outcome;
- the files/systems expected to own it;
- prerequisites and dependent milestones;
- the command, interaction, or artifact that proves the milestone;
- what remains intentionally unsupported.

Avoid milestones such as "implement backend" that hide several independent risks. Split
only where a meaningful boundary exists; do not turn a small patch into ceremony.

## Maintain a compact evidence ledger

Keep a short ledger of accepted requirements, confirmed repository facts, material design
decisions, changed paths, commands and results, unresolved risks, and the next executable
step. Put raw logs in the bounded output store and retain only the relevant error or result
in the ledger.

Use `update_todos` and `begin_plan_step` as the authoritative execution state. The ledger
is for decisions and evidence that would otherwise be lost; it is not a second status
system. Record a design decision only when it changes the implementation, compatibility,
or recovery path.

## Sequence coherent, reversible slices

Before editing a slice, re-read files that may have changed and inspect current ownership.
Implement all coupled changes needed for that slice to compile or behave coherently, then
run the narrowest check. Review the diff before starting the next slice so a wrong contract
does not propagate.

For a risky managed file write, know whether the Host will create a pre-write checkpoint
and what that checkpoint restores. The local file checkpoint does not include commands,
MCP activity, external applications, or remote effects. Preserve an explicit recovery or
forward-fix path for those surfaces.

## Delegate by ownership boundary

Use delegates for independent repository mapping, research, test design, or review. Each
delegate needs a bounded question, allowed paths, expected evidence, and a clear statement
of whether it may write. Do not assign overlapping writers.

Continue local work that does not depend on the delegate, but do not integrate speculative
answers before results arrive. Reconcile contradictory evidence yourself and rerun shared
or integration checks after merging changes.

## Survive interruption and compaction

On resume:

1. Read the current persisted plan and agent mode.
2. Inspect `git status` and the relevant files instead of trusting remembered contents.
3. Check uncertain side effects before any new mutation.
4. Reconcile the ledger with actual files, tests, and command sessions.
5. Continue the first incomplete milestone, or revise the plan when the evidence changed.

Never replay an old tool call solely because it appears in reconstructed history. Never
assume that an interrupted process ended, a file write failed, or a remote request did not
execute without inspecting the actual state.

## Close the whole change

Reconcile every planned item as complete, cancelled with a reason, or blocked with a
concrete cause. Run integrated checks for the finished behavior, inspect the final diff,
and remove temporary fixtures or processes. Report evidence by milestone and name anything
that remains unverified.
