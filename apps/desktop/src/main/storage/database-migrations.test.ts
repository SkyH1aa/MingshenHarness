import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  DATABASE_MIGRATIONS,
  DATABASE_SCHEMA_VERSION,
  openDatabase,
  PRE_V11_BACKUP_MARKER,
} from "./database";
import { Repository } from "./repository";

const V11_TABLES = [
  "runtime_runs",
  "runtime_events",
  "accepted_turns",
  "plan_generations",
  "plan_step_claims",
  "office_deliveries",
] as const;

function expectV11Tables(database: DatabaseSync): void {
  for (const table of V11_TABLES)
    expect(
      database
        .prepare("select name from sqlite_master where type = 'table' and name = ?")
        .get(table)?.name,
    ).toBe(table);
  expect(database.prepare("pragma table_info(runtime_runs)").all()).toContainEqual(
    expect.objectContaining({
      name: "policy_denial_json",
      type: "TEXT",
      notnull: 1,
      dflt_value: "'null'",
    }),
  );
}

describe("permanent local database upgrade chain", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
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
          expect(db.prepare("pragma user_version").get()?.user_version).toBe(
            DATABASE_SCHEMA_VERSION,
          );
          expect(DATABASE_SCHEMA_VERSION).toBe(11);
          expect(DATABASE_MIGRATIONS).toHaveLength(11);
          expectV11Tables(db);
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
            agentMode: "code",
            permissionMode: "request_approval",
          });
          expect(repo.getAgentProfile("primary")?.applicableModes).toEqual(["code", "work"]);
          expect(
            db.prepare("select name from sqlite_master where name='chat_groups'").get()?.name,
          ).toBe("chat_groups");
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
  it("upgrades schema 9 to 11 and accepts the OpenAI Images provider protocol", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-provider-v10-"));
    const path = join(root, "legacy.db");
    let db = new DatabaseSync(path);
    try {
      for (const migration of DATABASE_MIGRATIONS.slice(0, 9)) db.exec(migration);
      db.exec("pragma user_version=9;");
      const time = "2026-01-01T00:00:00Z";
      db.prepare("insert into secrets values(?,?,?)").run("secret", Buffer.from([9, 8, 7]), time);
      db.prepare("insert into providers values(?,?,?,?,?,?,?,?,?)").run(
        "preserved",
        "Preserved",
        "https://fixture.invalid/v1",
        "openai_responses",
        "bearer",
        null,
        "key",
        time,
        time,
      );
      db.prepare(`insert into provider_keys(id,provider_id,label,secret_ref,masked_hint,created_at)
        values('key','preserved','Key','secret','***fixture',?)`).run(time);
      db.prepare(`insert into models(id,provider_id,model_id,display_name,context_window,max_output_tokens,
        input_modalities,output_modalities,reasoning_levels,created_at,updated_at)
        values('model','preserved','fixture','Fixture',10000,1000,'["text"]','["text"]','[]',?,?)`).run(
        time,
        time,
      );
      db.prepare(`insert into sessions(
        id,title,provider_id,model_id,workspace_path,permission_mode,
        archived,pinned,created_at,updated_at,last_opened_at
      ) values('session','Preserved session','preserved','model','C:\\Fixture',
        'request_approval',0,0,?,?,?)`).run(time, time, time);
      db.prepare("insert into app_settings values(?,?,?)").run(
        "fixture.setting",
        '{"value":"keep"}',
        time,
      );
      db.close();

      db = openDatabase(path);
      expect(db.prepare("pragma user_version").get()?.user_version).toBe(DATABASE_SCHEMA_VERSION);
      expect(DATABASE_MIGRATIONS).toHaveLength(11);
      expect(DATABASE_MIGRATIONS[9]).toContain("'openai_images'");
      expectV11Tables(db);
      expect(db.prepare("select * from providers where id='preserved'").get()).toMatchObject({
        name: "Preserved",
        protocol: "openai_responses",
        auth_mode: "bearer",
      });
      expect(db.prepare("select * from provider_keys where id='key'").get()).toMatchObject({
        provider_id: "preserved",
        secret_ref: "secret",
      });
      expect(db.prepare("select * from models where id='model'").get()).toMatchObject({
        provider_id: "preserved",
        model_id: "fixture",
      });
      expect(db.prepare("select * from sessions where id='session'").get()).toMatchObject({
        provider_id: "preserved",
        model_id: "model",
      });
      expect(
        db.prepare("select value_json from app_settings where key='fixture.setting'").get()
          ?.value_json,
      ).toBe('{"value":"keep"}');

      expect(() =>
        db
          .prepare("insert into providers values(?,?,?,?,?,?,?,?,?)")
          .run(
            "invalid",
            "Invalid",
            "https://fixture.invalid/v1",
            "not_a_protocol",
            "bearer",
            null,
            null,
            time,
            time,
          ),
      ).toThrow();
      db.prepare("insert into providers values(?,?,?,?,?,?,?,?,?)").run(
        "images",
        "Images",
        "https://fixture.invalid/v1",
        "openai_images",
        "bearer",
        null,
        null,
        time,
        time,
      );
      expect(db.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
      expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);

      db.close();
      db = openDatabase(path);
      expect(db.prepare("select protocol from providers where id='images'").get()?.protocol).toBe(
        "openai_images",
      );
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
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
  it("rolls back the schema 10 provider rebuild and restores foreign keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-provider-v10-failure-"));
    const path = join(root, "legacy.db");
    let db = new DatabaseSync(path);
    try {
      for (const migration of DATABASE_MIGRATIONS.slice(0, 9)) db.exec(migration);
      db.exec(`pragma foreign_keys=off; pragma user_version=9;
        insert into secrets values('secret',x'1234','now');
        insert into provider_keys(id,provider_id,label,secret_ref,masked_hint,created_at)
          values('orphan','missing','Keep','secret','***','now');`);
      db.close();

      const originalClose = DatabaseSync.prototype.close;
      let foreignKeysBeforeFailureClose: unknown;
      const closeSpy = vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(function (
        this: DatabaseSync,
      ) {
        foreignKeysBeforeFailureClose = this.prepare("pragma foreign_keys").get()?.foreign_keys;
        originalClose.call(this);
      });
      try {
        expect(() => openDatabase(path)).toThrow("foreign key validation");
      } finally {
        closeSpy.mockRestore();
      }
      expect(foreignKeysBeforeFailureClose).toBe(1);

      db = new DatabaseSync(path);
      expect(db.prepare("pragma user_version").get()?.user_version).toBe(9);
      expect(db.prepare("select id from provider_keys").get()?.id).toBe("orphan");
      expect(
        db.prepare("select name from sqlite_master where name='providers_v10'").get(),
      ).toBeUndefined();
      expect(
        db.prepare("select sql from sqlite_master where name='providers'").get()?.sql,
      ).not.toContain("openai_images");
      expect(db.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("backs up schema 10 before upgrading and keeps the backup at schema 10", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-db-v11-backup-"));
    const path = join(root, "legacy.db");
    let database = new DatabaseSync(path);
    try {
      for (const migration of DATABASE_MIGRATIONS.slice(0, 10)) database.exec(migration);
      database.exec("pragma user_version = 10;");
      database
        .prepare("insert into app_settings values(?, ?, ?)")
        .run("fixture.preserved", '{"value":"keep"}', "2026-01-01T00:00:00Z");
      database.close();

      database = openDatabase(path);
      expect(database.prepare("pragma user_version").get()?.user_version).toBe(11);
      expectV11Tables(database);
      expect(
        database
          .prepare("select value_json from app_settings where key = ?")
          .get("fixture.preserved")?.value_json,
      ).toBe('{"value":"keep"}');
      database.close();

      const backups = (await readdir(root)).filter((name) => name.includes(PRE_V11_BACKUP_MARKER));
      expect(backups).toHaveLength(1);
      const backup = backups[0];
      if (!backup) throw new Error("Expected a pre-v11 database backup.");
      database = new DatabaseSync(join(root, backup));
      expect(database.prepare("pragma user_version").get()?.user_version).toBe(10);
      expect(
        database
          .prepare("select value_json from app_settings where key = ?")
          .get("fixture.preserved")?.value_json,
      ).toBe('{"value":"keep"}');
      expect(
        database.prepare("select name from sqlite_master where name = 'runtime_runs'").get(),
      ).toBeUndefined();
      expect(database.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("leaves the main database at schema 10 when v11 fails after the backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-db-v11-failure-"));
    const path = join(root, "legacy.db");
    let database = new DatabaseSync(path);
    try {
      for (const migration of DATABASE_MIGRATIONS.slice(0, 10)) database.exec(migration);
      database.exec(`
        pragma user_version = 10;
        create table runtime_runs (fixture text);
      `);
      database
        .prepare("insert into app_settings values(?, ?, ?)")
        .run("fixture.preserved", '{"value":"keep"}', "2026-01-01T00:00:00Z");
      database.close();

      expect(() => openDatabase(path)).toThrow(/runtime_runs.*already exists/i);
      database = new DatabaseSync(path);
      expect(database.prepare("pragma user_version").get()?.user_version).toBe(10);
      expect(
        database
          .prepare("select value_json from app_settings where key = ?")
          .get("fixture.preserved")?.value_json,
      ).toBe('{"value":"keep"}');
      expect(database.prepare("pragma table_info(runtime_runs)").all()).toEqual([
        expect.objectContaining({ name: "fixture" }),
      ]);
      expect(
        database.prepare("select name from sqlite_master where name = 'runtime_events'").get(),
      ).toBeUndefined();
      expect(database.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
      database.close();

      const backups = (await readdir(root)).filter((name) => name.includes(PRE_V11_BACKUP_MARKER));
      expect(backups).toHaveLength(1);
      const backup = backups[0];
      if (!backup) throw new Error("Expected a pre-v11 database backup.");
      database = new DatabaseSync(join(root, backup));
      expect(database.prepare("pragma user_version").get()?.user_version).toBe(10);
      expect(
        database
          .prepare("select value_json from app_settings where key = ?")
          .get("fixture.preserved")?.value_json,
      ).toBe('{"value":"keep"}');
      expect(database.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("creates schema 11 directly without an empty pre-upgrade backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-db-v11-new-"));
    const path = join(root, "new.db");
    let database: DatabaseSync | null = null;
    try {
      database = openDatabase(path);
      expect(database.prepare("pragma user_version").get()?.user_version).toBe(11);
      expectV11Tables(database);
      database.close();
      database = null;
      expect((await readdir(root)).filter((name) => name.includes(PRE_V11_BACKUP_MARKER))).toEqual(
        [],
      );

      database = openDatabase("file::memory:?mingshen_v11_test=1");
      expect(database.prepare("pragma user_version").get()?.user_version).toBe(11);
      expectV11Tables(database);
    } finally {
      database?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
