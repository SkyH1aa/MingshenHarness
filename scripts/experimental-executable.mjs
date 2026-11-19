import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

export function experimentalExecutable() {
  const desktop = resolve("apps/desktop");
  const metadata = require.resolve("electron/package.json", { paths: [desktop] });
  const executable = join(dirname(metadata), "dist", "MingshenHarnessExperimental.exe");
  if (!existsSync(executable)) {
    throw new Error(
      `Experimental runtime not found at ${executable}. Run node scripts/prepare-experimental-runtime.cjs first.`,
    );
  }
  return executable;
}
