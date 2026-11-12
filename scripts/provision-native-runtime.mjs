import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, copyFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('../apps/desktop/resources/native', import.meta.url));
const version = 'rust-v0.166.0';
const name = 'codex-x86_64-pc-windows-msvc.exe';
const executableHash = '9d563ee4e0441ff9d59d612013e0460ddf8e5709735c2d9f6b98b7ef8ca4eb42';
async function hash(file) {
  const result = createHash('sha256');
  for await (const chunk of createReadStream(file)) result.update(chunk);
  return result.digest('hex');
}
await mkdir(destination, { recursive: true });
const target = join(destination, 'codex-sandbox.exe');
if (await access(target).then(() => true, () => false)) {
  if (await hash(target) === executableHash) { console.log('Native runtime verified.'); process.exit(0); }
}
const temporary = await mkdtemp(join(tmpdir(), 'mingshen-runtime-'));
try {
  const archive = join(temporary, 'codex.tar.gz');
  console.log('Downloading the pinned native sandbox runtime...');
  const response = await fetch(`https://github.com/openai/codex/releases/download/${version}/${name}.tar.gz`, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) throw new Error(`Runtime download: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  if (await hash(archive) !== 'dafeb48b5a853b2898453a6b5bdae0fa0646bd5d5b73c5dfe74c97d0af4a4a0d') throw new Error('Archive integrity check failed');
  await promisify(execFile)('tar.exe', ['-xzf', archive, '-C', temporary], { windowsHide: true });
  const extracted = join(temporary, name);
  if (await hash(extracted) !== executableHash) throw new Error('Executable integrity check failed');
  await copyFile(extracted, target);
  console.log('Native runtime installed and verified.');
} finally {
  const checked = resolve(temporary);
  if (checked.startsWith(`${resolve(tmpdir())}\\mingshen-runtime-`)) await rm(checked, { recursive: true, force: true });
}
