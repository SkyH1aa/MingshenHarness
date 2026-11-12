import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

// Only an isolated temporary profile, local model server and owned command run here.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-information-disclosure-'));
const profile = resolve(temporary, 'profile');
const project = resolve(temporary, 'project');
const screenshots = resolve('.impeccable/review');
const passed = [], exceptions = [], serverErrors = [], requests = [], captures = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const deferred = () => {
  let release;
  const promise = new Promise(done => { release = done; });
  return { promise, release };
};
const commandFinal = deferred(), retryProgress = deferred(), retryFinal = deferred();
const commandTail = 'COMMAND_ARGUMENT_TAIL_7d98';
const outputTail = 'STDOUT_COMPLETE_TAIL_38c5';
const stderrTail = 'STDERR_FAILURE_TAIL_95ab';
const retryTail = 'HTTP_RETRY_COMPLETE_TAIL_106e';
const errorTail = 'HTTP_FAILURE_COMPLETE_TAIL_67d2';
const longArgument = `ARGUMENT_START_${'complete_argument_'.repeat(150)}${commandTail}`;
const stdout = [
  'STDOUT_FIRST_LINE',
  ...Array.from({ length: 35 }, (_, index) => `stdout line ${index + 1}: preserve the complete command result`),
  `LONG_SINGLE_LINE_${'0123456789abcdef'.repeat(280)}`,
  'STDOUT_BEFORE_BLANK_LINE', '', outputTail, '',
].join('\n');
const stderr = [
  'STDERR_FIRST_LINE',
  ...Array.from({ length: 12 }, (_, index) => `stderr detail ${index + 1}: expected fixture failure`),
  stderrTail, '',
].join('\n');
const retryError = [
  'LOCAL_HTTP_RETRY_START',
  ...Array.from({ length: 65 }, (_, index) => `retry diagnostic ${index + 1}: retain the full upstream response`),
  '', retryTail,
].join('\n');
const terminalError = [
  'LOCAL_HTTP_FAILURE_START',
  ...Array.from({ length: 65 }, (_, index) => `failure diagnostic ${index + 1}: retain this original error line`),
  `LONG_HTTP_SINGLE_LINE_${'abcdef0123456789'.repeat(180)}`, '', errorTail,
].join('\n');
const quotePowerShell = value => `'${value.replaceAll("'", "''")}'`;
const command = `& ${quotePowerShell(process.execPath)} './disclosure-output.cjs' ${quotePowerShell(longArgument)}`;
const commandSelector = '.activity-file-group[data-activity-id$=":disclosure-command"] .activity-disclosure';
const retrySelector = '.activity-file-group[data-activity-id*=":retry:"] .activity-disclosure';
let child, main, renderer, scenario = 'history', count = 0, fixture;

function completed(response, text, output) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (text) response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`);
  response.end(`data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      status: 'completed',
      ...(output ? { output } : {}),
      usage: { input_tokens: 5000, output_tokens: 100, total_tokens: 5100 },
    },
  })}\n\n`);
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if ((body.instructions || '').includes('\u4f1a\u8bdd\u6807\u9898\u751f\u6210')) {
      completed(response, 'Information disclosure verification');
      return;
    }
    const activeScenario = scenario;
    const round = ++count;
    requests.push({ scenario: activeScenario, round, body });
    if (activeScenario === 'history') {
      completed(response, Array.from({ length: 100 }, (_, index) =>
        `History paragraph ${index + 1}. Complete local evidence remains available while new activity changes. This paragraph gives the scroll fixture enough real conversation content to read.\n\n`).join(''));
    } else if (activeScenario === 'command') {
      if (round === 1) {
        completed(response, '', [{
          type: 'function_call', call_id: 'disclosure-command', name: 'run_command',
          arguments: JSON.stringify({ command, timeout_ms: 120000 }),
        }]);
      } else {
        const result = body.input?.find(item =>
          item.type === 'function_call_output' && item.call_id === 'disclosure-command');
        assert.ok(result, 'A real command result must reach the next Responses request');
        assert.ok(String(result.output).includes(outputTail), 'The actual stdout tail must reach the model');
        assert.ok(String(result.output).includes(stderrTail), 'The actual stderr tail must reach the model');
        await commandFinal.promise;
        if (!response.destroyed) completed(response, 'The controlled command exited with code 7; its complete stdout and stderr are preserved.');
      }
    } else if (activeScenario === 'retry') {
      if (round === 1) {
        response.writeHead(503, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Retry-After': '0',
          'X-Request-Id': 'local-disclosure-retry',
        });
        response.end(retryError);
      } else {
        await retryProgress.promise;
        if (response.destroyed) return;
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({
          type: 'response.output_text.delta', delta: 'The local connection recovered. ',
        })}\n\n`);
        await retryFinal.promise;
        if (response.destroyed) return;
        response.end(`data: ${JSON.stringify({
          type: 'response.completed',
          response: { status: 'completed', usage: { input_tokens: 5000, output_tokens: 100, total_tokens: 5100 } },
        })}\n\n`);
      }
    } else if (activeScenario === 'error') {
      response.writeHead(403, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Request-Id': 'local-disclosure-permanent-error',
      });
      response.end(terminalError);
    } else {
      throw new Error(`Unknown local fixture scenario: ${activeScenario}`);
    }
  } catch (cause) {
    serverErrors.push(cause.stack || String(cause));
    if (!response.destroyed) {
      if (!response.headersSent) response.writeHead(500);
      response.end('Local disclosure fixture assertion failed.');
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

async function nativeToggle(selector, open) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const state = await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).open`);
  if (state !== open) {
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
  if (selector.includes('expandable-text') || selector.includes('disclosure') || selector.includes('message-error')) {
    await until(`Boolean(document.querySelector(${JSON.stringify(selector)})?.querySelector('.expandable-text__body pre'))===${open}`);
  }
}

async function installCopyCapture() {
  await renderer.evaluate(`(()=>{
    window.__fullCopy=null;
    Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.__fullCopy=text}});
    return true;
  })()`);
}

async function assertCopy(selector, expected) {
  await renderer.evaluate('window.__fullCopy=null;true');
  await click(`${selector} .copy-control button`);
  await until('window.__fullCopy!==null');
  assert.equal(await renderer.evaluate('window.__fullCopy'), expected, 'Copy must preserve the complete original disclosure text');
}

async function assertScrollableTail(selector, tail) {
  await until(`document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(tail)})`);
  const state = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});
    el.scrollTop=el.scrollHeight;
    return{overflow:getComputedStyle(el).overflowY,top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight,tail:el.textContent.includes(${JSON.stringify(tail)})};
  })()`);
  assert.match(state.overflow, /^(auto|scroll)$/, `Long detail must support user scrolling: ${JSON.stringify(state)}`);
  assert.ok(state.total > state.height && state.top > 0, `The fixture must exercise a vertically overflowing detail: ${JSON.stringify(state)}`);
  assert.ok(state.top + state.height >= state.total - 2, `The complete detail must be scrollable to its end: ${JSON.stringify(state)}`);
  assert.equal(state.tail, true, 'The end of the saved detail must remain available after scrolling');
}

async function viewport(width, height) {
  await renderer.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  await sleep(160);
}

async function shot(name) {
  await sleep(150);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(screenshots, `information-disclosure-${name}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  captures.push(path);
}

async function assertBounds() {
  const state = await renderer.evaluate(`(()=>{
    const issues=[];
    for(const el of document.querySelectorAll('.app-shell,.conversation-scroll,.conversation,.expandable-text,.expandable-text__body,.expandable-text__body pre,.tool-call,.tool-call__body pre')){
      const rect=el.getBoundingClientRect();
      if(!rect.width||!rect.height)continue;
      if(el.scrollWidth>el.clientWidth+2)issues.push({
        className:el.className,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,
        descendants:[...el.querySelectorAll('*')].filter(node=>{
          const child=node.getBoundingClientRect();
          return child.width>0&&(child.right>rect.right+1||child.left<rect.left-1);
        }).slice(0,12).map(node=>{
          const child=node.getBoundingClientRect(),style=getComputedStyle(node);
          return{tag:node.tagName,className:node.className,left:child.left,right:child.right,parentRight:rect.right,
            display:style.display,width:style.width,minWidth:style.minWidth,grid:style.gridTemplateColumns};
        }),
      });
      if(rect.left < -2 || rect.right > innerWidth+2)issues.push({className:el.className,left:rect.left,right:rect.right,viewport:innerWidth});
    }
    return{overflow:document.documentElement.scrollWidth>innerWidth+1,issues};
  })()`);
  assert.equal(state.overflow, false, JSON.stringify(state));
  assert.deepEqual(state.issues, [], 'Long command, output and error content must wrap within their own panels');
}

async function pauseInHistory() {
  await renderer.evaluate(`(()=>{
    const el=document.querySelector('.conversation-scroll');
    el.dispatchEvent(new WheelEvent('wheel',{deltaY:-180,bubbles:true}));
    el.scrollTop=Math.min(240,Math.max(0,(el.scrollHeight-el.clientHeight)/2));
    el.dispatchEvent(new Event('scroll',{bubbles:true}));
    return true;
  })()`);
  await until('Boolean(document.querySelector(".chat-scroll-controls"))');
  return renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop');
}

async function assertScroll(top) {
  await sleep(200);
  const actual = await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop');
  assert.ok(Math.abs(actual - top) <= 2, `Reading position changed from ${top} to ${actual}`);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".chat-scroll-controls"))'), true);
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
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), [
    `--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`,
  ], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort, 'main');
  await main.evaluate(`globalThis.__disclosureFixtureFetch=fetch;
    globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')
      ?Promise.resolve(Response.json([])):globalThis.__disclosureFixtureFetch(url,options);true`);
  renderer = await connect(rendererPort, 'renderer');
  await renderer.send('Runtime.enable');
}

async function send(value, text) {
  scenario = value;
  count = 0;
  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.sessionId)},text:${JSON.stringify(text)}})`);
}

async function done(status = 'idle') {
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(s=>s.status===${JSON.stringify(status)})`, 60000);
}

async function messages() {
  return renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)})`);
}

function record(value) {
  passed.push(value);
  console.log(`PASS ${passed.length}: ${value}`);
}

try {
  assert.ok(retryError.indexOf(retryTail) > 1500);
  assert.ok(terminalError.indexOf(errorTail) > 1500);
  await mkdir(project, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  await writeFile(resolve(project, 'disclosure-output.cjs'), [
    "const { existsSync } = require('node:fs');",
    "process.stdout.write('COMMAND_IS_RUNNING\\n');",
    "const timeout=setTimeout(()=>process.exit(97),110000);",
    "const poll=setInterval(()=>{if(!existsSync('command.release'))return;clearInterval(poll);clearTimeout(timeout);",
    `process.stdout.write(${JSON.stringify(stdout)});`,
    `process.stderr.write(${JSON.stringify(stderr)});`,
    'setTimeout(()=>process.exit(7),20);},60);',
  ].join('\n'));
  await new Promise(doneListening => server.listen(0, '127.0.0.1', doneListening));
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
    const provider=await window.mingshen.createProvider({name:'Disclosure local fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-disclosure-fixture-only',keyLabel:'Fixture',neverReveal:true});
    const updated=await window.mingshen.createModel({providerId:provider.id,modelId:'disclosure-fixture',displayName:'Disclosure fixture',contextWindow:128000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    for(const mcp of await window.mingshen.listMcpServers())if(mcp.enabled)await window.mingshen.setMcpServerEnabled(mcp.id,false);
    const session=await window.mingshen.createSession({title:'Information disclosure fixture',workspacePath:${JSON.stringify(project)},providerId:provider.id,modelId:updated.models[0].id,permissionMode:'full_access',executionMode:'host',reasoningLevel:null});
    await window.mingshen.setProjectMemoryEnabled(session.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:1});
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),defaultLayout:'chat',interfaceStyle:'orbit'});
    return{providerId:provider.id,sessionId:session.id};
  })()`);
  await renderer.send('Page.reload');
  await until('document.documentElement?.dataset.interfaceStyle==="orbit"&&Boolean(document.querySelector(".composer textarea"))');
  await viewport(1440, 900);
  await installCopyCapture();
  await send('history', 'Produce the complete local history fixture.');
  await done();
  await until('document.querySelector(".conversation")?.textContent.includes("History paragraph 100.")');
  record('A real local Responses conversation supplies long history without private data or paid requests');

  await send('command', 'Run the controlled long command, preserve all output and report its intentional failure honestly.');
  await until('Boolean(document.querySelector(".activity-trail__current-main"))');
  if (await renderer.evaluate('document.querySelector(".activity-trail__current-main").getAttribute("aria-expanded")==="true"')) {
    await click('.activity-trail__current-main');
  }
  await until('Boolean(document.querySelector(".activity-trail__current-main[aria-expanded=false]"))');
  const compactHeight = await renderer.evaluate('document.querySelector(".activity-trail__current").getBoundingClientRect().height');
  assert.ok(compactHeight <= 80, `Collapsed current activity must stay compact: ${compactHeight}`);
  await click('.activity-trail__current-main');
  await until(`Boolean(document.querySelector(${JSON.stringify(commandSelector)}))`);
  const collapsed = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(commandSelector)});
    return{open:el.open,height:el.getBoundingClientRect().height,body:Boolean(el.querySelector('.expandable-text__body'))};
  })()`);
  assert.equal(collapsed.open, false);
  assert.equal(collapsed.body, false);
  assert.ok(collapsed.height <= 60, JSON.stringify(collapsed));
  record('Current activity and each closed disclosure remain compact despite a multi-kilobyte command');

  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  const scrollPoint = await renderer.evaluate(`(()=>{
    const el=document.querySelector('.conversation-scroll'),r=el.getBoundingClientRect();
    return{x:r.left+Math.min(12,r.width/2),y:r.top+r.height/2,total:el.scrollHeight,height:el.clientHeight};
  })()`);
  assert.ok(scrollPoint.total - scrollPoint.height > 8, 'Real history must provide room for an upward reading gesture');
  await renderer.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: scrollPoint.x, y: scrollPoint.y, deltaX: 0, deltaY: scrollPoint.total,
  });
  await until(`(()=>{
    const el=document.querySelector('.conversation-scroll');
    return el.scrollHeight-el.clientHeight-el.scrollTop<=2;
  })()`);
  const followedTop = await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop');
  await renderer.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: scrollPoint.x, y: scrollPoint.y, deltaX: 0, deltaY: -480,
  });
  await until(`Boolean(document.querySelector('.chat-scroll-controls__latest'))&&(()=>{
    const el=document.querySelector('.conversation-scroll');
    return el.scrollTop<${followedTop}-8&&el.scrollHeight-el.clientHeight-el.scrollTop>8;
  })()`);
  await click('.chat-scroll-controls__latest');
  await until(`!document.querySelector('.chat-scroll-controls')&&(()=>{
    const el=document.querySelector('.conversation-scroll');
    return el.scrollHeight-el.clientHeight-el.scrollTop<=2;
  })()`);
  await nativeToggle(commandSelector, true);
  await until('Boolean(document.querySelector(".chat-scroll-controls"))');
  let commandText = await renderer.evaluate(`document.querySelector(${JSON.stringify(commandSelector)}).querySelector('pre').textContent`);
  assert.ok(commandText.includes(commandTail), 'Live activity must link the complete tool arguments by call id');
  assert.ok(commandText.includes(JSON.stringify({ command, timeout_ms: 120000 }, null, 2)));
  await nativeToggle(commandSelector, false);
  await nativeToggle(commandSelector, true);
  await assertCopy(commandSelector, commandText);
  const commandSummary = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(commandSelector)}).querySelector('summary');
    return{title:el.title,label:el.getAttribute('aria-label'),text:el.textContent};
  })()`);
  assert.match(commandSummary.title, /\u6536\u8d77|Collapse/i);
  assert.equal(commandSummary.label, null, 'Native summary text must retain the identity of the disclosed information');
  assert.ok(commandSummary.text.includes(commandTail), 'The full command preview must remain retained in the disclosure summary');
  await renderer.evaluate(`window.__commandDisclosure=document.querySelector(${JSON.stringify(commandSelector)});true`);
  record('Native Enter expands from bottom-following and immediately pauses follow; the summary text and copy retain complete original arguments');

  const commandScroll = await renderer.evaluate('document.querySelector(".conversation-scroll").scrollTop');
  await writeFile(resolve(project, 'command.release'), 'Release the owned command fixture.\n');
  await until(`document.querySelector(${JSON.stringify(commandSelector)})?.closest('.activity-row')?.classList.contains('activity-row--failed')`);
  await until(`document.querySelector(${JSON.stringify(commandSelector)})?.querySelector('pre')?.textContent.includes(${JSON.stringify(stderrTail)})`);
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(commandSelector)})===window.__commandDisclosure&&window.__commandDisclosure.open`), true);
  await assertScroll(commandScroll);
  const toolParts = (await messages()).flatMap(message => message.parts);
  const actualCall = toolParts.find(part => part.type === 'tool_call' && part.callId === 'disclosure-command');
  const actualResult = toolParts.find(part => part.type === 'tool_result' && part.callId === 'disclosure-command');
  assert.ok(actualCall);
  assert.ok(actualResult?.isError, 'The real command failure must remain an error result');
  assert.equal(JSON.parse(actualCall.arguments).command, command);
  assert.ok(actualResult.output.includes(stdout.trimEnd()), 'The complete multiline stdout and blank line must survive');
  assert.ok(actualResult.output.includes(stderr.trimEnd()), 'The complete multiline stderr must survive');
  commandText = await renderer.evaluate(`document.querySelector(${JSON.stringify(commandSelector)}).querySelector('pre').textContent`);
  assert.ok(commandText.includes(actualResult.output), 'Live disclosure must include the exact persisted tool result');
  await assertCopy(commandSelector, commandText);
  await assertScrollableTail(`${commandSelector} pre`, stderrTail);
  await assertBounds();
  await renderer.evaluate(`document.querySelector(${JSON.stringify(commandSelector)}).scrollIntoView({block:'center'});true`);
  await shot('live-command-failure-orbit-zh-night');
  record('Running-to-failed command updates preserve the same open disclosure, complete scrollable output and the reading position paused by expansion');

  commandFinal.release();
  await done();
  await until('Boolean(document.querySelector(".tool-call"))');
  await nativeToggle('.tool-call', true);
  const historical = await renderer.evaluate(`[...document.querySelectorAll('.tool-call__body pre')].map(el=>el.textContent)`);
  assert.deepEqual(historical, [command, JSON.stringify(JSON.parse(actualCall.arguments), null, 2), actualResult.output]);
  await assertCopy('.tool-call__body section:nth-child(1)', command);
  await assertCopy('.tool-call__body section:nth-child(2)', historical[1]);
  await assertCopy('.tool-call__body section:nth-child(3)', actualResult.output);
  await assertScrollableTail('.tool-call__body section:nth-child(3) pre', stderrTail);
  await nativeToggle('.tool-call', false);
  record('Persisted historical command, formatted arguments and error output stay independently readable and exactly copyable');

  if (await renderer.evaluate('document.documentElement.dataset.interfaceStyle==="orbit"')) {
    await click('.orbit-tool-rail button[data-orbit-action="review"]');
  } else {
    await click('.app-topbar button[aria-label="\u6253\u5f00\u5de5\u4f5c\u533a"]');
  }
  await until('document.querySelector(".inspector-host")?.hidden===false');
  await click('.workspace-tabs button[data-workspace-tab="review"]');
  await until('document.querySelector(".workspace-panel")?.dataset.workspaceTab==="review"');
  await until(`Boolean([...document.querySelectorAll('.review-checks > .expandable-text')].find(el=>el.querySelector('summary')?.textContent.includes(${JSON.stringify(commandTail)})))`);
  const reviewIndex = await renderer.evaluate(`[...document.querySelectorAll('.review-checks > .expandable-text')].findIndex(el=>el.querySelector('summary')?.textContent.includes(${JSON.stringify(commandTail)}))`);
  const reviewSelector = `.review-checks > .expandable-text:nth-of-type(${reviewIndex + 1})`;
  await nativeToggle(reviewSelector, true);
  await until(`document.querySelector(${JSON.stringify(reviewSelector)})?.querySelector('pre')?.textContent.includes(${JSON.stringify(stderrTail)})`);
  const reviewText = await renderer.evaluate(`document.querySelector(${JSON.stringify(reviewSelector)}).querySelector('pre').textContent`);
  assert.equal(reviewText, commandText, 'Review and live activity must expose the same complete saved execution detail');
  assert.ok(reviewText.includes(historical[1]) && reviewText.includes(actualResult.output));
  await assertCopy(reviewSelector, reviewText);
  await assertScrollableTail(`${reviewSelector} pre`, stderrTail);
  await assertBounds();
  await renderer.evaluate(`document.querySelector(${JSON.stringify(reviewSelector)}).scrollIntoView({block:'center'});true`);
  await shot('review-command-failure-orbit-zh-night');
  await nativeToggle(reviewSelector, false);
  await click('.workspace-panel__header > .icon-button');
  await until('document.querySelector(".inspector-host")?.hidden===true');
  record('Right Review execution and verification expands the exact full command, arguments and failed output, supports end scrolling and exact copy, and closes back to chat');

  await send('retry', 'Exercise one local HTTP retry while keeping its complete diagnostic available.');
  await until(`document.querySelector('.activity-trail__current-main')?.textContent.includes(${JSON.stringify(retryTail)})`);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".tool-call"))'), true, 'Earlier historical tool records must remain available while a later run is active');
  await nativeToggle('.tool-call', true);
  assert.deepEqual(await renderer.evaluate(`[...document.querySelectorAll('.tool-call__body pre')].map(el=>el.textContent)`), historical, 'A later retry must retain the complete earlier command, arguments and output');
  await assertCopy('.tool-call__body section:nth-child(3)', actualResult.output);
  await nativeToggle('.tool-call', false);
  record('The earlier complete historical tool record remains expandable and exactly copyable during a later live retry');
  if (await renderer.evaluate('document.querySelector(".activity-trail__current-main").getAttribute("aria-expanded")==="false"')) {
    await click('.activity-trail__current-main');
  }
  await until(`Boolean(document.querySelector(${JSON.stringify(retrySelector)}))`);
  const retrySummaryText = await renderer.evaluate(`document.querySelector(${JSON.stringify(retrySelector)}).querySelector('summary').textContent`);
  assert.ok(retrySummaryText.includes('LOCAL_HTTP_RETRY_START'), 'A retry summary must retain its distinct diagnostic preview');
  await nativeToggle(retrySelector, true);
  const retryText = await renderer.evaluate(`document.querySelector(${JSON.stringify(retrySelector)}).querySelector('pre').textContent`);
  assert.ok(retryText.includes(retryError), 'Retry diagnostics must retain original newlines and the tail beyond 1500 characters');
  await assertCopy(retrySelector, retryText);
  await renderer.evaluate(`window.__retryDisclosure=document.querySelector(${JSON.stringify(retrySelector)});true`);
  const retryScroll = await pauseInHistory();
  await click(`${retrySelector} > summary`);
  await until(`!document.querySelector(${JSON.stringify(retrySelector)}).open`);
  await assertScroll(retryScroll);
  await click(`${retrySelector} > summary`);
  await until(`document.querySelector(${JSON.stringify(retrySelector)}).open`);
  await assertScroll(retryScroll);
  retryProgress.release();
  await until(`document.querySelector(${JSON.stringify(retrySelector)})?.closest('.activity-row')?.classList.contains('activity-row--completed')`);
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(retrySelector)})===window.__retryDisclosure&&window.__retryDisclosure.open`), true);
  await assertScroll(retryScroll);
  assert.ok((await renderer.evaluate(`document.querySelector(${JSON.stringify(retrySelector)}).querySelector('pre').textContent`)).includes(retryTail));
  await renderer.evaluate(`document.querySelector(${JSON.stringify(retrySelector)}).scrollIntoView({block:'center'});true`);
  await assertBounds();
  await shot('live-retry-recovered-orbit-zh-night');
  retryFinal.release();
  await done();
  assert.equal(count, 2, 'One 503 failure must make exactly one retry');
  record('HTTP retry keeps its complete long diagnostic and the open native element through recovery without resetting history reading');

  await send('error', 'Preserve the final local HTTP failure as a complete readable error.');
  await done('error');
  assert.equal(count, 1, 'A permanent HTTP 403 must not retry');
  await until('Boolean(document.querySelector(".message-error.expandable-text"))');
  const errorSelector = '.message-error.expandable-text';
  const compactError = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(errorSelector)});
    return{open:el.open,height:el.getBoundingClientRect().height,body:Boolean(el.querySelector('pre'))};
  })()`);
  assert.equal(compactError.open, false);
  assert.equal(compactError.body, false);
  assert.ok(compactError.height <= 60, JSON.stringify(compactError));
  const errorSummary = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(errorSelector)}).querySelector('summary');
    return{title:el.title,label:el.getAttribute('aria-label'),text:el.textContent};
  })()`);
  assert.match(errorSummary.title, /\u5c55\u5f00|Expand/i);
  assert.equal(errorSummary.label, null, 'An error summary must use its diagnostic preview as the native accessible text');
  assert.ok(errorSummary.text.includes('LOCAL_HTTP_FAILURE_START'), 'Distinct failure diagnostics must remain distinguishable in their summary text');
  assert.notEqual(errorSummary.text, retrySummaryText, 'The final failure and retry must expose distinct diagnostic summaries');
  await nativeToggle(errorSelector, true);
  const errorText = await renderer.evaluate(`document.querySelector(${JSON.stringify(errorSelector)}).querySelector('pre').textContent`);
  assert.ok(errorText.includes(terminalError), 'The final error must preserve the complete original HTTP body');
  await assertCopy(errorSelector, errorText);
  await assertScrollableTail(`${errorSelector} pre`, errorTail);
  const persistedError = (await messages()).flatMap(message => message.parts).find(part => part.type === 'error');
  assert.equal(errorText, persistedError.message);
  await nativeToggle(errorSelector, false);
  record('A final permanent failure is compact when closed and expands or copies the exact persisted original error');

  const baseline = await messages();
  for (const style of ['simple', 'orbit']) {
    for (const locale of ['zh-CN', 'en']) {
      for (const theme of ['night', 'day']) {
        await renderer.evaluate(`(async()=>{
          await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:${JSON.stringify(style)}});
          await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});
          localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
          localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
        })()`);
        await renderer.send('Page.reload');
        await until(`document.documentElement?.dataset.interfaceStyle===${JSON.stringify(style)}&&Boolean(document.querySelector(${JSON.stringify(errorSelector)}))`);
        await installCopyCapture();
        for (const width of [800, 1440]) {
          await viewport(width, width === 800 ? 680 : 900);
          await nativeToggle('.tool-call', false);
          await nativeToggle(errorSelector, false);
          await renderer.evaluate('document.querySelector(".message-error").scrollIntoView({block:"center"});true');
          await assertBounds();
          await shot(`${style}-${locale}-${theme}-${width}-closed`);
          await nativeToggle('.tool-call', true);
          await nativeToggle(errorSelector, true);
          assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(errorSelector)}).querySelector('pre').textContent`), errorText);
          assert.ok(await renderer.evaluate(`document.querySelector('.tool-call__body').textContent.includes(${JSON.stringify(outputTail)})&&document.querySelector('.tool-call__body').textContent.includes(${JSON.stringify(commandTail)})`));
          await assertCopy(errorSelector, errorText);
          await renderer.evaluate('document.querySelector(".message-error").scrollIntoView({block:"center"});true');
          await assertBounds();
          await shot(`${style}-${locale}-${theme}-${width}-open`);
        }
        assert.deepEqual(await messages(), baseline, 'Appearance and disclosure toggles must not alter stored messages');
      }
    }
  }
  record('Simple/Orbit, both languages, day/night and 800/1440 widths preserve full data, bounded wrapping and compact/open presentation');
  assert.deepEqual(serverErrors, []);
  assert.deepEqual(exceptions, []);
  record('All local HTTP assertions pass and the real Electron renderer reports no uncaught exceptions');
  console.log(JSON.stringify({
    version, passed, captures, localRequests: requests.length,
    rendererExceptions: exceptions, serverErrors,
    boundaries: [
      'Real Electron, real owned PowerShell command, local Responses SSE and HTTP errors',
      'Copy is captured only in the isolated renderer; the system clipboard is not accessed',
      'No private profile, paid model, installer, cloud SQL or Git publishing',
      'Viewport checks do not constitute complete Windows DPI or assistive-technology certification',
    ],
  }, null, 2));
} catch (cause) {
  if (renderer) await shot('failure').catch(() => {});
  console.error(JSON.stringify({
    passed, exceptions, serverErrors, scenario, count,
    body: await renderer?.evaluate('document.body.innerText').catch(() => null),
  }, null, 2));
  throw cause;
} finally {
  commandFinal.release();
  retryProgress.release();
  retryFinal.release();
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
  if (!temporary.startsWith(root) || !temporary.slice(root.length).startsWith('mingshen-information-disclosure-')) {
    throw new Error('Unsafe fixture cleanup path');
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
