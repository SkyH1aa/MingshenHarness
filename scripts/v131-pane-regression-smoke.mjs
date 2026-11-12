import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const baseline = process.argv.includes('--baseline');
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-v131-panes-'));
const project = resolve(temporary, 'workspace');
const configured = resolve(temporary, 'configured');
const captures = resolve('.impeccable/review/v131-pane-regression');
const passed = [], exceptions = [], serverErrors = [], requests = [], screenshots = [], measurements = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const parentTitle = ('这是我的HiMCM答题工作与并行SubAgent检查 ' + 'Long conversation title '.repeat(6)).slice(0, 120);
const ordinaryTitle = 'Long ordinary conversation menu and workspace file inspection '.repeat(5).slice(0, 120);
const diagnosticServer = resolve(temporary, 'diagnostic-fixture.cjs');
const diagnosticSource = String.raw`
let buffer = Buffer.alloc(0);
const send = payload => {
  const body = Buffer.from(JSON.stringify(payload));
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n');
  process.stdout.write(body);
};
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } });
    if (message.method === 'textDocument/didOpen') send({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
      params: { uri: message.params.textDocument.uri, diagnostics: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1, source: 'pane-fixture', message: 'V131_CONFIGURED_DIAGNOSTIC_FAILURE',
      }] },
    });
  }
});
`;
let child, main, renderer, fixture;

function finish(response, text, output) {
  if (response.destroyed) return;
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (text) response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`);
  response.end(`data: ${JSON.stringify({ type: 'response.completed', response: {
    status: 'completed', ...(output ? { output } : {}),
    usage: { input_tokens: 1500, output_tokens: 80, total_tokens: 1580 },
  } })}\n\n`);
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if ((body.instructions || '').includes('会话标题生成')) return finish(response, parentTitle);
    const input = body.input || [];
    const worker = JSON.stringify(input.filter(item => item.role === 'user')).includes('PANE_WORKER');
    const checkFailure = JSON.stringify(input.filter(item => item.role === 'user')).includes('CONFIGURED_DIAGNOSTIC');
    requests.push({ worker, checkFailure });
    const calls = input.filter(item => item.type === 'function_call');
    const has = name => calls.some(item => item.name === name);
    const tool = (name, args) => ({
      type: 'function_call', call_id: `v131-${requests.length}-${name}`, name,
      arguments: JSON.stringify(args),
    });
    if (worker) return finish(response, 'PANE_WORKER_COMPLETE: read-only layout review complete.');
    if (!has('write_file')) return finish(response, '', [tool('write_file', {
      path: checkFailure ? 'failure.ps1' : 'notes.ps1',
      content: checkFailure ? '# Configured diagnostic failure remains visible.\n' : '# No project diagnostic engine is configured.\n',
    })]);
    if (checkFailure) return finish(response, 'CONFIGURED_DIAGNOSTIC_COMPLETE');
    if (!has('spawn_subagent')) return finish(response, '', [tool('spawn_subagent', {
      agent: 'review-subagent', label: 'PANE_WORKER', task: 'PANE_WORKER: inspect the workbench layout without modifying files.',
    })]);
    if (!has('wait_subagents')) return finish(response, '', [tool('wait_subagents', {})]);
    return finish(response, 'PANE_PARENT_COMPLETE: files and child review are ready.');
  } catch (cause) {
    serverErrors.push(cause.stack || String(cause));
    if (!response.destroyed) response.destroy();
  }
});

async function availablePort() {
  const probe = createPortServer();
  await new Promise((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port;
  await new Promise(done => probe.close(done));
  return port;
}

async function connect(port, page = false) {
  let target;
  for (let index = 0; index < 160; index++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then(value => value.json()))
        .find(item => item.webSocketDebuggerUrl && (!page || item.type === 'page'));
      if (target) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(target, `Missing debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (page && value.method === 'Runtime.exceptionThrown')
      exceptions.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id);
    clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 30000);
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

async function until(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await renderer.evaluate(expression)) return; }
    catch (cause) { if (!/context|navigat|reload|destroyed/i.test(String(cause))) throw cause; }
    await sleep(70);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(selector) {
  await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return Boolean(el&&!el.disabled&&el.getBoundingClientRect().width>0)})()`);
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
}

async function pointer(selector) {
  const point = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el)throw new Error('Missing pointer target');
    el.scrollIntoView({block:'nearest'});
    const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    if(!el.contains(document.elementFromPoint(x,y)))throw new Error('Pointer target is occluded: '+${JSON.stringify(selector)});
    return {x,y};
  })()`);
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await renderer.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}

async function key(name, code, windowsVirtualKeyCode) {
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode,
    ...(name === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode });
}

async function shot(name) {
  await renderer.send('Page.bringToFront');
  await sleep(160);
  const result = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(captures, `${baseline ? 'baseline-' : ''}${name}.png`);
  await writeFile(path, Buffer.from(result.data, 'base64'));
  screenshots.push(path);
}

function record(message) {
  passed.push(message);
  console.log(`PASS ${passed.length}: ${message}`);
}

async function select(id) {
  if (await renderer.evaluate('document.querySelector(".sidebar-host")?.hidden'))
    await click('.orbit-workspace-header > button:first-child, .app-topbar button.sidebar-toggle');
  await renderer.evaluate(`(()=>{
    for(const el of document.querySelectorAll('.session-group__header[aria-expanded=false], .session-group__show-all[aria-expanded=false]'))el.click();
    return true;
  })()`);
  await until(`Boolean(document.querySelector('[data-session-id="${id}"] .session-row'))`);
  await click(`[data-session-id="${id}"] .session-row`);
  await until(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(id)}`);
}

async function presentation(style, locale, theme, width, height) {
  await renderer.evaluate(`(async()=>{
    await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:${JSON.stringify(style)}});
  })()`);
  await renderer.send('Page.reload');
  await until(`Boolean(document.querySelector(".composer textarea"))&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}`);
  await renderer.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  await sleep(180);
  if (await renderer.evaluate('Boolean(document.querySelector(".app-body[data-inspector-drawer=true] > .inspector-host:not([hidden])"))')) {
    await pointer('.workspace-panel__header > .icon-button');
    await until('document.querySelector(".inspector-host").hidden');
  }
  await select(fixture.parent);
  await sleep(180);
}

async function files() {
  if (await renderer.evaluate('document.documentElement.dataset.interfaceStyle==="orbit"'))
    await click('.orbit-tool-rail [data-orbit-action="files"]');
  else {
    if (!await renderer.evaluate('Boolean(document.querySelector(".inspector-workspace:not([hidden])"))'))
      await pointer('.app-topbar [data-layout="code"]');
    if (await renderer.evaluate('document.querySelector(".inspector-host").hidden'))
      await pointer('.app-topbar button[aria-label="打开工作区"], .app-topbar button[aria-label="Open workspace"]');
    await click('.workspace-tab[data-workspace-tab="files"]');
  }
  await until('document.querySelectorAll(".file-tree .tree-row").length>=100');
}

async function treeMetrics() {
  return renderer.evaluate(`(()=>{
    const el=document.querySelector('.file-tree'),r=el.getBoundingClientRect();
    const pane=document.querySelector('.workspace-panel').getBoundingClientRect();
    const last=[...el.querySelectorAll('.tree-row')].at(-1).getBoundingClientRect();
    return {height:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop,
      top:r.top,bottom:r.bottom,paneBottom:pane.bottom,viewportBottom:innerHeight,lastTop:last.top,lastBottom:last.bottom};
  })()`);
}

async function scrollFiles(label) {
  const first = await treeMetrics();
  assert.ok(first.height > 20 && first.scrollHeight > first.height + 100, `${label}: no constrained scroll area: ${JSON.stringify(first)}`);
  assert.ok(first.bottom <= first.paneBottom + 1, `${label}: tree clipped outside workspace`);
  assert.ok(first.paneBottom <= first.viewportBottom + 1, `${label}: workspace clipped outside viewport`);
  await renderer.evaluate('document.querySelector(".file-tree").scrollTop=0;true');
  const center = await renderer.evaluate(`(()=>{const r=document.querySelector('.file-tree').getBoundingClientRect();return{x:r.x+r.width/2,y:r.top+r.height/2}})()`);
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center });
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...center, deltaX: 0, deltaY: 8000 });
  await until('(()=>{const el=document.querySelector(".file-tree");return el.scrollTop+el.clientHeight>=el.scrollHeight-2})()');
  const wheel = await treeMetrics();
  assert.ok(wheel.lastTop >= wheel.top - 1 && wheel.lastBottom <= wheel.bottom + 1, `${label}: last file unreachable`);
  await sleep(180);
  await renderer.evaluate('document.querySelector(".file-tree").focus({preventScroll:true});true');
  await key('Home', 'Home', 36);
  await until('document.querySelector(".file-tree").scrollTop<1');
  assert.ok(await renderer.evaluate(`(()=>{
    const el=document.querySelector('.file-tree'),r=el.getBoundingClientRect();
    const first=el.querySelector('.tree-row').getBoundingClientRect();
    return first.top>=r.top-1&&first.bottom<=r.bottom+1;
  })()`), `${label}: Home must reveal the first file`);
  await sleep(180);
  await key('End', 'End', 35);
  await until('(()=>{const el=document.querySelector(".file-tree");return el.scrollTop+el.clientHeight>=el.scrollHeight-2})()');
  const keyboard = await treeMetrics();
  assert.ok(keyboard.lastBottom <= keyboard.bottom + 1);
  assert.equal(keyboard.top, first.top, 'Header must stay fixed while files scroll');
  measurements.push({ label, first, wheel, keyboard });
}

async function sidebarGeometry(id) {
  const selector = `[data-session-id="${id}"]`;
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector + ' .session-row__menu')}).focus({preventScroll:true});true`);
  return renderer.evaluate(`(()=>{
    const row=document.querySelector(${JSON.stringify(selector)});
    const box=el=>{if(!el)return null;const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    return {title:box(row.querySelector('.session-row__title')),body:box(row.querySelector('.session-row__body')),
      expand:box(row.querySelector('.session-row__children')),menu:box(row.querySelector('.session-row__menu')),
      paddingRight:getComputedStyle(row.querySelector('.session-row')).paddingRight,
      tooltip:row.querySelector('.session-row__title').title,text:row.querySelector('.session-row__title').textContent};
  })()`);
}

async function checkSidebar(label) {
  for (const id of [fixture.parent, fixture.ordinary]) {
    const data = await sidebarGeometry(id);
    assert.ok(data.title.right <= (data.expand || data.menu).left - 1, `${label}: title overlaps controls: ${JSON.stringify(data)}`);
    if (data.expand) assert.ok(data.expand.right <= data.menu.left + 1, `${label}: controls overlap`);
    assert.equal(data.tooltip, data.text, `${label}: complete title tooltip`);
    measurements.push({ label: `${label}-sidebar-${id === fixture.parent ? 'parent' : 'ordinary'}`, ...data });
  }
  const expand = `[data-session-id="${fixture.parent}"] .session-row__children`;
  if (await renderer.evaluate(`document.querySelector(${JSON.stringify(expand)}).getAttribute('aria-expanded')==='true'`))
    await pointer(expand);
  await pointer(expand);
  await until(`Boolean(document.querySelector('[data-session-id="${fixture.worker}"]'))`);
  await renderer.evaluate(`document.querySelector(${JSON.stringify(expand)}).focus();true`);
  await key('Enter', 'Enter', 13);
  await until(`document.querySelector(${JSON.stringify(expand)}).getAttribute('aria-expanded')==='false'`);
  assert.equal(await renderer.evaluate('document.querySelector(".session-row--selected").closest("[data-session-id]").dataset.sessionId'), fixture.parent);
  await pointer(`[data-session-id="${fixture.parent}"] .session-row__menu`);
  await until('Boolean(document.querySelector(".session-menu[role=menu]"))');
  await shot(`${label}-parent-menu`);
  await key('Escape', 'Escape', 27);
  await until('!document.querySelector(".session-menu")');
  await pointer(`[data-session-id="${fixture.ordinary}"] .session-row__menu`);
  await until('Boolean(document.querySelector(".session-menu[role=menu]"))');
  await key('Escape', 'Escape', 27);
}

try {
  await mkdir(resolve(project, '00-nested'), { recursive: true });
  await mkdir(configured, { recursive: true });
  await mkdir(captures, { recursive: true });
  await Promise.all(Array.from({ length: 110 }, (_, index) => writeFile(resolve(project,
    `file-${String(index).padStart(3, '0')}.txt`),
  Array.from({ length: 120 }, (_, line) => `File ${index}, line ${line}: retained editor content.`).join('\n'))));
  await writeFile(resolve(project, '00-nested/deep-file.txt'), 'Nested file remains reachable.\n');
  await mkdir(resolve(configured, '.mingshen'), { recursive: true });
  await writeFile(diagnosticServer, diagnosticSource);
  await writeFile(resolve(configured, '.mingshen/config.json'), JSON.stringify({
    lsp: { 'pane-fixture': { command: [process.execPath, diagnosticServer], extensions: ['.ps1'] } },
  }));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  execFileSync(process.execPath, [resolve('scripts/prepare-experimental-runtime.cjs')], { windowsHide: true, stdio: 'pipe' });
  const mainPort = await availablePort();
  let rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const env = { ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: resolve(temporary, 'profile'),
    MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'),
    [`--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`],
    { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__v131Fetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')
    ?Promise.resolve(Response.json([])):globalThis.__v131Fetch(url,options);true`);
  renderer = await connect(rendererPort, true);
  await renderer.send('Runtime.enable');
  await renderer.send('Page.bringToFront');
  await renderer.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await until('Boolean(document.querySelector(".policy-consents"))');
  await sleep(5100);
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  await click('.policy-dialog .btn--primary');
  await until('document.querySelector(".policy-dialog")?.textContent.includes("开始使用")&&!document.querySelector(".policy-consents")');
  await click('.policy-dialog .btn--primary');
  await until('!document.querySelector(".policy-dialog")');
  fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Pane regression fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',
      protocol:'openai_responses',authMode:'bearer',apiKey:'local-pane-fixture-only',keyLabel:'Fixture',neverReveal:true});
    const p=await window.mingshen.createModel({providerId:provider.id,modelId:'pane-fixture',contextWindow:200000,maxOutputTokens:8192,
      inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const s of await window.mingshen.listMcpServers())if(s.enabled)await window.mingshen.setMcpServerEnabled(s.id,false);
    const base={workspacePath:${JSON.stringify(project)},providerId:provider.id,modelId:p.models[0].id,reasoningLevel:null,permissionMode:'full_access'};
    const parent=await window.mingshen.createSession({...base,title:${JSON.stringify(parentTitle)}});
    await window.mingshen.setProjectMemoryEnabled(parent.id,false);
    const ordinary=await window.mingshen.createSession({...base,title:${JSON.stringify(ordinaryTitle)}});
    await window.mingshen.updateSession({sessionId:parent.id,pinned:true});
    const diagnostic=await window.mingshen.createSession({...base,workspacePath:${JSON.stringify(configured)},title:'Configured diagnostic error'});
    await window.mingshen.setProjectMemoryEnabled(diagnostic.id,false);
    const projects={};
    for(const style of ['simple','orbit']){
      const k=(style==='orbit'?'@orbit:':'')+parent.workspacePath.replaceAll('/','\\\\').replace(/\\\\+$/,'').toLowerCase();
      projects[k]={mode:'chat',sidebarWidth:228,inspectorWidth:400,sidebarOpen:true,inspectorOpen:true};
    }
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:'orbit',defaultLayout:'chat',projects});
    return {parent:parent.id,ordinary:ordinary.id,diagnostic:diagnostic.id};
  })()`);
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.parent)},text:'Write the PowerShell note and delegate one read-only layout review.'})`);
  await until(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.parent)}).then(messages=>messages.some(m=>m.parts.some(p=>p.type==='text'&&p.text.includes('PANE_PARENT_COMPLETE'))))`, 60000);
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.parent)}).then(s=>s.status==='idle')`);
  fixture.worker = (await renderer.evaluate(`window.mingshen.listSessionPage({parentId:${JSON.stringify(fixture.parent)}})`)).sessions[0]?.id;
  assert.ok(fixture.worker, 'A real spawned child must back the parent controls');
  await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(fixture.parent)},title:${JSON.stringify(parentTitle)}})`);
  await presentation('orbit', 'zh-CN', 'night', 1440, 900);
  await files();
  if (baseline) {
    const tree = await treeMetrics(), sidebar = await sidebarGeometry(fixture.parent);
    measurements.push({ baseline: true, tree, sidebar });
    assert.ok(tree.height >= tree.scrollHeight - 1 || tree.bottom > tree.paneBottom + 1, 'Expected original unconstrained file-tree regression');
    assert.ok(sidebar.title.right > sidebar.expand.left, 'Expected original title/control regression');
    await shot('orbit-zh-night');
    record('Original production output reproduces the clipped, non-scrolling file tree and overlapping parent controls');
  } else {
    assert.equal((await renderer.evaluate('window.mingshen.getAppInfo()')).version, version);
    const trajectories = await renderer.evaluate(`window.mingshen.listTrajectories(${JSON.stringify(fixture.parent)})`);
    assert.ok(!JSON.stringify(trajectories).includes('not-configured'), 'No-engine automatic checks must not create a bogus success activity');
    record('A real .ps1 write without project diagnostics emits no not-configured success activity');
    for (const style of ['orbit', 'simple']) for (const [locale, theme, width, height] of [
      ['zh-CN', 'night', 1440, 900], ['en', 'day', 1040, 680], ['zh-CN', 'day', 800, 680],
    ]) {
      const label = `${style}-${locale}-${theme}-${width}`;
      await presentation(style, locale, theme, width, height);
      await checkSidebar(label);
      await files();
      await scrollFiles(`${label}-files`);
      await shot(`${label}-files-bottom`);
      await pointer('.tree-row[title="file-109.txt"]');
      await until('document.querySelector(".editor-pane__header")?.textContent.includes("file-109.txt")');
      await scrollFiles(`${label}-with-editor`);
      await until('Boolean(document.querySelector(".editor-textarea"))');
      const editorMetrics = () => renderer.evaluate(`(()=>{
        const el=document.querySelector('.editor-textarea'),r=el.getBoundingClientRect();
        const pane=document.querySelector('.workspace-panel').getBoundingClientRect();
        const style=getComputedStyle(el);
        return {height:r.height,bottom:r.bottom,paneBottom:pane.bottom,
          retainedContent:el.value.includes('File 109, line 119'),scroll:el.scrollHeight,client:el.clientHeight,
          textHeight:el.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom),
          lineHeight:parseFloat(style.lineHeight)};
      })()`);
      const editor = await editorMetrics();
      assert.ok(editor.textHeight >= editor.lineHeight && editor.bottom <= editor.paneBottom + 1 && editor.retainedContent,
        `${label}: editor text is hidden: ${JSON.stringify(editor)}`);
      await shot(`${label}-with-editor`);
      await click('.command-dock-toggle');
      await scrollFiles(`${label}-commands-docked`);
      const dockedEditor = await editorMetrics();
      measurements.push({ label: `${label}-editor`, editor, dockedEditor });
      assert.ok(dockedEditor.textHeight >= dockedEditor.lineHeight && dockedEditor.bottom <= dockedEditor.paneBottom + 1,
        `${label}: docked commands hide the editor: ${JSON.stringify(dockedEditor)}`);
      await shot(`${label}-commands-docked`);
      await click('.command-dock-toggle');
      record(`${label}: long list wheel/keyboard, editor, command dock, pinned parent expansion and both menus`);
    }
    await presentation('orbit', 'zh-CN', 'night', 1440, 900);
    await select(fixture.diagnostic);
    await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.diagnostic)},text:'CONFIGURED_DIAGNOSTIC: write the PowerShell file and preserve the configured LSP diagnostic error.'})`);
    await until(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.diagnostic)}).then(messages=>messages.some(m=>m.parts.some(p=>p.type==='text'&&p.text.includes('CONFIGURED_DIAGNOSTIC_COMPLETE'))))`, 60000);
    await until(`window.mingshen.getSession(${JSON.stringify(fixture.diagnostic)}).then(s=>s.status==='idle')`, 60000);
    const report = await renderer.evaluate(`window.mingshen.listTrajectories(${JSON.stringify(fixture.diagnostic)})`);
    assert.ok(JSON.stringify(report).includes('V131_CONFIGURED_DIAGNOSTIC_FAILURE'), 'Configured failures must remain recorded');
    const diagnosticActivity = report.flatMap(run => run.events)
      .map(event => event.payload?.activity).find(activity => activity?.detail.includes('V131_CONFIGURED_DIAGNOSTIC_FAILURE'));
    assert.equal(diagnosticActivity?.status, 'failed');
    await until('Boolean(document.querySelector(".review-checks .expandable-text--error"))');
    await pointer('.review-checks .expandable-text--error > summary');
    await until('document.querySelector(".review-checks .expandable-text--error")?.open');
    await shot('configured-diagnostic-failure');
    record('A configured project LSP retains the real diagnostic error and failed activity');
  }
  assert.deepEqual(exceptions, []);
  assert.deepEqual(serverErrors, []);
  const result = { version, baseline, passed, localRequests: requests.length,
    workerRequests: requests.filter(item => item.worker).length, exceptions, measurements, screenshots };
  await writeFile(resolve(captures, `${baseline ? 'baseline-' : ''}result.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, measurements: `${measurements.length} entries saved in result.json` }, null, 2));
} catch (cause) {
  if (renderer) await shot('failure').catch(() => {});
  console.error(JSON.stringify({ passed, exceptions, serverErrors, measurements,
    focus: await renderer?.evaluate('({focused:document.hasFocus(),active:document.activeElement?.outerHTML.slice(0,500)})').catch(() => null),
    tree: await treeMetrics().catch(() => null),
    body: await renderer?.evaluate('document.body.innerText.slice(0,2000)').catch(() => null) }, null, 2));
  throw cause;
} finally {
  if (child) {
    const current = child, exited = new Promise(done => current.once('exit', done));
    await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
    renderer?.close();
    main?.close();
    await Promise.race([exited, sleep(7000)]);
    if (current.exitCode === null) { current.kill(); await exited; }
  }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  const root = resolve(tmpdir()) + sep;
  if (!temporary.startsWith(root) || !temporary.slice(root.length).startsWith('mingshen-v131-panes-'))
    throw new Error('Unsafe pane fixture cleanup path');
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
