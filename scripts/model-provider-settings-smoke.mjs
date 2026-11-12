import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-model-provider-settings-'));
const profile = resolve(temporary, 'profile');
const project = resolve(temporary, 'project');
const screenshots = resolve(process.env.MSH_SCREENSHOT_DIR || '.impeccable/review');
const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const passed = [], errors = [], requests = [], held = [];
const rendererPort = 9447, mainPort = 9448;
const root = '.provider-list > div:not([hidden])';
const modelForm = `${root} .model-form`;
const connectionForm = `${root} .provider-connection-settings`;
const modelIdInput = `${modelForm} .form-grid--two > .field:nth-child(1) input`;
const contextInput = `${modelForm} input[name=contextWindow]`;
const outputInput = `${modelForm} input[name=maxOutputTokens]`;
const reasoningInput = `${modelForm} input[placeholder="none,low,medium,high,xhigh,max"]`;
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, main, renderer, holdActor = false;

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url.endsWith('/models')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'deepseek-v4.1-discovered-ui' }, { id: 'gpt-6.1-discovered-ui' }, { id: 'unrelated-discovered-ui' }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const instructions = typeof body.instructions === 'string' ? body.instructions : JSON.stringify(body.system ?? body.messages?.[0] ?? '');
    const auxiliary = instructions.includes('会话标题生成');
    if (!auxiliary) requests.push({ path: request.url, model: body.model, authorization: request.headers.authorization });
    const finish = () => {
      if (response.destroyed) return;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
      const text = auxiliary ? 'Model settings fixture' : 'Local provider configuration verified.';
      if (request.url.endsWith('/messages')) {
        event({ type: 'message_start', message: { id: 'fixture-message', type: 'message', role: 'assistant', model: body.model, usage: { input_tokens: 100, output_tokens: 12 } } });
        event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
        event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } });
        event({ type: 'message_stop' });
      } else if (request.url.endsWith('/chat/completions')) {
        event({ choices: [{ delta: { content: text }, finish_reason: null }] });
        event({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 12 } });
        response.write('data: [DONE]\n\n');
      } else {
        event({ type: 'response.output_text.delta', delta: text });
        event({ type: 'response.completed', response: { id: 'fixture-response', status: 'completed', output: [], usage: { input_tokens: 100, output_tokens: 12 } } });
      }
      response.end();
    };
    if (!auxiliary && holdActor) held.push(finish);
    else finish();
  } catch (cause) {
    errors.push(String(cause));
    response.destroy();
  }
});

async function available(port) {
  const probe = createNetServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
  await new Promise(done => probe.close(done));
}
async function connect(port) {
  let target;
  for (let index = 0; index < 150; index++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(result => result.json())).find(item => item.webSocketDebuggerUrl); if (target) break; } catch {}
    await sleep(80);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 40000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}
async function waitFor(check, label, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(60);
  }
  throw new Error(`Timed out: ${label}`);
}
const until = expression => waitFor(() => renderer.evaluate(expression), expression);
async function click(selector, text) {
  const target = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&!e.disabled${text === undefined ? '' : `&&e.textContent.trim()===${JSON.stringify(text)}`})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}
async function input(selector, value) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select();return true})()`);
  await renderer.send('Input.insertText', { text: value });
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), value);
}
async function select(selector, value) {
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function launch() {
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__fixtureFetch=fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if(['127.0.0.1','localhost','[::1]'].includes(u.hostname))return globalThis.__fixtureFetch(input,options);if(u.pathname.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));return Promise.reject(new Error('Nonlocal network blocked by model-settings fixture'));};true`);
  renderer = await connect(rendererPort);
  await renderer.send('Runtime.enable');
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
}
async function stopApp() {
  const current = child;
  if (!current) return;
  const exited = current.exitCode !== null || current.signalCode !== null;
  const ended = exited ? Promise.resolve() : new Promise(done => current.once('exit', done));
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close();
  main?.close();
  renderer = undefined;
  main = undefined;
  await Promise.race([ended, sleep(7000)]);
  if (current.pid && current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(7000)]);
    assert.ok(current.exitCode !== null || current.signalCode !== null, 'Fixture Electron process did not exit');
  }
  child = undefined;
}
async function openProvider(name, tab = 'models', english = false) {
  if (!(await renderer.evaluate('Boolean(document.querySelector(".settings-content"))'))) {
    await click('.app-topbar button[aria-label="打开设置"], .app-topbar button[aria-label="Open settings"]');
  }
  await click('.settings-nav__item', english ? 'Providers and models' : '供应商与模型');
  const target = `[...document.querySelectorAll('.provider-master button')].find(e=>e.getClientRects().length&&e.querySelector('strong')?.textContent===${JSON.stringify(name)})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
  await click(`${root} .provider-detail-tabs button`, tab === 'models' ? (english ? 'Models' : '模型') : (english ? 'Connection' : '连接'));
}
const providerState = providerId => renderer.evaluate(`window.mingshen.bootstrap().then(s=>s.providers.find(p=>p.id===${JSON.stringify(providerId)}))`);
const sessionState = sessionId => renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(sessionId)})`);
async function newModel(english = false) {
  await click(`${root} .provider-models__heading button`, english ? 'Add manually' : '手动添加');
  await until(`Boolean(document.querySelector(${JSON.stringify(modelForm)}))`);
}
async function closeModel() {
  await click(`${modelForm} .model-form__heading button`);
  await until(`!document.querySelector(${JSON.stringify(modelForm)})`);
}
async function modelDraftState() {
  return renderer.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(modelForm)});return {modelId:f.querySelector('.form-grid--two > .field:nth-child(1) input').value,contextWindow:f.querySelector('[name=contextWindow]').value,maxOutputTokens:f.querySelector('[name=maxOutputTokens]').value,reasoningLevels:f.querySelector('[placeholder="none,low,medium,high,xhigh,max"]').value,inputModalities:[...f.querySelectorAll('.check-grid .check-row')].filter(e=>e.querySelector('input')?.checked).map(e=>e.querySelector('span')?.textContent).filter(e=>['text','image','audio','video','file'].includes(e)),billing:f.querySelector('.field-group > .check-row input')?.checked??null}})()`);
}
async function saveModel(providerId, expectedId) {
  await click(`${modelForm} button[type=submit]`);
  await until(`!document.querySelector(${JSON.stringify(modelForm)})`);
  const state = await providerState(providerId);
  const model = state.models.find(item => item.modelId === expectedId);
  assert.ok(model, `Saved model ${expectedId} is missing`);
  return model;
}
async function editModel(modelId, english = false) {
  const target = `[...document.querySelectorAll(${JSON.stringify(`${root} .model-row`)})].find(e=>e.querySelector('.model-row__identity code')?.textContent===${JSON.stringify(modelId)})?.querySelector('button[title=${JSON.stringify(english ? 'Edit model' : '编辑模型')}]')`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
  await until(`Boolean(document.querySelector(${JSON.stringify(modelForm)}))`);
}
async function saveConnection() {
  await click(`${connectionForm} button[type=submit]`);
  await until(`Boolean(document.querySelector(${JSON.stringify(`${connectionForm} .form-actions [role=status]`)}))`);
}
async function run(session, text) {
  const before = requests.length;
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(text)}})`);
  await until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>!['running','waiting_approval'].includes(s.status))`);
  assert.equal((await sessionState(session.id)).status, 'idle');
  assert.equal(requests.length, before + 1, 'Expected one ordinary local fixture request');
  return requests.at(-1);
}
async function inspectForm(selector) {
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'});true`);
  const result = await renderer.evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(selector)}),s=document.querySelector('.settings-content');const labels=[...f.querySelectorAll('.field > span,.check-row > span,.btn')].filter(e=>e.getClientRects().length);return {width:innerWidth,height:innerHeight,overflow:s.scrollWidth>s.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,clipped:labels.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent),text:f.innerText}})()`);
  assert.equal(result.width, 1040);
  assert.equal(result.height, 680);
  assert.equal(result.overflow, false);
  assert.deepEqual(result.clipped, []);
  return result.text;
}
async function shot(name) {
  await sleep(150);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}

try {
  await available(rendererPort);
  await available(mainPort);
  await mkdir(project, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const changedUrl = `http://127.0.0.1:${server.address().port}/gateway/v1`;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch();
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  await until('!document.querySelector(".policy-dialog")');
  const fixture = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Model settings fixture',baseUrl:${JSON.stringify(baseUrl)},protocol:'openai_responses',authMode:'bearer',apiKey:'local-model-settings-fixture',keyLabel:'Fixture key',neverReveal:true,promptCaching:{mode:'openai',ttl:'5m',modelFamily:'openai'}});
    await window.mingshen.createModel({providerId:p.id,modelId:'gpt-6.1-existing-custom',displayName:'Existing custom GPT',contextWindow:77000,maxOutputTokens:1234,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:['low'],anthropicNoneBehavior:'disabled'});
    const result=await window.mingshen.createModel({providerId:p.id,modelId:'local-settings-runner',displayName:'Local settings runner',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const model=result.models.find(m=>m.modelId==='local-settings-runner');
    const session=await window.mingshen.createSession({title:'Settings persistence fixture',providerId:p.id,modelId:model.id,workspacePath:${JSON.stringify(project)},memoryBackend:'native',permissionMode:'request_approval',reasoningLevel:null});
    await window.mingshen.setProjectMemoryEnabled(session.id,false);
    for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);
    const settings=(await window.mingshen.getTokenSaver()).settings;
    await window.mingshen.setTokenSaver({...settings,historySummaries:false});
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    return {provider:result,session};
  })()`);
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))');
  await openProvider(fixture.provider.name);

  await newModel();
  await input(modelIdInput, 'gpt-6');
  assert.deepEqual(await modelDraftState(), { modelId: 'gpt-6', contextWindow: '1000000', maxOutputTokens: '128000', reasoningLevels: 'none,low,medium,high,xhigh,max', inputModalities: ['text','image','file'], billing: false });
  await input(outputInput, '64K');
  await click(`${modelForm} .field-group > .check-row input`);
  assert.deepEqual([(await modelDraftState()).contextWindow, (await modelDraftState()).maxOutputTokens, (await modelDraftState()).billing], ['200000','64K',true]);
  await click(`${modelForm} .field-group > .check-row input`);
  assert.deepEqual([(await modelDraftState()).contextWindow, (await modelDraftState()).maxOutputTokens], ['1000000','64K']);
  await input(contextInput, '350k');
  await input(reasoningInput, 'high');
  await renderer.evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(`${modelForm} .check-grid .check-row`)})].find(e=>e.querySelector('span')?.textContent==='image');e.querySelector('input').click();return true})()`);
  await input(modelIdInput, 'deepseek-same-draft');
  assert.deepEqual(await modelDraftState(), { modelId: 'deepseek-same-draft', contextWindow: '350k', maxOutputTokens: '64K', reasoningLevels: 'high', inputModalities: ['text','file'], billing: null });
  await input(modelIdInput, 'gpt-6.1-manual-ui');
  const gpt = await saveModel(fixture.provider.id, 'gpt-6.1-manual-ui');
  assert.deepEqual([gpt.contextWindow,gpt.maxOutputTokens,gpt.inputModalities,gpt.reasoningLevels], [350000,64000,['text','file'],['high']]);
  passed.push('Manual GPT prefix presets run once; billing toggles change only context, and later ID/modality/reasoning/limit edits survive and persist');

  await editModel('gpt-6.1-existing-custom');
  const existingDraft = await modelDraftState();
  assert.deepEqual([existingDraft.contextWindow,existingDraft.maxOutputTokens,existingDraft.reasoningLevels,existingDraft.inputModalities,existingDraft.billing], ['77000','1234','low',['text'],null]);
  await input(modelIdInput, 'gpt-6.1-existing-renamed');
  assert.deepEqual([(await modelDraftState()).contextWindow,(await modelDraftState()).maxOutputTokens], ['77000','1234']);
  await closeModel();
  await newModel();
  await input(modelIdInput, 'vendor/gpt-6.1');
  assert.deepEqual(await modelDraftState(), { modelId: 'vendor/gpt-6.1', contextWindow: '128000', maxOutputTokens: '8192', reasoningLevels: 'none,low,medium,high,xhigh,max', inputModalities: ['text','image'], billing: null });
  await closeModel();
  passed.push('Existing custom GPT models never receive creation presets; unrelated model IDs retain the original defaults');

  await click(`${root} .provider-models__heading button`, '拉取模型列表');
  await click(`${root} .discovered-models button`, 'deepseek-v4.1-discovered-ui');
  assert.deepEqual(await modelDraftState(), { modelId: 'deepseek-v4.1-discovered-ui', contextWindow: '1000000', maxOutputTokens: '384000', reasoningLevels: 'low,high,max', inputModalities: ['text','image','file'], billing: null });
  await input(contextInput, '1.5M');
  await input(outputInput, '384k');
  const deepseek = await saveModel(fixture.provider.id, 'deepseek-v4.1-discovered-ui');
  assert.deepEqual([deepseek.contextWindow,deepseek.maxOutputTokens,deepseek.reasoningLevels], [1500000,384000,['low','high','max']]);
  passed.push('The real HTTP model-discovery path opens DeepSeek presets and saves decimal uppercase M and lowercase k as exact numeric limits');

  const modelCount = (await providerState(fixture.provider.id)).models.length;
  await newModel();
  await input(modelIdInput, 'integer-input-ui');
  await input(contextInput, '100g');
  await input(outputInput, '0');
  await click(`${modelForm} button[type=submit]`);
  await until(`document.querySelector(${JSON.stringify(contextInput)})?.getAttribute('aria-invalid')==='true'`);
  assert.deepEqual([(await modelDraftState()).contextWindow,(await modelDraftState()).maxOutputTokens], ['100g','0']);
  assert.equal(await renderer.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(contextInput)})`), true);
  assert.equal((await providerState(fixture.provider.id)).models.length, modelCount);
  await input(contextInput, '1.001K');
  await input(outputInput, '1');
  const integer = await saveModel(fixture.provider.id, 'integer-input-ui');
  assert.deepEqual([integer.contextWindow,integer.maxOutputTokens], [1001,1]);
  passed.push('Invalid units and zero show inline errors, preserve the draft, focus the first invalid field and create nothing; 1.001K saves exactly 1001');

  await openProvider(fixture.provider.name, 'connection');
  await input(`${connectionForm} input[name=providerName]`, 'Edited local settings gateway');
  await input(`${connectionForm} input[name=providerBaseUrl]`, changedUrl);
  await select(`${connectionForm} select[name=providerProtocol]`, 'anthropic_messages');
  await saveConnection();
  const changed = await providerState(fixture.provider.id);
  assert.deepEqual([changed.name,changed.baseUrl,changed.protocol,changed.authMode], ['Edited local settings gateway',changedUrl,'anthropic_messages',fixture.provider.authMode]);
  assert.deepEqual(changed.keys, fixture.provider.keys);
  assert.deepEqual(changed.models.map(m=>m.id).sort(), [...fixture.provider.models.map(m=>m.id),gpt.id,deepseek.id,integer.id].sort());
  assert.deepEqual(changed.promptCaching, { mode: 'auto', ttl: '5m', modelFamily: 'openai' });
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${root} .provider-cache-settings select[name=cacheMode]`)}).value`), 'auto');
  const sessionAfterEdit = await sessionState(fixture.session.id);
  assert.deepEqual([sessionAfterEdit.id,sessionAfterEdit.providerId,sessionAfterEdit.modelId,sessionAfterEdit.workspacePath], [fixture.session.id,fixture.session.providerId,fixture.session.modelId,fixture.session.workspacePath]);
  const anthropicRequest = await run(fixture.session, 'Verify the edited local Anthropic endpoint without tools.');
  assert.equal(anthropicRequest.path, '/gateway/v1/messages');
  assert.equal(anthropicRequest.authorization, 'Bearer local-model-settings-fixture');
  passed.push('Connection editing preserves key/model/session identities and authentication, resets incompatible cache mode and routes an actual local request to the new API');

  await input(`${connectionForm} input[name=providerBaseUrl]`, `${changedUrl}?invalid=1`);
  await click(`${connectionForm} button[type=submit]`);
  await until(`Boolean(document.querySelector(${JSON.stringify(`${connectionForm} [role=alert]`)}))`);
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${connectionForm} input[name=providerBaseUrl]`)}).value`), `${changedUrl}?invalid=1`);
  assert.equal((await providerState(fixture.provider.id)).baseUrl, changedUrl);
  await input(`${connectionForm} input[name=providerBaseUrl]`, changedUrl);
  holdActor = true;
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.session.id)},text:'Keep this local request open for the active-run edit test.'})`);
  await waitFor(() => held.length > 0, 'held local model request');
  await input(`${connectionForm} input[name=providerBaseUrl]`, baseUrl);
  await click(`${connectionForm} button[type=submit]`);
  await until(`document.querySelector(${JSON.stringify(`${connectionForm} [role=alert]`)})?.textContent.includes('等待所有会话')`);
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(`${connectionForm} input[name=providerBaseUrl]`)}).value`), baseUrl);
  assert.equal((await providerState(fixture.provider.id)).baseUrl, changedUrl);
  holdActor = false;
  held.splice(0).forEach(finish => finish());
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.session.id)}).then(s=>s.status==='idle')`);
  await input(`${connectionForm} input[name=providerBaseUrl]`, changedUrl);
  await select(`${connectionForm} select[name=providerProtocol]`, 'openai_chat_completions');
  await saveConnection();
  const completionRequest = await run(fixture.session, 'Verify the edited local Chat Completions endpoint without tools.');
  assert.equal(completionRequest.path, '/gateway/v1/chat/completions');
  assert.equal(completionRequest.authorization, 'Bearer local-model-settings-fixture');
  passed.push('Invalid endpoint and active-run edits are rejected visibly without losing drafts or changing stored settings; after the run, the same UI can save another protocol');

  for (const [locale, theme] of [['zh-CN','night'],['zh-CN','day'],['en','day'],['en','night']]) {
    const english = locale === 'en';
    await renderer.evaluate(`window.mingshen.desktopAction('locale',${JSON.stringify(locale)}).then(()=>{localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});localStorage.setItem('mingshen.theme',${JSON.stringify(theme)})})`);
    await renderer.send('Page.reload');
    await until('Boolean(document.querySelector(".composer"))');
    await openProvider('Edited local settings gateway', 'connection', english);
    const connectionText = await inspectForm(connectionForm);
    if (english) { assert.match(connectionText, /Save connection/); assert.doesNotMatch(connectionText, /[\u4e00-\u9fff]/); }
    else assert.match(connectionText, /保存连接/);
    const captureConnection = (locale === 'zh-CN' && theme === 'day') || (english && theme === 'night');
    if (captureConnection) await shot(`v130-model-provider-${english ? 'en' : 'zh'}-${theme}`);
    await openProvider('Edited local settings gateway', 'models', english);
    await newModel(english);
    await input(modelIdInput, 'gpt-6.1-localized-ui');
    const modelText = await inspectForm(modelForm);
    if (english) { assert.match(modelText, /long-context billing/); assert.match(modelText, /Accepts K\/k/); assert.doesNotMatch(modelText, /[\u4e00-\u9fff]/); }
    else assert.match(modelText, /GPT厂商是否开启了长上下文计费/);
    if (!captureConnection) await shot(`v130-model-provider-${english ? 'en' : 'zh'}-${theme}`);
    await closeModel();
  }
  passed.push('Both forms pass DOM overflow/text checks at 1040x680 in Chinese/English and day/night; four theme/locale screenshots are captured for visual review');

  const persisted = await providerState(fixture.provider.id);
  await stopApp();
  await launch();
  await until('Boolean(document.querySelector(".composer"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-dialog"))'), false);
  const restored = await providerState(fixture.provider.id);
  for (const field of ['id','name','baseUrl','protocol','authMode','customHeaderName','keys','models','promptCaching']) assert.deepEqual(restored[field], persisted[field], `Restart changed ${field}`);
  const restoredSession = await sessionState(fixture.session.id);
  assert.deepEqual([restoredSession.id,restoredSession.providerId,restoredSession.modelId,restoredSession.workspacePath], [fixture.session.id,fixture.session.providerId,fixture.session.modelId,fixture.session.workspacePath]);
  const restartedRequest = await run(fixture.session, 'Continue the same local session after a real application restart.');
  assert.equal(restartedRequest.path, '/gateway/v1/chat/completions');
  assert.equal(restartedRequest.authorization, 'Bearer local-model-settings-fixture');
  assert.equal((await renderer.evaluate('window.mingshen.getAppInfo()')).version, version);
  assert.deepEqual(errors, []);
  passed.push('A real process restart preserves provider edits, all exact model limits and original session/key identities; the same session still authenticates against the edited local endpoint');
  console.log(JSON.stringify({ version, passed, actorRequests: requests.length, screenshots }, null, 2));
} catch (cause) {
  console.error(JSON.stringify({ passed, errors, body: await renderer?.evaluate('(document.querySelector(".settings-content")?.innerText||document.body.innerText).slice(0,10000)').catch(() => null) }, null, 2));
  if (renderer) await shot('v130-model-provider-failure').catch(() => {});
  throw cause;
} finally {
  holdActor = false;
  held.splice(0).forEach(finish => finish());
  await stopApp();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  assert.ok(temporary.startsWith(resolve(tmpdir()) + sep), 'Invalid fixture cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
