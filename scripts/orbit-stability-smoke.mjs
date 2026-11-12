import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { crc32 } from 'node:zlib';

// Historical data and UI failure events belong only to this temporary profile.
// This exercises rendering, not compaction/backend error handling.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const baseline = process.argv.includes('--baseline');
const phase = baseline ? 'baseline' : 'final';
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-orbit-stability-'));
const profile = resolve(temporary, 'profile');
const project = resolve(temporary, 'project');
const captures = resolve('.impeccable/review/orbit-stability', phase);
const passed = [], exceptions = [], crashes = [], serverErrors = [], requests = [];
const measurements = [], benchmarks = [], screenshots = [], layoutIssues = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const toolCount = 180;
const argumentCharacters = 8192;
const outputCharacters = 16384;
const streamChunks = 80;
const inputSamples = 8;
const toolSelector = '.orbit-execution-records .tool-call';
const groupSelector = '.orbit-execution-records';
const errorTail = 'ORBIT_COMPLETE_CONTEXT_ERROR_TAIL_78b4';
const savedErrorTail = 'ORBIT_COMPLETE_SAVED_ERROR_TAIL_94b2';
const toolOutputTail = 'ORBIT_COMPLETE_TOOL_OUTPUT_TAIL_63c5';
const contextError = [
  'CONTEXT_FAILURE_START',
  'Model request failed. HTTP 503. Local synthetic provider returned a diagnostic.',
  ...Array.from({ length: 75 }, (_, i) => `Complete diagnostic line ${i + 1}: retain the original information.`),
  `LONG_UNBROKEN_DIAGNOSTIC_${'abcdefgh01234567'.repeat(700)}`,
  '', errorTail,
].join('\n');
const savedError = `${contextError}\n${savedErrorTail}`;
const fixtureArguments = JSON.stringify({
  path: 'images/synthetic-layout-check.png',
  note: 'Preserved complete synthetic argument. '.repeat(250).slice(0, argumentCharacters),
});
const fixtureOutput = `${'Preserved complete synthetic output.\n'.repeat(550).slice(0, outputCharacters)}\n${toolOutputTail}`;
const pixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aen8AAAAASUVORK5CYII=', 'base64');
pixelPng.writeUInt32BE(crc32(pixelPng.subarray(37, 52)), 52);
const imageComment = Buffer.from(`Comment\0${'A'.repeat(1536 * 1024)}`);
const imageChunk = Buffer.alloc(imageComment.length + 12);
imageChunk.writeUInt32BE(imageComment.length, 0);
imageChunk.write('tEXt', 4, 'ascii');
imageComment.copy(imageChunk, 8);
imageChunk.writeUInt32BE(crc32(imageChunk.subarray(4, imageChunk.length - 4)), imageChunk.length - 4);
const imageData = `data:image/png;base64,${Buffer.concat([pixelPng.subarray(0, -12), imageChunk, pixelPng.subarray(-12)]).toString('base64')}`;
let child, main, renderer, fixture, streamStarted = false;
let streamRelease;
const streamGate = new Promise(done => { streamRelease = done; });
const result = () => ({
  version, phase, baseline,
  fixture: { toolCount, argumentCharacters, outputCharacters, imageDataCharacters: imageData.length, streamChunks, inputSamples },
  scope: 'Synthetic historical image data supplies a large-field history workload only; final image-field equality, image decoding and real vision provider quality are not tested.',
  passed, requests, exceptions, crashes, serverErrors, layoutIssues, measurements, benchmarks, screenshots,
});

function completed(response, text) {
  if (response.destroyed) return;
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (text) response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`);
  response.end(`data: ${JSON.stringify({ type: 'response.completed', response: {
    status: 'completed',
    usage: { input_tokens: 6000, output_tokens: 800, total_tokens: 6800 },
  } })}\n\n`);
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if ((body.instructions || '').includes('会话标题生成')) {
      completed(response, 'Synthetic orbit stability');
      return;
    }
    requests.push({ sequence: requests.length + 1, model: body.model });
    assert.equal(body.model, 'orbit-stability-fixture');
    streamStarted = true;
    await streamGate;
    if (response.destroyed) return;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < streamChunks; i++) {
      if (response.destroyed) return;
      const delta = `Streaming sample ${i + 1}: stable layout while composing and reading details.\n\n`;
      response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`);
      await sleep(22);
    }
    response.end(`data: ${JSON.stringify({ type: 'response.completed', response: {
      status: 'completed',
      usage: { input_tokens: 6000, output_tokens: 800, total_tokens: 6800 },
    } })}\n\n`);
  } catch (cause) {
    serverErrors.push(cause.stack || String(cause));
    if (!response.destroyed) response.destroy();
  }
});

async function availablePort() {
  const probe = createPortServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  return port;
}

async function connect(port, page = false) {
  let target;
  for (let index = 0; index < 160; index++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(value => value.json()))
        .find(item => item.webSocketDebuggerUrl && (!page || item.type === 'page'));
      if (target) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (page && value.method === 'Runtime.exceptionThrown')
      exceptions.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    if (page && value.method === 'Inspector.targetCrashed') crashes.push(value.params || {});
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id);
    clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

async function until(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await renderer.evaluate(expression)) return; }
    catch (cause) { if (!/context|navigat|reload|destroyed/i.test(String(cause))) throw cause; }
    await sleep(70);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(selector) {
  await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return Boolean(el&&!el.disabled&&el.getBoundingClientRect().width>0)})()`);
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
}

async function key(name, code, windowsVirtualKeyCode, modifiers = 0) {
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode, modifiers,
    ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode, modifiers });
}

async function shot(name) {
  await sleep(180);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(captures, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  screenshots.push(path);
}

function record(message) {
  passed.push(message);
  console.log(`PASS ${passed.length}: ${message}`);
}

async function selectSession() {
  if (await renderer.evaluate('document.querySelector(".sidebar-host")?.hidden'))
    await click('.orbit-workspace-header > button:first-child, .app-topbar button.sidebar-toggle');
  await renderer.evaluate(`(()=>{for(const el of document.querySelectorAll('.session-group__header[aria-expanded=false],.session-group__show-all[aria-expanded=false]'))el.click();return true})()`);
  await click(`[data-session-id="${fixture.sessionId}"] .session-row`);
  await until(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(fixture.sessionId)}`);
}

async function injectContextError() {
  const context = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(fixture.sessionId)})`);
  await main.evaluate(`(()=>{
    const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    const window=BrowserWindow.getAllWindows().find(value=>value.webContents.getURL().includes('index.html'));
    if(!window)throw new Error('Missing owned fixture window');
    window.webContents.send('runtime:event',{type:'context_updated',context:{
      ...${JSON.stringify(context)},sessionId:${JSON.stringify(fixture.sessionId)},
      runId:'orbit-stability-context',state:'failed',usedTokens:6000,contextWindow:10000000,
      source:'estimate',lastCompactedAt:null,error:${JSON.stringify(contextError)},updatedAt:new Date().toISOString()
    }});
    return true;
  })()`);
  await until('Boolean(document.querySelector(".context-notice--error"))');
}

async function presentation(style, locale, theme, width, height) {
  await renderer.evaluate(`(async()=>{
    await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:${JSON.stringify(style)}});
  })()`);
  await renderer.send('Page.reload');
  await until(`Boolean(document.querySelector(".composer textarea"))&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}`);
  await renderer.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  await selectSession();
  await injectContextError();
  await sleep(180);
}

async function geometry(label) {
  const data = await renderer.evaluate(`(()=>{
    const rect=el=>{
      if(!el)return null;
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
        clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,scrollLeft:el.scrollLeft,
        clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop,
        gridColumns:s.gridTemplateColumns,gridRows:s.gridTemplateRows,minWidth:s.minWidth,
        overflowX:s.overflowX,overflowY:s.overflowY,transform:s.transform};
    };
    const selectors=['.app-body','.chat-view','.conversation-viewport','.conversation-scroll','.conversation','.composer-wrap','.composer'];
    return {width:innerWidth,height:innerHeight,documentScrollWidth:document.documentElement.scrollWidth,
      contextOpen:Boolean(document.querySelector('.context-notice--error')?.open),
      nodes:Object.fromEntries(selectors.map(selector=>[selector,rect(document.querySelector(selector))]))};
  })()`);
  measurements.push({ label, ...data });
  const issues = [];
  const chat = data.nodes['.chat-view'];
  if (!chat || chat.width < 100 || chat.left < -1 || chat.right > data.width + 1 || chat.bottom > data.height + 1)
    issues.push({ label, selector: '.chat-view', reason: 'outside viewport', node: chat });
  for (const selector of ['.conversation-viewport', '.conversation-scroll', '.conversation', '.composer-wrap', '.composer']) {
    const node = data.nodes[selector];
    if (!node || node.width < 20) { issues.push({ label, selector, reason: 'missing or collapsed', node }); continue; }
    if (node.left < chat.left - 1 || node.right > chat.right + 1)
      issues.push({ label, selector, reason: 'outside chat', node });
    if (node.scrollWidth > node.clientWidth + 2)
      issues.push({ label, selector, reason: 'horizontal overflow', node });
    if (Math.abs(node.scrollLeft) > 1) issues.push({ label, selector, reason: 'horizontally scrolled', node });
  }
  const composer = data.nodes['.composer'];
  if (!data.contextOpen && composer && (composer.top < chat.top - 1 || composer.bottom > chat.bottom + 1))
    issues.push({ label, selector: '.composer', reason: 'composer outside chat vertically', node: composer });
  if (data.contextOpen) {
    const wrap = data.nodes['.composer-wrap'];
    if (wrap && (wrap.top < chat.top - 1 || wrap.bottom > chat.bottom + 1))
      issues.push({ label, selector: '.composer-wrap', reason: 'open context wrapper outside chat vertically', node: wrap });
    if (composer && wrap && (composer.top < wrap.top - 1 || composer.bottom > wrap.bottom + 1)) {
      if (!['auto', 'scroll'].includes(wrap.overflowY))
        issues.push({ label, selector: '.composer-wrap', reason: 'hidden composer has no user vertical scroller', node: wrap });
      const reached = await renderer.evaluate(`(async()=>{
        const wrap=document.querySelector('.composer-wrap'),history=document.querySelector('.conversation-scroll');
        const previous=wrap.scrollTop,historyTop=history?.scrollTop;
        try{
          wrap.scrollTop=wrap.scrollHeight;
          await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
          const c=document.querySelector('.composer').getBoundingClientRect(),w=wrap.getBoundingClientRect();
          return {top:c.top,bottom:c.bottom,wrapTop:w.top,wrapBottom:w.bottom,
            scrollTop:wrap.scrollTop,historyPreserved:history?.scrollTop===historyTop};
        }finally{wrap.scrollTop=previous}
      })()`);
      measurements.push({ label: `${label}-composer-reachability`, ...reached });
      if (reached.top < reached.wrapTop - 1 || reached.bottom > reached.wrapBottom + 1 || !reached.historyPreserved)
        issues.push({ label, selector: '.composer', reason: 'open context composer unreachable by wrapper scrolling', node: reached });
    }
  }
  layoutIssues.push(...issues);
  if (!baseline) assert.deepEqual(issues, [], `${label}: chat geometry must remain constrained`);
  return data;
}

async function nativeToggle(selector, open) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  if (await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).open`) !== open) {
    await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector(':scope > summary').focus({preventScroll:true});true`);
    await key('Enter', 'Enter', 13);
  }
  await until(`document.querySelector(${JSON.stringify(selector)})?.open===${open}`);
  if (selector.includes('expandable-text') || selector.includes('notice') || selector.includes('message-error'))
    await until(`Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('.expandable-text__body pre'))===${open}`);
  await renderer.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
}

async function detailCycles(label, loops = 4) {
  const selector = '.context-notice--error';
  for (let i = 0; i < loops; i++) {
    await nativeToggle(selector, true);
    const text = await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector('pre').textContent`);
    assert.equal(text, contextError, 'Expanded context error must preserve the complete original text');
    await geometry(`${label}-open-${i + 1}`);
    await nativeToggle(selector, false);
    await geometry(`${label}-closed-${i + 1}`);
  }
}

async function toolDisclosure(label) {
  const closedBodies = await renderer.evaluate(`document.querySelectorAll('.tool-call:not([open]) .tool-call__body').length`);
  measurements.push({ label: `${label}-closed-tool-bodies`, count: closedBodies });
  if (!baseline) assert.equal(closedBodies, 0, 'Closed tool records must not mount the full arguments/output body');
  await renderer.evaluate(`document.querySelector(${JSON.stringify(toolSelector)}).querySelector(':scope > summary').scrollIntoView({block:'center',inline:'nearest'});true`);
  await nativeToggle(toolSelector, true);
  await until(`Boolean(document.querySelector(${JSON.stringify(toolSelector)})?.querySelector('.tool-call__body pre'))`);
  const detail = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(toolSelector)});
    return [...el.querySelectorAll('.tool-call__body pre')].map(pre=>pre.textContent);
  })()`);
  assert.deepEqual(JSON.parse(detail[0]), JSON.parse(fixtureArguments), 'Expanded tool arguments remain complete');
  assert.equal(detail.at(-1), fixtureOutput, 'Expanded tool output remains complete');
  await nativeToggle(toolSelector, false);
  if (!baseline)
    await until(`!document.querySelector(${JSON.stringify(toolSelector)})?.querySelector('.tool-call__body')`);
  await nativeToggle(groupSelector, false);
  await nativeToggle(groupSelector, true);
  await nativeToggle(toolSelector, true);
  await until(`document.querySelector(${JSON.stringify(toolSelector)})?.querySelector('.tool-call__body')?.textContent.includes(${JSON.stringify(toolOutputTail)})`);
  await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(toolSelector)});
    const pre=[...el.querySelectorAll('.tool-call__body pre')].at(-1);
    pre.scrollTop=Math.min(60,pre.scrollHeight-pre.clientHeight);
    window.__orbitOpenTool={element:el,pre,scrollTop:pre.scrollTop};
    return true;
  })()`);
  measurements.push({ label: `${label}-tool-open`, ...(await renderer.evaluate(`(()=>{
    const state=window.__orbitOpenTool;
    return {scrollTop:state.pre.scrollTop,scrollHeight:state.pre.scrollHeight,clientHeight:state.pre.clientHeight,
      argumentCharacters:state.element.querySelector('pre').textContent.length,outputCharacters:state.pre.textContent.length};
  })()`)) });
}

async function assertOpenToolPreserved() {
  const state = await renderer.evaluate(`(()=>{
    const previous=window.__orbitOpenTool,element=document.querySelector(${JSON.stringify(toolSelector)});
    const pre=[...element.querySelectorAll('.tool-call__body pre')].at(-1);
    return {sameElement:element===previous.element,samePre:pre===previous.pre,open:element.open,
      scrollTop:pre?.scrollTop,previousTop:previous.scrollTop,complete:pre?.textContent.includes(${JSON.stringify(toolOutputTail)})};
  })()`);
  measurements.push({ label: 'stream-open-tool-preserved', ...state });
  assert.equal(state.sameElement, true, 'Live updates must preserve the open tool element');
  assert.equal(state.samePre, true, 'Live updates must preserve the open output node');
  assert.equal(state.open, true, 'Live updates must retain the user-opened tool record');
  assert.equal(state.complete, true);
  assert.ok(Math.abs(state.scrollTop - state.previousTop) <= 1, 'Live updates must preserve the internal output reading position');
}

async function historicalUpdates() {
  const english = JSON.parse(await readFile('apps/desktop/src/renderer/src/i18n/en.json', 'utf8'));
  for (const [locale, status] of [['en', english['完成']], ['zh-CN', '完成']]) {
    await click('.desktop-caption__actions button[aria-label="中文 / English"]');
    await until(`document.documentElement.lang===${JSON.stringify(locale)}`);
    await until(`document.querySelector(${JSON.stringify(toolSelector)})?.querySelector('.orbit-execution-state')?.textContent===${JSON.stringify(status)}`);
  }
  for (const isError of [true, false]) {
    for (const hasResult of [false, true]) {
    await main.evaluate(`(()=>{
      const path=${JSON.stringify(resolve(profile, 'mingshen.db'))};
      if(!path.startsWith(${JSON.stringify(temporary + sep)}))throw new Error('Unsafe fixture database path');
      const db=new(process.getBuiltinModule('node:sqlite').DatabaseSync)(path);
      let message;
      try{
        const seq=db.prepare('select coalesce(max(seq),0)+1 as seq from messages where session_id=?').get(${JSON.stringify(fixture.sessionId)}).seq;
        message={id:'orbit-status-update-'+${JSON.stringify(`${isError}-${hasResult}`)},sessionId:${JSON.stringify(fixture.sessionId)},seq,
          role:${JSON.stringify(hasResult ? 'tool' : 'assistant')},
          parts:${JSON.stringify(hasResult
            ? [{ type: 'tool_result', callId: `orbit-live-status-${isError}`, output: fixtureOutput, isError }]
            : [{ type: 'tool_call', callId: `orbit-live-status-${isError}`, name: 'view_image', arguments: fixtureArguments, status: 'requested' }])},
          createdAt:new Date().toISOString()};
        db.prepare('insert into messages(id,session_id,seq,role,parts_json,created_at) values(?,?,?,?,?,?)')
          .run(message.id,message.sessionId,message.seq,message.role,JSON.stringify(message.parts),message.createdAt);
      }finally{db.close()}
      const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
      const window=BrowserWindow.getAllWindows().find(value=>value.webContents.getURL().includes('index.html'));
      if(!window)throw new Error('Missing owned fixture window');
      window.webContents.send('runtime:event',{type:'assistant_message',sessionId:message.sessionId,
        runId:'orbit-fixture-status',message});
      return true;
    })()`);
    await until(`(()=>{const row=[...document.querySelectorAll(${JSON.stringify(toolSelector)})].at(-1);
      return row?.dataset.status===${JSON.stringify(hasResult ? (isError ? 'failed' : 'completed') : 'requested')}
        &&row.querySelector('.orbit-execution-state')?.textContent===${JSON.stringify(hasResult ? (isError ? '失败' : '完成') : '已请求')};})()`);
    }
  }
  record('Historical tool labels switch language immediately and arriving failed/completed tool results refresh their requested rows');
}

async function counters() {
  const [performance, dom, heap] = await Promise.all([
    renderer.send('Performance.getMetrics'),
    renderer.send('Memory.getDOMCounters'),
    renderer.send('Runtime.getHeapUsage'),
  ]);
  return {
    performance: Object.fromEntries(performance.metrics.map(item => [item.name, item.value])),
    dom, heap,
  };
}

async function startBenchmark() {
  await renderer.send('HeapProfiler.collectGarbage');
  const before = await counters();
  await renderer.evaluate(`(()=>{
    window.__orbitBenchmark?.observer?.disconnect();
    const state=window.__orbitBenchmark={started:performance.now(),inputs:[],longTasks:[],frames:[],active:true};
    if(PerformanceObserver.supportedEntryTypes.includes('longtask')){
      state.observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries())state.longTasks.push({start:entry.startTime,duration:entry.duration});
      });
      state.observer.observe({type:'longtask'});
    }
    const field=document.querySelector('.composer textarea');
    state.inputListener=()=>{
      const started=performance.now();
      requestAnimationFrame(()=>requestAnimationFrame(()=>state.inputs.push(performance.now()-started)));
    };
    field.addEventListener('input',state.inputListener);
    let previous=performance.now();
    const frame=now=>{
      if(!state.active)return;
      state.frames.push(now-previous);previous=now;requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return true;
  })()`);
  return before;
}

async function stopBenchmark(label, before) {
  await sleep(200);
  const timing = await renderer.evaluate(`(()=>{
    const state=window.__orbitBenchmark;
    state.active=false;
    state.observer?.disconnect();
    document.querySelector('.composer textarea').removeEventListener('input',state.inputListener);
    const values=state.inputs.slice().sort((a,b)=>a-b),frames=state.frames.slice().sort((a,b)=>a-b);
    const percentile=(items,p)=>items.length?items[Math.min(items.length-1,Math.floor(items.length*p))]:null;
    return {duration:performance.now()-state.started,inputLatency:state.inputs,
      inputP50:percentile(values,.5),inputP95:percentile(values,.95),
      frameP95:percentile(frames,.95),maxFrame:frames.at(-1),longTasks:state.longTasks,
      longTaskTotal:state.longTasks.reduce((sum,item)=>sum+item.duration,0),
      toolRows:document.querySelectorAll('.tool-call,.orbit-execution-step').length,
      toolBodies:document.querySelectorAll('.tool-call__body,.orbit-execution-step .expandable-text__body').length};
  })()`);
  const after = await counters();
  const delta = {};
  for (const name of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'])
    delta[name] = after.performance[name] - before.performance[name];
  const data = { label, timing, before, after, delta };
  benchmarks.push(data);
  assert.equal(timing.inputLatency.length, inputSamples, `${label}: all native input events must reach a rendered frame`);
  if (!baseline) {
    assert.ok(timing.inputP95 < 1500, `${label}: composer stalls for more than 1.5 seconds`);
    assert.ok(timing.maxFrame < 4000, `${label}: renderer stalls for more than 4 seconds`);
  }
  console.log(`BENCHMARK ${label}: input P95 ${timing.inputP95.toFixed(1)}ms; script ${(delta.ScriptDuration * 1000).toFixed(1)}ms; ${timing.longTasks.length} long tasks`);
}

async function typeSamples() {
  await renderer.evaluate('document.querySelector(".composer textarea").focus({preventScroll:true});true');
  for (let i = 0; i < inputSamples; i++) {
    await renderer.send('Input.insertText', { text: String.fromCharCode(97 + i) });
    await renderer.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    await sleep(35);
  }
}

async function clearComposer() {
  await renderer.evaluate('document.querySelector(".composer textarea").focus({preventScroll:true});true');
  await key('a', 'KeyA', 65, 2);
  await key('Backspace', 'Backspace', 8);
  await until('document.querySelector(".composer textarea").value===""');
}

async function seedHistory() {
  const messages = [];
  for (let turn = 0; turn < 6; turn++) {
    messages.push({ id: `orbit-user-${turn}`, role: 'user', parts: [
      { type: 'text', text: `Synthetic work turn ${turn + 1}: inspect generated images and preserve all error details.` },
    ] });
    messages.push({ id: `orbit-answer-${turn}`, role: 'assistant', parts: [
      { type: 'text', text: `### Synthetic inspection ${turn + 1}\n\n${'Saved historical explanation with a short `code` token and a file reference.\n\n'.repeat(12)}\n\`\`\`js\nconst stable = true;\nconsole.log(stable);\n\`\`\`` },
    ] });
    for (let i = 0; i < toolCount / 6; i++) {
      const index = turn * (toolCount / 6) + i;
      const callId = `orbit-view-${index}`;
      messages.push({ id: `orbit-call-${index}`, role: 'assistant', parts: [
        { type: 'tool_call', callId, name: 'view_image', arguments: fixtureArguments, status: 'completed' },
      ] });
      messages.push({ id: `orbit-result-${index}`, role: 'tool', parts: [
        { type: 'tool_result', callId, output: fixtureOutput, isError: false,
          ...(index === 0 ? { images: [{ mimeType: 'image/png', dataUrl: imageData }] } : {}) },
      ] });
    }
  }
  messages.push({ id: 'orbit-saved-failure', role: 'assistant', parts: [{ type: 'error', message: savedError }] });
  await main.evaluate(`(()=>{
    const path=${JSON.stringify(resolve(profile, 'mingshen.db'))};
    if(!path.startsWith(${JSON.stringify(temporary + sep)}))throw new Error('Unsafe fixture database path');
    const db=new(process.getBuiltinModule('node:sqlite').DatabaseSync)(path);
    try{
      db.exec('begin immediate');
      const insert=db.prepare('insert into messages(id,session_id,seq,role,parts_json,created_at) values(?,?,?,?,?,?)');
      let seq=0;
      for(const message of ${JSON.stringify(messages)}){
        insert.run(message.id,${JSON.stringify(fixture.sessionId)},++seq,message.role,JSON.stringify(message.parts),
          new Date(Date.UTC(2026,10,10,0,0,seq)).toISOString());
      }
      db.exec('commit');
      return {messages:seq};
    }finally{db.close()}
  })()`);
  return messages.length;
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(captures, { recursive: true });
  await writeFile(resolve(project, 'inspection.txt'), 'Synthetic stability workspace.\n');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const mainPort = await availablePort();
  let rendererPort = await availablePort();
  while (mainPort === rendererPort) rendererPort = await availablePort();
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),
    [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`],
    { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__orbitStabilityFetch=fetch;globalThis.fetch=(url,options)=>
    String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__orbitStabilityFetch(url,options);true`);
  renderer = await connect(rendererPort, true);
  await renderer.send('Runtime.enable');
  await renderer.send('Inspector.enable');
  await renderer.send('Performance.enable');
  await renderer.send('Page.bringToFront');
  await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await until('Boolean(document.querySelector(".policy-consents"))');
  await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await click('.policy-dialog .btn--primary');
  await until('document.querySelector(".policy-dialog")?.textContent.includes("开始使用")&&!document.querySelector(".policy-consents")');
  await click('.policy-dialog .btn--primary');
  await until('!document.querySelector(".policy-dialog")');
  fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Orbit stability local fixture',
      baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',
      apiKey:'local-orbit-stability-only',keyLabel:'Fixture',neverReveal:true});
    const p=await window.mingshen.createModel({providerId:provider.id,modelId:'orbit-stability-fixture',
      contextWindow:10000000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,
      reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    const session=await window.mingshen.createSession({title:'Synthetic orbit stability',
      workspacePath:${JSON.stringify(project)},providerId:provider.id,modelId:p.models[0].id,
      permissionMode:'full_access',executionMode:'host',reasoningLevel:null});
    await window.mingshen.setProjectMemoryEnabled(session.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const projects={};
    for(const style of ['simple','orbit']){
      const key=(style==='orbit'?'@orbit:':'')+session.workspacePath.replaceAll('/','\\\\').replace(/\\\\+$/,'').toLowerCase();
      projects[key]={mode:'chat',sidebarWidth:228,inspectorWidth:360,sidebarOpen:true,inspectorOpen:false};
    }
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),
      interfaceStyle:'orbit',defaultLayout:'chat',projects});
    return {sessionId:session.id};
  })()`);
  const messageCount = await seedHistory();
  await presentation('orbit', 'zh-CN', 'night', 1440, 900);
  await until(`document.querySelectorAll('.orbit-execution-step').length===${toolCount}`);
  await until('document.querySelector(".message-error")?.textContent.includes("CONTEXT_FAILURE_START")');
  record(`Seeded ${messageCount} synthetic historical messages with ${toolCount} view_image calls and complete errors`);

  await geometry('orbit-1440-initial-closed');
  await shot('orbit-1440-initial-closed');
  const idleBefore = await startBenchmark();
  await typeSamples();
  await stopBenchmark('orbit-1440-idle-typing', idleBefore);
  await clearComposer();
  await detailCycles('orbit-1440', 4);
  await shot('orbit-1440-after-four-detail-cycles');
  record('Repeated native Enter expansion/collapse preserves complete context error text and measures every chat boundary');

  await toolDisclosure('orbit-1440');
  await shot('orbit-1440-tool-open');
  record('Tool details preserve complete arguments/output after native disclosure and execution-group collapse/reopen');

  // A real local SSE stream supplies live updates over the exact same seeded history.
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.sessionId)},text:'Stream the synthetic stability observations.'})`);
  for (let i = 0; i < 200 && !streamStarted; i++) await sleep(50);
  assert.equal(streamStarted, true, 'The local model must receive a real request');
  const streamBefore = await startBenchmark();
  streamRelease();
  await typeSamples();
  await until(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)}).then(messages=>
    messages.some(message=>message.parts.some(part=>part.type==='text'&&part.text.includes('Streaming sample ${streamChunks}:'))))`, 60000);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(session=>session.status==='idle')`, 60000);
  await stopBenchmark('orbit-1440-streaming-typing', streamBefore);
  await assertOpenToolPreserved();
  await clearComposer();
  await nativeToggle(toolSelector, false);
  if (!baseline)
    await until(`!document.querySelector(${JSON.stringify(toolSelector)})?.querySelector('.tool-call__body')`);
  await historicalUpdates();
  await injectContextError();
  await geometry('orbit-1440-after-stream');
  record(`${streamChunks} real SSE updates and ${inputSamples} native composer inputs complete without losing output`);

  for (const [style, locale, theme, width, height] of [
    ['orbit', 'zh-CN', 'night', 2048, 1280],
    ['orbit', 'en', 'day', 1040, 680],
    ['orbit', 'zh-CN', 'night', 800, 680],
    ['simple', 'zh-CN', 'night', 1440, 900],
    ['simple', 'en', 'day', 1040, 680],
  ]) {
    const label = `${style}-${locale}-${theme}-${width}`;
    await presentation(style, locale, theme, width, height);
    if (style === 'orbit' && width === 800) {
      if (await renderer.evaluate('!document.querySelector(".sidebar-host")?.hidden'))
        await click('.orbit-workspace-header > button[aria-expanded="true"]');
      await until('document.querySelector(".sidebar-host")?.hidden&&!document.querySelector(".workbench-drawer-scrim")');
      await renderer.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    }
    await geometry(`${label}-closed`);
    await detailCycles(label, 2);
    await nativeToggle('.context-notice--error', true);
    await shot(`${label}-context-open`);
    await nativeToggle('.context-notice--error', false);
    await shot(`${label}-context-closed`);
    record(`${label}: reload, long history and repeated complete error disclosure remain usable`);
  }
  await presentation('orbit', 'zh-CN', 'night', 1440, 900);
  const history = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)})`);
  assert.equal(history.flatMap(message => message.parts).filter(part => part.type === 'tool_call').length, toolCount + 2);
  assert.equal(history.find(message => message.id === 'orbit-result-179').parts[0].output, fixtureOutput);
  assert.equal(history.find(message => message.id === 'orbit-saved-failure').parts[0].message, savedError);
  assert.deepEqual(exceptions, []);
  assert.deepEqual(crashes, []);
  assert.deepEqual(serverErrors, []);
  if (baseline) console.log(`BASELINE observed ${layoutIssues.length} constrained-layout failures; retained for before/after comparison`);
  else assert.equal(layoutIssues.length, 0);
  record('Historical tool-call count and the specified saved output and error remain unchanged after all UI operations');
  await writeFile(resolve(captures, 'result.json'), JSON.stringify(result(), null, 2));
  console.log(JSON.stringify({ version, phase, passed, layoutIssues: layoutIssues.length,
    measurements: measurements.length, benchmarks: benchmarks.length, screenshots: screenshots.length,
    exceptions, crashes, resultPath: resolve(captures, 'result.json') }, null, 2));
} catch (cause) {
  if (renderer) await shot('failure').catch(() => {});
  await writeFile(resolve(captures, 'result.json'), JSON.stringify({ ...result(), failure: cause.stack || String(cause) }, null, 2)).catch(() => {});
  console.error(JSON.stringify({ ...result(), measurements: measurements.slice(-3), failure: String(cause) }, null, 2));
  throw cause;
} finally {
  streamRelease();
  if (child) {
    const current = child, exited = current.exitCode !== null ? Promise.resolve() : new Promise(done => current.once('exit', done));
    await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
    renderer?.close();
    main?.close();
    await Promise.race([exited, sleep(7000)]);
    if (current.exitCode === null) { current.kill(); await exited; }
  }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  const root = resolve(tmpdir()) + sep;
  if (!temporary.startsWith(root) || !temporary.slice(root.length).startsWith('mingshen-orbit-stability-'))
    throw new Error('Unsafe orbit stability cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
