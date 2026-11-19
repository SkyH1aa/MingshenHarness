# Verification, Regression Review, and Delivery Evidence

Verification proves the requested behavior with the least test scope that still covers
its real risk. It is not a ritual performed after the code becomes too expensive to
change.

Use [test-design.md](code-verification/references/test-design.md) when selecting regression
layers, designing migration/lifecycle coverage, or reviewing whether new tests can actually
distinguish the repaired behavior.

## Build an evidence matrix

Before declaring substantial work complete, map each behavior change to evidence:

| Change | Minimum useful evidence |
| --- | --- |
| Local deterministic function | Focused regression plus adjacent boundary |
| Bug fix | Original reproduction now passes; nearby bad input stays safe |
| Intermittent failure | Pre/post frequency or deterministic interleaving under comparable conditions |
| Shared contract/type | Caller coverage, serialization, compatibility, failure path |
| Storage or schema | Fresh install, old-data upgrade, rollback/error boundary |
| Permission/isolation | Forged or direct entry rejection with no forbidden side effect |
| Async lifecycle | Success, cancellation, timeout, stale response, cleanup, restart |
| UI/interaction | Real rendered path, keyboard/focus, states, narrow viewport, theme |
| Build/package | Production build, packaged resource, runtime dependency, launch path |

Add tests for observable behavior and meaningful invariants. Do not add tests that merely
repeat a constant, assert mock call count without a behavioral consequence, or mock away
the component whose integration is at risk. Detailed coverage selection is in
[test-design.md](code-verification/references/test-design.md).

## Run checks in escalation order

Start with the failing regression or the narrow test file that exercises the change.
Then run adjacent tests for the affected boundary. Run type checking, linting, and build
when their inputs or contracts changed. Run a broader suite when the patch crosses shared
state, permissions, persistence, concurrency, or user-facing flows.

Use the repository's declared package manager and scripts. This Harness also accepts a
root `mingshen.verify.json` with 1-6 commands:

```json
{
  "commands": ["pnpm test", "pnpm lint", "pnpm typecheck"]
}
```

Review commands before execution because project checks can run arbitrary code. Do not
declare a long-lived dev/watch process as a verification command.

For long commands, use the managed command session and bounded output. Poll real progress,
preserve the last meaningful error, stop only processes started by this run when their
ownership is confirmed, and wait for cleanup. A command that timed out is not proven to
have failed before or after the timeout boundary.

## Interpret failures precisely

Record exact command, working directory, exit status, and relevant output. Classify a
failure as:

- product regression;
- invalid or flaky test;
- missing dependency or tool;
- permission, approval, or sandbox denial;
- timeout, transport loss, or uncertain external state;
- environment-specific incompatibility.

Diagnose before changing assertions, retry counts, or timeouts. Preserve the first failed
result. A later focused pass does not erase an earlier broad-suite failure; explain
whether it was repaired or remained environmental.

For a flaky or intermittent result, one passing rerun is not acceptance. Record the
pre-fix failure conditions, repeat the public reproduction or use a deterministic event
ordering, and report the observed post-fix distribution. If the race cannot be reproduced
on demand, state that the regression is not proven rather than replacing it with a longer
timeout.

Do not dump raw secrets, tokens, personal paths, or private content into evidence. Use
test fixtures in disposable directories and never use a user's normal database as
disposable test data.

## Review the diff before calling it complete

Inspect the final diff, not only the files remembered during editing. Check:

- accidental files, generated artifacts, formatting churn, or unrelated user changes;
- missing callers, imports, registrations, IPC/API clients, docs, and resources;
- validation gaps at trust boundaries;
- path, shell, SQL, HTML, template, and prompt-injection risk;
- unsafe fallback, hidden failure, unbounded scan, retry, queue, or memory growth;
- stale state, race, cleanup, cancellation, and restart behavior;
- encoding, line endings, Unicode paths, Windows compatibility, and packaging;
- dependency license, runtime, native module, and lockfile changes.

For review requests, lead with actionable correctness and security findings ordered by
severity, cite exact locations, and keep the change summary secondary. If no issue is
found, say so and name the residual test or compatibility gap.

## Verify the user-visible workflow

A unit test is not a full delivery check. Exercise the public entry point with a
representative successful case, one important failure case, and any change-specific
boundary such as retry, cancellation, restart, or approval.

For embedded web content, `browser_screenshot` captures the guest webview. For the
Electron application shell or React renderer, launch a disposable local profile and use
the repository's Electron/CDP smoke path to capture the actual BrowserWindow, then inspect
the resulting pixels through image-capable model input or `view_image`. A saved PNG path
without consumed pixels is not visual acceptance. Check console errors,
loading/empty/error states, focus, keyboard access, text fit, overlap, horizontal overflow,
narrow width, supported themes, and representative real data. A DOM node or build success
is not visual acceptance.

For packaging, distinguish source checks, production build, unpacked application launch,
installer creation, installation, upgrade, and publication. Verify resources from the
actual packaged layout rather than the source tree.

## Report evidence without inflation

Use precise status words: written, unit-tested, integrated, built, rendered, executed
with a real service, installed, published. A plan step becomes verified only when its
completion condition was observed.

At handoff state:

- the resulting behavior;
- checks actually run and their results;
- known failures, skips, environmental limits, and unverified areas;
- any cleanup or follow-up required before the user can rely on the result.

Do not bury a failing check under a broad success claim, and do not require a full suite
after every small edit when the focused checks already cover the change and no new shared
risk was introduced.
