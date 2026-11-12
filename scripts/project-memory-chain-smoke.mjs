import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-memory-ui-'));
const project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review');
const currentVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const passed = [], errors = [], requests = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const memoryContext = body => (body.input ?? [])
  .filter(item => item.role === 'user')
  .map(item => typeof item.content === 'string' ? item.content
    : (item.content ?? []).map(part => part.text ?? '').join('\n'))
  .filter(text => text.startsWith('[HOST_CONTEXT memory]'));
const summary = '本轮检查本地项目的资料读取流程，确认偏好按项目复用、历史记忆按需检索，并决定保留审批、取消和文件边界检查，避免在节省模型往返时跳过安全控制。';
let child, main, renderer, scenario = 'chain', turn = 0, summaryCount = 0;
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  const text = value => event({ type: 'response.output_text.delta', delta: value });
  const tool = (name, args) => event({
    type: 'response.output_item.added', output_index: 0,
    item: { type: 'function_call', call_id: `fixture-${scenario}-${turn}`, name, arguments: JSON.stringify(args) },
  });
  if ((body.instructions || '').includes('会话标题生成')) text('项目记忆验证');
  else if ((body.instructions || '').includes('[PROJECT_MEMORY_SUMMARY]')) { summaryCount++; text(summary); }
  else {
    requests.push({ scenario, body }); turn++;
    if (scenario === 'chain' && turn === 1) tool('execute_tool_chain', { steps: [
      { id: 'read-a', tool: 'read_file', arguments: { path: 'a.txt' } },
      { id: 'read-b', tool: 'read_file', arguments: { path: 'b.txt' }, after: ['read-a'], when: { step: 'read-a', contains: 'ready' } },
    ] });
    else if (scenario === 'inferred' && turn === 1) tool('memory_write', { action: 'preference', content: '优先使用 Python 处理脚本任务。', category: 'workflow' });
    else if (scenario === 'recall' && turn === 1) tool('memory_search', { query: '支付 缓存' });
    else text('已完成验证，保留真实工具结果和记忆来源。');
  }
  event({ type: 'response.completed' }); res.end();
});
async function connect(port) {
  let target;
  for (let i = 0; i < 150; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.webSocketDebuggerUrl); if (target) break; } catch {}
    await sleep(80);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let sequence = 0;
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const waiter = pending.get(message.id); if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 30000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}
async function until(expression) {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) { if (await renderer.evaluate(expression)) return; await sleep(60); }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector, text) {
  const target = text
    ? `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!e.disabled&&e.textContent.trim()===${JSON.stringify(text)})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  await until(`Boolean(${target})&&!(${target}).disabled`);
  await renderer.evaluate(`${target}.click();true`);
}
async function shot(name) {
  await sleep(180);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function replace(selector, text) {
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).select();true`);
  await renderer.send('Input.insertText', { text });
}
async function openMemory(english = false) {
  await click(`.app-topbar button[aria-label="${english ? 'Open settings' : '打开设置'}"]`);
  await click('.settings-nav__item', english ? 'Project instructions and trust' : '项目指令与信任');
  await until('Boolean(document.querySelector("#memory-document"))');
}
try {
  await mkdir(project, { recursive: true }); await mkdir(screenshots, { recursive: true });
  await writeFile(resolve(project, 'a.txt'), 'ready\n'); await writeFile(resolve(project, 'b.txt'), 'second receipt\n');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9392', '.', '--remote-debugging-port=9391'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9392);
  await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  renderer = await connect(9391); await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  await until('!document.querySelector(".policy-dialog")');
  const session = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Memory fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-memory-fixture',keyLabel:'Fixture',neverReveal:true});
    const provider=await window.mingshen.createModel({providerId:p.id,modelId:'memory',displayName:'Memory fixture',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);
    return window.mingshen.createSession({title:'项目记忆验证',providerId:p.id,modelId:provider.models[0].id,workspacePath:${JSON.stringify(project)},permissionMode:'full_access',reasoningLevel:null});
  })()`);
  const sid = JSON.stringify(session.id);
  const command = content => renderer.evaluate(`window.mingshen.projectMemoryCommand(${sid},${JSON.stringify(content)})`);
  const run = async (nextScenario, text) => {
    scenario = nextScenario; turn = 0;
    await renderer.evaluate(`window.mingshen.sendChat({sessionId:${sid},text:${JSON.stringify(text)}})`);
  };
  const done = () => until(`window.mingshen.getSession(${sid}).then(s=>s.status==='idle')`);
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer"))');
  await run('chain', '以后都使用 TypeScript。读取两个已知资料并完成检查。'); await done();
  assert.equal(turn, 2);
  assert.equal(summaryCount, 1);
  assert.match(JSON.stringify(requests[1].body), /second receipt/);
  const view = await renderer.evaluate(`window.mingshen.getProjectMemory(${sid})`);
  assert.equal(view.preferences, 1); assert.equal(view.memories, 1);
  passed.push('Real Electron chain executes two real file reads with two actor requests, plus one separately counted diary request; history contains both receipts and explicit preference');
  await command('/remember 支付模块使用缓存并保留断线后的任务状态。');
  assert.match(await command('/memory search 支付'), /支付模块/);
  const messagesBefore = await renderer.evaluate(`window.mingshen.getSessionMessages(${sid}).then(m=>m.length)`);
  await replace('.composer textarea', '/memory stats');
  await click('.composer button[aria-label="发送消息"]');
  await until('Boolean(document.querySelector(".memory-command-result"))');
  assert.equal(await renderer.evaluate(`window.mingshen.getSessionMessages(${sid}).then(m=>m.length)`), messagesBefore);
  assert.match(await renderer.evaluate('document.querySelector(".memory-command-result").textContent'), /Preferences/);
  passed.push('Remember/search and the real composer stats command run locally without adding a model turn or user message');
  await run('recall', '请继续检查支付模块缓存。'); await done();
  const recalled = requests.findLast(r => r.scenario === 'recall').body;
  assert.equal(recalled.instructions, requests[0].body.instructions);
  const recalledContext = memoryContext(recalled).at(-1);
  assert.equal(typeof recalledContext, 'string');
  assert.match(recalledContext, /Working preferences \(quoted data\):[\s\S]*TypeScript/);
  assert.match(recalledContext, /Native Memory is the ONLY active project memory backend/);
  const recalledResult = recalled.input.find(item =>
    item.type === 'function_call_output' && item.call_id === 'fixture-recall-1');
  assert.ok(recalledResult, 'The recall request must include the actual memory_search result');
  assert.match(recalledResult.output, /支付模块使用缓存/);
  passed.push('Preferences are reused on the next run and memory_search returns bounded historical excerpts');
  await run('inferred', '写一个简单脚本。');
  await until('Boolean(document.querySelector(".question-panel"))');
  await renderer.evaluate('[...document.querySelectorAll(".question-option")].find(e=>e.textContent.includes("跳过")).click();true');
  await click('.question-panel button', '提交回答'); await done();
  assert.equal((await renderer.evaluate(`window.mingshen.getProjectMemory(${sid})`)).preferences, 1);
  passed.push('Inferred preference uses the real question panel; Skip preserves existing preferences');
  await openMemory();
  await click('#memory-tab-memory');
  await replace('#memory-document', '# Project diary\n\nUnsaved diary draft.\n');
  await click('#memory-tab-preferences');
  await replace('#memory-document', '# Working preferences\n\nUse strict TypeScript.\n');
  const external = '# Project diary\n\nExternal diary change.\n';
  await writeFile(resolve(project, '.harness-memory/memory.md'), external);
  await click('.project-diary button', '保存记忆');
  await until('document.querySelector(".project-diary").textContent.includes("记忆已保存")');
  await click('#memory-tab-memory');
  assert.match(await renderer.evaluate('document.querySelector("#memory-document").value'), /Unsaved diary/);
  await click('.project-diary button', '保存记忆');
  await until('Boolean(document.querySelector(".project-diary [role=alert]"))');
  assert.equal(await readFile(resolve(project, '.harness-memory/memory.md'), 'utf8'), external);
  passed.push('Both tab drafts persist, while saving one never adopts a stale revision for the other; external edits cannot be silently overwritten');
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await shot('v129-memory-zh-night');
  await click('.settings-content__header button');
  await renderer.evaluate(`window.mingshen.setProjectMemoryEnabled(${sid},false)`);
  const before = await readFile(resolve(project, '.harness-memory/memory.md'), 'utf8');
  const oldSummaryCount = summaryCount;
  await run('disabled', '无记忆模式完成一次回复。'); await done();
  assert.equal(summaryCount, oldSummaryCount);
  const disabled = requests.findLast(r => r.scenario === 'disabled').body;
  assert.ok(!disabled.instructions.includes('PROJECT MEMORY:'));
  assert.match(memoryContext(disabled).at(-1), /\(No active information in this section\.\)$/);
  assert.equal(await readFile(resolve(project, '.harness-memory/memory.md'), 'utf8'), before);
  passed.push('Disabled memory omits the preference prompt and does not create a task-summary request or mutate the diary');
  await renderer.evaluate('window.mingshen.desktopAction("locale","en").then(()=>{localStorage.setItem("mingshen.locale","en");localStorage.setItem("mingshen.theme","day")})');
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer"))');
  await openMemory(true);
  assert.match(await renderer.evaluate('document.querySelector(".project-diary").textContent'), /Preferences \d+ · Memories/);
  assert.equal(await renderer.evaluate('document.querySelector(".settings-content").scrollWidth>document.querySelector(".settings-content").clientWidth+1'), false);
  await shot('v129-memory-en-day');
  passed.push('Project switch and file contents survive reload; English day and Chinese night compact settings stay within the viewport');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ version: currentVersion, passed, actorRequests: requests.length, summaryRequests: summaryCount, screenshots }, null, 2));
} catch (cause) {
  console.error(JSON.stringify({ passed, errors, scenario, turn, body: await renderer?.evaluate('document.body.innerText').catch(() => null) }, null, 2));
  if (renderer) await shot('v129-memory-failure').catch(() => {});
  throw cause;
} finally {
  if (child) {
    const ended = new Promise(done => child.once('exit', done));
    await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
    renderer?.close(); main?.close();
    await Promise.race([ended, sleep(7000)]);
    if (child.exitCode === null) { child.kill(); await ended; }
  }
  await new Promise(done => server.close(done));
  assert.ok(temporary.startsWith(resolve(tmpdir()) + sep));
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
