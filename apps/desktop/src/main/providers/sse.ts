export interface ParsedSseEvent {
  event: string | null;
  data: string;
}

function dispatchEvent(event: string | null, dataLines: string[]): ParsedSseEvent | null {
  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ParsedSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent: string | null = null;
  let dataLines: string[] = [];
  let finished = false;

  const consumeLine = (rawLine: string): ParsedSseEvent | null => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (!line) {
      const event = dispatchEvent(currentEvent, dataLines);
      currentEvent = null;
      dataLines = [];
      return event;
    }

    if (line.startsWith(":")) {
      return null;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      currentEvent = value;
    } else if (field === "data") {
      dataLines.push(value);
    }

    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const event = consumeLine(line);
        if (event) {
          yield event;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      const event = consumeLine(buffer);
      if (event) {
        yield event;
      }
    }

    const finalEvent = dispatchEvent(currentEvent, dataLines);
    if (finalEvent) {
      yield finalEvent;
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
