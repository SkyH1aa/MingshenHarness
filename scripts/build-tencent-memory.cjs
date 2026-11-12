const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const {
  TENCENT_MEMORY_VERSION,
  TENCENT_MEMORY_COMMIT,
  verifyTencentMemorySources,
  createTencentMemoryRuntimeManifest,
  checkTencentMemoryResources,
} = require('./tencent-memory-package.cjs');
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'third_party/tencentdb-agent-memory');
const output = path.join(root, 'apps/desktop/resources/tencentdb-memory');
const importRoot = process.argv[2];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
(async () => {
  const sourceRoot = path.resolve(importRoot || path.join(vendor, 'src'));
  if (importRoot) {
    for (const file of walk(importRoot).filter((file) => /\.(?:ts|js)$/.test(file))) {
      const relative = path.relative(importRoot, file);
      const target = path.join(vendor, 'src', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
  }
  const files = walk(sourceRoot).filter((file) => /\.(?:ts|js)$/.test(file));
  const manifest = importRoot
    ? { version: TENCENT_MEMORY_VERSION, commit: TENCENT_MEMORY_COMMIT, files: {} }
    : verifyTencentMemorySources(vendor);
  for (const file of files) {
    const relative = path.relative(sourceRoot, file).replaceAll(path.sep, '/');
    const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (importRoot) manifest.files[relative] = hash;
    else if (manifest.files[relative] !== hash) throw new Error(`Upstream integrity mismatch: ${relative}`);
  }
  if (importRoot) fs.writeFileSync(path.join(vendor, 'upstream.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const generated = path.resolve(output, 'upstream');
  if (!generated.startsWith(`${path.resolve(root)}${path.sep}`) || path.basename(generated) !== 'upstream')
    throw new Error('Unsafe generated runtime directory.');
  fs.rmSync(generated, { recursive: true, force: true });
  fs.mkdirSync(path.join(output, 'upstream', 'adapters'), { recursive: true });
  for (const file of ['disabled-runner.js', 'disabled-observability.js', 'disabled-embedding.js', 'tokenize.js'])
    fs.copyFileSync(path.join(vendor, 'adapters', file), path.join(output, 'upstream/adapters', file));
  const toolchain = path.dirname(require.resolve('electron-vite', { paths: [path.join(root, 'apps/desktop')] }));
  const { build } = await import(pathToFileURL(require.resolve('rolldown', { paths: [toolchain] })).href);
  const entry = (name) => path.join(sourceRoot, name);
  const originalPrompts = new Map([
    ['mingshen-original:l1-extraction', entry('core/prompts/l1-extraction.ts')],
    ['mingshen-original:l1-dedup', entry('core/prompts/l1-dedup.ts')],
  ]);
  const aliases = new Map([
    [entry('core/prompts/l1-extraction.ts'), path.join(vendor, 'adapters/generic-l1-extraction.js')],
    [entry('core/prompts/l1-dedup.ts'), path.join(vendor, 'adapters/generic-l1-dedup.js')],
    [entry('core/storage/local-backend.ts'), path.join(vendor, 'adapters/disabled-storage.mjs')],
    [entry('core/storage/adapter.ts'), path.join(vendor, 'adapters/disabled-storage.mjs')],
    [entry('utils/clean-context-runner.ts'), path.join(output, 'upstream/adapters/disabled-runner.js')],
    [entry('core/store/tokenize.ts'), path.join(output, 'upstream/adapters/tokenize.js')],
    [entry('core/store/embedding.ts'), path.join(output, 'upstream/adapters/disabled-embedding.js')],
    ...[
      'core/report/reporter.ts',
      'core/report/kafka-metric-producer.ts',
      'core/report/metric-tracking-l1-latency.ts',
      'core/memory-generation-log/store.ts',
      'core/memory-generation-log/best-effort.ts',
    ].map((name) => [entry(name), path.join(output, 'upstream/adapters/disabled-observability.js')]),
  ]);
  const loadedSources = new Set();
  await build({
    input: {
      'memory-store': entry('core/store/sqlite/memory-store.ts'),
      'l1-extractor': entry('core/record/l1-extractor.ts'),
      'l1-writer': entry('core/record/l1-writer.ts'),
      'memory-search': entry('core/tools/memory-search.ts'),
    },
    external: source => source.startsWith('node:') && source !== 'node:module',
    plugins: [{
      name: 'mingshen-memory-host-boundaries',
      resolveId(source, importer) {
        // Explicit original imports retain the chat prompts for the host model
        // runner. Named imports omit inactive team/work prompts from the bundle.
        if (originalPrompts.has(source)) return originalPrompts.get(source);
        if (source === 'node:module') return path.join(vendor, 'adapters/local-sqlite-loader.mjs');
        if (!importer || !source.startsWith('.')) return null;
        const candidate = path.resolve(path.dirname(importer), source).replace(/\.js$/, '.ts');
        return aliases.get(candidate) || null;
      },
      transform(_code, id) {
        const relative = path.relative(sourceRoot, id);
        if (!relative.startsWith('..') && !path.isAbsolute(relative))
          loadedSources.add(relative);
        return null;
      },
    }],
    output: { dir: path.join(output, 'upstream'), format: 'esm', entryFileNames: '[name].js', chunkFileNames: 'chunk-[hash].js' },
  });
  // Inlined modules may be omitted from emitted chunk metadata even though
  // rebuilding still needs their source. Record the loaded graph instead.
  const used = loadedSources;
  if (!used.size) throw new Error('No upstream modules were bundled.');
  if (importRoot) {
    // Explicit vendoring retains only the original dependency closure. Ordinary
    // builds verify these bytes and never remove or rewrite vendored sources.
    for (const file of walk(path.join(vendor, 'src'))) {
      const relative = path.relative(path.join(vendor, 'src'), file);
      if (!used.has(relative)) fs.unlinkSync(file);
    }
    manifest.files = {};
    for (const relative of used) {
      const file = path.join(vendor, 'src', relative);
      if (fs.existsSync(file))
        manifest.files[relative.replaceAll(path.sep, '/')] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
    fs.writeFileSync(path.join(vendor, 'upstream.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(output, 'package.json'), '{"type":"module","private":true}\n');
  for (const file of ['LICENSE', 'NOTICE.md', 'upstream.json']) fs.copyFileSync(path.join(vendor, file), path.join(output, file));
  fs.writeFileSync(path.join(output, 'runtime.json'), `${JSON.stringify(createTencentMemoryRuntimeManifest(output), null, 2)}\n`);
  checkTencentMemoryResources(output, { vendor });
  console.log(`TencentDB Agent Memory v${manifest.version}: ${Object.keys(manifest.files).length} verified source modules, bundled L1 core with host model runner.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
