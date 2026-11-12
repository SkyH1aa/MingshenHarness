const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const { test } = require('node:test');
const {
  checkAuthoringRuntime,
  checkPackagedAuthoringRuntime,
} = require('./check-package.cjs');
const requireDesktop = createRequire(path.resolve(__dirname, '../apps/desktop/package.json'));
const asar = createRequire(requireDesktop.resolve('app-builder-lib'))('@electron/asar');

function fixture(t, { missingPackage, missingEntry, missingExport } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mingshen-document-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const packages = {
    docx: {
      version: '9.15.3',
      main: 'dist/index.cjs',
      exports: Object.fromEntries(['index', 'math', 'html', 'charts'].map(name => [name === 'index' ? '.' : `./${name}`, { require: `./dist/${name}.cjs`, import: `./dist/${name}.mjs` }])),
      dependencies: { fflate: '0.8.3' },
    },
    pptxgenjs: {
      version: '4.0.1',
      main: 'dist/index.cjs',
      dependencies: { jszip: '3.10.2' },
    },
    fflate: { version: '0.8.3', main: 'lib/index.cjs' },
    jszip: { version: '3.10.2', main: 'lib/index.js' },
    '@xmldom/xmldom': { version: '0.8.15', main: 'lib/index.js' },
    marked: { version: '18.1.2', main: 'lib/marked.umd.js' },
    katex: { version: '0.19.1', main: 'dist/katex.js' },
  };
  const entries = new Map();
  for (const [name, metadata] of Object.entries(packages)) {
    if (name === missingPackage) continue;
    const directory = path.join(source, 'node_modules', name);
    fs.mkdirSync(path.join(directory, path.dirname(metadata.main)), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(metadata));
    if (name !== missingEntry)
      fs.writeFileSync(path.join(directory, metadata.main), `module.exports = ${JSON.stringify(name)};`);
    if (name === 'docx') for (const entry of Object.values(metadata.exports).flatMap(value => Object.values(value))) {
      if (entry === missingExport || (name === missingEntry && entry === `./${metadata.main}`)) continue;
      fs.writeFileSync(path.join(directory, entry), '// runtime fixture');
    }
    entries.set(name, path.join(directory, metadata.main));
  }
  return { root, source, packages, entries };
}

async function packagedFixture(f, options = {}) {
  const archive = path.join(f.root, 'app.asar');
  const output = await asar.createPackageWithOptions(f.source, archive, options);
  await finished(output);
  const files = new Set(
    asar.listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\/+/, '')),
  );
  return { archive, unpacked: `${archive}.unpacked`, files };
}

test('checks source authoring packages and their runtime dependency closure', t => {
  const f = fixture(t);
  const resolver = name => {
    const entry = f.entries.get(name);
    if (!entry) throw Object.assign(new Error(`Missing ${name}`), { code: 'MODULE_NOT_FOUND' });
    return entry;
  };
  const checked = checkAuthoringRuntime(resolver);
  assert.ok(checked.has('docx'));
  assert.ok(checked.has('pptxgenjs'));
  assert.ok(checked.has('fflate'));
  assert.ok(checked.has('jszip'));
});

test('checks real ASAR authoring files without unpacked or host dependencies', async t => {
  const f = fixture(t);
  const p = await packagedFixture(f);
  assert.equal(fs.existsSync(p.unpacked), false);
  const checked = checkPackagedAuthoringRuntime(p.archive, p.unpacked, p.files, asar);
  assert.ok(checked.has('docx'));
  assert.ok(checked.has('pptxgenjs'));
  assert.ok(checked.has('fflate'));
  assert.ok(checked.has('jszip'));
});

test('checks authoring dependencies split between ASAR and unpacked files', async t => {
  const f = fixture(t);
  const p = await packagedFixture(f, { unpackDir: 'node_modules/jszip' });
  assert.ok(fs.existsSync(path.join(p.unpacked, 'node_modules/jszip/package.json')));
  assert.equal(fs.existsSync(path.join(p.unpacked, 'node_modules/docx/package.json')), false);
  const checked = checkPackagedAuthoringRuntime(p.archive, p.unpacked, p.files, asar);
  assert.ok(checked.has('docx') && checked.has('jszip'));
});

test('rejects an ASAR dependency missing from the package even when installed on the host', async t => {
  const f = fixture(t, { missingPackage: 'jszip' });
  const p = await packagedFixture(f);
  assert.throws(
    () => checkPackagedAuthoringRuntime(p.archive, p.unpacked, p.files, asar),
    /Missing packaged document dependency: jszip/,
  );
});

test('rejects an ASAR package with a missing authoring runtime entry', async t => {
  const f = fixture(t, { missingEntry: 'docx' });
  const p = await packagedFixture(f);
  assert.throws(
    () => checkPackagedAuthoringRuntime(p.archive, p.unpacked, p.files, asar),
    /Missing packaged docx runtime (entry|export)/,
  );
});

for (const subpath of ['math', 'html', 'charts']) test(`rejects missing ${subpath} runtime exports in real ASAR`, async t => {
  const f = fixture(t, { missingExport: `./dist/${subpath}.cjs` });
  const p = await packagedFixture(f);
  assert.throws(() => checkPackagedAuthoringRuntime(p.archive, p.unpacked, p.files, asar), /Missing packaged docx runtime export/);
  assert.throws(() => checkAuthoringRuntime(name => f.entries.get(name)), /Missing docx runtime export/);
});

test('rejects a package closure with a missing runtime entry', t => {
  const f = fixture(t, { missingEntry: 'jszip' });
  assert.throws(
    () =>
      checkAuthoringRuntime(name => {
        const entry = f.entries.get(name);
        if (!entry) throw Object.assign(new Error(`Missing ${name}`), { code: 'MODULE_NOT_FOUND' });
        return entry;
      }),
    /Missing jszip runtime entry/,
  );
});
