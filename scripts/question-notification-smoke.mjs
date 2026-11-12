import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-question-toasts-'));
const project = resolve(temporary, 'project');
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const passed = [], errors = [], requests = [];
const currentVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const held = new Set();
const settings = { nativeEnabled: true, questionEnabled: true, approvalEnabled: true, taskbarEnabled: true, showPreview: true, sound: true };
let child, renderer, main, activator, sequence = 0;

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const input = body.input ?? [];
    const userIndex = input.findLastIndex(item => item.role === 'user' && /CASE:/.test(JSON.stringify(item.content)));
    const scenario = /CASE:([a-z]+)/.exec(JSON.stringify(input[userIndex]?.content ?? ''))?.[1] ?? 'auxiliary';
    const turn = input.slice(Math.max(0, userIndex));
    const has = name => turn.some(item => item.type === 'function_call' && item.name === name);
    requests.push({ scenario, body });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    const tool = (name, args) => {
      event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: `${scenario}-${++sequence}`, name, arguments: '' } });
      event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: JSON.stringify(args) });
    };
    if (['owner', 'contender'].includes(scenario) && !has('write_file')) {
      tool('write_file', { path: 'shared.txt', content: scenario === 'owner' ? 'Original writer retained.\n' : 'STALE_CONTENDER_MUST_NOT_WRITE\n' });
    } else if (scenario === 'owner') {
      held.add(response);
      await new Promise(done => response.once('close', done));
      held.delete(response);
      return;
    } else if (scenario === 'approval' && !has('write_file')) {
      tool('write_file', { path: 'approval.txt', content: 'APPROVAL_MUST_REMAIN_MANUAL\n' });
    } else if (['ask', 'stale', 'replacement', 'foreground', 'private', 'disabled'].includes(scenario) && !has('ask_user')) {
      tool('ask_user', {
        questions: [{
          id: 'direction', header: 'Fixture direction',
          question: `PRIVATE_QUESTION_PREVIEW_${scenario}: Which implementation should the Agent use?`,
          options: [
            { label: 'Safe route', description: 'Continue with the bounded fixture task.' },
            { label: 'Alternative route', description: 'Wait for another implementation.' },
          ],
          multiSelect: false,
        }],
      });
    } else {
      event({ type: 'response.output_text.delta', delta: scenario === 'auxiliary'
        ? 'The bounded fixture completed. Preserve all existing user choices and permissions; no unrelated work or credentials were used.'
        : `Completed ${scenario} using the real tool result.` });
    }
    event({ type: 'response.completed', response: { usage: { input_tokens: 300, output_tokens: 40 } } });
    response.end();
  } catch (cause) {
    errors.push(String(cause));
    response.destroy();
  }
});

async function connect(port) {
  let target;
  for (let index = 0; index < 150; index++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(result => result.json())).find(item => item.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await sleep(80);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let next = 0;
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id); clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 40000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

async function until(expression, timeout = 40000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await renderer.evaluate(expression)) return;
    await sleep(70);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector, text) {
  const target = text
    ? `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  await until(`Boolean(${target})&&!(${target}).disabled`);
  await renderer.evaluate(`${target}.click();true`);
}
async function select(session) {
  await renderer.evaluate("document.querySelectorAll('.session-group__show-all[aria-expanded=false]').forEach(el=>el.click());true");
  await until(`Boolean(document.querySelector('[data-session-id="${session.id}"] .session-row'))`);
  await renderer.evaluate(`document.querySelector('[data-session-id="${session.id}"] .session-row').click();true`);
  await selected(session);
}
const selected = session => until(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(session.id)}`);
const idle = session => until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>s.status==='idle')`);
const question = session => until(`window.mingshen.getQuestionState().then(s=>s.requests.some(x=>x.sessionId===${JSON.stringify(session.id)}))`);
const noQuestion = session => until(`window.mingshen.getQuestionState().then(s=>s.requests.every(x=>x.sessionId!==${JSON.stringify(session.id)}))`);
const nativeProbe = async args => (await promisify(execFile)('powershell.exe', [
  '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', resolve('scripts/windows-notification-probe.ps1'), ...args,
], { windowsHide: true, timeout: 20000 })).stdout.trim();
async function history() {
  const value = await nativeProbe([]);
  const list = value ? JSON.parse(value) : [];
  return Array.isArray(list) ? list : [list];
}
async function toastFor(session, group = 'mingshen-questions', predicate = item => item.xml.includes(session.title)) {
  for (let index = 0; index < 20; index++) {
    const found = (await history()).find(item => item.group === group && predicate(item));
    if (found) return found;
    await sleep(200);
  }
  throw new Error(`No ${group} native toast for ${session.title}`);
}
function actionArgs(toast, index = 0) {
  const actions = [...toast.xml.matchAll(/<action\b[^>]*>/g)].map(match => match[0]);
  const value = actions[index]?.match(/arguments="([^"]*)"/)?.[1];
  assert.ok(value, `Missing action ${index}: ${toast.xml}`);
  return value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}
const activate = (toast, index = 0) => nativeProbe([
  '-Activator', activator, '-Tag', toast.tag, '-RawArguments', actionArgs(toast, index),
]);
async function configure(changes) {
  Object.assign(settings, changes);
  return await renderer.evaluate(`window.mingshen.configureCompletionNotifications(${JSON.stringify(settings)})`);
}
async function start(session, scenario, hide = true) {
  await select(session);
  if (hide) await renderer.evaluate("window.mingshen.desktopAction('tray')");
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(`CASE:${scenario} perform only the bounded fixture task.`)}})`);
}
async function answer(session, option = 'Safe route') {
  await selected(session);
  await until("Boolean(document.querySelector('.question-panel'))");
  await renderer.evaluate(`[...document.querySelectorAll('.question-option')].find(el=>el.querySelector('strong')?.textContent===${JSON.stringify(option)}).click();true`);
  await click('.question-panel button[type=submit]');
  await noQuestion(session);
}
async function stop(session) {
  await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(session.id)})`);
  await noQuestion(session);
  await until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>s.status==='interrupted')`);
}
async function shot(name) {
  await sleep(180);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function launch() {
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), [
    '--inspect=9396', '.', '--remote-debugging-port=9395',
  ], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9396);
  await main.evaluate("globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true");
  renderer = await connect(9395);
  await renderer.send('Runtime.enable');
  await until("Boolean(window.mingshen)");
  await main.evaluate("globalThis.__electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');true");
  activator = await main.evaluate("globalThis.__electron.app.toastActivatorCLSID");
  assert.equal(activator.toLowerCase(), '{6094cee7-98e1-4d01-97a6-68a726eba51e}');
}
async function close() {
  if (!child) return;
  const current = child;
  const ended = new Promise(done => current.once('exit', done));
  await renderer?.evaluate("setTimeout(()=>void window.mingshen.desktopAction('quit'),100);true").catch(() => {});
  renderer?.close(); main?.close(); renderer = null; main = null;
  await Promise.race([ended, sleep(5000)]);
  if (current.exitCode === null) { current.kill(); await ended; }
  child = null;
}

try {
  await mkdir(project); await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch();
  await until("Boolean(document.querySelector('.policy-consents'))");
  await renderer.evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  await until("!document.querySelector('.policy-dialog')");
  const fixtures = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Local question toast fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-question-fixture-only',keyLabel:'Fixture',neverReveal:true});
    const updated=await window.mingshen.createModel({providerId:p.id,modelId:'question-fixture',contextWindow:200000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    const config={providerId:p.id,modelId:updated.models[0].id,workspacePath:${JSON.stringify(project)},permissionMode:'full_access',reasoningLevel:null};
    const sessions={};
    for(const key of ['ask','stale','foreground','private','disabled','owner','contender','approval','completion']){
      sessions[key]=await window.mingshen.createSession({...config,title:'Question toast '+key+' ${Date.now()}',...(key==='approval'?{permissionMode:'request_approval'}:{})});
      await window.mingshen.setProjectMemoryEnabled(sessions[key].id,false);
    }
    return sessions;
  })()`);
  await renderer.send('Page.reload');
  await until("Boolean(document.querySelector('.session-row'))");
  await configure({});

  await start(fixtures.ask, 'ask'); await question(fixtures.ask);
  const firstToast = await toastFor(fixtures.ask);
  assert.match(firstToast.xml, /content="查看问题"/);
  assert.ok(!firstToast.xml.includes('Safe route'), 'Notifications must not include answer actions');
  await activate(firstToast); await selected(fixtures.ask);
  await question(fixtures.ask);
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(fixtures.ask.id)})`)).status, 'waiting_approval');
  await activate(firstToast);
  await question(fixtures.ask);
  await answer(fixtures.ask); await idle(fixtures.ask);
  assert.ok(!(await history()).some(item => item.group === 'mingshen-questions' && item.tag === firstToast.tag));
  assert.match(JSON.stringify(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixtures.ask.id)})`)), /Safe route/);
  passed.push('A real tray/background ask_user toast opens the exact waiting conversation through Windows COM; duplicate activation never answers, and an in-app answer resumes the real run');

  await start(fixtures.stale, 'stale'); await question(fixtures.stale);
  const oldToast = await toastFor(fixtures.stale);
  await stop(fixtures.stale);
  assert.ok(!(await history()).some(item => item.group === 'mingshen-questions' && item.tag === oldToast.tag));
  await start(fixtures.stale, 'replacement'); await question(fixtures.stale);
  const replacement = await toastFor(fixtures.stale);
  assert.notEqual(replacement.tag, oldToast.tag);
  await activate(oldToast); await sleep(200);
  const current = (await renderer.evaluate('window.mingshen.getQuestionState()')).requests.find(item => item.sessionId === fixtures.stale.id);
  assert.match(current.question, /replacement/);
  assert.ok((await history()).some(item => item.group === 'mingshen-questions' && item.tag === replacement.tag));
  await activate(replacement); await answer(fixtures.stale); await idle(fixtures.stale);
  passed.push('Stop removes its question toast and route; replaying an old native action cannot open, answer or consume a new request in the same chat');

  await renderer.evaluate("window.mingshen.desktopAction('show')");
  await select(fixtures.foreground);
  await renderer.evaluate(`window.mingshen.setActiveNotificationSession(${JSON.stringify(fixtures.foreground.id)})`);
  await main.evaluate("globalThis.__electron.BrowserWindow.getAllWindows()[0].focus();true");
  await start(fixtures.foreground, 'foreground', false); await question(fixtures.foreground);
  await sleep(200);
  assert.ok(!(await history()).some(item => item.group === 'mingshen-questions' && item.xml.includes(fixtures.foreground.title)));
  await renderer.evaluate("window.mingshen.desktopAction('minimize')");
  const minimizedToast = await toastFor(fixtures.foreground);
  await activate(minimizedToast); await question(fixtures.foreground);
  await answer(fixtures.foreground); await idle(fixtures.foreground);
  passed.push('A visible foreground question stays inline; minimizing afterward delivers the pending native notification and preserves the original answer flow');

  await start(fixtures.owner, 'owner');
  await until(`window.mingshen.getWorkbench(${JSON.stringify(fixtures.owner.id)}).then(s=>s.checkpoint.completedTools===1)`);
  assert.equal(await readFile(resolve(project, 'shared.txt'), 'utf8'), 'Original writer retained.\n');
  await start(fixtures.contender, 'contender'); await question(fixtures.contender);
  const conflict = (await renderer.evaluate('window.mingshen.getQuestionState()')).requests.find(item => item.sessionId === fixtures.contender.id);
  assert.equal(conflict.kind, 'file_conflict');
  const conflictToast = await toastFor(fixtures.contender);
  assert.match(conflictToast.xml, /content="处理冲突"/);
  assert.ok(!conflictToast.xml.includes('切换到当前 Agent'), 'Writer selection must remain inside Harness');
  await activate(conflictToast); await selected(fixtures.contender);
  await question(fixtures.contender);
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(fixtures.owner.id)})`)).status, 'running');
  assert.equal(await readFile(resolve(project, 'shared.txt'), 'utf8'), 'Original writer retained.\n');
  await shot('question-notification-conflict-zh-night');
  await answer(fixtures.contender, '切换到当前 Agent'); await idle(fixtures.contender);
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(fixtures.owner.id)})`)).status, 'interrupted');
  assert.equal(await readFile(resolve(project, 'shared.txt'), 'utf8'), 'Original writer retained.\n');
  assert.match(JSON.stringify(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixtures.contender.id)})`)), /pending operation was NOT executed/);
  passed.push('Two real Agents competing for one file produce a distinct conflict toast; only an in-app human choice transfers ownership, stops the original run and prevents stale write replay');

  await renderer.evaluate("window.mingshen.desktopAction('locale','en')");
  await configure({ showPreview: false, sound: false });
  const knownTags = new Set((await history()).map(item => `${item.group}:${item.tag}`));
  await start(fixtures.private, 'private'); await question(fixtures.private);
  const privateToast = await toastFor(fixtures.private, 'mingshen-questions', item => !knownTags.has(`${item.group}:${item.tag}`));
  assert.match(privateToast.xml, /View question/);
  assert.match(privateToast.xml, /silent="true"/);
  assert.ok(!privateToast.xml.includes(fixtures.private.title));
  assert.ok(!privateToast.xml.includes('PRIVATE_QUESTION_PREVIEW'));
  assert.ok(!privateToast.xml.includes(project));
  await configure({ questionEnabled: false });
  assert.ok(!(await history()).some(item => item.group === 'mingshen-questions' && item.tag === privateToast.tag));
  await activate(privateToast); await question(fixtures.private);
  await stop(fixtures.private);
  passed.push('English action labels, hidden previews and silent mode reach real native toast XML; disabling question reminders removes routes without deciding the pending question');

  const existingQuestions = new Set((await history()).filter(item => item.group === 'mingshen-questions').map(item => item.tag));
  await start(fixtures.disabled, 'disabled'); await question(fixtures.disabled);
  await sleep(250);
  assert.ok(!(await history()).some(item => item.group === 'mingshen-questions' && !existingQuestions.has(item.tag)));
  await stop(fixtures.disabled);
  await start(fixtures.approval, 'approval');
  await until(`window.mingshen.getApprovalState().then(s=>s.requests.some(x=>x.sessionId===${JSON.stringify(fixtures.approval.id)}))`);
  const approvalToast = await toastFor(fixtures.approval, 'mingshen-approvals', item => item.xml.includes('Approval required'));
  await activate(approvalToast, 1); await idle(fixtures.approval);
  await assert.rejects(readFile(resolve(project, 'approval.txt')), { code: 'ENOENT' });
  await start(fixtures.completion, 'completion'); await idle(fixtures.completion);
  await toastFor(fixtures.completion, 'mingshen-tasks', item => item.xml.includes('Task completed'));
  passed.push('Turning off question reminders leaves existing native approval Reject and task-completion delivery working');

  await close(); await launch();
  await until("Boolean(document.querySelector('.session-row'))");
  assert.equal((await renderer.evaluate('window.mingshen.getCompletionNotifications()')).settings.questionEnabled, false);
  await renderer.evaluate("window.mingshen.configureCompletionNotifications({nativeEnabled:true,approvalEnabled:true,taskbarEnabled:true,showPreview:true,sound:true})");
  assert.equal((await renderer.evaluate('window.mingshen.getCompletionNotifications()')).settings.questionEnabled, false);
  await configure({ questionEnabled: true, showPreview: true, sound: true });
  passed.push('The independent question-reminder preference survives real restart and legacy settings payloads preserve its value');

  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  for (const [locale, theme] of [['zh-CN', 'night'], ['en', 'day']]) {
    await renderer.evaluate(`window.mingshen.desktopAction('locale',${JSON.stringify(locale)}).then(()=>{localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});return true})`);
    await renderer.send('Page.reload');
    await until(`document.documentElement.lang===${JSON.stringify(locale)}`);
    await click(`.app-topbar button[aria-label="${locale === 'en' ? 'Open settings' : '打开设置'}"]`);
    await until("Boolean(document.querySelector('.settings-workspace'))");
    const findRow = locale === 'en'
      ? "[...document.querySelectorAll('.setting-row')].find(el=>/Agent/i.test(el.textContent)&&/conflict/i.test(el.textContent))"
      : "[...document.querySelectorAll('.setting-row')].find(el=>el.textContent.includes('提问')&&el.textContent.includes('冲突'))";
    await until(`Boolean(${findRow}?.querySelector('input[type=checkbox]'))`);
    await renderer.evaluate(`${findRow}.scrollIntoView({block:'center'});true`);
    const bounds = await renderer.evaluate(`(()=>{const row=${findRow},r=row.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,checked:row.querySelector('input').checked}})()`);
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.top >= 0 && bounds.bottom <= bounds.height + 1, JSON.stringify(bounds));
    assert.equal(bounds.checked, true);
    await shot(`question-notification-settings-${locale === 'en' ? 'en-day' : 'zh-night'}`);
  }
  assert.equal((await renderer.evaluate('window.mingshen.getAppInfo()')).version, currentVersion);
  for (const locale of ['zh-CN', 'en']) {
    for (const name of ['manual', 'privacy', 'changelog']) {
      assert.ok((await renderer.evaluate(`window.mingshen.readPolicy(${JSON.stringify(name)},${JSON.stringify(locale)})`)).includes(currentVersion));
    }
  }
  passed.push(`The real independent settings control remains visible and checked at 1040x680 in Chinese/night and English/day; embedded manual/privacy/changelog stay at ${currentVersion}`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, requests: requests.length, native: true, version: currentVersion, screenshots }, null, 2));
} catch (cause) {
  console.error('Question notification fixture:', JSON.stringify({
    error: String(cause), errors,
    body: renderer ? await renderer.evaluate('document.body.innerText').catch(() => null) : null,
  }));
  if (renderer) await shot('question-notification-failure').catch(() => {});
  throw cause;
} finally {
  for (const response of held) response.destroy();
  held.clear();
  await close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  const root = resolve(temporary);
  if (root.startsWith(resolve(tmpdir()) + sep) && root.includes('mingshen-question-toasts-')) await rm(root, { recursive: true, force: true });
}
