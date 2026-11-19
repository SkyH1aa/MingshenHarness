import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const desktop = resolve("apps/desktop");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-queued-prompt-"));
const project = join(temporary, "project");
const profile = join(temporary, "profile");
const evidence = resolve(
  ".impeccable/review",
  `v133-queued-prompts-${Date.now()}`,
);
const MAIN_INSPECT_PORT = 9492;
const RENDERER_DEBUG_PORT = 9491;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function debugPortInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1_000, () => finish(false));
  });
}

async function assertDebugPortsAvailable() {
  for (const port of [MAIN_INSPECT_PORT, RENDERER_DEBUG_PORT]) {
    if (await debugPortInUse(port)) {
      throw new Error(
        `Debug port ${port} is already in use; refusing to attach to another Electron instance.`,
      );
    }
  }
}

const passed = [];
const errors = [];
const requests = [];
const screenshots = [];
const expectedDenials = [];
const queueEvidence = {};

let child;
let mainInspector;
let renderer;
let quickRenderer;
let holdEnabled = false;
let intentionallyFailingTextPrefix = null;
let nextSteps = [];
let nextStepIndex = 0;
const heldRequests = [];

function finish(response, text = "", output) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  if (text) {
    for (let offset = 0; offset < text.length; offset += 180) {
      response.write(
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: text.slice(offset, offset + 180),
        })}\n\n`,
      );
    }
  }
  response.end(
    `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        status: "completed",
        ...(output ? { output } : {}),
        usage: {
          input_tokens: 2_000,
          output_tokens: 300,
          total_tokens: 2_300,
        },
      },
    })}\n\n`,
  );
}

function newestUserParts(body) {
  const input = Array.isArray(body.input) ? body.input : [];
  const userItems = input.filter((item) => item?.role === "user");
  const promptItems = userItems.filter((item) => {
    const parts =
      typeof item.content === "string"
        ? [{ type: "input_text", text: item.content }]
        : Array.isArray(item.content)
          ? item.content
          : [];
    const textParts = parts.filter((part) => part?.type === "input_text");
    return !(
      textParts.length > 0 &&
      textParts.every(
        (part) =>
          typeof part.text === "string" &&
          (part.text.startsWith("[HOST_CONTEXT ") || part.text.trim() === ""),
      )
    );
  });
  const content = (promptItems.at(-1) ?? userItems.at(-1))?.content;
  if (typeof content === "string") return [{ type: "input_text", text: content }];
  return Array.isArray(content) ? content : [];
}

function newestUserText(body) {
  return newestUserParts(body)
    .filter((part) => part?.type === "input_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function newestInputFiles(body) {
  return newestUserParts(body).filter(
    (part) => part?.type === "input_file" && typeof part.file_data === "string",
  );
}

const server = createServer(async (request, response) => {
  response.on("error", () => undefined);
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const serialized = JSON.stringify(body);
    if (/会话标题生成|conversation title/i.test(serialized)) {
      finish(response, "Queued prompt verification");
      return;
    }

    requests.push(body);
    if (
      intentionallyFailingTextPrefix &&
      newestUserText(body).startsWith(intentionallyFailingTextPrefix)
    ) {
      intentionallyFailingTextPrefix = null;
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "QUEUE_INTENTIONAL_500",
            type: "server_error",
          },
        }),
      );
      return;
    }
    if (holdEnabled) {
      heldRequests.push({ body, response });
      return;
    }

    const step = nextSteps[nextStepIndex++];
    if (step) {
      finish(response, "", [
        {
          type: "function_call",
          name: step.name,
          arguments: JSON.stringify(step.args ?? {}),
          call_id: step.callId ?? `queued-prompt-${requests.length}`,
        },
      ]);
      return;
    }
    finish(response, "QUEUED_PROMPT_FIXTURE_COMPLETE");
  } catch (error) {
    errors.push(`Fixture server: ${String(error)}`);
    response.destroy();
  }
});

async function connectTarget(target, label) {
  assert.ok(target?.webSocketDebuggerUrl, `Missing debugger socket for ${label}`);
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
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text ??
          `Runtime exception in ${label}`,
      );
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.done(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout in ${label}: ${method}`));
      }, 60_000);
      pending.set(id, { done, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          `Evaluation failed in ${label}`,
      );
    }
    return result.result.value;
  };
  await send("Runtime.enable");
  return { send, evaluate, close: () => socket.close() };
}

async function debuggerTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  assert.ok(response.ok, `Debugger target list failed on ${port}`);
  return response.json();
}

async function connectMainInspector(timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const target = (await debuggerTargets(MAIN_INSPECT_PORT)).find(
        (entry) => entry.webSocketDebuggerUrl,
      );
      if (target) return connectTarget(target, "main-process");
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Main process inspector did not start: ${String(lastError ?? "timeout")}`);
}

async function connectPage(surface = "main", timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = (await debuggerTargets(RENDERER_DEBUG_PORT)).filter(
        (target) => target.type === "page" && target.webSocketDebuggerUrl,
      );
      for (const target of targets) {
        const client = await connectTarget(target, `renderer:${surface}`);
        let matched = false;
        try {
          const actual =
            (await client.evaluate(
              'new URL(location.href).searchParams.get("surface") ?? "main"',
            )) ?? "main";
          if (actual === surface) {
            matched = true;
            return client;
          }
        } finally {
          if (!matched) client.close();
        }
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Cannot connect ${surface} renderer: ${String(lastError ?? "timeout")}`);
}

async function untilOn(client, expression, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(expression)) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(80);
  }
  throw new Error(
    `Timed out: ${expression}${lastError ? `\nLast evaluation error: ${String(lastError)}` : ""}`,
  );
}

async function until(expression, timeout = 30_000) {
  return untilOn(renderer, expression, timeout);
}

function api(name, ...args) {
  return renderer.evaluate(
    `window.mingshen.${name}(${args.map((value) => JSON.stringify(value) ?? "undefined").join(",")})`,
  );
}

async function expectRejected(name, args, pattern) {
  const message = await renderer.evaluate(`(async()=>{
    try{
      await window.mingshen.${name}(${args.map((value) => JSON.stringify(value) ?? "undefined").join(",")});
      return "__RESOLVED__";
    }catch(error){
      return String(error?.message??error);
    }
  })()`);
  assert.notEqual(message, "__RESOLVED__", `${name} unexpectedly resolved`);
  if (pattern) assert.match(message, pattern, `${name}: ${message}`);
  return message;
}

async function expectQuickRejected(name, args, pattern) {
  const message = await quickRenderer.evaluate(`(async()=>{
    try{
      await window.mingshen.${name}(${args.map((value) => JSON.stringify(value) ?? "undefined").join(",")});
      return "__RESOLVED__";
    }catch(error){
      return String(error?.message??error);
    }
  })()`);
  assert.notEqual(message, "__RESOLVED__", `Quick Chat unexpectedly allowed ${name}`);
  if (pattern) assert.match(message, pattern, `${name}: ${message}`);
  expectedDenials.push({ surface: "quick-chat", api: name, message });
}

async function fillComposer(value) {
  const selector = 'textarea[aria-label="消息输入框"]';
  await until(
    `Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`,
  );
  await renderer.evaluate(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(value)}}));
    input.focus();
    return true;
  })()`);
  await until(
    `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`,
  );
}

async function click(selector) {
  await until(
    `Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`,
  );
  await renderer.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).click();true`,
  );
}

async function completeFirstRun() {
  await until(
    'Boolean(document.querySelector(".policy-consents, .app-shell, .setup-shell"))',
    60_000,
  );
  if (await renderer.evaluate('Boolean(document.querySelector(".policy-consents"))')) {
    await renderer.evaluate(
      'document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true',
    );
    for (const text of ["同意并继续", "开始使用"]) {
      const button = `[...document.querySelectorAll(".policy-dialog button")].find(button=>!button.disabled&&button.textContent.trim()===${JSON.stringify(text)})`;
      await until(`Boolean(${button})`);
      await renderer.evaluate(`${button}.click();true`);
    }
    await until('!document.querySelector(".policy-dialog")');
  }
  await until('Boolean(document.querySelector(".app-shell, .setup-shell"))', 60_000);
}

async function installRuntimeListener() {
  await renderer.evaluate(
    "globalThis.__queuedPromptEvents=[];window.mingshen.onRuntimeEvent(event=>globalThis.__queuedPromptEvents.push(event));true",
  );
}

async function launch() {
  const environment = {
    ...process.env,
    MSH_EXPERIMENTAL: "1",
    MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: "1",
    MSH_NOTIFICATION_FIXTURE: "1",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(
    experimentalExecutable(),
    [
      `--inspect=${MAIN_INSPECT_PORT}`,
      ".",
      `--remote-debugging-port=${RENDERER_DEBUG_PORT}`,
    ],
    {
      cwd: desktop,
      env: environment,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  mainInspector = await connectMainInspector();
  await mainInspector.evaluate(
    'globalThis.__queuedPromptFetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__queuedPromptFetch(url,options);true',
  );
  renderer = await connectPage("main");
  await completeFirstRun();
}

async function close() {
  if (!child) return;
  const current = child;
  const ended =
    current.exitCode !== null
      ? Promise.resolve()
      : new Promise((done) => current.once("exit", done));
  await renderer
    ?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true')
    .catch(() => undefined);
  quickRenderer?.close();
  renderer?.close();
  mainInspector?.close();
  await Promise.race([ended, sleep(20_000)]);
  if (current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(5_000)]);
  }
  assert.ok(
    current.exitCode !== null || current.signalCode !== null,
    "Electron fixture did not exit",
  );
  child = undefined;
  mainInspector = undefined;
  renderer = undefined;
  quickRenderer = undefined;
}

async function capture(name, width = 1440, height = 960) {
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until('document.readyState==="complete"');
  if (width <= 1000) {
    for (let index = 0; index < 3; index += 1) {
      const closed = await renderer.evaluate(`(()=>{
        const scrim=document.querySelector(".workbench-drawer-scrim");
        if(!scrim)return false;
        scrim.click();return true;
      })()`);
      if (!closed) break;
      await sleep(220);
    }
    await until('!document.querySelector(".workbench-drawer-scrim")');
  }
  await sleep(220);
  const layout = await renderer.evaluate(`(()=>{
    const queue=document.querySelector(".queued-prompts");
    const rect=queue?.getBoundingClientRect();
    const hit=rect?document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2):null;
    return {
      overflow:document.documentElement.scrollWidth>innerWidth+2,
      foreground:Boolean(queue&&hit&&queue.contains(hit)),
      queue:rect?{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,viewport:innerWidth,viewportHeight:innerHeight}:null
    };
  })()`);
  assert.equal(layout.overflow, false, `Horizontal overflow: ${name}`);
  if (layout.queue) {
    assert.ok(layout.queue.left >= -1, `Queue tray left overflow: ${name}`);
    assert.ok(layout.queue.right <= layout.queue.viewport + 2, `Queue tray right overflow: ${name}`);
    assert.ok(layout.queue.width > 320, `Queue tray is unexpectedly narrow: ${name}`);
    assert.ok(layout.queue.top >= 0 && layout.queue.bottom <= layout.queue.viewportHeight, `Queue tray is vertically clipped: ${name}`);
    assert.equal(layout.foreground, true, `Queue tray is occluded: ${name}`);
  }
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
}

async function selectWorkspaceSession(session) {
  const mode = session.agentMode === "work" ? "work" : "code";
  const sessionSelector = `[data-session-id="${session.id}"] .session-row`;
  await until(`(()=>{
    const row=document.querySelector(${JSON.stringify(sessionSelector)});
    if(row){row.scrollIntoView({block:"nearest"});return true;}
    const group=document.querySelector('.session-group__header[aria-expanded="false"]');
    if(group){group.click();return false;}
    const more=document.querySelector('.session-group__show-all[aria-expanded="false"]');
    if(more){more.click();return false;}
    return false;
  })()`);
  await click(sessionSelector);
  await until(
    `document.querySelector(${JSON.stringify(sessionSelector)})?.classList.contains("session-row--selected")`,
  );
  await click(`[data-testid="agent-mode-${mode}"]`);
  await until(
    `document.querySelector('[data-testid="agent-mode-${mode}"]')?.getAttribute("aria-pressed")==="true"`,
  );
  await until(
    `window.mingshen.getSession(${JSON.stringify(session.id)}).then(current=>current?.agentMode===${JSON.stringify(mode)})`,
  );
}

async function selectChatSession(sessionId) {
  await click('[data-testid="agent-mode-chat"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="chat"');
  const selector = `[data-session-id="${sessionId}"] .chat-session-row__main`;
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await click(selector);
  const title = (await api("getSession", sessionId))?.title;
  await until(
    `document.querySelector('[data-session-id="${sessionId}"] .chat-session-row')?.classList.contains("chat-session-row--selected") ||
      document.querySelector(".conversation-empty h1")?.textContent?.trim()===${JSON.stringify(title)}`,
  );
}

async function waitForHeld(previousCount, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (heldRequests.length > previousCount) return heldRequests.at(-1);
    await sleep(50);
  }
  throw new Error("Timed out waiting for the controlled provider hold");
}

async function waitForRunStarted(sessionId, afterIndex = 0) {
  await until(
    `globalThis.__queuedPromptEvents
      .slice(${afterIndex})
      .some(event=>event.type==="run_started"&&event.sessionId===${JSON.stringify(sessionId)})`,
    60_000,
  );
  return renderer.evaluate(
    `globalThis.__queuedPromptEvents
      .slice(${afterIndex})
      .find(event=>event.type==="run_started"&&event.sessionId===${JSON.stringify(sessionId)})`,
  );
}

async function waitForTerminal(runId, timeout = 120_000) {
  await until(
    `globalThis.__queuedPromptEvents.some(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`,
    timeout,
  );
  return renderer.evaluate(
    `globalThis.__queuedPromptEvents.find(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`,
  );
}

async function startUiRun(sessionId, text, hold = true, steps = []) {
  const eventIndex = await renderer.evaluate("globalThis.__queuedPromptEvents.length");
  const heldCount = heldRequests.length;
  holdEnabled = hold;
  nextSteps = [...steps];
  nextStepIndex = 0;
  await fillComposer(text);
  await click(".composer .send-button");
  const started = await waitForRunStarted(sessionId, eventIndex);
  const held = hold ? await waitForHeld(heldCount) : null;
  return { runId: started.runId, held };
}

async function queueViaUi(sessionId, text) {
  await fillComposer(text);
  await until(
    'Boolean(document.querySelector(".queue-next-button")&&!document.querySelector(".queue-next-button").disabled)',
  );
  await click(".queue-next-button");
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(sessionId)}).then(items=>items.some(item=>item.text===${JSON.stringify(text)}))`,
  );
  await until(
    `[...document.querySelectorAll(".queued-prompt-item__copy p")].some(node=>node.textContent.trim()===${JSON.stringify(text)})`,
  );
}

async function queueItems(sessionId) {
  return await api("listQueuedPrompts", sessionId);
}

async function queueIndexByText(sessionId, text) {
  const items = await queueItems(sessionId);
  const index = items.findIndex((item) => item.text === text);
  assert.ok(index >= 0, `Missing queued item: ${text}`);
  return index;
}

async function waitForAutomaticPause(sessionId, reason, timeout = 60_000) {
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(sessionId)}).then(items=>items.length===0||items[0].automaticPauseReason===${JSON.stringify(reason)})`,
    timeout,
  );
  return queueItems(sessionId);
}

async function waitForQueueCount(sessionId, expected, timeout = 60_000) {
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(sessionId)}).then(items=>items.length===${expected})`,
    timeout,
  );
  if (expected === 0) {
    await until(
      '!document.querySelector("[data-testid=queued-prompt-tray]")',
      timeout,
    );
    return [];
  }
  await until(
    `document.querySelector("[data-testid=queued-prompt-count]")?.textContent?.replace(/\\s/g,"")===${JSON.stringify(`${expected}/10`)}`,
    timeout,
  );
  const count = await renderer.evaluate(
    'document.querySelector("[data-testid=queued-prompt-count]")?.textContent?.replace(/\\s/g,"") ?? ""',
  );
  assert.equal(count, `${expected}/10`);
  return queueItems(sessionId);
}

async function waitForQueueUpdated(sessionId, afterIndex, timeout = 60_000) {
  await until(
    `globalThis.__queuedPromptEvents
      .slice(${afterIndex})
      .some(event=>event.type==="queued_prompts_updated"&&event.sessionId===${JSON.stringify(sessionId)})`,
    timeout,
  );
}

async function waitForAutomaticRun(sessionId, afterIndex, heldCount) {
  const started = await waitForRunStarted(sessionId, afterIndex);
  const held = await waitForHeld(heldCount);
  return { runId: started.runId, held };
}

function queueRowAt(index) {
  return `document.querySelectorAll(".queued-prompt-item")[${index}]`;
}

function queueButtonAt(index, label) {
  return `(${queueRowAt(index)})?.querySelector('button[aria-label="${label}"]')`;
}

async function clickQueueButtonAt(index, label) {
  await until(
    `Boolean(${queueButtonAt(index, label)}&&!${queueButtonAt(index, label)}.disabled)`,
  );
  await renderer.evaluate(`${queueButtonAt(index, label)}.click();true`);
}

async function setQueueEditText(index, text) {
  const selector = `(${queueRowAt(index)})?.querySelector('textarea[aria-label="编辑队列消息"]')`;
  await until(`Boolean(${selector})`);
  await renderer.evaluate(`(()=>{
    const input=${selector};
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,${JSON.stringify(text)});
    input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(text)}}));
    return true;
  })()`);
}

async function replaceQueuedAttachment(sessionId, text, fileName, mimeType, contents) {
  const index = await queueIndexByText(sessionId, text);
  await renderer.evaluate(`(()=>{
    const input=document.querySelector('.queued-prompts input[type="file"]');
    if(!input)throw new Error("Missing queued attachment input");
    globalThis.__queuedPickerCalls=0;
    input.click=function(){globalThis.__queuedPickerCalls+=1;};
    return true;
  })()`);
  await clickQueueButtonAt(index, "替换队列附件");
  await until("globalThis.__queuedPickerCalls===1");
  await renderer.evaluate(`(()=>{
    const input=document.querySelector('.queued-prompts input[type="file"]');
    const transfer=new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(contents)}],${JSON.stringify(fileName)},{type:${JSON.stringify(mimeType)}}));
    try{input.files=transfer.files;}catch{
      Object.defineProperty(input,"files",{configurable:true,value:transfer.files});
    }
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  })()`);
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(sessionId)}).then(items=>items.some(item=>item.text===${JSON.stringify(text)}&&item.attachments.some(attachment=>attachment.name===${JSON.stringify(fileName)})))`,
  );
  await until(
    `[...document.querySelectorAll(".queued-prompt-item")].some(item=>item.textContent.includes(${JSON.stringify(fileName)}))`,
  );
}

async function failQueuedAttachmentReplacement(sessionId, text, fileName) {
  const index = await queueIndexByText(sessionId, text);
  await renderer.evaluate(`(()=>{
    const input=document.querySelector('.queued-prompts input[type="file"]');
    if(!input)throw new Error("Missing queued attachment input");
    globalThis.__queuedPickerCalls=0;
    input.click=function(){globalThis.__queuedPickerCalls+=1;};
    return true;
  })()`);
  await clickQueueButtonAt(index, "替换队列附件");
  await until("globalThis.__queuedPickerCalls===1");
  await renderer.evaluate(`(()=>{
    const input=document.querySelector('.queued-prompts input[type="file"]');
    const oversized=new Uint8Array(25*1024*1024+1);
    const transfer=new DataTransfer();
    transfer.items.add(new File([oversized],${JSON.stringify(fileName)},{type:"text/plain"}));
    try{input.files=transfer.files;}catch{
      Object.defineProperty(input,"files",{configurable:true,value:transfer.files});
    }
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  })()`);
  await until(
    'Boolean(document.querySelector("[data-testid=queued-prompt-error]")?.textContent?.trim())',
  );
  return renderer.evaluate(
    'document.querySelector("[data-testid=queued-prompt-error]")?.textContent?.trim() ?? ""',
  );
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await assertDebugPortsAvailable();
  execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], {
    windowsHide: true,
    stdio: "pipe",
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await launch();

  await renderer.evaluate(
    'localStorage.setItem("mingshen.theme","day");document.documentElement.dataset.theme="day";true',
  );
  await renderer.evaluate(`(async()=>{
    for(const server of await window.mingshen.listMcpServers()){
      if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    }
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const saver=await window.mingshen.getTokenSaver();
    await window.mingshen.setTokenSaver({...saver.settings,enabled:false});
    await window.mingshen.configureCompletionNotifications({
      nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false
    });
    return true;
  })()`);

  const provider = await api("createProvider", {
    name: "Queued prompt local fixture",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    protocol: "openai_responses",
    authMode: "bearer",
    apiKey: "{{SECRET_queue_fixture}}",
    keyLabel: "Fixture",
    neverReveal: true,
  });
  const configured = await api("createModel", {
    providerId: provider.id,
    modelId: "queued-prompt-fixture",
    displayName: "Queued prompt fixture",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    inputModalities: ["text", "file"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const modelId = configured.models[0]?.id;
  assert.ok(modelId);
  const baseSessionInput = {
    providerId: provider.id,
    modelId,
    agentProfileId: "primary",
    executionMode: "host",
    patchOnly: false,
    reasoningLevel: null,
  };
  const codeSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "code",
    workspacePath: project,
    permissionMode: "full_access",
    approvalMode: "manual",
    title: "Queued prompt Code session",
  });
  await api("setProjectMemoryEnabled", codeSession.id, false);
  await api("setProjectTrust", project, true);
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector("[data-testid=agent-mode-code]"))', 60_000);
  await installRuntimeListener();
  await selectWorkspaceSession(codeSession);

  const initial = await startUiRun(codeSession.id, "QUEUE_INITIAL_HOLD", true);
  assert.ok(initial.held);
  assert.equal((await api("getSession", codeSession.id)).status, "running");

  const firstOriginal = "QUEUE_FIRST_ORIGINAL";
  const firstEdited = "QUEUE_FIRST_EDITED";
  const secondText = "QUEUE_SECOND_ORIGINAL";
  const deleteText = "QUEUE_DELETE_ME";
  await queueViaUi(codeSession.id, firstOriginal);
  await queueViaUi(codeSession.id, secondText);
  await queueViaUi(codeSession.id, deleteText);

  let items = await waitForQueueCount(codeSession.id, 3);
  assert.deepEqual(
    items.map((item) => item.text),
    [firstOriginal, secondText, deleteText],
  );
  assert.ok(
    items.every(
      (item) =>
        item.continuationBlocker === "session_busy" &&
        item.automaticPauseReason === null &&
        item.automaticError === null,
    ),
  );
  assert.ok(!JSON.stringify(items).includes('"dataUrl"'));
  assert.ok(!JSON.stringify(items).includes('"path"'));
  assert.equal(
    await renderer.evaluate(
      'Boolean(document.querySelector("[data-testid=queued-prompt-move-up], [data-testid=queued-prompt-move-down]"))',
    ),
    false,
    "Queue order controls must not be exposed",
  );
  assert.equal(
    await renderer.evaluate(
      'Boolean(document.querySelector("[data-testid=queued-prompt-resume]"))',
    ),
    false,
    "Resume must only appear while the automatic queue is paused",
  );

  let firstIndex = await queueIndexByText(codeSession.id, firstOriginal);
  await clickQueueButtonAt(firstIndex, "编辑队列消息");
  await setQueueEditText(firstIndex, firstEdited);
  await clickQueueButtonAt(firstIndex, "保存队列消息");
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(codeSession.id)}).then(items=>items.some(item=>item.text===${JSON.stringify(firstEdited)}))`,
  );

  const replacementText = "QUEUE_REPLACEMENT_PAYLOAD";
  const replacementName = "queue-replacement.txt";
  await replaceQueuedAttachment(
    codeSession.id,
    firstEdited,
    replacementName,
    "text/plain",
    replacementText,
  );
  items = await queueItems(codeSession.id);
  const replacementItem = items.find((item) => item.text === firstEdited);
  assert.ok(replacementItem);
  assert.deepEqual(replacementItem.attachments, [
    {
      name: replacementName,
      mimeType: "text/plain",
      size: Buffer.byteLength(replacementText),
      kind: "file",
    },
  ]);

  const deleteIndex = await queueIndexByText(codeSession.id, deleteText);
  await clickQueueButtonAt(deleteIndex, "删除队列消息");
  await waitForQueueCount(codeSession.id, 2);
  assert.deepEqual(
    (await queueItems(codeSession.id)).map((item) => item.text),
    [firstEdited, secondText],
  );

  const reorderRejection = await expectRejected("reorderQueuedPrompts", [
    {
      sessionId: codeSession.id,
      itemId: replacementItem.id,
      targetIndex: 1,
    },
  ]);
  queueEvidence.reorderRejection = reorderRejection;
  queueEvidence.initial = (await queueItems(codeSession.id)).map((item) => ({
    id: item.id,
    text: item.text,
    attachments: item.attachments,
    blocker: item.continuationBlocker,
    automaticPauseReason: item.automaticPauseReason,
  }));
  await capture("queued-prompts-busy-code");
  passed.push(
    "Busy CodeAgent composer queues three drafts in insertion order; edit, attachment replacement and delete work without exposing reorder controls",
  );

  const editedDuringRun = "QUEUE_FIRST_EDITED_WHILE_RUN_COMPLETES";
  firstIndex = await queueIndexByText(codeSession.id, firstEdited);
  await clickQueueButtonAt(firstIndex, "编辑队列消息");
  await setQueueEditText(firstIndex, editedDuringRun);

  const initialHeld = heldRequests.shift();
  assert.ok(initialHeld);
  finish(initialHeld.response, "QUEUE_INITIAL_COMPLETE");
  const initialEnding = await waitForTerminal(initial.runId);
  assert.equal(initialEnding.type, "run_completed");
  const editingPause = await waitForAutomaticPause(codeSession.id, "editing");
  assert.equal(editingPause[0]?.text, firstEdited);
  const requestsWhileEditing = requests.length;
  const eventsWhileEditing = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  await sleep(700);
  assert.equal(
    requests.length,
    requestsWhileEditing,
    "An edit hold must prevent automatic dispatch of stale text",
  );
  assert.equal(
    await renderer.evaluate(
      `globalThis.__queuedPromptEvents.slice(${eventsWhileEditing}).some(event=>event.type==="run_started"&&event.sessionId===${JSON.stringify(codeSession.id)})`,
    ),
    false,
  );
  assert.equal(
    await renderer.evaluate(
      'Boolean(document.querySelector("[data-testid=queued-prompt-resume]"))',
    ),
    false,
    "An edit hold is not a queue-level resume action",
  );
  await capture("queued-prompts-editing-hold");

  const editSaveEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  const editSaveHeldCount = heldRequests.length;
  await clickQueueButtonAt(firstIndex, "保存队列消息");
  const firstAutomaticRun = await waitForAutomaticRun(
    codeSession.id,
    editSaveEventIndex,
    editSaveHeldCount,
  );
  await waitForQueueUpdated(codeSession.id, editSaveEventIndex);
  const firstAutomaticText = newestUserText(firstAutomaticRun.held.body);
  assert.ok(
    firstAutomaticText.startsWith(`${editedDuringRun}\n`),
    `Automatically sent prompt text was not the saved edit: ${firstAutomaticText}`,
  );
  const automaticFiles = newestInputFiles(firstAutomaticRun.held.body);
  if (automaticFiles.length) {
    assert.equal(automaticFiles.length, 1);
    assert.equal(automaticFiles[0].filename, replacementName);
  } else {
    assert.ok(firstAutomaticText.includes(`Uploaded attachment: ${replacementName}`));
    assert.ok(firstAutomaticText.includes(replacementText));
  }
  queueEvidence.firstAutomaticRun = {
    text: firstAutomaticText,
    transport: automaticFiles.length ? "input_file" : "extracted_text",
    ...(automaticFiles[0]
      ? {
          filename: automaticFiles[0].filename,
          dataSha256: createHash("sha256")
            .update(automaticFiles[0].file_data)
            .digest("hex"),
        }
      : {
          extractedContentSha256: createHash("sha256")
            .update(replacementText)
            .digest("hex"),
        }),
  };

  const secondRunEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  heldRequests.splice(heldRequests.indexOf(firstAutomaticRun.held), 1);
  const nextHeldCount = heldRequests.length;
  finish(firstAutomaticRun.held.response, "QUEUE_AUTO_FIRST_COMPLETE");
  const firstAutomaticEnding = await waitForTerminal(firstAutomaticRun.runId);
  assert.equal(firstAutomaticEnding.type, "run_completed");
  const secondAutomaticRun = await waitForAutomaticRun(
    codeSession.id,
    secondRunEventIndex,
    nextHeldCount,
  );
  const secondAutomaticText = newestUserText(secondAutomaticRun.held.body);
  assert.equal(
    secondAutomaticText.split(/\r?\n/, 1)[0],
    secondText,
    `The second queued item was not sent after the first automatic run completed. Actual prompt: ${JSON.stringify(secondAutomaticText.slice(0, 500))}`,
  );
  queueEvidence.fifo = [
    { order: 1, text: firstAutomaticText.split(/\r?\n/, 1)[0] },
    {
      order: 2,
      text: secondAutomaticText.split(/\r?\n/, 1)[0],
    },
  ];
  heldRequests.splice(heldRequests.indexOf(secondAutomaticRun.held), 1);
  finish(secondAutomaticRun.held.response, "QUEUE_AUTO_SECOND_COMPLETE");
  const secondAutomaticEnding = await waitForTerminal(secondAutomaticRun.runId);
  assert.equal(secondAutomaticEnding.type, "run_completed");
  await waitForQueueCount(codeSession.id, 0);
  passed.push(
    "Successful runs automatically drain queued prompts FIFO; an open edit hold pauses the chain until the edited text and attachment are saved",
  );

  const idleRejection = await expectRejected(
    "addQueuedPrompt",
    [{ sessionId: codeSession.id, text: "QUEUE_IDLE_MUST_REJECT" }],
    /QUEUED_PROMPT_REQUIRES_ACTIVE_RUN/,
  );
  expectedDenials.push({
    surface: "main-code-idle",
    api: "addQueuedPrompt",
    message: idleRejection,
  });

  const configRun = await startUiRun(
    codeSession.id,
    "QUEUE_CONFIGURATION_HOLD",
    true,
  );
  const configQueueText = "QUEUE_CONFIGURATION_SNAPSHOT";
  await queueViaUi(codeSession.id, configQueueText);
  const configQueueIndex = await queueIndexByText(codeSession.id, configQueueText);
  await clickQueueButtonAt(configQueueIndex, "编辑队列消息");
  await setQueueEditText(configQueueIndex, `${configQueueText}_EDITED`);
  const configHeld = heldRequests.shift();
  assert.ok(configHeld);
  finish(configHeld.response, "QUEUE_CONFIGURATION_INITIAL_COMPLETE");
  const configEnding = await waitForTerminal(configRun.runId);
  assert.equal(configEnding.type, "run_completed");
  await waitForAutomaticPause(codeSession.id, "editing");
  await api("updateSession", {
    sessionId: codeSession.id,
    permissionMode: "request_approval",
  });
  const configEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  const requestsBeforeBlockedConfig = requests.length;
  await clickQueueButtonAt(configQueueIndex, "保存队列消息");
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(codeSession.id)}).then(items=>items.some(item=>item.text===${JSON.stringify(
      `${configQueueText}_EDITED`,
    )}&&item.continuationBlocker==="configuration_changed"))`,
  );
  await waitForQueueUpdated(codeSession.id, configEventIndex);
  await sleep(700);
  assert.equal(requests.length, requestsBeforeBlockedConfig);
  assert.equal(
    await renderer.evaluate(
      'Boolean(document.querySelector(".queued-prompt-item__warning")?.textContent.includes("配置已变化"))',
    ),
    true,
  );
  await capture("queued-prompts-configuration-changed");
  const changedItems = await queueItems(codeSession.id);
  assert.equal(changedItems[0]?.automaticPauseReason, null);
  assert.equal(changedItems[0]?.continuationBlocker, "configuration_changed");
  await api("removeQueuedPrompt", codeSession.id, changedItems[0].id);
  await waitForQueueCount(codeSession.id, 0);
  await api("updateSession", {
    sessionId: codeSession.id,
    permissionMode: "full_access",
  });
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector("[data-testid=agent-mode-code]"))', 60_000);
  await installRuntimeListener();
  await selectWorkspaceSession({
    ...codeSession,
    permissionMode: "full_access",
  });
  passed.push(
    "Configuration snapshot changes pause automatic dispatch and remain visible after releasing an edit hold",
  );

  const backgroundSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "code",
    workspacePath: project,
    permissionMode: "full_access",
    approvalMode: "manual",
    title: "Queued prompt background session",
  });
  const workSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "work",
    workspacePath: project,
    permissionMode: "full_access",
    approvalMode: "manual",
    title: "Queued prompt Work session",
  });
  const attachmentFailureSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "code",
    workspacePath: project,
    permissionMode: "full_access",
    approvalMode: "manual",
    title: "Queued prompt attachment failure session",
  });
  const failureSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "code",
    workspacePath: project,
    permissionMode: "full_access",
    approvalMode: "manual",
    title: "Queued prompt failure session",
  });
  const drainSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "code",
    workspacePath: project,
    permissionMode: "full_access",
    approvalMode: "manual",
    title: "Queued prompt ten item drain session",
  });
  const directMentionSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "code",
    workspacePath: project,
    permissionMode: "full_access",
    approvalMode: "manual",
    title: "Queued prompt direct SubAgent session",
  });

  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector("[data-testid=agent-mode-code]"))', 60_000);
  await installRuntimeListener();
  await selectWorkspaceSession(backgroundSession);

  const backgroundRequestIndex = requests.length;
  const backgroundInitial = await startUiRun(
    backgroundSession.id,
    "QUEUE_BACKGROUND_INITIAL_HOLD",
    true,
  );
  const backgroundFirst = "QUEUE_BACKGROUND_FIRST";
  const backgroundSecond = "QUEUE_BACKGROUND_SECOND";
  await queueViaUi(backgroundSession.id, backgroundFirst);
  await queueViaUi(backgroundSession.id, backgroundSecond);
  const backgroundSecondIndex = await queueIndexByText(
    backgroundSession.id,
    backgroundSecond,
  );
  await clickQueueButtonAt(backgroundSecondIndex, "编辑队列消息");
  await setQueueEditText(
    backgroundSecondIndex,
    "QUEUE_BACKGROUND_SECOND_CANCELLED",
  );
  await clickQueueButtonAt(backgroundSecondIndex, "取消编辑");
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(backgroundSession.id)}).then(items=>items[1]?.text===${JSON.stringify(backgroundSecond)}&&items[1]?.automaticPauseReason===null)`,
  );

  await selectWorkspaceSession(drainSession);
  assert.equal(
    await renderer.evaluate(
      `document.querySelector('[data-session-id="${drainSession.id}"] .session-row')?.classList.contains("session-row--selected")`,
    ),
    true,
    "The observer session was not selected before the background run completed",
  );
  const backgroundHeld = heldRequests.shift();
  assert.ok(backgroundHeld);
  holdEnabled = false;
  finish(backgroundHeld.response, "QUEUE_BACKGROUND_INITIAL_COMPLETE");
  const backgroundInitialEnding = await waitForTerminal(backgroundInitial.runId);
  assert.equal(backgroundInitialEnding.type, "run_completed");
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(backgroundSession.id)}).then(items=>items.length===0)`,
    90_000,
  );
  await until(
    `window.mingshen.getSession(${JSON.stringify(backgroundSession.id)}).then(session=>session.status==="idle")`,
    90_000,
  );
  await until(
    `window.mingshen.getSessionMessages(${JSON.stringify(backgroundSession.id)}).then(messages=>messages.filter(message=>message.role==="assistant"&&message.parts.some(part=>part.type==="text"&&part.text==="QUEUED_PROMPT_FIXTURE_COMPLETE")).length===2)`,
    90_000,
  );

  await selectWorkspaceSession(backgroundSession);
  await waitForQueueCount(backgroundSession.id, 0);
  const backgroundMessages = await api(
    "getSessionMessages",
    backgroundSession.id,
  );
  const backgroundUserText = backgroundMessages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text);
  assert.deepEqual(backgroundUserText, [
    "QUEUE_BACKGROUND_INITIAL_HOLD",
    backgroundFirst,
    backgroundSecond,
  ]);
  const backgroundRequests = requests
    .slice(backgroundRequestIndex)
    .map((request) => newestUserText(request).split(/\r?\n/, 1)[0])
    .filter((text) => text.startsWith("QUEUE_BACKGROUND_"));
  assert.deepEqual(backgroundRequests, [
    "QUEUE_BACKGROUND_INITIAL_HOLD",
    backgroundFirst,
    backgroundSecond,
  ]);
  queueEvidence.background = {
    selectedObserver: drainSession.id,
    history: backgroundUserText,
    queueLength: (await queueItems(backgroundSession.id)).length,
  };
  passed.push(
    "Two queued prompts are automatically drained in FIFO order while another session is selected; returning to the original session shows the exact history and an empty queue",
  );

  await selectWorkspaceSession(workSession);
  assert.equal((await api("getSession", workSession.id))?.agentMode, "work");
  assert.equal(
    await renderer.evaluate(
      'document.querySelector(".app-shell")?.dataset.agentMode',
    ),
    "work",
  );
  const workRequestIndex = requests.length;
  const workInitial = await startUiRun(
    workSession.id,
    "QUEUE_WORK_INITIAL_HOLD",
    true,
  );
  const workFirst = "QUEUE_WORK_FIRST";
  const workSecond = "QUEUE_WORK_SECOND";
  await queueViaUi(workSession.id, workFirst);
  await queueViaUi(workSession.id, workSecond);
  const workHeld = heldRequests.shift();
  assert.ok(workHeld);
  holdEnabled = false;
  finish(workHeld.response, "QUEUE_WORK_INITIAL_COMPLETE");
  const workInitialEnding = await waitForTerminal(workInitial.runId);
  assert.equal(workInitialEnding.type, "run_completed");
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(workSession.id)}).then(items=>items.length===0)`,
    90_000,
  );
  await until(
    `window.mingshen.getSession(${JSON.stringify(workSession.id)}).then(session=>session.agentMode==="work"&&session.status==="idle")`,
    90_000,
  );
  await waitForQueueCount(workSession.id, 0);
  const workRequestTexts = requests
    .slice(workRequestIndex)
    .map((request) => newestUserText(request).split(/\r?\n/, 1)[0])
    .filter((text) => text.startsWith("QUEUE_WORK_"));
  assert.deepEqual(workRequestTexts, [
    "QUEUE_WORK_INITIAL_HOLD",
    workFirst,
    workSecond,
  ]);
  const workUserText = (await api("getSessionMessages", workSession.id))
    .filter((message) => message.role === "user")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text);
  assert.deepEqual(workUserText, [
    "QUEUE_WORK_INITIAL_HOLD",
    workFirst,
    workSecond,
  ]);
  queueEvidence.work = {
    agentMode: "work",
    sent: workRequestTexts,
    history: workUserText,
    queueLength: (await queueItems(workSession.id)).length,
  };
  passed.push(
    "A real WorkAgent session automatically drains two queued prompts FIFO and keeps Work mode plus exact history",
  );

  await selectWorkspaceSession(attachmentFailureSession);
  const attachmentRun = await startUiRun(
    attachmentFailureSession.id,
    "QUEUE_ATTACHMENT_FAILURE_INITIAL_HOLD",
    true,
  );
  const attachmentQueueText = "QUEUE_ATTACHMENT_FAILURE_HEAD";
  const originalAttachmentName = "queue-original-attachment.txt";
  const originalAttachmentText = "QUEUE_ORIGINAL_ATTACHMENT_PAYLOAD";
  const originalAttachment = {
    name: originalAttachmentName,
    mimeType: "text/plain",
    size: Buffer.byteLength(originalAttachmentText),
    kind: "file",
    dataUrl: `data:text/plain;base64,${Buffer.from(originalAttachmentText).toString("base64")}`,
  };
  await api("addQueuedPrompt", {
    sessionId: attachmentFailureSession.id,
    text: attachmentQueueText,
    attachments: [originalAttachment],
  });
  await waitForQueueCount(attachmentFailureSession.id, 1);
  const replacementError = await failQueuedAttachmentReplacement(
    attachmentFailureSession.id,
    attachmentQueueText,
    "queue-invalid-over-25-miB.txt",
  );
  assert.match(replacementError, /25 MiB/);
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(attachmentFailureSession.id)}).then(items=>items.length===1&&items[0].automaticPauseReason==="editing"&&items[0].attachments.length===1&&items[0].attachments[0].name===${JSON.stringify(originalAttachmentName)})`,
  );
  const attachmentPaused = (await queueItems(attachmentFailureSession.id))[0];
  assert.ok(attachmentPaused);
  assert.deepEqual(attachmentPaused.attachments, [
    {
      name: originalAttachmentName,
      mimeType: "text/plain",
      size: Buffer.byteLength(originalAttachmentText),
      kind: "file",
    },
  ]);
  await capture("queued-prompts-attachment-replace-failed");

  const attachmentRequestCount = requests.length;
  const attachmentHeld = heldRequests.shift();
  assert.ok(attachmentHeld);
  holdEnabled = false;
  finish(attachmentHeld.response, "QUEUE_ATTACHMENT_INITIAL_COMPLETE");
  const attachmentInitialEnding = await waitForTerminal(attachmentRun.runId);
  assert.equal(attachmentInitialEnding.type, "run_completed");
  await sleep(900);
  assert.equal(
    requests.length,
    attachmentRequestCount,
    "The queued prompt with the preserved attachment auto-sent after a failed replacement",
  );
  assert.equal(
    requests.some(
      (request) =>
        newestUserText(request).split(/\r?\n/, 1)[0] === attachmentQueueText,
    ),
    false,
  );
  await until(
    'Boolean(document.querySelector("[data-testid=queued-prompt-resume]"))',
  );

  const attachmentResumeEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  const attachmentResumeHeldCount = heldRequests.length;
  holdEnabled = true;
  await click('[data-testid="queued-prompt-resume"]');
  const attachmentRecovered = await waitForAutomaticRun(
    attachmentFailureSession.id,
    attachmentResumeEventIndex,
    attachmentResumeHeldCount,
  );
  const attachmentRecoveredText = newestUserText(attachmentRecovered.held.body);
  assert.equal(
    attachmentRecoveredText.split(/\r?\n/, 1)[0],
    attachmentQueueText,
  );
  const recoveredFiles = newestInputFiles(attachmentRecovered.held.body);
  if (recoveredFiles.length) {
    assert.equal(recoveredFiles[0]?.filename, originalAttachmentName);
  } else {
    assert.ok(attachmentRecoveredText.includes(originalAttachmentName));
    assert.ok(attachmentRecoveredText.includes(originalAttachmentText));
  }
  heldRequests.splice(
    heldRequests.indexOf(attachmentRecovered.held),
    1,
  );
  holdEnabled = false;
  finish(attachmentRecovered.held.response, "QUEUE_ATTACHMENT_RECOVERED_COMPLETE");
  const attachmentRecoveredEnding = await waitForTerminal(
    attachmentRecovered.runId,
  );
  assert.equal(attachmentRecoveredEnding.type, "run_completed");
  await waitForQueueCount(attachmentFailureSession.id, 0);
  queueEvidence.attachmentReplacementFailure = {
    error: replacementError,
    preserved: attachmentPaused.attachments,
    automaticRequestsBeforeResume: 0,
    resumedRunId: attachmentRecovered.runId,
    transport: recoveredFiles.length ? "input_file" : "extracted_text",
  };
  passed.push(
    "A queued head with an attachment pauses when an oversized replacement fails, preserves the original bytes, sends nothing automatically, and sends the original only after queue-level Resume",
  );

  await selectWorkspaceSession(failureSession);
  const failureInitial = await startUiRun(
    failureSession.id,
    "QUEUE_FAILURE_INITIAL_HOLD",
    true,
  );
  const failureHead = "QUEUE_FAILURE_HEAD";
  const failureNext = "QUEUE_FAILURE_NEXT";
  await queueViaUi(failureSession.id, failureHead);
  await queueViaUi(failureSession.id, failureNext);
  intentionallyFailingTextPrefix = failureHead;
  const failureEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  const failureHeld = heldRequests.shift();
  assert.ok(failureHeld);
  holdEnabled = false;
  finish(failureHeld.response, "QUEUE_FAILURE_INITIAL_COMPLETE");
  const failureInitialEnding = await waitForTerminal(failureInitial.runId);
  assert.equal(failureInitialEnding.type, "run_completed");
  const failedRunStarted = await waitForRunStarted(
    failureSession.id,
    failureEventIndex,
  );
  const failedRunEnding = await waitForTerminal(failedRunStarted.runId);
  assert.equal(failedRunEnding.type, "run_failed");
  const failedQueue = await waitForAutomaticPause(failureSession.id, "failed");
  assert.deepEqual(
    failedQueue.map((item) => item.text),
    [failureNext],
  );
  assert.equal(failedQueue[0]?.automaticPauseReason, "failed");
  assert.ok(
    failedQueue[0]?.automaticError,
    "The failed automatic run did not surface its error on the queue",
  );
  const failureRequestCount = requests.filter((request) =>
    newestUserText(request).startsWith(failureHead),
  ).length;
  assert.equal(failureRequestCount, 1);
  const afterFailureEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  await sleep(800);
  assert.equal(
    requests.some((request) => newestUserText(request).startsWith(failureNext)),
    false,
    "The next queued prompt started before queue-level recovery",
  );
  assert.equal(
    await renderer.evaluate(
      `globalThis.__queuedPromptEvents.slice(${afterFailureEventIndex}).some(event=>event.type==="run_started"&&event.sessionId===${JSON.stringify(failureSession.id)})`,
    ),
    false,
  );
  await until(
    'Boolean(document.querySelector("[data-testid=queued-prompt-resume]"))',
  );
  await until(
    'Boolean(document.querySelector("[data-testid=queued-prompt-auto-error]")?.textContent?.trim())',
  );
  queueEvidence.failure = {
    failedText: failureHead,
    remaining: [failureNext],
    error: failedRunEnding.error,
  };

  const failureResumeEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  const failureResumeHeldCount = heldRequests.length;
  holdEnabled = true;
  await click('[data-testid="queued-prompt-resume"]');
  const recoveredRun = await waitForAutomaticRun(
    failureSession.id,
    failureResumeEventIndex,
    failureResumeHeldCount,
  );
  assert.equal(
    newestUserText(recoveredRun.held.body).split(/\r?\n/, 1)[0],
    failureNext,
    "Queue-level Resume did not start the remaining first item after a 500 failure",
  );
  heldRequests.splice(heldRequests.indexOf(recoveredRun.held), 1);
  holdEnabled = false;
  finish(recoveredRun.held.response, "QUEUE_FAILURE_RECOVERED_COMPLETE");
  const recoveredEnding = await waitForTerminal(recoveredRun.runId);
  assert.equal(recoveredEnding.type, "run_completed");
  await waitForQueueCount(failureSession.id, 0);
  queueEvidence.failure.recoveredRunId = recoveredRun.runId;
  passed.push(
    "A deliberate provider 500 pauses the queue with maxRetries disabled, does not start the next item, and queue-level Resume starts the remaining head",
  );

  await selectWorkspaceSession(drainSession);
  const drainInitial = await startUiRun(
    drainSession.id,
    "QUEUE_DRAIN_INITIAL_HOLD",
    true,
  );
  const drainTexts = Array.from({ length: 10 }, (_, index) => `QUEUE_DRAIN_${index + 1}`);
  for (const text of drainTexts) await queueViaUi(drainSession.id, text);
  const drainItems = await waitForQueueCount(drainSession.id, 10);
  assert.deepEqual(
    drainItems.map((item) => item.text),
    drainTexts,
  );
  await fillComposer("QUEUE_DRAIN_11");
  await until('Boolean(document.querySelector(".queue-next-button")?.disabled)');
  const drainOverflow = await expectRejected(
    "addQueuedPrompt",
    [{ sessionId: drainSession.id, text: "QUEUE_DRAIN_11" }],
    /最多保留 10 条/,
  );
  expectedDenials.push({
    surface: "main-code-ten-item-drain",
    api: "addQueuedPrompt",
    message: drainOverflow,
  });
  const drainRequestIndex = requests.length;
  const drainHeld = heldRequests.shift();
  assert.ok(drainHeld);
  holdEnabled = false;
  finish(drainHeld.response, "QUEUE_DRAIN_INITIAL_COMPLETE");
  const drainInitialEnding = await waitForTerminal(drainInitial.runId);
  assert.equal(drainInitialEnding.type, "run_completed");
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(drainSession.id)}).then(items=>items.length===0)`,
    90_000,
  );
  await until(
    `window.mingshen.getSession(${JSON.stringify(drainSession.id)}).then(session=>session.status==="idle")`,
    120_000,
  );
  await waitForQueueCount(drainSession.id, 0);
  const drainedTexts = requests
    .slice(drainRequestIndex)
    .map((request) => newestUserText(request).split(/\r?\n/, 1)[0])
    .filter((text) => /^QUEUE_DRAIN_\d+$/.test(text));
  assert.deepEqual(drainedTexts, drainTexts);
  const drainMessages = await api("getSessionMessages", drainSession.id);
  const drainUserText = drainMessages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text);
  assert.deepEqual(drainUserText, ["QUEUE_DRAIN_INITIAL_HOLD", ...drainTexts]);
  queueEvidence.tenItemDrain = {
    queued: drainTexts,
    sent: drainedTexts,
    history: drainUserText,
    overflow: drainOverflow,
  };
  passed.push(
    "A full ten-item queue is really drained in insertion order after successful immediate responses, with the eleventh item rejected",
  );

  const availableProfiles = await api("listAgentProfiles");
  const exactMentionProfiles = availableProfiles.filter(
    (profile) =>
      profile.enabled &&
      profile.role === "subagent" &&
      profile.hidden !== true &&
      (!profile.applicableModes?.length || profile.applicableModes.includes("code")) &&
      /^[a-zA-Z0-9_\-\u4e00-\u9fff]+$/.test(profile.name),
  );
  const directMentionProfile =
    exactMentionProfiles.find((profile) => profile.id === "general") ??
    exactMentionProfiles[0];
  assert.ok(directMentionProfile, "No enabled, visible CodeAgent SubAgent profile is available");
  assert.ok(directMentionProfile.name, "The direct SubAgent profile has no mentionable name");
  assert.ok(directMentionProfile.id, "The direct SubAgent profile has no id");

  await selectWorkspaceSession(directMentionSession);
  const directMentionRequestIndex = requests.length;
  const directMentionEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  const directMentionInitial = await startUiRun(
    directMentionSession.id,
    "QUEUE_MENTION_INITIAL_HOLD",
    true,
  );
  const directMentionChildText = "QUEUE_MENTION_CHILD_TASK";
  const directMentionText = `@${directMentionProfile.name} ${directMentionChildText}`;
  const directMentionFollowup = "QUEUE_MENTION_PARENT_NEXT";
  await queueViaUi(directMentionSession.id, directMentionText);
  await queueViaUi(directMentionSession.id, directMentionFollowup);
  const directMentionQueued = await waitForQueueCount(directMentionSession.id, 2);
  assert.deepEqual(
    directMentionQueued.map((item) => item.text),
    [directMentionText, directMentionFollowup],
  );

  const directMentionInitialHeld = heldRequests.shift();
  assert.ok(directMentionInitialHeld);
  const directMentionChildHeldCount = heldRequests.length;
  finish(directMentionInitialHeld.response, "QUEUE_MENTION_INITIAL_COMPLETE");
  const directMentionInitialEnding = await waitForTerminal(directMentionInitial.runId);
  assert.equal(directMentionInitialEnding.type, "run_completed");

  await until(
    `globalThis.__queuedPromptEvents
      .slice(${directMentionEventIndex})
      .some(event=>
        event.type==="session_updated" &&
        event.session?.parentSessionId===${JSON.stringify(directMentionSession.id)} &&
        event.session?.agentProfileId===${JSON.stringify(directMentionProfile.id)}
      )`,
    60_000,
  );
  const directMentionChildSessionId = await renderer.evaluate(
    `globalThis.__queuedPromptEvents
      .slice(${directMentionEventIndex})
      .find(event=>
        event.type==="session_updated" &&
        event.session?.parentSessionId===${JSON.stringify(directMentionSession.id)} &&
        event.session?.agentProfileId===${JSON.stringify(directMentionProfile.id)}
      )?.session.id`,
  );
  const directMentionChildSession = await api("getSession", directMentionChildSessionId);
  assert.ok(directMentionChildSession, "The queued @SubAgent did not create a child session");
  assert.equal(directMentionChildSession.parentSessionId, directMentionSession.id);
  assert.equal(directMentionChildSession.agentProfileId, directMentionProfile.id);

  const directMentionChildStarted = await waitForRunStarted(
    directMentionChildSession.id,
    directMentionEventIndex,
  );
  const directMentionChildHeld = await waitForHeld(directMentionChildHeldCount);
  assert.equal(
    newestUserText(directMentionChildHeld.body).split(/\r?\n/, 1)[0],
    directMentionChildText,
    "The direct @SubAgent request did not receive the mention-stripped child task",
  );

  const directMentionWhileChild = await waitForQueueCount(
    directMentionSession.id,
    1,
  );
  assert.equal(directMentionWhileChild[0]?.text, directMentionFollowup);
  assert.equal(directMentionWhileChild[0]?.continuationBlocker, "session_busy");
  const directMentionRequestsBeforeChildCompletion = requests
    .slice(directMentionRequestIndex)
    .map((request) => newestUserText(request).split(/\r?\n/, 1)[0])
    .filter((text) => text.startsWith("QUEUE_MENTION_"));
  assert.deepEqual(directMentionRequestsBeforeChildCompletion, [
    "QUEUE_MENTION_INITIAL_HOLD",
    directMentionChildText,
  ]);
  await sleep(700);
  assert.deepEqual(
    requests
      .slice(directMentionRequestIndex)
      .map((request) => newestUserText(request).split(/\r?\n/, 1)[0])
      .filter((text) => text.startsWith("QUEUE_MENTION_")),
    directMentionRequestsBeforeChildCompletion,
    "The parent follow-up started before the queued direct @SubAgent completed",
  );

  const directMentionFollowupEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  heldRequests.splice(
    heldRequests.indexOf(directMentionChildHeld),
    1,
  );
  const directMentionFollowupHeldCount = heldRequests.length;
  finish(directMentionChildHeld.response, "QUEUE_MENTION_CHILD_COMPLETE");
  const directMentionChildEnding = await waitForTerminal(
    directMentionChildStarted.runId,
  );
  assert.equal(directMentionChildEnding.type, "run_completed");

  const directMentionFollowupRun = await waitForAutomaticRun(
    directMentionSession.id,
    directMentionFollowupEventIndex,
    directMentionFollowupHeldCount,
  );
  assert.equal(
    newestUserText(directMentionFollowupRun.held.body).split(/\r?\n/, 1)[0],
    directMentionFollowup,
    "The parent follow-up was not automatically sent after the queued @SubAgent completed",
  );
  await waitForQueueCount(directMentionSession.id, 0);

  heldRequests.splice(
    heldRequests.indexOf(directMentionFollowupRun.held),
    1,
  );
  finish(directMentionFollowupRun.held.response, "QUEUE_MENTION_PARENT_COMPLETE");
  const directMentionFollowupEnding = await waitForTerminal(
    directMentionFollowupRun.runId,
  );
  assert.equal(directMentionFollowupEnding.type, "run_completed");

  const directMentionParentHistory = (await api(
    "getSessionMessages",
    directMentionSession.id,
  ))
    .filter((message) => message.role === "user")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text);
  assert.deepEqual(directMentionParentHistory, [
    "QUEUE_MENTION_INITIAL_HOLD",
    directMentionFollowup,
  ]);
  const directMentionChildHistory = (await api(
    "getSessionMessages",
    directMentionChildSession.id,
  ))
    .filter((message) => message.role === "user")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text);
  assert.deepEqual(directMentionChildHistory, [directMentionChildText]);
  queueEvidence.directMention = {
    profile: {
      id: directMentionProfile.id,
      name: directMentionProfile.name,
      role: directMentionProfile.role,
    },
    parentSessionId: directMentionSession.id,
    childSessionId: directMentionChildSession.id,
    childRunId: directMentionChildStarted.runId,
    followupRunId: directMentionFollowupRun.runId,
    queued: [directMentionText, directMentionFollowup],
    whileChildRunning: directMentionWhileChild.map((item) => ({
      text: item.text,
      continuationBlocker: item.continuationBlocker,
      automaticPauseReason: item.automaticPauseReason,
    })),
    providerRequests: [
      ...directMentionRequestsBeforeChildCompletion,
      directMentionFollowup,
    ],
    parentHistory: directMentionParentHistory,
    childHistory: directMentionChildHistory,
  };
  passed.push(
    "A queued direct @SubAgent runs first, keeps the ordinary parent follow-up pending, then automatically sends that follow-up after the child succeeds",
  );

  await selectWorkspaceSession(codeSession);
  const delegatedRun = await startUiRun(
    codeSession.id,
    "SPAWN_SUBAGENT_FOR_QUEUE_BOUNDARY",
    false,
    [
      {
        name: "spawn_subagent",
        args: {
          agent: "general",
          task: "Return a concise queue-boundary probe. Do not modify files.",
        },
        callId: "queue-subagent-boundary-spawn",
      },
    ],
  );
  const delegatedEnding = await waitForTerminal(delegatedRun.runId);
  assert.equal(delegatedEnding.type, "run_completed");
  queueEvidence.delegation = {
    runId: delegatedRun.runId,
    toolResults: (await api("getSessionMessages", codeSession.id))
      .flatMap((message) => message.parts)
      .filter((part) => part.type === "tool_result" && part.callId === "queue-subagent-boundary-spawn"),
  };
  await until(
    `globalThis.__queuedPromptEvents.some(event=>event.type==="session_updated"&&event.session?.parentSessionId===${JSON.stringify(codeSession.id)})`,
    60_000,
  );
  const childSessionId = await renderer.evaluate(
    `globalThis.__queuedPromptEvents.find(event=>event.type==="session_updated"&&event.session?.parentSessionId===${JSON.stringify(codeSession.id)})?.session.id`,
  );
  const subagentSession = await api("getSession", childSessionId);
  assert.ok(subagentSession, "The provider-spawned run did not create an actual SubAgent session");
  const subagentAddRejection = await expectRejected(
    "addQueuedPrompt",
    [{ sessionId: subagentSession.id, text: "SUBAGENT_QUEUE_MUST_REJECT" }],
    /QUEUED_PROMPT_UNSUPPORTED_SUBAGENT/,
  );
  expectedDenials.push({
    surface: "actual-subagent",
    api: "addQueuedPrompt",
    message: subagentAddRejection,
    sessionId: subagentSession.id,
    parentSessionId: codeSession.id,
  });
  queueEvidence.subagent = {
    sessionId: subagentSession.id,
    parentSessionId: codeSession.id,
    addBlocker: subagentAddRejection,
  };
  passed.push("An actual provider-spawned SubAgent is rejected by the queue service before a queue record can be created");

  const pauseInitial = await startUiRun(
    codeSession.id,
    "QUEUE_PAUSE_INITIAL_HOLD",
    true,
  );
  const pauseTexts = Array.from(
    { length: 3 },
    (_, index) => `QUEUE_PAUSE_${index + 1}`,
  );
  for (const text of pauseTexts) await queueViaUi(codeSession.id, text);
  const pauseItems = await waitForQueueCount(codeSession.id, 3);
  assert.deepEqual(
    pauseItems.map((item) => item.text),
    pauseTexts,
  );
  const reorderLimitRejection = await expectRejected("reorderQueuedPrompts", [
    {
      sessionId: codeSession.id,
      itemId: pauseItems[0]?.id,
      targetIndex: 1,
    },
  ]);
  queueEvidence.pauseReorderRejection = reorderLimitRejection;
  assert.equal(
    await renderer.evaluate(
      'Boolean(document.querySelector("[data-testid=queued-prompt-move-up], [data-testid=queued-prompt-move-down]"))',
    ),
    false,
  );

  await renderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".composer__actions button")]
      .find(node=>node.textContent.includes("停止"));
    if(!button)throw new Error("Missing stop button");
    button.click();
    return true;
  })()`);
  const pauseEnding = await waitForTerminal(pauseInitial.runId);
  assert.equal(pauseEnding.type, "run_interrupted");
  const pauseHeld = heldRequests.shift();
  pauseHeld?.response.destroy();
  const stoppedItems = await waitForAutomaticPause(codeSession.id, "stopped");
  assert.equal(stoppedItems.length, 3);
  assert.ok(stoppedItems.every((item) => item.automaticPauseReason === "stopped"));
  await until(
    'Boolean(document.querySelector("[data-testid=queued-prompt-resume]"))',
  );
  queueEvidence.stopped = stoppedItems.map((item) => ({
    id: item.id,
    text: item.text,
    pause: item.automaticPauseReason,
  }));
  await capture("queued-prompts-stopped");
  passed.push(
    "Stopping the active run pauses the FIFO queue, preserves all items and exposes one queue-level Resume control without exposing reorder controls",
  );

  await close();
  const requestsBeforeRestart = requests.length;
  await launch();
  await installRuntimeListener();
  await selectWorkspaceSession({
    ...codeSession,
    permissionMode: "full_access",
  });
  const restartedItems = await waitForAutomaticPause(codeSession.id, "restarted");
  await waitForQueueCount(codeSession.id, 3);
  assert.ok(
    restartedItems.every((item) => item.automaticPauseReason === "restarted"),
  );
  await until(
    'Boolean(document.querySelector("[data-testid=queued-prompt-resume]"))',
  );
  await sleep(900);
  assert.equal(
    requests.length,
    requestsBeforeRestart,
    "Restart must not auto-send a persisted paused queue",
  );
  await capture("queued-prompts-restarted-paused");
  passed.push(
    "A real Electron restart keeps the paused items in FIFO order, marks the persisted queue as restarted and waits for queue-level Resume",
  );

  const resumeEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  const resumeHeldCount = heldRequests.length;
  holdEnabled = true;
  await click('[data-testid="queued-prompt-resume"]');
  const resumedRun = await waitForAutomaticRun(
    codeSession.id,
    resumeEventIndex,
    resumeHeldCount,
  );
  await waitForQueueUpdated(codeSession.id, resumeEventIndex);
  assert.equal(
    newestUserText(resumedRun.held.body).split(/\r?\n/, 1)[0],
    "QUEUE_PAUSE_1",
    "Queue-level Resume did not start the first persisted item",
  );
  const keptItems = await waitForQueueCount(codeSession.id, 2);
  assert.deepEqual(keptItems.map((item) => item.text), ["QUEUE_PAUSE_2", "QUEUE_PAUSE_3"]);
  await renderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".composer__actions button")]
      .find(node=>node.textContent.includes("停止"));
    if(!button)throw new Error("Missing stop button");
    button.click();
    return true;
  })()`);
  const resumedEnding = await waitForTerminal(resumedRun.runId);
  assert.equal(resumedEnding.type, "run_interrupted");
  const resumedHeld = heldRequests.shift();
  resumedHeld?.response.destroy();
  const finalPausedItems = await waitForAutomaticPause(codeSession.id, "stopped");
  assert.deepEqual(
    finalPausedItems.map((item) => item.text),
    ["QUEUE_PAUSE_2", "QUEUE_PAUSE_3"],
  );
  queueEvidence.resume = {
    resumedText: newestUserText(resumedRun.held.body).split(/\r?\n/, 1)[0],
    remaining: finalPausedItems.map((item) => item.text),
  };
  passed.push(
    "Queue-level Resume starts only the first item and leaves subsequent items waiting for their own successful completions",
  );

  const chatSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "chat",
    workspacePath: null,
    permissionMode: "request_approval",
    approvalMode: "manual",
    title: "Queued prompt Chat session",
  });
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector("[data-testid=agent-mode-chat]"))', 60_000);
  await installRuntimeListener();
  await selectChatSession(chatSession.id);

  const chatInitial = await startUiRun(chatSession.id, "CHAT_QUEUE_INITIAL_HOLD", true);
  const chatQueueText = "CHAT_QUEUE_TOOL_BOUNDARY";
  await queueViaUi(chatSession.id, chatQueueText);
  assert.equal(
    await renderer.evaluate('Boolean(document.querySelector("[data-testid=chat-queue-add]"))'),
    true,
    "Main ChatAgent did not expose the shared next-round queue button",
  );
  assert.deepEqual(
    (await queueItems(chatSession.id)).map((item) => item.text),
    [chatQueueText],
  );
  await capture("queued-prompts-busy-chat");
  const chatHeld = chatInitial.held;
  assert.ok(chatHeld);
  assert.ok(heldRequests.includes(chatHeld));
  heldRequests.splice(heldRequests.indexOf(chatHeld), 1);
  const chatAutoEventIndex = await renderer.evaluate(
    "globalThis.__queuedPromptEvents.length",
  );
  const chatHeldCount = heldRequests.length;
  const chatRequestIndex = requests.length;
  finish(chatHeld.response, "CHAT_QUEUE_INITIAL_COMPLETE");
  const chatInitialEnding = await waitForTerminal(chatInitial.runId);
  assert.equal(chatInitialEnding.type, "run_completed");
  const chatContinuedRun = await waitForAutomaticRun(
    chatSession.id,
    chatAutoEventIndex,
    chatHeldCount,
  );
  await waitForQueueUpdated(chatSession.id, chatAutoEventIndex);
  assert.equal(
    newestUserText(chatContinuedRun.held.body).split(/\r?\n/, 1)[0],
    chatQueueText,
  );
  heldRequests.splice(heldRequests.indexOf(chatContinuedRun.held), 1);
  holdEnabled = false;
  finish(chatContinuedRun.held.response, "", [
    {
      type: "function_call",
      name: "read_file",
      arguments: JSON.stringify({ path: join(project, "chat-must-not-read.txt") }),
      call_id: "chat-queue-read-file-denied",
    },
  ]);
  const requestDeadline = Date.now() + 60_000;
  while (requests.length <= chatRequestIndex + 1 && Date.now() < requestDeadline) {
    await sleep(80);
  }
  assert.ok(
    requests.length > chatRequestIndex + 1,
    "Timed out waiting for ChatAgent to process the denied read_file tool call",
  );
  assert.ok(
    requests
      .slice(chatRequestIndex)
      .some((request) => JSON.stringify(request).includes("CHAT_TOOL_DENIED")),
    "Main ChatAgent automatic queue run did not receive CHAT_TOOL_DENIED for read_file",
  );
  for (const request of requests.slice(chatRequestIndex)) {
    assert.deepEqual(
      (request.tools ?? []).map((tool) => tool.name).sort(),
      ["web_fetch", "web_search"],
    );
  }
  const chatContinuedEnding = await waitForTerminal(chatContinuedRun.runId);
  assert.equal(chatContinuedEnding.type, "run_completed");
  await until(
    `window.mingshen.listQueuedPrompts(${JSON.stringify(chatSession.id)}).then(items=>items.length===0)`,
  );
  queueEvidence.chat = {
    text: chatQueueText,
    automaticRunId: chatContinuedRun.runId,
    maliciousTool: "read_file",
    maliciousToolResult: "CHAT_TOOL_DENIED",
  };
  passed.push(
    "Main ChatAgent automatically starts its queued item after successful completion while read_file remains denied by ChatAgent tool policy",
  );

  const quickState = await api("quickChatAction", "show");
  assert.ok(quickState?.session);
  quickRenderer = await connectPage("quick-chat");
  await untilOn(
    quickRenderer,
    'document.readyState==="complete"&&Boolean(document.querySelector(".quick-chat"))',
    60_000,
  );
  const quickSessionId = quickState.session.id;
  const quickDenyPattern = /ChatAgent 小窗口仅允许操作当前对话/;
  await expectQuickRejected(
    "listQueuedPrompts",
    [quickSessionId],
    quickDenyPattern,
  );
  await expectQuickRejected(
    "addQueuedPrompt",
    [{ sessionId: quickSessionId, text: "QUICK_CHAT_QUEUE_DENIED" }],
    quickDenyPattern,
  );
  await expectQuickRejected(
    "updateQueuedPrompt",
    [{ sessionId: quickSessionId, itemId: "missing", text: "denied" }],
    quickDenyPattern,
  );
  await expectQuickRejected(
    "reorderQueuedPrompts",
    [{ sessionId: quickSessionId, itemId: "missing", targetIndex: 0 }],
    quickDenyPattern,
  );
  await expectQuickRejected(
    "removeQueuedPrompt",
    [quickSessionId, "missing"],
    quickDenyPattern,
  );
  await expectQuickRejected(
    "continueQueuedPrompt",
    [quickSessionId, "missing"],
    quickDenyPattern,
  );
  await expectQuickRejected(
    "beginQueuedPromptEdit",
    [quickSessionId, "missing"],
    quickDenyPattern,
  );
  await expectQuickRejected(
    "endQueuedPromptEdit",
    [quickSessionId, "missing-edit", true],
    quickDenyPattern,
  );
  passed.push(
    "Quick Chat rejects every queued-prompt and edit-hold IPC channel before it can reach the main service",
  );

  await api("quickChatAction", "hide");
  const uiPreferences = await api("getUiPreferences");
  await api("saveUiPreferences", { ...uiPreferences, interfaceStyle: "orbit" });
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector(".app-shell--orbit"))', 60_000);
  await click('[data-testid="agent-mode-code"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="code"');
  await selectWorkspaceSession({ ...codeSession, permissionMode: "full_access" });
  await until('document.querySelectorAll(".queued-prompt-item").length===2');
  assert.equal(
    await renderer.evaluate(
      'Boolean(document.querySelector("[data-testid=queued-prompt-resume]"))',
    ),
    true,
  );
  assert.equal(
    await renderer.evaluate(
      'document.querySelector("[data-testid=queued-prompt-count]")?.textContent?.replace(/\\s/g,"")',
    ),
    "2/10",
  );
  await capture("queued-prompts-orbit-day");
  await renderer.evaluate(
    'document.documentElement.dataset.theme="night";localStorage.setItem("mingshen.theme","night");true',
  );
  await renderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".desktop-caption button")].find(node=>(node.getAttribute("aria-label")??"").includes("English"));
    if(!button)throw new Error("Missing locale switch");
    button.click();return true;
  })()`);
  await until('document.querySelector("[data-testid=queued-prompt-tray]")?.textContent.includes("Next-run queue")');
  await capture("queued-prompts-orbit-english-night-800", 800, 900);
  passed.push(
    "The persisted queue remains visible within the composer in Orbit day and night, including English at 800 pixels without horizontal overflow",
  );

  assert.deepEqual(errors, []);
  const result = {
    ok: true,
    passed,
    evidence,
    screenshots,
    expectedDenials,
    queueEvidence,
    modelRequestCount: requests.length,
    boundaries:
      "Synthetic local Responses provider, temporary Electron profile and temporary workspace only. No normal user database, API key, paid service, installer, cloud request or source-scan substitute is used.",
  };
  await writeFile(
    join(evidence, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "failure.json"),
    `${JSON.stringify(
      {
        passed,
        errors,
        expectedDenials,
        queueEvidence,
        requestCount: requests.length,
        requestLatestUserTexts: requests.map((body, index) => ({
          index,
          latestUserText: newestUserText(body),
        })),
        screenshots,
        failure: String(error.stack ?? error),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  throw error;
} finally {
  holdEnabled = false;
  for (const held of heldRequests.splice(0)) held.response.destroy();
  await close().catch(() => undefined);
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  const local = relative(resolve(tmpdir()), temporary);
  assert.ok(
    local && !local.startsWith("..") && !isAbsolute(local),
    "Refusing to clean a temporary directory outside the OS temp root",
  );
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}
