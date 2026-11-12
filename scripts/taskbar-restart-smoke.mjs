import assert from 'node:assert/strict';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const profile = resolve(`.tmp-taskbar-restart-${Date.now()}`);
const executable = resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe');
execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
const environment = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
await mkdir(profile, { recursive: true });
const extracted = resolve(profile, 'shell-icons');
await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  `& '${resolve('scripts/windows-icon-probe.ps1').replaceAll("'", "''")}' -Paths @('${resolve('apps/desktop/build/icon.ico').replaceAll("'", "''")}','${executable.replaceAll("'", "''")}') -OutputDirectory '${extracted.replaceAll("'", "''")}'`,
], { windowsHide: true, timeout: 12000 });
for (const size of ['large', 'small'])
  assert.deepEqual(await readFile(resolve(extracted, `MingshenHarnessExperimental.exe.${size}.png`)),
    await readFile(resolve(extracted, `icon.ico.${size}.png`)), 'Windows shell must extract the approved icon from the experimental executable');
console.log('PASS: Windows shell extracts the approved small and large executable icons.');
for (let round = 1; round <= 2; round++) {
  const child = spawn(executable, ['.', '--remote-debugging-port=9341'], { cwd: resolve('apps/desktop'), env: environment, windowsHide: false, stdio: 'ignore' });
  let socket;
  try {
    let target;
    for (let i = 0; i < 100; i++) {
      try { target = (await fetch('http://127.0.0.1:9341/json').then(r => r.json())).find(t => t.type === 'page'); } catch {}
      if (target) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(target, 'Main window must start');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => socket.addEventListener('open', r, { once: true }));
    let sequence = 0;
    const evaluate = expression => new Promise((done, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => reject(new Error('CDP timeout')), 5000);
      const receive = e => { const m = JSON.parse(String(e.data)); if (m.id !== id) return; clearTimeout(timeout); socket.removeEventListener('message', receive); m.error || m.result.exceptionDetails ? reject(new Error(JSON.stringify(m.error || m.result.exceptionDetails))) : done(m.result.result.value); };
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    await new Promise(r => setTimeout(r, 600));
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/windows-taskbar-probe.ps1'), '-ProcessId', String(child.pid), '-OutputDirectory', resolve(profile, `round-${round}`)], { timeout: 12000, windowsHide: true });
    console.log(`ROUND_${round}`, result.stdout.trim());
    await writeFile(resolve(profile, `round-${round}.json`), result.stdout);
    assert.ok(result.stdout.trim(), 'Windows must expose a visible application window');
    const window = JSON.parse(result.stdout.trim());
    assert.equal(window.appId, 'com.mingshen.harness.experimental.desktop');
    assert.equal(window.icon, `${executable},0`);
    assert.ok(window.small && window.big, 'Native window icons must be populated');
    await evaluate(`setTimeout(()=>{void window.mingshen.desktopAction('quit')},100);true`);
    console.log(`PASS: Clean experimental start ${round}.`);
    await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 2500))]);
  } finally { socket?.close(); child.kill(); }
}
console.log(`Evidence: ${profile}`);
