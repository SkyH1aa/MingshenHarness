import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-tencent-memory-ui-'));
const project = resolve(temporary, 'project');
const profile = resolve(temporary, 'profile');
const screenshots = resolve('.impeccable/review');
const currentVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const snapshotPath = resolve(project, '.harness-tencent-memory/records.jsonl');
const rendererPort = 9399, mainPort = 9400;
const passed = [], errors = [], requests = [], memoryRequests = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const goal = 'The project completed its cache snapshot migration to local disk.';
const result = 'Cache snapshots are written atomically on local disk and checked before reuse.';
const memoryChoice = '.dialog select[aria-describedby="project-memory-choice-note"]';
let child, renderer, main, fixture, session, originalId;
let scenario = 'idle', actorTurn = 0, childTurn = 0, nativeSummaries = 0;

function plainText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(plainText).join('\n');
  if (!value || typeof value !== 'object') return '';
  return [value.text, value.content].filter(item => item !== undefined).map(plainText).join('\n');
}
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const instructions = String(body.instructions ?? '');
    const prompt = plainText(body.input);
    const delegatedChild = body.input?.some?.(item =>
      item.role === 'user' && plainText(item).startsWith('子任务：CHILD_MEMORY_FIXTURE:'));
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    const text = value => event({ type: 'response.output_text.delta', delta: value });
    const tool = (name, args) => event({
      type: 'response.output_item.added', output_index: 0,
      item: {
        id: `item-${scenario}-${requests.length}`,
        type: 'function_call', call_id: `call-${scenario}-${requests.length}`,
        name, arguments: JSON.stringify(args),
      },
    });
    if (instructions.includes('会话标题生成')) text('Tencent memory fixture');
    else if (instructions.includes('[PROJECT_MEMORY_SUMMARY]')) {
      nativeSummaries++;
      throw new Error('Tencent project unexpectedly requested a native memory summary.');
    } else if (instructions.includes('情境切分与记忆提取专家')) {
      memoryRequests.push({ scenario, stage: 'extract', body, prompt });
      assert.equal(body.model, 'memory', 'Analysis must use the current conversation model');
      assert.deepEqual(body.tools ?? [], [], 'Memory analysis must not receive tools');
      const ids = [...prompt.matchAll(/^\[([^\]]+)\] \[(?:user|assistant)\] /gm)]
        .map(match => match[1]);
      assert.ok(ids.length, 'Analysis must receive real source-message IDs');
      if (scenario === 'update' || scenario === 'skip') {
        assert.ok(ids.length >= 2, 'Analysis must include the completed user and assistant messages');
        assert.ok(prompt.includes(result), 'Analysis must receive the completed assistant result');
        text(JSON.stringify([{
          scene_name: 'Cache snapshot migration',
          message_ids: ids,
          memories: [{
            content: result, type: 'episodic', priority: 80,
            source_message_ids: ids, metadata: {},
          }],
        }]));
      } else {
        assert.ok(['persona', 'child'].includes(scenario), `Unexpected analysis scenario: ${scenario}`);
        text('[]');
      }
    } else if (instructions.includes('记忆冲突检测器')) {
      memoryRequests.push({ scenario, stage: 'dedup', body, prompt });
      assert.equal(body.model, 'memory', 'Conflict analysis must use the current conversation model');
      assert.deepEqual(body.tools ?? [], [], 'Conflict analysis must not receive tools');
      assert.ok(['update', 'skip'].includes(scenario), `Unexpected conflict scenario: ${scenario}`);
      const ids = [...prompt.matchAll(/^### 第 \d+ 条新记忆 \(record_id: (m_[\w-]+)\)/gm)]
        .map(match => match[1]);
      assert.ok(ids.length, 'Conflict analysis must receive dynamic record IDs');
      text(JSON.stringify(ids.map(record_id => ({
        record_id, action: scenario === 'skip' ? 'skip' : 'store', target_ids: [],
      }))));
    } else if (delegatedChild) {
      childTurn++;
      requests.push({ scenario, child: true, body });
      if (childTurn === 1) tool('memory_search', { query: 'cache' });
      else text('CHILD_MEMORY_FIXTURE completed the read-only project memory lookup.');
    } else {
      actorTurn++;
      requests.push({ scenario, child: false, body });
      if (scenario === 'child' && actorTurn === 1) {
        tool('spawn_subagent', {
          task: 'CHILD_MEMORY_FIXTURE: inspect the project cache memory and report its source.',
          context: 'Do not change project memory. Return the actual lookup result.',
          label: 'Tencent child fixture', agent: 'explore',
        });
      } else if (scenario === 'child' && actorTurn === 2) tool('wait_subagents', {});
      else text(scenario === 'update' || scenario === 'skip' ? result : 'Done.');
    }
    event({
      type: 'response.completed',
      response: { usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } },
    });
    response.end();
  } catch (cause) {
    errors.push(`Fixture server: ${cause?.stack ?? cause}`);
    response.destroy();
  }
});

async function available(port) {
  const probe = createNetServer();
  await new Promise((done, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', done);
  });
  await new Promise(done => probe.close(done));
}
async function connect(port) {
  let target;
  for (let index = 0; index < 180; index++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(value => value.json()))
        .find(item => item.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await sleep(80);
  }
  assert.ok(target, `No fixture debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown')
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
async function until(expression, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await renderer.evaluate(expression)) return;
    await sleep(65);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector, text) {
  const target = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&!e.disabled${text === undefined ? '' : `&&e.textContent.trim()===${JSON.stringify(text)}`})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}
async function replace(selector, text) {
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await renderer.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select();return true})()`);
  assert.equal(await renderer.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true,
    `The fixture must focus ${selector} before typing`);
  await renderer.send('Input.insertText', { text });
  await until(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}`);
}
async function select(selector, value) {
  await renderer.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function shot(name) {
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await until('[...document.querySelectorAll(".settings-workspace")].every(e=>e.getAnimations().every(a=>a.playState!=="running"))');
  await sleep(180);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64'));
}
async function launch() {
  await available(rendererPort);
  await available(mainPort);
  const env = {
    ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),
    [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`],
    { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__fixtureFetch=fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input.url??String(input));if(['127.0.0.1','localhost','[::1]'].includes(u.hostname))return globalThis.__fixtureFetch(input,options);if(u.pathname.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));return Promise.reject(new Error('Nonlocal network blocked by local-memory fixture'));};true`);
  renderer = await connect(rendererPort);
  await renderer.send('Runtime.enable');
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await renderer.send('Emulation.setDeviceMetricsOverride', {
    width: 1040, height: 680, deviceScaleFactor: 1, mobile: false,
  });
  await until('Boolean(window.mingshen?.getAppInfo)');
  await main.evaluate(`globalThis.__fixtureElectron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');globalThis.__fixtureElectron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(project)}]});true`);
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
  await Promise.race([ended, sleep(7000)]);
  if (current.pid && current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(7000)]);
    assert.ok(current.exitCode !== null || current.signalCode !== null, 'Fixture Electron process did not exit');
  }
  child = undefined;
}
const view = id => renderer.evaluate(`window.mingshen.getProjectMemory(${JSON.stringify(id ?? session.id)})`);
const command = text => renderer.evaluate(`window.mingshen.projectMemoryCommand(${JSON.stringify(session.id)},${JSON.stringify(text)})`);
const records = async () => (await readFile(snapshotPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
async function run(nextScenario, text) {
  scenario = nextScenario;
  actorTurn = 0;
  childTurn = 0;
  const before = requests.length;
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:${JSON.stringify(text)}})`);
  await until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>!['running','waiting_approval'].includes(s.status))`, 70000);
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(session.id)})`)).status, 'idle');
  assert.ok(requests.length > before, 'A real actor request must have occurred');
  assert.deepEqual(errors, []);
}
async function selectSession(title) {
  await click('.session-row__title', title);
  await until(`document.querySelector('.session-row[aria-current="page"] .session-row__title')?.textContent===${JSON.stringify(title)}&&Boolean(document.querySelector(".composer"))`);
}
async function openMemory(english = false) {
  if (!await renderer.evaluate('Boolean(document.querySelector(".settings-content"))'))
    await click(`.app-topbar button[aria-label="${english ? 'Open settings' : '打开设置'}"]`);
  await click('.settings-nav__item', english ? 'Project instructions and trust' : '项目指令与信任');
  await until('Boolean(document.querySelector("#memory-document"))');
}
async function closeSettings() {
  if (await renderer.evaluate('Boolean(document.querySelector(".settings-content"))'))
    await click('.settings-content__header button');
}
async function diskTree(root) {
  const result = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        result[`${relative(root, path)}/`] = 'directory';
        await walk(path);
      } else result[relative(root, path)] = (await readFile(path)).toString('base64');
    }
  }
  await walk(root);
  return result;
}
async function rejected(expression, expected) {
  const message = await renderer.evaluate(`(${expression}).then(()=>null,e=>e.message)`);
  assert.equal(typeof message, 'string', 'Expected real IPC rejection');
  assert.match(message, expected);
}
async function unchangedRejection(root, expression, expected) {
  const before = await diskTree(root);
  const count = await renderer.evaluate('window.mingshen.bootstrap().then(s=>s.sessions.length)');
  await rejected(expression, expected);
  assert.deepEqual(await diskTree(root), before, 'Rejected selection must not mutate project files');
  assert.equal(await renderer.evaluate('window.mingshen.bootstrap().then(s=>s.sessions.length)'), count);
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], {
    windowsHide: true, stdio: 'pipe',
  });
  await launch();
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(e=>e.click());true');
  await click('.policy-dialog button', '同意并继续');
  await click('.policy-dialog button', '开始使用');
  await until('!document.querySelector(".policy-dialog")');
  fixture = await renderer.evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Tencent memory fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-tencent-memory-fixture',keyLabel:'Fixture',neverReveal:true});
    const provider=await window.mingshen.createModel({providerId:p.id,modelId:'memory',displayName:'Memory fixture',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const m of await window.mingshen.listMcpServers())if(m.enabled)await window.mingshen.setMcpServerEnabled(m.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    await window.mingshen.setProjectTrust(${JSON.stringify(project)},true);
    return {providerId:p.id,modelId:provider.models[0].id,workspacePath:${JSON.stringify(project)},permissionMode:'full_access',reasoningLevel:null,executionMode:'host'};
  })()`);
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".session-new-button"))');
  await click('.session-new-button');
  await until(`Boolean(document.querySelector(${JSON.stringify(memoryChoice)}))`);
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(memoryChoice)}).disabled`), true);
  await click('.dialog .path-picker');
  await until(`!document.querySelector(${JSON.stringify(memoryChoice)}).disabled`);
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(memoryChoice)}).value`), 'native');
  await select(memoryChoice, 'tencentdb');
  await renderer.evaluate("[...document.querySelectorAll('.dialog select')].find(e=>[...e.options].some(o=>o.value==='full_access')).value='full_access';[...document.querySelectorAll('.dialog select')].find(e=>[...e.options].some(o=>o.value==='full_access')).dispatchEvent(new Event('change',{bubbles:true}));true");
  await shot('v129-tencent-memory-choice-zh-night');
  await click('.dialog button[type=submit]');
  await until('!document.querySelector("#new-session-title")');
  session = await renderer.evaluate(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.workspacePath===${JSON.stringify(project)}&&!x.parentSessionId))`);
  assert.ok(session, 'The real new-session form must create a project session');
  session = await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(session.id)},title:'Tencent memory primary'})`);
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getProjectMemorySelection(${JSON.stringify(project)})`), { backend: 'tencentdb', locked: true });
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))');
  await selectSession(session.title);
  await click('.session-new-button');
  await until(`document.querySelector(${JSON.stringify(memoryChoice)})?.disabled&&document.querySelector(${JSON.stringify(memoryChoice)})?.value==='tencentdb'`);
  assert.match(await renderer.evaluate('document.querySelector("#project-memory-choice-note").textContent'), /默认继承此项目记忆.*项目指令与信任中修改/);
  assert.match(await renderer.evaluate('document.querySelector(".dialog .path-picker").textContent'), /project/);
  await click('.dialog .path-picker');
  await until(`document.querySelector(${JSON.stringify(memoryChoice)})?.disabled&&document.querySelector(${JSON.stringify(memoryChoice)})?.value==='tencentdb'&&document.querySelector('#project-memory-choice-note')?.textContent.includes('默认继承此项目记忆')`);
  await click('.dialog button[type=submit]');
  await until('!document.querySelector("#new-session-title")');
  const sameFolder = await renderer.evaluate(`window.mingshen.createSessionInWorkspace(${JSON.stringify(project)})`);
  assert.equal((await view(sameFolder.id)).backend, 'tencentdb');
  assert.equal((await view()).backend, 'tencentdb');
  passed.push('The real new-project picker selects Tencent memory; later same-folder creation and the workspace shortcut inherit the backend with a settings configuration hint');

  const invalidProject = resolve(temporary, 'invalid-project');
  await mkdir(invalidProject);
  await writeFile(resolve(invalidProject, 'sentinel.txt'), 'Keep this exact fixture.\n');
  for (const memoryBackend of [['native', 'tencentdb'], {}, 'both', null, false]) {
    await unchangedRejection(invalidProject,
      `window.mingshen.createSession(${JSON.stringify({ ...fixture, workspacePath: invalidProject, memoryBackend })})`,
      /exactly one/);
  }
  await unchangedRejection(project,
    `window.mingshen.createSession(${JSON.stringify({ ...fixture, memoryBackend: 'native' })})`,
    /already uses another/);
  const bothProject = resolve(temporary, 'both-project');
  await mkdir(resolve(bothProject, '.harness-memory'), { recursive: true });
  await mkdir(resolve(bothProject, '.harness-tencent-memory'), { recursive: true });
  await writeFile(resolve(bothProject, '.harness-memory/preferences.md'), 'Preserve native fixture.\n');
  await writeFile(resolve(bothProject, '.harness-tencent-memory/records.jsonl'), '');
  await unchangedRejection(bothProject,
    `window.mingshen.createSession(${JSON.stringify({ ...fixture, workspacePath: bothProject, memoryBackend: 'tencentdb' })})`,
    /contains both memory backends/);
  const oppositeProject = resolve(temporary, 'opposite-project');
  await mkdir(oppositeProject);
  await renderer.evaluate(`window.mingshen.createSession(${JSON.stringify({ ...fixture, workspacePath: oppositeProject, memoryBackend: 'tencentdb' })})`);
  await mkdir(resolve(oppositeProject, '.harness-memory'));
  await writeFile(resolve(oppositeProject, '.harness-memory/preferences.md'), 'Preserve conflicting fixture.\n');
  await unchangedRejection(oppositeProject,
    `window.mingshen.getProjectMemorySelection(${JSON.stringify(oppositeProject)})`,
    /conflicts with its saved backend/);
  passed.push('Invalid, opposite, dual-directory and saved-backend conflicts reject through real IPC without modifying project bytes or creating sessions');

  await command('/remember 以后都使用 TypeScript。');
  await command(`/remember ${goal}`);
  const beforeUpdate = await records();
  const preference = beforeUpdate.find(record => record.type === 'persona');
  originalId = beforeUpdate.find(record => record.type === 'episodic').id;
  assert.ok(preference);
  assert.match(await command('/memory search cache'), /cache snapshot migration/);
  await selectSession(session.title);
  await run('update', goal);
  const updated = await records();
  assert.deepEqual(updated.find(record => record.id === preference.id), preference);
  const updatedMemory = updated.find(record => record.type === 'episodic' && record.content.includes(result));
  assert.ok(updatedMemory, 'Semantic extraction must persist a completed-task memory');
  assert.equal(updatedMemory.content, result);
  assert.notEqual(updatedMemory.id, originalId);
  assert.deepEqual(updated.find(record => record.id === originalId), beforeUpdate.find(record => record.id === originalId),
    'Automatic maintenance must not semantically overwrite a different fact');
  assert.deepEqual(memoryRequests.filter(request => request.scenario === 'update').map(request => request.stage),
    ['extract', 'dedup']);
  assert.equal(requests.filter(request => request.scenario === 'update').length, 1,
    'Memory analysis must be counted separately from the single actor request');
  assert.match(JSON.stringify(requests.find(request => request.scenario === 'update').body), /TypeScript/);
  assert.doesNotMatch(await readFile(snapshotPath, 'utf8'), /teamId|userId|work_fact|work_task/);
  assert.equal(nativeSummaries, 0);
  passed.push('Bundled Tencent extraction/filter/write/FTS uses the current model and official prompts, stores semantic memory, and preserves confirmed preferences and earlier facts');

  const beforeSkip = await readFile(snapshotPath, 'utf8');
  await run('skip', goal);
  assert.equal(await readFile(snapshotPath, 'utf8'), beforeSkip);
  assert.deepEqual(memoryRequests.filter(request => request.scenario === 'skip').map(request => request.stage),
    ['extract', 'dedup']);
  await run('persona', 'Check the reusable cache result without changing confirmed user preferences.');
  assert.equal(await readFile(snapshotPath, 'utf8'), beforeSkip);
  assert.deepEqual(memoryRequests.filter(request => request.scenario === 'persona').map(request => request.stage),
    ['extract']);
  const fork = await renderer.evaluate(`window.mingshen.forkSession(${JSON.stringify(session.id)})`);
  assert.equal((await view(fork.id)).backend, 'tencentdb');
  assert.equal((await view(fork.id)).root.toLowerCase(), (await view()).root.toLowerCase());
  passed.push('Semantic deduplication and a valid empty analysis leave snapshot bytes unchanged; a real chat fork inherits Tencent memory and its project root');

  await run('child', 'Delegate a read-only cache memory check to an explore helper, collect its result, then finish.');
  assert.equal(actorTurn, 3);
  assert.equal(childTurn, 2);
  assert.deepEqual(memoryRequests.filter(request => request.scenario === 'child').map(request => request.stage),
    ['extract'], 'Only the parent completion may request analysis; the read-only child must not');
  const childLookupBody = requests.filter(request => request.scenario === 'child' && request.child).at(-1).body;
  const childLookupOutput = childLookupBody.input.filter(item => item.type === 'function_call_output').at(-1)?.output;
  assert.equal(typeof childLookupOutput, 'string', 'The child must receive an actual memory_search tool result');
  const childMatches = JSON.parse(childLookupOutput);
  assert.ok(Array.isArray(childMatches) && childMatches.some(match =>
    match.id === updatedMemory.id &&
    match.source === '.harness-tencent-memory/records.jsonl' &&
    match.text.includes(result)), 'The child must retrieve the inherited record and its real snapshot source');
  const spawned = await renderer.evaluate(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.parentSessionId===${JSON.stringify(session.id)}&&x.title.includes('Tencent child fixture')))`);
  assert.ok(spawned, 'spawn_subagent must create a real child session');
  assert.equal(spawned.status, 'idle');
  assert.equal((await view(spawned.id)).backend, 'tencentdb');
  assert.equal((await view(spawned.id)).root.toLowerCase(), (await view()).root.toLowerCase());
  await rejected(`window.mingshen.setProjectMemoryEnabled(${JSON.stringify(spawned.id)},false)`, /Subagents cannot change/);
  await rejected(`window.mingshen.projectMemoryCommand(${JSON.stringify(spawned.id)},'/remember Unauthorized child edit')`, /Stop the main session/);
  assert.equal(await readFile(snapshotPath, 'utf8'), beforeSkip);
  passed.push('A real spawned child searches inherited Tencent memory and returns through wait_subagents; direct child configuration and memory writes are rejected');

  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))');
  await selectSession(session.title);
  await openMemory();
  const editorView = await view();
  const memoryDraft = JSON.parse(editorView.documents.memory);
  memoryDraft[0].content = 'Cache snapshots use atomic local writes and a strict integrity check before reuse.';
  const preferenceDraft = JSON.parse(editorView.documents.preferences);
  preferenceDraft[0].content = 'Use strict TypeScript for project scripts.';
  const memoryDraftText = JSON.stringify(memoryDraft, null, 2);
  const preferenceDraftText = JSON.stringify(preferenceDraft, null, 2);
  await click('#memory-tab-memory');
  await replace('#memory-document', memoryDraftText);
  await click('#memory-tab-preferences');
  await replace('#memory-document', preferenceDraftText);
  await click('.project-diary button', '保存记忆');
  await until('document.querySelector(".project-diary [role=status]")?.textContent==="记忆已保存"');
  await click('#memory-tab-memory');
  assert.equal(await renderer.evaluate('document.querySelector("#memory-document").value'), memoryDraftText);
  await click('.project-diary button', '保存记忆');
  await until('document.querySelector(".project-diary [role=status]")?.textContent==="记忆已保存"&&!document.querySelector(".project-diary [role=alert]")');
  const savedView = await view();
  assert.equal(JSON.parse(savedView.documents.preferences)[0].content, preferenceDraft[0].content);
  assert.equal(JSON.parse(savedView.documents.memory)[0].content, memoryDraft[0].content);
  memoryDraft[0].content = 'Unsaved memory draft retained after an external snapshot conflict.';
  const conflictDraft = JSON.stringify(memoryDraft, null, 2);
  await replace('#memory-document', conflictDraft);
  const external = `${await readFile(snapshotPath, 'utf8')}\n`;
  await writeFile(snapshotPath, external);
  await click('.project-diary button', '保存记忆');
  await until('Boolean(document.querySelector(".project-diary [role=alert]"))');
  assert.match(await renderer.evaluate('document.querySelector(".project-diary [role=alert]").textContent'), /未覆盖磁盘/);
  assert.equal(await renderer.evaluate('document.querySelector("#memory-document").value'), conflictDraft);
  assert.equal(await readFile(snapshotPath, 'utf8'), external);
  passed.push('Real JSON tabs retain separate drafts, sequential saves adopt their shared snapshot revision, and an external edit preserves both disk bytes and the unsaved draft');

  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))');
  await selectSession(session.title);
  await openMemory();
  await click('.project-diary .toggle-row input');
  await until(`window.mingshen.getProjectMemory(${JSON.stringify(session.id)}).then(v=>!v.enabled)`);
  const beforeDisabled = await readFile(snapshotPath, 'utf8');
  const auxiliaryCount = memoryRequests.length;
  await closeSettings();
  await run('disabled', 'Complete this local reply with automatic project memory disabled.');
  assert.equal(memoryRequests.length, auxiliaryCount);
  assert.equal(await readFile(snapshotPath, 'utf8'), beforeDisabled);
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer"))');
  assert.equal((await view()).enabled, false);
  await stopApp();
  await launch();
  await until('Boolean(document.querySelector(".composer"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-dialog"))'), false);
  assert.deepEqual(await renderer.evaluate(`window.mingshen.getProjectMemorySelection(${JSON.stringify(project)})`), { backend: 'tencentdb', locked: true });
  assert.equal((await view()).enabled, false);
  assert.equal(await readFile(snapshotPath, 'utf8'), beforeDisabled);
  assert.match(await command('/memory search atomic'), /atomic/);
  passed.push('The real automatic-memory switch suppresses extraction and writes; backend, records, search and disabled state survive reload and an actual Electron restart');

  const utfText = 'Unicode 中文 fixture\r\nsecond line\r\n';
  const utfBytes = Buffer.from(utfText, 'utf16le');
  await writeFile(resolve(project, 'utf16-le.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), utfBytes]));
  await writeFile(resolve(project, 'utf16-be.txt'), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utfBytes).swap16()]));
  await writeFile(resolve(project, 'binary.bin'), Buffer.from([0, 1, 0, 2, 0, 3]));
  for (const name of ['utf16-le.txt', 'utf16-be.txt']) {
    const file = await renderer.evaluate(`window.mingshen.readWorkspaceFile(${JSON.stringify(project)},${JSON.stringify(name)})`);
    assert.equal(file.content, utfText);
    const absolute = await renderer.evaluate(`window.mingshen.readAbsoluteFile(${JSON.stringify(resolve(project, name))})`);
    assert.equal(absolute.content, utfText);
    const entries = await renderer.evaluate(`window.mingshen.listWorkspace(${JSON.stringify(project)},${JSON.stringify(name)})`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, name);
  }
  await rejected(`window.mingshen.readWorkspaceFile(${JSON.stringify(project)},'binary.bin')`, /binary|Office|PDF|text/i);
  await rejected(`window.mingshen.readWorkspaceFile(${JSON.stringify(project)},'missing.txt')`, /not found|does not exist|不存在|找不到路径/i);
  passed.push('Real Workspace IPC decodes UTF-16 LE/BE in relative and absolute reads, accepts listing a file, and rejects binary or missing paths with actionable errors');

  await selectSession(session.title);
  await click('.app-topbar button[aria-label="打开工作区"]');
  await until('Boolean(document.querySelector(".workspace-panel"))');
  await click('.workspace-tabs button', '终端');
  await replace('.terminal-input-row input', "[Console]::WriteLine('Unicode 中文');[Console]::Error.WriteLine('fixture warning');exit 0");
  await click('.terminal-input-row button[type=submit]');
  await until('[...document.querySelectorAll(".terminal-entry")].some(e=>e.querySelector(".terminal-meta")?.textContent.includes("exit 0"))');
  const success = await renderer.evaluate(`(()=>{const e=[...document.querySelectorAll('.terminal-entry')].find(e=>e.querySelector('.terminal-meta')?.textContent.includes('exit 0'));const p=[...e.querySelectorAll('pre:not(.terminal-entry__command)')];return {text:e.innerText,red:e.querySelectorAll('.terminal-stderr').length,colors:p.map(x=>getComputedStyle(x).color)}})()`);
  assert.match(success.text, /Unicode 中文/);
  assert.match(success.text, /fixture warning/);
  assert.equal(success.red, 0);
  assert.equal(success.colors.length, 2, 'Both stdout and stderr must be rendered');
  assert.equal(new Set(success.colors).size, 1);
  await replace('.terminal-input-row input', "[Console]::Error.WriteLine('fixture failure');exit 7");
  await click('.terminal-input-row button[type=submit]');
  await until('[...document.querySelectorAll(".terminal-entry")].some(e=>e.querySelector(".terminal-meta")?.textContent.includes("exit 7"))');
  const failure = await renderer.evaluate(`(()=>{const e=[...document.querySelectorAll('.terminal-entry')].find(e=>e.querySelector('.terminal-meta')?.textContent.includes('exit 7'));const p=e.querySelector('.terminal-stderr');return {text:e.innerText,color:p&&getComputedStyle(p).color}})()`);
  assert.match(failure.text, /fixture failure/);
  assert.ok(failure.color);
  assert.notEqual(failure.color, success.colors[0]);
  await shot('v129-tencent-memory-terminal-zh-night');
  passed.push('The real terminal preserves Chinese output and renders successful stderr neutrally while a nonzero exit retains the error color');

  for (const [locale, theme] of [['zh-CN', 'night'], ['zh-CN', 'day'], ['en', 'day'], ['en', 'night']]) {
    await renderer.evaluate(`window.mingshen.desktopAction('locale',${JSON.stringify(locale)}).then(()=>{localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});localStorage.setItem('mingshen.theme',${JSON.stringify(theme)})})`);
    await renderer.send('Page.reload');
    await until('Boolean(document.querySelector(".composer"))');
    await selectSession(session.title);
    await openMemory(locale === 'en');
    await until('document.querySelector("#project-memory-backend")?.disabled===false');
    await renderer.send('Page.bringToFront');
    await renderer.evaluate('document.querySelector(".settings-content").scrollTop=0;true');
    await sleep(320);
    await shot(`v130-tencent-memory-workspace-top-${locale === 'en' ? 'en' : 'zh'}-${theme}`);
    const text = await renderer.evaluate('document.querySelector(".project-diary").innerText');
    assert.match(text, /TencentDB Agent Memory · 2\.0\.3/);
    if (locale === 'en') {
      assert.match(text, /Structured memories/);
      assert.match(text, /Local memory library/);
      assert.doesNotMatch(text, /[\u4e00-\u9fff]/);
    } else {
      assert.match(text, /结构化记忆/);
      assert.match(text, /本地记忆库/);
    }
    assert.equal(await renderer.evaluate('document.querySelector(".settings-content").scrollWidth>document.querySelector(".settings-content").clientWidth+1'), false);
    const bounds = await renderer.evaluate(`(()=>{const p=document.querySelector('.project-diary');p.scrollIntoView({block:'start'});const c=document.querySelector('.settings-content').getBoundingClientRect();return [...p.querySelectorAll('textarea,input,button,.provider-detail-tabs')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {name:e.id||e.tagName,left:r.left,right:r.right,containerLeft:c.left,containerRight:c.right}})})()`);
    assert.ok(bounds.every(item => item.left >= item.containerLeft - 1 && item.right <= item.containerRight + 1), `Memory controls exceed their settings container: ${JSON.stringify(bounds)}`);
    await click('#memory-tab-memory');
    await renderer.evaluate('document.querySelector("#memory-document").scrollIntoView({block:"center"});true');
    await shot(`v129-tencent-memory-${locale === 'en' ? 'en' : 'zh'}-${theme}`);
    await closeSettings();
  }
  passed.push('Tencent memory settings remain localized with no horizontal control overflow at 1040x680 in Chinese/English and day/night; screenshots cover all four combinations');
  assert.equal(nativeSummaries, 0);
  assert.equal(requests.filter(request => !request.child).length, 7);
  assert.equal(requests.filter(request => request.child).length, 2);
  assert.equal(memoryRequests.length, 6);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    version: currentVersion, passed,
    actorRequests: requests.filter(request => !request.child).length,
    childRequests: requests.filter(request => request.child).length,
    memoryRequests: memoryRequests.length, nativeSummaries, screenshots,
  }, null, 2));
} catch (cause) {
  console.error(JSON.stringify({
    passed, errors, scenario, actorTurn, childTurn,
    fixtureRequests: requests.filter(request => request.scenario === scenario).map(request => ({
      child: request.child,
      userMessages: request.body.input.filter(item => item.role === 'user').map(item => plainText(item).slice(0, 350)),
      toolResults: request.body.input.filter(item => item.type === 'function_call_output').map(item => item.output.slice(0, 1200)),
    })),
    body: await renderer?.evaluate('(document.querySelector(".settings-content")?.innerText||document.body.innerText).slice(0,12000)').catch(() => null),
  }, null, 2));
  if (renderer) await shot('v129-tencent-memory-failure').catch(() => {});
  throw cause;
} finally {
  await stopApp();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  assert.ok(temporary.startsWith(resolve(tmpdir()) + sep));
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
