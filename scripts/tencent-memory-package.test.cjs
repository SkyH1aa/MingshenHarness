const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  TENCENT_MEMORY_VERSION, TENCENT_MEMORY_COMMIT, TENCENT_MEMORY_RESOURCES,
  verifyTencentMemorySources, createTencentMemoryRuntimeManifest, checkTencentMemoryResources,
} = require('./tencent-memory-package.cjs');

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mingshen-memory-package-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), temporary);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const root = path.join(temporary, 'tencentdb-memory');
  fs.mkdirSync(path.join(root, 'upstream'), { recursive: true });
  const original = path.resolve(__dirname, '../third_party/tencentdb-agent-memory');
  for (const name of ['LICENSE', 'NOTICE.md'])
    fs.copyFileSync(path.join(original, name), path.join(root, name));
  writeJson(path.join(root, 'package.json'), { type: 'module', private: true });
  writeJson(path.join(root, 'upstream.json'), {
    version: TENCENT_MEMORY_VERSION,
    commit: TENCENT_MEMORY_COMMIT,
    files: { 'core/sample.ts': 'a'.repeat(64) },
  });
  for (const name of TENCENT_MEMORY_RESOURCES.filter(file => file.endsWith('.js')))
    fs.writeFileSync(path.join(root, name), 'export { value } from "./chunk-fixture.js";\n');
  fs.writeFileSync(path.join(root, 'upstream/chunk-fixture.js'),
    'import { createHash } from "node:crypto";\nexport const value = createHash;\n');
  const refresh = () => writeJson(path.join(root, 'runtime.json'), createTencentMemoryRuntimeManifest(root));
  refresh();
  return { root, refresh };
}

test('checks complete local ESM resources and hashes without importing or executing the core', t => {
  const f = fixture(t);
  assert.deepEqual(checkTencentMemoryResources(f.root), { files: 10, modules: 5 });
});

for (const missing of [
  'upstream/l1-extractor.js', 'LICENSE', 'upstream.json', 'runtime.json',
]) {
  test(`rejects missing TencentDB resource: ${missing}`, t => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.root, missing));
    assert.throws(() => checkTencentMemoryResources(f.root), /Missing TencentDB memory resource/);
  });
}

test('rejects missing shared chunks even when the remaining runtime manifest was regenerated', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'upstream/chunk-fixture.js'));
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /Missing TencentDB ESM dependency/);
});

test('rejects altered runtime bytes against their build manifest', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, 'upstream/chunk-fixture.js'), '// altered\n');
  assert.throws(() => checkTencentMemoryResources(f.root), /runtime integrity mismatch/);
});

test('rejects resources omitted from the runtime manifest', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'upstream/unrecorded.js'), 'export const extra = true;\n');
  assert.throws(() => checkTencentMemoryResources(f.root), /runtime manifest is incomplete/);
});

test('rejects changed upstream pin and invalid hashes', t => {
  const f = fixture(t);
  const file = path.join(f.root, 'upstream.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  writeJson(file, { ...manifest, commit: '0'.repeat(40) });
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /source manifest commit mismatch/);
  writeJson(file, { ...manifest, files: { 'core/sample.ts': 'invalid' } });
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /invalid SHA-256/);
});

test('rejects a shortened MIT license even with a regenerated runtime manifest', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'LICENSE'), 'MIT');
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /MIT license integrity/);
});

test('rejects ESM dependencies outside the bundled runtime', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'upstream/chunk-fixture.js'), 'export { value } from "../../outside.js";\n');
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /Missing TencentDB ESM dependency/);
});

test('rejects bare external service imports and computed dynamic imports', t => {
  const f = fixture(t);
  const file = path.join(f.root, 'upstream/chunk-fixture.js');
  fs.writeFileSync(file, 'import "tencent-business-service";\n');
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /External TencentDB runtime import/);
  fs.writeFileSync(file, 'const name = "./dynamic.js"; import(name);\n');
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /Nonliteral TencentDB import/);
});

test('permits node builtins, literal dynamic imports and import.meta', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'upstream/chunk-fixture.js'),
    'export const value = import.meta.url; export const load = () => import("node:fs/promises");\n');
  f.refresh();
  assert.doesNotThrow(() => checkTencentMemoryResources(f.root));
});

test('rejects a CJS package boundary and install hooks', t => {
  const f = fixture(t);
  writeJson(path.join(f.root, 'package.json'), { type: 'commonjs', private: true });
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /requires ESM/);
  writeJson(path.join(f.root, 'package.json'), {
    type: 'module', private: true, scripts: { postinstall: 'unexpected' },
  });
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /must not include install hooks/);
});

test('rejects retained inactive team/work business prompts', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'upstream/chunk-fixture.js'),
    'export const EXTRACT_WORK_MEMORIES_SYSTEM_PROMPT = "unused";\n');
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root), /business prompt must not be bundled/);
});

test('verifies source provenance, packaged notices and original source integrity', t => {
  const f = fixture(t);
  const vendor = path.join(path.dirname(f.root), 'vendor');
  const source = path.join(vendor, 'src/core/sample.ts');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'export const value = "original";\n');
  for (const name of ['LICENSE', 'NOTICE.md']) fs.copyFileSync(path.join(f.root, name), path.join(vendor, name));
  const sourceManifest = {
    version: TENCENT_MEMORY_VERSION,
    commit: TENCENT_MEMORY_COMMIT,
    files: {
      'core/sample.ts': createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
    },
  };
  writeJson(path.join(vendor, 'upstream.json'), sourceManifest);
  writeJson(path.join(f.root, 'upstream.json'), sourceManifest);
  f.refresh();
  assert.doesNotThrow(() => checkTencentMemoryResources(f.root, { vendor }));
  fs.appendFileSync(path.join(f.root, 'NOTICE.md'), 'Altered attribution\n');
  f.refresh();
  assert.throws(() => checkTencentMemoryResources(f.root, { vendor }), /packaged notice differs/);
  fs.writeFileSync(source, 'export const value = "changed";\n');
  assert.throws(() => verifyTencentMemorySources(vendor), /source integrity mismatch/);
});

test('rejects unsafe source-manifest paths before accessing them', t => {
  const f = fixture(t);
  const vendor = path.join(path.dirname(f.root), 'vendor');
  fs.mkdirSync(vendor);
  writeJson(path.join(vendor, 'upstream.json'), {
    version: TENCENT_MEMORY_VERSION,
    commit: TENCENT_MEMORY_COMMIT,
    files: { '../outside.ts': 'a'.repeat(64) },
  });
  assert.throws(() => verifyTencentMemorySources(vendor), /Unsafe TencentDB manifest path/);
});

test('host SQLite adapter cannot resolve optional packages or workspace code', async () => {
  const adapter = path.resolve(__dirname,
    '../third_party/tencentdb-agent-memory/adapters/local-sqlite-loader.mjs');
  const { createRequire } = await import(pathToFileURL(adapter).href);
  const localRequire = createRequire();
  assert.equal(typeof localRequire('node:sqlite').DatabaseSync, 'function');
  for (const specifier of ['sqlite-vec', './workspace.js', 'node:child_process'])
    assert.throws(() => localRequire(specifier), /does not load external modules/);
});

test('host snapshot storage cannot fall back to Tencent product storage adapters', async () => {
  const adapter = path.resolve(__dirname,
    '../third_party/tencentdb-agent-memory/adapters/disabled-storage.mjs');
  const { StorageAdapter, LocalStorageBackend } = await import(pathToFileURL(adapter).href);
  assert.throws(() => new StorageAdapter(), /snapshot storage is required/);
  assert.throws(() => new LocalStorageBackend(), /snapshot storage is required/);
});
