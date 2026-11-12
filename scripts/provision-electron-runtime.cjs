const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const desktop = path.resolve(__dirname, '../apps/desktop');
const requiredFiles = [
  'electron.exe', 'd3dcompiler_47.dll', 'vulkan-1.dll', 'resources.pak',
  'icudtl.dat', 'locales/en-US.pak',
];

function resolveElectronRuntime(from = desktop) {
  let metadata;
  try {
    metadata = require.resolve('electron/package.json', { paths: [from] });
  } catch (cause) {
    throw new Error('Electron dependency is missing. Run pnpm install --frozen-lockfile in the repository root.', { cause });
  }
  const root = path.dirname(metadata);
  return {
    root, dist: path.join(root, 'dist'),
    executable: path.join(root, 'dist', 'electron.exe'),
    version: JSON.parse(fs.readFileSync(metadata, 'utf8')).version,
  };
}

function checkElectronRuntime(runtime = resolveElectronRuntime()) {
  try {
    const installed = fs.readFileSync(path.join(runtime.dist, 'version'), 'utf8').trim().replace(/^v/, '');
    if (installed !== runtime.version) throw new Error(`Expected ${runtime.version}, found ${installed}.`);
    if (fs.readFileSync(path.join(runtime.root, 'path.txt'), 'utf8').trim() !== 'electron.exe')
      throw new Error('Electron executable registration is missing or targets another platform.');
    for (const name of requiredFiles) {
      const file = fs.statSync(path.join(runtime.dist, name));
      if (!file.isFile() || file.size === 0) throw new Error(`Missing or empty Electron file: ${name}`);
    }
  } catch (cause) {
    throw Object.assign(new Error(
      `Electron ${runtime.version} Windows runtime is incomplete at ${runtime.dist}.\n` +
      'Run node scripts/provision-electron-runtime.cjs from the repository root, or rerun package-win.cmd.',
      { cause },
    ), { code: 'ELECTRON_RUNTIME_UNAVAILABLE' });
  }
  return runtime;
}

function provisionElectronRuntime(from = desktop) {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('This packaging runtime requires Windows x64 Node.js.');
  const runtime = resolveElectronRuntime(from);
  try {
    return checkElectronRuntime(runtime);
  } catch (error) {
    if (error.code !== 'ELECTRON_RUNTIME_UNAVAILABLE') throw error;
    console.log(`Preparing Electron ${runtime.version} Windows x64 runtime with its official installer...`);
  }
  // Keep the package's pinned ZIP checksums and install into its current resolved directory.
  const result = spawnSync(process.execPath, [path.join(runtime.root, 'install.js')], {
    cwd: runtime.root, stdio: 'inherit', windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_INSTALL_PLATFORM: 'win32', ELECTRON_INSTALL_ARCH: 'x64',
      ELECTRON_OVERRIDE_DIST_PATH: '',
      electron_use_remote_checksums: '', npm_config_electron_use_remote_checksums: '',
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(`Electron runtime installation failed (${result.error?.message ?? result.signal ?? result.status}).`, { cause: result.error });
  return checkElectronRuntime(runtime);
}

module.exports = { resolveElectronRuntime, checkElectronRuntime, provisionElectronRuntime };
if (require.main === module) {
  try {
    const runtime = provisionElectronRuntime();
    console.log(`Electron ${runtime.version} Windows runtime verified: ${runtime.dist}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
