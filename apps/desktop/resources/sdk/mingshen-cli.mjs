#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { MingshenAuthenticationError, MingshenClient } from "./mingshen-client.mjs";

const terminalStatuses = new Set(["completed", "failed", "interrupted", "blocked_policy"]);
const args = process.argv.slice(2);
const flags = new Map();
const positionals = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (!arg.startsWith("--")) {
    positionals.push(arg);
    continue;
  }
  const separator = arg.indexOf("=");
  if (separator > 2) {
    flags.set(arg.slice(2, separator), arg.slice(separator + 1));
    continue;
  }
  const name = arg.slice(2);
  const next = args[index + 1];
  if (next !== undefined && !next.startsWith("--")) {
    flags.set(name, next);
    index += 1;
  } else {
    flags.set(name, true);
  }
}

const url = String(
  flags.get("url") || process.env.MINGSHEN_SERVER_URL || "http://127.0.0.1:4096",
).replace(/\/+$/, "");
const token = String(flags.get("token") || process.env.MINGSHEN_SERVER_TOKEN || "");
const outputMode = flags.has("ndjson") ? "ndjson" : flags.has("json") ? "json" : "text";
const command = positionals.shift() || "help";

function usage() {
  return `Mingshen Harness local CLI (attaches to the running desktop app)

Environment:
  MINGSHEN_SERVER_URL     default: http://127.0.0.1:4096
  MINGSHEN_SERVER_TOKEN   copied from Settings > Runtime & Integrations

Usage:
  mingshen-cli health
  mingshen-cli capabilities
  mingshen-cli sessions
  mingshen-cli session <sessionId>
  mingshen-cli snapshot <sessionId>
  mingshen-cli new --provider <id> --model <id> [--title text] [--workspace path]
  mingshen-cli prompt <sessionId> <text|-> [--key idempotency-key]
  mingshen-cli run <runId>
  mingshen-cli watch <runId> [--events]
  mingshen-cli cancel <runId>
  mingshen-cli policy [sessionId]
  mingshen-cli claims [key=value ...]
  mingshen-cli claim '<json>'
  mingshen-cli heartbeat <claimId> <ownerRunId>
  mingshen-cli settle '<json>'
  mingshen-cli recover '<json>'
  mingshen-cli receipts [key=value ...]
  mingshen-cli receipt '<json>'

Global flags:
  --url <url> --token <token> --json --ndjson
`;
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function queryFrom(values) {
  const result = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new Error(`Expected key=value, received: ${value}`);
    result[value.slice(0, separator)] = value.slice(separator + 1);
  }
  return result;
}

function jsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(required(value, label));
  } catch {
    throw new Error(`${label} must be a JSON object.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function write(value, mode = outputMode) {
  if (mode === "ndjson") {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (mode === "json" || typeof value === "string") {
    process.stdout.write(
      typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatHuman(value) {
  if (Array.isArray(value)) {
    if (!value.length) return "No records.";
    return value
      .map((entry, index) => `${index + 1}. ${JSON.stringify(entry)}`)
      .join("\n");
  }
  if (value && typeof value === "object") {
    const priority = [
      "id",
      "runId",
      "sessionId",
      "status",
      "title",
      "source",
      "createdAt",
      "updatedAt",
      "eventCursor",
    ];
    const lines = [];
    const seen = new Set();
    for (const key of priority) {
      if (!(key in value)) continue;
      seen.add(key);
      lines.push(`${key}: ${formatScalar(value[key])}`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (seen.has(key)) continue;
      lines.push(`${key}: ${formatScalar(entry)}`);
    }
    return lines.join("\n");
  }
  return String(value);
}

function formatScalar(value) {
  if (value === null || value === undefined) return "-";
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function promptText(value) {
  if (value !== "-") return required(value, "Prompt text");
  return (await readFile(0, "utf8")).trim();
}

function createClient() {
  if (!token) {
    throw new Error(
      "MINGSHEN_SERVER_TOKEN is required. Copy it from Settings > Runtime & Integrations, or pass --token.",
    );
  }
  return new MingshenClient({ baseUrl: url, token });
}

async function waitForRun(client, runId, eventsOnly) {
  if (eventsOnly) {
    const controller = new AbortController();
    for await (const envelope of client.runtimeEvents({
      runId,
      follow: true,
      signal: controller.signal,
    })) {
      write(envelope);
      if (
        envelope.type === "run_completed" ||
        envelope.type === "run_failed" ||
        envelope.type === "run_interrupted" ||
        (envelope.event?.type === "runtime.status" &&
          terminalStatuses.has(envelope.event.status))
      ) {
        controller.abort();
        return;
      }
    }
    return;
  }
  while (true) {
    const run = await client.run(runId);
    write(run);
    if (terminalStatuses.has(run.status)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function main() {
  if (command === "help" || flags.has("help")) {
    write(usage());
    return;
  }
  const client = createClient();
  if (command === "health") {
    const result = await client.health();
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "capabilities") {
    const result = await client.capabilities();
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "sessions") {
    const result = await client.sessions();
    if (outputMode === "text") {
      write(
        result
          .map(
            (session) =>
              `${session.id}\t${session.agentMode || "code"}\t${session.title}\t${session.status}`,
          )
          .join("\n") || "No sessions.",
      );
    } else {
      write(result);
    }
    return;
  }
  if (command === "session") {
    const result = await client.session(required(positionals[0], "sessionId"));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "snapshot") {
    const result = await client.snapshot(required(positionals[0], "sessionId"));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "new") {
    const result = await client.createSession({
      title: String(flags.get("title") || "CLI session"),
      providerId: required(flags.get("provider"), "--provider"),
      modelId: required(flags.get("model"), "--model"),
      workspacePath: flags.has("workspace") ? String(flags.get("workspace")) : null,
      agentMode: flags.get("mode") === "work" ? "work" : "code",
      agentProfileId: String(flags.get("profile") || "primary"),
      permissionMode:
        flags.get("permission") === "full_access" ? "full_access" : "request_approval",
      executionMode:
        flags.get("execution") === "worktree" || flags.get("execution") === "docker"
          ? flags.get("execution")
          : "host",
    });
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "prompt") {
    const sessionId = required(positionals[0], "sessionId");
    const text = await promptText(positionals[1]);
    const result = await client.createTurn(
      sessionId,
      text,
      String(flags.get("key") || randomUUID()),
    );
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "run") {
    const result = await client.run(required(positionals[0], "runId"));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "watch") {
    await waitForRun(client, required(positionals[0], "runId"), flags.has("events"));
    return;
  }
  if (command === "cancel") {
    const result = await client.cancelRun(required(positionals[0], "runId"));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "policy") {
    const result = await client.effectivePolicy(positionals[0]);
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "claims") {
    const result = await client.claims(queryFrom(positionals));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "claim") {
    const result = await client.claimTask(jsonObject(positionals[0], "claim JSON"));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "heartbeat") {
    const result = await client.heartbeatTask(
      required(positionals[0], "claimId"),
      required(positionals[1], "ownerRunId"),
    );
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "settle") {
    const result = await client.settleTask(jsonObject(positionals[0], "settle JSON"));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "recover") {
    const result = await client.recoverTask(jsonObject(positionals[0], "recover JSON"));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "receipts") {
    const result = await client.receipts(queryFrom(positionals));
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  if (command === "receipt") {
    const result = await client.officeReceiptAction(
      jsonObject(positionals[0], "receipt JSON"),
    );
    write(outputMode === "text" ? formatHuman(result) : result);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

try {
  await main();
} catch (error) {
  if (error instanceof MingshenAuthenticationError) {
    process.stderr.write(`Authentication failed: ${error.message}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
}
