import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
assert.equal(version, "1.3.4", "This regression fixture is pinned to the 1.3.4 cycle");

const desktop = resolve("apps/desktop");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-composer-source-paste-"));
const project = join(temporary, "project");
const profile = join(temporary, "profile");
const evidence = resolve(".impeccable/review", `v134-composer-source-paste-${Date.now()}`);
const resultPath = join(evidence, "result.json");
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));

const passed = [];
const rendererExceptions = [];
const rendererCrashes = [];
const serverErrors = [];
const modelRequests = [];
const screenshots = [];
const measurements = [];
const blockedNetworkAttempts = [];

const labels = {
  edit: ["\u7F16\u8F91\u539F\u6587", "Edit source"],
  preview: ["\u683C\u5F0F\u9884\u89C8", "Formatted preview"],
};

const sourceText = [
  "## Release draft",
  "",
  "**Important** $x^2+y^2$ and \\(a+b\\)",
  "",
  "- first item",
  "- second item",
  "",
  "SOURCE_TAIL_V134",
].join("\n");
const typedTail = "\n\nTYPED_SOURCE_V134";
const imeTail = "\n\n\u4E2D\u6587\u8F93\u5165_V134";
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aen8AAAAASUVORK5CYII=";

let child;
let main;
let primary;
let quick;
let rendererPort;
let fixture;
let fixturePort;
let heldQueuePreflightResponse;
let queuePreflightEvidence;

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const payload = JSON.parse(body || "{}");
    const titleRequest =
      typeof payload.instructions === "string" &&
      payload.instructions.includes("\u4F1A\u8BDD\u6807\u9898\u751F\u6210");
    modelRequests.push({
      url: request.url,
      method: request.method,
      kind: titleRequest ? "title" : "chat",
      body,
    });
    if (titleRequest) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: "Composer queue fixture",
        })}\n\n` +
          `data: ${JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 },
            },
          })}\n\n`,
      );
      return;
    }
    if (
      body.includes("QUEUE_PREFLIGHT_INITIAL_HOLD") &&
      heldQueuePreflightResponse === undefined
    ) {
      heldQueuePreflightResponse = response;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.flushHeaders();
      return;
    }
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end("Unexpected model request in composer source-paste smoke.");
  } catch (cause) {
    serverErrors.push(cause instanceof Error ? cause.stack : String(cause));
    if (!response.headersSent) response.writeHead(500);
    response.end("Fixture error.");
  }
});

function finishHeldQueuePreflight() {
  const response = heldQueuePreflightResponse;
  assert.ok(response, "Missing held queue-preflight model response");
  heldQueuePreflightResponse = undefined;
  response.write(
    `data: ${JSON.stringify({
      type: "response.output_text.delta",
      delta: "Queue preflight fixture completed.",
    })}\n\n`,
  );
  response.end(
    `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        status: "completed",
        usage: { input_tokens: 50, output_tokens: 8, total_tokens: 58 },
      },
    })}\n\n`,
  );
}

async function availablePort() {
  const probe = createPortServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", done);
  });
  const port = probe.address().port;
  await new Promise((done, reject) => {
    probe.close((cause) => (cause ? reject(cause) : done()));
  });
  return port;
}

async function connect(port, surface) {
  let target;
  for (let index = 0; index < 240; index++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((value) => value.json());
      target = targets.find((item) => {
        if (!item.webSocketDebuggerUrl) return false;
        if (surface === "main") return true;
        if (item.type !== "page") return false;
        const isQuick = item.url.includes("surface=quick-chat");
        return surface === "quick" ? isQuick : !isQuick;
      });
    } catch {}
    if (target) break;
    await sleep(80);
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
    if (surface !== "main" && message.method === "Runtime.exceptionThrown") {
      rendererExceptions.push({
        surface,
        message:
          message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text ||
          "Unknown renderer exception",
      });
    }
    if (surface !== "main" && message.method === "Inspector.targetCrashed") {
      rendererCrashes.push({ surface, details: message.params ?? {} });
    }
    if (
      surface !== "main" &&
      message.method === "Network.requestWillBeSent" &&
      /^https?:/i.test(message.params.request.url)
    ) {
      blockedNetworkAttempts.push(message.params.request.url);
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    message.error
      ? waiter.reject(new Error(message.error.message))
      : waiter.done(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 60000);
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
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    }
    return result.result.value;
  };
  const close = () =>
    new Promise((done) => {
      if (socket.readyState === WebSocket.CLOSED) return done();
      socket.addEventListener("close", done, { once: true });
      socket.close();
      setTimeout(done, 500).unref();
    });
  return { send, evaluate, close };
}

async function until(client, expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await client.evaluate(expression)) return;
    } catch (cause) {
      if (!/context|navigat|reload|destroyed/i.test(String(cause))) throw cause;
      lastError = cause;
    }
    await sleep(70);
  }
  throw new Error(`Timed out: ${expression}${lastError ? ` (${lastError})` : ""}`);
}

async function waitForCondition(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(70);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function api(client, name, ...args) {
  return client.evaluate(
    `window.mingshen.${name}(${args.map((value) => JSON.stringify(value)).join(",")})`,
  );
}

async function click(client, selector) {
  const target = `(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    if(!element||element.disabled)return false;
    const rect=element.getBoundingClientRect();
    if(rect.width<1||rect.height<1)return false;
    element.click();
    return true;
  })()`;
  await until(client, target);
}

async function key(client, keyName, code, virtualKey, modifiers = 0, text) {
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: keyName,
    code,
    windowsVirtualKeyCode: virtualKey,
    modifiers,
    ...(text === undefined ? {} : { text, unmodifiedText: text }),
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: keyName,
    code,
    windowsVirtualKeyCode: virtualKey,
    modifiers,
  });
}

function formatSelector(kind) {
  return labels[kind]
    .map(
      (label) =>
        `.composer-format-switch button[aria-label=${JSON.stringify(label)}]`,
    )
    .join(",");
}

const previewVisible = 'Boolean(document.querySelector(".composer-preview")?.getClientRects().length)';
const textareaVisible =
  '(()=>{const field=document.querySelector("[data-testid=chat-composer-input]");return Boolean(field&&!field.hidden&&!field.disabled&&field.getClientRects().length)})()';

async function viewport(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.evaluate('window.dispatchEvent(new Event("resize"));true');
  await sleep(180);
}

async function capture(client, name) {
  await sleep(160);
  const image = await client.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
  return path;
}

async function focusSource(client) {
  if (await client.evaluate(previewVisible)) {
    await click(client, formatSelector("edit"));
  }
  await until(client, textareaVisible);
  await client.evaluate(`(()=>{
    const field=document.querySelector("[data-testid=chat-composer-input]");
    field.focus({preventScroll:true});
    field.setSelectionRange(field.value.length,field.value.length);
    return true;
  })()`);
}

async function clearComposer(client) {
  await focusSource(client);
  await client.evaluate(`(()=>{
    const field=document.querySelector("[data-testid=chat-composer-input]");
    field.focus({preventScroll:true});
    field.setSelectionRange(0,field.value.length);
    return true;
  })()`);
  await key(client, "Backspace", "Backspace", 8);
  await until(
    client,
    'document.querySelector("[data-testid=chat-composer-input]")?.value===""',
  );
  await client.evaluate(`(()=>{
    for(const button of document.querySelectorAll(".draft-attachment button"))button.click();
    return true;
  })()`);
  await until(client, 'document.querySelectorAll(".draft-attachment").length===0');
}

async function pasteText(client, text) {
  const state = await client.evaluate(`(()=>{
    const target=document.querySelector("[data-testid=chat-composer-input]");
    if(!target)throw new Error("Missing composer textarea");
    target.focus({preventScroll:true});
    target.setSelectionRange(target.value.length,target.value.length);
    const data=new DataTransfer();
    data.setData("text/plain",${JSON.stringify(text)});
    const event=new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true});
    target.dispatchEvent(event);
    const inserted=!event.defaultPrevented
      ?document.execCommand("insertText",false,${JSON.stringify(text)})
      :false;
    return {
      prevented:event.defaultPrevented,
      inserted,
      focused:document.activeElement===target,
      visible:!target.hidden&&target.getClientRects().length>0,
    };
  })()`);
  assert.equal(state.prevented, false, "Text paste must retain native insertion");
  assert.equal(state.inserted, true, "Synthetic native insertion must update the composer");
  assert.equal(state.focused, true, "Text paste must keep textarea focus");
  assert.equal(state.visible, true, "Text paste must not hide the source textarea");
}

async function assertSourceState(client, expected, label) {
  const state = await client.evaluate(`(()=>{
    const field=document.querySelector("[data-testid=chat-composer-input]");
    const rect=field?.getBoundingClientRect();
    return {
      value:field?.value??null,
      focused:document.activeElement===field,
      hidden:Boolean(field?.hidden),
      disabled:Boolean(field?.disabled),
      visible:Boolean(rect&&rect.width>1&&rect.height>1),
      preview:Boolean(document.querySelector(".composer-preview")?.getClientRects().length),
      previewStatus:Boolean(document.querySelector(".composer-preview-status")),
      attachments:document.querySelectorAll(".draft-attachment").length,
      overflow:document.documentElement.scrollWidth>innerWidth+1,
      rect:rect?{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}:null,
    };
  })()`);
  assert.equal(state.value, expected, `${label}: source text changed`);
  assert.equal(state.focused, true, `${label}: source textarea lost focus`);
  assert.equal(state.hidden, false, `${label}: source textarea was hidden`);
  assert.equal(state.disabled, false, `${label}: source textarea was disabled`);
  assert.equal(state.visible, true, `${label}: source textarea is not visible`);
  assert.equal(state.preview, false, `${label}: formatted preview opened unexpectedly`);
  assert.equal(state.previewStatus, false, `${label}: preview fallback status opened unexpectedly`);
  assert.equal(state.overflow, false, `${label}: page gained horizontal overflow`);
  assert.ok(
    state.rect &&
      state.rect.width >= 120 &&
      state.rect.height >= 40 &&
      state.rect.left >= -1 &&
      state.rect.right <= 1441 &&
      state.rect.top >= -1 &&
      state.rect.bottom <= 901,
    `${label}: textarea is not fully usable (${JSON.stringify(state.rect)})`,
  );
  measurements.push({ label, ...state });
  return state;
}

async function assertPreviewAndRestore(client, expected, label) {
  await click(client, formatSelector("preview"));
  await until(client, previewVisible);
  const preview = await client.evaluate(`(()=>{
    const panel=document.querySelector(".composer-preview");
    const field=document.querySelector("[data-testid=chat-composer-input]");
    return {
      focus:document.activeElement===panel,
      textareaHidden:Boolean(field?.hidden),
      heading:panel.querySelector("h2")?.textContent??null,
      strong:panel.querySelector("strong")?.textContent??null,
      math:panel.querySelectorAll(".katex").length,
      text:panel.textContent,
      overflow:document.documentElement.scrollWidth>innerWidth+1,
    };
  })()`);
  assert.equal(preview.focus, true, `${label}: manual preview did not receive focus`);
  assert.equal(preview.textareaHidden, true, `${label}: source textarea should be hidden in preview`);
  assert.equal(preview.heading, "Release draft", `${label}: Markdown heading was not rendered`);
  assert.equal(preview.strong, "Important", `${label}: Markdown emphasis was not rendered`);
  assert.ok(preview.math >= 2, `${label}: inline formulas were not rendered`);
  assert.ok(preview.text.includes("SOURCE_TAIL_V134"), `${label}: source tail is missing in preview`);
  assert.equal(preview.overflow, false, `${label}: preview caused horizontal overflow`);
  await capture(client, `${label}-manual-preview`);

  await click(client, formatSelector("edit"));
  await until(client, `${textareaVisible}&&!${previewVisible}`);
  assert.equal(
    await client.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'),
    expected,
    `${label}: edit source did not restore the exact draft`,
  );
  assert.equal(
    await client.evaluate(
      'document.activeElement===document.querySelector("[data-testid=chat-composer-input]")',
    ),
    true,
    `${label}: edit source did not restore textarea focus`,
  );
}

async function pasteImage(client) {
  const state = await client.evaluate(`(()=>{
    const target=document.querySelector("[data-testid=chat-composer-input]");
    const bytes=Uint8Array.from(atob(${JSON.stringify(pngBase64)}),value=>value.charCodeAt(0));
    const data=new DataTransfer();
    data.items.add(new File([bytes],"synthetic-source-paste.png",{type:"image/png"}));
    const event=new ClipboardEvent("paste",{clipboardData:data,bubbles:true,cancelable:true});
    target.focus({preventScroll:true});
    target.dispatchEvent(event);
    return {
      prevented:event.defaultPrevented,
      focused:document.activeElement===target,
      hidden:target.hidden,
    };
  })()`);
  assert.equal(state.prevented, true, "Image paste must be handled by attachment flow");
  assert.equal(state.focused, true, "Image paste must retain composer focus");
  assert.equal(state.hidden, false, "Image paste must not switch to preview");
  await until(client, 'document.querySelectorAll(".draft-attachment").length===1');
}

async function applyPresentation(client, style, theme) {
  await client.evaluate(`(async()=>{
    await window.mingshen.desktopAction("locale","zh-CN");
    const preferences=await window.mingshen.getUiPreferences();
    await window.mingshen.saveUiPreferences({
      ...preferences,
      interfaceStyle:${JSON.stringify(style)},
      composerRichPaste:true
    });
    localStorage.setItem("mingshen.locale","zh-CN");
    localStorage.setItem("mingshen.theme",${JSON.stringify(theme)});
    localStorage.setItem("mingshen.agent-mode","code");
    return true;
  })()`);
}

function selectedSessionExpression(mode) {
  return mode === "chat"
    ? 'document.querySelector(".chat-session-row--selected")?.dataset.sessionId??null'
    : 'document.querySelector(".session-row--selected")?.closest("[data-session-id]")?.dataset.sessionId??null';
}

async function ensureWorkspaceSession(client, sessionId) {
  if ((await client.evaluate(selectedSessionExpression("code"))) === sessionId) return;
  if (await client.evaluate('Boolean(document.querySelector(".sidebar-host")?.hidden)')) {
    await click(
      client,
      ".orbit-workspace-header > button:first-child, .app-topbar button.sidebar-toggle",
    );
  }
  await client.evaluate(`(()=>{
    for(const element of document.querySelectorAll(
      '.session-group__header[aria-expanded=false],.session-group__show-all[aria-expanded=false]'
    ))element.click();
    return true;
  })()`);
  await click(client, `[data-session-id="${sessionId}"] .session-row`);
}

async function ensureChatSession(client, sessionId) {
  if ((await client.evaluate(selectedSessionExpression("chat"))) === sessionId) return;
  if (
    (await client.evaluate('document.querySelector(".app-shell")?.dataset.agentMode')) !==
    "chat"
  ) {
    await click(client, '[data-testid="agent-mode-chat"]');
    await until(
      client,
      'document.querySelector(".app-shell")?.dataset.agentMode==="chat"',
    );
  }
  if (await client.evaluate('Boolean(document.querySelector(".chat-sidebar-host")?.hidden)')) {
    await click(client, ".app-topbar button.sidebar-toggle");
  }
  await client.evaluate(`(()=>{
    for(const element of document.querySelectorAll(
      '.chat-session-group__heading[aria-expanded=false]'
    ))element.click();
    return true;
  })()`);
  await click(client, `[data-session-id="${sessionId}"] .chat-session-row__main`);
}

async function activateScenario(client, style, mode, theme) {
  const session = fixture.sessions[mode];
  await applyPresentation(client, style, theme);
  await api(client, "updateSession", {
    sessionId: session.id,
    title: `Source paste ${style} ${mode} ${Date.now()}`,
  });
  const token = `reload-${style}-${mode}-${Date.now()}`;
  await client.evaluate(`(()=>{
    localStorage.setItem("mingshen.agent-mode",${JSON.stringify(mode)});
    localStorage.setItem("mingshen.theme",${JSON.stringify(theme)});
    globalThis.__composerSourcePasteReload=${JSON.stringify(token)};
    return true;
  })()`);
  await client.send("Page.reload");
  await until(
    client,
    `(
      globalThis.__composerSourcePasteReload===undefined&&
      document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}&&
      document.documentElement.dataset.theme===${JSON.stringify(theme)}&&
      document.querySelector(".app-shell")?.dataset.agentMode===${JSON.stringify(mode)}&&
      Boolean(document.querySelector("[data-testid=chat-composer-input]"))
    )`,
    45000,
  );
  await viewport(client, 1440, 900);
  if (mode === "chat") {
    await ensureChatSession(client, session.id);
  } else {
    await ensureWorkspaceSession(client, session.id);
  }
  await until(client, `${selectedSessionExpression(mode)}===${JSON.stringify(session.id)}`);
  assert.equal(
    await client.evaluate('document.querySelector(".app-shell")?.dataset.agentMode'),
    mode,
    `Expected ${mode} mode before paste`,
  );
  assert.equal(
    await client.evaluate('document.documentElement.dataset.interfaceStyle'),
    style,
    `Expected ${style} style before paste`,
  );
  assert.equal(
    await client.evaluate(
      'Boolean(document.querySelector("[data-testid=chat-view][data-agent-mode="+JSON.stringify(document.querySelector(".app-shell")?.dataset.agentMode)+"]"))',
    ),
    true,
    `Expected a mounted composer for ${mode}`,
  );
  return session;
}

async function runPasteScenario(client, style, mode, theme) {
  const label = `${style}-${mode}-${theme}`;
  await activateScenario(client, style, mode, theme);
  await clearComposer(client);

  await pasteText(client, sourceText);
  await until(
    client,
    `document.querySelector("[data-testid=chat-composer-input]")?.value===${JSON.stringify(sourceText)}`,
  );
  await sleep(700);
  await assertSourceState(client, sourceText, `${label} text paste`);

  await client.send("Input.insertText", { text: typedTail });
  const typedValue = sourceText + typedTail;
  await until(
    client,
    `document.querySelector("[data-testid=chat-composer-input]")?.value===${JSON.stringify(typedValue)}`,
  );
  await sleep(350);
  await assertSourceState(client, typedValue, `${label} native typing`);

  await client.send("Input.imeSetComposition", {
    text: "zhongwen",
    selectionStart: 8,
    selectionEnd: 8,
  });
  await client.send("Input.insertText", { text: imeTail });
  const composedValue = typedValue + imeTail;
  await until(
    client,
    `document.querySelector("[data-testid=chat-composer-input]")?.value===${JSON.stringify(composedValue)}`,
  );
  await sleep(350);
  await assertSourceState(client, composedValue, `${label} emulated IME commit`);
  await capture(client, `${label}-source`);

  await assertPreviewAndRestore(client, composedValue, label);

  await pasteImage(client);
  await sleep(350);
  const imageState = await assertSourceState(client, composedValue, `${label} image paste`);
  assert.equal(imageState.attachments, 1, `${label}: image attachment was not retained`);
  await capture(client, `${label}-image-attachment`);

  await client.evaluate(`(()=>{
    document.querySelector(".draft-attachment button")?.click();
    return true;
  })()`);
  await until(client, 'document.querySelectorAll(".draft-attachment").length===0');
  await assertSourceState(client, composedValue, `${label} attachment removal`);
  await clearComposer(client);

  passed.push(
    `${style}/${mode}: text paste, native typing and IME remain in source; manual preview/edit, image attachment and focus are stable`,
  );
  console.log(`PASS ${passed.length}: ${label}`);
}

async function runQuickChatScenario(client) {
  await viewport(client, 540, 720);
  await until(
    client,
    'Boolean(document.querySelector(".quick-chat [data-testid=chat-composer-input]"))',
  );
  assert.equal(
    await client.evaluate('document.querySelector(".app-shell")?.dataset.agentMode??"chat"'),
    "chat",
    "QuickChat must use the ChatAgent surface",
  );
  await clearComposer(client);
  await pasteText(client, sourceText);
  await until(
    client,
    `document.querySelector("[data-testid=chat-composer-input]")?.value===${JSON.stringify(sourceText)}`,
  );
  await sleep(700);
  await assertSourceState(client, sourceText, "quick-chat text paste");
  await client.send("Input.insertText", { text: typedTail });
  const typedValue = sourceText + typedTail;
  await until(
    client,
    `document.querySelector("[data-testid=chat-composer-input]")?.value===${JSON.stringify(typedValue)}`,
  );
  await assertSourceState(client, typedValue, "quick-chat native typing");
  await capture(client, "orbit-quick-chat-source");
  await assertPreviewAndRestore(client, typedValue, "quick-chat");
  await capture(client, "orbit-quick-chat-restored-source");
  await clearComposer(client);
  passed.push(
    "Orbit QuickChat keeps pasted Markdown/formula text in source with focus and supports manual preview/edit",
  );
}

async function runAttachmentLimitScenarios(client) {
  await activateScenario(client, "simple", "code", "day");
  await clearComposer(client);

  await main.evaluate(`(()=>{
    const ipcMain=process.getBuiltinModule("module")
      .createRequire(process.cwd()+"/package.json")("electron").ipcMain;
    const handlers=ipcMain._invokeHandlers;
    const original=handlers.get("composer:draft-save");
    if(typeof original!=="function")throw new Error("Missing composer draft save handler");
    globalThis.__composerDraftSaveCalls=0;
    globalThis.__composerDraftSaveRestore=()=>{
      handlers.set("composer:draft-save",original);
    };
    handlers.set("composer:draft-save",(...args)=>{
      globalThis.__composerDraftSaveCalls+=1;
      return original(...args);
    });
    return true;
  })()`);
  await client.evaluate(`(()=>{
    globalThis.__composerFileReads=0;
    globalThis.__composerOriginalFileReader=FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL=function(file){
      globalThis.__composerFileReads+=1;
      return globalThis.__composerOriginalFileReader.call(this,file);
    };
    return true;
  })()`);

  const resetBoundaryCounters = async () => {
    await main.evaluate("globalThis.__composerDraftSaveCalls=0;true");
    await client.evaluate("globalThis.__composerFileReads=0;true");
  };
  const assertBlockedBeforePayload = async (label, errorFragment) => {
    await until(
      client,
      `document.querySelector(".composer-error")?.textContent.includes(${JSON.stringify(errorFragment)})`,
    );
    const state = await client.evaluate(`(()=>({
      attachments:document.querySelectorAll(".draft-attachment").length,
      reads:globalThis.__composerFileReads,
      saves:${JSON.stringify(await main.evaluate("globalThis.__composerDraftSaveCalls"))},
    }))()`);
    assert.equal(state.attachments, 0, `${label}: attachment escaped renderer preflight`);
    assert.equal(state.reads, 0, `${label}: FileReader ran after renderer preflight`);
    assert.equal(state.saves, 0, `${label}: draft-save IPC ran after renderer preflight`);
  };

  await resetBoundaryCounters();
  await click(client, '[data-testid="capability-picker-trigger"]');
  await until(client, 'Boolean(document.querySelector("[data-testid=capability-picker-panel]"))');
  await client.evaluate(`(()=>{
    const input=document.querySelector("[data-testid=chat-attachment-input]")
      ??document.querySelector("[data-testid=capability-picker-panel] input[type=file]")
      ??document.querySelector(".composer input[type=file]");
    if(!input)throw new Error("Missing composer file input");
    const transfer=new DataTransfer();
    for(let index=0;index<11;index++){
      transfer.items.add(new File(["x"],"too-many-"+index+".txt",{type:"text/plain"}));
    }
    input.files=transfer.files;
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  })()`);
  await assertBlockedBeforePayload("file input count", "\u4E00\u6B21\u6700\u591A\u53D1\u9001 10 \u4E2A\u9644\u4EF6");

  await resetBoundaryCounters();
  await client.evaluate(`(()=>{
    const transfer=new DataTransfer();
    for(let index=0;index<3;index++){
      transfer.items.add(
        new File([new Uint8Array(20*1024*1024)],"too-large-total-"+index+".bin",{
          type:"application/octet-stream"
        })
      );
    }
    window.dispatchEvent(new DragEvent("drop",{
      bubbles:true,cancelable:true,dataTransfer:transfer
    }));
    return true;
  })()`);
  await assertBlockedBeforePayload("drag total bytes", "\u9644\u4EF6\u603B\u5927\u5C0F\u4E0D\u80FD\u8D85\u8FC7 50 MiB");

  await resetBoundaryCounters();
  await client.evaluate(`(()=>{
    const bytes=new Uint8Array(25*1024*1024+1);
    bytes.set([137,80,78,71,13,10,26,10]);
    const data=new DataTransfer();
    data.items.add(new File([bytes],"too-large-image.png",{type:"image/png"}));
    const target=document.querySelector("[data-testid=chat-composer-input]");
    target.focus({preventScroll:true});
    target.dispatchEvent(new ClipboardEvent("paste",{
      clipboardData:data,bubbles:true,cancelable:true
    }));
    return true;
  })()`);
  await assertBlockedBeforePayload(
    "image paste single bytes",
    "\u8D85\u8FC7\u5355\u6587\u4EF6 25 MiB \u9650\u5236",
  );

  await client.evaluate(`(()=>{
    FileReader.prototype.readAsDataURL=globalThis.__composerOriginalFileReader;
    delete globalThis.__composerOriginalFileReader;
    globalThis.__composerFileReads=0;
    return true;
  })()`);
  await main.evaluate("globalThis.__composerDraftSaveRestore();true");
  await clearComposer(client);
  passed.push(
    "File input, window drop and pasted image reject count/total/single-size overflow with zero FileReader and draft-save IPC calls",
  );
}

async function runQueuedReplacementPreflightScenario(client) {
  const session = await activateScenario(client, "simple", "code", "day");
  await clearComposer(client);
  await pasteText(client, "QUEUE_PREFLIGHT_INITIAL_HOLD");
  await click(client, '[data-testid="chat-composer-send"]');
  await waitForCondition(
    () => heldQueuePreflightResponse !== undefined,
    "held queue-preflight model response",
    45000,
  );
  await until(client, 'Boolean(document.querySelector("[data-testid=chat-queue-add]"))');

  const queuedText = "QUEUE_PREFLIGHT_REPLACE_HEAD";
  await pasteText(client, queuedText);
  await click(client, '[data-testid="chat-queue-add"]');
  await until(
    client,
    `document.querySelector("[data-testid=queued-prompt-count]")?.textContent?.replace(/\\s/g,"")==="1/10"&&document.querySelector("[data-testid=queued-prompt-item]")?.textContent.includes(${JSON.stringify(queuedText)})`,
  );

  await main.evaluate(`(()=>{
    const ipcMain=process.getBuiltinModule("module")
      .createRequire(process.cwd()+"/package.json")("electron").ipcMain;
    const handlers=ipcMain._invokeHandlers;
    const original=handlers.get("chat:queue-update");
    if(typeof original!=="function")throw new Error("Missing queue update handler");
    globalThis.__sourceQueueUpdateCalls=0;
    globalThis.__sourceQueueUpdateRestore=()=>{
      handlers.set("chat:queue-update",original);
    };
    handlers.set("chat:queue-update",(...args)=>{
      globalThis.__sourceQueueUpdateCalls+=1;
      return original(...args);
    });
    return true;
  })()`);
  await client.evaluate(`(()=>{
    globalThis.__sourceQueueFileReads=0;
    globalThis.__sourceQueueOriginalFileReader=FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL=function(file){
      globalThis.__sourceQueueFileReads+=1;
      return globalThis.__sourceQueueOriginalFileReader.call(this,file);
    };
    return true;
  })()`);

  try {
    await client.evaluate(`(()=>{
      const input=document.querySelector("[data-testid=queued-prompt-replace-input]");
      if(!input)throw new Error("Missing queued replacement input");
      globalThis.__sourceQueuePickerCalls=0;
      input.click=function(){globalThis.__sourceQueuePickerCalls+=1;};
      return true;
    })()`);
    await click(client, '[data-testid="queued-prompt-replace-attachments"]');
    await until(client, "globalThis.__sourceQueuePickerCalls===1");
    await client.evaluate(`(()=>{
      const input=document.querySelector("[data-testid=queued-prompt-replace-input]");
      const transfer=new DataTransfer();
      for(let index=0;index<11;index++){
        transfer.items.add(
          new File(["x"],"queue-too-many-"+index+".txt",{type:"text/plain"})
        );
      }
      try{input.files=transfer.files;}catch{
        Object.defineProperty(input,"files",{configurable:true,value:transfer.files});
      }
      input.dispatchEvent(new Event("change",{bubbles:true}));
      return true;
    })()`);
    await until(
      client,
      `document.querySelector("[data-testid=queued-prompt-error]")?.textContent.includes("\\u4E00\\u6B21\\u6700\\u591A\\u53D1\\u9001 10 \\u4E2A\\u9644\\u4EF6")`,
    );
    const fileReads = await client.evaluate("globalThis.__sourceQueueFileReads");
    const queueUpdates = await main.evaluate("globalThis.__sourceQueueUpdateCalls");
    const queue = await api(client, "listQueuedPrompts", session.id);
    assert.equal(fileReads, 0, "Queued replacement must reject before FileReader");
    assert.equal(queueUpdates, 0, "Queued replacement must reject before queue update IPC");
    assert.equal(queue.length, 1, "Queued replacement must retain the original queue item");
    assert.equal(queue[0]?.text, queuedText, "Queued replacement changed the original text");
    assert.deepEqual(queue[0]?.attachments, [], "Queued replacement installed invalid files");
    queuePreflightEvidence = {
      fileReads,
      queueUpdates,
      queueLength: queue.length,
      text: queue[0]?.text,
      attachments: queue[0]?.attachments,
      error: await client.evaluate(
        'document.querySelector("[data-testid=queued-prompt-error]")?.textContent?.trim() ?? ""',
      ),
    };
    await capture(client, "queued-replacement-rejected-before-payload");
  } finally {
    await client.evaluate(`(()=>{
      FileReader.prototype.readAsDataURL=globalThis.__sourceQueueOriginalFileReader;
      delete globalThis.__sourceQueueOriginalFileReader;
      delete globalThis.__sourceQueueFileReads;
      delete globalThis.__sourceQueuePickerCalls;
      return true;
    })()`).catch(() => undefined);
    await main.evaluate(`(()=>{
      globalThis.__sourceQueueUpdateRestore?.();
      delete globalThis.__sourceQueueUpdateRestore;
      delete globalThis.__sourceQueueUpdateCalls;
      return true;
    })()`).catch(() => undefined);
    if (heldQueuePreflightResponse !== undefined) finishHeldQueuePreflight();
  }

  await until(
    client,
    `window.mingshen.getSession(${JSON.stringify(session.id)}).then(session=>session.status==="idle")`,
    45000,
  );
  await click(client, '[data-testid="queued-prompt-delete"]');
  await until(client, '!document.querySelector("[data-testid=queued-prompt-tray]")');
  await clearComposer(client);
  await capture(client, "queued-replacement-preflight-finished");
  passed.push(
    "An in-flight session rejects an oversized queued attachment replacement before FileReader and queue-update IPC while retaining the original queue item",
  );
}

async function writeResult(success, failure = null) {
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        version,
        success,
        passed,
        modelRequests,
        rendererExceptions,
        rendererCrashes,
        serverErrors,
        blockedNetworkAttempts,
        screenshots,
        measurements,
        queuePreflightEvidence,
        ...(failure
          ? {
              failure:
                failure instanceof Error
                  ? (failure.stack ?? failure.message)
                  : String(failure),
            }
          : {}),
        pasteMethod:
          "Synthetic ClipboardEvent with DataTransfer text followed synchronously by document.execCommand(insertText). Native typing and IME use CDP Input commands. No system clipboard is read or written.",
        boundaries: [
          "Isolated temporary Electron profile and project; no normal user profile, database, settings or API key is read.",
          "The local provider fixture is used only to enter a real in-flight state for queue replacement preflight; all other unexpected requests are rejected.",
          "Synthetic clipboard dispatch exercises the application handler and Chromium editing path, not an OS-level clipboard request.",
          "Chromium composition is emulated; physical IME, assistive technology and the full Windows DPI/GPU matrix are not covered.",
          "Code, Work and Chat are covered in both Simple and Orbit at 1440x900; QuickChat is covered at 540x720.",
        ],
      },
      null,
      2,
    ),
  );
  return resultPath;
}

async function close() {
  if (!child) return;
  const current = child;
  const ended =
    current.exitCode !== null
      ? Promise.resolve()
      : new Promise((done) => current.once("exit", done));
  await quick?.close().catch(() => {});
  await primary
    ?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true')
    .catch(() => {});
  await primary?.close().catch(() => {});
  await main?.close().catch(() => {});
  await Promise.race([ended, sleep(7000)]);
  if (current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(5000)]);
  }
  assert.ok(
    current.exitCode !== null || current.signalCode !== null,
    "Electron fixture did not exit",
  );
  child = primary = main = quick = undefined;
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await writeFile(join(project, "fixture.txt"), "Synthetic composer source-paste workspace.\n");
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  fixturePort = server.address().port;

  execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], {
    cwd: resolve("."),
    windowsHide: true,
    stdio: "pipe",
  });

  const mainPort = await availablePort();
  rendererPort = await availablePort();
  while (rendererPort === mainPort) rendererPort = await availablePort();
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
    [`--inspect=${mainPort}`, ".", `--remote-debugging-port=${rendererPort}`],
    {
      cwd: desktop,
      env: environment,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  main = await connect(mainPort, "main");
  await main.evaluate(`(()=>{
    globalThis.__composerSourcePasteFetch=fetch;
    globalThis.fetch=(input,options)=>{
      const url=new URL(typeof input==="string"?input:input.url??String(input));
      if(url.hostname==="127.0.0.1"&&url.port===${JSON.stringify(String(fixturePort))}){
        return globalThis.__composerSourcePasteFetch(input,options);
      }
      if(url.pathname.includes("/rest/v1/rpc/"))return Promise.resolve(Response.json([]));
      return Promise.reject(new Error("Nonlocal synthetic fixture network blocked"));
    };
    return true;
  })()`);

  primary = await connect(rendererPort, "primary");
  await primary.send("Runtime.enable");
  await primary.send("Inspector.enable");
  await primary.send("Network.enable");
  await primary.send("Page.bringToFront");
  await primary.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  await main.evaluate(`(()=>{
    const {BrowserWindow}=process.getBuiltinModule("module")
      .createRequire(process.cwd()+"/package.json")("electron");
    const owned=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes("index.html"));
    if(!owned)throw new Error("Missing owned fixture window");
    owned.webContents.session.webRequest.onBeforeRequest(
      {urls:["http://*/*","https://*/*"]},
      (details,callback)=>{
        const url=new URL(details.url);
        const local=url.hostname==="127.0.0.1"&&url.port===${JSON.stringify(String(fixturePort))};
        callback({cancel:!local});
      }
    );
    return true;
  })()`);

  await until(primary, 'Boolean(document.querySelector(".policy-consents"))', 45000);
  await primary.evaluate(
    'document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true',
  );
  for (const text of ["\u540C\u610F\u5E76\u7EE7\u7EED", "\u5F00\u59CB\u4F7F\u7528"]) {
    const button = `[...document.querySelectorAll(".policy-dialog button")]
      .find(button=>!button.disabled&&button.textContent.trim()===${JSON.stringify(text)})`;
    await until(primary, `Boolean(${button})`);
    await primary.evaluate(`${button}.click();true`);
  }
  await until(primary, '!document.querySelector(".policy-dialog")');

  fixture = await primary.evaluate(`(async()=>{
    for(const server of await window.mingshen.listMcpServers()){
      if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    }
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const saver=await window.mingshen.getTokenSaver();
    await window.mingshen.setTokenSaver({...saver.settings,enabled:false});
    await window.mingshen.configureCompletionNotifications({
      nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false
    });
    const preferences=await window.mingshen.getUiPreferences();
    await window.mingshen.saveUiPreferences({
      ...preferences,
      interfaceStyle:"simple",
      composerRichPaste:true
    });
    const provider=await window.mingshen.createProvider({
      name:"Composer source-paste fixture",
      baseUrl:${JSON.stringify(`http://127.0.0.1:${fixturePort}/v1`)},
      protocol:"openai_responses",
      authMode:"bearer",
      apiKey:"synthetic-composer-source-paste-only",
      keyLabel:"Synthetic fixture",
      neverReveal:true
    });
    const configured=await window.mingshen.createModel({
      providerId:provider.id,
      modelId:"composer-source-paste-fixture",
      displayName:"Composer source-paste fixture",
      contextWindow:128000,
      maxOutputTokens:4096,
      inputModalities:["text","image"],
      toolCalls:false,
      parallelToolCalls:false,
      reasoningLevels:[],
      anthropicNoneBehavior:"disabled"
    });
    const modelId=configured.models[0].id;
    const common={
      providerId:provider.id,
      modelId,
      agentProfileId:"primary",
      reasoningLevel:null,
      permissionMode:"full_access",
      executionMode:"host"
    };
    const code=await window.mingshen.createSession({
      ...common,
      title:"Source paste Code",
      agentMode:"code",
      workspacePath:${JSON.stringify(project)}
    });
    const work=await window.mingshen.createSession({
      ...common,
      title:"Source paste Work",
      agentMode:"work",
      workspacePath:${JSON.stringify(project)}
    });
    const chat=await window.mingshen.createSession({
      ...common,
      title:"Source paste Chat",
      agentMode:"chat",
      workspacePath:null
    });
    await window.mingshen.setProjectMemoryEnabled(code.id,false);
    await window.mingshen.setProjectMemoryEnabled(work.id,false);
    return {
      providerId:provider.id,
      modelId,
      sessions:{code,work,chat}
    };
  })()`);

  await primary.send("Page.reload");
  await until(
    primary,
    'globalThis.__composerSourcePasteReload===undefined&&Boolean(document.querySelector("[data-testid=agent-mode-switcher]"))',
    45000,
  );

  await runAttachmentLimitScenarios(primary);
  await runQueuedReplacementPreflightScenario(primary);

  for (const style of ["simple", "orbit"]) {
    const theme = style === "simple" ? "day" : "night";
    for (const mode of ["code", "work", "chat"]) {
      await runPasteScenario(primary, style, mode, theme);
    }
  }

  await primary.evaluate('window.mingshen.quickChatAction("show")');
  quick = await connect(rendererPort, "quick");
  await quick.send("Runtime.enable");
  await quick.send("Inspector.enable");
  await quick.send("Network.enable");
  await quick.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await runQuickChatScenario(quick);
  await primary.evaluate('window.mingshen.quickChatAction("hide")').catch(() => {});
  await quick.close().catch(() => {});
  quick = undefined;

  assert.equal((await primary.evaluate("window.mingshen.getAppInfo()")).version, version);
  const chatModelRequests = modelRequests.filter((request) => request.kind === "chat");
  const titleModelRequests = modelRequests.filter((request) => request.kind === "title");
  assert.equal(
    chatModelRequests.length,
    1,
    "Only the held queue-preflight chat request may reach the local fixture",
  );
  assert.equal(
    titleModelRequests.length,
    0,
    "The queue-preflight session already has a title and must not request title generation",
  );
  assert.ok(queuePreflightEvidence, "Missing queued replacement preflight evidence");
  assert.equal(serverErrors.length, 0, "The local fixture server must not record errors");
  assert.deepEqual(rendererExceptions, [], "Renderer exceptions must remain empty");
  assert.deepEqual(rendererCrashes, [], "Renderer crashes must remain empty");

  const outputPath = await writeResult(true);
  console.log(
    JSON.stringify(
      {
        version,
        passed,
        checks: passed.length,
        screenshots: screenshots.length,
        measurements: measurements.length,
        modelRequestCount: modelRequests.length,
        chatModelRequestCount: chatModelRequests.length,
        titleModelRequestCount: titleModelRequests.length,
        rendererExceptionCount: rendererExceptions.length,
        rendererCrashCount: rendererCrashes.length,
        resultPath: outputPath,
      },
      null,
      2,
    ),
  );
} catch (cause) {
  if (primary) {
    await capture(primary, "failure").catch(() => {});
  }
  if (rendererExceptions.length === 0 && cause instanceof Error) {
    rendererExceptions.push({ surface: "driver", message: cause.message });
  }
  await writeResult(false, cause).catch(() => {});
  console.error(
    JSON.stringify(
      {
        passed,
        modelRequests: modelRequests.map((request) => ({
          url: request.url,
          method: request.method,
        })),
        rendererExceptions,
        rendererCrashes,
        serverErrors,
        resultPath,
      },
      null,
      2,
    ),
  );
  throw cause;
} finally {
  await close().catch(() => {});
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  const local = relative(resolve(tmpdir()), temporary);
  assert.ok(
    local &&
      !local.startsWith("..") &&
      !isAbsolute(local) &&
      local.startsWith("mingshen-composer-source-paste-"),
    "Unsafe composer source-paste cleanup path",
  );
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
