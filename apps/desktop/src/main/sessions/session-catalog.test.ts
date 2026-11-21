import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DATABASE_MIGRATIONS, openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";

describe("persistent session paging and change feed", () => {
  it("migrates existing schema 6 data without changing history, configuration or secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-catalog-migration-"));
    const path = join(root, "test.db");
    let db = new DatabaseSync(path);
    const id = "legacy-session";
    try {
      for (const migration of DATABASE_MIGRATIONS.slice(0, 6)) db.exec(migration);
      const now = new Date().toISOString();
      db.prepare(`insert into sessions(
        id,title,provider_id,model_id,workspace_path,system_prompt,reasoning_level,
        permission_mode,status,archived,pinned,created_at,updated_at,last_opened_at,
        agent_profile_id,execution_mode,patch_only
      ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id,
        "迁移前的历史",
        null,
        null,
        "C:\\Project",
        "Keep",
        null,
        "request_approval",
        "idle",
        0,
        0,
        now,
        now,
        now,
        "primary",
        "host",
        0,
      );
      db.prepare("insert into messages values(?,?,?,?,?,?)").run(
        "legacy-message",
        id,
        1,
        "user",
        '[{"type":"text","text":"Keep this history"}]',
        now,
      );
      db.prepare("insert into app_settings values(?,?,?)").run(
        "fixture.keep",
        JSON.stringify({ enabled: true }),
        now,
      );
      db.prepare("insert into secrets(id,ciphertext,created_at) values(?,?,?)").run(
        "fixture",
        Buffer.from("encrypted-fixture"),
        now,
      );
      db.exec("pragma user_version=6;");
      db.close();
      db = openDatabase(path);
      const migrated = new Repository(db);
      expect(migrated.sessionPage({ query: "迁移前" }).sessions[0]?.id).toBe(id);
      expect(migrated.getMessages(id)[0]?.parts[0]).toEqual({
        type: "text",
        text: "Keep this history",
      });
      expect(migrated.getSetting("fixture.keep")).toEqual({ enabled: true });
      expect(
        Buffer.from(
          db.prepare("select ciphertext from secrets where id=?").get("fixture")
            ?.ciphertext as Uint8Array,
        ).toString(),
      ).toBe("encrypted-fixture");
      expect(db.prepare("pragma user_version").get()?.user_version).toBe(9);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("pages thousands of rows without gaps, searches CJK/substring and reconciles changed records", () => {
    const db = openDatabase(":memory:"),
      repo = new Repository(db);
    try {
      const create = (title: string, parentSessionId: string | null = null) =>
        repo.insertSession({
          title,
          parentSessionId,
          providerId: null,
          modelId: null,
          agentProfileId: "primary",
          workspacePath: "C:\\Project",
          systemPrompt: "",
          reasoningLevel: null,
          permissionMode: "request_approval",
          executionMode: "host",
          patchOnly: false,
        });
      const all = Array.from({ length: 1200 }, (_, i) =>
        create(`索引测试 task-${String(i).padStart(4, "0")}`),
      );
      const child = create("worker", all[0]?.id);
      const ids = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = repo.sessionPage({ limit: 100, ...(cursor ? { cursor } : {}) });
        expect(page.total).toBe(1200);
        for (const item of page.sessions) {
          expect(ids.has(item.id)).toBe(false);
          ids.add(item.id);
        }
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids.size).toBe(1200);
      expect(repo.sessionPage({ query: "索引测试", limit: 1 }).total).toBe(1200);
      expect(repo.sessionPage({ query: "task-0001" }).sessions[0]?.id).toBe(all[1]?.id);
      expect(repo.sessionPage({ parentId: all[0]?.id ?? "" }).sessions[0]?.id).toBe(child.id);
      const revision = repo.sessionRevision();
      repo.updateSession(all[0]?.id ?? "", { title: "renamed" });
      const delta = repo.sessionDelta(revision, [all[0]?.id ?? "", child.id]);
      expect(delta.sessions[0]?.title).toBe("renamed");
      const beforeRemoval = repo.sessionRevision();
      repo.removeSession(child.id);
      expect(repo.sessionDelta(beforeRemoval, [child.id]).reset).toBe(true);
      expect(repo.sessionGroups()[0]).toMatchObject({ total: 1200, children: 0 });
      const oldPage = repo.sessionPage({ limit: 1 });
      create("new");
      expect(
        repo.sessionPage({ cursor: oldPage.nextCursor ?? "", limit: 1 }).sessions[0]?.id,
      ).not.toBe(oldPage.sessions[0]?.id);
      expect(db.prepare("pragma user_version").get()?.user_version).toBe(9);
      expect(() => repo.sessionPage({ cursor: "x".repeat(9000) })).toThrow("Invalid session page");
      expect(() => repo.sessionPage({ limit: Number.NaN })).toThrow("Invalid session page");
      expect(() => repo.sessionDelta(0, [42] as unknown as string[])).toThrow(
        "Invalid session synchronization",
      );
    } finally {
      db.close();
    }
  });

  it("recovers unknown visible changes without repeatedly resetting for hidden or related rows", () => {
    const db = openDatabase(":memory:"),
      repo = new Repository(db);
    try {
      const base = {
        providerId: null,
        modelId: null,
        agentProfileId: "primary",
        workspacePath: "C:\\Project",
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "request_approval" as const,
        executionMode: "host" as const,
        patchOnly: false,
      };
      const create = (
        title: string,
        options: { parentSessionId?: string; agentMode?: "code" | "work" | "chat" } = {},
      ) =>
        repo.insertSession({
          ...base,
          title,
          parentSessionId: options.parentSessionId ?? null,
          agentMode: options.agentMode ?? "code",
          workspacePath: options.agentMode === "chat" ? null : base.workspacePath,
        });

      const parent = create("parent");
      const beforeChild = repo.sessionRevision();
      const child = create("child", { parentSessionId: parent.id });
      const childDelta = repo.sessionDelta(beforeChild, [parent.id]);
      expect(childDelta.reset).toBe(false);
      expect(childDelta.sessions.map((item) => item.id)).toEqual([child.id]);

      const beforeChat = repo.sessionRevision();
      const chat = create("chat", { agentMode: "chat" });
      const chatDelta = repo.sessionDelta(beforeChat, [parent.id]);
      expect(chatDelta.reset).toBe(false);
      expect(chatDelta.sessions.map((item) => item.id)).toEqual([chat.id]);

      const beforeRoot = repo.sessionRevision();
      const root = create("new visible root");
      const rootDelta = repo.sessionDelta(beforeRoot, [parent.id]);
      expect(rootDelta).toMatchObject({ reset: true, sessions: [], removed: [] });
      expect(rootDelta.revision).toBeGreaterThan(beforeRoot);

      const archived = create("archived root");
      const beforeArchive = repo.sessionRevision();
      repo.updateSession(archived.id, { archived: true });
      const archiveDelta = repo.sessionDelta(beforeArchive, [parent.id]);
      expect(archiveDelta).toMatchObject({ reset: false, sessions: [], removed: [] });

      const beforeRemoval = repo.sessionRevision();
      repo.removeSession(root.id);
      const removalDelta = repo.sessionDelta(beforeRemoval, [parent.id]);
      expect(removalDelta).toMatchObject({ reset: false, sessions: [], removed: [] });

      const beforeKnownRemoval = repo.sessionRevision();
      repo.removeSession(child.id);
      const knownRemoval = repo.sessionDelta(beforeKnownRemoval, [child.id]);
      expect(knownRemoval.reset).toBe(true);
    } finally {
      db.close();
    }
  });

  it("keeps ChatAgent out of the workspace catalog and persists manual chat groups", () => {
    const db = openDatabase(":memory:"),
      repo = new Repository(db);
    try {
      const base = {
        providerId: null,
        modelId: null,
        agentProfileId: "primary",
        workspacePath: null,
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "request_approval" as const,
        executionMode: "host" as const,
        patchOnly: false,
      };
      const group = repo.createChatGroup("Research");
      const code = repo.insertSession({
        ...base,
        title: "Code",
        agentMode: "code",
        workspacePath: "C:\\Project",
      });
      const work = repo.insertSession({
        ...base,
        title: "Work",
        agentMode: "work",
        workspacePath: "C:\\Project",
      });
      const chat = repo.insertSession({
        ...base,
        title: "Chat",
        agentMode: "chat",
        chatGroupId: group.id,
      });

      expect(repo.sessionPage().total).toBe(2);
      expect(repo.sessionPage({ agentMode: "workspace" }).total).toBe(2);
      expect(repo.sessionPage({ agentMode: "code" }).sessions[0]?.id).toBe(code.id);
      expect(repo.sessionPage({ agentMode: "work" }).sessions[0]?.id).toBe(work.id);
      expect(repo.sessionPage({ agentMode: "chat" }).sessions[0]?.id).toBe(chat.id);
      expect(repo.sessionPage({ agentMode: "chat", chatGroupId: group.id }).total).toBe(1);
      expect(repo.sessionGroups()[0]).toMatchObject({ total: 2 });

      expect(repo.renameChatGroup(group.id, "Deep research").name).toBe("Deep research");
      repo.removeChatGroup(group.id);
      expect(repo.listChatGroups()).toEqual([]);
      expect(repo.getSession(chat.id)?.chatGroupId).toBeNull();
    } finally {
      db.close();
    }
  });
});
