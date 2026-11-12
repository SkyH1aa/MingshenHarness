const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { packageCacheRoot, assertChildPath } = require('./package-paths.cjs');

test('builds inside the user LocalAppData rather than the project or Documents', () => {
  const local = path.resolve('fixture-user', 'AppData', 'Local');
  assert.equal(packageCacheRoot({ LOCALAPPDATA: local }), path.join(local, 'MingshenHarness', 'BuildCache'));
});

test('provides a user-local cache when LOCALAPPDATA is unset', () => {
  assert.equal(path.isAbsolute(packageCacheRoot({})), true);
  assert.equal(packageCacheRoot({}).endsWith(path.join('AppData', 'Local', 'MingshenHarness', 'BuildCache')), true);
});

test('rejects cleanup of the cache root, a sibling or a parent path', () => {
  const root = path.resolve('fixture-cache');
  for (const target of [root, path.dirname(root), path.resolve('fixture-cache-other')])
    assert.throws(() => assertChildPath(root, target), /Unsafe packaging path/);
  assert.doesNotThrow(() => assertChildPath(root, path.join(root, 'build', 'electron')));
});
