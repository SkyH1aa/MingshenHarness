import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-compaction-'));
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
let child;
let renderer;
let main;
let releaseSummary = false;
let failSummary = false;
let backupFailure = false;
let outputLimitMode = '';
let outputLimitIssued = false;
const summaries = [];
const regular = [];
const rounds = new Map();
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const isSummary = String(body.instructions).startsWith('# 会话压缩任务') ||
    (body.tool_choice === 'none' && JSON.stringify(body.input?.at(-1) || '').includes('Temporarily summarize the preceding completed conversation prefix'));
  if (isSummary && ((failSummary && body.model !== 'backup-summary') || (backupFailure && body.model === 'backup-summary'))) { summaries.push(body); response.writeHead(503); response.end(body.model === 'backup-summary' ? 'Backup compaction unavailable' : 'Fixture compaction unavailable'); return; }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const end = (inputTokens = 5000) => { event({ type: 'response.completed', response: { usage: { input_tokens: inputTokens, output_tokens: 100, total_tokens: inputTokens + 100 } } }); response.end(); };
  if (isSummary) {
    summaries.push(body);
    if (body.tool_choice === 'none') {
      assert.ok(body.tools?.length > 0, 'Prefix reuse keeps the original tools while forbidding selection');
      assert.equal(body.instructions, regular.findLast(request => request.model === body.model)?.instructions);
    } else assert.equal(body.tools?.length ?? 0, 0);
    while (!releaseSummary && !response.destroyed) await sleep(40);
    if (response.destroyed) return;
    if (outputLimitMode) {
      assert.equal(body.max_output_tokens, 30000, 'The 200K main context limits every compactor to 30K total output tokens');
      assert.match(JSON.stringify(body), /Summary hard limit: 30000 tokens/);
      if (!outputLimitIssued) {
        outputLimitIssued = true;
        event({ type: 'response.reasoning_summary_text.delta', delta: 'Fixture reasoning consumed the output allowance.' });
        event({ type: 'response.output_text.delta', delta: 'DISCARDED_INCOMPLETE_SUMMARY' });
        event({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 197206, output_tokens: 30000, output_tokens_details: { reasoning_tokens: 29900 } } } });
        response.end();
        return;
      }
      assert.match(JSON.stringify(body), /Write a shorter summary/);
      assert.doesNotMatch(JSON.stringify(body), /DISCARDED_INCOMPLETE_SUMMARY/);
    }
    event({ type: 'response.output_text.delta', delta: 'COMPACTED_CONTEXT: Preserve user goals, permission rules and pending tasks. The earlier task investigated facts. Original messages stay local. Continue the current instruction with real tools.' });
    end(400);
    return;
  }
  regular.push(body);
  const text = JSON.stringify(body.input || []);
  const scenario = text.match(/CASE:([a-z]+)/)?.[1] || 'current';
  const round = (rounds.get(scenario) || 0) + 1;
  rounds.set(scenario, round);
  if (scenario === 'active' && round <= 2) {
    if (round === 1) event({ type: 'response.output_text.delta', delta: 'Actual observed repository findings and constraints.\n'.repeat(200) });
    event({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: `active-step-${round}`, name: 'update_todos', arguments: '' } });
    event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"todos":[{"content":"Preserve active work while compacting","status":"in_progress"}]}' });
    end(round === 1 ? 5000 : 170000);
    return;
  }
  event({ type: 'response.output_text.delta', delta: round === 1 ? 'OLD_HISTORY_MARKER\n' + 'Observed source evidence; preserve constraints.\n'.repeat(300) : 'RESUMED_AFTER_COMPACTION. Current instruction completed.' });
  end(round === 1 || (scenario === 'failed' && round === 2) ? 170000 : 5000);
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
    const value = JSON.parse(String(event.data));
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id); clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  return { evaluate, send, close: () => socket.close() };
}

try {
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9348', '.', '--remote-debugging-port=9343'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9348);
  await main.evaluate("globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true");
  renderer = await connect(9343);
  const { evaluate, send } = renderer;
  const until = async (expression, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(60); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (selector, text) => {
    const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
    await until(`Boolean(${expression})`); await evaluate(`${expression}.click();true`);
  };
  const revealSessions = async count => {
    await until("Boolean(document.querySelector('.session-group__list'))");
    await evaluate("document.querySelectorAll('.session-group__show-all[aria-expanded=false]').forEach(el=>el.click());true");
    await until(`document.querySelectorAll('.session-row').length===${count}`);
  };
  const select = async session => {
    if (!(await evaluate(`[...document.querySelectorAll('.session-row__title')].some(el=>el.textContent===${JSON.stringify(session.title)})`))) await evaluate("document.querySelectorAll('.session-group__show-all[aria-expanded=false]').forEach(el=>el.click());true");
    await click('.session-row__title', session.title);
  };
  const finished = async session => until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(session.id)})?.status==='idle')`);
  const start = async (session, text) => {
    await select(session); await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(text)}})`);
  };
  const shot = async name => { const image = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); };
  const chooseModel = async (selector, model) => {
    await until(`Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`);
    await sleep(120);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await evaluate("Boolean(document.querySelector('.model-picker__panel'))"))) await evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
      await until("Boolean(document.querySelector('.model-picker__panel'))");
      if (await evaluate("Boolean(document.querySelector('.model-picker__model'))")) break;
      await evaluate("document.querySelector('.model-picker__provider-toggle')?.click();true");
      await sleep(80);
      if (await evaluate("Boolean(document.querySelector('.model-picker__model'))")) break;
    }
    await until(`Boolean([...document.querySelectorAll('.model-picker__model')].find(el=>el.querySelector('code')?.textContent===${JSON.stringify(model)}))`);
    await evaluate(`[...document.querySelectorAll('.model-picker__model')].find(el=>el.querySelector('code')?.textContent===${JSON.stringify(model)}).click();true`);
  };
  await until("Boolean(document.querySelector('.policy-consents'))");
  await sleep(5100);
  await evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  const fixture = await evaluate(`(async()=>{
    // Isolate summary/fallback behavior; transport reconnection has its own runtime coverage.
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const provider=await window.mingshen.createProvider({name:'Local compaction',baseUrl:'http://127.0.0.1:${port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-fixture-key',keyLabel:'Local',neverReveal:true});
    for(const modelId of ['current','global-summary','session-summary','backup-summary']) await window.mingshen.createModel({providerId:provider.id,modelId,contextWindow:200000,maxOutputTokens:65536,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const configured=(await window.mingshen.bootstrap()).providers.find(p=>p.id===provider.id);
    const config={providerId:provider.id,modelId:configured.models.find(m=>m.modelId==='current').id,workspacePath:null,reasoningLevel:null,permissionMode:'request_approval'};
    const sessions=[];for(const title of ['Current model','Global model','Session model','Active task','Interrupted compaction','Failed compaction'])sessions.push(await window.mingshen.createSession({...config,title}));
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    return {sessions,providerId:provider.id,globalId:configured.models.find(m=>m.modelId==='global-summary').id,customId:configured.models.find(m=>m.modelId==='session-summary').id,backupId:configured.models.find(m=>m.modelId==='backup-summary').id,config};
  })()`);
  await send('Page.reload');
  await revealSessions(6);
  const [current, global, custom, active, interrupted, failed] = fixture.sessions;
  await start(current, 'CASE:current First complete the investigation.');
  await finished(current);
  assert.equal(summaries.length, 0);
  await sleep(400);
  assert.equal(summaries.length, 0);
  assert.match(await evaluate("document.querySelector('.context-meter').textContent"), /85%/);
  passed.push('Completed reply at 85% stays idle and makes no background compaction request');
  await start(current, 'CURRENT_NEW_INSTRUCTION: Continue CASE:current without losing the goal.');
  await until("Boolean(document.querySelector('.context-notice')?.textContent.includes('可能需要几分钟'))");
  await shot('compaction-current-zh-night');
  assert.equal(summaries[0].model, 'current');
  assert.equal(regular.length, 1);
  await send('Page.reload');
  await until("Boolean(document.querySelector('.context-notice')?.textContent.includes('可能需要几分钟'))");
  assert.equal(summaries.length, 1);
  releaseSummary = true;
  await finished(current);
  assert.match(JSON.stringify(regular.at(-1).input), /COMPACTED_CONTEXT/);
  assert.match(JSON.stringify(regular.at(-1).input), /CURRENT_NEW_INSTRUCTION/);
  assert.doesNotMatch(JSON.stringify(regular.at(-1).input), /OLD_HISTORY_MARKER/);
  const originals = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(current.id)})`);
  assert.match(JSON.stringify(originals), /OLD_HISTORY_MARKER/);
  assert.match(JSON.stringify(originals), /RESUMED_AFTER_COMPACTION/);
  passed.push('Next message triggers current-model summary, reload restores progress, original history survives, task resumes with summary and current instruction');

  await evaluate("document.querySelector('.context-meter').click();true");
  await click('.context-details button', '压缩设置');
  await until("Boolean(document.querySelector('.context-settings'))");
  await chooseModel('.context-settings .model-picker__trigger', 'global-summary');
  await click('.context-settings button', '保存全局配置');
  await until(`window.mingshen.getGlobalCompactionModel().then(x=>x?.modelId===${JSON.stringify(fixture.globalId)})`);
  await shot('compaction-settings-zh-night');
  await evaluate("document.querySelector('button[aria-label=\"关闭设置\"]').click();true");
  await start(global, 'CASE:global Investigation.'); await finished(global);
  const globalStart = summaries.length;
  await start(global, 'Continue CASE:global.'); await finished(global);
  assert.equal(summaries[globalStart].model, 'global-summary');
  passed.push('Global default model saved through grouped model picker and used for inherited conversation compaction');

  await select(custom);
  await evaluate("document.querySelector('.context-meter').click();true");
  await click('.context-details button', '压缩设置');
  await until("Boolean(document.querySelector('.context-settings__session select'))");
  await evaluate("const mode=document.querySelector('.context-settings__session select');mode.value='custom';mode.dispatchEvent(new Event('change',{bubbles:true}));true");
  await chooseModel('.context-settings__session .model-picker__trigger', 'session-summary');
  await click('.context-settings button', '保存会话配置');
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(custom.id)})?.compactionModel?.modelId===${JSON.stringify(fixture.customId)})`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click();document.documentElement.dataset.theme='day';true");
  await shot('compaction-settings-en-day');
  await evaluate("document.querySelector('button[aria-label=\"Close settings\"]').click();true");
  await start(custom, 'CASE:custom Investigation.'); await finished(custom);
  releaseSummary = false;
  const customStart = summaries.length;
  await start(custom, 'Continue CASE:custom.');
  await until("Boolean(document.querySelector('.context-notice')?.textContent.includes('few minutes'))");
  await shot('compaction-custom-en-day');
  assert.equal(summaries[customStart].model, 'session-summary');
  releaseSummary = true; await finished(custom);
  passed.push('Per-conversation model overrides global, settings persist, English/day compact progress and settings render');

  const immutablePrefix = regular.at(-1).input[0];
  await start(custom, 'NEW_CUSTOM_EVIDENCE: ' + 'Verified new evidence and changed results. '.repeat(500)); await finished(custom);
  await start(custom, 'Continue CASE:custom after the new evidence.'); await finished(custom);
  const incrementalStart = summaries.length;
  await evaluate(`window.mingshen.compactChat(${JSON.stringify(custom.id)})`);
  await finished(custom);
  assert.equal(summaries.length, incrementalStart + 1);
  assert.equal(summaries[incrementalStart].model, 'session-summary');
  assert.match(JSON.stringify(summaries[incrementalStart].input), /Older immutable summaries/);
  assert.match(JSON.stringify(summaries[incrementalStart].input), /NEW_CUSTOM_EVIDENCE/);
  await start(custom, 'Continue CASE:custom after incremental compaction.'); await finished(custom);
  assert.deepEqual(regular.at(-1).input[0], immutablePrefix);
  assert.match(JSON.stringify(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(custom.id)})`)), /NEW_CUSTOM_EVIDENCE/);
  passed.push('Consecutive custom-model compaction appends a new segment, preserves the actual main-model summary prefix and keeps original new evidence');

  const activeStart = summaries.length;
  releaseSummary = false;
  await start(active, 'CASE:active Work across multiple tool steps.');
  await until("Boolean(document.querySelector('.context-notice')?.textContent.includes('few minutes'))");
  for (let i = 0; i < 200 && summaries.length < activeStart + 1; i++) await sleep(25);
  assert.equal(summaries.length, activeStart + 1);
  releaseSummary = true; await finished(active);
  assert.match(JSON.stringify(regular.at(-1).input), /COMPACTED_CONTEXT/);
  assert.match(JSON.stringify(regular.at(-1).input), /CASE:active/);
  assert.match(JSON.stringify(regular.at(-1).input), /function_call_output/);
  passed.push('Active tool loop compacts at the next safe boundary, preserves paired tool result and continues the same run');

  await start(interrupted, 'CASE:interrupted Investigation.'); await finished(interrupted);
  releaseSummary = false;
  await start(interrupted, 'Continue CASE:interrupted.');
  await until("Boolean(document.querySelector('.context-notice'))");
  await evaluate(`window.mingshen.stopChat(${JSON.stringify(interrupted.id)})`);
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(interrupted.id)})?.status==='interrupted')`);
  const state = await evaluate('window.mingshen.bootstrap()');
  assert.equal(state.contextStates.find(s=>s.sessionId===interrupted.id).lastCompactedAt, null);
  releaseSummary = true;
  await start(interrupted, 'Retry CASE:interrupted safely.'); await finished(interrupted);
  passed.push('Stop cancels compaction without a checkpoint; next run retries and resumes with intact history');

  await start(failed, 'CASE:failed Investigation.'); await finished(failed);
  failSummary = true;
  await start(failed, 'Continue CASE:failed with original data.'); await finished(failed);
  assert.match(await evaluate("document.querySelector('.context-notice--error').textContent"), /503/);
  assert.match(JSON.stringify(regular.at(-1).input), /OLD_HISTORY_MARKER/);
  failSummary = false;
  await start(failed, 'Retry CASE:failed.'); await finished(failed);
  assert.match(JSON.stringify(regular.at(-1).input), /COMPACTED_CONTEXT/);
  passed.push('HTTP503 preserves error and original context, continues when it still fits, then retries compaction next run');

  await evaluate("document.querySelector('.context-meter').click();true");
  await click('.context-details button', 'Compaction settings');
  await until("Boolean(document.querySelector('.context-settings__fallback .model-picker__trigger'))");
  await chooseModel('.context-settings__fallback .model-picker__trigger', 'backup-summary');
  await click('.context-settings__fallback button', 'Save backup compaction model');
  await until(`window.mingshen.getCompactionFallbackModel().then(x=>x?.modelId===${JSON.stringify(fixture.backupId)})`);
  await shot('compaction-backup-settings-en-day');
  await evaluate("document.querySelector('button[aria-label=\"Close settings\"]').click();true");
  const backupSession = await evaluate(`window.mingshen.createSession({...${JSON.stringify(fixture.config)},title:'Backup compaction'})`);
  await send('Page.reload'); await revealSessions(7);
  await start(backupSession, 'CASE:backup Investigation.'); await finished(backupSession);
  failSummary = true; releaseSummary = false;
  const backupStart = summaries.length;
  await start(backupSession, 'Continue CASE:backup with fallback.');
  await until("document.querySelector('.context-notice')?.textContent.includes('backup model')");
  assert.equal(summaries[backupStart].model, 'global-summary');
  assert.equal(summaries[backupStart + 1].model, 'backup-summary');
  await shot('compaction-backup-active-en-day');
  releaseSummary = true; await finished(backupSession);
  assert.match(JSON.stringify(regular.at(-1).input), /COMPACTED_CONTEXT/);
  assert.match(JSON.stringify(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(backupSession.id)})`)), /OLD_HISTORY_MARKER/);
  passed.push('Backup compaction model saves in settings, primary HTTP503 switches with visible progress, preserves originals and resumes');
  const both = await evaluate(`window.mingshen.createSession({...${JSON.stringify(fixture.config)},title:'Both summaries fail'})`);
  await send('Page.reload'); await revealSessions(8);
  await start(both, 'CASE:both Investigation.'); await finished(both);
  backupFailure = true;
  await start(both, 'Continue CASE:both safely.'); await finished(both);
  const error = await evaluate("document.querySelector('.context-notice--error').textContent");
  assert.match(error, /Fixture compaction unavailable/); assert.match(error, /Backup compaction unavailable/);
  assert.match(JSON.stringify(regular.at(-1).input), /OLD_HISTORY_MARKER/);
  passed.push('Both compaction failures retain separate error details and original context without a partial checkpoint');

  failSummary = false; backupFailure = false;
  for (const [mode, title] of [['independent', 'Independent output budget recovery'], ['cached', 'Cached output budget recovery']]) {
    const recoveredSession = await evaluate(`window.mingshen.createSession({...${JSON.stringify(fixture.config)},title:${JSON.stringify(title)},compactionModel:${mode === 'cached' ? "{mode:'current',providerId:null,modelId:null}" : "{mode:'default',providerId:null,modelId:null}"}})`);
    await send('Page.reload'); await revealSessions(mode === 'independent' ? 9 : 10);
    await start(recoveredSession, `CASE:budget${mode} Investigation.`); await finished(recoveredSession);
    const requestStart = summaries.length;
    outputLimitMode = mode; outputLimitIssued = false;
    await start(recoveredSession, `Continue CASE:budget${mode} with all original constraints.`);
    await finished(recoveredSession);
    assert.equal(outputLimitIssued, true);
    const attempts = summaries.slice(requestStart);
    assert.ok(attempts.length >= 3, 'A truncated prefix is replaced by multiple smaller complete fragments');
    assert.equal(attempts[0].tool_choice === 'none', mode === 'cached');
    assert.ok(attempts.slice(1).every(request => !request.tools?.length && !request.tool_choice), 'Recovery uses tool-free history fragments');
    const compacted = JSON.stringify(regular.at(-1).input);
    assert.match(compacted, /COMPACTED_CONTEXT/);
    assert.doesNotMatch(compacted, /DISCARDED_INCOMPLETE_SUMMARY/);
    const state = await evaluate('window.mingshen.bootstrap()');
    const context = state.contextStates.find(context => context.sessionId === recoveredSession.id);
    assert.equal(context.state, 'ready');
    assert.ok(context.lastCompactedAt);
    assert.match(JSON.stringify(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(recoveredSession.id)})`)), /OLD_HISTORY_MARKER/);
    outputLimitMode = '';
    passed.push(`${mode} compactor uses the dynamic 15% output cap, requests a shorter summary after max_output_tokens, completes every smaller history fragment and preserves originals`);
  }

  console.log(JSON.stringify({ passed, compactionRequests: summaries.length, modelRequests: regular.length, screenshots }, null, 2));
  await evaluate('void window.mingshen.desktopAction("quit");true').catch(() => {});
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(3000)]);
} finally {
  releaseSummary = true;
  renderer?.close(); main?.close();
  if (child && child.exitCode === null) child.kill();
  server.closeAllConnections(); await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
