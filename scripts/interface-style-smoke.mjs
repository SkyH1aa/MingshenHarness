import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { experimentalExecutable } from './experimental-executable.mjs';

// This fixture never opens the normal profile or calls a remote model.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-interface-style-'));
const profile = resolve(temporary, 'profile');
const project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review', `v133-interface-style-${Date.now()}`);
const passed = [], errors = [], requests = [], captures = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, main, renderer, launchCount = 0;

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push(body);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    if ((body.instructions || '').includes('\u4f1a\u8bdd\u6807\u9898\u751f\u6210')) {
      event({ type: 'response.output_text.delta', delta: 'Interface verification' });
    } else {
      const busy = JSON.stringify(body).includes('INTERFACE_BUSY_FIXTURE');
      for (let index = 0; index < (busy ? 90 : 5) && !response.destroyed; index++) {
        if (!busy || index === 0 || index === 89) {
          event({
            type: 'response.output_text.delta',
            delta: `${busy ? 'Busy' : 'Verified'} local interface output ${index}.\n\n`,
          });
        } else if (index % 10 === 0) {
          event({ type: 'response.reasoning_summary_text.delta', delta: `Checking local workbench state ${index}.\n` });
        }
        await sleep(busy ? 100 : 30);
      }
    }
    if (!response.destroyed) {
      event({
        type: 'response.completed',
        response: { usage: { input_tokens: 2400, output_tokens: 300, total_tokens: 2700 } },
      });
      response.end();
    }
  } catch (cause) {
    if (!response.destroyed) {
      response.writeHead(500);
      response.end(String(cause));
    }
  }
});

async function availablePort() {
  const probe = createPortServer();
  await new Promise((done, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', done);
  });
  const port = probe.address().port;
  await new Promise((done, reject) => probe.close(cause => cause ? reject(cause) : done()));
  return port;
}

async function connect(port, surface) {
  let target;
  for (let index = 0; index < 160; index++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(value => value.json()))
        .find(item => item.webSocketDebuggerUrl && (surface !== 'renderer' || item.type === 'page'));
      if (target) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(target, `No ${surface} debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let next = 0;
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (surface === 'renderer' && value.method === 'Runtime.exceptionThrown') {
      errors.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    }
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id);
    clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++next;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method}`));
    }, 30000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) {
      throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    }
    return value.result.value;
  };
  const close = () => new Promise(done => {
    if (socket.readyState === WebSocket.CLOSED) return done();
    socket.addEventListener('close', done, { once: true });
    socket.close();
    setTimeout(done, 500).unref();
  });
  return { send, evaluate, close };
}

async function until(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      if (await renderer.evaluate(expression)) return;
    } catch (cause) {
      // A successful interface reload replaces the JavaScript context.
      if (!/context|navigat|reload|destroyed/i.test(String(cause))) throw cause;
      lastError = cause;
    }
    await sleep(70);
  }
  throw new Error(`Timed out: ${expression}${lastError ? ` (${lastError})` : ''}`);
}

async function untilMain(expression) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await main.evaluate(expression)) return;
    await sleep(70);
  }
  throw new Error(`Timed out in main: ${expression}`);
}

async function click(selector, text) {
  const candidates = `[...document.querySelectorAll(${JSON.stringify(selector)})]`;
  const target = `${candidates}.find(el=>!el.disabled${text === undefined ? '' : `&&el.textContent.trim()===${JSON.stringify(text)}`})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}

async function fill(selector, text) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select();return true})()`);
  if (text) await renderer.send('Input.insertText', { text });
  else {
    await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  }
}

async function viewport(width, height, scale = 1) {
  await renderer.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: false,
  });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  await sleep(180);
}

async function shot(name) {
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await until('[...document.querySelectorAll(".settings-workspace")].every(el=>el.getAnimations().every(a=>a.playState!=="running"))');
  await sleep(160);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(screenshots, `interface-style-${name}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  captures.push(path);
}

async function assertBounds() {
  const bounds = await renderer.evaluate(`(()=>{
    const box=selector=>{const rect=document.querySelector(selector)?.getBoundingClientRect();return rect?{x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}:null};
    return{style:document.documentElement.dataset.interfaceStyle,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,caption:box('.desktop-caption'),composer:box('.composer'),settings:box('.settings-workspace'),content:box('.settings-content'),shell:box('.app-shell')};
  })()`);
  assert.equal(bounds.overflow, false, JSON.stringify(bounds));
  if (bounds.style === 'orbit') {
    assert.ok(bounds.caption?.height >= 48 && bounds.caption.height <= 64, JSON.stringify(bounds));
  } else {
    assert.ok(bounds.caption?.height >= 40 && bounds.caption.height <= 64, JSON.stringify(bounds));
  }
  assert.ok(bounds.caption && bounds.caption.x >= 0 && bounds.caption.right <= bounds.width &&
    bounds.caption.bottom <= bounds.shell.y + 1, JSON.stringify(bounds));
  assert.ok(bounds.shell && bounds.shell.x >= -1 && bounds.shell.right <= bounds.width + 1, JSON.stringify(bounds));
  const visible = bounds.settings || bounds.composer;
  assert.ok(visible && visible.x >= -1 && visible.right <= bounds.width + 1 && visible.bottom <= bounds.height + 1, JSON.stringify(bounds));
  if (bounds.settings) {
    assert.equal(await renderer.evaluate(`(()=>{
      const el=document.querySelector('.settings-content');
      return el.scrollWidth>el.clientWidth+1;
    })()`), false, 'Settings content exceeds its horizontal bounds');
  }
  return bounds;
}

async function mode(value) {
  await click(`.app-topbar button[data-layout="${value}"], .orbit-workspace-header button[data-layout="${value}"]`);
  await until(`document.querySelector('.app-shell')?.dataset.layout===${JSON.stringify(value)}`);
}

async function openSettings() {
  if (await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))')) return;
  await click('.app-topbar button[aria-label="\u6253\u5f00\u8bbe\u7f6e"], .app-topbar button[aria-label="Open settings"], .orbit-tool-rail button[data-orbit-action="settings"]');
  await until('Boolean(document.querySelector(".interface-style-picker"))');
  await until('document.querySelector(".settings-workspace").getAnimations().every(a=>a.playState!=="running")');
}

async function closeSettings() {
  if (await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))')) {
    await click('.settings-content__header button');
    await until('!document.querySelector(".settings-workspace")');
  }
}

async function chooseStyle(value) {
  await openSettings();
  await click(`.interface-style-option[data-interface-style="${value}"] input[type="radio"]`);
  await until(`window.mingshen.getUiPreferences().then(p=>p.interfaceStyle===${JSON.stringify(value)})`);
}

async function applyStyle(value) {
  await renderer.evaluate('window.__interfaceStyleGeneration="old";true');
  await click('.interface-style-apply');
  await until(`document.documentElement?.dataset.interfaceStyle===${JSON.stringify(value)}&&!window.__interfaceStyleGeneration&&Boolean(document.querySelector(".composer textarea"))`);
}

async function preferences(patch) {
  await renderer.evaluate(`(async()=>window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),...${JSON.stringify(patch)}}))()`);
}

async function localeTheme(locale, theme) {
  await renderer.evaluate(`window.mingshen.desktopAction('locale',${JSON.stringify(locale)}).then(()=>{localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});localStorage.setItem('mingshen.theme',${JSON.stringify(theme)})})`);
  await renderer.evaluate('window.__localeThemeReloadPending=true;true');
  await renderer.send('Page.reload');
  await until('!window.__localeThemeReloadPending&&Boolean(document.querySelector(".composer textarea"))');
}

async function launch() {
  const mainPort = await availablePort();
  let rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const env = {
    ...process.env,
    MSH_EXPERIMENTAL: '1',
    MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1',
    MSH_NOTIFICATION_FIXTURE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(), [
    `--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`,
  ], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort, 'main');
  await main.evaluate(`globalThis.__interfaceFixtureFetch=fetch;
    globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')
      ?Promise.resolve(Response.json([])):globalThis.__interfaceFixtureFetch(url,options);true`);
  renderer = await connect(rendererPort, 'renderer');
  await renderer.send('Runtime.enable');
  launchCount++;
}

async function closeApplication() {
  if (!child) return;
  const closing = child;
  const exited = new Promise(done => closing.once('exit', done));
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  await renderer?.close();
  await main?.close();
  renderer = null;
  main = null;
  await Promise.race([exited, sleep(8000)]);
  assert.notEqual(closing.exitCode, null, 'Fixture application must quit cleanly before restart');
  child = null;
}

async function snapshot(fixture) {
  return renderer.evaluate(`(async()=>{
    const state=await window.mingshen.bootstrap();
    const session=await window.mingshen.getSession(${JSON.stringify(fixture.sessionId)});
    return{provider:state.providers.find(p=>p.id===${JSON.stringify(fixture.providerId)}),
      session:Object.fromEntries(['id','workspacePath','providerId','modelId','permissionMode','agentProfileId','reasoningLevel','memoryBackend'].map(k=>[k,session[k]])),
      messages:await window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)})};
  })()`);
}

function record(value) {
  passed.push(value);
  console.log(`PASS ${passed.length}: ${value}`);
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  await writeFile(resolve(project, 'interface-evidence.txt'), 'Local interface fixture evidence.\n');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], {
    windowsHide: true, stdio: 'pipe',
  });
  await launch();
  await until('Boolean(document.querySelector(".policy-consents"))');
  await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await click('.policy-dialog button', '\u540c\u610f\u5e76\u7ee7\u7eed');
  await click('.policy-dialog button', '\u5f00\u59cb\u4f7f\u7528');
  await until('!document.querySelector(".policy-dialog")');
  assert.equal(await renderer.evaluate('window.mingshen.getUiPreferences().then(p=>p.interfaceStyle)'), 'simple');
  await renderer.evaluate(`window.mingshen.saveUiPreferences({defaultLayout:'chat',motion:'system',projects:{}})`);
  await renderer.send('Page.reload');
  await until('document.documentElement?.dataset.interfaceStyle==="simple"');
  assert.equal(await renderer.evaluate('window.mingshen.getUiPreferences().then(p=>p.interfaceStyle)'), 'simple');
  record('Fresh and legacy preferences without interfaceStyle use the original simple interface');

  const fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Interface local fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-interface-fixture-only',keyLabel:'Fixture',neverReveal:true});
    const updated=await window.mingshen.createModel({providerId:provider.id,modelId:'interface-fixture',displayName:'Interface fixture model',contextWindow:128000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['none','low','high'],anthropicNoneBehavior:'disabled'});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    const session=await window.mingshen.createSession({title:'Interface style fixture',workspacePath:${JSON.stringify(project)},providerId:provider.id,modelId:updated.models[0].id,permissionMode:'full_access',reasoningLevel:null});
    await window.mingshen.setProjectMemoryEnabled(session.id,false);
    return{providerId:provider.id,sessionId:session.id};
  })()`);
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer textarea"))');
  await viewport(1440, 900);
  await assertBounds();
  await shot('simple-zh-night');

  await chooseStyle('orbit');
  assert.equal(await renderer.evaluate('document.documentElement.dataset.interfaceStyle'), 'simple');
  await shot('simple-pending-orbit-zh-night');
  await chooseStyle('simple');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".interface-style-apply:not(:disabled)"))'), false);
  await chooseStyle('orbit');
  await closeSettings();
  const reloadSource = '  # Interface draft\n\n**\u4fdd\u7559\u5168\u90e8\u539f\u6587** $x^2+1$\n\nKeep  interior  whitespace.\n  ';
  assert.deepEqual(await renderer.evaluate(`(()=>{
    const el=document.querySelector('.composer textarea');el.focus();
    const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(reloadSource)});
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    el.dispatchEvent(event);
    return{prevented:event.defaultPrevented,inserted:document.execCommand('insertText',false,${JSON.stringify(reloadSource)})};
  })()`), { prevented: false, inserted: true });
  await until('Boolean(document.querySelector(".composer-preview")?.getClientRects().length)');
  await click('.composer .extension-trigger');
  await until('Boolean(document.querySelector(".extension-panel input[type=file]"))');
  const { root: attachmentRoot } = await renderer.send('DOM.getDocument');
  const { nodeId: attachmentInput } = await renderer.send('DOM.querySelector', {
    nodeId: attachmentRoot.nodeId, selector: '.extension-panel input[type=file]',
  });
  assert.ok(attachmentInput, 'The real composer attachment picker must exist');
  await renderer.send('DOM.setFileInputFiles', {
    nodeId: attachmentInput, files: [resolve(project, 'interface-evidence.txt')],
  });
  await until('document.querySelectorAll(".draft-attachment").length===1');
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.sessionId)}).then(d=>d?.text===${JSON.stringify(reloadSource)}&&d.formatted&&d.attachments.length===1)`);
  const beforeReloadDraft = await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.sessionId)})`);
  assert.deepEqual(Buffer.from(beforeReloadDraft.attachments[0].dataUrl.split(',')[1], 'base64'),
    Buffer.from('Local interface fixture evidence.\n'));
  const requestsBeforeDraftReload = requests.length;
  await openSettings();
  await applyStyle('orbit');
  await until(`document.querySelector(".composer textarea")?.value===${JSON.stringify(reloadSource)}&&Boolean(document.querySelector(".composer-preview")?.getClientRects().length)&&document.querySelectorAll(".draft-attachment").length===1`);
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.sessionId)})`), beforeReloadDraft);
  assert.equal(requests.length, requestsBeforeDraftReload, 'Reload must not submit a draft to the model');
  await shot('orbit-restored-composer-preview-zh-night');
  record('Native settings radios persist a pending style, allow reverting, and apply only after explicit renderer reload');
  record('A real style reload restores exact draft whitespace, math-preview state and complete attachment bytes without sending');

  await main.evaluate(`globalThis.__interfaceDraftHandlers=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain._invokeHandlers;
    globalThis.__interfaceDraftSave=globalThis.__interfaceDraftHandlers.get('composer:draft-save');
    globalThis.__interfaceDraftHandlers.set('composer:draft-save',()=>{throw new Error('INTERFACE_DRAFT_SAVE_FAILURE_6a27')});true`);
  await click('.composer-format-switch button[aria-label="\u7f16\u8f91\u539f\u6587"]');
  const failedReloadSource = '  Keep the newer draft when style-reload storage fails.\n\n$x+2$  ';
  await fill('.composer textarea', failedReloadSource);
  await until('document.querySelector(".composer-error")?.textContent.includes("INTERFACE_DRAFT_SAVE_FAILURE_6a27")');
  await chooseStyle('simple');
  await renderer.evaluate('window.__failedDraftReloadSentinel=true;true');
  await click('.interface-style-apply');
  await until('document.querySelector(".interface-style-picker .form-error")?.textContent.includes("INTERFACE_DRAFT_SAVE_FAILURE_6a27")');
  assert.equal(await renderer.evaluate('window.__failedDraftReloadSentinel'), true);
  assert.equal(await renderer.evaluate('document.documentElement.dataset.interfaceStyle'), 'orbit');
  assert.equal(await renderer.evaluate('document.querySelector(".composer textarea").value'), failedReloadSource);
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.sessionId)})`), beforeReloadDraft);
  assert.equal(child.exitCode, null);
  await shot('orbit-failed-composer-save-guard-zh-night');
  await main.evaluate("globalThis.__interfaceDraftHandlers.set('composer:draft-save',globalThis.__interfaceDraftSave);true");
  await applyStyle('simple');
  await until(`document.querySelector(".composer textarea")?.value===${JSON.stringify(failedReloadSource)}&&document.querySelectorAll(".draft-attachment").length===1`);
  const retriedDraft = await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.sessionId)})`);
  assert.equal(retriedDraft.text, failedReloadSource);
  assert.equal(retriedDraft.formatted, false);
  assert.deepEqual(retriedDraft.attachments, beforeReloadDraft.attachments);
  assert.equal(requests.length, requestsBeforeDraftReload);
  await shot('simple-retried-composer-reload-zh-night');
  record('A failed draft save preserves the renderer and newer input; restoring storage lets the same Apply action save and reload successfully');

  await closeSettings();
  await fill('.composer textarea', '');
  await click('.draft-attachment button');
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.sessionId)}).then(d=>!d||(!d.text&&d.attachments.length===0))`);
  await until('!document.querySelector(\'[data-unsaved="true"]\')');
  await chooseStyle('orbit');
  await applyStyle('orbit');
  await renderer.evaluate(`(async()=>{const{interfaceStyle,...legacy}=await window.mingshen.getUiPreferences();await window.mingshen.saveUiPreferences(legacy)})()`);
  assert.equal(await renderer.evaluate('window.mingshen.getUiPreferences().then(p=>p.interfaceStyle)'), 'orbit');
  record('A legacy preference save that omits interfaceStyle preserves the already selected Orbit style');

  assert.equal(await renderer.evaluate(`(()=>{
    return [...document.querySelectorAll('section,article,[class*="memory"]')].some(el=>{
      const r=el.getBoundingClientRect();
      return r.width>240&&r.height>120&&/\\u672c\\u5730\\u8bb0\\u5fc6\\u5f15\\u64ce|Local memory engine/i.test(el.innerText||'');
    });
  })()`), false, 'The large local memory engine banner must be absent');
  await assertBounds();
  await shot('orbit-empty-zh-night');
  record('Orbit boots into its own workbench shell with no large local-memory banner');

  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.sessionId)},text:'Complete the local interface verification and keep the fixture evidence unchanged.'})`);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(s=>s.status==='idle')`);
  await until('document.querySelector(".conversation")?.textContent.includes("Verified local interface output 4.")');
  const baseline = await snapshot(fixture);
  assert.ok(baseline.messages.some(message => message.role === 'assistant'));
  await closeApplication();
  await launch();
  await until('document.documentElement?.dataset.interfaceStyle==="orbit"&&Boolean(document.querySelector(".composer textarea"))');
  assert.deepEqual(await snapshot(fixture), baseline);
  record('A real clean quit and fresh Electron process preserve Orbit, provider/model settings and exact stored messages');

  await renderer.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await renderer.evaluate(`(()=>{
    window.__firstStreamingFrame=null;
    let scheduled=false;
    const observer=new MutationObserver(()=>{
      const message=document.querySelector('.message--streaming');
      const content=message?.querySelector('.message__content');
      if(scheduled||!content?.textContent.trim())return;
      scheduled=true;
      requestAnimationFrame(()=>{
        let effectiveOpacity=1;
        for(let node=content;node;node=node.parentElement)effectiveOpacity*=Number(getComputedStyle(node).opacity);
        window.__firstStreamingFrame={messageOpacity:getComputedStyle(message).opacity,contentOpacity:getComputedStyle(content).opacity,effectiveOpacity,text:content.textContent};
        observer.disconnect();
      });
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    return true;
  })()`);
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.sessionId)},text:'INTERFACE_BUSY_FIXTURE: finish all local streaming output without interruption.'})`);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(s=>s.status==='running')`);
  await until('Boolean(window.__firstStreamingFrame)');
  const streamingFrame = await renderer.evaluate('window.__firstStreamingFrame');
  assert.equal(streamingFrame.messageOpacity, '1', JSON.stringify(streamingFrame));
  assert.equal(streamingFrame.contentOpacity, '1', JSON.stringify(streamingFrame));
  assert.equal(streamingFrame.effectiveOpacity, 1, JSON.stringify(streamingFrame));
  record('The first animation frame containing streamed text keeps message, content and effective ancestor opacity at 1');
  await until('document.querySelector(".chat-view")?.dataset.runState==="running"&&document.querySelector(".app-topbar")?.dataset.runState==="running"');
  await until('getComputedStyle(document.querySelector(".orbit-status-bar__state"),"::before").animationName==="orbit-status-breathe"');
  await shot('orbit-streaming-zh-night');
  await main.evaluate(`globalThis.__interfaceFixtureElectron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__interfaceFixtureWindow=globalThis.__interfaceFixtureElectron.BrowserWindow.getAllWindows()[0];globalThis.__interfaceFixtureWindow.hide();true`);
  await until('document.documentElement.dataset.pageVisible==="false"');
  assert.equal(await renderer.evaluate('getComputedStyle(document.querySelector(".orbit-status-bar__state"),"::before").animationPlayState'), 'paused');
  await main.evaluate('globalThis.__interfaceFixtureWindow.show();globalThis.__interfaceFixtureWindow.focus();true');
  await until('document.documentElement.dataset.pageVisible==="true"&&getComputedStyle(document.querySelector(".orbit-status-bar__state"),"::before").animationPlayState==="running"');
  record('Real streaming state activates the status signal; hiding the actual Electron window pauses animation and showing it resumes');
  await renderer.evaluate('window.__busyReloadSentinel=true;true');
  const busyError = await renderer.evaluate(`window.mingshen.reloadInterface().then(()=>'UNEXPECTED_SUCCESS',cause=>String(cause))`);
  assert.notEqual(busyError, 'UNEXPECTED_SUCCESS');
  assert.match(busyError, /running|busy|active|task|\u8fd0\u884c|\u4efb\u52a1|\u7ed3\u675f/i);
  assert.equal(await renderer.evaluate('window.__busyReloadSentinel'), true);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(s=>s.status==='idle')`);
  await until('document.querySelector(".conversation")?.textContent.includes("Busy local interface output 89.")');
  record('The guarded reload rejects an active task without replacing its renderer or interrupting local SSE completion');

  const messagesBeforeEdit = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)})`);
  await click('.message--user .message-action[aria-label="\u4fee\u6539\u6d88\u606f"]');
  await fill('.user-message-editor textarea', 'Unsaved history edit must remain local until submitted.');
  await until('Boolean(document.querySelector(\'.message--user[data-unsaved="true"]\'))');
  await chooseStyle('simple');
  await renderer.evaluate('window.__dirtyHistorySentinel=true;true');
  await click('.interface-style-apply');
  await until('Boolean(document.querySelector(".interface-style-picker .form-error")?.textContent.trim())');
  assert.equal(await renderer.evaluate('window.__dirtyHistorySentinel'), true);
  assert.equal(await renderer.evaluate('document.documentElement.dataset.interfaceStyle'), 'orbit');
  assert.equal(await renderer.evaluate('document.querySelector(".user-message-editor textarea").value'), 'Unsaved history edit must remain local until submitted.');
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)})`), messagesBeforeEdit);
  await shot('orbit-unsaved-history-guard-zh-night');
  await closeSettings();
  await click('.user-message-editor__actions button', '\u53d6\u6d88');
  await until('!document.querySelector(".user-message-editor")&&!document.querySelector(\'[data-unsaved="true"]\')');
  await chooseStyle('orbit');
  await closeSettings();
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)})`), messagesBeforeEdit);
  record('A pending history-message edit blocks style reload; cancel restores the original editor and leaves all stored messages unchanged');

  const requestsBeforePlanGuard = requests.length;
  const planBeforeDraft = await renderer.evaluate(`(async()=>{
    const current=await window.mingshen.getWorkbench(${JSON.stringify(fixture.sessionId)});
    return window.mingshen.updatePlan({
      sessionId:${JSON.stringify(fixture.sessionId)},revision:current.plan.revision,
      steps:[{id:crypto.randomUUID(),content:'Saved local plan before interface reload.',status:'pending',priority:'medium',dependsOn:[],updatedAt:new Date().toISOString()}]
    });
  })()`);
  await mode('agents');
  await until('document.querySelector(".task-workbench")?.dataset.taskView==="agents"');
  await click('[data-task-tab="plan"]');
  await until('document.querySelector(".plan-step strong")?.textContent.includes("Saved local plan before interface reload.")');
  await click('.task-workbench button[aria-label="\u7f16\u8f91\u8ba1\u5212"]');
  await fill('.plan-edit-row > input', 'Unsaved local plan draft must survive a rejected reload.');
  await until('Boolean(document.querySelector(\'.task-workbench[data-unsaved="true"]\'))');
  await chooseStyle('simple');
  await renderer.evaluate('window.__dirtyPlanSentinel=true;true');
  await click('.interface-style-apply');
  await until('Boolean(document.querySelector(".interface-style-picker .form-error")?.textContent.trim())');
  assert.equal(await renderer.evaluate('window.__dirtyPlanSentinel'), true);
  assert.equal(await renderer.evaluate('document.documentElement.dataset.interfaceStyle'), 'orbit');
  assert.equal(await renderer.evaluate('document.querySelector(".plan-edit-row > input").value'), 'Unsaved local plan draft must survive a rejected reload.');
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(fixture.sessionId)}).then(state=>state.plan)`), planBeforeDraft);
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)})`), messagesBeforeEdit);
  await shot('orbit-unsaved-plan-guard-zh-night');
  await closeSettings();
  await click('.plan-edit-actions button', '\u53d6\u6d88');
  await until('!document.querySelector(".plan-edit-row")&&!document.querySelector(\'.task-workbench[data-unsaved="true"]\')');
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(fixture.sessionId)}).then(state=>state.plan)`), planBeforeDraft);
  await chooseStyle('orbit');
  await closeSettings();
  assert.equal(requests.length, requestsBeforePlanGuard, 'Plan draft protection must not make a model request');
  record('An unsaved plan blocks style reload without changing the renderer, draft, saved plan or messages; cancelling clears its dirty marker');

  await fill('.composer textarea', '\u4e2d\u6587\u8349\u7a3f Interface draft');
  await renderer.evaluate('window.__styleComposer=document.querySelector(".composer textarea");true');
  for (const layout of ['code', 'agents', 'chat']) {
    await mode(layout);
    assert.equal(await renderer.evaluate('document.querySelector(".composer textarea")===window.__styleComposer&&window.__styleComposer.value==="\\u4e2d\\u6587\\u8349\\u7a3f Interface draft"'), true);
    await assertBounds();
  }
  await fill('.composer textarea', '');
  await mode('code');
  await click('.workspace-tabs [data-workspace-tab="files"], .workspace-tabs button[aria-label="Files"]');
  await until('Boolean(document.querySelector(".tree-row"))');
  await click('.tree-row');
  await until('Boolean(document.querySelector(".editor-textarea"))');
  const originalEditor = await renderer.evaluate('document.querySelector(".editor-textarea").value');
  await renderer.evaluate('window.__styleEditor=document.querySelector(".editor-textarea");window.__styleEditor.focus();window.__styleEditor.setSelectionRange(0,0);true');
  await renderer.send('Input.insertText', { text: 'Unsaved interface draft. ' });
  for (const layout of ['chat', 'agents', 'code']) await mode(layout);
  assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea")===window.__styleEditor&&window.__styleEditor.value.startsWith("Unsaved interface draft.")'), true);
  record('All three existing layouts keep the same composer/editor elements and preserve unsaved text within the shared interface');
  await chooseStyle('simple');
  await renderer.evaluate('window.__dirtyEditorSentinel=true;true');
  await click('.interface-style-apply');
  await until('Boolean(document.querySelector(".interface-style-picker .form-error")?.textContent.trim())');
  assert.equal(await renderer.evaluate('window.__dirtyEditorSentinel'), true);
  assert.equal(await renderer.evaluate('document.documentElement.dataset.interfaceStyle'), 'orbit');
  assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea").value.startsWith("Unsaved interface draft.")'), true);
  await shot('orbit-unsaved-editor-guard-zh-night');
  await closeSettings();
  await fill('.editor-textarea', originalEditor);
  await until('!document.querySelector(\'[data-unsaved="true"]\')');
  await chooseStyle('orbit');
  await closeSettings();
  record('Applying a pending style rejects an unsaved file editor and preserves its draft until explicitly restored');

  const lateEditorDraft = 'Unsaved file edit made while a style reload waits for composer storage.\n';
  const lateComposerDraft = 'Composer content waiting for a delayed local save.\n';
  const requestsBeforeLateEdit = requests.length;
  await main.evaluate(`globalThis.__interfaceDraftHandlers=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').ipcMain._invokeHandlers;
    globalThis.__interfaceDraftSave=globalThis.__interfaceDraftHandlers.get('composer:draft-save');
    globalThis.__interfaceReloadHandler=globalThis.__interfaceDraftHandlers.get('ui:reload-interface');
    globalThis.__interfaceDelayedSaves=[];globalThis.__interfaceReloadStarted=false;
    globalThis.__interfaceDraftHandlers.set('composer:draft-save',async(...args)=>{
      await new Promise(done=>globalThis.__interfaceDelayedSaves.push(done));
      return globalThis.__interfaceDraftSave(...args);
    });
    globalThis.__interfaceDraftHandlers.set('ui:reload-interface',(...args)=>{
      globalThis.__interfaceReloadStarted=true;
      return globalThis.__interfaceReloadHandler(...args);
    });true`);
  await fill('.composer textarea', lateComposerDraft);
  await untilMain('globalThis.__interfaceDelayedSaves.length>0');
  await chooseStyle('simple');
  await renderer.evaluate(`window.__lateEditorReloadSentinel=true;
    window.addEventListener('beforeunload',event=>{window.__lateEditorUnloadBlocked=event.defaultPrevented});
    true`);
  await click('.interface-style-apply');
  await untilMain('globalThis.__interfaceReloadStarted');
  await closeSettings();
  await fill('.editor-textarea', lateEditorDraft + originalEditor);
  await until('Boolean(document.querySelector(\'.workspace-panel[data-unsaved="true"]\'))||Boolean(document.querySelector(\'.workspace-pane[data-unsaved="true"]\'))||Boolean(document.querySelector(\'[data-unsaved="true"]\'))');
  await main.evaluate(`globalThis.__interfaceDraftHandlers.set('composer:draft-save',globalThis.__interfaceDraftSave);
    globalThis.__interfaceDraftHandlers.set('ui:reload-interface',globalThis.__interfaceReloadHandler);
    for(const done of globalThis.__interfaceDelayedSaves.splice(0))done();true`);
  await until('window.__lateEditorUnloadBlocked===true');
  assert.equal(await renderer.evaluate('window.__lateEditorReloadSentinel'), true);
  assert.equal(await renderer.evaluate('document.documentElement.dataset.interfaceStyle'), 'orbit');
  assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea").value'), lateEditorDraft + originalEditor);
  assert.equal(await readFile(resolve(project, 'interface-evidence.txt'), 'utf8'), originalEditor);
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.sessionId)}).then(d=>d?.text===${JSON.stringify(lateComposerDraft)})`);
  assert.equal(requests.length, requestsBeforeLateEdit);
  await shot('orbit-late-editor-unload-guard-zh-night');
  await fill('.editor-textarea', originalEditor);
  await fill('.composer textarea', '');
  await chooseStyle('simple');
  await applyStyle('simple');
  await chooseStyle('orbit');
  await applyStyle('orbit');
  record('An actual beforeunload blocks file edits created during a delayed composer save; drafts persist and a clean retry still applies the style');

  await mode('chat');
  await click('.chat-model-picker .model-picker__trigger');
  await until('Boolean(document.querySelector(".model-picker__panel"))');
  await shot('orbit-model-menu-zh-night');
  await click('.model-picker__model');
  await until('!document.querySelector(".model-picker__panel")');
  await openSettings();
  await assertBounds();
  await shot('orbit-appearance-zh-night');
  await closeSettings();
  record('The shared model menu, editor and settings remain functional under Orbit');

  for (const locale of ['zh-CN', 'en']) {
    for (const theme of ['night', 'day']) {
      await localeTheme(locale, theme);
      assert.equal(await renderer.evaluate('document.documentElement.dataset.interfaceStyle'), 'orbit');
      for (const layout of ['chat', 'code', 'agents']) {
        await viewport(1440, 900);
        await mode(layout);
        await assertBounds();
        await shot(`orbit-${layout}-${locale}-${theme}`);
      }
      await viewport(1040, 680, 1.25);
      await mode('chat');
      await assertBounds();
      await shot(`orbit-chat-${locale}-${theme}-compact`);
      await openSettings();
      await assertBounds();
      await shot(`orbit-settings-${locale}-${theme}-compact`);
      await closeSettings();
    }
  }
  record('Orbit renders all layouts in both languages and day/night themes, plus bounded compact workbench/settings screenshots');

  for (const [width, height, scale] of [[1440, 900, 1], [1040, 680, 1], [800, 600, 1], [1920, 1080, 2]]) {
    await viewport(width, height, scale);
    for (const layout of ['chat', 'code', 'agents']) {
      await mode(layout);
      await assertBounds();
    }
    await mode('chat');
    await shot(`orbit-bounds-${width}x${height}-${scale}x`);
  }
  await viewport(1440, 900);
  await renderer.evaluate('document.querySelector(".composer textarea").focus();true');
  const focused = await renderer.evaluate('getComputedStyle(document.querySelector(".composer")).borderColor');
  assert.equal(await renderer.evaluate('document.activeElement===document.querySelector(".composer textarea")'), true);
  const hoverPoint = await renderer.evaluate(`(()=>{
    const r=document.querySelector('.chat-model-picker .model-picker__trigger').getBoundingClientRect();
    return{x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint });
  await shot('orbit-focus-hover-en-day');
  assert.ok(focused, 'Focused composer must retain its computed focus treatment');
  record('Shell, composer and all layouts stay bounded at 800/1040/1440/1920 widths and 200% pixel scale; hover/focus remain usable');

  await preferences({ motion: 'off' });
  await renderer.send('Page.reload');
  await until('document.documentElement?.dataset.motion==="off"&&Boolean(document.querySelector(".composer"))');
  assert.equal(await renderer.evaluate('getComputedStyle(document.querySelector(".layout-picker button")).transitionDuration'), '0s');
  assert.equal(await renderer.evaluate('document.getAnimations().filter(a=>a.playState==="running").length'), 0);
  await preferences({ motion: 'system' });
  await renderer.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))&&matchMedia("(prefers-reduced-motion: reduce)").matches');
  assert.equal(await renderer.evaluate('document.getAnimations().filter(a=>a.playState==="running").length'), 0);
  await shot('orbit-reduced-motion-en-day');
  await renderer.send('Emulation.setEmulatedMedia', { features: [] });
  record('App motion-off and system reduced-motion stop the actual running UI animations');

  const afterBusy = await snapshot(fixture);
  await chooseStyle('simple');
  assert.equal(await renderer.evaluate('document.documentElement.dataset.interfaceStyle'), 'orbit');
  await applyStyle('simple');
  assert.deepEqual(await snapshot(fixture), afterBusy);
  await viewport(1040, 680, 1.25);
  await assertBounds();
  await shot('simple-restored-en-day-compact');
  await chooseStyle('orbit');
  await applyStyle('orbit');
  assert.deepEqual(await snapshot(fixture), afterBusy);
  assert.deepEqual(errors, []);
  record('Round-trip simple/Orbit reloads retain exact provider/model, permission, session and message data without renderer exceptions');
  const result = {
    version, passed, screenshots, captures, launchCount,
    localRequests: requests.length, rendererExceptions: errors,
    boundaries: [
      'Local SSE fixture, no paid model or private credentials',
      'Synthetic paste, owned-profile save failure and delayed-save editing race; no system clipboard or normal user data',
      'CDP pixel scale is not the complete Windows system-DPI matrix',
      'No installer generation, installation, upgrade or cloud writes',
    ],
  };
  await writeFile(resolve(screenshots, 'interface-style-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (cause) {
  if (renderer) await shot('failure').catch(() => {});
  console.error(JSON.stringify({
    passed, errors,
    body: await renderer?.evaluate('document.body.innerText').catch(() => null),
  }, null, 2));
  throw cause;
} finally {
  if (child) {
    const closing = child;
    const exited = new Promise(done => closing.once('exit', done));
    await main?.evaluate(`if(globalThis.__interfaceDraftSave)globalThis.__interfaceDraftHandlers.set('composer:draft-save',globalThis.__interfaceDraftSave);
      if(globalThis.__interfaceReloadHandler)globalThis.__interfaceDraftHandlers.set('ui:reload-interface',globalThis.__interfaceReloadHandler);
      for(const done of globalThis.__interfaceDelayedSaves?.splice(0)||[])done();true`).catch(() => {});
    await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
    await renderer?.close();
    await main?.close();
    await Promise.race([exited, sleep(7000)]);
    if (closing.exitCode === null) {
      closing.kill();
      await exited;
    }
  }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  const root = resolve(tmpdir()) + sep;
  if (!temporary.startsWith(root) || !temporary.slice(root.length).startsWith('mingshen-interface-style-')) {
    throw new Error('Unsafe fixture cleanup path');
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
