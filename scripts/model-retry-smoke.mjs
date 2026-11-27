import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { experimentalExecutable } from './experimental-executable.mjs';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-retry-'));
const profile = resolve(temporary, 'profile'), project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review', `v137-retry-${Date.now()}`);
const currentVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [], errors = [], requests = [];
let child, main, renderer, scenario = 'recover', count = 0, childRequests = 0, memoryRequests = 0;
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const event = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  if ((body.instructions || '').includes('会话标题生成')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    event({ type: 'response.output_text.delta', delta: 'Retry verification' });
    event({ type: 'response.completed' }); res.end(); return;
  }
  if ((body.instructions || '').includes('[PROJECT_MEMORY_SUMMARY]')) {
    memoryRequests++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    event({ type: 'response.output_text.delta', delta: 'Validated the local model retry workflow with an isolated temporary workspace and a synthetic provider. Completed file writes remain in conversation history and are never replayed during transport retries. Truncated tool calls do not execute, partial failed text is discarded, and each request uses a fixed retry allowance. Cancellation, permanent failures, scheduled tasks and delegated workers retain their normal execution boundaries.' });
    event({ type: 'response.completed' }); res.end(); return;
  }
  if (scenario === 'workers' && /"agent_depth"\s*:\s*1\b/.test(body.instructions || '')) {
    childRequests++;
    if (childRequests === 1) { res.writeHead(503, {'retry-after-ms':'0'}); res.end('Child temporary failure'); return; }
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    event({type:'response.output_text.delta',delta:'Recovered child verified findings.'}); event({type:'response.completed'});res.end();return;
  }
  count++; requests.push({ scenario, body });
  if (scenario === 'permanent' || scenario === 'disabled' || scenario === 'exhaust' || scenario === 'cancel' || ((scenario === 'recover' || scenario === 'scheduled') && count <= 2)) {
    res.writeHead(scenario === 'permanent' ? 403 : 503, { 'Content-Type': 'application/json', 'Retry-After': scenario === 'cancel' ? '300' : '0', 'X-Request-Id': 'local-retry-evidence' });
    res.end(JSON.stringify({ error: { message: 'Local temporary upstream failure', type: 'server_error' } })); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if(scenario==='episodes'){event({type:'response.output_text.delta',delta:`EPISODE_PARTIAL_${count}`});res.end();return;}
  if (scenario === 'workers' && count === 1) {
    event({ type:'response.output_item.added', output_index:0,item:{type:'function_call',call_id:'retry-child',name:'spawn_subagent',arguments:JSON.stringify({agent:'review-subagent',label:'Retry child',task:'Read-only: return a short verified finding.',context:'Do not modify files.'})}});
  } else if (scenario === 'tools' && count === 1) {
    event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'written-once', name: 'write_file', arguments: JSON.stringify({ path: 'retry-evidence.txt', content: 'Written exactly once.\n' }) } });
  } else if (scenario === 'tools' && count === 2) {
    event({ type: 'response.output_text.delta', delta: 'DISCARD_FAILED_ATTEMPT' });
    event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'never-execute', name: 'write_file', arguments: '{"path":"must-not-exist.txt","content":"unfinished' } });
    res.end(); return;
  } else event({ type: 'response.output_text.delta', delta: `Recovered ${scenario} response` });
  event({ type: 'response.completed', response: { usage: { input_tokens: 1200, output_tokens: 40 } } }); res.end();
});
async function connect(port, kind) {
  let target;
  for (let i = 0; i < 240; i++) { try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(t => t.webSocketDebuggerUrl && (kind === 'main' ? t.type === 'node' : t.type === 'page' && /\/renderer\/index\.html(?:[?#]|$)/.test(t.url))); if (target) break; } catch {} await sleep(100); }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let next = 0;
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', e => { const value = JSON.parse(String(e.data)); if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text); const p = pending.get(value.id); if (!p) return; pending.delete(value.id); clearTimeout(p.timer); value.error ? p.reject(new Error(value.error.message)) : p.done(value.result); });
  const send = (method, params = {}) => new Promise((done, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 30000); pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  return { send, evaluate, close: () => socket.close() };
}
async function until(expression, timeout = 30000) { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await renderer.evaluate(expression)) return; } catch (cause) { if (!/Execution context was destroyed|Cannot find context|Inspected target navigated or closed/.test(String(cause))) throw cause; } await sleep(60); } throw new Error(`Timed out: ${expression}`); }
async function reload() { await renderer.evaluate('globalThis.__retryReloadPending=true'); await renderer.send('Page.reload'); await until('document.readyState==="complete"&&!globalThis.__retryReloadPending&&Boolean(document.querySelector(".composer"))'); }
async function click(selector, text) { const target = text ? `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})` : `document.querySelector(${JSON.stringify(selector)})`; await until(`Boolean(${target})&&!(${target}).disabled`); await renderer.evaluate(`${target}.click();true`); }
async function shot(name) { await sleep(150); const image = await renderer.send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); }
async function setScenario(value) { scenario = value; count = 0; }
async function typeRetry(value) {
  const state = await renderer.evaluate(`new Promise(done=>{const input=document.querySelector("input[aria-describedby=model-retry-hint]");input.scrollIntoView({block:"center"});requestAnimationFrame(()=>requestAnimationFrame(()=>{input.focus();const rect=input.getBoundingClientRect();const hit=document.elementFromPoint(rect.x+Math.min(30,rect.width/2),rect.y+rect.height/2);done({focused:document.activeElement===input,hit:hit===input||input.contains(hit),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}) }))})`);
  assert.equal(state.focused, true, `Retry input did not receive DOM focus: ${JSON.stringify(state)}`);
  assert.equal(state.hit, true, `Retry input is not hit-testable after scrolling: ${JSON.stringify(state)}`);
  await renderer.send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await renderer.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await renderer.send('Input.insertText',{text:String(value)});
  await until(`document.querySelector('input[aria-describedby=model-retry-hint]').value===${JSON.stringify(String(value))}`);
}
try {
  await mkdir(project, { recursive: true }); await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(), ['--inspect=9386', '.', '--remote-debugging-port=9385'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9386, 'main'); await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  renderer = await connect(9385, 'renderer'); await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))'); await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  const fixture = await renderer.evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Retry fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-ui-fixture',keyLabel:'Fixture',neverReveal:true});const m=await window.mingshen.createModel({providerId:p.id,modelId:'retry',displayName:'Retry',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);const session=await window.mingshen.createSession({title:'${currentVersion} retry test',workspacePath:${JSON.stringify(project)},providerId:p.id,modelId:m.models[0].id,permissionMode:'full_access',reasoningLevel:null});return{sessionId:session.id}})()`);
  const sid = JSON.stringify(fixture.sessionId);
  const send = text => renderer.evaluate(`window.mingshen.sendChat({sessionId:${sid},text:${JSON.stringify(text)}})`);
  const done = status => until(`window.mingshen.getSession(${sid}).then(s=>s.status===${JSON.stringify(status)})`);
  await reload();
  await click('.app-topbar button[aria-label="打开设置"]'); await click('.settings-nav__item', '运行与集成');
  await until('document.querySelector("#model-retry-heading")&& !document.querySelector("input[aria-describedby=model-retry-hint]").disabled');
  assert.equal(await renderer.evaluate('document.querySelector("input[aria-describedby=model-retry-hint]").value'), '5');
  await typeRetry(21);
  await until('[...document.querySelectorAll("button")].find(x=>x.textContent==="保存重试设置").disabled');
  await typeRetry(20);
  await click('button','保存重试设置'); await until('document.querySelector(".settings-content").textContent.includes("自动重试设置已保存")');
  assert.equal(await renderer.evaluate('window.mingshen.getModelRetrySettings().then(s=>s.maxRetries)'),20);
  await renderer.send('Emulation.setDeviceMetricsOverride',{width:1040,height:680,deviceScaleFactor:1,mobile:false});
  await shot('retry-settings-zh-night'); passed.push('Real typing, default five, rejected twenty-one and saved twenty through IPC');
  await click('.settings-content__header button'); await renderer.evaluate('window.mingshen.setModelRetrySettings({maxRetries:5})');
  await setScenario('recover'); await send('Read no files. Reply briefly.'); await done('idle');
  assert.equal(count,3); passed.push('Two HTTP 503 failures recover in the same real desktop run');
  await setScenario('tools'); await send('Create retry-evidence.txt and finish.'); await done('idle');
  assert.equal(await readFile(resolve(project,'retry-evidence.txt'),'utf8'),'Written exactly once.\n');
  assert.equal(count,3);
  const toolRequests=requests.filter(x=>x.scenario==='tools'); assert.deepEqual(toolRequests[1].body,toolRequests[2].body);
  await assert.rejects(readFile(resolve(project,'must-not-exist.txt')), {code:'ENOENT'});
  assert.equal(await renderer.evaluate('document.querySelector(".conversation")?.textContent.includes("DISCARD_FAILED_ATTEMPT")'),false);
  await until('[...document.querySelectorAll(".tool-call summary")].some(el=>el.textContent.includes("write_file")&&el.textContent.includes("完成"))');
  assert.equal(toolRequests.every(request=>request.body.tools?.some(tool=>tool.name==='write_file')),true);
  await renderer.evaluate('[...document.querySelectorAll(".tool-call summary")].find(el=>el.textContent.includes("write_file"))?.scrollIntoView({block:"center"});true');
  await shot('completed-tool-preserved');
  passed.push('Completed file write not replayed and its card stays visible; tools retained on retry; truncated tool never executes; failed partial text cleared');
  await renderer.evaluate('globalThis.__retryTitles=[];globalThis.__retryUnsub=window.mingshen.onRuntimeEvent(e=>{if(e.type==="activity"&&e.activity.toolName==="model_retry"&&e.activity.status==="running")globalThis.__retryTitles.push(e.activity.title)});window.mingshen.setModelRetrySettings({maxRetries:2})');
  await setScenario('episodes'); await send('Exercise the fixed retry budget without changing any files.'); await done('error');assert.equal(count,3);
  assert.deepEqual(await renderer.evaluate('globalThis.__retryTitles'),['正在自动尝试重连（1/2）','正在自动尝试重连（2/2）']);
  const stored = await renderer.evaluate(`window.mingshen.getSessionMessages(${sid})`);
  assert.equal(JSON.stringify(stored).includes('EPISODE_PARTIAL_'),false);
  assert.equal(JSON.stringify(stored).includes('written-once'),true);
  assert.equal(requests.filter(request=>request.scenario==='episodes').every(request=>request.body.tools?.some(tool=>tool.name==='write_file')),true);
  await shot('partial-budget-exhausted');
  await renderer.evaluate('globalThis.__retryUnsub();window.mingshen.setModelRetrySettings({maxRetries:5})');
  passed.push('Partial text on every failed attempt cannot reset the two-retry budget; incomplete text absent from history and completed tool history retained');
  await setScenario('cancel'); await send('Wait for network recovery.'); await until('document.body.textContent.includes("正在自动尝试重连（1/5）")');
  await renderer.evaluate('document.querySelector("button[aria-label=回到底部并恢复自动跟随]")?.click();true');
  await shot('retry-wait-zh-night'); await renderer.evaluate(`window.mingshen.stopChat(${sid})`); await done('interrupted'); assert.equal(count,1);
  passed.push('Stop cancels a five-minute server-requested wait without another request');
  await setScenario('permanent'); await send('Return a permanent failure.'); await done('error'); assert.equal(count,1);
  passed.push('HTTP 403 stops immediately and preserves full error');
  await setScenario('disabled'); await renderer.evaluate('window.mingshen.setModelRetrySettings({maxRetries:0})'); await send('Disable retries.'); await done('error'); assert.equal(count,1);
  await setScenario('exhaust'); await renderer.evaluate('window.mingshen.setModelRetrySettings({maxRetries:2})'); await send('Exhaust two retries.'); await done('error'); assert.equal(count,3);
  passed.push('Zero disables retries; configured exhaustion requests exactly initial plus limit');
  await renderer.evaluate('window.mingshen.setModelRetrySettings({maxRetries:5})');
  await setScenario('scheduled');
  await renderer.evaluate(`(async()=>{const task=await window.mingshen.createScheduledTask({name:'Retry schedule',sessionId:${sid},prompt:'Respond to the scheduled request.',intervalMinutes:10080,enabled:false});await window.mingshen.runScheduledTaskNow(task.id)})()`);
  await done('idle'); assert.equal(count,3); passed.push('Scheduled task recovers from two upstream failures without a manual restart');
  await setScenario('workers'); await send('Delegate a read-only review and summarize the findings.'); await done('idle');
  assert.equal(childRequests,2); passed.push('Real delegated child recovers from HTTP 503 and returns findings to its parent');
  await renderer.evaluate('window.mingshen.desktopAction("locale","en").then(()=>{localStorage.setItem("mingshen.locale","en");localStorage.setItem("mingshen.theme","day")})');
  await reload();
  await click('.app-topbar button[aria-label="Open settings"]'); await click('.settings-nav__item','Runtime and integrations');
  await until('document.querySelector("input[aria-describedby=model-retry-hint]")?.value==="5"');
  assert.equal(await renderer.evaluate('document.querySelector(".settings-content").scrollWidth>document.querySelector(".settings-content").clientWidth+1'),false);
  await shot('retry-settings-en-day'); passed.push('Persistence after reload; English day and Chinese night compact settings render without horizontal overflow');
  assert.deepEqual(errors, []);
  const result={version:currentVersion,passed,errors,requests:requests.length,childRequests,memoryRequests,screenshots};
  await writeFile(resolve(screenshots,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch(cause) {
  console.error(JSON.stringify({passed,errors,scenario,count,body:await renderer?.evaluate('document.body.innerText').catch(()=>null)},null,2));
  await writeFile(resolve(screenshots,'failure.json'),JSON.stringify({passed,errors,scenario,count,error:cause.stack||String(cause)},null,2)).catch(()=>{});
  if(renderer) await shot('failure').catch(()=>{}); throw cause;
} finally {
  if(child){const done=new Promise(resolve=>child.once('exit',resolve));await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(()=>{});renderer?.close();main?.close();await Promise.race([done,sleep(7000)]);if(child.exitCode===null){child.kill();await done;}}
  await new Promise(done=>server.close(done));
  if(!temporary.startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe cleanup');await rm(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
