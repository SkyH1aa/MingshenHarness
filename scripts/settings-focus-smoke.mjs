import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-settings-focus-'));
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const errors = [];
let child, renderer, main;

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
const click = async (selector, text) => {
  const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
  await until(`Boolean(${expression})`); await renderer.evaluate(`${expression}.click();true`);
};
async function key(key, code, modifiers = 0) {
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
}
async function shot(name) {
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function typeField(selector, text, delay = 35) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{window.__focusTarget=document.querySelector(${JSON.stringify(selector)});window.__focusTarget.focus();window.__focusTarget.select();return true})()`);
  let expected = '';
  for (const character of text) {
    await renderer.send('Input.insertText', { text: character });
    expected += character;
    await sleep(delay);
    const state = await renderer.evaluate('({focused:document.activeElement===window.__focusTarget,value:window.__focusTarget.value,active:document.activeElement?.getAttribute("aria-label")})');
    assert.equal(state.focused, true, `Focus stolen from ${selector}; active=${state.active}`);
    assert.equal(state.value, expected, `Input lost in ${selector}`);
  }
  // Use the existing window-focus approval resync to force an App rerender.
  await renderer.evaluate('window.dispatchEvent(new Event("focus"));true');
  await sleep(200);
  assert.equal(await renderer.evaluate('document.activeElement===window.__focusTarget'), true, `Background refresh stole focus from ${selector}`);
}
async function openSettings() {
  const selector = '.app-topbar button[aria-label="打开设置"],.app-topbar button[aria-label="Open settings"]';
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
  await until('Boolean(document.querySelector(".settings-workspace"))');
  assert.equal(await renderer.evaluate('document.activeElement===document.querySelector(".settings-content__header button")'), true);
}

try {
  await mkdir(screenshots, { recursive: true });
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9354', '.', '--remote-debugging-port=9353'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9354);
  await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  renderer = await connect(9353);
  await renderer.send('Runtime.enable');
  await until('Boolean(document.querySelector(".policy-consents"))'); await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  const fixture = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Focus fixture',baseUrl:'http://127.0.0.1:9/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-fixture-key',keyLabel:'Initial fixture',neverReveal:true});
    const result=await window.mingshen.createModel({providerId:p.id,modelId:'focus-model',displayName:'Focus model',contextWindow:128000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['none','low','high'],anthropicNoneBehavior:'disabled'});
    const session=await window.mingshen.createSession({providerId:p.id,modelId:result.models[0].id,title:'Focus regression',workspacePath:null,permissionMode:'request_approval',reasoningLevel:null});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    return {providerId:p.id,sessionId:session.id};})()`);
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".app-topbar"))');
  await openSettings(); await click('.settings-nav__item', '供应商与模型');
  await click('.provider-toolbar button', '添加供应商');
  await typeField('.provider-form .field:nth-child(2) input', '连续输入标签-focus-123456', 230);
  passed.push('Continuous Chinese/Latin typing survives the real three-second approval poll and explicit App refresh');

  await renderer.evaluate('window.__focusTarget.setSelectionRange(2,6);window.dispatchEvent(new Event("focus"));true');
  await sleep(250);
  assert.deepEqual(await renderer.evaluate('({focused:document.activeElement===window.__focusTarget,start:window.__focusTarget.selectionStart,end:window.__focusTarget.selectionEnd})'), { focused: true, start: 2, end: 6 });
  await renderer.send('Input.insertText', { text: '替换' });
  assert.equal(await renderer.evaluate('window.__focusTarget.value'), '连续替换-focus-123456');
  passed.push('Selection and caret survive a parent refresh; replacing a selected range preserves the rest of the draft');

  await typeField('.provider-form input[placeholder="Chatgpt Pro"]', 'New provider fixture');
  await typeField('.provider-form input[placeholder="https://api.your-domain.com/v1"]', 'http://127.0.0.1:9/v1');
  await typeField('.provider-form input[type="password"]', 'local-new-fixture-key');
  await click('.provider-form button', '保存连接');
  await until('!document.querySelector(".provider-form")');
  assert.ok((await renderer.evaluate('window.mingshen.bootstrap()')).providers.some(p => p.name === 'New provider fixture' && p.keys[0]?.label === '连续替换-focus-123456'));
  passed.push('Provider name, Base URL and secret inputs retain focus, and the connection saves through real IPC');

  await renderer.evaluate('document.querySelector(".provider-section").setAttribute("data-focus-fixture", "true");true');
  const providerRoot = '.provider-section[data-focus-fixture]';
  await click(`${providerRoot} .provider-actions button`, 'API Key');
  await typeField(`${providerRoot} form.inline-form:not(.key-edit-form) input:not([type])`, 'New fixture label');
  await typeField(`${providerRoot} form.inline-form:not(.key-edit-form) input[type="password"]`, 'local-added-fixture-key');
  await click(`${providerRoot} form.inline-form button`, '添加');
  await until(`!document.querySelector(${JSON.stringify(`${providerRoot} form.inline-form:not(.key-edit-form)`)})`);
  assert.equal((await renderer.evaluate('window.mingshen.bootstrap()')).providers.find(p => p.id === fixture.providerId).keys.length, 2);
  passed.push('Adding an API Key retains typing focus across parent updates and persists the new label');

  await renderer.evaluate(`document.querySelector(${JSON.stringify(`${providerRoot} .key-row button[title="编辑 API Key"]`)}).click();true`);
  await typeField('.key-edit-form input:not([type])', '中文标签-Edited');
  await typeField('.key-edit-form input[type="password"]', 'local-replaced-fixture-key');
  await shot('settings-focus-zh-night');
  await click('.key-edit-form button', '保存修改');
  await until('!document.querySelector(".key-edit-form")');
  assert.ok((await renderer.evaluate('window.mingshen.bootstrap()')).providers.find(p => p.id === fixture.providerId).keys.some(k => k.label === '中文标签-Edited'));
  passed.push('Editing an existing Key label and replacing its masked secret remain stable and save correctly');

  await click(`${providerRoot} .provider-detail-tabs button`, '模型');
  await renderer.evaluate(`document.querySelector(${JSON.stringify(`${providerRoot} .model-row button[title="编辑模型"]`)}).click();true`);
  await typeField('.model-form .form-grid--two > .field:nth-child(1) input', 'focus-model-edited');
  // Select by containing field since each input is the first child of its own label.
  await typeField('.model-form .form-grid--two > .field:nth-child(2) input', 'Edited model');
  await typeField('.model-form .form-grid--two > .field:nth-child(3) input', '200000');
  await typeField('.model-form .form-grid--two > .field:nth-child(4) input', '16384');
  await typeField('.model-form input[placeholder="none,low,medium,high,xhigh,max"]', 'none,low,medium,high');
  passed.push('Model ID/name, numeric limits and reasoning levels retain focus while the parent rerenders');

  await renderer.evaluate('window.__focusTarget=document.querySelector(".model-form .form-grid--two > .field:nth-child(2) input");window.__focusTarget.focus();window.__focusTarget.select();true');
  await renderer.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 });
  await renderer.evaluate('window.dispatchEvent(new Event("focus"));true'); await sleep(200);
  assert.equal(await renderer.evaluate('document.activeElement===window.__focusTarget'), true);
  await renderer.send('Input.insertText', { text: '中文模型' });
  assert.equal(await renderer.evaluate('window.__focusTarget.value'), '中文模型');
  await click('.model-form button', '保存模型');
  await until('!document.querySelector(".model-form")');
  const model = (await renderer.evaluate('window.mingshen.bootstrap()')).providers.find(p => p.id === fixture.providerId).models[0];
  assert.deepEqual([model.modelId, model.displayName, model.contextWindow, model.maxOutputTokens, model.reasoningLevels], ['focus-model-edited', '中文模型', 200000, 16384, ['none','low','medium','high']]);
  passed.push('Chromium IME composition survives background approval sync and commits the Chinese model name');

  await key('Escape', 'Escape'); await until('!document.querySelector(".settings-workspace")');
  await openSettings();
  await key('Tab', 'Tab');
  assert.equal(await renderer.evaluate('document.activeElement===document.querySelector(".settings-content__header button")'), false);
  await renderer.evaluate('document.querySelector(".settings-content__header button").click();true');
  await until('!document.querySelector(".settings-workspace")');
  passed.push('Opening and reopening set initial keyboard focus once; Tab, Escape and the close button still work');

  await renderer.evaluate(`document.querySelector('.desktop-caption__actions button[aria-label="中文 / English"]').click();document.documentElement.dataset.theme='day';true`);
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await openSettings(); await click('.settings-nav__item', 'Providers and models');
  await click('.provider-toolbar button', 'Add provider');
  await typeField('.provider-form .field:nth-child(2) input', 'English input across polling', 150);
  await shot('settings-focus-en-day');
  const bounds = await renderer.evaluate('(()=>{const r=document.querySelector(".settings-workspace").getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()');
  assert.ok(bounds.top >= 0 && bounds.left >= 0 && bounds.right <= bounds.w && bounds.bottom <= bounds.h && !bounds.overflow);
  passed.push('English/day continuous input stays focused at 1040x680 without layout overflow');
  assert.equal((await renderer.evaluate('window.mingshen.getAppInfo()')).version, version);
  for (const kind of ['terms','privacy','disclaimer','manual']) for (const locale of ['zh-CN','en'])
    assert.ok((await renderer.evaluate(`window.mingshen.readPolicy(${JSON.stringify(kind)},${JSON.stringify(locale)})`)).includes(version), `${kind}/${locale} must show ${version}`);
  for (const locale of ['zh-CN','en']) assert.ok((await renderer.evaluate(`window.mingshen.readPolicy('changelog',${JSON.stringify(locale)})`)).includes(`## ${version}`));
  assert.deepEqual(errors, []);
  passed.push('Runtime and all ten embedded documents match the workspace version; no uncaught renderer exceptions');
  console.log(JSON.stringify({ version, passed, screenshots }, null, 2));
} finally {
  if (renderer) await renderer.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close(); main?.close();
  if (child && child.exitCode === null) {
    await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
    if (child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  }
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
