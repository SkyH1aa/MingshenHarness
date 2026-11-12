import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-session-management-'));
const profile = resolve(temporary, 'profile');
const folderA = resolve(temporary, 'parent-a/shared');
const folderB = resolve(temporary, 'parent-b/shared');
const archivedFolder = resolve(temporary, 'archived-only');
const worktree = resolve(temporary, 'owned-worktree');
const captures = resolve(`.impeccable/review/v${version.replaceAll('.', '')}-session-management`);
const projectFile = resolve(folderA, 'project-must-survive.txt');
const projectContent = 'OWNED_PROJECT_FILE_REMAINS_AFTER_CONVERSATION_DELETE_8e69\n';
const draftBytes = Buffer.from('Exact attachment bytes.\nMANAGED_DRAFT_BYTES_TAIL_32ad\n');
const runningMarker = 'MANAGED_RUNNING_REQUEST_f09c';
const passed = [], errors = [], crashes = [], serverErrors = [], requests = [];
const networkAttempts = [], screenshots = [], measurements = [];
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const folderKey = path => path ? path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() : '__none__';
const treeId = 'managed-tree';
const worktreeId = 'managed-tree-worktree';
const grandchildId = 'managed-tree-grandchild';
const partialIds = ['managed-partial-one', 'managed-partial-two'];
const liveId = '3f02e65c-8e51-4268-bfad-eedc4048ad61';
const liveChildId = '29a781f0-04f1-4dcb-b472-3252921ebf11';
const otherId = 'managed-other-folder';
const descendantIds = [
  ...Array.from({ length: 205 }, (_, index) => `managed-tree-child-${String(index).padStart(3, '0')}`),
  worktreeId,
  grandchildId,
];
const folderARoots = [
  treeId,
  ...Array.from({ length: 252 }, (_, index) => `managed-catalog-${String(index).padStart(3, '0')}`),
  ...partialIds,
];
let child = null, main, renderer, fixture, launchCount = 0, normalExits = 0;
let english = false, serverListening = false, originalDrafts, finalDatabase;

function plainText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plainText).join('\n');
  if (!value || typeof value !== 'object') return '';
  return [value.text, value.content].filter(part => part !== undefined).map(plainText).join('\n');
}

const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/responses');
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const title = String(body.instructions ?? '').includes('\u4f1a\u8bdd\u6807\u9898\u751f\u6210');
    const held = !title && plainText(body.input).includes(runningMarker);
    const entry = { model: body.model, title, held, closed: false, input: plainText(body.input) };
    requests.push(entry);
    response.once('close', () => { entry.closed = true; });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({
      type: 'response.output_text.delta',
      delta: title ? 'Managed local conversation' : held ? 'Waiting for the controlled delete fixture.' : 'Local fixture complete.',
    })}\n\n`);
    if (!held)
      response.end(`data: ${JSON.stringify({
        type: 'response.completed',
        response: { status: 'completed', usage: { input_tokens: 200, output_tokens: 20, total_tokens: 220 } },
      })}\n\n`);
  } catch (cause) {
    serverErrors.push(cause.stack || String(cause));
    if (!response.headersSent) response.writeHead(500);
    response.end('Synthetic session management fixture failed');
  }
});

function result(failure) {
  return {
    version, passed, launchCount, normalExits, requests, errors, crashes, serverErrors,
    networkAttempts, screenshots, measurements, finalDatabase,
    fixtures: {
      folderARoots: folderARoots.length,
      treeDescendants: descendantIds.length,
      paths: { folderA, folderB, archivedFolder, worktree },
    },
    methods: {
      data: 'Only an owned temporary profile, synthetic local key, SQLite fixtures seeded while Electron is stopped, and owned project files are used.',
      pagination: '255 roots cross the 200-row IPC boundary and six 50-row UI pages; 205 active direct children cross the child-page boundary, with archived worktree descendants too.',
      failures: 'Only owned Electron IPC handlers are wrapped for catalog failure, one root archive failure, and a delayed archive acknowledgment.',
      running: 'A local Responses SSE request is held open until the real ChatService delete path stops it.',
      screenshots: 'CDP captures both interface styles, Chinese/English, day/night and 800/1440-pixel viewports.',
    },
    limitations: 'Synthetic local execution does not certify paid-model quality, arbitrary power loss, all Windows/DPI/GPU combinations or assistive technology. DOM clicks and CDP keyboard input are used; no normal user data, key or system clipboard is accessed.',
    ...(failure ? { failure: failure.stack || String(failure) } : {}),
  };
}

async function availablePort() {
  const probe = createPortServer();
  await new Promise((done, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', done);
  });
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  return port;
}

async function connect(port, page = false) {
  let target;
  for (let attempt = 0; attempt < 220; attempt++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(value => value.json()))
        .find(item => item.webSocketDebuggerUrl && (!page || item.type === 'page'));
      if (target) break;
    } catch {}
    await sleep(80);
  }
  assert.ok(target, `Missing ${page ? 'renderer' : 'main'} debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
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
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 40000);
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

async function until(expression, timeout = 40000, connection = renderer) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await connection.evaluate(expression)) return; }
    catch (cause) { if (!/context|navigat|destroyed|reload/i.test(String(cause))) throw cause; }
    await sleep(65);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(selector, text) {
  const element = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>
    e.getClientRects().length&&!e.disabled${text === undefined ? '' : `&&e.textContent.trim()===${JSON.stringify(text)}`})`;
  await until(`Boolean(${element})`);
  await renderer.evaluate(`${element}.click();true`);
}

async function select(selector, value) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled)`);
  await renderer.evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)});
    e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await until(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`);
}

async function key(name, code, virtualKey) {
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey });
}

async function fill(selector, text) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)});
    e.focus({preventScroll:true});e.select();return true;
  })()`);
  if (text) await renderer.send('Input.insertText', { text });
  else await key('Backspace', 'Backspace', 8);
  await until(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(text)}`);
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
  launchCount++;
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__managedFixtureFetch=fetch;globalThis.__managedFixtureBlockedNetwork=[];globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url??String(input));
    if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return globalThis.__managedFixtureFetch(input,options);
    if(url.pathname.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));
    globalThis.__managedFixtureBlockedNetwork.push(url.href);
    return Promise.reject(new Error('Nonlocal session-management fixture network blocked'));
  };true`);
  renderer = await connect(rendererPort, true);
  await renderer.send('Runtime.enable');
  await renderer.send('Inspector.enable');
  await renderer.send('Network.enable');
  await renderer.send('Page.bringToFront');
  await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await until('Boolean(window.mingshen)');
  await main.evaluate(`(()=>{
    const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    globalThis.__managedFixtureElectron=electron;
    const owned=electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));
    if(!owned)throw new Error('Missing owned fixture window');
    owned.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},
      (_details,callback)=>callback({cancel:true}));
    globalThis.__managedFixtureHandlers=electron.ipcMain._invokeHandlers;
    globalThis.__managedFixtureOriginals=new Map(['session:page','session:update','session:remove'].map(
      channel=>[channel,globalThis.__managedFixtureHandlers.get(channel)]));
    globalThis.__managedFixtureCalls=[];
    return true;
  })()`);
}

async function stop({ cleanup = false } = {}) {
  if (!child) return;
  const current = child;
  const ended = current.exitCode !== null || current.signalCode !== null
    ? Promise.resolve() : new Promise(done => current.once('exit', done));
  await main?.evaluate(`(()=>{
    globalThis.__managedFixtureRelease?.();
    for(const [channel,handler] of globalThis.__managedFixtureOriginals??[])
      globalThis.__managedFixtureHandlers.set(channel,handler);
    return true;
  })()`).catch(() => {});
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},60);true').catch(() => {});
  main?.close();
  main = null;
  await Promise.race([ended, sleep(10000)]);
  const graceful = current.exitCode !== null && current.signalCode === null;
  if (!graceful && cleanup && current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(7000)]);
  }
  renderer?.close();
  renderer = null;
  child = null;
  if (graceful) normalExits++;
  assert.ok(current.exitCode !== null || current.signalCode !== null,
    'Owned Electron must exit before its profile is cleaned');
  if (!cleanup) assert.equal(graceful, true, 'A successful fixture requires graceful Electron exit');
}

async function acceptPolicies() {
  await until('Boolean(document.querySelector(".policy-consents"))');
  await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog .btn--primary');
  await until('document.querySelector(".policy-dialog")&&!document.querySelector(".policy-consents")');
  await click('.policy-dialog .btn--primary');
  await until('!document.querySelector(".policy-dialog")');
}

async function openSettings() {
  if (!await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))'))
    await click('.app-topbar button[aria-label="\u6253\u5f00\u8bbe\u7f6e"],.app-topbar button[aria-label="Open settings"],.orbit-tool-rail button[data-orbit-action="settings"]');
  await click('.settings-nav__item', english ? 'Sessions and data' : '\u4f1a\u8bdd\u4e0e\u6570\u636e');
  await until('Boolean(document.querySelector(".session-management"))');
}

async function ready() {
  await until('document.querySelector(".session-management")?.getAttribute("aria-busy")==="false"');
}

async function closeSettings() {
  if (!await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))')) return;
  await click('.settings-content__header button');
  await until('!document.querySelector(".settings-workspace")');
}

async function refresh() {
  await click('.session-management .settings-block__heading > button');
  await ready();
}

async function folder(path, status = 'active', search = '') {
  await ready();
  await select('#managed-workspace', folderKey(path));
  await select('#managed-status', status);
  await fill('#managed-search', search);
  await ready();
}

async function selected(count) {
  await until(`Number(document.querySelector(".session-management__count")?.textContent.match(/\\d+/)?.[0])===${count}`);
}

async function pick(id) {
  await click(`.managed-session-row[data-session-id="${id}"] input[type=checkbox]`);
}

async function complete(action) {
  await until(`Boolean(document.querySelector(".session-management__result"))&&document.querySelector(".session-management")?.getAttribute("aria-busy")==="false"`);
  const text = await renderer.evaluate('document.querySelector(".session-management__result").textContent');
  assert.ok(text.trim(), `Missing ${action} result`);
  return text;
}

async function readyDialog() {
  await until(`(()=>{
    const dialog=document.querySelector(".mingshen-dialog[role=alertdialog]");
    return Boolean(dialog?.getClientRects().length&&
      dialog.querySelector("#mingshen-dialog-description")?.textContent.trim()&&
      dialog.querySelectorAll(".mingshen-dialog__actions button").length===2);
  })()`);
}

async function confirm(accepted) {
  await readyDialog();
  await click(accepted ? '.mingshen-dialog__actions button:last-child' : '.mingshen-dialog__actions button:first-child');
  await until('!document.querySelector(".mingshen-dialog")');
}

async function confirmationDescription() {
  await readyDialog();
  return renderer.evaluate('document.querySelector("#mingshen-dialog-description").textContent');
}

async function session(id) {
  return renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(id)})`);
}

async function drafts() {
  return renderer.evaluate(`Promise.all(${JSON.stringify([treeId, worktreeId, grandchildId, otherId])}
    .map(id=>window.mingshen.getComposerDraft(id)))`);
}

async function statuses(ids) {
  return renderer.evaluate(`Promise.all(${JSON.stringify(ids)}.map(id=>window.mingshen.getSession(id)))`);
}

async function present(style, locale, theme, width, height) {
  await closeSettings();
  await renderer.evaluate(`(async()=>{
    await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:${JSON.stringify(style)}});
    globalThis.__managedReloadGeneration='old';
  })()`);
  await renderer.send('Page.reload');
  await until(`globalThis.__managedReloadGeneration===undefined&&Boolean(window.mingshen&&document.querySelector(".app-topbar"))&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}`);
  await renderer.send('Page.bringToFront');
  await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await renderer.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  english = locale === 'en';
  await openSettings();
  await ready();
}

async function shot(label, { dialog = false, checkGeometry = true } = {}) {
  if (dialog) await readyDialog();
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await renderer.evaluate('document.querySelector(".settings-content__body").scrollTop=0;true');
  await until('[...document.querySelectorAll(".settings-workspace,.mingshen-dialog")].every(e=>e.getAnimations().every(a=>a.playState!=="running"))');
  await sleep(140);
  const geometry = await renderer.evaluate(`(()=>{
    const selectors=${JSON.stringify(dialog
      ? ['.settings-workspace', '.mingshen-dialog', '.mingshen-dialog__actions', '.mingshen-dialog__actions button:first-child', '.mingshen-dialog__actions button:last-child']
      : ['.settings-workspace', '.settings-content', '.session-management', '.session-management__filters', '#managed-workspace', '#managed-status', '#managed-search', '.session-management__toolbar', '.session-management__list', '.managed-session-row', '.managed-session-row__copy'])};
    const parent=document.querySelector('.settings-content').getBoundingClientRect();
    return {label:${JSON.stringify(label)},width:innerWidth,height:innerHeight,
      documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
      parent:{left:parent.left,right:parent.right},
      elements:selectors.map(selector=>{
        const e=document.querySelector(selector);if(!e)return {selector,missing:true};
        const r=e.getBoundingClientRect();
        return {selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
          scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};
      })};
  })()`);
  measurements.push(geometry);
  if (checkGeometry) {
    assert.equal(geometry.documentOverflow, false, `${label}: document overflow`);
    for (const element of geometry.elements) {
      assert.equal(element.missing, undefined, `${label}: missing ${element.selector}`);
      assert.ok(element.width > 0 && element.height > 0, `${label}: invisible ${element.selector}`);
      assert.ok(element.left >= -1 && element.right <= geometry.width + 1,
        `${label}: horizontal clipping ${JSON.stringify(element)}`);
      if (element.selector === '.settings-workspace' || element.selector.startsWith('.mingshen-dialog'))
        assert.ok(element.top >= -1 && element.bottom <= geometry.height + 1,
          `${label}: vertical clipping ${JSON.stringify(element)}`);
      if (element.selector.startsWith('.session-management') && element.selector !== '.session-management')
        assert.ok(element.left >= geometry.parent.left - 1 && element.right <= geometry.parent.right + 1,
          `${label}: section escaped settings content ${JSON.stringify(element)}`);
    }
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

function ownedDatabase() {
  assert.equal(child, null, 'Seed or inspect only after the owned Electron process stopped');
  const databasePath = resolve(profile, 'mingshen.db');
  assert.ok(databasePath.startsWith(temporary + sep));
  const database = new DatabaseSync(databasePath);
  assert.equal(database.prepare('pragma user_version').get().user_version, 7);
  return database;
}

function seedCatalog(baseId) {
  const database = ownedDatabase();
  try {
    const source = database.prepare('select * from sessions where id=?').get(baseId);
    assert.ok(source, 'The real application must create the seed session');
    const columns = Object.keys(source);
    assert.ok(columns.includes('parent_session_id'));
    const insert = database.prepare(`insert into sessions(${columns.join(',')}) values(${columns.map(() => '?').join(',')})`);
    const old = '2020-01-01T00:00:00.000Z';
    const base = { ...source, status: 'idle', archived: 0, pinned: 0,
      parent_session_id: null, created_at: old, updated_at: old, last_opened_at: old };
    const put = (id, title, workspace, parent = null, archived = 0) => {
      const row = { ...base, id, title, workspace_path: workspace, parent_session_id: parent, archived };
      insert.run(...columns.map(name => row[name]));
    };
    database.exec('begin');
    put(treeId, 'Managed hierarchy root', folderA);
    for (let index = 0; index < 252; index++)
      put(folderARoots[index + 1], `Managed catalog ${String(index).padStart(3, '0')}`, folderA);
    put(partialIds[0], 'Managed partial one', folderA);
    put(partialIds[1], 'Managed partial two', folderA);
    for (const [index, id] of descendantIds.slice(0, 205).entries())
      put(id, `Managed direct child ${index}`, folderA, treeId);
    put(worktreeId, 'Managed archived worktree child', worktree, treeId, 1);
    put(grandchildId, 'Managed mixed-state grandchild', worktree, worktreeId);
    put(liveId, 'Managed running root', folderB);
    put(liveChildId, 'Managed running child', worktree, liveId);
    put(otherId, 'Managed other folder preserved', folderB);
    put('managed-other-archived', 'Managed archived sibling', folderB, null, 1);
    put('managed-no-folder-one', 'Managed no folder one', null);
    put('managed-no-folder-two', 'Managed no folder two', null);
    for (let index = 0; index < 3; index++)
      put(`managed-archived-only-${index}`, `Managed archived only ${index}`, archivedFolder, null, 1);
    database.prepare('delete from sessions where id=?').run(baseId);
    database.exec('commit');
    assert.equal(database.prepare('select count(*) as count from sessions where parent_session_id is null and workspace_path=?').get(folderA).count, 255);
    assert.equal(database.prepare('pragma integrity_check').get().integrity_check, 'ok');
  } catch (cause) {
    try { database.exec('rollback'); } catch {}
    throw cause;
  } finally {
    database.close();
  }
}

async function selectMain(id, title) {
  await closeSettings();
  await until('Boolean(document.querySelector(".session-sidebar"))');
  if (await renderer.evaluate('document.querySelector(".sidebar-host")?.hidden'))
    await click('.orbit-workspace-header > button:first-child,.app-topbar button.sidebar-toggle');
  await fill('.session-search input', title);
  await click(`.session-sidebar [data-session-id="${id}"] .session-row`);
  await until(`document.querySelector(".session-row--selected")?.closest("[data-session-id]")?.dataset.sessionId===${JSON.stringify(id)}`);
  if (await renderer.evaluate('Boolean(document.querySelector(".workbench-drawer-scrim"))'))
    await click('.workbench-drawer-scrim');
}

try {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  await mkdir(captures, { recursive: true });
  for (const path of [folderA, folderB, archivedFolder, worktree]) await mkdir(path, { recursive: true });
  await writeFile(projectFile, projectContent);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  serverListening = true;
  await launch();
  await acceptPolicies();
  fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Managed local fixture',
      baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',
      apiKey:'synthetic-session-management-only',keyLabel:'Fixture',neverReveal:true});
    const created=await window.mingshen.createModel({providerId:provider.id,modelId:'managed-fixture',
      displayName:'Managed fixture',contextWindow:128000,maxOutputTokens:1024,inputModalities:['text'],
      toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const item of await window.mingshen.listMcpServers())
      if(item.enabled)await window.mingshen.setMcpServerEnabled(item.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    await window.mingshen.setSessionRetention({days:null});
    const base=await window.mingshen.createSession({title:'Managed seed',
      providerId:provider.id,modelId:created.models[0].id,workspacePath:${JSON.stringify(folderA)},
      permissionMode:'full_access',executionMode:'host',reasoningLevel:null});
    await window.mingshen.setProjectMemoryEnabled(base.id,false);
    const preferences=await window.mingshen.getUiPreferences();
    await window.mingshen.saveUiPreferences({...preferences,defaultLayout:'chat'});
    return {base:base.id,modelId:created.models[0].id,providerId:provider.id};
  })()`);
  await stop();
  seedCatalog(fixture.base);
  await launch();
  await until('Boolean(document.querySelector(".session-sidebar"))');
  fixture.schedule = await renderer.evaluate(`(async()=>{
    for(const id of ${JSON.stringify([treeId, liveId])})await window.mingshen.setProjectMemoryEnabled(id,false);
    const attachment={id:'managed-fixture-attachment',name:'draft.txt',mimeType:'text/plain',
      size:${draftBytes.length},kind:'file',dataUrl:${JSON.stringify(`data:text/plain;base64,${draftBytes.toString('base64')}`)}};
    for(const [index,id] of ${JSON.stringify([treeId, worktreeId, grandchildId, otherId])}.entries())
      await window.mingshen.saveComposerDraft({sessionId:id,revision:'managed-draft-'+index,
        text:'Exact unsent draft for '+id+'\\n  $x^2+1$  ',formatted:true,
        attachmentIds:[attachment.id],addedAttachments:[attachment],notificationDraftIds:[]});
    const task=await window.mingshen.createScheduledTask({name:'Managed fixture schedule',
      prompt:'Must not run during the fixture.',sessionId:${JSON.stringify(worktreeId)},intervalMinutes:10080,enabled:true});
    return task.id;
  })()`);
  originalDrafts = await drafts();
  for (const draft of originalDrafts) {
    assert.ok(draft.text.includes('Exact unsent draft'));
    assert.deepEqual(Buffer.from(draft.attachments[0].dataUrl.split(',')[1], 'base64'), draftBytes);
  }
  await present('simple', 'zh-CN', 'night', 1440, 900);
  const options = await renderer.evaluate('[...document.querySelector("#managed-workspace").options].map(e=>({value:e.value,text:e.textContent}))');
  for (const path of [folderA, folderB, archivedFolder, null])
    assert.ok(options.some(option => option.value === folderKey(path)), `Missing folder ${path}`);
  assert.ok(!options.some(option => option.value === folderKey(worktree)), 'Worktree descendants must remain under their root folder');
  assert.ok(options.find(option => option.value === folderKey(folderA)).text.includes(folderA));
  assert.ok(options.find(option => option.value === folderKey(folderB)).text.includes(folderB));
  assert.equal(basename(folderA), basename(folderB), 'Fixture must have colliding folder names');
  await folder(archivedFolder, 'archived');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".managed-session-row").length'), 3);
  await folder(null);
  assert.equal(await renderer.evaluate('document.querySelectorAll(".managed-session-row").length'), 2);
  record('The complete catalog includes same-name folders by full path, no-folder sessions and an archived-only folder; descendants are grouped with roots');

  await folder(folderA);
  assert.equal(await renderer.evaluate('document.querySelectorAll(".managed-session-row").length'), 50);
  await click('#managed-select-all');
  await selected(255);
  for (let page = 1; page < 6; page++) {
    await click('[data-session-page=next]');
    assert.equal(await renderer.evaluate('[...document.querySelectorAll(".managed-session-row input")].every(e=>e.checked)'), true);
  }
  assert.equal(await renderer.evaluate('document.querySelectorAll(".managed-session-row").length'), 5);
  await click('.managed-session-row input');
  await selected(254);
  assert.deepEqual(await renderer.evaluate('(()=>{const e=document.querySelector("#managed-select-all");return{checked:e.checked,indeterminate:e.indeterminate}})()'),
    { checked: false, indeterminate: true });
  await fill('#managed-search', 'Managed partial');
  await selected(0);
  await pick(partialIds[0]);
  await selected(1);
  await select('#managed-status', 'all');
  await selected(0);
  await pick(partialIds[0]);
  await select('#managed-workspace', folderKey(folderB));
  await selected(0);
  await folder(folderB, 'all');
  await click('#managed-select-all');
  await selected(3);
  assert.deepEqual(await renderer.evaluate(`({
    archive:document.querySelector('[data-session-action=archive]').disabled,
    restore:document.querySelector('[data-session-action=restore]').disabled,
    remove:document.querySelector('[data-session-action=delete]').disabled
  })`), { archive: true, restore: true, remove: false });
  record('Select-all spans 255 roots over six pages; partial selection is indeterminate, filters clear selection and mixed archive states expose only a valid delete action');

  await folder(folderA, 'active', 'Managed hierarchy root');
  await pick(treeId);
  await click('[data-session-action=delete]');
  const confirmation = await confirmationDescription();
  assert.ok(confirmation.includes('207'), 'Confirmation must count all 207 descendants across archive states and child pages');
  assert.ok(/1/.test(confirmation));
  assert.ok(/草稿|drafts/i.test(confirmation));
  assert.ok(/保留|remain/i.test(confirmation));
  assert.equal(await renderer.evaluate('[...document.querySelectorAll(".settings-nav__item,.settings-content__header button,.session-management input,.session-management select,.session-management button")].every(e=>e.disabled)'), true);
  await shot('cancel-delete-confirmation', { dialog: true });
  await confirm(false);
  await ready();
  assert.ok(await session(treeId));
  assert.deepEqual(await drafts(), originalDrafts);
  await selected(1);
  record('Delete confirmation counts paged and mixed-state descendants, explains draft deletion and project preservation, locks settings, and cancellation changes no data');

  await folder(folderA);
  await click('#managed-select-all');
  await selected(255);
  await click('[data-session-action=archive]');
  await confirm(true);
  await complete('archive');
  await selected(0);
  assert.ok((await statuses([...folderARoots, ...descendantIds])).every(row => row?.archived));
  assert.deepEqual(await drafts(), originalDrafts, 'Archive must preserve exact draft revisions, source and attachment bytes');
  assert.equal((await renderer.evaluate('window.mingshen.listScheduledTasks()')).find(task => task.id === fixture.schedule).enabled, false);
  await select('#managed-status', 'archived');
  await click('#managed-select-all');
  await selected(255);
  await click('[data-session-action=restore]');
  await complete('restore');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".mingshen-dialog"))'), false);
  assert.ok((await statuses([...folderARoots, ...descendantIds])).every(row => row && !row.archived));
  assert.deepEqual(await drafts(), originalDrafts);
  assert.equal((await renderer.evaluate('window.mingshen.listScheduledTasks()')).find(task => task.id === fixture.schedule).enabled, false);
  assert.ok(await session(otherId));
  record('Bulk archive and restore update all 255 roots and 207 descendants, preserve exact drafts and attachment bytes, pause schedules and keep them paused after restore');

  for (const [style, locale, theme, width, height] of [
    ['simple', 'zh-CN', 'night', 1440, 900],
    ['simple', 'en', 'day', 1440, 900],
    ['simple', 'zh-CN', 'day', 800, 680],
    ['simple', 'en', 'night', 800, 680],
    ['orbit', 'zh-CN', 'night', 1440, 900],
    ['orbit', 'en', 'day', 1440, 900],
    ['orbit', 'zh-CN', 'day', 800, 680],
    ['orbit', 'en', 'night', 800, 680],
  ]) {
    await present(style, locale, theme, width, height);
    await folder(folderA);
    await click('.managed-session-row input[type=checkbox]');
    await shot(`${style}-${locale}-${theme}-${width}`);
  }
  record('Both interface styles, languages and day/night themes render batch controls and rows within 800/1440-pixel settings layouts');

  await present('simple', 'en', 'day', 1440, 900);
  await folder(folderA, 'active', 'Managed hierarchy root');
  await pick(treeId);
  await click('[data-session-action=delete]');
  await shot('english-delete-confirmation', { dialog: true });
  await confirm(true);
  await complete('delete');
  assert.ok((await statuses([treeId, ...descendantIds])).every(row => row === null));
  const remainingDrafts = await drafts();
  assert.ok(remainingDrafts.slice(0, 3).every(draft => draft === null));
  assert.deepEqual(remainingDrafts[3], originalDrafts[3]);
  assert.equal((await renderer.evaluate('window.mingshen.listScheduledTasks()')).some(task => task.id === fixture.schedule), false);
  assert.equal(await readFile(projectFile, 'utf8'), projectContent);
  assert.ok(await session(otherId));
  record('Confirmed deletion removes the complete 208-session hierarchy, its drafts, attachments and schedule while preserving another folder and the real project file');

  await main.evaluate(`(()=>{
    const original=globalThis.__managedFixtureOriginals.get('session:update');
    globalThis.__managedFixtureArchiveFailure=true;
    globalThis.__managedFixtureHandlers.set('session:update',async(...args)=>{
      const input=args[1];
      globalThis.__managedFixtureCalls.push({channel:'session:update',sessionId:input.sessionId,archived:input.archived});
      if(input.sessionId===${JSON.stringify(partialIds[1])}&&input.archived===true&&globalThis.__managedFixtureArchiveFailure){
        globalThis.__managedFixtureArchiveFailure=false;throw new Error('MANAGED_ARCHIVE_FAILURE_04ae');
      }
      return original(...args);
    });return true;
  })()`);
  await folder(folderA, 'active', 'Managed partial');
  await click('#managed-select-all');
  await click('[data-session-action=archive]');
  await confirm(true);
  const partialResult = await complete('archive');
  await selected(1);
  assert.ok(partialResult.includes('MANAGED_ARCHIVE_FAILURE_04ae'));
  assert.equal((await session(partialIds[0])).archived, true);
  assert.equal((await session(partialIds[1])).archived, false);
  assert.equal(await renderer.evaluate(`document.querySelector('.managed-session-row[data-session-id="${partialIds[1]}"] input').checked`), true);
  await shot('partial-failure-retains-selection');
  await click('[data-session-action=archive]');
  await confirm(true);
  await complete('archive');
  await selected(0);
  const updateCalls = await main.evaluate('globalThis.__managedFixtureCalls.filter(item=>item.channel==="session:update"&&item.archived===true)');
  assert.equal(updateCalls.filter(item => item.sessionId === partialIds[0]).length, 1);
  assert.equal(updateCalls.filter(item => item.sessionId === partialIds[1]).length, 2);
  record('A partial archive failure reports its own error, retains only the failed root for retry and never repeats the successful root');

  await closeSettings();
  await main.evaluate(`(()=>{
    const original=globalThis.__managedFixtureOriginals.get('session:page');
    globalThis.__managedFixtureFailCatalog=true;
    globalThis.__managedFixtureHandlers.set('session:page',async(...args)=>{
      const input=args[1];
      if(input?.parentId===null&&globalThis.__managedFixtureFailCatalog){
        globalThis.__managedFixtureFailCatalog=false;throw new Error('MANAGED_CATALOG_FAILURE_e086');
      }
      return original(...args);
    });return true;
  })()`);
  await openSettings();
  await until('document.querySelector(".session-management .form-error")?.textContent.includes("MANAGED_CATALOG_FAILURE_e086")');
  await ready();
  await shot('catalog-error-refresh', { checkGeometry: false });
  await refresh();
  await until('!document.querySelector(".session-management .form-error")');
  assert.ok((await renderer.evaluate('[...document.querySelector("#managed-workspace").options].map(e=>e.value)')).includes(folderKey(archivedFolder)));
  record('A real IPC catalog failure is visible and the refresh control recovers the complete list without reopening the application');

  await folder(folderA, 'active', 'Managed catalog 001');
  const lockId = folderARoots[2];
  await pick(lockId);
  await main.evaluate(`(()=>{
    const original=globalThis.__managedFixtureOriginals.get('session:update');
    globalThis.__managedFixtureUpdateHeld=false;
    globalThis.__managedFixtureHandlers.set('session:update',async(...args)=>{
      const input=args[1];
      if(input.sessionId===${JSON.stringify(lockId)}&&input.archived===true){
        globalThis.__managedFixtureUpdateHeld=true;
        await new Promise(done=>{globalThis.__managedFixtureRelease=done;});
      }
      return original(...args);
    });return true;
  })()`);
  await click('[data-session-action=archive]');
  await confirm(true);
  await until('globalThis.__managedFixtureUpdateHeld===true', 40000, main);
  assert.equal(await renderer.evaluate('[...document.querySelectorAll(".settings-nav__item,.settings-content__header button,.session-management input,.session-management select,.session-management button")].every(e=>e.disabled)'), true);
  await key('Escape', 'Escape', 27);
  await renderer.evaluate('document.querySelector(".settings-scrim").click();true');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".session-management"))'), true);
  const browserSession = await renderer.evaluate(`(()=>{
    globalThis.__managedFixtureBrowserEventReceived=false;
    globalThis.__managedFixtureBrowserUnsubscribe=window.mingshen.onRuntimeEvent(event=>{
      if(event.type==='browser_open_requested')globalThis.__managedFixtureBrowserEventReceived=true;
    });
    return document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId??${JSON.stringify(otherId)};
  })()`);
  await main.evaluate(`(()=>{
    const owned=globalThis.__managedFixtureElectron.BrowserWindow.getAllWindows()
      .find(window=>window.webContents.getURL().includes('index.html'));
    owned.webContents.send('runtime:event',{type:'browser_open_requested',
      sessionId:${JSON.stringify(browserSession)},provider:'chrome',url:'about:blank'});
    return true;
  })()`);
  await until('globalThis.__managedFixtureBrowserEventReceived===true');
  await renderer.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".session-management"))'), true,
    'A background browser-open runtime event must not unmount the busy settings operation');
  await renderer.evaluate('globalThis.__managedFixtureBrowserUnsubscribe();true');
  await main.evaluate('globalThis.__managedFixtureRelease();globalThis.__managedFixtureRelease=null;true');
  await complete('archive');
  await main.evaluate("globalThis.__managedFixtureHandlers.set('session:update',globalThis.__managedFixtureOriginals.get('session:update'));true");
  record('While an archive acknowledgment is pending, controls, navigation, Escape, the backdrop and a real-channel browser-open event cannot abandon the batch');

  await selectMain(liveId, 'Managed running root');
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(liveId)},text:${JSON.stringify(runningMarker)}})`);
  await until(`window.mingshen.getSession(${JSON.stringify(liveId)}).then(value=>value?.status==='running')`);
  for (let attempt = 0; attempt < 100 && !requests.some(request => request.held); attempt++) await sleep(50);
  assert.ok(requests.some(request => request.held && !request.closed), 'The controlled model request must be live before delete');
  await openSettings();
  await ready();
  await folder(folderB, 'active', 'Managed running root');
  await pick(liveId);
  await click('[data-session-action=delete]');
  const liveConfirmation = await confirmationDescription();
  assert.ok(/stop/i.test(liveConfirmation));
  await confirm(true);
  await complete('delete');
  assert.equal(await session(liveId), null);
  assert.equal(await session(liveChildId), null);
  for (let attempt = 0; attempt < 100 && requests.some(request => request.held && !request.closed); attempt++) await sleep(50);
  assert.ok(requests.filter(request => request.held).every(request => request.closed), 'Delete must cancel the live HTTP/SSE stream');
  await closeSettings();
  await selectMain(otherId, 'Managed other folder preserved');
  await until('Boolean(document.querySelector(".composer > textarea")&&!document.querySelector(".composer > textarea").disabled)');
  assert.deepEqual((await drafts())[3], originalDrafts[3]);
  assert.equal(await readFile(projectFile, 'utf8'), projectContent);
  record('Deleting the currently selected running root stops the local SSE request, waits for removal of its child and leaves another conversation usable');

  networkAttempts.push(...await main.evaluate('globalThis.__managedFixtureBlockedNetwork'));
  assert.deepEqual(errors, []);
  assert.deepEqual(crashes, []);
  assert.deepEqual(serverErrors, []);
  assert.deepEqual(networkAttempts, []);
  assert.equal(requests.filter(request => !request.title).length, 1);
  await stop();
  const database = ownedDatabase();
  try {
    const removed = [treeId, ...descendantIds, liveId, liveChildId];
    for (const id of removed) {
      assert.equal(database.prepare('select count(*) as count from sessions where id=?').get(id).count, 0);
      assert.equal(database.prepare('select count(*) as count from app_settings where key=? or key like ?')
        .get(`composer.draft.${id}`, `composer.draft-attachment.${id}.%`).count, 0);
    }
    assert.equal(database.prepare('pragma integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(database.prepare('pragma foreign_key_check').all(), []);
    finalDatabase = {
      schema: database.prepare('pragma user_version').get().user_version,
      remainingSessions: database.prepare('select count(*) as count from sessions').get().count,
      deletedIds: removed.length,
      integrity: 'ok',
      orphanDrafts: 0,
    };
  } finally {
    database.close();
  }
  record('Normal shutdown leaves schema 7 intact, no deleted-session draft or attachment records, no foreign-key violations and no renderer errors or crashes');
  await writeFile(resolve(captures, 'result.json'), JSON.stringify(result(), null, 2));
  console.log(JSON.stringify(result(), null, 2));
} catch (cause) {
  if (renderer) {
    try {
      const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
      const path = resolve(captures, 'failure.png');
      await writeFile(path, Buffer.from(image.data, 'base64'));
      screenshots.push(path);
      measurements.push({ failureBody: await renderer.evaluate('(document.querySelector(".settings-content")?.innerText||document.body.innerText).slice(0,14000)') });
    } catch {}
  }
  await mkdir(captures, { recursive: true });
  await writeFile(resolve(captures, 'result.json'), JSON.stringify(result(cause), null, 2));
  console.error(cause);
  process.exitCode = 1;
} finally {
  await stop({ cleanup: true });
  if (serverListening) {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
  const normalized = resolve(temporary);
  assert.ok(normalized.startsWith(resolve(tmpdir()) + sep) && basename(normalized).startsWith('mingshen-session-management-'),
    'Cleanup must remain in the uniquely owned temporary directory');
  await rm(normalized, { recursive: true, force: true });
}
