import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const desktop = resolve("apps/desktop");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-run-steering-"));
const profile = join(temporary, "profile");
const project = join(temporary, "project");
const evidence = resolve(".impeccable/review", `v134-run-steering-${Date.now()}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const passed = [];
const requests = [];
const plans = [];
const screenshots = [];
const measurements = [];
const selectionChecks = [];
const errors = [];
const crashes = [];
const networkAttempts = [];
const held = new Map();
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aen8AAAAASUVORK5CYII=";
let child;
let main;
let primary;
let quick;
let rendererPort;
let serverListening = false;
let fixture;

function writeEvent(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function finish(record, text = "", output) {
  assert.ok(record && !record.response.destroyed && !record.response.writableEnded,
    `Cannot finish closed fixture response: ${record?.name}`);
  record.released = true;
  if (text) writeEvent(record.response, { type: "response.output_text.delta", delta: text });
  writeEvent(record.response, {
    type: "response.completed",
    response: {
      status: "completed",
      ...(output ? { output } : {}),
      usage: { input_tokens: 200, output_tokens: 40, total_tokens: 240 },
    },
  });
  record.response.end();
}

const server = createServer(async (request, response) => {
  response.on("error", (cause) => errors.push(`fixture response: ${String(cause)}`));
  try {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/responses");
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    if (/会话标题生成|conversation title/i.test(JSON.stringify(body))) {
      finish({ response, name: "title" }, "Steering fixture");
      return;
    }
    const plan = plans.shift();
    assert.ok(plan, `Unexpected model request: ${JSON.stringify(body.input).slice(0, 1000)}`);
    const record = { name: plan.name, body, response, released: false, closedEarly: false };
    requests.push(record);
    response.on("close", () => {
      if (!record.released) record.closedEarly = true;
    });
    if (plan.kind === "hold") {
      response.flushHeaders();
      writeEvent(response, { type: "response.output_text.delta", delta: `OPEN_${plan.name} ` });
      held.set(plan.name, record);
    } else if (plan.kind === "question") {
      finish(record, "", [{
        type: "function_call",
        name: "ask_user",
        arguments: JSON.stringify({
          question: "Choose the fixture answer before continuing.",
          header: "Fixture question",
          options: [{ label: "Proceed", description: "Continue the same run." }],
        }),
        call_id: `question-${plan.name}`,
      }]);
    } else {
      finish(record, `FINAL_${plan.name}`);
    }
  } catch (cause) {
    errors.push(`fixture server: ${cause.stack ?? String(cause)}`);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});

async function availablePort() {
  const probe = createPortServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", done);
  });
  const port = probe.address().port;
  await new Promise((done, reject) => probe.close((cause) => cause ? reject(cause) : done()));
  return port;
}

async function connect(port, surface) {
  let target;
  for (let attempt = 0; attempt < 300 && !target; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      target = targets.find((item) => {
        if (!item.webSocketDebuggerUrl) return false;
        if (surface === "main-process") return true;
        if (item.type !== "page") return false;
        const isQuick = item.url.includes("surface=quick-chat");
        return surface === "quick-chat" ? isQuick : !isQuick;
      });
    } catch {}
    if (!target) await sleep(100);
  }
  assert.ok(target, `Missing ${surface} debugger on ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") {
      errors.push(`${surface}: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
    }
    if (message.method === "Inspector.targetCrashed") crashes.push(surface);
    if (message.method === "Network.requestWillBeSent" && /^https?:/i.test(message.params.request.url)) {
      networkAttempts.push({ surface, url: message.params.request.url });
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout in ${surface}: ${method}`));
    }, 60_000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };
  await send("Runtime.enable");
  if (surface !== "main-process") {
    await send("Inspector.enable");
    await send("Network.enable");
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  }
  return {
    send,
    evaluate,
    close: () => {
      for (const waiter of pending.values()) clearTimeout(waiter.timer);
      socket.close();
    },
  };
}

async function until(client, expression, timeout = 60_000) {
  const end = Date.now() + timeout;
  let lastError;
  while (Date.now() < end) {
    try {
      if (await client.evaluate(expression)) return;
    } catch (cause) {
      lastError = cause;
    }
    await sleep(80);
  }
  throw new Error(`Timed out: ${expression}${lastError ? `\n${String(lastError)}` : ""}`);
}

async function waitFor(check, label, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function api(client, name, ...args) {
  return client.evaluate(`window.mingshen.${name}(${args.map((value) => JSON.stringify(value)).join(",")})`);
}

async function click(client, selector) {
  await until(client, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});return Boolean(e&&!e.disabled&&e.getClientRects().length)})()`);
  await client.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`);
}

async function fill(client, value) {
  await until(client, 'Boolean(document.querySelector("[data-testid=chat-composer-input]")&&!document.querySelector("[data-testid=chat-composer-input]").disabled)');
  await client.evaluate(`(()=>{
    const input=document.querySelector("[data-testid=chat-composer-input]");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(value)}}));
    input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);return true;
  })()`);
  await until(client, `document.querySelector("[data-testid=chat-composer-input]")?.value===${JSON.stringify(value)}`);
}

async function key(client, keyName, code, virtualKey, modifiers = 0, text) {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: keyName, code, windowsVirtualKeyCode: virtualKey, modifiers,
    ...(text === undefined ? {} : { text, unmodifiedText: text }),
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: keyName, code, windowsVirtualKeyCode: virtualKey, modifiers,
  });
}

async function viewport(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await client.evaluate('window.dispatchEvent(new Event("resize"));true');
  await sleep(200);
}

async function capture(client, name, session) {
  const selection = await assertSessionSelection(session, `capture:${name}`);
  await until(client, 'Boolean(document.querySelector("[data-testid=chat-steering-tray]"))');
  const result = await client.evaluate(`(()=>{
    const selectors=['[data-testid=chat-composer-input]','[data-testid=chat-steering-send]','[data-testid=chat-steering-tray]'];
    return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,
      elements:selectors.map(selector=>{const e=document.querySelector(selector);if(!e)return{selector,missing:true};
        const r=e.getBoundingClientRect();const x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
        const hit=document.elementFromPoint(x,y);
        return{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
          hit:Boolean(hit&&(e===hit||e.contains(hit)))};})};
  })()`);
  measurements.push({ name, surface: client === quick ? "quick-chat" : "main", selection, ...result });
  assert.equal(result.overflow, false, `Horizontal overflow: ${name}`);
  for (const element of result.elements) {
    assert.equal(element.missing, undefined, JSON.stringify({ name, element }));
    assert.ok(element.width > 0 && element.height > 0, JSON.stringify({ name, element }));
    assert.ok(element.left >= -1 && element.right <= result.width + 1, JSON.stringify({ name, element }));
    assert.ok(element.top >= -1 && element.bottom <= result.height + 1, JSON.stringify({ name, element }));
    assert.ok(element.hit, JSON.stringify({ name, element }));
  }
  const image = await client.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
}

async function pointer(client, selector) {
  const point = await client.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
    if(!e||e.disabled)return null;e.scrollIntoView({block:"nearest",inline:"nearest"});
    const r=e.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,hit=document.elementFromPoint(x,y);
    return{x,y,hit:Boolean(hit&&(e===hit||e.contains(hit)))};})()`);
  assert.ok(point?.hit, `Steering button is not reachable by pointer: ${JSON.stringify(point)}`);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
}

async function listen(client) {
  await client.evaluate('globalThis.__steeringEvents=[];window.mingshen.onRuntimeEvent(event=>globalThis.__steeringEvents.push(event));true');
}

async function started(client, sessionId, from) {
  const expression = `globalThis.__steeringEvents.slice(${from}).find(event=>event.type==="run_started"&&event.sessionId===${JSON.stringify(sessionId)})`;
  await until(client, `Boolean(${expression})`);
  return client.evaluate(expression);
}

async function terminal(client, runId) {
  const expression = `globalThis.__steeringEvents.find(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`;
  await until(client, `Boolean(${expression})`, 120_000);
  return client.evaluate(expression);
}

async function startHeld(client, sessionId, name) {
  plans.push({ name, kind: "hold" });
  const index = await client.evaluate("globalThis.__steeringEvents.length");
  await fill(client, `INITIAL_${name}`);
  await click(client, "[data-testid=chat-composer-send]");
  const event = await started(client, sessionId, index);
  const response = await waitFor(() => held.get(name), `open response ${name}`);
  await until(client, `globalThis.__steeringEvents.slice(${index}).some(event=>event.type==='assistant_delta'&&event.sessionId===${JSON.stringify(sessionId)}&&event.runId===${JSON.stringify(event.runId)}&&event.text.includes(${JSON.stringify(`OPEN_${name}`)}))`);
  await until(client, `window.mingshen.getRunSteering(${JSON.stringify(sessionId)}).then(state=>state?.runId===${JSON.stringify(event.runId)}&&state.accepting)`);
  await until(client, 'document.querySelector("[data-testid=chat-composer-input]")?.value===""');
  return { runId: event.runId, response, eventIndex: index };
}

async function steer(client, sessionId, runId, text, usePointer = false) {
  await fill(client, text);
  await until(client, 'Boolean(document.querySelector("[data-testid=chat-steering-send]")&&!document.querySelector("[data-testid=chat-steering-send]").disabled)');
  if (usePointer) await pointer(client, "[data-testid=chat-steering-send]");
  else await key(client, "Enter", "Enter", 13, 0, "\r");
  await until(client, `globalThis.__steeringEvents.some(event=>event.type==='run_steering_updated'&&event.sessionId===${JSON.stringify(sessionId)}&&event.state?.runId===${JSON.stringify(runId)}&&event.state.messages.some(message=>message.text===${JSON.stringify(text)}&&message.status==='pending'))`);
  await until(client, `window.mingshen.getRunSteering(${JSON.stringify(sessionId)}).then(state=>state?.runId===${JSON.stringify(runId)}&&state.messages.some(message=>message.text===${JSON.stringify(text)}&&message.status==="pending"))`);
  await until(client, `[...document.querySelectorAll('[data-testid=chat-steering-message][data-status=pending]')].some(node=>node.textContent.includes(${JSON.stringify(text)}))`);
  await until(client, 'document.querySelector("[data-testid=chat-composer-input]")?.value===""');
}

async function assertStillRunning(client, sessionId, run, expectedRequests) {
  await sleep(350);
  assert.equal(run.response.closedEarly, false, "Steering closed the active SSE response");
  assert.equal(run.response.response.destroyed, false, "Steering destroyed the active SSE response");
  assert.equal(requests.length, expectedRequests, "Steering dispatched another request before the current boundary");
  const current = await api(client, "getSessionRunState", sessionId);
  assert.equal(current?.runId, run.runId);
  assert.equal(current?.status, "running");
  const events = await client.evaluate(`globalThis.__steeringEvents.slice(${run.eventIndex})`);
  assert.equal(events.filter((event) => event.type === "run_started" && event.sessionId === sessionId).length, 1);
  assert.ok(!events.some((event) => event.runId === run.runId && ["run_completed", "run_failed", "run_interrupted"].includes(event.type)));
}

async function completeSteered(client, sessionId, run, name, text) {
  plans.push({ name: `${name}_continuation`, kind: "hold" });
  finish(run.response, `BOUNDARY_${name}`);
  const continuation = await waitFor(() => held.get(`${name}_continuation`), `${name} continuation`);
  assert.ok(JSON.stringify(continuation.body.input).includes(text), `Steering absent from next model request: ${name}`);
  assert.ok(!JSON.stringify(run.response.body.input).includes(text), `Steering appeared in the earlier request: ${name}`);
  const current = await api(client, "getSessionRunState", sessionId);
  assert.equal(current?.runId, run.runId);
  assert.equal(current?.status, "running");
  const events = await client.evaluate(`globalThis.__steeringEvents.slice(${run.eventIndex})`);
  assert.equal(events.filter((event) => event.type === "run_started" && event.sessionId === sessionId).length, 1,
    "Steering continuation must not start a new run");
  await until(client, `globalThis.__steeringEvents.some(event=>event.type==='run_steering_updated'&&event.sessionId===${JSON.stringify(sessionId)}&&event.state?.runId===${JSON.stringify(run.runId)}&&event.state.messages.some(message=>message.text===${JSON.stringify(text)}&&message.status==='delivered'))`);
  await until(client, `window.mingshen.getRunSteering(${JSON.stringify(sessionId)}).then(state=>state?.runId===${JSON.stringify(run.runId)}&&state.messages.some(message=>message.text===${JSON.stringify(text)}&&message.status==="delivered"))`);
  return continuation;
}

async function assertAnswer(client, sessionId, text) {
  await until(client, `window.mingshen.getSessionMessages(${JSON.stringify(sessionId)}).then(messages=>JSON.stringify(messages).includes(${JSON.stringify(text)}))`);
}

async function presentation(style, locale, mode) {
  await viewport(primary, 1440, 900);
  await primary.evaluate(`(async()=>{
    await window.mingshen.desktopAction("locale",${JSON.stringify(locale)});
    localStorage.setItem("mingshen.locale",${JSON.stringify(locale)});
    localStorage.setItem("mingshen.theme",${JSON.stringify(style === "simple" ? "day" : "night")});
    localStorage.setItem("mingshen.agent-mode",${JSON.stringify(mode)});
    const preferences=await window.mingshen.getUiPreferences();
    await window.mingshen.saveUiPreferences({...preferences,interfaceStyle:${JSON.stringify(style)}});
    globalThis.__steeringReload=true;return true;
  })()`);
  await primary.send("Page.reload");
  const domain = mode === "chat"
    ? 'Boolean(document.querySelector("[data-testid=agent-mode-chat][aria-pressed=true]"))'
    : 'Boolean(document.querySelector("[data-testid=agent-mode-code][aria-pressed=true],[data-testid=agent-mode-work][aria-pressed=true]"))';
  await until(primary, `globalThis.__steeringReload===undefined&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}&&${domain}`);
  await listen(primary);
}

async function assertSessionSelection(session, stage) {
  const mode = session.agentMode;
  const selected = mode === "chat"
    ? `.chat-session-row--selected[data-session-id="${session.id}"]`
    : `[data-session-id="${session.id}"] .session-row--selected`;
  await until(primary, `Boolean(document.querySelector(${JSON.stringify(selected)}))&&document.querySelector('.app-shell')?.dataset.agentMode===${JSON.stringify(mode)}&&document.querySelector('[data-testid=agent-mode-${mode}]')?.getAttribute('aria-pressed')==='true'`);
  const observed = await primary.evaluate(`(()=>({
    appMode:document.querySelector('.app-shell')?.dataset.agentMode,
    pressedModes:[...document.querySelectorAll('[data-testid=agent-mode-switcher] [aria-pressed=true]')].map(node=>node.dataset.agentMode),
    selected:Boolean(document.querySelector(${JSON.stringify(selected)}))
  }))()`);
  const stored = await api(primary, "getSession", session.id);
  assert.equal(stored?.agentMode, mode, `Persisted session mode differs at ${stage}`);
  assert.equal(observed.appMode, mode, `App mode differs at ${stage}`);
  assert.deepEqual(observed.pressedModes, [mode], `Pressed mode differs at ${stage}`);
  assert.equal(observed.selected, true, `Wrong session selected at ${stage}`);
  const check = { stage, sessionId: session.id, expectedMode: mode, sessionMode: stored.agentMode, ...observed };
  selectionChecks.push(check);
  return check;
}

async function selectSession(session) {
  const mode = session.agentMode;
  const row = mode === "chat"
    ? `[data-session-id="${session.id}"] .chat-session-row__main`
    : `[data-session-id="${session.id}"] .session-row`;
  assert.equal((await api(primary, "getSession", session.id))?.agentMode, mode,
    "Fixture session mode changed before selection");
  await primary.evaluate(`(()=>{for(const e of document.querySelectorAll('.session-group__header[aria-expanded=false],.session-group__show-all[aria-expanded=false],.chat-session-group__heading[aria-expanded=false]'))e.click();return true})()`);
  await click(primary, row);
  await assertSessionSelection(session, "select");
}

async function selectAndSize(session, width) {
  await viewport(primary, 1440, 900);
  await selectSession(session);
  await viewport(primary, width, 900);
  for (let count = 0; count < 3; count++) {
    const closed = await primary.evaluate(`(()=>{const e=document.querySelector('.workbench-drawer-scrim');if(!e)return false;e.click();return true})()`);
    if (!closed) break;
    await sleep(180);
  }
}

async function acceptPolicies() {
  await until(primary, 'Boolean(document.querySelector(".policy-consents,.app-shell,.setup-shell"))');
  if (!(await primary.evaluate('Boolean(document.querySelector(".policy-consents"))'))) return;
  await primary.evaluate('document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true');
  for (const text of ["同意并继续", "开始使用"]) {
    const selector = `[...document.querySelectorAll('.policy-dialog button')].find(button=>!button.disabled&&button.textContent.trim()===${JSON.stringify(text)})`;
    await until(primary, `Boolean(${selector})`);
    await primary.evaluate(`${selector}.click();true`);
  }
  await until(primary, '!document.querySelector(".policy-dialog")');
}

async function rejectedDraftAndControls(session, run) {
  const text = "REJECTED_STEERING_DRAFT";
  await fill(primary, text);
  await until(primary, `window.mingshen.getComposerDraft(${JSON.stringify(session.id)}).then(draft=>draft?.text===${JSON.stringify(text)})`);
  await main.evaluate(`(()=>{const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    const handlers=electron.ipcMain._invokeHandlers;
    globalThis.__steeringOriginalHandler=handlers.get('chat:steering-send');
    if(!globalThis.__steeringOriginalHandler)throw new Error('Missing steering IPC handler');
    handlers.set('chat:steering-send',()=>{throw new Error('STEERING_FIXTURE_REJECTED')});return true;})()`);
  try {
    await click(primary, "[data-testid=chat-steering-send]");
    await until(primary, 'document.body.innerText.includes("STEERING_FIXTURE_REJECTED")');
    assert.equal(await primary.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), text);
    assert.equal((await api(primary, "getComposerDraft", session.id)).text, text);
    assert.equal((await api(primary, "getRunSteering", session.id)).messages.length, 0);
  } finally {
    await main.evaluate(`(()=>{const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');electron.ipcMain._invokeHandlers.set('chat:steering-send',globalThis.__steeringOriginalHandler);return true})()`);
  }
  const draftBeforeStale = await api(primary, "getComposerDraft", session.id);
  const staleRejected = await primary.evaluate(`(async()=>{try{
    await window.mingshen.steerRun({sessionId:${JSON.stringify(session.id)},runId:'00000000-0000-4000-8000-000000000001',requestId:'00000000-0000-4000-8000-000000000002',text:${JSON.stringify(text)},draftRevision:${JSON.stringify(draftBeforeStale.revision)}});
    return false;
  }catch{return true}})()`);
  assert.equal(staleRejected, true, "A stale run id must be rejected");
  assert.deepEqual(await api(primary, "getComposerDraft", session.id), draftBeforeStale);
  assert.equal((await api(primary, "getRunSteering", session.id)).messages.length, 0);

  await primary.evaluate(`(()=>{const target=document.querySelector('[data-testid=chat-composer-input]');
    const bytes=Uint8Array.from(atob(${JSON.stringify(pngBase64)}),value=>value.charCodeAt(0));
    const data=new DataTransfer();data.items.add(new File([bytes],'steering-fixture.png',{type:'image/png'}));
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});target.dispatchEvent(event);
    if(!event.defaultPrevented)throw new Error('Image attachment paste was not handled');return true;})()`);
  await until(primary, 'document.querySelectorAll(".draft-attachment").length===1');
  await until(primary, `window.mingshen.getComposerDraft(${JSON.stringify(session.id)}).then(draft=>draft?.attachments.length===1)`);
  const attachmentButton = await primary.evaluate(`(()=>{const e=document.querySelector('[data-testid=chat-steering-send]');return{disabled:e?.disabled,title:e?.title??''}})()`);
  assert.equal(attachmentButton.disabled, true);
  assert.match(attachmentButton.title, /附件|attachment/i, "Disabled steering must explain the attachment restriction");
  const withAttachment = await api(primary, "getComposerDraft", session.id);
  assert.equal(withAttachment.text, text);
  assert.match(withAttachment.attachments[0].name, /^clipboard-[0-9a-f-]+\.png$/i);
  assert.equal(withAttachment.attachments[0].mimeType, "image/png");
  assert.equal(withAttachment.attachments[0].dataUrl, `data:image/png;base64,${pngBase64}`);
  await fill(primary, text);
  await key(primary, "Enter", "Enter", 13, 0, "\r");
  await sleep(250);
  assert.equal((await api(primary, "getRunSteering", session.id)).messages.length, 0);
  assert.equal(await primary.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), text);
  assert.equal((await api(primary, "getComposerDraft", session.id)).attachments[0].dataUrl, withAttachment.attachments[0].dataUrl);
  await primary.evaluate('document.querySelector(".draft-attachment button").click();true');
  await until(primary, 'document.querySelectorAll(".draft-attachment").length===0');

  if (!(await primary.evaluate('Boolean(document.querySelector("[data-testid=temporary-instruction-input]"))'))) {
    await click(primary, '[data-testid=composer-temporary-instruction-trigger]');
  }
  await until(primary, 'Boolean(document.querySelector("[data-testid=temporary-instruction-input]"))');
  await primary.evaluate(`(()=>{const e=document.querySelector('[data-testid=temporary-instruction-input]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'INSTRUCTION_RETAINED');
    e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'INSTRUCTION_RETAINED'}));return true})()`);
  await until(primary, 'document.querySelector("[data-testid=composer-temporary-instruction-trigger]")?.dataset.active==="true"');
  const instructionButton = await primary.evaluate(`(()=>{const e=document.querySelector('[data-testid=chat-steering-send]');return{disabled:e?.disabled,title:e?.title??''}})()`);
  assert.equal(instructionButton.disabled, true);
  assert.match(instructionButton.title, /临时指令|instruction/i, "Disabled steering must explain the temporary-instruction restriction");
  assert.equal(await primary.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), text);
  await fill(primary, text);
  await key(primary, "Enter", "Enter", 13, 0, "\r");
  await sleep(250);
  assert.equal((await api(primary, "getRunSteering", session.id)).messages.length, 0);
  assert.equal(await primary.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), text);
  assert.equal(await primary.evaluate('document.querySelector("[data-testid=composer-temporary-instruction-trigger]")?.dataset.active'), "true");
  if (!(await primary.evaluate('Boolean(document.querySelector("[data-testid=temporary-instruction-input]"))'))) {
    await click(primary, '[data-testid=composer-temporary-instruction-trigger]');
  }
  await until(primary, 'Boolean(document.querySelector("[data-testid=temporary-instruction-input]"))');
  assert.equal(await primary.evaluate('document.querySelector("[data-testid=temporary-instruction-input]").value'), "INSTRUCTION_RETAINED");
  await primary.evaluate(`(()=>{const e=document.querySelector('[data-testid=temporary-instruction-input]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'');
    e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward'}));return true})()`);
  await primary.evaluate('document.querySelector("[data-testid=composer-temporary-instruction-trigger]").click();true');
  await until(primary, 'document.querySelector("[data-testid=composer-temporary-instruction-trigger]")?.dataset.active==="false"');
  assert.equal(run.response.closedEarly, false);
  passed.push("Rejected and stale steering preserve the persisted text; attachments and one-shot instructions disable both button and Enter without consuming the draft");
}

async function keyboardChecks(session, run) {
  const text = "IME_AND_SHIFT_STEERING";
  await fill(primary, text);
  await primary.evaluate(`(()=>{const input=document.querySelector('[data-testid=chat-composer-input]');
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,isComposing:true,keyCode:229}));return true})()`);
  await sleep(200);
  assert.equal((await api(primary, "getRunSteering", session.id)).messages.length, 0);
  assert.equal(await primary.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), text);
  await primary.evaluate(`(()=>{const input=document.querySelector('[data-testid=chat-composer-input]');
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,isComposing:false,keyCode:229}));return true})()`);
  await sleep(200);
  assert.equal((await api(primary, "getRunSteering", session.id)).messages.length, 0);
  assert.equal(await primary.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), text);
  await key(primary, "Enter", "Enter", 13, 8, "\r");
  await until(primary, `document.querySelector('[data-testid=chat-composer-input]')?.value===${JSON.stringify(`${text}\n`)}`);
  assert.equal((await api(primary, "getRunSteering", session.id)).messages.length, 0);
  await fill(primary, text);
  await key(primary, "Enter", "Enter", 13, 0, "\r");
  await until(primary, `window.mingshen.getRunSteering(${JSON.stringify(session.id)}).then(state=>state?.runId===${JSON.stringify(run.runId)}&&state.messages.some(message=>message.text===${JSON.stringify(text)}&&message.status==='pending'))`);
  await until(primary, 'document.querySelector("[data-testid=chat-composer-input]")?.value===""');
  passed.push("Composing and keyCode-229 Enter and Shift+Enter do not steer; ordinary Enter submits the text to the active run");
  return text;
}

async function close() {
  if (!child) return;
  const current = child;
  const ended = current.exitCode !== null || current.signalCode !== null
    ? Promise.resolve() : new Promise((done) => current.once("exit", done));
  await primary?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true').catch(() => {});
  quick?.close(); primary?.close(); main?.close();
  await Promise.race([ended, sleep(20_000)]);
  if (current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(5_000)]);
  }
  assert.ok(current.exitCode !== null || current.signalCode !== null, "Owned Electron did not exit");
  child = main = primary = quick = undefined;
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  serverListening = true;
  execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], { windowsHide: true, stdio: "pipe" });
  const mainPort = await availablePort();
  rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
  const environment = { ...process.env, MSH_EXPERIMENTAL: "1", MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: "1", MSH_NOTIFICATION_FIXTURE: "1" };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(), [`--inspect=${mainPort}`, ".", `--remote-debugging-port=${rendererPort}`], {
    cwd: desktop, env: environment, windowsHide: true, stdio: "ignore",
  });
  main = await connect(mainPort, "main-process");
  const fixturePort = server.address().port;
  await main.evaluate(`(()=>{globalThis.__steeringFetch=fetch;globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'?input:input.url??String(input));
    if(url.hostname==='127.0.0.1'&&url.port===${JSON.stringify(String(fixturePort))})return globalThis.__steeringFetch(input,options);
    if(url.pathname.includes('/rest/v1/rpc/'))return Promise.resolve(Response.json([]));
    return Promise.reject(new Error('Nonlocal steering fixture network blocked'));};return true})()`);
  primary = await connect(rendererPort, "main");
  await main.evaluate(`(()=>{const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    const owner=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('index.html'));
    if(!owner)throw new Error('Missing owned fixture window');
    owner.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{
      const url=new URL(details.url);callback({cancel:!(url.hostname==='127.0.0.1'&&url.port===${JSON.stringify(String(fixturePort))})});
    });return true})()`);
  await acceptPolicies();
  fixture = await primary.evaluate(`(async()=>{
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const saver=await window.mingshen.getTokenSaver();await window.mingshen.setTokenSaver({...saver.settings,enabled:false});
    await window.mingshen.configureCompletionNotifications({nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false});
    const provider=await window.mingshen.createProvider({name:'Steering local fixture',baseUrl:${JSON.stringify(`http://127.0.0.1:${fixturePort}/v1`)},protocol:'openai_responses',authMode:'bearer',apiKey:'synthetic-steering-fixture-only',keyLabel:'Fixture',neverReveal:true});
    const configured=await window.mingshen.createModel({providerId:provider.id,modelId:'steering-fixture',displayName:'Steering fixture',contextWindow:128000,maxOutputTokens:4096,inputModalities:['text','image','file'],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    const common={providerId:provider.id,modelId:configured.models[0].id,agentProfileId:'primary',reasoningLevel:null,executionMode:'host',patchOnly:false};
    const code=await window.mingshen.createSession({...common,title:'Steering Code',agentMode:'code',workspacePath:${JSON.stringify(project)},permissionMode:'full_access'});
    const work=await window.mingshen.createSession({...common,title:'Steering Work',agentMode:'work',workspacePath:${JSON.stringify(project)},permissionMode:'full_access'});
    const chat=await window.mingshen.createSession({...common,title:'Steering Chat',agentMode:'chat',workspacePath:null,permissionMode:'request_approval'});
    await window.mingshen.setProjectTrust(${JSON.stringify(project)},true);
    await window.mingshen.setProjectMemoryEnabled(code.id,false);await window.mingshen.setProjectMemoryEnabled(work.id,false);
    return{code,work,chat};
  })()`);
  for (const mode of ["code", "work", "chat"]) {
    assert.equal(fixture[mode].agentMode, mode, `Fixture was not created in ${mode} mode`);
  }

  await presentation("simple", "zh-CN", "code");
  await selectAndSize(fixture.code, 1440);
  const initial = await startHeld(primary, fixture.code.id, "QUEUE_ORDER");
  await fill(primary, "QUEUED_AFTER_STEERING");
  await click(primary, "[data-testid=chat-queue-add]");
  await until(primary, `window.mingshen.listQueuedPrompts(${JSON.stringify(fixture.code.id)}).then(items=>items.length===1&&items[0].text==='QUEUED_AFTER_STEERING')`);
  await rejectedDraftAndControls(fixture.code, initial);
  const initialRequestCount = requests.length;
  const steeringText = await keyboardChecks(fixture.code, initial);
  await assertStillRunning(primary, fixture.code.id, initial, initialRequestCount);
  await capture(primary, "simple-code-zh-wide-pending", fixture.code);
  const continuation = await completeSteered(primary, fixture.code.id, initial, "QUEUE_ORDER", steeringText);
  assert.equal((await api(primary, "listQueuedPrompts", fixture.code.id)).length, 1);
  assert.equal(requests.length, initialRequestCount + 1, "Queue dispatched while steering continuation was still open");
  assert.ok(!JSON.stringify(continuation.body.input).includes("QUEUED_AFTER_STEERING"));
  const queueEventIndex = await primary.evaluate("globalThis.__steeringEvents.length");
  plans.push({ name: "QUEUE_AUTOMATIC", kind: "hold" });
  finish(continuation, "STEERED_RUN_COMPLETE");
  assert.equal((await terminal(primary, initial.runId)).type, "run_completed");
  await assertAnswer(primary, fixture.code.id, "STEERED_RUN_COMPLETE");
  const queueStart = await started(primary, fixture.code.id, queueEventIndex);
  assert.notEqual(queueStart.runId, initial.runId);
  const queueResponse = await waitFor(() => held.get("QUEUE_AUTOMATIC"), "automatic queued request");
  assert.ok(JSON.stringify(queueResponse.body.input).includes("QUEUED_AFTER_STEERING"));
  finish(queueResponse, "QUEUE_COMPLETE");
  assert.equal((await terminal(primary, queueStart.runId)).type, "run_completed");
  await assertAnswer(primary, fixture.code.id, "QUEUE_COMPLETE");
  await until(primary, `window.mingshen.listQueuedPrompts(${JSON.stringify(fixture.code.id)}).then(items=>items.length===0)`);
  passed.push("Live SSE remains open, steering reaches the next request in the same run, and the pre-existing FIFO item starts only afterward in a new run");

  for (const scenario of [
    { style: "simple", locale: "en", mode: "chat", width: 800 },
    { style: "orbit", locale: "en", mode: "work", width: 800 },
    { style: "orbit", locale: "zh-CN", mode: "code", width: 1440 },
    { style: "orbit", locale: "en", mode: "chat", width: 1440 },
    { style: "simple", locale: "zh-CN", mode: "work", width: 1440 },
  ]) {
    const { style, locale, mode, width } = scenario;
    await presentation(style, locale, mode);
    await selectAndSize(fixture[mode], width);
    const name = `${style}_${locale}_${mode}_${width}`;
    const run = await startHeld(primary, fixture[mode].id, name);
    const count = requests.length;
    const text = `STEER_${name}`;
    await steer(primary, fixture[mode].id, run.runId, text, true);
    await assertStillRunning(primary, fixture[mode].id, run, count);
    await capture(primary, name, fixture[mode]);
    const next = await completeSteered(primary, fixture[mode].id, run, name, text);
    finish(next, `COMPLETE_${name}`);
    assert.equal((await terminal(primary, run.runId)).type, "run_completed");
    await assertAnswer(primary, fixture[mode].id, `COMPLETE_${name}`);
    passed.push(`${name}: pointer steering preserves the run and reaches its next model request`);
  }

  await presentation("simple", "zh-CN", "code");
  await selectAndSize(fixture.code, 1440);
  const toolEventIndex = await primary.evaluate("globalThis.__steeringEvents.length");
  plans.push({ name: "TOOL_WAIT", kind: "question" });
  await fill(primary, "INITIAL_TOOL_WAIT");
  await click(primary, "[data-testid=chat-composer-send]");
  const toolStarted = await started(primary, fixture.code.id, toolEventIndex);
  await until(primary, 'Boolean(document.querySelector(".question-panel"))');
  const beforeToolSteer = requests.length;
  await steer(primary, fixture.code.id, toolStarted.runId, "STEER_DURING_QUESTION", true);
  await sleep(350);
  assert.equal(requests.length, beforeToolSteer, "A pending tool was interrupted for steering");
  assert.equal(await primary.evaluate('Boolean(document.querySelector(".question-panel"))'), true);
  assert.equal((await api(primary, "getSessionRunState", fixture.code.id)).runId, toolStarted.runId);
  plans.push({ name: "TOOL_CONTINUATION", kind: "hold" });
  await click(primary, '.question-option input[value="Proceed"]');
  await click(primary, '.question-panel button[type=submit]');
  const toolContinuation = await waitFor(() => held.get("TOOL_CONTINUATION"), "question tool continuation");
  assert.ok(JSON.stringify(toolContinuation.body.input).includes("STEER_DURING_QUESTION"));
  assert.ok(JSON.stringify(toolContinuation.body.input).includes("question-TOOL_WAIT"), "Tool result is missing from the continuation");
  assert.equal((await api(primary, "getSessionRunState", fixture.code.id)).runId, toolStarted.runId);
  finish(toolContinuation, "QUESTION_AND_STEERING_COMPLETE");
  assert.equal((await terminal(primary, toolStarted.runId)).type, "run_completed");
  await assertAnswer(primary, fixture.code.id, "QUESTION_AND_STEERING_COMPLETE");
  passed.push("Steering during a real ask_user tool wait leaves the question pending and appears only after its answer on the same run");

  await presentation("simple", "en", "chat");
  await selectAndSize(fixture.chat, 800);
  const stoppedRun = await startHeld(primary, fixture.chat.id, "STOP_PENDING");
  await steer(primary, fixture.chat.id, stoppedRun.runId, "STOPPED_UNAPPLIED_TEXT", true);
  const beforeStop = requests.length;
  await assertStillRunning(primary, fixture.chat.id, stoppedRun, beforeStop);
  await click(primary, "[data-testid=chat-composer-stop]");
  assert.equal((await terminal(primary, stoppedRun.runId)).type, "run_interrupted");
  await until(primary, `globalThis.__steeringEvents.some(event=>event.type==='run_steering_updated'&&event.sessionId===${JSON.stringify(fixture.chat.id)}&&event.state?.runId===${JSON.stringify(stoppedRun.runId)}&&event.state.messages.some(message=>message.text==='STOPPED_UNAPPLIED_TEXT'&&message.status==='unapplied'))`);
  await until(primary, `window.mingshen.getRunSteering(${JSON.stringify(fixture.chat.id)}).then(state=>state?.runId===${JSON.stringify(stoppedRun.runId)}&&!state.accepting&&state.messages.some(message=>message.text==='STOPPED_UNAPPLIED_TEXT'&&message.status==='unapplied'))`);
  await until(primary, `[...document.querySelectorAll('[data-testid=chat-steering-message][data-status=unapplied]')].some(node=>node.textContent.includes('STOPPED_UNAPPLIED_TEXT'))`);
  await waitFor(() => stoppedRun.response.closedEarly, "provider connection to close after explicit stop");
  await sleep(300);
  assert.equal(requests.length, beforeStop, "Stopping must not send pending steering to another request");
  await primary.send("Page.reload");
  await until(primary, 'Boolean(document.querySelector("[data-testid=agent-mode-chat]"))');
  await selectAndSize(fixture.chat, 800);
  await until(primary, `[...document.querySelectorAll('[data-testid=chat-steering-message][data-status=unapplied]')].some(node=>node.textContent.includes('STOPPED_UNAPPLIED_TEXT'))`);
  passed.push("Stopping marks undelivered steering unapplied, retains it after renderer reload, and makes no continuation request");

  await presentation("orbit", "en", "chat");
  const quickState = await api(primary, "quickChatAction", "show");
  assert.ok(quickState?.session);
  quick = await connect(rendererPort, "quick-chat");
  await listen(quick);
  await until(quick, 'Boolean(document.querySelector(".quick-chat [data-testid=chat-composer-input]"))');
  await api(quick, "quickChatAction", "open-main");
  await until(primary, `Boolean(document.querySelector(${JSON.stringify(`.chat-session-row--selected[data-session-id="${quickState.session.id}"]`)}))`);
  const reopenedQuick = await api(primary, "quickChatAction", "show");
  assert.equal(reopenedQuick?.session?.id, quickState.session.id);
  await viewport(quick, 400, 680);
  const quickRun = await startHeld(quick, quickState.session.id, "QUICK_CHAT");
  const quickCount = requests.length;
  const quickSteering = "QUICK_CHAT_STEERING";
  const newerQuickDraft = "QUICK_CHAT_NEWER_DRAFT";
  await fill(quick, quickSteering);
  await until(quick, `window.mingshen.getComposerDraft(${JSON.stringify(quickState.session.id)}).then(draft=>draft?.text===${JSON.stringify(quickSteering)})`);
  const submittedQuickDraft = await api(quick, "getComposerDraft", quickState.session.id);
  await until(primary, `document.querySelector('[data-testid=chat-composer-input]')?.value===${JSON.stringify(quickSteering)}`);
  await main.evaluate(`(()=>{
    const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    const handlers=electron.ipcMain._invokeHandlers;
    const original=handlers.get('chat:steering-send');
    if(!original)throw new Error('Missing steering IPC handler');
    globalThis.__steeringLateOriginal=original;
    globalThis.__steeringLateAccepted=false;globalThis.__steeringLateReturned=false;
    globalThis.__steeringLateCancelled=false;globalThis.__steeringLateRelease=null;
    handlers.set('chat:steering-send',async(...args)=>{
      const value=await original(...args);
      globalThis.__steeringLateAccepted=true;
      if(!globalThis.__steeringLateCancelled)await new Promise(done=>{
        const timer=setTimeout(release,180000);
        function release(){clearTimeout(timer);done()}
        globalThis.__steeringLateRelease=release;
      });
      globalThis.__steeringLateReturned=true;return value;
    });return true;
  })()`);
  try {
    await pointer(quick, "[data-testid=chat-steering-send]");
    await until(main, 'globalThis.__steeringLateAccepted===true');
    const consumed = `globalThis.__steeringEvents.some(event=>event.type==='composer_draft_consumed'&&event.sessionId===${JSON.stringify(quickState.session.id)}&&event.revision===${JSON.stringify(submittedQuickDraft.revision)})`;
    await until(primary, consumed);
    await until(quick, consumed);
    await until(primary, 'document.querySelector("[data-testid=chat-composer-input]")?.value===""');
    await until(quick, 'document.querySelector("[data-testid=chat-composer-input]")?.value===""');
    const clearedQuickDraft = await api(primary, "getComposerDraft", quickState.session.id);
    assert.ok(!clearedQuickDraft || (!clearedQuickDraft.text && clearedQuickDraft.attachments.length === 0));
    await until(quick, `[...document.querySelectorAll('[data-testid=chat-steering-message][data-status=pending]')].some(node=>node.textContent.includes(${JSON.stringify(quickSteering)}))`);
    assert.equal(await main.evaluate('globalThis.__steeringLateReturned'), false, "Steering receipt returned before the newer draft was saved");

    await fill(primary, newerQuickDraft);
    await until(primary, `window.mingshen.getComposerDraft(${JSON.stringify(quickState.session.id)}).then(draft=>draft?.text===${JSON.stringify(newerQuickDraft)})`);
    const newer = await api(primary, "getComposerDraft", quickState.session.id);
    assert.notEqual(newer.revision, submittedQuickDraft.revision);
    await until(quick, `document.querySelector('[data-testid=chat-composer-input]')?.value===${JSON.stringify(newerQuickDraft)}`);
    assert.equal(await main.evaluate('globalThis.__steeringLateReturned'), false, "Steering receipt was not held until both windows saw the newer draft");
    await main.evaluate('globalThis.__steeringLateRelease();true');
    await until(main, 'globalThis.__steeringLateReturned===true');
    await until(quick, `document.querySelector('[data-testid=chat-composer-input]')?.value===${JSON.stringify(newerQuickDraft)}&&!document.querySelector('[data-testid=chat-steering-send]')?.disabled`);
    assert.equal(await primary.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), newerQuickDraft);
    const retained = await api(primary, "getComposerDraft", quickState.session.id);
    assert.equal(retained?.text, newerQuickDraft);
    assert.equal(retained?.revision, newer.revision);
  } finally {
    await main.evaluate(`(()=>{
      globalThis.__steeringLateCancelled=true;globalThis.__steeringLateRelease?.();
      const electron=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
      electron.ipcMain._invokeHandlers.set('chat:steering-send',globalThis.__steeringLateOriginal);return true;
    })()`);
  }
  await assertStillRunning(quick, quickState.session.id, quickRun, quickCount);
  assert.equal(quickState.session.agentMode, "chat");
  await capture(quick, "orbit-quick-en-narrow", quickState.session);
  const quickContinuation = await completeSteered(quick, quickState.session.id, quickRun, "QUICK_CHAT", quickSteering);
  const foreignDenied = await quick.evaluate(`(async()=>{try{await window.mingshen.getRunSteering(${JSON.stringify(fixture.code.id)});return false}catch{return true}})()`);
  assert.equal(foreignDenied, true, "Quick Chat must reject another session's steering state");
  finish(quickContinuation, "QUICK_CHAT_STEERING_COMPLETE");
  assert.equal((await terminal(quick, quickRun.runId)).type, "run_completed");
  await assertAnswer(quick, quickState.session.id, "QUICK_CHAT_STEERING_COMPLETE");
  passed.push("Quick Chat steers its current conversation without interrupting the run and cannot inspect another session's steering state");
  passed.push("Both windows consume the submitted steering draft, and a delayed Quick Chat receipt preserves a newer draft saved in the main window");
  await api(primary, "quickChatAction", "hide");

  assert.equal(plans.length, 0, "Unused fixture response plans");
  assert.deepEqual(errors, []);
  assert.deepEqual(crashes, []);
  assert.deepEqual(networkAttempts, []);
  assert.equal((await api(primary, "getAppInfo")).version, "1.3.4");
  const result = { ok: true, passed, screenshots, measurements, selectionChecks, errors, crashes, networkAttempts,
    requests: requests.map((record) => ({ name: record.name, closedEarly: record.closedEarly, released: record.released })),
    boundaries: ["Only an isolated temporary Electron profile, temporary workspace and synthetic local Responses provider are used.",
      "IME is emulated and pointer input is Chromium CDP, not native Windows IME or a complete DPI/accessibility matrix.",
      "ask_user is a real waiting tool; no external provider, user database, paid model or installer is exercised."] };
  await writeFile(join(evidence, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (cause) {
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "failure.json"), `${JSON.stringify({ passed, errors, crashes, screenshots, measurements, selectionChecks, networkAttempts,
    requests: requests.map((record) => ({ name: record.name, closedEarly: record.closedEarly, released: record.released })),
    plans, failure: String(cause.stack ?? cause) }, null, 2)}\n`);
  throw cause;
} finally {
  for (const record of held.values()) {
    if (!record.released && !record.response.destroyed) {
      record.released = true;
      record.response.destroy();
    }
  }
  let closeFailure;
  try { await close(); } catch (cause) { closeFailure = cause; }
  if (serverListening) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  const local = relative(resolve(tmpdir()), temporary);
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local) && local.startsWith("mingshen-run-steering-"),
    "Refusing to remove a directory outside this fixture's OS temporary root");
  if (closeFailure) throw closeFailure;
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
