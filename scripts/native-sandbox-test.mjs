import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'mingshen-mxc-e2e-'));
try {
  await mkdir(join(root, 'workspace')); await mkdir(join(root, 'outside'));
  await writeFile(join(root, 'outside', 'sentinel.txt'), 'OUTSIDE_SECRET');
  await symlink(join(root, 'outside'), join(root, 'workspace', 'linked'), 'junction');
  const child = spawn(process.execPath, [resolve('apps/desktop/node_modules/vitest/vitest.mjs'), 'run', 'src/main/workspace/native-sandbox-live.test.ts'], { cwd: resolve('apps/desktop'), env: { ...process.env, MINGSHEN_NATIVE_E2E: '1', MINGSHEN_NATIVE_TEST_ROOT: root }, windowsHide: true, stdio: 'inherit' });
  process.exitCode = await new Promise((done, reject) => { child.once('exit', done); child.once('error', reject); }) || 0;
} finally {
  const checked = resolve(root);
  if (checked.startsWith(`${resolve(tmpdir())}\\mingshen-mxc-e2e-`)) await rm(checked, { recursive: true, force: true });
}
