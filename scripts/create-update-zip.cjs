const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { stat, rename, rm, writeFile } = require('node:fs/promises');
const { basename, dirname, join, resolve } = require('node:path');

async function createUpdateZip(installer) {
  const source = resolve(installer);
  const match = /^MingshenHarness-(\d{1,3}\.\d{1,3}\.\d{1,3})-x64\.exe$/.exec(basename(source));
  if (!match || !(await stat(source)).isFile()) throw new Error('Expected a version-named x64 Mingshen installer.');
  const archive = source.replace(/\.exe$/, '.zip');
  const temporary = join(dirname(source), `.update-${randomUUID()}.zip`);
  try {
    await new Promise((done, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        join(__dirname, 'create-update-zip.ps1'), '-Installer', source, '-Archive', temporary], { windowsHide: true, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? done() : reject(new Error(`ZIP creation failed (${code}).`)));
    });
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(temporary)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    const size = (await stat(temporary)).size;
    if (size > 2147483648) throw new Error('Update ZIP exceeds the 2 GiB limit.');
    await rename(temporary, archive);
    const metadata = { version: match[1], package_format: 'zip', package_sha256: sha256, package_size: size, filename: basename(archive) };
    await writeFile(`${archive}.sha256`, `${sha256}  ${basename(archive)}\n`);
    await writeFile(`${archive}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Update ZIP: ${archive}\nZIP SHA-256: ${sha256}\nZIP size: ${size} bytes`);
    return { archive, ...metadata };
  } finally {
    // Only this UUID-named file alongside the explicitly selected installer is removed.
    if (dirname(temporary) === dirname(source) && basename(temporary).startsWith('.update-'))
      await rm(temporary, { force: true });
  }
}
module.exports = { createUpdateZip };
if (require.main === module) {
  const version = require('../apps/desktop/package.json').version;
  createUpdateZip(process.argv[2] || join(__dirname, '..', 'apps', 'desktop', 'release-artifacts', `MingshenHarness-${version}-x64.exe`))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
