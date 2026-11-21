const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { builtinModules, createRequire, isBuiltin, Module } = require('node:module');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');
const { tmpdir } = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { finished } = require('node:stream/promises');
const { promisify } = require('node:util');

const builtins = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));
const pause = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const execFileAsync = promisify(execFile);

function inside(parent, child) {
  const local = relative(parent, child);
  return Boolean(local && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local));
}

async function processGone(pid) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESOENT' || error.code === 'ESRCH') return true;
      throw error;
    }
    await pause(50);
  }
  return false;
}

async function exercisePty(pty, directory, stateFile) {
  let terminal;
  let exited = false;
  let exitPromise;
  let timer;
  const marker = `FEATURE_ASAR_${randomUUID().replaceAll('-', '')}`;
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ marker, pid: null, confirmed: false }));
    terminal = pty.spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `[Console]::Out.WriteLine("${marker}_READY"); $line=[Console]::In.ReadLine(); [Console]::Out.WriteLine("${marker}_INPUT=" + $line); Start-Sleep -Milliseconds 100`,
    ], {
      name: 'xterm-256color', cols: 100, rows: 30, cwd: directory, useConpty: true,
      env: {
        PATH: process.env.PATH, PATHEXT: process.env.PATHEXT,
        SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        COMSPEC: process.env.COMSPEC, TEMP: process.env.TEMP, TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
      },
    });
    const pid = terminal.pid;
    assert.ok(Number.isInteger(pid) && pid > 0, 'PTY did not return an owned PID.');
    fs.writeFileSync(stateFile, JSON.stringify({ marker, pid, confirmed: false }));
    let text = '';
    let inputSent = false;
    let resized = false;
    exitPromise = new Promise(resolveExit => terminal.onExit(event => {
      exited = true;
      resolveExit(event);
    }));
    let rejectData;
    const dataError = new Promise((_resolve, reject) => { rejectData = reject; });
    terminal.onData(data => {
      try {
        text += data;
        if (!inputSent && text.includes(`${marker}_READY`)) {
          inputSent = true;
          terminal.resize(120, 40);
          resized = true;
          terminal.write('fixture-input\r');
        }
      } catch (error) { rejectData(error); }
    });
    const event = await Promise.race([
      exitPromise,
      dataError,
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PTY fixture timed out.')), 12000); }),
    ]);
    assert.equal(event.exitCode, 0, `PTY returned ${event.exitCode}: ${text}`);
    assert.ok(inputSent && resized, 'PTY input/resize was not exercised.');
    assert.ok(text.includes(`${marker}_INPUT=fixture-input`), 'PTY input was not echoed.');
    assert.ok(await processGone(pid), 'PTY process remained after exit.');
    fs.writeFileSync(stateFile, JSON.stringify({ marker, pid, confirmed: true }));
    return { pid, input: true, resize: '100x30 -> 120x40', exitCode: event.exitCode, processGone: true };
  } finally {
    clearTimeout(timer);
    if (terminal && !exited) {
      terminal.kill();
      const observed = await Promise.race([exitPromise.then(() => true), pause(5000).then(() => false)]);
      if (!observed || !await processGone(terminal.pid)) throw new Error('Fixture PTY cleanup was not confirmed.');
      fs.writeFileSync(stateFile, JSON.stringify({ marker, pid: terminal.pid, confirmed: true }));
    }
  }
}

async function probe() {
  const [, , , archive, userData, sessionData, result] = process.argv;
  const { app, session } = require('electron');
  app.setPath('userData', userData);
  app.setPath('sessionData', sessionData);
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  globalThis.fetch = async () => { throw new Error('Network is disabled in the ASAR fixture.'); };
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
  const requireArchive = createRequire(join(archive, 'fixture.cjs'));
  const originalResolve = Module._resolveFilename;
  const resolved = {};
  Module._resolveFilename = function(request, parent, ...rest) {
    const filename = originalResolve.call(this, request, parent, ...rest);
    if (!isBuiltin(request) && request !== 'electron')
      assert.ok(inside(archive, filename) || inside(`${archive}.unpacked`, filename), `Dependency escaped fixture: ${request} -> ${filename}`);
    return filename;
  };
  try {
    for (const name of ['sharp', '@img/sharp-win32-x64/sharp.node', 'node-pty', 'diff', 'gifenc'])
      resolved[name] = requireArchive.resolve(name);
    const sharp = requireArchive('sharp');
    const pty = requireArchive('node-pty');
    const diff = requireArchive('diff');
    const { GIFEncoder } = requireArchive('gifenc');
    assert.equal(sharp.versions.sharp, '0.35.5');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const decoded = await sharp(png, { failOn: 'warning' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 1);
    assert.equal(decoded.info.height, 1);
    assert.equal(decoded.data.length, 4);
    const changes = diff.diffLines('old\n', 'new\n');
    assert.ok(changes.some(part => part.removed && part.value === 'old\n'));
    assert.ok(changes.some(part => part.added && part.value === 'new\n'));
    const encoder = GIFEncoder();
    encoder.writeFrame(Uint8Array.from([0, 1, 1, 0]), 2, 2, { palette: [[255, 0, 0], [0, 0, 255]], delay: 100 });
    encoder.finish();
    const gif = await sharp(Buffer.from(encoder.bytesView()), { failOn: 'warning' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(gif.info.width, 2);
    assert.equal(gif.info.height, 2);
    assert.equal(gif.data.length, 16);
    const terminal = await exercisePty(pty, userData, join(dirname(result), 'pty-state.json'));
    fs.writeFileSync(result, JSON.stringify({ ok: true, electron: process.versions.electron, sharp: sharp.versions.sharp, png: '1x1 RGBA', gif: '2x2 RGBA', diff: true, terminal, resolved }));
  } finally {
    Module._resolveFilename = originalResolve;
  }
  app.quit();
}

function resolvePackage(resolver, name) {
  for (const candidate of [`${name}/package.json`, `${name}/package`, name]) {
    try { return resolver.resolve(candidate); } catch (error) {
      if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    }
  }
  throw new Error(`Missing runtime package: ${name}`);
}

async function confirmPtyCleanup(stateFile) {
  let state;
  try {
    state = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (state.confirmed) return;
  assert.match(state.marker, /^FEATURE_ASAR_[0-9a-f]{32}$/, 'Invalid PTY ownership marker.');
  if (!Number.isSafeInteger(state.pid) || state.pid <= 0)
    throw new Error('PTY creation was interrupted before its PID was recorded.');
  if (await processGone(state.pid)) return;
  const script = [
    `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${state.pid}' -ErrorAction Stop`,
    'if (-not $p) { exit 0 }',
    `if (-not $p.CommandLine.Contains('${state.marker}')) { exit 42 }`,
    `& "$env:SystemRoot\\System32\\taskkill.exe" /PID ${state.pid} /T /F`,
    'exit $LASTEXITCODE',
  ].join('; ');
  await execFileAsync(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 });
  assert.ok(await processGone(state.pid), 'Owned PTY process remained after fallback cleanup.');
}

async function main() {
  assert.equal(process.platform, 'win32', 'The native fixture requires Windows.');
  assert.equal(process.arch, 'x64', 'The native fixture requires Windows x64.');
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--archive'), 'Usage: node feature-asar-smoke.cjs [--archive <app.asar>]');
  const packagedArchive = args.length ? await fsp.realpath(resolve(args[1])) : null;
  if (packagedArchive) assert.ok((await fsp.stat(packagedArchive)).isFile(), 'Packaged ASAR is missing.');
  const desktop = resolve(__dirname, '../apps/desktop');
  const requireApp = createRequire(join(desktop, 'package.json'));
  const asar = createRequire(requireApp.resolve('app-builder-lib'))('@electron/asar');
  const temporary = await fsp.mkdtemp(join(tmpdir(), 'mingshen-feature-asar-'));
  const target = await fsp.realpath(temporary);
  const tempRoot = await fsp.realpath(tmpdir());
  assert.ok(inside(tempRoot, target), 'Fixture directory escaped the temp root.');
  let child;
  let childClosed = true;
  try {
    const archive = packagedArchive || join(target, 'app.asar');
    if (!packagedArchive) {
      const source = join(target, 'source');
      const modules = join(source, 'node_modules');
      await fsp.mkdir(modules, { recursive: true });
      const copied = new Map();
      async function copyPackage(name, base, parent = source) {
        const resolver = createRequire(join(base, 'package.json'));
        let directory = dirname(resolvePackage(resolver, name));
        while (!fs.existsSync(join(directory, 'package.json'))) {
          const next = dirname(directory);
          if (next === directory) throw new Error(`Cannot locate package manifest: ${name}`);
          directory = next;
        }
        const pkg = JSON.parse(fs.readFileSync(join(directory, 'package.json'), 'utf8'));
        assert.equal(pkg.name, name, `Unexpected package root: ${name}`);
        const rootTarget = join(modules, name);
        const destination = copied.has(rootTarget) && copied.get(rootTarget) !== pkg.version
          ? join(parent, 'node_modules', name) : rootTarget;
        if (copied.has(destination)) {
          assert.equal(copied.get(destination), pkg.version, `Conflicting dependency: ${name}`);
          return;
        }
        copied.set(destination, pkg.version);
        await fsp.cp(directory, destination, {
          recursive: true, filter: path => !relative(directory, path).split(/[\\/]/).includes('node_modules'),
        });
        for (const dependency of Object.keys(pkg.dependencies || {}))
          if (!builtins.has(dependency) && !dependency.startsWith('@types/'))
            await copyPackage(dependency, directory, destination);
      }
      for (const name of ['sharp', '@img/sharp-win32-x64', 'node-pty', 'diff', 'gifenc'])
        await copyPackage(name, desktop);
      for (const [name, version] of Object.entries({ sharp: '0.35.5', '@img/sharp-win32-x64': '0.35.5', 'node-pty': '1.1.0', diff: '9.0.0', gifenc: '1.0.3' }))
        assert.equal(copied.get(join(modules, name)), version, `Unexpected version: ${name}`);
      const stream = await asar.createPackageWithOptions(source, archive, {
        unpackDir: 'node_modules/{sharp,@img,detect-libc,semver,node-pty}{,/**}',
      });
      await finished(stream);
    }
    const unpacked = `${archive}.unpacked`;
    for (const name of [
      'sharp/package.json', 'sharp/LICENSE', '@img/colour/package.json', 'detect-libc/package.json', 'semver/package.json',
      '@img/sharp-win32-x64/LICENSE',
      '@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node',
      '@img/sharp-win32-x64/lib/libvips-42.dll', '@img/sharp-win32-x64/lib/libvips-cpp-8.18.7.dll',
      'node-pty/package.json', 'node-pty/LICENSE', 'node-pty/prebuilds/win32-x64/conpty.node',
      'node-pty/prebuilds/win32-x64/conpty_console_list.node', 'node-pty/lib/conpty_console_list_agent.js',
      'node-pty/prebuilds/win32-x64/conpty/conpty.dll', 'node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
      'node-pty/prebuilds/win32-x64/winpty.dll', 'node-pty/prebuilds/win32-x64/winpty-agent.exe',
    ]) assert.ok((await fsp.stat(join(unpacked, 'node_modules', name))).size > 0, `Missing unpacked runtime: ${name}`);
    if (packagedArchive) {
      const notices = join(dirname(archive), 'third-party-notices', 'sharp-win32-x64');
      assert.ok(['app-local-README.md', 'workspace-README.md'].some(name => fs.existsSync(join(notices, name))), 'Packaged sharp notices are missing.');
    } else {
      assert.ok((await fsp.stat(join(unpacked, 'node_modules/@img/sharp-win32-x64/README.md'))).size > 0, 'Fixture sharp README is missing.');
    }
    for (const name of ['diff', 'gifenc'])
      assert.ok(!fs.existsSync(join(unpacked, 'node_modules', name)), `${name} should remain in ASAR.`);

    const profile = join(target, 'profile');
    const userData = join(profile, 'userdata');
    const sessionData = join(profile, 'session');
    const temp = join(profile, 'temp');
    const roaming = join(profile, 'roaming');
    const local = join(profile, 'local');
    await Promise.all([userData, sessionData, temp, roaming, local].map(path => fsp.mkdir(path, { recursive: true })));
    const result = join(target, 'result.json');
    const probeFile = join(target, 'probe.cjs');
    await fsp.copyFile(__filename, probeFile);
    const env = {
      PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR, COMSPEC: process.env.COMSPEC, USERPROFILE: profile,
      HOME: profile, APPDATA: roaming, LOCALAPPDATA: local, TEMP: temp, TMP: temp, NODE_PATH: '',
    };
    const electron = join(dirname(requireApp.resolve('electron/package.json')), 'dist', 'electron.exe');
    childClosed = false;
    child = spawn(electron, [probeFile, '--probe', archive, userData, sessionData, result], {
      env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 45000);
    const code = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', code => { childClosed = true; resolveExit(code); });
    }).finally(() => clearTimeout(timeout));
    const output = JSON.parse(await fsp.readFile(result, 'utf8').catch(() => JSON.stringify({ error: stderr })));
    assert.ok(!timedOut, 'Electron fixture timed out.');
    assert.equal(code, 0, JSON.stringify(output));
    assert.equal(output.ok, true, JSON.stringify(output));
    console.log(JSON.stringify(output, null, 2));
    console.log(packagedArchive
      ? 'Packaged ASAR runtime probe passed in isolated Electron; NSIS installation was not exercised.'
      : 'Isolated Electron ASAR fixture passed; this is not an electron-builder package or installer.');
  } finally {
    if (child && !childClosed) {
      child.kill();
      await Promise.race([new Promise(resolveClose => child.once('close', resolveClose)), pause(5000)]);
      if (!childClosed) throw new Error(`Electron cleanup was not confirmed; fixture retained at ${target}`);
    }
    try {
      await confirmPtyCleanup(join(target, 'pty-state.json'));
    } catch (error) {
      throw new Error(`PTY cleanup was not confirmed; fixture retained at ${target}: ${error.message}`);
    }
    const current = await fsp.realpath(target);
    assert.equal(current, target, 'Fixture path changed before cleanup.');
    assert.ok(inside(tempRoot, current), 'Fixture cleanup escaped the temp root.');
    await fsp.rm(current, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv[2] === '--probe') {
  probe().catch(error => {
    const result = process.argv[6];
    if (result) fs.writeFileSync(result, JSON.stringify({ error: String(error), stack: error.stack }));
    require('electron').app.exit(1);
  });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
