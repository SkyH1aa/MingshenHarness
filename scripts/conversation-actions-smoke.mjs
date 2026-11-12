import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-conversation-actions-'));
const screenshots = resolve('.impeccable/review');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const passed = [];
const requests = [];
const summaries = [];
let releaseSummary = true;
let failSummary = false;
let child, renderer, main;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  const summary = String(body.instructions).startsWith('# 会话压缩任务');
  (summary ? summaries : requests).push(body);
  if (summary && failSummary) { response.writeHead(503); response.end('Fixture summary HTTP503'); return; }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
  if (summary) {
    assert.equal(body.tools?.length ?? 0, 0);
    while (!releaseSummary && !response.destroyed) await sleep(30);
    if (response.destroyed) return;
    event({ type: 'response.output_text.delta', delta: 'FORK_SUMMARY: ORIGINAL_GOAL is a careful repository investigation. Preserve original constraints, permissions and remaining work. Earlier records remain local.' });
  } else {
    event({ type: 'response.output_text.delta', delta: requests.length === 1 ? 'FULL_HISTORY_MARKER\n' + 'Actual source facts and task constraints.\n'.repeat(300) : 'CONTINUATION_COMPLETE: Followed the inherited context.' });
  }
  event({ type: 'response.completed', response: { usage: { input_tokens: summary ? 400 : 20000, output_tokens: 100, total_tokens: summary ? 500 : 20100 } } });
  response.end();
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

try {
  await mkdir(screenshots, { recursive: true });
  const skillPath = resolve(temporary, 'skill');
  const pluginPath = resolve(temporary, 'plugin');
  await mkdir(skillPath, { recursive: true });
  await mkdir(resolve(pluginPath, '.codex-plugin'), { recursive: true });
  await writeFile(resolve(skillPath, 'SKILL.md'), '---\nname: Actions Skill\ndescription: Review the current task carefully.\n---\nVerify facts and preserve user constraints.\n');
  await writeFile(resolve(pluginPath, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'Actions Plugin', description: 'Local plugin fixture', version: '1.0.0' }));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'), MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), ['--inspect=9350', '.', '--remote-debugging-port=9349'], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(9350);
  await main.evaluate("globalThis.__fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__fetch(url,options);true");
  renderer = await connect(9349);
  const { evaluate, send } = renderer;
  const until = async (expression, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(60); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async (selector, text) => {
    const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)})`;
    await until(`Boolean(${expression})`); await evaluate(`${expression}.click();true`);
  };
  const fill = async text => {
    await evaluate(`(()=>{const el=document.querySelector('.composer textarea');el.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await sleep(80);
  };
  const key = async (key, code = key) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code }); await sleep(80); };
  const finished = async id => until(`window.mingshen.bootstrap().then(s=>!['running','waiting_approval'].includes(s.sessions.find(x=>x.id===${JSON.stringify(id)})?.status))`);
  const shot = async name => { const image = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(resolve(screenshots, `${name}.png`), Buffer.from(image.data, 'base64')); };
  await until("Boolean(document.querySelector('.policy-consents'))"); await sleep(5100);
  await evaluate("document.querySelectorAll('.policy-consents input').forEach(el=>el.click());true");
  await click('.policy-dialog button', '同意并继续'); await click('.policy-dialog button', '开始使用');
  await until("Boolean(document.querySelector('.agent-guide'))");
  const guide = await evaluate("document.querySelector('.agent-guide').textContent");
  for (const expected of ['Mingshen · 通用', 'Plan · 计划', 'General · 通用子任务', 'Explore · 探索']) assert.ok(guide.includes(expected));
  const config = await evaluate(`(async()=>{
    const p=await window.mingshen.createProvider({name:'Local actions fixture',baseUrl:'http://127.0.0.1:${port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-fixture-key',keyLabel:'Local',neverReveal:true});
    await window.mingshen.createModel({providerId:p.id,modelId:'fixture',contextWindow:200000,maxOutputTokens:4096,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const data=await window.mingshen.bootstrap();const model=data.providers.find(x=>x.id===p.id).models[0];
    const s=await window.mingshen.createSession({providerId:p.id,modelId:model.id,title:'Source conversation',workspacePath:null,permissionMode:'request_approval',reasoningLevel:null});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    return {id:s.id,providerId:p.id,modelId:model.id};})()`);
  await send('Page.reload'); await until("Boolean(document.querySelector('.composer textarea'))");
  const agentOptions = await evaluate("document.querySelector('select[aria-label=\"当前 Agent\"]').textContent");
  for (const expected of ['Mingshen · 通用', 'Plan · 计划', 'General · 通用子任务', 'Explore · 探索']) assert.ok(agentOptions.includes(expected));
  passed.push('Setup and current-Agent selector explain all four built-in Agent roles');
  await fill('/');
  await until("document.querySelectorAll('.composer-slash-menu button').length>=9");
  await evaluate("document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));true");
  assert.equal(await evaluate("Boolean(document.querySelector('.session-rename-dialog'))"), false);
  await shot('conversation-slash-zh-night');
  const before = await evaluate("document.querySelector('.composer textarea').getAttribute('aria-activedescendant')");
  await key('ArrowDown'); assert.notEqual(await evaluate("document.querySelector('.composer textarea').getAttribute('aria-activedescendant')"), before);
  await key('Escape'); assert.equal(await evaluate("Boolean(document.querySelector('.composer-slash-menu'))"), false);
  await fill('/ren'); await key('Enter'); await until("Boolean(document.querySelector('.session-rename-dialog'))");
  await evaluate("(()=>{const el=document.querySelector('.session-rename-dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Renamed with slash');el.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
  await click('.session-rename-dialog button', '保存');
  await until("document.querySelector('.session-row__title')?.textContent==='Renamed with slash'");
  await fill('/rename Direct rename'); await key('Enter');
  await until("document.querySelector('.session-row__title')?.textContent==='Direct rename'");
  assert.equal(requests.length, 0);
  passed.push('Slash filtering, keyboard navigation, Escape, app-styled rename prompt and inline rename work without a model call');
  await fill('/status'); await key('Enter'); await until("Boolean(document.querySelector('.context-details'))");
  assert.match(await evaluate("document.querySelector('.context-details').textContent"), /本地上下文估算/);
  assert.doesNotMatch(await evaluate("document.querySelector('.context-meter').textContent"), /—/);
  await key('Escape');
  await fill('Investigate carefully. Preserve ORIGINAL_GOAL and follow permissions.'); await key('Enter'); await finished(config.id);
  assert.equal(requests.length, 1);
  assert.match(await evaluate("document.querySelector('.context-meter').textContent"), /10%/);
  await evaluate("document.querySelector('.context-meter').click();true");
  await until("Boolean(document.querySelector('.context-details'))");
  const measuredContext = await evaluate(`window.mingshen.getContextUsage(${JSON.stringify(config.id)})`);
  assert.match(await evaluate("document.querySelector('.context-details__usage').textContent"), new RegExp(`${(measuredContext.usedTokens / 1000).toFixed(1)}K.*200K`));
  await shot('conversation-context-zh-night'); await key('Escape');
  passed.push('Context percentage and clickable K-token detail use provider-calibrated model-specific usage');
  const originals = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(config.id)})`);
  const unreadBefore = (await evaluate('window.mingshen.getCompletionNotifications()')).unread.length;
  releaseSummary = false;
  await fill('/compact'); await key('Enter');
  await until("Boolean(document.querySelector('.context-notice')?.textContent.includes('可能需要几分钟'))");
  assert.ok(summaries.length > 0);
  assert.equal(requests.length, 1);
  assert.equal(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(config.id)}).then(x=>x.some(m=>m.parts.some(p=>p.type==='text'&&p.text==='/compact')))`), false);
  await assert.rejects(evaluate(`window.mingshen.compactChat(${JSON.stringify(config.id)})`), /正在运行/);
  await send('Page.reload'); await until("Boolean(document.querySelector('.context-notice'))");
  await shot('conversation-manual-compaction-zh-night');
  releaseSummary = true; await finished(config.id);
  assert.deepEqual(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(config.id)})`), originals);
  assert.equal((await evaluate('window.mingshen.getCompletionNotifications()')).unread.length, unreadBefore);
  passed.push('Manual /compact runs below 85%, survives reload, rejects duplicates, preserves transcript and emits no task-completion notification');
  await fill('/fork'); await key('Enter');
  await until("document.querySelectorAll('.session-row').length===2");
  await until("document.querySelector('.session-row[aria-current=page] .session-row__title')?.textContent.includes('分支')");
  const fork = await evaluate(`window.mingshen.bootstrap().then(s=>s.sessions.find(x=>x.id!==${JSON.stringify(config.id)}))`);
  assert.equal(fork.parentSessionId, null);
  assert.deepEqual((await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fork.id)})`)).map(m => m.parts), originals.map(m => m.parts));
  await fill('Continue from the FORK with the complete inherited context.'); await key('Enter'); await finished(fork.id);
  assert.match(JSON.stringify(requests.at(-1).input), /FORK_SUMMARY/);
  assert.match(JSON.stringify(requests.at(-1).input), /ORIGINAL_GOAL/);
  assert.doesNotMatch(JSON.stringify(requests.at(-1).input), /FULL_HISTORY_MARKER/);
  assert.deepEqual(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(config.id)})`), originals);
  passed.push('Fork opens a new independent primary chat with full original records and inherited effective summary; continuing it leaves source untouched');
  await evaluate("document.querySelector('.session-row-wrap:has(.session-row[aria-current=page]) .session-row__menu').click();true");
  await click('.session-menu button', '分支聊天');
  await until("document.querySelectorAll('.session-row').length===3");
  await until("document.querySelector('.session-row[aria-current=page] .session-row__title')?.textContent.includes('分支 · 分支')");
  await sleep(150);
  passed.push('Sidebar ellipsis offers the same complete-context fork action');
  await fill('/skills '); await until("Boolean(document.querySelector('.composer-slash-menu'))");
  await click('.composer-slash-menu button', '管理技能与插件从本地导入、启用或移除扩展');
  await until("Boolean(document.querySelector('.settings-workspace'))");
  await evaluate("document.querySelector('button[aria-label=\"关闭设置\"]').click();true");
  passed.push('Slash skill/plugin references expose local extension management when none are installed');
  const imported = await evaluate(`(async()=>{const a=await window.mingshen.importExtensions(${JSON.stringify(skillPath)});const b=await window.mingshen.importExtensions(${JSON.stringify(pluginPath)});return [...a.imported,...b.imported]})()`);
  assert.equal(imported.length, 2);
  await send('Page.reload'); await until("Boolean(document.querySelector('.composer textarea'))");
  await fill('/skills ');
  await click('.composer-slash-menu button', 'Actions SkillReview the current task carefully.');
  await until("[...document.querySelectorAll('.reference-chip strong')].some(el=>el.textContent==='Actions Skill')");
  await fill('/plugins ');
  await click('.composer-slash-menu button', 'Actions PluginLocal plugin fixture');
  await until("document.querySelectorAll('.reference-chip').length===2");
  passed.push('Local imported skill and Codex plugin can be referenced separately from the slash menu and appear as removable context chips');
  await fill('/plan'); await key('Enter');
  await until("document.querySelector('select[aria-label=\"当前 Agent\"]').value==='plan'");
  await fill('/');
  await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 680, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('.desktop-caption__actions button[aria-label=\"中文 / English\"]').click();document.documentElement.dataset.theme='day';true");
  await shot('conversation-slash-en-day');
  const bounds = await evaluate("(()=>{const r=document.querySelector('.composer-slash-menu').getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()");
  assert.ok(bounds.top >= 0 && bounds.left >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height);
  assert.doesNotMatch(await evaluate("document.querySelector('.composer-slash-menu').textContent"), /[\u4e00-\u9fff]/);
  await fill('/archive'); await key('Enter'); await until("Boolean(document.querySelector('.mingshen-dialog'))");
  await click('.mingshen-dialog button', 'Archive');
  await until("document.querySelectorAll('.session-row').length===2");
  passed.push('Plan switching, English/day slash popup at 1040x680, and archive confirmation work with no overflow');
  await click('.session-row__title', 'Direct rename');
  await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(config.id)},text:'Additional source work to compact.'})`); await finished(config.id);
  const laterOriginals = await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(config.id)})`);
  releaseSummary = false;
  await evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(config.id)},text:'/compact'})`);
  await until("Boolean(document.querySelector('.context-notice'))");
  await evaluate(`window.mingshen.stopChat(${JSON.stringify(config.id)})`); await finished(config.id);
  assert.deepEqual(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(config.id)})`), laterOriginals);
  passed.push('Direct backend /compact can be stopped without changing original messages or saving partial context');
  releaseSummary = true; failSummary = true;
  await evaluate(`window.mingshen.compactChat(${JSON.stringify(config.id)})`); await finished(config.id);
  await until("document.querySelector('.context-notice--error')?.textContent.includes('Fixture summary HTTP503')");
  assert.deepEqual(await evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(config.id)})`), laterOriginals);
  passed.push('Manual compaction HTTP503 is visible and preserves original history for retry');
  console.log(JSON.stringify({ passed, modelRequests: requests.length, compactionRequests: summaries.length, screenshots }, null, 2));
  await evaluate('void window.mingshen.desktopAction("quit");true').catch(() => {});
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(3000)]);
} finally {
  releaseSummary = true; renderer?.close(); main?.close();
  if (child && child.exitCode === null) child.kill();
  server.closeAllConnections(); await new Promise(done => server.close(done));
  if (!temporary.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
