import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-native-gemini-'));
const profile = resolve(temporary, 'profile'), project = resolve(temporary, 'project');
const evidence = resolve('.impeccable/review', `v132-gemini-native-${Date.now()}`);
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const passed = [], errors = [], crashes = [], requests = [], outbound = [], images = [], geometry = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const quote = JSON.stringify;
const rendererPort = 9401, mainPort = 9402;
const providerName = 'Google native fixture', modelName = 'gemini-3-flash-preview';
const key = 'synthetic-native-gemini-key';
const parts = [
  { text: 'Inspecting two fixture files.', thought: true, thoughtSignature: 'fixture-thought' },
  { functionCall: { name: 'read_file', args: { path: 'alpha.txt' } }, thoughtSignature: 'fixture-first-call' },
  { functionCall: { id: 'fixture-wire-second', name: 'read_file', args: { path: 'beta.txt' } } },
  { text: '', thoughtSignature: 'fixture-trailing-signature' },
];
let child, main, renderer, provider, session, failure = null, scenario = 'text', scenarioRound = 0;
let normalExits = 0, forcedExits = 0, launches = 0, auxiliaryRequests = 0;
const connectionForm = '.provider-list > div:not([hidden]) .provider-connection-settings';
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.headers['x-goog-api-key'], key);
    assert.equal(request.headers.authorization, undefined);
    const url = new URL(request.url, 'http://fixture');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (request.method === 'GET') {
      assert.equal(url.pathname, '/v1beta/models');
      assert.equal(url.searchParams.get('pageSize'), '1000');
      const page = url.searchParams.get('pageToken');
      requests.push({ type: 'discovery', path: request.url });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(page
        ? { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }
        : { models: [{ name: `models/${modelName}`, supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-fixture', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'second page/+' }));
      if (page) assert.equal(page, 'second page/+');
      return;
    }
    assert.ok(body.contents?.length);
    assert.equal(body.model, undefined);
    assert.equal(body.messages, undefined);
    for (const field of ['stream', 'prompt_cache_key', 'cache_control', 'parallel_tool_calls', 'cachedContent'])
      assert.equal(body[field], undefined);
    if (url.pathname.endsWith(':generateContent')) {
      requests.push({ type: 'connection', path: request.url, body });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] }));
      return;
    }
    assert.equal(url.pathname, `/v1beta/models/${modelName}:streamGenerateContent`);
    assert.equal(url.searchParams.get('alt'), 'sse');
    const prompt = body.systemInstruction?.parts?.map(part => part.text ?? '').join('');
    const auxiliary = prompt?.includes('会话标题生成');
    if (auxiliary) auxiliaryRequests++;
    else requests.push({ type: 'agent', scenario, path: request.url, body });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    const candidate = (output, finishReason = 'STOP') =>
      event({ candidates: [{ index: 0, content: { role: 'model', parts: output }, finishReason }] });
    if (!auxiliary && scenario === 'tools' && scenarioRound++ === 0) {
      assert.ok(body.tools[0].functionDeclarations.some(tool => tool.name === 'read_file' && tool.parametersJsonSchema));
      candidate(parts.slice(0, 3));
      event({ candidates: [{ content: { parts: parts.slice(3) } }] });
    } else if (!auxiliary && scenario === 'incomplete') {
      candidate([{ functionCall: { name: 'read_file', args: { path: 'alpha.txt' } } }], 'MAX_TOKENS');
    } else candidate([{ text: auxiliary ? 'Native fixture' : 'Verified local Gemini response.',
      thoughtSignature: 'fixture-final-signature' }]);
    event({ usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 800,
      candidatesTokenCount: 12, thoughtsTokenCount: 8, totalTokenCount: 1020 } });
    response.end();
  } catch (cause) { errors.push(cause.stack ?? String(cause)); response.destroy(); }
});

async function available(port) {
  const probe = createNetServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', done); });
  await new Promise(done => probe.close(done));
}
async function connect(port) {
  let target;
  for (let index = 0; index < 150; index++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json())).find(item => item.webSocketDebuggerUrl); } catch {}
    if (target) break;
    await sleep(80);
  }
  assert.ok(target, `No debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let sequence = 0;
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails.exception?.description ?? value.params.exceptionDetails.text);
    if (value.method === 'Inspector.targetCrashed') crashes.push(value.params);
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id); clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 40000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}
async function until(expression, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await renderer.evaluate(expression)) return;
    await sleep(80);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector, text) {
  const target = `[...document.querySelectorAll(${quote(selector)})].find(e=>e.getClientRects().length&&!e.disabled${text === undefined ? '' : `&&e.textContent.trim()===${quote(text)}`})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}
async function fill(selector, value) {
  await renderer.evaluate(`(()=>{const e=document.querySelector(${quote(selector)});e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${quote(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
}
async function select(selector, value) {
  await renderer.evaluate(`(()=>{const e=document.querySelector(${quote(selector)});e.value=${quote(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function launch() {
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),
    [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`],
    { cwd: resolve('apps/desktop'), env, stdio: 'ignore', windowsHide: true });
  launches++;
  main = await connect(mainPort);
  const local = `http://127.0.0.1:${server.address().port}`;
  await main.evaluate(`globalThis.__nativeOutbound=[];globalThis.__nativeFetch=fetch;globalThis.fetch=(url,options)=>{
    const address=typeof url==='string'?url:url instanceof URL?url.href:url.url;
    if(address.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));
    const parsed=new URL(address);
    if(parsed.origin==='https://generativelanguage.googleapis.com')return globalThis.__nativeFetch(${quote(local)}+parsed.pathname+parsed.search,options);
    if(parsed.origin!==${quote(local)}){globalThis.__nativeOutbound.push(parsed.origin);return Promise.reject(new Error('Unexpected fixture network'))}
    return globalThis.__nativeFetch(url,options)};true`);
  renderer = await connect(rendererPort);
  await renderer.send('Runtime.enable');
  await renderer.send('Inspector.enable');
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 760, deviceScaleFactor: 1, mobile: false });
}
async function stop() {
  if (!child) return;
  const current = child;
  outbound.push(...await main?.evaluate('globalThis.__nativeOutbound ?? []').catch(() => []) ?? []);
  const ended = current.exitCode === null ? new Promise(done => current.once('exit', done)) : Promise.resolve();
  await renderer?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true').catch(() => {});
  renderer?.close(); main?.close(); renderer = main = undefined;
  await Promise.race([ended, sleep(7000)]);
  if (current.exitCode === null && current.signalCode === null) {
    forcedExits++; current.kill(); await Promise.race([ended, sleep(7000)]);
    assert.ok(current.exitCode !== null || current.signalCode !== null);
  } else if (current.exitCode === 0) normalExits++;
  child = undefined;
}
async function reload() {
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))&&!document.querySelector(".policy-dialog")');
  await renderer.evaluate('globalThis.__nativeEvents=[];window.mingshen.onRuntimeEvent(event=>globalThis.__nativeEvents.push(event));true');
}
async function settings(english = false) {
  if (!await renderer.evaluate('Boolean(document.querySelector(".settings-content"))'))
    await click(`button[aria-label="${english ? 'Open settings' : '打开设置'}"]`);
  await click('.settings-nav__item', english ? 'Providers and models' : '供应商与模型');
}
async function connection(english = false) {
  await settings(english);
  await until(`Boolean([...document.querySelectorAll('.provider-master button')].find(e=>e.querySelector('strong')?.textContent===${quote(providerName)}))`);
  await renderer.evaluate(`[...document.querySelectorAll('.provider-master button')].find(e=>e.querySelector('strong')?.textContent===${quote(providerName)}).click();true`);
  await click('.provider-list > div:not([hidden]) .provider-detail-tabs button', english ? 'Connection' : '连接');
  await until(`Boolean(document.querySelector(${quote(connectionForm)}))`);
}
async function closeSettings() {
  if (await renderer.evaluate('Boolean(document.querySelector(".settings-content"))'))
    await click('.settings-content__header button');
}
async function shot(name, target = connectionForm) {
  await renderer.evaluate(`document.querySelector(${quote(target)})?.scrollIntoView({block:'start'});true`);
  await sleep(180);
  geometry.push(await renderer.evaluate(`(()=>{const e=document.querySelector(${quote(target)});const r=e.getBoundingClientRect();const container=document.querySelector('.settings-content')??document.documentElement;return {name:${quote(name)},width:innerWidth,height:innerHeight,left:r.left,right:r.right,scrollWidth:container.scrollWidth,clientWidth:container.clientWidth}})()`));
  const current = geometry.at(-1);
  assert.ok(current.left >= 0 && current.right <= current.width + 1);
  assert.ok(current.scrollWidth <= current.clientWidth + 1);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(evidence, `${name}.png`), Buffer.from(image.data, 'base64')); images.push(`${name}.png`);
}
async function run(text, expected = 'run_completed') {
  const result = await renderer.evaluate(`window.mingshen.sendChat({sessionId:${quote(session.id)},text:${quote(text)}})`);
  await until(`globalThis.__nativeEvents.some(e=>e.runId===${quote(result.runId)}&&['run_completed','run_failed','run_interrupted'].includes(e.type))`, 120000);
  const ending = await renderer.evaluate(`globalThis.__nativeEvents.find(e=>e.runId===${quote(result.runId)}&&['run_completed','run_failed','run_interrupted'].includes(e.type))`);
  assert.equal(ending.type, expected, JSON.stringify(ending));
  return renderer.evaluate(`window.mingshen.getSessionMessages(${quote(session.id)})`);
}
try {
  await mkdir(evidence, { recursive: true }); await mkdir(project);
  await writeFile(resolve(project, 'alpha.txt'), 'ALPHA_NATIVE_FIXTURE');
  await writeFile(resolve(project, 'beta.txt'), 'BETA_NATIVE_FIXTURE');
  await available(rendererPort); await available(mainPort);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch();
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  await until('!document.querySelector(".policy-dialog")');
  if (!await renderer.evaluate('Boolean(document.querySelector(".provider-form"))')) {
    await settings();
    await click('.provider-setup > .section-heading button, .provider-toolbar button', '添加供应商');
  }
  await fill('.provider-form input', providerName);
  await select('.provider-form select:not([name])', 'gemini_generate_content');
  await until('document.querySelector(".provider-form input[placeholder=\\"https://api.your-domain.com/v1\\"]").value==="https://generativelanguage.googleapis.com/v1beta"');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".provider-form select:not([name])")[1].value'), 'x_goog_api_key');
  await fill('.provider-form input[type=password]', key);
  await shot('create-zh-simple', '.provider-form');
  await click('.provider-form button[type=submit]');
  await until('!document.querySelector(".provider-form")');
  provider = await renderer.evaluate(`window.mingshen.bootstrap().then(s=>s.providers.find(p=>p.name===${quote(providerName)}))`);
  assert.equal(provider.protocol, 'gemini_generate_content');
  assert.equal(provider.authMode, 'x_goog_api_key');
  passed.push('Creation UI selects native protocol, default Google base and header, and persists a synthetic credential');
  const discovery = await renderer.evaluate(`window.mingshen.fetchProviderModels(${quote(provider.id)})`);
  assert.deepEqual(discovery.modelIds, ['gemini-2.5-flash', modelName]);
  assert.equal(requests.filter(r => r.type === 'discovery').length, 2);
  provider = await renderer.evaluate(`window.mingshen.createModel(${quote({
    providerId: provider.id, modelId: modelName, displayName: 'Gemini native fixture',
    contextWindow: 200000, maxOutputTokens: 4096, inputModalities: ['text', 'image', 'audio', 'file'],
    toolCalls: true, parallelToolCalls: true, reasoningLevels: ['auto', 'high'], anthropicNoneBehavior: 'disabled',
  })})`);
  assert.equal((await renderer.evaluate(`window.mingshen.testProvider(${quote(provider.id)},${quote(provider.models[0].id)})`)).ok, true);
  passed.push('Native paginated discovery filters embedding models and connection testing uses generateContent');
  session = await renderer.evaluate(`(async()=>{
    for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const s=await window.mingshen.createSession(${quote({
      title: 'Native Gemini tool fixture', providerId: provider.id, modelId: provider.models[0].id,
      workspacePath: project, permissionMode: 'full_access', executionMode: 'host', reasoningLevel: 'high',
    })});
    await window.mingshen.setProjectMemoryEnabled(s.id,false);
    const settings=(await window.mingshen.getTokenSaver()).settings;await window.mingshen.setTokenSaver({...settings,historySummaries:false});
    return s;
  })()`);
  await reload();
  scenario = 'tools'; scenarioRound = 0;
  let messages = await run('Read alpha.txt and beta.txt and verify the two fixture values.');
  const agent = requests.filter(r => r.type === 'agent');
  assert.equal(agent.length, 2);
  const signed = agent[1].body.contents.find(content => content.role === 'model' && content.parts.some(p => p.functionCall));
  assert.deepEqual(signed, { role: 'model', parts });
  const results = agent[1].body.contents.flatMap(c => c.parts).filter(p => p.functionResponse).map(p => p.functionResponse);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, undefined); assert.equal(results[1].id, 'fixture-wire-second');
  assert.match(results[0].response.output, /ALPHA_NATIVE_FIXTURE/);
  assert.match(results[1].response.output, /BETA_NATIVE_FIXTURE/);
  assert.equal(messages.flatMap(m => m.parts).filter(p => p.type === 'provider_state').length, 2);
  passed.push('Real Agent executes two same-name read_file calls, retains signed Parts and pairs ordered native responses');
  const usage = await renderer.evaluate(`window.mingshen.getTokenSaver(${quote(session.id)})`);
  assert.equal(usage.cacheDiagnostics.agent.cachedInputTokens, 800);
  assert.equal(usage.cacheDiagnostics.agent.cacheOutcome, 'partial');
  passed.push('Native cached-content and thinking usage reach the existing Token Saver diagnostics');
  await stop(); await launch(); await reload();
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-dialog"))'), false);
  const restored = await renderer.evaluate(`window.mingshen.bootstrap().then(s=>s.providers.find(p=>p.id===${quote(provider.id)}))`);
  assert.equal(restored.authMode, 'x_goog_api_key'); assert.equal(restored.models[0].id, provider.models[0].id);
  scenario = 'text';
  await run('Continue after restart using the verified file contents.');
  const restartBody = requests.filter(r => r.type === 'agent').at(-1).body;
  assert.deepEqual(restartBody.contents.find(c => c.role === 'model' && c.parts.some(p => p.functionCall)), signed);
  assert.ok(restartBody.contents.some(c => c.parts.some(p => p.thoughtSignature === 'fixture-final-signature')));
  passed.push('Normal application restart preserves native provider, model, credential and exact signed continuation');
  scenario = 'incomplete';
  const before = await renderer.evaluate(`window.mingshen.getSessionMessages(${quote(session.id)})`);
  messages = await run('Check incomplete output handling.', 'run_failed');
  const added = messages.filter(m => !before.some(old => old.id === m.id)).flatMap(m => m.parts);
  assert.equal(added.some(p => p.type === 'tool_result' || p.type === 'provider_state'), false);
  passed.push('Output exhaustion fails visibly without executing the incomplete tool or persisting its native state');
  for (const [style, locale, theme, width] of [
    ['simple', 'zh-CN', 'night', 1040], ['simple', 'en', 'day', 800],
    ['orbit', 'zh-CN', 'day', 800], ['orbit', 'en', 'night', 1040],
  ]) {
    await closeSettings();
    await renderer.evaluate(`(async()=>{await window.mingshen.desktopAction('locale',${quote(locale)});
      localStorage.setItem('mingshen.locale',${quote(locale)});localStorage.setItem('mingshen.theme',${quote(theme)});
      await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:${quote(style)}})})()`);
    await reload();
    await until(`document.documentElement.dataset.interfaceStyle===${quote(style)}`);
    await renderer.send('Emulation.setDeviceMetricsOverride', { width, height: 760, deviceScaleFactor: 1, mobile: false });
    await connection(locale === 'en');
    assert.equal(await renderer.evaluate(`document.querySelector(${quote(connectionForm + ' select[name=providerProtocol]')}).value`), 'gemini_generate_content');
    assert.equal(await renderer.evaluate(`document.querySelector(${quote(connectionForm + ' select[name=providerAuthMode]')}).value`), 'x_goog_api_key');
    await shot(`connection-${style}-${locale}-${theme}-${width}`);
    if (locale === 'en') assert.doesNotMatch(await renderer.evaluate(`document.querySelector(${quote(connectionForm)}).innerText`), /[\u4e00-\u9fff]/);
    const family = '.provider-list > div:not([hidden]) select[name=cacheFamily]';
    assert.equal(await renderer.evaluate(`document.querySelector(${quote(family)}).value`), 'gemini');
    assert.equal(await renderer.evaluate(`document.querySelector(${quote(family)}).disabled`), true);
  }
  passed.push('Native connection and fixed-family controls render in both styles, languages, day/night and 800/1040px layouts');
  const integrity = await main.evaluate(`(()=>{const db=new(process.getBuiltinModule('node:sqlite').DatabaseSync)(${quote(resolve(profile, 'mingshen.db'))},{readOnly:true});try{return {version:db.prepare('pragma user_version').get().user_version,integrity:db.prepare('pragma integrity_check').get().integrity_check,foreignKeys:db.prepare('pragma foreign_key_check').all()}}finally{db.close()}})()`);
  assert.deepEqual(integrity, { version: 8, integrity: 'ok', foreignKeys: [] });
  passed.push('Synthetic persisted database has schema8, intact relations and successful integrity checks');
  assert.deepEqual(errors, []); assert.deepEqual(crashes, []);
} catch (cause) {
  failure = cause.stack ?? String(cause);
  if (renderer) {
    const screenshot = await renderer.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (screenshot) await writeFile(resolve(evidence, 'failure.png'), Buffer.from(screenshot.data, 'base64'));
    await writeFile(resolve(evidence, 'failure-ui.txt'), await renderer.evaluate('document.body.innerText').catch(() => 'Unavailable'));
  }
  process.exitCode = 1;
} finally {
  await stop();
  await new Promise(done => server.close(done));
  const target = resolve(temporary);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target !== resolve(tmpdir()));
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  const temporaryRemoved = await stat(target).then(() => false, cause => { if (cause.code === 'ENOENT') return true; throw cause; });
  if (outbound.length || errors.length || crashes.length || forcedExits) process.exitCode = 1;
  const result = { version, passed, requests, auxiliaryRequests, launches, normalExits, forcedExits,
    errors, crashes, outbound, temporaryRemoved, images, geometry, failure, evidence };
  await writeFile(resolve(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, requests: requests.map(({ body, ...item }) => item) }, null, 2));
}
