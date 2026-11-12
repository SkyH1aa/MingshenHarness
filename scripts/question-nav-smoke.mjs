import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-question-nav-'));
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const errors = [];
let child, renderer, main, responseStream;
const server = createServer(async (request, response) => {
  for await (const _chunk of request) {}
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  responseStream = response;
  response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Streaming answer for navigation verification.\n\n'.repeat(30) })}\n\n`);
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
    if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    const waiter = pending.get(value.id);
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
async function key(key, code, extra = {}) {
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}), ...extra });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, ...extra });
}
async function hover(index) {
  const center = await renderer.evaluate(`(()=>{const r=document.querySelectorAll('.question-nav__marker')[${index}].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center });
  await until('Boolean(document.querySelector(".question-nav__preview"))');
}
async function clickMarker(index) {
  await renderer.evaluate(`document.querySelectorAll('.question-nav__marker')[${index}].click();true`);
  await sleep(120);
}
async function shot(name) {
  const image = await renderer.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}
const metrics = () => renderer.evaluate('(()=>{const el=document.querySelector(".conversation-scroll");return {top:el.scrollTop,gap:el.scrollHeight-el.clientHeight-el.scrollTop}})()');
async function seed(sessionId, count, start = 0) {
  const messages = [];
  for (let index = start; index < start + count; index++) {
    const text = index === 0 ? 'PS C:\\Users\\Ming> package-win.cmd\n请检查打包失败原因，保留错误信息和现有目录。' : index === 1 ? '<img src=x onerror="window.__unsafePreview=true">\n' + 'Long untrusted text '.repeat(80) : `历史问题 ${index + 1}：定位与修复第 ${index + 1} 个问题\n请阅读之前的代码，完成相关检查。`;
    messages.push({ id: `fixture-user-${index}`, role: 'user', parts: index === 2 ? [{ type: 'attachment', attachment: { name: 'notes.txt', kind: 'file', size: 4, mimeType: 'text/plain', dataUrl: 'data:text/plain;base64,dGVzdA==' } }] : [{ type: 'text', text }] });
    messages.push({ id: `fixture-assistant-${index}`, role: 'assistant', parts: [{ type: 'text', text: `### 第 ${index + 1} 轮检查结果\n\n` + '已检查相关实现，记录执行过程并保留必要的文件引用。\n\n'.repeat(7) }] });
  }
  await main.evaluate(`(()=>{const db=new (process.getBuiltinModule('node:sqlite').DatabaseSync)(${JSON.stringify(resolve(profile, 'mingshen.db'))});const insert=db.prepare('insert into messages(id,session_id,seq,role,parts_json,created_at) values(?,?,?,?,?,?)');let seq=Number(db.prepare('select coalesce(max(seq),0) as seq from messages where session_id=?').get(${JSON.stringify(sessionId)}).seq);for(const m of ${JSON.stringify(messages)})insert.run(m.id,${JSON.stringify(sessionId)},++seq,m.role,JSON.stringify(m.parts),new Date().toISOString());db.close();return true})()`);
}

try {
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9356', '.', '--remote-debugging-port=9355'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9356);
  await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  renderer = await connect(9355); await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))'); await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await until('[...document.querySelectorAll(".policy-dialog button")].some(el=>el.textContent.trim()==="同意并继续"&&!el.disabled)');
  await renderer.evaluate('[...document.querySelectorAll(".policy-dialog button")].find(el=>el.textContent.trim()==="同意并继续").click();true');
  await until('[...document.querySelectorAll(".policy-dialog button")].some(el=>el.textContent.trim()==="开始使用"&&!el.disabled)');
  await renderer.evaluate('[...document.querySelectorAll(".policy-dialog button")].find(el=>el.textContent.trim()==="开始使用").click();true');
  await until('!document.querySelector(".policy-dialog")');
  const fixture = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Local navigation fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-fixture-key',keyLabel:'Local',neverReveal:true});
    const result=await window.mingshen.createModel({providerId:p.id,modelId:'nav-fixture',contextWindow:200000,maxOutputTokens:8192,inputModalities:['text','file'],toolCalls:false,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const config={providerId:p.id,modelId:result.models[0].id,workspacePath:null,permissionMode:'request_approval',reasoningLevel:null};
    const other=await window.mingshen.createSession({...config,title:'Empty conversation'});
    const active=await window.mingshen.createSession({...config,title:'Question navigation'});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    return {active,other};})()`);
  await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".conversation-empty"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".question-nav"))'), false);
  passed.push('An empty conversation has no navigation rail');
  await seed(fixture.active.id, 1);
  await renderer.send('Page.reload');
  await until('document.querySelectorAll(".message--user").length===1');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".question-nav"))'), false);
  passed.push('A single-question conversation stays uncluttered without a redundant rail');
  await seed(fixture.active.id, 17, 1);
  await renderer.send('Page.reload');
  await until('document.querySelectorAll(".question-nav__marker").length===18');
  await renderer.evaluate(`window.__navEvents=[];for(const name of ['resize','blur','focus'])window.addEventListener(name,()=>window.__navEvents.push(name));for(const name of ['pointerenter','pointerleave','focusin','focusout','scroll'])document.querySelector('.question-nav').addEventListener(name,event=>window.__navEvents.push(name+':'+event.target.className),true);true`);
  await until('document.querySelector(".question-nav__marker[aria-current]")?.getAttribute("aria-controls")==="message-fixture-user-17"');
  await hover(0);
  const preview = await renderer.evaluate('document.querySelector(".question-nav__preview").innerText');
  assert.match(preview, /PS C:\\Users\\Ming/); assert.match(preview, /请检查打包失败原因/);
  await shot('question-nav-zh-night');
  passed.push('Each sent user message gets one marker; the latest is active initially and real hover previews its question');
  await clickMarker(0);
  assert.equal(await renderer.evaluate('document.querySelector(".question-nav__marker[aria-current]").getAttribute("aria-controls")'), 'message-fixture-user-0');
  const alignment = await renderer.evaluate('document.querySelector("#message-fixture-user-0").getBoundingClientRect().top-document.querySelector(".conversation-scroll").getBoundingClientRect().top');
  assert.ok(alignment >= 0 && alignment <= 24, `Question not aligned: ${alignment}`);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".question-nav__preview"))'), false);
  passed.push('Clicking the first marker jumps to the original question and updates the reading marker');

  await hover(1); assert.equal(await renderer.evaluate('Boolean(document.querySelector(".question-nav__preview img"))||Boolean(window.__unsafePreview)'), false);
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 70 });
  await until('!document.querySelector(".question-nav__preview")');
  await hover(2); assert.match(await renderer.evaluate('document.querySelector(".question-nav__preview").textContent'), /notes.txt/);
  passed.push('Preview treats HTML as plain text, truncates long content and supports attachment-only questions');

  await renderer.evaluate('document.querySelectorAll(".question-nav__marker")[0].focus({preventScroll:true});true');
  await key('ArrowDown', 'ArrowDown');
  assert.equal(await renderer.evaluate('document.activeElement.getAttribute("aria-controls")'), 'message-fixture-user-1');
  await key('Escape', 'Escape', { windowsVirtualKeyCode: 27 }); await until('!document.querySelector(".question-nav__preview")');
  await key('End', 'End'); await key('Enter', 'Enter', { windowsVirtualKeyCode: 13 });
  await until('document.querySelector(".question-nav__marker[aria-current]")?.getAttribute("aria-controls")==="message-fixture-user-17"');
  passed.push('Keyboard arrows/Home/End select markers, Escape dismisses preview and Enter jumps');

  await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop=0;true');
  await until('document.querySelector(".question-nav__marker[aria-current]")?.getAttribute("aria-controls")==="message-fixture-user-0"');
  await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop=document.querySelector(".conversation-scroll").scrollHeight;true');
  await until('document.querySelector(".question-nav__marker[aria-current]")?.getAttribute("aria-controls")==="message-fixture-user-17"');
  passed.push('Ordinary conversation scrolling updates the active marker in both directions');

  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.active.id)},text:'New question while navigating history'})`);
  await until('document.querySelectorAll(".question-nav__marker").length===19 && Boolean(document.querySelector(".message--streaming"))');
  await clickMarker(4); const before = await metrics();
  await until('document.querySelectorAll(".chat-scroll-controls button").length===1');
  responseStream.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '\nMORE_STREAM_CONTENT\n' + 'Later streamed paragraph.\n\n'.repeat(20) })}\n\n`);
  await until('document.querySelector(".message--streaming")?.textContent.includes("MORE_STREAM_CONTENT")'); await sleep(200);
  assert.ok(Math.abs((await metrics()).top - before.top) <= 2);
  responseStream.write(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 300, total_tokens: 400 } } })}\n\n`); responseStream.end();
  await until('!document.querySelector(".message--streaming")'); assert.ok((await metrics()).gap > 100);
  passed.push('New questions appear live; jumping to history pauses following through later streaming and completion');

  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate(`document.querySelector('.desktop-caption__actions button[aria-label="中文 / English"]').click();document.documentElement.dataset.theme='day';true`);
  await sleep(350);
  await hover(3);
  assert.match(await renderer.evaluate('document.querySelector(".question-nav__preview").innerText'), /Question 4 \/ 19/);
  const layout = await renderer.evaluate('(()=>{const p=document.querySelector(".question-nav__preview").getBoundingClientRect(),r=document.querySelector(".question-nav").getBoundingClientRect(),c=document.querySelector(".composer-wrap").getBoundingClientRect(),body=document.querySelector(".conversation").getBoundingClientRect();return {p:{top:p.top,bottom:p.bottom,left:p.left,right:p.right},rail:r.right,content:body.right,bottom:r.bottom,composer:c.top,w:innerWidth,h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()');
  assert.ok(layout.p.top >= 0 && layout.p.bottom <= layout.h && layout.p.left >= 0 && layout.p.right <= layout.w && !layout.overflow);
  assert.ok(layout.bottom <= layout.composer && layout.content < layout.rail - 20);
  const controls = await renderer.evaluate('(()=>{const a=document.querySelector(".chat-scroll-controls").getBoundingClientRect(),r=document.querySelector(".question-nav").getBoundingClientRect(),c=document.querySelector(".composer-wrap").getBoundingClientRect(),text=document.querySelector(".conversation").getBoundingClientRect();return {left:a.left,top:a.top,textRight:text.right,railBottom:r.bottom,bottom:a.bottom,composerTop:c.top}})()');
  assert.ok(controls.left >= controls.textRight+2 && controls.top >= controls.railBottom+8 && controls.bottom < controls.composerTop, JSON.stringify(controls));
  await renderer.evaluate('document.querySelectorAll(".question-nav__marker")[3].focus({preventScroll:true});true');
  await shot('question-nav-en-day-compact');
  passed.push('English/day compact layout keeps previews inside the viewport and markers clear of text/composer');

  await renderer.send('Emulation.clearDeviceMetricsOverride');
  await sleep(350);
  await renderer.evaluate(`document.querySelector('.app-topbar button[aria-label="Open workspace"]').click();true`);
  await until('Boolean(document.querySelector(".workspace-panel"))');
  const dock = await renderer.evaluate('(()=>{const rail=document.querySelector(".question-nav").getBoundingClientRect(),panel=document.querySelector(".workspace-panel").getBoundingClientRect(),button=document.querySelector(".chat-scroll-controls button").getBoundingClientRect(),text=document.querySelector(".conversation").getBoundingClientRect();return {railRight:rail.right,panelLeft:panel.left,buttonLeft:button.left,buttonRight:button.right,textRight:text.right}})()');
  assert.ok(dock.railRight <= dock.panelLeft && dock.buttonRight <= dock.panelLeft && dock.buttonLeft >= dock.textRight+2, JSON.stringify(dock));
  await renderer.evaluate(`document.querySelector('.app-topbar button[aria-label="Open workspace"]').click();true`);
  passed.push('Opening the right workspace dock does not place navigation over that panel');

  await renderer.evaluate('[...document.querySelectorAll(".session-row__title")].find(el=>el.textContent==="Empty conversation").click();true');
  await until('!document.querySelector(".question-nav")');
  await renderer.evaluate('[...document.querySelectorAll(".session-row__title")].find(el=>el.textContent==="Question navigation").click();true');
  await until('document.querySelectorAll(".question-nav__marker").length===19');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".question-nav__preview"))'), false);
  passed.push('Switching conversations resets previews and uses only the selected conversation history');

  await seed(fixture.active.id, 100, 18);
  await renderer.send('Page.reload');
  await until('document.querySelectorAll(".question-nav__marker").length===119');
  await renderer.evaluate('document.querySelectorAll(".question-nav__marker")[118].focus({preventScroll:true});true');
  await key('Home', 'Home'); await sleep(120);
  assert.equal(await renderer.evaluate('document.activeElement.getAttribute("aria-controls")'), 'message-fixture-user-0');
  assert.ok(await renderer.evaluate('document.querySelector(".question-nav__rail").scrollTop < 10'));
  await key('End', 'End'); await sleep(120);
  assert.ok(await renderer.evaluate('document.querySelector(".question-nav__rail").scrollTop>0'));
  const railBefore = await renderer.evaluate('(()=>{const rail=document.querySelector(".question-nav__rail"),r=rail.getBoundingClientRect();return {top:rail.scrollTop,x:r.x+r.width/2,y:r.y+r.height/2,chat:document.querySelector(".conversation-scroll").scrollTop}})()');
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: railBefore.x, y: railBefore.y, deltaX: 0, deltaY: -200 });
  await until(`document.querySelector('.question-nav__rail').scrollTop<${railBefore.top - 50}`);
  assert.ok(Math.abs((await metrics()).top - railBefore.chat) <= 2);
  passed.push('Mouse-wheel scrolling over a long rail moves its markers without moving the conversation');
  const history = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.active.id)})`);
  await renderer.evaluate(`window.mingshen.rewriteAndSendChat({sessionId:${JSON.stringify(fixture.active.id)},messageId:'fixture-user-3',text:'Edited question: supersede later history'})`);
  await until('document.querySelectorAll(".question-nav__marker").length===4');
  assert.ok(!(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.active.id)})`)).some(m => m.id === 'fixture-user-4'));
  await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(fixture.active.id)})`);
  assert.ok(history.length > 200);
  passed.push('119-question history remains navigable; editing an earlier question removes obsolete markers with its replaced history');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, screenshots }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ passed, ui: await renderer?.evaluate('(()=>{const marker=document.querySelector(".question-nav__marker"),r=marker?.getBoundingClientRect();return {focus:document.activeElement?.outerHTML,active:document.querySelector(".question-nav__marker[aria-current]")?.outerHTML,scroll:document.querySelector(".conversation-scroll")?.scrollTop,preview:document.querySelector(".question-nav__preview")?.textContent,events:window.__navEvents?.slice(-35),marker:r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,400)}:null}})()').catch(() => null) }, null, 2));
  if(renderer)await shot('question-nav-failure').catch(()=>{});
  throw error;
} finally {
  if (renderer) await renderer.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close(); main?.close();
  if (child && child.exitCode === null) {
    await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
    if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  }
  server.closeAllConnections(); await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
