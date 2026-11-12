const { homedir } = require('node:os');
const path = require('node:path');

function packageCacheRoot(environment = process.env) {
  return path.join(
    environment.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
    'MingshenHarness', 'BuildCache',
  );
}

function assertChildPath(root, target) {
  const local = path.relative(path.resolve(root), path.resolve(target));
  if (!local || path.isAbsolute(local) || local === '..' || local.startsWith(`..${path.sep}`))
    throw new Error(`Unsafe packaging path: ${target}`);
}

module.exports = { packageCacheRoot, assertChildPath };
