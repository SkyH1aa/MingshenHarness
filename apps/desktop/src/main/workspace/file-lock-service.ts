import { realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface EditOwner {
  sessionId: string;
  runId: string;
  label: string;
}
export interface EditConflict {
  path: string;
  owner: EditOwner;
  contender: EditOwner;
}
interface Lease {
  path: string;
  directory: boolean;
  owner: EditOwner;
}

async function canonical(path: string): Promise<string> {
  let cursor = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(await realpath(cursor), ...tail).toLowerCase();
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(path).toLowerCase();
      tail.unshift(cursor.slice(parent.length).replace(/^[\\/]/, ""));
      cursor = parent;
    }
  }
}

function overlaps(a: Lease, b: Lease): boolean {
  return (
    a.path === b.path ||
    (a.directory && b.path.startsWith(a.path + sep)) ||
    (b.directory && a.path.startsWith(b.path + sep))
  );
}

export class FileLockService {
  private leases: Lease[] = [];
  private gate: Promise<void> = Promise.resolve();

  async acquire(
    paths: string[],
    directory: boolean,
    owner: EditOwner,
    signal: AbortSignal,
    choose: (conflict: EditConflict) => Promise<boolean>,
  ): Promise<() => void> {
    const targets = [...new Set(await Promise.all(paths.map(canonical)))].sort();
    for (;;) {
      signal.throwIfAborted();
      let release: () => void = () => {};
      const previous = this.gate;
      this.gate = new Promise<void>((done) => {
        release = done;
      });
      await previous;
      let conflict: Lease | undefined;
      let conflictPath = "";
      try {
        for (const path of targets) {
          conflict = this.leases.find(
            (lease) =>
              lease.owner.runId !== owner.runId && overlaps(lease, { path, directory, owner }),
          );
          if (conflict) {
            conflictPath = path;
            break;
          }
        }
        if (!conflict) {
          signal.throwIfAborted();
          const acquired: Lease[] = [];
          // Each acquisition owns its lifetime, including overlapping processes in one run.
          for (const path of targets) {
            const lease = { path, directory, owner };
            this.leases.push(lease);
            acquired.push(lease);
          }
          return () => {
            this.leases = this.leases.filter((lease) => !acquired.includes(lease));
          };
        }
      } finally {
        release();
      }
      // The decision callback must wait for the previous writer to stop before releasing its lease.
      if (!(await choose({ path: conflictPath, owner: conflict.owner, contender: owner })))
        throw new Error(
          `File edit conflict: ${conflictPath}. Writer retained: ${conflict.owner.label}. No change executed.`,
        );
      signal.throwIfAborted();
      if (this.leases.includes(conflict))
        throw new Error("Previous writer is still active; edit remains blocked.");
    }
  }

  releaseRun(runId: string): void {
    this.leases = this.leases.filter((lease) => lease.owner.runId !== runId);
  }
}
