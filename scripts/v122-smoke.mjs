import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const workspace = process.cwd();
const currentVersion = JSON.parse(await readFile(resolve(workspace, 'package.json'), 'utf8')).version;
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-v122-'));
const taskRoot = resolve(temporary, 'project');
const skillRoot = resolve(temporary, 'skill');
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const requests = [];
const failures = [];
const passed = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const modelServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (request.method === 'GET') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ data: [{ id: 'fixture-v122' }] }));
    return;
  }
  if (!body.stream) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'OK' }] }] }));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  if (String(body.instructions).trim().startsWith('# 会话标题生成')) {
    event({ type: 'response.output_text.delta', delta: 'Document validation' });
  } else {
    requests.push(body);
    const input = body.input || [];
    const start = input.findLastIndex(item => item.role === 'user' && JSON.stringify(item.content).includes('DOCUMENT_122'));
    const turn = input.slice(Math.max(0, start));
    const protectedTask = JSON.stringify(turn).includes('PROTECTED');
    if (!turn.some(item => item.type === 'function_call_output')) {
      event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: `write-${requests.length}`, name: 'write_file', arguments: '' } });
      event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: JSON.stringify({ path: protectedTask ? 'protected.txt' : 'notes.txt', content: 'Document task completed.\n' }) });
    } else {
      if (turn.some(item => item.role === 'user' && /诊断|Protected session|Formatter/.test(JSON.stringify(item.content)))) failures.push('Unexpected synthetic diagnostics in document task');
      event({ type: 'response.output_text.delta', delta: `Created [${protectedTask ? 'protected.txt' : 'notes.txt'}](${protectedTask ? 'protected.txt' : 'notes.txt'}).` });
    }
  }
  event({ type: 'response.completed', response: { usage: { input_tokens: 24, output_tokens: 12, total_tokens: 36 } } });
  response.end();
});
let child;
let socket;
try {
  await mkdir(taskRoot);
  await mkdir(skillRoot);
  await mkdir(screenshots, { recursive: true });
  await writeFile(resolve(skillRoot, 'SKILL.md'), '---\nname: v122-fixture\ndescription: Document regression fixture\n---\nRead only the requested task materials.\n');
  await writeFile(resolve(taskRoot, 'tsconfig.json'), '{}');
  await writeFile(resolve(taskRoot, 'package.json'), JSON.stringify({ scripts: { typecheck: 'exit 1' } }));
  await new Promise(done => modelServer.listen(0, '127.0.0.1', done));
  const modelPort = modelServer.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['.', '--remote-debugging-port=9337'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { target = (await fetch('http://127.0.0.1:9337/json').then(result => result.json())).find(item => item.type === 'page'); if (target) break; } catch {}
    await sleep(100);
  }
  assert.ok(target, 'Desktop application did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    clearTimeout(handler.timer);
    message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    try {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    } catch (cause) {
      throw new Error(`Desktop check failed at ${expression.slice(0, 240)}`, { cause });
    }
  };
  const until = async (expression, timeout = 12000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (selector, text) => {
    await until(`Boolean([...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)}))`);
    await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).values().find(el => el.textContent.trim() === ${JSON.stringify(text)}).click(); true`);
  };
  const screenshot = async name => {
    await sleep(200);
    const result = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(result.data, 'base64'));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await until("Boolean(document.querySelector('.policy-dialog__body')?.innerText.includes('服务协议'))");
  await sleep(5100);
  await evaluate("document.querySelectorAll('.policy-consents input').forEach(input => input.click()); true");
  await click('.policy-dialog button', '同意并继续');
  await until("Boolean(document.querySelector('.policy-dialog__body')?.innerText.includes('快速开始'))");
  await click('.policy-dialog button', '开始使用');
  assert.equal((await evaluate('window.mingshen.getAppInfo()')).version, currentVersion);
  passed.push(`version ${currentVersion} and first-run manual`);
  const created = await evaluate(`(async () => {
    const provider = await window.mingshen.createProvider({ name: 'Fixture provider', baseUrl: 'http://127.0.0.1:${modelPort}/v1', protocol: 'openai_responses', authMode: 'bearer', apiKey: 'local-dummy-key', keyLabel: 'Fixture', neverReveal: true });
    const configured = await window.mingshen.createModel({ providerId: provider.id, modelId: 'fixture-v122', displayName: 'Fixture model', contextWindow: 128000, maxOutputTokens: 4096, inputModalities: ['text'], toolCalls: true, parallelToolCalls: true, reasoningLevels: ['low','high'], anthropicNoneBehavior: 'disabled' });
    const source = await window.mingshen.createSession({ title: 'Previous configuration', providerId: provider.id, modelId: configured.models[0].id, workspacePath: ${JSON.stringify(taskRoot)}, reasoningLevel: 'high', permissionMode: 'request_approval', executionMode: 'docker', agentProfileId: 'plan', systemPrompt: 'Preserve the selected settings.', patchOnly: true });
    const imported = await window.mingshen.importExtensions(${JSON.stringify(skillRoot)});
    await window.mingshen.setSessionExtension(source.id, imported.imported[0].id, true);
    return { source, extensionId: imported.imported[0].id };
  })()`);
  await send('Page.reload');
  await until("Boolean(document.querySelector('.session-group__add'))");
  await until("Boolean(document.querySelector('#update-title')) || window.mingshen.getUpdateStatus().then(s => s.state !== 'checking' && s.checkedAt !== null)", 20000);
  if (await evaluate("Boolean(document.querySelector('#update-title'))")) await click('.close-dialog button', '稍后再说');
  await evaluate("const add = document.querySelector('.session-group__add'); add.click(); add.click(); add.click(); true");
  await until("window.mingshen.bootstrap().then(data => data.sessions.length === 2)");
  assert.equal(await evaluate("Boolean(document.querySelector('#new-session-title'))"), false);
  const all = await evaluate('window.mingshen.bootstrap()');
  const quick = all.sessions.find(item => item.id !== created.source.id);
  for (const field of ['providerId','modelId','agentProfileId','workspacePath','systemPrompt','reasoningLevel','permissionMode','executionMode','patchOnly']) assert.deepEqual(quick[field], created.source[field], field);
  assert.equal(quick.title, '新会话');
  assert.equal(quick.parentSessionId, null);
  assert.equal(quick.status, 'idle');
  assert.deepEqual(await evaluate(`window.mingshen.listSessionExtensions(${JSON.stringify(quick.id)})`), [created.extensionId]);
  assert.deepEqual(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(quick.id)})`), []);
  assert.equal(await evaluate('window.mingshen.getProjectTrust(' + JSON.stringify(taskRoot) + ')'), false);
  assert.equal(await evaluate("document.querySelector('.session-row[aria-current=page] .session-row__title').textContent"), '新会话');
  passed.push('folder plus creates once without dialog and inherits every setting and extension; history, trust and state remain independent');
  await evaluate("document.querySelector('.session-group__header').click(); true");
  assert.equal(await evaluate("document.querySelector('.session-group__header').getAttribute('aria-expanded')"), 'false');
  await evaluate("document.querySelector('.session-group__header').click(); true");
  await click('.session-new-button', '新对话');
  assert.ok(await evaluate("Boolean(document.querySelector('#new-session-title'))"));
  await evaluate("document.querySelector('.dialog__header button').click(); true");
  passed.push('folder collapse and global new conversation remain available');
  await evaluate("document.querySelector('.desktop-caption__actions button').click(); true");
  await click('.policy-dialog__navigation button', '更新日志');
  await until("Boolean(document.querySelector('.policy-dialog__body')?.innerText.includes('普通文本'))");
  const changelogVersions = await evaluate("[...document.querySelectorAll('.policy-dialog__body h2')].map(el => el.textContent)");
  assert.equal(changelogVersions[0], currentVersion);
  assert.ok(changelogVersions.includes('1.2.2') && changelogVersions.includes('1.2.1'));
  await screenshot('v122-changelog-zh-night');
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.documentElement.dataset.theme = 'day'; document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click(); true");
  await until("Boolean(document.querySelector('.policy-dialog__body')?.innerText.includes('Changelog'))");
  assert.equal(await evaluate("document.querySelector('#policy-title').textContent"), 'Changelog');
  assert.equal(await evaluate("(() => { const el = document.querySelector('.policy-dialog'); return el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth; })()"), true);
  await screenshot('v122-changelog-en-day-compact');
  await click('.policy-dialog__body a', 'User guide');
  await until("Boolean(document.querySelector('.policy-dialog__body')?.innerText.includes('Quick start'))");
  await click('.policy-dialog button', 'Get started');
  await send('Emulation.clearDeviceMetricsOverride');
  passed.push('embedded bilingual changelog, manual link navigation, day/night and 1040x680 layout');
  await evaluate(`window.__events = []; window.mingshen.onRuntimeEvent(event => { window.__events.push(event); if (event.type === 'approval_required') void window.mingshen.decideApproval({ approvalId: event.approval.id, decision: 'allow_once' }); }); true`);
  for (const mode of ['full_access', 'request_approval']) {
    const session = await evaluate(`(async () => { const current = await window.mingshen.updateSession({ sessionId: ${JSON.stringify(quick.id)}, permissionMode: ${JSON.stringify(mode)}, executionMode: 'host', patchOnly: false, agentProfileId: 'primary' }); window.__events = []; await window.mingshen.sendChat({ sessionId: current.id, text: 'DOCUMENT_122 ${mode === 'request_approval' ? 'PROTECTED' : 'HOST'}: write the requested text document' }); return current; })()`);
    await until("window.__events.some(event => event.type === 'run_completed' || event.type === 'run_failed')", 90000);
    const events = await evaluate('window.__events');
    assert.ok(events.some(event => event.type === 'run_completed'), JSON.stringify(events.filter(event => event.type === 'run_failed')));
    assert.equal(events.some(event => event.type === 'activity' && ['diagnostics','formatter','run_command'].includes(event.activity.toolName)), false);
    assert.equal(await readFile(resolve(taskRoot, mode === 'request_approval' ? 'protected.txt' : 'notes.txt'), 'utf8'), 'Document task completed.\n');
    const messages = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(session.id)})`);
    assert.equal(messages.filter(message => message.role === 'user').length, mode === 'request_approval' ? 2 : 1);
    passed.push(`real file write and no spurious diagnostics: ${mode}`);
  }
  assert.deepEqual(failures, []);
  assert.equal(requests.length, 4, 'Document tasks should each use one tool round and one final response');
  await evaluate('window.mingshen.desktopAction("locale", "zh-CN")');
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click(); true");
  await evaluate('document.documentElement.dataset.theme = "night"; true');
  await screenshot('v122-document-completed');
  console.log(JSON.stringify({ passed, modelRequests: requests.length, screenshots }, null, 2));
  await evaluate('void window.mingshen.desktopAction("quit"); true').catch(() => {});
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(3000)]);
} finally {
  socket?.close();
  if (child && child.exitCode === null) child.kill();
  modelServer.closeAllConnections();
  await new Promise(done => modelServer.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid temporary cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
