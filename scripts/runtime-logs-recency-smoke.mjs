import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-logs-recency-'));
const profile = resolve(temporary, 'profile');
const project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const key = 'opaque-fixture-credential-not-a-real-key';
let child, renderer, main;
let failSummary = false;
const server = createServer(async (request, response) => {
  if (request.url.endsWith('/models')) { response.writeHead(503); response.end(`Fixture model list unavailable ${key}`); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const summary = String(body.instructions).startsWith('# 会话压缩任务');
  const review = String(body.instructions).startsWith('You are the security reviewer');
  if ((summary && failSummary) || body.model === 'review-primary') { response.writeHead(503); response.end(`Fixture upstream unavailable ${key}`); return; }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const text = review ? 'Maybe this is okay, but no formal verdict.' : summary ? 'Preserve user goals and constraints. Earlier work found verified facts. Continue the pending task.' : 'Verified source evidence and prior task constraints.\n'.repeat(1200);
  response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`);
  response.write(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: summary || review ? 500 : 70000, output_tokens: summary || review ? 100 : 15000 } } })}\n\n`);
  response.end();
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
  socket.addEventListener('message', event => { const value = JSON.parse(String(event.data)); const waiter = pending.get(value.id); if (!waiter) return; pending.delete(value.id); clearTimeout(waiter.timer); value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result); });
  const send = (method, params = {}) => new Promise((done, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000); pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result.value; };
  return { evaluate, send, close: () => socket.close() };
}
const until = async (expression, timeout = 25000) => { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await renderer.evaluate(expression)) return; await sleep(60); } throw new Error(`Timed out: ${expression}`); };
const click = async (selector, text) => { const match = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`; await until(`Boolean(${match})`); await renderer.evaluate(`${match}.click();true`); };
const rows = () => renderer.evaluate("[...document.querySelectorAll('.session-row__title')].map(x=>x.textContent)");
async function launch() {
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9366', '.', '--remote-debugging-port=9365'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9366);
  await main.evaluate("globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true");
  renderer = await connect(9365);
  await until("Boolean(document.querySelector('.desktop-caption'))");
  await main.evaluate("globalThis.__electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');true");
}
async function close() {
  const current = child; const ended = new Promise(done => current.once('exit', done));
  await renderer.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer.close(); main.close(); renderer = null; main = null;
  await Promise.race([ended, sleep(5000)]); assert.notEqual(current.exitCode, null); child = null;
}
async function shot(name) { const image = await renderer.send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); }
async function select(title) {
  if (!(await rows()).includes(title)) await renderer.evaluate("document.querySelector('.session-group__show-all')?.click();true");
  await click('.session-row__title', title);
}
async function run(session, text) {
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(text)}})`);
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(session.id)})?.status==='idle')`);
}
try {
  await mkdir(screenshots, { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(resolve(project, 'fixture.txt'), 'Local read-only fixture.');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch();
  await until("Boolean(document.querySelector('.policy-consents'))"); await sleep(5100);
  await renderer.evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用'); await until("!document.querySelector('.policy-dialog')");
  const fixture = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Local logging fixture',baseUrl:'http://127.0.0.1:${port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:${JSON.stringify(key)},keyLabel:'Local',neverReveal:true});
    for(const name of ['current','review-primary','review-backup','summary-backup'])await window.mingshen.createModel({providerId:p.id,modelId:name,contextWindow:200000,maxOutputTokens:20000,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const models=(await window.mingshen.bootstrap()).providers.find(x=>x.id===p.id).models;const config={providerId:p.id,modelId:models.find(m=>m.modelId==='current').id,workspacePath:${JSON.stringify(project)},permissionMode:'request_approval',reasoningLevel:null};
    const sessions=[];for(const title of ['Conversation 1','Conversation 2','Conversation 3','Conversation 4','Conversation 5','Conversation 6'])sessions.push(await window.mingshen.createSession({...config,title}));
    for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);
    return {providerId:p.id,models,sessions};})()`);
  await renderer.send('Page.reload'); await until("document.querySelectorAll('.session-row').length===3");
  assert.equal((await rows()).length, 3);
  await renderer.evaluate("document.querySelector('.session-group__show-all').click();true"); await until("document.querySelectorAll('.session-row').length===6");
  await select('Conversation 1');
  await until("document.querySelector('.session-row--selected')?.textContent.includes('Conversation 1')");
  await click('.session-group__show-all', '收起，仅显示最近 3 个');
  await until("document.querySelectorAll('.session-row').length===3"); assert.ok((await rows()).includes('Conversation 1'));
  await renderer.evaluate("document.querySelector('.session-group__header').click();true"); await sleep(3400); assert.equal((await rows()).length, 0);
  await renderer.evaluate("document.querySelector('.session-group__header').click();true"); await until("document.querySelectorAll('.session-row').length===3");
  await shot('v125-recent-sessions-zh-night');
  passed.push('Folder shows three recent conversations; expands all six, promotes an opened older chat and remains collapsed across background polls');

  const visible = await rows(); const hiddenSession = fixture.sessions.find(s => !visible.includes(s.title)); assert.ok(hiddenSession);
  const search = '.session-search input';
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(search)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(hiddenSession.title)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await until(`document.querySelector('.session-row__title')?.textContent===${JSON.stringify(hiddenSession.title)}`);
  assert.equal((await rows()).length, 1);
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(search)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await until("document.querySelectorAll('.session-row').length===3");
  passed.push('Search includes conversations hidden by the recent-three limit');

  const session = fixture.sessions[0]; await select(session.title);
  await run(session, 'Build a verified record of the project findings.');
  const before = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(session.id)})`); assert.ok(before.usedTokens >= 85000);
  await renderer.evaluate(`window.mingshen.compactChat(${JSON.stringify(session.id)})`);
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(session.id)})?.status==='idle')`);
  const after = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(session.id)})`); assert.ok(after.usedTokens < before.usedTokens * 0.7, `${before.usedTokens} -> ${after.usedTokens}`);
  await until(`document.querySelector('.context-meter')?.textContent.includes(${JSON.stringify(`${Math.floor(after.usedTokens / 200000 * 100)}%`)})`);
  await renderer.evaluate("document.querySelector('.context-meter').click();true"); await shot('v125-compacted-ctx-zh-night');
  await renderer.send('Page.reload'); await until("Boolean(document.querySelector('.context-meter'))");
  assert.equal((await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(session.id)})`)).usedTokens, after.usedTokens);
  passed.push(`Manual compaction lowers actual effective CTX (${before.usedTokens} -> ${after.usedTokens}), updates the live meter and persists across reload`);

  await renderer.evaluate(`window.mingshen.fetchProviderModels(${JSON.stringify(fixture.providerId)}).catch(()=>null)`);
  const primary = fixture.models.find(m => m.modelId === 'review-primary'); const backup = fixture.models.find(m => m.modelId === 'review-backup');
  await renderer.evaluate(`window.mingshen.testProvider(${JSON.stringify(fixture.providerId)},${JSON.stringify(primary.id)})`);
  await renderer.evaluate(`window.mingshen.setApprovalModelSettings({providerId:${JSON.stringify(fixture.providerId)},modelId:${JSON.stringify(primary.id)},fallback:{providerId:${JSON.stringify(fixture.providerId)},modelId:${JSON.stringify(backup.id)}}})`);
  // Exercise approval attempts via the real chat tool request without exposing a production testing API.
  await main.evaluate(`globalThis.__realFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{
    if(String(url).includes('/v1/responses')){const b=JSON.parse(options.body);if(b.model==='current'&&b.tools?.length){return new Response('data: '+JSON.stringify({type:'response.output_item.added',output_index:0,item:{type:'function_call',call_id:'log-approval',name:'read_file',arguments:'{"path":"fixture.txt"}'}})+'\\n\\ndata: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:500,output_tokens:50}}})+'\\n\\n',{headers:{'Content-Type':'text/event-stream'}});}}
    return globalThis.__realFetch(url,options);};true`);
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:'Read the requested local fixture.'})`);
  await until("window.mingshen.getApprovalState().then(s=>s.requests.length>0)");
  await renderer.evaluate(`window.mingshen.startAutomaticApproval(${JSON.stringify(session.id)})`);
  await until("window.mingshen.getApprovalState().then(s=>s.requests.some(x=>x.review?.state==='manual'&&x.review.reason?.includes('备用审批模型失败')))");
  await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(session.id)})`);
  await main.evaluate("globalThis.fetch=globalThis.__realFetch;true");
  await renderer.evaluate("window.mingshen.reportRuntimeError({source:'window',message:'Fixture renderer failure',stack:'Fixture stack line'})");
  await renderer.evaluate("console.error('Fixture captured console error');true");
  failSummary = true;
  const summaryBackup = fixture.models.find(m => m.modelId === 'summary-backup');
  await renderer.evaluate(`window.mingshen.setCompactionFallbackModel({providerId:${JSON.stringify(fixture.providerId)},modelId:${JSON.stringify(summaryBackup.id)}})`);
  await renderer.evaluate(`window.mingshen.compactChat(${JSON.stringify(session.id)})`);
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(session.id)})?.status==='error')`);
  failSummary = false;
  await renderer.evaluate("document.querySelector('.app-topbar button[aria-label=\"打开设置\"]').click();true");
  await click('.settings-nav__item', '运行日志'); await until("Boolean(document.querySelector('.runtime-log-details')?.textContent.includes('MiB'))");
  const reportPath = resolve(temporary, 'runtime-report.json');
  await main.evaluate(`globalThis.__save=globalThis.__electron.dialog.showSaveDialog;globalThis.__electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(reportPath)}});true`);
  await click('.runtime-log-settings button', '导出运行日志');
  await until("Boolean(document.querySelector('.runtime-log-settings [role=status]'))");
  await main.evaluate("globalThis.__electron.dialog.showSaveDialog=globalThis.__save;true");
  const raw = await readFile(reportPath, 'utf8'); const report = JSON.parse(raw);
  assert.ok(report.entries.some(e => e.source === 'provider.models' && e.context.status === 503));
  assert.ok(report.entries.some(e => e.source === 'provider.test' && e.context.status === 503));
  assert.ok(report.entries.some(e => e.source === 'approval.model' && e.context.attempt === 'primary'));
  assert.ok(report.entries.some(e => e.source === 'approval.model' && e.context.attempt === 'fallback' && e.context.code === 'INVALID_VERDICT'));
  assert.ok(report.entries.some(e => e.source === 'compaction.model' && e.context.attempt === 'primary'));
  assert.ok(report.entries.some(e => e.source === 'compaction.model' && e.context.attempt === 'fallback'));
  assert.ok(report.entries.some(e => e.source === 'renderer.window'));
  assert.ok(report.entries.some(e => e.source === 'renderer.console'));
  assert.ok(report.entries.some(e => e.source === 'chat.run'));
  assert.ok(!raw.includes(key)); assert.ok(!raw.includes('Verified source evidence and prior task constraints.'));
  await shot('v125-runtime-logs-zh-night');
  passed.push('Real IPC export includes model-list/test HTTP503, primary/backup approval and invalid verdict, both compaction attempts, run failure and renderer errors with no credentials or full chat');
  await click('.settings-nav__item', '外观与语言'); await click('.settings-content button', 'English');
  await renderer.evaluate("document.querySelector('.theme-card__preview--day').closest('button').click();true");
  await click('.settings-nav__item', 'Runtime logs'); await until("Boolean(document.querySelector('.runtime-log-settings'))");
  assert.ok(!(await renderer.evaluate("document.querySelector('.runtime-log-settings').textContent")).match(/[\u4e00-\u9fff]/));
  await main.evaluate("globalThis.__electron.BrowserWindow.getAllWindows()[0].setSize(1040,680);true"); await sleep(300);
  assert.ok(await renderer.evaluate("[...document.querySelectorAll('.runtime-log-settings button,.runtime-log-details dd')].every(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+2;})"));
  await shot('v125-runtime-logs-en-day');
  passed.push('Log export/status layout fits 1040x680 in English day theme and Chinese night theme');
  await close(); await launch(); await until("Boolean(document.querySelector('.session-row'))");
  const persisted = await renderer.evaluate('window.mingshen.getRuntimeLogStatus()'); assert.ok(persisted.bytes > 0);
  assert.equal((await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(session.id)})`)).state, 'failed');
  passed.push('Logs survive a real application exit/restart and failed compaction remains visible without replacing saved history');
  console.log(JSON.stringify({ passed, logEntries: report.entries.length, version: report.version, screenshots }, null, 2));
} finally {
  if (child) {
    try { await close(); } catch { renderer?.close(); main?.close(); child?.kill(); }
  }
  await new Promise(done => server.close(done));
  if (temporary.startsWith(resolve(tmpdir()) + sep)) await rm(temporary, { recursive: true, force: true });
}
