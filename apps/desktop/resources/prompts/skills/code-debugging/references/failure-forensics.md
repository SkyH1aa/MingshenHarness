# Failure Forensics

Use this reference for intermittent, concurrency, lifecycle, performance, resource-leak,
or cross-process failures. Start with the smallest reproduction and preserve the main
debugging discipline.

## Normalize the failure record

Record the operation, inputs, expected and actual states, time, environment, revision,
frequency, and observation source. Distinguish user report, model inference, application
log, platform diagnostic, and test result.

For a flaky case, log attempts and outcomes rather than only the passing run:

```text
attempts=20 passed=13 failed=7 first_failure=attempt-3
condition=two concurrent saves, workspace changed between read and write
```

Twenty attempts are not automatically better evidence than five. Choose a repetition count
or deterministic interleaving that can distinguish the predicted failure rate from a
single lucky pass.

## Build an event timeline

For asynchronous defects, give every relevant event an identity and order: request start,
state revision, lock/lease, response arrival, cancellation, cleanup, persistence, and UI
update. Compare expected ordering with observed ordering.

Look for:

- duplicate or late delivery;
- stale result accepted after a newer request;
- lock or writer ownership released by the wrong task;
- cancellation that stops the UI while work continues elsewhere;
- timeout followed by a retry that duplicates a non-idempotent mutation;
- cleanup using an inferred rather than recorded process owner;
- persisted state that disagrees with the live object after restart.

Use controllable promises, barriers, fake clocks, and event injection. Avoid sleeps unless
the test is explicitly measuring wall-clock behavior.

## Investigate performance with a baseline

Measure the same representative workload before and after:

- input and output size, concurrency, cache state, and environment;
- latency distribution, not only one average;
- main-thread long tasks or event-loop delay where relevant;
- CPU, memory, file handles, queues, and backpressure;
- cold and warm behavior separately.

Profile before changing code. A hot helper may be a symptom of repeated calls from a
larger path. Re-measure after the repair and report variance and environment limits.

## Investigate resource and lifecycle leaks

List every resource that must be closed, unsubscribed, aborted, released, or removed:
timers, subscriptions, worker threads, file handles, database connections, child
processes, temporary profiles, locks, and listeners.

Verify the success path, exception path, cancellation path, process restart, and duplicate
initialization. Assert that cleanup happens once and only for resources owned by this run.
Do not terminate processes by a broad name match when the run did not establish ownership.

## Distributed and external boundaries

A timeout is not proof of failure. Check the remote or persistent state before retrying a
mutation. Preserve request identity and idempotency keys when the external contract offers
them.

When the result is still unknown, stop side effects, inspect the narrowest available
evidence, and report the uncertainty. An operator may need to verify the external system
before the local task can safely continue.

## Instrument without contaminating the product

Add boundary-level diagnostics that identify state and ordering, not vague position
markers. Redact credentials and user content. Remove temporary probes, restore intentional
logging, and check that tests do not depend on debug-only timing or output.
