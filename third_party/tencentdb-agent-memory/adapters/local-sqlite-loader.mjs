import * as sqlite from "node:sqlite";

// The local preset only uses built-in SQLite FTS. Upstream's optional vector
// extension must never fall through to package resolution on the user's machine.
export function createRequire() {
  return (specifier) => {
    if (specifier === "node:sqlite") return sqlite;
    throw new Error(`TencentDB local memory does not load external modules: ${specifier}`);
  };
}
