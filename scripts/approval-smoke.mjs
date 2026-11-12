import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-approvals-'));
const project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
let child;
let renderer;
let main;
let reviewMode = 'allow';
let holdFinal = false;
let reviewRequests = 0;
let backupRequests = 0;
let backupMode = 'allow';
let holdBackup = false;
const requests = new Map();
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const prompt = String(body.instructions || '');
  response.writeHead(reviewMode === 'error' && body.model === 'review-model' ? 503 : 200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const end = () => { event({ type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } } }); response.end(); };
  if (body.model === 'review-model' || body.model === 'backup-review') {
    if (body.model === 'backup-review') {
      backupRequests++;
      while (holdBackup && !response.destroyed) await sleep(40);
      if (response.destroyed) return;
      event({ type: 'response.output_text.delta', delta: backupMode === 'invalid' ? 'Backup cannot decide' : backupMode === 'deny' ? '{"decision":"deny","reason":"Backup refuses this host operation."}' : '{"decision":"allow","reason":"Backup confirms this bounded operation."}' });
      end(); return;
    }
    reviewRequests++;
    assert.equal(body.tools?.length ?? 0, 0);
    if (reviewMode === 'error') { response.end('upstream unavailable'); return; }
    await sleep(250);
    event({ type: 'response.output_text.delta', delta: reviewMode === 'deny' ? 'DENY: Fixture refuses this operation.' : reviewMode === 'invalid' ? 'Maybe safe.' : 'ALLOW: Fixture confirms this bounded operation.' });
    end();
    return;
  }
  if (prompt.trim().startsWith('# 会话标题生成')) { event({ type: 'response.output_text.delta', delta: 'Approval regression' }); end(); return; }
  const text = JSON.stringify(body.input || []);
  const scenario = [...text.matchAll(/SCENARIO:([a-z]+)/g)].at(-1)?.[1] || 'default';
  const round = (requests.get(scenario) || 0) + 1;
  requests.set(scenario, round);
  if (round <= 2) {
    // Different paths force two distinct approvals even after a session-scoped grant.
    event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: `${scenario}-${round}`, name: 'write_file', arguments: '' } });
    event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: JSON.stringify({ path: `${scenario}-${round}.txt`, content: `Verified ${scenario} operation ${round}.\n` }) });
  } else {
    while (holdFinal && !response.destroyed) await sleep(50);
    if (response.destroyed) return;
    event({ type: 'response.output_text.delta', delta: 'Verified final answer.' });
  }
  end();
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
    pending.delete(value.id);
    clearTimeout(waiter.timer);
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
  await mkdir(project);
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9347', '.', '--remote-debugging-port=9342'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9347);
  await main.evaluate(`globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);globalThis.__electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');true`);
  renderer = await connect(9342);
  const { evaluate, send } = renderer;
  const until = async (expression, timeout = 25000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(60); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (selector, text) => {
    const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`;
    await until(`(()=>{const el=${expression};if(!el)return false;el.click();return true;})()`);
  };
  const select = async title => {
    if (!(await evaluate(`[...document.querySelectorAll('.session-row__title')].some(el=>el.textContent===${JSON.stringify(title)})`))) await evaluate("document.querySelectorAll('.session-group__show-all[aria-expanded=false]').forEach(el=>el.click());true");
    await click('.session-row__title', title);
  };
  const snapshot = async () => evaluate('window.mingshen.getApprovalState()');
  const pending = async () => { await until('window.mingshen.getApprovalState().then(s=>s.requests.length>0)'); await until("Boolean(document.querySelector('.approval-panel'))"); return (await snapshot()).requests[0]; };
  const shot = async name => { const image = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); };
  const finished = async sessionId => until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(sessionId)})?.status==='idle')`);
  const start = async (session, scenario) => {
    await select(session.title);
    await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(`SCENARIO:${scenario} create the requested files.`)}})`);
  };
  await until("Boolean(document.querySelector('.policy-consents'))");
  await evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  const fixture = await evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Local fixture',baseUrl:'http://127.0.0.1:${port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-test-key',keyLabel:'Local',neverReveal:true});
    for(const id of ['agent-model','review-model','backup-review']) await window.mingshen.createModel({providerId:provider.id,modelId:id,contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const configured=(await window.mingshen.bootstrap()).providers.find(p=>p.id===provider.id);
    const model=configured.models.find(m=>m.modelId==='agent-model');
    const review=configured.models.find(m=>m.modelId==='review-model');
    const config={providerId:provider.id,modelId:model.id,workspacePath:${JSON.stringify(project)},reasoningLevel:null,permissionMode:'request_approval'};
    const list=[];for(const title of ['Approval race','Full access','Automatic allowed','Automatic denied','Automatic invalid','Parallel pending']) list.push(await window.mingshen.createSession({...config,title}));
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    return {sessions:list,config,providerId:provider.id,reviewId:review.id,backupId:configured.models.find(m=>m.modelId==='backup-review').id};
  })()`);
  await send('Page.reload');
  await until("document.querySelectorAll('.session-row').length===3");
  await evaluate("document.querySelector('.session-group__show-all').click();true");
  await until("document.querySelectorAll('.session-row').length===6");
  await evaluate("window.__events=[];window.mingshen.onRuntimeEvent(event=>window.__events.push(event));true");
  const [race, full, allowed, denied, invalid, parallel] = fixture.sessions;
  await start(race, 'race');
  const first = await pending();
  await shot('approval-zh-night');
  // Delay only the IPC acknowledgement. Actual tools and native sandbox still run.
  await main.evaluate(`globalThis.__approvalHandler=globalThis.__electron.ipcMain._invokeHandlers.get('approval:decide');globalThis.__electron.ipcMain._invokeHandlers.set('approval:decide',async(...args)=>{const value=await globalThis.__approvalHandler(...args);await new Promise(done=>setTimeout(done,3500));return value;});true`);
  await click('.approval-panel button', '本会话允许');
  await until(`window.mingshen.getApprovalState().then(s=>s.requests.some(r=>r.id!==${JSON.stringify(first.id)}))`);
  const second = (await snapshot()).requests[0];
  await sleep(3800);
  assert.ok(await evaluate(`document.querySelector('.approval-panel__detail')?.textContent.includes('race-2.txt')`));
  assert.equal((await snapshot()).requests[0].id, second.id);
  await main.evaluate(`globalThis.__electron.ipcMain._invokeHandlers.set('approval:decide',globalThis.__approvalHandler);true`);
  passed.push('Delayed old decision acknowledgement cannot clear the next approval after Allow for session');
  await send('Page.reload');
  await until("Boolean(document.querySelector('.approval-panel__detail')?.textContent.includes('race-2.txt'))");
  await evaluate("window.__events=[];window.mingshen.onRuntimeEvent(event=>window.__events.push(event));true");
  await main.evaluate(`globalThis.__timerPath=${JSON.stringify(resolve(temporary, 'profile', 'mingshen.db'))};globalThis.__db=new (process.getBuiltinModule('node:sqlite').DatabaseSync)(globalThis.__timerPath);globalThis.__db.prepare("update trajectories set created_at=? where session_id=? and type='run_started'").run(new Date(Date.now()-3661000).toISOString(),${JSON.stringify(race.id)});globalThis.__db.close();true`);
  await send('Page.reload');
  await until("Boolean(document.querySelector('.run-status')?.textContent.match(/已运行 1 小时 1 分/))");
  assert.ok(await evaluate("Boolean(document.querySelector('.session-row--selected')?.textContent.match(/1 小时 1 分/))"));
  await evaluate("window.__events=[];window.mingshen.onRuntimeEvent(event=>window.__events.push(event));true");
  passed.push('Persisted elapsed time renders hours/minutes/seconds in timeline and sidebar after reload');
  await click('.approval-panel button', '仅本次');
  await finished(race.id);
  assert.match(await readFile(resolve(project, 'race-2.txt'), 'utf8'), /Verified race/);
  passed.push('Renderer reload restores the pending approval and protected file tools complete');

  await start(full, 'full');
  await pending();
  await click('.approval-panel button', '此项目完全访问');
  await click('.mingshen-dialog__actions button', '切换为完全访问');
  await finished(full.id);
  const upgraded = await evaluate('window.mingshen.bootstrap()');
  assert.ok(upgraded.sessions.every(s => s.permissionMode === 'full_access'));
  const inherited = await evaluate(`window.mingshen.createSession({...${JSON.stringify(fixture.config)},title:'Inherited project access'})`);
  assert.equal(inherited.permissionMode, 'full_access');
  assert.match(await readFile(resolve(project, 'full-2.txt'), 'utf8'), /Verified full/);
  passed.push('Approval action switches the live run and all project conversations to Full access; new sessions inherit it');
  await evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(full.id)},permissionMode:'request_approval'})`);

  await start(allowed, 'allowed');
  await pending();
  await click('.approval-panel button', '自动审批');
  await until("Boolean(document.querySelector('.mingshen-dialog')?.textContent.includes('请先配置审批模型'))");
  await click('.mingshen-dialog__actions button', '打开设置');
  await until("Boolean(document.querySelector('.approval-model-settings'))");
  await evaluate("document.querySelector('.approval-model-settings .model-picker__trigger').click();true");
  await until("Boolean(document.querySelector('.model-picker__panel'))");
  await evaluate("document.querySelector('.model-picker__provider-toggle').click();true");
  await until("Boolean([...document.querySelectorAll('.model-picker__model')].find(el=>el.textContent.includes('review-model')))");
  await evaluate("[...document.querySelectorAll('.model-picker__model')].find(el=>el.textContent.includes('review-model')).click();true");
  await click('.approval-model-settings button', '保存审批模型');
  await until("Boolean(document.querySelector('.approval-model-settings')?.textContent.includes('审批模型已保存'))");
  assert.equal((await evaluate('window.mingshen.getApprovalModelSettings()')).modelId, fixture.reviewId);
  await shot('approval-model-settings-zh-night');
  await evaluate("document.querySelector('button[aria-label=\"关闭设置\"]').click();true");
  holdFinal = true;
  await click('.approval-panel button', '自动审批');
  await until("window.__events.filter(e=>e.type==='activity'&&e.activity.toolName==='approval_review').length>=2");
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(allowed.id)})?.status==='running')`);
  await until(`Boolean(document.querySelector('.run-status')?.textContent.includes('已运行'))`);
  assert.ok(reviewRequests >= 2);
  await evaluate("window.mingshen.desktopAction('close');true");
  await until("Boolean(document.querySelector('.close-dialog'))");
  assert.match(await evaluate("document.querySelector('.close-dialog').textContent"), /1 个会话正在运行/);
  await shot('approval-close-running-zh-night');
  await click('.close-dialog button', '取消');
  holdFinal = false;
  await finished(allowed.id);
  assert.match(await readFile(resolve(project, 'allowed-2.txt'), 'utf8'), /Verified allowed/);
  passed.push('Missing reviewer shows app dialog; provider/model settings save; pending and subsequent protected writes are reviewed; closing counts running work');

  reviewMode = 'deny';
  await evaluate(`window.mingshen.startAutomaticApproval(${JSON.stringify(denied.id)})`);
  await start(denied, 'denied');
  await finished(denied.id);
  await assert.rejects(readFile(resolve(project, 'denied-1.txt')));
  const deniedMessages = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(denied.id)})`);
  assert.match(JSON.stringify(deniedMessages), /Fixture refuses/);
  passed.push('Reviewer DENY prevents file writes and returns the real reason to the agent');

  reviewMode = 'invalid';
  await evaluate(`window.mingshen.startAutomaticApproval(${JSON.stringify(invalid.id)})`);
  await start(invalid, 'invalid');
  await pending();
  await until("document.querySelector('.approval-review-status')?.textContent.includes('无效')");
  await assert.rejects(readFile(resolve(project, 'invalid-1.txt')));
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 680, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click();document.documentElement.dataset.theme='day';true");
  await shot('approval-en-day-compact');
  assert.ok(await evaluate("[...document.querySelectorAll('.approval-panel button')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})"));
  await evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(invalid.id)},approvalMode:'manual'})`);
  await click('.approval-panel button', 'Allow once');
  await pending();
  await click('.approval-panel button', 'Deny');
  await finished(invalid.id);
  passed.push('Malformed reviewer output fails closed, exposes manual controls and recovers in English/day compact layout');

  reviewMode = 'error';
  await evaluate(`window.mingshen.startAutomaticApproval(${JSON.stringify(parallel.id)})`);
  await start(parallel, 'parallel');
  await pending();
  await until("document.querySelector('.approval-review-status')?.textContent.includes('503')");
  passed.push('Reviewer HTTP 503 preserves full error and a pending manual approval');
  const concurrency = await evaluate(`window.mingshen.createSession({...${JSON.stringify(fixture.config)},title:'Concurrent approval'})`);
  await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(concurrency.id)},text:'SCENARIO:concurrent create files.'})`);
  await until('window.mingshen.getApprovalState().then(s=>s.requests.length===2)');
  await evaluate("window.mingshen.desktopAction('close');true");
  await until("Boolean(document.querySelector('.close-dialog'))");
  assert.match(await evaluate("document.querySelector('.close-dialog').textContent"), /2 conversations are running/);
  await shot('approval-close-pending-en-day');
  await click('.close-dialog button', 'Cancel');
  await evaluate(`window.mingshen.stopChat(${JSON.stringify(parallel.id)})`);
  await until('window.mingshen.getApprovalState().then(s=>s.requests.length===1)');
  await evaluate(`window.mingshen.stopChat(${JSON.stringify(concurrency.id)})`);
  await until('window.mingshen.getApprovalState().then(s=>s.requests.length===0)');
  passed.push('Two concurrent approvals remain independent; close counts both; Stop removes only its own pending state');
  await evaluate("document.querySelector('button[title=\"Settings\"]').click();true").catch(async () => {
    await evaluate("[...document.querySelectorAll('button')].find(el=>el.getAttribute('aria-label')==='Settings')?.click();true");
  });
  await until("Boolean(document.querySelector('.settings-nav'))");
  await click('.settings-nav__item', 'Permissions and security');
  await until("Boolean(document.querySelector('.approval-backup-picker .model-picker__trigger'))");
  await until(`(()=>{
    const trigger=document.querySelector('.approval-backup-picker .model-picker__trigger');
    if(trigger.getAttribute('aria-expanded')!=='true'){trigger.click();return false;}
    const provider=document.querySelector('.model-picker__provider-toggle');
    if(!provider)return false;
    if(provider.getAttribute('aria-expanded')!=='true'){provider.click();return false;}
    const model=[...document.querySelectorAll('.model-picker__model')].find(el=>el.querySelector('code')?.textContent==='backup-review');
    if(!model)return false;model.click();return true;
  })()`);
  await click('.approval-model-settings button', 'Save approval model');
  await until(`window.mingshen.getApprovalModelSettings().then(x=>x.fallback?.modelId===${JSON.stringify(fixture.backupId)})`);
  await shot('approval-backup-settings-en-day');
  await evaluate("document.querySelector('button[aria-label=\"Close settings\"]').click();true");
  const fallbackSession = await evaluate(`window.mingshen.createSession({...${JSON.stringify(fixture.config)},title:'Backup approval'})`);
  await evaluate(`window.mingshen.startAutomaticApproval(${JSON.stringify(fallbackSession.id)})`);
  reviewMode = 'invalid'; holdBackup = true;
  await start(fallbackSession, 'backup');
  await until("document.querySelector('.approval-review-status')?.textContent.includes('backup model')");
  await shot('approval-backup-active-en-day');
  holdBackup = false; await finished(fallbackSession.id);
  assert.match(await readFile(resolve(project, 'backup-2.txt'), 'utf8'), /Verified backup/);
  passed.push('Backup reviewer saves through settings, invalid primary output switches with visible status, valid JSON backup executes protected writes');
  const beforeDeny = backupRequests;
  reviewMode = 'deny'; await start(fallbackSession, 'finaldeny'); await finished(fallbackSession.id);
  assert.equal(backupRequests, beforeDeny);
  await assert.rejects(readFile(resolve(project, 'finaldeny-1.txt')));
  passed.push('Valid primary denial remains final and does not contact the backup');
  reviewMode = 'error';
  await start(fallbackSession, 'networkbackup'); await finished(fallbackSession.id);
  assert.match(await readFile(resolve(project, 'networkbackup-2.txt'), 'utf8'), /Verified networkbackup/);
  passed.push('Primary HTTP503 fails over to the configured backup and resumes the same run');
  backupMode = 'invalid';
  await start(fallbackSession, 'bothfail'); await pending();
  await until("document.querySelector('.approval-review-status')?.textContent.includes('Backup cannot decide')");
  assert.match(await evaluate("document.querySelector('.approval-review-status').textContent"), /503/);
  await assert.rejects(readFile(resolve(project, 'bothfail-1.txt')));
  await evaluate(`window.mingshen.stopChat(${JSON.stringify(fallbackSession.id)})`);
  await until('window.mingshen.getApprovalState().then(s=>s.requests.length===0)');
  passed.push('Both reviewer failures remain pending with primary HTTP status and redacted backup response preview');
  console.log(JSON.stringify({ passed, reviewRequests, backupRequests, screenshots }, null, 2));
  await evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true').catch(() => {});
  renderer.close();renderer=null;main.close();main=null;
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
} finally {
  holdFinal = false;
  holdBackup = false;
  renderer?.close();
  main?.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
