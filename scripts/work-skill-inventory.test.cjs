const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  checkWorkSourceCatalog,
  isEmptyPackageResourceAllowed,
  inventoryWorkSkills,
} = require('./check-package.cjs');

const SOURCE_ARCHIVE_SHA256 =
  'D7AEAEE62CF99E3E49391A581B16C8F4E1091A6D9DCB46FB20E9F83769FD9A17';
const DESIGN_SOURCE_COUNT = 82;
const PDF_SOURCE_PATHS = [
  'pdf/SKILL.md',
  'pdf-reading/SKILL.md',
  'pdf-1/0.1.7/skills/pdf/SKILL.md',
  'pdf-1/0.1.8/skills/pdf/SKILL.md',
  'pdf-1/0.2.1/skills/pdf/SKILL.md',
  'pdf-1/0.2.1/skills/pdf-viewer/SKILL.md',
  'pdf-1/0.2.2/skills/pdf/SKILL.md',
  'pdf-1/0.2.2/skills/pdf-viewer/SKILL.md',
  'pdf-1/0.2.3/skills/pdf/SKILL.md',
  'pdf-1/0.2.3/skills/pdf-viewer/SKILL.md',
];
const PDF_UNIQUE_BODY_COUNT = 5;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeSkill(file, { name, description, body }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
    'utf8',
  );
  fs.writeFileSync(file, bytes);
  return sha256(bytes);
}

function catalogId(family, version, slug, sourceSha256) {
  const versionPart = version ? version.replaceAll('.', '-') : 'loose';
  return `builtin:work-source-${family}-${versionPart}-${slug}-${sourceSha256.slice(0, 8)}`;
}

function writeCatalog(fixture, entries = fixture.entries) {
  fs.writeFileSync(
    fixture.catalogFile,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
        entries,
      },
      null,
      2,
    )}\n`,
  );
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mingshen-work-skills-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const sourceRoot = path.join(root, 'WorkAgentSkill');
  const skillsRoot = path.join(root, 'packaged/prompts/skills');
  const catalogFile = path.join(skillsRoot, 'work-sources/catalog.json');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(path.dirname(catalogFile), { recursive: true });

  const entries = [];
  const copiedTargets = new Map();
  const entryFiles = new Map();
  let sequence = 0;

  function addSource({
    family,
    version = null,
    sourcePath,
    slug,
    name,
    description,
    body,
    designResource = false,
  }) {
    sequence += 1;
    const sourceFile = path.join(sourceRoot, sourcePath);
    const sourceSha256 = writeSkill(sourceFile, { name, description, body });
    const entryNumber = String(sequence).padStart(3, '0');
    const target = `work-sources/entry-${entryNumber}/${path.posix.basename(sourcePath)}`;
    const entryFile = path.join(skillsRoot, target);
    fs.mkdirSync(path.dirname(entryFile), { recursive: true });
    if (designResource) {
      const copied = sourcePath.slice(
        sourcePath.indexOf('/skills/design/design-resources/') +
          '/skills/design/design-resources/'.length,
      );
      const copiedFile = path.join(
        skillsRoot,
        'work-visual-design/references/design-resources',
        copied,
      );
      fs.mkdirSync(path.dirname(copiedFile), { recursive: true });
      fs.copyFileSync(sourceFile, copiedFile);
      fs.writeFileSync(
        entryFile,
        `---\nname: ${name}\ndescription: ${description}\n---\n\n# Design adapter\n\nUse \`resource:"references/design-resources/${copied}"\`.\n`,
      );
      copiedTargets.set(sourcePath, copiedFile);
    } else {
      fs.copyFileSync(sourceFile, entryFile);
      copiedTargets.set(sourcePath, entryFile);
    }
    const entry = {
      id: catalogId(family, version, slug, sourceSha256),
      name,
      description,
      family,
      version,
      sourcePath,
      sourceSha256,
      entry: target,
      resourceRoot: path.posix.dirname(target),
      compatibility: 'adapted',
      licenseDisposition: 'verbatim',
    };
    entries.push(entry);
    entryFiles.set(sourcePath, entryFile);
    return { entry, sourceFile, sourceSha256 };
  }

  const duplicateBodies = [];
  for (let index = 0; index < DESIGN_SOURCE_COUNT; index += 1) {
    const number = String(index + 1).padStart(3, '0');
    const description = `Design resource ${number}`;
    const body = `# Design resource ${number}\nUnique fixture content ${number}.`;
    duplicateBodies.push({ name: `design-resource-${number}`, description, body });
    addSource({
      family: 'design',
      version: '0.1.0',
      sourcePath: `design-1/0.1.0/skills/design/design-resources/resource-${number}/SKILL.md`,
      slug: `source-${number}`,
      name: `design-resource-${number}`,
      description,
      body,
      designResource: true,
    });
  }

  addSource({
    family: 'design',
    version: '0.1.0',
    sourcePath: 'design-1/0.1.0/skills/design/SKILL.md',
    slug: 'source-083',
    name: 'design-primary',
    description: 'Primary design workflow',
    body: '# Primary design workflow\nUnique fixture content 083.',
  });

  for (const [index, sourcePath] of PDF_SOURCE_PATHS.entries()) {
    const number = String(index + 1).padStart(3, '0');
    const sourceFamily = sourcePath.split('/')[0];
    const versionMatch = sourcePath.split('/')[1];
    const version = /^\d+\.\d+\.\d+$/.test(versionMatch) ? versionMatch : null;
    const isViewer = sourcePath.includes('/pdf-viewer/');
    const viewerVersion = isViewer ? version : null;
    const body =
      sourcePath === 'pdf/SKILL.md'
        ? '# Loose PDF fixture\nDistinct legacy PDF content.'
        : sourcePath === 'pdf-reading/SKILL.md'
          ? '# PDF reading fixture\nDistinct reading content.'
          : isViewer
            ? viewerVersion === '0.2.1'
              ? '# Viewer fixture 0.2.1\nDistinct viewer 0.2.1 content.'
              : '# Viewer fixture current\nDistinct current viewer content.'
            : '# PDF production fixture\nDistinct production content.';
    const description =
      sourcePath === 'pdf/SKILL.md'
        ? 'Loose PDF fixture'
        : sourcePath === 'pdf-reading/SKILL.md'
          ? 'PDF reading fixture'
          : isViewer
            ? viewerVersion === '0.2.1'
              ? 'PDF viewer fixture 0.2.1'
              : 'PDF viewer fixture current'
            : 'PDF production fixture';
    addSource({
      family: sourceFamily.replace(/-1$/, ''),
      version,
      sourcePath,
      slug: `pdf-suite-${number}`,
      name: isViewer ? 'pdf-viewer' : sourcePath === 'pdf-reading/SKILL.md' ? 'pdf-reading' : 'pdf',
      description,
      body,
    });
  }

  for (let index = 0; index < 16; index += 1) {
    const number = String(index + 1).padStart(3, '0');
    addSource({
      family: `other-${number}`,
      sourcePath: `other-${number}/SKILL.md`,
      slug: `source-${number}`,
      name: `other-skill-${number}`,
      description: `Other fixture skill ${number}`,
      body: `# Other fixture skill ${number}\nUnique fixture content ${number}.`,
    });
  }

  for (let index = 0; index < 15; index += 1) {
    const number = String(index + 1).padStart(3, '0');
    const shared = duplicateBodies[index];
    addSource({
      family: `duplicate-${number}`,
      sourcePath: `duplicate-${number}/SKILL.md`,
      slug: `duplicate-${number}`,
      name: shared.name,
      description: shared.description,
      body: shared.body,
    });
  }

  assert.equal(entries.length, 124);
  writeCatalog({ catalogFile, entries });
  return {
    root,
    sourceRoot,
    skillsRoot,
    catalogFile,
    entries,
    copiedTargets,
    entryFiles,
  };
}

function pathForSource(f, sourcePath) {
  return path.join(f.sourceRoot, sourcePath);
}

function entryForSource(f, sourcePath) {
  return f.entries.find(entry => entry.sourcePath === sourcePath);
}

test('inventories every physical WorkAgent source while preserving duplicate names and bodies', t => {
  const f = fixture(t);
  const result = checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot);
  assert.deepEqual(result, {
    entryCount: 124,
    uniqueShaCount: 104,
    designResources: 82,
  });

  const inventory = inventoryWorkSkills(f.sourceRoot);
  assert.equal(inventory.size, 124);
  assert.equal(new Set([...inventory.values()].map(row => row.sourceSha256)).size, 104);
  const pdfRows = PDF_SOURCE_PATHS.map(sourcePath => inventory.get(sourcePath));
  assert.equal(new Set(pdfRows.map(row => row.name)).size, 3);
  assert.equal(
    new Set(pdfRows.map(row => row.sourceSha256)).size,
    PDF_UNIQUE_BODY_COUNT,
  );
});

test('validates the packaged catalog without requiring WorkAgentSkill', t => {
  const f = fixture(t);
  fs.rmSync(f.sourceRoot, { recursive: true, force: true });
  const result = checkWorkSourceCatalog(f.skillsRoot);
  assert.equal(result.entryCount, 124);
  assert.equal(result.uniqueShaCount, 104);
  assert.equal(result.designResources, 82);
});

test('allows zero-byte bundled skill support files but requires entry bodies', () => {
  assert.equal(
    isEmptyPackageResourceAllowed(
      'prompts/skills/work-sources/entries/adaptation-3679488c/references/source/scripts/__init__.py',
    ),
    true,
  );
  assert.equal(
    isEmptyPackageResourceAllowed(
      'prompts/skills/work-sources/entries/adaptation-3679488c/references/source/scripts/tool.py',
    ),
    true,
  );
  assert.equal(isEmptyPackageResourceAllowed('prompts/skills/work-pdf.md'), false);
  assert.equal(
    isEmptyPackageResourceAllowed(
      'prompts/skills/work-sources/entries/adaptation-3679488c/SKILL.md',
    ),
    false,
  );
  assert.equal(
    isEmptyPackageResourceAllowed('prompts/skills/work-pdf/references/empty.txt'),
    false,
  );
});

test('fails when one physical source is missing', t => {
  const f = fixture(t);
  fs.rmSync(pathForSource(f, PDF_SOURCE_PATHS[0]));
  assert.throws(
    () => checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot),
    /124 physical SKILL\.md files/,
  );
});

test('fails when the catalog replaces a physical source path with a fabricated path', t => {
  const f = fixture(t);
  f.entries[82].sourcePath = 'design-1/0.1.0/skills/design/ghost/SKILL.md';
  writeCatalog(f);
  assert.throws(
    () => checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot),
    /exact physical source paths/,
  );
});

test('does not collapse a missing source into another file with the same frontmatter name', t => {
  const f = fixture(t);
  fs.rmSync(pathForSource(f, PDF_SOURCE_PATHS[0]));
  writeSkill(path.join(f.sourceRoot, 'pdf-1/0.2.3/skills/pdf-extra/SKILL.md'), {
    name: 'pdf-suite',
    description: 'Replacement with the same name',
    body: '# Replacement with the same name\nDifferent source content.',
  });
  assert.throws(
    () => checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot),
    /exact physical source paths/,
  );
});

for (const [field, replacement, pattern] of [
  ['sourceSha256', '0'.repeat(64), /Stale WorkAgentSkill source SHA/],
  ['name', 'stale-name', /Stale WorkAgentSkill source name/],
  ['description', 'Stale description', /Stale WorkAgentSkill source description/],
]) {
  test(`fails when a physical source ${field} is stale`, t => {
    const f = fixture(t);
    const sourcePath = f.entries[83].sourcePath;
    const entry = entryForSource(f, sourcePath);
    entry[field] = replacement;
    if (field === 'sourceSha256')
      entry.id = catalogId(entry.family, entry.version, 'stale-source', replacement);
    writeCatalog(f);
    assert.throws(() => checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot), pattern);
  });
}

test('fails when the work source version field is absent', t => {
  const f = fixture(t);
  delete f.entries[0].version;
  writeCatalog(f);
  assert.throws(
    () => checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot),
    /missing version/,
  );
});

test('rejects loader-incompatible dot-separated versions in source IDs', t => {
  const f = fixture(t);
  const entry = entryForSource(f, 'pdf-1/0.2.3/skills/pdf/SKILL.md');
  entry.id = entry.id.replace('-pdf-0-2-3-', '-pdf-0.2.3-');
  writeCatalog(f);
  assert.throws(
    () => checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot),
    /Invalid work source id/,
  );
});

test('fails when a catalog entry file is missing or empty', t => {
  const missing = fixture(t);
  fs.rmSync(missing.copiedTargets.get(missing.entries[83].sourcePath));
  assert.throws(
    () => checkWorkSourceCatalog(missing.skillsRoot, missing.sourceRoot),
    /ENOENT/,
  );

  const empty = fixture(t);
  fs.writeFileSync(empty.copiedTargets.get(empty.entries[83].sourcePath), '');
  assert.throws(
    () => checkWorkSourceCatalog(empty.skillsRoot, empty.sourceRoot),
    /Empty work source entry/,
  );
});

test('fails when a resource root is not a loadable directory', t => {
  const f = fixture(t);
  const entry = f.entries[83];
  const notDirectory = 'work-sources/not-a-directory/SKILL.md';
  const notDirectoryFile = path.join(f.skillsRoot, notDirectory);
  fs.mkdirSync(path.dirname(notDirectoryFile), { recursive: true });
  fs.writeFileSync(notDirectoryFile, '# Not a directory\n');
  entry.entry = notDirectory;
  entry.resourceRoot = notDirectory;
  writeCatalog(f);
  assert.throws(
    () => checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot),
    /resourceRoot must be a directory/,
  );
});

test('rejects catalog path traversal and linked package paths', t => {
  const traversal = fixture(t);
  traversal.entries[83].entry = '../escape.md';
  writeCatalog(traversal);
  assert.throws(
    () => checkWorkSourceCatalog(traversal.skillsRoot, traversal.sourceRoot),
    /must not escape its root/,
  );

  const linked = fixture(t);
  const target = path.join(linked.root, 'linked-target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'SKILL.md'), '# Linked skill\n');
  fs.symlinkSync(target, path.join(linked.skillsRoot, 'work-linked'), 'junction');
  linked.entries[83].entry = 'work-linked/SKILL.md';
  linked.entries[83].resourceRoot = 'work-linked';
  writeCatalog(linked);
  assert.throws(
    () => checkWorkSourceCatalog(linked.skillsRoot, linked.sourceRoot),
    /must not traverse a linked path/,
  );
});

test('requires every design resource to reuse its exact source copy', t => {
  const f = fixture(t);
  const entry = f.entries.find(candidate =>
    candidate.sourcePath.includes('/skills/design/design-resources/'),
  );
  const target = f.copiedTargets.get(entry.sourcePath);
  fs.appendFileSync(target, '\nchanged copy\n');
  assert.throws(
    () => checkWorkSourceCatalog(f.skillsRoot, f.sourceRoot),
    /Design source resource copy is not byte-identical/,
  );

  const routing = fixture(t);
  const routingEntry = routing.entries.find(candidate =>
    candidate.sourcePath.includes('/skills/design/design-resources/'),
  );
  const adapterFile = routing.entryFiles.get(routingEntry.sourcePath);
  fs.writeFileSync(
    adapterFile,
    fs.readFileSync(adapterFile, 'utf8').replaceAll(
      'references/design-resources/',
      'references/redirected/',
    ),
  );
  assert.throws(
    () => checkWorkSourceCatalog(routing.skillsRoot, routing.sourceRoot),
    /Design adapter does not route to its exact copied resource/,
  );
});

test('requires all ten PDF source paths and five unique bodies', t => {
  const missing = fixture(t);
  const pdfEntry = entryForSource(missing, PDF_SOURCE_PATHS[0]);
  pdfEntry.family = 'replacement-pdf';
  pdfEntry.version = null;
  pdfEntry.sourcePath = 'replacement-pdf/SKILL.md';
  pdfEntry.sourceSha256 = sha256(
    fs.readFileSync(pathForSource(missing, PDF_SOURCE_PATHS[0])),
  );
  pdfEntry.id = catalogId(
    pdfEntry.family,
    pdfEntry.version,
    'replacement',
    pdfEntry.sourceSha256,
  );
  writeCatalog(missing);
  assert.throws(
    () => checkWorkSourceCatalog(missing.skillsRoot, missing.sourceRoot),
    /Missing PDF source variant/,
  );

  const duplicate = fixture(t);
  const firstPdf = entryForSource(duplicate, PDF_SOURCE_PATHS[0]);
  const secondPdf = entryForSource(duplicate, PDF_SOURCE_PATHS[1]);
  firstPdf.sourceSha256 = secondPdf.sourceSha256;
  firstPdf.id = catalogId(firstPdf.family, firstPdf.version, 'pdf-duplicate', firstPdf.sourceSha256);
  const duplicateEntry = entryForSource(
    duplicate,
    'duplicate-001/SKILL.md',
  );
  const replacementSha256 = writeSkill(
    pathForSource(duplicate, duplicateEntry.sourcePath),
    {
      name: duplicateEntry.name,
      description: duplicateEntry.description,
      body: '# Newly unique duplicate source\nThe PDF duplicate leaves the total hash count unchanged.',
    },
  );
  duplicateEntry.sourceSha256 = replacementSha256;
  duplicateEntry.id = catalogId(
    duplicateEntry.family,
    duplicateEntry.version,
    'unique-replacement',
    replacementSha256,
  );
  writeCatalog(duplicate);
  assert.throws(
    () => checkWorkSourceCatalog(duplicate.skillsRoot, duplicate.sourceRoot),
    /All 10 PDF source paths and 5 unique bodies must remain loadable/,
  );
});
