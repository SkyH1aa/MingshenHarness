import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-provider-cache-'));
const profile = resolve(temporary, 'profile');
const currentVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const screenshotsOnly = process.argv.includes('--screenshots-only');
const screenshotPrefix = `v${currentVersion.replaceAll('.', '')}-provider-cache`;
const screenshots = resolve('.impeccable/review', screenshotPrefix, `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const passed = [], errors = [], requests = [], launches = [], crashes = [], blockedOutbound = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const rendererPort = 9397, mainPort = 9398;
const form = '.provider-list > div:not([hidden]) .provider-cache-settings';
const fixtureOrigins = [
  'https://api.deepseek.com',
  'https://api.deepseek.com.evil.invalid',
  'https://generativelanguage.googleapis.com',
  'https://generativelanguage.googleapis.com.evil.invalid',
];
let child, main, renderer, cacheReport = 'unknown', cacheUsageFormat = 'standard', normalExits = 0, forcedExits = 0, failure = null;

function chatUsage() {
  const cached = cacheReport === 'zero' ? 0 : 80;
  if (cacheUsageFormat === 'deepseek') {
    return { usage: cacheReport === 'unknown'
      ? { prompt_tokens: 100, completion_tokens: 12 }
      : { completion_tokens: 12, prompt_cache_hit_tokens: cached, prompt_cache_miss_tokens: 100 - cached } };
  }
  if (cacheUsageFormat === 'gemini') {
    return { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 12, totalTokenCount: 112,
      ...(cacheReport === 'unknown' ? {} : { cachedContentTokenCount: cached }) } };
  }
  return { usage: { prompt_tokens: 100, completion_tokens: 12,
    ...(cacheReport === 'unknown' ? {} : { prompt_tokens_details: { cached_tokens: cached } }) } };
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const instructions = typeof body.instructions === 'string' ? body.instructions
      : typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? body.messages?.[0] ?? '');
    const auxiliary = instructions.includes('会话标题生成');
    if (!auxiliary) requests.push({ path: request.url, body });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    const text = auxiliary ? 'Provider cache fixture' : 'The bounded local cache fixture completed.';
    if (request.url.endsWith('/messages')) {
      const usage = { input_tokens: 20, output_tokens: 12, cache_creation_input_tokens: 0 };
      if (cacheReport !== 'unknown') usage.cache_read_input_tokens = cacheReport === 'zero' ? 0 : 80;
      event({ type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: body.model, usage } });
      event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
      event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } });
      event({ type: 'message_stop' });
    } else if (request.url.endsWith('/chat/completions')) {
      event({ choices: [{ delta: { content: text }, finish_reason: null }] });
      event({ choices: [{ delta: {}, finish_reason: 'stop' }] });
      event({ choices: [], ...chatUsage() });
      response.write('data: [DONE]\n\n');
    } else {
      event({ type: 'response.output_text.delta', delta: text });
      event({ type: 'response.completed', response: { output: [], usage: { input_tokens: 100, output_tokens: 12, ...(cacheReport === 'unknown' ? {} : { input_tokens_details: { cached_tokens: cacheReport === 'zero' ? 0 : 80 } }) } } });
    }
    response.end();
  } catch (cause) { errors.push(String(cause)); response.destroy(); }
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
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(); let sequence = 0;
  await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Inspector.targetCrashed') {
      crashes.push(message.params ?? {});
      errors.push('Fixture renderer crashed');
    }
    const waiter = pending.get(message.id); if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 40000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}
async function until(expression, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await renderer.evaluate(expression)) return;
    await sleep(60);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector, text) {
  const target = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&!e.disabled${text === undefined ? '' : `&&e.textContent.trim()===${JSON.stringify(text)}`})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}
async function shot(name) {
  await sleep(200);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function launch() {
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  launches.push({ pid: child.pid });
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__fixtureBlockedOutbound=[];globalThis.__fixtureFetch=fetch;globalThis.fetch=(url,options)=>{const address=typeof url==="string"?url:url instanceof URL?url.href:url.url;if(address.includes("/rest/v1/rpc/"))return Promise.resolve(Response.json([]));const parsed=new URL(address);if(${JSON.stringify(fixtureOrigins)}.includes(parsed.origin))return globalThis.__fixtureFetch(${JSON.stringify(`http://127.0.0.1:${server.address().port}`)}+parsed.pathname,options);if(parsed.origin!==${JSON.stringify(`http://127.0.0.1:${server.address().port}`)}){globalThis.__fixtureBlockedOutbound.push(parsed.origin);return Promise.reject(new Error("Unexpected external fixture request"))}return globalThis.__fixtureFetch(url,options)};true`);
  renderer = await connect(rendererPort);
  await renderer.send('Runtime.enable');
  await renderer.send('Inspector.enable');
  await renderer.send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
}
async function stopApp() {
  const current = child;
  if (!current) return;
  if (main) blockedOutbound.push(...await main.evaluate('globalThis.__fixtureBlockedOutbound ?? []').catch(() => []));
  const exited = current.exitCode !== null || current.signalCode !== null;
  const ended = exited ? Promise.resolve() : new Promise(done => current.once('exit', done));
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close(); main?.close();
  renderer = undefined; main = undefined;
  await Promise.race([ended, sleep(7000)]);
  if (current.pid && current.exitCode === null && current.signalCode === null) {
    forcedExits++;
    current.kill();
    await Promise.race([ended, sleep(7000)]);
    assert.ok(current.exitCode !== null || current.signalCode !== null, 'Fixture Electron process did not exit');
  } else if (current.exitCode === 0) {
    normalExits++;
  }
  child = undefined;
}
async function openProvider(name, english = false) {
  const settings = await renderer.evaluate('Boolean(document.querySelector(".settings-content"))');
  if (!settings) await click(`.app-topbar button[aria-label="${english ? 'Open settings' : '打开设置'}"]`);
  await click('.settings-nav__item', english ? 'Providers and models' : '供应商与模型');
  const target = `[...document.querySelectorAll(".provider-master button")].find(e=>e.getClientRects().length&&e.querySelector("strong")?.textContent===${JSON.stringify(name)})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
  await click('.provider-list > div:not([hidden]) .provider-detail-tabs button', english ? 'Connection' : '连接');
  await until(`Boolean(document.querySelector(${JSON.stringify(form)}))`);
}
async function closeSettings() {
  if (await renderer.evaluate('Boolean(document.querySelector(".settings-content"))')) await click('.settings-content__header button');
}
async function setForm(mode, ttl = '5m', english = false) {
  const selector = `${form} select[name=cacheMode]`;
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.value=${JSON.stringify(mode)};e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
  await sleep(900);
  assert.equal(await renderer.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, 'Cache setting edit lost focus');
  if (await renderer.evaluate(`Boolean(document.querySelector(${JSON.stringify(form + ' select[name=cacheTtl]')}))`)) {
    await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(form + ' select[name=cacheTtl]')});e.value=${JSON.stringify(ttl)};e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
  }
  await click(`${form} button[type=submit]`);
  await until(`document.querySelector(${JSON.stringify(`${form} .form-actions [role=status]`)})?.textContent===${JSON.stringify(english ? 'Cache settings saved' : '缓存配置已保存')}`);
  assert.equal(await renderer.evaluate('document.activeElement===document.querySelector(".settings-content__header button")'), false, 'Saving focused the settings close button');
}
async function setFamily(family) {
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(form + ' select[name=cacheFamily]')});e.focus();e.value=${JSON.stringify(family)};e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
  await until(`document.querySelector(${JSON.stringify(form + ' select[name=cacheMode]')}).value==='auto'`);
  await setForm('auto');
}
async function input(selector, value) {
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
}
async function createFixture(name, protocol, options = {}) {
  return renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:${JSON.stringify(name)},baseUrl:${JSON.stringify(options.baseUrl ?? `http://127.0.0.1:${server.address().port}/v1`)},protocol:${JSON.stringify(protocol)},authMode:'bearer',apiKey:'local-cache-fixture',keyLabel:'Fixture',neverReveal:true});
    const provider=await window.mingshen.createModel({providerId:p.id,modelId:'cache-fixture',displayName:'Cache fixture',contextWindow:200000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:${JSON.stringify(options.reasoningLevels ?? [])},anthropicNoneBehavior:'disabled'});
    return {provider,session:await window.mingshen.createSession({title:${JSON.stringify(name)},providerId:p.id,modelId:provider.models[0].id,workspacePath:null,permissionMode:'request_approval',reasoningLevel:${JSON.stringify(options.reasoningLevel ?? null)}})};
  })()`);
}
async function removeFixture(fixture) {
  await renderer.evaluate(`window.mingshen.removeSession(${JSON.stringify(fixture.session.id)}).then(()=>window.mingshen.removeProvider(${JSON.stringify(fixture.provider.id)}))`);
}
async function run(session, text) {
  const before = requests.length, id = JSON.stringify(session.id);
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${id},text:${JSON.stringify(text)}})`);
  await until(`window.mingshen.getSession(${id}).then(s=>!['running','waiting_approval'].includes(s.status))`);
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${id})`)).status, 'idle');
  assert.equal(requests.length, before + 1, 'Expected one ordinary local model request');
  return requests.at(-1).body;
}
const snapshot = session => renderer.evaluate(`window.mingshen.getTokenSaver(${JSON.stringify(session.id)})`);
const providers = () => renderer.evaluate('window.mingshen.bootstrap().then(s=>s.providers)');
const setting = key => main.evaluate(`(()=>{const db=new(process.getBuiltinModule('node:sqlite').DatabaseSync)(${JSON.stringify(resolve(profile, 'mingshen.db'))},{readOnly:true});try{const row=db.prepare('select value_json from app_settings where key=?').get(${JSON.stringify(key)});return row?JSON.parse(row.value_json):null}finally{db.close()}})()`);
function markers(body) {
  const found = [];
  if (body.cache_control) found.push(body.cache_control);
  for (const block of body.tools ?? []) if (block.cache_control) found.push(block.cache_control);
  for (const block of Array.isArray(body.system) ? body.system : []) if (block.cache_control) found.push(block.cache_control);
  for (const message of body.messages ?? []) for (const block of Array.isArray(message.content) ? message.content : []) if (block.cache_control) found.push(block.cache_control);
  return found;
}
function assertImplicitWire(body) {
  for (const key of ['prompt_cache_key', 'prompt_cache_retention', 'cache_control', 'cached_content', 'cachedContent']) {
    assert.equal(body[key], undefined, `Implicit caching must not add ${key}`);
  }
  assert.deepEqual(markers(body), []);
}
try {
  await available(rendererPort); await available(mainPort);
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch();
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  await until('!document.querySelector(".policy-dialog")');
  const fixtures = [];
  for (const [name, protocol] of [
    ['Cache gateway', 'openai_responses'], ['Second cache gateway', 'openai_responses'],
    ['Anthropic cache gateway', 'anthropic_messages'], ['Chat cache gateway', 'openai_chat_completions'],
    ['Gemini cache gateway', 'openai_chat_completions'], ['DeepSeek cache gateway', 'openai_chat_completions'],
  ]) fixtures.push(await createFixture(name, protocol));
  await renderer.evaluate(`(async()=>{
    for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);
    const settings=(await window.mingshen.getTokenSaver()).settings;
    await window.mingshen.setTokenSaver({...settings,historySummaries:false});
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    return true;
  })()`);
  const [gateway, second, anthropic, chat, gemini, deepseek] = fixtures;
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))');
  let completion;
  if (!screenshotsOnly) {
  const automatic = await run(gateway.session, 'Keep the exact cache fixture constraints and continue.');
  assert.equal(automatic.prompt_cache_key, undefined);
  let state = await snapshot(gateway.session);
  assert.equal(state.cacheDiagnostics.agent.cacheOutcome, 'unknown');
  assert.equal(state.usage.agent.cacheMeasuredRequests ?? 0, 0);
  await run(gateway.session, 'Continue the same fixture without changing its constraints.');
  state = await snapshot(gateway.session);
  assert.equal(state.cacheDiagnostics.agent.change, 'append_only');
  assert.equal(state.cacheDiagnostics.agent.cachedInputTokens, null);
  assert.equal(state.usage.agent.cacheMeasuredRequests ?? 0, 0);
  passed.push('Unknown gateways omit unsupported hints; consecutive wire requests are append-only and unreported cache reads are unknown, not zero');

  await openProvider(gateway.provider.name);
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(form + ' select')}).value`), 'auto');
  await setForm('openai'); await closeSettings();
  cacheReport = 'zero';
  const optedIn = await run(gateway.session, 'Continue after enabling the gateway cache key.');
  assert.match(optedIn.prompt_cache_key, /^msh:[a-f0-9]{60}$/);
  state = await snapshot(gateway.session);
  assert.equal(state.cacheDiagnostics.agent.cacheOutcome, 'none');
  assert.equal(state.usage.agent.cacheMeasuredRequests, 1);
  assert.equal(state.usage.agent.cacheMeasuredInputTokens, 100);
  cacheReport = 'hit';
  const hit = await run(gateway.session, 'Continue again with the same enabled cache policy.');
  assert.equal(hit.prompt_cache_key, optedIn.prompt_cache_key);
  state = await snapshot(gateway.session);
  assert.equal(state.cacheDiagnostics.agent.change, 'append_only');
  assert.equal(state.cacheDiagnostics.agent.cacheOutcome, 'partial');
  assert.equal(state.usage.agent.cacheMeasuredRequests, 2);
  assert.equal(state.usage.agent.cacheMeasuredInputTokens, 200);
  assert.equal(state.usage.agent.cachedInputTokens, 80);
  passed.push('Real UI save keeps edit focus; OpenAI opt-in uses a stable opaque session key across new runs, and reported zero/hit retain their measured denominator');

  await openProvider(gateway.provider.name); await setForm('off'); await closeSettings();
  const disabled = await run(gateway.session, 'Continue after disabling client cache hints.');
  assert.equal(disabled.prompt_cache_key, undefined);
  const rejected = await renderer.evaluate(`window.mingshen.setProviderPromptCaching(${JSON.stringify(gateway.provider.id)},{mode:'anthropic_auto',ttl:'5m'}).then(()=>false,()=>true)`);
  assert.equal(rejected, true);
  assert.deepEqual((await providers()).find(p => p.id === gateway.provider.id).promptCaching, { mode: 'off', ttl: '5m' });
  assert.deepEqual(await setting(`providers.promptCaching.${gateway.provider.id}`), { mode: 'off', ttl: '5m' });
  passed.push('No-hints mode omits the key and incompatible IPC settings are rejected without overwriting persisted configuration');

  await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(gateway.session.id)},providerId:${JSON.stringify(second.provider.id)},modelId:${JSON.stringify(second.provider.models[0].id)}})`);
  await run(gateway.session, 'Continue with the explicitly changed provider.');
  assert.equal((await snapshot(gateway.session)).cacheDiagnostics.agent.change, 'provider');
  await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(gateway.session.id)},systemPrompt:'Preserve the cache fixture while using this explicit custom system instruction.'})`);
  await run(gateway.session, 'Continue with the explicitly changed system prompt.');
  assert.equal((await snapshot(gateway.session)).cacheDiagnostics.agent.change, 'system');
  passed.push('Actual transport diagnostics distinguish append-only history, provider changes and system-prompt changes');

  await openProvider(anthropic.provider.name); await setForm('anthropic_auto', '1h'); await closeSettings();
  const automaticAnthropic = await run(anthropic.session, 'Continue the Anthropic fixture with automatic one-hour caching.');
  assert.deepEqual(automaticAnthropic.cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.equal(automaticAnthropic.prompt_cache_key, undefined);
  assert.ok(markers(automaticAnthropic).length >= 2 && markers(automaticAnthropic).length <= 4);
  assert.ok(markers(automaticAnthropic).every(marker => marker.type === 'ephemeral' && marker.ttl === '1h'));
  await openProvider(anthropic.provider.name); await setForm('anthropic_breakpoints', '1h'); await closeSettings();
  const explicitAnthropic = await run(anthropic.session, 'Continue the Anthropic fixture with explicit one-hour breakpoints.');
  assert.equal(explicitAnthropic.cache_control, undefined);
  assert.equal(markers(explicitAnthropic).length, 4);
  assert.ok(markers(explicitAnthropic).every(marker => marker.type === 'ephemeral' && marker.ttl === '1h'));
  passed.push('Anthropic automatic and explicit modes preserve the four-marker budget and opt-in one-hour TTL through the real UI/IPC/transport');

  await openProvider(chat.provider.name); await setForm('openai'); await closeSettings();
  completion = await run(chat.session, 'Continue the Chat Completions cache fixture.');
  assert.match(completion.prompt_cache_key, /^msh:[a-f0-9]{60}$/);
  assert.equal(requests.at(-1).path, '/v1/chat/completions');
  passed.push('OpenAI-compatible opt-in reaches both Responses and Chat Completions wire bodies');

  await openProvider(anthropic.provider.name); await setFamily('claude'); await closeSettings();
  const claudeFamily = await run(anthropic.session, 'Continue after choosing the Claude model family.');
  assert.deepEqual(claudeFamily.cache_control, { type: 'ephemeral' });
  assert.equal(claudeFamily.prompt_cache_key, undefined);
  await openProvider(chat.provider.name); await setFamily('claude');
  assert.match(await renderer.evaluate(`document.querySelector(${JSON.stringify(form)}).innerText`), /协议不匹配/);
  await closeSettings();
  const mismatch = await run(chat.session, 'Continue a mismatched family fixture without native Claude fields.');
  assert.equal(mismatch.prompt_cache_key, undefined);
  assert.equal(mismatch.cache_control, undefined);
  await openProvider(chat.provider.name); await setFamily('openai'); await closeSettings();
  const familyKey = await run(chat.session, 'Continue after selecting the matching OpenAI model family.');
  assert.equal(familyKey.prompt_cache_key, completion.prompt_cache_key);
  passed.push('Model family selection enables matching gateway hints, persists through IPC, and omits native hints on mismatched protocols');

  for (const [family, fixture] of [['gemini', gemini], ['deepseek', deepseek]]) {
    await openProvider(fixture.provider.name);
    await setFamily(family);
    assert.equal(await renderer.evaluate(`Boolean(document.querySelector(${JSON.stringify(form + ' select[name=cacheTtl]')}))`), false);
    const configured = { mode: 'auto', ttl: '5m', modelFamily: family };
    assert.deepEqual((await providers()).find(p => p.id === fixture.provider.id).promptCaching, configured);
    assert.deepEqual(await setting(`providers.promptCaching.${fixture.provider.id}`), configured);
    assert.match(await renderer.evaluate(`document.querySelector(${JSON.stringify(form)}).innerText`), family === 'gemini' ? /Gemini/ : /DeepSeek/);
    await closeSettings();
    cacheUsageFormat = family;
    cacheReport = 'unknown';
    assertImplicitWire(await run(fixture.session, `Keep the ${family} prefix stable without reported cache reads.`));
    state = await snapshot(fixture.session);
    assert.equal(state.cacheDiagnostics.agent.cachedInputTokens, null);
    assert.equal(state.usage.agent.cacheMeasuredRequests ?? 0, 0);
    cacheReport = 'zero';
    assertImplicitWire(await run(fixture.session, `Continue ${family} with an explicitly reported cache miss.`));
    state = await snapshot(fixture.session);
    assert.equal(state.cacheDiagnostics.agent.cacheOutcome, 'none');
    assert.equal(state.usage.agent.cacheMeasuredRequests, 1);
    assert.equal(state.usage.agent.cacheMeasuredInputTokens, 100);
    cacheReport = 'hit';
    assertImplicitWire(await run(fixture.session, `Continue ${family} with an explicitly reported partial cache hit.`));
    state = await snapshot(fixture.session);
    assert.equal(state.cacheDiagnostics.agent.change, 'append_only');
    assert.equal(state.cacheDiagnostics.agent.cacheOutcome, 'partial');
    assert.equal(state.usage.agent.cacheMeasuredRequests, 2);
    assert.equal(state.usage.agent.cacheMeasuredInputTokens, 200);
    assert.equal(state.usage.agent.cachedInputTokens, 80);
    assert.equal(state.cacheDiagnostics.agent.inputTokens, 100);
    assert.equal(state.cacheDiagnostics.agent.cachedInputTokens, 80);
    if (family === 'gemini') {
      cacheUsageFormat = 'standard';
      assertImplicitWire(await run(fixture.session, 'Continue Gemini with the OpenAI-compatible cached_tokens usage field.'));
      state = await snapshot(fixture.session);
      assert.equal(state.usage.agent.cacheMeasuredRequests, 3);
      assert.equal(state.usage.agent.cacheMeasuredInputTokens, 300);
      assert.equal(state.usage.agent.cachedInputTokens, 160);
    }
  }
  cacheUsageFormat = 'standard';
  passed.push('Gemini and DeepSeek family edits persist through UI/IPC/storage, use implicit caching without foreign hints, and measure native or compatible usage-only tail frames without treating unknown reads as zero');

  for (const fixture of [anthropic, second]) {
    await openProvider(fixture.provider.name);
    await setFamily('gemini');
    assert.match(await renderer.evaluate(`document.querySelector(${JSON.stringify(form)}).innerText`), /协议不匹配/);
    await closeSettings();
    assertImplicitWire(await run(fixture.session, 'Keep the selected Gemini family from adding fields to an incompatible API protocol.'));
  }
  await openProvider(anthropic.provider.name);
  await setFamily('deepseek');
  assert.doesNotMatch(await renderer.evaluate(`document.querySelector(${JSON.stringify(form)}).innerText`), /协议不匹配/);
  await closeSettings();
  assertImplicitWire(await run(anthropic.session, 'Keep DeepSeek Anthropic compatibility free of Claude-specific cache markers.'));
  await openProvider(anthropic.provider.name); await setFamily('claude'); await closeSettings();
  passed.push('Gemini warns on Responses and Anthropic protocol mismatches; DeepSeek Anthropic compatibility does not receive Claude cache markers');

  const officialDeepseek = await createFixture('Official DeepSeek auto fixture', 'openai_chat_completions', {
    baseUrl: 'https://api.deepseek.com/v1', reasoningLevels: ['none', 'low'], reasoningLevel: 'none',
  });
  let native = await run(officialDeepseek.session, 'Detect the official DeepSeek endpoint with thinking explicitly disabled.');
  assertImplicitWire(native);
  assert.deepEqual(native.thinking, { type: 'disabled' });
  assert.equal(native.reasoning_effort, undefined);
  await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(officialDeepseek.session.id)},reasoningLevel:'low'})`);
  native = await run(officialDeepseek.session, 'Keep the official DeepSeek prefix while explicitly enabling thinking.');
  assert.deepEqual(native.thinking, { type: 'enabled' });
  assert.equal(native.reasoning_effort, 'low');
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))');
  await openProvider(officialDeepseek.provider.name); await setFamily('other'); await closeSettings();
  native = await run(officialDeepseek.session, 'Respect the explicit Other override on the official DeepSeek endpoint.');
  assert.equal(native.thinking, undefined);
  assertImplicitWire(native);
  await removeFixture(officialDeepseek);
  const officialGemini = await createFixture('Official Gemini auto fixture', 'openai_chat_completions', {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  });
  native = await run(officialGemini.session, 'Accept the official Gemini OpenAI-compatible base URL without foreign cache hints.');
  assertImplicitWire(native);
  assert.equal(requests.at(-1).path, '/v1beta/openai/chat/completions');
  await removeFixture(officialGemini);
  for (const baseUrl of [
    'https://api.deepseek.com.evil.invalid/v1',
    'https://generativelanguage.googleapis.com.evil.invalid/v1',
  ]) {
    const spoof = await createFixture('Untrusted lookalike endpoint fixture', 'openai_chat_completions', {
      baseUrl, reasoningLevels: ['none'], reasoningLevel: 'none',
    });
    native = await run(spoof.session, 'Do not classify a lookalike hostname as an official provider.');
    assertImplicitWire(native);
    assert.equal(native.thinking, undefined);
    await removeFixture(spoof);
  }
  passed.push('Strict official endpoint detection and explicit Other overrides reach real request builders; lookalike hosts receive no native thinking fields and all official-looking requests remain local fixtures');

  await openProvider(chat.provider.name);
  for (const [family, protocol] of [
    ['openai', 'openai_responses'], ['claude', 'anthropic_messages'],
    ['gemini', 'openai_chat_completions'], ['deepseek', 'openai_chat_completions'],
  ]) {
    await click('.provider-setup > .section-heading button, .provider-toolbar button', '添加供应商');
    await until('Boolean(document.querySelector(".provider-form"))');
    await input('.provider-form input', `Created ${family} family`);
    await input('.provider-form input[placeholder="https://api.your-domain.com/v1"]', `http://127.0.0.1:${server.address().port}/v1`);
    await input('.provider-form input[type=password]', 'local-cache-fixture');
    await renderer.evaluate(`(()=>{const e=document.querySelector('.provider-form select:not([name])');e.value=${JSON.stringify(protocol)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await renderer.evaluate(`(()=>{const e=document.querySelector('.provider-form select[name=cacheFamily]');e.value=${JSON.stringify(family)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await click('.provider-form button[type=submit]');
    await until('!document.querySelector(".provider-form")');
    const created = (await providers()).find(p => p.name === `Created ${family} family`);
    assert.ok(created);
    assert.deepEqual(created.promptCaching, { mode: 'auto', ttl: '5m', modelFamily: family });
    const configured = await renderer.evaluate(`window.mingshen.createModel({providerId:${JSON.stringify(created.id)},modelId:'created-family-fixture',displayName:'Created family fixture',contextWindow:200000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'})`);
    const session = await renderer.evaluate(`window.mingshen.createSession({title:'Created family',providerId:${JSON.stringify(created.id)},modelId:${JSON.stringify(configured.models[0].id)},workspacePath:null,permissionMode:'request_approval',reasoningLevel:null})`);
    const wire = await run(session, 'Check the creation-time family cache adaptation.');
    if (family === 'openai') assert.match(wire.prompt_cache_key, /^msh:[a-f0-9]{60}$/);
    else if (family === 'claude') assert.deepEqual(wire.cache_control, { type: 'ephemeral' });
    else assertImplicitWire(wire);
    await renderer.evaluate(`window.mingshen.removeSession(${JSON.stringify(session.id)}).then(()=>window.mingshen.removeProvider(${JSON.stringify(created.id)}))`);
  }
  passed.push('Provider creation UI saves OpenAI, Claude, Gemini and DeepSeek families and their first requests use the configured cache mechanism');
  } else {
    for (const [fixture, modelFamily] of [[anthropic, 'claude'], [chat, 'openai'], [gemini, 'gemini'], [deepseek, 'deepseek']]) {
      await renderer.evaluate(`window.mingshen.setProviderPromptCaching(${JSON.stringify(fixture.provider.id)},${JSON.stringify({ mode: 'auto', ttl: '5m', modelFamily })})`);
    }
    await renderer.send('Page.reload');
    await until('Boolean(document.querySelector(".composer"))');
    passed.push('Screenshot-only provider setup uses persisted family settings without sending model requests');
  }

  for (const [locale, theme] of [['zh-CN', 'night'], ['zh-CN', 'day'], ['en', 'day'], ['en', 'night']]) {
    await renderer.evaluate(`window.mingshen.desktopAction('locale',${JSON.stringify(locale)}).then(()=>{localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});localStorage.setItem('mingshen.theme',${JSON.stringify(theme)})})`);
    await renderer.send('Page.reload'); await until('Boolean(document.querySelector(".composer"))');
    await openProvider(anthropic.provider.name, locale === 'en');
    const text = await renderer.evaluate(`document.querySelector(${JSON.stringify(form)}).innerText`);
    if (locale === 'en') { assert.match(text, /Changes apply to the next run/); assert.doesNotMatch(text, /[\u4e00-\u9fff]/); }
    else assert.match(text, /保存后从下一次运行生效/);
    assert.equal(await renderer.evaluate('document.querySelector(".settings-content").scrollWidth>document.querySelector(".settings-content").clientWidth+1'), false);
    await renderer.evaluate(`document.querySelector(${JSON.stringify(form)}).scrollIntoView({block:'center'});true`);
    await shot(`claude-${locale === 'en' ? 'en' : 'zh'}-${theme}`);
    for (const fixture of [gemini, deepseek]) {
      await openProvider(fixture.provider.name, locale === 'en');
      const text = await renderer.evaluate(`document.querySelector(${JSON.stringify(form)}).innerText`);
      assert.match(text, fixture === gemini ? /Gemini/ : /DeepSeek/);
      if (locale === 'en') assert.doesNotMatch(text, /[\u4e00-\u9fff]/);
      assert.equal(await renderer.evaluate('document.querySelector(".settings-content").scrollWidth>document.querySelector(".settings-content").clientWidth+1'), false);
      await renderer.evaluate(`document.querySelector(${JSON.stringify(form)}).scrollIntoView({block:'center'});true`);
      await shot(`${fixture === gemini ? 'gemini' : 'deepseek'}-${locale === 'en' ? 'en' : 'zh'}-${theme}`);
    }
    await closeSettings();
  }
  passed.push('Claude, Gemini and DeepSeek cache controls remain localized and avoid horizontal overflow in Chinese/English and day/night at 1040x680');

  if (!screenshotsOnly) {
  await stopApp(); await launch();
  await until('Boolean(document.querySelector(".composer"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-dialog"))'), false);
  const restored = await providers();
  assert.deepEqual(restored.find(p => p.id === anthropic.provider.id).promptCaching, { mode: 'auto', ttl: '5m', modelFamily: 'claude' });
  assert.deepEqual(restored.find(p => p.id === chat.provider.id).promptCaching, { mode: 'auto', ttl: '5m', modelFamily: 'openai' });
  assert.deepEqual(restored.find(p => p.id === gemini.provider.id).promptCaching, { mode: 'auto', ttl: '5m', modelFamily: 'gemini' });
  assert.deepEqual(restored.find(p => p.id === deepseek.provider.id).promptCaching, { mode: 'auto', ttl: '5m', modelFamily: 'deepseek' });
  const restarted = await run(chat.session, 'Continue the same cache fixture after restarting the application.');
  assert.equal(restarted.prompt_cache_key, completion.prompt_cache_key);
  await renderer.evaluate(`window.mingshen.removeSession(${JSON.stringify(chat.session.id)}).then(()=>window.mingshen.removeProvider(${JSON.stringify(chat.provider.id)}))`);
  assert.equal((await providers()).some(p => p.id === chat.provider.id), false);
  assert.equal(await setting(`providers.promptCaching.${chat.provider.id}`), null);
  passed.push('Application restart preserves all four provider families and opaque keys; removing a provider deletes its cache setting without recreating the database');
  }
  if (screenshotsOnly) assert.equal(requests.length, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual([...blockedOutbound, ...await main.evaluate('globalThis.__fixtureBlockedOutbound ?? []')], []);
} catch (cause) {
  failure = cause instanceof Error ? cause.stack : String(cause);
  const evidence = { passed, errors, failure, body: await renderer?.evaluate('(document.querySelector(".settings-content")?.innerText || document.body.innerText).slice(0,10000)').catch(() => null) };
  await writeFile(resolve(screenshots, 'failure.json'), JSON.stringify(evidence, null, 2));
  console.error(JSON.stringify(evidence, null, 2));
  if (renderer) await shot('failure').catch(() => {});
  throw cause;
} finally {
  await stopApp();
  await new Promise(done => server.close(done));
  assert.ok(temporary.startsWith(resolve(tmpdir()) + sep));
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  const temporaryRemoved = await stat(temporary).then(() => false, cause => {
    if (cause.code === 'ENOENT') return true;
    throw cause;
  });
  const result = { version: currentVersion, mode: screenshotsOnly ? 'screenshots-only' : 'functional', passed, actorRequests: requests.length, errors, crashes,
    blockedOutbound, launches, normalExits, forcedExits, temporaryRemoved, failure, screenshots };
  await writeFile(resolve(screenshots, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.equal(temporaryRemoved, true);
}
