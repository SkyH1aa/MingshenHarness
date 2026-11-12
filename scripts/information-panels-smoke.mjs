import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

// The owned terminal command, project configuration and failing MCP all stay local.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-information-panels-'));
const profile = resolve(temporary, 'profile');
const fixtureHome = resolve(temporary, 'home');
const project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review');
const passed = [], exceptions = [], serverErrors = [], requests = [], captures = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const commandTail = 'PANEL_COMMAND_ARGUMENT_TAIL_752e';
const outputTail = 'PANEL_STDOUT_COMPLETE_TAIL_953b';
const stderrTail = 'PANEL_STDERR_COMPLETE_TAIL_17cb';
const mcpTail = 'PANEL_MCP_ERROR_COMPLETE_TAIL_d84b';
const toolTail = 'panel_custom_tool_path_tail_13e0';
const integrationTail = 'PANEL_INTEGRATION_COMMAND_TAIL_c26d';
const extensionTail = '.panel_extension_tail_349b';
const contextTail = 'PANEL_CONTEXT_ERROR_TAIL_69ed';
const composerTail = 'PANEL_COMPOSER_ERROR_TAIL_04bc';
const contextError = `PANEL_CONTEXT_FAILURE_START\n${'Complete context failure diagnostic.\n'.repeat(100)}\n${contextTail}`;
const composerError = `PANEL_COMPOSER_FAILURE_START\n${'Complete composer failure diagnostic.\n'.repeat(100)}\n${composerTail}`;
const mcpSecret = 'local-panels-header-fixture-only';
const mcpName = 'Information panels local MCP';
const longArgument = `${'preserve_complete_argument_'.repeat(100)}${commandTail}`;
const toolPath = resolve(project, '.mingshen/tools', `${'long_source_'.repeat(5)}${toolTail}.mjs`);
const toolDescription = 'Custom tool (loaded only during an authorized Full Access run)';
const stdout = [
  'PANEL_STDOUT_FIRST_LINE',
  ...Array.from({ length: 28 }, (_, index) => `stdout line ${index + 1}: complete local command evidence`),
  `LONG_SINGLE_LINE_${'0123456789abcdef'.repeat(240)}`,
  '', outputTail, '',
].join('\n');
const stderr = [
  'PANEL_STDERR_FIRST_LINE',
  ...Array.from({ length: 12 }, (_, index) => `stderr line ${index + 1}: intentional exit seven`),
  '', stderrTail, '',
].join('\n');
const mcpBody = [
  'PANEL_MCP_HTTP_FAILURE_START',
  ...Array.from({ length: 100 }, (_, index) => `MCP diagnostic ${index + 1}: preserve the complete original response`),
  `Echoed fixture header: Bearer ${mcpSecret}`,
  `LONG_MCP_SINGLE_LINE_${'abcdef0123456789'.repeat(150)}`,
  '', mcpTail,
].join('\n');
const mcpDescription = `Complete local MCP description. ${'Description evidence remains readable. '.repeat(20)}DESCRIPTION_TAIL_dc39`;
const integrationCommand = [
  process.execPath,
  './owned-language-server.cjs',
  `--fixture-description=${'complete_command_'.repeat(90)}${integrationTail}`,
];
const extensions = [
  ...Array.from({ length: 22 }, (_, index) => `.panel_extension_${index + 1}`),
  extensionTail,
];
const quotePowerShell = value => `'${value.replaceAll("'", "''")}'`;
const command = `& ${quotePowerShell(process.execPath)} './panel-command.cjs' ${quotePowerShell(longArgument)}; exit $LASTEXITCODE`;
let child, main, renderer, fixture;

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push({ method: body.method, path: request.url });
    assert.equal(request.headers.authorization, `Bearer ${mcpSecret}`);
    assert.equal(body.method, 'initialize');
    response.writeHead(503, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Request-Id': 'local-information-panels-mcp',
    });
    response.end(mcpBody);
  } catch (cause) {
    serverErrors.push(cause.stack || String(cause));
    if (!response.destroyed) {
      if (!response.headersSent) response.writeHead(500);
      response.end('Local information panel fixture failed.');
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
      exceptions.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
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
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
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
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await renderer.evaluate(expression)) return;
    } catch (cause) {
      if (!/context|navigat|reload|destroyed/i.test(String(cause))) throw cause;
      lastError = cause;
    }
    await sleep(65);
  }
  throw new Error(`Timed out: ${expression}${lastError ? ` (${lastError})` : ''}`);
}

async function click(selector, text) {
  const target = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0${text === undefined ? '' : `&&el.textContent.trim()===${JSON.stringify(text)}`})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}

async function chooseLayout(mode, style) {
  await click(`${style === 'orbit' ? '.orbit-workspace-header' : '.app-topbar'} button[data-layout="${mode}"]`);
  await until(`document.querySelector('.app-shell')?.dataset.layout===${JSON.stringify(mode)}`);
}

async function replace(selector, value) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    element.focus();element.select();return true;
  })()`);
  await renderer.send('Input.insertText', { text: value });
  await until(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`);
}

async function nativeToggle(selector, open) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  if (await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).open`) !== open) {
    await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).querySelector(':scope > summary').focus({preventScroll:true});true`);
    await renderer.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      text: '\r', unmodifiedText: '\r',
    });
    await renderer.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    });
  }
  await until(`document.querySelector(${JSON.stringify(selector)})?.open===${open}`);
  if (selector !== '.terminal-entry') {
    await until(`Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('.expandable-text__body pre'))===${open}`);
  }
}

async function installCopyCapture() {
  await renderer.evaluate(`(()=>{
    window.__panelCopy=null;
    Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.__panelCopy=text}});
    return true;
  })()`);
}

async function assertCopy(selector, expected) {
  await renderer.evaluate('window.__panelCopy=null;true');
  await click(`${selector} .copy-control button`);
  await until('window.__panelCopy!==null');
  assert.equal(await renderer.evaluate('window.__panelCopy'), expected, 'Copy must preserve the exact full detail text');
}

async function viewport(width, height) {
  await renderer.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  await sleep(180);
}

async function assertOrbitTaskDock() {
  const state = await renderer.evaluate(`(()=>{
    const host=document.querySelector('.task-host');
    const task=host?.querySelector('.task-workbench');
    const body=task?.querySelector('.task-workbench__body');
    const steps=[...task?.querySelectorAll('.plan-step')??[]];
    if(!host||!task||!body||!steps.length)throw new Error('Missing fixed Orbit task plan');
    const box=el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const within=(inner,outer)=>inner.width>0&&inner.height>0&&inner.top>=outer.top-2&&inner.bottom<=outer.bottom+2&&inner.left>=outer.left-2&&inner.right<=outer.right+2;
    const hostBox=box(host),taskBox=box(task),bodyBox=box(body);
    body.scrollTop=0;
    const firstVisible=within(box(steps[0]),bodyBox);
    body.scrollTop=body.scrollHeight;
    const lastVisible=within(box(steps.at(-1)),bodyBox);
    const range=body.scrollHeight-body.clientHeight;
    const remaining=body.scrollHeight-body.clientHeight-body.scrollTop;
    body.scrollTop=0;
    return{
      hidden:host.hidden,docked:task.dataset.taskDocked,view:task.dataset.taskView,
      host:hostBox,task:taskBox,body:bodyBox,
      viewport:{left:0,right:innerWidth,top:0,bottom:innerHeight},
      bodyWithinTask:within(bodyBox,taskBox),hostWithinViewport:within(hostBox,{left:0,right:innerWidth,top:0,bottom:innerHeight}),
      titles:steps.map(step=>step.querySelector('strong').textContent),
      overflow:getComputedStyle(body).overflowY,firstVisible,lastVisible,range,remaining
    };
  })()`);
  assert.equal(state.hidden, false, JSON.stringify(state));
  assert.equal(state.docked, 'true', JSON.stringify(state));
  assert.equal(state.view, 'plan', JSON.stringify(state));
  assert.equal(state.bodyWithinTask, true, JSON.stringify(state));
  assert.equal(state.hostWithinViewport, true, JSON.stringify(state));
  assert.deepEqual(state.titles, Array.from({ length: 8 }, (_, index) => `Owned inspection step ${index + 1}`));
  assert.match(state.overflow, /auto|scroll/);
  assert.ok(state.range > 0 && Math.abs(state.remaining) <= 2, JSON.stringify(state));
  assert.equal(state.firstVisible, true, JSON.stringify(state));
  assert.equal(state.lastVisible, true, JSON.stringify(state));
  await assertBounds('.task-workbench');
}

async function scrollWithin(selector, containerSelector) {
  await renderer.evaluate(`(()=>{
    const target=document.querySelector(${JSON.stringify(selector)});
    const container=document.querySelector(${JSON.stringify(containerSelector)});
    const bounds=target.getBoundingClientRect();
    container.scrollTop+=bounds.top-container.getBoundingClientRect().top-Math.max(0,(container.clientHeight-bounds.height)/2);
    return true;
  })()`);
}

async function shot(name) {
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await renderer.evaluate(`Promise.all(
    (document.querySelector('.settings-workspace')?.getAnimations()??[])
      .map(animation=>animation.finished.catch(()=>{}))
  )`);
  await sleep(150);
  const settings = await renderer.evaluate(`(()=>{
    const element=document.querySelector('.settings-workspace');
    if(!element)return null;
    const bounds=element.getBoundingClientRect();
    return{top:bounds.top,bottom:bounds.bottom,opacity:getComputedStyle(element).opacity,height:innerHeight};
  })()`);
  if (settings) {
    assert.ok(settings.top >= 47 && settings.bottom <= settings.height + 1, JSON.stringify(settings));
    assert.equal(Number(settings.opacity), 1, 'The settings screenshot must capture the visible completed entry frame');
  }
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(screenshots, `information-panels-${name}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  captures.push(path);
}

async function assertBounds(root) {
  const state = await renderer.evaluate(`(()=>{
    const parent=document.querySelector(${JSON.stringify(root)});
    const issues=[];
    for(const el of [parent,...parent.querySelectorAll('.expandable-text,.expandable-text__body,.expandable-text__body pre,.terminal-entry,.terminal-entry pre,.mcp-card--detail,.tooling-status-row')]){
      const rect=el.getBoundingClientRect();
      if(!rect.width||!rect.height)continue;
      if(el.scrollWidth>el.clientWidth+2)issues.push({className:el.className,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth});
      if(rect.left < -2 || rect.right > innerWidth+2)issues.push({className:el.className,left:rect.left,right:rect.right,viewport:innerWidth});
    }
    return{overflow:document.documentElement.scrollWidth>innerWidth+1,issues};
  })()`);
  assert.equal(state.overflow, false, JSON.stringify(state));
  assert.deepEqual(state.issues, [], `Long panel content must wrap within ${root}`);
}

async function assertScrollableTail(selector, tail) {
  const state = await renderer.evaluate(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)}).querySelector('pre');
    element.scrollTop=element.scrollHeight;
    return{
      text:element.textContent,
      overflow:getComputedStyle(element).overflowY,
      range:element.scrollHeight-element.clientHeight,
      remaining:element.scrollHeight-element.clientHeight-element.scrollTop
    };
  })()`);
  assert.ok(state.text.endsWith(tail));
  assert.match(state.overflow, /auto|scroll/);
  assert.ok(state.range > 0, `${selector} must exercise real internal scrolling`);
  assert.ok(Math.abs(state.remaining) <= 2, `${selector} must reach the final diagnostic`);
}

async function launch() {
  const mainPort = await availablePort();
  let rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const env = {
    ...process.env, MSH_EXPERIMENTAL: '1', MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1', MSH_NOTIFICATION_FIXTURE: '1',
    USERPROFILE: fixtureHome, HOME: fixtureHome,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), [
    `--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`,
  ], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort, 'main');
  assert.equal(
    resolve(await main.evaluate('process.getBuiltinModule("node:os").homedir()')),
    fixtureHome,
    'Global custom-tool discovery must use the owned temporary home',
  );
  await main.evaluate(`globalThis.__panelsFixtureFetch=fetch;
    globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')
      ?Promise.resolve(Response.json([])):globalThis.__panelsFixtureFetch(url,options);true`);
  renderer = await connect(rendererPort, 'renderer');
  await renderer.send('Runtime.enable');
}

function record(value) {
  passed.push(value);
  console.log(`PASS ${passed.length}: ${value}`);
}

try {
  assert.ok(mcpBody.indexOf(mcpTail) > 4000);
  await mkdir(project, { recursive: true });
  await mkdir(fixtureHome, { recursive: true });
  await mkdir(resolve(project, '.mingshen/tools'), { recursive: true });
  await mkdir(screenshots, { recursive: true });
  await writeFile(resolve(project, 'panel-command.cjs'), [
    `process.stdout.write(${JSON.stringify(stdout)});`,
    `process.stderr.write(${JSON.stringify(stderr)});`,
    'process.exitCode=7;',
  ].join('\n'));
  await writeFile(toolPath, [
    'export default {',
    'description: "Owned custom tool fixture, never executed by this smoke.",',
    'args: {}, execute: async () => "Unused owned tool result",',
    '};',
  ].join('\n'));
  await writeFile(resolve(project, '.mingshen/config.json'), JSON.stringify({
    lsp: { 'panel-long-language-server': { command: integrationCommand, extensions } },
    formatter: { 'panel-long-formatter': { command: [...integrationCommand, '$FILE'], extensions } },
  }, null, 2));
  await new Promise(doneListening => server.listen(0, '127.0.0.1', doneListening));
  const mcpUrl = `http://127.0.0.1:${server.address().port}/mcp/${'long-connection-path-'.repeat(50)}CONNECTION_TAIL_21d7`;
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
  fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:'Information panels fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-panels-provider-fixture-only',keyLabel:'Fixture',neverReveal:true});
    const updated=await window.mingshen.createModel({providerId:provider.id,modelId:'panels-fixture',displayName:'Information panels fixture',contextWindow:128000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:false,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    const session=await window.mingshen.createSession({title:'Information panels fixture',workspacePath:${JSON.stringify(project)},providerId:provider.id,modelId:updated.models[0].id,permissionMode:'full_access',executionMode:'host',reasoningLevel:null});
    await window.mingshen.setProjectTrust(${JSON.stringify(project)},true);
    await window.mingshen.setProjectMemoryEnabled(session.id,false);
    const workbench=await window.mingshen.getWorkbench(session.id);
    await window.mingshen.updatePlan({sessionId:session.id,revision:workbench.plan.revision,steps:
      Array.from({length:8},(_,index)=>({
        id:'panel-step-'+index,content:'Owned inspection step '+(index+1),status:'pending',
        priority:'medium',updatedAt:new Date().toISOString(),dependsOn:[]
      }))
    });
    const mcp=await window.mingshen.saveMcpServer({name:${JSON.stringify(mcpName)},description:${JSON.stringify(mcpDescription)},transport:'http',enabled:false,url:${JSON.stringify(mcpUrl)},headers:{Authorization:${JSON.stringify(`Bearer ${mcpSecret}`)}},oauthEnabled:false,timeoutMs:10000});
    return{sessionId:session.id,mcpId:mcp.id};
  })()`);
  const customTools = await renderer.evaluate(`window.mingshen.listCustomTools(${JSON.stringify(project)})`);
  assert.equal(customTools.length, 1, 'Only the owned project custom tool may be discovered');
  assert.equal(customTools[0].sourcePath, toolPath);
  assert.equal(customTools[0].description, toolDescription);
  const tooling = await renderer.evaluate(`window.mingshen.getToolingStatus(${JSON.stringify(project)})`);
  for (const id of ['panel-long-language-server', 'panel-long-formatter']) {
    const item = tooling.find(entry => entry.id === id);
    assert.ok(item?.available, `${id} must be discoverable from the owned project configuration`);
    assert.ok(item.command.join(' ').includes(integrationTail));
    assert.equal(item.extensions.at(-1), extensionTail);
  }
  record('Real project IPC discovers the complete custom-tool path and long language-server/formatter configurations within a temporary home');

  for (const [style, locale, theme, width, height] of [
    ['simple', 'zh-CN', 'night', 1440, 900],
    ['orbit', 'en', 'day', 800, 680],
  ]) {
    const english = locale === 'en';
    const suffix = `${style}-${locale}-${theme}-${width}`;
    await renderer.evaluate(`(async()=>{
      await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),defaultLayout:'code',interfaceStyle:${JSON.stringify(style)}});
      await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});
      localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
      localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
    })()`);
    await renderer.send('Page.reload');
    await until(`document.documentElement?.dataset.interfaceStyle===${JSON.stringify(style)}&&Boolean(document.querySelector(".composer textarea"))`);
    await viewport(width, height);
    await installCopyCapture();
    await chooseLayout('code', style);
    await until('document.querySelector(".inspector-host")?.hidden===false&&document.querySelector(".workspace-panel")?.getBoundingClientRect().height>0');
    await click('.workspace-tabs button', english ? 'Terminal' : '\u7ec8\u7aef');
    await replace('.terminal-input-row input', command);
    await click('.terminal-input-row button[type=submit]');
    await until('document.querySelector(".terminal-entry .terminal-meta")?.textContent.includes("exit 7")');
    const terminalParts = await renderer.evaluate(`(()=>{
      const entry=document.querySelector('.terminal-entry');
      return{open:entry.open,parts:[...entry.querySelectorAll('pre')].map(el=>el.textContent),meta:entry.querySelector('.terminal-meta').textContent};
    })()`);
    assert.equal(terminalParts.open, true);
    assert.equal(terminalParts.parts[0], command);
    assert.equal(terminalParts.parts[1].replaceAll('\r\n', '\n'), stdout);
    assert.equal(terminalParts.parts[2].replaceAll('\r\n', '\n'), stderr);
    assert.ok(terminalParts.parts[0].includes(commandTail));
    assert.ok(terminalParts.parts[1].includes(outputTail));
    assert.ok(terminalParts.parts[2].includes(stderrTail));
    await assertCopy('.terminal-entry', [...terminalParts.parts, terminalParts.meta].join('\n\n'));
    await assertBounds('.workspace-panel');
    await shot(`terminal-open-${suffix}`);
    await nativeToggle('.terminal-entry', false);
    const closedHeight = await renderer.evaluate('document.querySelector(".terminal-entry").getBoundingClientRect().height');
    assert.ok(closedHeight <= 60, `Collapsed terminal entry must stay compact: ${closedHeight}`);
    await shot(`terminal-closed-${suffix}`);
    await nativeToggle('.terminal-entry', true);
    assert.equal(await renderer.evaluate('document.querySelector(".terminal-entry__command").textContent'), command);
    record(`${suffix}: owned PowerShell terminal preserves complete long command, stdout, stderr, exit status and exact copy through native keyboard collapse/reopen`);

    await click(style === 'orbit'
      ? '.orbit-tool-rail button[data-orbit-action="settings"]'
      : `.app-topbar button[aria-label="${english ? 'Open settings' : '\u6253\u5f00\u8bbe\u7f6e'}"]`);
    await click('.settings-nav__item', english ? 'Runtime and integrations' : '\u8fd0\u884c\u4e0e\u96c6\u6210');
    await until('document.querySelectorAll(".tooling-status-row--tool").length===1');
    const customSelector = '.tooling-status-row--tool .expandable-text';
    await nativeToggle(customSelector, true);
    const customText = await renderer.evaluate(`document.querySelector(${JSON.stringify(customSelector)}).querySelector('pre').textContent`);
    assert.equal(customText, `${toolPath}\n\n${toolDescription}`);
    await assertCopy(customSelector, customText);
    const status = await renderer.evaluate(`(()=>{
      const element=document.querySelector('.tooling-status-row--tool > .state-ok');
      const rect=element.getBoundingClientRect();
      return{display:getComputedStyle(element).display,width:rect.width,height:rect.height,text:element.textContent};
    })()`);
    assert.notEqual(status.display, 'none');
    assert.ok(status.width > 0 && status.height > 0, JSON.stringify(status));
    assert.equal(status.text, english ? 'Available' : '\u53ef\u7528');
    const configuredRows = await renderer.evaluate(`(()=>{
      const sections=[...document.querySelectorAll('.settings-page > .settings-block')];
      return sections.flatMap((section,sectionIndex)=>[...section.querySelectorAll('.tooling-status-row')].map((row,rowIndex)=>({
        name:row.querySelector('strong')?.textContent,
        selector:'.settings-page > .settings-block:nth-child('+(sectionIndex+1)+') .tooling-status-row:nth-child('+(rowIndex+1)+') .expandable-text'
      }))).filter(row=>row.name?.startsWith('panel-long-'));
    })()`);
    assert.equal(configuredRows.length, 2);
    for (const row of configuredRows) {
      await nativeToggle(row.selector, true);
      const text = await renderer.evaluate(`document.querySelector(${JSON.stringify(row.selector)}).querySelector('pre').textContent`);
      const data = tooling.find(item => item.name === row.name);
      assert.equal(text, `${data.command.join(' ')}\n\n${data.extensions.join(' ')}`);
      assert.ok(text.includes(integrationTail) && text.includes(extensionTail));
      await assertCopy(row.selector, text);
      await nativeToggle(row.selector, false);
    }
    await scrollWithin('.tooling-status-row--tool', '.settings-content__body');
    await assertBounds('.settings-workspace');
    await shot(`runtime-details-${suffix}`);
    await nativeToggle(customSelector, false);
    record(`${suffix}: custom-tool full path/description and integration command/extensions expand and copy completely; narrow custom-tool availability remains visible`);

    await click('.settings-nav__item', 'MCP Servers');
    await click('.connection-select', mcpName);
    await until('Boolean(document.querySelector(".mcp-card--detail"))');
    assert.equal(await renderer.evaluate('document.querySelector(".mcp-card--detail .mcp-card__copy p").textContent'), mcpDescription);
    const connectionSelector = '.mcp-card--detail .mcp-card__connection';
    await nativeToggle(connectionSelector, true);
    assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(connectionSelector)}).querySelector('pre').textContent`), mcpUrl);
    await assertCopy(connectionSelector, mcpUrl);
    await nativeToggle(connectionSelector, false);
    await click('.connection-master .mcp-group:last-child .mcp-card .btn', english ? 'Test' : '\u6d4b\u8bd5');
    await until('Boolean(document.querySelector(".mcp-card--detail .mcp-test--error"))');
    const errorSelector = '.mcp-card--detail .mcp-card__error';
    const testSelector = '.mcp-card--detail .mcp-test .expandable-text';
    await nativeToggle(errorSelector, true);
    await nativeToggle(testSelector, true);
    const actualError = await renderer.evaluate(`document.querySelector(${JSON.stringify(errorSelector)}).querySelector('pre').textContent`);
    const testedError = await renderer.evaluate(`document.querySelector(${JSON.stringify(testSelector)}).querySelector('pre').textContent`);
    const persisted = await renderer.evaluate(`window.mingshen.listMcpServers().then(items=>items.find(item=>item.id===${JSON.stringify(fixture.mcpId)}))`);
    assert.match(actualError, /HTTP 503/);
    assert.ok(actualError.includes(mcpTail), 'MCP error tail beyond 4000 characters must survive service and UI');
    assert.ok(actualError.includes(`\n\n${mcpTail}`), 'MCP blank lines must survive disclosure');
    assert.ok(!actualError.includes(mcpSecret), 'Configured fake secrets must remain redacted from expanded MCP errors');
    assert.equal(actualError, persisted.lastError);
    assert.equal(testedError, actualError);
    await assertCopy(errorSelector, actualError);
    await assertCopy(testSelector, actualError);
    await scrollWithin(`${testSelector} > summary`, '.settings-content__body');
    await assertBounds('.settings-workspace');
    await shot(`mcp-error-open-${suffix}`);
    await nativeToggle(errorSelector, false);
    await nativeToggle(testSelector, false);
    await assertBounds('.settings-workspace');
    record(`${suffix}: real local MCP failure exposes complete persisted/test diagnostics with long description/connection, exact copy and secret redaction`);
    await click('.settings-content__header button');

    // Inject only owned UI failure events; backend compaction/reply execution is not claimed here.
    const context = await renderer.evaluate(`window.mingshen.getContextUsage(${JSON.stringify(fixture.sessionId)})`);
    const notifications = await renderer.evaluate('window.mingshen.getCompletionNotifications()');
    await main.evaluate(`(()=>{
      const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
      const window=BrowserWindow.getAllWindows().find(value=>value.webContents.getURL().includes('index.html'));
      if(!window)throw new Error('Owned fixture window unavailable');
      window.webContents.send('runtime:event',{type:'context_updated',context:{
        ...${JSON.stringify(context)},sessionId:${JSON.stringify(fixture.sessionId)},
        runId:'information-panels-ui-failure',state:'failed',usedTokens:1000,contextWindow:128000,
        source:'estimate',lastCompactedAt:null,error:${JSON.stringify(contextError)},updatedAt:new Date().toISOString()
      }});
      window.webContents.send('notifications:event',{
        ...${JSON.stringify(notifications)},replyDraft:{
          id:${JSON.stringify(`panel-reply-${suffix}`)},sessionId:${JSON.stringify(fixture.sessionId)},
          text:'Owned reply draft retained for inspection.',error:${JSON.stringify(composerError)}
        }
      });
      return true;
    })()`);
    await until('Boolean(document.querySelector(".context-notice--error"))&&Boolean(document.querySelector(".composer-error"))');
    await chooseLayout('chat', style);
    if (style === 'simple') {
      if (await renderer.evaluate('document.querySelector("button.task-workbench__toggle").getAttribute("aria-expanded")==="true"')) {
        await click('button.task-workbench__toggle');
      }
      await until('!document.querySelector(".task-workbench__body")');
      await click('button.task-workbench__toggle');
    } else {
      await until('document.querySelector(".task-workbench")?.dataset.taskDocked==="true"');
      await click('.task-workbench button[data-task-tab="agents"]');
      await until('document.querySelector(".task-workbench")?.dataset.taskView==="agents"');
      await click('.task-workbench button[data-task-tab="plan"]');
    }
    await until('Boolean(document.querySelector(".task-workbench__body"))');
    await until('document.querySelector(".task-workbench")?.dataset.taskView==="plan"&&document.querySelectorAll(".plan-step").length===8');
    await viewport(800, 600);
    if (style === 'orbit') await assertOrbitTaskDock();
    await nativeToggle('.context-notice--error', true);
    await nativeToggle('.composer-error', true);
    assert.equal(await renderer.evaluate('document.querySelector(".context-notice--error pre").textContent'), contextError);
    assert.equal(await renderer.evaluate('document.querySelector(".composer-error pre").textContent'), composerError);
    await assertCopy('.context-notice--error', contextError);
    await assertCopy('.composer-error', composerError);
    await assertScrollableTail('.context-notice--error', contextTail);
    await assertScrollableTail('.composer-error', composerTail);
    const composerBounds = await renderer.evaluate(`(()=>{
      const chat=document.querySelector('.chat-view').getBoundingClientRect();
      const element=document.querySelector('.composer-wrap');
      const bounds=element.getBoundingClientRect();
      element.scrollTop=element.scrollHeight;
      return{
        chat:{top:chat.top,bottom:chat.bottom},
        composer:{top:bounds.top,bottom:bounds.bottom},
        range:element.scrollHeight-element.clientHeight,
        remaining:element.scrollHeight-element.clientHeight-element.scrollTop,
        overflow:getComputedStyle(element).overflowY
      };
    })()`);
    assert.ok(composerBounds.composer.top >= composerBounds.chat.top - 2, JSON.stringify(composerBounds));
    assert.ok(composerBounds.composer.bottom <= 602, JSON.stringify(composerBounds));
    assert.match(composerBounds.overflow, /auto|scroll/);
    assert.ok(composerBounds.range > 0, JSON.stringify(composerBounds));
    assert.ok(Math.abs(composerBounds.remaining) <= 2, JSON.stringify(composerBounds));
    await assertBounds('.composer-wrap');
    await shot(`composer-errors-bottom-${suffix}-800x600`);
    await scrollWithin('.composer', '.composer-wrap');
    const inputBounds = await renderer.evaluate(`(()=>{
      const input=document.querySelector('.composer textarea').getBoundingClientRect();
      const composer=document.querySelector('.composer-wrap').getBoundingClientRect();
      return{top:input.top,bottom:input.bottom,containerTop:composer.top,containerBottom:composer.bottom};
    })()`);
    assert.ok(inputBounds.top >= inputBounds.containerTop - 2 && inputBounds.bottom <= inputBounds.containerBottom + 2, JSON.stringify(inputBounds));
    assert.equal(await renderer.evaluate('document.querySelector(".app-body").scrollTop'), 0, 'Only the composer may scroll while reaching its input');
    await shot(`composer-errors-input-${suffix}-800x600`);
    await nativeToggle('.context-notice--error', false);
    await nativeToggle('.composer-error', false);
    if (style === 'simple') {
      await click('button.task-workbench__toggle');
      await until('!document.querySelector(".task-workbench__body")');
    } else {
      await assertOrbitTaskDock();
    }
    record(`${suffix}: two simultaneous injected composer/context failures expand and copy in an 800x600 window with ${style === 'orbit' ? 'a fixed task dock and all eight plan steps reachable' : 'an open task band'}; both tails and the input remain reachable by scrolling`);
  }
  assert.deepEqual(serverErrors, []);
  assert.deepEqual(exceptions, []);
  assert.equal(requests.length, 2, 'Each appearance scenario should perform one owned MCP initialize request');
  record('Both panel scenarios finish with two owned MCP requests, no horizontal overflow and no uncaught renderer exceptions');
  console.log(JSON.stringify({
    version, passed, captures, localMcpRequests: requests.length,
    rendererExceptions: exceptions, serverErrors,
    boundaries: [
      'Real Electron, owned PowerShell commands and local HTTP MCP errors',
      'A temporary USERPROFILE/HOME isolates global custom-tool discovery',
      'Custom-tool listing intentionally exposes a generic description without executing authored metadata',
      'Composer/context failures are injected local UI events; this does not certify backend compaction or reply failure execution',
      'Copy is captured in the isolated renderer; the system clipboard is not accessed',
      'No private profile/database, paid model requests, installer, cloud SQL or Git publishing',
      'Representative viewport checks do not certify every Windows DPI or assistive technology',
    ],
  }, null, 2));
} catch (cause) {
  if (renderer) await shot('failure').catch(() => {});
  console.error(JSON.stringify({
    passed, exceptions, serverErrors, requests,
    body: await renderer?.evaluate('document.body.innerText').catch(() => null),
  }, null, 2));
  throw cause;
} finally {
  if (child) {
    const closing = child;
    const exited = closing.exitCode === null
      ? new Promise(doneExiting => closing.once('exit', doneExiting))
      : Promise.resolve();
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
  await new Promise(doneClosing => server.close(doneClosing));
  const root = resolve(tmpdir()) + sep;
  if (!temporary.startsWith(root) || !temporary.slice(root.length).startsWith('mingshen-information-panels-')) {
    throw new Error('Unsafe fixture cleanup path');
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
