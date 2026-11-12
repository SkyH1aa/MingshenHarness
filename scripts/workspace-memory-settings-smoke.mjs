import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// All profiles, conversations, model requests and memory files are synthetic.
const officialExtraction = await import(pathToFileURL(resolve(
  'third_party/tencentdb-agent-memory/src/core/prompts/l1-extraction.ts',
)).href);
const officialConflict = await import(pathToFileURL(resolve(
  'third_party/tencentdb-agent-memory/src/core/prompts/l1-dedup.ts',
)).href);
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-workspace-memory-'));
const project = resolve(temporary, 'project');
const standalone = resolve(temporary, 'standalone');
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const snapshot = resolve(project, '.harness-tencent-memory/records.jsonl');
const passed = [], errors = [], requests = [], captures = [];
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const facts = {
  current: 'The fixture project stores cache snapshots on local disk.',
  configured: 'Cache snapshots use atomic writes and checksums before reuse.',
  primary: 'Cache snapshots use atomic writes and checksums before reuse. Discard this primary candidate.',
  fallback: 'Cache snapshots use atomic writes and checksums before reuse. Rebuild on checksum mismatch.',
};
const rawAnswer = 'VERBATIM_ASSISTANT_FIXTURE: A lengthy answer discusses cache implementation details. '.repeat(12);
let child, main, renderer, fixture, session, launchCount = 0, scenario = 'idle', english = true;

function plainText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plainText).join('\n');
  if (!value || typeof value !== 'object') return '';
  return [value.text, value.content].filter(item => item !== undefined).map(plainText).join('\n');
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const instructions = String(body.instructions ?? '');
    const prompt = plainText(body.input);
    const stage = instructions.includes('\u60c5\u5883\u5207\u5206\u4e0e\u8bb0\u5fc6\u63d0\u53d6\u4e13\u5bb6')
      ? 'extract'
      : instructions.includes('\u8bb0\u5fc6\u51b2\u7a81\u68c0\u6d4b\u5668')
        ? 'dedup'
        : instructions.includes('\u4f1a\u8bdd\u6807\u9898\u751f\u6210') ? 'title' : 'chat';
    requests.push({ scenario, stage, model: body.model, prompt, body });
    assert.ok(!instructions.includes('[PROJECT_MEMORY_SUMMARY]'), 'Tencent memory requested native summarization');
    let text = rawAnswer;
    if (stage === 'title') text = 'Workspace memory fixture';
    if (stage === 'extract') {
      assert.equal(instructions, officialExtraction.EXTRACT_MEMORIES_SYSTEM_PROMPT,
        'Extraction must receive the exact official system prompt without host additions');
      const ids = [...prompt.matchAll(/^\[([^\]]+)\] \[(?:user|assistant)\] /gm)].map(match => match[1]);
      assert.ok(ids.length >= 2, 'Analysis must receive real source-message IDs');
      assert.ok(prompt.includes('VERBATIM_ASSISTANT_FIXTURE'), 'Analysis must see the completed answer');
      assert.deepEqual(body.tools ?? [], [], 'Analysis has no tools');
      if (scenario === 'failed-both') text = 'invalid extraction fixture';
      else {
        const content = scenario === 'current'
          ? facts.current
          : scenario === 'configured'
            ? facts.configured
            : body.model === 'analysis-fixture' ? facts.primary : facts.fallback;
        text = JSON.stringify(scenario === 'empty' ? [] : [{
          scene_name: 'Cache snapshot architecture',
          message_ids: ids,
          memories: [{
            content, type: 'episodic', priority: 80, source_message_ids: ids, metadata: {},
          }],
        }]);
      }
    }
    if (stage === 'dedup') {
      assert.equal(instructions, officialConflict.CONFLICT_DETECTION_SYSTEM_PROMPT,
        'Conflict analysis must receive the exact official system prompt without host additions');
      assert.deepEqual(body.tools ?? [], [], 'Conflict analysis has no tools');
      const ids = [...prompt.matchAll(/^### \u7b2c \d+ \u6761\u65b0\u8bb0\u5fc6 \(record_id: (m_[\w-]+)\)/gm)]
        .map(match => match[1]);
      assert.ok(ids.length, 'Conflict analysis receives dynamic record IDs');
      text = scenario === 'fallback' && body.model === 'analysis-fixture'
        ? 'invalid primary conflict fixture'
        : JSON.stringify(ids.map(record_id => ({ record_id, action: 'store', target_ids: [] })));
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    event({ type: 'response.output_text.delta', delta: text });
    event({
      type: 'response.completed',
      response: { usage: { input_tokens: 300, output_tokens: 120, total_tokens: 420 } },
    });
    response.end();
  } catch (cause) {
    errors.push(`Fixture server: ${cause?.stack ?? cause}`);
    if (!response.headersSent) response.writeHead(500);
    response.end('Fixture failed');
  }
});

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

async function connect(port, surface) {
  let target;
  for (let index = 0; index < 180; index++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(value => value.json()))
        .find(item => item.webSocketDebuggerUrl && (surface !== 'renderer' || item.type === 'page'));
      if (target) break;
    } catch {}
    await sleep(80);
  }
  assert.ok(target, `No ${surface} debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (surface === 'renderer' && message.method === 'Runtime.exceptionThrown')
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
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
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails)
      throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

async function until(expression, timeout = 40000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await renderer.evaluate(expression)) return;
    } catch (cause) {
      if (!/context|navigat|destroyed|reload/i.test(String(cause))) throw cause;
    }
    await sleep(70);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(selector, text) {
  const target = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&!e.disabled${text === undefined ? '' : `&&e.textContent.trim()===${JSON.stringify(text)}`})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}

async function select(selector, value) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}

async function fill(selector, text) {
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select();return true})()`);
  await renderer.send('Input.insertText', { text });
}

async function pressEscape() {
  await renderer.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await renderer.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
}

async function viewport(width, height = 800) {
  await renderer.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
}

async function shot(name, filename) {
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await until('[...document.querySelectorAll(".settings-workspace")].every(e=>e.getAnimations().every(a=>a.playState!=="running"))');
  await sleep(180);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(screenshots, filename ?? `tencent-analysis-${name}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  captures.push(path);
}

async function launch() {
  const mainPort = await availablePort();
  let rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const env = {
    ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),
    [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`],
    { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort, 'main');
  await main.evaluate(`globalThis.__memoryFixtureFetch=fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if(['127.0.0.1','localhost','[::1]'].includes(u.hostname))return globalThis.__memoryFixtureFetch(input,options);if(u.pathname.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));return Promise.reject(new Error('Nonlocal fixture network blocked'));};true`);
  renderer = await connect(rendererPort, 'renderer');
  await renderer.send('Runtime.enable');
  await until('Boolean(window.mingshen?.getProjectMemoryConfiguration)');
  await main.evaluate(`globalThis.__memoryFixtureElectron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__memoryFixtureChosenFolder=${JSON.stringify(project)};globalThis.__memoryFixtureElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[globalThis.__memoryFixtureChosenFolder]});true`);
  launchCount++;
  await viewport(1440);
}

async function stopApp() {
  const current = child;
  if (!current) return;
  const ended = current.exitCode !== null || current.signalCode !== null
    ? Promise.resolve()
    : new Promise(done => current.once('exit', done));
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close();
  main?.close();
  renderer = undefined;
  main = undefined;
  await Promise.race([ended, sleep(8000)]);
  if (current.pid && current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(8000)]);
  }
  assert.ok(current.exitCode !== null || current.signalCode !== null, 'Fixture Electron did not exit');
  child = undefined;
}

async function openSettings() {
  if (!await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))'))
    await click('.app-topbar button[aria-label="Open settings"], .app-topbar button[aria-label="\u6253\u5f00\u8bbe\u7f6e"], .orbit-tool-rail button[data-orbit-action="settings"]');
  await click('.settings-nav__item', english ? 'Project instructions and trust' : '\u9879\u76ee\u6307\u4ee4\u4e0e\u4fe1\u4efb');
  await until('Boolean(document.querySelector("#project-memory-backend"))&&!document.querySelector("#project-memory-backend").disabled');
}

async function closeSettings() {
  if (await renderer.evaluate('Boolean(document.querySelector(".settings-workspace"))')) {
    await click('.settings-content__header button');
    await until('!document.querySelector(".settings-workspace")');
  }
}

async function chooseWorkspace(path) {
  await select('#project-memory-workspace', path);
  await until(`document.querySelector("#project-memory-workspace")?.value===${JSON.stringify(path)}&&!document.querySelector("#project-memory-backend")?.disabled`);
}

async function browseWorkspace(path) {
  await main.evaluate(`globalThis.__memoryFixtureChosenFolder=${JSON.stringify(path)};true`);
  await click('button[aria-label="Browse workspace folders"]');
  await until(`document.querySelector("#project-memory-workspace")?.value===${JSON.stringify(path)}&&!document.querySelector("#project-memory-backend")?.disabled`);
}

const configuration = path => renderer.evaluate(`window.mingshen.getProjectMemoryConfiguration(${JSON.stringify(path ?? project)})`);
const memoryView = () => renderer.evaluate(`window.mingshen.getProjectMemory(${JSON.stringify(session.id)})`);
const records = async () => (await readFile(snapshot, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

async function saveConfiguration() {
  await click('.project-memory-settings button', 'Save memory configuration');
  await until('[...document.querySelectorAll(".project-memory-settings [role=status]")].some(e=>e.textContent==="Project memory configuration saved.")');
}

async function chooseModel(field, displayName) {
  await click(`fieldset[aria-labelledby="${field}"] .model-picker__trigger`);
  await click('.model-picker__provider-toggle');
  const target = `[...document.querySelectorAll(".model-picker__model")].find(e=>!e.disabled&&e.querySelector("strong")?.textContent===${JSON.stringify(displayName)})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
  await until('!document.querySelector(".model-picker__panel")');
}

async function run(nextScenario) {
  scenario = nextScenario;
  await closeSettings();
  const before = requests.length;
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(`CACHE_MEMORY_${nextScenario}: complete the cache snapshot review and report the result.`)}})`);
  await until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>!['running','waiting_approval'].includes(s.status))`, 70000);
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(session.id)})`)).status, 'idle');
  assert.ok(requests.slice(before).some(item => item.stage === 'chat'));
  assert.deepEqual(errors, []);
  return requests.slice(before).filter(item => ['extract', 'dedup'].includes(item.stage));
}

async function diskTree(root) {
  const files = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files[relative(root, path)] = (await readFile(path)).toString('base64');
    }
  }
  await visit(root);
  return files;
}

async function assertBounds() {
  const bounds = await renderer.evaluate(`(()=>{
    const panel=document.querySelector('.settings-content'),p=panel.getBoundingClientRect();
    const section=document.querySelector('[aria-labelledby="project-memory-configuration-title"]');
    const action=section.querySelector('.project-memory-actions'),a=action.getBoundingClientRect();
    return {documentOverflow:document.documentElement.scrollWidth>innerWidth+1,panelOverflow:panel.scrollWidth>panel.clientWidth+1,
      action:{top:a.top,bottom:a.bottom,position:getComputedStyle(action).position,
        fieldBottoms:[...section.querySelectorAll('.field,.form-note,.form-error')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().bottom)},
      controls:[...document.querySelectorAll('.project-memory-settings select,.project-memory-settings button,.project-memory-settings textarea,.project-memory-settings fieldset')]
        .filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return{name:e.id||e.getAttribute('aria-label')||e.tagName,left:r.left,right:r.right,min:p.left,max:p.right}})};
  })()`);
  assert.equal(bounds.documentOverflow, false, JSON.stringify(bounds));
  assert.equal(bounds.panelOverflow, false, JSON.stringify(bounds));
  assert.ok(bounds.controls.every(item => item.left >= item.min - 1 && item.right <= item.max + 1), JSON.stringify(bounds));
  assert.equal(bounds.action.position, 'static', 'Memory actions must remain in normal document flow');
  assert.ok(bounds.action.fieldBottoms.every(bottom => bounds.action.top >= bottom - 1),
    `The memory save action overlaps configuration fields: ${JSON.stringify(bounds.action)}`);
}

async function assertTopControls() {
  const state = await renderer.evaluate(`(()=>{
    const body=document.querySelector('.settings-content__body').getBoundingClientRect();
    return [...document.querySelectorAll('#project-memory-workspace,#project-memory-backend,fieldset[aria-labelledby="project-memory-analysis-label"] .model-picker__trigger,fieldset[aria-labelledby="project-memory-fallback-label"] .model-picker__trigger,fieldset[aria-labelledby="project-memory-fallback-label"] .icon-button')]
      .map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{
        name:e.id||e.getAttribute('aria-label')||e.textContent,top:r.top,bottom:r.bottom,min:body.top,max:body.bottom,
        visible:r.top>=body.top-1&&r.bottom<=body.bottom+1,unobstructed:Boolean(hit&&(hit===e||e.contains(hit)))}});
  })()`);
  assert.equal(state.length, 5, JSON.stringify(state));
  assert.ok(state.every(item => item.visible && item.unobstructed),
    `The first settings viewport hides or covers a required control: ${JSON.stringify(state)}`);
}

try {
  await Promise.all([mkdir(project), mkdir(standalone), mkdir(screenshots, { recursive: true })]);
  await writeFile(resolve(standalone, 'AGENTS.md'), '# Synthetic standalone workspace\nUse short factual memory entries.\n');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  await launch();
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button', '\u540c\u610f\u5e76\u7ee7\u7eed');
  await click('.policy-dialog button', '\u5f00\u59cb\u4f7f\u7528');
  await until('!document.querySelector(".policy-dialog")');
  fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Workspace memory fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'synthetic-local-fixture',keyLabel:'Fixture',neverReveal:true});
    for(const [modelId,displayName] of [['main-fixture','Main Fixture'],['analysis-fixture','Analysis Fixture'],['fallback-fixture','Fallback Fixture']])
      await window.mingshen.createModel({providerId:provider.id,modelId,displayName,contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],outputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const item of await window.mingshen.listMcpServers())if(item.enabled)await window.mingshen.setMcpServerEnabled(item.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    await window.mingshen.setProjectTrust(${JSON.stringify(project)},true);
    await window.mingshen.desktopAction('locale','en');localStorage.setItem('mingshen.locale','en');
    const models=(await window.mingshen.bootstrap()).providers.find(p=>p.id===provider.id).models;
    return {providerId:provider.id,models:Object.fromEntries(models.map(m=>[m.modelId,m.id]))};
  })()`);
  session = await renderer.evaluate(`window.mingshen.createSession(${JSON.stringify({
    providerId: fixture.providerId, modelId: fixture.models['main-fixture'], workspacePath: project,
    permissionMode: 'full_access', reasoningLevel: null, executionMode: 'host', memoryBackend: 'native',
  })})`);
  session = await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(session.id)},title:'Workspace memory primary'})`);
  await renderer.evaluate(`window.mingshen.projectMemoryCommand(${JSON.stringify(session.id)},'/remember From now on, keep the native fixture preference.')`);
  const nativeBefore = await diskTree(resolve(project, '.harness-memory'));
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))');
  await click('.session-row__title', session.title);
  await openSettings();
  assert.equal(await renderer.evaluate('document.querySelector("#project-memory-backend").value'), 'native');
  await browseWorkspace(standalone);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector("#memory-document"))'), false);
  assert.equal(await renderer.evaluate(`window.mingshen.getProjectTrust(${JSON.stringify(standalone)})`), false);
  await until('document.querySelector(".instruction-list")?.textContent.includes("AGENTS.md")');
  await select('#project-memory-backend', 'tencentdb');
  await saveConfiguration();
  assert.equal((await configuration(standalone)).backend, 'tencentdb');
  assert.equal(await renderer.evaluate(`window.mingshen.getProjectTrust(${JSON.stringify(standalone)})`), false);
  passed.push('The folder browser configures a directory with no session, shows its own instructions, and does not grant trust or show another session memory.');

  await chooseWorkspace(project);
  await select('#project-memory-backend', 'tencentdb');
  await click('.settings-content__header button');
  await until('Boolean(document.querySelector(".mingshen-dialog"))');
  await pressEscape();
  await until('!document.querySelector(".mingshen-dialog")');
  assert.equal(await renderer.evaluate('document.querySelector("#project-memory-backend").value'), 'tencentdb');
  await select('#project-memory-workspace', standalone);
  await until('Boolean(document.querySelector(".mingshen-dialog"))');
  await click('.mingshen-dialog button', 'Cancel');
  assert.equal(await renderer.evaluate('document.querySelector("#project-memory-workspace").value'), project);
  await saveConfiguration();
  await until('Boolean(document.querySelector("#memory-document"))');
  assert.deepEqual(await diskTree(resolve(project, '.harness-memory')), nativeBefore);
  assert.equal((await configuration()).analysisModel, null);
  passed.push('Unsaved configuration survives cancelled close, Escape, and workspace-switch dialogs. Saving Tencent routing preserves every native memory file.');

  const currentRequests = await run('current');
  assert.ok(currentRequests.length >= 1 && currentRequests.every(item => item.model === 'main-fixture'));
  let stored = await records();
  assert.ok(stored.some(record => record.content === facts.current));
  assert.ok(stored.every(record => !record.content.includes('VERBATIM_ASSISTANT_FIXTURE')));
  assert.ok(stored.every(record => record.source_message_ids.length >= 2));
  passed.push('Without an analysis override the real main model performs official extraction and stores a semantic fact with real message IDs instead of the answer transcript.');

  await openSettings();
  await chooseModel('project-memory-analysis-label', 'Analysis Fixture');
  await chooseModel('project-memory-fallback-label', 'Fallback Fixture');
  await saveConfiguration();
  const chosen = await configuration();
  assert.deepEqual(chosen.analysisModel, { providerId: fixture.providerId, modelId: fixture.models['analysis-fixture'] });
  assert.deepEqual(chosen.fallbackModel, { providerId: fixture.providerId, modelId: fixture.models['fallback-fixture'] });
  await closeSettings();
  await stopApp();
  await launch();
  await until('Boolean(document.querySelector(".composer"))');
  assert.deepEqual(await configuration(), chosen);
  await click('.session-row__title', session.title);
  await openSettings();
  assert.match(await renderer.evaluate('document.querySelector("fieldset[aria-labelledby=project-memory-analysis-label]").textContent'), /Analysis Fixture/);
  assert.match(await renderer.evaluate('document.querySelector("fieldset[aria-labelledby=project-memory-fallback-label]").textContent'), /Fallback Fixture/);
  passed.push('Real model-picker selection persists distinct primary and fallback model configuration through an actual Electron restart.');

  const configuredRequests = await run('configured');
  assert.ok(configuredRequests.every(item => item.model === 'analysis-fixture'));
  assert.ok((await records()).some(record => record.content === facts.configured));
  const fallbackRequests = await run('fallback');
  assert.deepEqual(fallbackRequests.map(item => `${item.model}:${item.stage}`), [
    'analysis-fixture:extract', 'analysis-fixture:dedup',
    'fallback-fixture:extract', 'fallback-fixture:dedup',
  ]);
  assert.equal(fallbackRequests[0].prompt, fallbackRequests[2].prompt);
  stored = await records();
  assert.ok(stored.some(record => record.content === facts.fallback));
  assert.ok(stored.every(record => record.content !== facts.primary));
  passed.push('The selected analysis model handles extraction and conflict rules; a primary conflict failure makes fallback repeat the complete transaction with identical source dialogue and no partial primary write.');

  const beforeEmpty = await readFile(snapshot, 'utf8');
  const emptyRequests = await run('empty');
  assert.deepEqual(emptyRequests.map(item => item.stage), ['extract']);
  assert.equal(await readFile(snapshot, 'utf8'), beforeEmpty);
  const failedRequests = await run('failed-both');
  assert.deepEqual(failedRequests.map(item => `${item.model}:${item.stage}`), ['analysis-fixture:extract', 'fallback-fixture:extract']);
  assert.equal(await readFile(snapshot, 'utf8'), beforeEmpty);
  passed.push('A valid empty extraction and two invalid analysis responses both preserve snapshot bytes; analysis failure does not replace the completed chat answer.');

  await openSettings();
  const originalDraft = await renderer.evaluate('document.querySelector("#memory-document").value');
  await fill('#memory-document', `${originalDraft}\n `);
  await select('#project-memory-workspace', standalone);
  await until('Boolean(document.querySelector(".mingshen-dialog"))');
  await pressEscape();
  assert.equal(await renderer.evaluate('document.querySelector("#memory-document").value'), `${originalDraft}\n `);
  await select('#project-memory-backend', 'native');
  await click('.project-memory-settings button', 'Save memory configuration');
  await until('Boolean(document.querySelector(".mingshen-dialog"))');
  await click('.mingshen-dialog button', 'Cancel');
  assert.equal((await configuration()).backend, 'tencentdb');
  await click('.project-memory-settings button', 'Save memory configuration');
  await click('.mingshen-dialog button', 'Switch memory backend');
  await until('[...document.querySelectorAll(".project-memory-settings [role=status]")].some(e=>e.textContent==="Project memory configuration saved.")');
  await until('document.querySelector("#memory-document")?.value.includes("native fixture preference")');
  assert.deepEqual(await diskTree(resolve(project, '.harness-memory')), nativeBefore);
  assert.equal(await readFile(snapshot, 'utf8'), beforeEmpty);
  await select('#project-memory-backend', 'tencentdb');
  await saveConfiguration();
  assert.equal(await readFile(snapshot, 'utf8'), beforeEmpty);
  assert.deepEqual(await diskTree(resolve(project, '.harness-memory')), nativeBefore);
  passed.push('Memory drafts survive cancelled folder/backend changes; confirmed backend changes reload the correct editor and preserve both inactive native files and Tencent snapshot bytes.');

  await click('fieldset[aria-labelledby="project-memory-analysis-label"] .icon-button');
  await saveConfiguration();
  assert.equal((await configuration()).analysisModel, null);
  assert.ok((await configuration()).fallbackModel);
  await closeSettings();
  for (const locale of ['zh-CN', 'en']) {
    for (const theme of ['day', 'night']) {
      english = locale === 'en';
      await renderer.evaluate(`(async()=>{
        await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:'simple'});
        await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});
        localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
        localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
      })()`);
      await renderer.send('Page.reload');
      await until('document.documentElement?.dataset.interfaceStyle==="simple"&&Boolean(document.querySelector(".composer"))');
      await viewport(1040, 680);
      await openSettings();
      await renderer.evaluate('document.querySelector(".settings-content__body").scrollTop=0;true');
      await assertBounds();
      await assertTopControls();
      await shot('', `v130-tencent-memory-workspace-top-${english ? 'en' : 'zh'}-${theme}.png`);
      await closeSettings();
    }
  }
  await openSettings();
  await chooseModel('project-memory-analysis-label', 'Analysis Fixture');
  await saveConfiguration();
  await closeSettings();
  for (const style of ['simple', 'orbit']) {
    for (const locale of ['zh-CN', 'en']) {
      for (const theme of ['night', 'day']) {
        for (const width of [800, 1440]) {
          english = locale === 'en';
          await renderer.evaluate(`(async()=>{
            await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:${JSON.stringify(style)}});
            await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});
            localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
            localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
          })()`);
          await renderer.send('Page.reload');
          await until(`document.documentElement?.dataset.interfaceStyle===${JSON.stringify(style)}&&Boolean(document.querySelector(".composer"))`);
          await viewport(width);
          await openSettings();
          await assertBounds();
          const text = await renderer.evaluate('document.querySelector(".project-memory-settings").innerText');
          if (english) assert.doesNotMatch(text, /[\u4e00-\u9fff]/);
          await renderer.evaluate('document.querySelector("#project-memory-configuration-title").scrollIntoView({block:"start"});true');
          await assertBounds();
          await shot(`${style}-${english ? 'en' : 'zh'}-${theme}-${width}`);
          await closeSettings();
        }
      }
    }
  }
  passed.push('Four 1040x680 first-viewport views expose the workspace, default main agent and fallback without coverage; sixteen style/language/theme/width views keep the save action below every field with no horizontal overflow.');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    version: JSON.parse(await readFile(resolve('package.json'), 'utf8')).version,
    passed, launches: launchCount, rendererErrors: errors.length,
    chatRequests: requests.filter(item => item.stage === 'chat').length,
    extractionRequests: requests.filter(item => item.stage === 'extract').length,
    conflictRequests: requests.filter(item => item.stage === 'dedup').length,
    screenshots: captures,
  }, null, 2));
} catch (cause) {
  console.error(JSON.stringify({
    passed, errors, scenario,
    requests: requests.filter(item => item.scenario === scenario).map(item => ({ stage: item.stage, model: item.model, prompt: item.prompt.slice(0, 300) })),
    body: await renderer?.evaluate('(document.querySelector(".settings-content")?.innerText||document.body.innerText).slice(0,10000)').catch(() => null),
  }, null, 2));
  if (renderer) await shot('failure').catch(() => {});
  throw cause;
} finally {
  await stopApp();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  assert.ok(temporary.startsWith(resolve(tmpdir()) + sep), 'Refusing cleanup outside the fixture directory');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
