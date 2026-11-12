import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

// All runtime records below are produced by a local fixture in its own profile.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-orbit-rebuild-'));
const profile = resolve(temporary, 'profile');
const project = resolve(temporary, 'orbit-workbench');
const screenshots = resolve('.impeccable/review');
const passed = [], requests = [], exceptions = [], serverErrors = [], captures = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const sourceBefore = [
  'export interface WorkbenchLayout {',
  '  inspector: boolean;',
  '  tasks: boolean;',
  '}',
  '',
  'export function resolveLayout(): WorkbenchLayout {',
  '  return { inspector: true, tasks: false };',
  '}',
  '',
].join('\n');
const sourceAfter = sourceBefore.replace(
  '  return { inspector: true, tasks: false };',
  '  // Keep review and task progress visible together.\n  return { inspector: true, tasks: true };',
);
const notes = '# Workbench verification\n\nThe review pane and task progress remain visible together.\n';
const commandTail = 'ORBIT_COMMAND_COMPLETE_TAIL_29c7';
const diagnostic = ['ORBIT_COMMAND_START', ...Array.from({ length: 24 }, (_, index) =>
  `Local command evidence ${index + 1}: preserve all output while the workbench changes.`), '', commandTail].join('\n');
const primaryModel = {
  providerName: 'Orbit local fixture',
  displayName: '\u672c\u5730\u9a8c\u6536\u6a21\u578b',
  modelId: 'orbit-fixture',
};
const alternateModel = {
  providerName: 'Optics',
  displayName: primaryModel.displayName,
  modelId: 'orbit-alternate-fixture',
};
const longModel = {
  providerName: 'Orbit optical engineering provider with deliberately long international gateway',
  displayName: 'Orbit precision reasoning model with a deliberately long display name',
  modelId: 'orbit-label-long-fixture',
};
let child, main, renderer, fixture, releaseParent = false, parentHolding = false;

function finish(response, text, output) {
  if (response.destroyed) return;
  if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (text) response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`);
  response.end(`data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      status: 'completed',
      ...(output ? { output } : {}),
      usage: { input_tokens: 7600, output_tokens: 420, total_tokens: 8020 },
    },
  })}\n\n`);
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if ((body.instructions || '').includes('\u4f1a\u8bdd\u6807\u9898\u751f\u6210')) {
      finish(response, '\u5de5\u4f5c\u53f0\u5e03\u5c40\u4e0e\u6267\u884c\u8f68\u8ff9\u68c0\u67e5');
      return;
    }
    const input = body.input || [];
    const userText = input.filter(item => item.role === 'user').map(item => JSON.stringify(item.content)).join('\n');
    const worker = /\u5b50\u4efb\u52a1\uff1aORBIT_READONLY_WORKER/.test(userText);
    requests.push({ worker, body });
    const calls = input.filter(item => item.type === 'function_call');
    const has = name => calls.some(item => item.name === name);
    const count = name => calls.filter(item => item.name === name).length;
    const tool = (name, args, suffix = '') => ({
      type: 'function_call',
      call_id: `orbit-${worker ? 'child' : 'parent'}-${requests.length}-${name}${suffix}`,
      name,
      arguments: JSON.stringify(args),
    });
    const todos = done => [
      { id: 'inspect', content: '\u6838\u5bf9\u5e03\u5c40\u4e0e\u6587\u4ef6\u6765\u6e90', status: 'completed', priority: 'high' },
      { id: 'rebuild', content: '\u8fde\u63a5\u5ba1\u67e5\u4e0e\u4efb\u52a1\u53cc\u9762\u677f', status: 'completed', priority: 'high', dependsOn: ['inspect'] },
      { id: 'verify', content: '\u8fd0\u884c\u56de\u5f52\u68c0\u67e5', status: done ? 'completed' : 'in_progress', priority: 'medium', dependsOn: ['rebuild'] },
    ];
    if (worker) {
      if (!has('read_file')) {
        finish(response, '', [tool('read_file', { path: 'src/workbench-layout.ts' })]);
      } else {
        finish(response, '\u53ea\u8bfb\u5ba1\u67e5\u5df2\u5b8c\u6210\uff1a\u5ba1\u67e5\u4e0e\u4efb\u52a1\u53ef\u4ee5\u540c\u65f6\u663e\u793a\uff0c\u6587\u4ef6\u53d8\u66f4\u4fdd\u7559\u6765\u6e90\u3002 ORBIT_WORKER_VERIFIED');
      }
      return;
    }
    if (!has('update_todos')) {
      finish(response, '\u6211\u4f1a\u5148\u6838\u5bf9\u5e03\u5c40\u4e0e\u6587\u4ef6\uff0c\u518d\u8fde\u63a5\u5ba1\u67e5\u4e0e\u4efb\u52a1\u9762\u677f\uff0c\u6700\u540e\u8fd0\u884c\u56de\u5f52\u68c0\u67e5\u3002', [
        tool('update_todos', { todos: [
          { id: 'inspect', content: '\u6838\u5bf9\u5e03\u5c40\u4e0e\u6587\u4ef6\u6765\u6e90', status: 'in_progress', priority: 'high' },
          { id: 'rebuild', content: '\u8fde\u63a5\u5ba1\u67e5\u4e0e\u4efb\u52a1\u53cc\u9762\u677f', status: 'pending', priority: 'high', dependsOn: ['inspect'] },
          { id: 'verify', content: '\u8fd0\u884c\u56de\u5f52\u68c0\u67e5', status: 'pending', priority: 'medium', dependsOn: ['rebuild'] },
        ] }),
      ]);
    } else if (!has('read_file')) {
      finish(response, '', [tool('read_file', { path: 'src/workbench-layout.ts' })]);
    } else if (count('update_todos') === 1) {
      finish(response, '', [tool('update_todos', { todos: [
        { id: 'inspect', content: '\u6838\u5bf9\u5e03\u5c40\u4e0e\u6587\u4ef6\u6765\u6e90', status: 'completed', priority: 'high' },
        { id: 'rebuild', content: '\u8fde\u63a5\u5ba1\u67e5\u4e0e\u4efb\u52a1\u53cc\u9762\u677f', status: 'in_progress', priority: 'high', dependsOn: ['inspect'] },
        { id: 'verify', content: '\u8fd0\u884c\u56de\u5f52\u68c0\u67e5', status: 'pending', priority: 'medium', dependsOn: ['rebuild'] },
      ] })]);
    } else if (!has('replace_in_file')) {
      finish(response, '\u5ba1\u67e5\u4e0e\u4efb\u52a1\u8fdb\u5ea6\u5e94\u540c\u65f6\u4fdd\u7559\uff0c\u6211\u4f1a\u4fee\u6b63\u5e03\u5c40\u8fd4\u56de\u503c\u5e76\u4fdd\u5b58\u8bf4\u660e\u3002', [
        tool('replace_in_file', {
          path: 'src/workbench-layout.ts',
          old_text: '  return { inspector: true, tasks: false };',
          new_text: '  // Keep review and task progress visible together.\n  return { inspector: true, tasks: true };',
        }),
      ]);
    } else if (!has('write_file')) {
      finish(response, '', [tool('write_file', { path: 'review-notes.md', content: notes })]);
    } else if (count('update_todos') === 2) {
      finish(response, '', [tool('update_todos', { todos: todos(false) })]);
    } else if (!has('run_command')) {
      const quote = value => `'${value.replaceAll("'", "''")}'`;
      finish(response, '', [tool('run_command', {
        command: `& ${quote(process.execPath)} './verify-workbench.cjs'`,
        timeout_ms: 30000,
      })]);
    } else if (!has('spawn_subagent')) {
      finish(response, '', [tool('spawn_subagent', {
        agent: 'review-subagent',
        label: '\u5e03\u5c40\u53ea\u8bfb\u5ba1\u67e5',
        task: 'ORBIT_READONLY_WORKER: inspect the saved workbench layout and report verified evidence.',
        context: 'Read-only verification of only src/workbench-layout.ts.',
      })]);
    } else if (!has('wait_subagents')) {
      finish(response, '', [tool('wait_subagents', {})]);
    } else if (count('update_todos') === 3) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({
        type: 'response.output_text.delta',
        delta: '\u6587\u4ef6\u5df2\u66f4\u65b0\uff0c\u672c\u5730\u547d\u4ee4\u4e0e\u53ea\u8bfb\u5ba1\u67e5\u5747\u5df2\u8fd4\u56de\u3002\u6b63\u5728\u6838\u5bf9\u5de5\u4f5c\u53f0\u7684\u5c55\u5f00\u3001\u5bfc\u822a\u548c\u5e03\u5c40\u5207\u6362\u3002',
      })}\n\n`);
      parentHolding = true;
      while (!releaseParent && !response.destroyed) {
        response.write(': owned workbench verification\n\n');
        await sleep(150);
      }
      finish(response, '', [tool('update_todos', { todos: todos(true) })]);
    } else {
      finish(response, '\u5e03\u5c40\u4e0e\u6267\u884c\u8f68\u8ff9\u68c0\u67e5\u5b8c\u6210\uff1a\u4e24\u4e2a\u6587\u4ef6\u7684\u53d8\u66f4\u4e0e\u5b8c\u6574\u547d\u4ee4\u8f93\u51fa\u5747\u5df2\u4fdd\u7559\uff0c\u8ba1\u5212\u5df2\u5b8c\u6210\u3002 ORBIT_PARENT_VERIFIED');
    }
  } catch (cause) {
    serverErrors.push(cause.stack || String(cause));
    if (!response.destroyed) {
      if (!response.headersSent) response.writeHead(500);
      response.end('Owned Orbit fixture failed.');
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
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      if (await renderer.evaluate(expression)) return;
    } catch (cause) {
      if (!/context|navigat|reload|destroyed/i.test(String(cause))) throw cause;
      lastError = cause;
    }
    await sleep(70);
  }
  throw new Error(`Timed out: ${expression}${lastError ? ` (${lastError})` : ''}`);
}

async function click(selector, text) {
  const target = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&el.getBoundingClientRect().width>0${text === undefined ? '' : `&&el.textContent.trim()===${JSON.stringify(text)}`})`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}

async function fill(selector, text) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select();return true})()`);
  if (text) await renderer.send('Input.insertText', { text });
  else {
    await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  }
}

async function viewport(width, height, scale = 1) {
  await renderer.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: false,
  });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  await sleep(180);
}

async function shot(name) {
  await renderer.send('Page.bringToFront');
  await until('document.visibilityState==="visible"');
  await until('[...document.querySelectorAll(".settings-workspace")].every(el=>el.getAnimations().every(a=>a.playState!=="running"))');
  await sleep(180);
  const image = await renderer.send('Page.captureScreenshot', { format: 'png' });
  const path = resolve(screenshots, `orbit-rebuild-${name}.png`);
  await writeFile(path, Buffer.from(image.data, 'base64'));
  captures.push(path);
}

async function mode(value) {
  await click(`.orbit-workspace-header button[data-layout="${value}"], .app-topbar button[data-layout="${value}"]`);
  await until(`document.querySelector('.app-shell')?.dataset.layout===${JSON.stringify(value)}`);
}

async function rail(value) {
  await click(`.orbit-tool-rail button[data-orbit-action="${value}"]`);
}

async function selectSession(sessionId) {
  if (await renderer.evaluate('document.querySelector(".sidebar-host")?.hidden')) {
    await click('.orbit-workspace-header > button:first-child, .app-topbar button.sidebar-toggle');
  }
  await until('document.querySelector(".sidebar-host")?.getBoundingClientRect().width>0');
  await renderer.evaluate(`(()=>{
    for(const header of document.querySelectorAll('.session-group__header[aria-expanded=false]'))header.click();
    return true;
  })()`);
  await until('!document.querySelector(".session-group__header[aria-expanded=false]")');
  await renderer.evaluate(`(()=>{
    for(const button of document.querySelectorAll('.session-group__show-all[aria-expanded=false]'))button.click();
    return true;
  })()`);
  await click(`[data-session-id="${sessionId}"] .session-row`);
  await until(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(sessionId)}`);
}

async function frameEvidence() {
  await rail('review');
  await click('[data-task-tab="plan"]');
  await until('Boolean(document.querySelector(".orbit-review-file[data-review-file]"))');
  await renderer.evaluate(`(()=>{
    const file=[...document.querySelectorAll('.orbit-review-file[data-review-file]')]
      .find(el=>el.dataset.reviewFile.includes('workbench-layout.ts'));
    if(!file)throw new Error('Missing saved TypeScript diff');
    if(file.getAttribute('aria-pressed')!=='true')file.click();
    return true;
  })()`);
  await until('document.querySelector(".orbit-review-preview")?.textContent.includes("tasks: true")');
  await renderer.evaluate(`(()=>{
    const scroll=document.querySelector('.conversation-scroll');
    if(!scroll)throw new Error('Missing conversation scroll container');
    for(const detail of scroll.querySelectorAll('.tool-call[open], .activity-disclosure[open]'))detail.open=false;
    const rendered=el=>el.getBoundingClientRect().height>0;
    const headings=[...scroll.querySelectorAll('.orbit-execution-records > summary, .activity-trail__current-main')].filter(rendered);
    for(const heading of headings){
      const group=heading.closest('details');
      if(group&&!group.open)heading.click();
    }
    const metadata=[...scroll.querySelectorAll('.message--assistant .orbit-message-meta, .orbit-transcript-group > .orbit-message-meta')].filter(rendered);
    const span=(meta,heading)=>{
      const a=meta.getBoundingClientRect(),b=heading.getBoundingClientRect();
      return {metadata:meta,heading,top:Math.min(a.top,b.top),bottom:Math.max(a.bottom,b.bottom)};
    };
    const pairs=headings.map(heading=>{
      const adjacent=heading.closest('.orbit-transcript-group')?.querySelector(':scope > .orbit-message-meta');
      return (adjacent&&rendered(adjacent)?[span(adjacent,heading)]:metadata.map(meta=>span(meta,heading)))
        .sort((a,b)=>(a.bottom-a.top)-(b.bottom-b.top))[0];
    }).filter(Boolean).sort((a,b)=>(a.bottom-a.top)-(b.bottom-b.top));
    const pair=pairs[0];
    if(!pair)throw new Error('Missing real assistant metadata or execution heading');
    const bounds=scroll.getBoundingClientRect();
    if(pair.bottom-pair.top>scroll.clientHeight-48)throw new Error('Adjacent assistant metadata and execution heading do not fit the conversation viewport');
    scroll.dispatchEvent(new WheelEvent('wheel',{deltaY:-180,bubbles:true}));
    scroll.scrollTop+=pair.top-bounds.top-24;
    scroll.dispatchEvent(new Event('scroll',{bubbles:true}));
    const review=document.querySelector('.review-panel');
    if(review)review.scrollTop=0;
    const tasks=document.querySelector('.task-workbench__body');
    if(tasks)tasks.scrollTop=0;
    return true;
  })()`);
  await sleep(160);
  const visible = await renderer.evaluate(`(()=>{
    const scroll=document.querySelector('.conversation-scroll').getBoundingClientRect();
    const visibleWithin=(selector,within)=>{
      const el=[...document.querySelectorAll(selector)].find(node=>{
        const rect=node.getBoundingClientRect();
        return rect.width>0&&rect.height>0&&rect.top>=within.top-1&&rect.bottom<=within.bottom+1;
      });
      return Boolean(el);
    };
    return {metadata:visibleWithin('.message--assistant .orbit-message-meta, .orbit-transcript-group > .orbit-message-meta',scroll),
      execution:visibleWithin('.orbit-execution-records > summary, .activity-trail__current-main',scroll),
      time:[...document.querySelectorAll('.orbit-message-meta time')].some(el=>el.dateTime&&!Number.isNaN(Date.parse(el.dateTime))),
      diff:document.querySelector('.orbit-review-preview')?.textContent.includes('tasks: true'),
      steps:document.querySelectorAll('.plan-step').length};
  })()`);
  assert.deepEqual(visible, { metadata: true, execution: true, time: true, diff: true, steps: 3 },
    `Reference screenshot must show real message metadata, execution heading, saved diff and plan: ${JSON.stringify(visible)}`);
}

async function geometry({ dual = true } = {}) {
  const layout = await renderer.evaluate(`(()=>{
    const box=selector=>{
      const el=document.querySelector(selector),r=el?.getBoundingClientRect();
      return r&&r.width>0&&r.height>0?{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;
    };
    return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,
      rail:box('.orbit-tool-rail'),sidebar:box('.sidebar-host'),header:box('.orbit-workspace-header'),
      chat:box('.chat-view'),inspector:box('.inspector-host'),task:box('.task-host'),
      status:box('.orbit-status-bar'),composer:box('.composer'),drawer:document.querySelector('.app-body')?.dataset.inspectorDrawer,
      sidebarDrawer:document.querySelector('.app-body')?.dataset.sidebarDrawer};
  })()`);
  assert.equal(layout.overflow, false, JSON.stringify(layout));
  for (const key of ['rail', 'header', 'chat', 'status', 'composer']) {
    const rect = layout[key];
    assert.ok(rect && rect.x >= -1 && rect.right <= layout.width + 1 && rect.bottom <= layout.height + 1,
      `${key} outside workbench: ${JSON.stringify(layout)}`);
  }
  assert.ok(layout.rail.width <= 82 && layout.rail.height > layout.chat.height, JSON.stringify(layout));
  assert.ok(layout.header.bottom <= layout.chat.y + 2, JSON.stringify(layout));
  assert.ok(layout.status.y >= layout.chat.bottom - 2, JSON.stringify(layout));
  assert.ok(layout.chat.x >= layout.rail.right, JSON.stringify(layout));
  if (layout.sidebar && layout.sidebarDrawer !== 'true') {
    assert.ok(layout.sidebar.x >= layout.rail.right && layout.chat.x >= layout.sidebar.right, JSON.stringify(layout));
  }
  if (dual && layout.drawer !== 'true') {
    const upper = layout.inspector, lower = layout.task;
    assert.ok(upper && lower && upper.height >= 120 && lower.height >= 120, JSON.stringify(layout));
    assert.ok(Math.abs(upper.x - lower.x) <= 2 && Math.abs(upper.right - lower.right) <= 2, JSON.stringify(layout));
    assert.ok(lower.y >= upper.bottom - 2, JSON.stringify(layout));
    assert.ok(upper.x >= layout.chat.right - 2, JSON.stringify(layout));
    assert.ok(lower.bottom <= layout.status.y + 2, JSON.stringify(layout));
  }
  return layout;
}

async function modelLabel(model, locale, { fullyVisible = false } = {}) {
  const expected = model
    ? `${model.displayName}${locale === 'zh-CN' ? `\uff08${model.providerName}\uff09` : ` (${model.providerName})`}`
    : locale === 'zh-CN' ? '\u9009\u62e9\u6a21\u578b' : 'Select model';
  const selector = '.chat-model-picker .model-picker__trigger';
  await until(`document.querySelector(${JSON.stringify(selector)})?.querySelector('strong')?.textContent===${JSON.stringify(expected)}`);
  const state = await renderer.evaluate(`(()=>{
    const trigger=document.querySelector(${JSON.stringify(selector)});
    const label=trigger.querySelector('strong');
    const provider=trigger.querySelector('.model-picker__inline-provider');
    const composer=trigger.closest('.composer').getBoundingClientRect();
    const bounds=trigger.getBoundingClientRect();
    const copy=label.getBoundingClientRect();
    const icon=trigger.querySelector('svg:last-child').getBoundingClientRect();
    const textParts=[...label.children].map(el=>({
      width:el.getBoundingClientRect().width,client:el.clientWidth,scroll:el.scrollWidth
    }));
    return {title:trigger.title,label:label.textContent,provider:provider?.textContent??null,
      viewport:{width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1},
      composer:{left:composer.left,right:composer.right,top:composer.top,bottom:composer.bottom},
      bounds:{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom},
      copy:{left:copy.left,right:copy.right,width:copy.width,client:label.clientWidth,scroll:label.scrollWidth},
      icon:{left:icon.left,right:icon.right,width:icon.width},textParts};
  })()`);
  assert.equal(state.label, expected);
  assert.equal(state.provider, model
    ? locale === 'zh-CN' ? `\uff08${model.providerName}\uff09` : ` (${model.providerName})`
    : null, 'The main selector must carry one provider suffix, without empty parentheses');
  if (model) {
    assert.equal(state.title, `${model.providerName} / ${model.displayName} (${model.modelId})`,
      'The tooltip must retain the full provider, display name and configured model identifier');
  } else {
    assert.equal(state.title, expected);
  }
  assert.equal(state.viewport.overflow, false, JSON.stringify(state));
  assert.ok(state.bounds.left >= state.composer.left - 1 &&
    state.bounds.right <= state.composer.right + 1 &&
    state.bounds.top >= state.composer.top - 1 &&
    state.bounds.bottom <= state.composer.bottom + 1 &&
    state.bounds.right <= state.viewport.width + 1, `Model selector outside composer: ${JSON.stringify(state)}`);
  assert.ok(state.copy.width > 12 && state.icon.width > 10 &&
    state.copy.right <= state.icon.left + 1 && state.icon.right <= state.bounds.right + 1,
  `Model text must leave the menu chevron reachable: ${JSON.stringify(state)}`);
  if (model) {
    assert.ok(state.textParts.length === 2 && state.textParts.every(part => part.width > 12),
      `Both model and provider must retain visible space: ${JSON.stringify(state)}`);
  }
  if (fullyVisible) {
    assert.ok(state.copy.scroll <= state.copy.client + 1 &&
      state.textParts.every(part => part.scroll <= part.client + 1),
    `An ordinary model/provider pair should fit without truncation: ${JSON.stringify(state)}`);
  }
  const { root } = await renderer.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await renderer.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { nodes } = await renderer.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  const accessibleName = nodes.find(node => node.role?.value === 'button')?.name?.value;
  assert.equal(accessibleName?.replace(/\s+/g, ''), expected.replace(/\s+/g, ''),
    'The accessibility tree must expose the complete selected model and provider even when the visual text is shortened');
}

async function selectModel(model) {
  await click('.chat-model-picker .model-picker__trigger');
  await until('Boolean(document.querySelector(".model-picker__panel"))');
  await renderer.evaluate(`(()=>{
    const provider=[...document.querySelectorAll('.model-picker__provider')]
      .find(el=>el.querySelector('.model-picker__provider-copy strong')?.textContent===${JSON.stringify(model.providerName)});
    if(!provider)throw new Error('Missing provider group in the real model menu');
    const toggle=provider.querySelector('.model-picker__provider-toggle');
    if(toggle.getAttribute('aria-expanded')!=='true')toggle.click();
    return true;
  })()`);
  const target = `(()=>{
    const provider=[...document.querySelectorAll('.model-picker__provider')]
      .find(el=>el.querySelector('.model-picker__provider-copy strong')?.textContent===${JSON.stringify(model.providerName)});
    return [...provider.querySelectorAll('.model-picker__model')]
      .find(el=>el.querySelector('code')?.textContent===${JSON.stringify(model.modelId)});
  })()`;
  await until(`Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
  await until('!document.querySelector(".model-picker__panel")');
}

async function preferences(patch) {
  await renderer.evaluate(`(async()=>window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),...${JSON.stringify(patch)}}))()`);
}

async function localeTheme(locale, theme, style = 'orbit') {
  await renderer.evaluate(`window.mingshen.desktopAction('locale',${JSON.stringify(locale)}).then(()=>{
    localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});
    localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});
  })`);
  await renderer.send('Page.reload');
  await until(`Boolean(document.querySelector(".composer textarea"))&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}`);
  await selectSession(fixture.sessionId);
}

async function snapshot() {
  return renderer.evaluate(`(async()=>{
    const s=await window.mingshen.getSession(${JSON.stringify(fixture.sessionId)});
    return {session:Object.fromEntries(['id','workspacePath','providerId','modelId','permissionMode','agentProfileId'].map(k=>[k,s[k]])),
      messages:await window.mingshen.getSessionMessages(s.id),
      plan:(await window.mingshen.getWorkbench(s.id)).plan};
  })()`);
}

async function launch() {
  const mainPort = await availablePort();
  let rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const env = {
    ...process.env,
    MSH_EXPERIMENTAL: '1',
    MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1',
    MSH_NOTIFICATION_FIXTURE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve('apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe'), [
    `--inspect=${mainPort}`, '.', `--remote-debugging-port=${rendererPort}`,
  ], { cwd: resolve('apps/desktop'), env, windowsHide: true, stdio: 'ignore' });
  main = await connect(mainPort, 'main');
  await main.evaluate(`globalThis.__orbitFixtureFetch=fetch;
    globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')
      ?Promise.resolve(Response.json([])):globalThis.__orbitFixtureFetch(url,options);true`);
  renderer = await connect(rendererPort, 'renderer');
  await renderer.send('Runtime.enable');
}

function record(value) {
  passed.push(value);
  console.log(`PASS ${passed.length}: ${value}`);
}

try {
  await mkdir(resolve(project, 'src'), { recursive: true });
  await mkdir(screenshots, { recursive: true });
  await writeFile(resolve(project, 'src/workbench-layout.ts'), sourceBefore);
  await writeFile(resolve(project, 'verify-workbench.cjs'), [
    "const assert = require('node:assert/strict');",
    "const fs = require('node:fs');",
    "assert.match(fs.readFileSync('src/workbench-layout.ts','utf8'), /tasks: true/);",
    "assert.match(fs.readFileSync('review-notes.md','utf8'), /visible together/);",
    `console.log(${JSON.stringify(diagnostic)});`,
    '',
  ].join('\n'));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
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
    const provider=await window.mingshen.createProvider({name:'Orbit local fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-orbit-fixture-only',keyLabel:'Fixture',neverReveal:true});
    const updated=await window.mingshen.createModel({providerId:provider.id,modelId:'orbit-fixture',displayName:'\u672c\u5730\u9a8c\u6536\u6a21\u578b',contextWindow:200000,maxOutputTokens:8192,inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['none','low','high'],anthropicNoneBehavior:'disabled'});
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    const session=await window.mingshen.createSession({title:'\u5de5\u4f5c\u53f0\u5e03\u5c40\u4e0e\u6267\u884c\u8f68\u8ff9\u68c0\u67e5',workspacePath:${JSON.stringify(project)},providerId:provider.id,modelId:updated.models[0].id,permissionMode:'full_access',reasoningLevel:'high'});
    await window.mingshen.setProjectMemoryEnabled(session.id,false);
    const key='@orbit:'+session.workspacePath.replaceAll('/','\\\\').replace(/\\\\+$/,'').toLowerCase();
    await window.mingshen.saveUiPreferences({...await window.mingshen.getUiPreferences(),interfaceStyle:'orbit',defaultLayout:'chat',
      projects:{[key]:{mode:'chat',sidebarWidth:236,inspectorWidth:400,sidebarOpen:true,inspectorOpen:true}}});
    return {sessionId:session.id,providerId:provider.id};
  })()`);
  await renderer.send('Page.reload');
  await until('document.documentElement.dataset.interfaceStyle==="orbit"&&Boolean(document.querySelector(".orbit-tool-rail"))&&Boolean(document.querySelector(".composer textarea"))');
  await viewport(1440, 900);
  await geometry();
  await modelLabel(primaryModel, 'zh-CN');
  await shot('empty-zh-night-1440');
  record('Orbit has its own rail, sidebar, breadcrumb header, conversation, simultaneous review/tasks and bottom status strip');

  await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.sessionId)},text:'\u6838\u5bf9\u5de5\u4f5c\u53f0\u5e03\u5c40\uff0c\u4fdd\u6301\u5ba1\u67e5\u4e0e\u4efb\u52a1\u8fdb\u5ea6\u540c\u65f6\u53ef\u89c1\uff0c\u8fd0\u884c\u672c\u5730\u56de\u5f52\u5e76\u6d3e\u53d1\u53ea\u8bfb\u5ba1\u67e5\u3002'})`);
  const end = Date.now() + 90000;
  while (!parentHolding && Date.now() < end) {
    assert.deepEqual(serverErrors, []);
    await sleep(150);
  }
  assert.equal(parentHolding, true, 'The real local tool sequence must reach its held running response');
  await until('document.querySelectorAll(".plan-step").length===3');
  await until(`window.mingshen.listSessionPage({parentId:${JSON.stringify(fixture.sessionId)}}).then(page=>page.total===1&&page.sessions[0].status==='idle')`);
  await rail('review');
  await until('Boolean(document.querySelector(".orbit-review-file[data-review-file]"))');
  await renderer.evaluate(`(()=>{const row=[...document.querySelectorAll('.orbit-review-file[data-review-file]')].find(el=>el.dataset.reviewFile.includes('workbench-layout.ts'));if(!row)throw new Error('Missing saved TS diff');if(row.getAttribute('aria-pressed')!=='true')row.click();return true})()`);
  await until('document.querySelector(".orbit-review-preview")?.textContent.includes("tasks: true")');
  const changes = await renderer.evaluate(`window.mingshen.getWorkbench(${JSON.stringify(fixture.sessionId)})`);
  assert.equal(changes.plan.steps.filter(step => step.status === 'completed').length, 2);
  assert.equal(await readFile(resolve(project, 'src/workbench-layout.ts'), 'utf8'), sourceAfter);
  assert.equal(await readFile(resolve(project, 'review-notes.md'), 'utf8'), notes);
  const sourceParts = (await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(fixture.sessionId)})`))
    .flatMap(message => message.parts);
  const sourceCommand = sourceParts.find(part => part.type === 'tool_call' && part.name === 'run_command');
  assert.ok(sourceCommand);
  assert.ok(sourceParts.some(part => part.type === 'tool_result' && part.callId === sourceCommand.callId &&
    !part.isError && part.output.includes(commandTail)), 'The real successful command must retain its complete output');
  await until('document.querySelector(".chat-view")?.dataset.runState==="running"&&document.querySelector(".app-topbar")?.dataset.runState==="running"');
  assert.equal(await renderer.evaluate('document.querySelector(".chat-model-picker .model-picker__trigger").disabled'), true);
  await modelLabel(primaryModel, 'zh-CN');
  await geometry();
  await shot('running-zh-night-1440');
  await viewport(1920, 1080);
  await geometry();
  await shot('running-zh-night-1920');
  await viewport(2559, 1440);
  await geometry();
  await shot('running-zh-night-2559');
  record('A real local run creates two file changes, complete command output, three plan steps and one completed read-only worker');

  await viewport(1440, 900);
  const commandSummary = '.activity-file-group[data-activity-id*="-run_command"] .activity-disclosure';
  await until(`Boolean(document.querySelector(${JSON.stringify(commandSummary)}))`);
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(commandSummary)});if(!el.open)el.querySelector('summary').click();return true})()`);
  await until(`document.querySelector('.conversation')?.textContent.includes(${JSON.stringify(commandTail)})`);
  await shot('command-expanded-zh-night');
  record('The rebuilt execution timeline still expands the actual complete command details and output tail');

  await fill('.composer textarea', '\u4e2d\u6587\u8349\u7a3f Orbit structure verification');
  await renderer.evaluate('window.__orbitComposer=document.querySelector(".composer textarea");true');
  for (const layout of ['code', 'agents', 'chat']) {
    await mode(layout);
    await geometry();
    assert.equal(await renderer.evaluate('document.querySelector(".composer textarea")===window.__orbitComposer&&window.__orbitComposer.value==="\\u4e2d\\u6587\\u8349\\u7a3f Orbit structure verification"'), true);
  }
  await rail('files');
  await until('document.querySelector(".workspace-panel")?.dataset.workspaceTab==="files"');
  await click('.tree-row[title="src"]');
  await click('.tree-row[title="src/workbench-layout.ts"], .tree-row[title="src\\\\workbench-layout.ts"]');
  await until('Boolean(document.querySelector(".editor-textarea"))');
  const savedEditor = await renderer.evaluate('document.querySelector(".editor-textarea").value');
  await renderer.evaluate('window.__orbitEditor=document.querySelector(".editor-textarea");window.__orbitEditor.focus();window.__orbitEditor.setSelectionRange(0,0);true');
  await renderer.send('Input.insertText', { text: '// Unsaved owned interface draft.\n' });
  for (const layout of ['agents', 'chat', 'code']) {
    await mode(layout);
    assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea")===window.__orbitEditor&&window.__orbitEditor.value.startsWith("// Unsaved owned interface draft.")'), true);
  }
  await rail('terminal');
  await until('document.querySelector(".workspace-panel")?.dataset.workspaceTab==="terminal"');
  await until('Boolean(document.querySelector(".terminal-input-row"))');
  await rail('agents');
  await until('document.querySelector(".task-workbench")?.dataset.taskView==="agents"');
  await rail('chat');
  await until('document.activeElement===document.querySelector(".composer textarea")');
  await rail('files');
  assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea")?.value.startsWith("// Unsaved owned interface draft.")'), true);
  assert.equal(await renderer.evaluate('document.querySelector(".composer textarea")===window.__orbitComposer&&window.__orbitComposer.value==="\\u4e2d\\u6587\\u8349\\u7a3f Orbit structure verification"'), true);
  await fill('.editor-textarea', savedEditor);
  await fill('.composer textarea', '');
  await rail('review');
  await mode('chat');
  await click('[data-task-tab="plan"]');
  record('Layout changes preserve identical composer/editor nodes; rail file/terminal/agent/chat navigation operates real panes and retains both drafts');

  releaseParent = true;
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(session=>session.status==='idle')`);
  await until('document.querySelector(".conversation")?.textContent.includes("ORBIT_PARENT_VERIFIED")');
  await until('document.querySelector(".chat-view")?.dataset.runState==="idle"&&document.querySelector(".app-topbar")?.dataset.runState==="idle"');
  assert.equal(await renderer.evaluate('document.querySelector(".chat-model-picker .model-picker__trigger").disabled'), false);
  const baseline = await snapshot();
  assert.equal(baseline.plan.steps.every(step => step.status === 'completed'), true);
  await rail('review');
  await shot('complete-zh-night-1440');
  await viewport(2559, 1440);
  await geometry();
  await frameEvidence();
  await shot('evidence-zh-night-2559');
  await viewport(1440, 900);
  await geometry();
  await frameEvidence();
  await shot('evidence-zh-night-1440');
  record('Reference-size 2559x1440 and 1440 screenshots expose real message author/time, execution heading, saved diff and task progress together');

  await selectSession(fixture.sessionId);
  const requestsBeforeNavigation = requests.length;
  await click(`.session-group:has([data-session-id="${fixture.sessionId}"]) > .session-group__heading > .session-group__add`);
  await until(`(()=>{
    const id=document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId;
    return Boolean(id)&&id!==${JSON.stringify(fixture.sessionId)};
  })()`);
  const secondary = await renderer.evaluate(`window.mingshen.getSession(
    document.querySelector('.session-row--selected').closest('[data-session-id]').dataset.sessionId)`);
  assert.notEqual(secondary.id, fixture.sessionId);
  assert.equal(secondary.parentSessionId, null, 'The sidebar must create a new main session in the same project');
  assert.equal(secondary.workspacePath, project);
  assert.equal(secondary.providerId, baseline.session.providerId);
  assert.equal(secondary.modelId, baseline.session.modelId);
  await selectSession(fixture.sessionId);
  await rail('agents');
  await until('document.querySelector(".task-workbench")?.dataset.taskView==="agents"');
  await selectSession(secondary.id);
  await until('document.querySelector(".task-workbench")?.dataset.taskView==="plan"');
  await sleep(200);
  assert.equal(await renderer.evaluate('document.querySelector(".task-workbench")?.dataset.taskView'), 'plan',
    'A prior session rail request must not select the agent tab in the new session');
  assert.equal((await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(secondary.id)})`)).length, 0,
    'The cross-session navigation check must not manufacture messages or call the model');
  assert.equal(requests.length, requestsBeforeNavigation, 'Session-scoped rail navigation must not make another model request');
  await selectSession(fixture.sessionId);
  await click('[data-task-tab="plan"]');
  assert.deepEqual(await snapshot(), baseline);
  record('An Agent rail request belongs to its original session and does not replay into another session default plan view');

  for (const [locale, theme] of [['zh-CN', 'day'], ['en', 'night'], ['en', 'day']]) {
    await localeTheme(locale, theme);
    await viewport(1440, 900);
    await rail('review');
    await geometry();
    await modelLabel(primaryModel, locale);
    assert.deepEqual(await snapshot(), baseline);
    await shot(`complete-${locale}-${theme}-1440`);
  }
  record('Chinese/English and day/night show the rebuilt composition with identical saved messages, plan and model/permission settings');

  for (const [width, height] of [[800, 600], [1040, 680], [1920, 1080], [2559, 1440]]) {
    await viewport(width, height);
    await rail('chat');
    await geometry({ dual: width >= 1440 });
    await modelLabel(primaryModel, 'en');
    await shot(`bounds-${width}x${height}`);
    await rail('terminal');
    await until('Boolean(document.querySelector(".terminal-input-row"))');
    const bounds = await renderer.evaluate(`(()=>{const p=document.querySelector('.workspace-panel').getBoundingClientRect();return{x:p.x,right:p.right,bottom:p.bottom,w:innerWidth,h:innerHeight}})()`);
    assert.ok(bounds.x >= -1 && bounds.right <= bounds.w + 1 && bounds.bottom <= bounds.h + 1, JSON.stringify(bounds));
    await shot(`terminal-${width}x${height}`);
  }
  await viewport(1440, 900);
  await rail('review');
  await geometry();
  record('Compact 800/1040 drawers and 1920/2559 desktops keep real command navigation, conversation and composer within the window');

  await rail('settings');
  await until('Boolean(document.querySelector(".settings-workspace"))');
  await shot('settings-en-day');
  await click('.settings-content__header button');
  await until('!document.querySelector(".settings-workspace")');
  await preferences({ interfaceStyle: 'simple' });
  await renderer.send('Page.reload');
  await until('document.documentElement.dataset.interfaceStyle==="simple"&&Boolean(document.querySelector(".composer textarea"))');
  await selectSession(fixture.sessionId);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".orbit-tool-rail, .orbit-workspace-header, .orbit-status-bar"))'), false);
  assert.deepEqual(await snapshot(), baseline);
  await modelLabel(primaryModel, 'en');
  await shot('simple-restored-en-day');
  await preferences({ interfaceStyle: 'orbit' });
  await renderer.send('Page.reload');
  await until('document.documentElement.dataset.interfaceStyle==="orbit"&&Boolean(document.querySelector(".orbit-tool-rail"))');
  await selectSession(fixture.sessionId);
  await rail('review');
  await geometry();
  assert.deepEqual(await snapshot(), baseline);
  record('Rail settings remains functional; switching back to Simple removes the Orbit shell and retains all data, then Orbit restores cleanly');

  const requestsBeforeLabels = requests.length;
  const labelFixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({name:${JSON.stringify(alternateModel.providerName)},
      baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',
      apiKey:'local-optics-label-only',keyLabel:'Fixture',neverReveal:true});
    await window.mingshen.createModel({providerId:provider.id,modelId:${JSON.stringify(alternateModel.modelId)},
      displayName:${JSON.stringify(alternateModel.displayName)},contextWindow:200000,maxOutputTokens:8192,
      inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['none','low','high'],
      anthropicNoneBehavior:'disabled'});
    const updated=await window.mingshen.createModel({providerId:provider.id,modelId:${JSON.stringify(longModel.modelId)},
      displayName:${JSON.stringify(longModel.displayName)},contextWindow:200000,maxOutputTokens:8192,
      inputModalities:['text'],toolCalls:true,parallelToolCalls:true,reasoningLevels:['none','low','high'],
      anthropicNoneBehavior:'disabled'});
    return {providerId:provider.id,longModelConfigId:updated.models.find(model=>model.modelId===${JSON.stringify(longModel.modelId)}).id};
  })()`);
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer textarea"))&&document.documentElement.dataset.interfaceStyle==="orbit"');
  await selectSession(fixture.sessionId);
  await selectModel(alternateModel);
  await modelLabel(alternateModel, 'en', { fullyVisible: true });
  const alternateSelection = await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)})`);
  assert.equal(alternateSelection.providerId, labelFixture.providerId);
  assert.notEqual(alternateSelection.modelId, baseline.session.modelId);
  await selectModel(primaryModel);
  await modelLabel(primaryModel, 'en');
  assert.deepEqual(await snapshot(), baseline);
  record('Selecting the same model display name from a different real provider visibly changes its provider suffix and retains the selected provider identity');

  await renderer.evaluate(`window.mingshen.updateProvider({providerId:${JSON.stringify(labelFixture.providerId)},
    name:${JSON.stringify(longModel.providerName)},baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses'})`);
  await renderer.send('Page.reload');
  await until('Boolean(document.querySelector(".composer textarea"))&&document.documentElement.dataset.interfaceStyle==="orbit"');
  await selectSession(fixture.sessionId);
  await selectModel(longModel);
  for (const style of ['orbit', 'simple']) {
    for (const [locale, theme] of [['zh-CN', 'night'], ['zh-CN', 'day'], ['en', 'night'], ['en', 'day']]) {
      await viewport(1440, 900);
      await preferences({ interfaceStyle: style });
      await localeTheme(locale, theme, style);
      await selectModel(primaryModel);
      await modelLabel(primaryModel, locale, { fullyVisible: true });
      await viewport(800, 600);
      await modelLabel(primaryModel, locale, { fullyVisible: true });
      await selectModel(longModel);
      await modelLabel(longModel, locale);
      await viewport(1440, 900);
      await modelLabel(longModel, locale);
      await viewport(800, 600);
      await shot(`model-provider-long-${style}-${locale}-${theme}-compact`);
    }
  }
  record('Ordinary model/provider pairs remain fully visible; long names retain complete tooltips and accessibility names in both styles, both languages, both themes and 1440/800 windows without escaping the composer');

  await viewport(1440, 900);
  await renderer.evaluate(`window.mingshen.removeModel(${JSON.stringify(labelFixture.longModelConfigId)})`);
  for (const locale of ['en', 'zh-CN']) {
    await localeTheme(locale, 'day', 'simple');
    await modelLabel(null, locale);
    await selectModel(primaryModel);
    await modelLabel(primaryModel, locale);
    if (locale === 'en') {
      await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(fixture.sessionId)},
        providerId:${JSON.stringify(labelFixture.providerId)},modelId:${JSON.stringify(alternateSelection.modelId)}})`);
      await renderer.evaluate(`window.mingshen.removeModel(${JSON.stringify(alternateSelection.modelId)})`);
    }
  }
  await preferences({ interfaceStyle: 'orbit' });
  await localeTheme('zh-CN', 'night');
  await rail('review');
  await geometry();
  await modelLabel(primaryModel, 'zh-CN', { fullyVisible: true });
  assert.deepEqual(await snapshot(), baseline);
  assert.equal(requests.length, requestsBeforeLabels, 'Model label and presentation checks must not send another model request');
  await frameEvidence();
  await shot('polished-provider-zh-night-1440');
  assert.deepEqual(exceptions, []);
  assert.deepEqual(serverErrors, []);
  record('Removing only temporary selected models shows the localized empty selection without stray parentheses; restoring the original model keeps messages and plan unchanged and sends no model request');
  console.log(JSON.stringify({
    version, passed, localRequests: requests.length,
    workerRequests: requests.filter(request => request.worker).length,
    rendererExceptions: exceptions, captures,
    boundaries: [
      'Only isolated profile/project and an owned local Responses SSE fixture; no paid model, private profile or system clipboard.',
      'Files, command output, plan and child records come from actual application tool execution.',
      'CDP viewport sizes are not the full Windows system-DPI or accessibility matrix.',
      'No installer generation, installation, update or cloud write.',
    ],
  }, null, 2));
} catch (cause) {
  if (renderer) await shot('failure').catch(() => {});
  console.error(JSON.stringify({
    passed, exceptions, serverErrors,
    requests: requests.map(({ worker, body }) => ({ worker, calls: (body.input || []).filter(item => item.type === 'function_call').map(item => item.name) })),
    body: await renderer?.evaluate('document.body.innerText').catch(() => null),
  }, null, 2));
  throw cause;
} finally {
  releaseParent = true;
  if (child) {
    const closing = child;
    const exited = new Promise(done => closing.once('exit', done));
    if (fixture) await renderer?.evaluate(`window.mingshen.stopChat(${JSON.stringify(fixture.sessionId)})`).catch(() => {});
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
  await new Promise(done => server.close(done));
  const root = resolve(tmpdir()) + sep;
  if (!temporary.startsWith(root) || !temporary.slice(root.length).startsWith('mingshen-orbit-rebuild-')) {
    throw new Error('Unsafe fixture cleanup path');
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
