import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sdkRoot = fileURLToPath(
  new URL("../apps/desktop/resources/sdk/", import.meta.url),
);
const acpName = (await readdir(sdkRoot)).find((entry) => entry.endsWith("acp.mjs"));
assert.ok(acpName, "ACP bridge was not found.");
const acpPath = join(sdkRoot, acpName);

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const eventClients = new Set();
const heldAbortResponses = new Set();
let markEventConnected;
const eventConnected = new Promise((resolve) => {
  markEventConnected = resolve;
});
let markDuplicateRunStarted;
const duplicateRunStarted = new Promise((resolve) => {
  markDuplicateRunStarted = resolve;
});
let abortMode = "success";
let markAbortPromptStarted;
let abortPromptStarted = new Promise((resolve) => {
  markAbortPromptStarted = resolve;
});

function resetAbortPromptStarted() {
  abortPromptStarted = new Promise((resolve) => {
    markAbortPromptStarted = resolve;
  });
}

const server = createServer(async (request, response) => {
  if (request.url === "/event") {
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    response.flushHeaders();
    eventClients.add(response);
    markEventConnected();
    request.on("close", () => eventClients.delete(response));
    return;
  }

  response.setHeader("Content-Type", "application/json");
  if (request.url === "/provider") {
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
  if (request.url === "/session" && request.method === "POST") {
    await readJsonBody(request);
    response.end(
      JSON.stringify({
        id: "session",
        providerId: "provider",
        modelId: "model",
      }),
    );
    return;
  }
  if (request.url === "/session/session/message" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (body.text === "complete before response") {
      sendEvent({
        type: "run_completed",
        sessionId: "session",
        runId: "early-complete",
      });
      setTimeout(() => {
        response.end(JSON.stringify({ runId: "early-complete" }));
      }, 50);
      return;
    }
    if (body.text === "fail this run") {
      response.end(JSON.stringify({ runId: "failed-run" }));
      sendEvent({
        type: "run_failed",
        sessionId: "session",
        runId: "failed-run",
        error: "fixture run failed",
      });
      return;
    }
    if (body.text === "interrupt this run") {
      response.end(JSON.stringify({ runId: "interrupted-run" }));
      sendEvent({
        type: "run_interrupted",
        sessionId: "session",
        runId: "interrupted-run",
      });
      return;
    }
    if (body.text === "duplicate prompt") {
      response.end(JSON.stringify({ runId: "duplicate-run" }));
      markDuplicateRunStarted();
      return;
    }
    if (body.text === "cancel with HTTP 503") {
      abortMode = "http-503";
      response.end(JSON.stringify({ runId: "abort-503-run" }));
      markAbortPromptStarted();
      return;
    }
    if (body.text === "cancel with hanging abort") {
      abortMode = "never-resolve";
      response.end(JSON.stringify({ runId: "abort-hanging-run" }));
      markAbortPromptStarted();
      return;
    }
    response.statusCode = 400;
    response.end(JSON.stringify({ error: "Unexpected fixture prompt." }));
    return;
  }
  if (request.url === "/session/session/abort" && request.method === "POST") {
    if (abortMode === "http-503") {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: "fixture abort unavailable" }));
      return;
    }
    if (abortMode === "never-resolve") {
      heldAbortResponses.add(response);
      request.on("close", () => heldAbortResponses.delete(response));
      return;
    }
    response.end("{}");
    return;
  }
  response.statusCode = 404;
  response.end("{}");
});

function sendEvent(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) {
    client.write(frame);
  }
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const child = spawn(process.execPath, [acpPath], {
  env: {
    ...process.env,
    MINGSHEN_SERVER_TOKEN: "fixture-token",
    MINGSHEN_SERVER_URL: `http://127.0.0.1:${address.port}`,
    MINGSHEN_ABORT_TIMEOUT_MS: "250",
  },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let nextId = 1;
let stdoutBuffer = "";
let stderr = "";
const pending = new Map();

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  while (true) {
    const boundary = stdoutBuffer.indexOf("\n");
    if (boundary < 0) break;
    const line = stdoutBuffer.slice(0, boundary).trim();
    stdoutBuffer = stdoutBuffer.slice(boundary + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === undefined || !pending.has(message.id)) continue;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  }
});

function rpc(method, params) {
  const id = nextId++;
  const result = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return result;
}

function notifyRpc(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

async function within(promise, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

try {
  await eventConnected;
  await rpc("initialize", { protocolVersion: 1 });
  await rpc("session/new", { cwd: process.cwd() });

  const early = await rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "complete before response" }],
  });
  assert.deepEqual(early, { stopReason: "end_turn" });

  await assert.rejects(
    rpc("session/prompt", {
      sessionId: "session",
      prompt: [{ type: "text", text: "fail this run" }],
    }),
    /fixture run failed/,
  );

  const interrupted = await rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "interrupt this run" }],
  });
  assert.deepEqual(interrupted, { stopReason: "cancelled" });

  const first = rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "duplicate prompt" }],
  });
  await duplicateRunStarted;
  await assert.rejects(
    rpc("session/prompt", {
      sessionId: "session",
      prompt: [{ type: "text", text: "duplicate prompt" }],
    }),
    /already has an active prompt/,
  );
  sendEvent({
    type: "run_completed",
    sessionId: "session",
    runId: "duplicate-run",
  });
  assert.deepEqual(await first, { stopReason: "end_turn" });

  resetAbortPromptStarted();
  const abort503 = rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "cancel with HTTP 503" }],
  });
  await abortPromptStarted;
  notifyRpc("session/cancel", { sessionId: "session" });
  await assert.rejects(
    within(abort503, 3000, "HTTP 503 cancellation"),
    /remote stop is not confirmed.*HTTP 503/,
  );

  resetAbortPromptStarted();
  const hangingAbort = rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "cancel with hanging abort" }],
  });
  await abortPromptStarted;
  notifyRpc("session/cancel", { sessionId: "session" });
  await assert.rejects(
    within(hangingAbort, 3000, "hanging cancellation"),
    /remote stop is not confirmed.*timed out/i,
  );
  const afterCancellationFailures = await rpc("session/prompt", {
    sessionId: "session",
    prompt: [{ type: "text", text: "interrupt this run" }],
  });
  assert.deepEqual(afterCancellationFailures, { stopReason: "cancelled" });

  console.log(
    JSON.stringify(
      {
        ok: true,
        passed: [
          "terminal SSE event before the message POST response",
          "run_failed rejects the ACP prompt",
          "run_interrupted returns cancelled",
          "concurrent prompts cannot overwrite the active waiter",
          "HTTP 503 cancellation rejects and clears the active prompt",
          "a hanging abort request times out and clears the active prompt",
          "the session accepts a new prompt after cancellation failures",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  child.kill();
  for (const response of heldAbortResponses) response.end("{}");
  for (const client of eventClients) client.end();
  await new Promise((resolve) => server.close(resolve));
  if (stderr.trim()) process.stderr.write(stderr);
}
