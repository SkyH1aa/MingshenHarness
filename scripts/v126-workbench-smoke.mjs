import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-v126-'));
const profile = resolve(temporary, 'profile');
const project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review');
const passed = [], requests = [], errors = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, renderer, main;
let activeWorkers = 0, peakWorkers = 0, totalWorkers = 0, memoryRequests = 0;
const held = new Map();
const todo = (id, status, content = id) => ({ id, content, status, priority: 'medium', dependsOn: [] });
const hostPlan = body => {
  const text = (body.input ?? []).filter(item => item.role === 'user')
    .map(item => typeof item.content === 'string' ? item.content
      : (item.content ?? []).map(part => part.text ?? '').join('\n'))
    .findLast(content => content.startsWith('[HOST_CONTEXT plan]')) ?? '';
  return JSON.parse(text.split('\n').findLast(line => line.startsWith('{"revision":')) ?? '{"steps":[]}');
};
const server = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const input = body.input ?? [];
    const goal = input.find(item => item.role === 'user' && /CASE:/.test(JSON.stringify(item.content)));
    const scenario = /CASE:([a-z0-9_-]+)/.exec(JSON.stringify(goal?.content ?? ''))?.[1] ?? 'plain';
    const outputs = input.filter(item => item.type === 'function_call_output');
    const calls = input.filter(item => item.type === 'function_call');
    const has = name => calls.some(call => call.name === name);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    let index = 0;
    const tool = (name, args) => {
      const output_index = index++;
      event({ type: 'response.output_item.added', output_index, item: { type: 'function_call', call_id: `${scenario}-${name}-${outputs.length}-${output_index}`, name, arguments: '' } });
      event({ type: 'response.function_call_arguments.delta', output_index, delta: JSON.stringify(args) });
    };
    const text = value => event({ type: 'response.output_text.delta', delta: value });
    if ((body.instructions ?? '').includes('[PROJECT_MEMORY_SUMMARY]')) {
      memoryRequests++;
      text('Verified the workbench workflow with real tool evidence, cancellation and file-change boundaries.');
      event({ type: 'response.completed' }); response.end(); return;
    }
    requests.push(body);
    const plan = hostPlan(body);
    if (plan.reviewRequired) tool('review_plan', { revision: plan.revision, action: 'keep', reason: 'Continue the same fixture task and preserve the configured breakpoint.' });
    else if (scenario === 'todo' && !has('update_todos')) tool('update_todos', { todos: [todo('inspect', 'completed', 'Inspect implementation'), todo('build', 'in_progress', 'Build the scoped change'), { ...todo('verify', 'pending', 'Verify expected behavior'), dependsOn: ['build'] }] });
    else if (scenario === 'index' && !has('code_index')) tool('code_index', { operation: 'symbols', query: 'sum' });
    else if (scenario === 'multilang' && outputs.length < 7) tool('code_index', {operation:'callers',query:'add',path:['fixture.py','fixture.go','fixture.rs','fixture.java','fixture.c','fixture.cpp','fixture.cs'][outputs.length]});
    else if (scenario === 'reads' && outputs.length < 3) tool('read_file', { path: outputs.length === 2 ? 'b.ts' : 'a.ts' });
    else if (scenario === 'workers' && !has('spawn_subagent')) {
      for (let worker = 1; worker <= 4; worker++) tool('spawn_subagent', { agent: 'review-subagent', label: `Worker ${worker}`, task: `CASE:worker-${worker} read-only review`, context: 'Return verified findings without mutation.' });
    } else if (/^worker-[1-4]$/.test(scenario)) {
      activeWorkers++; totalWorkers++; peakWorkers = Math.max(peakWorkers, activeWorkers);
      try { text(`Investigating ${scenario}.\n\n`); await sleep(4000); text(`Verified ${scenario}.`); } finally { activeWorkers--; }
    } else if (scenario === 'verify' && !has('write_file')) tool('write_file', { path: 'calculation.js', content: 'module.exports = 1;\n' });
    else if (scenario === 'verify' && JSON.stringify(input.at(-1)).includes('Explicit verification attempt') && !calls.some(call => call.name === 'replace_in_file')) tool('replace_in_file', { path: 'calculation.js', old_text: 'module.exports = 1;', new_text: 'module.exports = 2;' });
    else if (scenario === 'breakpoint' && !has('update_todos')) tool('update_todos', { todos: [todo('pause-here', 'in_progress', 'Breakpoint must pause before writing')] });
    else if (scenario === 'breakpoint' && !has('write_file')) tool('write_file', { path: 'breakpoint.txt', content: 'continued after checkpoint\n' });
    else if (scenario === 'owner' && !has('write_file')) tool('write_file', { path: 'shared.txt', content: 'original writer\n' });
    else if (scenario === 'owner') {
      held.set('owner', response);
      while (held.has('owner') && !response.destroyed) await sleep(60);
      if (response.destroyed) return;
      text('Owner completed.');
    } else if (scenario === 'contender' && !has('write_file')) tool('write_file', { path: 'shared.txt', content: 'contender must not overwrite\n' });
    else if (scenario === 'resume' && !has('write_file')) tool('write_file', { path: 'resume.txt', content: 'write once\n' });
    else if (scenario === 'resume' && !input.some(item => item.role === 'user' && JSON.stringify(item.content).includes('最近已保存的安全工具边界'))) {
      held.set('resume', response);
      while (held.has('resume') && !response.destroyed) await sleep(60);
      if (response.destroyed) return;
      text('Original run released.');
    } else if (scenario === 'race' && !has('update_todos')) {
      held.set('race', response);
      while (held.has('race') && !response.destroyed) await sleep(60);
      if (response.destroyed) return;
      tool('update_todos', { todos: [todo('stale', 'completed', 'Stale model overwrite')] });
    } else text(`Completed ${scenario}; tool evidence reviewed.`);
    event({ type: 'response.completed', response: { usage: { input_tokens: 1200, output_tokens: 50, total_tokens: 1250 } } }); response.end();
  } catch (error) { errors.push(String(error)); response.destroy(); }
});

async function connect(port) {
  let target;
  for (let index = 0; index < 150; index++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(result => result.json())).find(item => item.webSocketDebuggerUrl); if (target) break; } catch {}
    await sleep(80);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let next = 0;
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    const waiter = pending.get(value.id); if (!waiter) return; pending.delete(value.id); clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 45000); pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result.value; };
  return { send, evaluate, close: () => socket.close() };
}
async function until(expression, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await renderer.evaluate(expression)) return; await sleep(80); } throw new Error(`Timed out: ${expression}`); }
async function click(selector, text) { const find = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => !el.disabled && el.textContent.trim() === ${JSON.stringify(text)})`; await until(`Boolean(${find})`); await renderer.evaluate(`${find}.click(); true`); }
async function select(id) {
  if (!await renderer.evaluate(`Boolean(document.querySelector('[data-session-id="${id}"] .session-row'))`)) await renderer.evaluate(`document.querySelector('.session-group__show-all[aria-expanded=false]')?.click();true`);
  if (!await renderer.evaluate(`Boolean(document.querySelector('[data-session-id="${id}"] .session-row'))`)) {
    const target=await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(id)})`);
    await renderer.evaluate('document.querySelector(".session-search input").focus();document.querySelector(".session-search input").select();true');
    await renderer.send('Input.insertText',{text:target.title});
  }
  await until(`Boolean(document.querySelector('[data-session-id="${id}"] .session-row'))`);
  await renderer.evaluate(`document.querySelector('[data-session-id="${id}"] .session-row').click();true`);
  await until(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId === ${JSON.stringify(id)}`);
}
async function finished(id, timeout = 45000) { await until(`window.mingshen.bootstrap().then(value => value.sessions.find(s => s.id === ${JSON.stringify(id)})?.status === 'idle')`, timeout); }
async function launch() {
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9370', '.', '--remote-debugging-port=9369'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9370);
  await main.evaluate("globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true");
  renderer = await connect(9369); await renderer.send('Runtime.enable');
}
async function close() {
  if (!child) return;
  const current = child, ended = new Promise(done => current.once('exit', done));
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close(); main?.close(); renderer = null; main = null;
  await Promise.race([ended, sleep(5000)]);
  if (current.exitCode === null) { current.kill(); await ended; }
  child = null;
}
async function screenshot(name) { const image = await renderer.send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); }
async function send(id, scenario) { return await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(id)},text:${JSON.stringify(`CASE:${scenario} perform the scoped task.`)}})`); }
async function create(config, title, overrides = {}) {
  const session = await renderer.evaluate(`window.mingshen.createSession(${JSON.stringify({ ...config, title, ...overrides })})`);
  await renderer.send('Page.reload');
  await until("Boolean(document.querySelector('.session-new-button'))");
  return session;
}
try {
  await mkdir(project, { recursive: true }); await mkdir(screenshots, { recursive: true });
  await writeFile(resolve(project, 'a.ts'), 'export function sum(a: number, b: number) { return a + b; }\n');
  await writeFile(resolve(project, 'b.ts'), "import { sum } from './a'; export const total = sum(1, 2);\n");
  for (const [name,text] of Object.entries({
    'fixture.py':'def add(a, b):\n return a+b\ndef work():\n return add(1, 2)',
    'fixture.go':'package x\nfunc add(a int) int { return a }; func work(){add(1)}',
    'fixture.rs':'fn add(a:i32)->i32{a} fn work(){add(1);}',
    'fixture.java':'class X { int add(int a){return a;} int work(){return add(1);} }',
    'fixture.c':'int add(int a){return a;} int work(){return add(1);}',
    'fixture.cpp':'class X {int add(int a){return a;} int work(){return add(1);}};',
    'fixture.cs':'class X { int add(int a){return a;} int work(){return add(1);} }',
  })) await writeFile(resolve(project,name),text);
  await writeFile(resolve(project, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', private: true, scripts: { test: 'node verify.cjs', lint: 'node lint.cjs', typecheck: 'node typecheck.cjs' } }));
  await writeFile(resolve(project, 'verify.cjs'), "const fs=require('node:fs');if(!fs.readFileSync('calculation.js','utf8').includes('= 2')){console.error('EXPECTED_VALUE_2');process.exit(1)}console.log('TEST_PASS')");
  await writeFile(resolve(project, 'lint.cjs'), "console.log('LINT_PASS')");
  await writeFile(resolve(project, 'typecheck.cjs'), "console.log('TYPECHECK_PASS')");
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch(); await until("Boolean(document.querySelector('.policy-consents'))");
  await renderer.evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  const config = await renderer.evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Local v126 fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-fixture-only',keyLabel:'Fixture',neverReveal:true});await window.mingshen.createModel({providerId:p.id,modelId:'fixture',contextWindow:200000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);await window.mingshen.setAgentRuntimeSettings({maxConcurrentSubagents:2});const p2=(await window.mingshen.bootstrap()).providers.find(x=>x.id===p.id);return {providerId:p.id,modelId:p2.models[0].id,workspacePath:${JSON.stringify(project)},reasoningLevel:null,permissionMode:'full_access'};})()`);
  await renderer.evaluate(`(async()=>window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),defaultLayout:'agents'}))()`);
  const base = await create(config, 'Task workbench');
  await renderer.send('Page.reload'); await until("Boolean(document.querySelector('.task-workbench'))");
  const profiles = await renderer.evaluate('window.mingshen.listAgentProfiles()'); assert.equal(profiles.filter(p => p.builtin).length, 10);
  const custom = await renderer.evaluate("window.mingshen.saveAgentProfile({name:'User custom all',description:'User profile retained',role:'all',instructions:'Read-only custom profile',readOnly:true,enabled:true})");
  await renderer.send('Page.reload'); await until("Boolean(document.querySelector('.session-new-button'))");
  await renderer.evaluate("document.querySelector('.session-new-button').click();true"); await until("Boolean(document.querySelector('#new-session-title'))");
  const options = await renderer.evaluate("[...document.querySelectorAll('.dialog select')].flatMap(el=>[...el.options].map(o=>o.value))");
  for (const id of [...profiles.map(p => p.id), custom.id]) assert.ok(options.includes(id), id);
  assert.ok(await renderer.evaluate("(()=>{const el=document.querySelector('.agent-guide dl');return el.scrollHeight>el.clientHeight&&getComputedStyle(el).overflowY==='auto'})()"));
  await renderer.evaluate("document.querySelector('.dialog [aria-label=关闭对话框]')?.click();true");
  if (await renderer.evaluate("Boolean(document.querySelector('#new-session-title'))")) await click('.dialog button', '取消');
  passed.push('Ten built-ins plus enabled custom Agent remain selectable; introductions scroll');

  await select(base.id); await send(base.id, 'todo'); await finished(base.id);
  await until("document.querySelectorAll('.plan-step').length===3");
  assert.equal(await renderer.evaluate("document.querySelectorAll('.plan-step--completed').length"), 1);
  assert.match(await renderer.evaluate("document.querySelector('.task-workbench').textContent"), /Build the scoped change/);
  await renderer.evaluate("document.querySelector('.task-workbench [aria-label=编辑计划]').click();true");
  await until("Boolean(document.querySelector('.plan-edit-row input'))");
  await renderer.evaluate("(()=>{const el=document.querySelector('.plan-edit-row input');el.focus();el.select();return true})()");
  await renderer.send('Input.insertText', { text: 'User edited investigation' });
  await click('.plan-edit-actions button', '保存计划');
  await until("document.querySelector('.plan-step strong')?.textContent.includes('User edited investigation')");
  await renderer.send('Page.reload'); await until("document.querySelector('.plan-step strong')?.textContent.includes('User edited investigation')");
  await screenshot('v126-plan-zh-night');
  passed.push('Model todos display actual states; UI edits, dependencies and completed steps survive reload');

  await click('.task-workbench__toolbar button','项目计划库');
  await renderer.evaluate("document.querySelector('.project-plan-library input[type=text],.project-plan-library input:not([type])').focus();true");
  await renderer.send('Input.insertText',{text:'Saved implementation plan'});
  await click('.project-plan-library button','保存当前计划');
  await until("document.querySelector('.project-plan-library__row strong')?.textContent==='Saved implementation plan'");
  const planTarget=await create(config,'Reuse saved plan');await select(planTarget.id);
  await click('.task-workbench__toolbar button','项目计划库');
  await click('.project-plan-library button','绑定到此会话');
  await click('.task-workbench__toolbar button','计划与待办');
  await until("document.querySelectorAll('.plan-step').length===3");
  assert.equal(await renderer.evaluate("document.querySelectorAll('.plan-step--completed').length"),1);
  assert.equal(await renderer.evaluate("document.querySelectorAll('.plan-step--in_progress').length"),0);
  await click('.task-workbench__toolbar button','项目计划库');
  await renderer.evaluate("document.querySelector('.project-plan-library input[type=checkbox]').click();true");
  await click('.project-plan-library button','绑定到此会话');
  await click('.task-workbench__toolbar button','计划与待办');
  await until("document.querySelectorAll('.plan-step--pending').length===3");
  await screenshot('v126-plan-library-zh-night');
  passed.push('Project plan library saves and attaches across conversations; progress/dependencies persist and reset is explicit');

  const race = await create(config, 'Concurrent plan edit'); await select(race.id); await send(race.id, 'race');
  while (!held.has('race')) await sleep(40);
  await renderer.evaluate(`window.mingshen.updatePlan({sessionId:${JSON.stringify(race.id)},revision:0,steps:[{id:'user',content:'Keep the user plan',status:'pending',priority:'medium',updatedAt:''}]})`);
  held.delete('race'); await finished(race.id);
  assert.equal((await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(race.id)})`)).plan.steps[0].content, 'Keep the user plan');
  passed.push('A real streaming model cannot overwrite a concurrently saved user plan');

  const indexed = await create(config, 'Index queries', { agentProfileId: 'plan' }); await select(indexed.id);
  await send(indexed.id, 'index'); await finished(indexed.id);
  const indexMessages = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(indexed.id)})`);
  assert.ok(indexMessages.some(m => m.parts.some(p => p.type === 'tool_result' && p.output.includes('FunctionDeclaration') && p.output.includes('sum'))));
  const available = requests.find(r => JSON.stringify(r.input).includes('CASE:index'))?.tools.map(t => t.name);
  assert.ok(available.includes('update_todos') && available.includes('code_index') && !available.includes('write_file'));
  passed.push('Read-only Plan exposes todos and local AST index; real symbol query returns file/line evidence');

  const protectedIndex = await create(config, 'Protected index', { permissionMode: 'request_approval', agentProfileId: 'plan' }); await select(protectedIndex.id);
  await send(protectedIndex.id, 'index'); await until("Boolean(document.querySelector('.approval-panel'))"); await click('.approval-panel button', '仅本次'); await finished(protectedIndex.id, 60000);
  const protectedMessages = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(protectedIndex.id)})`);
  assert.ok(protectedMessages.some(m => m.parts.some(p => p.type==='tool_result' && p.output.includes('FunctionDeclaration') && p.output.includes('sum'))));
  passed.push('Protected local index performs real native isolated enumeration/reads after explicit approval');

  const multilang=await create(config,'Multi-language calls',{agentProfileId:'plan'});await select(multilang.id);await send(multilang.id,'multilang');await finished(multilang.id,60000);
  const languageResults=(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(multilang.id)})`)).flatMap(m=>m.parts).filter(p=>p.type==='tool_result');
  assert.equal(languageResults.length,7);
  for(const result of languageResults){assert.equal(result.isError,false);assert.match(result.output,/"caller": "work"/);assert.match(result.output,/"name": "add"/);}
  passed.push('Real Electron loads seven bundled native grammars and returns cross-file syntax call evidence');

  const reads = await create(config, 'Batch reads', { permissionMode: 'request_approval' }); await select(reads.id);
  await send(reads.id, 'reads'); await until("Boolean(document.querySelector('.approval-panel'))");
  await click('.approval-panel button', '本会话同类批量批准'); await finished(reads.id, 60000);
  assert.equal((await renderer.evaluate(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(reads.id)}))`)).permissionMode, 'request_approval');
  const readMessages = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(reads.id)})`);
  assert.ok(readMessages.some(m => m.parts.some(p => p.type === 'tool_result' && p.output.includes('Cache hit'))));
  assert.ok(readMessages.some(m => m.parts.some(p => p.type === 'tool_result' && p.output.includes("from './a'"))));
  assert.equal((await renderer.evaluate('window.mingshen.getApprovalState()')).requests.length, 0);
  passed.push('Same-session batch approval preserves protected mode; isolated repeated read deduplicates and subsequent file read runs');

  const parent = await create(config, 'Parallel parent', { agentProfileId: 'code-review' }); await select(parent.id); await send(parent.id, 'workers');
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.filter(x=>x.parentSessionId===${JSON.stringify(parent.id)}).length===4)`);
  await click('.task-workbench__toolbar button', 'Agent 任务树');
  await until("document.querySelectorAll('.agent-task-tree__child').length===4");
  assert.match(await renderer.evaluate("document.querySelector('.agent-task-tree').textContent"), /排队中|运行中/);
  const firstWorker=(await renderer.evaluate(`window.mingshen.bootstrap().then(s=>s.sessions.filter(x=>x.parentSessionId===${JSON.stringify(parent.id)}))`))[0];
  assert.equal(await renderer.evaluate('document.querySelectorAll(".subagent-output").length'),0);
  await renderer.evaluate(`document.querySelector('[data-agent-session="${firstWorker.id}"] .agent-task-tree__expand').click();true`);
  await until('document.querySelector(".subagent-output")?.textContent.includes("Investigating")');
  assert.equal(await renderer.evaluate('document.querySelector(".session-row--selected").closest("[data-session-id]").dataset.sessionId'),parent.id);
  await renderer.evaluate(`document.querySelector('[data-agent-session="${firstWorker.id}"] .agent-task-tree__expand').click();true`);
  await until('!document.querySelector(".subagent-output")');
  assert.equal(await renderer.evaluate(`document.querySelector('[data-session-id="${parent.id}"] .session-row__children')?.getAttribute('aria-expanded')`), 'false');
  assert.equal(await renderer.evaluate("document.querySelectorAll('.session-row--child').length"), 0);
  await renderer.evaluate(`document.querySelector('[data-session-id="${parent.id}"] .session-row__children').click();true`);
  await until("document.querySelectorAll('.session-row--child').length===4");
  await renderer.evaluate(`document.querySelector('[data-session-id="${parent.id}"] .session-row__children').click();true`);
  await finished(parent.id, 60000);
  await renderer.evaluate(`document.querySelector('[data-agent-session="${firstWorker.id}"] .agent-task-tree__expand').click();true`);
  await until('document.querySelector(".subagent-output")?.textContent.includes("Verified")');
  await screenshot('v126-agent-output-zh-night');
  await renderer.evaluate(`document.querySelector('[data-agent-session="${firstWorker.id}"] .agent-task-tree__name').click();true`);
  await until('Boolean(document.querySelector(".parent-session-link"))&&!document.querySelector(".subagent-output")&&document.querySelector(".conversation")?.textContent.includes("Verified worker-")');
  await select(parent.id);await click('.task-workbench__toolbar button','Agent 任务树');
  assert.equal(totalWorkers, 4); assert.ok(peakWorkers <= 2 && peakWorkers >= 2, `peak=${peakWorkers}`);
  const reviewRequest = requests.find(request => JSON.stringify(request.input).includes('CASE:workers'));
  assert.ok(reviewRequest.tools.some(tool => tool.name === 'spawn_subagent'));
  assert.ok(!reviewRequest.tools.some(tool => tool.name === 'write_file'));
  assert.ok(reviewRequest.instructions.includes('review-subagent') && !reviewRequest.instructions.includes('"id": "general"'));
  await screenshot('v126-task-tree-zh-night');
  await renderer.send('Page.reload'); await until("Boolean(document.querySelector('.task-workbench'))"); await select(parent.id); await click('.task-workbench__toolbar button','Agent 任务树'); await until("document.querySelectorAll('.agent-task-tree__child').length===4");
  await renderer.evaluate(`document.querySelector('[data-agent-session="${firstWorker.id}"] .agent-task-tree__expand').click();true`);
  await until('document.querySelector(".subagent-output")?.textContent.includes("Verified")');
  await renderer.evaluate(`document.querySelector('[data-session-id="${parent.id}"] .session-row').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:140,clientY:220}));true`);
  await until("Boolean(document.querySelector('.session-menu'))");
  assert.equal(await renderer.evaluate("document.querySelectorAll('.session-menu [role=menuitem]').length"), 6);
  await renderer.evaluate("document.querySelector('.session-menu-scrim').click();true");
  passed.push('Four permitted workers obey concurrency two; task-tree arrows preview streaming/persisted output without navigating, names alone open children, reload restores output; sidebar folding/right-click retain behavior');

  const verify = await create(config, 'Explicit verification'); await select(verify.id); await send(verify.id, 'verify'); await finished(verify.id, 90000);
  assert.equal(await readFile(resolve(project, 'calculation.js'), 'utf8'), 'module.exports = 2;\n');
  const trajectories = await renderer.evaluate(`window.mingshen.listTrajectories(${JSON.stringify(verify.id)})`);
  const verification = trajectories.flatMap(t => t.events).filter(e => e.type === 'activity' && e.payload.activity.toolName === 'verification');
  assert.ok(verification.some(e => e.payload.activity.status === 'failed' && e.payload.activity.detail.includes('EXPECTED_VALUE_2')));
  assert.ok(verification.some(e => e.payload.activity.status === 'completed' && e.payload.activity.detail.includes('TEST_PASS') && e.payload.activity.detail.includes('TYPECHECK_PASS')));
  passed.push('Actual project test failure feeds back; model fixes code and test/lint/typecheck all run and persist');

  const breakpoint = await create(config, 'Breakpoint plan'); await select(breakpoint.id);
  await renderer.evaluate(`window.mingshen.updatePlan({sessionId:${JSON.stringify(breakpoint.id)},revision:0,steps:[${JSON.stringify({ ...todo('pause-here', 'pending', 'Breakpoint must pause before writing'), updatedAt: '' })}],breakpoints:['pause-here']})`);
  await send(breakpoint.id, 'breakpoint');
  await until(`window.mingshen.getWorkbench(${JSON.stringify(breakpoint.id)}).then(s=>s.plan.paused&&s.checkpoint.state==='interrupted')`);
  await until('document.querySelector(".plan-step--in_progress")?.dataset.stepState==="已暂停"');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".plan-step--in_progress .spin").length'),0);
  await assert.rejects(readFile(resolve(project, 'breakpoint.txt')), /ENOENT/);
  await click('.task-workbench button', '从恢复点继续'); await finished(breakpoint.id);
  assert.equal(await readFile(resolve(project, 'breakpoint.txt'), 'utf8'), 'continued after checkpoint\n');
  passed.push('Step breakpoint pauses before file mutation; checkpoint resume continues and writes only after user action');

  const owner = await create(config, 'File owner'); const contender = await create(config, 'Conflicting writer');
  await select(owner.id); await send(owner.id, 'owner'); await until(`window.mingshen.getWorkbench(${JSON.stringify(owner.id)}).then(s=>s.checkpoint.completedTools===1)`);
  await select(contender.id); await send(contender.id, 'contender'); await until("document.querySelector('.question-panel')?.textContent.includes('文件冲突')");
  assert.equal(await readFile(resolve(project, 'shared.txt'), 'utf8'), 'original writer\n');
  await screenshot('v126-writer-conflict-zh-night');
  await renderer.evaluate("[...document.querySelectorAll('.question-option')].find(el=>el.textContent.includes('切换到当前 Agent')).click();true");
  await click('.question-panel button', '提交回答'); await finished(contender.id);
  assert.equal(await readFile(resolve(project, 'shared.txt'), 'utf8'), 'original writer\n');
  const conflictMessages = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(contender.id)})`);
  assert.ok(conflictMessages.some(m => m.parts.some(p => p.type === 'tool_result' && p.output.includes('pending operation was NOT executed'))));
  assert.equal((await renderer.evaluate(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(owner.id)}))`)).status, 'interrupted');
  passed.push('Concurrent shared-file write prompts a human; transfer stops incumbent and requires fresh read without replaying stale mutation');

  const resume = await create(config, 'Resume safe boundary'); await select(resume.id); await send(resume.id, 'resume');
  await until(`window.mingshen.getWorkbench(${JSON.stringify(resume.id)}).then(s=>s.checkpoint.completedTools===1)`);
  await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(resume.id)})`);
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(resume.id)})?.status==='interrupted')`);
  const checkpoint = await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(resume.id)})`);
  assert.equal(checkpoint.checkpoint.lastSafeTool, 'write_file');
  const resumePlanInput={sessionId:resume.id,revision:checkpoint.plan.revision,breakpoints:['keep-next'],steps:[
    {id:'keep-done',content:'Keep completed evidence',status:'completed',priority:'high',updatedAt:''},
    {id:'keep-current',content:'User edited continuation after stop',status:'in_progress',priority:'medium',updatedAt:'',dependsOn:['keep-done']},
    {id:'keep-next',content:'Final verification',status:'pending',priority:'medium',updatedAt:'',dependsOn:['keep-current']}
  ]};
  const resumePlan=await renderer.evaluate(`window.mingshen.updatePlan(${JSON.stringify(resumePlanInput)})`);
  await until('document.querySelector(".plan-step--in_progress")?.dataset.stepState==="已中断"');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".plan-step .spin").length'),0);
  await close(); await launch(); await until("Boolean(document.querySelector('.task-workbench'))"); await select(resume.id);
  assert.equal((await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(resume.id)})`)).checkpoint.lastSafeCallId, checkpoint.checkpoint.lastSafeCallId);
  await click('.task-workbench button', '从恢复点继续'); await finished(resume.id);
  const resumedPlan=(await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(resume.id)})`)).plan;
  assert.deepEqual(resumedPlan.steps.map(step=>({id:step.id,status:step.status,content:step.content,dependsOn:step.dependsOn})),resumePlan.steps.map(step=>({id:step.id,status:step.status,content:step.content,dependsOn:step.dependsOn})));
  assert.deepEqual(resumedPlan.breakpoints,['keep-next']);
  const resumeRequest=requests.findLast(r=>hostPlan(r).steps.some(step=>step.content==='User edited continuation after stop'));
  assert.ok(resumeRequest, 'The resumed model request must contain the current host plan');
  assert.deepEqual(hostPlan(resumeRequest).breakpoints, ['keep-next']);
  assert.ok(resumeRequest.input.some(item=>item.role==='user'&&JSON.stringify(item.content).includes('User edited continuation after stop')));
  await until('document.querySelector(".plan-step--in_progress")?.dataset.stepState==="待继续"');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".plan-step .spin").length'),0);
  await screenshot('v126-resumed-plan-zh-night');
  const resumedMessages = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(resume.id)})`);
  assert.equal(resumedMessages.flatMap(m => m.parts).filter(p => p.type === 'tool_call' && p.name === 'write_file').length, 1);
  passed.push('Stop/restart and resume preserve latest user-edited plan, completion, dependency/breakpoint state and confirmed writes; interrupted/paused/idle steps do not spin');

  await renderer.evaluate(`(async()=>{for(let index=0;index<105;index++)await window.mingshen.createSession({...${JSON.stringify(config)},title:'Pagination '+String(index).padStart(3,'0')});return true})()`);
  await renderer.send('Page.reload'); await until("Boolean(document.querySelector('.session-search input'))");
  await until('document.querySelector(".conversation-empty h1")?.textContent==="Pagination 104"');
  await renderer.send('Page.bringToFront');
  await renderer.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))))');
  await renderer.evaluate("document.querySelector('.session-search input').focus();true");
  await renderer.send('Input.insertText', { text: 'Pagination' });
  await until('document.querySelector(".session-search input").value==="Pagination"');
  await until("document.querySelectorAll('.session-row').length===100");
  await click('.session-group__show-all', '加载更多搜索结果');
  await click('.session-group__show-all', '显示更多（还有 5 个）');
  await until("Boolean(document.querySelector('.session-virtual-scroll'))");
  assert.ok(await renderer.evaluate("document.querySelectorAll('.session-row').length<40"));
  await renderer.evaluate("document.querySelector('.session-virtual-scroll').scrollTop=100000;true");
  await until("[...document.querySelectorAll('.session-row')].some(el=>el.textContent.includes('Pagination 000'))");
  await renderer.evaluate("document.querySelector('.session-search input').focus();document.querySelector('.session-search input').select();true");
  await renderer.send('Input.insertText', { text: 'Pagination 000' });
  await until("document.querySelectorAll('.session-row').length===1");
  assert.match(await renderer.evaluate("document.querySelector('.session-row').textContent"), /Pagination 000/);
  await renderer.evaluate("document.querySelector('.session-search input').select();true");
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await until("document.querySelector('.session-search input').value===''");
  passed.push('Database-backed search pages 105 actual conversations; virtualized rows stay bounded and scrolling/search reach old records');

  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate("window.mingshen.desktopAction('locale','en').then(()=>{localStorage.setItem('mingshen.locale','en');localStorage.setItem('mingshen.theme','day');return true})");
  await renderer.send('Page.reload'); await until("document.documentElement.lang==='en'&&Boolean(document.querySelector('.task-workbench'))");
  const bounds = await renderer.evaluate("(()=>{const panel=document.querySelector('.task-workbench').getBoundingClientRect(),composer=document.querySelector('.composer textarea').getBoundingClientRect();return {panel:{x:panel.x,y:panel.y,right:panel.right,bottom:panel.bottom},composer:{x:composer.x,y:composer.y,right:composer.right,bottom:composer.bottom},w:innerWidth,h:innerHeight,text:document.querySelector('.task-workbench').textContent}})()");
  assert.ok(bounds.panel.x >= 0 && bounds.panel.right <= bounds.w + 1 && bounds.composer.bottom <= bounds.h + 1, JSON.stringify(bounds));
  assert.ok(!/[\u4e00-\u9fff]/.test(bounds.text), bounds.text);
  await screenshot('v126-workbench-en-day');
  await select(parent.id);await click('.task-workbench__toolbar button','Agent task tree');
  await until(`Boolean(document.querySelector('[data-agent-session="${firstWorker.id}"] .agent-task-tree__expand'))`);
  await renderer.evaluate(`document.querySelector('[data-agent-session="${firstWorker.id}"] .agent-task-tree__expand').click();true`);
  await until('document.querySelector(".subagent-output")?.textContent.includes("Verified")');
  const outputBounds=await renderer.evaluate('(()=>{const r=document.querySelector(".subagent-output").getBoundingClientRect(),b=document.querySelector(".subagent-output__body");return {left:r.left,right:r.right,w:innerWidth,overflow:getComputedStyle(b).overflowY,text:document.querySelector(".task-workbench").textContent}})()');
  assert.ok(outputBounds.left>=0&&outputBounds.right<=outputBounds.w+1);assert.equal(outputBounds.overflow,'auto');
  assert.ok(!/[\u4e00-\u9fff]/.test(outputBounds.text),outputBounds.text);
  await screenshot('v126-agent-output-en-day-compact');
  const version=(await renderer.evaluate('window.mingshen.getAppInfo()')).version;
  for (const doc of ['terms', 'privacy', 'disclaimer', 'manual', 'changelog']) for (const locale of ['en', 'zh-CN']) assert.ok((await renderer.evaluate(`window.mingshen.readPolicy(${JSON.stringify(doc)},${JSON.stringify(locale)})`)).includes(version));
  passed.push('English/light 1040x680 keeps workbench/composer inside viewport; all ten embedded documents match current version');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, requests: requests.length, memoryRequests, peakWorkers, errors }, null, 2));
} catch(error) {
  console.error('v126 fixture state:', JSON.stringify({error:String(error),errors,body:renderer?await renderer.evaluate('document.body.innerText').catch(()=>null):null}));
  if(renderer)await screenshot('v126-failure').catch(()=>{});
  throw error;
} finally {
  held.clear(); await close();
  await new Promise(done => server.close(done));
  const root = resolve(temporary); if (root.startsWith(resolve(tmpdir()) + sep) && root.includes('mingshen-v126-')) await rm(root, { recursive: true, force: true });
}
