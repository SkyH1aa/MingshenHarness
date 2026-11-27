import { randomUUID } from "node:crypto";

export class MingshenAuthenticationError extends Error {
  constructor(message = "Mingshen local API authentication failed. The service may have restarted; copy the current token again.") {
    super(message);
    this.name = "MingshenAuthenticationError";
    this.status = 401;
  }
}

export class MingshenCursorExpiredError extends Error {
  constructor(details = {}) {
    super("Mingshen runtime event cursor expired. Fetch a fresh session snapshot before resuming.");
    this.name = "MingshenCursorExpiredError";
    this.status = 410;
    this.snapshotRequired = true;
    Object.assign(this, details);
  }
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(true);
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class MingshenClient {
  constructor({ baseUrl = "http://127.0.0.1:4096", token }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401) throw new MingshenAuthenticationError();
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }
    return response.status === 204 ? null : response.json();
  }

  health() {
    return fetch(`${this.baseUrl}/global/health`).then((response) => response.json());
  }

  agents() {
    return this.request("/agent");
  }

  sessions() {
    return this.request("/session");
  }

  session(id) {
    return this.request(`/session/${encodeURIComponent(id)}`);
  }

  messages(id) {
    return this.request(`/session/${encodeURIComponent(id)}/message`);
  }

  children(id) {
    return this.request(`/session/${encodeURIComponent(id)}/children`);
  }

  createSession(input) {
    return this.request("/session", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  prompt(id, text) {
    return this.request(`/session/${encodeURIComponent(id)}/message`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text }] }),
    });
  }

  abort(id) {
    return this.request(`/session/${encodeURIComponent(id)}/abort`, { method: "POST" });
  }

  command(id, command, args = "") {
    return this.request(`/session/${encodeURIComponent(id)}/command`, {
      method: "POST",
      body: JSON.stringify({ command, arguments: args }),
    });
  }

  answerPermission(id, response, feedback) {
    return this.request(`/permission/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ response, feedback }),
    });
  }

  answerQuestion(id, answer) {
    return this.request(`/question/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(Array.isArray(answer) ? { answers: answer } : { answer }),
    });
  }

  share(id) {
    return this.request(`/session/${encodeURIComponent(id)}/share`, { method: "POST" });
  }

  capabilities() {
    return this.request("/v1/capabilities");
  }

  snapshot(sessionId) {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/snapshot`);
  }

  createTurn(sessionId, text, idempotencyKey = randomUUID()) {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ text }),
    });
  }

  run(runId) {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}`);
  }

  cancelRun(runId) {
    return this.request(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      body: "{}",
    });
  }

  effectivePolicy(sessionId) {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    return this.request(`/v1/policy/effective${query}`);
  }

  claims(query = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    }
    const suffix = search.size ? `?${search}` : "";
    return this.request(`/v1/tasks/claims${suffix}`);
  }

  claimTask(input) {
    return this.request("/v1/tasks/claims", {
      method: "POST",
      body: JSON.stringify({ ...input, action: "claim" }),
    });
  }

  heartbeatTask(claimId, ownerRunId) {
    return this.request("/v1/tasks/claims", {
      method: "POST",
      body: JSON.stringify({ action: "heartbeat", claimId, ownerRunId }),
    });
  }

  settleTask(input) {
    return this.request("/v1/tasks/claims", {
      method: "POST",
      body: JSON.stringify({ ...input, action: "settle" }),
    });
  }

  recoverTask(input) {
    return this.request("/v1/tasks/claims", {
      method: "POST",
      body: JSON.stringify({ ...input, action: "recover" }),
    });
  }

  receipts(query = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    }
    const suffix = search.size ? `?${search}` : "";
    return this.request(`/v1/office/receipts${suffix}`);
  }

  officeReceipt(deliveryId) {
    return this.request(`/v1/office/receipts?deliveryId=${encodeURIComponent(deliveryId)}`);
  }

  officeReceiptAction(input) {
    const action = input && typeof input.action === "string" ? input.action : "";
    if (!["prepare", "check"].includes(action)) {
      throw new Error("Office receipt actions support prepare or check; visual verification must run in the host.");
    }
    return this.request("/v1/office/receipts", {
      method: "POST",
      body: JSON.stringify({ ...input, action }),
    });
  }

  async *runtimeEvents({
    after = 0,
    sessionId,
    runId,
    signal,
    follow = true,
    retryMs = 3_000,
    onReconnect,
  } = {}) {
    let cursor = Number(after) || 0;
    let retry = retryMs;
    while (!signal?.aborted) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const search = new URLSearchParams({ after: String(cursor) });
        if (sessionId) search.set("sessionId", sessionId);
        if (runId) search.set("runId", runId);
        const response = await fetch(`${this.baseUrl}/v1/events?${search}`, {
          headers: { Authorization: `Bearer ${this.token}` },
          signal: controller.signal,
        });
        if (response.status === 401) throw new MingshenAuthenticationError();
        if (response.status === 410) {
          let details = {};
          try {
            details = await response.json();
          } catch {
            // Preserve the typed cursor error even if the response body is unavailable.
          }
          throw new MingshenCursorExpiredError(details);
        }
        if (!response.ok || !response.body) {
          throw new Error(`Runtime event stream failed: ${response.status}`);
        }
        retry = retryMs;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const lines = frame.split(/\r?\n/);
            const idLine = lines.find((line) => line.startsWith("id:"));
            const retryLine = lines.find((line) => line.startsWith("retry:"));
            const data = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (retryLine) {
              const parsed = Number(retryLine.slice(6).trim());
              if (Number.isFinite(parsed) && parsed >= 250) retry = parsed;
            }
            if (!data) continue;
            let event;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            if (event?.type === "server.connected") continue;
            const eventId = Number(idLine?.slice(3).trim() || event?.eventId || cursor);
            if (Number.isSafeInteger(eventId) && eventId > cursor) cursor = eventId;
            yield event;
          }
        }
        if (!follow) return;
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof MingshenAuthenticationError || error instanceof MingshenCursorExpiredError) {
          throw error;
        }
        if (!follow) throw error;
        onReconnect?.({ error, cursor, retryMs: retry });
      } finally {
        signal?.removeEventListener("abort", abort);
      }
      if (!follow || !(await delay(retry, signal))) return;
    }
  }

  async *events() {
    const response = await fetch(`${this.baseUrl}/event`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Event stream failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop() ?? "";
      for (const message of messages) {
        const data = message
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data) {
          yield JSON.parse(data);
        }
      }
    }
  }
}
