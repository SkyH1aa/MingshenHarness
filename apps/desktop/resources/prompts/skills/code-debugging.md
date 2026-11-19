# Evidence-Driven Debugging and Reliability

Use this workflow when behavior is wrong, flaky, slow, blocked, or not reproducible.
Optimize for finding the first violated invariant, not for finding a plausible line to
change.

For intermittent, concurrency, performance, leak, or cross-process investigation, load
[failure-forensics.md](code-debugging/references/failure-forensics.md).

## Start with a falsifiable bug statement

Capture:

- expected behavior and exact observed behavior;
- trigger or reproduction sequence, frequency, and relevant environment;
- earliest causal error and the last known good boundary;
- affected input, state, version, platform, and permission mode;
- what the user has already ruled out.

Reduce the report to the smallest scenario that still fails. Preserve a passing control
when one exists. Remove secrets and personal data before storing logs or fixtures. If the
report cannot be reproduced yet, say which evidence is missing and gather it rather than
guessing.

## Trace the real path

Follow the input through the actual caller, validation, transformation, asynchronous
boundary, persistence, and presentation. Use `code_index` to identify likely callers,
then confirm dynamic dispatch and runtime composition in source, tests, logs, or a debug
probe.

Separate:

- the original cause;
- secondary errors produced by cancellation, cleanup, or retry;
- presentation symptoms;
- environment or permission failures;
- legitimate product behavior that differs from the report.

Read the closest test and the production path it exercises. A mocked unit test can show
how a component behaves in isolation, but not which component is wired in production.

## Build a diagnostic ladder

Choose observations that distinguish competing hypotheses. Start with the cheapest:
existing error boundaries, structured return values, command exit status, targeted logs,
test output, state inspection, and a minimal local reproduction.

When logging is necessary, add temporary evidence at a boundary, not vague messages on
every line. Log identity, ordering, and state transitions needed to separate hypotheses;
redact sensitive values. Remove temporary instrumentation or convert it into intentional
diagnostics after the cause is confirmed.

Change one causal variable at a time. If a hypothesis survives, strengthen it with an
independent observation. If it fails, update the model of the system instead of
accumulating speculative fixes.

## Classify the failure before repairing it

Use a concrete class such as:

- compile, type, lint, or schema mismatch;
- incorrect branch, boundary, null/empty, or error mapping;
- stale or duplicated asynchronous state;
- race, ordering, cancellation, or cleanup defect;
- persistence, migration, or serialization corruption;
- performance regression with a measured slow path;
- missing dependency, denied permission, transport loss, or test-environment issue.

The class determines the repair and verification. Do not loosen a timeout for a race,
change an assertion for an invalid product result, retry a non-idempotent request, or
hide a denied approval behind a success-shaped fallback.

## Repair the invariant owner

Add a regression that fails for the observed behavior before applying the fix when this
is practical. Fix the code that owns the broken invariant, not only the screen, wrapper,
or caller where the symptom appears. Preserve public contracts unless changing them is
required and authorized.

Cover the exact trigger plus one adjacent boundary that the root cause could also affect.
If the fix changes shared behavior, trace all call sites and persisted states.

## Concurrency and lifecycle

Construct a timeline of events, requests, revisions, ownership, and cancellation. Check
double submission, stale closures, late responses, subscription cleanup, component
unmounts, process termination, and restart state.

Test races with controllable promises, barriers, or event order, not long sleeps. Assert
both the intended state and the absence of duplicate side effects. If cancellation can
arrive after a remote operation starts, verify the remote outcome before retrying. Use
[failure-forensics.md](code-debugging/references/failure-forensics.md) for event timelines,
leak ownership, and cross-process evidence.

For an intermittent bug, record the pre-fix frequency and trigger conditions. A single
successful rerun is not enough. Re-run the original workload for a justified repetition
count, use the same concurrency and environment, or construct a deterministic interleaving
that exercises the bad order. Report the before/after distribution or the deterministic
evidence; merely increasing a timeout is not proof that a race or flaky operation is fixed.

## Performance defects

Measure before optimizing. Record workload, input size, cold/warm state, latency
distribution, memory, and main-thread work as applicable. Profile the actual slow path,
then set a bounded target. Re-run the same workload after the change.

Prefer removing repeated work, narrowing scans, batching independent I/O, bounding
queues, streaming large output, and adding backpressure. Do not call a synthetic microbench
a production performance proof.

## Failure-loop discipline

Repeating the same tool with unchanged input and no new evidence is not a new strategy.
After a repeated failure, inspect schema, arguments, state, environment, permission, and
preconditions. Change the hypothesis, tool, scope, or implementation.

Keep different failure classes separate. A timeout means the command's final state is
unknown. A denied approval is not an environmental bug. A missing executable is not a
failed assertion. Check active command sessions, partial files, and server state before
repeating a possible mutation.

If the Host returns `STRATEGY_CHANGE_REQUIRED`, do not replay the known path. Inspect the
error and current state, then change the hypothesis, tool, scope, or implementation with
new evidence. `TOOL_FAILURE_LIMIT` is a current-run terminal state: stop, preserve the
evidence and completed work, and report the blocker. Only a new user turn can resume after
the cause is addressed. Do not evade either guard with whitespace, equivalent commands,
or changed call IDs.

## Recovery and closeout

For a potentially executed mutation, use read-only inspection and
`resolve_interrupted` when required by the Host. Confirm locally or remotely that an
uncertain action has stopped. Never describe an unconfirmed operation as rolled back.

Finish by re-running the original reproduction through the public path, running the
smallest relevant regression and risk-appropriate checks, checking cleanup, and reviewing
the final diff. Report the causal finding, changed behavior, evidence, and any issue that
remains intermittent or unverified.
