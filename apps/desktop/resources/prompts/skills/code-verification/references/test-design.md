# Risk-Based Test Design

Use this reference when the change needs new regression coverage, crosses a contract, or
has a failure mode that a simple happy-path assertion cannot catch.

## Turn the behavior into assertions

Name the observable behavior, the state before and after, and the forbidden side effect.
For a bug, reproduce the exact failing behavior first. A useful regression distinguishes
the old broken implementation from the repaired one and remains valid if internal helpers
are renamed.

Test through the narrowest layer that still owns the behavior:

- pure input/output or state transition at unit level;
- component integration where wiring, serialization, storage, or lifecycle matters;
- public CLI/API/UI path for end-to-end acceptance;
- packaged runtime for a distribution-only failure.

Use mocks at true process or service boundaries. Do not mock the function, parser, state
store, or component whose integration is the reason for the test.

## Select cases by failure class

Consider, where relevant:

- empty, missing, null, zero, false, maximum, and Unicode values;
- invalid, malformed, duplicated, and out-of-order inputs;
- cancellation before, during, and after an effect starts;
- timeout followed by late success or retry;
- restart after partial persistence;
- permissions denied at discovery and at execution;
- old data upgraded through every supported migration step;
- concurrent writers, stale revisions, and cleanup ownership;
- narrow viewport, long localized labels, focus, keyboard, and reduced motion.

Do not add every row mechanically. Select cases that can violate the actual invariant.

## Make tests deterministic

Use controllable clocks, ordering barriers, and explicit promises. Avoid arbitrary sleeps.
If timing is unavoidable, use wide but bounded convergence with a clear failure message,
and keep the pass condition independent of machine speed.

Tests must not read normal user data, credentials, or external mutable services. Use a
disposable directory/profile and synthetic fixtures. Cleanup must tolerate a prior test
failure without hiding the original error.

## Test compatibility and recovery

For additive migrations, verify a realistic old fixture, fresh creation, idempotent replay,
and the failure point that prevents partial commit. Preserve old-version data and assert
the exact new defaults.

For files and generated artifacts, verify source integrity, atomic replacement, and the
scope preserved on error. For permissions, exercise forged/direct entry as well as the
friendly UI path. For async work, assert both the resulting state and the absence of
duplicate effects.

## Review test quality

An assertion should explain what a user or caller can rely on. Avoid snapshots of enormous
unrelated output, tests of private implementation order, and constants that cannot fail
independently. A test that passes before the regression is present may still be useful as a
contract test, but it is not proof that the regression is covered.
