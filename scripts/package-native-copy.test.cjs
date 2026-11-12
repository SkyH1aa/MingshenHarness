const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');
const { nativeCopyFor } = require('./package-native-copy.cjs');
const { packageCacheRoot } = require('./package-paths.cjs');

test('copies with the actual Windows file API and refuses a destination outside the build', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mingshen native copy '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.dll');
  const build = path.join(root, 'build');
  await mkdir(build);
  const destination = path.join(build, 'target file.dll');
  const content = Buffer.from('native Windows copy\0'.repeat(200));
  await writeFile(source, content);
  await nativeCopyFor(build)(source, destination);
  assert.deepEqual(await readFile(destination), content);
  await assert.rejects(nativeCopyFor(build)(source, path.join(root, 'outside.dll')), /Unsafe packaging path/);
});

test('recovers builder callback and promise copies only inside the private build directory', async t => {
  const cache = packageCacheRoot();
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, 'copy-compat-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.dll');
  await writeFile(source, 'compatibility fixture');
  const result = await promisify(execFile)(process.execPath, ['-e', `
    const fs = require('node:fs');
    const promises = require('node:fs/promises');
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const denied = () => Object.assign(new Error('fixture denial'), { code: 'EPERM' });
    fs.copyFile = (_source, _destination, flags, callback) => {
      if (typeof flags === 'function') callback = flags;
      callback(denied());
    };
    promises.copyFile = async () => { throw denied(); };
    require(process.argv[1]);
    (async () => {
      const root = process.env.MSH_PACKAGE_BUILD_ROOT;
      const source = path.join(root, 'source.dll');
      await promises.copyFile(source, path.join(root, 'promise.dll'));
      await new Promise((done, reject) => fs.copyFile(source, path.join(root, 'callback.dll'), error => error ? reject(error) : done()));
      await assert.rejects(promises.copyFile(source, path.join(path.dirname(root), 'outside.dll')), { code: 'EPERM' });
      console.log('Scoped builder copy fallback passed.');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, path.join(__dirname, 'package-copy-compat.cjs')], {
    env: { ...process.env, MSH_PACKAGE_BUILD_ROOT: root },
    windowsHide: true, timeout: 20_000,
  });
  assert.match(result.stdout, /Scoped builder copy fallback passed/);
  for (const name of ['promise.dll', 'callback.dll'])
    assert.equal(await readFile(path.join(root, name), 'utf8'), 'compatibility fixture');
});

test('moves the private staged runtime once with the Electron host first and verified contents', async t => {
  const cache = packageCacheRoot();
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, 'copy-order-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime');
  const output = path.join(root, 'output');
  await mkdir(runtime);
  await mkdir(output);
  for (const name of ['electron.exe', 'd3dcompiler_47.dll', 'vulkan-1.dll'])
    await writeFile(path.join(runtime, name), name);
  const result = await promisify(execFile)(process.execPath, ['-e', `
    const fs = require('node:fs/promises');
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const original = fs.rename.bind(fs);
    const order = [];
    fs.rename = async (source, destination) => {
      const name = path.basename(source);
      if (name.endsWith('.dll'))
        assert.equal(await fs.readFile(path.join(path.dirname(destination), 'electron.exe'), 'utf8'), 'electron.exe');
      await original(source, destination);
      order.push(name);
    };
    require(process.argv[1]);
    (async () => {
      const runtime = process.env.MSH_PACKAGE_ELECTRON_ROOT;
      const output = path.join(process.env.MSH_PACKAGE_BUILD_ROOT, 'output');
      await Promise.all(['d3dcompiler_47.dll', 'vulkan-1.dll', 'electron.exe'].map(name => fs.copyFile(path.join(runtime, name), path.join(output, name))));
      assert.equal(order[0], 'electron.exe');
      assert.equal(order.filter(name => name === 'electron.exe').length, 1);
      for(const name of ['electron.exe', 'd3dcompiler_47.dll', 'vulkan-1.dll']) {
        assert.equal(await fs.readFile(path.join(output, name), 'utf8'), name);
        await assert.rejects(fs.stat(path.join(runtime, name)), { code:'ENOENT' });
      }
      console.log('Executable-first staged runtime deployment passed.');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, path.join(__dirname, 'package-copy-compat.cjs')], {
    env: { ...process.env, MSH_PACKAGE_BUILD_ROOT: root, MSH_PACKAGE_ELECTRON_ROOT: runtime },
    windowsHide: true, timeout: 20_000,
  });
  assert.match(result.stdout, /Executable-first staged runtime deployment passed/);
});

test('falls back to verified copying when a private runtime move crosses volumes', async t => {
  const cache = packageCacheRoot();
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, 'runtime-move-fallback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'runtime');
  const output = path.join(root, 'output');
  await mkdir(runtime);
  await mkdir(output);
  for (const name of ['electron.exe', 'd3dcompiler_47.dll'])
    await writeFile(path.join(runtime, name), name);
  const result = await promisify(execFile)(process.execPath, ['-e', `
    const fs = require('node:fs/promises');
    const assert = require('node:assert/strict');
    const path = require('node:path');
    fs.rename = async () => { throw Object.assign(new Error('cross-volume fixture'), { code:'EXDEV' }); };
    require(process.argv[1]);
    (async () => {
      const runtime = process.env.MSH_PACKAGE_ELECTRON_ROOT;
      const output = path.join(process.env.MSH_PACKAGE_BUILD_ROOT, 'output');
      await fs.copyFile(path.join(runtime, 'd3dcompiler_47.dll'), path.join(output, 'd3dcompiler_47.dll'));
      for (const name of ['electron.exe', 'd3dcompiler_47.dll']) {
        assert.equal(await fs.readFile(path.join(output, name), 'utf8'), name);
        assert.equal(await fs.readFile(path.join(runtime, name), 'utf8'), name);
      }
      console.log('Runtime cross-volume fallback passed.');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, path.join(__dirname, 'package-copy-compat.cjs')], {
    env: { ...process.env, MSH_PACKAGE_BUILD_ROOT: root, MSH_PACKAGE_ELECTRON_ROOT: runtime },
    windowsHide: true, timeout: 20_000,
  });
  assert.match(result.stdout, /Runtime cross-volume fallback passed/);
});
