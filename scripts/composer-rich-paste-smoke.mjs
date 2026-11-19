import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { experimentalExecutable } from './experimental-executable.mjs';

// Paste events carry synthetic data; native insertText supplies browser editing
// and undo without reading or writing the normal Windows clipboard.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-composer-format-'));
const project = resolve(temporary, 'project');
const profile = resolve(temporary, 'profile');
const captures = resolve('.impeccable/review/composer-rich-paste');
const passed = [], errors = [], crashes = [], requests = [], capturesList = [], measurements = [];
const networkAttempts = [], serverErrors = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const labels = {
  edit: ['\u7f16\u8f91\u539f\u6587', 'Edit source'],
  preview: ['\u683c\u5f0f\u9884\u89c8', 'Formatted preview'],
  setting: ['\u7c98\u8d34\u65f6\u663e\u793a Markdown \u548c\u516c\u5f0f\u683c\u5f0f', 'Render Markdown and math on paste'],
};
const richSource = [
  '## \u516c\u5f0f\u4e0e Markdown',
  '',
  '**\u91cd\u70b9** and *emphasis*, inline $x^2+1$ and \\(\\alpha+\\beta\\).',
  '',
  '$$',
  '\\int_0^1 x^2\\,dx=\\frac{1}{3}',
  '$$',
  '',
  '- \u7b2c\u4e00\u9879',
  '- Second item',
  '',
  '| Value | Formula |',
  '| --- | --- |',
  '| Radius | $r^2$ |',
  '',
  '```tex',
  '\\frac{literal}{code}',
  '```',
  '',
  'SOURCE_TAIL_3b95',
].join('\n');
const rawWithSpacing = '  **Retain interior**\n\n    exact spaces\n\n\\[a^2+b^2=c^2\\]\n\nSOURCE_SEND_TAIL_61d0  ';
let child, main, renderer, fixture;
const result = failure => ({
  version, passed, requests: requests.map(({ model, input }) => ({ model, input })),
  errors, crashes, serverErrors, networkAttempts, measurements, screenshots: capturesList,
  pasteMethod: 'Synthetic ClipboardEvent with DataTransfer text followed synchronously by browser document.execCommand(insertText). Native typing, undo, redo, selection and IME use CDP. No system clipboard access.',
  limitations: 'Synthetic paste dispatch tests the application handler and browser input path, not a real OS clipboard gesture. Chromium composition is emulated; physical IME, assistive technology and all DPI/GPU combinations are untested.',
  ...(failure ? { failure: failure.stack || String(failure) } : {}),
});

const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST', `Unexpected renderer/media request: ${request.url}`);
    assert.match(request.url, /^\/v1\/responses$/);
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const title = (body.instructions || '').includes('\u4f1a\u8bdd\u6807\u9898\u751f\u6210');
    if (!title) requests.push(body);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: title ? 'Composer format fixture' : 'Synthetic composer request received.' })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 200, output_tokens: 30, total_tokens: 230 } } })}\n\n`,
    );
  } catch (cause) {
    serverErrors.push(cause.stack || String(cause));
    if (!response.headersSent) response.writeHead(500);
    response.end('Synthetic fixture failed');
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
  for (let i = 0; i < 180; i++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(value => value.json()))
        .find(item => item.webSocketDebuggerUrl && (!page || item.type === 'page'));
      if (target) break;
    } catch {}
    await sleep(80);
  }
  assert.ok(target, `Missing debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (page && message.method === 'Runtime.exceptionThrown')
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (page && message.method === 'Inspector.targetCrashed') crashes.push(message.params || {});
    if (page && message.method === 'Network.requestWillBeSent' && /^https?:/i.test(message.params.request.url))
      networkAttempts.push(message.params.request.url);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const output = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (output.exceptionDetails) throw new Error(output.exceptionDetails.exception?.description || output.exceptionDetails.text);
    return output.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

async function until(expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await renderer.evaluate(expression)) return; }
    catch (cause) { if (!/context|navigat|destroyed|reload/i.test(String(cause))) throw cause; }
    await sleep(60);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(selector) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return Boolean(e&&!e.disabled&&e.getClientRects().length)})()`);
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
}

async function key(name, code, virtualKey, modifiers = 0, text) {
  await renderer.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers,
    ...(text !== undefined ? { text, unmodifiedText: text } : name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
  });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
}

const formatButton = kind => labels[kind].map(label => `.composer-format-switch button[aria-label=${JSON.stringify(label)}]`).join(',');
const value = () => renderer.evaluate('document.querySelector(".composer > textarea").value');
const previewVisible = 'Boolean(document.querySelector(".composer-preview")?.getClientRects().length)';

async function edit() {
  if (await renderer.evaluate(previewVisible)) await click(formatButton('edit'));
  await until('(()=>{const e=document.querySelector(".composer > textarea");return Boolean(e&&!e.disabled&&e.getClientRects().length)})()');
  await renderer.evaluate('document.querySelector(".composer > textarea").focus({preventScroll:true});true');
}

async function clear() {
  await edit();
  await renderer.evaluate('document.querySelector(".composer > textarea").select();true');
  await key('Backspace', 'Backspace', 8);
  await until('document.querySelector(".composer > textarea").value===""');
}

async function paste(text, { target = '.composer > textarea', start, end } = {}) {
  const state = await renderer.evaluate(`(()=>{
    const target=document.querySelector(${JSON.stringify(target)});
    if(!target)throw new Error('Missing synthetic paste target');
    target.focus({preventScroll:true});
    if(target instanceof HTMLTextAreaElement&&${start !== undefined})
      target.setSelectionRange(${start ?? 0},${end ?? start ?? 0});
    const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(text)});
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    target.dispatchEvent(event);
    const inserted=!event.defaultPrevented?document.execCommand('insertText',false,${JSON.stringify(text)}):false;
    return {prevented:event.defaultPrevented,inserted};
  })()`);
  assert.equal(state.prevented, false, 'Text paste must retain native insertion');
  assert.equal(state.inserted, true, 'Native synthetic insertText must reach the composer');
}

async function shot(name) {
  await sleep(150);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(captures, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  capturesList.push(path);
}

function record(message) {
  passed.push(message);
  console.log(`PASS ${passed.length}: ${message}`);
}

async function selectFixtureSession() {
  const selected = await renderer.evaluate(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(fixture.sessionId)}`);
  if (selected) return;
  if (await renderer.evaluate('document.querySelector(".sidebar-host")?.hidden'))
    await click('.orbit-workspace-header > button:first-child, .app-topbar button.sidebar-toggle');
  await renderer.evaluate(`(()=>{for(const el of document.querySelectorAll('.session-group__header[aria-expanded=false],.session-group__show-all[aria-expanded=false]'))el.click();return true})()`);
  await click(`[data-session-id="${fixture.sessionId}"] .session-row`);
}

async function presentation(style, locale, theme, width, height) {
  await renderer.evaluate(`(async()=>{
    await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:${JSON.stringify(style)}});
  })()`);
  await renderer.send('Page.reload');
  await until(`Boolean(document.querySelector(".composer > textarea"))&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}`);
  await renderer.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  await selectFixtureSession();
  await until('(()=>{const e=document.querySelector(".composer > textarea");return Boolean(e&&!e.disabled)})()');
  if (width <= 800 && await renderer.evaluate('Boolean(document.querySelector(".workbench-drawer-scrim"))'))
    await click('.workbench-drawer-scrim');
  await sleep(120);
}

async function geometry(label) {
  const data = await renderer.evaluate(`(()=>{
    const names=['.chat-view','.composer-wrap','.composer','.composer-preview','.composer-format-switch','.send-button'];
    return {label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,
      overflow:document.documentElement.scrollWidth>innerWidth+1,
      elements:names.map(selector=>{const e=document.querySelector(selector);if(!e)return{selector,missing:true};
        const r=e.getBoundingClientRect();return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
          width:r.width,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}})};
  })()`);
  measurements.push(data);
  assert.equal(data.overflow, false, label);
  for (const item of data.elements) {
    assert.equal(item.missing, undefined, `${label}: ${item.selector} missing`);
    assert.ok(item.width > 0 && item.height > 0, `${label}: invisible ${JSON.stringify(item)}`);
    assert.ok(item.left >= -1 && item.right <= data.width + 1, `${label}: horizontal overflow ${JSON.stringify(item)}`);
    assert.ok(item.top >= -1 && item.bottom <= data.height + 1, `${label}: vertical overflow ${JSON.stringify(item)}`);
  }
}

async function openAppearance() {
  await click('.app-topbar button[aria-label="\u6253\u5f00\u8bbe\u7f6e"], .app-topbar button[aria-label="Open settings"], .orbit-tool-rail button[data-orbit-action="settings"]');
  await until('Boolean(document.querySelector(".settings-workspace"))');
  const nav = ['\u5916\u89c2\u4e0e\u8bed\u8a00', 'Appearance and language'];
  await renderer.evaluate(`(()=>{const target=[...document.querySelectorAll('.settings-nav__item')].find(e=>${JSON.stringify(nav)}.includes(e.textContent.trim()));if(!target)throw new Error('Missing Appearance settings');target.click();return true})()`);
  await until(`(()=>{const label=[...document.querySelectorAll('.settings-workspace label')].find(e=>${JSON.stringify(labels.setting)}.some(text=>e.textContent.includes(text)));return Boolean(label?.querySelector('input[type=checkbox]'))})()`);
}

async function toggleSetting(checked) {
  await renderer.evaluate(`(()=>{const label=[...document.querySelectorAll('.settings-workspace label')].find(e=>${JSON.stringify(labels.setting)}.some(text=>e.textContent.includes(text)));const checkbox=label.querySelector('input[type=checkbox]');checkbox.scrollIntoView({block:'center'});checkbox.focus({preventScroll:true});window.__composerSettingFocus=checkbox;if(checkbox.checked!==${checked})checkbox.click();return true})()`);
  await until(`window.mingshen.getUiPreferences().then(p=>p.composerRichPaste===${checked})`);
  assert.equal(await renderer.evaluate('document.activeElement===window.__composerSettingFocus'), true,
    'Applying the paste setting must not steal focus from its checkbox');
}

async function closeSettings() {
  await click('.settings-content__header button');
  await until('!document.querySelector(".settings-workspace")');
}

async function sendAndAssert(source) {
  const previous = requests.length;
  await renderer.evaluate('document.querySelector(".composer-preview").focus({preventScroll:true});true');
  await key('Enter', 'Enter', 13);
  await until(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)}).then(messages=>messages.some(message=>message.role==='user'&&message.parts.some(part=>part.type==='text'&&part.text===${JSON.stringify(source.trim())})))`);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(session=>session.status==='idle')`);
  assert.equal(requests.length, previous + 1, 'One Enter must produce exactly one chat request');
  const body = requests.at(-1);
  assert.ok(body.input.some(message => message.role === 'user' &&
    (typeof message.content === 'string' ? message.content === source.trim() :
      Array.isArray(message.content) && message.content.some(part => part.type === 'input_text' && part.text === source.trim()))),
  'Transport must receive exact source including interior whitespace, TeX and Markdown');
  await until('document.querySelector(".composer > textarea").value===""');
  assert.equal(await renderer.evaluate(previewVisible), false);
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(captures, { recursive: true });
  await writeFile(resolve(project, 'fixture.txt'), 'Synthetic rich-paste workspace.\n');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const mainPort = await availablePort();
  let rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(),
    [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`],
    { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__composerFixtureFetch=fetch;globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url??String(input));
    if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return globalThis.__composerFixtureFetch(input,options);
    if(url.pathname.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));
    return Promise.reject(new Error('Nonlocal synthetic fixture network blocked'));
  };true`);
  renderer = await connect(rendererPort, true);
  await renderer.send('Runtime.enable');
  await renderer.send('Inspector.enable');
  await renderer.send('Network.enable');
  await renderer.send('Page.bringToFront');
  await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await main.evaluate(`(()=>{
    const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    const owned=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));
    if(!owned)throw new Error('Missing owned fixture window');
    owned.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},
      (_details,callback)=>callback({cancel:true}));
    return true;
  })()`);
  await until('Boolean(document.querySelector(".policy-consents"))');
  await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog .btn--primary');
  await until('document.querySelector(".policy-dialog")?.textContent.includes("\u5f00\u59cb\u4f7f\u7528")&&!document.querySelector(".policy-consents")');
  await click('.policy-dialog .btn--primary');
  await until('!document.querySelector(".policy-dialog")');
  fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Composer local fixture',
      baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',
      apiKey:'synthetic-composer-only',keyLabel:'Fixture',neverReveal:true});
    const model=await window.mingshen.createModel({providerId:provider.id,modelId:'composer-format-fixture',
      displayName:'Composer fixture',contextWindow:128000,maxOutputTokens:1024,
      inputModalities:['text','image'],toolCalls:true,parallelToolCalls:false,
      reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    const session=await window.mingshen.createSession({title:'Composer format fixture',
      workspacePath:${JSON.stringify(project)},providerId:provider.id,modelId:model.models[0].id,
      permissionMode:'full_access',executionMode:'host',reasoningLevel:null});
    await window.mingshen.setProjectMemoryEnabled(session.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const preferences=await window.mingshen.getUiPreferences(),projects={};
    for(const style of ['simple','orbit']){
      const key=(style==='orbit'?'@orbit:':'')+session.workspacePath.replaceAll('/','\\\\').replace(/\\\\+$/,'').toLowerCase();
      projects[key]={mode:'chat',sidebarWidth:228,inspectorWidth:360,sidebarOpen:true,inspectorOpen:false};
    }
    await window.mingshen.saveUiPreferences({...preferences,defaultLayout:'chat',projects});
    return {sessionId:session.id};
  })()`);
  assert.equal((await renderer.evaluate('window.mingshen.getUiPreferences()')).composerRichPaste, true);
  await presentation('simple', 'zh-CN', 'night', 1440, 900);
  await paste(richSource);
  await until(previewVisible);
  assert.equal(await value(), richSource);
  const structure = await renderer.evaluate(`(()=>{
    const p=document.querySelector('.composer-preview');
    return {heading:p.querySelector('h2')?.textContent,strong:p.querySelector('strong')?.textContent,
      math:p.querySelectorAll('.katex').length,table:!!p.querySelector('table'),list:!!p.querySelector('ul'),
      code:p.querySelector('pre code')?.textContent,textareaHidden:document.querySelector('.composer > textarea').hidden};
  })()`);
  assert.equal(structure.heading, '\u516c\u5f0f\u4e0e Markdown');
  assert.equal(structure.strong, '\u91cd\u70b9');
  assert.ok(structure.math >= 3);
  assert.equal(structure.table, true);
  assert.equal(structure.list, true);
  assert.ok(structure.code.includes('\\frac{literal}{code}'));
  assert.equal(structure.textareaHidden, true);
  await geometry('simple-zh-night-1440');
  await shot('simple-zh-night-1440');
  record('A paste automatically replaces raw syntax in the composer with Markdown, table, code and KaTeX while retaining exact source');

  await renderer.evaluate('document.querySelector(".composer-preview").focus();true');
  await key('Escape', 'Escape', 27);
  await until('document.activeElement===document.querySelector(".composer > textarea")&&!document.querySelector(".composer > textarea").hidden');
  assert.equal(await value(), richSource);
  await click(formatButton('preview'));
  await until(previewVisible);
  await renderer.evaluate('document.querySelector(".composer-preview").focus();true');
  await key('q', 'KeyQ', 81, 0, 'q');
  await until('!document.querySelector(".composer > textarea").hidden&&document.activeElement===document.querySelector(".composer > textarea")');
  assert.ok((await value()).includes('q'));
  await clear();
  await renderer.send('Input.insertText', { text: 'Prefix KEEP suffix' });
  await paste('**Replacement** $x^2$', { start: 7, end: 11 });
  await until(previewVisible);
  assert.equal(await value(), 'Prefix **Replacement** $x^2$ suffix');
  await renderer.evaluate('document.querySelector(".composer-preview").focus();true');
  await key('z', 'KeyZ', 90, 2);
  await until('document.querySelector(".composer > textarea").value==="Prefix KEEP suffix"');
  await key('y', 'KeyY', 89, 2);
  await until('document.querySelector(".composer > textarea").value==="Prefix **Replacement** $x^2$ suffix"');
  record('Edit/preview, Escape, native typing and selection replacement retain the browser undo/redo history');

  await clear();
  await paste(richSource);
  await until(previewVisible);
  await renderer.evaluate('document.querySelector(".composer-preview").focus();true');
  await key('a', 'KeyA', 65, 2);
  await until('document.activeElement===document.querySelector(".composer > textarea")&&!document.querySelector(".composer > textarea").hidden');
  assert.deepEqual(await renderer.evaluate('(()=>{const t=document.querySelector(".composer > textarea");return[t.selectionStart,t.selectionEnd,t.value.length]})()'),
    [0, richSource.length, richSource.length]);
  assert.ok((await renderer.evaluate('window.getSelection()?.toString()??""')).length <= richSource.length,
    'Ctrl+A from the draft must not select the application document');
  await click(formatButton('preview'));
  await until(previewVisible);
  const contextPoint = await renderer.evaluate('(()=>{const r=document.querySelector(".composer-preview").getBoundingClientRect();return{x:r.right-20,y:r.top+18}})()');
  await renderer.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...contextPoint, button: 'right', clickCount: 1 });
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...contextPoint, button: 'right', clickCount: 1 });
  await until('Boolean(document.querySelector(".composer-edit-menu"))');
  assert.equal(await renderer.evaluate('document.querySelector(".composer > textarea").hidden'), false);
  assert.equal(await renderer.evaluate('document.querySelector(".composer > textarea").selectionStart===document.querySelector(".composer > textarea").selectionEnd'),
    true, 'Preview context-menu must not reuse an invisible source selection');
  const commands = await renderer.evaluate('[...document.querySelectorAll(".composer-edit-menu button")].map(e=>e.textContent.trim())');
  assert.deepEqual(commands, ['\u526a\u5207', '\u590d\u5236', '\u7c98\u8d34', '\u5168\u9009']);
  await shot('preview-context-menu-zh-night');
  // Select-all touches only this editor's selection; Copy/Cut are left untouched
  // because their native implementation accesses the system clipboard.
  await renderer.evaluate(`(()=>{const button=[...document.querySelectorAll('.composer-edit-menu button')].find(e=>e.textContent.trim()==='\u5168\u9009');button.click();return true})()`);
  await until('!document.querySelector(".composer-edit-menu")');
  await until('document.querySelector(".composer > textarea").selectionStart===0&&document.querySelector(".composer > textarea").selectionEnd===document.querySelector(".composer > textarea").value.length');
  assert.equal(await value(), richSource);
  record('Ctrl+A stays within the draft, and preview right-click opens the existing themed native editor menu with Select all');

  await click(formatButton('preview'));
  await until(previewVisible);
  await renderer.evaluate('document.querySelector(".composer-preview").focus();true');
  // The preview handles the first Ctrl+X only as a transition to source; native
  // cut is prevented, so this does not access the normal Windows clipboard.
  await key('x', 'KeyX', 88, 2);
  await until('!document.querySelector(".composer > textarea").hidden&&document.activeElement===document.querySelector(".composer > textarea")');
  assert.equal(await value(), richSource,
    'The first Ctrl+X from preview must not delete the retained invisible source selection');
  for (const kind of ['empty', 'unsupported-html']) {
    await clear();
    await paste('**Retained draft** $r$');
    await until(previewVisible);
    const after = await renderer.evaluate(`(()=>{
      const preview=document.querySelector('.composer-preview');preview.focus();
      const data=new DataTransfer();
      if(${JSON.stringify(kind)}==='unsupported-html')data.setData('text/html','<b>Synthetic HTML-only clipboard</b>');
      const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
      preview.dispatchEvent(event);
      const inserted=document.execCommand('insertText',false,' normal typing');
      const field=document.querySelector('.composer > textarea');
      return {prevented:event.defaultPrevented,inserted,value:field.value,hidden:field.hidden,
        previewVisible:Boolean(document.querySelector('.composer-preview')?.getClientRects().length)};
    })()`);
    assert.equal(after.prevented, false, `${kind}: unsupported text paste must not fabricate insertion`);
    assert.equal(after.inserted, true);
    assert.equal(after.value, '**Retained draft** $r$ normal typing');
    assert.equal(after.hidden, false, `${kind}: normal typing must remain editable source`);
    assert.equal(after.previewVisible, false, `${kind}: no stale paste flag may trigger preview`);
  }
  record('Preview Ctrl+X changes to source without cutting; empty and unsupported paste do not turn later ordinary typing into a formatted paste');

  await clear();
  await renderer.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
  await renderer.send('Input.insertText', { text: '\u4e2d\u6587\u8f93\u5165' });
  await until('document.querySelector(".composer > textarea").value==="\u4e2d\u6587\u8f93\u5165"');
  assert.equal(await renderer.evaluate(previewVisible), false);
  await clear();
  await paste('**First** $x$');
  await until(previewVisible);
  await paste('\n\n**Second** $y$', { target: '.composer-preview' });
  await until(previewVisible);
  assert.equal(await value(), '**First** $x$\n\n**Second** $y$');
  record('Emulated Chinese composition commits in source mode and a further paste from preview reaches the retained native editor');

  await clear();
  await paste(rawWithSpacing);
  await until(previewVisible);
  await sendAndAssert(rawWithSpacing);
  record('Enter from preview sends one request with exact Markdown/LaTeX source and interior whitespace, then clears the draft');

  await paste(richSource);
  await until(previewVisible);
  await openAppearance();
  await toggleSetting(false);
  await shot('setting-off-zh-night');
  await closeSettings();
  assert.equal(await value(), richSource);
  assert.equal(await renderer.evaluate(previewVisible), false);
  await clear();
  await paste(richSource);
  assert.equal(await renderer.evaluate(previewVisible), false);
  assert.equal(await value(), richSource);
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer > textarea"))');
  await selectFixtureSession();
  assert.equal((await renderer.evaluate('window.mingshen.getUiPreferences()')).composerRichPaste, false);
  await paste(richSource);
  assert.equal(await renderer.evaluate(previewVisible), false);
  await openAppearance();
  await toggleSetting(true);
  await closeSettings();
  await clear();
  await paste(richSource);
  await until(previewVisible);
  record('Appearance toggle applies to the existing draft immediately, disables automatic rendering, persists across reload and can be re-enabled');

  await clear();
  const payload = [
    '**Sanitized draft** $x^2$',
    '<img src="https://example.invalid/composer-preview-forbidden.png" onerror="window.__composerUnsafe=1">',
    '<style>body{display:none}</style><script>window.__composerUnsafe=2</script>',
    '<input autofocus><button onclick="window.__composerUnsafe=3">Do not activate</button>',
    '[External](https://example.invalid/composer-preview-forbidden) [Local](C:/composer-preview-forbidden.txt)',
  ].join('\n\n');
  await paste(payload);
  await until(previewVisible);
  const safe = await renderer.evaluate(`(()=>{
    const preview=document.querySelector('.composer-preview');
    return {active:preview.querySelectorAll('img,iframe,object,embed,video,audio,source,style,script,input,button,textarea,select,form').length,
      style:preview.querySelectorAll('[style]').length,
      links:preview.querySelectorAll('a[href]').length,unsafe:window.__composerUnsafe??null};
  })()`);
  assert.equal(safe.active, 0, JSON.stringify(safe));
  assert.equal(safe.links, 0, JSON.stringify(safe));
  assert.equal(safe.unsafe, null);
  await sleep(150);
  assert.equal(networkAttempts.filter(url => url.includes('composer-preview-forbidden')).length, 0);
  assert.equal(await value(), payload);
  await clear();
  await paste('**Malformed formula**\n\n$$\\notAValidMacro{\\frac{1}{ $$');
  await until(previewVisible);
  assert.ok((await value()).includes('\\notAValidMacro'));
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".composer-preview .katex-error"))'), true);
  record('Pasted HTML has no active controls, media requests, styles, scripts or navigable links; malformed math remains recoverable with its source');

  await clear();
  const large = `**Large draft**\n\n${'a'.repeat(30000)}\nLARGE_SOURCE_TAIL_c4a9`;
  const started = Date.now();
  await paste(large);
  await until('!document.querySelector(".composer > textarea").hidden');
  assert.equal(await value(), large);
  assert.equal(await renderer.evaluate(previewVisible), false);
  assert.ok(Date.now() - started < 5000, 'A text-budget fallback must not stall the renderer');
  await clear();
  await paste('**Image paste retains this draft** $z$');
  await until(previewVisible);
  const imagePaste = await renderer.evaluate(`(()=>{
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aen8AAAAASUVORK5CYII='),v=>v.charCodeAt(0));
    const data=new DataTransfer();data.items.add(new File([bytes],'synthetic.png',{type:'image/png'}));
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    document.querySelector('.composer-preview').dispatchEvent(event);return event.defaultPrevented;
  })()`);
  assert.equal(imagePaste, true);
  await until('document.querySelectorAll(".draft-attachment").length===1');
  assert.equal(await value(), '**Image paste retains this draft** $z$');
  await click('.draft-attachment button');
  await until('document.querySelectorAll(".draft-attachment").length===0');
  record('Oversized text degrades to an exact editable source without stalling; image paste remains an attachment without replacing the text');
  await clear();

  for (const [style, locale, theme, width, height] of [
    ['simple', 'en', 'day', 1040, 680],
    ['simple', 'zh-CN', 'day', 800, 680],
    ['orbit', 'zh-CN', 'night', 1440, 900],
    ['orbit', 'en', 'day', 1040, 680],
    ['orbit', 'zh-CN', 'day', 800, 680],
  ]) {
    await presentation(style, locale, theme, width, height);
    await paste(richSource);
    await until(previewVisible);
    const label = `${style}-${locale}-${theme}-${width}`;
    await geometry(label);
    await shot(label);
    assert.equal(await renderer.evaluate(`Boolean(document.querySelector(${JSON.stringify(formatButton('edit'))}))`), true);
    assert.equal(await value(), richSource);
    await edit();
    assert.equal(await value(), richSource);
    await click(formatButton('preview'));
    await until(previewVisible);
    await clear();
  }
  record('Both interface styles render, edit and preview in Chinese/night and English/day at 1440, 1040 and 800 pixels without shifting controls out of the window');

  assert.deepEqual(errors, []);
  assert.deepEqual(crashes, []);
  assert.deepEqual(serverErrors, []);
  assert.equal(requests.length, 1);
  assert.equal((await renderer.evaluate('window.mingshen.getAppInfo()')).version, version);
  record('All checks use the unchanged application version, one local chat request, no renderer exceptions and no renderer crashes');
  await writeFile(resolve(captures, 'result.json'), JSON.stringify(result(), null, 2));
  console.log(JSON.stringify({ version, passed, screenshots: capturesList.length, measurements: measurements.length,
    requests: requests.length, errors, crashes, resultPath: resolve(captures, 'result.json') }, null, 2));
} catch (cause) {
  if (renderer) await shot('failure').catch(() => {});
  await writeFile(resolve(captures, 'result.json'), JSON.stringify(result(cause), null, 2)).catch(() => {});
  console.error(JSON.stringify(result(cause), null, 2));
  throw cause;
} finally {
  if (child) {
    const current = child;
    const ended = current.exitCode !== null || current.signalCode !== null ? Promise.resolve() : new Promise(done => current.once('exit', done));
    await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
    renderer?.close();
    main?.close();
    await Promise.race([ended, sleep(7000)]);
    if (current.exitCode === null && current.signalCode === null) {
      current.kill();
      await Promise.race([ended, sleep(7000)]);
    }
    assert.ok(current.exitCode !== null || current.signalCode !== null, 'Owned fixture Electron must exit');
  }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  const root = resolve(tmpdir()) + sep;
  if (!temporary.startsWith(root) || !temporary.slice(root.length).startsWith('mingshen-composer-format-'))
    throw new Error('Unsafe rich-paste smoke cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
