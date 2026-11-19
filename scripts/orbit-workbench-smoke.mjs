import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { experimentalExecutable } from './experimental-executable.mjs';

// All runtime records below are produced by a local fixture in its own profile.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const temporary = await mkdtemp(resolve(tmpdir(), 'mingshen-orbit-rebuild-'));
const profile = resolve(temporary, 'profile');
const project = resolve(temporary, 'orbit-workbench');
const startedAt = Date.now();
const screenshots = resolve('.impeccable/review', `v133-orbit-layout-${startedAt}`);
const passed = [], requests = [], exceptions = [], serverErrors = [], captures = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));
const boundaries = [
  'Only isolated profile/project and an owned local Responses SSE fixture; no paid model, private profile or system clipboard.',
  'Files, command output, plan, child records and queue entries come from actual application actions.',
  'Layout checks cover 1440x900, 1280x800, 800x600 and a 720x450 CSS viewport equivalent to 200% scaling at 1440x900; they do not certify the full Windows system-DPI or assistive-technology matrix.',
  'No installer generation, installation, update or cloud write.',
];
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
let child, main, renderer, rendererPort, fixture, releaseParent = false, parentHolding = false;

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
        .find(item => item.webSocketDebuggerUrl &&
          (surface === 'quick' ? item.type === 'page' && item.url.includes('surface=quick-chat') :
            surface !== 'renderer' || item.type === 'page' && !item.url.includes('surface=quick-chat')));
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
    if ((surface === 'renderer' || surface === 'quick') && value.method === 'Runtime.exceptionThrown') {
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

async function clickByPointer(selector) {
  const target = JSON.stringify(selector);
  await until(`(()=>{const el=document.querySelector(${target}),r=el?.getBoundingClientRect();return Boolean(el&&!el.matches(':disabled')&&r&&r.width>0&&r.height>0)})()`);
  const point = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${target}),r=el.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
    return {x,y,foreground:Boolean(hit&&el.contains(hit))};
  })()`);
  assert.equal(point.foreground, true, `Control is not pointer-reachable: ${selector}`);
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none', buttons: 0 });
  await renderer.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 });
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 });
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

async function closeWorkbenchDrawers() {
  for (let index = 0; index < 3; index++) {
    const visible = await renderer.evaluate(`(()=>{
      const scrim=document.querySelector('.workbench-drawer-scrim');
      return Boolean(scrim&&scrim.getBoundingClientRect().width>0);
    })()`);
    if (!visible) break;
    await renderer.evaluate(`(()=>{
      document.querySelector('.workbench-drawer-scrim')?.click();
      return true;
    })()`);
    await sleep(120);
  }
  await until(`![...document.querySelectorAll('.workbench-drawer-scrim')]
    .some(el=>el.getBoundingClientRect().width>0)`);
}

async function restoreWidePanels() {
  await viewport(1440, 900);
  if (await renderer.evaluate('document.querySelector(".sidebar-host")?.hidden')) {
    await click('.orbit-workspace-header > button:first-child');
  }
  await rail('review');
  await until('document.querySelector(".inspector-host")?.getBoundingClientRect().width>0&&document.querySelector(".task-host--docked")?.getBoundingClientRect().width>0');
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

async function captionGeometry(label) {
  const state = await renderer.evaluate(`(()=>{
    const box=selector=>{
      const el=document.querySelector(selector),r=el?.getBoundingClientRect();
      return r&&r.width>1&&r.height>1
        ?{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}
        :null;
    };
    const brand=box('.app-topbar--orbit .brand');
    const modes=box('[data-testid="agent-mode-switcher"]');
    const actions=box('.app-topbar--orbit .topbar-actions');
    const windows=box('.desktop-caption__actions');
    const mark=box('.orbit-style-mark');
    const visibleButtons=[...document.querySelectorAll('.desktop-caption button')].filter(el=>{
      const r=el.getBoundingClientRect();
      return r.width>1&&r.height>1;
    }).map(el=>{
      const r=el.getBoundingClientRect();
      return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    });
    const intersects=(left,right)=>Boolean(left&&right&&
      Math.min(left.right,right.right)-Math.max(left.left,right.left)>1&&
      Math.min(left.bottom,right.bottom)-Math.max(left.top,right.top)>1);
    return {
      width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
      brand,modes,actions,windows,mark,visibleButtons,
      overlaps:{
        brandModes:intersects(brand,modes),
        brandActions:intersects(brand,actions),
        modesActions:intersects(modes,actions),
        brandWindows:intersects(brand,windows),
        modesWindows:intersects(modes,windows),
        actionsWindows:intersects(actions,windows),
        markModes:intersects(mark,modes),
        markActions:intersects(mark,actions),
      },
    };
  })()`);
  assert.equal(state.overflow, false, `Caption overflow at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.brand && state.modes && state.actions && state.windows,
    `Caption controls must remain rendered at ${label}: ${JSON.stringify(state)}`);
  assert.deepEqual(state.overlaps, {
    brandModes: false,
    brandActions: false,
    modesActions: false,
    brandWindows: false,
    modesWindows: false,
    actionsWindows: false,
    markModes: false,
    markActions: false,
  }, `Caption content overlaps at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.visibleButtons.length >= 3 && state.visibleButtons.every(button =>
    button.left >= -1 && button.right <= state.width + 1 && button.top >= -1),
  `Caption buttons must remain reachable at ${label}: ${JSON.stringify(state)}`);
  return state;
}

async function assertFloatingSurface(selector, label, options = {}) {
  const state = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el)return null;
    const r=el.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    const composer=el.closest('.composer')?.getBoundingClientRect();
    return {
      viewport:{width:innerWidth,height:innerHeight},
      overflow:document.documentElement.scrollWidth>innerWidth+1,
      rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height},
      client:{width:el.clientWidth,height:el.clientHeight},
      scroll:{width:el.scrollWidth,height:el.scrollHeight},
      foreground:Boolean(hit&&el.contains(hit)),
      composer:composer?{left:composer.left,right:composer.right,top:composer.top,bottom:composer.bottom}:null,
    };
  })()`);
  assert.ok(state && state.rect.width > 40 && state.rect.height > 30,
    `${label} must remain visibly rendered: ${JSON.stringify(state)}`);
  assert.equal(state.overflow, false, `${label} caused document overflow: ${JSON.stringify(state)}`);
  assert.equal(state.foreground, true, `${label} is occluded: ${JSON.stringify(state)}`);
  assert.ok(state.rect.left >= -1 && state.rect.right <= state.viewport.width + 1 &&
    state.rect.top >= -1 && state.rect.bottom <= state.viewport.height + 1,
  `${label} escaped the viewport: ${JSON.stringify(state)}`);
  assert.ok(state.scroll.width <= state.client.width + 2,
    `${label} has internal horizontal overflow: ${JSON.stringify(state)}`);
  if (options.withinComposer) {
    assert.ok(state.composer && state.rect.top >= state.composer.top - 2 &&
      state.rect.bottom <= state.composer.bottom + 2,
    `${label} escaped the composer: ${JSON.stringify(state)}`);
  }
  return state;
}

async function composerGeometry(label) {
  const state = await renderer.evaluate(`(()=>{
    const box=selector=>{
      const el=document.querySelector(selector),r=el?.getBoundingClientRect();
      return r&&r.width>1&&r.height>1
        ?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
          clientWidth:el.clientWidth,scrollWidth:el.scrollWidth}
        :null;
    };
    const composer=document.querySelector('.composer');
    const textarea=document.querySelector('[data-testid="chat-composer-input"]');
    const visibleChildren=[...(composer?.children??[])].filter(el=>{
      const r=el.getBoundingClientRect(),style=getComputedStyle(el);
      return r.width>1&&r.height>1&&style.visibility!=='hidden';
    }).map(el=>{
      const r=el.getBoundingClientRect();
      return {className:el.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
        width:r.width,height:r.height,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth};
    });
    const overlapCount=items=>{
      let count=0;
      for(let left=0;left<items.length;left++){
        for(let right=left+1;right<items.length;right++){
          const a=items[left],b=items[right];
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&
            Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)count++;
        }
      }
      return count;
    };
    return {
      viewport:{width:innerWidth,height:innerHeight},
      overflow:document.documentElement.scrollWidth>innerWidth+1,
      composer:box('.composer'),
      context:box('.composer__context'),
      textarea:box('[data-testid="chat-composer-input"]'),
      footer:box('.composer__footer'),
      textareaHidden:Boolean(textarea?.hidden),
      textareaDisabled:Boolean(textarea?.disabled),
      directChildOverlap:overlapCount(visibleChildren),
      directChildOverflow:visibleChildren.some(child=>child.scrollWidth>child.clientWidth+2),
      visibleChildren,
    };
  })()`);
  assert.equal(state.overflow, false, `Composer caused document overflow at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.composer && state.context && state.textarea && state.footer,
    `Composer regions must remain rendered at ${label}: ${JSON.stringify(state)}`);
  assert.equal(state.textareaHidden, false, `Composer textarea must stay editable at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.textarea.height >= 40 && state.textarea.width >= 120,
    `Composer textarea needs usable space at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.context.top >= state.composer.top - 1 &&
    state.context.bottom <= state.textarea.top + 1 &&
    state.textarea.bottom <= state.footer.top + 1 &&
    state.footer.bottom <= state.composer.bottom + 1,
  `Composer regions overlap or escape their container at ${label}: ${JSON.stringify(state)}`);
  assert.ok([state.context, state.textarea, state.footer].every(region =>
    region.left >= state.composer.left - 1 && region.right <= state.composer.right + 1),
  `Composer region escaped horizontally at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.composer.left >= -1 && state.composer.right <= state.viewport.width + 1 &&
    state.composer.top >= -1 && state.composer.bottom <= state.viewport.height + 1,
  `Composer escaped the viewport at ${label}: ${JSON.stringify(state)}`);
  assert.equal(state.directChildOverlap, 0,
    `Visible composer children overlap at ${label}: ${JSON.stringify(state)}`);
  assert.equal(state.directChildOverflow, false,
    `Visible composer children overflow horizontally at ${label}: ${JSON.stringify(state)}`);
  return state;
}

async function workspaceGeometry(label) {
  const state = await renderer.evaluate(`(()=>{
    const box=selector=>{
      const r=document.querySelector(selector)?.getBoundingClientRect();
      return r&&r.width>1&&r.height>1
        ?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}
        :null;
    };
    return {
      viewport:{width:innerWidth,height:innerHeight},
      overflow:document.documentElement.scrollWidth>innerWidth+1,
      workspace:box('.inspector-host'),
      editor:box('.editor-textarea'),
      task:box('.task-host--docked'),
      taskBody:box('.task-workbench__body'),
    };
  })()`);
  assert.equal(state.overflow, false, `Workspace caused document overflow at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.workspace && state.editor && state.task && state.taskBody,
    `Editor and task dock must remain rendered at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.editor.height >= 160,
    `Editor lost usable height at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.task.height >= 150 && state.taskBody.height >= 80,
    `Task dock lost usable height at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.task.top >= state.workspace.bottom - 2,
    `Inspector and task dock overlap at ${label}: ${JSON.stringify(state)}`);
  assert.ok(state.task.bottom <= state.viewport.height + 1,
    `Task dock escaped the viewport at ${label}: ${JSON.stringify(state)}`);
  return state;
}

async function capabilityPickerEvidence() {
  const requestsBefore = requests.length;
  await click('[data-testid="capability-picker-trigger"]');
  await until('Boolean(document.querySelector("[data-testid=capability-picker-panel]"))');
  await until('Boolean(document.querySelector("[data-testid=capability-picker-search]"))');
  await assertFloatingSurface('[data-testid="capability-picker-panel"]', 'Capability picker at 1440');
  const selectedId = await renderer.evaluate(`(()=>{
    const item=[...document.querySelectorAll('[data-testid="builtin-capability-item"]')]
      .find(el=>!el.disabled&&el.getAttribute('aria-pressed')!=='true'&&
        el.dataset.capabilityType==='skill');
    if(!item)throw new Error('No selectable built-in Skill in the real picker');
    item.click();
    return item.dataset.capabilityId;
  })()`);
  await until(`Boolean(document.querySelector('[data-testid="capability-chip"][data-capability-id="${selectedId}"]'))`);
  await shot('capability-picker-zh-night-1440');

  await viewport(800, 600);
  await closeWorkbenchDrawers();
  await assertFloatingSurface('[data-testid="capability-picker-panel"]', 'Capability picker at 800');
  await shot('capability-picker-zh-night-800');
  await renderer.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await renderer.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await until('!document.querySelector("[data-testid=capability-picker-panel]")');
  const selectedChip = `[...document.querySelectorAll('[data-testid="capability-chip"]')]
    .find(el=>el.dataset.capabilityId===${JSON.stringify(selectedId)})`;
  await until(`Boolean(${selectedChip})`);
  await renderer.evaluate(`${selectedChip}.click();true`);
  await until(`!${selectedChip}`);
  await restoreWidePanels();
  assert.equal(requests.length, requestsBefore, 'Opening and selecting a capability must not make a model request');
  record('The manual capability picker is searchable, selectable, foreground and within the composer at 1440 and 800 without horizontal overflow');
}

async function queuedPromptEvidence() {
  const requestsBefore = requests.length;
  await fill('[data-testid="chat-composer-input"]', 'ORBIT_LAYOUT_NEXT_TURN_VERIFY');
  await until('!document.querySelector("[data-testid=chat-queue-add]")?.disabled');
  await click('[data-testid="chat-queue-add"]');
  await until('document.querySelector("[data-testid=queued-prompt-count]")?.textContent?.replace(/\\s/g,"")==="1/10"');
  await until('document.querySelector("[data-testid=queued-prompt-item]")?.textContent.includes("ORBIT_LAYOUT_NEXT_TURN_VERIFY")');
  await assertFloatingSurface('[data-testid="queued-prompt-tray"]', 'Queued prompt at 1440', {
    withinComposer: true,
  });
  await shot('queued-prompt-running-zh-night-1440');

  await viewport(800, 600);
  await closeWorkbenchDrawers();
  await assertFloatingSurface('[data-testid="queued-prompt-tray"]', 'Queued prompt at 800', {
    withinComposer: true,
  });
  await shot('queued-prompt-running-zh-night-800');
  await click('[data-testid="queued-prompt-delete"]');
  await until('!document.querySelector("[data-testid=queued-prompt-tray]")');
  await restoreWidePanels();
  assert.equal(requests.length, requestsBefore, 'Queuing and deleting a next-turn prompt must not make a model request');
  record('A real busy-session next-turn queue remains usable and foreground in the composer at 1440 and 800 without horizontal overflow');
}

async function agentLayoutEvidence() {
  const requestsBefore = requests.length;
  await localeTheme('zh-CN', 'night');
  await restoreWidePanels();
  await click('[data-testid="agent-mode-work"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="work"');
  await until(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(session=>session.agentMode==='work')`);
  await captionGeometry('WorkAgent zh-CN night 1440x900');
  await composerGeometry('WorkAgent zh-CN night 1440x900');
  await shot('work-zh-night-1440');
  await viewport(800, 600);
  await closeWorkbenchDrawers();
  await captionGeometry('WorkAgent zh-CN night 800x600');
  await composerGeometry('WorkAgent zh-CN night 800x600');
  await shot('work-zh-night-800');

  await viewport(1440, 900);
  await click('[data-testid="agent-mode-chat"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="chat"');
  await click('[data-testid="new-chat"]');
  await until('Boolean(document.querySelector("[data-testid=new-chat-dialog]"))');
  await click('[data-testid="new-chat-dialog"] button[type="submit"]');
  await until('!document.querySelector("[data-testid=new-chat-dialog]")&&Boolean(document.querySelector(".chat-session-row--selected"))');
  const chatId = await renderer.evaluate('document.querySelector(".chat-session-row--selected").dataset.sessionId');
  const chat = await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(chatId)})`);
  assert.equal(chat.agentMode, 'chat');
  assert.equal(chat.workspacePath, null);

  for (const theme of ['night', 'day']) {
    await renderer.evaluate(`localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});true`);
    await renderer.send('Page.reload');
    await until('document.querySelector(".app-shell")?.dataset.agentMode==="chat"&&Boolean(document.querySelector(".composer textarea"))');
    await viewport(1440, 900);
    await captionGeometry(`ChatAgent zh-CN ${theme} 1440x900`);
    await composerGeometry(`ChatAgent zh-CN ${theme} 1440x900`);
    await shot(`chat-zh-${theme}-1440`);
    await viewport(800, 600);
    if (await renderer.evaluate('Boolean(document.querySelector(".chat-sidebar-scrim"))')) {
      await click('.chat-sidebar-scrim');
    }
    await captionGeometry(`ChatAgent zh-CN ${theme} 800x600`);
    await composerGeometry(`ChatAgent zh-CN ${theme} 800x600`);
    await shot(`chat-zh-${theme}-800`);
  }

  await click('[data-testid="agent-mode-code"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="code"');
  await restoreWidePanels();
  await quickLayoutEvidence();
  assert.equal(requests.length, requestsBefore, 'Checking real Work/Chat layouts must not make a model request');
  record('WorkAgent retains the shared workspace and ChatAgent opens its independent page; real mode controls and composers remain bounded at 1440/800 in day/night without a model request');
}

async function quickLayoutEvidence() {
  const primary = renderer;
  let quick;
  await primary.evaluate('window.mingshen.quickChatAction("show")');
  try {
    quick = await connect(rendererPort, 'quick');
    renderer = quick;
    await renderer.send('Runtime.enable');
    await until('Boolean(document.querySelector(".quick-chat .composer textarea"))');
    for (const [width, height] of [[540, 720], [400, 560]]) {
      await viewport(width, height);
      await composerGeometry(`QuickChat ${width}x${height}`);
      await shot(`quick-chat-day-${width}x${height}`);
    }
    record('The actual QuickChat window retains an editable, bounded composer at 540x720 and 400x560');
  } finally {
    renderer = primary;
    await primary.evaluate('window.mingshen.quickChatAction("hide")').catch(() => {});
    await quick?.close();
  }
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

async function reviewPathEvidence(locale) {
  const selector = '.orbit-review-file[data-review-file$="workbench-layout.ts"]';
  await rail('review');
  await click(selector);
  await until('document.querySelector(".orbit-review-preview header code")?.textContent==="workbench-layout.ts"');
  const review = await renderer.evaluate(`(()=>{
    const row=document.querySelector(${JSON.stringify(selector)});
    const button=document.querySelector('.orbit-review-preview header > button');
    return {directory:row.querySelector('.orbit-review-file__path')?.textContent,
      name:row.querySelector('.orbit-review-file__name')?.textContent,
      previewName:button.querySelector('code')?.textContent,
      previewDirectory:button.querySelector('.orbit-review-file__path')?.textContent,
      previewPath:button.getAttribute('aria-label'),
      additions:Number(row.querySelector('.run-summary__added')?.textContent.slice(1)),
      deletions:Number(row.querySelector('.run-summary__deleted')?.textContent.slice(1)),
      files:document.querySelectorAll('.orbit-review-file[data-review-file]').length};
  })()`);
  assert.equal(review.directory, 'src');
  assert.equal(review.name, 'workbench-layout.ts');
  assert.equal(review.previewName, 'workbench-layout.ts');
  assert.equal(review.previewDirectory, 'src');
  assert.equal(review.previewPath?.replaceAll('\\', '/'), 'src/workbench-layout.ts');
  assert.equal(review.files, 2);
  assert.ok(Number.isInteger(review.additions) && review.additions >= 0 && Number.isInteger(review.deletions) && review.deletions >= 0);
  const expected = locale === 'en'
    ? `${review.previewPath}, ${review.additions} additions, ${review.deletions} deletions`
    : `${review.previewPath}\uff0c\u65b0\u589e ${review.additions} \u884c\uff0c\u5220\u9664 ${review.deletions} \u884c`;
  const { root } = await renderer.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await renderer.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { nodes } = await renderer.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
  assert.equal(nodes.find(node => node.role?.value === 'button')?.name?.value, expected,
    'The review row accessibility name must retain its full path and localized additions/deletions');
}

async function taskDockEvidence(baseline) {
  const requestsBefore = requests.length;
  const key = `@orbit:${project.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()}`;
  const splitter = '.panel-resize--bottom';
  const savedHeight = value => `window.mingshen.getUiPreferences().then(p=>p.projects[${JSON.stringify(key)}]?.taskPanelHeight===${value === undefined ? 'undefined' : value})`;
  const savedCollapsed = value => `window.mingshen.getUiPreferences().then(p=>p.projects[${JSON.stringify(key)}]?.taskPanelCollapsed===${value})`;
  const valueIs = value => `(()=>{const h=document.querySelector(${JSON.stringify(splitter)}),p=document.querySelector('.task-host--docked');return Boolean(h&&p&&Math.abs(p.getBoundingClientRect().height-${value})<2&&Number(h.getAttribute('aria-valuenow'))===${value})})()`;
  const handlePoint = () => renderer.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(splitter)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  const mouse = (type, point, buttons, count = 1) => renderer.send('Input.dispatchMouseEvent', {
    type, x: point.x, y: point.y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: count,
  });
  const pressKey = async (name, code) => {
    await renderer.evaluate(`document.querySelector(${JSON.stringify(splitter)}).focus();true`);
    await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code });
    await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
  };
  const reset = async () => {
    const point = await handlePoint();
    await mouse('mouseMoved', point, 0);
    await mouse('mousePressed', point, 1);
    await mouse('mouseReleased', point, 0);
    await mouse('mousePressed', point, 1, 2);
    await mouse('mouseReleased', point, 0, 2);
    await until(savedHeight(undefined));
    await until(`!document.querySelector('.app-body').style.getPropertyValue('--orbit-task-height-override')`);
  };

  await restoreWidePanels();
  await click('[data-task-tab="plan"]');
  await until('document.querySelectorAll(".plan-step").length===3');
  await reviewPathEvidence('zh-CN');
  record('The real two-file review separates directory and filename, retains the complete relative path and exposes localized diff counts to accessibility');

  await click('.task-workbench__toolbar button[title="\u7f16\u8f91\u8ba1\u5212"]');
  await fill('.plan-edit-row:first-child > input[required]', 'Unsaved owned plan edit');
  await renderer.evaluate(`window.__orbitPlanInput=document.querySelector('.plan-edit-row:first-child > input[required]');window.__orbitTaskNode=document.querySelector('.task-workbench');true`);
  await click('[data-task-action="collapse"]');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="true"');
  assert.equal(await renderer.evaluate(`document.querySelector('.task-workbench')===window.__orbitTaskNode&&document.querySelector('.plan-edit-row:first-child > input[required]')===window.__orbitPlanInput&&window.__orbitPlanInput.value==='Unsaved owned plan edit'`), true);
  assert.equal(await renderer.evaluate('document.querySelector("[data-task-action=collapse]").getAttribute("aria-expanded")'), 'false');
  assert.ok((await renderer.evaluate('document.querySelector(".task-host--docked").getBoundingClientRect().height')) <= 42);
  await shot('task-collapsed-unsaved-zh-night');
  await click('[data-task-action="collapse"]');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="false"');
  assert.equal(await renderer.evaluate(`document.querySelector('.plan-edit-row:first-child > input[required]')===window.__orbitPlanInput&&window.__orbitPlanInput.value==='Unsaved owned plan edit'`), true);
  await click('.plan-edit-actions button[type="button"]:nth-of-type(2)');
  await until('!document.querySelector(".task-workbench[data-unsaved=true]")');
  assert.deepEqual(await snapshot(), baseline, 'Cancelling the temporary plan edit must not change the saved plan');
  record('Collapsing and expanding keeps the actual task and unsaved plan input mounted, while cancelling leaves the saved plan unchanged');

  const initial = Math.round(await renderer.evaluate('document.querySelector(".task-host--docked").getBoundingClientRect().height'));
  assert.equal(await renderer.evaluate('document.querySelector(".panel-resize--bottom").getAttribute("aria-orientation")'), 'horizontal');
  const point = await handlePoint();
  assert.equal(await renderer.evaluate(`(()=>{const p=${JSON.stringify(point)};
    return document.elementFromPoint(p.x,p.y)===document.querySelector(${JSON.stringify(splitter)})})()`), true);
  await mouse('mouseMoved', point, 0);
  await mouse('mousePressed', point, 1);
  await sleep(80);
  await mouse('mouseMoved', { x: point.x, y: point.y - 80 }, 1);
  await sleep(80);
  await mouse('mouseReleased', { x: point.x, y: point.y - 80 }, 0);
  const dragged = initial + 80;
  await until(valueIs(dragged));
  await until(savedHeight(dragged));
  const handleColors = await renderer.evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(splitter)});
    return {surface:getComputedStyle(h).backgroundColor,grip:getComputedStyle(h,'::after').backgroundColor}})()`);
  assert.notEqual(handleColors.surface, handleColors.grip, 'Hover highlights the grip without filling the full drag target with the accent color');
  await shot('task-resized-zh-night');
  await pressKey('ArrowUp', 38);
  await until(valueIs(dragged + 16));
  await pressKey('ArrowDown', 40);
  await until(valueIs(dragged));
  await pressKey('Home', 36);
  await until(valueIs(160));
  await pressKey('End', 35);
  const maximum = Math.min(640, 900 - 300);
  await until(valueIs(maximum));
  await until(savedHeight(maximum));

  const cancelPoint = await handlePoint();
  await renderer.evaluate(`document.querySelector(${JSON.stringify(splitter)}).focus();true`);
  await mouse('mouseMoved', cancelPoint, 0);
  await mouse('mousePressed', cancelPoint, 1);
  await mouse('mouseMoved', { x: cancelPoint.x, y: cancelPoint.y + 48 }, 1);
  await until(valueIs(maximum - 48));
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await renderer.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await mouse('mouseReleased', { x: cancelPoint.x, y: cancelPoint.y + 48 }, 0);
  await until(valueIs(maximum));
  for (let index = 0; index < 5; index++) {
    await sleep(200);
    assert.equal(await renderer.evaluate(savedHeight(maximum)), true, 'Cancelled dragging must not persist its intermediate height');
  }
  await renderer.evaluate('window.__orbitCancelledDragReload=true;true');
  await renderer.send('Page.reload');
  await until('window.__orbitCancelledDragReload===undefined&&Boolean(document.querySelector(".orbit-tool-rail"))');
  await selectSession(fixture.sessionId);
  await rail('review');
  await until(valueIs(maximum));
  await until(savedHeight(maximum));
  await reset();
  const defaultHeight = Math.round(await renderer.evaluate('document.querySelector(".task-host--docked").getBoundingClientRect().height'));
  await pressKey('ArrowUp', 38);
  await until(valueIs(defaultHeight + 16));
  await until(savedHeight(defaultHeight + 16));
  await pressKey('Enter', 13);
  await until(savedHeight(undefined));
  await until(valueIs(defaultHeight));
  await pressKey('ArrowUp', 38);
  const persistedHeight = defaultHeight + 16;
  await until(valueIs(persistedHeight));
  await until(savedHeight(persistedHeight));
  await click('[data-task-action="collapse"]');
  await until(savedCollapsed(true));
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.sessionId)}).then(d=>!d||!d.text)`);
  await renderer.evaluate('window.__orbitBeforeTaskReload=true;true');
  await renderer.send('Page.reload');
  await until('window.__orbitBeforeTaskReload===undefined&&Boolean(document.querySelector(".orbit-tool-rail"))&&Boolean(window.mingshen)');
  await selectSession(fixture.sessionId);
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="true"');
  await until(savedHeight(persistedHeight));
  await click('[data-task-action="collapse"]');
  await until(valueIs(persistedHeight));
  await click('[data-task-action="collapse"]');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="true"');
  await rail('agents');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="false"&&document.querySelector(".task-workbench")?.dataset.taskView==="agents"');
  await rail('review');
  await click('[data-task-tab="plan"]');
  await reset();
  await until(savedCollapsed(false));
  await geometry();
  assert.deepEqual(await snapshot(), baseline);
  assert.equal(requests.length, requestsBefore);
  record('The horizontal splitter supports real pointer drag, keyboard bounds, Escape rollback, Enter and double-click reset; project height and collapse survive reload and the Agent rail reveals tasks');
}

async function workStarterEvidence(sessionId, locale) {
  const requestsBefore = requests.length;
  await selectSession(sessionId);
  await click('[data-testid="agent-mode-work"]');
  await until(`document.querySelector('.app-shell')?.dataset.agentMode==='work'&&window.mingshen.getSession(${JSON.stringify(sessionId)}).then(s=>s.agentMode==='work')`);
  const heading = locale === 'en' ? 'Start with a work goal' : '\u4ece\u5de5\u4f5c\u76ee\u6807\u5f00\u59cb';
  const labels = locale === 'en'
    ? ['Draft a Word document', 'Analyze an Excel spreadsheet', 'Create a PowerPoint presentation']
    : ['\u8d77\u8349 Word \u6587\u6863', '\u5206\u6790 Excel \u8868\u683c', '\u5236\u4f5c PPT \u6f14\u793a'];
  await until(`document.querySelector('.conversation-empty h1')?.textContent===${JSON.stringify(heading)}&&document.querySelectorAll('[data-starter-kind]').length===3&&!document.querySelector('[data-starter-kind="document"]').matches(':disabled')&&!document.querySelector('.composer textarea')?.disabled`);
  assert.deepEqual(await renderer.evaluate('[...document.querySelectorAll("[data-starter-kind]")].map(el=>el.textContent.trim())'), labels);
  await shot(`work-empty-${locale}-1440`);
  await fill('.composer textarea', 'Owned work draft');
  for (const [kind, expected] of [['document', 'Word'], ['spreadsheet', 'Excel'], ['presentation', locale === 'en' ? 'PowerPoint' : 'PPT']]) {
    const previous = await renderer.evaluate('document.querySelector(".composer textarea").value');
    await clickByPointer(`[data-starter-kind="${kind}"]`);
    await until(`document.activeElement===document.querySelector('.composer textarea')&&document.querySelector('.composer textarea').value.startsWith(${JSON.stringify(`${previous}\n\n`)})&&document.querySelector('.composer textarea').value.slice(${previous.length}).includes(${JSON.stringify(expected)})`);
  }
  const finalWord = locale === 'en' ? 'PowerPoint' : 'PPT';
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(sessionId)}).then(d=>d?.text.includes(${JSON.stringify(finalWord)}))`);
  await fill('.composer textarea', '');
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(sessionId)}).then(d=>!d||!d.text)`);
  assert.equal((await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(sessionId)})`)).length, 0);
  assert.equal(requests.length, requestsBefore, 'Work starter prompts must only edit the draft, not send a request');
  await click('[data-testid="agent-mode-code"]');
  await until(`document.querySelector('.app-shell')?.dataset.agentMode==='code'&&window.mingshen.getSession(${JSON.stringify(sessionId)}).then(s=>s.agentMode==='code')`);
  await until('document.querySelectorAll("[data-starter-kind]").length===0');
  await selectSession(fixture.sessionId);
  record(`Work starter actions in ${locale} append the three office prompts, focus the composer and make no model request; Code mode is restored`);
}

async function planNavigationEvidence(otherSessionId, baseline) {
  const requestsBefore = requests.length;
  const message = '\u8bf7\u5148\u4fdd\u5b58\u6216\u53d6\u6d88\u8ba1\u5212\u7f16\u8f91\uff0c\u518d\u5207\u6362\u4f1a\u8bdd\u6216 ChatAgent\u3002';
  await restoreWidePanels();
  await click('[data-task-tab="plan"]');
  await click('.task-workbench__toolbar button[title="\u7f16\u8f91\u8ba1\u5212"]');
  await fill('.plan-edit-row:first-child > input[required]', 'Owned navigation plan draft');
  await fill('.plan-edit-row:nth-child(2) .plan-edit-row__dependencies input', '1, 3');
  await renderer.evaluate(`window.__orbitGuardPlan=document.querySelector('.plan-edit-row:first-child > input[required]');window.__orbitGuardDependencies=document.querySelector('.plan-edit-row:nth-child(2) .plan-edit-row__dependencies input');true`);
  const preserved = `(()=>{const task=document.querySelector('.task-workbench');return task?.dataset.taskSession===${JSON.stringify(fixture.sessionId)}&&task.dataset.taskView==='plan'&&task.dataset.unsaved==='true'&&document.querySelector('.plan-edit-row:first-child > input[required]')===window.__orbitGuardPlan&&window.__orbitGuardPlan.value==='Owned navigation plan draft'&&document.querySelector('.plan-edit-row:nth-child(2) .plan-edit-row__dependencies input')===window.__orbitGuardDependencies&&window.__orbitGuardDependencies.value==='1, 3'})()`;
  const blocked = `document.querySelector('.app-shell')?.dataset.agentMode==='code'&&document.querySelector('.app-body')?.dataset.taskCollapsed==='false'&&document.querySelector('.task-workbench [role="alert"]')?.textContent.includes(${JSON.stringify(message)})&&${preserved}`;

  await clickByPointer('[data-task-action="collapse"]');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="true"');
  await clickByPointer('[data-testid="agent-mode-chat"]');
  await until(blocked);
  assert.equal(await renderer.evaluate(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(fixture.sessionId)}`), true);
  await shot('task-unsaved-navigation-guard-zh-night');

  await clickByPointer('[data-task-action="collapse"]');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="true"');
  await clickByPointer(`[data-session-id="${otherSessionId}"] .session-row`);
  await until(blocked);
  assert.equal(await renderer.evaluate(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(fixture.sessionId)}`), true);

  const ownRow = `[data-session-id="${fixture.sessionId}"]`;
  await until(`(()=>{const s=document.querySelector(${JSON.stringify(`${ownRow} .session-row__state`)});return Boolean(s&&!s.className.includes('--running')&&!s.className.includes('--waiting_approval'))})()`);
  const hover = await renderer.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(`${ownRow} .session-row`)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await renderer.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y, button: 'none', buttons: 0 });
  await clickByPointer(`${ownRow} .session-row__menu`);
  await until('Boolean(document.querySelector(".session-menu [role=menuitem]:nth-of-type(5)"))');
  const archive = await renderer.evaluate(`(()=>{const el=document.querySelector('.session-menu [role=menuitem]:nth-of-type(5)');return{text:el.textContent.trim(),disabled:el.disabled}})()`);
  assert.deepEqual(archive, { text: '\u5f52\u6863', disabled: false });
  await clickByPointer('.session-menu [role="menuitem"]:nth-of-type(5)');
  await until(`document.querySelector('.session-sidebar__error[role="alert"]')?.textContent.includes(${JSON.stringify(message)})`);
  assert.equal(await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(fixture.sessionId)}).then(s=>s.archived)`), false);
  assert.equal(await renderer.evaluate(preserved), true);
  assert.equal(await renderer.evaluate(`document.querySelector('.session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId===${JSON.stringify(fixture.sessionId)}`), true);
  await click('.plan-edit-actions button[type="button"]:nth-of-type(2)');
  await until('!document.querySelector(".task-workbench[data-unsaved=true]")&&!document.querySelector(".task-workbench [role=alert]")');
  await clickByPointer('[data-testid="agent-mode-chat"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="chat"');
  await clickByPointer('[data-testid="agent-mode-code"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="code"');
  await selectSession(fixture.sessionId);
  assert.deepEqual(await snapshot(), baseline);
  assert.equal(requests.length, requestsBefore);
  record('Unsaved plan and dependency edits block Chat, other-session navigation and archiving the current session, reveal an alert, and allow Chat after cancellation');
}

async function compactTaskEvidence() {
  await viewport(800, 600);
  await rail('review');
  await until('document.querySelector(".app-body")?.dataset.inspectorDrawer==="true"&&Boolean(document.querySelector("[data-task-action=collapse]"))');
  const header = await renderer.evaluate(`(()=>{
    const parent=document.querySelector('.task-workbench__header').getBoundingClientRect();
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    return {parent:{left:parent.left,right:parent.right,top:parent.top,bottom:parent.bottom},
      heading:rect('.task-workbench__heading'),agents:rect('.task-workbench__agents'),collapse:rect('[data-task-action=collapse]'),
      label:document.querySelector('[data-task-action=collapse]').getAttribute('aria-label'),overflow:document.documentElement.scrollWidth>innerWidth+1};
  })()`);
  assert.equal(header.label, 'Collapse tasks');
  assert.equal(header.overflow, false);
  assert.ok(header.heading.left >= header.parent.left - 1 && header.heading.right <= header.agents.left + 1 &&
    header.agents.right <= header.collapse.left + 1 && header.collapse.right <= header.parent.right + 1 &&
    header.collapse.top >= header.parent.top - 1 && header.collapse.bottom <= header.parent.bottom + 1, JSON.stringify(header));
  await shot('task-compact-en-day');
  await clickByPointer('[data-task-action="collapse"]');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="true"');
  assert.equal(await renderer.evaluate('document.querySelector("[data-task-action=collapse]").getAttribute("aria-label")'), 'Expand tasks');
  await shot('task-compact-collapsed-en-day');
  await rail('agents');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="false"&&document.querySelector(".task-workbench")?.dataset.taskView==="agents"');
  await restoreWidePanels();
  await click('[data-task-tab="plan"]');
  record('The English 800x600 task drawer keeps its heading and collapse controls separate and allows the Agent rail to reveal it again');
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
    window.__orbitLocaleReload=true;
  })`);
  await renderer.send('Page.reload');
  await until(`window.__orbitLocaleReload===undefined&&Boolean(document.querySelector(".composer textarea"))&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}`);
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
  rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const env = {
    ...process.env,
    MSH_EXPERIMENTAL: '1',
    MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: '1',
    MSH_NOTIFICATION_FIXTURE: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(), [
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

async function writeResult(ok, cause) {
  const completedAt = Date.now();
  await mkdir(screenshots, { recursive: true });
  const path = resolve(screenshots, 'result.json');
  await writeFile(path, JSON.stringify({
    ok,
    version,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: completedAt - startedAt,
    passed,
    localRequests: requests.length,
    workerRequests: requests.filter(request => request.worker).length,
    requestCalls: requests.map(({ worker, body }) => ({
      worker,
      calls: (body.input || []).filter(item => item.type === 'function_call').map(item => item.name),
    })),
    rendererExceptions: exceptions,
    serverErrors,
    captures,
    boundaries,
    ...(cause ? {
      error: {
        message: cause instanceof Error ? cause.message : String(cause),
        stack: cause instanceof Error ? cause.stack ?? null : null,
      },
    } : {}),
  }, null, 2));
  return path;
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
  await closeWorkbenchDrawers();
  await geometry();
  await captionGeometry('zh-CN 1440x900');
  await composerGeometry('zh-CN 1440x900');
  await modelLabel(primaryModel, 'zh-CN');
  await capabilityPickerEvidence();
  await shot('empty-zh-night-1440');
  record('Orbit has its own rail, sidebar, breadcrumb header, conversation, simultaneous review/tasks and bottom status strip with non-overlapping caption and usable composer at 1440');

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
  await captionGeometry('zh-CN running 1440x900');
  await composerGeometry('zh-CN running 1440x900');
  await shot('running-zh-night-1440');
  await queuedPromptEvidence();
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
  await workspaceGeometry('zh-CN 1440x900');
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
  await until('document.querySelector(".workspace-panel")?.dataset.workspaceTab==="files"&&document.querySelector(".editor-textarea")?.value.startsWith("// Unsaved owned interface draft.")');
  assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea")?.value.startsWith("// Unsaved owned interface draft.")'), true);
  assert.equal(await renderer.evaluate('document.querySelector(".composer textarea")===window.__orbitComposer&&window.__orbitComposer.value==="\\u4e2d\\u6587\\u8349\\u7a3f Orbit structure verification"'), true);
  await renderer.evaluate('window.__orbitEditorAfterFiles=document.querySelector(".editor-textarea");true');
  await click('[data-task-action="collapse"]');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="true"');
  assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea")===window.__orbitEditorAfterFiles&&window.__orbitEditorAfterFiles.value.startsWith("// Unsaved owned interface draft.")&&document.querySelector(".composer textarea")===window.__orbitComposer&&window.__orbitComposer.value==="\\u4e2d\\u6587\\u8349\\u7a3f Orbit structure verification"'), true);
  await click('[data-task-action="collapse"]');
  await until('document.querySelector(".app-body")?.dataset.taskCollapsed==="false"');
  assert.equal(await renderer.evaluate('document.querySelector(".editor-textarea")===window.__orbitEditorAfterFiles&&window.__orbitEditorAfterFiles.value.startsWith("// Unsaved owned interface draft.")'), true);
  await fill('.editor-textarea', savedEditor);
  await fill('.composer textarea', '');
  await rail('review');
  await mode('chat');
  await click('[data-task-tab="plan"]');
  record('Layout mode switches preserve composer/editor nodes, rail navigation retains both drafts, and task collapse preserves the currently mounted editor');

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
  await taskDockEvidence(baseline);

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
  await workStarterEvidence(secondary.id, 'zh-CN');
  await planNavigationEvidence(secondary.id, baseline);
  await selectSession(fixture.sessionId);
  await click('[data-task-tab="plan"]');
  assert.deepEqual(await snapshot(), baseline);
  record('An Agent rail request belongs to its original session and does not replay into another session default plan view');

  for (const [locale, theme] of [['zh-CN', 'day'], ['en', 'night'], ['en', 'day']]) {
    await localeTheme(locale, theme);
    await viewport(1440, 900);
    await rail('review');
    await geometry();
    await captionGeometry(`${locale} ${theme} 1440x900`);
    await composerGeometry(`${locale} ${theme} 1440x900`);
    await modelLabel(primaryModel, locale);
    assert.deepEqual(await snapshot(), baseline);
    await shot(`complete-${locale}-${theme}-1440`);
  }
  record('Chinese/English and day/night show the rebuilt composition with identical saved messages, plan and model/permission settings');
  await reviewPathEvidence('en');
  record('English review accessibility exposes the selected file path and exact addition and deletion counts');
  await workStarterEvidence(secondary.id, 'en');
  await compactTaskEvidence();
  assert.deepEqual(await snapshot(), baseline);

  for (const [width, height] of [[800, 600], [1040, 680], [1280, 800], [1920, 1080], [2559, 1440]]) {
    await viewport(width, height);
    await rail('chat');
    await closeWorkbenchDrawers();
    await geometry({ dual: width >= 1440 });
    await composerGeometry(`en ${width}x${height}`);
    if (width === 800 || width === 1280) await captionGeometry(`en ${width}x${height}`);
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

  await viewport(720, 450);
  await rail('chat');
  await closeWorkbenchDrawers();
  await geometry({ dual: false });
  await captionGeometry('en day 720x450, 200% CSS equivalent for 1440x900');
  await composerGeometry('en day 720x450, 200% CSS equivalent for 1440x900');
  await shot('zoom-200pct-css-equivalent-en-day');
  record('The 720x450 CSS layout viewport equivalent to 200% scaling keeps caption controls separate and the composer editable without overlap');
  await viewport(1440, 900);
  await rail('review');
  await geometry();

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
  await agentLayoutEvidence();
  assert.deepEqual(await snapshot(), baseline);
  assert.deepEqual(exceptions, []);
  const resultPath = await writeResult(true);
  console.log(JSON.stringify({
    version, passed, localRequests: requests.length,
    workerRequests: requests.filter(request => request.worker).length,
    rendererExceptions: exceptions, captures,
    boundaries, resultPath,
  }, null, 2));
} catch (cause) {
  if (renderer) await shot('failure').catch(() => {});
  const resultPath = await writeResult(false, cause).catch(() => null);
  console.error(JSON.stringify({
    passed, exceptions, serverErrors,
    requests: requests.map(({ worker, body }) => ({ worker, calls: (body.input || []).filter(item => item.type === 'function_call').map(item => item.name) })),
    body: await renderer?.evaluate('document.body.innerText').catch(() => null),
    resultPath,
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
