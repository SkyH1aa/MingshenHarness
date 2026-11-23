import type { DatabaseSync } from "node:sqlite";

export const STARTUP_INDEX_WARMUP_QUERIES = [
  `select 1 from sessions indexed by sessions_catalog_idx
   where archived=0 and parent_session_id is null
   order by pinned desc, max(last_opened_at, updated_at, created_at) desc, id limit 32`,
  `select 1 from sessions indexed by sessions_agent_mode_catalog_idx
   where agent_mode='chat' and archived=0 limit 32`,
] as const;

export function warmStartupIndexes(database: DatabaseSync): void {
  const timeout = database.prepare("pragma busy_timeout").get()?.timeout;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 0) return;

  try {
    // The shared connection is used synchronously; don't wait on external locks for optional work.
    database.exec("pragma busy_timeout = 0");
    for (const query of STARTUP_INDEX_WARMUP_QUERIES) database.prepare(query).all();
  } finally {
    database.exec(`pragma busy_timeout = ${timeout}`);
  }
}

export function scheduleStartupIndexWarmup(options: {
  shouldRun(): boolean;
  warm(): void;
  schedule?: (callback: () => void) => void;
}): void {
  const schedule = options.schedule ?? setImmediate;
  schedule(() => {
    try {
      if (options.shouldRun()) options.warm();
    } catch {
      // A failed optional warmup must not hold the startup window open.
    }
  });
}
