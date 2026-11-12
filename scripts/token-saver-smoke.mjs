import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-token-saver-'));
const screenshots = resolve('.impeccable/review');
const currentVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const passed = [], errors = [], requests = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, main, renderer, scenario = 'dedupe', summaries = 0, recallId, recallRound = 0;
const answer = 'Verified historical explanation. '.repeat(180);
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const summary = (body.instructions || '').includes('会话压缩任务') ||
    (body.tool_choice === 'none' && JSON.stringify(body.input?.at(-1) || '').includes('Temporarily summarize the preceding completed conversation prefix'));
  if (scenario === 'failure' && !summary) { res.writeHead(403); res.end('fixture forbidden'); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
  const text = delta => event({ type: 'response.output_text.delta', delta });
  if ((body.instructions || '').includes('会话标题生成')) text('Token Saver fixture');
  else if (summary) {
    summaries++;
    text('User goals: preserve SOURCE_GOAL, keep all permissions and real evidence. Completed historical checks; continue the latest request. Original records retained with source identifiers.');
  } else {
    requests.push({ scenario, body });
    if (scenario === 'recall' && recallRound++ === 0) event({
      type: 'response.output_item.added', output_index: 0,
      item: { type: 'function_call', call_id: 'recall-original', name: 'recall_context', arguments: JSON.stringify({ message_id: recallId, part_index: 0 }) },
    });
    else text(scenario === 'dedupe' ? answer : 'Completed with original history available.');
  }
  const cacheDetails = scenario === 'dedupe' && requests.length === 7
    ? {} : { input_tokens_details: { cached_tokens: scenario === 'dedupe' && requests.length === 8 ? 0 : 108 } };
  event({ type: 'response.completed', response: { usage: { input_tokens: 120, output_tokens: 40, ...cacheDetails } } });
  res.end();
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
  await until(`Boolean(${target})&&!(${target}).disabled`); await renderer.evaluate(`${target}.click();true`);
}
async function shot(name) {
  await sleep(200);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function openSettings(english = false) {
  await click(`.app-topbar button[aria-label="${english ? 'Open settings' : '打开设置'}"]`);
  await click('.settings-nav__item', english ? 'Skills and plugins' : 'Skills 与插件');
  await until('Boolean(document.querySelector(".token-saver-settings input:not(:disabled)"))');
}
try {
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9394', '.', '--remote-debugging-port=9393'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9394);
  await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  renderer = await connect(9393); await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  await until('!document.querySelector(".policy-dialog")');
  const session = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Token Saver fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-saver-fixture',keyLabel:'Fixture',neverReveal:true});
    const provider=await window.mingshen.createModel({providerId:p.id,modelId:'saver',displayName:'Saver fixture',contextWindow:200000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);
    const settings=(await window.mingshen.getTokenSaver()).settings;
    await window.mingshen.setTokenSaver({...settings,historySummaries:false});
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    return window.mingshen.createSession({title:'Token Saver fixture',providerId:p.id,modelId:provider.models[0].id,workspacePath:null,permissionMode:'request_approval',reasoningLevel:null});
  })()`);
  const sid = JSON.stringify(session.id);
  const snapshot = () => renderer.evaluate(`window.mingshen.getTokenSaver(${sid})`);
  const configure = value => renderer.evaluate(`window.mingshen.getTokenSaver().then(s=>window.mingshen.setTokenSaver({...s.settings,...${JSON.stringify(value)}}))`);
  const run = async text => {
    await renderer.evaluate(`window.mingshen.sendChat({sessionId:${sid},text:${JSON.stringify(text)}})`);
    await until(`window.mingshen.getSession(${sid}).then(s=>!['running','waiting_approval'].includes(s.status))`);
    assert.equal((await renderer.evaluate(`window.mingshen.getSession(${sid})`)).status, 'idle');
  };
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer"))');
  for (let i = 0; i < 8; i++) await run(`SOURCE_GOAL ${i}: preserve exact constraints and continue.`);
  const stableView = await snapshot();
  assert.equal(stableView.report.savedTokens, 0);
  for (let i = 1; i < 8; i++) {
    assert.equal(requests[i].body.instructions, requests[i - 1].body.instructions);
    assert.deepEqual(requests[i].body.tools, requests[i - 1].body.tools);
    assert.deepEqual(requests[i].body.input.slice(0, requests[i - 1].body.input.length), requests[i - 1].body.input);
    assert.equal(requests[i].body.prompt_cache_key, undefined, 'Unknown compatible gateways receive no unsupported cache fields');
  }
  assert.equal(stableView.usage.agent.requests, 8);
  assert.equal(stableView.usage.agent.cacheMeasuredRequests, 7);
  assert.equal(stableView.usage.agent.cacheMeasuredInputTokens, 840);
  assert.equal(stableView.usage.agent.cachedInputTokens, 648);
  assert.equal(stableView.usage.agent.cacheCreationMeasuredRequests, 0);
  assert.equal(stableView.cacheDiagnostics.agent.change, 'append_only');
  assert.equal(stableView.cacheDiagnostics.agent.cacheOutcome, 'none');
  assert.equal(stableView.cacheDiagnostics.agent.cachedInputTokens, 0);
  passed.push('Eight actual transport requests preserve the complete earlier prefix, system and tool schema; moving recent-turn boundaries do not rewrite emitted history');
  await configure({ outputMode: 'standard' });
  await run('SOURCE_GOAL: continue after the explicit output-policy change.');
  const view = await snapshot();
  assert.equal(view.cacheDiagnostics.agent.change, 'system');
  assert.equal(view.cacheDiagnostics.agent.cacheOutcome, 'partial');
  assert.ok(view.report.savedTokens > 0);
  assert.ok(JSON.stringify(requests.at(-1).body).includes('Exact duplicate of retained message'));
  assert.match(requests[0].body.instructions, /TOKEN_SAVER response=auto/);
  assert.ok(requests[0].body.tools.some(t => t.name === 'recall_context'));
  const originals = await renderer.evaluate(`window.mingshen.getSessionMessages(${sid})`);
  const savedAnswers = originals.filter(m => m.role === 'assistant').flatMap(m => m.parts).filter(p => p.type === 'text').map(p => p.text);
  assert.ok(savedAnswers.every(t => t === answer));
  passed.push('An explicit configuration change rebuilds the request representation and deduplicates older replies while all original messages and constraints remain intact');
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await openSettings();
  const expectedRate = `${(100 * view.usage.agent.cachedInputTokens / view.usage.agent.cacheMeasuredInputTokens).toFixed(1)}%`;
  assert.equal(await renderer.evaluate('document.querySelector(\'[data-cache="rate"]\').textContent'), expectedRate);
  assert.equal(await renderer.evaluate('document.querySelector(\'[data-cache="write"]\').textContent'), '未报告');
  const reported = Object.values(view.usage).reduce((sum, value) => sum + (value.cacheMeasuredRequests ?? 0), 0);
  const allRequests = Object.values(view.usage).reduce((sum, value) => sum + value.requests, 0);
  assert.equal(await renderer.evaluate('document.querySelector(\'[data-cache="coverage"]\').textContent'), `${reported} / ${allRequests} 次请求`);
  await click('.token-saver-stats details summary', '实际用量明细');
  await renderer.evaluate('document.querySelector(\'[data-cache="rate"]\').scrollIntoView({block:"center"});true');
  await shot('v129-cache-usage-zh-night');
  await renderer.evaluate('document.querySelector(".token-saver-table").scrollIntoView({block:"center",inline:"nearest"});true');
  assert.equal(await renderer.evaluate('document.querySelector(".settings-content").scrollWidth>document.querySelector(".settings-content").clientWidth+1'), false);
  await shot('v129-cache-table-zh-night');
  await click('.token-saver-stats details summary', '缓存前缀诊断');
  await renderer.evaluate('document.querySelector("[data-cache-diagnostics]").scrollIntoView({block:"center"});true');
  assert.match(await renderer.evaluate('document.querySelector("[data-cache-diagnostics]").textContent'), /系统提示发生变化/);
  await shot('v129-cache-diagnostics-zh-night');
  passed.push('Cache UI uses explicitly reported input only: unknown excluded, reported zero included, writes unknown distinguished from zero, and measured coverage visible');
  await click('.token-saver-stats details summary', '最近请求优化记录 (' + view.report.changes.length + ')');
  await click('.token-saver-changes button');
  await until('document.querySelector(".token-saver-source pre")?.textContent.length>1000');
  assert.equal(await renderer.evaluate('document.querySelector(".token-saver-source pre").textContent'), answer);
  const numeric = '.token-saver-grid input[type=number]';
  await renderer.evaluate(`document.querySelector(${JSON.stringify(numeric)}).focus();document.querySelector(${JSON.stringify(numeric)}).select();true`);
  await renderer.send('Input.insertText', { text: '12' });
  await click('.token-saver-settings button', '保存 Token Saver');
  await until('document.querySelector("#token-saver-validation")?.textContent.includes("必须大于")');
  await until('document.activeElement.id==="token-saver-summarizeAfterTurns"');
  assert.equal(await renderer.evaluate('document.activeElement.id'), 'token-saver-summarizeAfterTurns');
  assert.equal((await snapshot()).settings.keepRecentTurns, 5);
  assert.equal(await renderer.evaluate('document.querySelector("#token-saver-keepRecentTurns").value'), '12');
  await shot('v129-token-saver-validation-zh-night');
  await renderer.evaluate(`document.querySelector(${JSON.stringify(numeric)}).focus();document.querySelector(${JSON.stringify(numeric)}).select();true`);
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  assert.equal(await renderer.evaluate('document.querySelector("#token-saver-keepRecentTurns").value'), '');
  await click('.token-saver-settings button', '保存 Token Saver');
  await until('document.querySelector("#token-saver-validation")?.textContent.includes("1–20")');
  await until('document.activeElement.id==="token-saver-keepRecentTurns"');
  assert.equal(await renderer.evaluate('document.activeElement.id'), 'token-saver-keepRecentTurns');
  await renderer.send('Input.insertText', { text: '4' }); await sleep(1100);
  assert.equal(await renderer.evaluate('document.activeElement===document.querySelector(".token-saver-grid input")'), true);
  await click('.token-saver-settings button', '保存 Token Saver');
  await until('document.querySelector(".token-saver-settings").textContent.includes("配置已保存")');
  assert.equal((await snapshot()).settings.keepRecentTurns, 4);
  passed.push('Real plugin controls retain typing focus, reject empty/cross-field invalid values with localized inline errors and field focus, preserve drafts, save through IPC and show original history');
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate('document.querySelector(".settings-content__body").scrollTop=0;true');
  await shot('v129-token-saver-zh-night');
  await click('.settings-content__header button');
  await configure({ keepRecentTurns: 5, summarizeAfterTurns: 6, minimumSummaryTokens: 1024, historySummaries: true, deduplicate: false });
  scenario = 'summary'; await run('Continue SOURCE_GOAL with the same constraints.');
  assert.equal(summaries, 1);
  const summarized = await snapshot();
  assert.equal(summarized.historySummary.keptTurns, 5);
  assert.ok(summarized.usage.compaction.totalTokens > 0);
  assert.match(JSON.stringify(requests.at(-1).body), /Original records retained/);
  const nowOriginals = await renderer.evaluate(`window.mingshen.getSessionMessages(${sid})`);
  assert.deepEqual(nowOriginals.slice(0, originals.length), originals);
  passed.push('Proactive summary below window pressure retains originals and counts the auxiliary model cost separately');
  recallId = originals.find(m => m.role === 'assistant').id;
  scenario = 'recall'; await run('Read the exact original historical explanation before continuing.');
  assert.match(JSON.stringify(requests.at(-1).body), /Original historical data/);
  assert.match(JSON.stringify(requests.at(-1).body), /Verified historical explanation/);
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${sid})`)).permissionMode, 'request_approval');
  passed.push('Model invokes recall_context through the real tool loop and receives same-session originals without changing approval mode');
  await configure({ enabled: false });
  scenario = 'disabled'; const oldSummaries = summaries; await run('Continue without Token Saver optimizations.');
  assert.equal(summaries, oldSummaries);
  assert.ok(!requests.at(-1).body.tools.some(t => t.name === 'recall_context'));
  assert.ok(!requests.at(-1).body.instructions.includes('[TOKEN_SAVER'));
  passed.push('Disabled plugin adds no response policy, proactive summary or recall tool; saved historical summaries remain usable');
  await renderer.evaluate('window.mingshen.desktopAction("locale","en").then(()=>{localStorage.setItem("mingshen.locale","en");localStorage.setItem("mingshen.theme","day")})');
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer"))');
  await openSettings(true);
  assert.equal((await snapshot()).settings.enabled, false);
  const english = await renderer.evaluate('document.querySelector(".token-saver-settings").textContent');
  assert.match(english, /Enable Token Saver/);
  assert.doesNotMatch(english, /[\u4e00-\u9fff]/);
  assert.equal(await renderer.evaluate('document.querySelector(".settings-content").scrollWidth>document.querySelector(".settings-content").clientWidth+1'), false);
  await shot('v129-token-saver-en-day');
  assert.equal(await renderer.evaluate('document.querySelector(\'[data-cache="write"]\').textContent'), 'Not reported');
  await click('.token-saver-stats details summary', 'Reported usage details');
  await renderer.evaluate('document.querySelector(\'[data-cache="rate"]\').scrollIntoView({block:"center"});true');
  await shot('v129-cache-usage-en-day');
  await renderer.evaluate('document.querySelector(".token-saver-table").scrollIntoView({block:"center",inline:"nearest"});true');
  await shot('v129-cache-table-en-day');
  await click('.token-saver-stats details summary', 'Cache prefix diagnostics');
  await renderer.evaluate('document.querySelector("[data-cache-diagnostics]").scrollIntoView({block:"center"});true');
  assert.equal(await renderer.evaluate('document.querySelector(".token-saver-diagnostics").textContent.includes("Provider reported")'), true);
  await shot('v129-cache-diagnostics-en-day');
  await click('.settings-content__header button');
  await click('.context-meter');
  await renderer.evaluate('document.querySelector(".token-saver-context").open=true;true');
  await until('document.querySelector(".context-details").textContent.includes("Cumulative reported usage")');
  const bounds = await renderer.evaluate('(()=>{const r=document.querySelector(".context-details").getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight}})()');
  assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height);
  await shot('v129-token-saver-context-en-day');
  passed.push('Settings persist across reload; English day/Chinese night and compact CTX detail remain within the viewport');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ version: currentVersion, passed, actorRequests: requests.length, summaryRequests: summaries, screenshots }, null, 2));
} catch (cause) {
  console.error(JSON.stringify({ passed, errors, scenario, body: await renderer?.evaluate('(document.querySelector(".token-saver-settings")?.innerText || document.body.innerText).slice(0,12000)').catch(() => null) }, null, 2));
  if (renderer) await shot('v129-token-saver-failure').catch(() => {});
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
