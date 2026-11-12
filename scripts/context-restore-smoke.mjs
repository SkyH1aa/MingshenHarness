import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-context-restart-'));
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const requests = [];
let child, renderer, main;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  requests.push(body);
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Persisted context evidence. The original task is complete.' })}\n\n`);
  response.write(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 32000, output_tokens: 500, total_tokens: 32500 } } })}\n\n`);
  response.end();
});

async function connect(port) {
  let target;
  for (let index = 0; index < 120; index++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(result => result.json())).find(item => item.webSocketDebuggerUrl); if (target) break; } catch {}
    await sleep(100);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data)); const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id); clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  return { evaluate, send, close: () => socket.close() };
}
const until = async (expression, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await renderer.evaluate(expression)) return; await sleep(60); }
  throw new Error(`Timed out: ${expression}`);
};
const click = async (selector, text) => {
  const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
  await until(`Boolean(${expression})`); await renderer.evaluate(`${expression}.click();true`);
};
async function launch() {
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9352', '.', '--remote-debugging-port=9351'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9352);
  await main.evaluate("globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true");
  renderer = await connect(9351);
}
async function close() {
  const processToClose = child;
  const ended = new Promise(done => processToClose.once('exit', done));
  await renderer.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer.close(); main.close(); renderer = null; main = null;
  await Promise.race([ended, sleep(5000)]);
  assert.notEqual(processToClose.exitCode, null, 'Fixture application must quit cleanly before restart');
  child = null;
}
async function shot(name) {
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}
try {
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch();
  await until("Boolean(document.querySelector('.policy-consents'))"); await sleep(5100);
  await renderer.evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  const fixture = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Local persistence fixture',baseUrl:'http://127.0.0.1:${port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-fixture-key',keyLabel:'Local',neverReveal:true});
    for(const name of ['current','other'])await window.mingshen.createModel({providerId:p.id,modelId:name,contextWindow:name==='current'?200000:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const data=await window.mingshen.bootstrap();const models=data.providers.find(x=>x.id===p.id).models;
    const session=await window.mingshen.createSession({providerId:p.id,modelId:models.find(m=>m.modelId==='current').id,title:'Persisted context',workspacePath:null,permissionMode:'request_approval',reasoningLevel:null});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    return {session,other:models.find(m=>m.modelId==='other')};})()`);
  await renderer.send('Page.reload');
  await until("Boolean(document.querySelector('.context-meter')) && !document.querySelector('.context-meter').textContent.includes('—')");
  const initial = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(fixture.session.id)})`);
  assert.ok(initial.usedTokens > 0); assert.equal(initial.estimateScope, 'local'); assert.equal(requests.length, 0);
  passed.push('An unsent conversation shows a local estimate including bundled prompt cost without making a model request');
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.session.id)},text:'Check persistence and retain all task constraints.'})`);
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(fixture.session.id)})?.status==='idle')`);
  await until("document.querySelector('.context-meter')?.textContent.includes('16%')");
  assert.equal(requests.length, 1);
  const measured = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(fixture.session.id)})`);
  assert.equal(measured.usedTokens, 32500);
  const messages = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.session.id)})`);
  await close();
  await launch();
  await until("document.querySelector('.context-meter')?.textContent.includes('16%')");
  const restored = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(fixture.session.id)})`);
  assert.equal(restored.usedTokens, measured.usedTokens); assert.equal(restored.updatedAt, measured.updatedAt); assert.equal(restored.restored, true);
  assert.equal(requests.length, 1);
  await renderer.evaluate("document.querySelector('.context-meter').click();true");
  await until("document.querySelector('.context-details')?.textContent.includes('已从本地记录恢复')");
  assert.match(await renderer.evaluate("document.querySelector('.context-details__usage').textContent"), /32.5K.*200K/);
  await shot('context-restored-zh-night');
  await renderer.evaluate("document.querySelector('.context-details header button').click();true");
  passed.push('A full clean quit and fresh process restore the exact 32.5K/200K usage and timestamp, with no extra model request');
  await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(fixture.session.id)},modelId:${JSON.stringify(fixture.other.id)}})`);
  const switched = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(fixture.session.id)})`);
  assert.equal(switched.modelId, fixture.other.id); assert.equal(switched.contextWindow, 128000); assert.equal(switched.source, 'estimate'); assert.ok(switched.usedTokens < 32500);
  await renderer.send('Page.reload');
  await until("Boolean(document.querySelector('.context-meter')) && !document.querySelector('.context-meter').textContent.includes('—')");
  assert.equal(requests.length, 1);
  passed.push('Switching models immediately recalculates the estimate for the new window and remains visible after reload');
  const fork = await renderer.evaluate(`window.mingshen.forkSession(${JSON.stringify(fixture.session.id)})`);
  const forked = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(fork.id)})`);
  assert.ok(forked.usedTokens > 0); assert.equal(forked.modelId, fixture.other.id); assert.equal(requests.length, 1);
  passed.push('Forks receive a local effective-history estimate immediately without sharing source calibration');
  // Emulate only an older view shape in this disposable database; never access the normal profile.
  const snapshotKey = `context.snapshot.${fixture.session.id}`;
  const viewKey = `context.view.${fixture.session.id}`;
  await main.evaluate(`(()=>{const db=new (process.getBuiltinModule('node:sqlite').DatabaseSync)(${JSON.stringify(resolve(profile, 'mingshen.db'))});const key=${JSON.stringify(viewKey)};const row=db.prepare('select value_json from app_settings where key = ?').get(key);const state=JSON.parse(row.value_json);delete state.providerId;delete state.modelId;db.prepare('update app_settings set value_json = ? where key = ?').run(JSON.stringify(state),key);db.prepare('delete from app_settings where key = ?').run(${JSON.stringify(snapshotKey)});db.close();return true})()`);
  await close(); await launch();
  await click('.session-row__title', 'Persisted context');
  await until("Boolean(document.querySelector('.context-meter')) && !document.querySelector('.context-meter').textContent.includes('—')");
  const legacy = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(fixture.session.id)})`);
  assert.equal(legacy.modelId, fixture.other.id); assert.equal(legacy.source, 'estimate');
  assert.equal(requests.length, 1);
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.session.id)})`), messages);
  passed.push('Legacy missing-identity records recover on a third real launch while original messages remain unchanged');
  await renderer.evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click();document.documentElement.dataset.theme='day';true");
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate("document.querySelector('.context-meter').click();true");
  await until("Boolean(document.querySelector('.context-details'))");
  assert.match(await renderer.evaluate("document.querySelector('.context-details').textContent"), /Local context estimate/);
  assert.doesNotMatch(await renderer.evaluate("document.querySelector('.context-details').textContent"), /[\u4e00-\u9fff]/);
  await shot('context-restored-en-day');
  const bounds = await renderer.evaluate("(()=>{const r=document.querySelector('.context-details').getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight}})()");
  assert.ok(bounds.top >= 0 && bounds.left >= 0 && bounds.right <= bounds.w && bounds.bottom <= bounds.h);
  passed.push('Restored and estimated usage descriptions render in Chinese/night and English/day at a compact desktop size');
  console.log(JSON.stringify({ passed, modelRequests: requests.length, launches: 3, screenshots }, null, 2));
  await close();
} finally {
  renderer?.close(); main?.close();
  if (child && child.exitCode === null) child.kill();
  server.closeAllConnections(); await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
