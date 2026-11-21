import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import * as guardedIo from "./guarded-workspace-io";
import { WorkspaceSearchService } from "./workspace-search-service";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await guardedIo.stopGuardedWorkspaceIo();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorkspaceSearchService", () => {
  it("searches bounded file names without following ignored directories or junctions", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-workspace-search-"));
    const outside = await mkdtemp(join(tmpdir(), "mingshen-outside-search-"));
    roots.push(root, outside);
    await mkdir(join(root, "src", "components"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
    await writeFile(join(root, "src", "components", "CommandPalette.tsx"), "");
    await writeFile(join(root, "node_modules", "ignored", "CommandPalette.tsx"), "");
    await writeFile(join(outside, "CommandPalette.tsx"), "");
    await symlink(outside, join(root, "outside-link"), "junction");
    const result = await new WorkspaceSearchService().findFiles(root, {
      sessionId: "session",
      query: "commandpalette",
    });
    expect(result.items.map((item) => item.relativePath)).toEqual([
      join("src", "components", "CommandPalette.tsx"),
    ]);
    expect(result.truncated).toBe(false);
  }, 30_000);

  it("derives the search root from the session and rejects ChatAgent", async () => {
    const database = openDatabase(":memory:");
    const root = await mkdtemp(join(tmpdir(), "mingshen-session-search-"));
    const otherRoot = await mkdtemp(join(tmpdir(), "mingshen-other-search-"));
    roots.push(root, otherRoot);
    try {
      const repository = new Repository(database);
      const create = (
        agentMode: "code" | "chat",
        workspacePath: string | null,
        executionMode: "host" | "worktree" = "host",
      ) =>
        repository.insertSession({
          title: "Fixture",
          providerId: null,
          modelId: null,
          agentMode,
          agentProfileId: "primary",
          workspacePath,
          systemPrompt: "",
          reasoningLevel: null,
          permissionMode: "request_approval",
          executionMode,
          patchOnly: false,
        });
      const session = create("code", root);
      const worktree = create("code", root, "worktree");
      const chat = create("chat", null);
      await writeFile(join(root, "session-owner.ts"), "");
      await writeFile(join(otherRoot, "session-owner.ts"), "");
      const service = new WorkspaceSearchService();

      const result = await service.findSessionFiles(repository, {
        sessionId: session.id,
        query: "session-owner",
        ...({ workspacePath: otherRoot } as object),
      });

      expect(result.root).toBe(root);
      expect(result.items.map((item) => item.path)).toEqual([join(root, "session-owner.ts")]);
      await expect(
        service.findSessionFiles(repository, { sessionId: chat.id, query: "session-owner" }),
      ).rejects.toThrow("ChatAgent");
      await expect(
        service.findSessionFiles(repository, { sessionId: worktree.id, query: "session-owner" }),
      ).rejects.toThrow("工作树尚未建立");

      const treeService = new WorkspaceSearchService((id) =>
        id === worktree.id ? otherRoot : null,
      );
      const treeResult = await treeService.findSessionFiles(repository, {
        sessionId: worktree.id,
        query: "session-owner",
      });
      expect(treeResult.root).toBe(otherRoot);
      expect(treeResult.items.map((item) => item.path)).toEqual([
        join(otherRoot, "session-owner.ts"),
      ]);
    } finally {
      database.close();
    }
  }, 30_000);

  it("skips reparse entries and paths replaced after enumeration", async () => {
    const list = vi
      .spyOn(guardedIo, "listGuardedDirectory")
      .mockImplementation(async (_root, path) => {
        if (!path)
          return [
            { name: "outside", directory: true, reparse: true, size: 0 },
            { name: "changed", directory: true, reparse: false, size: 0 },
            { name: "match.ts", directory: false, reparse: false, size: 0 },
            { name: "match-swap.ts", directory: false, reparse: false, size: 0 },
          ];
        throw new Error("directory replaced by a junction");
      });
    const stat = vi.spyOn(guardedIo, "statGuardedPath").mockImplementation(async (_root, path) => {
      if (path === "match-swap.ts") throw new Error("file replaced by a link");
      return { state: "file", directory: false, size: 0 };
    });

    const root = resolveFixtureRoot();
    const result = await new WorkspaceSearchService().findFiles(root, {
      sessionId: "session",
      query: "match",
    });
    expect(result.items.map((item) => item.relativePath)).toEqual(["match.ts"]);
    expect(stat).toHaveBeenCalledWith(root, "match-swap.ts", expect.any(Object));
    expect(list).not.toHaveBeenCalledWith(root, "outside", expect.any(Object));
    expect(list).toHaveBeenCalledWith(root, "changed", expect.any(Object));
  });

  it("propagates a guarded root failure", async () => {
    vi.spyOn(guardedIo, "listGuardedDirectory").mockRejectedValue(new Error("root unavailable"));
    await expect(
      new WorkspaceSearchService().findFiles(resolveFixtureRoot(), {
        sessionId: "session",
        query: "match",
      }),
    ).rejects.toThrow("root unavailable");
  });
});

function resolveFixtureRoot(): string {
  return join(tmpdir(), "mingshen-guarded-search-fixture");
}
