import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";

describe("persistent session paging and change feed", () => {
  it("migrates existing schema 6 data without changing history, configuration or secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-catalog-migration-"));
    const path = join(root, "test.db");
    let db = openDatabase(path);
    let id = "";
    try {
      const repo = new Repository(db);
      id = repo.insertSession({
        title: "迁移前的历史",
        providerId: null,
        modelId: null,
        agentProfileId: "primary",
        workspacePath: "C:\\Project",
        systemPrompt: "Keep",
        reasoningLevel: null,
        permissionMode: "request_approval",
        executionMode: "host",
        patchOnly: false,
      }).id;
      repo.appendMessage({
        sessionId: id,
        role: "user",
        parts: [{ type: "text", text: "Keep this history" }],
      });
      repo.setSetting("fixture.keep", { enabled: true });
      db.prepare("insert into secrets(id,ciphertext,created_at) values(?,?,?)").run(
        "fixture",
        Buffer.from("encrypted-fixture"),
        new Date().toISOString(),
      );
      db.exec(
        `drop trigger sessions_catalog_insert;drop trigger sessions_catalog_update;drop trigger sessions_catalog_delete;drop table session_title_search;drop table session_changes;drop index sessions_catalog_idx;drop index sessions_workspace_catalog_idx;pragma user_version=6;`,
      );
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
      expect(db.prepare("pragma user_version").get()?.user_version).toBe(8);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("pages thousands of rows without gaps, searches CJK/substring and returns only changed loaded records", () => {
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
      repo.removeSession(child.id);
      const delta = repo.sessionDelta(revision, [all[0]?.id ?? "", child.id]);
      expect(delta.removed).toEqual([child.id]);
      expect(delta.sessions[0]?.title).toBe("renamed");
      expect(repo.sessionGroups()[0]).toMatchObject({ total: 1200, children: 0 });
      const oldPage = repo.sessionPage({ limit: 1 });
      create("new");
      expect(
        repo.sessionPage({ cursor: oldPage.nextCursor ?? "", limit: 1 }).sessions[0]?.id,
      ).not.toBe(oldPage.sessions[0]?.id);
      expect(db.prepare("pragma user_version").get()?.user_version).toBe(8);
      expect(() => repo.sessionPage({ cursor: "x".repeat(9000) })).toThrow("Invalid session page");
      expect(() => repo.sessionPage({ limit: Number.NaN })).toThrow("Invalid session page");
      expect(() => repo.sessionDelta(0, [42] as unknown as string[])).toThrow(
        "Invalid session synchronization",
      );
    } finally {
      db.close();
    }
  });
});
