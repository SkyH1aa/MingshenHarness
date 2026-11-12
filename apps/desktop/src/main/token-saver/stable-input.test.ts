import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionMessage } from "../../shared/domain";
import {
  DEFAULT_TOKEN_SAVER_SETTINGS as defaults,
  TOKEN_SAVER_SETTING,
} from "../../shared/token-saver";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { TokenSaverService, tokenSaverPrompt } from "./token-saver-service";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  return { repository, service: new TokenSaverService(repository) };
}

function message(seq: number, role: SessionMessage["role"], text: string): SessionMessage {
  return {
    id: `m${seq}`,
    seq,
    role,
    sessionId: "test",
    parts: [{ type: "text", text }],
    createdAt: "2026-11-07T00:00:00Z",
  };
}

const repeated = "Independent retained evidence about the build process. ".repeat(80);
function history(): SessionMessage[] {
  return Array.from({ length: 14 }, (_, index) => [
    message(index * 2 + 1, "user", `Task ${index}`),
    message(index * 2 + 2, "assistant", repeated),
  ]).flat();
}

describe("cache-stable Token Saver inputs", () => {
  it("retains the emitted summary prefix when compaction replaces only later history", () => {
    const { service } = fixture();
    const messages = history();
    const first = service.prepareMessages("test", messages, true, true);
    const replaced = [
      ...messages.slice(0, 4),
      { ...message(0, "user", "New independent summary"), id: "new-summary" },
    ];
    const result = service.prepareMessages("test", replaced, true, true);
    expect(result.messages.slice(0, 4)).toEqual(first.messages.slice(0, 4));
    expect(result.messages.at(-1)).toEqual(replaced.at(-1));
  });

  it("keeps already-sent recent messages raw when the five-turn window moves", () => {
    const { service } = fixture();
    const messages = [
      message(1, "user", "Retain this JSON."),
      message(2, "assistant", `{\n  "payload": "${"example ".repeat(150)}"\n}`),
    ];
    let previous = service.prepareMessages("test", messages, true, true).messages;
    for (let turn = 1; turn <= 8; turn += 1) {
      messages.push(
        message(turn * 2 + 1, "user", `Next task ${turn}`),
        message(turn * 2 + 2, "assistant", repeated),
      );
      const next = service.prepareMessages("test", messages, true, true);
      expect(next.messages.slice(0, previous.length)).toEqual(previous);
      expect(next.changes).toEqual([]);
      previous = next.messages;
    }
    expect(previous[1]).toEqual(messages[1]);
  });

  it("persists transformed prefixes across restart, new questions and repeated content", () => {
    const { repository, service } = fixture();
    const messages = history();
    const first = service.prepareMessages("test", messages, true, true);
    expect(first.changes.length).toBeGreaterThan(0);
    expect(first.messages[1]).toEqual(messages[1]);
    expect(first.messages[3]?.parts[0]).toMatchObject({
      text: expect.stringContaining("message m2"),
    });
    messages.push(
      message(29, "user", "Now discuss an unrelated topic"),
      message(30, "assistant", repeated),
    );
    const restarted = new TokenSaverService(repository);
    const second = restarted.prepareMessages("test", messages, true, true);
    expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(second.messages.slice(-10)).toEqual(messages.slice(-10));
    for (const change of second.changes) {
      const part = second.messages.find((item) => item.id === change.messageId)?.parts[
        change.partIndex
      ];
      if (change.strategy === "duplicate") {
        expect(part).toMatchObject({ text: expect.stringContaining("message m2") });
        expect(part).not.toMatchObject({ text: expect.stringContaining("message m30") });
      }
    }
  });

  it("does not persist estimate-only history or invalidate the actual emitted prefix", () => {
    const { repository, service } = fixture();
    const messages = history();
    const first = service.prepareMessages("test", messages, true, true);
    const stored = repository.getSetting("tokenSaver.input.test");
    service.prepareMessages("test", messages.slice(10), true);
    expect(repository.getSetting("tokenSaver.input.test")).toEqual(stored);
    messages.push(message(29, "user", "Continue."));
    expect(service.prepareMessages("test", messages, true, true).messages.slice(0, 28)).toEqual(
      first.messages,
    );
  });

  it("rebuilds after deliberate compaction, edited history or setting changes", () => {
    const { repository, service } = fixture();
    const messages = history();
    service.prepareMessages("test", messages, true, true);
    const compacted = [
      { ...message(0, "user", "Authoritative saved summary."), id: "summary-epoch-2" },
      ...messages.slice(-10),
    ];
    expect(service.prepareMessages("test", compacted, true, true).messages).toEqual(compacted);
    const ledger = repository.getSetting("tokenSaver.input.test") as { entries: { id: string }[] };
    expect(ledger.entries[0]?.id).toBe("summary-epoch-2");
    messages[1] = message(2, "assistant", "Edited original evidence.");
    const edited = service.prepareMessages("test", messages, true, true);
    expect(edited.messages[1]).toEqual(messages[1]);
    repository.setSetting(TOKEN_SAVER_SETTING, { ...defaults, enabled: false });
    expect(service.prepareMessages("test", messages, true, true).messages).toEqual(messages);
  });

  it("ignores UI-only updates but invalidates changed tool arguments", () => {
    const { repository, service } = fixture();
    const messages = history();
    messages[0] = {
      ...message(1, "assistant", ""),
      parts: [
        {
          type: "tool_call",
          callId: "read",
          name: "read_file",
          arguments: '{"path":"a.ts"}',
          status: "pending",
        },
      ],
    };
    const first = service.prepareMessages("test", messages, true, true);
    const save = vi.spyOn(repository, "setSetting");
    const part = messages[0]?.parts[0];
    if (part?.type !== "tool_call") throw new Error("Missing test tool call.");
    part.status = "completed";
    messages[0]?.parts.push({ type: "reasoning", text: "UI reasoning summary changed." });
    const next = service.prepareMessages("test", messages, true, true);
    expect(next.messages.slice(1)).toEqual(first.messages.slice(1));
    expect(save).not.toHaveBeenCalled();
    part.arguments = '{"path":"b.ts"}';
    service.prepareMessages("test", messages, true, true);
    expect(save).toHaveBeenCalledWith("tokenSaver.input.test", expect.any(Object));
  });

  it("invalidates replayable Responses state without persisting opaque payloads in the ledger", () => {
    const { repository, service } = fixture();
    const messages = history();
    messages[0]?.parts.push({
      type: "responses_state",
      providerId: "provider",
      modelId: "model",
      endpointKey: "fixture-endpoint",
      items: [
        { type: "reasoning", encrypted_content: "first-opaque-fixture" },
        { type: "message", role: "assistant", phase: "commentary", content: [] },
      ],
    });
    service.prepareMessages("test", messages, true, true);
    const original = repository.getSetting("tokenSaver.input.test");
    expect(JSON.stringify(original)).not.toContain("first-opaque-fixture");
    const part = messages[0]?.parts.find((item) => item.type === "responses_state");
    if (part?.type !== "responses_state") throw new Error("Missing Responses fixture.");
    const save = vi.spyOn(repository, "setSetting");
    service.prepareMessages("test", messages, true, true);
    expect(save).not.toHaveBeenCalled();
    part.items[0] = { type: "reasoning", encrypted_content: "different-opaque-fixture" };
    service.prepareMessages("test", messages, true, true);
    expect(save).toHaveBeenCalledWith("tokenSaver.input.test", expect.any(Object));
    expect(repository.getSetting("tokenSaver.input.test")).not.toEqual(original);
    expect(JSON.stringify(repository.getSetting("tokenSaver.input.test"))).not.toContain(
      "different-opaque-fixture",
    );
    const changedPayload = repository.getSetting("tokenSaver.input.test");
    part.endpointKey = "different-endpoint";
    service.prepareMessages("test", messages, true, true);
    expect(repository.getSetting("tokenSaver.input.test")).not.toEqual(changedPayload);
  });

  it("rejects saved text replacements for replay-sensitive messages", () => {
    const { repository, service } = fixture();
    const messages = history();
    messages[1]?.parts.push({
      type: "responses_state",
      providerId: "provider",
      modelId: "model",
      endpointKey: "fixture-endpoint",
      items: [{ type: "reasoning", encrypted_content: "opaque-fixture" }],
    });
    service.prepareMessages("test", messages, true, true);
    const saved = repository.getSetting("tokenSaver.input.test") as {
      entries: Array<{ replacements: unknown[] }>;
    };
    saved.entries[1]?.replacements.push({
      partIndex: 0,
      text: "Prior shortened text",
      change: {
        messageId: "m2",
        partIndex: 0,
        importance: "medium",
        strategy: "relevance",
        beforeTokens: 1000,
        afterTokens: 10,
      },
    });
    repository.setSetting("tokenSaver.input.test", saved);
    const restored = service.prepareMessages("test", messages, true, true);
    expect(restored.messages[1]).toEqual(messages[1]);
    expect(restored.changes.some((change) => change.messageId === "m2")).toBe(false);
  });

  it("keeps provider-native turns exact and invalidates their hashes without copying native state into the ledger", () => {
    const { repository, service } = fixture();
    const messages = history();
    const native = messages[1];
    if (!native) throw new Error("Missing assistant fixture");
    native.parts.push({
      type: "provider_state",
      state: {
        family: "deepseek",
        protocol: "openai_chat_completions",
        providerId: "provider",
        modelId: "model",
        endpointKey: "fixture-endpoint",
        payload: {
          role: "assistant",
          content: repeated,
          reasoning_content: "native-fixture-content",
        },
      },
    });
    const first = service.prepareMessages("test", messages, true, true);
    expect(first.messages[1]).toEqual(native);
    expect(first.changes.some((change) => change.messageId === native.id)).toBe(false);
    const original = repository.getSetting("tokenSaver.input.test");
    expect(JSON.stringify(original)).not.toContain("native-fixture-content");
    const state = native.parts.find((part) => part.type === "provider_state");
    if (state?.type !== "provider_state") throw new Error("Missing native state");
    state.state.payload.reasoning_content = "changed-native-fixture";
    const next = service.prepareMessages("test", messages, true, true);
    expect(next.messages[1]).toEqual(native);
    expect(repository.getSetting("tokenSaver.input.test")).not.toEqual(original);
    expect(JSON.stringify(repository.getSetting("tokenSaver.input.test"))).not.toContain(
      "changed-native-fixture",
    );
  });

  it("invalidates changed tool image pixels while retaining image parts verbatim", () => {
    const { repository, service } = fixture();
    const messages = history();
    messages[0] = {
      ...message(1, "tool", ""),
      parts: [
        {
          type: "tool_result",
          callId: "image",
          output: "Visual evidence",
          isError: false,
          images: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,FIRST" }],
        },
      ],
    };
    const first = service.prepareMessages("test", messages, true, true);
    expect(first.messages[0]).toEqual(messages[0]);
    const original = repository.getSetting("tokenSaver.input.test");
    expect(JSON.stringify(original)).not.toContain("base64");
    const part = messages[0].parts[0];
    if (part?.type !== "tool_result" || !part.images?.[0])
      throw new Error("Missing image fixture.");
    part.images[0].dataUrl = "data:image/png;base64,SECOND";
    const next = service.prepareMessages("test", messages, true, true);
    expect(next.messages[0]).toEqual(messages[0]);
    expect(repository.getSetting("tokenSaver.input.test")).not.toEqual(original);
    expect(JSON.stringify(repository.getSetting("tokenSaver.input.test"))).not.toContain("SECOND");
  });

  it("never references an earlier excerpt whose full text is no longer in the request", () => {
    const { repository, service } = fixture();
    repository.setSetting(TOKEN_SAVER_SETTING, {
      ...defaults,
      deduplicate: false,
      filterHistory: true,
    });
    const messages = history();
    messages[1] = message(2, "assistant", "Unrelated historical prose. ".repeat(120));
    const first = service.prepareMessages("test", messages, true, true);
    expect(first.messages[1]?.parts[0]).toMatchObject({
      text: expect.stringContaining("recall_context"),
    });
    repository.setSetting(TOKEN_SAVER_SETTING, {
      ...defaults,
      deduplicate: true,
      filterHistory: true,
    });
    // Reconfigure is an intentional new prefix; the first original must now be retained.
    messages[3] = { ...messages[1], id: "m4", seq: 4 };
    const reset = service.prepareMessages("test", messages, true, true);
    expect(reset.messages[1]).toEqual(messages[1]);
    expect(reset.messages[3]?.parts[0]).toMatchObject({
      text: expect.stringContaining("message m2"),
    });
    const noRecall = service.prepareMessages("test", messages, false, true);
    expect(noRecall.messages.some((item) => JSON.stringify(item).includes("recall_context"))).toBe(
      false,
    );
  });

  it("keeps automatic response policy byte-identical across different tasks", () => {
    const settings = { ...defaults, outputMode: "auto" as const };
    expect(tokenSaverPrompt(settings, "Hello")).toBe(
      tokenSaverPrompt(settings, "Please provide a detailed complete implementation."),
    );
    expect(tokenSaverPrompt(settings, "Hello")).toContain("response=auto");
    expect(tokenSaverPrompt(settings, "Hello")).toContain("overrides the response mode");
  });
});
