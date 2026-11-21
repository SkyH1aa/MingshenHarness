const assert = require('node:assert/strict');
const fs = require('node:fs');
const { builtinModules, createRequire } = require('node:module');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TENCENT_MEMORY_RESOURCES, checkTencentMemoryResources } = require('./tencent-memory-package.cjs');
const { validateWindowsIcon } = require('./windows-icon.cjs');
const { checkElectronRuntime } = require('./provision-electron-runtime.cjs');
const { validateNodePty } = require('./package-native-dependencies.cjs');
const desktop = path.resolve(__dirname, '../apps/desktop');
const requireDesktop = createRequire(path.resolve(desktop, 'package.json'));
const YAML = requireDesktop('yaml');
const WORK_SOURCE_CATALOG = 'work-sources/catalog.json';
const WORK_SOURCE_ARCHIVE_SHA256 =
  'D7AEAEE62CF99E3E49391A581B16C8F4E1091A6D9DCB46FB20E9F83769FD9A17';
const WORK_SOURCE_ENTRY_COUNT = 124;
const WORK_SOURCE_UNIQUE_HASH_COUNT = 104;
const WORK_SOURCE_DESIGN_RESOURCE_COUNT = 82;
const WORK_SOURCE_COMPATIBILITY = new Set(['native', 'adapted', 'resource', 'reference']);
const WORK_SOURCE_LICENSE_DISPOSITIONS = new Set(['verbatim', 'adapted', 'reference-only']);
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
const IMPORTED_SKILL_SOURCES = [
  {
    id: 'work-ppt-master',
    sourceName: 'ppt-master',
    version: '6.9.0',
    relativeRoot: 'work-ppt-master/references/source',
    repositoryRoot: 'ppt-master/skills/ppt-master',
    expectedFiles: 13089,
    expectedBytes: 39892466,
    expectedTreeSha256:
      '6e8023b4b8ab81e0fb4cffb71c1dcea8dd4f6f6abca490395c21fb273bfe473c',
    excludedRelativePaths: new Set(['.env.example']),
  },
  {
    id: 'work-asd-ste100',
    sourceName: 'asd-ste100',
    version: '0.4.0',
    relativeRoot: 'work-asd-ste100/references/source',
    repositoryRoot: 'asd-ste100-skill-master',
    expectedFiles: 9,
    expectedBytes: 231661,
    expectedTreeSha256:
      '0886b021b0f18d8997736af0a3b51a3492dd2c3b378ebb7484bead7803e04930',
    excludedRelativePaths: new Set(),
  },
];
const indexedLanguages = ['python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp'];
const authoringPackages = new Map([
  ['docx', '9.15.3'],
  ['pptxgenjs', '4.0.1'],
  ['exceljs', '4.4.0'],
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
  let entry;
  try {
    entry = resolveModule(`${name}/package.json`);
  } catch {
    entry = resolveModule(name);
  }
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

function checkTerminalRuntime(resolveModule, unpackedRoot) {
  const root = packageRoot(resolveModule, 'node-pty');
  validateNodePty({ moduleRoot: root });
  if (unpackedRoot) assert.ok(root.startsWith(unpackedRoot), 'node-pty must be unpacked');
  for (const relative of [
    'lib/index.js',
    'lib/utils.js',
    'lib/windowsPtyAgent.js',
    'lib/conpty_console_list_agent.js',
    'prebuilds/win32-x64/pty.node',
    'prebuilds/win32-x64/conpty.node',
    'prebuilds/win32-x64/conpty_console_list.node',
    'prebuilds/win32-x64/conpty/conpty.dll',
    'prebuilds/win32-x64/conpty/OpenConsole.exe',
    'prebuilds/win32-x64/winpty.dll',
    'prebuilds/win32-x64/winpty-agent.exe',
  ]) {
    const file = path.join(root, relative);
    assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0, `Missing node-pty runtime: ${relative}`);
    if (unpackedRoot) assert.ok(file.startsWith(unpackedRoot), `node-pty runtime must be unpacked: ${relative}`);
  }
}

function checkImageRuntime(resolveModule, unpackedRoot) {
  const root = packageRoot(resolveModule, 'sharp');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.35.5', 'Unexpected sharp version');
  if (unpackedRoot) assert.ok(root.startsWith(unpackedRoot), 'sharp must be unpacked');
  for (const dependency of Object.keys(metadata.dependencies || {})) {
    const entry = resolveModule(dependency);
    assert.ok(fs.existsSync(entry), `Missing sharp dependency: ${dependency}`);
    if (unpackedRoot) assert.ok(entry.startsWith(unpackedRoot), `sharp dependency must be unpacked: ${dependency}`);
  }
  const nativeRoot = path.dirname(resolveModule('@img/sharp-win32-x64/sharp.node'));
  if (unpackedRoot) assert.ok(nativeRoot.startsWith(unpackedRoot), 'sharp native runtime must be unpacked');
  for (const relative of ['lib/sharp-win32-x64-0.35.5.node', 'lib/libvips-42.dll', 'lib/libvips-cpp-8.18.7.dll', 'LICENSE']) {
    const file = path.join(nativeRoot, relative);
    assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0, `Missing sharp runtime: ${relative}`);
  }
}

const imageNoticeHashes = {
  'README.md': '3d083ada5ebafe1e6c227daa7b061d4254b61df4a3901c359ffdeac817ce5866',
  LICENSE: 'dc1f5d2d43c5531dfe0acaf4e950ea5dbe3e61e1850cf0e983bda7efc10d6693',
};
const imageNoticeCopies = [
  { from: 'node_modules/@img/sharp-win32-x64/README.md', to: 'third-party-notices/sharp-win32-x64/app-local-README.md' },
  { from: '../../node_modules/@img/sharp-win32-x64/README.md', to: 'third-party-notices/sharp-win32-x64/workspace-README.md' },
];

function checkImageNotices(resolveSource, options = {}) {
  const appDirectory = options.appDirectory || desktop;
  const config = options.config || YAML.parse(fs.readFileSync(path.join(desktop, 'electron-builder.yml'), 'utf8'));
  const sourceRoot = path.dirname(resolveSource('@img/sharp-win32-x64/sharp.node'));
  const verify = (file, expected, label) => {
    assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing ${label}: ${file}`);
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected, `${label} hash mismatch`);
  };
  assert.equal(JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8')).version, '0.35.5', 'Unexpected sharp native package version');
  for (const [name, expected] of Object.entries(imageNoticeHashes))
    verify(path.join(sourceRoot, name), expected, `sharp source ${name}`);
  let availableSourceCopies = 0;
  for (const copy of imageNoticeCopies) {
    assert.ok(Array.isArray(config.extraResources) && config.extraResources.some(entry => entry && entry.from === copy.from && entry.to === copy.to), `Missing sharp notice copy configuration: ${copy.from}`);
    const file = path.resolve(appDirectory, copy.from);
    if (fs.existsSync(file)) {
      verify(file, imageNoticeHashes['README.md'], 'sharp configured source README');
      availableSourceCopies++;
    }
  }
  assert.ok(availableSourceCopies > 0, 'Missing sharp configured source README');
  if (!options.resources) return;
  assert.equal(typeof options.resolvePackaged, 'function', 'Missing packaged sharp resolver');
  const packagedRoot = path.dirname(options.resolvePackaged('@img/sharp-win32-x64/sharp.node'));
  verify(path.join(packagedRoot, 'LICENSE'), imageNoticeHashes.LICENSE, 'sharp packaged LICENSE');
  let packagedCopies = 0;
  for (const copy of imageNoticeCopies) {
    const file = path.join(options.resources, copy.to);
    if (fs.existsSync(file)) {
      verify(file, imageNoticeHashes['README.md'], 'sharp packaged README');
      packagedCopies++;
    }
  }
  assert.ok(packagedCopies > 0, 'Missing sharp packaged README');
}

function skillResourceFiles(directory, local = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), `Linked bundled skill resource: ${path.join(directory, entry.name)}`);
    const file = path.posix.join(local, entry.name);
    return entry.isDirectory() ? skillResourceFiles(path.join(directory, entry.name), file)
      : entry.isFile() ? [`prompts/skills/${file}`] : [];
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizedSkillDescription(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function safeCatalogRelative(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  assert.ok(!value.includes('\\'), `${label} must use portable forward slashes`);
  assert.ok(!path.posix.isAbsolute(value), `${label} must be relative`);
  assert.ok(!/^[a-z]:/i.test(value), `${label} must not contain a drive letter`);
  const normalized = path.posix.normalize(value);
  assert.equal(normalized, value, `${label} must be normalized`);
  assert.ok(normalized !== '.', `${label} must not be the root itself`);
  assert.ok(!normalized.startsWith('../'), `${label} must not escape its root`);
  return normalized;
}

function assertPathWithin(root, target, label) {
  const local = path.relative(root, target);
  assert.ok(
    local && local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local),
    `${label} escapes its root`,
  );
}

function assertNoLinkedPath(root, relative, label, kind) {
  const rootStat = fs.lstatSync(root);
  assert.ok(rootStat.isDirectory(), `${label} root is unavailable`);
  assert.ok(!rootStat.isSymbolicLink(), `${label} root must not be linked`);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const metadata = fs.lstatSync(current);
    assert.ok(!metadata.isSymbolicLink(), `${label} must not traverse a linked path: ${relative}`);
  }
  if (kind === 'file') assert.ok(fs.lstatSync(current).isFile(), `${label} must be a file`);
  if (kind === 'directory') assert.ok(fs.lstatSync(current).isDirectory(), `${label} must be a directory`);
  return current;
}

function readSkillFrontmatter(file, label) {
  const text = fs.readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  assert.ok(match, `${label} is missing YAML frontmatter`);
  const metadata = YAML.parse(match[1]);
  assert.ok(metadata && typeof metadata === 'object', `${label} frontmatter must be an object`);
  assert.equal(typeof metadata.name, 'string', `${label} frontmatter name is missing`);
  assert.ok(metadata.name.trim(), `${label} frontmatter name is empty`);
  assert.equal(typeof metadata.description, 'string', `${label} frontmatter description is missing`);
  assert.ok(metadata.description.trim(), `${label} frontmatter description is empty`);
  return metadata;
}

function inventoryWorkSkills(sourceRoot) {
  const rows = new Map();
  function walk(directory, local = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Linked WorkAgent skill source: ${file}`);
      const relative = path.posix.join(local, entry.name);
      if (entry.isDirectory()) walk(file, relative);
      else if (entry.isFile() && entry.name === 'SKILL.md') {
        const bytes = fs.readFileSync(file);
        const metadata = readSkillFrontmatter(file, `WorkAgent skill ${relative}`);
        rows.set(relative, {
          sourcePath: relative,
          sourceSha256: sha256(bytes),
          name: metadata.name,
          description: metadata.description,
        });
      }
    }
  }
  walk(sourceRoot);
  return rows;
}

function checkWorkSourceCatalog(skillsRoot, sourceRoot) {
  const catalogFile = path.join(skillsRoot, WORK_SOURCE_CATALOG);
  assert.ok(fs.existsSync(catalogFile), `Missing work source catalog: ${catalogFile}`);
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  assert.equal(catalog.schemaVersion, 1, 'Unsupported work source catalog schema version');
  assert.equal(
    catalog.sourceArchiveSha256,
    WORK_SOURCE_ARCHIVE_SHA256,
    'Unexpected WorkAgentSkill source archive SHA-256',
  );
  assert.ok(Array.isArray(catalog.entries), 'Work source catalog entries must be an array');
  assert.equal(
    catalog.entries.length,
    WORK_SOURCE_ENTRY_COUNT,
    'Work source catalog must contain every physical source entry',
  );

  const ids = new Set();
  const sourcePaths = new Set();
  const sourceHashes = new Set();
  const bySourcePath = new Map();
  let designResources = 0;
  for (const entry of catalog.entries) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), 'Invalid work source entry');
    for (const field of [
      'id',
      'name',
      'description',
      'family',
      'version',
      'sourcePath',
      'sourceSha256',
      'entry',
      'resourceRoot',
      'compatibility',
      'licenseDisposition',
    ])
      assert.ok(Object.hasOwn(entry, field), `Work source entry is missing ${field}`);
    assert.match(
      entry.id,
      /^builtin:work-source-[a-z0-9][a-z0-9-]*-(?:[0-9]+(?:-[0-9]+){2}|loose)-[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/,
      `Invalid work source id: ${entry.id}`,
    );
    assert.ok(!ids.has(entry.id), `Duplicate work source id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(typeof entry.name === 'string' && entry.name.trim(), `Missing name: ${entry.id}`);
    assert.ok(
      typeof entry.description === 'string' && entry.description.trim(),
      `Missing description: ${entry.id}`,
    );
    assert.ok(typeof entry.family === 'string' && entry.family.trim(), `Missing family: ${entry.id}`);
    assert.ok(
      entry.version === null || /^\d+\.\d+\.\d+$/.test(entry.version),
      `Invalid source version: ${entry.id}`,
    );
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/, `Invalid source SHA-256: ${entry.id}`);
    assert.ok(
      entry.id.endsWith(entry.sourceSha256.slice(0, 8)),
      `Work source id must end with the source SHA-256 prefix: ${entry.id}`,
    );
    assert.ok(
      WORK_SOURCE_COMPATIBILITY.has(entry.compatibility),
      `Invalid compatibility: ${entry.id}`,
    );
    assert.ok(
      WORK_SOURCE_LICENSE_DISPOSITIONS.has(entry.licenseDisposition),
      `Invalid license disposition: ${entry.id}`,
    );

    const sourcePath = safeCatalogRelative(entry.sourcePath, `${entry.id} sourcePath`);
    assert.ok(sourcePath.endsWith('/SKILL.md'), `Work source must be a SKILL.md: ${entry.id}`);
    const sourceFamily = sourcePath.split('/')[0];
    const runtimeFamily = sourceFamily.replace(/-1$/, '');
    assert.equal(runtimeFamily, entry.family, `Source family mismatch: ${entry.id}`);
    if (entry.version) {
      assert.ok(
        sourcePath.split('/').includes(entry.version),
        `Source version is missing from sourcePath: ${entry.id}`,
      );
    } else {
      assert.ok(
        !sourcePath.split('/').some(part => /^\d+\.\d+\.\d+$/.test(part)),
        `Loose source unexpectedly has a version directory: ${entry.id}`,
      );
    }
    assert.ok(!sourcePaths.has(sourcePath), `Duplicate physical work source path: ${sourcePath}`);
    sourcePaths.add(sourcePath);
    assert.ok(!bySourcePath.has(sourcePath), `Duplicate work source mapping: ${sourcePath}`);
    bySourcePath.set(sourcePath, entry);
    sourceHashes.add(entry.sourceSha256);

    const entryPath = safeCatalogRelative(entry.entry, `${entry.id} entry`);
    const resourceRootPath = safeCatalogRelative(entry.resourceRoot, `${entry.id} resourceRoot`);
    assert.match(entryPath, /(?:^|\/)SKILL\.md$/i, `Work source entry must be SKILL.md: ${entry.id}`);
    const entryFile = assertNoLinkedPath(skillsRoot, entryPath, `${entry.id} entry`, 'file');
    const resourceRoot = assertNoLinkedPath(
      skillsRoot,
      resourceRootPath,
      `${entry.id} resourceRoot`,
      'directory',
    );
    assertPathWithin(skillsRoot, entryFile, `${entry.id} entry`);
    assertPathWithin(skillsRoot, resourceRoot, `${entry.id} resourceRoot`);
    assertPathWithin(resourceRoot, entryFile, `${entry.id} entry within resourceRoot`);
    const entryText = fs.readFileSync(entryFile, 'utf8');
    assert.ok(entryText.trim(), `Empty work source entry: ${entry.id}`);
    assert.ok(!entryText.includes('\0'), `Binary work source entry: ${entry.id}`);

    const designMarker = '/skills/design/design-resources/';
    if (entry.family === 'design' && sourcePath.includes(designMarker)) {
      designResources += 1;
      const copied = sourcePath.slice(sourcePath.indexOf(designMarker) + designMarker.length);
      const copiedRelative = `work-visual-design/references/design-resources/${copied}`;
      const copiedFile = assertNoLinkedPath(
        skillsRoot,
        copiedRelative,
        `${sourcePath} copied design resource`,
        'file',
      );
      assertPathWithin(skillsRoot, copiedFile, `${sourcePath} copied design resource`);
      assert.equal(
        sha256(fs.readFileSync(copiedFile)),
        entry.sourceSha256,
        `Design source resource copy is not byte-identical: ${sourcePath}`,
      );
      assert.ok(
        entryText.includes(`resource:"references/design-resources/${copied}"`),
        `Design adapter does not route to its exact copied resource: ${sourcePath}`,
      );
    }
  }
  assert.equal(ids.size, WORK_SOURCE_ENTRY_COUNT, 'Work source ids are incomplete');
  assert.equal(sourcePaths.size, WORK_SOURCE_ENTRY_COUNT, 'Work source paths are incomplete');
  assert.equal(
    sourceHashes.size,
    WORK_SOURCE_UNIQUE_HASH_COUNT,
    'Work source catalog must preserve 104 unique bodies',
  );
  assert.equal(
    designResources,
    WORK_SOURCE_DESIGN_RESOURCE_COUNT,
    'Work source catalog must reuse every copied design resource',
  );

  for (const sourcePath of PDF_SOURCE_PATHS) {
    const entry = bySourcePath.get(sourcePath);
    assert.ok(entry, `Missing PDF source variant: ${sourcePath}`);
    const target = path.join(skillsRoot, safeCatalogRelative(entry.entry, `${sourcePath} entry`));
    assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), `PDF source is not loadable: ${sourcePath}`);
  }
  const pdfHashes = new Set(
    PDF_SOURCE_PATHS.map(sourcePath => bySourcePath.get(sourcePath)?.sourceSha256),
  );
  assert.equal(
    pdfHashes.size,
    PDF_UNIQUE_BODY_COUNT,
    `All ${PDF_SOURCE_PATHS.length} PDF source paths and ${PDF_UNIQUE_BODY_COUNT} unique bodies must remain loadable`,
  );

  if (sourceRoot) {
    assert.ok(fs.existsSync(sourceRoot), `Missing WorkAgentSkill source directory: ${sourceRoot}`);
    const sourceStat = fs.lstatSync(sourceRoot);
    assert.ok(sourceStat.isDirectory() && !sourceStat.isSymbolicLink(), 'WorkAgentSkill source root must be a real directory');
    const physical = inventoryWorkSkills(sourceRoot);
    assert.equal(
      physical.size,
      WORK_SOURCE_ENTRY_COUNT,
      'WorkAgentSkill source inventory must contain 124 physical SKILL.md files',
    );
    assert.equal(
      new Set([...physical.values()].map(row => row.sourceSha256)).size,
      WORK_SOURCE_UNIQUE_HASH_COUNT,
      'WorkAgentSkill source inventory must have 104 unique bodies',
    );
    assert.deepEqual(
      [...physical.keys()].sort(),
      [...sourcePaths].sort(),
      'Work source catalog does not cover the exact physical source paths',
    );
    for (const [sourcePath, row] of physical) {
      const entry = bySourcePath.get(sourcePath);
      assert.ok(entry, `Unlisted WorkAgentSkill source: ${sourcePath}`);
      assert.equal(entry.sourceSha256, row.sourceSha256, `Stale WorkAgentSkill source SHA: ${sourcePath}`);
      assert.equal(entry.name, row.name, `Stale WorkAgentSkill source name: ${sourcePath}`);
      assert.equal(
        normalizedSkillDescription(entry.description),
        normalizedSkillDescription(row.description),
        `Stale WorkAgentSkill source description: ${sourcePath}`,
      );
    }
    const archive = path.resolve(sourceRoot, '..', 'WorkAgentSkill.7z');
    if (fs.existsSync(archive))
      assert.equal(
        sha256(fs.readFileSync(archive)),
        WORK_SOURCE_ARCHIVE_SHA256.toLowerCase(),
        'WorkAgentSkill archive SHA-256 does not match the catalog',
      );
  }
  return { entryCount: ids.size, uniqueShaCount: sourceHashes.size, designResources };
}

function importedSkillTreeDescriptor(root, excludedRelativePaths = new Set()) {
  const rootMetadata = fs.lstatSync(root);
  assert.ok(rootMetadata.isDirectory(), `Imported skill source is not a directory: ${root}`);
  assert.ok(!rootMetadata.isSymbolicLink(), `Imported skill source root is linked: ${root}`);
  const files = [];
  let bytes = 0;
  function walk(directory, local = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(local, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Linked imported skill resource: ${absolute}`);
      if (entry.isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      assert.ok(entry.isFile(), `Unsupported imported skill resource: ${absolute}`);
      if (excludedRelativePaths.has(relative)) continue;
      const metadata = fs.lstatSync(absolute);
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), `Invalid imported skill resource: ${absolute}`);
      bytes += metadata.size;
      files.push({ absolute, relative });
    }
  }
  walk(root);
  files.sort((left, right) => left.relative.localeCompare(right.relative, 'en'));
  const tree = createHash('sha256');
  for (const file of files) {
    tree.update(Buffer.from(file.relative, 'utf8'));
    tree.update(Buffer.from([0]));
    tree.update(createHash('sha256').update(fs.readFileSync(file.absolute)).digest());
  }
  return {
    files: files.length,
    bytes,
    treeSha256: tree.digest('hex'),
    paths: files.map(file => file.relative),
  };
}

function assertImportedSkillSource(descriptor, expected, label) {
  assert.equal(
    descriptor.files,
    expected.expectedFiles,
    `${label} must contain ${expected.expectedFiles} packaged resources`,
  );
  assert.equal(
    descriptor.bytes,
    expected.expectedBytes,
    `${label} must contain ${expected.expectedBytes} resource bytes`,
  );
  assert.equal(
    descriptor.treeSha256,
    expected.expectedTreeSha256,
    `${label} deterministic tree SHA-256 changed`,
  );
}

function checkImportedSkillSources(skillsRoot, repositoryRoot) {
  for (const expected of IMPORTED_SKILL_SOURCES) {
    const packagedRoot = path.join(
      skillsRoot,
      ...expected.relativeRoot.split('/'),
    );
    assertNoLinkedPath(
      skillsRoot,
      expected.relativeRoot,
      `${expected.id} imported source`,
      'directory',
    );
    const packaged = importedSkillTreeDescriptor(
      packagedRoot,
      expected.excludedRelativePaths,
    );
    assertImportedSkillSource(packaged, expected, expected.id);
    assert.ok(
      packaged.paths.every(relative => !/(?:^|\/)\.env(?:\.example)?$/i.test(relative)),
      `${expected.id} must not package an environment or credential template`,
    );
    const metadata = readSkillFrontmatter(
      path.join(packagedRoot, 'SKILL.md'),
      `${expected.id} source entry`,
    );
    assert.equal(metadata.name, expected.sourceName, `${expected.id} source name changed`);
    assert.equal(
      String(metadata.metadata?.version),
      expected.version,
      `${expected.id} source version changed`,
    );
    assert.ok(
      fs.existsSync(path.join(packagedRoot, 'LICENSE')),
      `${expected.id} must package its upstream license`,
    );
    if (repositoryRoot) {
      const sourceRoot = path.resolve(repositoryRoot, expected.repositoryRoot);
      assert.ok(
        fs.existsSync(sourceRoot),
        `Missing imported skill repository source: ${sourceRoot}`,
      );
      const source = importedSkillTreeDescriptor(
        sourceRoot,
        expected.excludedRelativePaths,
      );
      assertImportedSkillSource(source, expected, `${expected.id} repository source`);
      assert.equal(
        packaged.treeSha256,
        source.treeSha256,
        `${expected.id} packaged source is stale`,
      );
    }
  }
  return IMPORTED_SKILL_SOURCES.map(source => source.id);
}

const bundledSkills = skillResourceFiles(path.join(desktop, 'resources/prompts/skills'));
const required = [...new Set([
  ...TENCENT_MEMORY_RESOURCES.map(file => `tencentdb-memory/${file}`),
  'documents/document-worker.cjs',
  'documents/office-com-verify.ps1',
  'prompts/chat.md', 'prompts/work.md',
  ...['code-engineering', 'code-debugging', 'code-verification', 'code-frontend', 'code-platform',
    'work-word', 'work-spreadsheets', 'work-presentations', 'work-analysis', 'work-research',
    'work-operations', 'artifact-quality', 'work-pdf', 'work-visual-design', 'work-visualization',
    'work-image-sourcing', 'work-ppt-master', 'work-asd-ste100',
    'skill-creator', 'plugin-creator', 'harness-plugin-api'].map(name => `prompts/skills/${name}.md`),
  ...[
    'code-engineering/references/large-change-execution.md',
    'code-debugging/references/failure-forensics.md',
    'code-verification/references/test-design.md',
    'code-frontend/references/visual-acceptance.md',
    'code-platform/references/release-safety.md',
    'work-word/references/editorial-quality.md',
    'work-spreadsheets/references/report-surfaces.md',
    'work-presentations/references/story-and-layout.md',
    'artifact-quality/references/format-acceptance.md',
  ].map(name => `prompts/skills/${name}`),
  'native/codex-sandbox.exe', 'native/LICENSE', 'native/NOTICE',
  'prompts/runtime.md', 'prompts/compaction.md', 'docs/USER_GUIDE.md', 'docs/USER_GUIDE.en.md',
  'docs/CHANGELOG.md', 'docs/CHANGELOG.en.md',
  'docs/TERMS_OF_SERVICE.md', 'docs/TERMS_OF_SERVICE.en.md',
  'docs/PRIVACY_POLICY.md', 'docs/PRIVACY_POLICY.en.md',
  'docs/DISCLAIMER.md', 'docs/DISCLAIMER.en.md',
  'lsp/typescript/lib/tsserver.js', 'lsp/typescript/lib/typescript.js', 'lsp/typescript-language-server/lib/cli.mjs',
  'sdk/mingshen-client.mjs', 'sdk/mingshen-acp.mjs', 'icon.png', 'icon.ico', 'THIRD_PARTY_NOTICES.md',
  'sdk/plugin-dev/mingshen-plugin.mjs', 'sdk/plugin-dev/README.md', 'docs/LOCAL_PLUGINS.md',
  ...bundledSkills,
])];
function sourcePath(item) {
  if (item.startsWith('docs/')) return path.resolve(desktop, '../..', item);
  if (item === 'THIRD_PARTY_NOTICES.md') return path.resolve(desktop, '../..', item);
  if (item.startsWith('icon.')) return path.join(desktop, 'build', item);
  return path.join(desktop, 'resources', item);
}

function isEmptyPackageResourceAllowed(item) {
  return (
    /^prompts\/skills\/work-sources\/entries\/[a-z0-9-]+\/.+/.test(item) &&
    path.posix.basename(item) !== 'SKILL.md'
  );
}

function check(root) {
  const version = require(path.join(desktop, 'package.json')).version;
  for (const item of required) {
    const file = root ? path.join(root, item) : sourcePath(item);
    const metadata = fs.existsSync(file) ? fs.statSync(file) : null;
    assert.ok(
      metadata &&
        metadata.isFile() &&
        (metadata.size > 0 || isEmptyPackageResourceAllowed(item)),
      `Missing, non-file, or empty package resource: ${file}`,
    );
    if (root && item.startsWith('prompts/skills/'))
      assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        createHash('sha256').update(fs.readFileSync(sourcePath(item))).digest('hex'), `Stale bundled skill resource: ${item}`);
    if (item.startsWith('docs/'))
      assert.ok(fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 5).join('\n').includes(version), `Stale embedded document version: ${item}`);
  }
  const skillsRoot = root
    ? path.join(root, 'prompts/skills')
    : path.join(desktop, 'resources/prompts/skills');
  const workSourceRoot = root ? null : path.resolve(desktop, '../../WorkAgentSkill');
  checkWorkSourceCatalog(skillsRoot, workSourceRoot);
  checkImportedSkillSources(
    skillsRoot,
    root ? null : path.resolve(desktop, '../..'),
  );
  const designManifestPath = 'prompts/skills/work-visual-design/references/design-entry-manifest.json';
  const designManifest = JSON.parse(fs.readFileSync(root ? path.join(root, designManifestPath) : sourcePath(designManifestPath), 'utf8'));
  assert.equal(designManifest.entryCount, 82, 'Incomplete bundled design entry manifest');
  assert.equal(designManifest.entries.length, designManifest.entryCount, 'Missing design resource entries');
  const designRoot = root ? path.join(root, 'prompts/skills/work-visual-design') : sourcePath('prompts/skills/work-visual-design');
  const designTargets = new Set();
  for (const entry of designManifest.entries) {
    assert.equal(typeof entry.targetResource, 'string', 'Missing design target');
    assert.ok(entry.targetResource.startsWith('references/design-resources/'), 'Design target outside bundled references');
    const target = path.resolve(designRoot, entry.targetResource);
    const local = path.relative(designRoot, target);
    assert.ok(local && local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local), 'Escaping design resource');
    assert.ok(!designTargets.has(target), 'Duplicate design resource target');
    designTargets.add(target);
    assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), `Missing design entry: ${entry.targetResource}`);
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
  checkTerminalRuntime(name => require.resolve(name, {paths:[unpacked]}), unpacked);
  checkImageRuntime(name => require.resolve(name, {paths:[unpacked]}), unpacked);
  checkImageNotices(name => require.resolve(name, {paths:[desktop]}), {
    resources,
    resolvePackaged: name => require.resolve(name, {paths:[unpacked]}),
  });
  checkPackagedAuthoringRuntime(archive, unpacked, files, asar);
  console.log('Packaged application resource validation passed.');
};
if (require.main === module) {
  checkElectronRuntime();
  check(null);
  const pkg = require(path.join(desktop, 'package.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(require(path.resolve(desktop, '../../package.json')).version, pkg.version, 'Workspace version mismatch');
  assert.ok(fs.readFileSync(path.join(desktop, 'src/shared/release.ts'), 'utf8').includes(`APP_VERSION = "${pkg.version}"`), 'Application version mismatch');
  for (const dependency of Object.keys(pkg.dependencies))
    assert.ok([desktop, path.resolve(desktop, '../..')].some(root => fs.existsSync(path.join(root, 'node_modules', dependency, 'package.json'))), `Missing dependency: ${dependency}`);
  checkParsers(name => require.resolve(name, {paths:[desktop]}));
  checkDocumentRuntime(name => require.resolve(name, {paths:[desktop]}));
  checkTerminalRuntime(name => require.resolve(name, {paths:[desktop]}));
  checkImageRuntime(name => require.resolve(name, {paths:[desktop]}));
  checkImageNotices(name => require.resolve(name, {paths:[desktop]}));
  checkAuthoringRuntime(name => require.resolve(name, {paths:[desktop]}));
  console.log(`Packaging preflight passed: ${required.length} resources, production dependencies and version ${pkg.version}.`);
}

module.exports.checkAuthoringRuntime = checkAuthoringRuntime;
module.exports.checkPackagedAuthoringRuntime = checkPackagedAuthoringRuntime;
module.exports.checkTerminalRuntime = checkTerminalRuntime;
module.exports.checkImageRuntime = checkImageRuntime;
module.exports.checkImageNotices = checkImageNotices;
module.exports.checkWorkSourceCatalog = checkWorkSourceCatalog;
module.exports.checkImportedSkillSources = checkImportedSkillSources;
module.exports.importedSkillTreeDescriptor = importedSkillTreeDescriptor;
module.exports.inventoryWorkSkills = inventoryWorkSkills;
module.exports.isEmptyPackageResourceAllowed = isEmptyPackageResourceAllowed;
