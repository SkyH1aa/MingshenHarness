const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');
const { assertChildPath } = require('./package-paths.cjs');

const execute = promisify(execFile);

function nativeCopyFor(buildRoot) {
  return async (source, destination) => {
    assertChildPath(buildRoot, destination);
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32',
      'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await execute(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'package-native-copy.ps1'),
      '-Source', source, '-Destination', destination, '-BuildRoot', buildRoot,
    ], { windowsHide: true, timeout: 15_000, maxBuffer: 32_768 });
  };
}

module.exports = { nativeCopyFor };
