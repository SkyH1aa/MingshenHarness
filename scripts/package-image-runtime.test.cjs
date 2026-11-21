const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const YAML = require('yaml');
const { log } = require('builder-util');
const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher.js');
const { checkImageNotices, checkImageRuntime } = require('./check-package.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mingshen-image-runtime-'));
  t.after(() => {
    const target = fs.realpathSync(root);
    const local = path.relative(fs.realpathSync(os.tmpdir()), target);
    assert.ok(local && local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const sharp = path.join(root, 'node_modules', 'sharp');
  const native = path.join(root, 'node_modules', '@img', 'sharp-win32-x64');
  const appDirectory = path.join(root, 'apps', 'desktop');
  fs.mkdirSync(appDirectory, { recursive: true });
  fs.mkdirSync(path.join(sharp, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(native, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(sharp, 'package.json'), JSON.stringify({
    version: '0.35.5', dependencies: { '@img/colour': '1.1.0', 'detect-libc': '2.1.2', semver: '7.8.5' },
  }));
  fs.writeFileSync(path.join(sharp, 'dist', 'index.cjs'), 'fixture');
  const entries = new Map([
    ['sharp', path.join(sharp, 'dist', 'index.cjs')],
    ['@img/sharp-win32-x64/sharp.node', path.join(native, 'index.cjs')],
  ]);
  for (const dependency of ['@img/colour', 'detect-libc', 'semver']) {
    const entry = path.join(root, 'node_modules', dependency, 'index.cjs');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, 'fixture');
    entries.set(dependency, entry);
  }
  for (const name of ['index.cjs', 'lib/sharp-win32-x64-0.35.5.node', 'lib/libvips-42.dll', 'lib/libvips-cpp-8.18.7.dll'])
    fs.writeFileSync(path.join(native, name), 'fixture');
  fs.writeFileSync(path.join(native, 'package.json'), JSON.stringify({ version: '0.35.5' }));
  const installed = path.dirname(require.resolve('@img/sharp-win32-x64/sharp.node', { paths: [path.resolve(__dirname, '../apps/desktop')] }));
  for (const name of ['LICENSE', 'README.md']) fs.copyFileSync(path.join(installed, name), path.join(native, name));
  const resolveModule = name => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`Missing ${name}`);
    return entry;
  };
  return { root, native, appDirectory, entries, resolveModule };
}

function noticeFixture(t) {
  const f = fixture(t);
  const resources = path.join(f.root, 'resources');
  const packagedNative = path.join(resources, 'app.asar.unpacked', 'node_modules', '@img', 'sharp-win32-x64');
  const packagedReadme = path.join(resources, 'third-party-notices', 'sharp-win32-x64', 'workspace-README.md');
  fs.mkdirSync(packagedNative, { recursive: true });
  fs.mkdirSync(path.dirname(packagedReadme), { recursive: true });
  fs.copyFileSync(path.join(f.native, 'LICENSE'), path.join(packagedNative, 'LICENSE'));
  fs.copyFileSync(path.join(f.native, 'README.md'), packagedReadme);
  const options = {
    appDirectory: f.appDirectory,
    resources,
    resolvePackaged: () => path.join(packagedNative, 'index.cjs'),
  };
  return { ...f, options, packagedNative, packagedReadme };
}

test('checks unpacked image decoder and runtime dependency closure', t => {
  const f = fixture(t);
  assert.doesNotThrow(() => checkImageRuntime(f.resolveModule, f.root));
});

test('rejects missing native decoder and DLLs', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.native, 'lib', 'libvips-42.dll'));
  assert.throws(() => checkImageRuntime(f.resolveModule, f.root), /Missing sharp runtime/);
});

test('rejects dependencies resolved outside the packaged root', t => {
  const f = fixture(t);
  f.entries.set('semver', __filename);
  assert.throws(() => checkImageRuntime(f.resolveModule, f.root), /sharp dependency must be unpacked/);
});

test('checks pinned source notices, builder copy configuration and packaged copies', t => {
  const f = noticeFixture(t);
  assert.doesNotThrow(() => checkImageNotices(f.resolveModule, f.options));
  assert.throws(() => checkImageNotices(f.resolveModule, { ...f.options, config: { extraResources: [] } }), /copy configuration/);
});

test('supports app-local as well as workspace-hoisted native notice sources', t => {
  const f = fixture(t);
  const appNative = path.join(f.appDirectory, 'node_modules', '@img', 'sharp-win32-x64');
  fs.cpSync(f.native, appNative, { recursive: true });
  fs.unlinkSync(path.join(f.native, 'README.md'));
  f.entries.set('@img/sharp-win32-x64/sharp.node', path.join(appNative, 'index.cjs'));
  assert.doesNotThrow(() => checkImageNotices(f.resolveModule, { appDirectory: f.appDirectory }));
});

for (const layout of ['workspace', 'app-local']) {
  test(`electron-builder copies the ${layout} native notice before afterPack`, async t => {
    const f = noticeFixture(t);
    fs.unlinkSync(f.packagedReadme);
    if (layout === 'app-local') {
      const appNative = path.join(f.appDirectory, 'node_modules', '@img', 'sharp-win32-x64');
      fs.cpSync(f.native, appNative, { recursive: true });
      fs.unlinkSync(path.join(f.native, 'README.md'));
      f.entries.set('@img/sharp-win32-x64/sharp.node', path.join(appNative, 'index.cjs'));
    }
    const config = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../apps/desktop/electron-builder.yml'), 'utf8'));
    const noticeConfig = {
      extraResources: config.extraResources.filter(item => item.from?.includes('@img/sharp-win32-x64/README.md')),
    };
    const matchers = getFileMatchers(noticeConfig, 'extraResources', f.options.resources, {
      defaultSrc: f.appDirectory,
      globalOutDir: path.join(f.root, 'output'),
      macroExpander: value => value,
      customBuildOptions: {},
    });
    const stream = log.stream;
    let builderOutput = '';
    log.stream = { write: chunk => { builderOutput += String(chunk); return true; } };
    try {
      await copyFiles(matchers);
    } finally {
      log.stream = stream;
      if (builderOutput.trim()) t.diagnostic(builderOutput.trim());
    }
    assert.doesNotThrow(() => checkImageNotices(f.resolveModule, f.options));
  });
}

test('rejects missing or modified source notices', t => {
  const f = fixture(t);
  const readme = fs.readFileSync(path.join(f.native, 'README.md'));
  fs.writeFileSync(path.join(f.native, 'README.md'), 'modified');
  assert.throws(() => checkImageNotices(f.resolveModule, { appDirectory: f.appDirectory }), /source README.md hash mismatch/);
  fs.writeFileSync(path.join(f.native, 'README.md'), readme);
  fs.unlinkSync(path.join(f.native, 'LICENSE'));
  assert.throws(() => checkImageNotices(f.resolveModule, { appDirectory: f.appDirectory }), /Missing sharp source LICENSE/);
});

test('rejects missing or modified packaged notice copies and license', t => {
  const f = noticeFixture(t);
  fs.unlinkSync(f.packagedReadme);
  assert.throws(() => checkImageNotices(f.resolveModule, f.options), /Missing sharp packaged README/);
  fs.writeFileSync(f.packagedReadme, 'modified');
  assert.throws(() => checkImageNotices(f.resolveModule, f.options), /packaged README hash mismatch/);
  fs.copyFileSync(path.join(f.native, 'README.md'), f.packagedReadme);
  fs.writeFileSync(path.join(f.packagedNative, 'LICENSE'), 'modified');
  assert.throws(() => checkImageNotices(f.resolveModule, f.options), /packaged LICENSE hash mismatch/);
  fs.unlinkSync(path.join(f.packagedNative, 'LICENSE'));
  assert.throws(() => checkImageNotices(f.resolveModule, f.options), /Missing sharp packaged LICENSE/);
});
