const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  NODE_PTY_FILES,
  prepareNativeDependencies,
  validateNodePty,
} = require('./package-native-dependencies.cjs');

// These digests were checked against the locked node-pty 1.1.0 npm tarball.
const expectedFiles = {
  'prebuilds/win32-x64/pty.node': 'ae323edd0835ee7b9e18cc96a7b2bb4b8173ff768317d178af2788406feb71ff',
  'prebuilds/win32-x64/conpty.node': 'ee8f4e6f4dad71939eecfda11de249400e34bfefe4c8b48af13f3b5476f4035b',
  'prebuilds/win32-x64/conpty_console_list.node': '879dd94cfc79f1e263a00077597ae9448a5394b7d193381aaa50d992a1f91090',
  'prebuilds/win32-x64/winpty.dll': 'e1cb26d868c954ba26817bedf3e4a5744e4ca2030adf51a7156e5ff2fadb881b',
  'prebuilds/win32-x64/winpty-agent.exe': '0c4834a0ab2a4f8c855a2f1db9b21fa6e5fc324ae8e3c82addd53d503d999825',
  'prebuilds/win32-x64/conpty/conpty.dll': '7c7430632052ff703540b68371ec43821820aa1335d8e11dfbcd9ff00e9daaed',
  'prebuilds/win32-x64/conpty/OpenConsole.exe': 'd1fe7faa62f9e955e2ac2371f95d7e5513df4d496255097158f979c94782c5fc',
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msh-pty-package-test-'));
  t.after(() => {
    const target = fs.realpathSync(root);
    const local = path.relative(fs.realpathSync(os.tmpdir()), target);
    assert.ok(local && local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const appDir = path.join(root, 'apps', 'desktop');
  const moduleRoot = path.join(root, 'node_modules', 'node-pty');
  const installed = path.dirname(require.resolve('node-pty/package.json', {
    paths: [path.resolve(__dirname, '../apps/desktop')],
  }));
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.copyFileSync(path.join(installed, 'package.json'), path.join(moduleRoot, 'package.json'));
  for (const name of Object.keys(expectedFiles)) {
    const target = path.join(moduleRoot, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(installed, name), target);
  }
  return { root, appDir, moduleRoot, electronVersion: '45.2.1' };
}

function prepareOptions(f, rebuild) {
  return {
    appDir: f.appDir,
    workspaceRoot: f.root,
    moduleRoot: f.moduleRoot,
    electronVersion: f.electronVersion,
    platform: 'win32',
    arch: 'x64',
    rebuild,
  };
}

test('checks the exact official Windows x64 PTY payload', t => {
  const f = fixture(t);
  assert.deepEqual(NODE_PTY_FILES, expectedFiles);
  for (const [name, expected] of Object.entries(expectedFiles)) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(f.moduleRoot, name))).digest('hex');
    assert.equal(actual, expected, name);
  }
  assert.deepEqual(validateNodePty({ moduleRoot: f.moduleRoot }), {
    moduleRoot: f.moduleRoot, version: '1.1.0', files: 7,
  });
});

test('rejects every missing or modified official PTY binary', t => {
  const f = fixture(t);
  for (const name of Object.keys(expectedFiles)) {
    const file = path.join(f.moduleRoot, name);
    const original = fs.readFileSync(file);
    fs.unlinkSync(file);
    assert.throws(() => validateNodePty({ moduleRoot: f.moduleRoot }), `missing ${name}`);
    fs.writeFileSync(file, Buffer.from('modified fixture'));
    assert.throws(() => validateNodePty({ moduleRoot: f.moduleRoot }), `modified ${name}`);
    fs.writeFileSync(file, original);
  }
  assert.equal(validateNodePty({ moduleRoot: f.moduleRoot }).files, 7);
});

test('rejects unknown versions and targets before rebuilding', async t => {
  const f = fixture(t);
  const packageFile = path.join(f.moduleRoot, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  let calls = 0;
  const rebuild = async () => { calls += 1; };
  fs.writeFileSync(packageFile, JSON.stringify({ ...metadata, version: '1.2.0' }));
  await assert.rejects(prepareNativeDependencies(prepareOptions(f, rebuild)));
  fs.writeFileSync(packageFile, JSON.stringify(metadata));
  for (const target of [
    { platform: 'linux', arch: 'x64' },
    { platform: 'win32', arch: 'arm64' },
    { platform: 'darwin', arch: 'x64' },
  ]) {
    assert.throws(() => validateNodePty({ moduleRoot: f.moduleRoot, ...target }));
    await assert.rejects(prepareNativeDependencies({ ...prepareOptions(f, rebuild), ...target }));
  }
  assert.equal(calls, 0);
});

test('rejects stale higher-priority PTY bindings without changing them', async t => {
  const f = fixture(t);
  let calls = 0;
  const rebuild = async () => { calls += 1; };
  for (const prefix of ['', 'lib']) {
    for (const buildType of ['Release', 'Debug']) {
      for (const binding of ['pty.node', 'conpty.node', 'conpty_console_list.node']) {
        const file = path.join(f.moduleRoot, prefix, 'build', buildType, binding);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'older fixture binding');
        assert.throws(() => validateNodePty({ moduleRoot: f.moduleRoot }), `${prefix}/${buildType}/${binding}`);
        await assert.rejects(prepareNativeDependencies(prepareOptions(f, rebuild)));
        assert.equal(fs.readFileSync(file, 'utf8'), 'older fixture binding');
        fs.unlinkSync(file);
      }
    }
  }
  assert.equal(calls, 0);
  assert.equal(validateNodePty({ moduleRoot: f.moduleRoot }).files, 7);
});

test('rebuilds other production dependencies while ignoring only node-pty', async t => {
  const f = fixture(t);
  const calls = [];
  const result = await prepareNativeDependencies(prepareOptions(f, async options => { calls.push(options); }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].buildPath, f.appDir);
  assert.equal(calls[0].projectRootPath, f.root);
  assert.equal(calls[0].electronVersion, f.electronVersion);
  assert.equal(calls[0].platform, 'win32');
  assert.equal(calls[0].arch, 'x64');
  assert.equal(calls[0].mode, 'sequential');
  assert.equal(calls[0].disablePreGypCopy, true);
  assert.equal(calls[0].buildFromSource, false);
  assert.deepEqual(calls[0].types, ['prod', 'optional']);
  assert.deepEqual(calls[0].ignoreModules, ['node-pty']);
  assert.ok(calls[0].onlyModules == null, 'other dependencies must not be restricted');
  assert.deepEqual(result, { moduleRoot: f.moduleRoot, version: '1.1.0', files: 7 });
});

test('validates every discovered node-pty copy and leaves other modules in the rebuild scope', async t => {
  const f = fixture(t);
  const otherPty = path.join(f.root, 'vendor', 'node_modules', 'node-pty');
  fs.cpSync(f.moduleRoot, otherPty, { recursive: true });
  const discovered = [f.moduleRoot, otherPty];
  for (const name of ['sharp', '@napi-rs/canvas', '@ast-grep/napi']) {
    const directory = path.join(f.root, 'vendor', 'node_modules', ...name.split('/'));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    discovered.push(directory);
  }
  const listModules = async () => discovered;
  const rebuilt = [];
  const rebuild = async options => {
    assert.deepEqual(options.ignoreModules, ['node-pty']);
    assert.ok(options.onlyModules == null);
    for (const directory of discovered) {
      const parent = path.basename(path.dirname(directory));
      const name = parent === 'node_modules' ? path.basename(directory) : `${parent}/${path.basename(directory)}`;
      if (!options.ignoreModules.includes(name)) rebuilt.push(name);
    }
  };
  await prepareNativeDependencies({ ...prepareOptions(f, rebuild), listModules });
  assert.deepEqual(rebuilt, ['sharp', '@napi-rs/canvas', '@ast-grep/napi']);

  const manifest = path.join(otherPty, 'package.json');
  const original = fs.readFileSync(manifest);
  const metadata = JSON.parse(original.toString());
  fs.writeFileSync(manifest, JSON.stringify({ ...metadata, version: '1.2.0' }));
  let invalidRebuildCalls = 0;
  const invalidRebuild = async () => { invalidRebuildCalls += 1; };
  await assert.rejects(prepareNativeDependencies({ ...prepareOptions(f, invalidRebuild), listModules }));
  fs.writeFileSync(manifest, original);
  const binary = path.join(otherPty, 'prebuilds', 'win32-x64', 'conpty.node');
  const originalBinary = fs.readFileSync(binary);
  fs.writeFileSync(binary, 'modified secondary payload');
  await assert.rejects(prepareNativeDependencies({ ...prepareOptions(f, invalidRebuild), listModules }));
  assert.equal(invalidRebuildCalls, 0);
  fs.writeFileSync(binary, originalBinary);

  await assert.rejects(prepareNativeDependencies({
    ...prepareOptions(f, async () => { fs.writeFileSync(binary, 'modified after validation'); }),
    listModules,
  }));
});

test('rejects mismatched manifest and rebuilder directory names before rebuilding', async t => {
  const f = fixture(t);
  let calls = 0;
  const rebuild = async () => { calls += 1; };
  const misplaced = path.join(f.root, 'vendor', 'node-pty');
  fs.cpSync(f.moduleRoot, misplaced, { recursive: true });
  await assert.rejects(prepareNativeDependencies({
    ...prepareOptions(f, rebuild), listModules: async () => [misplaced],
  }));

  const aliased = path.join(f.root, 'alias', 'node_modules', 'node-pty');
  fs.cpSync(f.moduleRoot, aliased, { recursive: true });
  const manifest = path.join(aliased, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  fs.writeFileSync(manifest, JSON.stringify({ ...metadata, name: 'unexpected-package' }));
  await assert.rejects(prepareNativeDependencies({
    ...prepareOptions(f, rebuild), listModules: async () => [aliased],
  }));
  assert.equal(calls, 0);
});

test('rejects newly discovered PTY copies after rebuilding, including a damaged copy', async t => {
  const f = fixture(t);
  const added = path.join(f.root, 'vendor', 'node_modules', 'node-pty');
  fs.cpSync(f.moduleRoot, added, { recursive: true });
  let rebuilt = false;
  let scans = 0;
  const rebuild = async () => { rebuilt = true; };
  const listModules = async () => {
    scans += 1;
    return rebuilt ? [f.moduleRoot, added] : [f.moduleRoot];
  };
  await assert.rejects(
    prepareNativeDependencies({ ...prepareOptions(f, rebuild), listModules }),
    /node-pty installation changed during the native rebuild/,
  );
  assert.equal(rebuilt, true);
  assert.equal(scans, 2);

  rebuilt = false;
  scans = 0;
  fs.writeFileSync(path.join(added, 'prebuilds', 'win32-x64', 'conpty.node'), 'damaged new copy');
  await assert.rejects(
    prepareNativeDependencies({ ...prepareOptions(f, rebuild), listModules }),
    /node-pty prebuild hash mismatch/,
  );
  assert.equal(rebuilt, true);
  assert.equal(scans, 2);
});

test('propagates a rebuild failure before packaging can continue', async t => {
  const f = fixture(t);
  const failure = new Error('simulated rebuild failure');
  let continued = false;
  await assert.rejects(async () => {
    await prepareNativeDependencies(prepareOptions(f, async () => { throw failure; }));
    continued = true;
  }, failure);
  assert.equal(continued, false);
});

test('revalidates the PTY payload and load precedence after rebuilding', async t => {
  const f = fixture(t);
  const target = path.join(f.moduleRoot, 'prebuilds', 'win32-x64', 'conpty.node');
  const original = fs.readFileSync(target);
  await assert.rejects(prepareNativeDependencies(prepareOptions(f, async () => {
    fs.writeFileSync(target, 'modified during rebuild');
  })));
  fs.writeFileSync(target, original);
  await assert.rejects(prepareNativeDependencies(prepareOptions(f, async () => {
    const stale = path.join(f.moduleRoot, 'build', 'Release', 'conpty.node');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, 'unexpected binding');
  })));
});
