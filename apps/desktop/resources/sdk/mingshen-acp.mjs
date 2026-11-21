#!/usr/bin/env node

import { createInterface } from "node:readline";

const serverUrl = (process.env.MINGSHEN_SERVER_URL || "http://127.0.0.1:4096").replace(
  /\/+$/,
  "",
);
const token = process.env.MINGSHEN_SERVER_TOKEN || "";
const version = process.env.MINGSHEN_VERSION || "1.3.4";
const defaultAbortTimeoutMs = 10_000;
const configuredAbortTimeoutMs = Number(process.env.MINGSHEN_ABORT_TIMEOUT_MS);
const abortTimeoutMs =
  Number.isFinite(configuredAbortTimeoutMs) && configuredAbortTimeoutMs >= 50
    ? Math.min(Math.floor(configuredAbortTimeoutMs), 60_000)
    : defaultAbortTimeoutMs;
const sessions = new Map();
const pendingPrompts = new Map();
let providerCache = null;

function matchesPending(pending, event) {
  return Boolean(
    pending &&
      (!pending.runId || !event.runId || pending.runId === event.runId),
  );
}

function settlePending(sessionId, event, settle) {
  const pending = pendingPrompts.get(sessionId);
  if (!matchesPending(pending, event)) {
    return;
  }
  pendingPrompts.delete(sessionId);
  settle(pending);
}

function handleTerminalEvent(event) {
  const pending = pendingPrompts.get(event.sessionId);
  if (pending && !pending.runId) {
    pending.earlyEvents.push(event);
    return;
  }
  if (event.type === "run_completed") {
    settlePending(event.sessionId, event, (prompt) =>
      prompt.resolve({ stopReason: "end_turn" }),
    );
  } else if (event.type === "run_failed") {
    settlePending(event.sessionId, event, (prompt) =>
      prompt.reject(new Error(eventErrorMessage(event.error))),
    );
  } else if (event.type === "run_interrupted") {
    settlePending(event.sessionId, event, (prompt) =>
      prompt.resolve({ stopReason: "cancelled" }),
    );
  } else if (event.type === "status" && event.status === "error") {
    settlePending(event.sessionId, event, (prompt) =>
      prompt.reject(new Error(eventErrorMessage(event.message))),
    );
  }
}

function eventErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error !== undefined) {
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through to the stable error label.
    }
  }
  return "Mingshen run failed.";
}

if (!token) {
  process.stderr.write(
    "MINGSHEN_SERVER_TOKEN is required. Copy it from Settings > Runtime & Integrations.\n",
  );
  process.exit(1);
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

async function api(path, init = {}) {
  const response = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 3000)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function abortSession(sessionId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), abortTimeoutMs);
  timeout.unref?.();
  try {
    await api(`/session/${encodeURIComponent(sessionId)}/abort`, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Mingshen cancellation request timed out after ${abortTimeoutMs} ms; remote stop is not confirmed.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function firstModel() {
  if (providerCache) {
    return providerCache;
  }
  const providers = await api("/provider");
  for (const provider of providers) {
    const model = (provider.models || []).find((entry) => entry.enabled);
    if (model) {
      providerCache = {
        providerId: provider.id,
        modelId: model.id,
        providerName: provider.name,
        modelName: model.displayName,
      };
      return providerCache;
    }
  }
  throw new Error("Mingshen Harness has no enabled model.");
}

function emitAgentText(sessionId, text, thought = false) {
  if (!text) {
    return;
  }
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: thought ? "agent_thought_chunk" : "agent_message_chunk",
      content: { type: "text", text },
    },
  });
}

function emitToolUpdate(sessionId, activity) {
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: activity.id,
      title: activity.title,
      status:
        activity.status === "running"
          ? "in_progress"
          : activity.status === "completed"
            ? "completed"
            : "failed",
      content: activity.detail
        ? [{ type: "content", content: { type: "text", text: activity.detail } }]
        : [],
    },
  });
}

function connectEvents() {
  const controller = new AbortController();
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(`${serverUrl}/event`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Event stream failed: HTTP ${response.status}`);
        }
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          while (true) {
            const boundary = buffer.indexOf("\n\n");
            if (boundary < 0) {
              break;
            }
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (!data) {
              continue;
            }
            let event;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            if (event.type === "assistant_delta") {
              emitAgentText(event.sessionId, event.text);
            } else if (event.type === "reasoning_delta") {
              emitAgentText(event.sessionId, event.text, true);
            } else if (event.type === "model_attempt_reset") {
              // ACP chunks cannot be retracted; clearly separate the discarded attempt.
              emitAgentText(event.sessionId, "\n[Connection interrupted. The incomplete response above was discarded; retrying the current request.]\n");
            } else if (event.type === "activity") {
              emitToolUpdate(event.sessionId, event.activity);
            } else if (
              ["run_completed", "run_failed", "run_interrupted"].includes(event.type) ||
              (event.type === "status" && event.status === "error")
            ) {
              handleTerminalEvent(event);
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          process.stderr.write(`Mingshen ACP event stream: ${String(error)}\n`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    }
  })();
  return () => controller.abort();
}

async function initialize(params) {
  const session = params && typeof params === "object" ? params : {};
  return {
    protocolVersion:
      typeof session.protocolVersion === "number" ? session.protocolVersion : 1,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: {
        image: true,
        audio: false,
        embeddedContext: true,
      },
      mcpCapabilities: {
        http: true,
        sse: false,
      },
    },
    authMethods: [],
    agentInfo: {
      name: "Mingshen Harness",
      version,
    },
  };
}

async function newSession(params) {
  const model = await firstModel();
  const cwd =
    params && typeof params.cwd === "string" ? params.cwd : process.cwd();
  const session = await api("/session", {
    method: "POST",
    body: JSON.stringify({
      title: "ACP 会话",
      providerId: model.providerId,
      modelId: model.modelId,
      agentProfileId: "primary",
      workspacePath: cwd,
      permissionMode: "request_approval",
      executionMode: "host",
    }),
  });
  sessions.set(session.id, session);
  return {
    sessionId: session.id,
    models: {
      currentModelId: `${model.providerName}/${model.modelName}`,
      availableModels: [
        {
          modelId: `${model.providerName}/${model.modelName}`,
          name: model.modelName,
          description: model.providerName,
        },
      ],
    },
    modes: {
      currentModeId: "request_approval",
      availableModes: [
        { id: "request_approval", name: "请求批准" },
        { id: "full_access", name: "完全访问" },
      ],
    },
  };
}

function promptText(prompt) {
  if (!Array.isArray(prompt)) {
    return "";
  }
  return prompt
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      if (block.type === "text") {
        return String(block.text || "");
      }
      if (block.type === "resource_link" && block.uri) {
        return `Referenced resource: ${block.uri}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function prompt(params) {
  const sessionId = String(params?.sessionId || "");
  if (!sessions.has(sessionId)) {
    throw new Error("Unknown ACP session.");
  }
  const text = promptText(params?.prompt);
  if (!text.trim()) {
    throw new Error("ACP prompt contains no supported text content.");
  }
  if (pendingPrompts.has(sessionId)) {
    throw new Error("This ACP session already has an active prompt.");
  }
  let resolvePrompt;
  let rejectPrompt;
  const pending = {
    runId: null,
    earlyEvents: [],
    promise: new Promise((resolve, reject) => {
      resolvePrompt = resolve;
      rejectPrompt = reject;
    }),
    resolve: (value) => resolvePrompt(value),
    reject: (error) => rejectPrompt(error),
  };
  pending.promise.catch(() => undefined);
  pendingPrompts.set(sessionId, pending);
  try {
    const started = await api(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    if (typeof started?.runId !== "string" || !started.runId) {
      throw new Error("Mingshen did not return a runId for the ACP prompt.");
    }
    pending.runId = started.runId;
    for (const event of pending.earlyEvents.splice(0)) {
      handleTerminalEvent(event);
    }
    return await pending.promise;
  } catch (error) {
    if (pendingPrompts.get(sessionId) === pending) {
      pendingPrompts.delete(sessionId);
    }
    throw error;
  }
}

async function cancel(params) {
  const sessionId = String(params?.sessionId || "");
  if (!sessionId) {
    return null;
  }
  const pending = pendingPrompts.get(sessionId);
  try {
    await abortSession(sessionId);
  } catch (error) {
    const message = `Mingshen cancellation failed; remote stop is not confirmed: ${eventErrorMessage(error)}`;
    if (pending && pendingPrompts.get(sessionId) === pending) {
      pendingPrompts.delete(sessionId);
      pending.reject(new Error(message));
    }
    throw new Error(message);
  }
  if (pending && pendingPrompts.get(sessionId) === pending) {
    pendingPrompts.delete(sessionId);
    pending.resolve({ stopReason: "cancelled" });
  }
  return null;
}

async function setMode(params) {
  const sessionId = String(params?.sessionId || "");
  const modeId = String(params?.modeId || "");
  if (!sessions.has(sessionId) || !["request_approval", "full_access"].includes(modeId)) {
    throw new Error("Invalid ACP session or mode.");
  }
  await api(`/session/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify({ permissionMode: modeId }),
  });
  return null;
}

const handlers = {
  initialize,
  authenticate: async () => null,
  "session/new": newSession,
  "session/prompt": prompt,
  "session/cancel": cancel,
  "session/set_mode": setMode,
};

const disconnectEvents = connectEvents();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  void (async () => {
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`Invalid ACP JSON: ${trimmed}\n`);
      return;
    }
    if (!message.method) {
      return;
    }
    const handler = handlers[message.method];
    if (message.id === undefined) {
      if (message.method === "session/cancel") {
        try {
          await cancel(message.params || {});
        } catch (error) {
          process.stderr.write(`ACP cancel failed: ${String(error)}\n`);
        }
      }
      return;
    }
    if (!handler) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` },
      });
      return;
    }
    try {
      const result = await handler(message.params || {});
      send({ jsonrpc: "2.0", id: message.id, result });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  })();
});

process.on("SIGINT", () => {
  disconnectEvents();
  process.exit(0);
});
