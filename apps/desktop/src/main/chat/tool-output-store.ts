import { createHash } from "node:crypto";
import { z } from "zod";
import { BoundedOutput, MAX_RECOVERABLE_CHARS, safePrefix } from "../tools/bounded-output";

interface SettingsStore {
  getSetting(key: string): unknown;
  setSetting(key: string, value: unknown): void;
  removeSetting(key: string): void;
}
interface OutputEntry {
  id: string;
  chars: number;
}
const MAX_SESSION_CHARS = 16_000_000;
const MAX_ENTRIES = 40;

export const readToolOutputSchema = z
  .object({
    call_id: z.string().min(1).max(1000),
    char_offset: z
      .number()
      .int()
      .min(0)
      .max(MAX_RECOVERABLE_CHARS + 1000)
      .default(0),
    max_chars: z.number().int().min(100).max(80_000).default(20_000),
  })
  .strict();
export const READ_TOOL_OUTPUT_TOOL = {
  name: "read_tool_output",
  description:
    "Recover a retained large tool result from this conversation by call_id. Read pages using the returned char_offset. Bounded storage retains up to 40 outputs / 16 million characters per conversation; single captures retain a bounded head and tail with explicit omissions. This never reads arbitrary local paths.",
  parameters: z.toJSONSchema(readToolOutputSchema, { target: "draft-7" }),
};

export class ToolOutputStore {
  constructor(private readonly settings: SettingsStore) {}
  private prefix(sessionId: string): string {
    return `tool.output.${sessionId}.`;
  }
  private id(callId: string): string {
    return createHash("sha256").update(callId).digest("hex");
  }
  save(sessionId: string, callId: string, output: string): void {
    const prefix = this.prefix(sessionId),
      id = this.id(callId);
    const capture = new BoundedOutput();
    capture.append(output);
    const text = capture.text();
    const raw = this.settings.getSetting(`${prefix}index`);
    const index: OutputEntry[] = Array.isArray(raw)
      ? raw.filter((entry): entry is OutputEntry =>
          Boolean(
            entry &&
              typeof entry.id === "string" &&
              typeof entry.chars === "number" &&
              entry.id !== id,
          ),
        )
      : [];
    index.push({ id, chars: text.length });
    let total = index.reduce((sum, entry) => sum + entry.chars, 0);
    while (index.length > MAX_ENTRIES || total > MAX_SESSION_CHARS) {
      const removed = index.shift();
      if (!removed) break;
      total -= removed.chars;
      this.settings.removeSetting(`${prefix}${removed.id}`);
    }
    this.settings.setSetting(`${prefix}${id}`, { text, callId });
    this.settings.setSetting(`${prefix}index`, index);
  }
  read(sessionId: string, raw: unknown): string {
    const args = readToolOutputSchema.parse(raw);
    const value = this.settings.getSetting(`${this.prefix(sessionId)}${this.id(args.call_id)}`) as {
      text?: unknown;
      callId?: unknown;
    } | null;
    if (!value || value.callId !== args.call_id || typeof value.text !== "string")
      throw new Error(
        "TOOL_OUTPUT_NOT_FOUND: no retained result in this conversation; it may have expired from bounded storage.",
      );
    const text = value.text;
    if (args.char_offset > text.length)
      throw new Error("char_offset exceeds retained output length.");
    let start = args.char_offset;
    if (/[\uDC00-\uDFFF]/.test(text[start] ?? "")) start--;
    const page = safePrefix(text.slice(start), args.max_chars);
    const end = start + page.length;
    return `call_id: ${args.call_id}\nCharacters: ${start}-${end}/${text.length}\n${page}\n${end < text.length ? `Continue with read_tool_output {call_id:${JSON.stringify(args.call_id)},char_offset:${end}}` : "End of retained output."}`;
  }
}
