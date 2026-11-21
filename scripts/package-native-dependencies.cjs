const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Official node-pty 1.1.0 npm archive, verified against pnpm-lock.yaml's SHA-512.
const NODE_PTY_FILES = Object.freeze({
  'prebuilds/win32-x64/pty.node': 'ae323edd0835ee7b9e18cc96a7b2bb4b8173ff768317d178af2788406feb71ff',
  'prebuilds/win32-x64/conpty.node': 'ee8f4e6f4dad71939eecfda11de249400e34bfefe4c8b48af13f3b5476f4035b',
  'prebuilds/win32-x64/conpty_console_list.node': '879dd94cfc79f1e263a00077597ae9448a5394b7d193381aaa50d992a1f91090',
  'prebuilds/win32-x64/winpty.dll': 'e1cb26d868c954ba26817bedf3e4a5744e4ca2030adf51a7156e5ff2fadb881b',
  'prebuilds/win32-x64/winpty-agent.exe': '0c4834a0ab2a4f8c855a2f1db9b21fa6e5fc324ae8e3c82addd53d503d999825',
  'prebuilds/win32-x64/conpty/conpty.dll': '7c7430632052ff703540b68371ec43821820aa1335d8e11dfbcd9ff00e9daaed',
  'prebuilds/win32-x64/conpty/OpenConsole.exe': 'd1fe7faa62f9e955e2ac2371f95d7e5513df4d496255097158f979c94782c5fc',
});

function validateNodePty({ moduleRoot, platform = 'win32', arch = 'x64' }) {
  assert.equal(platform, 'win32', 'The verified node-pty payload targets Windows only.');
  assert.equal(arch, 'x64', 'The verified node-pty payload targets x64 only.');
  const metadata = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8'));
  assert.equal(metadata.name, 'node-pty', 'Unexpected terminal package.');
  assert.equal(metadata.version, '1.1.0', 'Recheck the official prebuilds before upgrading node-pty.');
  for (const [relative, expected] of Object.entries(NODE_PTY_FILES)) {
    const file = path.join(moduleRoot, relative);
    assert.ok(fs.statSync(file).isFile(), `Missing node-pty prebuild: ${relative}`);
    const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(actual, expected, `node-pty prebuild hash mismatch: ${relative}`);
  }
  // The upstream loader tries both directories before falling back to prebuilds.
  for (const prefix of ['', 'lib']) {
    for (const type of ['Release', 'Debug']) {
      for (const binding of ['pty.node', 'conpty.node', 'conpty_console_list.node']) {
        const candidate = path.join(moduleRoot, prefix, 'build', type, binding);
        assert.ok(!fs.existsSync(candidate), `A local node-pty build would override the verified prebuild: ${candidate}. Restore the locked package before packaging.`);
      }
    }
  }
  return { moduleRoot, version: metadata.version, files: Object.keys(NODE_PTY_FILES).length };
}

function findPackageRoot(entry, name) {
  let directory = path.dirname(entry);
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot resolve ${name} package root from ${entry}`);
    directory = parent;
  }
}

async function loadBuilderRebuilder(appDir) {
  const cli = require.resolve('electron-builder/cli.js', { paths: [appDir] });
  const builderEntry = createRequire(cli).resolve('./out/builder.js');
  const libraryEntry = createRequire(builderEntry).resolve('app-builder-lib');
  const libraryRoot = findPackageRoot(libraryEntry, 'app-builder-lib');
  const resolveBuilder = createRequire(path.join(libraryRoot, 'helpers/dynamic-import.js'));
  const entry = resolveBuilder.resolve('@electron/rebuild');
  const root = findPackageRoot(entry, '@electron/rebuild');
  // ModuleWalker is also used by the rebuilder; recheck its contract on upgrades.
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, '4.2.1', 'Recheck the native dependency policy after upgrading @electron/rebuild.');
  const { rebuild } = await import(pathToFileURL(entry).href);
  const { ModuleWalker } = await import(pathToFileURL(path.join(path.dirname(entry), 'module-walker.js')).href);
  assert.equal(typeof rebuild, 'function');
  assert.equal(typeof ModuleWalker, 'function');
  return {
    rebuild,
    async listModules(options) {
      const walker = new ModuleWalker(options.buildPath, options.projectRootPath, options.types, new Set(), null);
      await walker.walkModules();
      for (const directory of await walker.nodeModulesPaths) await walker.findAllModulesIn(directory);
      return walker.modulesToRebuild;
    },
  };
}

async function prepareNativeDependencies({
  appDir, workspaceRoot, electronVersion, platform = 'win32', arch = 'x64',
  rebuild, listModules, moduleRoot = path.dirname(require.resolve('node-pty/package.json', { paths: [appDir] })),
}) {
  assert.match(electronVersion, /^\d+\.\d+\.\d+$/, 'A verified Electron version is required.');
  const target = { platform, arch };
  validateNodePty({ moduleRoot, ...target });
  const api = rebuild ? { rebuild, listModules: listModules || (async () => [moduleRoot]) } : await loadBuilderRebuilder(appDir);
  const options = {
    buildPath: appDir, projectRootPath: workspaceRoot, electronVersion, ...target,
    types: ['prod', 'optional'], mode: 'sequential', disablePreGypCopy: true,
    buildFromSource: false, ignoreModules: ['node-pty'],
  };
  async function validatedTerminalRoots() {
    // ignoreModules matches directory names, including every installed instance.
    const roots = new Set([moduleRoot]);
    for (const directory of await (listModules || api.listModules)(options)) {
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      const parentName = path.basename(path.dirname(directory));
      const rebuildName = parentName === 'node_modules' ? path.basename(directory) : `${parentName}/${path.basename(directory)}`;
      if (metadata.name === 'node-pty')
        assert.equal(rebuildName, 'node-pty', `Unsupported node-pty installation layout: ${directory}`);
      if (rebuildName === 'node-pty') roots.add(directory);
    }
    for (const directory of roots) validateNodePty({ moduleRoot: directory, ...target });
    return [...roots].sort();
  }
  const terminalRoots = await validatedTerminalRoots();
  await api.rebuild(options);
  assert.deepEqual(await validatedTerminalRoots(), terminalRoots, 'node-pty installation changed during the native rebuild. Retry with no concurrent dependency installation.');
  return validateNodePty({ moduleRoot, ...target });
}

module.exports = { NODE_PTY_FILES, validateNodePty, prepareNativeDependencies };
