import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DATABASE_MIGRATIONS, openDatabase } from "./database";
import { Repository } from "./repository";

describe("permanent local database upgrade chain", () => {
  it.each([1, 2, 3, 4, 5, 6, 7])(
    "upgrades schema %i and preserves user data across repeated launches",
    async (version) => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-old-db-"));
      const path = join(root, "legacy.db");
      let db = new DatabaseSync(path);
      try {
        for (const migration of DATABASE_MIGRATIONS.slice(0, version)) db.exec(migration);
        db.exec(`pragma user_version=${version};`);
        const time = "2026-01-01T00:00:00Z";
        db.prepare(`insert into sessions(id,title,workspace_path,permission_mode,archived,pinned,created_at,updated_at,last_opened_at)
        values(?,?,?,?,?,?,?,?,?)`).run(
          "old",
          "历史记录 Keep",
          "C:\\Old project",
          "request_approval",
          1,
          1,
          time,
          time,
          time,
        );
        db.prepare("insert into messages values(?,?,?,?,?,?)").run(
          "msg",
          "old",
          1,
          "user",
          '[{"type":"text","text":"Keep full history"}]',
          time,
        );
        db.prepare("insert into secrets values(?,?,?)").run(
          "encrypted",
          Buffer.from([1, 7, 0, 255, 42]),
          time,
        );
        db.prepare("insert into providers values(?,?,?,?,?,?,?,?,?)").run(
          "provider",
          "Preserved",
          "https://fixture.invalid/v1",
          "openai_responses",
          "custom",
          "x-fixture",
          "key",
          time,
          time,
        );
        db.prepare(`insert into provider_keys(id,provider_id,label,secret_ref,masked_hint,created_at)
          values('key','provider','Key','encrypted','***fixture',?)`).run(time);
        db.prepare(`insert into models(id,provider_id,model_id,display_name,context_window,max_output_tokens,
          input_modalities,output_modalities,reasoning_levels,created_at,updated_at)
          values('model','provider','fixture','Fixture',10000,1000,'["text"]','["text"]','[]',?,?)`).run(
          time,
          time,
        );
        db.exec("update sessions set provider_id='provider',model_id='model' where id='old'");
        const preservedTables = ["providers", "provider_keys", "models"].map((table) =>
          db.prepare(`select * from ${table}`).all(),
        );
        for (const [key, value] of Object.entries({
          "legal.acceptedVersion": "policy-fixture",
          "legal.consent": {
            terms: true,
            privacy: true,
            disclaimer: true,
            version: "policy-fixture",
          },
          "context.checkpoint.old": { summary: "Preserved" },
          "fixture.setting": { value: "Keep" },
        }))
          db.prepare("insert into app_settings values(?,?,?)").run(
            key,
            JSON.stringify(value),
            time,
          );
        for (let launch = 0; launch < 2; launch++) {
          db.close();
          db = openDatabase(path);
          const repo = new Repository(db);
          expect(db.prepare("pragma user_version").get()?.user_version).toBe(8);
          for (const [index, table] of ["providers", "provider_keys", "models"].entries())
            expect(db.prepare(`select * from ${table}`).all()).toEqual(preservedTables[index]);
          expect(db.prepare("pragma foreign_keys").get()?.foreign_keys).toBe(1);
          expect(() =>
            db
              .prepare(`insert into provider_keys(id,provider_id,label,secret_ref,masked_hint,created_at)
            values('invalid','missing','Key','encrypted','***','now')`)
              .run(),
          ).toThrow();
          expect(db.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
          expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
          expect(repo.getSession("old")).toMatchObject({
            title: "历史记录 Keep",
            archived: true,
            pinned: true,
            permissionMode: "request_approval",
          });
          expect(repo.getMessages("old")[0]?.parts).toEqual([
            { type: "text", text: "Keep full history" },
          ]);
          expect(repo.getSetting("context.checkpoint.old")).toEqual({ summary: "Preserved" });
          expect(repo.getSetting("legal.consent")).toEqual({
            terms: true,
            privacy: true,
            disclaimer: true,
            version: "policy-fixture",
          });
          expect(
            Buffer.from(
              db.prepare("select ciphertext from secrets").get()?.ciphertext as Uint8Array,
            ),
          ).toEqual(Buffer.from([1, 7, 0, 255, 42]));
          expect(
            db
              .prepare("select rowid from session_title_search where session_title_search match ?")
              .all('"历史记录"'),
          ).toHaveLength(1);
        }
      } finally {
        db.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("rolls back a failing migration and refuses future schemas without deleting history", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-db-failure-"));
    const path = join(root, "legacy.db");
    try {
      let db = new DatabaseSync(path);
      for (const migration of DATABASE_MIGRATIONS.slice(0, 6)) db.exec(migration);
      db.exec(
        "pragma user_version=6;create table session_changes(legacy text);insert into app_settings values('keep','true','now');",
      );
      db.close();
      expect(() => openDatabase(path)).toThrow();
      db = new DatabaseSync(path);
      expect(db.prepare("pragma user_version").get()?.user_version).toBe(6);
      expect(
        db.prepare("select value_json from app_settings where key='keep'").get()?.value_json,
      ).toBe("true");
      expect(
        db.prepare("select name from sqlite_master where name='session_title_search'").get(),
      ).toBeUndefined();
      db.exec("drop table session_changes;pragma user_version=99;");
      db.close();
      expect(() => openDatabase(path)).toThrow("newer");
      db = new DatabaseSync(path);
      expect(
        db.prepare("select value_json from app_settings where key='keep'").get()?.value_json,
      ).toBe("true");
      db.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rolls back the provider rebuild if foreign key validation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-provider-migration-"));
    const path = join(root, "legacy.db");
    let db = new DatabaseSync(path);
    try {
      for (const migration of DATABASE_MIGRATIONS.slice(0, 7)) db.exec(migration);
      db.exec(`pragma foreign_keys=off; pragma user_version=7;
        insert into secrets values('secret',x'1234','now');
        insert into provider_keys(id,provider_id,label,secret_ref,masked_hint,created_at)
          values('orphan','missing','Keep','secret','***','now');`);
      db.close();
      expect(() => openDatabase(path)).toThrow("foreign key validation");
      db = new DatabaseSync(path);
      expect(db.prepare("pragma user_version").get()?.user_version).toBe(7);
      expect(db.prepare("select id from provider_keys").get()?.id).toBe("orphan");
      expect(
        db.prepare("select name from sqlite_master where name='providers_v8'").get(),
      ).toBeUndefined();
      expect(
        db.prepare("select sql from sqlite_master where name='providers'").get()?.sql,
      ).not.toContain("gemini_generate_content");
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
