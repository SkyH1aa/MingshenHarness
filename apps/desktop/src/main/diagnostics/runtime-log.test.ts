import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installRuntimeLog,
  RuntimeLogService,
  recordRuntimeWarning,
  registerRuntimeSecret,
  sanitizeRuntimeText,
} from "./runtime-log";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mingshen-runtime-log-"));
  roots.push(root);
  return { root, logger: new RuntimeLogService(join(root, "logs"), "1.2.5") };
}

describe("local runtime error logs", () => {
  it("retains HTTP status, cause, attempt and IDs while removing credentials and echoed model inputs", async () => {
    const { root, logger } = await fixture();
    registerRuntimeSecret("opaque-local-credential-2198");
    logger.record(
      "approval.model",
      new Error(
        'HTTP 503 Stream failed\nAuthorization: Bearer visible-credential\nCookie: session=browser-secret\nhttps://user:pass@example.test/api?credential=hidden\n{"error":"bad request","messages":[{"role":"user","content":"private history"}],"apiKey":"opaque-local-credential-2198"}',
        { cause: new Error("ECONNRESET") },
      ),
      { sessionId: "session", runId: "run", attempt: "primary" },
    );
    const path = join(root, "export.json");
    await logger.export(path);
    const text = await readFile(path, "utf8");
    const report = JSON.parse(text);
    expect(report).toMatchObject({ version: "1.2.5", localOnly: true });
    expect(report.entries[0]).toMatchObject({
      source: "approval.model",
      context: { status: 503, sessionId: "session", runId: "run", attempt: "primary" },
    });
    expect(text).toContain("ECONNRESET");
    for (const secret of [
      "visible-credential",
      "browser-secret",
      "private history",
      "opaque-local-credential-2198",
      "credential=hidden",
      "user:pass",
    ])
      expect(text).not.toContain(secret);
    expect(text).toContain("[OMITTED]");
    expect((await logger.status()).bytes).toBeGreaterThan(0);
    await expect(logger.export(join(root, "logs", "runtime.jsonl"))).rejects.toThrow("outside");
    const reopened = new RuntimeLogService(join(root, "logs"), "1.2.5");
    await reopened.export(join(root, "reopened.json"));
    expect(JSON.parse(await readFile(join(root, "reopened.json"), "utf8")).entries).toHaveLength(1);
  });

  it("serializes exports with concurrent appends without losing entries or corrupting JSON", async () => {
    const { root, logger } = await fixture();
    logger.record("network", "HTTP 502 before export");
    const exporting = logger.export(join(root, "first.json"));
    logger.record("network", "HTTP 403 during export");
    await exporting;
    await logger.export(join(root, "second.json"));
    expect(JSON.parse(await readFile(join(root, "first.json"), "utf8")).entries).toHaveLength(1);
    expect(JSON.parse(await readFile(join(root, "second.json"), "utf8")).entries).toHaveLength(2);
  });

  it("omits reflected HTTP bodies but preserves allowlisted codes, status, real stack and cause", async () => {
    const { root, logger } = await fixture();
    const reflected = "FIXTURE_PRIVATE_USER_INPUT_7394";
    const error = new Error(
      `HTTP 400 Bad Request\n${JSON.stringify({ error: { message: reflected, code: "content_policy_violation", type: "invalid_request_error", param: "prompt", detail: reflected } })}`,
      { cause: new Error("ECONNRESET fixture") },
    );
    logger.record("ipc.request", error, { operation: "image-studio:generate" });
    logger.record("provider.test", `403 Forbidden\n${reflected}`, { status: 403 });
    logger.record("provider.test", `HTTP 502\n${reflected}`);
    logger.record("ordinary", "plain diagnostic remains visible");
    await logger.export(join(root, "http.json"));
    const text = await readFile(join(root, "http.json"), "utf8");
    const report = JSON.parse(text);
    expect(text).not.toContain(reflected);
    expect(report.entries[0].message).toContain("HTTP 400");
    expect(report.entries[0].message).toContain("code=content_policy_violation");
    expect(report.entries[0].message).toContain("type=invalid_request_error");
    expect(report.entries[0].message).toContain("param=prompt");
    expect(report.entries[0].message).toContain("ECONNRESET fixture");
    expect(report.entries[0].message).toContain("runtime-log.test.ts");
    expect(report.entries[1].message).toContain("HTTP 403");
    expect(report.entries[2].message).toContain("HTTP 502");
    expect(report.entries[3].message).toContain("plain diagnostic remains visible");
  });

  it("suppresses old HTTP bodies and rejects unrecognized free-form diagnostic fields", async () => {
    const { root, logger } = await fixture();
    await logger.status();
    const reflected = "FIXTURE_UNTRUSTED_PROVIDER_ECHO";
    await writeFile(
      join(root, "logs", "runtime.jsonl"),
      `${JSON.stringify({ timestamp: new Date().toISOString(), level: "error", source: "provider.test", context: { status: 400 }, message: `400 Bad Request\n${JSON.stringify({ error: { message: reflected, code: reflected, type: reflected, param: reflected } })}` })}\n`,
    );
    const reopened = new RuntimeLogService(join(root, "logs"), "1.2.5");
    await reopened.export(join(root, "old-http.json"));
    const text = await readFile(join(root, "old-http.json"), "utf8");
    expect(text).not.toContain(reflected);
    expect(text).toContain("HTTP 400");
  });

  it("repairs a missing final newline before append and accounts for the repaired byte when rotating", async () => {
    const { root, logger } = await fixture();
    await logger.status();
    const entry = {
      timestamp: new Date().toISOString(),
      level: "error",
      source: "legacy",
      message: "",
      context: {},
    };
    const empty = JSON.stringify(entry);
    entry.message = "x".repeat(3 * 1024 * 1024 - Buffer.byteLength(empty) - 1);
    const oldLine = JSON.stringify(entry);
    expect(Buffer.byteLength(oldLine)).toBe(3 * 1024 * 1024 - 1);
    await writeFile(join(root, "logs", "runtime.jsonl"), oldLine);
    const reopened = new RuntimeLogService(join(root, "logs"), "1.2.5");
    reopened.record("new", "new failure");
    await reopened.export(join(root, "repaired.json"));
    const report = JSON.parse(await readFile(join(root, "repaired.json"), "utf8"));
    expect(report.entries.map((item: { source: string }) => item.source).sort()).toEqual([
      "legacy",
      "new",
    ]);
    expect(report.statistics.damaged).toBe(0);
    expect((await stat(join(root, "logs", "runtime.1.jsonl"))).size).toBe(3 * 1024 * 1024);
    expect((await reopened.status()).bytes).toBeLessThanOrEqual(15 * 1024 * 1024);
  });

  it("includes pending write failures in repeated status and export without double counting", async () => {
    const { root } = await fixture();
    const directory = join(root, "blocked");
    await writeFile(directory, "file");
    const logger = new RuntimeLogService(directory, "1.2.5");
    logger.record("fixture", "unpersisted error");
    logger.record("fixture", "unpersisted warning", {}, "warn");
    await logger.flush();
    await rm(directory);
    await mkdir(directory);
    expect((await logger.status()).statistics.omitted).toEqual({
      errors: 1,
      warnings: 1,
      unknown: 0,
    });
    expect((await logger.status()).statistics.omitted).toEqual({
      errors: 1,
      warnings: 1,
      unknown: 0,
    });
    await logger.export(join(root, "pending.json"));
    expect(
      JSON.parse(await readFile(join(root, "pending.json"), "utf8")).statistics.omitted,
    ).toEqual({ errors: 1, warnings: 1, unknown: 0 });
    logger.record("fixture", "next successful write");
    expect((await logger.status()).statistics.omitted).toEqual({
      errors: 1,
      warnings: 1,
      unknown: 0,
    });
  });

  it("rotates within 15 MiB total, removes old logs and preserves unrelated files", async () => {
    const { root, logger } = await fixture();
    await logger.status();
    const directory = join(root, "logs");
    await writeFile(join(directory, "runtime.4.jsonl"), "old");
    const old = new Date(Date.now() - 31 * 86400000);
    await utimes(join(directory, "runtime.4.jsonl"), old, old);
    await writeFile(join(directory, "keep.txt"), "unrelated");
    await writeFile(
      join(directory, "runtime.3.jsonl"),
      `${JSON.stringify({ timestamp: old.toISOString(), message: "expired" })}\n${JSON.stringify({ timestamp: new Date().toISOString(), message: "recent" })}\n`,
    );
    const reopened = new RuntimeLogService(directory, "1.2.5");
    await reopened.status();
    expect(await readdir(directory)).not.toContain("runtime.4.jsonl");
    expect(await readFile(join(directory, "runtime.3.jsonl"), "utf8")).not.toContain("expired");
    for (let index = 0; index < 1150; index++) {
      reopened.record("burst", `${index}: ${"x".repeat(15000)}`);
      if (index % 80 === 0) await reopened.flush();
    }
    const status = await reopened.status();
    expect(status.files).toBe(5);
    expect(status.maxBytes).toBe(15 * 1024 * 1024);
    expect(status.bytes).toBeLessThanOrEqual(status.maxBytes);
    for (const name of await readdir(directory)) {
      if (/^runtime(?:\.[1-4])?\.jsonl$/.test(name))
        expect((await stat(join(directory, name))).size).toBeLessThanOrEqual(3 * 1024 * 1024);
    }
    expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe("unrelated");
  });

  it("summarizes retained records and bounded omitted counts without equating them to incidents", async () => {
    const { root, logger } = await fixture();
    installRuntimeLog(logger);
    recordRuntimeWarning("local-api.request", "fixture rejection", { operation: "GET /v1/runs" });
    logger.record("ipc.request", "fixture failure", { operation: "image-studio:generate" });
    await logger.flush();
    const status = await logger.status();
    expect(status.statistics).toMatchObject({
      errors: 1,
      warnings: 1,
      omitted: { errors: 0, warnings: 0, unknown: 0 },
      damaged: 0,
    });
    expect(status.statistics.bySource).toContainEqual({
      name: "local-api.request",
      errors: 0,
      warnings: 1,
    });
    expect(status.statistics.byOperation).toContainEqual({
      name: "image-studio:generate",
      errors: 1,
      warnings: 0,
    });
    await logger.export(join(root, "stats.json"));
    const report = JSON.parse(await readFile(join(root, "stats.json"), "utf8"));
    expect(report.maxBytes).toBe(15 * 1024 * 1024);
    expect(report.statistics).toEqual(status.statistics);
  });

  it("reports burst omissions by severity and preserves them across restart", async () => {
    const { root, logger } = await fixture();
    for (let index = 0; index < 600; index++)
      logger.record("fixture", "burst", {}, index % 2 === 0 ? "error" : "warn");
    const status = await logger.status();
    expect(status.statistics).toMatchObject({
      errors: 256,
      warnings: 256,
      omitted: { errors: 44, warnings: 44, unknown: 0 },
    });
    const reopened = new RuntimeLogService(join(root, "logs"), "1.2.5");
    expect((await reopened.status()).statistics).toEqual(status.statistics);
  });

  it("retains valid legacy entries, counts damaged lines, and bounds oversized legacy files", async () => {
    const { root, logger } = await fixture();
    await logger.status();
    const directory = join(root, "logs");
    const timestamp = new Date().toISOString();
    const oldEntry = JSON.stringify({
      timestamp,
      level: "error",
      source: "old.interface",
      message: "[3 additional errors omitted during a burst]\nlegacy failure",
    });
    await writeFile(join(directory, "runtime.2.jsonl"), `${oldEntry}\nnot valid json\n`);
    const oversizedLine = (index: number) =>
      JSON.stringify({
        timestamp,
        level: "warn",
        source: "large.legacy",
        message: `${index}:${"x".repeat(1000)}`,
        context: {},
      });
    await writeFile(
      join(directory, "runtime.1.jsonl"),
      `${Array.from({ length: 3200 }, (_, index) => oversizedLine(index)).join("\n")}\n`,
    );
    const reopened = new RuntimeLogService(directory, "1.2.5");
    const status = await reopened.status();
    expect((await stat(join(directory, "runtime.1.jsonl"))).size).toBeLessThanOrEqual(
      3 * 1024 * 1024,
    );
    expect(status.statistics.errors).toBe(1);
    expect(status.statistics.warnings).toBeGreaterThan(0);
    expect(status.statistics.omitted.unknown).toBe(3);
    expect(status.statistics.damaged).toBe(1);
    await reopened.export(join(root, "legacy.json"));
    const report = JSON.parse(await readFile(join(root, "legacy.json"), "utf8"));
    expect(report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "old.interface", context: {} }),
        expect.objectContaining({ source: "logs.read" }),
        expect.objectContaining({
          source: "large.legacy",
          message: expect.stringContaining("3199:"),
        }),
      ]),
    );
  });

  it("bounds aggregate label cardinality while retaining all record counts", async () => {
    const { logger } = await fixture();
    for (let index = 0; index < 140; index++)
      logger.record(`source.${index}`, "fixture", { operation: `operation.${index}` });
    const { statistics } = await logger.status();
    expect(statistics.errors).toBe(140);
    expect(statistics.bySource).toHaveLength(129);
    expect(statistics.byOperation).toHaveLength(129);
    expect(statistics.bySource.find((item) => item.name === "<other>")?.errors).toBe(12);
  });

  it("keeps logging failures from replacing the original operation error and exports empty profiles", async () => {
    const { root } = await fixture();
    const blocked = join(root, "blocked");
    await writeFile(blocked, "file");
    const broken = new RuntimeLogService(blocked, "1.2.5");
    expect(() => broken.record("test", "original error")).not.toThrow();
    await broken.flush();
    await expect(broken.status()).rejects.toThrow();
    const empty = new RuntimeLogService(join(root, "empty"), "1.2.5");
    await empty.export(join(root, "empty.json"));
    expect(JSON.parse(await readFile(join(root, "empty.json"), "utf8")).entries).toEqual([]);
    expect(
      sanitizeRuntimeText(
        'x-api-key: example-secret\n{"content":"private code","error":"invalid"}',
      ),
    ).not.toContain("private code");
  });

  it("persists a fatal error synchronously before a process can exit", async () => {
    const { root, logger } = await fixture();
    logger.recordFatal(new Error("Fatal fixture error"));
    expect(await readFile(join(root, "logs", "runtime.4.jsonl"), "utf8")).toContain(
      "Fatal fixture error",
    );
    await logger.export(join(root, "fatal.json"));
    expect(JSON.parse(await readFile(join(root, "fatal.json"), "utf8")).entries[0].source).toBe(
      "main.uncaught",
    );
  });

  it("omits base64 payloads from plain CSP and image errors without losing the error category", () => {
    const font = Buffer.from("embedded font fixture").toString("base64");
    const image = Buffer.from("private image fixture").toString("base64");
    const sanitized = sanitizeRuntimeText(
      `CSP blocked font data:font/woff2;base64,${font} and data:image/png;base64,${image}`,
    );
    expect(sanitized).toContain("CSP blocked font");
    expect(sanitized).toContain("data:font/woff2;base64,[OMITTED]");
    expect(sanitized).not.toContain(font);
    expect(sanitized).not.toContain(image);
  });
});
