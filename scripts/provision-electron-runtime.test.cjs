const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  resolveElectronRuntime, checkElectronRuntime, provisionElectronRuntime,
} = require('./provision-electron-runtime.cjs');

const requiredFiles = [
  'electron.exe', 'd3dcompiler_47.dll', 'vulkan-1.dll', 'resources.pak',
  'icudtl.dat', 'locales/en-US.pak',
];
const windowsOnly = { skip: process.platform !== 'win32' || process.arch !== 'x64' };

function fixture(t, hoisted = true) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mingshen electron '));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), temporary);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const workspace = path.join(temporary, '\u8fc1\u79fb\u540e repo');
  const desktop = path.join(workspace, 'apps', 'desktop');
  const root = path.join(hoisted ? workspace : desktop, 'node_modules', 'electron');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(desktop, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'electron', version: '45.2.1' }));
  return { desktop, runtime: resolveElectronRuntime(desktop) };
}

function installFixture(runtime) {
  fs.mkdirSync(runtime.dist, { recursive: true });
  fs.writeFileSync(path.join(runtime.dist, 'version'), runtime.version);
  fs.writeFileSync(path.join(runtime.root, 'path.txt'), 'electron.exe');
  for (const name of requiredFiles) {
    fs.mkdirSync(path.dirname(path.join(runtime.dist, name)), { recursive: true });
    fs.writeFileSync(path.join(runtime.dist, name), 'runtime fixture');
  }
}

test('resolves both hoisted and app-local Electron from a relocated workspace with spaces and Unicode', t => {
  for (const hoisted of [true, false]) {
    const { desktop, runtime } = fixture(t, hoisted);
    assert.equal(runtime.root, path.join(hoisted ? path.resolve(desktop, '../..') : desktop, 'node_modules', 'electron'));
    assert.equal(runtime.executable, path.join(runtime.dist, 'electron.exe'));
    installFixture(runtime);
    assert.equal(checkElectronRuntime(runtime), runtime);
  }
});

test('preflight reports a missing runtime with a repair command and does not install it', t => {
  const { runtime } = fixture(t);
  assert.throws(() => checkElectronRuntime(runtime), error =>
    error.code === 'ELECTRON_RUNTIME_UNAVAILABLE' &&
    error.message.includes('node scripts/provision-electron-runtime.cjs') &&
    error.message.includes(runtime.dist));
  assert.equal(fs.existsSync(runtime.dist), false);
});

test('rejects stale versions, wrong platform registration and missing or empty companion files', t => {
  const { runtime } = fixture(t);
  installFixture(runtime);
  fs.writeFileSync(path.join(runtime.dist, 'version'), '1.0.0');
  assert.throws(() => checkElectronRuntime(runtime), { code: 'ELECTRON_RUNTIME_UNAVAILABLE' });
  installFixture(runtime);
  fs.writeFileSync(path.join(runtime.root, 'path.txt'), 'electron');
  assert.throws(() => checkElectronRuntime(runtime), { code: 'ELECTRON_RUNTIME_UNAVAILABLE' });
  installFixture(runtime);
  fs.unlinkSync(path.join(runtime.dist, 'vulkan-1.dll'));
  assert.throws(() => checkElectronRuntime(runtime), { code: 'ELECTRON_RUNTIME_UNAVAILABLE' });
  installFixture(runtime);
  fs.writeFileSync(path.join(runtime.dist, 'resources.pak'), '');
  assert.throws(() => checkElectronRuntime(runtime), { code: 'ELECTRON_RUNTIME_UNAVAILABLE' });
});

test('provisions through the resolved package installer and then reuses an intact runtime', windowsOnly, t => {
  const { desktop, runtime } = fixture(t);
  fs.writeFileSync(path.join(runtime.root, 'install.js'), `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    assert.equal(process.cwd(), __dirname);
    assert.equal(process.env.ELECTRON_INSTALL_PLATFORM, 'win32');
    assert.equal(process.env.ELECTRON_INSTALL_ARCH, 'x64');
    assert.equal(process.env.ELECTRON_OVERRIDE_DIST_PATH, '');
    assert.equal(process.env.electron_use_remote_checksums, '');
    assert.equal(process.env.npm_config_electron_use_remote_checksums, '');
    fs.writeFileSync(path.join(__dirname, 'path.txt'), 'electron.exe');
    for (const name of ${JSON.stringify([...requiredFiles, 'version'])}) {
      const file = path.join(__dirname, 'dist', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, name === 'version' ? '45.2.1' : 'runtime fixture');
    }
  `);
  assert.equal(provisionElectronRuntime(desktop).dist, runtime.dist);
  fs.writeFileSync(path.join(runtime.root, 'install.js'), 'process.exit(99)');
  assert.equal(provisionElectronRuntime(desktop).dist, runtime.dist);
});

test('stops on installer failure and on a successful installer that left files missing', windowsOnly, t => {
  const { desktop, runtime } = fixture(t);
  fs.writeFileSync(path.join(runtime.root, 'install.js'), 'process.exit(23)');
  assert.throws(() => provisionElectronRuntime(desktop), /installation failed \(23\)/);
  fs.writeFileSync(path.join(runtime.root, 'install.js'), 'process.exit(0)');
  assert.throws(() => provisionElectronRuntime(desktop), { code: 'ELECTRON_RUNTIME_UNAVAILABLE' });
});
