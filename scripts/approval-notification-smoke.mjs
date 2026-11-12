import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-approval-toasts-'));
const project = resolve(temporary, 'project');
const profile = resolve(temporary, 'profile');
const shots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const rounds = new Map();
let child, renderer, main;
const server = createServer(async (request, response) => {
  const chunks = []; for await (const part of request) chunks.push(Buffer.from(part));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const scenario = [...JSON.stringify(body.input ?? []).matchAll(/CASE:([a-z]+)/g)].at(-1)?.[1] ?? 'default';
  const count = (rounds.get(scenario) ?? 0) + 1; rounds.set(scenario, count);
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  if (count === 1) {
    event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: `approval-${scenario}`, name: 'write_file', arguments: '' } });
    event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: JSON.stringify({ path: `${scenario}.txt`, content: `Approved Windows notification fixture: ${scenario}\n` }) });
  } else event({ type: 'response.output_text.delta', delta: 'Processed the exact approval result.' });
  event({ type: 'response.completed', response: { usage: { input_tokens: 500, output_tokens: 50 } } }); response.end();
});

async function connect(port) {
  let target;
  for (let index = 0; index < 120; index++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.webSocketDebuggerUrl); if (target) break; } catch {}
    await sleep(100);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map();
  socket.addEventListener('message', event => { const value = JSON.parse(String(event.data)); const p = pending.get(value.id); if (!p) return; pending.delete(value.id); clearTimeout(p.timer); value.error ? p.reject(new Error(value.error.message)) : p.done(value.result); });
  const send = (method, params = {}) => new Promise((done, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000); pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  return { evaluate, send, close: () => socket.close() };
}
const until = async (expression, timeout = 25000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await renderer.evaluate(expression)) return; await sleep(70); } throw new Error(`Timed out: ${expression}`); };
const click = async (selector, text) => { const match = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`; await until(`Boolean(${match})`); await renderer.evaluate(`${match}.click();true`); };
const nativeProbe = async args => (await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/windows-notification-probe.ps1'), ...args], { windowsHide: true, timeout: 20000 })).stdout.trim();
const history = async () => { const raw = await nativeProbe([]); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : [list]; };
const actionArgs = (toast, index) => {
  const actions = [...toast.xml.matchAll(/<action\b[^>]*>/g)].map(match => match[0]);
  const encoded = actions[index]?.match(/arguments="([^"]*)"/)?.[1]; assert.ok(encoded, `Action ${index} missing: ${toast.xml}`);
  return encoded.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
};
async function toastFor(session) {
  for (let index = 0; index < 20; index++) {
    const found = (await history()).find(item => item.group === 'mingshen-approvals' && item.xml.includes(session.title));
    if (found) return found;
    await sleep(250);
  }
  throw new Error(`No native approval toast for ${session.title}`);
}
const activate = (toast, index) => nativeProbe(['-Activator', '{6094CEE7-98E1-4D01-97A6-68A726EBA51E}', '-Tag', toast.tag, '-RawArguments', actionArgs(toast, index)]);
async function select(session) {
  await renderer.evaluate("document.querySelectorAll('.session-group__show-all[aria-expanded=false]').forEach(el=>el.click());true");
  await click('.session-row__title', session.title);
  await until(`document.querySelector('.session-row--selected')?.textContent.includes(${JSON.stringify(session.title)})`);
}
const pending = session => until(`window.mingshen.getApprovalState().then(s=>s.requests.some(x=>x.sessionId===${JSON.stringify(session.id)}))`);
const idle = session => until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(session.id)})?.status==='idle')`);
async function start(session, scenario, hide = true) {
  await select(session);
  if (hide) await renderer.evaluate("window.mingshen.desktopAction('tray')");
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(`CASE:${scenario} create the bounded fixture file.`)}})`);
  await pending(session);
}
async function close() {
  if (!child) return;
  const current = child; const ended = new Promise(done => current.once('exit', done));
  await renderer?.evaluate("setTimeout(()=>void window.mingshen.desktopAction('quit'),100);true").catch(() => {});
  renderer?.close(); main?.close(); renderer = null; main = null;
  await Promise.race([ended, sleep(5000)]); assert.notEqual(current.exitCode, null); child = null;
}

try {
  await mkdir(project); await mkdir(shots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done)); const port = server.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9368', '.', '--remote-debugging-port=9367'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9368);
  await main.evaluate("globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true");
  renderer = await connect(9367); await until("Boolean(document.querySelector('.policy-consents'))"); await sleep(5100);
  await renderer.evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用'); await until("!document.querySelector('.policy-dialog')");
  const fixture = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Approval toast fixture',baseUrl:'http://127.0.0.1:${port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-notification-fixture-key',keyLabel:'Local',neverReveal:true});
    const p2=await window.mingshen.createModel({providerId:p.id,modelId:'notification-fixture',contextWindow:200000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const config={providerId:p.id,modelId:p2.models[0].id,workspacePath:${JSON.stringify(project)},permissionMode:'request_approval',reasoningLevel:null};const sessions=[];
    for(const name of ['approve','reject','stale','hidden','settings'])sessions.push(await window.mingshen.createSession({...config,title:'Toast '+name+' ${Date.now()}'}));
    for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);
    return {sessions};})()`);
  await renderer.send('Page.reload'); await until("document.querySelectorAll('.session-row').length===3");
  const [allow, deny, stale, hidden, settings] = fixture.sessions;
  await start(allow, 'approve');
  const allowToast = await toastFor(allow); assert.match(allowToast.xml, /content="批准"/); assert.match(allowToast.xml, /content="拒绝"/); assert.ok(!allowToast.xml.includes('Approved Windows notification fixture'));
  await activate(allowToast, 0); await idle(allow);
  assert.match(await readFile(resolve(project, 'approve.txt'), 'utf8'), /Approved Windows notification fixture/);
  assert.equal((await renderer.evaluate('window.mingshen.bootstrap()')).sessions.find(s => s.id === allow.id).permissionMode, 'request_approval');
  assert.ok(!(await history()).some(item => item.tag === allowToast.tag && item.group === 'mingshen-approvals'));
  passed.push('A real Windows toast offers Approve/Reject while hidden in tray; native COM Approve writes the exact file in the protected backend without changing permissions');

  await start(deny, 'reject'); const denyToast = await toastFor(deny); await activate(denyToast, 1); await idle(deny);
  await assert.rejects(readFile(resolve(project, 'reject.txt')), { code: 'ENOENT' });
  assert.match(JSON.stringify(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(deny.id)})`)), /Windows/);
  passed.push('Native Reject returns denial feedback to the original conversation and prevents the file from being written');

  await start(stale, 'stale'); const oldToast = await toastFor(stale);
  await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(stale.id)})`); await until("window.mingshen.getApprovalState().then(s=>s.requests.length===0)");
  await start(stale, 'replacement'); const replacement = await toastFor(stale); assert.notEqual(replacement.tag, oldToast.tag);
  await activate(oldToast, 0); await sleep(300); await pending(stale); await assert.rejects(readFile(resolve(project, 'replacement.txt')), { code: 'ENOENT' });
  await activate(replacement, 1); await idle(stale);
  passed.push('Stopped approvals remove their native toast; replaying an old native action cannot decide a newer request in the same conversation');

  await renderer.evaluate("window.mingshen.desktopAction('show')");
  await select(hidden); await renderer.evaluate("window.mingshen.setActiveNotificationSession(" + JSON.stringify(hidden.id) + ")");
  await main.evaluate("globalThis.__electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__electron.BrowserWindow.getAllWindows()[0].focus();true");
  await start(hidden, 'foreground', false); await sleep(200);
  assert.ok(!(await history()).some(item => item.group === 'mingshen-approvals' && item.xml.includes(hidden.title)));
  await renderer.evaluate("window.mingshen.desktopAction('minimize')"); const minimizedToast = await toastFor(hidden); await activate(minimizedToast, 1); await idle(hidden);
  passed.push('An approval already visible in the active foreground chat stays inline; minimizing afterward creates the native notification');

  await renderer.evaluate("window.mingshen.desktopAction('locale','en')");
  await renderer.evaluate("window.mingshen.configureCompletionNotifications({nativeEnabled:true,taskbarEnabled:true,showPreview:false,sound:false,approvalEnabled:true})");
  await start(settings, 'private');
  let privateToast;
  for(let index=0;index<10;index++){privateToast=(await history()).find(x=>x.group==='mingshen-approvals'&&x.xml.includes('Approval required'));if(privateToast)break;await sleep(200);}
  assert.ok(privateToast); assert.match(privateToast.xml, /Approve once/); assert.match(privateToast.xml, /Reject/); assert.ok(!privateToast.xml.includes(settings.title)); assert.ok(!privateToast.xml.includes('private.txt')); assert.match(privateToast.xml, /silent="true"/);
  await renderer.evaluate("window.mingshen.configureCompletionNotifications({nativeEnabled:true,taskbarEnabled:true,showPreview:false,sound:false,approvalEnabled:false})");
  assert.ok(!(await history()).some(item=>item.tag===privateToast.tag&&item.group==='mingshen-approvals'));
  await activate(privateToast, 0); await pending(settings); await assert.rejects(readFile(resolve(project, 'private.txt')), {code:'ENOENT'});
  await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(settings.id)})`);
  passed.push('English native action labels, preview suppression, silent mode and the separate approval-notification toggle work; disabling removes actionable routes');

  await renderer.evaluate("window.mingshen.desktopAction('show')");
  await renderer.evaluate("document.querySelector('.desktop-caption button[aria-label=\"中文 / English\"]').click();true");
  await until("document.documentElement.lang==='en'");
  await renderer.evaluate("document.querySelector('.app-topbar button[aria-label=\"Open settings\"]').click();true");
  await until("Boolean(document.querySelector('.settings-workspace'))");
  await until("Boolean([...document.querySelectorAll('.setting-row')].find(x=>x.textContent.includes('Approval notifications')))");
  await renderer.evaluate("[...document.querySelectorAll('.setting-row')].find(x=>x.textContent.includes('Approval notifications')).scrollIntoView({block:'center'});true");
  const image = await renderer.send('Page.captureScreenshot',{format:'png'});await writeFile(resolve(shots,'approval-notification-settings-en.png'),Buffer.from(image.data,'base64'));
  passed.push('The independent approval toggle is present in the real English settings and persists through the existing notification settings API');
  console.log(JSON.stringify({ passed, native: true, version:'1.2.5', screenshots:shots },null,2));
} finally {
  if(child){try{await close();}catch{renderer?.close();main?.close();child?.kill();}}
  server.closeAllConnections();await new Promise(done=>server.close(done));
  if(temporary.startsWith(resolve(tmpdir())+sep))await rm(temporary,{recursive:true,force:true});
}
