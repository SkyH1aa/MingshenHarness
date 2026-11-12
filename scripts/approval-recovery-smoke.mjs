import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-approval-recovery-'));
const project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const rounds = new Map();
const only = process.argv.find(value => value.startsWith('--only='))?.slice(7);
let child;
let renderer;
let main;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const finish = () => {
    event({ type: 'response.completed', response: { usage: { input_tokens: 40, output_tokens: 20, total_tokens: 60 } } });
    response.end();
  };
  if (String(body.instructions).trim().startsWith('# 会话标题生成')) {
    event({ type: 'response.output_text.delta', delta: 'Recovery check' }); finish(); return;
  }
  if (String(body.instructions).includes('[PROJECT_MEMORY_SUMMARY]')) {
    event({ type: 'response.output_text.delta', delta: 'Verified approval recovery while preserving actual user decisions and protected file changes.' });
    finish(); return;
  }
  const scenario = [...JSON.stringify(body.input).matchAll(/SCENARIO:([a-z]+)/g)].at(-1)?.[1] || 'default';
  const round = (rounds.get(scenario) || 0) + 1;
  rounds.set(scenario, round);
  if (round <= 2) {
    const question = scenario === 'question';
    const args = question
      ? { question: `Recovery question ${round}?`, header: 'Recovery', options: [{ label: 'Continue', description: 'Continue the test.' }] }
      : { path: `${scenario}-${round}.txt`, content: `Verified ${scenario} operation ${round}.\n` };
    event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: `${scenario}-${round}`, name: question ? 'ask_user' : 'write_file', arguments: '' } });
    event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: JSON.stringify(args) });
  } else event({ type: 'response.output_text.delta', delta: 'Recovery run completed.' });
  finish();
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
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id); clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(key, { done, reject, timer });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  return { evaluate, send, close: () => socket.close() };
}

try {
  await mkdir(project); await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9360', '.', '--remote-debugging-port=9359'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9360);
  await main.evaluate(`globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);globalThis.__electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');true`);
  renderer = await connect(9359);
  const { evaluate, send } = renderer;
  const until = async (expression, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(65); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (selector, text) => {
    const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`;
    await until(`Boolean(${expression})`); await evaluate(`${expression}.click();true`);
  };
  const shot = async name => { const image = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); };
  const finished = async id => until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(id)})?.status==='idle')`);
  const start = async (session, scenario) => {
    await click('.session-row__title', session.title);
    await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(`SCENARIO:${scenario} perform the test.`)}})`);
  };
  await until("Boolean(document.querySelector('.policy-consents'))");
  await evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  const fixture = await evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Local recovery fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-test-key',keyLabel:'Local',neverReveal:true});
    await window.mingshen.createModel({providerId:p.id,modelId:'recovery-model',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const provider=(await window.mingshen.bootstrap()).providers.find(x=>x.id===p.id);
    const config={providerId:p.id,modelId:provider.models[0].id,workspacePath:${JSON.stringify(project)},reasoningLevel:null,permissionMode:'request_approval'};
    const sessions=[];for(const title of ['Lost question event','Approval visibility','Slow approval'])sessions.push(await window.mingshen.createSession({...config,title}));
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    return {sessions,config};
  })()`);
  await send('Page.reload'); await until("document.querySelectorAll('.session-row').length===3");
  await evaluate("window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));true");
  const [question, visibility, slow] = fixture.sessions;
  if (!only || only === 'question') {
  // Drop live question delivery only in this isolated debugger process.
  await main.evaluate(`globalThis.__wc=globalThis.__electron.BrowserWindow.getAllWindows()[0].webContents;globalThis.__send=globalThis.__wc.send;globalThis.__wc.send=function(channel,event,...rest){if(channel==='runtime:event'&&['question_required','question_state'].includes(event?.type))return;return globalThis.__send.call(this,channel,event,...rest);};true`);
  await start(question, 'question');
  await until(`window.mingshen.bootstrap().then(s=>s.pendingQuestions.length===1)`);
  await until("Boolean(document.querySelector('.question-panel'))", 12000);
  await main.evaluate(`globalThis.__wc.send=globalThis.__send;true`);
  assert.match(await evaluate("document.querySelector('.question-panel').textContent"), /Recovery question 1/);
  await evaluate("document.querySelector('.question-option').click();true");
  await click('.question-panel button', '提交回答');
  await until("document.querySelector('.question-panel')?.textContent.includes('Recovery question 2')");
  await evaluate("document.querySelector('.question-option').click();true");
  await click('.question-panel button', '提交回答'); await finished(question.id);
  passed.push('Lost Agent question event recovers through authoritative polling; consecutive questions remain answerable');
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 680, deviceScaleFactor: 1, mobile: false });
  if (!only || only === 'approval') {
  await main.evaluate(`globalThis.__wc=globalThis.__electron.BrowserWindow.getAllWindows()[0].webContents;globalThis.__send=globalThis.__wc.send;globalThis.__wc.send=function(channel,event,...rest){if(channel==='runtime:event'&&['approval_required','approval_state'].includes(event?.type))return;return globalThis.__send.call(this,channel,event,...rest);};true`);
  await start(visibility, 'lostapproval');
  await until("window.mingshen.getApprovalState().then(s=>s.requests.length===1)");
  await until("Boolean(document.querySelector('.approval-panel'))", 12000);
  await main.evaluate("globalThis.__wc.send=globalThis.__send;true");
  await click('.session-row__title', question.title);
  await until("!document.querySelector('.approval-panel')");
  await click('.session-row__title', visibility.title);
  await until("document.querySelector('.approval-panel__detail')?.textContent.includes('lostapproval-1.txt')");
  await click('.approval-panel button', '拒绝');
  await until("document.querySelector('.approval-panel__detail')?.textContent.includes('lostapproval-2.txt')");
  await click('.approval-panel button', '拒绝'); await finished(visibility.id);
  await assert.rejects(readFile(resolve(project, 'lostapproval-1.txt')));
  passed.push('Lost tool approval events recover through polling and survive conversation switches without granting access');
  }
  if (!only || only === 'rejected') {
  await start(slow, 'rejected'); await until("Boolean(document.querySelector('.approval-panel'))");
  await main.evaluate(`globalThis.__approvalHandler=globalThis.__electron.ipcMain._invokeHandlers.get('approval:decide');globalThis.__electron.ipcMain._invokeHandlers.set('approval:decide',async()=>{throw new Error('Fixture submission failed');});true`);
  await click('.approval-panel button', '本会话允许');
  await until("document.querySelector('.approval-panel .form-error')?.textContent.includes('Fixture submission failed')");
  assert.ok(await evaluate("[...document.querySelectorAll('.approval-panel button')].some(x=>!x.disabled&&x.textContent.trim()==='仅本次')"), 'Failed submission must leave approval buttons usable');
  await main.evaluate("globalThis.__electron.ipcMain._invokeHandlers.set('approval:decide',globalThis.__approvalHandler);true");
  await click('.approval-panel button', '拒绝');
  await until("document.querySelector('.approval-panel__detail')?.textContent.includes('rejected-2.txt')");
  await click('.approval-panel button', '拒绝'); await finished(slow.id);
  await assert.rejects(readFile(resolve(project, 'rejected-1.txt')));
  passed.push('Rejected approval IPC restores active controls and the pending operation remains denied until a real decision');
  }
  if (!only || only === 'visibility') {
  await start(visibility, 'visibility');
  await until("Boolean(document.querySelector('.approval-panel'))");
  await evaluate(`(()=>{const e=document.querySelector('.composer > textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(e,${JSON.stringify('Draft line\n'.repeat(20))});e.dispatchEvent(new Event('input',{bubbles:true}));})();true`);
  await evaluate("const c=document.querySelector('.composer-wrap');c.scrollTop=c.scrollHeight;true");
  await click('.approval-panel button', '本会话允许');
  await until("document.querySelector('.approval-panel__detail')?.textContent.includes('visibility-2.txt')");
  const bounds = await evaluate("(()=>{const p=document.querySelector('.approval-panel');const b=[...p.querySelectorAll('button')].find(x=>x.textContent.trim()==='仅本次');const r=b.getBoundingClientRect();const c=document.querySelector('.composer-wrap').getBoundingClientRect();return {top:r.top,bottom:r.bottom,containerTop:c.top,containerBottom:c.bottom,height:innerHeight};})()");
  assert.ok(bounds.top >= bounds.containerTop && bounds.bottom <= Math.min(bounds.containerBottom, bounds.height), `Approval actions are clipped: ${JSON.stringify(bounds)}`);
  await shot('approval-recovery-zh-night-compact');
  await click('.approval-panel button', '仅本次'); await finished(visibility.id);
  assert.match(await readFile(resolve(project, 'visibility-2.txt'), 'utf8'), /Verified visibility/);
  passed.push('Next approval stays visible with a tall draft and a previously scrolled composer in a compact window');
  }

  if (!only || only === 'slow') {
  await start(slow, 'slow'); await until("Boolean(document.querySelector('.approval-panel'))");
  await main.evaluate(`globalThis.__approvalHandler=globalThis.__electron.ipcMain._invokeHandlers.get('approval:decide');globalThis.__electron.ipcMain._invokeHandlers.set('approval:decide',async(...args)=>{await new Promise(done=>setTimeout(done,8000));return globalThis.__approvalHandler(...args);});true`);
  await click('.approval-panel button', '本会话允许');
  await until("Boolean(document.querySelector('.approval-submission'))");
  assert.equal(await evaluate("window.mingshen.getApprovalState().then(s=>s.requests.length)"), 1);
  await shot('approval-recovery-submitting-zh-night');
  await until("Boolean(document.querySelector('.approval-panel'))", 7000);
  assert.ok(await evaluate("document.querySelector('.approval-panel').textContent.includes('尚未确认')"));
  await until("document.querySelector('.approval-panel__detail')?.textContent.includes('slow-2.txt')", 16000);
  await main.evaluate("globalThis.__electron.ipcMain._invokeHandlers.set('approval:decide',globalThis.__approvalHandler);true");
  await click('.approval-panel button', '仅本次'); await finished(slow.id);
  assert.match(await readFile(resolve(project, 'slow-1.txt'), 'utf8'), /Verified slow/);
  assert.match(await readFile(resolve(project, 'slow-2.txt'), 'utf8'), /Verified slow/);
  passed.push('Delayed submission shows status, restores pending controls and never lets an older acknowledgement hide the next approval');
  }

  if (!only || only === 'reload') {
  await click('.session-row__title', slow.title);
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click();document.documentElement.dataset.theme='day';true");
  await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(slow.id)},text:'SCENARIO:english perform the test.'})`);
  await until("Boolean(document.querySelector('.approval-panel'))"); await shot('approval-recovery-en-day-compact');
  await send('Page.reload'); await until("Boolean(document.querySelector('.approval-panel'))");
  await click('.approval-panel button', 'Deny'); await until("document.querySelector('.approval-panel__detail')?.textContent.includes('english-2.txt')");
  await click('.approval-panel button', 'Deny'); await finished(slow.id);
  await assert.rejects(readFile(resolve(project, 'english-1.txt')));
  await assert.rejects(readFile(resolve(project, 'english-2.txt')));
  passed.push('English/day pending approvals survive reload and denials still prevent protected writes');
  }
  assert.deepEqual(await evaluate('window.__errors||[]'), []);
  console.log(JSON.stringify({ passed, rounds: Object.fromEntries(rounds), screenshots }, null, 2));
  await evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true');
  renderer.close(); renderer = null; main.close(); main = null;
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
} finally {
  renderer?.close(); main?.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  server.closeAllConnections(); await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
