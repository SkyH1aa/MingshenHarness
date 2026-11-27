import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import {
  MingshenAuthenticationError,
  MingshenClient,
  MingshenCursorExpiredError,
} from "../apps/desktop/resources/sdk/mingshen-client.mjs";

const sdkDirectory = fileURLToPath(
  new URL("../apps/desktop/resources/sdk/", import.meta.url),
);
let eventConnections = 0;
const eventConnectionWaiters = [];
let markEventConnected;
const firstEventConnected = new Promise((resolve) => {
  markEventConnected = resolve;
});

function sse(response, id, event) {
  response.write(`id: ${id}\nevent: runtime\ndata: ${JSON.stringify(event)}\n\n`);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/v1/capabilities") {
    if (request.headers.authorization !== "Bearer fixture-token") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        apiVersion: "v1",
        runtimeEvents: true,
        eventReplay: true,
        idempotentTurns: true,
        permissionModes: ["request_approval"],
      }),
    );
    return;
  }
  if (url.pathname === "/v1/events") {
    if (request.headers.authorization !== "Bearer fixture-token") {
      response.writeHead(401);
      response.end();
      return;
    }
    const after = Number(url.searchParams.get("after") || 0);
    if (after === 999) {
      response.writeHead(410, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          code: "CURSOR_EXPIRED",
          snapshotRequired: true,
          requestedCursor: 999,
          earliestCursor: 3,
        }),
      );
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    response.write(`retry: 25\n\n`);
    response.write(`data: ${JSON.stringify({ type: "server.connected", cursor: after })}\n\n`);
    eventConnections += 1;
    markEventConnected();
    for (const waiter of eventConnectionWaiters.splice(0)) waiter();
    if (after === 0) {
      sse(response, 1, {
        eventId: 1,
        seq: 1,
        sessionId: "session",
        runId: "run",
        type: "run_started",
        event: { type: "run_started", sessionId: "session", runId: "run" },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      setTimeout(() => response.destroy(), 10);
    } else if (after === 1) {
      sse(response, 2, {
        eventId: 2,
        seq: 2,
        sessionId: "session",
        runId: "run",
        type: "run_completed",
        event: { type: "run_completed", sessionId: "session", runId: "run" },
        createdAt: "2026-01-01T00:00:01.000Z",
      });
    }
    return;
  }
  if (url.pathname === "/v1/sessions/session/turns" && request.method === "POST") {
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ runId: "run" }));
    return;
  }
  if (url.pathname === "/v1/sessions/session/snapshot" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        session: { id: "session", title: "Fixture" },
        messages: [
          {
            id: "message",
            sessionId: "session",
            seq: 1,
            role: "assistant",
            createdAt: "2026-01-01T00:00:01.000Z",
            parts: [
              { type: "text", text: "Persisted final answer" },
              {
                type: "responses_state",
                providerId: "provider",
                modelId: "model",
                endpointKey: "responses",
                items: [
                  {
                    type: "reasoning",
                    id: "reasoning",
                    encrypted_content: "opaque-reference",
                  },
                ],
              },
              {
                type: "tool_result",
                callId: "call",
                output: "[recoverable output]",
                isError: false,
                outcome: {
                  status: "success",
                  effect: "confirmed",
                  retryable: false,
                  codes: [],
                  validation: { status: "validated", source: "builtin" },
                  evidence: [
                    {
                      kind: "recovery",
                      summary: "Referenced retained output",
                    },
                  ],
                },
              },
            ],
          },
        ],
        eventCursor: 2,
      }),
    );
    return;
  }
  if (
    url.pathname === "/v1/tasks/claims" &&
    (request.method === "GET" || request.method === "POST")
  ) {
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify([{ claimId: "claim", sessionId: url.searchParams.get("sessionId") }]),
      );
      return;
    }
    let payload = "";
    for await (const chunk of request) payload += chunk;
    const input = JSON.parse(payload || "{}");
    response.writeHead(input.action === "claim" ? 201 : 200, {
      "Content-Type": "application/json",
    });
    response.end(JSON.stringify(input));
    return;
  }
  if (
    url.pathname === "/v1/office/receipts" &&
    (request.method === "GET" || request.method === "POST")
  ) {
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify([
          {
            id: url.searchParams.get("deliveryId") || "delivery",
            sessionId: url.searchParams.get("sessionId"),
          },
        ]),
      );
      return;
    }
    let payload = "";
    for await (const chunk of request) payload += chunk;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(payload || "{}");
    return;
  }
  if (url.pathname === "/session") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify([]));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

function waitForSecondConnection() {
  if (eventConnections >= 2) return Promise.resolve();
  return new Promise((resolve) => eventConnectionWaiters.push(resolve));
}

function runCli(arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [`${sdkDirectory}mingshen-cli.mjs`, ...arguments_],
      {
        env: { ...process.env, ...environment },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object");
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const client = new MingshenClient({ baseUrl, token: ["fixture", "token"].join("-") });
  assert.deepEqual(await client.capabilities(), {
    apiVersion: "v1",
    runtimeEvents: true,
    eventReplay: true,
    idempotentTurns: true,
    permissionModes: ["request_approval"],
  });
  const turn = await client.createTurn("session", "fixture", "idempotency-fixture");
  assert.equal(turn.runId, "run");

  const controller = new AbortController();
  const observed = [];
  for await (const envelope of client.runtimeEvents({
    follow: true,
    retryMs: 25,
    signal: controller.signal,
  })) {
    observed.push(envelope.eventId);
    if (envelope.eventId === 1) await firstEventConnected;
    if (envelope.eventId === 2) {
      controller.abort();
      break;
    }
  }
  assert.deepEqual(observed, [1, 2]);
  await waitForSecondConnection();

  await assert.rejects(
    new MingshenClient({ baseUrl, token: "wrong" }).capabilities(),
    MingshenAuthenticationError,
  );
  await assert.rejects(
    async () => {
      for await (const _event of client.runtimeEvents({
        after: 999,
        follow: false,
      })) {
        // Cursor validation happens before any event is yielded.
      }
    },
    (error) =>
      error instanceof MingshenCursorExpiredError &&
      error.snapshotRequired === true &&
      error.earliestCursor === 3,
  );
  const recoveredSnapshot = await client.snapshot("session");
  assert.equal(recoveredSnapshot.messages[0].parts[0].text, "Persisted final answer");
  assert.equal(
    recoveredSnapshot.messages[0].parts[1].items[0].encrypted_content,
    "opaque-reference",
  );
  assert.equal(recoveredSnapshot.messages[0].parts[2].outcome.evidence[0].kind, "recovery");

  assert.deepEqual(await client.claims({ sessionId: "session" }), [
    { claimId: "claim", sessionId: "session" },
  ]);
  assert.deepEqual(
    await client.claimTask({
      sessionId: "session",
      runId: "run",
      stepId: "step",
      revision: 1,
    }),
    {
      action: "claim",
      sessionId: "session",
      runId: "run",
      stepId: "step",
      revision: 1,
    },
  );
  assert.deepEqual(await client.heartbeatTask("claim", "run"), {
    action: "heartbeat",
    claimId: "claim",
    ownerRunId: "run",
  });
  assert.deepEqual(
    await client.settleTask({
      claimId: "claim",
      ownerRunId: "run",
      status: "completed",
    }),
    {
      action: "settle",
      claimId: "claim",
      ownerRunId: "run",
      status: "completed",
    },
  );
  assert.deepEqual(await client.receipts({ sessionId: "session" }), [
    { id: "delivery", sessionId: "session" },
  ]);
  assert.deepEqual(await client.officeReceipt("delivery"), [
    { id: "delivery", sessionId: null },
  ]);
  assert.deepEqual(
    await client.officeReceiptAction({
      action: "check",
      deliveryId: "delivery",
    }),
    {
      action: "check",
      deliveryId: "delivery",
    },
  );
  for (const action of ["visual-batch", "record-visual"]) {
    assert.throws(
      () => client.officeReceiptAction({ action, deliveryId: "delivery" }),
      /visual verification must run in the host/,
    );
  }

  const cli = await runCli(["capabilities", "--url", baseUrl, "--token", "fixture-token", "--json"], {});
  assert.equal(cli.code, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).apiVersion, "v1");
  const claimsCli = await runCli(
    ["claims", "sessionId=session", "--url", baseUrl, "--token", "fixture-token", "--json"],
    {},
  );
  assert.equal(claimsCli.code, 0, claimsCli.stderr);
  assert.equal(JSON.parse(claimsCli.stdout)[0].claimId, "claim");
  const receiptCli = await runCli(
    [
      "receipt",
      JSON.stringify({ action: "check", deliveryId: "delivery" }),
      "--url",
      baseUrl,
      "--token",
      "fixture-token",
      "--json",
    ],
    {},
  );
  assert.equal(receiptCli.code, 0, receiptCli.stderr);
  assert.equal(JSON.parse(receiptCli.stdout).action, "check");

  console.log(
    JSON.stringify(
      {
        ok: true,
        eventConnections,
        passed: [
          "authenticated v1 capability request",
          "idempotent turn client call",
          "SDK resumed after a dropped SSE connection using its cursor",
          "HTTP 401 maps to a typed authentication error",
          "HTTP 410 maps to a typed snapshot-required cursor error",
          "a fresh snapshot restores the final message and provider/recovery references",
          "SDK dispatches claim list/create/heartbeat/settle and receipt list/inspect/action calls",
          "CLI dispatches claim and receipt GET/POST commands",
          "standalone CLI attached to the already running local server",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
