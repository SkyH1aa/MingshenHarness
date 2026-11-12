const { createHash, randomUUID } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { validateWindowsIcon } = require('./windows-icon.cjs');
const { checkElectronRuntime, resolveElectronRuntime } = require('./provision-electron-runtime.cjs');

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function readIconArtwork(iconPath, resedit) {
  const bytes = fs.readFileSync(iconPath);
  try {
    const count = validateWindowsIcon(bytes);
    const artwork = resedit.Data.IconFile.from(bytes);
    if (artwork.icons.length !== count) throw new Error('The icon frames could not be parsed.');
    return { bytes, artwork };
  } catch (cause) {
    throw Object.assign(new Error(`Invalid Windows icon: ${iconPath}`, { cause }), { code: 'INVALID_ICON' });
  }
}

function loadIconArtwork(iconPath, resedit) {
  try {
    return readIconArtwork(iconPath, resedit);
  } catch (cause) {
    if (!['ENOENT', 'INVALID_ICON'].includes(cause.code)) throw cause;
    const source = path.join(path.dirname(iconPath), `${path.parse(iconPath).name}.png`);
    try {
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, 'generate-icon.ps1'),
        '-SourcePath', source, '-OutputPath', iconPath,
      ], { windowsHide: true, timeout: 30000, stdio: 'pipe' });
      return readIconArtwork(iconPath, resedit);
    } catch (error) {
      const detail = error.stderr?.toString().trim() || error.message;
      throw new Error(`Cannot regenerate the Windows icon at ${iconPath} from ${source}.\n${detail}`, { cause: error });
    }
  }
}

function prepareExperimentalRuntime(options = {}) {
  const desktop = options.desktop ?? path.resolve(__dirname, '../apps/desktop');
  const source = options.source ?? checkElectronRuntime(resolveElectronRuntime(desktop)).executable;
  const target = options.target ?? path.join(path.dirname(source), 'MingshenHarnessExperimental.exe');
  if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase())
    throw new Error('The experimental executable must not replace the original Electron runtime.');
  const marker = `${target}.json`;
  const builder = require.resolve('electron-builder', { paths: [desktop] });
  const library = require.resolve('app-builder-lib', { paths: [path.dirname(builder)] });
  const resedit = require(require.resolve('resedit', { paths: [path.dirname(library)] }));
  const { bytes: icon, artwork } = loadIconArtwork(
    path.resolve(options.icon ?? path.join(desktop, 'build/icon.ico')), resedit);
  const sourceBytes = fs.readFileSync(source);
  const version = options.version ?? JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;
  const fingerprint = hash(JSON.stringify({ version, source: hash(sourceBytes), icon: hash(icon), revision: 2 }));
  let previous;
  try { previous = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch {}
  if (previous?.fingerprint === fingerprint && fs.existsSync(target) &&
      hash(fs.readFileSync(target)) === previous.executableHash)
    return { target, changed: false };

  const executable = resedit.NtExecutable.from(sourceBytes, { ignoreCert: true });
  const resource = resedit.NtExecutableResource.from(executable);
  const groups = resource.entries.filter(entry => entry.type === 14);
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }])
    resedit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, group.id, group.lang, artwork.icons.map(item => item.data));
  const versions = resedit.Resource.VersionInfo.fromEntries(resource.entries);
  for (const info of versions.length ? versions : [resedit.Resource.VersionInfo.createEmpty()]) {
    const languages = info.getAllLanguagesForStringValues();
    for (const language of languages.length ? languages : [{ lang: 1033, codepage: 1200 }])
      info.setStringValues(language, {
        ProductName: 'Mingshen Harness Dev', FileDescription: 'Mingshen Harness Experimental',
        CompanyName: 'Ming', InternalName: 'MingshenHarnessExperimental',
        OriginalFilename: 'MingshenHarnessExperimental.exe',
      });
    info.setFileVersion(`${version}.0`);
    info.setProductVersion(`${version}.0`);
    info.outputToResourceEntries(resource.entries);
  }
  resource.outputResource(executable);
  const output = Buffer.from(executable.generate());
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, output);
    fs.renameSync(temporary, target);
    fs.writeFileSync(marker, JSON.stringify({ fingerprint, executableHash: hash(output) }));
  } catch (cause) {
    if (['EPERM', 'EBUSY', 'EACCES'].includes(cause.code))
      throw new Error('Cannot refresh the experimental runtime. Close its window and tray instance, then run run-experimental.cmd again.', { cause });
    throw cause;
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { target, changed: true };
}

module.exports = { prepareExperimentalRuntime };
if (require.main === module) {
  const result = prepareExperimentalRuntime();
  console.log(result.changed
    ? `Experimental runtime prepared with the approved icon: ${result.target}`
    : 'Experimental runtime executable and icon integrity verified.');
  if (process.argv.includes('--launch')) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(result.target, [path.resolve(__dirname, '../apps/desktop'), '--mingshen-experimental'], {
      detached: true, stdio: 'ignore', env,
    });
    child.once('error', error => { console.error(error); process.exitCode = 1; });
    child.once('spawn', () => child.unref());
  }
}
