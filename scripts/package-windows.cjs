const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { copyRuntimeFile } = require('./package-runtime-copy.cjs');
const { packageCacheRoot, assertChildPath } = require('./package-paths.cjs');
const { nativeCopyFor } = require('./package-native-copy.cjs');
const { createUpdateZip } = require('./create-update-zip.cjs');

const workspace = path.resolve(__dirname, '..');
const desktop = path.join(workspace, 'apps', 'desktop');
const packageManager = require(path.join(workspace, 'package.json')).packageManager;
const applicationVersion = require(path.join(desktop, 'package.json')).version;

async function copyRuntimeDirectory(source, destination, nativeCopy) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyRuntimeDirectory(from, to, nativeCopy);
    else if (entry.isFile()) await copyRuntimeFile(from, to, { nativeCopy });
    else throw new Error(`Unexpected link in Electron runtime: ${from}`);
  }
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'boolean', default: false } } });
  const electronPackage = require.resolve('electron/package.json', { paths: [desktop] });
  const electron = require(electronPackage);
  const installed = path.join(path.dirname(electronPackage), 'dist');
  const version = (await fs.readFile(path.join(installed, 'version'), 'utf8')).trim();
  if (version !== electron.version) throw new Error('Installed Electron runtime version mismatch. Run pnpm install.');
  const cacheRoot = packageCacheRoot();
  await fs.mkdir(cacheRoot, { recursive: true });
  const buildRoot = await fs.mkdtemp(path.join(cacheRoot, `windows-${applicationVersion}-`));
  const staging = path.join(buildRoot, 'electron');
  const output = path.join(buildRoot, 'output');
  const temporary = path.join(buildRoot, 'temp');
  await fs.mkdir(staging);
  await fs.mkdir(temporary);
  const nativeCopy = nativeCopyFor(buildRoot);
  console.log(`Node: ${process.execPath} (${process.version})`);
  console.log(`Build workspace: ${buildRoot}`);
  console.log('Electron DLLs and the unpacked application are built in LocalAppData.');
  try {
    // Place the Electron host before copying its companion DLLs.
    await copyRuntimeFile(path.join(installed, 'electron.exe'), path.join(staging, 'electron.exe'), { nativeCopy });
    // Stage the original distribution only; development executables and probes stay out.
    for (const entry of await fs.readdir(installed, { withFileTypes: true })) {
      if (entry.name === 'electron.exe') continue;
      if (!entry.isFile() || !(
        ['version', 'LICENSE', 'LICENSES.chromium.html'].includes(entry.name) ||
        /\.(?:dll|pak|bin|dat)$/i.test(entry.name) || entry.name === 'vk_swiftshader_icd.json'
      )) continue;
      let reported = false;
      await copyRuntimeFile(path.join(installed, entry.name), path.join(staging, entry.name), {
        nativeCopy,
        onFallback: code => {
          if (!reported) console.warn(`Retrying ${entry.name} with verified stream copy (${code}).`);
          reported = true;
        },
      });
    }
    await copyRuntimeDirectory(path.join(installed, 'locales'), path.join(staging, 'locales'), nativeCopy);
    await fs.mkdir(path.join(staging, 'resources'));
    for (const entry of ['electron.exe', 'vulkan-1.dll', 'resources.pak', 'icudtl.dat']) {
      if (!(await fs.stat(path.join(staging, entry))).size) throw new Error(`Missing Electron runtime: ${entry}`);
    }
    const cli = require.resolve('electron-builder/cli.js', { paths: [desktop] });
    console.log(`Using installed Electron ${version}; experimental executables are excluded.`);
    const code = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [
        '--require', path.join(__dirname, 'package-copy-compat.cjs'),
        cli, '--win', '--x64', '--publish', 'never',
        `--config.electronDist=${staging}`, `--config.directories.output=${output}`,
        ...(values.dir ? ['--dir'] : []),
      ], {
        cwd: desktop, stdio: 'inherit', windowsHide: true,
        env: {
          ...process.env, npm_config_user_agent: packageManager.replace('@', '/'),
          TEMP: temporary, TMP: temporary, MSH_PACKAGE_BUILD_ROOT: buildRoot,
          MSH_PACKAGE_ELECTRON_ROOT: staging,
        },
      });
      child.once('error', reject);
      child.once('close', status => done(status ?? 1));
    });
    process.exitCode = code;
    if (code !== 0) {
      console.error(`Build files retained for diagnostics: ${buildRoot}`);
      return;
    }
    if (values.dir) {
      const executable = path.join(output, 'win-unpacked', 'MingshenHarness.exe');
      if (!(await fs.stat(executable)).size) throw new Error('Packaged executable is missing.');
      console.log(`Unpacked application verified: ${executable}`);
      return;
    }
    const installerName = `MingshenHarness-${applicationVersion}-x64.exe`;
    const installer = path.join(output, installerName);
    if (!(await fs.stat(installer)).size) throw new Error(`Installer is missing: ${installer}`);
    const releases = path.join(desktop, 'release-artifacts');
    try {
      await fs.mkdir(releases, { recursive: true });
      await copyRuntimeFile(installer, path.join(releases, installerName));
      console.log(`Installer output: ${path.join(releases, installerName)}`);
      for (const name of [`${installerName}.blockmap`, 'latest.yml']) {
        if (await fs.stat(path.join(output, name)).then(() => true, () => false))
          await copyRuntimeFile(path.join(output, name), path.join(releases, name));
      }
    } catch (error) {
      console.warn(`Installer was built, but copying to the project failed (${error.code ?? error.message}).`);
      console.warn(`Use the verified installer here: ${installer}`);
    }
    console.log(`Cached installer: ${installer}`);
    const zip = await createUpdateZip(installer);
    for (const suffix of ['', '.sha256', '.json']) {
      await copyRuntimeFile(`${zip.archive}${suffix}`, path.join(releases, `${path.basename(zip.archive)}${suffix}`))
        .catch(error => console.warn(`Update artifact retained in build cache: ${zip.archive}${suffix} (${error.code ?? error.message})`));
    }
  } catch (error) {
    console.error(`Build files retained for diagnostics: ${buildRoot}`);
    throw error;
  } finally {
    assertChildPath(cacheRoot, buildRoot);
    assertChildPath(buildRoot, staging);
    await fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      .catch(error => console.warn(`Temporary runtime retained: ${staging} (${error.code})`));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
