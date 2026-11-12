import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-conversations-'));
const project = resolve(temporary, 'project');
const otherProject = resolve(temporary, 'workspace \u4e2d\u6587 folder');
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
let round = 0;
let releaseFirst = false;
let releaseSecond = false;
let releaseFinal = false;
let child;
let renderer;
let main;
function explorerWindows(close = false) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$shell = New-Object -ComObject Shell.Application; $count = 0; foreach ($window in @($shell.Windows())) { try { if ($window.Document.Folder.Self.Path -eq $env:MSH_EXPLORER_TEST_PATH) { $count++; if ($env:MSH_EXPLORER_TEST_CLOSE -eq "1") { $window.Quit() } } } catch {} }; Write-Output $count'], { windowsHide: true, encoding: 'utf8', env: { ...process.env, MSH_EXPLORER_TEST_PATH: otherProject, MSH_EXPLORER_TEST_CLOSE: close ? '1' : '0' } }).trim();
}
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const end = () => { event({ type: 'response.completed', response: { usage: { input_tokens: 30, output_tokens: 20, total_tokens: 50 } } }); response.end(); };
  const wait = async predicate => { const deadline = Date.now() + 45000; while (!predicate() && !response.destroyed && Date.now() < deadline) await sleep(50); };
  if (String(body.instructions).trim().startsWith('# 会话标题生成')) {
    event({ type: 'response.output_text.delta', delta: 'Conversation regression' });
    end();
    return;
  }
  round++;
  if (round === 1 || round === 2) {
    await wait(() => round === 1 ? releaseFirst : releaseSecond);
    if (response.destroyed) return;
    event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: `write-${round}`, name: 'write_file', arguments: '' } });
    const args = JSON.stringify({ path: 'notes.txt', content: round === 1 ? 'First change.\n' : 'Second change.\nMore evidence.\n' });
    const split = Math.floor(args.length / 2);
    event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: args.slice(0, split) });
    await sleep(150);
    event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: args.slice(split) });
  } else {
    await wait(() => releaseFinal);
    if (response.destroyed) return;
    event({ type: 'response.output_text.delta', delta: 'Formula:\n\n$\n\n\\dim_{\\mathrm H} K=3.\n\n$\n\nInline $x^2$ and \\(y^2\\).\n\nPrices are $5 and $10. Code: `\\(literal\\)`.\n\n[notes.txt](notes.txt)' });
  }
  end();
});

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
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const handler = pending.get(message.id);
    if (handler) { pending.delete(message.id); clearTimeout(handler.timer); message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve: done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`${expression.slice(0, 120)}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

try {
  await mkdir(project);
  await mkdir(otherProject);
  await writeFile(resolve(project, 'notes.txt'), 'Original.\n');
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9345', '.', '--remote-debugging-port=9339'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9345);
  await main.evaluate('globalThis.__fetch = fetch; globalThis.fetch = (url,options) => String(url).includes("/rest/v1/rpc/") ? Promise.resolve(Response.json([])) : globalThis.__fetch(url,options); true');
  renderer = await connect(9339);
  const { send, evaluate } = renderer;
  const until = async (expression, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(80); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (selector, text) => {
    const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
    await until(`Boolean(${expression})`);
    await evaluate(`${expression}.click(); true`);
  };
  const input = async (selector, value, kind = 'HTMLInputElement') => evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`);
  const shot = async name => { await sleep(100); const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(result.data, 'base64')); };
  const menu = async title => {
    await evaluate(`[...document.querySelectorAll('.session-group__header[aria-expanded="false"]')].forEach(el=>el.click());true`);
    await until(`Boolean([...document.querySelectorAll('.session-row-wrap')].find(el => el.querySelector('.session-row__title')?.textContent === ${JSON.stringify(title)}))`);
    await evaluate(`[...document.querySelectorAll('.session-row-wrap')].find(el => el.querySelector('.session-row__title')?.textContent === ${JSON.stringify(title)}).querySelector('.session-row__menu').click(); true`);
    await until("Boolean(document.querySelector('.session-menu'))");
  };
  const select = async title => {
    await evaluate(`[...document.querySelectorAll('.session-group__header[aria-expanded="false"]')].forEach(el=>el.click());true`);
    await click('.session-row__title', title);
  };
  const bothSessions = () => until("(()=>{document.querySelectorAll('.session-group__header[aria-expanded=false]').forEach(el=>el.click());return document.querySelectorAll('.session-row').length===2})()");
  await until("Boolean(document.querySelector('.policy-consents'))");
  await evaluate("document.querySelectorAll('.policy-consents input').forEach(el => el.click()); true");
  await until("[...document.querySelectorAll('.policy-dialog button')].some(el=>el.textContent.trim()==='同意并继续'&&!el.disabled)");
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  const fixture = await evaluate(`(async () => {
    const provider = await window.mingshen.createProvider({name:'Fixture',baseUrl:'http://127.0.0.1:${port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-dummy',keyLabel:'Fixture',neverReveal:true});
    const configured = await window.mingshen.createModel({providerId:provider.id,modelId:'fixture',displayName:'Fixture',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['low'],anthropicNoneBehavior:'disabled'});
    const config={providerId:provider.id,modelId:configured.models[0].id,workspacePath:${JSON.stringify(project)},reasoningLevel:'low',permissionMode:'full_access'};
    const other=await window.mingshen.createSession({...config,workspacePath:${JSON.stringify(otherProject)},title:'Second conversation'});
    const active=await window.mingshen.createSession({...config,title:'Primary conversation'});
    for(const server of await window.mingshen.listMcpServers()) if(server.enabled) await window.mingshen.setMcpServerEnabled(server.id,false);
    return {active,other};
  })()`);
  await send('Page.reload');
  await bothSessions();
  await select('Primary conversation');
  await until("Boolean(document.querySelector('.composer textarea'))");
  await main.evaluate("(()=>{const {shell}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__realOpenPath=shell.openPath;globalThis.__explorerCalls=[];globalThis.__explorerError='';shell.openPath=async target=>{globalThis.__explorerCalls.push(target);return globalThis.__explorerError||globalThis.__realOpenPath(target)};return true})()");
  await menu('Second conversation');
  await click('.session-menu button', '在资源管理器中打开');
  await until("!document.querySelector('.session-menu')");
  for (let attempt=0; attempt<30 && explorerWindows()==='0'; attempt++) await sleep(150);
  assert.ok(Number(explorerWindows())>0, 'File Explorer must open the inactive conversation directory');
  assert.deepEqual(await main.evaluate('globalThis.__explorerCalls'), [otherProject]);
  assert.equal(await evaluate("document.querySelector('.session-row--selected .session-row__title').textContent"), 'Primary conversation');
  explorerWindows(true);
  await evaluate('window.mingshen.desktopAction("show");true');
  passed.push('File Explorer really opens the inactive conversation folder, including Chinese characters and spaces, without changing selection');

  await main.evaluate("globalThis.__explorerError='Explorer unavailable (fixture)';true");
  await menu('Primary conversation');
  await click('.session-menu button', '在资源管理器中打开');
  await until("document.querySelector('.session-sidebar__error')?.textContent.includes('Explorer unavailable (fixture)')");
  await main.evaluate("globalThis.__explorerError='';true");
  await assert.rejects(evaluate("window.mingshen.openSessionWorkspace('missing-session')"), /会话不存在/);
  await evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(fixture.other.id)},workspacePath:null})`);
  await send('Page.reload');
  await bothSessions();
  await menu('Second conversation');
  assert.equal(await evaluate("[...document.querySelectorAll('.session-menu button')].find(el=>el.textContent.trim()==='在资源管理器中打开').disabled"), true);
  await assert.rejects(evaluate(`window.mingshen.openSessionWorkspace(${JSON.stringify(fixture.other.id)})`), /尚未设置工作目录/);
  await evaluate("document.querySelector('.session-menu-scrim').click();true");
  await evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(fixture.other.id)},workspacePath:${JSON.stringify(otherProject)}})`);
  assert.ok(otherProject.startsWith(temporary + sep), 'Cleanup must stay inside this test directory');
  await rm(otherProject, { recursive: true, force: true });
  await send('Page.reload');
  await bothSessions();
  await menu('Second conversation');
  await click('.session-menu button', '在资源管理器中打开');
  await until("document.querySelector('.session-sidebar__error')?.textContent.includes('工作目录不存在或无法访问')");
  await mkdir(otherProject);
  passed.push('Missing directory and native opening failures show inline errors; an unset directory disables the action and main IPC validates the conversation');
  await select('Primary conversation');
  await evaluate("window.__events=[]; window.mingshen.onRuntimeEvent(event=>window.__events.push(event)); true");
  await input('.composer textarea', 'Update notes and verify the formula.', 'HTMLTextAreaElement');
  await evaluate("document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); true");
  await until("Boolean(document.querySelector('.run-status')?.textContent.includes('思考中'))", 2000);
  await menu('Primary conversation');
  assert.equal(await evaluate("[...document.querySelectorAll('.session-menu button')].find(el=>el.textContent.trim()==='在资源管理器中打开').disabled"), false);
  await evaluate("document.querySelector('.session-menu-scrim').click();true");
  await until("/已运行 [1-9][0-9]* 秒/.test(document.querySelector('.run-status').textContent)", 5000);
  assert.equal(await evaluate("Boolean(document.querySelector('.activity-diff'))"), false);
  await shot('v123-thinking-zh-night');
  passed.push('Immediate Thinking state appears before model output; real seconds advance');
  releaseFirst = true;
  await until("window.__events.some(e=>e.type==='activity' && e.activity.fileChange?.diff)");
  await until("Boolean(document.querySelector('.activity-trail--collapsed'))");
  assert.equal(await evaluate("document.querySelectorAll('.activity-diff').length"), 0);
  await evaluate("document.querySelector('.activity-trail__current-main').click(); true");
  await until("Boolean(document.querySelector('.activity-row__diff-toggle'))");
  assert.equal(await evaluate("document.querySelectorAll('.activity-diff').length"), 0);
  await evaluate("document.querySelector('.activity-row__diff-toggle').click(); true");
  await until("document.querySelectorAll('.activity-diff').length === 1");
  await shot('v123-diff-expanded-zh-night');
  await evaluate("document.querySelector('.activity-row__diff-toggle').click(); document.querySelector('.activity-trail__current-toggle').click(); true");
  releaseSecond = true;
  await until("window.__events.filter(e=>e.type==='activity' && e.activity.fileChange?.diff).length >= 2");
  assert.equal(await evaluate("Boolean(document.querySelector('.activity-trail--collapsed')) && document.querySelectorAll('.activity-diff').length === 0"), true);
  await shot('v123-diff-collapsed-zh-night');
  await select('Second conversation');
  await select('Primary conversation');
  await until("Boolean(document.querySelector('.run-status')?.textContent.includes('已运行'))");
  assert.equal(await evaluate("document.querySelectorAll('.activity-diff').length"), 0);
  await send('Page.reload');
  await until("Boolean(document.querySelector('.run-status')?.textContent.includes('已运行'))");
  passed.push('Two real file writes: default collapsed, manual expand/collapse, no reopen, timer survives conversation switching and renderer reload');
  releaseFinal = true;
  await until("Boolean(document.querySelector('.run-status')?.textContent.includes('已完成'))");
  assert.equal(await readFile(resolve(project, 'notes.txt'), 'utf8'), 'Second change.\nMore evidence.\n');
  await until("document.querySelectorAll('.message .katex').length >= 3");
  assert.equal(await evaluate("document.querySelectorAll('.katex-error').length"), 0);
  assert.ok(await evaluate("[...document.querySelectorAll('.message--assistant')].some(el=>el.textContent.includes('Prices are $5 and $10.'))"));
  assert.ok(await evaluate(`[...document.querySelectorAll('.message code')].some(el=>el.textContent === ${JSON.stringify('\\(literal\\)')})`));
  const duration = await evaluate("document.querySelector('.run-status').textContent");
  await sleep(1150);
  assert.equal(await evaluate("document.querySelector('.run-status').textContent"), duration);
  await shot('v123-math-completed-zh-night');
  await select('Second conversation');
  await select('Primary conversation');
  assert.equal(await evaluate("document.querySelector('.run-status').textContent"), duration);
  await send('Page.reload');
  await until("Boolean(document.querySelector('.run-status')?.textContent.includes('已完成'))");
  assert.equal(await evaluate("document.querySelector('.run-status').textContent"), duration);
  passed.push('Screenshot math example, inline TeX, literal code/currency and persisted final duration render correctly');
  await menu('Primary conversation');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  assert.equal(await evaluate("document.activeElement.textContent.trim()"), '分支聊天');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until("!document.querySelector('.session-menu')");
  assert.equal(await evaluate("document.activeElement.classList.contains('session-row__menu')"), true);
  await menu('Primary conversation');
  await shot('v123-session-menu-zh-night');
  await click('.session-menu button', '重命名');
  await input('.session-rename-dialog input', 'Renamed conversation');
  await click('.session-rename-dialog button', '保存');
  await until("[...document.querySelectorAll('.session-row__title')].some(el=>el.textContent==='Renamed conversation')");
  await menu('Renamed conversation');
  await click('.session-menu button', '置顶');
  await until("Boolean(document.querySelector('.session-row__pin'))");
  assert.equal(await evaluate("document.querySelector('.session-row__title').textContent"), 'Renamed conversation');
  await menu('Renamed conversation');
  await click('.session-menu button', '归档');
  await until("document.querySelectorAll('.session-row').length === 1");
  assert.equal(await evaluate("document.querySelector('.session-row__title').textContent"), 'Second conversation');
  await assert.rejects(evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.active.id)},text:'Archived task'})`), /恢复已归档/);
  await evaluate("document.querySelector('button[aria-label=\"打开设置\"]').click(); true");
  await click('.settings-nav__item', '会话与数据');
  await until("document.querySelectorAll('.archived-session-row').length === 1");
  assert.equal((await evaluate('window.mingshen.getSessionRetention()')).days, null);
  await shot('v123-archive-retention-zh-night');
  await evaluate("(() => {const input=document.querySelector('.session-retention-form select');input.value='days';input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await input('.session-retention-form input', '45');
  await click('.session-retention-form button', '保存清理设置');
  await click('.mingshen-dialog__actions button', '保存清理设置');
  await until("window.mingshen.getSessionRetention().then(value=>value.days===45)");
  await click('.archived-session-row button', '恢复');
  await until("document.querySelectorAll('.archived-session-row').length === 0");
  assert.ok((await evaluate('window.mingshen.bootstrap()')).sessions.every(session => !session.archived));
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click();document.documentElement.dataset.theme='day';true");
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await shot('v123-retention-en-day-compact');
  assert.equal(await evaluate("(() => {const root=document.querySelector('.settings-content'); return root.scrollWidth <= root.clientWidth+1 && document.documentElement.scrollWidth <= innerWidth;})()"), true);
  await evaluate("(() => {const input=document.querySelector('.session-retention-form select');input.value='never';input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
  await click('.session-retention-form button', 'Save retention settings');
  await until("window.mingshen.getSessionRetention().then(value=>value.days===null)");
  await evaluate("document.querySelector('button[aria-label=\"Close settings\"]').click(); true");
  await menu('Renamed conversation');
  await shot('v123-session-menu-en-day-compact');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.session-menu button')].map(el=>el.textContent.trim())"), ['Rename','Fork conversation','Open in File Explorer','Unpin','Archive','Delete']);
  const menuLayout = await evaluate("(()=>{const m=document.querySelector('.session-menu'),r=m.getBoundingClientRect();return {inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,overflow:m.scrollWidth>m.clientWidth,items:[...m.querySelectorAll('button')].map(b=>b.scrollWidth>b.clientWidth)}})()");
  assert.ok(menuLayout.inside&&!menuLayout.overflow&&!menuLayout.items.some(Boolean), JSON.stringify(menuLayout));
  await assert.rejects(evaluate("window.mingshen.openSessionWorkspace('missing-session')"), /Conversation not found/);
  assert.ok((await evaluate("window.mingshen.readPolicy('manual','en')")).includes('Open in File Explorer'));
  assert.ok((await evaluate("window.mingshen.readPolicy('changelog','zh-CN')")).includes('在资源管理器中打开'));
  await click('.session-menu button', 'Delete');
  await shot('v123-delete-dialog-en-day-compact');
  await click('.mingshen-dialog__actions button', 'Cancel');
  assert.equal((await evaluate('window.mingshen.bootstrap()')).sessions.length, 2);
  await menu('Renamed conversation');
  await click('.session-menu button', 'Delete');
  await click('.mingshen-dialog__actions button', 'Delete');
  await until("document.querySelectorAll('.session-row').length === 1");
  assert.equal(await readFile(resolve(project, 'notes.txt'), 'utf8'), 'Second change.\nMore evidence.\n');
  assert.equal((await evaluate(`window.mingshen.listSnapshots(${JSON.stringify(fixture.active.id)})`)).length, 0);
  await send('Page.reload');
  await until("document.querySelectorAll('.session-row').length === 1");
  assert.deepEqual(await evaluate('window.mingshen.getSessionRetention()'), { days: null });
  passed.push('Sidebar rename/pin/archive/delete, Settings restore, saved 45-day/never retention, cancel confirmation and no workspace deletion');
  console.log(JSON.stringify({ passed, modelRounds: round, screenshots }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ passed, ui: await renderer?.evaluate("({selected:document.querySelector('.session-row--selected')?.innerText,rows:[...document.querySelectorAll('.session-row__title')].map(el=>el.textContent),error:document.querySelector('.session-sidebar__error')?.textContent,menu:document.querySelector('.session-menu')?.innerText,status:document.querySelector('.run-status')?.innerText})").catch(()=>null) },null,2));
  throw error;
} finally {
  explorerWindows(true);
  if (renderer) await renderer.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close();
  main?.close();
  if (child && child.exitCode === null) {
    await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
    if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
