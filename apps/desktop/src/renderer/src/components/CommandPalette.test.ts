import { describe, expect, it } from "vitest";
import type { SessionView } from "../../../shared/domain";
import {
  commandPaletteCommandAvailable,
  currentPaletteSession,
  paletteSearchScopeMatches,
} from "../lib/command-palette-policy";
import { beginLatestRequest, invalidateLatestRequests } from "../lib/latest-request";

const session = (overrides: Partial<SessionView> = {}): SessionView =>
  ({
    id: "session",
    title: "Fixture",
    parentSessionId: null,
    agentMode: "code",
    agentProfileId: "primary",
    providerId: null,
    modelId: null,
    workspacePath: "C:\\Project",
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
    status: "idle",
    archived: false,
    pinned: false,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    lastOpenedAt: "2026-11-20T00:00:00.000Z",
    ...overrides,
  }) as SessionView;

describe("command palette capability filtering", () => {
  it("keeps ChatAgent to safe application commands", () => {
    const chat = session({ agentMode: "chat", workspacePath: null });
    expect(commandPaletteCommandAvailable("settings", chat)).toBe(true);
    expect(commandPaletteCommandAvailable("new-session", chat)).toBe(true);
    for (const command of [
      "terminal",
      "files",
      "review",
      "workstation",
      "image-studio",
      "rename",
      "compact",
      "archive",
      "fork",
      "status",
      "skills",
      "plugins",
      "plan",
      "mcp",
      "remember",
      "forget",
      "memory",
      "custom:review",
    ])
      expect(commandPaletteCommandAvailable(command, chat)).toBe(false);
  });

  it("hides data belonging to a previous session or search query", () => {
    const old = session({ id: "old" });
    expect(currentPaletteSession(old, "new")).toBeNull();
    expect(currentPaletteSession(old, null)).toBeNull();
    expect(currentPaletteSession(old, "old")).toBe(old);
    const scope = { sessionId: "old", query: "file" };
    expect(paletteSearchScopeMatches(scope, "new", "file")).toBe(false);
    expect(paletteSearchScopeMatches(scope, "old", "other")).toBe(false);
    expect(paletteSearchScopeMatches(scope, "old", " file ")).toBe(true);
  });

  it("ignores a response after its request is invalidated or superseded", async () => {
    const cursor = { current: 0 };
    let resolve!: (value: string) => void;
    const response = new Promise<string>((resolvePromise) => {
      resolve = resolvePromise;
    });
    let displayed = "";
    const request = beginLatestRequest(cursor);
    const pending = response.then((value) => {
      if (request.isCurrent()) displayed = value;
    });
    invalidateLatestRequests(cursor);
    resolve("stale");
    await pending;
    expect(displayed).toBe("");

    const superseded = beginLatestRequest(cursor);
    const current = beginLatestRequest(cursor);
    expect(superseded.isCurrent()).toBe(false);
    expect(current.isCurrent()).toBe(true);
    invalidateLatestRequests(cursor);
    expect(current.isCurrent()).toBe(false);
  });

  it("limits subagents and workspace-less sessions to safe session operations", () => {
    const child = session({ parentSessionId: "parent" });
    expect(commandPaletteCommandAvailable("rename", child)).toBe(true);
    expect(commandPaletteCommandAvailable("status", child)).toBe(true);
    expect(commandPaletteCommandAvailable("new-session", child)).toBe(false);
    expect(commandPaletteCommandAvailable("terminal", child)).toBe(false);
    expect(commandPaletteCommandAvailable("fork", child)).toBe(false);

    const noWorkspace = session({ workspacePath: null });
    expect(commandPaletteCommandAvailable("compact", noWorkspace)).toBe(true);
    expect(commandPaletteCommandAvailable("files", noWorkspace)).toBe(false);
    expect(commandPaletteCommandAvailable("skills", noWorkspace)).toBe(false);
  });

  it("exposes the full workspace toolset only to a main Code/Work session", () => {
    const main = session({ agentMode: "work" });
    for (const command of [
      "terminal",
      "files",
      "review",
      "workstation",
      "image-studio",
      "fork",
      "skills",
      "plugins",
      "plan",
      "mcp",
      "memory",
      "custom:release",
    ])
      expect(commandPaletteCommandAvailable(command, main)).toBe(true);
    expect(commandPaletteCommandAvailable("unknown", main)).toBe(false);
  });
});
