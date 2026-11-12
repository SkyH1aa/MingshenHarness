import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-composer-drafts-'));
const project = resolve(temporary, 'project');
const profile = resolve(temporary, 'profile');
const captures = resolve(`.impeccable/review/v${version.replaceAll('.', '')}-composer-drafts`);
const sourceImage = resolve(project, 'draft-source.png');
const sourceFile = resolve(project, 'draft-source.txt');
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aen8AAAAASUVORK5CYII=', 'base64');
const fileBytes = Buffer.from('Synthetic attachment bytes.\nDRAFT_FILE_TAIL_4b21\n', 'utf8');
const newSource = [
  '  ## \u5f85\u53d1\u9001\u8349\u7a3f',
  '',
  '**Keep the original source** and $x^2+1$.',
  '',
  '\\[\\int_0^1 x^2\\,dx=\\frac{1}{3}\\]',
  '',
  '- First item',
  '- Second item',
  '',
  '    keep these interior spaces',
  '',
  'NEW_DRAFT_TAIL_6e41  ',
].join('\n');
let existingSource = '  Existing conversation draft.\n\n\\(a^2+b^2=c^2\\)\nEXISTING_DRAFT_TAIL_0d31  ';
const raceSource = 'DRAFT_DELAYED_ACCEPT_951a';
const newerSource = 'Newer draft while the previous IPC reply is pending.\nNEWER_DRAFT_TAIL_bec7';
const rejectedSource = 'DRAFT_PREACCEPT_REJECT_196c';
const notificationText = 'Recovered notification reply.\nNOTIFICATION_DRAFT_TAIL_831a';
const notificationId = 'draft-notification-fixture-32ed';
const passed = [], requests = [], errors = [], crashes = [], serverErrors = [], networkAttempts = [];
const screenshots = [], measurements = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const previewVisible = 'Boolean(document.querySelector(".composer-preview")?.getClientRects().length)';
const formatButton = kind => ({
  edit: ['\u7f16\u8f91\u539f\u6587', 'Edit source'],
  preview: ['\u683c\u5f0f\u9884\u89c8', 'Formatted preview'],
})[kind].map(label => `.composer-format-switch button[aria-label=${JSON.stringify(label)}]`).join(',');
let child, main, renderer, fixture, launches = 0, normalExits = 0, serverListening = false;

const result = failure => ({
  version, passed, launches, normalExits,
  requests: requests.map(({ model, input }) => ({ model, input })),
  errors, crashes, serverErrors, networkAttempts, measurements, screenshots,
  methods: {
    text: 'CDP Input.insertText and synthetic ClipboardEvent/DataTransfer followed synchronously by browser insertText; no system clipboard access.',
    files: 'CDP DOM.setFileInputFiles selects two real files in the owned temporary workspace; source files are deleted after durable draft bytes are checked.',
    restart: 'The owned Electron process exits through desktopAction(quit) and restarts with the same temporary profile.',
    failures: 'Only the owned Electron ipcMain chat:send handler is temporarily wrapped for pre-accept rejection and a delayed post-accept reply.',
    notification: 'A synthetic failed-reply setting is seeded in the owned temporary profile database while Electron is stopped.',
  },
  limitations: 'This is a local fixture, not a real OS paste/IME or hardware/DPI/assistive-technology certification. It checks normal application restarts and a controlled late IPC reply, not arbitrary power loss or disk corruption. It does not certify model semantic quality or Windows native notification delivery.',
  ...(failure ? { failure: failure.stack || String(failure) } : {}),
});

const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST', `Unexpected request: ${request.url}`);
    assert.equal(request.url, '/v1/responses');
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const title = (body.instructions || '').includes('\u4f1a\u8bdd\u6807\u9898\u751f\u6210');
    if (!title) requests.push(body);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: title ? 'Draft fixture' : 'The local draft fixture completed.' })}\n\n` +
      `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 200, output_tokens: 20, total_tokens: 220 } } })}\n\n`,
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
  for (let attempt = 0; attempt < 180; attempt++) {
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

async function until(expression, timeout = 30000, connection = renderer) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await connection.evaluate(expression)) return; }
    catch (cause) { if (!/context|navigat|destroyed|reload/i.test(String(cause))) throw cause; }
    await sleep(60);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(selector) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return Boolean(e&&!e.disabled&&e.getClientRects().length)})()`);
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
}

async function launch() {
  assert.equal(child, null);
  const mainPort = await availablePort();
  let rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),
    [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`],
    { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  launches++;
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__draftFixtureFetch=fetch;globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url??String(input));
    if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return globalThis.__draftFixtureFetch(input,options);
    if(url.pathname.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));
    return Promise.reject(new Error('Nonlocal draft fixture network blocked'));
  };true`);
  renderer = await connect(rendererPort, true);
  await renderer.send('Runtime.enable');
  await renderer.send('Inspector.enable');
  await renderer.send('Network.enable');
  await renderer.send('Page.bringToFront');
  await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await main.evaluate(`(()=>{
    const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    globalThis.__draftFixtureElectron=electron;
    const owned=electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));
    if(!owned)throw new Error('Missing owned fixture window');
    owned.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},
      (_details,callback)=>callback({cancel:true}));
    globalThis.__draftFixtureHandlers=electron.ipcMain._invokeHandlers;
    globalThis.__draftFixtureSend=globalThis.__draftFixtureHandlers.get('chat:send');
    return true;
  })()`);
}

async function stop({ cleanup = false } = {}) {
  if (!child) return;
  const current = child;
  const ended = current.exitCode !== null || current.signalCode !== null ? Promise.resolve() : new Promise(done => current.once('exit', done));
  await main?.evaluate('globalThis.__draftFixtureRelease?.();true').catch(() => {});
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},60);true').catch(() => {});
  main?.close();
  main = null;
  await Promise.race([ended, sleep(9000)]);
  const graceful = current.exitCode !== null && current.signalCode === null;
  if (!graceful && cleanup && current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(7000)]);
  }
  renderer?.close();
  main?.close();
  renderer = null;
  main = null;
  child = null;
  if (!cleanup) assert.equal(graceful, true, 'Restart evidence requires a normal owned Electron exit');
  if (graceful) normalExits++;
  assert.ok(current.exitCode !== null || current.signalCode !== null, 'Owned fixture Electron must exit before profile cleanup');
}

async function acceptPolicies() {
  await until('Boolean(document.querySelector(".policy-consents"))');
  await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog .btn--primary');
  await until('document.querySelector(".policy-dialog")?.textContent.includes("\u5f00\u59cb\u4f7f\u7528")&&!document.querySelector(".policy-consents")');
  await click('.policy-dialog .btn--primary');
  await until('!document.querySelector(".policy-dialog")');
}

async function selectSession(sessionId) {
  await until('Boolean(window.mingshen&&document.querySelector(".session-sidebar"))');
  const selected = `document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(sessionId)}`;
  if (!await renderer.evaluate(selected)) {
    if (await renderer.evaluate('document.querySelector(".sidebar-host")?.hidden'))
      await click('.orbit-workspace-header > button:first-child, .app-topbar button.sidebar-toggle');
    await renderer.evaluate(`(()=>{for(const el of document.querySelectorAll('.session-group__header[aria-expanded=false],.session-group__show-all[aria-expanded=false]'))el.click();return true})()`);
    await click(`[data-session-id="${sessionId}"] .session-row`);
  }
  await until(selected);
  await until('(()=>{const t=document.querySelector(".composer > textarea");return Boolean(t&&!t.disabled)})()');
  if (await renderer.evaluate('Boolean(document.querySelector(".workbench-drawer-scrim"))'))
    await click('.workbench-drawer-scrim');
}

const value = () => renderer.evaluate('document.querySelector(".composer > textarea").value');
const readDraft = sessionId => renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(sessionId)})`);
async function saved(sessionId, text, { formatted, attachmentCount } = {}) {
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(sessionId)}).then(d=>Boolean(d&&d.text===${JSON.stringify(text)}${formatted === undefined ? '' : `&&d.formatted===${formatted}`}${attachmentCount === undefined ? '' : `&&d.attachments.length===${attachmentCount}`}))`);
  return readDraft(sessionId);
}

async function key(name, code, virtualKey, modifiers = 0) {
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
}

async function edit() {
  if (await renderer.evaluate(previewVisible)) await click(formatButton('edit'));
  await until('Boolean(document.querySelector(".composer > textarea")?.getClientRects().length)');
  await renderer.evaluate('document.querySelector(".composer > textarea").focus({preventScroll:true});true');
}

async function clearText(sessionId) {
  await edit();
  await renderer.evaluate('document.querySelector(".composer > textarea").select();true');
  await key('Backspace', 'Backspace', 8);
  await until('document.querySelector(".composer > textarea").value===""');
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(sessionId)}).then(d=>d===null||(!d.text&&d.attachments.length===0))`);
}

async function type(text) {
  await edit();
  await renderer.send('Input.insertText', { text });
}

async function paste(text) {
  await edit();
  const insertion = await renderer.evaluate(`(()=>{
    const target=document.querySelector('.composer > textarea');target.focus({preventScroll:true});
    const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(text)});
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    target.dispatchEvent(event);
    const inserted=!event.defaultPrevented?document.execCommand('insertText',false,${JSON.stringify(text)}):false;
    return {prevented:event.defaultPrevented,inserted};
  })()`);
  assert.deepEqual(insertion, { prevented: false, inserted: true });
}

async function attachFiles(paths) {
  await click('.composer .extension-trigger');
  await until('Boolean(document.querySelector(".extension-panel input[type=file]"))');
  const { root } = await renderer.send('DOM.getDocument');
  const { nodeId } = await renderer.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.extension-panel input[type=file]' });
  assert.ok(nodeId, 'Attachment picker input must exist');
  await renderer.send('DOM.setFileInputFiles', { nodeId, files: paths });
  await until(`document.querySelectorAll(".draft-attachment").length===${paths.length}`);
}

function assertAttachmentBytes(draft) {
  assert.equal(draft.attachments.length, 2);
  for (const [name, expected] of [['draft-source.png', imageBytes], ['draft-source.txt', fileBytes]]) {
    const attachment = draft.attachments.find(item => item.name === name);
    assert.ok(attachment, `Missing saved ${name}`);
    assert.equal(attachment.size, expected.length);
    const [, payload] = attachment.dataUrl.split(',', 2);
    assert.ok(/;base64,/.test(attachment.dataUrl), 'The fixture expects a base64 data URL');
    assert.deepEqual(Buffer.from(payload, 'base64'), expected, `Saved ${name} must retain every byte`);
  }
}

function assertNoDraftContent(draft) {
  assert.ok(draft === null || (draft.text === '' && draft.attachments.length === 0),
    'A cleared draft may retain notification receipts but must have no text or attachments');
}

async function presentation(style, locale, theme, width, height, sessionId) {
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
  await selectSession(sessionId);
}

async function shot(label, { preview = false, attachmentCount = 0 } = {}) {
  await until(`document.querySelectorAll(".draft-attachment").length===${attachmentCount}`);
  if (preview) await until(previewVisible);
  const geometry = await renderer.evaluate(`(()=>{
    const selectors=['.composer-wrap','.composer',${JSON.stringify(preview ? '.composer-preview' : '.composer > textarea')},'.send-button'${attachmentCount ? ",'.draft-attachments'" : ''}];
    return {label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,
      documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
      elements:selectors.map(selector=>{const e=document.querySelector(selector);if(!e)return{selector,missing:true};
        const r=e.getBoundingClientRect();return{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})};
  })()`);
  measurements.push(geometry);
  assert.equal(geometry.documentOverflow, false, label);
  for (const element of geometry.elements) {
    assert.equal(element.missing, undefined, `${label}: missing ${element.selector}`);
    assert.ok(element.width > 0 && element.height > 0, `${label}: invisible ${element.selector}`);
    assert.ok(element.left >= -1 && element.right <= geometry.width + 1, `${label}: horizontal clipping ${JSON.stringify(element)}`);
    assert.ok(element.top >= -1 && element.bottom <= geometry.height + 1, `${label}: vertical clipping ${JSON.stringify(element)}`);
  }
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(captures, `${label}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  screenshots.push(path);
}

function record(message) {
  passed.push(message);
  console.log(`PASS ${passed.length}: ${message}`);
}

function seedNotification() {
  assert.equal(child, null, 'Seed only the stopped fixture profile');
  const databasePath = resolve(profile, 'mingshen.db');
  assert.ok(databasePath.startsWith(temporary + sep));
  const database = new DatabaseSync(databasePath);
  try {
    assert.equal(database.prepare('pragma user_version').get().user_version, 7);
    database.prepare(`insert into app_settings(key,value_json,updated_at) values(?,?,?)
      on conflict(key) do update set value_json=excluded.value_json,updated_at=excluded.updated_at`)
      .run('desktop.notificationReplyDraft', JSON.stringify({
        sessionId: fixture.b, text: notificationText, error: 'Synthetic notification reply was not accepted.',
        id: notificationId,
      }), new Date().toISOString());
  } finally {
    database.close();
  }
}

child = null;
try {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  await mkdir(project, { recursive: true });
  await mkdir(captures, { recursive: true });
  await writeFile(sourceImage, imageBytes);
  await writeFile(sourceFile, fileBytes);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  serverListening = true;
  await launch();
  await acceptPolicies();
  fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Draft local fixture',
      baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',
      apiKey:'synthetic-draft-only',keyLabel:'Fixture',neverReveal:true});
    const created=await window.mingshen.createModel({providerId:provider.id,modelId:'composer-draft-fixture',
      displayName:'Draft fixture',contextWindow:128000,maxOutputTokens:1024,
      inputModalities:['text','image','file'],toolCalls:true,parallelToolCalls:false,
      reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const input={workspacePath:${JSON.stringify(project)},providerId:provider.id,modelId:created.models[0].id,
      permissionMode:'full_access',executionMode:'host',reasoningLevel:null};
    const a=await window.mingshen.createSession({...input,title:'Draft new conversation'});
    const b=await window.mingshen.createSession({...input,title:'Draft existing conversation'});
    const c=await window.mingshen.createSession({...input,title:'Draft clear and failure'});
    await window.mingshen.setProjectMemoryEnabled(a.id,false);
    await window.mingshen.sendChat({sessionId:b.id,text:'Seed one completed history turn for the draft fixture.'});
    const preferences=await window.mingshen.getUiPreferences(),projects={};
    for(const style of ['simple','orbit']){
      const key=(style==='orbit'?'@orbit:':'')+a.workspacePath.replaceAll('/','\\\\').replace(/\\\\+$/,'').toLowerCase();
      projects[key]={mode:'chat',sidebarWidth:228,inspectorWidth:360,sidebarOpen:true,inspectorOpen:false};
    }
    await window.mingshen.saveUiPreferences({...preferences,composerRichPaste:true,defaultLayout:'chat',projects});
    return{a:a.id,b:b.id,c:c.id};
  })()`);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.b)}).then(s=>s.status==='idle')`);
  await presentation('simple', 'zh-CN', 'night', 1440, 900, fixture.a);
  assert.equal((await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.a)})`)).length, 0);
  assert.ok((await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.b)})`)).some(message => message.role === 'assistant'));
  await paste(newSource);
  await until(previewVisible);
  await attachFiles([sourceImage, sourceFile]);
  assertAttachmentBytes(await saved(fixture.a, newSource, { formatted: true, attachmentCount: 2 }));
  await selectSession(fixture.b);
  await type(existingSource);
  await saved(fixture.b, existingSource, { formatted: false, attachmentCount: 0 });
  await selectSession(fixture.a);
  assert.equal(await value(), newSource);
  await until(previewVisible);
  await selectSession(fixture.b);
  assert.equal(await value(), existingSource);
  assert.equal(await renderer.evaluate(previewVisible), false);
  record('New empty and existing-history conversations save separate exact source drafts and restore them when switching');

  for (const source of [sourceImage, sourceFile]) {
    assert.ok(source.startsWith(project + sep));
    await rm(source, { force: false });
    await assert.rejects(readFile(source), { code: 'ENOENT' });
  }
  assertAttachmentBytes(await readDraft(fixture.a));
  await stop();
  await launch();
  await selectSession(fixture.a);
  assert.equal(await value(), newSource);
  assertAttachmentBytes(await readDraft(fixture.a));
  await until(previewVisible);
  await until('document.querySelectorAll(".draft-attachment").length===2');
  await selectSession(fixture.b);
  assert.equal(await value(), existingSource);
  record('A normal Electron restart restores exact text, source/preview mode and both complete attachment files after their originals were deleted');

  for (const [style, locale, theme, width, height] of [
    ['simple', 'zh-CN', 'night', 1440, 900],
    ['orbit', 'en', 'day', 800, 680],
  ]) {
    await presentation(style, locale, theme, width, height, fixture.a);
    assert.equal(await value(), newSource);
    assertAttachmentBytes(await readDraft(fixture.a));
    await shot(`${style}-${locale}-${theme}-${width}-restored-preview`, { preview: true, attachmentCount: 2 });
    await selectSession(fixture.b);
    assert.equal(await value(), existingSource);
    assert.equal(await renderer.evaluate(previewVisible), false);
    await shot(`${style}-${locale}-${theme}-${width}-restored-source`);
  }
  record('Simple Chinese/night and Orbit English/day at 1440 and 800 pixels restore readable source, math preview and attachment controls without clipping');

  await selectSession(fixture.a);
  const beforeSend = requests.length;
  await click('.send-button');
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.a)}).then(d=>d===null)`);
  await until('document.querySelector(".composer > textarea").value===""&&document.querySelectorAll(".draft-attachment").length===0');
  await until(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.a)}).then(messages=>messages.some(message=>message.role==='assistant'))`);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.a)}).then(s=>s.status==='idle')`);
  assert.equal(requests.length, beforeSend + 1);
  const sent = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.a)})`);
  const message = sent.find(item => item.role === 'user' && item.parts.some(part => part.type === 'text' && part.text === newSource.trim()));
  assert.ok(message, 'Accepted send must retain original Markdown, TeX and interior whitespace');
  assertAttachmentBytes({ attachments: message.parts.filter(part => part.type === 'attachment').map(part => part.attachment) });
  assert.equal((await readDraft(fixture.b)).text, existingSource);
  record('An accepted send retains the source and attachment bytes, removes only that conversation draft and leaves the other unsent draft intact');

  await paste(raceSource);
  await saved(fixture.a, raceSource);
  await main.evaluate(`globalThis.__draftFixtureAccepted=false;globalThis.__draftFixtureReturned=false;
    globalThis.__draftFixtureHandlers.set('chat:send',async(...args)=>{
      const value=await globalThis.__draftFixtureSend(...args);
      globalThis.__draftFixtureAccepted=true;
      await new Promise(done=>{globalThis.__draftFixtureRelease=done});
      globalThis.__draftFixtureReturned=true;return value;
    });true`);
  await click('.send-button');
  await until('globalThis.__draftFixtureAccepted===true', 30000, main);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.a)}).then(s=>s.status==='idle')`);
  await selectSession(fixture.b);
  await selectSession(fixture.a);
  assert.equal(await value(), '', 'Accepted draft must already be consumed before the delayed IPC reply');
  await type(newerSource);
  const newer = await saved(fixture.a, newerSource);
  await main.evaluate('globalThis.__draftFixtureRelease();true');
  await until('globalThis.__draftFixtureReturned===true', 30000, main);
  await sleep(150);
  await main.evaluate("globalThis.__draftFixtureHandlers.set('chat:send',globalThis.__draftFixtureSend);true");
  await selectSession(fixture.b);
  await selectSession(fixture.a);
  assert.equal(await value(), newerSource);
  assert.equal((await readDraft(fixture.a)).revision, newer.revision);
  record('A delayed reply from an already accepted send cannot erase a newer draft written after switching away and back');

  await selectSession(fixture.c);
  await type(rejectedSource);
  await saved(fixture.c, rejectedSource);
  const beforeReject = requests.length;
  await main.evaluate("globalThis.__draftFixtureHandlers.set('chat:send',()=>{throw new Error('DRAFT_PREACCEPT_FAILURE_8a1d')});true");
  await click('.send-button');
  await until('document.querySelector(".composer-error")?.textContent.includes("DRAFT_PREACCEPT_FAILURE_8a1d")');
  assert.equal(await value(), rejectedSource);
  assert.equal((await readDraft(fixture.c)).text, rejectedSource);
  assert.equal(requests.length, beforeReject);
  await main.evaluate("globalThis.__draftFixtureHandlers.set('chat:send',globalThis.__draftFixtureSend);true");
  await clearText(fixture.c);
  await main.evaluate(`globalThis.__draftFixtureSave=globalThis.__draftFixtureHandlers.get('composer:draft-save');
    globalThis.__draftFixtureHandlers.set('composer:draft-save',()=>{throw new Error('DRAFT_SAVE_FAILURE_3f12')});true`);
  const unsavedBeforeQuit = 'Keep this draft when storage temporarily fails.';
  await type(unsavedBeforeQuit);
  await until('document.querySelector(".composer-error")?.textContent.includes("DRAFT_SAVE_FAILURE_3f12")');
  await renderer.evaluate('window.mingshen.desktopAction("quit")');
  await until(`(()=>{const w=globalThis.__draftFixtureElectron.BrowserWindow.getAllWindows()[0];return Boolean(w&&!w.isDestroyed()&&w.isEnabled())})()`, 30000, main);
  await until('Array.from(document.querySelectorAll(".composer-error")).some(node => node.textContent.includes("\\u5df2\\u53d6\\u6d88\\u9000\\u51fa\\u6216\\u91cd\\u8f7d"))');
  assert.equal(await value(), unsavedBeforeQuit);
  assert.equal(child.exitCode, null, 'A failed draft save must cancel shutdown before SQLite is disposed');
  await main.evaluate("globalThis.__draftFixtureHandlers.set('composer:draft-save',globalThis.__draftFixtureSave);true");
  await click('.composer-error .btn--secondary');
  await saved(fixture.c, unsavedBeforeQuit);
  await clearText(fixture.c);
  record('A failed draft save cancels quit, restores the usable window and permits a durable retry without losing input');
  await selectSession(fixture.b);
  await edit();
  await renderer.evaluate('(()=>{const t=document.querySelector(".composer > textarea");t.setSelectionRange(t.value.length,t.value.length);return true})()');
  const finalKeystroke = '\nLAST_EDIT_BEFORE_QUIT_8fd1';
  await renderer.send('Input.insertText', { text: finalKeystroke });
  existingSource += finalKeystroke;
  await stop();
  seedNotification();
  await launch();
  await selectSession(fixture.c);
  assert.equal(await value(), '');
  assertNoDraftContent(await readDraft(fixture.c));
  await selectSession(fixture.a);
  assert.equal(await value(), newerSource);
  record('Pre-accept IPC rejection preserves the unsent draft; manually deleting its text remains deleted after a real restart');

  const mergedNotification = `${existingSource}\n${notificationText}`;
  await selectSession(fixture.b);
  await until(`document.querySelector(".composer > textarea").value===${JSON.stringify(mergedNotification)}`);
  await saved(fixture.b, mergedNotification);
  await selectSession(fixture.a);
  await selectSession(fixture.b);
  assert.equal(await value(), mergedNotification);
  await renderer.send('Page.reload');
  await selectSession(fixture.b);
  assert.equal(await value(), mergedNotification);
  await stop();
  await launch();
  await selectSession(fixture.b);
  assert.equal(await value(), mergedNotification);
  assert.equal((await readDraft(fixture.b)).text, mergedNotification);
  record('The last edit immediately before quit survives, and a failed-notification reply merges exactly once across switching, reload and another full restart');

  await clearText(fixture.b);
  await renderer.send('Page.reload');
  await selectSession(fixture.b);
  assert.equal(await value(), '');
  assertNoDraftContent(await readDraft(fixture.b));
  await selectSession(fixture.a);
  assert.equal(await value(), newerSource);
  assertNoDraftContent(await readDraft(fixture.c));
  record('Clearing the merged notification draft does not resurrect it on reload or remove another conversation draft');

  assert.equal((await renderer.evaluate('window.mingshen.getAppInfo()')).version, version);
  assert.deepEqual(errors, []);
  assert.deepEqual(crashes, []);
  assert.deepEqual(serverErrors, []);
  assert.deepEqual(networkAttempts, []);
  assert.equal(requests.length, 3, 'Only the history seed, normal send and delayed accepted send may call the local model');
  await stop();
  assert.equal(launches, 4);
  assert.equal(normalExits, launches);
  record(`Version matches ${version}; all four owned Electron launches exit normally with three local model requests and no renderer errors or crashes`);
  await writeFile(resolve(captures, 'result.json'), JSON.stringify(result(), null, 2));
  console.log(JSON.stringify({ version, passed, launches, normalExits, screenshots: screenshots.length,
    measurements: measurements.length, requests: requests.length, resultPath: resolve(captures, 'result.json') }, null, 2));
} catch (cause) {
  if (renderer) {
    try {
      const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
      const path = resolve(captures, 'failure.png');
      await writeFile(path, Buffer.from(image.data, 'base64'));
      screenshots.push(path);
    } catch {}
  }
  await writeFile(resolve(captures, 'result.json'), JSON.stringify(result(cause), null, 2)).catch(() => {});
  console.error(JSON.stringify(result(cause), null, 2));
  throw cause;
} finally {
  await stop({ cleanup: true });
  if (serverListening) {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
  const temporaryRoot = resolve(tmpdir()) + sep;
  if (!temporary.startsWith(temporaryRoot) || !temporary.slice(temporaryRoot.length).startsWith('mingshen-composer-drafts-'))
    throw new Error('Unsafe composer draft smoke cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
