import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-agent-selection-'));
const screenshots = resolve(process.env.MSH_SCREENSHOT_DIR || '.impeccable/review');
const resultPath = resolve(screenshots, 'agent-selection-result.json');
const screenshotFiles = [];
const passed = [];
const requests = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, renderer, main;
let failure = null, reloadCount = 0, normalExit = false, temporaryRemoved = false;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push(body);
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Agent configuration received and task completed.' })}\n\n`);
  response.end(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } })}\n\n`);
});

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
    const value = JSON.parse(String(event.data)); const waiter = pending.get(value.id);
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
  while (Date.now() < deadline) {
    try { if (await renderer.evaluate(expression)) return; }
    catch (cause) { if (!/context|navigat|destroyed|reload/i.test(String(cause))) throw cause; }
    await sleep(60);
  }
  throw new Error(`Timed out: ${expression}`);
};
async function reloadPage() {
  // The old document can still satisfy a selector immediately after Page.reload.
  await renderer.evaluate('globalThis.__agentSelectionPageGeneration="old";true');
  await renderer.send('Page.reload');
  await until('globalThis.__agentSelectionPageGeneration===undefined&&Boolean(window.mingshen&&document.querySelector(".session-new-button"))');
  reloadCount++;
}
async function captureScreenshot(name) {
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".policy-dialog"))'), false,
    'The first-run manual must not obscure a target screenshot');
  if (name.endsWith('-en-day.png')) {
    assert.equal(await renderer.evaluate('document.documentElement.dataset.theme'), 'day',
      'English/day screenshot must use the persisted day theme');
  }
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(screenshots, name);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  screenshotFiles.push(path);
}
const profileSelectExpression = `[...document.querySelectorAll('.dialog form .field')].find(el=>el.querySelector('span')?.textContent.toLowerCase().includes('agent'))?.querySelector('select')`;
const subagentModelTriggerExpression = `document.querySelector('.settings-form-grid .model-picker__trigger[aria-label="Subagent model"]')`;
const modelButtonExpression = configId => `[...document.querySelectorAll('.model-picker__panel button.model-picker__model')].find(button=>button.dataset.modelConfigId===${JSON.stringify(configId)})`;
async function openNew() {
  await until('Boolean(document.querySelector(".session-new-button"))');
  await renderer.evaluate('document.querySelector(".session-new-button").click();true');
  await until('Boolean(document.querySelector("#new-session-title"))');
}
async function choose(value) {
  await renderer.evaluate(`(()=>{const el=${profileSelectExpression};if(!el)throw new Error('Agent profile selector not found');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function submit(profileId) {
  const existing = (await renderer.evaluate('window.mingshen.bootstrap()')).sessions.map(s => s.id);
  await renderer.evaluate('document.querySelector(".dialog form button[type=submit]").click();true');
  await until('!document.querySelector("#new-session-title")');
  const created = (await renderer.evaluate('window.mingshen.bootstrap()')).sessions.find(s => !existing.includes(s.id));
  assert.equal(created.agentProfileId, profileId);
  assert.equal(created.parentSessionId, null);
  assert.equal(created.permissionMode, 'request_approval');
  await until(`document.querySelector('.composer-agent select')?.value===${JSON.stringify(profileId)}`);
  return created;
}
async function fillField(label, text) {
  await renderer.evaluate(`(()=>{const field=[...document.querySelectorAll('.settings-form-grid > .field')].find(el=>el.querySelector('span')?.textContent.trim()===${JSON.stringify(label)});const input=field.querySelector('input,textarea');input.focus();input.select();return true})()`);
  await renderer.send('Input.insertText', { text });
}
async function openSubagentModelPicker() {
  await renderer.evaluate(`(()=>{const button=${subagentModelTriggerExpression};if(!button)throw new Error('Subagent model picker not found');button.click();return true})()`);
  await until('Boolean(document.querySelector(".model-picker__panel"))');
}
async function chooseSubagentModel(configId) {
  await openSubagentModelPicker();
  await renderer.evaluate(`(()=>{const provider=[...document.querySelectorAll('.model-picker__panel .model-picker__provider-toggle')].find(button=>button.querySelector('strong')?.textContent.trim()==='Local Agent fixture');if(!provider)throw new Error('Fixture provider not found');if(provider.getAttribute('aria-expanded')!=='true')provider.click();return true})()`);
  await until(`Boolean(${modelButtonExpression(configId)})`);
  await renderer.evaluate(`(${modelButtonExpression(configId)}).click();true`);
  await until('!document.querySelector(".model-picker__panel")');
}

try {
  await mkdir(screenshots, { recursive: true });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9358', '.', '--remote-debugging-port=9357'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9358);
  await main.evaluate('globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true');
  renderer = await connect(9357);
  await until('Boolean(document.querySelector(".policy-consents"))'); await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await until('[...document.querySelectorAll(".policy-dialog button")].some(el=>el.textContent.trim()==="同意并继续"&&!el.disabled)');
  await renderer.evaluate('[...document.querySelectorAll(".policy-dialog button")].find(el=>el.textContent.trim()==="同意并继续").click();true');
  await until('[...document.querySelectorAll(".policy-dialog button")].some(el=>el.textContent.trim()==="开始使用"&&!el.disabled)');
  await renderer.evaluate('[...document.querySelectorAll(".policy-dialog button")].find(el=>el.textContent.trim()==="开始使用"&&!el.disabled).click();true');
  await until('!document.querySelector(".policy-dialog")');
  await renderer.evaluate(`(async()=>{const p=await window.mingshen.createProvider({name:'Local Agent fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-dummy',keyLabel:'Fixture',neverReveal:true});const result=await window.mingshen.createModel({providerId:p.id,modelId:'agent-fixture',displayName:'Agent fixture',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});await window.mingshen.createSession({providerId:p.id,modelId:result.models[0].id,title:'Agent selection',workspacePath:null,reasoningLevel:null,permissionMode:'request_approval'});for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);return true})()`);
  await reloadPage();
  const originals = await renderer.evaluate('window.mingshen.listAgentProfiles()');
  const builtinIds = ['primary','plan','general','explore','code-review','review-subagent','operations','operations-subagent','creative','brainstorm'].sort();
  assert.deepEqual(originals.filter(p => p.builtin).map(p => p.id).sort(), builtinIds);
  await openNew();
  assert.deepEqual(await renderer.evaluate(`[...(${profileSelectExpression})?.options??[]].map(o=>o.value).sort()`), builtinIds);
  assert.equal(await renderer.evaluate(`(${profileSelectExpression})?.value`), 'primary');
  await captureScreenshot('agent-selection-zh-night.png');
  passed.push('New conversation lists all ten enabled defaults and still initially selects Mingshen');

  const created = [];
  for (const id of ['primary','plan','general','explore']) {
    if (created.length) await openNew();
    await choose(id); created.push(await submit(id));
  }
  passed.push('All four profiles create independent root conversations and keep their selected profile and permissions');
  for (const session of created) {
    await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(session.id)},title:${JSON.stringify(`Fixture ${session.agentProfileId}`)}})`);
    const before = requests.length;
    await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:'Check selected profile without invoking any tools.'})`);
    await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(session.id)})?.status==='idle')`);
    assert.equal(requests.length, before + 1);
    const request = requests.at(-1);
    assert.match(request.instructions, new RegExp(`"id"\\s*:\\s*"${session.agentProfileId}"`));
    assert.match(request.instructions, /"agent_depth"\s*:\s*0/);
    const tools = request.tools.map(tool => tool.name);
    if (['plan','explore'].includes(session.agentProfileId)) {
      for (const tool of ['write_file','replace_in_file','apply_patch','delete_file','run_command']) assert.ok(!tools.includes(tool), `${session.agentProfileId} unexpectedly offers ${tool}`);
    } else assert.ok(tools.includes('write_file'));
    assert.ok(tools.includes('read_file'));
  }
  passed.push('Four local model calls use the selected profile at root depth; Plan and Explore omit mutation/command tools');

  await reloadPage();
  for (const session of created) assert.equal((await renderer.evaluate('window.mingshen.bootstrap()')).sessions.find(s=>s.id===session.id).agentProfileId, session.agentProfileId);
  passed.push('The selected profiles persist after reloading the application');
  await renderer.evaluate(`document.querySelector('.desktop-caption__actions button[aria-label="中文 / English"]').click();true`);
  await until('Boolean(document.querySelector(\'.app-topbar button[aria-label="Switch to light theme"]\'))');
  await renderer.evaluate('document.querySelector(\'.app-topbar button[aria-label="Switch to light theme"]\').click();true');
  await until('document.documentElement.dataset.theme==="day"&&localStorage.getItem("mingshen.theme")==="day"');
  await openNew();
  const english = await renderer.evaluate(`[...(${profileSelectExpression})?.options??[]].map(o=>o.textContent)`);
  assert.equal(english.length, builtinIds.length); assert.ok(english.some(s=>s.startsWith('Explore'))); assert.ok(english.every(s=>!/[\u4e00-\u9fff]/.test(s)));
  await captureScreenshot('agent-selection-en-day.png');
  await renderer.evaluate('document.querySelector(".dialog-scrim").click();true');
  passed.push('English/day and Chinese/night show all ten choices with their purpose labels');

  await renderer.evaluate(`document.querySelector('.app-topbar button[aria-label="Open settings"]').click();true`);
  await until('Boolean(document.querySelector(".settings-workspace"))');
  await renderer.evaluate('[...document.querySelectorAll(".settings-nav__item")].find(el=>el.textContent.trim()==="Agent profiles").click();true');
  await until('[...document.querySelectorAll(".settings-content button")].some(el=>el.textContent.trim()==="New agent")');
  await renderer.evaluate('[...document.querySelectorAll(".settings-content button")].find(el=>el.textContent.trim()==="New agent").click();true');
  const fixtureModelId = await renderer.evaluate(`window.mingshen.bootstrap().then(state=>state.providers.find(provider=>provider.name==='Local Agent fixture')?.models.find(model=>model.modelId==='agent-fixture')?.id)`);
  assert.ok(fixtureModelId, 'The local enabled model fixture must be available in Agent settings');
  const setDraftRole = async role => renderer.evaluate(`(()=>{const field=[...document.querySelectorAll('.settings-form-grid > .field')].find(el=>el.querySelector('span')?.textContent.trim()==='Type');const select=field?.querySelector('select');if(!select)return false;select.value=${JSON.stringify(role)};select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await setDraftRole('primary');
  assert.equal(await renderer.evaluate(`[...document.querySelectorAll('.settings-form-grid > .field')].some(el=>el.querySelector('span')?.textContent.trim()==='Subagent model')`), false);
  await setDraftRole('plan');
  assert.equal(await renderer.evaluate(`[...document.querySelectorAll('.settings-form-grid > .field')].some(el=>el.querySelector('span')?.textContent.trim()==='Subagent model')`), false);
  await setDraftRole('all');
  assert.equal(await renderer.evaluate(`[...document.querySelectorAll('.settings-form-grid > .field')].some(el=>el.querySelector('span')?.textContent.trim()==='Subagent model')`), true);
  assert.equal(await renderer.evaluate(`(${subagentModelTriggerExpression})?.querySelector('strong')?.textContent.trim()`), 'Use the parent conversation model');
  await chooseSubagentModel(fixtureModelId);
  await setDraftRole('subagent');
  assert.equal(await renderer.evaluate(`(${subagentModelTriggerExpression})?.querySelector('strong')?.textContent.trim()`), 'Agent fixture');
  await openSubagentModelPicker();
  assert.equal(await renderer.evaluate(`(${modelButtonExpression(fixtureModelId)})?.getAttribute('aria-pressed')`), 'true');
  await renderer.evaluate(`(()=>{const inherit=document.querySelector('.model-picker__panel .model-picker__clear');if(!inherit)throw new Error('Parent model inheritance option not found');inherit.click();return true})()`);
  await until('!document.querySelector(".model-picker__panel")');
  assert.equal(await renderer.evaluate(`(${subagentModelTriggerExpression})?.querySelector('strong')?.textContent.trim()`), 'Use the parent conversation model');
  await chooseSubagentModel(fixtureModelId);
  passed.push('The shared Subagent model picker preserves role visibility, explicit selection and parent-model inheritance');
  await captureScreenshot('agent-submodel-editor-en-day.png');
  await fillField('Name', 'User created reviewer');
  await fillField('Description', 'Review project changes with concise evidence.');
  await fillField('System instructions', 'CUSTOM_UI_REVIEWER: Inspect the task and return useful findings.');
  await renderer.evaluate('[...document.querySelectorAll(".settings-actions button")].find(el=>el.textContent.trim()==="Save agent").click();true');
  await until('[...document.querySelectorAll(".agent-profile-row strong")].some(el=>el.textContent==="User created reviewer")');
  const uiProfile = (await renderer.evaluate('window.mingshen.listAgentProfiles()')).find(p=>p.name==='User created reviewer');
  assert.equal(uiProfile.builtin, false); assert.equal(uiProfile.role, 'subagent');
  assert.equal(uiProfile.modelId, fixtureModelId);
  await renderer.evaluate('document.querySelector(".settings-content__header button").click();true');
  assert.ok(await renderer.evaluate(`[...document.querySelector('.composer-agent select').options].some(o=>o.value===${JSON.stringify(uiProfile.id)})`));
  await openNew();
  assert.ok(await renderer.evaluate(`[...(${profileSelectExpression})?.options??[]].some(o=>o.value===${JSON.stringify(uiProfile.id)})`));
  assert.ok(await renderer.evaluate('document.querySelector(".agent-guide").textContent.includes("Review project changes with concise evidence.")'));
  await choose(uiProfile.id); const uiSession = await submit(uiProfile.id);
  passed.push('An Agent created in Settings immediately appears in both selectors and the purpose guide without restarting');

  const custom = [uiProfile];
  for (const role of ['primary','plan','all']) {
    const value = await renderer.evaluate(`window.mingshen.saveAgentProfile(${JSON.stringify({name:`Custom ${role}`,description:`Custom ${role} instructions and purpose`,role,instructions:`CUSTOM_${role.toUpperCase()}_PROFILE`,modelId:null,readOnly:role==='plan',enabled:true,hidden:role==='all',permissions:{},toolAllowlist:[]})})`);
    assert.equal(value.builtin, false); custom.push(value);
  }
  const disabled = await renderer.evaluate(`window.mingshen.saveAgentProfile(${JSON.stringify({name:'Disabled custom',description:'Must not be selectable',role:'subagent',instructions:'Disabled fixture',modelId:null,readOnly:false,enabled:false})})`);
  await reloadPage();
  await openNew();
  const expectedIds = [...originals,...custom].filter(p=>p.enabled).map(p=>p.id).sort();
  assert.deepEqual(await renderer.evaluate(`[...(${profileSelectExpression})?.options??[]].map(o=>o.value).sort()`), expectedIds);
  assert.deepEqual(await renderer.evaluate('[...document.querySelector(".composer-agent select").options].map(o=>o.value).sort()'), expectedIds);
  const guide = await renderer.evaluate('document.querySelector(".agent-guide").innerText');
  for (const p of custom) assert.ok(guide.includes(p.name) && guide.includes(p.description));
  assert.ok(!guide.includes(disabled.name));
  await captureScreenshot('agent-selection-custom-en-day.png');
  await renderer.evaluate('document.querySelector(".dialog-scrim").click();true');
  passed.push('Custom primary/Plan/Subagent/all roles and @-hidden profiles appear with their descriptions; disabled profiles stay excluded');

  const customSessions = [uiSession];
  for (const p of custom.slice(1)) {
    await openNew(); await choose(p.id); customSessions.push(await submit(p.id));
  }
  for (const session of customSessions) {
    const p = custom.find(p=>p.id===session.agentProfileId);
    await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(session.id)},title:${JSON.stringify(`Custom fixture ${p.role}`)}})`);
    const before = requests.length;
    await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:'Verify the user-created profile without invoking tools.'})`);
    await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(session.id)})?.status==='idle')`);
    assert.equal(requests.length, before + 1);
    const request = requests.at(-1);
    assert.ok(request.instructions.includes(p.instructions));
    assert.ok(new RegExp(`"id"\\s*:\\s*"${p.id}"`).test(request.instructions));
    assert.match(request.instructions, /"agent_depth"\s*:\s*0/);
    const tools = request.tools.map(tool=>tool.name);
    assert.equal(tools.includes('write_file'), !p.readOnly);
  }
  await renderer.evaluate(`(()=>{const select=document.querySelector('.composer-agent select');select.value=${JSON.stringify(uiProfile.id)};select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await until(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id===${JSON.stringify(customSessions.at(-1).id)})?.agentProfileId===${JSON.stringify(uiProfile.id)})`);
  await reloadPage();
  assert.equal(await renderer.evaluate('document.querySelector(".composer-agent select").value'), uiProfile.id);
  passed.push('Each custom role creates and runs an independent chat with its instructions and read-only boundary; header switching persists after reload');

  for (const original of [...originals,...custom].filter(p=>p.id!=='general')) await renderer.evaluate(`window.mingshen.saveAgentProfile(${JSON.stringify({ ...original, enabled: false })})`);
  await reloadPage();
  await openNew();
  assert.deepEqual(await renderer.evaluate(`[...(${profileSelectExpression})?.options??[]].map(o=>o.value)`), ['general']);
  assert.equal(await renderer.evaluate(`(${profileSelectExpression})?.value`), 'general');
  await submit('general');
  passed.push('Disabled profiles stay excluded and the enabled subagent profile is a valid default when Mingshen is disabled');
} catch (cause) {
  failure = cause;
} finally {
  try {
    if (renderer) await renderer.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
    renderer?.close(); main?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
      normalExit = child.exitCode === 0;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(); await new Promise(done => child.once('exit', done));
      }
    } else normalExit = child?.exitCode === 0;
    server.closeAllConnections();
    if (server.listening) await new Promise(done => server.close(done));
    if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    temporaryRemoved = true;
    assert.equal(normalExit, true, 'The owned Electron process must exit normally');
  } catch (cause) {
    failure ??= cause;
  }
  const result = {
    passed, modelRequests: requests.length, reloadCount, screenshots: screenshotFiles,
    normalExit, temporaryRemoved, failure: failure ? String(failure.stack || failure) : null,
    methods: 'Owned temporary profile, synthetic local provider, real Electron UI and local SSE only.',
  };
  await mkdir(screenshots, { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
if (failure) throw failure;
