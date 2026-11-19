# Release and Delivery Safety

Use this reference for migrations, packaging, CI/CD, signing, deployment, or changes that
could affect existing users during upgrade.

## Separate the delivery gates

Treat these as distinct results:

1. source validation;
2. production build;
3. packaged resource/dependency inspection;
4. unpacked application launch;
5. installer creation;
6. install and first run;
7. upgrade over an old fixture;
8. publication or remote deployment.

Passing an earlier gate does not imply a later one. Never describe an upload, release draft,
or process start as an installed or verified release.

## Protect user state

Back up or version migration inputs and use disposable fixtures. Verify the oldest supported
state, the previous released state, a partially written state, and repeat execution where
migrations are intended to be replayable.

Use additive changes and a transaction for invariants that must commit together. Define what
the user sees if a migration cannot finish. Do not clear a whole profile, database, cache,
or AppData directory to recover unless the user explicitly authorizes that data loss.

## Inspect dependencies and resources

Confirm the intended package manager, frozen lockfile, production dependency graph, native
modules, licenses, and platform architecture. Resources required at runtime must exist in
the packaged layout under the same relative path the application resolves.

Keep secrets out of build artifacts and logs. Do not weaken code signing, hash checks,
sandboxing, ACLs, or the installer configuration to bypass a local error.

## Windows-specific checks

Use literal paths and verify spaces, Unicode, long paths, current directory, file locks, and
process ownership. Confirm that an existing Office, browser, or Electron process belongs to
the exception before handling it.

For `EPERM`, `EACCES`, or `EBUSY`, identify the exact file and owner. Retry only through the
repository's approved packaging path. Never recursively delete an unverified build or temp
path.

## Rollout and rollback

Know whether the change rolls forward, rolls back, or cannot be reversed. A rollback plan
must include stored data and external side effects, not only the executable version.

For remote services, verify health, authorization, and a representative user path after
deployment. Keep build, deployment, and runtime logs separately so one successful layer
does not obscure a failure in another.

Publishing, deployment, credential rotation, and production data changes require explicit
user authorization. Without that authorization, stop at a reviewable local artifact and
state exactly what remains unperformed.
