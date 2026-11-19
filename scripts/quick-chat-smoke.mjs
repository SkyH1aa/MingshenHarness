import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const desktop = resolve("apps/desktop");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-quick-chat-"));
const profile = join(temporary, "profile");
const evidence = resolve(".impeccable/review", `v133-quick-chat-${Date.now()}`);
const passed = [];
const skipped = [];
const expectedDenials = [];
const errors = [];
const screenshots = [];
const layoutMeasurements = [];
const requests = [];
const shortcutEvidence = {};
const LEASE_MS = 10 * 60 * 1000;
const MAIN_INSPECT_PORT = 9472;
const RENDERER_DEBUG_PORT = 9471;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const displayShortcut = (accelerator) => accelerator.replace(/\bControl\b/g, "Ctrl");

let child;
let mainInspector;
let mainRenderer;
let quickRenderer;
let heldResponse;

const finish = (response, text = "", output) => {
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
        usage: { input_tokens: 2000, output_tokens: 500, total_tokens: 2500 },
      },
    })}\n\n`,
  );
};

const longReply = [
  "# Quick Chat 验证",
  "",
  "这是一条用于验证小窗口长回复、Markdown 排版与滚动表现的中文回复。",
  "",
  "| 项目 | 状态 |",
  "| --- | --- |",
  "| 流式输出 | 已接收 |",
  "| 窗口布局 | 待截图检查 |",
  "| 文件权限 | 只读附件 |",
  "",
  "> 会话只在 10 分钟租约内复用，隐藏窗口不会删除历史。",
  "",
  "```text",
  "QUICK_LONG_RESPONSE_END",
  "```",
].join("\n");

const server = createServer(async (request, response) => {
  response.on("error", () => undefined);
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const serialized = JSON.stringify(body);
    if (/会话标题生成|conversation title/i.test(serialized)) {
      finish(response, "Quick Chat verification");
      return;
    }

    requests.push(body);
    const latestUser = (Array.isArray(body.input) ? body.input : [])
      .filter((item) => item.role === "user")
      .at(-1);
    const currentInput = JSON.stringify(latestUser ?? body.input ?? "");
    if (currentInput.includes("QUICK_HOLD")) {
      heldResponse = response;
      return;
    }
    if (currentInput.includes("QUICK_LONG")) {
      finish(response, longReply);
      return;
    }
    if (currentInput.includes("QUICK_ATTACHMENT")) {
      finish(response, "只读附件已解析，未读取任何本地路径。QUICK_ATTACHMENT_COMPLETE");
      return;
    }
    finish(response, "QUICK_FIXTURE_COMPLETE");
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

async function connectPage(surface, timeout = 30_000) {
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

async function until(client, expression, timeout = 30_000) {
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

function api(client, name, ...args) {
  return client.evaluate(
    `window.mingshen.${name}(${args.map((value) => JSON.stringify(value) ?? "undefined").join(",")})`,
  );
}

async function fillQuick(value) {
  const selector = 'textarea[aria-label="消息输入框"]';
  await until(
    quickRenderer,
    `Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`,
  );
  await quickRenderer.evaluate(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(value)}}));
    input.focus();
    return true;
  })()`);
}

async function clickQuick(selector) {
  await until(
    quickRenderer,
    `Boolean(document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled)`,
  );
  await quickRenderer.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).click();true`,
  );
}

async function capture(client, name, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until(client, 'document.readyState==="complete"');
  await sleep(220);
  const layout = await client.evaluate(`(()=>{
    const composer=document.querySelector(".composer");
    const rect=composer?.getBoundingClientRect();
    const pin=document.querySelector('[data-testid="quick-chat-pin"]');
    const pinRect=pin?.getBoundingClientRect();
    const bar=document.querySelector(".quick-chat__bar");
    const barRect=bar?.getBoundingClientRect();
    return {
      surface:document.body.dataset.surface??"main",
      overflow: document.documentElement.scrollWidth>innerWidth+2,
      composer: rect?{left:rect.left,right:rect.right,width:rect.width,viewport:innerWidth}:null,
      pin: pinRect?{left:pinRect.left,right:pinRect.right,width:pinRect.width,height:pinRect.height,viewport:innerWidth}:null,
      bar: barRect?{height:barRect.height}:null,
      conflictButtons:[...document.querySelectorAll(".composer-error--draft-conflict > button")].map(node=>{
        const bounds=node.getBoundingClientRect();
        return {text:node.textContent,left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,height:bounds.height,viewportHeight:innerHeight};
      })
    };
  })()`);
  assert.equal(layout.overflow, false, `Horizontal overflow: ${name}`);
  if (layout.composer) {
    assert.ok(layout.composer.left >= -1, `Composer left overflow: ${name}`);
    assert.ok(
      layout.composer.right <= layout.composer.viewport + 2,
      `Composer right overflow: ${name}`,
    );
    assert.ok(layout.composer.width > 240, `Composer too narrow: ${name}`);
  }
  if (layout.surface === "quick-chat") {
    assert.ok(layout.pin, `Quick Chat pin button is missing: ${name}`);
    assert.ok(layout.bar, `Quick Chat toolbar is missing: ${name}`);
    assert.ok(layout.pin.width >= 30, `Quick Chat pin target is too narrow: ${name}`);
    assert.ok(layout.pin.height >= 30, `Quick Chat pin target is too short: ${name}`);
    assert.ok(layout.pin.left >= -1, `Quick Chat pin overlaps the left edge: ${name}`);
    assert.ok(layout.pin.right <= layout.pin.viewport + 1, `Quick Chat pin clips: ${name}`);
    assert.ok(layout.bar?.height <= 53, `Quick Chat toolbar grew unexpectedly: ${name}`);
  }
  for (const button of layout.conflictButtons) {
    assert.ok(button.height >= 30, `Draft recovery button is too small: ${JSON.stringify(button)}`);
    assert.ok(button.top >= 0 && button.bottom <= height - 4, `Draft recovery button is clipped: ${JSON.stringify(button)}`);
  }
  layoutMeasurements.push({ name, width, height, ...layout });
  const image = await client.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
}

async function completeFirstRun() {
  await until(
    mainRenderer,
    'Boolean(document.querySelector(".policy-consents, .app-shell, .setup-shell"))',
    60_000,
  );
  if (await mainRenderer.evaluate('Boolean(document.querySelector(".policy-consents"))')) {
    await mainRenderer.evaluate(
      'document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true',
    );
    for (const text of ["同意并继续", "开始使用"]) {
      const button = `[...document.querySelectorAll(".policy-dialog button")].find(button=>!button.disabled&&button.textContent.trim()===${JSON.stringify(text)})`;
      await until(mainRenderer, `Boolean(${button})`);
      await mainRenderer.evaluate(`${button}.click();true`);
    }
    await until(mainRenderer, '!document.querySelector(".policy-dialog")');
  }
  await until(mainRenderer, 'Boolean(document.querySelector(".app-shell, .setup-shell"))', 60_000);
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

  const deadline = Date.now() + 30_000;
  let inspectorTarget;
  while (Date.now() < deadline) {
    try {
      inspectorTarget = (await debuggerTargets(MAIN_INSPECT_PORT)).find(
        (target) => target.webSocketDebuggerUrl,
      );
      if (inspectorTarget) break;
    } catch {
      // Electron inspector is not ready yet.
    }
    await sleep(100);
  }
  assert.ok(inspectorTarget, "Main process inspector did not start");
  mainInspector = await connectTarget(inspectorTarget, "main-process");
  await mainInspector.evaluate(
    'globalThis.__quickFetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__quickFetch(url,options);true',
  );
  mainRenderer = await connectPage("main", 60_000);
  await completeFirstRun();
}

async function close() {
  if (!child) return;
  const current = child;
  const ended =
    current.exitCode !== null
      ? Promise.resolve()
      : new Promise((done) => current.once("exit", done));
  await mainRenderer
    ?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true')
    .catch(() => undefined);
  quickRenderer?.close();
  mainRenderer?.close();
  mainInspector?.close();
  await Promise.race([ended, sleep(7000)]);
  if (current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(5000)]);
  }
  assert.ok(
    current.exitCode !== null || current.signalCode !== null,
    "Electron fixture did not exit",
  );
  child = undefined;
  mainInspector = undefined;
  mainRenderer = undefined;
  quickRenderer = undefined;
}

async function browserWindows() {
  return mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module")
      .createRequire(process.cwd()+"/package.json")("electron");
    return electron.BrowserWindow.getAllWindows().map(window=>({
      surface:window.webContents.getURL()
        ?new URL(window.webContents.getURL()).searchParams.get("surface")??"main"
        :"loading",
      visible:window.isVisible(),
      focused:window.isFocused(),
      alwaysOnTop:window.isAlwaysOnTop(),
      minimized:window.isMinimized(),
      bounds:window.getBounds(),
      minimum:window.getMinimumSize(),
      menuVisible:window.isMenuBarVisible()
    }));
  })()`);
}

function pressGlobalShortcut(accelerator) {
  const keys = accelerator.split("+").map((key) => {
    if (key === "Control") return 0x11;
    if (key === "Alt") return 0x12;
    if (key === "Shift") return 0x10;
    if (/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return 0x6f + Number(key.slice(1));
    if (/^[A-Z0-9]$/.test(key)) return key.charCodeAt(0);
    throw new Error(`Unsupported fixture key: ${key}`);
  });
  const commands = [
    'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class QuickChatKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }\'',
    ...keys.flatMap((key) => [
      `[QuickChatKeys]::keybd_event(${key},0,0,[UIntPtr]::Zero)`,
      "[System.Threading.Thread]::Sleep(35)",
    ]),
    ...keys.toReversed().flatMap((key) => [
      `[QuickChatKeys]::keybd_event(${key},0,2,[UIntPtr]::Zero)`,
      "[System.Threading.Thread]::Sleep(35)",
    ]),
  ];
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", commands.join("\n")], {
    windowsHide: true,
    stdio: "pipe",
    timeout: 15_000,
  });
}

async function dispatchRecordedShortcut(client, accelerator) {
  const parts = accelerator.split("+");
  const modifierFlags = { Control: 2, Alt: 1, Shift: 8 };
  const modifierKeys = {
    Control: { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 },
    Alt: { key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18 },
    Shift: { key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 },
  };
  const modifiers = parts.filter((part) => part in modifierFlags);
  const key = parts.at(-1);
  assert.ok(key && !(key in modifierFlags), `Invalid recorded shortcut: ${accelerator}`);
  let currentModifiers = 0;
  for (const modifier of modifiers) {
    currentModifiers |= modifierFlags[modifier];
    await client.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      ...modifierKeys[modifier],
      modifiers: currentModifiers,
    });
  }
  const windowsVirtualKeyCode = /^F(?:[1-9]|1\d|2[0-4])$/.test(key)
    ? 111 + Number(key.slice(1))
    : key.charCodeAt(0);
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: /^F(?:[1-9]|1\d|2[0-4])$/.test(key) ? key : `Key${key}`,
    modifiers: currentModifiers,
    windowsVirtualKeyCode,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: /^F(?:[1-9]|1\d|2[0-4])$/.test(key) ? key : `Key${key}`,
    modifiers: currentModifiers,
    windowsVirtualKeyCode,
  });
  for (const modifier of modifiers.toReversed()) {
    currentModifiers &= ~modifierFlags[modifier];
    await client.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      ...modifierKeys[modifier],
      modifiers: currentModifiers,
    });
  }
}

async function waitForWindow(surface, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let windows;
  while (Date.now() < deadline) {
    windows = await browserWindows();
    const target = windows.find((window) => window.surface === surface);
    if (target && predicate(target)) return target;
    await sleep(100);
  }
  throw new Error(`Window state timed out for ${surface}: ${JSON.stringify(windows)}`);
}

async function assertShortcutWarningGeometry(label) {
  const geometry = await mainRenderer.evaluate(`(()=>{
    const warning=document.querySelector('[data-testid="desktop-shortcut-warning"]');
    const icon=warning?.querySelector("svg");
    const caption=warning?.closest(".desktop-caption");
    if(!warning||!icon||!caption)return null;
    const warningRect=warning.getBoundingClientRect();
    const iconRect=icon.getBoundingClientRect();
    const captionRect=caption.getBoundingClientRect();
    return {
      warning:{left:warningRect.left,top:warningRect.top,width:warningRect.width,height:warningRect.height},
      icon:{left:iconRect.left,top:iconRect.top,width:iconRect.width,height:iconRect.height},
      caption:{top:captionRect.top,height:captionRect.height},
      interfaceStyle:document.documentElement.dataset.interfaceStyle??"simple"
    };
  })()`);
  assert.ok(geometry, `Shortcut warning is missing: ${label}`);
  const iconCenterX = geometry.icon.left + geometry.icon.width / 2;
  const iconCenterY = geometry.icon.top + geometry.icon.height / 2;
  const warningCenterX = geometry.warning.left + geometry.warning.width / 2;
  const warningCenterY = geometry.warning.top + geometry.warning.height / 2;
  assert.ok(
    Math.abs(iconCenterX - warningCenterX) <= 1,
    `Shortcut warning icon is horizontally off-centre: ${label} ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    Math.abs(iconCenterY - warningCenterY) <= 1,
    `Shortcut warning icon is vertically off-centre: ${label} ${JSON.stringify(geometry)}`,
  );
  const expectedSize =
    geometry.interfaceStyle === "orbit"
      ? { width: 32, height: 36 }
      : { width: 34, height: 34 };
  assert.ok(
    Math.abs(geometry.warning.width - expectedSize.width) <= 1 &&
      Math.abs(geometry.warning.height - expectedSize.height) <= 1,
    `Shortcut warning does not retain its fixed hit-box: ${label} ${JSON.stringify(geometry)}`,
  );
  assert.ok(
    geometry.warning.top >= geometry.caption.top - 1 &&
      geometry.warning.top + geometry.warning.height <= geometry.caption.top + geometry.caption.height + 1,
    `Shortcut warning escapes the title bar: ${label} ${JSON.stringify(geometry)}`,
  );
  layoutMeasurements.push({ name: `${label}-shortcut-warning`, ...geometry });
  return geometry;
}

async function crashQuickChatRenderer() {
  return mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module")
      .createRequire(process.cwd()+"/package.json")("electron");
    const window=electron.BrowserWindow.getAllWindows().find(candidate=>
      new URL(candidate.webContents.getURL()||"about:blank").searchParams.get("surface")==="quick-chat"
    );
    if(!window)return false;
    window.webContents.forcefullyCrashRenderer();
    return true;
  })()`);
}

async function expectQuickDenied(name, args) {
  const denied = await quickRenderer.evaluate(`(async()=>{
    try {
      await window.mingshen.${name}(${args.map((value) => JSON.stringify(value)).join(",")});
      return false;
    } catch {
      return true;
    }
  })()`);
  assert.equal(denied, true, `Quick Chat unexpectedly allowed ${name}`);
  expectedDenials.push(name);
}

async function waitQuickEvent(runId, terminalTypes, timeout = 120_000) {
  await until(
    quickRenderer,
    `globalThis.__quickEvents?.some(event=>event.runId===${JSON.stringify(runId)}&&${JSON.stringify(terminalTypes)}.includes(event.type))`,
    timeout,
  );
  return quickRenderer.evaluate(
    `globalThis.__quickEvents.find(event=>event.runId===${JSON.stringify(runId)}&&${JSON.stringify(terminalTypes)}.includes(event.type))`,
  );
}

try {
  await mkdir(evidence, { recursive: true });
  execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], {
    windowsHide: true,
    stdio: "pipe",
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));

  await launch();
  const defaultShortcutState = await api(mainRenderer, "getDesktopShortcutSettings");
  assert.deepEqual(defaultShortcutState.settings, {
    quickChat: "Control+M",
    toggleMain: "Control+Alt+L",
  });
  shortcutEvidence.defaults = defaultShortcutState.settings;
  await mainRenderer.evaluate(
    'localStorage.setItem("mingshen.theme","day");document.documentElement.dataset.theme="day";true',
  );
  await mainRenderer.evaluate(`(async()=>{
    await window.mingshen.configureCompletionNotifications({
      nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false
    }).catch(()=>undefined);
    return true;
  })()`);

  const noModel = await api(mainRenderer, "quickChatAction", "show");
  assert.ok(noModel, "Quick Chat did not return its initial state");
  assert.equal(noModel.session, null);
  assert.ok(noModel.error, "Missing-model state must expose a configuration error");
  quickRenderer = await connectPage("quick-chat", 60_000);
  await until(quickRenderer, 'Boolean(document.querySelector(".quick-chat__unavailable"))');
  const initialWindow = await waitForWindow("quick-chat", (window) => window.visible);
  assert.equal(noModel.pinned, false);
  assert.equal(initialWindow.alwaysOnTop, false);
  assert.ok(
    initialWindow.bounds.width >= 400 && initialWindow.bounds.width <= 600,
    `Unexpected Quick Chat width: ${JSON.stringify(initialWindow)}`,
  );
  assert.ok(
    initialWindow.bounds.height >= 460 && initialWindow.bounds.height <= 760,
    `Unexpected Quick Chat height: ${JSON.stringify(initialWindow)}`,
  );
  assert.deepEqual(initialWindow.minimum, [400, 460]);
  await capture(quickRenderer, "quick-chat-no-model", 480, 680);
  passed.push("Quick Chat opens its real compact window in an isolated profile and explains missing model configuration");

  const provider = await api(mainRenderer, "createProvider", {
    name: "Local Quick Chat fixture",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    protocol: "openai_responses",
    authMode: "bearer",
    apiKey: "quick-chat-local-fixture-only",
    keyLabel: "Fixture",
    neverReveal: true,
  });
  const configured = await api(mainRenderer, "createModel", {
    providerId: provider.id,
    modelId: "quick-chat-fixture",
    displayName: "Quick Chat fixture",
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    inputModalities: ["text", "image"],
    toolCalls: true,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  assert.ok(configured.models[0]?.id);
  await mainRenderer.send("Page.reload");
  await until(mainRenderer, 'Boolean(document.querySelector(".app-shell"))', 60_000);

  const first = await api(mainRenderer, "quickChatAction", "show");
  assert.ok(first?.session, "Configured Quick Chat must create a Chat session");
  assert.equal(first.session.agentMode, "chat");
  assert.equal(first.session.workspacePath, null);
  assert.equal(first.session.permissionMode, "request_approval");
  assert.equal(first.session.executionMode, "host");
  assert.equal(first.session.patchOnly, false);
  assert.ok(first.expiresAt);
  const remaining = first.expiresAt - Date.now();
  assert.ok(
    remaining > LEASE_MS - 5000 && remaining <= LEASE_MS + 1000,
    `Unexpected Quick Chat lease: ${remaining}`,
  );
  await until(
    quickRenderer,
    `window.mingshen.getQuickChatState().then(state=>state.session?.id===${JSON.stringify(first.session.id)})`,
  );
  await until(quickRenderer, 'Boolean(document.querySelector(".quick-chat .composer"))');
  await capture(quickRenderer, "quick-chat-new-day", 480, 680);
  assert.equal(first.pinned, false);
  await clickQuick('[data-testid="quick-chat-pin"]');
  await until(
    quickRenderer,
    'document.querySelector(\'[data-testid="quick-chat-pin"]\')?.getAttribute("aria-pressed")==="true"',
  );
  const pinnedWindow = await waitForWindow(
    "quick-chat",
    (window) => window.visible && window.alwaysOnTop,
  );
  assert.equal(pinnedWindow.alwaysOnTop, true);
  assert.equal((await api(mainRenderer, "getQuickChatState")).pinned, true);
  await capture(quickRenderer, "quick-chat-pinned", 480, 680);
  await clickQuick('[data-testid="quick-chat-pin"]');
  await until(
    quickRenderer,
    'document.querySelector(\'[data-testid="quick-chat-pin"]\')?.getAttribute("aria-pressed")==="false"',
  );
  const unpinnedWindow = await waitForWindow(
    "quick-chat",
    (window) => window.visible && !window.alwaysOnTop,
  );
  assert.equal(unpinnedWindow.alwaysOnTop, false);
  assert.equal((await api(mainRenderer, "getQuickChatState")).pinned, false);
  await clickQuick('[data-testid="quick-chat-pin"]');
  await until(
    quickRenderer,
    'document.querySelector(\'[data-testid="quick-chat-pin"]\')?.getAttribute("aria-pressed")==="true"',
  );
  await waitForWindow("quick-chat", (window) => window.visible && window.alwaysOnTop);
  passed.push("The Quick Chat pin button updates renderer state and the real BrowserWindow always-on-top flag in both directions");

  const beforeToggle = await api(mainRenderer, "getQuickChatState");
  const hiddenByToggle = await api(mainRenderer, "quickChatAction", "toggle");
  assert.ok(hiddenByToggle, "Toggle-to-hide must return the current Quick Chat state");
  assert.equal(hiddenByToggle.session.id, first.session.id);
  assert.equal(hiddenByToggle.expiresAt, beforeToggle.expiresAt);
  await waitForWindow("quick-chat", (window) => !window.visible);
  await sleep(1100);
  const hiddenLease = await api(mainRenderer, "getQuickChatState");
  assert.equal(
    hiddenLease.expiresAt,
    beforeToggle.expiresAt,
    "Hiding Quick Chat and reading its state must not renew the sliding lease",
  );
  const shownByToggle = await api(mainRenderer, "quickChatAction", "toggle");
  assert.ok(shownByToggle, "Toggle-to-show must return the current Quick Chat state");
  assert.equal(shownByToggle.session.id, first.session.id);
  assert.ok(
    shownByToggle.expiresAt > hiddenLease.expiresAt,
    "Toggle-to-show must renew the sliding lease through the standard show path",
  );
  await waitForWindow("quick-chat", (window) => window.visible && window.focused);

  const hiddenAgain = await api(mainRenderer, "quickChatAction", "toggle");
  assert.ok(hiddenAgain);
  assert.equal(hiddenAgain.expiresAt, shownByToggle.expiresAt);
  await waitForWindow("quick-chat", (window) => !window.visible);
  await sleep(1100);
  const shownExplicitly = await api(mainRenderer, "quickChatAction", "show");
  assert.ok(shownExplicitly);
  assert.ok(
    shownExplicitly.expiresAt > hiddenAgain.expiresAt,
    "An explicit show after a hidden toggle must renew the lease without creating a new session",
  );
  assert.equal(shownExplicitly.session.id, first.session.id);
  await waitForWindow("quick-chat", (window) => window.visible && window.focused);

  const beforeConcurrentToggle = await api(mainRenderer, "getQuickChatState");
  const concurrentToggles = await mainRenderer.evaluate(`Promise.all([
    window.mingshen.quickChatAction("toggle"),
    window.mingshen.quickChatAction("toggle")
  ])`);
  assert.equal(concurrentToggles.length, 2);
  assert.ok(concurrentToggles.every(Boolean), "Concurrent toggle actions must both resolve");
  assert.ok(
    concurrentToggles.some((state) => state.expiresAt > beforeConcurrentToggle.expiresAt),
    "One of two concurrent toggles must show and renew instead of being coalesced away",
  );
  await waitForWindow("quick-chat", (window) => window.visible && window.focused);
  shortcutEvidence.toggle = {
    hiddenWithoutRenewal: true,
    toggleShowRenewed: true,
    explicitShowRenewed: true,
    concurrentPairSurvived: true,
  };
  passed.push(
    "Quick Chat toggle never renews while hidden, renews on the next show, and serializes a concurrent pair without losing an action",
  );

  const beforeInterleavedHide = await api(mainRenderer, "getQuickChatState");
  await api(mainRenderer, "quickChatAction", "hide");
  await waitForWindow("quick-chat", (window) => !window.visible);
  const hiddenBeforeInterleavedShow = await api(mainRenderer, "getQuickChatState");
  assert.equal(
    hiddenBeforeInterleavedShow.expiresAt,
    beforeInterleavedHide.expiresAt,
    "The queued hide must not renew the lease",
  );
  const showHideShow = await mainRenderer.evaluate(`Promise.all([
    window.mingshen.quickChatAction("show"),
    window.mingshen.quickChatAction("hide"),
    window.mingshen.quickChatAction("show")
  ])`);
  assert.equal(showHideShow.length, 3);
  assert.ok(showHideShow[0], "The first show in show/hide/show must resolve");
  assert.equal(showHideShow[1], null, "The middle hide must resolve as a completed visibility action");
  assert.ok(showHideShow[2], "The final show in show/hide/show must resolve");
  assert.equal(showHideShow[0].session.id, first.session.id);
  assert.equal(showHideShow[2].session.id, first.session.id);
  assert.ok(
    showHideShow[2].expiresAt > hiddenBeforeInterleavedShow.expiresAt,
    "The latest show must renew the lease after the queued hide",
  );
  await waitForWindow("quick-chat", (window) => window.visible && window.focused);
  shortcutEvidence.interleavedVisibility = {
    showHideShow: "latest-show-visible",
    hiddenLeaseUnchanged: true,
  };
  passed.push(
    "Concurrent show/hide/show is processed in order, keeps the hidden interval out of lease renewal and leaves the latest show visible",
  );

  const beforeHideShow = await api(mainRenderer, "getQuickChatState");
  const hideShow = await mainRenderer.evaluate(`Promise.all([
    window.mingshen.quickChatAction("hide"),
    window.mingshen.quickChatAction("show")
  ])`);
  assert.equal(hideShow.length, 2);
  assert.equal(hideShow[0], null);
  assert.ok(hideShow[1]);
  assert.equal(hideShow[1].session.id, first.session.id);
  assert.ok(
    hideShow[1].expiresAt > beforeHideShow.expiresAt,
    "The trailing show must renew after the queued hide",
  );
  await waitForWindow("quick-chat", (window) => window.visible && window.focused);
  passed.push("Concurrent hide/show resolves with the trailing show visible and its lease renewed");

  await quickRenderer.evaluate(
    'globalThis.__quickEvents=[];window.mingshen.onRuntimeEvent(event=>globalThis.__quickEvents.push(event));true',
  );
  await sleep(80);
  const [renewed, created] = await mainRenderer.evaluate(`Promise.all([
    window.mingshen.quickChatAction("show"),
    window.mingshen.quickChatAction("new")
  ])`);
  assert.equal(renewed.session.id, first.session.id);
  assert.ok(
    renewed.expiresAt > first.expiresAt,
    "Showing the leased Quick Chat again must renew its sliding expiry",
  );
  assert.ok(created?.session);
  assert.notEqual(created.session.id, first.session.id);
  passed.push("Quick Chat reuses the current Chat session, renews its sliding lease and queues a concurrent New action instead of swallowing it");

  assert.equal((await api(mainRenderer, "getSession", first.session.id)).agentMode, "chat");
  await until(
    quickRenderer,
    `window.mingshen.getQuickChatState().then(state=>state.session?.id===${JSON.stringify(created.session.id)})`,
  );
  passed.push("New Quick Chat creates a fresh conversation while preserving the previous Chat history");

  const currentSession = created.session;
  await fillQuick("QUICK_DRAFT_SYNC_A");
  const quickDraft = await (async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const draft = await api(mainRenderer, "getComposerDraft", currentSession.id);
      if (draft?.text === "QUICK_DRAFT_SYNC_A") return draft;
      await sleep(100);
    }
    throw new Error("Quick Chat draft did not persist across windows");
  })();
  const mainRevision = `quick-main-${Date.now()}`;
  await api(mainRenderer, "saveComposerDraft", {
    sessionId: currentSession.id,
    revision: mainRevision,
    text: "QUICK_DRAFT_SYNC_B",
    formatted: false,
    attachmentIds: quickDraft.attachments.map((attachment) => attachment.id),
    notificationDraftIds: quickDraft.notificationDraftIds,
  });
  await quickRenderer.evaluate(
    'window.dispatchEvent(new FocusEvent("focus"));window.dispatchEvent(new Event("focus"));true',
  );
  await until(
    quickRenderer,
    `document.querySelector('textarea[aria-label="消息输入框"]')?.value==="QUICK_DRAFT_SYNC_B"`,
  );
  await fillQuick("QUICK_DRAFT_SYNC_C");
  await until(
    quickRenderer,
    `window.mingshen.getComposerDraft(${JSON.stringify(currentSession.id)}).then(draft=>draft?.text==="QUICK_DRAFT_SYNC_C")`,
  );
  const latestDraft = await api(
    mainRenderer,
    "getComposerDraft",
    currentSession.id,
  );
  await api(
    mainRenderer,
    "clearComposerDraft",
    currentSession.id,
    latestDraft.revision,
  );
  await until(
    quickRenderer,
    `document.querySelector('textarea[aria-label="消息输入框"]')?.value===""`,
  );
  passed.push("Composer drafts synchronize in both directions between the main window and Quick Chat");

  await fillQuick("QUICK_BEFORE_CLEAR");
  await until(
    quickRenderer,
    `window.mingshen.getComposerDraft(${JSON.stringify(currentSession.id)}).then(draft=>draft?.text==="QUICK_BEFORE_CLEAR")`,
  );
  await fillQuick("");
  await until(
    quickRenderer,
    `window.mingshen.getComposerDraft(${JSON.stringify(currentSession.id)}).then(draft=>draft===null)`,
  );
  await fillQuick("QUICK_AFTER_CLEAR");
  await until(
    quickRenderer,
    `window.mingshen.getComposerDraft(${JSON.stringify(currentSession.id)}).then(draft=>draft?.text==="QUICK_AFTER_CLEAR")`,
  );
  const afterClear = await api(mainRenderer, "getComposerDraft", currentSession.id);
  await api(mainRenderer, "clearComposerDraft", currentSession.id, afterClear.revision);
  await until(
    quickRenderer,
    'document.querySelector(\'textarea[aria-label="消息输入框"]\')?.value===""',
  );
  passed.push("Clearing the complete draft and typing again does not create a false multi-window conflict");

  const conflictingRevision = `quick-conflict-${Date.now()}`;
  await quickRenderer.evaluate(`(async()=>{
    const saved=window.mingshen.saveComposerDraft({
      sessionId:${JSON.stringify(currentSession.id)},baseRevision:null,
      revision:${JSON.stringify(conflictingRevision)},text:"QUICK_REMOTE_CONFLICT",
      formatted:false,attachmentIds:[],notificationDraftIds:[]
    });
    const input=document.querySelector('textarea[aria-label="消息输入框"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"QUICK_LOCAL_CONFLICT");
    input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:"QUICK_LOCAL_CONFLICT"}));
    await saved;
    return true;
  })()`);
  await until(
    quickRenderer,
    'document.body.innerText.includes("用本地内容覆盖") && document.body.innerText.includes("载入最新草稿")',
  );
  assert.equal(
    (await api(mainRenderer, "getComposerDraft", currentSession.id)).text,
    "QUICK_REMOTE_CONFLICT",
  );
  assert.equal(
    await quickRenderer.evaluate('document.querySelector(\'textarea[aria-label="消息输入框"]\').value'),
    "QUICK_LOCAL_CONFLICT",
  );
  await capture(quickRenderer, "quick-chat-draft-conflict", 480, 680);
  await quickRenderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".composer-error button")].find(node=>node.textContent.includes("用本地内容覆盖"));
    if(!button)throw new Error("Missing explicit draft overwrite action");
    button.click();return true;
  })()`);
  await until(
    quickRenderer,
    `window.mingshen.getComposerDraft(${JSON.stringify(currentSession.id)}).then(draft=>draft?.text==="QUICK_LOCAL_CONFLICT")`,
  );
  await until(quickRenderer, '!document.body.innerText.includes("用本地内容覆盖")');
  const resolvedDraft = await api(mainRenderer, "getComposerDraft", currentSession.id);
  await api(mainRenderer, "clearComposerDraft", currentSession.id, resolvedDraft.revision);
  await until(
    quickRenderer,
    'document.querySelector(\'textarea[aria-label="消息输入框"]\')?.value===""',
  );
  passed.push("Conflicting window saves preserve both drafts until the user explicitly chooses to replace the latest saved version");

  await quickRenderer.evaluate(
    'globalThis.__quickDraftChanges=[];window.mingshen.onComposerDraftChanged(event=>globalThis.__quickDraftChanges.push(event));true',
  );
  const foreignDraftRevision = `quick-foreign-${Date.now()}`;
  await api(mainRenderer, "saveComposerDraft", {
    sessionId: first.session.id,
    revision: foreignDraftRevision,
    text: "Draft for a different Chat session",
    formatted: false,
    attachmentIds: [],
    notificationDraftIds: [],
  });
  await sleep(180);
  assert.equal(
    await quickRenderer.evaluate(
      `globalThis.__quickDraftChanges.filter(event=>event.sessionId===${JSON.stringify(first.session.id)}).length`,
    ),
    0,
    "Quick Chat must not receive draft change metadata for another Chat conversation",
  );
  await api(mainRenderer, "clearComposerDraft", first.session.id, foreignDraftRevision);
  passed.push("Quick Chat only receives composer draft metadata for its active conversation");

  await fillQuick("QUICK_LONG");
  await clickQuick(".composer .send-button");
  await until(
    quickRenderer,
    "globalThis.__quickEvents.some(event=>event.type==='run_started')",
  );
  const longRunId = await quickRenderer.evaluate(
    "globalThis.__quickEvents.filter(event=>event.type==='run_started').at(-1)?.runId",
  );
  const longEnding = await waitQuickEvent(longRunId, [
    "run_completed",
    "run_failed",
  ]);
  assert.equal(longEnding.type, "run_completed", JSON.stringify(longEnding));
  await until(
    quickRenderer,
    'document.body.innerText.includes("QUICK_LONG_RESPONSE_END")',
    120_000,
  );
  const normalRequest = requests.at(-1);
  assert.ok(normalRequest);
  const toolNames = (normalRequest.tools ?? [])
    .map((tool) => tool.name ?? tool.function?.name)
    .filter(Boolean)
    .sort();
  assert.deepEqual(toolNames, ["web_fetch", "web_search"]);
  assert.ok(JSON.stringify(normalRequest.input).includes("QUICK_LONG"));
  await capture(quickRenderer, "quick-chat-long-day", 480, 680);
  passed.push("A real streamed Chat round trip renders a long Markdown response and receives only web_search/web_fetch tools");

  await quickRenderer.evaluate(
    'localStorage.setItem("mingshen.theme","night");document.documentElement.dataset.theme="night";true',
  );
  await capture(quickRenderer, "quick-chat-long-night", 480, 680);
  await quickRenderer.evaluate(
    'localStorage.setItem("mingshen.theme","day");document.documentElement.dataset.theme="day";true',
  );
  await capture(quickRenderer, "quick-chat-narrow", 400, 680);
  await capture(quickRenderer, "quick-chat-wide", 580, 680);
  passed.push("Quick Chat remains usable without horizontal overflow at 400, 480 and 580 pixels in day and night themes");

  heldResponse = undefined;
  await fillQuick("QUICK_HOLD");
  await clickQuick(".composer .send-button");
  const holdDeadline = Date.now() + 20_000;
  while (!heldResponse && Date.now() < holdDeadline) await sleep(100);
  assert.ok(heldResponse, "Hold fixture did not reach the local Responses server");
  await capture(quickRenderer, "quick-chat-running", 480, 680);
  await quickRenderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".composer button")].find(button=>button.textContent.includes("停止"));
    if(!button)throw new Error("Missing Quick Chat stop button");
    button.click();return true;
  })()`);
  const interrupted = await waitQuickEvent(
    (await quickRenderer.evaluate("globalThis.__quickEvents.filter(event=>event.type==='run_started').at(-1)?.runId")),
    ["run_interrupted"],
  );
  assert.equal(interrupted.type, "run_interrupted");
  heldResponse.destroy();
  heldResponse = undefined;
  await until(quickRenderer, 'Boolean(document.querySelector(".composer .send-button"))');
  await capture(quickRenderer, "quick-chat-stopped", 480, 680);
  passed.push("A running Quick Chat response can be stopped and returns to an editable, non-stuck composer");

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n1cAAAAASUVORK5CYII=",
    "base64",
  );
  const attachment = {
    name: "quick-chat-pixel.png",
    mimeType: "image/png",
    size: png.length,
    kind: "image",
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
  };
  const attachmentRun = await api(quickRenderer, "sendChat", {
    sessionId: currentSession.id,
    text: "QUICK_ATTACHMENT",
    attachments: [attachment],
  });
  const attachmentEnding = await waitQuickEvent(attachmentRun.runId, [
    "run_completed",
    "run_failed",
  ]);
  assert.equal(
    attachmentEnding.type,
    "run_completed",
    JSON.stringify(attachmentEnding),
  );
  const attachmentRequest = requests.at(-1);
  assert.ok(
    JSON.stringify(attachmentRequest.input).includes("input_image"),
    "Uploaded image must reach the model as an image input",
  );
  const storedMessages = await api(
    quickRenderer,
    "getSessionMessages",
    currentSession.id,
  );
  const storedAttachment = storedMessages
    .flatMap((message) => message.parts)
    .find((part) => part.type === "attachment")?.attachment;
  assert.ok(storedAttachment);
  assert.equal(storedAttachment.path, undefined);
  await capture(quickRenderer, "quick-chat-attachment", 480, 680);
  passed.push("Quick Chat can send uploaded image bytes for read-only analysis without persisting a local path");

  await expectQuickDenied("readWorkspaceFile", ["C:\\", "Windows\\win.ini"]);
  await expectQuickDenied("listExtensions", []);
  await expectQuickDenied("listMcpServers", []);
  await expectQuickDenied("setDesktopShortcutSettings", [
    { quickChat: "Control+Shift+F10", toggleMain: "Control+Alt+Shift+F11" },
  ]);
  await expectQuickDenied("removeSession", [currentSession.id]);
  await expectQuickDenied("updateSession", [
    { sessionId: currentSession.id, workspacePath: "C:\\secret" },
  ]);
  await expectQuickDenied("updateSession", [
    { sessionId: currentSession.id, permissionMode: "full_access" },
  ]);
  await expectQuickDenied("getSessionMessages", [first.session.id]);
  const allowedMessages = await api(
    quickRenderer,
    "getSessionMessages",
    currentSession.id,
  );
  assert.ok(Array.isArray(allowedMessages));
  const safeUpdate = await api(quickRenderer, "updateSession", {
    sessionId: currentSession.id,
    title: "Quick Chat verified",
  });
  assert.equal(safeUpdate.title, "Quick Chat verified");
  passed.push("Quick Chat IPC white-list rejects local files, Extensions, MCP, destructive and cross-session access while allowing current-chat title edits");

  await api(mainRenderer, "quickChatAction", "hide");
  await waitForWindow("quick-chat", (window) => !window.visible);
  const errorsBeforeForcedFailure = errors.length;
  await quickRenderer.send("Debugger.enable");
  await quickRenderer.send("Debugger.pause");
  const failedShowOutcome = mainRenderer.evaluate(`window.mingshen.quickChatAction("show").then(
    ()=>null,
    (cause)=>({message:cause instanceof Error?cause.message:String(cause)})
  )`);
  await sleep(400);
  assert.equal(await crashQuickChatRenderer(), true, "Cannot crash the paused Quick Chat renderer");
  const failedShow = await failedShowOutcome;
  assert.ok(
    failedShow?.message,
    `The forced activation failure unexpectedly succeeded: ${JSON.stringify(failedShow)}`,
  );
  const intentionalCrashErrors = errors.splice(errorsBeforeForcedFailure);
  quickRenderer.close();
  quickRenderer = undefined;

  const retriedShow = await api(mainRenderer, "quickChatAction", "show");
  assert.ok(retriedShow, "A retry after a failed show must return the recovered state");
  assert.equal(retriedShow.session.id, currentSession.id);
  await waitForWindow("quick-chat", (window) => window.visible && window.focused);
  quickRenderer = await connectPage("quick-chat", 60_000);
  await until(quickRenderer, 'Boolean(document.querySelector(".quick-chat .composer"))');
  await until(
    quickRenderer,
    `window.mingshen.getQuickChatState().then(state=>state.session?.id===${JSON.stringify(currentSession.id)})`,
  );
  shortcutEvidence.visibilityRetry = {
    failedShow: true,
    latestRetryVisible: true,
    intentionalCrashErrors: intentionalCrashErrors.length,
  };
  passed.push(
    "A forced show activation failure releases the visibility queue and a subsequent show recreates the surface with the same Chat session",
  );

  await quickRenderer.evaluate(
    'window.mingshen.desktopAction("tray",undefined,undefined)',
  );
  await waitForWindow("quick-chat", (window) => !window.visible);
  await api(mainRenderer, "quickChatAction", "show");
  const restoredWindow = await waitForWindow(
    "quick-chat",
    (window) => window.visible,
  );
  assert.equal(restoredWindow.minimized, false);
  const restored = await api(mainRenderer, "getQuickChatState");
  assert.equal(restored.session.id, currentSession.id);

  const shortcuts = await api(mainRenderer, "getDesktopState");
  assert.equal(typeof shortcuts.shortcuts?.quickChat, "boolean");
  assert.equal(typeof shortcuts.shortcuts?.toggleMain, "boolean");
  const registered = await mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module")
      .createRequire(process.cwd()+"/package.json")("electron");
    return {
      quickChat:electron.globalShortcut.isRegistered("Control+M"),
      toggleMain:electron.globalShortcut.isRegistered("Control+Alt+L")
    };
  })()`);
  assert.deepEqual(registered, shortcuts.shortcuts);
  const unavailable = [
    ...(!registered.quickChat ? ["Ctrl+M"] : []),
    ...(!registered.toggleMain ? ["Ctrl+Alt+L"] : []),
  ];
  for (const accelerator of unavailable) {
    await until(mainRenderer, `[...document.querySelectorAll('[role="status"]')].some(node=>(node.getAttribute("title")??"").includes(${JSON.stringify(accelerator)}))`);
  }
  shortcutEvidence.registered = registered;
  shortcutEvidence.unavailable = unavailable;
  passed.push("Global shortcut registration matches the OS state and occupied bindings are visibly reported");

  await api(quickRenderer, "quickChatAction", "open-main");
  await waitForWindow("quick-chat", (window) => !window.visible);
  await waitForWindow("main", (window) => window.visible);
  await until(
    mainRenderer,
    'document.querySelector(".app-shell")?.dataset.agentMode==="chat"',
    30_000,
  );
  await capture(mainRenderer, "main-chat-selected", 1440, 960);
  passed.push("Open-main hides the compact surface and selects the same current ChatAgent conversation in the primary window");

  await api(mainRenderer, "desktopAction", "tray", undefined, undefined);
  await waitForWindow("main", (window) => !window.visible);
  await api(mainRenderer, "desktopAction", "show", undefined, undefined);
  await waitForWindow("main", (window) => window.visible);
  passed.push("The primary window can be hidden to the tray and restored through the same desktop action path");

  let customShortcuts;
  for (const number of [10, 9, 8, 7]) {
    const candidate = {
      quickChat: `Control+Shift+F${number}`,
      toggleMain: `Control+Alt+Shift+F${number + 1}`,
    };
    const result = await api(mainRenderer, "setDesktopShortcutSettings", candidate);
    if (result.ok) {
      customShortcuts = result.settings;
      assert.deepEqual(result.status, { quickChat: true, toggleMain: true });
      break;
    }
  }
  assert.ok(customShortcuts, "No free fixture shortcut pair could be registered");
  const duplicate = await api(mainRenderer, "setDesktopShortcutSettings", {
    quickChat: customShortcuts.quickChat,
    toggleMain: customShortcuts.quickChat,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.errors.quickChat.code, "shortcut-duplicate");
  assert.deepEqual((await api(mainRenderer, "getDesktopShortcutSettings")).settings, customShortcuts);

  const reservedForFixture = await mainInspector.evaluate(`(()=>{
    const {globalShortcut}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    for(const key of ["Control+Alt+Shift+F24","Control+Alt+Shift+F23","Control+Alt+Shift+F22"]){
      if(globalShortcut.register(key,()=>{}))return key;
    }
    return null;
  })()`);
  assert.ok(reservedForFixture, "Cannot reserve an independent OS binding for occupancy testing");
  try {
    const occupied = await api(mainRenderer, "setDesktopShortcutSettings", {
      ...customShortcuts,
      quickChat: reservedForFixture,
    });
    assert.equal(occupied.ok, false);
    assert.equal(occupied.errors.quickChat.code, "shortcut-occupied");
    assert.deepEqual(occupied.settings, customShortcuts);
    assert.deepEqual(occupied.status, { quickChat: true, toggleMain: true });
  } finally {
    await mainInspector.evaluate(`process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").globalShortcut.unregister(${JSON.stringify(reservedForFixture)});true`);
  }
  shortcutEvidence.custom = customShortcuts;
  passed.push("Custom global bindings reject duplicate and actual occupied OS combinations while keeping both original working bindings");

  await api(mainRenderer, "setDesktopShortcutRecording", true);
  await until(
    mainRenderer,
    `[...document.querySelectorAll('[role="status"]')].some(node=>(node.getAttribute("title")??"").includes(${JSON.stringify(displayShortcut(customShortcuts.quickChat))}))`,
  );
  shortcutEvidence.simpleWarning = await assertShortcutWarningGeometry("simple-1440");
  await capture(mainRenderer, "shortcut-warning-simple-1440", 1440, 960);
  await api(mainRenderer, "setDesktopShortcutRecording", false);
  await until(
    mainRenderer,
    'window.mingshen.getDesktopShortcutSettings().then(state=>state.status.quickChat&&state.status.toggleMain)',
  );
  passed.push("The titlebar warning follows the configured binding rather than a hard-coded default");

  await mainRenderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll("button")].find(node=>["打开设置","Open settings"].includes(node.getAttribute("aria-label")??""));
    if(!button)throw new Error("Missing settings entry");
    button.click();
    return true;
  })()`);
  await until(mainRenderer, 'Boolean(document.querySelector(".global-shortcuts-settings"))');
  const requestedRecordingShortcuts = ["Control+Alt+K", "Control+Alt+Shift+F12"];
  const recordingShortcutsAvailable = await mainInspector.evaluate(`(()=>{
    const {globalShortcut}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    return ${JSON.stringify(requestedRecordingShortcuts)}.every(key=>{
      if(!globalShortcut.register(key,()=>{}))return false;
      globalShortcut.unregister(key);
      return true;
    });
  })()`);
  assert.equal(
    recordingShortcutsAvailable,
    true,
    "Ctrl+Alt+K and Ctrl+Alt+Shift+F12 must both be available for CDP recorder coverage",
  );
  await mainRenderer.evaluate(`(()=>{
    globalThis.__shortcutKeyEvents=[];
    for(const type of ["keydown","keyup","focus","blur"]){
      window.addEventListener(type,event=>globalThis.__shortcutKeyEvents.push({
        type,key:event.key,code:event.code,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,
        altKey:event.altKey,altGraph:type.startsWith("key")
          ? event.getModifierState("AltGraph")
          : false,
        target:event.target?.tagName,focused:document.hasFocus()
      }),true);
    }
    return true;
  })()`);
  for (const accelerator of requestedRecordingShortcuts) {
    await until(
      mainRenderer,
      '!document.querySelector(\'[data-shortcut-recorder="quickChat"]\')?.disabled',
    );
    await mainRenderer.evaluate(
      'document.querySelector(\'[data-shortcut-recorder="quickChat"]\').focus();document.querySelector(\'[data-shortcut-recorder="quickChat"]\').click();true',
    );
    await until(
      mainRenderer,
      'document.querySelector(\'[data-shortcut-recorder="quickChat"]\')?.getAttribute("aria-pressed")==="true"',
    );
    await waitForWindow("main", (window) => window.visible && window.focused);
    await dispatchRecordedShortcut(mainRenderer, accelerator);
    await until(
      mainRenderer,
      `window.mingshen.getDesktopShortcutSettings().then(state=>state.settings.quickChat===${JSON.stringify(accelerator)}&&state.status.quickChat)`,
    );
  }
  const recordedQuickChat = requestedRecordingShortcuts.at(-1);
  const recordedState = await api(mainRenderer, "getDesktopShortcutSettings");
  const recordedRegistered = await mainInspector.evaluate(`(()=>{
    const {globalShortcut}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    return {
      quickChat:globalShortcut.isRegistered(${JSON.stringify(recordedQuickChat)}),
      toggleMain:globalShortcut.isRegistered(${JSON.stringify(customShortcuts.toggleMain)})
    };
  })()`);
  assert.deepEqual(recordedRegistered, recordedState.status);
  const recordedEventShapes = await mainRenderer.evaluate(
    "globalThis.__shortcutKeyEvents.filter(event=>event.type==='keydown'&&['K','F12'].includes(event.key.toUpperCase()))",
  );
  const ctrlAltKShape = recordedEventShapes.find(
    (event) =>
      event.key.toUpperCase() === "K" &&
      event.ctrlKey &&
      event.altKey &&
      !event.shiftKey,
  );
  const ctrlAltShiftF12Shape = recordedEventShapes.find(
    (event) =>
      event.key.toUpperCase() === "F12" &&
      event.ctrlKey &&
      event.altKey &&
      event.shiftKey,
  );
  assert.ok(
    ctrlAltKShape,
    `CDP did not expose the Ctrl+Alt event shape: ${JSON.stringify(recordedEventShapes)}`,
  );
  assert.ok(
    ctrlAltShiftF12Shape,
    `CDP did not expose the Ctrl+Alt+Shift event shape: ${JSON.stringify(recordedEventShapes)}`,
  );
  shortcutEvidence.recordedEventShapes = {
    ctrlAltK: ctrlAltKShape,
    ctrlAltShiftF12: ctrlAltShiftF12Shape,
    cdpReportedAltGraph: Boolean(ctrlAltKShape.altGraph || ctrlAltShiftF12Shape.altGraph),
  };
  await capture(mainRenderer, "shortcut-settings-custom", 1440, 960);
  await capture(mainRenderer, "shortcut-settings-custom-800", 800, 900);
  await mainRenderer.evaluate(
    'localStorage.setItem("mingshen.theme","night");document.documentElement.dataset.theme="night";true',
  );
  await capture(mainRenderer, "shortcut-settings-night", 1440, 960);
  await mainRenderer.evaluate(
    'localStorage.setItem("mingshen.theme","day");document.documentElement.dataset.theme="day";true',
  );

  const reservedForUi = await mainInspector.evaluate(`(()=>{
    const {globalShortcut}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    for(const key of ["Control+Shift+F4","Control+Shift+F3","Control+Shift+F2"]){
      if(globalShortcut.register(key,()=>{}))return key;
    }
    return null;
  })()`);
  assert.ok(reservedForUi, "Cannot reserve a shortcut for renderer conflict testing");
  try {
    const functionKey = reservedForUi.slice(reservedForUi.lastIndexOf("+") + 1);
    await mainRenderer.evaluate(
      'document.querySelector(\'[data-shortcut-recorder="quickChat"]\').click();true',
    );
    await until(
      mainRenderer,
      'document.querySelector(\'[data-shortcut-recorder="quickChat"]\')?.getAttribute("aria-pressed")==="true"',
    );
    await mainRenderer.evaluate(`(()=>{
      const event=new KeyboardEvent("keydown",{
        key:${JSON.stringify(functionKey)},code:${JSON.stringify(functionKey)},
        ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true
      });
      window.dispatchEvent(event);
      return true;
    })()`);
    await until(
      mainRenderer,
      'Boolean(document.querySelector(\'[data-shortcut-error="quickChat"]\'))',
    );
    const conflictState = await api(mainRenderer, "getDesktopShortcutSettings");
    assert.equal(conflictState.settings.quickChat, recordedQuickChat);
    assert.equal(conflictState.status.quickChat, true);
    assert.equal(conflictState.errors.quickChat.code, "shortcut-occupied");
    await capture(mainRenderer, "shortcut-settings-conflict", 1440, 960);
  } finally {
    await mainInspector.evaluate(`process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").globalShortcut.unregister(${JSON.stringify(reservedForUi)});true`);
  }

  const retried = await api(mainRenderer, "setDesktopShortcutSettings", recordedState.settings);
  assert.equal(retried.ok, true);
  assert.deepEqual(retried.errors, {});
  await mainRenderer.evaluate(
    'document.querySelector(\'[data-shortcut-reset="quickChat"]\').click();true',
  );
  await until(
    mainRenderer,
    'window.mingshen.getDesktopShortcutSettings().then(state=>state.settings.quickChat==="Control+M"&&state.status.quickChat)',
  );
  const restoredCustomPair = await api(
    mainRenderer,
    "setDesktopShortcutSettings",
    customShortcuts,
  );
  assert.equal(restoredCustomPair.ok, true);

  await mainRenderer.evaluate(
    'document.querySelector(\'[data-shortcut-recorder="toggleMain"]\').focus();document.querySelector(\'[data-shortcut-recorder="toggleMain"]\').click();true',
  );
  await until(
    mainRenderer,
    'document.querySelector(\'[data-shortcut-recorder="toggleMain"]\')?.getAttribute("aria-pressed")==="true"',
  );
  await mainRenderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await mainRenderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(
    mainRenderer,
    'document.querySelector(\'[data-shortcut-recorder="toggleMain"]\')?.getAttribute("aria-pressed")==="false"',
  );
  await until(
    mainRenderer,
    'window.mingshen.getDesktopShortcutSettings().then(state=>state.status.quickChat&&state.status.toggleMain)',
  );
  assert.deepEqual((await api(mainRenderer, "getDesktopShortcutSettings")).settings, customShortcuts);
  passed.push("Escape cancels recording without closing Settings or changing the bindings, and restores both global shortcuts");

  await mainRenderer.evaluate(
    'document.querySelector(".settings-content__header button").click();true',
  );
  await until(mainRenderer, '!document.querySelector(".global-shortcuts-settings")');
  shortcutEvidence.rendererRecording = {
    accepted: requestedRecordingShortcuts,
    finalQuickChat: recordedQuickChat,
    failedBinding: reservedForUi,
    resetQuickChat: "Control+M",
  };
  passed.push("Settings records Ctrl+Alt+K and Ctrl+Alt+Shift+F12 from real modifier events, reports occupancy without losing the previous binding, resets to the unchanged default and restores the custom pair");

  await api(mainRenderer, "quickChatAction", "hide");
  await api(mainRenderer, "desktopAction", "tray", undefined, undefined);
  await waitForWindow("main", (window) => !window.visible);
  const inputProbeKey = await mainInspector.evaluate(`(()=>{
    const {globalShortcut}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    globalThis.__shortcutInputProbeHits=0;
    for(const key of ["Control+Alt+Shift+F21","Control+Alt+Shift+F20","Control+Alt+Shift+F19"]){
      if(globalShortcut.register(key,()=>{globalThis.__shortcutInputProbeHits+=1}))return key;
    }
    return null;
  })()`);
  assert.ok(inputProbeKey, "Cannot register an independent OS input probe");
  let inputProbeHits = 0;
  try {
    pressGlobalShortcut(inputProbeKey);
    for (let attempt = 0; attempt < 20 && !inputProbeHits; attempt++) {
      await sleep(100);
      inputProbeHits = await mainInspector.evaluate("globalThis.__shortcutInputProbeHits");
    }
  } finally {
    await mainInspector.evaluate(`process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").globalShortcut.unregister(${JSON.stringify(inputProbeKey)});true`);
  }
  shortcutEvidence.osInputProbe = { key: inputProbeKey, hits: inputProbeHits };
  if (inputProbeHits) {
    pressGlobalShortcut(customShortcuts.quickChat);
    await waitForWindow("quick-chat", (window) => window.visible && window.focused);
    pressGlobalShortcut(customShortcuts.quickChat);
    await waitForWindow("quick-chat", (window) => !window.visible);
    pressGlobalShortcut(customShortcuts.quickChat);
    await waitForWindow("quick-chat", (window) => window.visible && window.focused);
    pressGlobalShortcut(customShortcuts.toggleMain);
    await waitForWindow("main", (window) => window.visible && window.focused);
    pressGlobalShortcut(customShortcuts.toggleMain);
    await waitForWindow("main", (window) => !window.visible);
    shortcutEvidence.nativeInjection = { callback: true, quickChatToggles: 3, mainToggles: 2 };
    passed.push("Real Windows key events toggle Quick Chat visible, hidden and visible again, then toggle the primary window between foreground and tray");
  } else {
    shortcutEvidence.nativeInjection = { callback: false };
    skipped.push("OS key injection produced no callback in an independent Electron globalShortcut registration; native key invocation was not verified in this run. System registration, occupancy, rollback, renderer recording and restart checks still run.");
  }
  await api(mainRenderer, "desktopAction", "show", undefined, undefined);

  const uiPreferences = await api(mainRenderer, "getUiPreferences");
  await api(mainRenderer, "saveUiPreferences", { ...uiPreferences, interfaceStyle: "orbit" });
  await mainRenderer.send("Page.reload");
  await quickRenderer.send("Page.reload");
  await until(mainRenderer, 'Boolean(document.querySelector(".app-shell--orbit"))', 60_000);
  await until(quickRenderer, 'document.documentElement.dataset.interfaceStyle==="orbit"&&Boolean(document.querySelector(".composer"))', 60_000);
  await mainRenderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll("button")].find(node=>["打开设置","Open settings"].includes(node.getAttribute("aria-label")??""));
    if(!button)throw new Error("Missing Orbit settings entry");
    button.click();return true;
  })()`);
  await until(mainRenderer, 'Boolean(document.querySelector(".global-shortcuts-settings"))');
  await mainRenderer.evaluate('document.querySelector(".global-shortcuts-settings").scrollIntoView({block:"center"});true');
  await api(mainRenderer, "setDesktopShortcutRecording", true);
  await until(
    mainRenderer,
    'Boolean(document.querySelector(\'[data-testid="desktop-shortcut-warning"]\'))',
  );
  shortcutEvidence.orbitWarning = await assertShortcutWarningGeometry("orbit-1440");
  await capture(mainRenderer, "shortcut-warning-orbit-1440", 1440, 960);
  await api(mainRenderer, "setDesktopShortcutRecording", false);
  await until(
    mainRenderer,
    'window.mingshen.getDesktopShortcutSettings().then(state=>state.status.quickChat&&state.status.toggleMain)',
  );
  await capture(mainRenderer, "shortcut-settings-orbit-day", 1440, 960);
  await mainRenderer.evaluate('document.documentElement.dataset.theme="night";localStorage.setItem("mingshen.theme","night");true');
  await capture(mainRenderer, "shortcut-settings-orbit-night", 1440, 960);
  await mainRenderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".desktop-caption button")].find(node=>(node.getAttribute("aria-label")??"").includes("English"));
    if(!button)throw new Error("Missing locale switch");
    button.click();return true;
  })()`);
  await until(mainRenderer, 'document.querySelector(".global-shortcuts-settings")?.textContent.includes("Global shortcuts")');
  await capture(mainRenderer, "shortcut-settings-orbit-english-800", 800, 900);
  await api(mainRenderer, "quickChatAction", "show");
  await until(quickRenderer, 'Boolean(document.querySelector(\'button[aria-label="New conversation"]\'))');
  await capture(quickRenderer, "quick-chat-orbit-night", 400, 680);
  await quickRenderer.evaluate('document.documentElement.dataset.theme="day";localStorage.setItem("mingshen.theme","day");true');
  await capture(quickRenderer, "quick-chat-orbit-day", 580, 680);
  passed.push("Shortcut Settings and Quick Chat render in Simple and Orbit, day and night, with English labels and an 800px Settings layout");

  const persistedSessionId = currentSession.id;
  const persistedExpiry = restored.expiresAt;
  await api(mainRenderer, "quickChatAction", "show");
  await close();

  await launch();
  const shortcutsAfterRestart = await api(mainRenderer, "getDesktopShortcutSettings");
  assert.deepEqual(shortcutsAfterRestart.settings, customShortcuts);
  assert.deepEqual(shortcutsAfterRestart.status, { quickChat: true, toggleMain: true });
  passed.push("Custom global shortcut settings are persisted and re-registered after a real Electron restart");
  const afterRestart = await api(mainRenderer, "quickChatAction", "show");
  assert.equal(afterRestart.session.id, persistedSessionId);
  assert.equal(afterRestart.pinned, true);
  assert.ok(
    afterRestart.expiresAt > persistedExpiry,
    "Restarting within the lease must renew the same Quick Chat session",
  );
  quickRenderer = await connectPage("quick-chat", 60_000);
  await until(
    quickRenderer,
    `window.mingshen.getQuickChatState().then(state=>state.session?.id===${JSON.stringify(persistedSessionId)})`,
  );
  await until(
    quickRenderer,
    'document.body.innerText.includes("QUICK_LONG_RESPONSE_END")',
  );
  await until(
    quickRenderer,
    'document.querySelector(\'[data-testid="quick-chat-pin"]\')?.getAttribute("aria-pressed")==="true"',
  );
  const pinnedAfterRestartWindow = await waitForWindow(
    "quick-chat",
    (window) => window.visible && window.alwaysOnTop,
  );
  assert.equal(pinnedAfterRestartWindow.alwaysOnTop, true);
  await capture(quickRenderer, "quick-chat-restored-after-restart", 480, 680);
  passed.push("A real Electron restart restores and renews the current Quick Chat lease and its visible message history");
  passed.push("The Quick Chat pin preference persists across restart and keeps the BrowserWindow always-on-top");

  await clickQuick('[data-testid="quick-chat-pin"]');
  await until(
    quickRenderer,
    'document.querySelector(\'[data-testid="quick-chat-pin"]\')?.getAttribute("aria-pressed")==="false"',
  );
  const unpinnedAfterRestartWindow = await waitForWindow(
    "quick-chat",
    (window) => window.visible && !window.alwaysOnTop,
  );
  assert.equal(unpinnedAfterRestartWindow.alwaysOnTop, false);
  assert.equal((await api(mainRenderer, "getQuickChatState")).pinned, false);
  shortcutEvidence.pin = {
    initial: false,
    toggled: true,
    restoredAfterRestart: true,
    cleanedUp: false,
  };
  passed.push("Quick Chat clears the persisted pin and always-on-top flag at test cleanup");

  assert.deepEqual(errors, [], `Renderer errors: ${errors.join("\n")}`);
  const result = {
    passed,
    skipped,
    expectedDenials,
    screenshots,
    layoutMeasurements,
    requests: requests.length,
    shortcutEvidence,
    shortcuts: shortcuts.shortcuts,
    evidence,
    boundaries:
      "Synthetic local Responses server and isolated Electron profile. The smoke verifies lease renewal/reuse but does not wait ten real minutes because expiry boundaries are covered by the focused unit tests. No user database, paid model, formal installer or real Office file was used.",
  };
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "failure.json"),
    JSON.stringify(
      {
        passed,
        skipped,
        expectedDenials,
        screenshots,
        layoutMeasurements,
        requests: requests.length,
        shortcutEvidence,
        shortcutDiagnostics: await mainRenderer?.evaluate(`(async()=>({
          events:globalThis.__shortcutKeyEvents,
          state:await window.mingshen.getDesktopShortcutSettings(),
          recorders:[...document.querySelectorAll("[data-shortcut-recorder]")].map(node=>({
            action:node.dataset.shortcutRecorder,pressed:node.getAttribute("aria-pressed"),
            disabled:node.disabled,text:node.textContent
          }))
        }))()`).catch(() => null),
        errors,
        failure: String(error.stack ?? error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  heldResponse?.destroy();
  await close().catch(() => undefined);
  if (server.listening) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  const local = relative(resolve(tmpdir()), temporary);
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local));
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
