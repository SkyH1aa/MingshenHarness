import { describe, expect, it } from "vitest";
import { parseServerSentEvents } from "./sse";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("parseServerSentEvents", () => {
  it("cancels the source when its consumer stops before the server closes", async () => {
    let canceled = false;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      },
      cancel() {
        canceled = true;
      },
    });
    for await (const _event of parseServerSentEvents(source)) break;
    expect(canceled).toBe(true);
  });
  it("handles chunk boundaries, CRLF and multiline data", async () => {
    const events = [];
    for await (const event of parseServerSentEvents(
      streamFromChunks(["event: message\r\nda", "ta: one\r\n\r\n", "data: two\ndata: three\n\n"]),
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { event: "message", data: "one" },
      { event: null, data: "two\nthree" },
    ]);
  });

  it("ignores comments and dispatches a final unterminated event", async () => {
    const events = [];
    for await (const event of parseServerSentEvents(
      streamFromChunks([": heartbeat\n", 'data: {"ok":true}']),
    )) {
      events.push(event);
    }

    expect(events).toEqual([{ event: null, data: '{"ok":true}' }]);
  });
});
