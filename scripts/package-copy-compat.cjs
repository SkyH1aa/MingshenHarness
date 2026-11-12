const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { copyRuntimeFile } = require('./package-runtime-copy.cjs');
const { nativeCopyFor } = require('./package-native-copy.cjs');
const { packageCacheRoot, assertChildPath } = require('./package-paths.cjs');

const root = process.env.MSH_PACKAGE_BUILD_ROOT;
if (!root) throw new Error('Missing build workspace for packaging copy compatibility.');
assertChildPath(packageCacheRoot(), root);
const originalPromiseCopy = fsPromises.copyFile.bind(fsPromises);
const nativeCopy = nativeCopyFor(root);
const runtimeRoot = process.env.MSH_PACKAGE_ELECTRON_ROOT;
if (runtimeRoot) assertChildPath(root, runtimeRoot);
const runtimeHosts = new Map();
const runtimeDeployments = new Map();
const allowed = target => {
  if (typeof target !== 'string') return false;
  const local = path.relative(root, path.resolve(target));
  return local && !path.isAbsolute(local) && local !== '..' && !local.startsWith(`..${path.sep}`);
};
const fallback = (error, source, destination) => {
  if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || !allowed(destination)) throw error;
  console.warn(`Recovering build copy: ${path.basename(destination)} (${error.code})`);
  return copyRuntimeFile(source, destination, { copyFile: originalPromiseCopy, nativeCopy });
};

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function deployRuntimeFile(source, destination) {
  assertChildPath(root, source);
  assertChildPath(root, destination);
  const expected = await hashFile(source);
  try {
    // Both paths belong to this build. Move the verified staging file once.
    await fsPromises.rename(source, destination);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
    await copyRuntimeFile(source, destination, { copyFile: originalPromiseCopy, nativeCopy });
  }
  if (await hashFile(destination) !== expected)
    throw new Error(`Runtime deployment integrity check failed: ${destination}`);
}

async function copyForBuild(source, destination, flags) {
  const runtimeFile = runtimeRoot && allowed(destination) && typeof source === 'string' &&
    path.resolve(path.dirname(source)).toLowerCase() === path.resolve(runtimeRoot).toLowerCase();
  if (runtimeFile) {
    const directory = path.dirname(destination);
    let host = runtimeHosts.get(directory);
    if (!host) {
      host = deployRuntimeFile(path.join(runtimeRoot, 'electron.exe'), path.join(directory, 'electron.exe'));
      runtimeHosts.set(directory, host);
    }
    await host;
    if (path.basename(destination).toLowerCase() === 'electron.exe') return;
    let deployment = runtimeDeployments.get(destination);
    if (!deployment) {
      deployment = deployRuntimeFile(source, destination);
      runtimeDeployments.set(destination, deployment);
    }
    await deployment;
    return;
  }
  try {
    await originalPromiseCopy(source, destination, flags);
  } catch (error) {
    await fallback(error, source, destination);
  }
}

// Limit the compatibility path to electron-builder's private build directory.
fs.copyFile = (source, destination, flags, callback) => {
  if (typeof flags === 'function') { callback = flags; flags = 0; }
  copyForBuild(source, destination, flags ?? 0).then(() => callback(null), callback);
};
fsPromises.copyFile = copyForBuild;
