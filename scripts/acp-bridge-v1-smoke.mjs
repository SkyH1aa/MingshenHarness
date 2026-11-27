import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const acpPath = fileURLToPath(
  new URL(
    "../apps/desktop/resources/sdk/mingshen-acp.mjs",
    import.meta.url,
  ),
);
const token = ["fixture", "token"].join("-");
let connectionCount = 0;
let lastEventId = 0;
let activeEventResponse = null;
const eventConnectionCursors = [];
let secondConnectionResolve;
const secondConnection = new Promise((resolve) => {
  secondConnectionResolve = resolve;
});
let thirdConnectionResolve;
const thirdConnection = new Promise((resolve) => {
  thirdConnectionResolve = resolve;
});
let fourthConnectionResolve;
const fourthConnection = new Promise((resolve) => {
  fourthConnectionResolve = resolve;
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/v1/capabilities") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        apiVersion: "v1",
        permissionModes: ["request_approval"],
        exactRunCancellation: true,
      }),
    );
    return;
  }
  if (url.pathname === "/v1/events") {
    connectionCount += 1;
    lastEventId = Number(url.searchParams.get("after") || 0);
    eventConnectionCursors.push(lastEventId);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    response.write(`retry: 25\n\n`);
    if (connectionCount === 1) {
      const event = {
        eventId: 1,
        seq: 1,
        sessionId: "session",
        runId: "resume-run",
        type: "run_started",
        event: { type: "run_started", sessionId: "session", runId: "resume-run" },
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      response.write(`id: 1\nevent: runtime\ndata: ${JSON.stringify(event)}\n\n`);
      lastEventId = 1;
      setTimeout(() => response.destroy(), 10);
    } else {
      activeEventResponse = response;
      if (connectionCount === 2) secondConnectionResolve();
      if (connectionCount === 3) thirdConnectionResolve();
      if (connectionCount === 4) fourthConnectionResolve();
    }
    return;
  }
  if (url.pathname === "/provider") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify([
        {
          id: "provider",
          name: "Fixture",
          models: [{ id: "model", displayName: "Model", enabled: true }],
        },
      ]),
    );
    return;
  }
  if (url.pathname === "/session" && request.method === "POST") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "session", providerId: "provider", modelId: "model" }));
    return;
  }
  if (url.pathname === "/v1/sessions/session/turns" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body || "{}");
    const text = String(input.text || "");
    const runId = text.includes("blocked")
      ? "blocked-run"
      : text.includes("cancel")
        ? "cancel-run"
        : "resume-run";
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ runId }));
    return;
  }
  if (url.pathname === "/v1/runs/resume-run") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ runId: "resume-run", status: "running" }));
    return;
  }
  if (url.pathname === "/v1/runs/cancel-run" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ runId: "cancel-run", status: "running" }));
    return;
  }
  if (url.pathname === "/v1/runs/blocked-run" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ runId: "blocked-run", status: "running" }));
    return;
  }
  if (url.pathname === "/v1/runs/cancel-run/cancel" && request.method === "POST") {
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        accepted: true,
        stopRequested: true,
        cancellationConfirmed: false,
        run: { runId: "cancel-run", status: "running" },
      }),
    );
    setTimeout(() => {
      const interrupted = {
        eventId: 5,
        seq: 2,
        sessionId: "session",
        runId: "cancel-run",
        type: "run_interrupted",
        event: {
          type: "run_interrupted",
          sessionId: "session",
          runId: "cancel-run",
        },
        createdAt: "2026-01-01T00:00:02.000Z",
      };
      activeEventResponse?.write(
        `id: 5\nevent: runtime\ndata: ${JSON.stringify(interrupted)}\n\n`,
      );
    }, 10);
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const child = spawn(process.execPath, [acpPath], {
  env: {
    ...process.env,
    MINGSHEN_SERVER_URL: `http://127.0.0.1:${address.port}`,
    MINGSHEN_SERVER_TOKEN: token,
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let nextId = 1;
let stdoutBuffer = "";
let stderr = "";
const pending = new Map();
const notifications = [];

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  while (true) {
    const boundary = stdoutBuffer.indexOf("\n");
    if (boundary < 0) break;
    const line = stdoutBuffer.slice(0, boundary).trim();
    stdoutBuffer = stdoutBuffer.slice(boundary + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === undefined) {
      if (message.method) notifications.push(message);
      continue;
    }
    if (!pending.has(message.id)) continue;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  }
});

function rpc(method, params) {
  const id = nextId++;
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return result;
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

async function waitFor(predicate, label, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

try {
  const initialized = await rpc("initialize", { protocolVersion: 1 });
  assert.equal(initialized.agentInfo.version, "1.3.7");
  assert.deepEqual(initialized.permissionCapabilities.availableModes, ["request_approval"]);
  const session = await rpc("session/new", { cwd: process.cwd() });
  assert.deepEqual(
    session.modes.availableModes.map((entry) => entry.id),
    ["request_approval"],
  );

  const prompt = rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "resume after the event stream drops" }],
  });
  await secondConnection;
  const transient = {
    eventId: null,
    seq: 0,
    sessionId: "session",
    runId: "resume-run",
    type: "assistant_delta",
    event: {
      type: "assistant_delta",
      sessionId: "session",
      runId: "resume-run",
      text: "owned live delta",
    },
    createdAt: "2026-01-01T00:00:01.000Z",
  };
  activeEventResponse.write(`event: runtime\ndata: ${JSON.stringify(transient)}\n\n`);
  await waitFor(
    () =>
      notifications.some(
        (message) =>
          message.method === "session/update" &&
          message.params?.sessionId === "session" &&
          message.params?.update?.content?.text === "owned live delta",
      ),
    "owned transient delta",
  );
  activeEventResponse.destroy();
  await thirdConnection;
  assert.deepEqual(eventConnectionCursors.slice(0, 3), [0, 1, 1]);

  const unrelatedPersistent = {
    eventId: 2,
    seq: 1,
    sessionId: "unrelated-session",
    runId: "unrelated-run",
    type: "run_started",
    event: {
      type: "run_started",
      sessionId: "unrelated-session",
      runId: "unrelated-run",
    },
    createdAt: "2026-01-01T00:00:02.000Z",
  };
  const afterGlobalTransient = {
    eventId: null,
    seq: 0,
    sessionId: "session",
    runId: "resume-run",
    type: "assistant_delta",
    event: {
      type: "assistant_delta",
      sessionId: "session",
      runId: "resume-run",
      text: "owned delta after an ignored global event",
    },
    createdAt: "2026-01-01T00:00:02.100Z",
  };
  activeEventResponse.write(
    `id: 2\nevent: runtime\ndata: ${JSON.stringify(unrelatedPersistent)}\n\n`,
  );
  activeEventResponse.write(
    `event: runtime\ndata: ${JSON.stringify(afterGlobalTransient)}\n\n`,
  );
  await waitFor(
    () =>
      notifications.some(
        (message) =>
          message.method === "session/update" &&
          message.params?.sessionId === "session" &&
          message.params?.update?.content?.text ===
            "owned delta after an ignored global event",
      ),
    "owned transient after an ignored global event",
  );
  activeEventResponse.destroy();
  await fourthConnection;
  assert.deepEqual(eventConnectionCursors.slice(0, 4), [0, 1, 1, 2]);

  const unrelatedActivity = {
    eventId: null,
    seq: 0,
    sessionId: "unrelated-session",
    runId: "unrelated-run",
    type: "activity",
    event: {
      type: "activity",
      activity: {
        id: "unrelated-tool",
        sessionId: "unrelated-session",
        runId: "unrelated-run",
        toolName: "read_file",
        kind: "read",
        title: "Unrelated private tool",
        detail: "Unrelated private detail",
        status: "running",
        startedAt: "2026-01-01T00:00:01.500Z",
        completedAt: null,
        durationMs: null,
        fileChange: null,
      },
    },
    createdAt: "2026-01-01T00:00:01.500Z",
  };
  const mismatchedIdentity = {
    eventId: null,
    seq: 0,
    sessionId: "session",
    runId: "unrelated-run",
    type: "reasoning_delta",
    event: {
      type: "reasoning_delta",
      sessionId: "unrelated-session",
      runId: "unrelated-run",
      text: "identity-confused content must not leak",
    },
    createdAt: "2026-01-01T00:00:01.600Z",
  };
  const sessionAdded = {
    eventId: null,
    seq: 0,
    sessionId: "session",
    runId: null,
    type: "session_added",
    event: {
      type: "session_added",
      session: { id: "session", providerId: "provider", modelId: "model" },
    },
    createdAt: "2026-01-01T00:00:01.750Z",
  };
  const ownedReasoning = {
    eventId: null,
    seq: 0,
    sessionId: "session",
    runId: "resume-run",
    type: "reasoning_delta",
    event: {
      type: "reasoning_delta",
      sessionId: "session",
      runId: "resume-run",
      text: "owned live reasoning",
    },
    createdAt: "2026-01-01T00:00:01.800Z",
  };
  const ownedActivity = {
    eventId: null,
    seq: 0,
    sessionId: "session",
    runId: "resume-run",
    type: "activity",
    event: {
      type: "activity",
      activity: {
        id: "owned-tool",
        sessionId: "session",
        runId: "resume-run",
        toolName: "read_file",
        kind: "read",
        title: "Owned tool",
        detail: "Owned detail",
        status: "running",
        startedAt: "2026-01-01T00:00:01.750Z",
        completedAt: null,
        durationMs: null,
        fileChange: null,
      },
    },
    createdAt: "2026-01-01T00:00:01.750Z",
  };
  for (const event of [
    unrelatedActivity,
    mismatchedIdentity,
    sessionAdded,
    ownedReasoning,
    ownedActivity,
  ]) {
    activeEventResponse.write(`event: runtime\ndata: ${JSON.stringify(event)}\n\n`);
  }
  await waitFor(
    () =>
      notifications.some(
        (message) =>
          message.method === "session/update" &&
          message.params?.sessionId === "session" &&
          message.params?.update?.toolCallId === "owned-tool",
      ),
    "owned activity update",
  );
  await waitFor(
    () =>
      notifications.some(
        (message) =>
          message.method === "session/update" &&
          message.params?.sessionId === "session" &&
          message.params?.update?.sessionUpdate === "agent_thought_chunk" &&
          message.params?.update?.content?.text === "owned live reasoning",
      ),
    "owned reasoning delta",
  );

  const completed = {
    eventId: 3,
    seq: 2,
    sessionId: "session",
    runId: "resume-run",
    type: "run_completed",
    event: { type: "run_completed", sessionId: "session", runId: "resume-run" },
    createdAt: "2026-01-01T00:00:01.000Z",
  };
  activeEventResponse.write(
    `id: 3\nevent: runtime\ndata: ${JSON.stringify(completed)}\n\n`,
  );
  assert.deepEqual(await prompt, { stopReason: "end_turn" });
  assert.equal(lastEventId, 2);
  assert.ok(
    notifications.every((message) => message.params?.sessionId !== "unrelated-session"),
  );
  assert.ok(
    notifications.every(
      (message) => message.params?.update?.toolCallId !== "unrelated-tool",
    ),
  );

  const blocked = rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "blocked by managed policy" }],
  });
  const blockedAssertion = assert.rejects(blocked, /Managed policy denied this run/i);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const blockedPolicy = {
    eventId: 4,
    seq: 1,
    sessionId: "session",
    runId: "blocked-run",
    type: "runtime.status",
    event: {
      type: "runtime.status",
      sessionId: "session",
      runId: "blocked-run",
      status: "blocked_policy",
      reason: "Managed policy denied this run.",
    },
    createdAt: "2026-01-01T00:00:02.000Z",
  };
  activeEventResponse.write(
    `id: 4\nevent: runtime\ndata: ${JSON.stringify(blockedPolicy)}\n\n`,
  );
  await blockedAssertion;

  const cancellable = rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "cancel this exact run" }],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  notify("session/cancel", { sessionId: "session" });
  assert.deepEqual(await cancellable, { stopReason: "cancelled" });

  console.log(
    JSON.stringify(
      {
        ok: true,
        passed: [
          "ACP advertises only policy-derived permission modes",
          "ACP version is 1.3.7",
          "ACP resumes the v1 event stream using its persisted cursor",
          "transient runtime deltas are forwarded without advancing the reconnect cursor",
          "an ignored external-session event still advances the global reconnect cursor",
          "events from sessions not owned by this ACP process are never forwarded",
          "known session_added events preserve ownership without broadening it",
          "a terminal event received after reconnect settles the prompt",
          "runtime.status blocked_policy rejects the active prompt",
          "exact run cancellation resolves only after accepted and interrupted",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  child.kill();
  activeEventResponse?.end();
  await new Promise((resolve) => server.close(resolve));
  if (stderr.trim()) process.stderr.write(stderr);
}
