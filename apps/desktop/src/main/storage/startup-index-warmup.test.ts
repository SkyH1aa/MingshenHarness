import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "./database";
import {
  STARTUP_INDEX_WARMUP_QUERIES,
  scheduleStartupIndexWarmup,
  warmStartupIndexes,
} from "./startup-index-warmup";

function insertSessions(database: DatabaseSync, count: number): void {
  const insert = database.prepare(`
    insert into sessions(id,title,permission_mode,agent_mode,created_at,updated_at,last_opened_at)
    values(?, 'Synthetic startup fixture', 'request_approval', 'chat', ?, ?, ?)
  `);
  const time = "2026-01-01T00:00:00Z";
  for (let index = 0; index < count; index++) insert.run(`fixture-${index}`, time, time, time);
}

describe("bounded startup SQLite index warmup", () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = openDatabase(":memory:");
  });
  afterEach(() => database.close());

  it("uses covering indexes without sorting and reads at most 32 entries per query", () => {
    insertSessions(database, 80);
    const expectedIndexes = ["sessions_catalog_idx", "sessions_agent_mode_catalog_idx"];
    expect(STARTUP_INDEX_WARMUP_QUERIES).toHaveLength(2);
    for (const [index, query] of STARTUP_INDEX_WARMUP_QUERIES.entries()) {
      const plan = database.prepare(`explain query plan ${query}`).all();
      expect(plan.map((row) => row.detail).join(" ")).toContain(
        `COVERING INDEX ${expectedIndexes[index]}`,
      );
      expect(plan.map((row) => row.detail).join(" ")).not.toContain("TEMP B-TREE");
      const rows = database.prepare(query).all();
      expect(rows).toHaveLength(32);
      expect(
        rows.every((row) => Object.values(row).length === 1 && Object.values(row)[0] === 1),
      ).toBe(true);
    }
  });

  it("preserves data, schema, journal configuration and the original busy timeout", () => {
    insertSessions(database, 1);
    database
      .prepare("insert into messages values(?,?,?,?,?,?)")
      .run(
        "fixture-message",
        "fixture-0",
        1,
        "user",
        '[{"type":"text","text":"Synthetic content to preserve"}]',
        "2026-01-01T00:00:00Z",
      );
    database.exec("pragma busy_timeout = 1729");
    const before = {
      changes: database.prepare("select total_changes() as value").get(),
      schema: database.prepare("pragma user_version").get(),
      journal: database.prepare("pragma journal_mode").get(),
      message: database.prepare("select * from messages").all(),
    };

    warmStartupIndexes(database);

    expect(database.prepare("pragma busy_timeout").get()?.timeout).toBe(1729);
    expect(database.prepare("select total_changes() as value").get()).toEqual(before.changes);
    expect(database.prepare("pragma user_version").get()).toEqual(before.schema);
    expect(database.prepare("pragma journal_mode").get()).toEqual(before.journal);
    expect(database.prepare("select * from messages").all()).toEqual(before.message);
  });

  it("restores the busy timeout even when an index is unavailable", () => {
    database.exec("pragma busy_timeout = 1729; drop index sessions_catalog_idx");
    expect(() => warmStartupIndexes(database)).toThrow(/sessions_catalog_idx/);
    expect(database.prepare("pragma busy_timeout").get()?.timeout).toBe(1729);
  });

  it("reads during a WAL writer transaction without retaining a stale snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "msh-startup-wal-"));
    let reader: DatabaseSync | undefined;
    let writer: DatabaseSync | undefined;
    try {
      const databasePath = join(directory, "fixture.db");
      reader = openDatabase(databasePath);
      writer = new DatabaseSync(databasePath);
      writer.exec("pragma busy_timeout = 5000; begin immediate");
      insertSessions(writer, 1);

      warmStartupIndexes(reader);
      expect(reader.prepare("select count(*) as count from sessions").get()?.count).toBe(0);
      writer.exec("commit");
      expect(reader.prepare("select count(*) as count from sessions").get()?.count).toBe(1);
      expect(reader.prepare("pragma journal_mode").get()?.journal_mode).toBe("wal");
      expect(reader.prepare("pragma busy_timeout").get()?.timeout).toBe(5000);
    } finally {
      writer?.close();
      reader?.close();
      const target = resolve(directory);
      const fromTemporaryRoot = relative(resolve(tmpdir()), target);
      expect(fromTemporaryRoot).not.toBe("");
      expect(fromTemporaryRoot.startsWith("..")).toBe(false);
      expect(isAbsolute(fromTemporaryRoot)).toBe(false);
      await rm(target, { recursive: true, force: true });
    }
  });

  it("defers work and checks eligibility again when the scheduled callback runs", () => {
    let pending: (() => void) | undefined;
    let eligible = true;
    const warm = vi.fn();
    const schedule = (callback: () => void) => {
      pending = callback;
    };
    scheduleStartupIndexWarmup({ shouldRun: () => eligible, warm, schedule });
    expect(warm).not.toHaveBeenCalled();
    eligible = false;
    pending?.();
    expect(warm).not.toHaveBeenCalled();

    scheduleStartupIndexWarmup({ shouldRun: () => eligible, warm, schedule });
    eligible = true;
    pending?.();
    expect(warm).toHaveBeenCalledOnce();
  });

  it("keeps eligibility and database failures out of the startup callback", () => {
    const schedule = (callback: () => void) => callback();
    expect(() =>
      scheduleStartupIndexWarmup({
        shouldRun: () => {
          throw new Error("Synthetic eligibility failure");
        },
        warm: vi.fn(),
        schedule,
      }),
    ).not.toThrow();
    expect(() =>
      scheduleStartupIndexWarmup({
        shouldRun: () => true,
        warm: () => {
          throw new Error("Synthetic SQLite failure");
        },
        schedule,
      }),
    ).not.toThrow();
  });
});
