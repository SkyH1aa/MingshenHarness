const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { isBuiltin } = require('node:module');
const path = require('node:path');

const TENCENT_MEMORY_VERSION = '2.0.3';
const TENCENT_MEMORY_COMMIT = '084bed45cad6bb7f877455082cee82835d65671a';
const TENCENT_MEMORY_LICENSE_HASH = 'c3b1edc3da9748a53c8c7743b358f4bf4fd6cf7129f835934ac255b0ebae6097';
const TENCENT_MEMORY_ENTRIES = [
  'upstream/memory-store.js',
  'upstream/l1-extractor.js',
  'upstream/l1-writer.js',
  'upstream/memory-search.js',
];
const TENCENT_MEMORY_RESOURCES = [
  'LICENSE', 'NOTICE.md', 'package.json', 'upstream.json', 'runtime.json',
  ...TENCENT_MEMORY_ENTRIES,
];

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Linked TencentDB resource is not allowed: ${target}`);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

function fileHash(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function manifestPath(root, relative) {
  assert.ok(
    typeof relative === 'string' && relative && !relative.includes('\\') &&
    !relative.split('/').some(part => !part || part === '.' || part === '..') &&
    !path.isAbsolute(relative) && !relative.includes(':'),
    `Unsafe TencentDB manifest path: ${relative}`,
  );
  const target = path.resolve(root, relative);
  const local = path.relative(path.resolve(root), target);
  assert.ok(local && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local),
    `Unsafe TencentDB manifest path: ${relative}`);
  return target;
}

function readManifest(file, label) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(value?.version, TENCENT_MEMORY_VERSION, `${label} version mismatch`);
  assert.equal(value?.commit, TENCENT_MEMORY_COMMIT, `${label} commit mismatch`);
  assert.ok(value.files && typeof value.files === 'object' && !Array.isArray(value.files) &&
    Object.keys(value.files).length > 0, `${label} has no file hashes`);
  for (const hash of Object.values(value.files))
    assert.match(hash, /^[a-f0-9]{64}$/, `${label} contains an invalid SHA-256`);
  return value;
}

function verifyTencentMemorySources(vendor) {
  const manifest = readManifest(path.join(vendor, 'upstream.json'), 'TencentDB source manifest');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = manifestPath(path.join(vendor, 'src'), relative);
    assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing TencentDB source: ${relative}`);
    assert.equal(fileHash(file), expected, `TencentDB source integrity mismatch: ${relative}`);
  }
  const actual = filesUnder(path.join(vendor, 'src')).map(file =>
    path.relative(path.join(vendor, 'src'), file).replaceAll(path.sep, '/')).sort();
  assert.deepEqual(actual, Object.keys(manifest.files).sort(), 'TencentDB source manifest is incomplete');
  assert.equal(fileHash(path.join(vendor, 'LICENSE')), TENCENT_MEMORY_LICENSE_HASH, 'TencentDB MIT license integrity');
  return manifest;
}

function createTencentMemoryRuntimeManifest(root) {
  return {
    version: TENCENT_MEMORY_VERSION,
    commit: TENCENT_MEMORY_COMMIT,
    files: Object.fromEntries(filesUnder(root)
      .filter(file => path.relative(root, file) !== 'runtime.json')
      .map(file => [path.relative(root, file).replaceAll(path.sep, '/'), fileHash(file)])
      .sort(([left], [right]) => left.localeCompare(right))),
  };
}

let lexer;
function moduleImports(source, name) {
  if (!lexer) {
    const desktop = path.resolve(__dirname, '../apps/desktop');
    const toolchain = path.dirname(require.resolve('vitest', { paths: [desktop] }));
    lexer = require(require.resolve('es-module-lexer', { paths: [toolchain] }));
    lexer.initSync();
  }
  return lexer.parse(source, name)[0];
}

function checkTencentMemoryResources(root, { vendor } = {}) {
  for (const relative of TENCENT_MEMORY_RESOURCES) {
    const file = path.join(root, relative);
    assert.ok(fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0,
      `Missing TencentDB memory resource: ${relative}`);
  }
  assert.equal(fileHash(path.join(root, 'LICENSE')), TENCENT_MEMORY_LICENSE_HASH, 'TencentDB MIT license integrity');
  const sourceManifest = readManifest(path.join(root, 'upstream.json'), 'TencentDB source manifest');
  const runtimeManifest = readManifest(path.join(root, 'runtime.json'), 'TencentDB runtime manifest');
  const expectedFiles = Object.keys(runtimeManifest.files).sort();
  const actualFiles = filesUnder(root)
    .map(file => path.relative(root, file).replaceAll(path.sep, '/'))
    .filter(file => file !== 'runtime.json').sort();
  assert.deepEqual(actualFiles, expectedFiles, 'TencentDB runtime manifest is incomplete');
  for (const [relative, expected] of Object.entries(runtimeManifest.files)) {
    assert.ok(
      ['LICENSE', 'NOTICE.md', 'package.json', 'upstream.json'].includes(relative) ||
      (relative.startsWith('upstream/') && relative.endsWith('.js')),
      `Unexpected TencentDB runtime resource: ${relative}`,
    );
    assert.equal(fileHash(manifestPath(root, relative)), expected,
      `TencentDB runtime integrity mismatch: ${relative}`);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.type, 'module', 'TencentDB runtime requires ESM package metadata');
  assert.equal(packageJson.private, true, 'TencentDB runtime must be private');
  assert.ok(!packageJson.scripts, 'TencentDB runtime must not include install hooks');
  const jsFiles = actualFiles.filter(file => file.endsWith('.js'));
  const available = new Set(jsFiles);
  for (const relative of jsFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.ok(!/EXTRACT_WORK_MEMORIES_SYSTEM_PROMPT|WORK_CONFLICT_DETECTION_SYSTEM_PROMPT|\u5b89\u706f|\u56e2\u961f\u5171\u4eab\u8bb0\u5fc6\u63d0\u53d6\u4e13\u5bb6|\u56e2\u961f\u5de5\u4f5c\u8bb0\u5fc6\u51b2\u7a81\u68c0\u6d4b\u5668/.test(source),
      `TencentDB business prompt must not be bundled: ${relative}`);
    for (const imported of moduleImports(source, relative)) {
      if (imported.d === -2) continue; // import.meta is metadata, not a dependency.
      const specifier = imported.n;
      assert.equal(typeof specifier, 'string', `Nonliteral TencentDB import: ${relative}`);
      if (specifier.startsWith('node:')) {
        assert.ok(isBuiltin(specifier), `Unknown TencentDB builtin import: ${specifier}`);
        continue;
      }
      assert.ok(specifier.startsWith('./') || specifier.startsWith('../'),
        `External TencentDB runtime import: ${relative}: ${specifier}`);
      const target = path.resolve(root, path.dirname(relative), specifier);
      const local = path.relative(root, target).replaceAll(path.sep, '/');
      assert.ok(local.startsWith('upstream/') && available.has(local),
        `Missing TencentDB ESM dependency: ${relative}: ${specifier}`);
    }
  }
  if (vendor) {
    const original = verifyTencentMemorySources(vendor);
    assert.deepEqual(sourceManifest, original, 'TencentDB packaged source manifest differs from verified sources');
    for (const name of ['LICENSE', 'NOTICE.md'])
      assert.equal(fileHash(path.join(root, name)), fileHash(path.join(vendor, name)),
        `TencentDB packaged notice differs from source: ${name}`);
  }
  return { files: actualFiles.length + 1, modules: jsFiles.length };
}

module.exports = {
  TENCENT_MEMORY_VERSION, TENCENT_MEMORY_COMMIT, TENCENT_MEMORY_RESOURCES,
  verifyTencentMemorySources, createTencentMemoryRuntimeManifest, checkTencentMemoryResources,
};
