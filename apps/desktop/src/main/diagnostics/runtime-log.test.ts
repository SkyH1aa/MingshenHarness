import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeLogService, registerRuntimeSecret, sanitizeRuntimeText } from "./runtime-log";

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

  it("rotates at 10 MiB total, removes old logs and preserves unrelated files", async () => {
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
    for (let index = 0; index < 750; index++) {
      reopened.record("burst", `${index}: ${"x".repeat(15000)}`);
      if (index % 80 === 0) await reopened.flush();
    }
    const status = await reopened.status();
    expect(status.files).toBe(5);
    expect(status.bytes).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(await readFile(join(directory, "keep.txt"), "utf8")).toBe("unrelated");
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
