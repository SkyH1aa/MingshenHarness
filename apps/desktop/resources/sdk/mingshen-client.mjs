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
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
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
