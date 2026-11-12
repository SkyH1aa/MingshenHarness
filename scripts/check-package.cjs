const assert = require('node:assert/strict');
const fs = require('node:fs');
const { builtinModules } = require('node:module');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TENCENT_MEMORY_RESOURCES, checkTencentMemoryResources } = require('./tencent-memory-package.cjs');
const { validateWindowsIcon } = require('./windows-icon.cjs');
const desktop = path.resolve(__dirname, '../apps/desktop');
const indexedLanguages = ['python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp'];
const authoringPackages = new Map([
  ['docx', '9.15.3'],
  ['pptxgenjs', '4.0.1'],
  ['@xmldom/xmldom', '0.8.15'],
  ['marked', null],
  ['katex', null],
]);
const documentSubpaths = ['.', './math', './html', './charts'];
function documentRuntimeExports(metadata) {
  const paths = new Set();
  function collect(value) {
    if (typeof value === 'string' && /\.(?:cjs|mjs|js)$/.test(value)) paths.add(value);
    else if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) if (key !== 'types') collect(item);
  }
  for (const subpath of documentSubpaths) {
    const entry = metadata.exports?.[subpath];
    assert.ok(entry, `Missing docx export: ${subpath}`);
    collect(entry);
  }
  assert.ok(paths.size >= documentSubpaths.length, 'Missing docx runtime exports');
  return [...paths];
}
const builtinNames = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));

function isRuntimeDependency(name) {
  return !name.startsWith('@types/') && !builtinNames.has(name);
}

function runtimeEntryCandidates(root, main) {
  const entry = path.resolve(root, main);
  return [entry, `${entry}.js`, `${entry}.cjs`, `${entry}.mjs`, path.join(entry, 'index.js')];
}

function packageRoot(resolveModule, name) {
  const entry = resolveModule(name);
  let current = path.dirname(entry);
  while (!fs.existsSync(path.join(current, 'package.json'))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot find package metadata for ${name}: ${entry}`);
    current = parent;
  }
  return current;
}

function checkAuthoringRuntime(resolveModule) {
  const pending = [...authoringPackages.keys()];
  const visited = new Set();
  while (pending.length) {
    const name = pending.shift();
    if (!name || visited.has(name) || !isRuntimeDependency(name)) continue;
    visited.add(name);
    const root = packageRoot(resolveModule, name);
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const expected = authoringPackages.get(name);
    if (expected) assert.equal(packageJson.version, expected, `Unexpected ${name} version`);
    if (name === 'docx') for (const entry of documentRuntimeExports(packageJson))
      assert.ok(fs.existsSync(path.resolve(root, entry)), `Missing docx runtime export: ${entry}`);
    const main = packageJson.main || packageJson.module;
    if (main) assert.ok(runtimeEntryCandidates(root, main).some(file => fs.existsSync(file)), `Missing ${name} runtime entry`);
    for (const dependency of Object.keys(packageJson.dependencies || {}))
      if (isRuntimeDependency(dependency)) pending.push(dependency);
    for (const dependency of Object.keys(packageJson.optionalDependencies || {}))
      if (isRuntimeDependency(dependency)) {
        try { packageRoot(resolveModule, dependency); pending.push(dependency); } catch {}
      }
  }
  assert.ok(visited.has('docx') && visited.has('pptxgenjs'), 'Document authoring packages are not installed');
  return visited;
}

function packagedFileReader(archive, unpacked, files, asar) {
  return relative => {
    const normalized = relative.replaceAll('\\', '/').replace(/^\/+/, '');
    if (files.has(normalized)) {
      try { return asar.extractFile(archive, path.normalize(normalized)); } catch {}
    }
    const physical = path.join(unpacked, normalized);
    if (fs.existsSync(physical)) return fs.readFileSync(physical);
    return null;
  };
}

function packagedPackagePath(readFile, name, entries, from = 'node_modules') {
  let current = from;
  while (true) {
    const modules = current === 'node_modules' || current.endsWith('/node_modules')
      ? current : path.posix.join(current, 'node_modules');
    const candidate = path.posix.join(modules, name, 'package.json');
    if (readFile(candidate)) return candidate.slice(0, -'/package.json'.length);
    if (current === '') break;
    const parent = path.posix.dirname(current);
    current = parent === '.' || parent === current ? '' : parent;
  }
  const suffix = `/node_modules/${name}/package.json`;
  const fallback = [...entries]
    .filter(entry => entry.endsWith(suffix))
    .sort((a, b) => a.length - b.length)[0];
  return fallback ? fallback.slice(0, -'/package.json'.length) : null;
}

function checkPackagedAuthoringRuntime(archive, unpacked, files, asar) {
  const readFile = packagedFileReader(archive, unpacked, files, asar);
  const pending = [...authoringPackages.keys()].map(name => ({ name, from: 'node_modules' }));
  const visited = new Set();
  while (pending.length) {
    const item = pending.shift();
    const name = item?.name;
    if (!name || visited.has(name) || !isRuntimeDependency(name)) continue;
    visited.add(name);
    const packagePath = packagedPackagePath(readFile, name, files, item.from);
    assert.ok(packagePath, `Missing packaged document dependency: ${name}`);
    const packageJson = JSON.parse(readFile(`${packagePath}/package.json`).toString('utf8'));
    const expected = authoringPackages.get(name);
    if (expected) assert.equal(packageJson.version, expected, `Unexpected packaged ${name} version`);
    if (name === 'docx') for (const entry of documentRuntimeExports(packageJson))
      assert.ok(readFile(path.posix.join(packagePath, entry)), `Missing packaged docx runtime export: ${entry}`);
    const main = packageJson.main || packageJson.module;
    if (main) {
      const entry = path.posix.join(packagePath, main);
      const candidates = [entry, `${entry}.js`, `${entry}.cjs`, `${entry}.mjs`, `${entry}/index.js`];
      assert.ok(candidates.some(file => readFile(file)), `Missing packaged ${name} runtime entry`);
    }
    for (const dependency of Object.keys(packageJson.dependencies || {}))
      if (isRuntimeDependency(dependency)) pending.push({ name: dependency, from: packagePath });
    for (const dependency of Object.keys(packageJson.optionalDependencies || {}))
      if (isRuntimeDependency(dependency)) pending.push({ name: dependency, from: packagePath });
  }
  assert.ok(visited.has('docx') && visited.has('pptxgenjs'), 'Packaged document authoring packages are missing');
  return visited;
}

function checkDocumentRuntime(resolveModule, unpackedRoot) {
  const binding = resolveModule('@napi-rs/canvas-win32-x64-msvc');
  assert.ok(fs.statSync(binding).size > 0, 'Missing Windows canvas binding');
  if (unpackedRoot) assert.ok(binding.startsWith(unpackedRoot), 'Canvas binding must be unpacked');
  for (const name of ['eng', 'chi_sim']) {
    const file = resolveModule(`@tesseract.js-data/${name}/4.0.0_best_int/${name}.traineddata.gz`);
    assert.ok(fs.statSync(file).size > 100000, `Missing offline OCR language: ${name}`);
    if (unpackedRoot) assert.ok(file.startsWith(unpackedRoot), 'OCR languages must be unpacked');
  }
  for (const name of ['tesseract.js/src/worker-script/node/index.js', 'tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm']) {
    const file = resolveModule(name);
    assert.ok(fs.statSync(file).size > 0, `Missing OCR runtime: ${name}`);
    if (unpackedRoot) assert.ok(file.startsWith(unpackedRoot), 'OCR workers and WASM must be unpacked');
  }
}
function checkParsers(resolveModule, unpackedRoot) {
  const native = resolveModule('@ast-grep/napi-win32-x64-msvc');
  assert.ok(fs.existsSync(native), 'Missing Windows x64 AST native binding');
  if (unpackedRoot) assert.ok(native.startsWith(unpackedRoot), 'AST native binding must be unpacked');
  for (const language of indexedLanguages) {
    const entry = resolveModule(`@ast-grep/lang-${language}`);
    const parser = path.join(path.dirname(entry), 'prebuilds', 'prebuild-Windows-X64', 'parser.so');
    assert.ok(fs.existsSync(parser) && fs.statSync(parser).size > 0, `Missing ${language} Windows parser: ${parser}`);
    if (unpackedRoot) assert.ok(parser.startsWith(unpackedRoot), 'Dynamic parsers must be unpacked');
  }
}
const required = [
  ...TENCENT_MEMORY_RESOURCES.map(file => `tencentdb-memory/${file}`),
  'documents/document-worker.cjs',
  'native/codex-sandbox.exe', 'native/LICENSE', 'native/NOTICE',
  'prompts/runtime.md', 'prompts/compaction.md', 'docs/USER_GUIDE.md', 'docs/USER_GUIDE.en.md',
  'docs/CHANGELOG.md', 'docs/CHANGELOG.en.md',
  'docs/TERMS_OF_SERVICE.md', 'docs/TERMS_OF_SERVICE.en.md',
  'docs/PRIVACY_POLICY.md', 'docs/PRIVACY_POLICY.en.md',
  'docs/DISCLAIMER.md', 'docs/DISCLAIMER.en.md',
  'lsp/typescript/lib/tsserver.js', 'lsp/typescript/lib/typescript.js', 'lsp/typescript-language-server/lib/cli.mjs',
  'sdk/mingshen-client.mjs', 'sdk/mingshen-acp.mjs', 'icon.png', 'icon.ico', 'THIRD_PARTY_NOTICES.md',
];
function sourcePath(item) {
  if (item.startsWith('docs/')) return path.resolve(desktop, '../..', item);
  if (item === 'THIRD_PARTY_NOTICES.md') return path.resolve(desktop, '../..', item);
  if (item.startsWith('icon.')) return path.join(desktop, 'build', item);
  return path.join(desktop, 'resources', item);
}
function check(root) {
  const version = require(path.join(desktop, 'package.json')).version;
  for (const item of required) {
    const file = root ? path.join(root, item) : sourcePath(item);
    assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0, `Missing package resource: ${file}`);
    if (item.startsWith('docs/'))
      assert.ok(fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 5).join('\n').includes(version), `Stale embedded document version: ${item}`);
  }
  const native = root ? path.join(root, 'native/codex-sandbox.exe') : sourcePath('native/codex-sandbox.exe');
  assert.equal(createHash('sha256').update(fs.readFileSync(native)).digest('hex'), '9d563ee4e0441ff9d59d612013e0460ddf8e5709735c2d9f6b98b7ef8ca4eb42', 'Native runtime integrity');
  const icon = fs.readFileSync(root ? path.join(root, 'icon.ico') : sourcePath('icon.ico'));
  assert.ok(validateWindowsIcon(icon) >= 6, 'Missing Windows icon sizes');
  checkTencentMemoryResources(
    root ? path.join(root, 'tencentdb-memory') : path.join(desktop, 'resources/tencentdb-memory'),
    { vendor: path.resolve(desktop, '../../third_party/tencentdb-agent-memory') },
  );
}
module.exports = async context => {
  const resources = path.join(context.appOutDir, 'resources');
  check(resources);
  for (const file of ['MingshenHarnessExperimental.exe', 'MingshenHarnessExperimental.exe.json'])
    assert.ok(!fs.existsSync(path.join(context.appOutDir, file)), 'Experimental files must not be shipped.');
  assert.ok(!fs.existsSync(path.join(resources, 'default_app.asar')), 'Electron sample application must not be shipped.');
  const builderEntry = require.resolve('app-builder-lib', { paths: [path.dirname(require.resolve('electron-builder', { paths: [desktop] }))] });
  const asar = require(require.resolve('@electron/asar', { paths: [path.dirname(builderEntry)] }));
  const archive = path.join(resources, 'app.asar');
  const files = new Set(asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, '')));
  assert.ok(![...files].some(file => /(?:^|\/)mingshen\.db(?:-(?:wal|shm))?$/i.test(file)), 'User database and consent records must not be shipped.');
  assert.ok(![...files].some(file => /(?:^|\/)logs\/runtime(?:\.\d+)?\.jsonl$/i.test(file)), 'Private runtime logs must not be shipped.');
  for (const entry of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html', 'node_modules/browserdo-mcp/dist/index.js'])
    assert.ok(files.has(entry), `Missing packaged application file: ${entry}`);
  const unpacked = path.join(resources, 'app.asar.unpacked');
  checkParsers(name => require.resolve(name, {paths:[unpacked]}), unpacked);
  checkDocumentRuntime(name => require.resolve(name, {paths:[unpacked]}), unpacked);
  checkPackagedAuthoringRuntime(archive, unpacked, files, asar);
  console.log('Packaged application resource validation passed.');
};
if (require.main === module) {
  check(null);
  const pkg = require(path.join(desktop, 'package.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(require(path.resolve(desktop, '../../package.json')).version, pkg.version, 'Workspace version mismatch');
  assert.ok(fs.readFileSync(path.join(desktop, 'src/shared/release.ts'), 'utf8').includes(`APP_VERSION = "${pkg.version}"`), 'Application version mismatch');
  for (const dependency of Object.keys(pkg.dependencies))
    assert.ok([desktop, path.resolve(desktop, '../..')].some(root => fs.existsSync(path.join(root, 'node_modules', dependency, 'package.json'))), `Missing dependency: ${dependency}`);
  checkParsers(name => require.resolve(name, {paths:[desktop]}));
  checkDocumentRuntime(name => require.resolve(name, {paths:[desktop]}));
  checkAuthoringRuntime(name => require.resolve(name, {paths:[desktop]}));
  console.log(`Packaging preflight passed: ${required.length} resources, production dependencies and version ${pkg.version}.`);
}

module.exports.checkAuthoringRuntime = checkAuthoringRuntime;
module.exports.checkPackagedAuthoringRuntime = checkPackagedAuthoringRuntime;
