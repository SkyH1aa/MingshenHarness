import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-chat-scroll-'));
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const errors = [];
let responseStream;
let child;
let renderer;
let main;
let line = 0;
const text = count => Array.from({ length: count }, () => `Output ${++line}: Inspect the earlier reasoning while later content continues to arrive.\n\n`).join('');
const event = value => {
  assert.ok(responseStream && !responseStream.destroyed, 'The local stream must be open');
  responseStream.write(`data: ${JSON.stringify(value)}\n\n`);
};
const append = count => event({ type: 'response.output_text.delta', delta: text(count) });
const server = createServer(async (request, response) => {
  for await (const _chunk of request) {}
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  responseStream = response;
  event({ type: 'response.reasoning_summary_text.delta', delta: 'Initial reasoning summary. This earlier evidence should remain readable while the response grows.\n'.repeat(8) });
  append(36);
});

async function connect(port) {
  let target;
  for (let index = 0; index < 100; index++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(result => result.json())).find(item => item.webSocketDebuggerUrl); if (target) break; } catch {}
    await sleep(100);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const handler = pending.get(message.id);
    if (handler) { pending.delete(message.id); clearTimeout(handler.timer); message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve: done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`${expression.slice(0, 180)}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

try {
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9346', '.', '--remote-debugging-port=9340'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9346);
  await main.evaluate('globalThis.__fetch = fetch; globalThis.fetch = (url,options) => String(url).includes("/rest/v1/rpc/") ? Promise.resolve(Response.json([])) : globalThis.__fetch(url,options); true');
  renderer = await connect(9340);
  const { send, evaluate } = renderer;
  await send('Runtime.enable');
  const until = async (expression, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(60); }
    throw new Error(`Timed out: ${expression}`);
  };
  const metrics = () => evaluate("(() => {const el=document.querySelector('.conversation-scroll');return {top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight,gap:el.scrollHeight-el.clientHeight-el.scrollTop};})()");
  const atBottom = () => until("(() => {const el=document.querySelector('.conversation-scroll');return el.scrollHeight-el.clientHeight-el.scrollTop<=8;})()");
  const screenshot = async name => { const image = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); };
  const settleScroll = async () => {
    let previous = (await metrics()).top;
    let stable = 0;
    for (let attempt = 0; attempt < 30 && stable < 3; attempt++) {
      await sleep(50);
      const current = (await metrics()).top;
      stable = Math.abs(current - previous) <= 1 ? stable + 1 : 0;
      previous = current;
    }
  };
  const verifyHeld = async (label, count = 10) => {
    await settleScroll();
    const before = await metrics();
    append(count);
    await until(`document.querySelector('.message--streaming')?.textContent.includes('Output ${line}:')`);
    await sleep(180);
    const after = await metrics();
    assert.ok(Math.abs(after.top - before.top) <= 2, `${label}: reading position changed: ${JSON.stringify({ before, after })}`);
    assert.ok(after.gap > 100, `${label}: unexpectedly returned to bottom`);
    passed.push(label);
  };
  await until("Boolean(document.querySelector('.policy-consents'))");
  await evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await until("[...document.querySelectorAll('.policy-dialog button')].some(el=>el.textContent.trim()==='同意并继续'&&!el.disabled)");
  await evaluate("[...document.querySelectorAll('.policy-dialog button')].find(el=>el.textContent.trim()==='同意并继续').click();true");
  await until("[...document.querySelectorAll('.policy-dialog button')].some(el=>el.textContent.trim()==='开始使用'&&!el.disabled)");
  await evaluate("[...document.querySelectorAll('.policy-dialog button')].find(el=>el.textContent.trim()==='开始使用').click();true");
  await until("!document.querySelector('.policy-dialog')");
  const sessions = await evaluate(`(async () => {
    const p=await window.mingshen.createProvider({name:'Scroll fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-dummy',keyLabel:'Fixture',neverReveal:true});
    const model=await window.mingshen.createModel({providerId:p.id,modelId:'scroll-fixture',displayName:'Scroll fixture',contextWindow:128000,maxOutputTokens:16000,inputModalities:['text'],toolCalls:false,parallelToolCalls:false,reasoningLevels:['low'],anthropicNoneBehavior:'disabled'});
    const config={providerId:p.id,modelId:model.models[0].id,workspacePath:null,reasoningLevel:'low',permissionMode:'request_approval'};
    const other=await window.mingshen.createSession({...config,title:'Other conversation'});
    const active=await window.mingshen.createSession({...config,title:'Scroll regression'});
    for(const mcp of await window.mingshen.listMcpServers()) if(mcp.enabled) await window.mingshen.setMcpServerEnabled(mcp.id,false);
    return {active,other};
  })()`);
  await send('Page.reload');
  await until("document.querySelectorAll('.session-row').length===2");
  assert.equal(await evaluate("Boolean(document.querySelector('.chat-scroll-controls'))"), false);
  await evaluate("document.querySelector('.conversation-scroll').dispatchEvent(new WheelEvent('wheel',{deltaY:-80,bubbles:true}));true");
  await sleep(80);
  assert.equal(await evaluate("Boolean(document.querySelector('.chat-scroll-controls'))"), false);
  passed.push('Empty conversations show no unnecessary scroll controls');
  await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(sessions.active.id)},text:'Stream a response to verify reading position.'})`);
  await until("document.querySelector('.message--streaming')?.textContent.includes('Output 36:')");
  await atBottom();
  append(10);
  await until(`document.querySelector('.message--streaming')?.textContent.includes('Output ${line}:')`);
  await atBottom();
  await until("!document.querySelector('.chat-scroll-controls')");
  passed.push('Bottom follows streamed text and reasoning');

  const center = await evaluate("(() => {const r=document.querySelector('.conversation-scroll').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  const readingWidth = await evaluate("document.querySelector('.conversation').getBoundingClientRect().width");
  const beforeWheel = await metrics();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...center, deltaX: 0, deltaY: -600 });
  await until(`document.querySelector('.conversation-scroll').scrollTop < ${beforeWheel.top - 50}`);
  await verifyHeld('Mouse wheel up retains reading position through later output');
  await until("document.querySelectorAll('.chat-scroll-controls button').length===1");
  assert.equal(await evaluate("document.querySelector('.chat-scroll-controls__latest').getAttribute('aria-label')"), '回到底部并恢复自动跟随');
  assert.equal(await evaluate("document.querySelector('.chat-scroll-controls__latest').getAttribute('title')"), '回到底部并恢复自动跟随');
  assert.equal(await evaluate("document.querySelector('.conversation').getBoundingClientRect().width"), readingWidth);
  assert.ok(await evaluate("(()=>{const b=document.querySelector('.chat-scroll-controls button').getBoundingClientRect(),text=document.querySelector('.conversation').getBoundingClientRect(),view=document.querySelector('.conversation-scroll').getBoundingClientRect();return b.left>=text.right+2&&b.right<=view.right-6;})()"));
  passed.push('One labelled side button combines latest/follow, stays outside the reading column and causes no text reflow');
  await screenshot('v126-scroll-button-zh-night');

  const jump = await evaluate("(() => {const r=document.querySelector('.chat-scroll-controls__latest').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...jump, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...jump, button: 'left', clickCount: 1 });
  await atBottom();
  await until("!document.querySelector('.chat-scroll-controls')");
  await settleScroll();
  assert.equal(await evaluate("document.activeElement.className"), 'conversation-scroll');
  append(12);
  await until(`document.querySelector('.message--streaming')?.textContent.includes('Output ${line}:')`);
  await atBottom();
  await until("!document.querySelector('.chat-scroll-controls')");
  passed.push('Clicking the side button reaches the latest message and follows subsequent output immediately');

  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...center, deltaX: 0, deltaY: -350 });
  await until("Boolean(document.querySelector('.chat-scroll-controls__latest'))");
  await verifyHeld('Scrolling up after a button click pauses following again');
  await evaluate("document.querySelector('.chat-scroll-controls__latest').focus({preventScroll:true});true");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await atBottom();
  await until("!document.querySelector('.chat-scroll-controls')");
  assert.equal(await evaluate("document.activeElement.className"), 'conversation-scroll');
  append(8);
  event({ type: 'response.reasoning_summary_text.delta', delta: '\nRESUMED_REASONING: Auto-follow also observes reasoning layout changes.\n'.repeat(6) });
  await until(`document.querySelector('.message--streaming')?.textContent.includes('Output ${line}:') && document.querySelector('.reasoning-block')?.textContent.includes('RESUMED_REASONING')`);
  await atBottom();
  passed.push('Keyboard resume follows later text/reasoning and retains usable focus');

  await evaluate("document.querySelector('.conversation-scroll').scrollTop-=400;true");
  await verifyHeld('Scrolling up after resume pauses again');

  await evaluate("(() => {const el=document.querySelector('.conversation-scroll');el.scrollTop=el.scrollHeight;return true;})()");
  await atBottom();
  // Let the synthetic scroll event restore following before generating more text.
  await settleScroll();
  append(6);
  await until(`document.querySelector('.message--streaming')?.textContent.includes('Output ${line}:')`);
  await atBottom();
  passed.push('Returning to the bottom resumes following');

  await evaluate("document.querySelector('.reasoning-block').open=false;true");
  await settleScroll();
  await atBottom();
  assert.equal(await evaluate("Boolean(document.querySelector('.chat-scroll-controls'))"), false);
  await evaluate("document.querySelector('.reasoning-block').open=true;true");
  await atBottom();
  append(4);
  await until(`document.querySelector('.message--streaming')?.textContent.includes('Output ${line}:')`);
  await atBottom();
  await until("!document.querySelector('.chat-scroll-controls')");
  passed.push('Collapsing and reopening reasoning while at the bottom keeps following enabled');

  await evaluate("document.querySelector('.conversation-scroll').focus();true");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 });
  await until("(() => {const el=document.querySelector('.conversation-scroll');return el.scrollHeight-el.clientHeight-el.scrollTop>100;})()");
  await verifyHeld('Keyboard Page Up pauses following');

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, modifiers: 2 });
  await until("document.querySelector('.conversation-scroll').scrollTop < 10");
  await settleScroll();
  const beforeReasoning = await metrics();
  event({ type: 'response.reasoning_summary_text.delta', delta: '\nADDITIONAL_REASONING: New evidence should not interrupt reading the earlier summary.\n'.repeat(8) });
  await until("document.querySelector('.message--streaming .reasoning-block')?.textContent.includes('ADDITIONAL_REASONING')");
  await sleep(120);
  assert.ok(Math.abs((await metrics()).top - beforeReasoning.top) <= 2);
  await verifyHeld('Reading earlier reasoning stays stable as reasoning and text grow');
  await screenshot('v123-scroll-reasoning-zh-night');

  await evaluate("(() => {const el=document.querySelector('.conversation-scroll');el.scrollTop=el.scrollHeight;return true;})()");
  await atBottom();
  // Direct scroll simulates a scrollbar thumb move without a wheel/key event.
  await evaluate("document.querySelector('.conversation-scroll').scrollTop-=450;true");
  await sleep(120);
  await verifyHeld('Scrollbar-position changes pause following');

  await evaluate("(() => {const el=document.querySelector('.conversation-scroll');el.scrollTop=el.scrollHeight;return true;})()");
  await atBottom();
  append(4);
  await until(`document.querySelector('.message--streaming')?.textContent.includes('Output ${line}:')`);
  await evaluate("(() => {const el=document.querySelector('.conversation-scroll');el.dispatchEvent(new WheelEvent('wheel',{deltaY:-2,bubbles:true}));el.scrollTop-=2;return true;})()");
  await sleep(60);
  await verifyHeld('Small upward gesture cancels pending follow frames');

  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click();document.documentElement.dataset.theme='day';true");
  await sleep(160);
  await verifyHeld('Compact window and language/theme changes retain the paused scroll');
  assert.equal(await evaluate("document.querySelector('.chat-scroll-controls__latest').getAttribute('aria-label')"), 'Jump to latest and resume auto-follow');
  const layout = await evaluate("(() => {const a=document.querySelector('.chat-scroll-controls').getBoundingClientRect(),s=document.querySelector('.conversation-scroll').getBoundingClientRect(),c=document.querySelector('.composer-wrap').getBoundingClientRect(),text=document.querySelector('.conversation').getBoundingClientRect();return {inside:a.left>=s.left&&a.right<=s.right&&a.top>=s.top&&a.bottom<=s.bottom&&a.bottom<c.top,outsideText:a.left>=text.right+2,overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('.chat-scroll-controls button')].map(b=>{const r=b.getBoundingClientRect();return {width:r.width,height:r.height,overflow:b.scrollWidth>b.clientWidth}})};})()");
  assert.ok(layout.inside && layout.outsideText && !layout.overflow && layout.buttons.length===1 && layout.buttons.every(b => b.width>=32 && b.height>=32 && !b.overflow), JSON.stringify(layout));
  passed.push('English/day single side button fits a compact window without covering text or the composer');
  await screenshot('v126-scroll-button-en-day-compact');

  event({ type: 'response.completed', response: { usage: { input_tokens: 20, output_tokens: 500, total_tokens: 520 } } });
  responseStream.end();
  await until("document.querySelector('.run-status')?.textContent.includes('Completed')");
  assert.ok((await metrics()).gap > 100, 'Completion must not jump to the bottom');
  passed.push('Completed response does not pull a reader down');
  await evaluate("document.querySelector('.chat-scroll-controls__latest').click();true");
  await atBottom();
  await until("!document.querySelector('.chat-scroll-controls')");
  passed.push('Completed conversations use the same single button to reach the latest message');
  for (let index=0; index<4; index++) {
    await evaluate("document.querySelector('.conversation-scroll').scrollTop-=350;true");
    await until("Boolean(document.querySelector('.chat-scroll-controls'))");
    await evaluate("[...document.querySelectorAll('.session-row__title')].find(el=>el.textContent==='Other conversation').click();true");
    await until("Boolean(document.querySelector('.conversation-empty')) && !document.querySelector('.chat-scroll-controls')");
    await evaluate("[...document.querySelectorAll('.session-row__title')].find(el=>el.textContent==='Scroll regression').click();true");
    await until("document.querySelectorAll('.message').length>=2");
    await atBottom();
    await until("!document.querySelector('.chat-scroll-controls')");
  }
  passed.push('Opening a conversation still positions its latest messages');
  assert.equal((await evaluate('window.mingshen.getAppInfo()')).version, version);
  assert.ok((await evaluate("window.mingshen.readPolicy('manual','zh-CN')")).includes('保持阅读位置'));
  assert.ok((await evaluate("window.mingshen.readPolicy('manual','zh-CN')")).includes('恢复自动跟随'));
  assert.ok((await evaluate("window.mingshen.readPolicy('changelog','en')")).includes('single down-arrow'));
  assert.ok((await evaluate("window.mingshen.readPolicy('changelog','en')")).includes('Fixed forced scrolling'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, outputParagraphs: line, screenshots }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ passed, errors, ui: await renderer?.evaluate("({selected:document.querySelector('.session-row--selected')?.innerText,empty:Boolean(document.querySelector('.conversation-empty')),messages:document.querySelectorAll('.message').length,controls:document.querySelector('.chat-scroll-controls')?.outerHTML,top:document.querySelector('.conversation-scroll')?.scrollTop,height:document.querySelector('.conversation-scroll')?.scrollHeight,client:document.querySelector('.conversation-scroll')?.clientHeight})").catch(() => null) }, null, 2));
  throw error;
} finally {
  if (renderer) await renderer.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close();
  main?.close();
  if (child && child.exitCode === null) {
    await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
    if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid temporary cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
