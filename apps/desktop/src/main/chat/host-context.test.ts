import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TOKEN_SAVER_SETTINGS } from "../../shared/token-saver";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { historySummaryCut, recentTurnBoundary } from "../token-saver/input-compressor";
import { HostContextService, hostContextKey } from "./host-context";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  const session = repository.insertSession({
    title: "Host facts",
    providerId: null,
    modelId: null,
    workspacePath: null,
    agentProfileId: "mingshen",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  const host = new HostContextService(repository);
  const add = (role: "user" | "assistant", text: string) =>
    repository.appendMessage({
      sessionId: session.id,
      role,
      parts: [{ type: "text", text }],
    });
  const merged = (through = 0) =>
    host.merge(session.id, repository.getMessages(session.id), through);
  return { repository, session, host, add, merged };
}

describe("chronological host context", () => {
  it("reuses identical facts and only appends changed plan/memory facts after the old prefix", () => {
    const f = fixture();
    f.add("user", "Start.");
    f.host.append(f.session.id, { plan: "revision=1 pending", memory: "Use TypeScript." });
    const first = f.merged();
    f.host.append(f.session.id, { plan: "revision=1 pending", memory: "Use TypeScript." });
    expect(f.merged()).toEqual(first);
    f.add("assistant", "Working.");
    f.add("user", "Continue.");
    f.host.append(f.session.id, { plan: "revision=2 complete", memory: "Use TypeScript." });
    const next = f.merged();
    expect(next.slice(0, first.length)).toEqual(first);
    expect(next.at(-1)?.parts[0]).toMatchObject({
      text: expect.stringContaining("revision=2 complete"),
    });
    expect(next.filter((item) => item.seq === 0)).toHaveLength(3);
    expect(
      new HostContextService(f.repository).merge(
        f.session.id,
        f.repository.getMessages(f.session.id),
      ),
    ).toEqual(next);
  });

  it("does not insert host data between tool calls and results", () => {
    const f = fixture();
    f.add("user", "Read.");
    const call = f.repository.appendMessage({
      sessionId: f.session.id,
      role: "assistant",
      parts: [
        {
          type: "tool_call",
          callId: "read",
          name: "read_file",
          arguments: '{"path":"a.ts"}',
          status: "completed",
        },
      ],
    });
    expect(() => f.host.append(f.session.id, { plan: "unsafe boundary" })).toThrow(
      "completed tool boundary",
    );
    expect(f.repository.getSetting(hostContextKey(f.session.id))).toBeNull();
    const result = f.repository.appendMessage({
      sessionId: f.session.id,
      role: "tool",
      parts: [{ type: "tool_result", callId: "read", output: "evidence", isError: false }],
    });
    f.host.append(f.session.id, { plan: "safe boundary" });
    const merged = f.merged();
    expect(merged.map((item) => item.id).slice(1, 3)).toEqual([call.id, result.id]);
    expect(merged.at(-1)?.seq).toBe(0);
  });

  it("restates only the latest authoritative snapshots after a compaction boundary", () => {
    const f = fixture();
    const first = f.add("user", "Original task.");
    f.host.append(f.session.id, { plan: "revision=1 pending", memory: "Prefer TypeScript." });
    const second = f.add("assistant", "Finished first step.");
    f.host.append(f.session.id, { plan: "revision=2 complete", permissions: "approval" });
    f.add("user", "New task.");
    f.host.append(f.session.id, { plan: "", permissions: "full_access" });
    const beforePrune = f.merged(second.seq);
    const facts = beforePrune.filter((item) => item.seq === 0);
    expect(facts).toHaveLength(5);
    expect(JSON.stringify(facts)).not.toContain("revision=1 pending");
    expect(JSON.stringify(facts)).toContain("revision=2 complete");
    expect(JSON.stringify(facts)).toContain("Prefer TypeScript.");
    expect(JSON.stringify(facts)).toContain("No active information");
    f.host.prune(f.session.id, second.seq);
    expect(f.merged(second.seq)).toEqual(beforePrune);
    const ledger = f.repository.getSetting(hostContextKey(f.session.id)) as { anchorId: string }[];
    expect(ledger.filter((item) => item.anchorId === first.id)).toHaveLength(1);
  });

  it("remaps fork anchors, excludes future facts in truncated forks and clears rewind state", () => {
    const f = fixture();
    const first = f.add("user", "First task.");
    f.host.append(f.session.id, { plan: "first plan" });
    const second = f.add("assistant", "First result.");
    f.host.append(f.session.id, { plan: "second plan" });
    f.add("user", "Later task.");
    f.host.append(f.session.id, { memory: "future memory" });
    const fork = f.repository.forkSession(f.session.id, second.id);
    const forkHistory = f.repository.getMessages(fork.id);
    const forkMessages = new HostContextService(f.repository).merge(fork.id, forkHistory);
    expect(JSON.stringify(forkMessages)).toContain("first plan");
    expect(JSON.stringify(forkMessages)).toContain("second plan");
    expect(JSON.stringify(forkMessages)).not.toContain("future memory");
    const ledger = f.repository.getSetting(hostContextKey(fork.id)) as {
      anchorId: string;
    }[];
    expect(ledger.every((fact) => forkHistory.some((item) => item.id === fact.anchorId))).toBe(
      true,
    );
    expect(ledger.some((fact) => fact.anchorId === first.id)).toBe(false);
    f.repository.removeSession(f.session.id);
    expect(new HostContextService(f.repository).merge(fork.id, forkHistory)).toEqual(forkMessages);
    f.repository.deleteMessagesFromSeq(fork.id, 2);
    expect(f.repository.getSetting(hostContextKey(fork.id))).toBeNull();
    f.repository.removeSession(fork.id);
    expect(f.repository.getSetting(hostContextKey(fork.id))).toBeNull();
  });

  it("does not count state snapshots as real user turns or trigger premature summaries", () => {
    const f = fixture();
    for (let index = 0; index < 5; index += 1) {
      f.add("user", `Task ${index}`);
      for (let update = 0; update < 4; update += 1)
        f.host.append(f.session.id, { plan: `Task ${index} state ${update}` });
      f.add("assistant", "Result.");
    }
    const merged = f.merged();
    expect(merged.filter((item) => item.seq === 0)).toHaveLength(20);
    expect(recentTurnBoundary(merged, 5)).toBe(0);
    expect(historySummaryCut(merged, DEFAULT_TOKEN_SAVER_SETTINGS)).toBe(0);
  });
});
