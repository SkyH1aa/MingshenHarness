# Security Validation: Mingshen Harness 1.2.1

Date: 2026-11-03. Scope: source, controlled local fixtures, built Electron renderer
and Docker probes. No public service was attacked or private third-party data read.
No paid model calls were made. This is not independent penetration testing or proof
of no vulnerabilities. Full Access deliberately permits current-user execution.

> Historical report for the earlier build. Native Windows isolation, the configured
> public GitHub Client ID and other later changes supersede related implementation
> status below; this is not a full validation of the current working tree. The
> completion-notification update is verified separately in
> [Notification validation](NOTIFICATION_VALIDATION_1.2.1.md). BrowserDo/Embiody and
> the full security suite were not rerun for that update.

## Threat matrix

| Requested risk | Review, correction and evidence | Remaining boundary |
| --- | --- | --- |
| RCE | IPC requires main top frame and app URL; guest preload/Node/IPC removed; executable chat links blocked; protected host custom tools/hooks/LSP disabled; listing tools does not import modules; local MCP startup approval | Full Access and approved local MCP intentionally execute code; third-party safety is not guaranteed |
| Sandbox escape | Real Docker: read-only root, dropped capabilities, no-new-privileges, resource limits, no network/socket, only workspace mount, no host fallback; junction sentinel inaccessible | No kernel/engine escape guarantee; native Windows AppContainer is not implemented |
| Privilege escalation | Current-user execution; no automatic elevation added | Official installers may require privileges; no kernel/admin escalation penetration test |
| Account takeover | safeStorage at rest, masking, Device Flow origin validation, generic OAuth state/PKCE | No hosted login; real GitHub login pending Client ID; compromised same-user account remains out of scope |
| Cross-tenant access | No hosted tenant backend; workspace ownership in project MCP routing and session-scoped approvals | Windows user profiles are not an implemented organization tenancy service |
| Unauthorized sensitive access | Project-config instructions restricted inside workspace; protected custom-command file references disabled; file/link boundary regressions | Known AGENTS.md auto-discovery is a product feature; trusted Full Access can access local files |
| SSRF | Public Agent fetch denies private/loopback/metadata/mapped/tunneled addresses; DNS checked at connect and each redirect; 2 MiB limit | Explicitly configured local provider/MCP addresses and browser browsing are separate authorized surfaces |
| Arbitrary file access | Approval, workspace/device/ADS/link checks, snapshot/Git recovery path checks; actual junction sentinel unchanged | Host checks are not race-free handle-based enforcement; hostile concurrent TOCTOU remains |
| Information leakage | HTTP/stream errors preserve status/body/request ID and redact configured credentials; MCP redacts headers/env/OAuth values; generic API 500 | Third-party diagnostics may contain unknown private content; review shared logs |
| CSRF / rebinding | API binds 127.0.0.1, random Bearer token, Host/Origin/Fetch Metadata checks; hostile Origin/Host tests | Public port forwarding and stolen tokens change the boundary |
| Reflected XSS | DOMPurify, KaTeX trust=false, CSP, escaped malicious share title; OAuth failure text/plain | No comprehensive browser fuzzing or independent XSS audit |
| Path traversal | Safe paths, backup/snapshot IDs, link filtering, project-instruction boundary test | User-initiated UI file access and Full Access are intentionally broader |
| Clickjacking | X-Frame-Options DENY and CSP frame-ancestors none on local HTTP responses, header tests | External sites control their own headers; no desktop overlay defense |
| Misconfiguration | Guest permissions/downloads/navigation restricted; first consent gates business IPC and schedules; dependency audit clean | Unsigned experimental app; clean-machine installer not tested; npx MCP dependencies not fully pinned |
| Error exposure | Useful bounded local diagnostics and secret redaction; generic unauthenticated API failures | Details are deliberately visible to local users and may contain unknown private information |

## Corrections

- Command approval prefix checks now require a token boundary and reject chained,
  piped or substituted suffixes. Tests include similar names and other sessions.
- Protected commands use Docker and fail closed; browser operations require approval.
- Local MCP startup is approved before discovery; denial excludes its process.
- Authenticated provider/MCP requests reject redirects; MCP errors redact secrets.
- Public Agent fetch checks DNS at connection and redirects, with response limits.
- Chat links reject executable/UNC targets; relative files open the editor. Browser
  registration verifies the guest belongs to the calling application window.
- Project instruction configuration cannot inject arbitrary outside files.
- Custom tool metadata listing no longer executes modules.
- MCP/LSP Windows launch uses cross-spawn escaping instead of raw shell=true.
- Updated vulnerable production dependencies: SheetJS CE, YAML and transitive Zod.

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod --json
node scripts/desktop-smoke.mjs
node scripts/security-path-smoke.mjs --docker
$env:MINGSHEN_DOCKER_E2E='1'
pnpm --filter @mingshen/desktop exec vitest run src/main/workspace/docker-live.test.ts
$env:MINGSHEN_MCP_E2E='1'
pnpm --filter @mingshen/desktop exec vitest run src/main/mcp/mcp-service.test.ts
```

Default suite: 72 passed, 7 optional skipped. Enabled Docker: 2 passed. Enabled MCP:
4 passed; BrowserDo operational test is separate and fails with the current external
browser build. Production audit: zero known advisories. Desktop tests use a mock
model and real files, not paid inference or external GitHub writes.

## Before an enterprise claim

1. Implement/review native Windows file/process containment or an isolated execution
   service; eliminate host path-check races.
2. Resolve upstream Embiody 0.9.0.5 launch failure; verify actual BrowserDo actions.
3. Test real publisher GitHub Device Flow/scopes/refresh and credentialed Notion and
   Browserbase accounts.
4. Review Git filters and all malicious-repository execution paths. Hooks/fsmonitor/
   external diff are disabled in inspection helpers, but filters remain a boundary.
5. Pin MCP/runtime supply chains and image digests; collect transitive notices.
6. Test final packages on clean Windows 10/11, upgrades and rollback. No installer
   was created in this task; no signing or packaged-app claim is made.
7. Obtain independent penetration testing, fuzzing and incident-response ownership.
8. Finish ecosystem integration gaps, including release polling and optional cloud
   diagnostics. SQL definitions alone do not implement an application client.

## References reviewed

- https://developers.openai.com/codex/windows/windows-sandbox/
- https://raw.githubusercontent.com/anomalyco/opencode/dev/SECURITY.md
- https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md
- https://github.com/zhaijunlong/browserdo
- https://embiody.com/eula

Codex Windows documentation describes native sandboxing, not bundled Docker Desktop.
OpenCode distinguishes a permission policy from a sandbox. Mingshen must preserve
these distinctions in product claims.
