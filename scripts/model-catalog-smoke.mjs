import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-model-catalog-'));
const profile = resolve(temporary, 'profile'), project = resolve(temporary, 'project');
const captures = resolve(process.env.MSH_SCREENSHOT_DIR || '.impeccable/review/model-catalog');
const passed = [], errors = [], crashes = [], requests = [], serverErrors = [];
const networkAttempts = [], screenshots = [], measurements = [], entrances = [];
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const quote = JSON.stringify;
let child = null, main, renderer, fixture, expectedOrder, finalDatabase;
let launchCount = 0, normalExits = 0, english = false, serverListening = false;
const rowSelector = (scope, id) => `${scope} [data-provider-order-id="${id}"]`;
const modelSelector = (id, scope = '.model-picker__panel') =>
  `${scope} button.model-picker__model[data-model-config-id="${id}"]`;
const starSelector = (id, scope = '.model-picker__panel') =>
  `${scope} button.model-star-button[data-star-model-id="${id}"]`;

const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    const route = request.url.match(/^\/([abc])\/v1\/responses$/);
    assert.ok(route, `Unexpected local endpoint ${request.url}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push({ providerTag: route[1], model: body.model });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({
      type: 'response.output_text.delta', delta: 'Synthetic model catalog selection received.',
    })}\n\n`);
    response.end(`data: ${JSON.stringify({
      type: 'response.completed',
      response: { status: 'completed', usage: { input_tokens: 120, output_tokens: 12, total_tokens: 132 } },
    })}\n\n`);
  } catch (cause) {
    serverErrors.push(cause.stack || String(cause));
    if (!response.headersSent) response.writeHead(500);
    response.end('Synthetic model catalog fixture failed');
  }
});

function result(failure) {
  return {
    version, passed, launchCount, normalExits, requests, entrances, screenshots,
    measurements, finalDatabase, errors, crashes, serverErrors, networkAttempts,
    methods: {
      data: 'Only a uniquely owned temporary profile, synthetic local keys and an owned project are used.',
      drag: 'Real CDP mouse press/move/release with a 430ms hold, short click, Escape cancellation and keyboard Alt+Arrow ordering.',
      failures: 'One-shot writes fail only for the owned fixture renderer sender; original handlers are restored before normal exit.',
      visuals: 'Both interface styles, Chinese/English, day/night and 800/1440-pixel viewport geometry are measured and captured.',
    },
    limitations: 'Synthetic local execution does not certify paid-model quality, arbitrary power loss, physical touch input, all Windows/DPI/GPU combinations or assistive technology. No normal user database, keys, memory or system clipboard are accessed.',
    ...(failure ? { failure: failure.stack || String(failure) } : {}),
  };
}

function record(message) {
  passed.push(message);
  console.log(`PASS ${passed.length}: ${message}`);
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

async function until(expression, timeout = 30000, connection = renderer) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await connection.evaluate(expression)) return; }
    catch (cause) { if (!/context|navigat|destroyed|reload/i.test(String(cause))) throw cause; }
    await sleep(65);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(selector, text) {
  const element = `[...document.querySelectorAll(${quote(selector)})].find(e=>
    e.getClientRects().length&&!e.disabled${text === undefined ? '' : `&&e.textContent.trim()===${quote(text)}`})`;
  await until(`Boolean(${element})`);
  await renderer.evaluate(`${element}.click();true`);
}

async function key(name, code, virtualKey, modifiers = 0) {
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
}

async function fill(selector, text) {
  await renderer.evaluate(`(()=>{
    const input=document.querySelector(${quote(selector)});
    if(!input)throw new Error('Missing input '+${quote(selector)});
    input.focus({preventScroll:true});input.select();return true;
  })()`);
  await renderer.send('Input.insertText', { text });
  await until(`document.querySelector(${quote(selector)})?.value===${quote(text)}`);
}

async function select(selector, value) {
  await until(`Boolean(document.querySelector(${quote(selector)})&&!document.querySelector(${quote(selector)}).disabled)`);
  await renderer.evaluate(`(()=>{
    const e=document.querySelector(${quote(selector)});
    e.value=${quote(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  await until(`document.querySelector(${quote(selector)})?.value===${quote(value)}`);
}

async function point(selector, { nearStart = false, nearEnd = false } = {}) {
  await until(`Boolean(document.querySelector(${quote(selector)})?.getClientRects().length)`);
  return renderer.evaluate(`(()=>{
    const e=document.querySelector(${quote(selector)});
    e.scrollIntoView({block:'nearest',inline:'nearest'});
    const r=e.getBoundingClientRect();
    const layout=getComputedStyle(e.parentElement);
    const horizontal=['flex','inline-flex'].includes(layout.display)&&layout.flexDirection.startsWith('row');
    return {x:horizontal?${nearStart ? 'r.left+5' : nearEnd ? 'r.right-5' : 'r.left+r.width/2'}:r.left+r.width/2,
      y:horizontal?r.top+r.height/2:${nearStart ? 'r.top+5' : nearEnd ? 'r.bottom-5' : 'r.top+r.height/2'}};
  })()`);
}

async function mouse(type, coordinates, pressed = false) {
  await renderer.send('Input.dispatchMouseEvent', {
    type, ...coordinates, button: type === 'mouseMoved' && !pressed ? 'none' : 'left',
    buttons: pressed ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
}

async function realClick(selector) {
  const coordinates = await point(selector);
  await mouse('mouseMoved', coordinates);
  await mouse('mousePressed', coordinates, true);
  await mouse('mouseReleased', coordinates);
}

async function dragProvider(scope, sourceId, targetId, { cancel = false, body = false } = {}) {
  const sourceRow = rowSelector(scope, sourceId), targetRow = rowSelector(scope, targetId);
  const source = await point(`${sourceRow} ${body ? '> button:first-child' : '.provider-order-handle'}`);
  const target = await point(targetRow, { nearStart: true });
  await mouse('mouseMoved', source);
  await mouse('mousePressed', source, true);
  await sleep(430);
  await until(`document.querySelector(${quote(sourceRow)})?.dataset.dragging==='true'`);
  for (let step = 1; step <= 6; step++) {
    await mouse('mouseMoved', {
      x: source.x + (target.x - source.x) * step / 6,
      y: source.y + (target.y - source.y) * step / 6,
    }, true);
    await sleep(18);
  }
  await until(`document.querySelector(${quote(targetRow)})?.dataset.dropPosition==='before'`);
  if (cancel) {
    await key('Escape', 'Escape', 27);
    await until(`!document.querySelector(${quote(`${scope} [data-dragging="true"]`)})`);
  }
  await mouse('mouseReleased', target);
  await until(`!document.querySelector(${quote(`${scope} [data-dragging="true"]`)})`);
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
  await main.evaluate(`globalThis.__catalogFixtureFetch=fetch;globalThis.__catalogFixtureBlockedNetwork=[];
    globalThis.fetch=(input,options)=>{
      const url=new URL(typeof input==='string'?input:input.url??String(input));
      if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return globalThis.__catalogFixtureFetch(input,options);
      if(url.pathname.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));
      globalThis.__catalogFixtureBlockedNetwork.push(url.href);
      return Promise.reject(new Error('Nonlocal model-catalog fixture network blocked'));
    };true`);
  renderer = await connect(rendererPort, true);
  await renderer.send('Runtime.enable');
  await renderer.send('Inspector.enable');
  await renderer.send('Network.enable');
  await renderer.send('Page.bringToFront');
  await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await main.evaluate(`(()=>{
    const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    const owned=electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html'));
    if(!owned)throw new Error('Missing owned fixture window');
    owned.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},
      (_details,callback)=>callback({cancel:true}));
    globalThis.__catalogFixtureSenderId=owned.webContents.id;
    globalThis.__catalogFixtureHandlers=electron.ipcMain._invokeHandlers;
    globalThis.__catalogFixtureOriginals=new Map(['model:catalog-get','model:catalog-provider-move','model:catalog-star-set'].map(
      channel=>[channel,globalThis.__catalogFixtureHandlers.get(channel)]));
    return true;
  })()`);
  await until('Boolean(window.mingshen)');
}

async function stop({ cleanup = false } = {}) {
  if (!child) return;
  const current = child;
  const ended = current.exitCode !== null || current.signalCode !== null
    ? Promise.resolve() : new Promise(done => current.once('exit', done));
  await main?.evaluate(`(()=>{
    for(const [channel,handler] of globalThis.__catalogFixtureOriginals??[])
      globalThis.__catalogFixtureHandlers.set(channel,handler);
    return true;
  })()`).catch(() => {});
  await closeSettings().catch(() => {});
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},60);true').catch(() => {});
  if (main) networkAttempts.push(...await main.evaluate('globalThis.__catalogFixtureBlockedNetwork').catch(() => []));
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

async function reload() {
  await renderer.evaluate('globalThis.__catalogFixturePageGeneration="old";true');
  await renderer.send('Page.reload');
  await until('globalThis.__catalogFixturePageGeneration===undefined&&Boolean(window.mingshen&&document.querySelector(".session-sidebar"))');
}

const settingsLabels = {
  providers: ['\u4f9b\u5e94\u5546\u4e0e\u6a21\u578b', 'Providers and models'],
  context: ['\u4e0a\u4e0b\u6587\u4e0e\u538b\u7f29', 'Context & compaction'],
  permissions: ['\u6743\u9650\u4e0e\u5b89\u5168', 'Permissions and security'],
  project: ['\u9879\u76ee\u6307\u4ee4\u4e0e\u4fe1\u4efb', 'Project instructions and trust'],
  agents: ['Agent \u914d\u7f6e', 'Agent profiles'],
};

async function openSettings(section = 'providers') {
  await closePicker();
  if (!await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))'))
    await click('.app-topbar button[aria-label="\u6253\u5f00\u8bbe\u7f6e"],.app-topbar button[aria-label="Open settings"],.orbit-tool-rail button[data-orbit-action="settings"]');
  await click('.settings-nav__item', settingsLabels[section][english ? 1 : 0]);
  if (section === 'providers')
    await until('Boolean(document.querySelector(".provider-master .provider-order-handle"))');
}

async function closeSettings() {
  if (!renderer) return;
  await closePicker();
  if (!await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))')) return;
  await click('.settings-content__header button');
  await until('!document.querySelector(".settings-workspace")||Boolean(document.querySelector(".mingshen-dialog"))');
  if (await renderer.evaluate('Boolean(document.querySelector(".mingshen-dialog"))')) {
    await click('.mingshen-dialog__actions button:last-child');
    await until('!document.querySelector(".settings-workspace")');
  }
}

async function closePicker() {
  if (renderer && await renderer.evaluate('Boolean(document.querySelector(".model-picker__panel"))')) {
    await key('Escape', 'Escape', 27);
    await until('!document.querySelector(".model-picker__panel")');
  }
}

async function openPicker(selector = '.chat-model-picker .model-picker__trigger') {
  await closePicker();
  await click(selector);
  await until('Boolean(document.querySelector(".model-picker__panel"))');
}

const preferences = () => renderer.evaluate('window.mingshen.getModelCatalogPreferences()');
const activeModel = () => renderer.evaluate(`window.mingshen.getSession(${quote(fixture.sessionId)}).then(s=>({providerId:s.providerId,modelId:s.modelId}))`);
const providerOrder = (scope = '.model-picker__providers') => renderer.evaluate(
  `[...document.querySelectorAll(${quote(`${scope} [data-provider-order-id]`)})].map(e=>e.dataset.providerOrderId)`);

async function waitOrder(order) {
  await until(`window.mingshen.getModelCatalogPreferences().then(p=>JSON.stringify(p.providerOrder)===${quote(JSON.stringify(order))})`);
  await until('[...document.querySelectorAll(".provider-order-handle")].every(e=>!e.disabled&&e.getAttribute("aria-disabled")!=="true")');
}

async function focusGrip(scope, id) {
  const selector = `${rowSelector(scope, id)} .provider-order-handle`;
  await until(`Boolean(document.querySelector(${quote(selector)})&&!document.querySelector(${quote(selector)}).disabled&&document.querySelector(${quote(selector)}).getAttribute('aria-disabled')!=='true')`);
  await renderer.evaluate(`document.querySelector(${quote(selector)}).focus({preventScroll:true});true`);
}

async function expandProvider(id) {
  const selector = `${rowSelector('.model-picker__providers', id)} .model-picker__provider-toggle`;
  await until(`Boolean(document.querySelector(${quote(selector)}))`);
  if (await renderer.evaluate(`document.querySelector(${quote(selector)}).getAttribute('aria-expanded')!=='true'`))
    await click(selector);
}

async function ensureFavoritesExpanded() {
  await until('Boolean(document.querySelector(".model-picker__favorites-toggle"))');
  if (await renderer.evaluate('document.querySelector(".model-picker__favorites-toggle").getAttribute("aria-expanded")!=="true"'))
    await click('.model-picker__favorites-toggle');
}

async function waitStar(id, starred) {
  await until(`window.mingshen.getModelCatalogPreferences().then(p=>p.starredModelIds.includes(${quote(id)})===${starred})`);
  await until(`[...document.querySelectorAll(${quote(`button.model-star-button[data-star-model-id="${id}"]`)})]
    .filter(e=>e.getClientRects().length).every(e=>e.getAttribute('aria-pressed')===${quote(String(starred))})`);
}

async function verifyPicker(selector, name, { excludedModels = [], filteredProviders } = {}) {
  await openPicker(selector);
  await ensureFavoritesExpanded();
  const order = await providerOrder();
  const expected = filteredProviders
    ? expectedOrder.filter(id => filteredProviders.includes(id))
    : expectedOrder;
  assert.deepEqual(order, expected, `${name}: provider order`);
  const state = await preferences();
  const wanted = state.starredModelIds.filter(id => !excludedModels.includes(id)).sort();
  const favoriteIds = await renderer.evaluate(
    '[...document.querySelectorAll(".model-picker__favorites button.model-picker__model")].map(e=>e.dataset.modelConfigId).sort()');
  assert.deepEqual(favoriteIds, wanted, `${name}: favorites must obey this entrance's model filter`);
  assert.equal(await renderer.evaluate(`(()=>{
    const a=document.querySelector('.model-picker__favorites'),b=document.querySelector('.model-picker__providers');
    return Boolean(a&&b&&(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING));
  })()`), true, `${name}: favorites must precede provider groups`);
  entrances.push({ name, providerOrder: order, favoriteIds, excludedModels });
  await closePicker();
}

async function injectFailure(channel, marker) {
  await main.evaluate(`(()=>{
    const original=globalThis.__catalogFixtureOriginals.get(${quote(channel)});
    let armed=true;
    globalThis.__catalogFixtureHandlers.set(${quote(channel)},async(event,input)=>{
      if(event.sender.id===globalThis.__catalogFixtureSenderId&&armed){
        armed=false;throw new Error(${quote(marker)});
      }
      return original(event,input);
    });return true;
  })()`);
}

async function present(style, locale, theme, width, height) {
  await closeSettings();
  await renderer.evaluate(`(async()=>{
    await window.mingshen.desktopAction('locale',${quote(locale)});
    localStorage.setItem('mingshen.locale',${quote(locale)});
    localStorage.setItem('mingshen.theme',${quote(theme)});
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:${quote(style)}});
  })()`);
  await reload();
  await until(`document.documentElement.dataset.interfaceStyle===${quote(style)}`);
  await renderer.send('Page.bringToFront');
  await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await renderer.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  english = locale === 'en';
}

async function shot(label, { settings = false } = {}) {
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await renderer.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))))');
  const geometry = await renderer.evaluate(`(()=>{
    const bounds=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const panel=document.querySelector(${quote(settings ? '.settings-workspace' : '.model-picker__panel')});
    const rows=[...document.querySelectorAll(${quote(settings ? '.provider-master [data-provider-order-id]' : '.model-picker__providers [data-provider-order-id]')})];
    const pairs=rows.map(e=>{
      const handle=e.querySelector('.provider-order-handle');
      const button=e.querySelector(${quote(settings ? 'button:first-child' : '.model-picker__provider-toggle')});
      return {kind:'provider',id:e.dataset.providerOrderId,row:bounds(e),a:bounds(button),b:bounds(handle)};
    });
    if(!${settings})for(const e of document.querySelectorAll('.model-picker__panel .model-picker__model')){
      if(!e.getClientRects().length)continue;
      const star=e.parentElement.querySelector('.model-star-button');
      if(star)pairs.push({kind:'model',id:e.dataset.modelConfigId,a:bounds(e),b:bounds(star)});
    }
    const names=[...document.querySelectorAll(${quote(settings ? '.provider-master strong' : '.model-picker__panel .model-picker__model strong')})]
      .filter(e=>e.getClientRects().length).map(e=>({text:e.textContent,rect:bounds(e),
        scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,overflow:getComputedStyle(e).overflow,textOverflow:getComputedStyle(e).textOverflow}));
    return {label:${quote(label)},width:innerWidth,height:innerHeight,
      documentOverflow:document.documentElement.scrollWidth>innerWidth+1,
      panel:panel?bounds(panel):null,pairs,names};
  })()`);
  measurements.push(geometry);
  assert.equal(geometry.documentOverflow, false, `${label}: document horizontal overflow`);
  assert.ok(geometry.panel?.width > 0 && geometry.panel?.height > 0, `${label}: missing visible panel`);
  assert.ok(geometry.panel.left >= -1 && geometry.panel.right <= geometry.width + 1 &&
    geometry.panel.top >= -1 && geometry.panel.bottom <= geometry.height + 1,
    `${label}: panel escaped viewport ${JSON.stringify(geometry.panel)}`);
  for (const pair of geometry.pairs) {
    const overlapX = Math.min(pair.a.right, pair.b.right) - Math.max(pair.a.left, pair.b.left);
    const overlapY = Math.min(pair.a.bottom, pair.b.bottom) - Math.max(pair.a.top, pair.b.top);
    assert.ok(overlapX <= 1 || overlapY <= 1, `${label}: independent buttons overlap ${JSON.stringify(pair)}`);
    assert.ok(pair.a.width > 0 && pair.b.width > 0, `${label}: collapsed command ${JSON.stringify(pair)}`);
    assert.ok(pair.a.left >= geometry.panel.left - 1 && pair.b.right <= geometry.panel.right + 1,
      `${label}: command escaped panel ${JSON.stringify(pair)}`);
  }
  for (const name of geometry.names)
    if (name.scrollWidth > name.clientWidth + 1)
      assert.ok(['hidden', 'clip'].includes(name.overflow) && name.textOverflow === 'ellipsis',
        `${label}: long name lacks bounded truncation ${JSON.stringify(name)}`);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(captures, `${label}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  screenshots.push(path);
}

async function checkInternalScroll() {
  const before = await renderer.evaluate(`(()=>{
    const panel=document.querySelector('.model-picker__panel');
    const nodes=[panel,...panel.querySelectorAll('*')];
    const e=nodes.find(e=>e.scrollHeight>e.clientHeight+20&&/auto|scroll/.test(getComputedStyle(e).overflowY));
    if(!e)return null;
    e.dataset.fixtureScroll='true';e.scrollTop=0;
    const r=e.getBoundingClientRect();
    return {x:r.right-12,y:(Math.max(r.top,0)+Math.min(r.bottom,innerHeight))/2,documentScroll:document.scrollingElement.scrollTop};
  })()`);
  assert.ok(before, 'A long model list needs an internal scrolling surface');
  await renderer.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: before.x, y: before.y, deltaX: 0, deltaY: 430, pointerType: 'mouse',
  });
  await until('document.querySelector("[data-fixture-scroll]")?.scrollTop>0');
  assert.equal(await renderer.evaluate('document.scrollingElement.scrollTop'), before.documentScroll);
  await renderer.evaluate('const e=document.querySelector("[data-fixture-scroll]");e.scrollTop=0;delete e.dataset.fixtureScroll;true');
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(captures, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  serverListening = true;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch();
  await acceptPolicies();
  fixture = await renderer.evaluate(`(async()=>{
    const providers=[],models={};
    const names=['Atlas','Boreal','Cygnus-'+ 'LongProviderName'.repeat(4)];
    const tags=['a','b','c'];
    for(let i=0;i<names.length;i++)providers.push(await window.mingshen.createProvider({
      name:names[i],baseUrl:'http://127.0.0.1:${server.address().port}/'+tags[i]+'/v1',
      protocol:'openai_responses',authMode:'bearer',apiKey:'catalog-local-dummy-'+i,keyLabel:'Synthetic fixture',neverReveal:true}));
    const create=async(provider,key,wire,display,input=['text'],output=['text'])=>{
      const view=await window.mingshen.createModel({providerId:provider.id,modelId:wire,displayName:display,
        contextWindow:128000,maxOutputTokens:1024,inputModalities:input,outputModalities:output,
        toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
      models[key]=view.models.find(m=>m.modelId===wire);return models[key];
    };
    await create(providers[0],'a','same-wire-model','Atlas display label');
    await create(providers[1],'b','same-wire-model','Boreal display label');
    await create(providers[0],'nontext','image-only-fixture','Image output fixture',['text','image'],['image']);
    await create(providers[2],'long','wire-'+ 'unbroken-model-identifier'.repeat(9),'LongModelDisplayName'.repeat(15));
    for(let i=0;i<24;i++)await create(providers[2],'extra'+i,'catalog-extra-'+i,'Catalog extra '+i);
    for(let i=0;i<8;i++)providers.push(await window.mingshen.createProvider({
      name:'Empty catalog provider '+i,baseUrl:'http://127.0.0.1:${server.address().port}/a/v1',
      protocol:'openai_responses',authMode:'bearer',apiKey:'catalog-empty-dummy-'+i,keyLabel:'Synthetic fixture',neverReveal:true}));
    for(const item of await window.mingshen.listMcpServers())if(item.enabled)await window.mingshen.setMcpServerEnabled(item.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const session=await window.mingshen.createSession({title:'Model catalog local selection',
      providerId:providers[0].id,modelId:models.a.id,workspacePath:${quote(project)},reasoningLevel:null,
      permissionMode:'full_access',executionMode:'host'});
    await window.mingshen.setProjectMemoryEnabled(session.id,false);
    await window.mingshen.setApprovalModelSettings({providerId:providers[0].id,modelId:models.a.id,
      fallback:{providerId:providers[1].id,modelId:models.b.id}});
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),defaultLayout:'chat'});
    return {providers,models,sessionId:session.id};
  })()`);
  await reload();
  expectedOrder = (await preferences()).providerOrder;
  assert.equal(expectedOrder.length, fixture.providers.length);
  const [a, b, c] = fixture.providers, { models } = fixture;
  const originalModel = await activeModel();
  await openSettings();
  await until('Boolean(document.querySelector(".provider-master .provider-order-handle")&&!document.querySelector(".provider-master .provider-order-handle").disabled)');
  assert.deepEqual(await providerOrder('.provider-master'), expectedOrder);
  await realClick(`${rowSelector('.provider-master', b.id)} > button:first-child`);
  await until(`document.querySelector(${quote(`${rowSelector('.provider-master', b.id)} > button:first-child`)})?.getAttribute('aria-current')==='true'`);
  assert.deepEqual((await preferences()).providerOrder, expectedOrder);
  await click(`${rowSelector('.provider-master', c.id)} > button:first-child`);
  await dragProvider('.provider-master', b.id, a.id, { body: true });
  expectedOrder = [b.id, ...expectedOrder.filter(id => id !== b.id)];
  await waitOrder(expectedOrder);
  assert.equal(await renderer.evaluate(`document.querySelector(${quote(`${rowSelector('.provider-master', c.id)} > button:first-child`)})?.getAttribute('aria-current')`), 'true');
  await dragProvider('.provider-master', a.id, b.id, { cancel: true });
  await sleep(100);
  assert.deepEqual((await preferences()).providerOrder, expectedOrder);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))'), true);
  await focusGrip('.provider-master', b.id);
  await key('ArrowDown', 'ArrowDown', 40, 1);
  expectedOrder = [a.id, b.id, ...expectedOrder.filter(id => id !== a.id && id !== b.id)];
  await waitOrder(expectedOrder);
  const keyboardFocus = await renderer.evaluate(`(()=>({
    activeTag:document.activeElement?.tagName,
    activeClass:document.activeElement?.className,
    gripFocused:document.activeElement===document.querySelector(${quote(`${rowSelector('.provider-master', b.id)} .provider-order-handle`)}),
    disabled:document.querySelector(${quote(`${rowSelector('.provider-master', b.id)} .provider-order-handle`)})?.disabled,
  }))()`);
  measurements.push({ label: 'keyboard-focus-after-order-save', ...keyboardFocus });
  console.log('KEYBOARD_FOCUS', JSON.stringify(keyboardFocus));
  assert.equal(keyboardFocus.gripFocused, true, 'Saved keyboard ordering must keep focus for the next move');
  await key('ArrowUp', 'ArrowUp', 38, 1);
  expectedOrder = [b.id, a.id, ...expectedOrder.filter(id => id !== a.id && id !== b.id)];
  await waitOrder(expectedOrder);
  await shot('settings-provider-order-zh-night', { settings: true });
  record('Settings short clicks select without reordering; real long-press row drag persists order, Escape cancels without selecting, and Alt+Arrow moves preserve the selected provider');

  await click(`${rowSelector('.provider-master', a.id)} > button:first-child`);
  await click('.provider-list > div:not([hidden]) .provider-detail-tabs button', '\u6a21\u578b');
  await click(`.provider-list > div:not([hidden]) button[aria-label=${quote('\u7f16\u8f91 Atlas display label')}]`);
  await fill('.provider-list > div:not([hidden]) .model-form input[name="contextWindow"]', '129K');
  await realClick(starSelector(models.a.id, '.provider-list > div:not([hidden])'));
  await waitStar(models.a.id, true);
  assert.equal(await renderer.evaluate(`document.activeElement===document.querySelector(${quote(starSelector(models.a.id, '.provider-list > div:not([hidden])'))})`), true,
    'Saving a model star must retain its button focus');
  assert.equal(await renderer.evaluate('document.querySelector(".provider-list > div:not([hidden]) .model-form input[name=contextWindow]")?.value'), '129K');
  assert.deepEqual(await activeModel(), originalModel);
  assert.equal((await renderer.evaluate('window.mingshen.bootstrap()')).providers.find(p => p.id === a.id).models.find(m => m.id === models.a.id).contextWindow, 128000);
  await click('.provider-list > div:not([hidden]) .model-form__heading button');
  await click(`${rowSelector('.provider-master', b.id)} > button:first-child`);
  await click('.provider-list > div:not([hidden]) .provider-detail-tabs button', '\u6a21\u578b');
  await click(starSelector(models.b.id, '.provider-list > div:not([hidden])'));
  await waitStar(models.b.id, true);
  await closeSettings();
  await openPicker();
  await ensureFavoritesExpanded();
  for (const [model, provider] of [[models.a, a], [models.b, b]]) {
    const selector = modelSelector(model.id, '.model-picker__favorites');
    assert.equal(await renderer.evaluate(`document.querySelector(${quote(selector)})?.dataset.providerId`), provider.id);
    assert.equal(await renderer.evaluate(`document.querySelector(${quote(selector)})?.querySelector('strong')?.textContent`), `${model.modelId}\uFF08${provider.name}\uFF09`);
  }
  await click('.model-picker__favorites-toggle');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".model-picker__favorites .model-picker__model").length'), 0);
  await click('.model-picker__favorites-toggle');
  await realClick(starSelector(models.a.id, '.model-picker__favorites'));
  await waitStar(models.a.id, false);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".model-picker__panel"))'), true);
  assert.deepEqual(await activeModel(), originalModel);
  await expandProvider(a.id);
  await click(starSelector(models.a.id, '.model-picker__providers'));
  await waitStar(models.a.id, true);
  assert.equal(await renderer.evaluate(`Boolean(document.querySelector(${quote(modelSelector(models.a.id, '.model-picker__favorites'))}))`), true);
  await click(starSelector(models.nontext.id, '.model-picker__providers'));
  await waitStar(models.nontext.id, true);
  await expandProvider(c.id);
  await click(starSelector(models.long.id, '.model-picker__providers'));
  await waitStar(models.long.id, true);
  await renderer.evaluate('document.querySelectorAll(".model-picker__provider-toggle[aria-expanded=true]").forEach(e=>e.click());true');
  await click('.model-picker__favorites-toggle');
  await dragProvider('.model-picker__providers', a.id, fixture.providers[3].id);
  expectedOrder = [b.id, c.id, a.id, ...expectedOrder.filter(id => ![a.id, b.id, c.id].includes(id))];
  await waitOrder(expectedOrder);
  assert.deepEqual(await providerOrder(), expectedOrder);
  await dragProvider('.model-picker__providers', a.id, c.id);
  expectedOrder = [b.id, a.id, c.id, ...expectedOrder.filter(id => ![a.id, b.id, c.id].includes(id))];
  await waitOrder(expectedOrder);
  assert.deepEqual(await providerOrder(), expectedOrder);
  await click('.model-picker__favorites-toggle');
  await dragProvider('.model-picker__providers', a.id, b.id);
  expectedOrder = [a.id, b.id, ...expectedOrder.filter(id => id !== a.id && id !== b.id)];
  await waitOrder(expectedOrder);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".model-picker__panel"))'), true);
  assert.deepEqual(await activeModel(), originalModel);
  record('Settings stars preserve unsaved model form data and the active model; duplicate wire IDs retain provider/config identities, favorite groups fold, and real menu grip drags move interior providers up/down without choosing or closing');

  const beforeKeyboard = await preferences();
  await renderer.evaluate('document.querySelector(".model-picker__favorites-toggle").focus();true');
  await key('ArrowDown', 'ArrowDown', 40);
  assert.equal(await renderer.evaluate('document.querySelector(".model-picker__panel").contains(document.activeElement)'), true);
  await key('End', 'End', 35);
  await key('Home', 'Home', 36);
  await key('Tab', 'Tab', 9);
  assert.equal(await renderer.evaluate('document.querySelector(".model-picker__panel").contains(document.activeElement)'), true);
  assert.deepEqual(await preferences(), beforeKeyboard);
  assert.deepEqual(await activeModel(), originalModel);
  await realClick(modelSelector(models.b.id, '.model-picker__favorites'));
  await until('!document.querySelector(".model-picker__panel")');
  await until(`window.mingshen.getSession(${quote(fixture.sessionId)}).then(s=>s.providerId===${quote(b.id)}&&s.modelId===${quote(models.b.id)})`);
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${quote(fixture.sessionId)},text:'MODEL_CATALOG_LOCAL_REQUEST: acknowledge the selected model without using tools.'})`);
  await until(`window.mingshen.getSession(${quote(fixture.sessionId)}).then(s=>s.status==='idle')`);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { providerTag: 'b', model: 'same-wire-model' });
  record('Menu arrow/Tab navigation keeps selection unchanged; choosing the second provider favorite closes the menu and a real local Responses request reaches that provider using its wire model ID');

  await verifyPicker('.chat-model-picker .model-picker__trigger', 'Main chat');
  await click('.session-new-button');
  await until('Boolean(document.querySelector("#new-session-title"))');
  await verifyPicker('.dialog .model-picker__trigger', 'New session');
  await click('.dialog__header button');
  await openSettings('context');
  await verifyPicker('.context-settings .settings-block:first-child .model-picker__trigger', 'Global compaction');
  await verifyPicker('.context-settings__fallback .model-picker__trigger', 'Fallback compaction');
  await select('.context-settings__session select', 'custom');
  await verifyPicker('.context-settings__session .model-picker__trigger', 'Session compaction');
  await openSettings('permissions');
  await verifyPicker('.approval-model-settings > .field:not(.approval-backup-picker) .model-picker__trigger', 'Approval main');
  await verifyPicker('.approval-backup-picker .model-picker__trigger', 'Approval fallback');
  await openSettings('project');
  await until('Boolean(document.querySelector("#project-memory-backend")&&!document.querySelector("#project-memory-backend").disabled)');
  await select('#project-memory-backend', 'tencentdb');
  const textProviderIds = [a.id, b.id, c.id];
  await verifyPicker('fieldset[aria-labelledby="project-memory-analysis-label"] .model-picker__trigger', 'Memory analysis', {
    excludedModels: [models.nontext.id], filteredProviders: textProviderIds,
  });
  await openPicker('fieldset[aria-labelledby="project-memory-analysis-label"] .model-picker__trigger');
  await ensureFavoritesExpanded();
  await click(modelSelector(models.a.id, '.model-picker__favorites'));
  await verifyPicker('fieldset[aria-labelledby="project-memory-fallback-label"] .model-picker__trigger', 'Memory fallback', {
    excludedModels: [models.nontext.id, models.a.id], filteredProviders: textProviderIds,
  });
  await closeSettings();
  await openSettings('agents');
  await click('.settings-content button', '\u65b0\u5efa Agent');
  await verifyPicker('.model-picker__trigger[aria-label="\u5b50 Agent \u6a21\u578b"]', 'Agent profile', { filteredProviders: textProviderIds });
  const roleSelect = '.settings-form-grid > .field:nth-child(2) select';
  for (const role of ['primary', 'plan']) {
    await select(roleSelect, role);
    assert.equal(await renderer.evaluate('Boolean(document.querySelector(".settings-form-grid .model-picker__trigger"))'), false);
  }
  await select(roleSelect, 'all');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".settings-form-grid .model-picker__trigger"))'), true);
  await closeSettings();
  record('All ten model pickers share provider order and stars; memory excludes non-text models and its selected primary from fallback, while Agent primary/Plan roles retain their model-override restriction');

  await openPicker();
  await ensureFavoritesExpanded();
  const beforeFailure = await preferences(), selectedBeforeFailure = await activeModel();
  await injectFailure('model:catalog-star-set', 'CATALOG_STAR_WRITE_FAILURE_8e14');
  await click(starSelector(models.long.id, '.model-picker__favorites'));
  await until('document.querySelector(".model-catalog-feedback")?.textContent.includes("CATALOG_STAR_WRITE_FAILURE_8e14")');
  assert.deepEqual(await preferences(), beforeFailure);
  assert.equal(await renderer.evaluate(`document.querySelector(${quote(starSelector(models.long.id, '.model-picker__favorites'))})?.getAttribute('aria-pressed')`), 'true');
  assert.deepEqual(await activeModel(), selectedBeforeFailure);
  await shot('star-failure-keeps-menu-state');
  await click('.model-catalog-feedback button');
  await waitStar(models.long.id, false);
  await expandProvider(c.id);
  await click(starSelector(models.long.id, '.model-picker__providers'));
  await waitStar(models.long.id, true);
  await injectFailure('model:catalog-provider-move', 'CATALOG_MOVE_WRITE_FAILURE_3fa9');
  await focusGrip('.model-picker__providers', a.id);
  await key('ArrowDown', 'ArrowDown', 40, 1);
  await until('document.querySelector(".model-catalog-feedback")?.textContent.includes("CATALOG_MOVE_WRITE_FAILURE_3fa9")');
  assert.deepEqual((await preferences()).providerOrder, expectedOrder);
  assert.deepEqual(await providerOrder(), expectedOrder);
  await click('.model-catalog-feedback button');
  expectedOrder = [b.id, a.id, ...expectedOrder.filter(id => id !== a.id && id !== b.id)];
  await waitOrder(expectedOrder);
  assert.deepEqual(await activeModel(), selectedBeforeFailure);
  await closePicker();
  record('One-shot star and provider-order write failures retain the saved UI state and active model, show actionable errors and retry the exact failed mutation');

  for (const [style, locale, theme, width, height] of [
    ['simple', 'zh-CN', 'night', 1440, 900], ['simple', 'en', 'day', 1440, 900],
    ['simple', 'zh-CN', 'day', 800, 680], ['simple', 'en', 'night', 800, 680],
    ['orbit', 'zh-CN', 'night', 1440, 900], ['orbit', 'en', 'day', 1440, 900],
    ['orbit', 'zh-CN', 'day', 800, 680], ['orbit', 'en', 'night', 800, 680],
  ]) {
    await present(style, locale, theme, width, height);
    await openPicker();
    await ensureFavoritesExpanded();
    await expandProvider(c.id);
    await shot(`${style}-${locale}-${theme}-${width}`);
    await checkInternalScroll();
    await closePicker();
  }
  record('Eight style/language/theme/viewport combinations keep floating menus and independent star/grip buttons bounded, truncate long labels and scroll long lists internally with a real wheel event');

  await present('simple', 'en', 'day', 800, 680);
  await openSettings();
  await dragProvider('.provider-master', a.id, b.id);
  expectedOrder = [a.id, b.id, ...expectedOrder.filter(id => id !== a.id && id !== b.id)];
  await waitOrder(expectedOrder);
  await closeSettings();
  record('The compact settings provider strip supports real horizontal long-press dragging and writes the same shared order');
  const persisted = await preferences();
  await stop();
  await launch();
  await until('Boolean(document.querySelector(".chat-model-picker"))');
  english = await renderer.evaluate('document.documentElement.lang==="en"');
  assert.deepEqual(await preferences(), persisted);
  await verifyPicker('.chat-model-picker .model-picker__trigger', 'Restarted main chat');
  await openSettings();
  assert.deepEqual(await providerOrder('.provider-master'), expectedOrder);
  for (const [provider, model] of [[a, models.a], [b, models.b]]) {
    await click(`${rowSelector('.provider-master', provider.id)} > button:first-child`);
    await click('.provider-list > div:not([hidden]) .provider-detail-tabs button', english ? 'Models' : '\u6a21\u578b');
    assert.equal(await renderer.evaluate(`document.querySelector(${quote(starSelector(model.id, '.provider-list > div:not([hidden])'))})?.getAttribute('aria-pressed')`), 'true');
  }
  await closeSettings();
  record('Normal quit and relaunch preserve provider order, config-specific favorites, settings stars and the selected model');

  const renamed = 'Boreal renamed catalog provider';
  await renderer.evaluate(`window.mingshen.updateProvider({providerId:${quote(b.id)},name:${quote(renamed)},baseUrl:${quote(b.baseUrl)},protocol:${quote(b.protocol)}})`);
  await reload();
  await openPicker();
  await ensureFavoritesExpanded();
  assert.equal(await renderer.evaluate(`document.querySelector(${quote(modelSelector(models.b.id, '.model-picker__favorites'))})?.querySelector('strong')?.textContent`),
    english ? `${models.b.modelId} (${renamed})` : `${models.b.modelId}\uFF08${renamed}\uFF09`);
  await injectFailure('model:catalog-star-set', 'CATALOG_DELETED_STAR_FAILURE_a531');
  await click(starSelector(models.a.id, '.model-picker__favorites'));
  await until('document.querySelector(".model-catalog-feedback")?.textContent.includes("CATALOG_DELETED_STAR_FAILURE_a531")');
  await waitStar(models.a.id, true);
  await closePicker();
  await openSettings();
  await click(`${rowSelector('.provider-master', a.id)} > button:first-child`);
  await click('.provider-list > div:not([hidden]) .provider-detail-tabs button', english ? 'Models' : '\u6a21\u578b');
  await click(`.provider-list > div:not([hidden]) button[aria-label=${quote(`${english ? 'Delete' : '\u5220\u9664'} ${models.a.displayName}`)}]`);
  await click('.mingshen-dialog__actions button:last-child');
  await until(`!document.querySelector(${quote(starSelector(models.a.id, '.provider-list > div:not([hidden])'))})`);
  await until('!document.querySelector(".model-catalog-feedback")');
  assert.ok(!(await preferences()).starredModelIds.includes(models.a.id));
  await closeSettings();
  await openPicker();
  await ensureFavoritesExpanded();
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".model-catalog-feedback"))'), false,
    'Deleting a failed star target must retire the obsolete retry without reloading');
  await injectFailure('model:catalog-provider-move', 'CATALOG_DELETED_MOVE_FAILURE_d912');
  await focusGrip('.model-picker__providers', c.id);
  await key('ArrowUp', 'ArrowUp', 38, 1);
  await until('document.querySelector(".model-catalog-feedback")?.textContent.includes("CATALOG_DELETED_MOVE_FAILURE_d912")');
  assert.deepEqual((await preferences()).providerOrder, expectedOrder);
  await closePicker();
  await openSettings();
  await click(`${rowSelector('.provider-master', c.id)} > button:first-child`);
  await click('.provider-list > div:not([hidden]) .provider-actions .btn--danger');
  await injectFailure('model:catalog-get', 'CATALOG_REFRESH_FAILURE_d134');
  await click('.mingshen-dialog__actions button:last-child');
  await until(`!document.querySelector(${quote(rowSelector('.provider-master', c.id))})`);
  await until('document.querySelector(".model-catalog-feedback")?.textContent.includes("CATALOG_REFRESH_FAILURE_d134")');
  await click('.model-catalog-feedback button');
  await until('!document.querySelector(".model-catalog-feedback")');
  expectedOrder = expectedOrder.filter(id => id !== c.id);
  await closeSettings();
  const afterDelete = await preferences();
  assert.deepEqual(afterDelete.providerOrder, expectedOrder);
  assert.ok(!afterDelete.starredModelIds.includes(models.a.id) && !afterDelete.starredModelIds.includes(models.long.id));
  assert.equal(await renderer.evaluate(`window.mingshen.setCatalogModelStar({modelConfigId:${quote(models.a.id)},starred:true}).then(()=>false,()=>true)`), true);
  await openPicker();
  await ensureFavoritesExpanded();
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".model-catalog-feedback"))'), false,
    'Deleting a failed move target must retire the obsolete retry without reloading');
  assert.equal(await renderer.evaluate(`Boolean(document.querySelector(${quote(modelSelector(models.a.id))})||document.querySelector(${quote(modelSelector(models.long.id))}))`), false);
  for (const id of [...afterDelete.starredModelIds]) {
    await click(starSelector(id, '.model-picker__favorites'));
    await waitStar(id, false);
  }
  assert.equal(await renderer.evaluate('document.querySelectorAll(".model-picker__favorites .model-picker__model").length'), 0);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".model-picker__favorites-toggle"))'), true);
  await click('.model-picker__favorites-toggle');
  await click('.model-picker__favorites-toggle');
  assert.deepEqual((await preferences()).starredModelIds, []);
  await closePicker();
  record('Provider renaming updates favorite labels by config identity; deleting failed star/move targets through Settings retires obsolete retries without reload, including a failed refresh retried as a fresh read, and keeps empty favorites foldable');

  assert.deepEqual(errors, []);
  assert.deepEqual(crashes, []);
  assert.deepEqual(serverErrors, []);
  assert.equal(requests.length, 1);
  const finalPreferences = await preferences();
  await stop();
  const databasePath = resolve(profile, 'mingshen.db');
  assert.ok(databasePath.startsWith(temporary + sep));
  const database = new DatabaseSync(databasePath);
  try {
    assert.equal(database.prepare('pragma user_version').get().user_version, 7);
    assert.equal(database.prepare('pragma integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(database.prepare('pragma foreign_key_check').all(), []);
    const stored = database.prepare('select value_json from app_settings where key=?').get('ui.modelCatalogPreferences');
    assert.deepEqual(JSON.parse(stored.value_json), finalPreferences);
    finalDatabase = { schema: 7, integrity: 'ok', preferences: finalPreferences };
  } finally {
    database.close();
  }
  assert.deepEqual(networkAttempts, []);
  record('Both owned launches exit normally; schema 7, exact catalog preferences and SQLite integrity remain intact with no renderer exceptions, crashes or nonlocal requests');
  await writeFile(resolve(captures, 'result.json'), JSON.stringify(result(), null, 2));
  console.log(JSON.stringify(result(), null, 2));
} catch (cause) {
  if (renderer) {
    try {
      const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
      const path = resolve(captures, 'failure.png');
      await writeFile(path, Buffer.from(image.data, 'base64'));
      screenshots.push(path);
      measurements.push({ failureBody: await renderer.evaluate('document.body.innerText.slice(0,18000)') });
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
  assert.ok(normalized.startsWith(resolve(tmpdir()) + sep) && basename(normalized).startsWith('mingshen-model-catalog-'),
    'Cleanup must remain in the uniquely owned temporary directory');
  await rm(normalized, { recursive: true, force: true });
}
