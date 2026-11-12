import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-v123-'));
const taskRoot = resolve(temporary, 'project');
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const failures = [];
const passed = [];
let activeChildren = 0;
let maxChildren = 0;
let childRequests = 0;
let parentRounds = 0;
let releaseChildren = false;
let parentWorkedDuringChildren = false;
let scenario = 'parallel';
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const end = () => { event({ type: 'response.completed', response: { usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 } } }); response.end(); };
  const call = (index, name, args) => {
    event({ type: 'response.output_item.added', output_index: index, item: { type: 'function_call', call_id: `${name}-${parentRounds}-${index}`, name, arguments: '' } });
    event({ type: 'response.function_call_arguments.delta', output_index: index, delta: JSON.stringify(args) });
  };
  try {
    const instructions = String(body.instructions || '');
    const runtimeText = instructions.slice(instructions.indexOf('# 宿主提供的运行事实'));
    const runtime = JSON.parse(/```json\s*([\s\S]*?)```/.exec(runtimeText)?.[1] || '{}');
    if (runtime.agent_depth === 1) {
      childRequests += 1;
      activeChildren += 1;
      maxChildren = Math.max(maxChildren, activeChildren);
      if (body.tools.some(tool => ['spawn_subagent', 'wait_subagents'].includes(tool.name))) failures.push('Child can recursively delegate');
      if (!instructions.includes('# 子 Agent 职责')) failures.push('Child prompt missing');
      let closed = false;
      response.on('close', () => { closed = true; });
      const deadline = Date.now() + 20000;
      while (!releaseChildren && !closed && Date.now() < deadline) await sleep(50);
      await sleep(200);
      activeChildren -= 1;
      if (closed) return;
      event({ type: 'response.output_text.delta', delta: 'Verified child evidence.' });
      end();
      return;
    }
    parentRounds += 1;
    if (parentRounds === 1) {
      if (!instructions.includes('应主动识别') || runtime.subagents?.max_concurrent !== 2) failures.push('Missing proactive policy or configured limit');
      for (let index = 0; index < 4; index++) call(index, 'spawn_subagent', { task: `Independently inspect module ${index}`, agent: 'explore', label: `Inspection ${index}` });
    } else if (scenario === 'cancel') {
      call(0, 'wait_subagents', {});
    } else if (parentRounds === 2) {
      for (let count = 0; count < 100 && activeChildren === 0; count++) await sleep(50);
      parentWorkedDuringChildren = activeChildren > 0;
      call(0, 'list_files', { path: '.' });
    } else if (parentRounds === 3) {
      releaseChildren = true;
      call(0, 'wait_subagents', {});
    } else {
      if (!JSON.stringify(body.input).includes('Verified child evidence')) failures.push('Parent did not receive child results');
      event({ type: 'response.output_text.delta', delta: 'Reviewed all four child results and completed independent work.' });
    }
    end();
  } catch (cause) { failures.push(String(cause)); end(); }
});
let child;
let renderer;
let main;
async function connect(port) {
  let target;
  for (let index = 0; index < 100; index++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(result => result.json())).find(item => item.webSocketDebuggerUrl); if (target) break; } catch {}
    await sleep(100);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(String(event.data)); const handler = pending.get(message.id); if (handler) { pending.delete(message.id); clearTimeout(handler.timer); message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result); } });
  const send = (method, params = {}) => new Promise((done, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 35000); pending.set(id, { resolve: done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { try { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; } catch (cause) { throw new Error(`Failed: ${expression.slice(0, 180)}`, { cause }); } };
  return { send, evaluate, close: () => socket.close() };
}
try {
  await mkdir(taskRoot);
  await writeFile(resolve(taskRoot, 'readme.txt'), 'Independent collaboration fixture.\n');
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const modelPort = server.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9344', '.', '--remote-debugging-port=9338'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9344);
  await main.evaluate(`globalThis.__originalFetch = fetch; globalThis.__authorize = false; globalThis.__openedUrls = []; globalThis.__codeVisibleBeforeOpen = false;
    globalThis.fetch = async (url, options) => {
      const value = String(url);
      if(value.includes('/rest/v1/rpc/')) return Response.json([]);
      if(value === 'https://github.com/login/device/code') return Response.json({ device_code: 'private-fixture-code', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
      if(value === 'https://github.com/login/oauth/access_token') return Response.json(globalThis.__authorize ? { access_token: 'fixture-oauth-token' } : { error: 'authorization_pending' });
      if(value === 'https://api.github.com/user') return Response.json({ login: 'fixture-user', name: 'Fixture User' });
      return globalThis.__originalFetch(url, options);
    };
    globalThis.__electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
    globalThis.__electron.shell.openExternal = async url => { globalThis.__openedUrls.push(url); globalThis.__codeVisibleBeforeOpen = await globalThis.__electron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript("Boolean(document.querySelector('.github-device-code code')?.textContent === 'ABCD-1234')"); };
    true`);
  renderer = await connect(9338);
  const { evaluate, send } = renderer;
  const until = async (expression, timeout = 15000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timed out: ${expression}`); };
  const click = async (selector, text) => { await until(`Boolean([...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)}))`); await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)}).click(); true`); };
  const screenshot = async name => { await sleep(200); const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(result.data, 'base64')); };
  await until("Boolean(document.querySelector('.policy-consents'))");
  await sleep(5100);
  await evaluate("document.querySelectorAll('.policy-consents input').forEach(el => el.click()); true");
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  assert.equal((await evaluate('window.mingshen.getAppInfo()')).version, version);
  const session = await evaluate(`(async () => {
    const provider = await window.mingshen.createProvider({ name: 'Fixture', baseUrl: 'http://127.0.0.1:${modelPort}/v1', protocol: 'openai_responses', authMode: 'bearer', apiKey: 'dummy-key', keyLabel: 'Fixture', neverReveal: true });
    const p = await window.mingshen.createModel({ providerId: provider.id, modelId: 'fixture-model', displayName: 'Fixture model', contextWindow: 128000, maxOutputTokens: 4096, inputModalities: ['text'], toolCalls: true, parallelToolCalls: true, reasoningLevels: ['low'], anthropicNoneBehavior: 'disabled' });
    const session = await window.mingshen.createSession({ title: '这是一个很长的会话名称'.repeat(8), providerId: provider.id, modelId: p.models[0].id, workspacePath: ${JSON.stringify(taskRoot)}, reasoningLevel: 'low', permissionMode: 'full_access' });
    await window.mingshen.setAgentRuntimeSettings({ maxConcurrentSubagents: 2 });
    return session;
  })()`);
  await send('Page.reload');
  await until("Boolean(document.querySelector('.session-row'))");
  await evaluate("document.querySelector('button[aria-label=\"打开设置\"]').click(); true");
  await click('.settings-nav__item', '快照与轨迹');
  await until("Boolean(document.querySelector('.runtime-history-session select'))");
  const checkLayout = async () => {
    const layout = await evaluate("(() => {const root=document.querySelector('.settings-content');const select=document.querySelector('.runtime-history-session select');const heading=document.querySelector('.runtime-history-settings h3');return {width:root.clientWidth,scroll:root.scrollWidth,select:select.getBoundingClientRect().height,heading:heading.getBoundingClientRect().width};})()");
    assert.ok(layout.scroll <= layout.width + 1 && layout.select <= 44 && layout.heading > 150, JSON.stringify(layout));
    assert.equal(await evaluate("(() => { const nav=document.querySelector('.settings-nav nav').getBoundingClientRect(); const footer=document.querySelector('.settings-nav__footer').getBoundingClientRect(); return nav.bottom <= footer.top + 1; })()"), true);
  };
  await checkLayout();
  await screenshot('v123-history-zh-night');
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click(); document.documentElement.dataset.theme='day'; true");
  await checkLayout();
  await screenshot('v123-history-en-day-compact');
  passed.push('Snapshots and Traces: long titles, compact window, Chinese/English and day/night layout');
  await click('.settings-nav__item', 'GitHub integration');
  await click('.github-plugin-settings button', 'Authorize in browser');
  await until("document.querySelector('.github-device-code code')?.textContent === 'ABCD-1234'");
  await until("window.mingshen.getGitHubAuthorization().then(value => value?.userCode === 'ABCD-1234')");
  for (let count = 0; count < 30 && !(await main.evaluate('globalThis.__codeVisibleBeforeOpen')); count++) await sleep(100);
  assert.equal(await main.evaluate('globalThis.__codeVisibleBeforeOpen'), true);
  assert.deepEqual(await main.evaluate('globalThis.__openedUrls'), ['https://github.com/login/device']);
  await screenshot('v123-github-code-en');
  await click('.settings-nav__item', 'Snapshots and traces');
  await click('.settings-nav__item', 'GitHub integration');
  await until("document.querySelector('.github-device-code code')?.textContent === 'ABCD-1234'");
  await main.evaluate('globalThis.__authorize = true; true');
  await until("Boolean(document.querySelector('.github-plugin-account')?.textContent.includes('fixture-user'))", 20000);
  assert.equal((await evaluate('window.mingshen.getGitHubStatus()')).configured, true);
  passed.push('GitHub: code painted before browser open, restored after navigation, poll completes and credentials stored');
  await evaluate('(async () => { for (const server of await window.mingshen.listMcpServers()) if (server.enabled) await window.mingshen.setMcpServerEnabled(server.id, false); })()');
  await evaluate("document.querySelector('button[aria-label=\"Close settings\"]').click(); true");
  await evaluate(`window.__events=[];window.mingshen.onRuntimeEvent(event => window.__events.push(event));window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:'Investigate the independent project modules and verify the result.'})`);
  await until(`window.__events.some(event => event.sessionId === ${JSON.stringify(session.id)} && ['run_completed','run_failed'].includes(event.type))`, 90000);
  const events = await evaluate('window.__events');
  assert.ok(events.some(event => event.sessionId === session.id && event.type === 'run_completed'), JSON.stringify(events.filter(event => event.type === 'run_failed')));
  assert.equal(childRequests, 4);
  assert.equal(maxChildren, 2);
  assert.equal(parentWorkedDuringChildren, true);
  assert.deepEqual(failures, []);
  const messages = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(session.id)})`);
  assert.ok(JSON.stringify(messages).includes('Verified child evidence'));
  const children = (await evaluate('window.mingshen.bootstrap()')).sessions.filter(item => item.parentSessionId === session.id);
  assert.equal(children.length, 4);
  assert.ok(children.every(item => item.status === 'idle'));
  assert.ok((await evaluate(`window.mingshen.listSnapshots(${JSON.stringify(session.id)})`)).length > 0);
  assert.ok((await evaluate(`window.mingshen.listTrajectories(${JSON.stringify(session.id)})`)).length > 0);
  passed.push('Real child sessions: four background tasks, max two at once, parent works concurrently, no recursive tools, actual results collected');
  await evaluate("document.querySelector('button[aria-label=\"Open settings\"]').click(); true");
  await click('.settings-nav__item', 'Snapshots and traces');
  await until("document.querySelectorAll('.trajectory-row').length > 0");
  await evaluate("document.querySelector('.trajectory-row').open=true; true");
  await checkLayout();
  await screenshot('v123-history-populated-en');
  passed.push('Populated snapshot and expanded trace records remain readable');
  await evaluate("document.querySelector('button[aria-label=\"Close settings\"]').click(); true");
  scenario = 'manual';
  releaseChildren = false;
  const manualStart = childRequests;
  const parents = await evaluate(`(async () => {
    const source = (await window.mingshen.bootstrap()).sessions.find(s => s.id === ${JSON.stringify(session.id)});
    return Promise.all([0,1,2].map(i => window.mingshen.createSession({ title:'Manual parent '+i, providerId:source.providerId, modelId:source.modelId, workspacePath:source.workspacePath, permissionMode:'full_access', reasoningLevel:'low' })));
  })()`);
  await evaluate(`window.__manualErrors=[]; window.__manualStarted=[]; ${JSON.stringify(parents.map(p => p.id))}.forEach(sessionId => { void window.mingshen.sendChat({sessionId, text:'@explore Inspect this project independently.'}).then(value => window.__manualStarted.push(value)).catch(error => window.__manualErrors.push(String(error))); }); true`);
  for (let count = 0; count < 100 && activeChildren < 2; count++) await sleep(100);
  assert.equal(activeChildren, 2);
  await sleep(400);
  assert.equal(childRequests - manualStart, 2);
  await evaluate("document.querySelector('button[aria-label=\"Open settings\"]').click(); true");
  await click('.settings-nav__item', 'Runtime and integrations');
  await until("Boolean(document.querySelector('input[type=number][max=\"8\"]'))");
  const setLimit = async value => {
    await evaluate(`(() => { const input=document.querySelector('input[type=number][max="8"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))}); input.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
    await click('.settings-actions button', 'Save agent profile');
  };
  await setLimit(1);
  await until("Boolean(document.querySelector('.settings-page [role=alert]')?.textContent.includes('More subagents'))");
  assert.equal((await evaluate('window.mingshen.getAgentRuntimeSettings()')).maxConcurrentSubagents, 2);
  await screenshot('v123-concurrency-limit-en');
  await setLimit(2);
  await until("Boolean(document.querySelector('.settings-page [role=status]')?.textContent.includes('concurrency settings saved'))");
  await evaluate("document.querySelector('button[aria-label=\"Close settings\"]').click(); true");
  const manualChildren = (await evaluate('window.mingshen.bootstrap()')).sessions.filter(item => parents.some(p => p.id === item.parentSessionId));
  assert.equal(manualChildren.length, 3);
  const queued = manualChildren.find(item => !['running','waiting_approval'].includes(item.status));
  assert.ok(queued);
  await evaluate(`window.mingshen.stopChat(${JSON.stringify(queued.parentSessionId)})`);
  await until(`window.mingshen.bootstrap().then(data => data.sessions.find(s => s.id === ${JSON.stringify(queued.id)})?.status === 'interrupted')`);
  releaseChildren = true;
  await until(`window.__events.filter(event => ${JSON.stringify(manualChildren.filter(c => c.id !== queued.id).map(c => c.id))}.includes(event.sessionId) && event.type === 'run_completed').length === 2`);
  assert.equal(childRequests - manualStart, 2);
  passed.push('Manual @ calls share the limit; lowering below active count shows an inline error; queued cancellation makes no model request');
  scenario = 'cancel';
  parentRounds = 0;
  releaseChildren = false;
  const cancelStart = childRequests;
  const cancelParent = await evaluate(`window.mingshen.createSession({title:'Cancel parent',providerId:${JSON.stringify(session.providerId)},modelId:${JSON.stringify(session.modelId)},workspacePath:${JSON.stringify(taskRoot)},permissionMode:'full_access',reasoningLevel:'low'})`);
  await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(cancelParent.id)},text:'Inspect independent modules concurrently.'})`);
  for (let count = 0; count < 100 && activeChildren < 2; count++) await sleep(100);
  await until(`window.mingshen.bootstrap().then(data => data.sessions.filter(s => s.parentSessionId === ${JSON.stringify(cancelParent.id)}).length === 4)`);
  await evaluate(`window.mingshen.stopChat(${JSON.stringify(cancelParent.id)})`);
  await until(`window.mingshen.bootstrap().then(data => { const children=data.sessions.filter(s => s.parentSessionId === ${JSON.stringify(cancelParent.id)}); return children.length === 4 && children.every(s => s.status === 'interrupted'); })`, 20000);
  await until(`window.__events.some(event => event.sessionId === ${JSON.stringify(cancelParent.id)} && event.type === 'run_interrupted')`);
  assert.equal(childRequests - cancelStart, 2);
  assert.equal(maxChildren, 2);
  assert.deepEqual(failures, []);
  passed.push('Stopping a delegating parent interrupts running children, removes queued children and preserves the global limit');
  console.log(JSON.stringify({ passed, parentRounds, childRequests, maxChildren, parentWorkedDuringChildren, screenshots }, null, 2));
  await evaluate('void window.mingshen.desktopAction("quit"); true').catch(() => {});
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(3000)]);
} finally {
  renderer?.close();
  main?.close();
  if (child && child.exitCode === null) child.kill();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
