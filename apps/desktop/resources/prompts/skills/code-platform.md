# Backend, Data, Platform, and Delivery Engineering

Use this workflow for services, persistence, authentication, CI/CD, Windows integration,
packaging, deployment, and operational changes. Correct local code is only part of the
contract; the result must survive its real runtime and upgrade boundary.

For migrations, release gates, Windows packaging, or any change that may affect installed
users during upgrade, load
[release-safety.md](code-platform/references/release-safety.md).

## Specify the service contract

Identify the public request and response shape, status and error semantics, caller
expectations, authentication and authorization, idempotency, pagination, and limits.
Distinguish absent, null, empty, zero, false, unknown, and unsupported.

Validate untrusted input where it enters the trusted layer. Use parameterized database
access, structured serializers/parsers, path normalization, output encoding, and explicit
timeouts. Do not construct shell, SQL, HTML, or filesystem commands from unchecked input.

Credential handling belongs in the trusted process. Never place secrets in client code,
logs, fixtures, error messages, URLs, or telemetry. Redact for display while preserving
the operational root cause.

## Protect state and migration history

Profile the real schema and query patterns before changing them. Use transactions where
multiple writes form one invariant. Check uniqueness, foreign keys, collation, time zones,
nullability, index selectivity, migration order, and concurrent updates.

Migrations are additive and replayable from every supported historical version. Preserve
existing data; verify upgrade with an old fixture and verify the failure boundary. Never
run destructive migration experiments against the user's normal database.

Backfills should be bounded, observable, restartable, and safe to run twice. If a change
cannot be rolled back without data loss, stop and make the recovery plan explicit before
executing it.

## Bound work and side effects

Use cancellation and appropriate retries. Retry read/idempotent operations only when the
error class permits it; do not repeat an uncertain mutation. Bound queue size, concurrency,
memory, recursion, files, rows, and network time.

Define ordering and ownership for background work. Handle duplicate delivery, lease
expiry, stale workers, partial failure, and restart. A timeout is an unknown outcome, not
a license to retry automatically.

## CI and supply chain

Read the real CI configuration. Use the repository package manager and frozen lockfile.
Make changes that work from a clean checkout, not only from an existing developer cache.
Keep build, test, artifact, and deployment permissions separate.

Inspect new dependencies for purpose, maintenance, license, transitive size, native
requirements, and vulnerability exposure. Pin deliberate runtime changes and update the
lockfile. Do not edit installed upstream packages or weaken signature, hash, sandbox, or
ACL checks to make delivery pass.

## Windows and desktop delivery

For Windows use the intended shell and literal paths, and account for spaces, Unicode,
long paths, working directory, encoding, process lifetime, and DLL/runtime placement.
Confirm the absolute scope before any recursive move or delete.

Keep unsigned development runs, unpacked application runs, installer creation,
installation, upgrade, and publication as separate evidence. Check resources from the
actual packaged layout. A successful build does not prove the installer or installed app
works. The complete gate and rollback checklist is in
[release-safety.md](code-platform/references/release-safety.md).

Read the repository's packaging notes before diagnosing `EPERM`, `EACCES`, or `EBUSY`.
Preserve user processes and files. Do not clear whole build, temp, AppData, or user-data
directories.

## Observability and recovery

Add structured diagnostics for the failure classes operators need to distinguish. Include
stable identity, state, duration, bounded context, and a safe error cause. Do not log whole
payloads, secrets, or unbounded user content.

Document the operational action for partial failure: inspect state, stop owned work, retry
safely, or roll back. For deployment, verify health and behavior after the artifact is in
the target environment rather than treating upload or process start as success.

Commit, push, deploy, publish, rotate credentials, and alter production data only within
the user's explicit authorization. Prepare a reviewable result and report build,
deployment, and runtime status separately and precisely.
