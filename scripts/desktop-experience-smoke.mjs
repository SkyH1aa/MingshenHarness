import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";
import { inspectCompanionVideos } from "./desktop-video-smoke-helper.mjs";

// This is an isolated desktop smoke. It intentionally uses a fresh Electron
// profile and never connects to the user's normal Mingshen instance.
const desktop = resolve("apps/desktop");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-desktop-experience-"));
const profile = join(temporary, "profile");
const evidence = resolve(".impeccable/review", `v135-desktop-experience-${Date.now()}`);
const debugPort = await freePort();
const inspectPort = await freePort();
const executable = experimentalExecutable();
const environment = {
  ...process.env,
  MSH_EXPERIMENTAL: "1",
  MSH_USER_DATA_DIR: profile,
  MSH_DISABLE_AUTO_DEPENDENCIES: "1",
  MSH_NOTIFICATION_FIXTURE: "1",
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_RENDERER_URL;

const passed = [];
const screenshots = [];
const geometry = [];
const videoResults = [];
const quickOnly = process.argv.includes("--quick");
const mediaOnly = process.argv.includes("--media-only");
const diagnosticsOnly = process.argv.includes("--diagnose");
const startupOnly = process.argv.includes("--startup-only");
const fallbackOnly = process.argv.includes("--fallback-only");
const captureProbeOnly = process.argv.includes("--capture-minimized-probe");
const exceptions = [];
const consoleErrors = [];
const fixtureRequests = [];
const fixtureResponses = new Set();
let fixtureFinishRequested = false;
const fixtureCompletionEvent = `data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } } })}\n\n`;
const fixtureServer = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    fixtureRequests.push({ method: request.method, path: request.url, bytes: Buffer.concat(chunks).length });
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "FIXTURE_PRIVATE_OUTPUT_SENTINEL" })}\n\n`);
    if (fixtureFinishRequested) {
      response.end(fixtureCompletionEvent);
    } else {
      fixtureResponses.add(response);
      response.once("close", () => fixtureResponses.delete(response));
    }
  } catch {
    response.destroy();
  }
});
let child;
let startup;
let renderer;
let companion;
let mainInspector;
let failure;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function freePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

async function startFixtureServer() {
  await new Promise((done, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(0, "127.0.0.1", done);
  });
  return fixtureServer.address().port;
}

function finishFixtureResponses() {
  fixtureFinishRequested = true;
  for (const response of fixtureResponses) {
    response.end(fixtureCompletionEvent);
    fixtureResponses.delete(response);
  }
}

async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    return await response.json();
  } catch {
    return [];
  }
}

async function waitForTarget(port, predicate, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const target = (await targets(port)).find(predicate);
    if (target) return target;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for a DevTools target on ${port}`);
}

async function connect(target, kind) {
  assert.ok(target?.webSocketDebuggerUrl, `Missing ${kind} debugger URL`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const observedEvents = [];
  const eventWaiters = new Map();
  let sequence = 0;
  let disconnected = null;
  const disconnect = (reason) => {
    if (disconnected) return;
    disconnected = new Error(`CDP ${kind} connection closed: ${reason}`);
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(disconnected);
    }
    pending.clear();
    for (const waiter of eventWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(disconnected);
    }
    eventWaiters.clear();
  };
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("close", (event) => disconnect(`code=${event.code}`));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Inspector.detached") disconnect(message.params?.reason || "target detached");
    if (message.method) {
      const waiter = eventWaiters.get(message.method);
      if (waiter) {
        eventWaiters.delete(message.method);
        clearTimeout(waiter.timer);
        waiter.resolve(message.params);
      } else if (message.method === "Debugger.paused") {
        observedEvents.push(message);
      }
    }
    if (message.method === "Runtime.exceptionThrown") {
      exceptions.push({ kind, detail: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text });
    }
    if (kind === "renderer" || kind === "companion" || kind === "startup") {
      if (message.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(message.params.type)) {
        consoleErrors.push({ kind, detail: message.params.args?.map((item) => item.value ?? item.description).join(" ") });
      }
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}, timeout = 45_000) => new Promise((resolveSend, reject) => {
    if (disconnected || socket.readyState !== WebSocket.OPEN) {
      reject(disconnected || new Error(`CDP ${kind} connection is not open: ${method}`));
      return;
    }
    const id = ++sequence;
    const timeoutError = new Error(`CDP timeout: ${kind} ${method}`);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(timeoutError);
    }, timeout);
    pending.set(id, { resolve: resolveSend, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable").catch(() => undefined);
  return {
    send,
    waitEvent: (method, timeout = 30_000) => {
      const index = observedEvents.findIndex((event) => event.method === method);
      if (index >= 0) return Promise.resolve(observedEvents.splice(index, 1)[0].params);
      return new Promise((resolveEvent, reject) => {
        const timer = setTimeout(() => {
          eventWaiters.delete(method);
          reject(new Error(`CDP event timeout: ${method}`));
        }, timeout);
        eventWaiters.set(method, { resolve: resolveEvent, reject, timer });
      });
    },
    evaluate: async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    },
    close: () => {
      disconnect("client closed");
      socket.close();
    },
  };
}

async function until(connection, expression, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await connection.evaluate(expression)) return;
    } catch (cause) {
      if (!/context|destroyed|navigat|target closed/i.test(String(cause))) throw cause;
    }
    await sleep(80);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(connection, selector, timeout = 30_000) {
  await until(connection, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return false;const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return false;el.scrollIntoView({block:"nearest",inline:"nearest"});el.click();return true})()`, timeout);
}

async function clickText(connection, selector, text) {
  await until(connection, `(()=>{const root=document.querySelector(${JSON.stringify(selector)});const el=[...(root?.querySelectorAll("button")||[])].find(item=>item.textContent?.includes(${JSON.stringify(text)}));if(!el||el.disabled)return false;el.click();return true})()`);
}

async function dispatchMouse(connection, type, x, y, options = {}) {
  await connection.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: options.button ?? "none",
    buttons: options.buttons ?? 0,
    clickCount: options.clickCount ?? 0,
    ...options,
  });
}

async function dispatchKey(connection, type, key, code, keyCode, options = {}) {
  await connection.send("Input.dispatchKeyEvent", {
    type,
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers: 0,
    ...options,
  });
}

async function clickStartupSkip(name) {
  const probeReady = await mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("startup.html"));
    if(!window||window.isDestroyed()||!window.isVisible())return false;
    const senderId=window.webContents.id;
    const events=[];
    let matching=false;
    const before=event=>{
      if(event.sender.id!==senderId)return;
      matching=true;
      events.push({phase:"before",at:performance.now(),visible:!window.isDestroyed()&&window.isVisible()});
    };
    const after=()=>{
      if(!matching)return;
      matching=false;
      events.push({phase:"after",at:performance.now(),destroyed:window.isDestroyed()});
    };
    electron.ipcMain.prependListener("startup-presentation:skip",before);
    electron.ipcMain.on("startup-presentation:skip",after);
    globalThis.__desktopSmokeSkip={events,restore:()=>{
      electron.ipcMain.removeListener("startup-presentation:skip",before);
      electron.ipcMain.removeListener("startup-presentation:skip",after);
    }};
    return true;
  })()`);
  assert.equal(probeReady, true, `${name}: startup window disappeared before skip probe`);
  let releaseError = null;
  let observations = null;
  try {
    const point = await startup.evaluate(`(()=>{
      const button=document.querySelector(".startup-presentation__skip");
      if(!button||button.disabled)return null;
      const box=button.getBoundingClientRect();
      const x=box.left+box.width/2,y=box.top+box.height/2;
      const hit=document.elementFromPoint(x,y);
      return {x,y,hit:Boolean(hit&&(hit===button||button.contains(hit)))};
    })()`);
    assert.ok(point?.hit, `${name}: skip button is not hit-testable`);
    await dispatchMouse(startup, "mouseMoved", point.x, point.y);
    await dispatchMouse(startup, "mousePressed", point.x, point.y, { button: "left", buttons: 1, clickCount: 1 });
    try {
      await dispatchMouse(startup, "mouseReleased", point.x, point.y, { button: "left", buttons: 0, clickCount: 1 });
    } catch (cause) {
      releaseError = String(cause);
    }
    await until(mainInspector, 'globalThis.__desktopSmokeSkip.events.some(event=>event.phase==="after")', 5_000);
  } finally {
    observations = await mainInspector.evaluate(`(()=>{
      const probe=globalThis.__desktopSmokeSkip;
      if(!probe)return null;
      probe.restore();
      delete globalThis.__desktopSmokeSkip;
      return probe.events;
    })()`);
    geometry.push({ name: `startup-skip-${name}`, releaseError, observations });
  }
  assert.equal(observations?.length, 2, `${name}: skip IPC was not observed exactly once`);
  assert.equal(observations[0]?.visible, true, `${name}: skip was received after startup stopped being visible`);
  assert.equal(observations[1]?.destroyed, true, `${name}: skip did not synchronously close the startup window`);
}

async function screenshot(connection, name, { delay = 120 } = {}) {
  if (delay) await sleep(delay);
  let image;
  const captureFailures = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      image = await connection.send("Page.captureScreenshot", { format: "png" }, 15_000);
      break;
    } catch (cause) {
      captureFailures.push(String(cause));
      if (attempt > 0 || !String(cause).includes("Page.captureScreenshot")) {
        const nativeState = connection === renderer
          ? await mainInspector?.evaluate(`(()=>{
            const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
            const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("index.html")&&!item.webContents.getURL().includes("surface=quick-chat"));
            return window?{visible:window.isVisible(),minimized:window.isMinimized(),focused:window.isFocused(),destroyed:window.isDestroyed()}:null;
          })()`).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }))
          : null;
        geometry.push({ name: `${name}-capture-failure`, captureFailures, nativeState });
        throw cause;
      }
      geometry.push({ name: `${name}-capture-retry`, failure: String(cause) });
      await sleep(160);
    }
  }
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
}

async function connectMain() {
  const target = await waitForTarget(debugPort, (item) => item.type === "page" && /index\.html/i.test(item.url) && !/surface=quick-chat/i.test(item.url));
  return connect(target, "renderer");
}

async function connectMainInspector() {
  const target = await waitForTarget(inspectPort, (item) => Boolean(item.webSocketDebuggerUrl));
  return connect(target, "main");
}

async function connectCompanion() {
  const target = await waitForTarget(debugPort, (item) => item.type === "page" && /companion\.html/i.test(item.url));
  return connect(target, "companion");
}

async function connectQuickChat() {
  const target = await waitForTarget(debugPort, (item) => item.type === "page" && /surface=quick-chat/i.test(item.url));
  return connect(target, "renderer");
}

async function closeSettings() {
  // The settings surface is localized independently from the visible shell;
  // accept both labels in the isolated profile and keep the selector scoped to
  // the dialog header so a similarly named toolbar action cannot be clicked.
  await until(renderer, `(()=>{
    const root=document.querySelector(".settings-workspace");
    if(!root)return false;
    const button=[...root.querySelectorAll(".settings-content__header button,button")].find(el=>{
      if(el.disabled)return false;
      const label=(el.getAttribute("aria-label")||"").trim().toLowerCase();
      const title=(el.getAttribute("title")||"").trim().toLowerCase();
      return label==="关闭设置"||label==="close settings"||title==="关闭设置"||title==="close settings";
    });
    if(!button)return false;
    const rect=button.getBoundingClientRect();
    if(rect.width<1||rect.height<1)return false;
    button.click();
    return true;
  })()`);
  await until(renderer, '!document.querySelector(".settings-workspace")');
}

async function setCompanionSetting(label, expected) {
  const selector = `input[aria-label=${JSON.stringify(label)}]`;
  await until(renderer, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});return Boolean(el&&el.checked!==${JSON.stringify(expected)})})()`);
  await click(renderer, selector);
  await until(renderer, `document.querySelector(${JSON.stringify(selector)})?.checked===${JSON.stringify(expected)}`);
}

async function setRangeSetting(label, value, preferenceExpression) {
  const selector = `input[type="range"][aria-label=${JSON.stringify(label)}]`;
  await until(renderer, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(String(value))});
    input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(String(value))}}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  })()`);
  await until(renderer, preferenceExpression);
}

async function inspectWindows() {
  if (!mainInspector) return null;
  const mainUrl = renderer ? await renderer.evaluate("location.href") : null;
  return mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const companion=electron.BrowserWindow.getAllWindows().find(window=>window.getTitle?.()==="Mingshen Companion");
    const main=electron.BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===${JSON.stringify(mainUrl)});
    return {
      main:main?{visible:main.isVisible(),focused:main.isFocused(),bounds:main.getBounds()}:null,
      companion:companion?{title:companion.getTitle(),bounds:companion.getBounds(),visible:companion.isVisible(),focused:companion.isFocused(),alwaysOnTop:companion.isAlwaysOnTop(),opacity:companion.getOpacity()}:null,
    };
  })()`);
}

async function captureCompanionMenu({ viaContextMenu = false, viaKeyboardStatus = false } = {}) {
  await mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    if(globalThis.__desktopSmokeOriginalPopup) throw new Error("Menu capture is already installed");
    globalThis.__desktopSmokeMenu=null;
    globalThis.__desktopSmokeOriginalPopup=electron.Menu.prototype.popup;
    electron.Menu.prototype.popup=function(...args){globalThis.__desktopSmokeMenu=this;return undefined};
    return true;
  })()`);
  try {
    if (viaContextMenu) {
      const point = await companion.evaluate(`(()=>{const r=document.querySelector(".companion-stage")?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`);
      assert.ok(point, "Companion stage missing for context menu");
      await dispatchMouse(companion, "mouseMoved", point.x, point.y);
      await dispatchMouse(companion, "mousePressed", point.x, point.y, { button: "right", buttons: 2, clickCount: 1 });
      await dispatchMouse(companion, "mouseReleased", point.x, point.y, { button: "right", buttons: 0, clickCount: 1 });
    } else if (viaKeyboardStatus) {
      assert.equal(await companion.evaluate('document.activeElement?.classList.contains("companion-status")'), true);
      await dispatchKey(companion, "keyDown", "Enter", "Enter", 13, { text: "\r", unmodifiedText: "\r" });
      await dispatchKey(companion, "keyUp", "Enter", "Enter", 13);
    } else {
      await companion.evaluate("window.companion.openMenu()");
    }
    await until(mainInspector, "Boolean(globalThis.__desktopSmokeMenu)");
    return await mainInspector.evaluate(`(()=>{
      const snapshot=items=>items.map(item=>({id:item.id,label:item.label,type:item.type,enabled:item.enabled,checked:item.checked,submenu:item.submenu?snapshot(item.submenu.items):null}));
      return snapshot(globalThis.__desktopSmokeMenu.items);
    })()`);
  } finally {
    await mainInspector.evaluate(`(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      if(globalThis.__desktopSmokeOriginalPopup) electron.Menu.prototype.popup=globalThis.__desktopSmokeOriginalPopup;
      delete globalThis.__desktopSmokeOriginalPopup;
      return true;
    })()`).catch(() => undefined);
  }
}

async function invokeCapturedMenu(id) {
  const clicked = await mainInspector.evaluate(`(()=>{
    const item=globalThis.__desktopSmokeMenu?.getMenuItemById(${JSON.stringify(id)});
    if(!item || !item.enabled || typeof item.click!=="function") return false;
    item.click(item);
    return true;
  })()`);
  assert.equal(clicked, true, `Missing, disabled or non-clickable captured menu item: ${id}`);
}

function menuItem(menu, id) {
  for (const item of menu) {
    if (item.id === id) return item;
    const nested = item.submenu && menuItem(item.submenu, id);
    if (nested) return nested;
  }
  return null;
}

async function setCompanionAtWorkAreaCenter() {
  const position = await mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("companion.html"));
    const bounds=window.getBounds();
    const area=electron.screen.getDisplayMatching(bounds).workArea;
    return {x:Math.round(area.x+(area.width-bounds.width)/2),y:Math.round(area.y+(area.height-bounds.height)/2)};
  })()`);
  await companion.evaluate(`window.companion.setPreferences({position:${JSON.stringify(position)},positionLocked:false})`);
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");const b=electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("companion.html"))?.getBounds();return b?.x===${position.x}&&b?.y===${position.y}})()`);
}

async function verifyPreferenceRetry() {
  const installed = await mainInspector.evaluate(`(()=>{
    const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const handlers=ipcMain._invokeHandlers;
    const save=handlers?.get("companion:set-preferences");
    const hide=handlers?.get("companion:hide");
    if(typeof save!=="function"||typeof hide!=="function")return false;
    globalThis.__desktopSmokePreferenceHandlers={save,hide,saveFailures:0,hideFailures:0};
    handlers.set("companion:set-preferences",(...args)=>{
      if(globalThis.__desktopSmokePreferenceHandlers.saveFailures++===0)throw new Error("SMOKE_SAVE_REJECTED");
      return save(...args);
    });
    handlers.set("companion:hide",(...args)=>{
      if(globalThis.__desktopSmokePreferenceHandlers.hideFailures++===0)throw new Error("SMOKE_HIDE_REJECTED");
      return hide(...args);
    });
    return true;
  })()`);
  assert.equal(installed, true, "Could not install the isolated IPC failure fixture");
  try {
    const before = await renderer.evaluate("window.mingshen.getCompanionPreferences()");
    const wanted = !before.greetingEnabled;
    await click(renderer, 'input[aria-label="开启问候"]');
    await until(renderer, `(()=>{const error=[...document.querySelectorAll(".desktop-experience-error")].find(el=>el.textContent.includes("SMOKE_SAVE_REJECTED"));return Boolean(error&&error.textContent.includes("重试保存"))})()`);
    assert.equal((await renderer.evaluate("window.mingshen.getCompanionPreferences()")).greetingEnabled, before.greetingEnabled);
    assert.equal(await renderer.evaluate('document.querySelector(\'input[aria-label="开启问候"]\').checked'), wanted);

    await clickText(renderer, ".desktop-experience-actions", "暂时隐藏");
    await until(renderer, `(()=>{const errors=[...document.querySelectorAll(".desktop-experience-error")].map(el=>el.textContent);return errors.some(text=>text.includes("SMOKE_SAVE_REJECTED")&&text.includes("重试保存"))&&errors.some(text=>text.includes("SMOKE_HIDE_REJECTED"))})()`);
    assert.equal(await renderer.evaluate('document.querySelector(\'input[aria-label="开启问候"]\').checked'), wanted);
    await clickText(renderer, ".desktop-experience-actions", "暂时隐藏");
    await until(renderer, 'window.mingshen.getCompanionState().then(state=>!state.visible)');
    await until(renderer, `document.querySelector(".desktop-experience-error")?.textContent.includes("重试保存")`);
    await clickText(renderer, ".desktop-experience-actions", "显示桌宠");
    await until(renderer, 'window.mingshen.getCompanionState().then(state=>state.visible)');
    await until(renderer, `document.querySelector(".desktop-experience-error")?.textContent.includes("重试保存")`);
    assert.equal(await renderer.evaluate('document.querySelector(\'input[aria-label="开启问候"]\').checked'), wanted);
    assert.equal((await renderer.evaluate("window.mingshen.getCompanionPreferences()")).greetingEnabled, before.greetingEnabled);

    await clickText(renderer, ".desktop-experience-error", "重试保存");
    await until(renderer, `window.mingshen.getCompanionPreferences().then(value=>value.greetingEnabled===${wanted})`);
    await until(renderer, `![...document.querySelectorAll(".desktop-experience-error")].some(el=>el.textContent.includes("重试保存"))`);
    const calls = await mainInspector.evaluate('({save:globalThis.__desktopSmokePreferenceHandlers.saveFailures,hide:globalThis.__desktopSmokePreferenceHandlers.hideFailures})');
    assert.equal(calls.save, 2, "The failed save was not retried exactly once");
    assert.equal(calls.hide, 2, "The failed hide was not retried exactly once");
    if (wanted !== before.greetingEnabled) {
      await click(renderer, 'input[aria-label="开启问候"]');
      await until(renderer, `window.mingshen.getCompanionPreferences().then(value=>value.greetingEnabled===${before.greetingEnabled})`);
    }
  } finally {
    await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const saved=globalThis.__desktopSmokePreferenceHandlers;
      if(!saved)return false;
      ipcMain._invokeHandlers.set("companion:set-preferences",saved.save);
      ipcMain._invokeHandlers.set("companion:hide",saved.hide);
      delete globalThis.__desktopSmokePreferenceHandlers;
      return true;
    })()`);
  }
}

async function readPersistedTitlePreference() {
  return mainInspector.evaluate(`(()=>{
    const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json");
    const {app}=require("electron"),path=require("node:path");
    if(path.resolve(app.getPath("userData"))!==path.resolve(${JSON.stringify(profile)}))
      throw new Error("Privacy fixture is not using its isolated profile");
    const {DatabaseSync}=process.getBuiltinModule("node:sqlite");
    const db=new DatabaseSync(path.join(app.getPath("userData"),"mingshen.db"),{readOnly:true});
    try{
      const rows=db.prepare("select value_json from app_settings where value_json like ?")
        .all('%"showSessionTitles"%')
        .map(row=>JSON.parse(row.value_json))
        .filter(value=>value&&typeof value.showSessionTitles==="boolean"&&typeof value.taskPanelEnabled==="boolean"&&typeof value.animationEnabled==="boolean");
      if(rows.length!==1)throw new Error("Could not uniquely identify isolated companion preferences");
      return rows[0].showSessionTitles;
    }finally{db.close()}
  })()`);
}

async function verifyTitlePrivacySaveRetry() {
  assert.equal((await renderer.evaluate("window.mingshen.getCompanionPreferences()")).showSessionTitles, true);
  assert.equal(await readPersistedTitlePreference(), true);
  const installed = await mainInspector.evaluate(`(()=>{
    const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const handlers=ipcMain._invokeHandlers,save=handlers?.get("companion:set-preferences");
    if(typeof save!=="function")return false;
    const fixture=globalThis.__desktopSmokeTitlePrivacy={save,attempts:0,rejectPending:null};
    handlers.set("companion:set-preferences",(...args)=>{
      if(args[1]?.showSessionTitles===false&&++fixture.attempts===1)
        return new Promise((_resolve,reject)=>{fixture.rejectPending=()=>{fixture.rejectPending=null;reject(new Error("SMOKE_PRIVACY_SAVE_REJECTED"))}});
      return save(...args);
    });
    return true;
  })()`);
  assert.equal(installed, true, "Could not install the isolated title-privacy failure fixture");
  try {
    await click(renderer, 'input[aria-label="显示会话标题"]');
    await until(mainInspector, 'typeof globalThis.__desktopSmokeTitlePrivacy?.rejectPending==="function"');
    await until(renderer, `(()=>{const input=document.querySelector('input[aria-label="显示会话标题"]');const text=input?.closest("label")?.textContent||"";return input?.checked===false&&text.includes("尚未生效")&&text.includes("仍可能显示会话标题")})()`);
    assert.equal((await renderer.evaluate("window.mingshen.getCompanionPreferences()")).showSessionTitles, true);
    assert.equal((await companion.evaluate("window.companion.getState()")).preferences.showSessionTitles, true);
    assert.equal(await readPersistedTitlePreference(), true);
    await screenshot(renderer, "desktop-settings-title-privacy-pending");

    await mainInspector.evaluate('globalThis.__desktopSmokeTitlePrivacy.rejectPending();true');
    await until(renderer, `(()=>{const error=[...document.querySelectorAll(".desktop-experience-error")].find(el=>el.textContent.includes("SMOKE_PRIVACY_SAVE_REJECTED"));const input=document.querySelector('input[aria-label="显示会话标题"]');return Boolean(error&&error.textContent.includes("重试保存")&&input?.checked===false&&input.closest("label")?.textContent.includes("尚未生效"))})()`);
    assert.equal((await companion.evaluate("window.companion.getState()")).preferences.showSessionTitles, true);
    assert.equal(await readPersistedTitlePreference(), true);
    await screenshot(renderer, "desktop-settings-title-privacy-failed");

    await clickText(renderer, ".desktop-experience-error", "重试保存");
    await until(renderer, `window.mingshen.getCompanionPreferences().then(value=>value.showSessionTitles===false)`);
    await until(companion, 'window.companion.getState().then(state=>state.preferences.showSessionTitles===false)');
    await until(renderer, `(()=>{const input=document.querySelector('input[aria-label="显示会话标题"]');return input?.checked===false&&!input.closest("label")?.textContent.includes("尚未生效")&&![...document.querySelectorAll(".desktop-experience-error")].some(el=>el.textContent.includes("重试保存"))})()`);
    assert.equal(await readPersistedTitlePreference(), false);
    assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeTitlePrivacy.attempts'), 2);

    await click(renderer, 'input[aria-label="显示会话标题"]');
    await until(companion, 'window.companion.getState().then(state=>state.preferences.showSessionTitles===true)');
    await until(renderer, `(()=>{const input=document.querySelector('input[aria-label="显示会话标题"]');return input?.checked===true&&!input.closest("label")?.textContent.includes("尚未生效")})()`);
    assert.equal(await readPersistedTitlePreference(), true);
  } finally {
    await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const fixture=globalThis.__desktopSmokeTitlePrivacy;
      if(!fixture)return false;
      fixture.rejectPending?.();
      ipcMain._invokeHandlers.set("companion:set-preferences",fixture.save);
      delete globalThis.__desktopSmokeTitlePrivacy;
      return true;
    })()`);
  }
}

async function verifySmallWorkAreaLayout() {
  const area = await mainInspector.evaluate(`(()=>{
    const {screen,BrowserWindow}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const window=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("companion.html"));
    if(!window||globalThis.__desktopSmokeSmallWorkArea)return null;
    const current=screen.getDisplayMatching(window.getBounds()).workArea;
    if(current.width<240||current.height<280)return null;
    const area={x:Math.round(current.x+(current.width-240)/2),y:Math.round(current.y+(current.height-280)/2),width:240,height:280};
    const original=screen.getDisplayNearestPoint;
    let calls=0;
    const replacement=(...args)=>{calls++;return {...original.apply(screen,args),workArea:area}};
    screen.getDisplayNearestPoint=replacement;
    const probe=screen.getDisplayNearestPoint({x:area.x,y:area.y}).workArea;
    if(calls!==1||probe.x!==area.x||probe.y!==area.y||probe.width!==240||probe.height!==280){
      screen.getDisplayNearestPoint=original;
      throw new Error("The isolated small-work-area replacement did not affect Electron screen lookups");
    }
    globalThis.__desktopSmokeSmallWorkArea={original};
    return area;
  })()`);
  assert.ok(area, "Could not install the isolated small-work-area fixture");
  try {
    await companion.evaluate('window.companion.setPreferences({size:320})');
    await until(companion, `window.companion.getState().then(state=>{
      const avatar=document.querySelector(".companion-avatar")?.getBoundingClientRect();
      const panel=document.querySelector(".companion-task-panel")?.getBoundingClientRect();
      return state.taskPanelOpen&&state.preferences.size===320&&state.layout.avatarSize===168&&state.layout.panelHeight===112&&
        innerWidth===240&&innerHeight===280&&Boolean(avatar&&panel&&avatar.width===168&&avatar.height===168&&panel.height===112);
    })`);
    const state = await companion.evaluate("window.companion.getState()");
    const native = (await inspectWindows()).companion;
    const layout = await companion.evaluate(`(()=>{
      const rect=selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null};
      return {avatar:rect(".companion-avatar"),panel:rect(".companion-task-panel"),row:rect(".companion-task-row")};
    })()`);
    assert.deepEqual(state.layout, { avatarSize: 168, panelHeight: 112 });
    assert.equal(state.preferences.size, 320, "A small display changed the stored avatar size");
    assert.ok(native.bounds.x>=area.x&&native.bounds.y>=area.y&&native.bounds.x+native.bounds.width<=area.x+area.width&&native.bounds.y+native.bounds.height<=area.y+area.height,
      `The companion escaped the simulated small work area: ${JSON.stringify({area,native})}`);
    assert.ok(layout.avatar&&layout.panel&&layout.row&&layout.panel.top>=layout.avatar.bottom-1&&layout.row.top>=layout.panel.top&&layout.row.bottom<=layout.panel.bottom,
      `The small-area controls overlap or are clipped: ${JSON.stringify(layout)}`);
    geometry.push({ name: "companion-small-work-area", area, native, ipcLayout: state.layout, layout });
    await screenshot(companion, "companion-small-work-area");
  } finally {
    await mainInspector.evaluate(`(()=>{
      const {screen}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const fixture=globalThis.__desktopSmokeSmallWorkArea;
      if(!fixture)return false;
      screen.getDisplayNearestPoint=fixture.original;
      delete globalThis.__desktopSmokeSmallWorkArea;
      return true;
    })()`);
    await companion.evaluate('window.companion.setPreferences({size:320})');
    await until(companion, 'window.companion.getState().then(state=>state.layout.avatarSize===320&&state.layout.panelHeight===144&&innerWidth===320&&innerHeight===464)');
  }
}

async function verifyWorkingPanelGeometry() {
  const originalSize = (await renderer.evaluate("window.mingshen.getCompanionPreferences()")).size;
  for (const size of [96, 176, 320]) {
    await setRangeSetting("桌宠大小", size, `window.mingshen.getCompanionPreferences().then(value=>value.size===${size})`);
    await until(companion, `window.companion.getState().then(state=>{
      const avatar=document.querySelector(".companion-avatar")?.getBoundingClientRect();
      const panel=document.querySelector(".companion-task-panel")?.getBoundingClientRect();
      return state.taskPanelOpen&&state.tasks.length>0&&state.preferences.size===${size}&&state.layout.avatarSize===${size}&&state.layout.panelHeight===144&&
        Math.abs(innerWidth-Math.max(state.layout.avatarSize,272))<=1&&Math.abs(innerHeight-state.layout.avatarSize-state.layout.panelHeight)<=1&&
        Boolean(avatar&&panel&&Math.abs(avatar.width-state.layout.avatarSize)<=1&&Math.abs(panel.height-state.layout.panelHeight)<=1);
    })`);
    const state = await companion.evaluate("window.companion.getState()");
    assert.deepEqual(state.layout, { avatarSize: size, panelHeight: 144 }, `Unexpected IPC layout at ${size}px`);
    const width = Math.max(state.layout.avatarSize, 272);
    const height = state.layout.avatarSize + state.layout.panelHeight;
    const native = (await inspectWindows()).companion;
    assert.ok(Math.abs(native.bounds.width - width) <= 1 && Math.abs(native.bounds.height - height) <= 1,
      `Expanded native companion dimensions are incorrect at ${size}px: ${JSON.stringify(native.bounds)}`);
    const layout = await companion.evaluate(`(()=>{
      const rect=selector=>{
        const element=document.querySelector(selector);
        if(!element)return null;
        const box=element.getBoundingClientRect();
        return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height};
      };
      return {width:innerWidth,height:innerHeight,avatar:rect(".companion-avatar"),panel:rect(".companion-task-panel"),row:rect(".companion-task-row")};
    })()`);
    assert.ok(layout.avatar && layout.panel && layout.row, `Working-session controls missing at ${size}px`);
    assert.ok(Math.abs(layout.avatar.width - state.layout.avatarSize) <= 1 && Math.abs(layout.avatar.height - state.layout.avatarSize) <= 1 &&
      Math.abs(layout.avatar.right - layout.width) <= 1 && Math.abs(layout.avatar.top) <= 1,
    `Avatar did not retain its upper-right square at ${size}px: ${JSON.stringify(layout)}`);
    assert.ok(Math.abs(layout.panel.height - state.layout.panelHeight) <= 1 &&
      layout.panel.top >= layout.avatar.bottom - 1 && layout.panel.left >= -1 &&
      layout.panel.right <= layout.width + 1 && layout.panel.bottom <= layout.height + 1 &&
      layout.row.top >= layout.panel.top - 1 && layout.row.bottom <= layout.panel.bottom + 1,
    `Working-session panel is clipped or overlaps the avatar at ${size}px: ${JSON.stringify(layout)}`);
    geometry.push({ name: `companion-task-panel-${size}`, native, ipcLayout: state.layout, layout });
    await screenshot(companion, `companion-task-panel-${size}`);
  }
  await verifySmallWorkAreaLayout();
  await setRangeSetting("桌宠大小", originalSize, `window.mingshen.getCompanionPreferences().then(value=>value.size===${originalSize})`);
  await until(companion, `window.companion.getState().then(state=>state.taskPanelOpen&&Math.abs(innerHeight-${originalSize + 144})<=1)`);
  await renderer.evaluate('window.mingshen.desktopAction("locale","en")');
  await until(companion, 'Boolean(document.querySelector(\'.companion-task-panel[aria-label="Working conversations"]\')&&document.querySelector(\'button[aria-label="Collapse working conversations"]\'))');
  await renderer.evaluate('window.mingshen.desktopAction("locale","zh-CN")');
  await until(companion, 'Boolean(document.querySelector(\'.companion-task-panel[aria-label="工作会话"]\'))');
  await click(companion, 'button[aria-label="折叠工作会话"]');
  await until(companion, `window.companion.getState().then(state=>!state.taskPanelOpen&&state.layout.avatarSize===${originalSize}&&state.layout.panelHeight===0&&Math.abs(innerWidth-state.layout.avatarSize)<=1&&Math.abs(innerHeight-state.layout.avatarSize)<=1)`);
  await click(companion, 'button[aria-label="展开工作会话"]');
  await until(companion, 'window.companion.getState().then(state=>state.taskPanelOpen&&Boolean(document.querySelector(".companion-task-panel")))');
  await setCompanionSetting("显示工作会话面板", false);
  await until(companion, `window.companion.getState().then(state=>!state.preferences.taskPanelEnabled&&!state.taskPanelOpen&&!document.querySelector(".companion-task-panel")&&Math.abs(innerWidth-${originalSize})<=1)`);
  await setCompanionSetting("显示工作会话面板", true);
  await until(companion, 'window.companion.getState().then(state=>state.preferences.taskPanelEnabled&&state.taskPanelOpen&&Boolean(document.querySelector(".companion-task-panel")))');
}

async function verifyNavigationReceipts(sessionId) {
  const installed = await mainInspector.evaluate(`(()=>{
    const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const handlers=ipcMain._invokeHandlers,resultChannel="companion:session-navigation-result",
      claimChannel="companion:session-navigation-claim",report=handlers?.get(resultChannel),
      listeners=ipcMain.listeners(claimChannel);
    if(typeof report!=="function"||listeners.length!==1||typeof listeners[0]!=="function")return false;
    const fixture=globalThis.__desktopSmokeNavigationReceipt={
      report,claim:listeners[0],wrapper:null,receipts:[],claims:[],forwarded:[],delayNext:false,release:null
    };
    handlers.set(resultChannel,(event,result)=>{
      fixture.receipts.push({requestId:result?.requestId,accepted:result?.accepted,reason:result?.reason});
      return report(event,result);
    });
    fixture.wrapper=(event,requestId,sessionId)=>{
      fixture.claims.push({requestId,sessionId});
      const forward=()=>{fixture.forwarded.push({requestId,sessionId});fixture.claim(event,requestId,sessionId)};
      if(fixture.delayNext){
        fixture.delayNext=false;
        fixture.release=()=>{fixture.release=null;forward()};
        return;
      }
      forward();
    };
    ipcMain.removeListener(claimChannel,fixture.claim);
    ipcMain.on(claimChannel,fixture.wrapper);
    return true;
  })()`);
  assert.equal(installed, true, "Could not install the navigation claim/receipt fixture");
  try {
    await until(companion, 'Boolean(document.querySelector(".companion-task-row")&&!document.querySelector(".companion-task-row").disabled)');
    await renderer.evaluate(`(()=>{
      const editor=document.createElement("div");
      editor.className="task-workbench";editor.hidden=true;
      editor.dataset.unsaved="true";editor.dataset.taskSession="SMOKE_OTHER_SESSION";
      editor.id="desktop-smoke-unsaved-plan";document.body.append(editor);return true;
    })()`);
    await click(companion, ".companion-task-row");
    await until(mainInspector, `globalThis.__desktopSmokeNavigationReceipt.receipts.some(value=>value.accepted===false&&value.reason==="unsaved_plan"&&typeof value.requestId==="string")`);
    await until(companion, `(()=>{const row=document.querySelector(".companion-task-row"),error=document.querySelector(".companion-task-error");return Boolean(row&&!row.disabled&&error?.textContent.includes("请先保存或取消主界面正在编辑的计划"))})()`);
    await screenshot(companion, "companion-navigation-unsaved-plan");
    const declined = await mainInspector.evaluate('globalThis.__desktopSmokeNavigationReceipt.receipts.at(-1)');
    assert.equal(await renderer.evaluate(`window.__desktopSmokeEvents.some(event=>event.type==="select-session"&&event.sessionId===${JSON.stringify(sessionId)}&&event.requestId===${JSON.stringify(declined.requestId)})`), true,
      "The rejection did not match the real session navigation request");
    await renderer.evaluate('document.querySelector("#desktop-smoke-unsaved-plan")?.remove();true');

    const alternate = await renderer.evaluate(`(async()=>{
      const target=await window.mingshen.getSession(${JSON.stringify(sessionId)});
      const session=await window.mingshen.createSession({providerId:target.providerId,modelId:target.modelId,
        title:"NAVIGATION_SMOKE_ALTERNATE",workspacePath:target.workspacePath,
        reasoningLevel:null,permissionMode:"request_approval",agentMode:"code"});
      return session.id;
    })()`);
    const memoryFixture = await renderer.evaluate(`(async()=>{
      const session=await window.mingshen.getSession(${JSON.stringify(alternate)});
      const configuration=await window.mingshen.getProjectMemoryConfiguration(session.workspacePath);
      const memory=await window.mingshen.getProjectMemory(session.id);
      return {workspacePath:session.workspacePath,configurationRoot:configuration.workspacePath,
        backend:configuration.backend,memoryRoot:memory.root};
    })()`);
    assert.ok(memoryFixture.workspacePath, "The project-memory navigation fixture has no workspace");
    assert.equal(memoryFixture.configurationRoot.toLowerCase(), memoryFixture.workspacePath.toLowerCase(),
      "The project-memory fixture resolved to a different workspace");
    assert.equal(memoryFixture.backend, "native", "The isolated project-memory fixture is not using native memory");
    assert.ok(memoryFixture.memoryRoot, "The isolated project-memory fixture did not load");
    await mainInspector.evaluate(`(()=>{
      const {BrowserWindow}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const main=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes("index.html")&&!window.webContents.getURL().includes("surface=quick-chat"));
      if(!main)throw new Error("Main window is unavailable");
      main.webContents.send("desktop:event",{type:"select-session",sessionId:${JSON.stringify(alternate)}});
      return true;
    })()`);
    await until(renderer, `Boolean(document.querySelector('[data-session-id="${alternate}"] .session-row[aria-current="page"]'))`);
    await closeSettings();
    const alternateRun = await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(alternate)},text:"NAVIGATION_HISTORY_ORIGINAL_SENTINEL"})`);
    assert.ok(alternateRun?.runId, "Could not create the navigation history fixture");
    await renderer.evaluate(`window.mingshen.stopChat(${JSON.stringify(alternate)})`);
    await until(companion, `window.companion.getState().then(state=>!state.tasks.some(task=>task.sessionId===${JSON.stringify(alternate)}))`);
    await until(renderer, 'Boolean(document.querySelector(\'.message--user button[aria-label="修改消息"]:not(:disabled)\'))');
    await click(renderer, '.message--user button[aria-label="修改消息"]');
    await until(renderer, 'Boolean(document.querySelector(\'.user-message-editor textarea[aria-label="修改消息"]:not(:disabled)\'))');
    await renderer.evaluate(`(()=>{
      const input=document.querySelector('.user-message-editor textarea[aria-label="修改消息"]');
      input.focus();input.setSelectionRange(input.value.length,input.value.length);return true;
    })()`);
    await renderer.send("Input.insertText", { text: " NAVIGATION_HISTORY_UNSAVED_SENTINEL" });
    await until(renderer, 'document.querySelector(\'.message--user[data-unsaved="true"] .user-message-editor textarea\')?.value.includes("NAVIGATION_HISTORY_UNSAVED_SENTINEL")');
    let receiptCount = await mainInspector.evaluate('globalThis.__desktopSmokeNavigationReceipt.receipts.length');
    await click(companion, ".companion-task-row");
    await until(mainInspector, `globalThis.__desktopSmokeNavigationReceipt.receipts.length>${receiptCount}&&globalThis.__desktopSmokeNavigationReceipt.receipts.at(-1)?.reason==="unsaved_edits"&&globalThis.__desktopSmokeNavigationReceipt.receipts.at(-1)?.accepted===false`);
    await until(companion, 'document.querySelector(".companion-task-error")?.textContent.includes("请先保存或取消主界面尚未完成的编辑")');
    assert.equal(await renderer.evaluate(`Boolean(document.querySelector('[data-session-id="${alternate}"] .session-row[aria-current="page"]'))`), true,
      "Companion navigation changed sessions despite an unsaved message edit");
    assert.equal(await renderer.evaluate('document.querySelector(\'.message--user[data-unsaved="true"] .user-message-editor textarea\')?.value.includes("NAVIGATION_HISTORY_UNSAVED_SENTINEL")'), true,
      "The rejected companion navigation lost the message edit");
    await screenshot(renderer, "companion-navigation-unsaved-message");
    await clickText(renderer, ".user-message-editor__actions", "取消");
    await until(renderer, '!document.querySelector(\'.message--user[data-unsaved="true"]\')');

    await click(renderer, 'button[aria-label="打开设置"]');
    await until(renderer, 'Boolean(document.querySelector(".settings-workspace"))');
    await clickText(renderer, ".settings-nav", "项目指令与信任");
    await until(renderer, 'Boolean(document.querySelector(".project-diary textarea:not(:disabled):not([readonly])"))');
    await renderer.evaluate(`(()=>{
      const input=document.querySelector(".project-diary textarea");
      input.focus();input.setSelectionRange(input.value.length,input.value.length);return true;
    })()`);
    await renderer.send("Input.insertText", { text: " NAVIGATION_MEMORY_UNSAVED_SENTINEL" });
    await until(renderer, 'document.querySelector(\'.project-diary[data-unsaved="true"] textarea\')?.value.includes("NAVIGATION_MEMORY_UNSAVED_SENTINEL")');
    receiptCount = await mainInspector.evaluate('globalThis.__desktopSmokeNavigationReceipt.receipts.length');
    await click(companion, ".companion-task-row");
    await until(mainInspector, `globalThis.__desktopSmokeNavigationReceipt.receipts.length>${receiptCount}&&globalThis.__desktopSmokeNavigationReceipt.receipts.at(-1)?.reason==="unsaved_edits"&&globalThis.__desktopSmokeNavigationReceipt.receipts.at(-1)?.accepted===false`);
    await until(companion, 'document.querySelector(".companion-task-error")?.textContent.includes("请先保存或取消主界面尚未完成的编辑")');
    assert.equal(await renderer.evaluate(`Boolean(document.querySelector('[data-session-id="${alternate}"] .session-row[aria-current="page"]'))`), true,
      "Companion navigation changed sessions despite an unsaved project-memory edit");
    assert.equal(await renderer.evaluate('document.querySelector(\'.project-diary[data-unsaved="true"] textarea\')?.value.includes("NAVIGATION_MEMORY_UNSAVED_SENTINEL")'), true,
      "The rejected companion navigation lost the project-memory draft");
    assert.equal(await renderer.evaluate(`Boolean(document.querySelector('[data-session-id="${alternate}"] .session-row[aria-current="page"]')&&document.querySelector('.project-diary[data-unsaved="true"]'))`), true,
      "The rejected companion navigation did not leave the project-memory editor dirty in the current session");
    await screenshot(renderer, "companion-navigation-unsaved-memory");
    // The preceding assertion and screenshot are the retention evidence. The
    // explicit discard below is test cleanup so later navigation checks can run.
    await clickText(renderer, ".settings-nav", "桌面体验");
    await until(renderer, 'document.querySelector(\'.mingshen-dialog[role="alertdialog"] #mingshen-dialog-title\')?.textContent.includes("放弃未保存的项目修改")');
    await click(renderer, '.mingshen-dialog__actions button:last-child');
    await until(renderer, 'Boolean(document.querySelector(".desktop-experience-settings"))');

    await companion.evaluate(`(()=>{
      const probe=window.__desktopSmokeNavigationBusy={sawBusy:false,observer:null};
      const observe=()=>{
        const row=document.querySelector(".companion-task-row"),list=document.querySelector(".companion-task-list");
        if(row?.disabled&&list?.getAttribute("aria-busy")==="true")probe.sawBusy=true;
      };
      probe.observer=new MutationObserver(observe);
      probe.observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["disabled","aria-busy"]});
      observe();
      return true;
    })()`);
    await mainInspector.evaluate('globalThis.__desktopSmokeNavigationReceipt.delayNext=true;true');
    await click(companion, ".companion-task-row");
    await until(mainInspector, 'typeof globalThis.__desktopSmokeNavigationReceipt.release==="function"');
    const claim = await mainInspector.evaluate('globalThis.__desktopSmokeNavigationReceipt.claims.at(-1)');
    assert.equal(claim.sessionId, sessionId, "The claim targeted the wrong session");
    assert.equal(typeof claim.requestId, "string");
    assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeNavigationReceipt.forwarded.length'), 0,
      "The real claim listener was called before the held request was released");
    await sleep(350);
    await mainInspector.evaluate('globalThis.__desktopSmokeNavigationReceipt.release();true');
    assert.deepEqual(await mainInspector.evaluate('globalThis.__desktopSmokeNavigationReceipt.forwarded'), [claim],
      "The real claim listener did not receive exactly the held request");
    await until(companion, `(()=>{const row=document.querySelector(".companion-task-row"),list=document.querySelector(".companion-task-list");return Boolean(row&&!row.disabled&&list?.getAttribute("aria-busy")==="false"&&!document.querySelector(".companion-task-error"))})()`);
    assert.equal(await companion.evaluate('window.__desktopSmokeNavigationBusy.sawBusy'), true,
      "The task row did not show a busy state while the claim was pending");
    await until(renderer, `Boolean(document.querySelector('[data-session-id="${sessionId}"] .session-row[aria-current="page"]'))`);
    assert.equal(await renderer.evaluate(`window.__desktopSmokeEvents.some(event=>event.type==="select-session"&&event.sessionId===${JSON.stringify(sessionId)}&&event.requestId===${JSON.stringify(claim.requestId)})`), true,
      "The claim did not match the real session navigation request");
    await screenshot(companion, "companion-navigation-claim-complete");
  } finally {
    await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const fixture=globalThis.__desktopSmokeNavigationReceipt;
      if(!fixture)return false;
      fixture.release?.();
      ipcMain._invokeHandlers.set("companion:session-navigation-result",fixture.report);
      ipcMain.removeListener("companion:session-navigation-claim",fixture.wrapper);
      ipcMain.on("companion:session-navigation-claim",fixture.claim);
      delete globalThis.__desktopSmokeNavigationReceipt;
      return true;
    })()`);
    await companion.evaluate('window.__desktopSmokeNavigationBusy?.observer?.disconnect();delete window.__desktopSmokeNavigationBusy;true').catch(() => undefined);
    await renderer.evaluate('document.querySelector("#desktop-smoke-unsaved-plan")?.remove();true').catch(() => undefined);
  }
}

async function waitForRealIdle(name) {
  const started = Date.now();
  await until(companion, 'window.companion.getState().then(state=>state.mood==="idle"&&state.motionRequest?.source==="idle")', 105_000);
  const request = (await companion.evaluate("window.companion.getState()")).motionRequest;
  assert.ok(request?.action, "The idle scheduler did not produce an action");
  await until(companion, `document.querySelector(".companion-video.is-visible")?.dataset.motion===${JSON.stringify(request.action)}`, 20_000);
  geometry.push({ name, waitMs: Date.now() - started, request });
  return request;
}

async function verifyQuietIdleInterruption() {
  await waitForRealIdle("companion-real-idle-before-quiet");
  await companion.evaluate(`(()=>{
    const old=document.querySelector(".companion-video.is-visible");
    if(!old||window.__desktopSmokeMotionProbe)throw new Error("Idle playback probe is not available");
    const original=HTMLMediaElement.prototype.play;
    const probe=window.__desktopSmokeMotionProbe={old,original,pending:[]};
    HTMLMediaElement.prototype.play=function(...args){
      if(/(?:^|\\/)idle_breathe-[^/]+\\.webm/.test(this.getAttribute("src")||""))
        return new Promise((resolve,reject)=>probe.pending.push({video:this,resolve,reject}));
      return original.apply(this,args);
    };
    return true;
  })()`);
  try {
    await renderer.evaluate('window.mingshen.setCompanionPreferences({quietMode:true})');
    await until(companion, 'window.__desktopSmokeMotionProbe.pending.length>0', 6_000);
    const interrupted = await companion.evaluate(`(()=>{
      const probe=window.__desktopSmokeMotionProbe;
      return {oldSource:probe.old.getAttribute("src"),oldPaused:probe.old.paused,
        visible:Boolean(document.querySelector(".companion-video.is-visible")),
        fallback:getComputedStyle(document.querySelector(".companion-character")).visibility};
    })()`);
    assert.deepEqual(interrupted, { oldSource: null, oldPaused: true, visible: false, fallback: "visible" },
      `Quiet mode left a stale automatic clip visible while the next play was delayed: ${JSON.stringify(interrupted)}`);
    await screenshot(companion, "companion-idle-quiet-delayed-play");
    await companion.evaluate(`(async()=>{
      const probe=window.__desktopSmokeMotionProbe, item=probe.pending.at(-1);
      try { await probe.original.call(item.video); item.resolve(); }
      catch(error) { item.reject(error); throw error; }
      return true;
    })()`);
    await until(companion, 'document.querySelector(".companion-video.is-visible")?.dataset.motion==="idle_breathe"', 6_000);
  } finally {
    await companion.evaluate(`(()=>{
      const probe=window.__desktopSmokeMotionProbe;
      if(!probe)return false;
      HTMLMediaElement.prototype.play=probe.original;
      for(const item of probe.pending)item.resolve();
      delete window.__desktopSmokeMotionProbe;
      return true;
    })()`);
    await renderer.evaluate('window.mingshen.setCompanionPreferences({quietMode:false})');
  }
}

async function startTaskWithDelayedPlayback(sessionId, text, onTaskStarted) {
  await companion.evaluate(`(()=>{
    const old=document.querySelector(".companion-video.is-visible");
    if(!old||window.__desktopSmokeMotionProbe)throw new Error("Idle playback probe is not available");
    const original=HTMLMediaElement.prototype.play;
    const probe=window.__desktopSmokeMotionProbe={old,original,pending:[]};
    HTMLMediaElement.prototype.play=function(...args){
      if(/(?:^|\\/)(?:thinking|working|waiting)(?:_|-)/.test(this.getAttribute("src")||""))
        return new Promise((resolve,reject)=>probe.pending.push({video:this,resolve,reject}));
      return original.apply(this,args);
    };
    return true;
  })()`);
  try {
    const run = await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(sessionId)},text:${JSON.stringify(text)}})`);
    assert.ok(run?.runId, "Fixture task did not return a run id");
    await until(companion, `window.companion.getState().then(state=>state.motionRequest?.source!=="idle"&&state.tasks.some(task=>task.sessionId===${JSON.stringify(sessionId)}&&task.runId===${JSON.stringify(run.runId)}))`);
    await until(companion, 'window.__desktopSmokeMotionProbe.pending.length>0', 6_000);
    const interrupted = await companion.evaluate(`(()=>{
      const probe=window.__desktopSmokeMotionProbe;
      return {oldSource:probe.old.getAttribute("src"),oldPaused:probe.old.paused,
        visible:Boolean(document.querySelector(".companion-video.is-visible")),
        fallback:getComputedStyle(document.querySelector(".companion-character")).visibility};
    })()`);
    assert.deepEqual(interrupted, { oldSource: null, oldPaused: true, visible: false, fallback: "visible" },
      `A real task left a stale automatic clip visible while its play was delayed: ${JSON.stringify(interrupted)}`);
    await onTaskStarted?.();
    await screenshot(companion, "companion-task-delayed-play");
    const priorPending = await companion.evaluate("window.__desktopSmokeMotionProbe.pending.length");
    await renderer.evaluate('window.mingshen.setCompanionPreferences({animationEnabled:false})');
    await until(companion, 'window.companion.getState().then(state=>!state.preferences.animationEnabled&&[...document.querySelectorAll(".companion-video")].every(video=>!video.getAttribute("src")))');
    await renderer.evaluate('window.mingshen.setCompanionPreferences({animationEnabled:true})');
    await until(companion, `window.__desktopSmokeMotionProbe.pending.length>${priorPending}`, 6_000);
    await companion.evaluate(`(async()=>{
      const probe=window.__desktopSmokeMotionProbe, item=probe.pending.at(-1);
      try { await probe.original.call(item.video); item.resolve(); }
      catch(error) { item.reject(error); throw error; }
      return true;
    })()`);
    await until(companion, '/^(thinking|working|waiting)/.test(document.querySelector(".companion-video.is-visible")?.dataset.motion||"")', 6_000);
    await companion.evaluate(`(()=>{
      const probe=window.__desktopSmokeMotionProbe;
      probe.accepted=document.querySelector(".companion-video.is-visible");
      probe.pending[0].resolve();
      return true;
    })()`);
    await sleep(250);
    assert.equal(await companion.evaluate('document.querySelector(".companion-video.is-visible")===window.__desktopSmokeMotionProbe.accepted'), true,
      "A late stale play resolution replaced the newer task clip");
    return run;
  } finally {
    await companion.evaluate(`(()=>{
      const probe=window.__desktopSmokeMotionProbe;
      if(!probe)return false;
      HTMLMediaElement.prototype.play=probe.original;
      for(const item of probe.pending)item.resolve();
      delete window.__desktopSmokeMotionProbe;
      return true;
    })()`);
  }
}

async function verifyTransientPlaybackRecovery() {
  await until(companion, 'window.companion.getState().then(state=>state.mood==="idle"&&state.tasks.length===0)');
  await until(companion, 'Boolean(document.querySelector(".companion-video.is-visible")?.videoWidth)', 20_000);
  await companion.evaluate(`(()=>{
    const original=HTMLMediaElement.prototype.play;
    if(window.__desktopSmokeRetryProbe)throw new Error("Playback retry probe is already installed");
    const probe=window.__desktopSmokeRetryProbe={original,danceFailed:false,idleFailed:false,failIdle:false};
    HTMLMediaElement.prototype.play=function(...args){
      const src=this.getAttribute("src")||"";
      if(!probe.danceFailed&&/(?:^|\\/)dance-[^/]+\\.webm/.test(src)){
        probe.danceFailed=true;return Promise.reject(new Error("Synthetic one-time dance playback failure"));
      }
      if(probe.failIdle&&!probe.idleFailed&&/(?:^|\\/)idle_breathe-[^/]+\\.webm/.test(src)){
        probe.idleFailed=true;return Promise.reject(new Error("Synthetic one-time idle playback failure"));
      }
      return original.apply(this,args);
    };
    return true;
  })()`);
  try {
    await companion.evaluate('window.companion.action({type:"interact",action:"dance"})');
    await until(companion, 'window.__desktopSmokeRetryProbe.danceFailed&&!document.querySelector(".companion-surface.has-motion")&&[...document.querySelectorAll(".companion-video")].every(video=>!video.getAttribute("src"))', 12_000);
    await companion.evaluate('window.companion.action({type:"interact",action:"dance"})');
    await until(companion, 'document.querySelector(".companion-video.is-visible")?.dataset.motion==="dance"', 12_000);
    await screenshot(companion, "companion-dance-retry");

    await renderer.evaluate('window.mingshen.setCompanionPreferences({animationEnabled:false})');
    await until(companion, 'window.companion.getState().then(state=>!state.preferences.animationEnabled&&[...document.querySelectorAll(".companion-video")].every(video=>!video.getAttribute("src")))');
    await companion.evaluate('window.__desktopSmokeRetryProbe.failIdle=true;true');
    await renderer.evaluate('window.mingshen.setCompanionPreferences({animationEnabled:true})');
    await until(companion, 'window.__desktopSmokeRetryProbe.idleFailed&&!document.querySelector(".companion-surface.has-motion")&&[...document.querySelectorAll(".companion-video")].every(video=>!video.getAttribute("src"))', 12_000);
    await renderer.evaluate('window.mingshen.setCompanionPreferences({animationEnabled:false})');
    await until(companion, 'window.companion.getState().then(state=>!state.preferences.animationEnabled)');
    await renderer.evaluate('window.mingshen.setCompanionPreferences({animationEnabled:true})');
    await until(companion, 'document.querySelector(".companion-video.is-visible")?.dataset.motion==="idle_breathe"', 12_000);
    await screenshot(companion, "companion-idle-retry");
  } finally {
    await companion.evaluate(`(()=>{
      const probe=window.__desktopSmokeRetryProbe;
      if(!probe)return false;
      HTMLMediaElement.prototype.play=probe.original;
      delete window.__desktopSmokeRetryProbe;
      return true;
    })()`);
  }
}

async function verifyRealTaskPrivacy() {
  const workspace = join(temporary, "FIXTURE_PRIVATE_WORKSPACE_SENTINEL");
  await mkdir(workspace, { recursive: true });
  const sentinels = ["FIXTURE_PRIVATE_TITLE_SENTINEL", "FIXTURE_PRIVATE_PROMPT_SENTINEL", "FIXTURE_PRIVATE_OUTPUT_SENTINEL", workspace];
  const initialPreferences = await renderer.evaluate("window.mingshen.getCompanionPreferences()");
  assert.equal(initialPreferences.taskPanelEnabled, true, "The isolated profile did not default to the working-session panel");
  assert.equal(initialPreferences.showSessionTitles, true, "The isolated profile did not default to showing session titles");
  await companion.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await renderer.evaluate('window.mingshen.setCompanionPreferences({idleAnimationFrequency:"high",quietMode:false,chattiness:"off",restAfterMinutes:0})');
  const created = await renderer.evaluate(`(async()=>{
    const provider=(await window.mingshen.bootstrap()).providers.find(item=>item.name==="Desktop layout fixture");
    const session=await window.mingshen.createSession({providerId:provider.id,modelId:provider.models[0].id,title:${JSON.stringify(sentinels[0])},workspacePath:${JSON.stringify(workspace)},reasoningLevel:null,permissionMode:"request_approval",agentMode:"code"});
    window.__desktopSmokeEvents=[];
    window.__desktopSmokeUnsubscribe=window.mingshen.onDesktopEvent(event=>window.__desktopSmokeEvents.push(event));
    return {sessionId:session.id};
  })()`);
  const oldRestInterval = (await renderer.evaluate("window.mingshen.getCompanionPreferences()")).restAfterMinutes;
  const pendingRestInterval = oldRestInterval === 73 ? 74 : 73;
  await verifyQuietIdleInterruption();
  await waitForRealIdle("companion-real-idle-before-task");
  await screenshot(companion, "companion-real-idle");
  await focusMain();
  await until(renderer, "document.hasFocus()");
  await renderer.evaluate(`(()=>{
    const input=document.querySelector('input[aria-label="闲置休息分钟数"]');
    if(!input)throw new Error("Rest interval input is missing");
    window.__desktopSmokeRestEvents=[];
    for(const type of ["focus","focusin","input","change","blur","focusout"])input.addEventListener(type,event=>window.__desktopSmokeRestEvents.push({type:event.type,at:performance.now(),trusted:event.isTrusted,documentFocused:document.hasFocus(),value:input.value}));
    for(const type of ["focus","blur"])window.addEventListener(type,event=>window.__desktopSmokeRestEvents.push({type:"window-"+event.type,at:performance.now(),trusted:event.isTrusted,documentFocused:document.hasFocus(),value:input.value}));
    input.focus();
    input.select();
    return true;
  })()`);
  await until(renderer, 'document.hasFocus()&&document.activeElement?.getAttribute("aria-label")==="闲置休息分钟数"');
  await renderer.send("Input.insertText", { text: String(pendingRestInterval) });
  await until(renderer, `document.querySelector('input[aria-label="闲置休息分钟数"]')?.value===${JSON.stringify(String(pendingRestInterval))}`);
  const run = await startTaskWithDelayedPlayback(created.sessionId, sentinels[1], async () => {
    const beforeBlur = await renderer.evaluate(`(async()=>({documentFocused:document.hasFocus(),activeElement:document.activeElement?.getAttribute("aria-label")??document.activeElement?.tagName,value:document.querySelector('input[aria-label="闲置休息分钟数"]')?.value,preferences:await window.mingshen.getCompanionPreferences(),events:window.__desktopSmokeRestEvents}))()`);
    geometry.push({ name: "rest-interval-before-explicit-blur", oldRestInterval, pendingRestInterval,
      native: await inspectWindows(), ...beforeBlur });
    assert.equal(beforeBlur.activeElement, "闲置休息分钟数");
    assert.equal(beforeBlur.documentFocused, true, "Main window lost focus while editing the rest interval");
    assert.equal(beforeBlur.events.some((event) => ["blur", "focusout", "window-blur"].includes(event.type)), false,
      "The uncommitted rest-interval test lost focus before the task assertion");
    assert.equal(beforeBlur.value, String(pendingRestInterval), "A live task event overwrote the uncommitted rest interval");
    assert.equal(beforeBlur.preferences.restAfterMinutes, oldRestInterval);
    await dispatchKey(renderer, "keyDown", "Tab", "Tab", 9);
    await dispatchKey(renderer, "keyUp", "Tab", "Tab", 9);
    try {
      await until(renderer, `window.mingshen.getCompanionPreferences().then(value=>value.restAfterMinutes===${pendingRestInterval})`);
    } finally {
      const state = await renderer.evaluate(`(async()=>({documentFocused:document.hasFocus(),activeElement:document.activeElement?.getAttribute("aria-label")??document.activeElement?.tagName,value:document.querySelector('input[aria-label="闲置休息分钟数"]')?.value,preferences:await window.mingshen.getCompanionPreferences(),events:window.__desktopSmokeRestEvents}))()`);
      geometry.push({ name: "rest-interval-trusted-input", ...state });
    }
    const inputEvents = await renderer.evaluate("window.__desktopSmokeRestEvents");
    assert.ok(inputEvents.some((event) => event.type === "input" && event.trusted && event.value === String(pendingRestInterval)),
      `The rest interval was not entered through a trusted input event: ${JSON.stringify(inputEvents)}`);
    assert.ok(inputEvents.some((event) => event.type === "focusout" && event.trusted),
      `The rest interval did not receive a trusted focusout event: ${JSON.stringify(inputEvents)}`);
  });
  created.runId = run.runId;
  assert.ok(created?.sessionId && created?.runId, "Fixture task did not return a session and run id");
  await until(companion, `window.companion.getState().then(state=>state.motionRequest?.source!=="idle"&&state.tasks.some(task=>task.sessionId===${JSON.stringify(created.sessionId)}&&task.runId===${JSON.stringify(created.runId)}))`);
  await until(companion, '/^(thinking|working|waiting)/.test(document.querySelector(".companion-video.is-visible")?.dataset.motion||"")', 20_000);
  await renderer.evaluate(`window.mingshen.setCompanionPreferences({restAfterMinutes:${oldRestInterval}})`);
  await until(renderer, `document.querySelector('input[aria-label="闲置休息分钟数"]')?.value===${JSON.stringify(String(oldRestInterval))}`);

  const liveState = await companion.evaluate("window.companion.getState()");
  const liveTask = liveState.tasks.find((task) => task.sessionId === created.sessionId);
  assert.equal(liveTask?.title, sentinels[0], "The default working-session payload omitted its real title");
  await until(companion, `document.querySelector(".companion-task-title")?.textContent===${JSON.stringify(sentinels[0])}`);
  const firstTaskRender = await companion.evaluate(`(()=>({
    status:document.querySelector(".companion-task-row")?.dataset.status,
    elapsed:document.querySelector(".companion-task-elapsed")?.textContent
  }))()`);
  assert.equal(firstTaskRender.status, liveTask.status, "Working-session status did not match the real task state");
  assert.match(firstTaskRender.elapsed ?? "", /^\d+:\d{2}(?::\d{2})?$/, "Working-session elapsed time is missing");
  await until(companion, `document.querySelector(".companion-task-elapsed")?.textContent!==${JSON.stringify(firstTaskRender.elapsed)}`, 4_000);
  await verifyWorkingPanelGeometry();

  await setCompanionSetting("显示会话标题", false);
  await until(companion, 'window.companion.getState().then(state=>state.preferences.showSessionTitles===false&&state.tasks.length>0&&state.tasks.every(task=>task.title===null))');
  await until(companion, 'document.querySelector(".companion-task-title")?.textContent==="会话 1"');
  const menu = await captureCompanionMenu();
  const task = menuItem(menu, "task-1");
  assert.ok(task?.enabled, "Running task is not available in companion menu");
  const visible = JSON.stringify(menu) + "\n" + await companion.evaluate("document.documentElement.outerHTML");
  for (const forbidden of [...sentinels, created.sessionId, created.runId]) {
    assert.equal(visible.includes(forbidden), false, `Companion exposed fixture private text or identifier: ${forbidden}`);
  }
  await invokeCapturedMenu("task-1");
  await until(renderer, `window.__desktopSmokeEvents.some(event=>event.type==="select-session"&&event.sessionId===${JSON.stringify(created.sessionId)})`);
  await setCompanionSetting("显示会话标题", true);
  await until(companion, `window.companion.getState().then(state=>state.tasks.some(task=>task.title===${JSON.stringify(sentinels[0])}))`);
  await until(companion, `document.querySelector(".companion-task-title")?.textContent===${JSON.stringify(sentinels[0])}`);
  const shown = JSON.stringify(await captureCompanionMenu()) + "\n" + await companion.evaluate("document.documentElement.outerHTML");
  for (const forbidden of [...sentinels.slice(1), created.sessionId, created.runId]) {
    assert.equal(shown.includes(forbidden), false, `Companion exposed non-title fixture data: ${forbidden}`);
  }
  await renderer.evaluate("window.__desktopSmokeEvents=[];true");
  const rowPoint = await companion.evaluate(`(()=>{
    const row=document.querySelector(".companion-task-row");
    if(!row)return null;
    const box=row.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
    const hit=document.elementFromPoint(x,y);
    return {x,y,hit:Boolean(hit&&(hit===row||row.contains(hit)))};
  })()`);
  assert.ok(rowPoint?.hit, "The working-session row is not hit-testable");
  await dispatchMouse(companion, "mouseMoved", rowPoint.x, rowPoint.y);
  await dispatchMouse(companion, "mousePressed", rowPoint.x, rowPoint.y, { button: "left", buttons: 1, clickCount: 1 });
  await dispatchMouse(companion, "mouseReleased", rowPoint.x, rowPoint.y, { button: "left", buttons: 0, clickCount: 1 });
  await until(renderer, `window.__desktopSmokeEvents.some(event=>event.type==="select-session"&&event.sessionId===${JSON.stringify(created.sessionId)})`);
  await verifyNavigationReceipts(created.sessionId);
  finishFixtureResponses();
  await until(companion, `window.companion.getState().then(state=>!state.tasks.some(task=>task.sessionId===${JSON.stringify(created.sessionId)}))`);
  assert.equal(await companion.evaluate(`window.companion.openSession(${JSON.stringify(created.sessionId)}).then(()=>false,()=>true)`), true,
    "Companion session bridge accepted a task after it had finished");
  await renderer.evaluate(`window.mingshen.setCompanionPreferences(${JSON.stringify({
    idleAnimationFrequency: initialPreferences.idleAnimationFrequency,
    quietMode: initialPreferences.quietMode,
    chattiness: initialPreferences.chattiness,
    restAfterMinutes: initialPreferences.restAfterMinutes,
  })})`);
  await companion.send("Emulation.setEmulatedMedia", { features: [] });
  await renderer.evaluate("window.__desktopSmokeUnsubscribe?.();delete window.__desktopSmokeEvents;delete window.__desktopSmokeUnsubscribe;true");
  assert.ok(fixtureRequests.length > 0, "No local SSE request reached the fixture server");
}

async function verifyChatBulkManagement() {
  const fixture = await renderer.evaluate(`(async()=>{
    const provider=(await window.mingshen.bootstrap()).providers.find(item=>item.name==="Desktop layout fixture");
    const groupA=await window.mingshen.createChatGroup("Bulk fixture A");
    const groupB=await window.mingshen.createChatGroup("Bulk fixture B");
    const create=(title,chatGroupId)=>window.mingshen.createSession({
      providerId:provider.id,modelId:provider.models[0].id,title,agentMode:"chat",chatGroupId,
      workspacePath:null,reasoningLevel:null,permissionMode:"request_approval"
    });
    const a=await create("BULK_SMOKE A",groupA.id);
    const b=await create("BULK_SMOKE B",groupB.id);
    const pinned=await create("BULK_SMOKE pinned",null);
    const untouched=await create("BULK_SMOKE untouched",null);
    const live=await create("BULK_SMOKE live",groupA.id);
    const archived=await create("BULK_SMOKE archived",groupB.id);
    await window.mingshen.updateSession({sessionId:pinned.id,pinned:true});
    await window.mingshen.updateSession({sessionId:archived.id,archived:true});
    return {groupA:groupA.id,groupB:groupB.id,a:a.id,b:b.id,pinned:pinned.id,untouched:untouched.id,live:live.id,archived:archived.id};
  })()`);
  assert.ok(Object.values(fixture).every(Boolean), "Chat batch fixture was not created");

  await renderer.send("Page.reload");
  await until(renderer, 'Boolean(document.querySelector(".app-shell"))');
  if (await renderer.evaluate('document.querySelector(".app-shell")?.dataset.agentMode!=="chat"')) {
    await click(renderer, '[data-testid="agent-mode-chat"]');
  }
  await until(renderer, 'document.querySelector(".app-shell")?.dataset.agentMode==="chat"&&Boolean(document.querySelector("[data-testid=chat-sidebar]"))');
  if (await renderer.evaluate('document.querySelector(".chat-sidebar-host")?.hidden')) {
    await click(renderer, ".app-topbar .sidebar-toggle");
  }
  await until(renderer, '!document.querySelector(".chat-sidebar-host")?.hidden');
  await click(renderer, '[data-testid="chat-batch-toggle"]');
  await until(renderer, 'document.querySelector("[data-testid=chat-batch-toggle]")?.getAttribute("aria-pressed")==="true"');
  await renderer.evaluate(`(()=>{
    const input=document.querySelector('[data-testid="chat-sidebar"] input[type="search"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"BULK_SMOKE");
    input.dispatchEvent(new Event("input",{bubbles:true}));
    return true;
  })()`);
  await until(renderer, 'document.querySelector("[data-testid=chat-sidebar] input[type=search]")?.value==="BULK_SMOKE"');
  const groupBHeading = `[data-chat-group-id=${JSON.stringify(fixture.groupB)}] .chat-session-group__heading`;
  await click(renderer, groupBHeading);
  await until(renderer, `document.querySelector(${JSON.stringify(groupBHeading)})?.getAttribute("aria-expanded")==="false"`);
  await click(renderer, '[data-testid="chat-batch-select-all"]');
  await until(renderer, 'document.querySelector(".chat-sidebar__batch-select [role=status]")?.textContent.includes("5")');
  await click(renderer, groupBHeading);
  await until(renderer, `document.querySelector('[data-session-id="${fixture.b}"] input[type=checkbox]')?.checked`);
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-batch-select-all]")?.checked'), true,
    "Select all did not include the folded group and pinned chat");

  await click(renderer, '[data-testid="chat-archive-toggle"]');
  await until(renderer, `Boolean(document.querySelector('[data-session-id="${fixture.archived}"] input[type=checkbox]'))`);
  await until(renderer, '!document.querySelector("[data-testid=chat-batch-select-all]")?.checked');
  await click(renderer, '[data-testid="chat-batch-select-all"]');
  await until(renderer, 'document.querySelector(".chat-sidebar__batch-select [role=status]")?.textContent.includes("6")');
  assert.deepEqual(await renderer.evaluate(`(()=>({
    archive:document.querySelector('[data-session-action="archive"]').disabled,
    restore:document.querySelector('[data-session-action="restore"]').disabled,
    remove:document.querySelector('[data-session-action="delete"]').disabled
  }))()`), { archive: true, restore: true, remove: false }, "Mixed archive states must only allow deletion");
  await screenshot(renderer, "chat-batch-mixed-status");
  await click(renderer, '[data-testid="chat-archive-toggle"]');
  await until(renderer, '!document.querySelector("[data-testid=chat-batch-select-all]")?.checked');

  const choose = async (id) => click(renderer, `[data-session-id=${JSON.stringify(id)}] input[type="checkbox"]`);
  const confirm = async (accept, title) => {
    await until(renderer, `document.querySelector('.mingshen-dialog[role="alertdialog"] #mingshen-dialog-title')?.textContent===${JSON.stringify(title)}`);
    await click(renderer, `.mingshen-dialog__actions button:${accept ? "last" : "first"}-child`);
    await until(renderer, '!document.querySelector(".mingshen-dialog[role=alertdialog]")');
  };
  const sessions = async (...ids) => renderer.evaluate(`Promise.all(${JSON.stringify(ids)}.map(id=>window.mingshen.getSession(id)))`);
  await choose(fixture.a);
  await choose(fixture.b);
  await click(renderer, '[data-session-action="delete"]');
  await confirm(false, "删除所选会话？");
  assert.ok((await sessions(fixture.a, fixture.b)).every(Boolean), "Cancelling batch deletion changed persisted chats");

  await mainInspector.evaluate(`(()=>{
    const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const original=ipcMain._invokeHandlers.get("session:update");
    if(!original||globalThis.__desktopSmokeChatUpdate)throw new Error("Cannot install chat batch failure fixture");
    globalThis.__desktopSmokeChatUpdate={original,failed:false};
    ipcMain._invokeHandlers.set("session:update",async(...args)=>{
      const input=args[1];
      if(input?.sessionId===${JSON.stringify(fixture.b)}&&input.archived===true&&!globalThis.__desktopSmokeChatUpdate.failed){
        globalThis.__desktopSmokeChatUpdate.failed=true;
        throw new Error("CHAT_BATCH_FIXTURE_ARCHIVE_FAILURE");
      }
      return original(...args);
    });
    return true;
  })()`);
  try {
    await click(renderer, '[data-session-action="archive"]');
    await confirm(true, "归档所选会话？");
    await until(renderer, 'document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("CHAT_BATCH_FIXTURE_ARCHIVE_FAILURE")');
    const [a, b] = await sessions(fixture.a, fixture.b);
    assert.equal(a?.archived, true, "Successful batch item was not archived");
    assert.equal(b?.archived, false, "Failed batch item changed archive state");
    assert.equal(await renderer.evaluate(`document.querySelector('[data-session-id="${fixture.b}"] input[type=checkbox]')?.checked`), true,
      "Failed batch item was not retained for retry");
    await screenshot(renderer, "chat-batch-partial-failure");
    await click(renderer, '[data-session-action="archive"]');
    await confirm(true, "归档所选会话？");
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(fixture.b)}).then(value=>value?.archived===true)`);
    await until(renderer, 'document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("已归档 1")');
  } finally {
    await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const fixture=globalThis.__desktopSmokeChatUpdate;
      if(fixture)ipcMain._invokeHandlers.set("session:update",fixture.original);
      delete globalThis.__desktopSmokeChatUpdate;
      return true;
    })()`);
  }

  await click(renderer, '[data-testid="chat-archive-toggle"]');
  await until(renderer, `Boolean(document.querySelector('[data-session-id="${fixture.a}"] input[type=checkbox]')&&document.querySelector('[data-session-id="${fixture.b}"] input[type=checkbox]'))`);
  await choose(fixture.a);
  await choose(fixture.b);
  await click(renderer, '[data-session-action="restore"]');
  await until(renderer, `Promise.all(${JSON.stringify([fixture.a, fixture.b])}.map(id=>window.mingshen.getSession(id))).then(rows=>rows.every(row=>row&&!row.archived))`);
  await until(renderer, 'document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("已恢复 2")');
  await click(renderer, '[data-testid="chat-archive-toggle"]');
  await choose(fixture.b);
  await choose(fixture.pinned);
  await click(renderer, '[data-session-action="delete"]');
  await confirm(true, "删除所选会话？");
  await until(renderer, `Promise.all(${JSON.stringify([fixture.b, fixture.pinned])}.map(id=>window.mingshen.getSession(id))).then(rows=>rows.every(row=>row===null))`);
  await until(renderer, 'document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("已删除 2")');
  await screenshot(renderer, "chat-batch-deleted");

  assert.equal(fixtureResponses.size, 0, "Cannot start a new held fixture while old responses remain");
  fixtureFinishRequested = false;
  try {
    const priorRequests = fixtureRequests.length;
    const live = await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(fixture.live)},text:"BULK_SMOKE live request"})`);
    assert.ok(live?.runId, "Live ChatAgent fixture did not start");
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(fixture.live)}).then(value=>value?.status==="running")`);
    await until(companion, `window.companion.getState().then(state=>state.tasks.some(task=>task.sessionId===${JSON.stringify(fixture.live)}))`);
    const requestDeadline = Date.now() + 30_000;
    while (fixtureResponses.size === 0 && Date.now() < requestDeadline) await sleep(100);
    assert.ok(fixtureResponses.size > 0 && fixtureRequests.length > priorRequests, "The ChatAgent request did not reach the held local SSE fixture");
    await choose(fixture.a);
    await choose(fixture.live);
    await click(renderer, '[data-session-action="archive"]');
    await confirm(true, "归档所选会话？");
    await until(renderer, `(()=>{
      const result=document.querySelector(".chat-sidebar__batch-result");
      const failed=document.querySelector('[data-session-id="${fixture.live}"] input[type=checkbox]');
      return Boolean(result?.textContent.includes("BULK_SMOKE live")&&failed?.checked);
    })()`);
    const [liveAfterArchive, archivedA] = await sessions(fixture.live, fixture.a);
    assert.equal(liveAfterArchive?.status, "running", "Archiving an active chat unexpectedly stopped its task");
    assert.equal(liveAfterArchive?.archived, false, "An active chat was archived");
    assert.equal(archivedA?.archived, true, "An idle chat in the same batch was not archived");
    await screenshot(renderer, "chat-batch-active-archive-rejected");

    await click(renderer, '[data-session-action="delete"]');
    await confirm(true, "删除所选会话？");
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(fixture.live)}).then(value=>value===null)`);
    await until(companion, `window.companion.getState().then(state=>!state.tasks.some(task=>task.sessionId===${JSON.stringify(fixture.live)}))`);
    await click(renderer, '[data-testid="chat-archive-toggle"]');
    await until(renderer, `Boolean(document.querySelector('[data-session-id="${fixture.a}"] input[type=checkbox]'))`);
    await choose(fixture.a);
    await click(renderer, '[data-session-action="restore"]');
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(fixture.a)}).then(value=>value&&!value.archived)`);
    await until(renderer, 'document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("已恢复 1")');
  } finally {
    finishFixtureResponses();
  }

  await renderer.send("Page.reload");
  await until(renderer, 'Boolean(document.querySelector(".app-shell"))');
  const [a, b, pinned, untouched, archived] = await sessions(fixture.a, fixture.b, fixture.pinned, fixture.untouched, fixture.archived);
  assert.ok(a && !a.archived && untouched && !untouched.archived, "A retained chat changed after reload");
  assert.equal(b, null);
  assert.equal(pinned, null);
  assert.equal(archived?.archived, true, "An unselected archived chat changed after reload");
}

async function verifyChatCatalogFailureRecovery() {
  const fixture = await renderer.evaluate(`(async()=>{
    const provider=(await window.mingshen.bootstrap()).providers.find(item=>item.name==="Desktop layout fixture");
    const active=[],archived=[];
    for(let index=0;index<4;index++){
      for(const [kind,ids] of [["ACTIVE",active],["ARCHIVED",archived]]){
        const session=await window.mingshen.createSession({providerId:provider.id,modelId:provider.models[0].id,
          title:"CATALOG_SMOKE "+kind+" "+index,agentMode:"chat",workspacePath:null,
          reasoningLevel:null,permissionMode:"request_approval"});
        ids.push(session.id);
        if(kind==="ARCHIVED")await window.mingshen.updateSession({sessionId:session.id,archived:true});
      }
    }
    localStorage.setItem("mingshen.agent-mode","chat");
    return {active,archived};
  })()`);
  assert.equal(fixture.active.length, 4);
  assert.equal(fixture.archived.length, 4);
  assert.equal(await mainInspector.evaluate(`(()=>{
    const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const handlers=ipcMain._invokeHandlers,original=handlers.get("session:page");
    if(!original||globalThis.__desktopSmokeCatalog)return false;
    const probe=globalThis.__desktopSmokeCatalog={original,failActive:true,failArchived:true,calls:[]};
    handlers.set("session:page",async(event,input)=>{
      if(input?.agentMode!=="chat")return original(event,input);
      const archived=input.archived===true;
      const call={archived,cursor:Boolean(input.cursor),failed:false,ids:[]};
      probe.calls.push(call);
      if(input.cursor&&(archived?probe.failArchived:probe.failActive)){
        call.failed=true;
        throw new Error(archived?"SMOKE_ARCHIVED_PAGE_FAILURE":"SMOKE_ACTIVE_PAGE_FAILURE");
      }
      const page=await original(event,{...input,limit:2});
      call.ids=page.sessions.map(session=>session.id);
      return page;
    });
    return true;
  })()`), true, "Could not install the isolated session page failure fixture");

  try {
    await renderer.send("Page.reload");
    await until(renderer, 'document.querySelector(".app-shell")?.dataset.agentMode==="chat"&&Boolean(document.querySelector("[data-testid=chat-sidebar]"))');
    if (await renderer.evaluate('document.querySelector(".chat-sidebar-host")?.hidden'))
      await click(renderer, ".app-topbar .sidebar-toggle");
    await until(renderer, `document.querySelector(".chat-sidebar__controls [role=alert]")?.textContent.includes("SMOKE_ACTIVE_PAGE_FAILURE")`);
    const activeCalls = await mainInspector.evaluate('globalThis.__desktopSmokeCatalog.calls.filter(call=>!call.archived)');
    assert.ok(activeCalls.some((call) => !call.cursor && call.ids.length === 2) &&
      activeCalls.some((call) => call.cursor && call.failed), "The active failure did not occur after a real first page");
    assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-batch-toggle]")?.disabled'), true,
      "Batch management was enabled without a complete active catalog");
    assert.equal(await renderer.evaluate(`document.querySelectorAll('[data-testid="chat-session-row"]').length`), 0,
      "The first active page was committed after a later page failed");
    await screenshot(renderer, "chat-active-catalog-page-failure");

    await mainInspector.evaluate('globalThis.__desktopSmokeCatalog.failActive=false;true');
    await clickText(renderer, ".chat-sidebar__controls [role=alert]", "重试");
    await until(renderer, `!document.querySelector(".chat-sidebar__controls [role=alert]")&&${JSON.stringify(fixture.active)}.every(id=>document.querySelector('[data-session-id="'+id+'"]'))`);
    await click(renderer, '[data-testid="chat-batch-toggle"]');
    await renderer.evaluate(`(()=>{
      const input=document.querySelector('[data-testid="chat-sidebar"] input[type="search"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"CATALOG_SMOKE");
      input.dispatchEvent(new Event("input",{bubbles:true}));
      return true;
    })()`);
    await until(renderer, 'document.querySelector(".chat-sidebar__batch-select label")?.textContent.includes("（4）")');
    await click(renderer, '[data-testid="chat-batch-select-all"]');
    await until(renderer, 'document.querySelector(".chat-sidebar__batch-select [role=status]")?.textContent.includes("4")');

    await click(renderer, '[data-testid="chat-archive-toggle"]');
    await until(renderer, 'document.querySelector(".chat-sidebar__scroll [role=alert]")?.textContent.includes("SMOKE_ARCHIVED_PAGE_FAILURE")');
    const archivedCalls = await mainInspector.evaluate('globalThis.__desktopSmokeCatalog.calls.filter(call=>call.archived)');
    assert.ok(archivedCalls.some((call) => !call.cursor && call.ids.length === 2) &&
      archivedCalls.some((call) => call.cursor && call.failed), "The archived failure did not occur after a real first page");
    assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-archive-toggle]")?.getAttribute("aria-expanded")'), "false");
    assert.equal(await renderer.evaluate('document.querySelectorAll("[data-testid=chat-archived-row]").length'), 0,
      "The first archived page was committed after a later page failed");
    assert.equal(await renderer.evaluate('document.querySelector(".chat-sidebar__batch-select [role=status]")?.textContent.includes("0")'), true,
      "A failed archive catalog retained the prior selection");
    await screenshot(renderer, "chat-archived-catalog-page-failure");

    await mainInspector.evaluate('globalThis.__desktopSmokeCatalog.failArchived=false;true');
    await click(renderer, '[data-testid="chat-archive-toggle"]');
    await until(renderer, `${JSON.stringify(fixture.archived)}.every(id=>document.querySelector('[data-testid="chat-archived-row"][data-session-id="'+id+'"]'))`);
    await until(renderer, 'document.querySelector(".chat-sidebar__batch-select label")?.textContent.includes("（8）")');
    await click(renderer, '[data-testid="chat-batch-select-all"]');
    await until(renderer, 'document.querySelector(".chat-sidebar__batch-select [role=status]")?.textContent.includes("8")');
    assert.equal(await renderer.evaluate('document.querySelectorAll("[data-testid=chat-session-row], [data-testid=chat-archived-row]").length'), 8,
      "Retried catalog contained duplicate or missing matching chats");
    await screenshot(renderer, "chat-catalog-page-retry");
    await click(renderer, '[data-testid="chat-archive-toggle"]');
    await click(renderer, '[data-testid="chat-batch-toggle"]');
    await click(renderer, '[aria-label="清除搜索"]');
  } finally {
    await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const probe=globalThis.__desktopSmokeCatalog;
      if(!probe)return false;
      ipcMain._invokeHandlers.set("session:page",probe.original);
      delete globalThis.__desktopSmokeCatalog;
      return true;
    })()`);
  }
}

async function verifyArchiveContextIsolation() {
  const sessionId = await renderer.evaluate(`(async()=>{
    const provider=(await window.mingshen.bootstrap()).providers.find(item=>item.name==="Desktop layout fixture");
    const session=await window.mingshen.createSession({providerId:provider.id,modelId:provider.models[0].id,
      title:"CONTEXT_SMOKE",agentMode:"chat",workspacePath:null,reasoningLevel:null,permissionMode:"request_approval"});
    return session.id;
  })()`);
  const installed = await mainInspector.evaluate(`(()=>{
    const {DatabaseSync}=process.getBuiltinModule("node:sqlite"),original=DatabaseSync.prototype.prepare;
    const fixture=globalThis.__desktopSmokeContextProbe={original,hits:0};
    DatabaseSync.prototype.prepare=function(sql,...args){
      const statement=original.call(this,sql,...args);
      if(sql.trim()!=="select id, seq, parts_json from messages where session_id = ? and seq < ? order by seq desc limit 1")return statement;
      return new Proxy(statement,{get(target,key){
        if(key==="get")return (...parameters)=>{
          if(parameters[0]===${JSON.stringify(sessionId)}){fixture.hits++;throw new Error("SMOKE_CONTEXT_RESTORE_QUERY")}
          return target.get(...parameters);
        };
        const value=Reflect.get(target,key,target);
        return typeof value==="function"?value.bind(target):value;
      }});
    };
    return true;
  })()`);
  assert.equal(installed, true);
  try {
    for (const archived of [true, false]) {
      const result = await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(sessionId)},archived:${archived}})`);
      assert.equal(result?.archived, archived, `Pure ${archived ? "archive" : "restore"} did not complete`);
      assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(sessionId)})`))?.archived, archived);
      assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeContextProbe.hits'), 0,
        "A pure archive state change attempted unrelated context restoration");
    }
    const error = await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(sessionId)},title:"CONTEXT_SMOKE changed"}).then(()=>null,error=>String(error))`);
    assert.match(error ?? "", /SMOKE_CONTEXT_RESTORE_QUERY/, "The injected context failure did not exercise a non-archive update");
    assert.ok((await mainInspector.evaluate('globalThis.__desktopSmokeContextProbe.hits')) > 0);
  } finally {
    await mainInspector.evaluate(`(()=>{
      const {DatabaseSync}=process.getBuiltinModule("node:sqlite"),fixture=globalThis.__desktopSmokeContextProbe;
      if(!fixture)return false;
      DatabaseSync.prototype.prepare=fixture.original;
      delete globalThis.__desktopSmokeContextProbe;
      return true;
    })()`);
  }
}

async function verifyQuickChatBatchLifecycle() {
  if (await renderer.evaluate('document.querySelector(".app-shell")?.dataset.agentMode!=="chat"'))
    await click(renderer, '[data-testid="agent-mode-chat"]');
  await until(renderer, 'document.querySelector(".app-shell")?.dataset.agentMode==="chat"&&Boolean(document.querySelector("[data-testid=chat-sidebar]"))');
  if (await renderer.evaluate('document.querySelector(".chat-sidebar-host")?.hidden'))
    await click(renderer, ".app-topbar .sidebar-toggle");
  await until(renderer, '!document.querySelector(".chat-sidebar-host")?.hidden');
  if (await renderer.evaluate('document.querySelector("[data-testid=chat-batch-toggle]")?.getAttribute("aria-pressed")!=="true"'))
    await click(renderer, '[data-testid="chat-batch-toggle"]');
  await until(renderer, 'document.querySelector("[data-testid=chat-batch-toggle]")?.getAttribute("aria-pressed")==="true"');

  const openNew = async () => {
    const state = await renderer.evaluate('window.mingshen.quickChatAction("new")');
    assert.ok(state?.session?.id, "Quick Chat did not create a session");
    return state.session.id;
  };
  const first = await openNew();
  const quick = await connectQuickChat();
  const installHold = async (sessionId) => {
    assert.equal(await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const handlers=ipcMain._invokeHandlers,save=handlers?.get("composer:draft-save");
      if(!save||globalThis.__desktopSmokeHeldDraft)return false;
      const fixture=globalThis.__desktopSmokeHeldDraft={save,held:false,settled:null,release:null};
      handlers.set("composer:draft-save",(event,input)=>{
        if(input?.sessionId!==${JSON.stringify(sessionId)}||fixture.held)return save(event,input);
        fixture.held=true;
        return new Promise((resolve,reject)=>{
          fixture.release=()=>{
            fixture.release=null;
            Promise.resolve().then(()=>save(event,input)).then(value=>{fixture.settled="resolved";resolve(value)},error=>{fixture.settled="rejected";reject(error)});
          };
        });
      });
      return true;
    })()`), true, "Could not install the isolated draft save delay");
  };
  const installFailure = async (sessionId) => {
    assert.equal(await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const handlers=ipcMain._invokeHandlers,save=handlers?.get("composer:draft-save");
      if(!save||globalThis.__desktopSmokeHeldDraft)return false;
      globalThis.__desktopSmokeHeldDraft={save,release:null};
      handlers.set("composer:draft-save",(event,input)=>input?.sessionId===${JSON.stringify(sessionId)}
        ? Promise.reject(new Error("QUICK_ARCHIVE_DRAFT_FAILURE"))
        : save(event,input));
      return true;
    })()`), true, "Could not install the isolated quick-chat save failure");
  };
  const releaseHold = async () => {
    await mainInspector.evaluate('globalThis.__desktopSmokeHeldDraft?.release?.();true');
    await until(mainInspector, 'Boolean(globalThis.__desktopSmokeHeldDraft?.settled)');
  };
  const removeHold = async () => {
    await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const fixture=globalThis.__desktopSmokeHeldDraft;
      if(!fixture)return false;
      fixture.release?.();
      ipcMain._invokeHandlers.set("composer:draft-save",fixture.save);
      delete globalThis.__desktopSmokeHeldDraft;
      return true;
    })()`);
  };
  const writePending = async (sessionId, text) => {
    await until(quick, `(()=>{
      const composer=document.querySelector('.chat-view--quick [data-testid="chat-composer"]');
      const input=composer?.querySelector('[data-testid="chat-composer-input"]:not([hidden]):not(:disabled)');
      return Boolean(input&&input.placeholder!=="正在恢复草稿…"&&composer.dataset.interactionLocked==="false"&&!composer.inert);
    })()`);
    assert.equal(await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(sessionId)})`), null);
    await installHold(sessionId);
    await quick.evaluate('document.querySelector(".chat-view--quick [data-testid=chat-composer-input]").focus();true');
    await quick.send("Input.insertText", { text });
    await until(quick, `document.querySelector(".chat-view--quick [data-testid=chat-composer-input]")?.value===${JSON.stringify(text)}`);
    await until(mainInspector, 'globalThis.__desktopSmokeHeldDraft?.held===true');
    assert.equal(await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(sessionId)})`), null,
      "The fixture draft was already persisted before the delayed save");
  };
  const selectAndConfirm = async (sessionId, action, select = true) => {
    if (await renderer.evaluate('document.querySelector("[data-testid=chat-batch-toggle]")?.getAttribute("aria-pressed")!=="true"'))
      await click(renderer, '[data-testid="chat-batch-toggle"]');
    await until(renderer, 'document.querySelector(".chat-sidebar__batch")?.getAttribute("aria-busy")==="false"');
    await until(renderer, `Boolean(document.querySelector('[data-session-id="${sessionId}"] input[type=checkbox]'))`);
    if (select) await click(renderer, `[data-session-id=${JSON.stringify(sessionId)}] input[type="checkbox"]`);
    await click(renderer, `[data-session-action=${JSON.stringify(action)}]`);
    const title = action === "archive" ? "归档所选会话？" : "删除所选会话？";
    await until(renderer, `document.querySelector('.mingshen-dialog[role="alertdialog"] #mingshen-dialog-title')?.textContent===${JSON.stringify(title)}`);
    await click(renderer, '.mingshen-dialog__actions button:last-child');
    await until(renderer, '!document.querySelector(".mingshen-dialog[role=alertdialog]")');
  };
  try {
    const archivedText = "QUICK_CHAT_ARCHIVE_DRAFT_SENTINEL";
    await writePending(first, archivedText);
    await selectAndConfirm(first, "archive");
    await until(quick, `(()=>{
      const composer=document.querySelector('.chat-view--quick [data-testid="chat-composer"][data-interaction-locked="true"]');
      return Boolean(composer?.inert);
    })()`);
    assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(first)})`))?.archived, false,
      "Archiving committed before the quick-chat draft finished saving");
    assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeHeldDraft.settled'), null);
    assert.equal(await quick.evaluate(`(()=>{
      const input=document.querySelector('.chat-view--quick [data-testid="chat-composer-input"]');
      input.focus();return document.activeElement===input;
    })()`), false, "The quick-chat composer accepted focus while archiving");
    await quick.send("Input.insertText", { text: "MUST_NOT_REACH_QUICK_DRAFT" });
    assert.equal(await quick.evaluate('document.querySelector(".chat-view--quick [data-testid=chat-composer-input]")?.value'), archivedText,
      "The quick-chat draft changed while archiving was waiting for its save");
    await screenshot(quick, "quick-chat-archive-locked");
    await releaseHold();
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(first)}).then(value=>value?.archived===true)`);
    await until(quick, 'Boolean(document.querySelector("[data-testid=quick-chat-archived]"))');
    await until(quick, `document.querySelector("[data-testid=quick-chat-archived-draft]")?.value===${JSON.stringify(archivedText)}&&document.querySelector("[data-testid=quick-chat-archived-draft]")?.readOnly`);
    assert.equal((await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(first)})`))?.text, archivedText,
      "The archived quick-chat draft was not preserved");
    assert.equal((await quick.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(first)})`))?.text, archivedText,
      "The archived quick-chat window lost access to its own saved draft");
    const forbidden = await quick.evaluate(`Promise.all([
      window.mingshen.sendChat({sessionId:${JSON.stringify(first)},text:"must not send"}).then(()=>false,()=>true),
      window.mingshen.updateSession({sessionId:${JSON.stringify(first)},title:"must not change"}).then(()=>false,()=>true)
    ])`);
    assert.deepEqual(forbidden, [true, true], "Archived quick chat accepted sending or session modification");
    await screenshot(quick, "quick-chat-archived-draft");
    await removeHold();
    await click(quick, 'button[aria-label="新建对话"]');
    await until(renderer, `window.mingshen.getQuickChatState().then(value=>Boolean(value.session&&value.session.id!==${JSON.stringify(first)}))`);
    const transitionSource = (await renderer.evaluate('window.mingshen.getQuickChatState()')).session.id;
    await until(quick, 'document.querySelector(".chat-view--quick [data-testid=chat-composer-input]")?.value===""');
    assert.equal(await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(transitionSource)})`), null,
      "A new quick-chat session inherited an archived draft");
    assert.equal((await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(first)})`))?.text, archivedText);

    const transitionText = "QUICK_NEW_PENDING_DRAFT_SENTINEL";
    await writePending(transitionSource, transitionText);
    await renderer.evaluate(`(()=>{
      window.__desktopSmokeQuickNew={status:"pending",result:null,error:null};
      window.mingshen.quickChatAction("new").then(result=>{
        window.__desktopSmokeQuickNew.status="resolved";window.__desktopSmokeQuickNew.result=result;
      },error=>{
        window.__desktopSmokeQuickNew.status="rejected";window.__desktopSmokeQuickNew.error=String(error);
      });
      return true;
    })()`);
    await until(quick, `(()=>{
      const composer=document.querySelector('.chat-view--quick [data-testid="chat-composer"][data-interaction-locked="true"]');
      return Boolean(composer?.inert);
    })()`);
    assert.equal(await renderer.evaluate('window.__desktopSmokeQuickNew.status'), "pending",
      "Creating a new quick chat finished before its existing draft was saved");
    assert.equal((await renderer.evaluate('window.mingshen.getQuickChatState()'))?.session?.id, transitionSource,
      "The quick-chat lease changed before its draft was saved");
    assert.equal(await quick.evaluate(`(()=>{
      const input=document.querySelector('.chat-view--quick [data-testid="chat-composer-input"]');
      input.focus();return document.activeElement===input;
    })()`), false, "The quick-chat composer accepted focus during new-session handoff");
    await quick.send("Input.insertText", { text: "MUST_NOT_REACH_QUICK_NEW_DRAFT" });
    assert.equal(await quick.evaluate('document.querySelector(".chat-view--quick [data-testid=chat-composer-input]")?.value'), transitionText,
      "The old quick-chat draft changed during new-session handoff");
    await screenshot(quick, "quick-chat-new-session-locked");
    await releaseHold();
    await until(renderer, 'window.__desktopSmokeQuickNew.status!=="pending"');
    const newResult = await renderer.evaluate('window.__desktopSmokeQuickNew');
    assert.equal(newResult.status, "resolved", `Creating a quick chat failed after draft save: ${newResult.error}`);
    const second = newResult.result?.session?.id;
    assert.ok(second && second !== transitionSource, "The quick-chat lease did not change after its draft was saved");
    await until(quick, 'document.querySelector(".chat-view--quick [data-testid=chat-composer-input]:not(:disabled)")?.value===""');
    assert.equal((await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(transitionSource)})`))?.text, transitionText,
      "The old quick-chat draft was not persisted before creating a new session");
    await removeHold();

    const failedText = "QUICK_ARCHIVE_FAILED_DRAFT_SENTINEL";
    await installFailure(second);
    await quick.evaluate('document.querySelector(".chat-view--quick [data-testid=chat-composer-input]").focus();true');
    await quick.send("Input.insertText", { text: failedText });
    await until(quick, 'document.querySelector(".composer-error[role=alert]")?.textContent.includes("QUICK_ARCHIVE_DRAFT_FAILURE")');
    await selectAndConfirm(second, "archive");
    await until(renderer, 'document.querySelector(".chat-sidebar__batch")?.getAttribute("aria-busy")==="false"&&document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("QUICK_ARCHIVE_DRAFT_FAILURE")');
    assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(second)})`))?.archived, false,
      "A quick-chat draft save failure did not block archiving");
    assert.equal(await renderer.evaluate(`document.querySelector('[data-session-id="${second}"] input[type=checkbox]')?.checked`), true);
    assert.equal(await quick.evaluate('document.querySelector(".chat-view--quick [data-testid=chat-composer-input]")?.value'), failedText,
      "The failed quick-chat draft was not retained");
    assert.equal(await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(second)})`), null);
    await screenshot(quick, "quick-chat-draft-save-failure");
    await removeHold();
    await selectAndConfirm(second, "archive", false);
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(second)}).then(value=>value?.archived===true)`);
    await until(renderer, 'document.querySelector(".chat-sidebar__batch")?.getAttribute("aria-busy")==="false"');
    assert.equal((await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(second)})`))?.text, failedText);
    await until(quick, 'Boolean(document.querySelector("[data-testid=quick-chat-archived]"))');

    await click(quick, 'button[aria-label="新建对话"]');
    await until(renderer, `window.mingshen.getQuickChatState().then(value=>Boolean(value.session&&value.session.id!==${JSON.stringify(second)}))`);
    const shared = (await renderer.evaluate('window.mingshen.getQuickChatState()')).session.id;
    await until(quick, 'document.querySelector(".chat-view--quick [data-testid=chat-composer-input]:not(:disabled)")?.value===""');
    await click(renderer, '[data-testid="chat-batch-toggle"]');
    await click(renderer, `[data-session-id=${JSON.stringify(shared)}] .chat-session-row__main`);
    await until(renderer, `Boolean(document.querySelector('[data-session-id="${shared}"].chat-session-row--selected')&&document.querySelector('[data-testid="chat-composer-input"]:not([hidden]):not(:disabled)'))`);
    const quickConflictText = "QUICK_STALE_CONFLICT_DRAFT_SENTINEL";
    const mainConflictText = "MAIN_PERSISTED_CONFLICT_DRAFT_SENTINEL";
    await writePending(shared, quickConflictText);
    await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]").focus();true');
    await renderer.send("Input.insertText", { text: mainConflictText });
    await until(renderer, `window.mingshen.getComposerDraft(${JSON.stringify(shared)}).then(value=>value?.text===${JSON.stringify(mainConflictText)})`);
    await releaseHold();
    assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeHeldDraft.settled'), "rejected",
      "The stale quick-chat revision did not conflict with the main-window save");
    await until(quick, 'Boolean(document.querySelector(".composer-error--draft-conflict"))');
    await removeHold();
    await selectAndConfirm(shared, "archive");
    await until(renderer, 'document.querySelector(".chat-sidebar__batch")?.getAttribute("aria-busy")==="false"&&document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("COMPOSER_DRAFT_CONFLICT")');
    assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(shared)})`))?.archived, false,
      "A quick-chat draft conflict did not block archiving");
    assert.equal(await renderer.evaluate(`document.querySelector('[data-session-id="${shared}"] input[type=checkbox]')?.checked`), true);
    assert.equal(await quick.evaluate('document.querySelector(".chat-view--quick [data-testid=chat-composer-input]")?.value'), quickConflictText);
    assert.equal((await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(shared)})`))?.text, mainConflictText,
      "A conflicting main-window draft was overwritten without confirmation");
    await screenshot(quick, "quick-chat-draft-conflict");
    await clickText(quick, ".composer-error--draft-conflict", "用本地内容覆盖");
    await until(renderer, `window.mingshen.getComposerDraft(${JSON.stringify(shared)}).then(value=>value?.text===${JSON.stringify(quickConflictText)})`);
    await until(quick, '!document.querySelector(".composer-error--draft-conflict")');
    await selectAndConfirm(shared, "archive", false);
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(shared)}).then(value=>value?.archived===true)`);
    await until(renderer, 'document.querySelector(".chat-sidebar__batch")?.getAttribute("aria-busy")==="false"');
    await until(quick, `document.querySelector('[data-testid="quick-chat-archived-draft"]')?.value===${JSON.stringify(quickConflictText)}`);

    await click(quick, 'button[aria-label="新建对话"]');
    await until(renderer, `window.mingshen.getQuickChatState().then(value=>Boolean(value.session&&value.session.id!==${JSON.stringify(shared)}))`);
    const toDelete = (await renderer.evaluate('window.mingshen.getQuickChatState()')).session.id;
    await until(quick, 'document.querySelector(".chat-view--quick [data-testid=chat-composer-input]:not(:disabled)")?.value===""');
    await quick.evaluate(`(()=>{
      window.__desktopSmokeQuickEvents=[];
      window.__desktopSmokeQuickUnsubscribe=window.mingshen.onRuntimeEvent(event=>window.__desktopSmokeQuickEvents.push(event));
      return true;
    })()`);
    const deletedText = "QUICK_CHAT_DELETED_DRAFT_SENTINEL";
    await writePending(toDelete, deletedText);
    await selectAndConfirm(toDelete, "delete");
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(toDelete)}).then(value=>value===null)`);
    await until(quick, `window.__desktopSmokeQuickEvents.some(event=>event.type==="session_removed"&&event.sessionId===${JSON.stringify(toDelete)})`);
    const hide = await renderer.evaluate(`Promise.race([
      window.mingshen.quickChatAction("hide").then(()=>"hidden",error=>String(error)),
      new Promise(resolve=>setTimeout(()=>resolve("timeout"),8000))
    ])`);
    assert.equal(hide, "hidden", "The deleted quick-chat draft prevented hiding the window");
    await releaseHold();
    assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeHeldDraft.settled'), "rejected",
      "A delayed save unexpectedly succeeded after its session was deleted");
    assert.equal(await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(toDelete)})`), null);
    assert.equal(await mainInspector.evaluate(`(()=>{
      const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json"),{app}=require("electron"),path=require("node:path");
      if(path.resolve(app.getPath("userData"))!==path.resolve(${JSON.stringify(profile)}))throw new Error("Unexpected test profile");
      const {DatabaseSync}=process.getBuiltinModule("node:sqlite"),db=new DatabaseSync(path.join(app.getPath("userData"),"mingshen.db"),{readOnly:true});
      try{return db.prepare("select count(*) as count from app_settings where key=? or substr(key,1,?)=?")
        .get("composer.draft."+${JSON.stringify(toDelete)},("composer.draft-attachment."+${JSON.stringify(toDelete)}+".").length,"composer.draft-attachment."+${JSON.stringify(toDelete)}+".").count}
      finally{db.close()}
    })()`), 0, "A late save recreated deleted draft records");
    await removeHold();
    await quick.evaluate('window.__desktopSmokeQuickUnsubscribe?.();true');
  } finally {
    await removeHold().catch(() => undefined);
    quick.close();
  }
}

async function verifyMainChatBatchDraftLifecycle() {
  const fixture = await renderer.evaluate(`(async()=>{
    const provider=(await window.mingshen.bootstrap()).providers.find(item=>item.name==="Desktop layout fixture");
    const create=title=>window.mingshen.createSession({providerId:provider.id,modelId:provider.models[0].id,
      title,agentMode:"chat",workspacePath:null,reasoningLevel:null,permissionMode:"request_approval"});
    const success=await create("MAIN_DRAFT_SMOKE success"),failure=await create("MAIN_DRAFT_SMOKE failure"),
      unrelated=await create("MAIN_DRAFT_SMOKE unrelated");
    localStorage.setItem("mingshen.agent-mode","chat");
    return {success:success.id,failure:failure.id,unrelated:unrelated.id};
  })()`);
  await renderer.send("Page.reload");
  await until(renderer, 'document.querySelector(".app-shell")?.dataset.agentMode==="chat"&&Boolean(document.querySelector("[data-testid=chat-sidebar]"))');
  if (await renderer.evaluate('document.querySelector(".chat-sidebar-host")?.hidden'))
    await click(renderer, ".app-topbar .sidebar-toggle");
  await until(renderer, '!document.querySelector(".chat-sidebar-host")?.hidden');

  const selectSession = async (sessionId) => {
    if (await renderer.evaluate('document.querySelector("[data-testid=chat-batch-toggle]")?.getAttribute("aria-pressed")==="true"'))
      await click(renderer, '[data-testid="chat-batch-toggle"]');
    await click(renderer, `[data-session-id=${JSON.stringify(sessionId)}] .chat-session-row__main`);
    await until(renderer, `Boolean(document.querySelector('[data-session-id="${sessionId}"].chat-session-row--selected')&&document.querySelector('[data-testid="chat-composer-input"]:not([hidden]):not(:disabled)'))`);
    await until(renderer, 'document.querySelector("[data-testid=chat-composer-input]")?.placeholder!=="正在恢复草稿…"');
  };
  const installSaveFixture = async (sessionId, mode, rejectedUnrelated = null) => {
    assert.equal(await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const handlers=ipcMain._invokeHandlers,save=handlers?.get("composer:draft-save");
      if(!save||globalThis.__desktopSmokeMainDraft)return false;
      const fixture=globalThis.__desktopSmokeMainDraft={save,attempts:0,unrelatedAttempts:0,held:false,settled:null,release:null};
      handlers.set("composer:draft-save",(event,input)=>{
        if(input?.sessionId===${JSON.stringify(rejectedUnrelated)}){
          fixture.unrelatedAttempts++;
          return Promise.reject(new Error("UNRELATED_DRAFT_FAILURE"));
        }
        if(input?.sessionId!==${JSON.stringify(sessionId)})return save(event,input);
        fixture.attempts++;
        if(${JSON.stringify(mode)}==="fail")return Promise.reject(new Error("MAIN_ARCHIVE_DRAFT_FAILURE"));
        if(fixture.held)return save(event,input);
        fixture.held=true;
        return new Promise((resolve,reject)=>{
          fixture.release=()=>{
            fixture.release=null;
            Promise.resolve().then(()=>save(event,input)).then(value=>{fixture.settled="resolved";resolve(value)},error=>{fixture.settled="rejected";reject(error)});
          };
        });
      });
      return true;
    })()`), true, "Could not install the isolated main-window draft fixture");
  };
  const releaseSave = async () => {
    await mainInspector.evaluate('globalThis.__desktopSmokeMainDraft?.release?.();true');
    await until(mainInspector, 'Boolean(globalThis.__desktopSmokeMainDraft?.settled)');
  };
  const removeSaveFixture = async () => {
    await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const fixture=globalThis.__desktopSmokeMainDraft;
      if(!fixture)return false;
      fixture.release?.();
      ipcMain._invokeHandlers.set("composer:draft-save",fixture.save);
      delete globalThis.__desktopSmokeMainDraft;
      return true;
    })()`);
  };
  const installArchiveHold = async (sessionId) => {
    assert.equal(await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const handlers=ipcMain._invokeHandlers,update=handlers?.get("session:update");
      if(!update||globalThis.__desktopSmokeArchiveHold)return false;
      const fixture=globalThis.__desktopSmokeArchiveHold={update,held:false,release:null};
      handlers.set("session:update",(...args)=>{
        if(args[1]?.sessionId!==${JSON.stringify(sessionId)}||args[1]?.archived!==true||fixture.held)return update(...args);
        fixture.held=true;
        return new Promise((resolve,reject)=>{
          fixture.release=()=>{
            fixture.release=null;
            Promise.resolve().then(()=>update(...args)).then(resolve,reject);
          };
        });
      });
      return true;
    })()`), true, "Could not hold the isolated batch archive request");
  };
  const removeArchiveHold = async () => {
    await mainInspector.evaluate(`(()=>{
      const {ipcMain}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const fixture=globalThis.__desktopSmokeArchiveHold;
      if(!fixture)return false;
      fixture.release?.();
      ipcMain._invokeHandlers.set("session:update",fixture.update);
      delete globalThis.__desktopSmokeArchiveHold;
      return true;
    })()`);
  };
  const typeDraft = async (connection, text) => {
    await connection.evaluate('document.querySelector("[data-testid=chat-composer-input]").focus();true');
    await connection.send("Input.insertText", { text });
    await until(connection, `document.querySelector('[data-testid="chat-composer-input"]')?.value===${JSON.stringify(text)}`);
  };
  const archiveSelected = async (sessionId, select = true) => {
    if (await renderer.evaluate('document.querySelector("[data-testid=chat-batch-toggle]")?.getAttribute("aria-pressed")!=="true"'))
      await click(renderer, '[data-testid="chat-batch-toggle"]');
    if (select) await click(renderer, `[data-session-id=${JSON.stringify(sessionId)}] input[type="checkbox"]`);
    await click(renderer, '[data-session-action="archive"]');
    await until(renderer, 'document.querySelector(\'.mingshen-dialog[role="alertdialog"] #mingshen-dialog-title\')?.textContent==="归档所选会话？"');
    await click(renderer, '.mingshen-dialog__actions button:last-child');
    await until(renderer, '!document.querySelector(".mingshen-dialog[role=alertdialog]")');
  };
  const waitForArchive = async (sessionId, text) => {
    await until(renderer, `window.mingshen.getSession(${JSON.stringify(sessionId)}).then(value=>value?.archived===true)`);
    await until(renderer, 'document.querySelector(".chat-sidebar__batch")?.getAttribute("aria-busy")==="false"&&document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("已归档 1")');
    assert.equal((await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(sessionId)})`))?.text, text,
      "Archived main-window draft was not persisted");
  };

  let quick;
  try {
    const savedText = "MAIN_ARCHIVE_SAVED_DRAFT_SENTINEL";
    const unrelatedText = "UNRELATED_UNSAVED_DRAFT_SENTINEL";
    await selectSession(fixture.unrelated);
    await installSaveFixture(fixture.success, "hold", fixture.unrelated);
    await typeDraft(renderer, unrelatedText);
    await until(renderer, 'document.querySelector(".composer-error[role=alert]")?.textContent.includes("UNRELATED_DRAFT_FAILURE")');
    await selectSession(fixture.success);
    await typeDraft(renderer, savedText);
    await until(mainInspector, 'globalThis.__desktopSmokeMainDraft?.held===true');
    await archiveSelected(fixture.success);
    await until(renderer, `(()=>{
      const region=document.querySelector('.composer[data-management-locked="true"]');
      const status=document.querySelector('[data-testid="chat-batch-composer-status"]');
      if(!region?.inert||status?.getAttribute("role")!=="status")return false;
      const rect=status.getBoundingClientRect(),style=getComputedStyle(status);
      return rect.width>0&&rect.height>0&&style.visibility!=="hidden"&&style.display!=="none"&&status.textContent.includes("输入暂时锁定");
    })()`);
    assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(fixture.success)})`))?.archived, false,
      "Archiving committed before the main-window draft finished saving");
    const starter = await renderer.evaluate(`(()=>{
      const group=document.querySelector('[data-testid="chat-empty-starters"]');
      const button=group?.querySelector("button");
      if(!group||!button)return null;
      button.scrollIntoView({block:"nearest",inline:"nearest"});
      const rect=button.getBoundingClientRect();
      return {disabled:group.disabled&&button.matches(":disabled"),x:rect.left+rect.width/2,y:rect.top+rect.height/2,width:rect.width,height:rect.height};
    })()`);
    assert.ok(starter?.disabled && starter.width > 0 && starter.height > 0,
      "Empty-chat starter buttons remained available during batch processing");
    await dispatchMouse(renderer, "mouseMoved", starter.x, starter.y);
    await dispatchMouse(renderer, "mousePressed", starter.x, starter.y, { button: "left", buttons: 1, clickCount: 1 });
    await dispatchMouse(renderer, "mouseReleased", starter.x, starter.y, { button: "left", buttons: 0, clickCount: 1 });
    assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]")?.value'), savedText,
      "An empty-chat starter modified the draft during batch processing");
    assert.equal(await renderer.evaluate(`(()=>{
      const input=document.querySelector('[data-testid="chat-composer-input"]');
      input.focus();return document.activeElement===input;
    })()`), false, "An inert composer accepted focus during batch processing");
    await renderer.send("Input.insertText", { text: "MUST_NOT_BE_INSERTED" });
    assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]")?.value'), savedText,
      "An inert composer accepted keyboard input during batch processing");
    await screenshot(renderer, "chat-batch-main-draft-saving");
    await releaseSave();
    assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeMainDraft.settled'), "resolved");
    await waitForArchive(fixture.success, savedText);
    assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeMainDraft.unrelatedAttempts'), 1,
      "Archiving attempted to flush an unrelated dirty draft");
    assert.equal(await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(fixture.unrelated)})`), null,
      "The unrelated draft unexpectedly changed before its retry");
    await removeSaveFixture();
    await selectSession(fixture.unrelated);
    assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]")?.value'), unrelatedText,
      "The unrelated unsaved draft was not retained");
    await clickText(renderer, '.composer-error[role="alert"]', "重试");
    await until(renderer, `window.mingshen.getComposerDraft(${JSON.stringify(fixture.unrelated)}).then(value=>value?.text===${JSON.stringify(unrelatedText)})`);

    const failedText = "MAIN_ARCHIVE_FAILED_DRAFT_SENTINEL";
    await selectSession(fixture.failure);
    await installSaveFixture(fixture.failure, "fail");
    await typeDraft(renderer, failedText);
    await until(renderer, 'document.querySelector(".composer-error[role=alert]")?.textContent.includes("MAIN_ARCHIVE_DRAFT_FAILURE")');
    await installArchiveHold(fixture.failure);
    await archiveSelected(fixture.failure);
    await until(mainInspector, 'globalThis.__desktopSmokeArchiveHold?.held===true');
    assert.equal(await renderer.evaluate(`(()=>{
      const buttons=[...document.querySelectorAll('.composer-error[role="alert"] button')];
      const retry=buttons.find(button=>button.textContent?.includes("重试"));
      return Boolean(retry?.disabled);
    })()`), true, "The draft retry button remained enabled during batch processing");
    await removeArchiveHold();
    await until(renderer, 'document.querySelector(".chat-sidebar__batch")?.getAttribute("aria-busy")==="false"&&document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("MAIN_ARCHIVE_DRAFT_FAILURE")');
    assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(fixture.failure)})`))?.archived, false,
      "A draft save failure did not block archiving");
    assert.equal(await renderer.evaluate(`document.querySelector('[data-session-id="${fixture.failure}"] input[type=checkbox]')?.checked`), true,
      "The failed archive was not retained for retry");
    assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]")?.value'), failedText);
    assert.equal(await renderer.evaluate('document.querySelector(".composer[data-testid=chat-composer]")?.inert'), false,
      "The composer remained locked after archive failure");
    assert.equal(await renderer.evaluate('Boolean(document.querySelector("[data-testid=chat-batch-composer-status]"))'), false);
    await screenshot(renderer, "chat-batch-main-draft-failure");
    await removeSaveFixture();
    await archiveSelected(fixture.failure, false);
    await waitForArchive(fixture.failure, failedText);

    await click(renderer, '[data-testid="chat-batch-toggle"]');
    const quickState = await renderer.evaluate('window.mingshen.quickChatAction("new")');
    const sharedId = quickState?.session?.id;
    assert.ok(sharedId, "Could not create the shared-window draft fixture");
    quick = await connectQuickChat();
    await until(quick, 'Boolean(document.querySelector(".chat-view--quick [data-testid=chat-composer-input]:not([hidden]):not(:disabled)"))');
    await selectSession(sharedId);
    const mainText = "MAIN_WINDOW_CONFLICT_DRAFT_SENTINEL";
    const quickText = "QUICK_WINDOW_CONFLICT_DRAFT_SENTINEL";
    await installSaveFixture(sharedId, "hold");
    await typeDraft(renderer, mainText);
    await until(mainInspector, 'globalThis.__desktopSmokeMainDraft?.held===true');
    await typeDraft(quick, quickText);
    await until(renderer, `window.mingshen.getComposerDraft(${JSON.stringify(sharedId)}).then(value=>value?.text===${JSON.stringify(quickText)})`);
    await releaseSave();
    assert.equal(await mainInspector.evaluate('globalThis.__desktopSmokeMainDraft.settled'), "rejected",
      "The stale main-window revision did not conflict with the quick-window save");
    await until(renderer, 'Boolean(document.querySelector(".composer-error--draft-conflict"))');
    await removeSaveFixture();
    await installArchiveHold(sharedId);
    await archiveSelected(sharedId);
    await until(mainInspector, 'globalThis.__desktopSmokeArchiveHold?.held===true');
    assert.equal(await renderer.evaluate(`(()=>{
      const buttons=[...document.querySelectorAll('.composer-error--draft-conflict button')];
      return buttons.length===2&&buttons.every(button=>button.disabled);
    })()`), true, "Draft conflict resolution remained enabled during batch processing");
    await removeArchiveHold();
    await until(renderer, 'document.querySelector(".chat-sidebar__batch")?.getAttribute("aria-busy")==="false"&&document.querySelector(".chat-sidebar__batch-result")?.textContent.includes("COMPOSER_DRAFT_CONFLICT")');
    assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(sharedId)})`))?.archived, false,
      "A cross-window draft conflict did not block archiving");
    assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]")?.value'), mainText,
      "The local conflict draft was not retained");
    assert.equal((await renderer.evaluate(`window.mingshen.getComposerDraft(${JSON.stringify(sharedId)})`))?.text, quickText,
      "The conflicting persisted draft was overwritten without confirmation");
    assert.equal(await renderer.evaluate(`document.querySelector('[data-session-id="${sharedId}"] input[type=checkbox]')?.checked`), true);
    await screenshot(renderer, "chat-batch-main-draft-conflict");
    await clickText(renderer, ".composer-error--draft-conflict", "用本地内容覆盖");
    await until(renderer, `window.mingshen.getComposerDraft(${JSON.stringify(sharedId)}).then(value=>value?.text===${JSON.stringify(mainText)})`);
    await until(renderer, '!document.querySelector(".composer-error--draft-conflict")');
    await archiveSelected(sharedId, false);
    await waitForArchive(sharedId, mainText);
    await until(quick, 'Boolean(document.querySelector("[data-testid=quick-chat-archived]"))');
    await until(quick, `document.querySelector('[data-testid="quick-chat-archived-draft"]')?.value===${JSON.stringify(mainText)}`);
  } finally {
    await removeArchiveHold().catch(() => undefined);
    await removeSaveFixture().catch(() => undefined);
    quick?.close();
  }
}

async function companionStagePoint() {
  const point = await companion.evaluate(`(()=>{const r=document.querySelector(".companion-stage")?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2}:null})()`);
  assert.ok(point, "Companion stage is missing");
  return point;
}

async function dragBy(dx, dy, { cancel = false } = {}) {
  const point = await companionStagePoint();
  await dispatchMouse(companion, "mouseMoved", point.x, point.y);
  await dispatchMouse(companion, "mousePressed", point.x, point.y, { button: "left", buttons: 1, clickCount: 1 });
  await dispatchMouse(companion, "mouseMoved", point.x + dx, point.y + dy, { button: "left", buttons: 1 });
  await sleep(120);
  if (cancel) {
    await companion.evaluate(`(()=>{const stage=document.querySelector(".companion-stage");stage.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,pointerId:1,pointerType:"mouse",button:0,buttons:0}));return true})()`);
    await sleep(120);
    const cancelledBounds = (await inspectWindows()).companion.bounds;
    await dispatchMouse(companion, "mouseMoved", point.x + dx + 24, point.y + dy + 18, { button: "left", buttons: 1 });
    await sleep(200);
    assert.deepEqual((await inspectWindows()).companion.bounds, cancelledBounds, "Position changed after synthetic pointercancel");
  }
  await dispatchMouse(companion, "mouseReleased", point.x + dx, point.y + dy, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(300);
}

async function verifyCompanionDrag() {
  await setCompanionAtWorkAreaCenter();
  const beforeSmall = (await inspectWindows()).companion.bounds;
  await dragBy(2, 2);
  assert.deepEqual((await inspectWindows()).companion.bounds, beforeSmall, "A below-threshold pointer movement moved the companion");
  assert.notEqual((await companion.evaluate("window.companion.getState()")).mood, "dragging");

  const beforeLarge = (await inspectWindows()).companion.bounds;
  await dragBy(40, 30);
  const afterLarge = (await inspectWindows()).companion.bounds;
  assert.ok(afterLarge.x !== beforeLarge.x || afterLarge.y !== beforeLarge.y, "Above-threshold drag did not move the companion");

  await setCompanionAtWorkAreaCenter();
  await dragBy(35, 25, { cancel: true });
  assert.notEqual((await companion.evaluate("window.companion.getState()")).mood, "dragging", "Pointer cancellation left the companion dragging");

  // Lock from the separate preferences path while the pointer is still held.
  // This exercises the ordering between renderer cancellation and the main
  // process state transition rather than just locking before a drag begins.
  await setCompanionAtWorkAreaCenter();
  const point = await companionStagePoint();
  await dispatchMouse(companion, "mouseMoved", point.x, point.y);
  await dispatchMouse(companion, "mousePressed", point.x, point.y, { button: "left", buttons: 1, clickCount: 1 });
  await dispatchMouse(companion, "mouseMoved", point.x + 35, point.y + 25, { button: "left", buttons: 1 });
  await until(companion, 'window.companion.getState().then(state=>state.mood==="dragging")');
  await renderer.evaluate('window.mingshen.setCompanionPreferences({positionLocked:true})');
  await until(companion, 'window.companion.getState().then(state=>state.preferences.positionLocked&&state.mood!=="dragging")');
  await until(companion, '!document.querySelector(".companion-surface.is-dragging")');
  await sleep(300);
  const lockedDuringDrag = (await inspectWindows()).companion.bounds;
  await dispatchMouse(companion, "mouseMoved", point.x + 65, point.y + 50, { button: "left", buttons: 1 });
  await dispatchMouse(companion, "mouseReleased", point.x + 65, point.y + 50, { button: "left", buttons: 0, clickCount: 1 });
  await sleep(300);
  assert.deepEqual((await inspectWindows()).companion.bounds, lockedDuringDrag, "Locking during a drag allowed a subsequent pointer movement");
  assert.notEqual((await companion.evaluate("window.companion.getState()")).mood, "dragging", "Locking during a drag left the companion dragging");
  await renderer.evaluate('window.mingshen.setCompanionPreferences({positionLocked:false})');
  await until(companion, 'window.companion.getPreferences().then(value=>value.positionLocked===false)');

  let menu = await captureCompanionMenu();
  assert.equal(menuItem(menu, "position-locked")?.checked, false);
  await invokeCapturedMenu("position-locked");
  await until(companion, "window.companion.getPreferences().then(value=>value.positionLocked===true)");
  const locked = (await inspectWindows()).companion.bounds;
  await dragBy(40, 30);
  assert.deepEqual((await inspectWindows()).companion.bounds, locked, "Locked companion moved during pointer drag");
  menu = await captureCompanionMenu();
  assert.equal(menuItem(menu, "position-locked")?.checked, true);
  await invokeCapturedMenu("position-locked");
  await until(companion, "window.companion.getPreferences().then(value=>value.positionLocked===false)");
}

async function verifyCompiledCompanionVideos({ limit = 36 } = {}) {
  const manifestPath = join(desktop, "src/renderer/companion-assets/motions/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, 1, "Unsupported motion manifest version");
  assert.equal(manifest.motions?.length, 36, "Motion manifest must contain exactly 36 clips");
  const assets = await readdir(join(desktop, "out/renderer/assets"));
  const clips = manifest.motions.slice(0, limit).map((motion) => {
    assert.match(motion.id, /^[a-z0-9_-]+$/, "Unexpected motion id");
    assert.equal(motion.file, `${motion.id}.webm`, `Unexpected manifest filename for ${motion.id}`);
    const candidates = assets.filter((name) => name.startsWith(`${motion.id}-`) && name.endsWith(".webm"));
    assert.equal(candidates.length, 1, `Expected one compiled asset for ${motion.id}; found ${candidates.length}`);
    return { id: motion.id, url: `./assets/${candidates[0]}` };
  });
  try {
    videoResults.push(...await inspectCompanionVideos(companion, clips, {
      expectedCount: limit,
      onFrame: async (result, dataUrl) => {
        assert.match(dataUrl, /^data:image\/png;base64,/, `Invalid frame evidence for ${result.id}`);
        const path = join(evidence, `video-${result.id}.png`);
        await writeFile(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
        screenshots.push(path);
      },
    }));
  } catch (cause) {
    if (Array.isArray(cause?.results)) videoResults.push(...cause.results);
    throw cause;
  }
}

async function quitOwnedElectron() {
  mainInspector?.close();
  mainInspector = null;
  await renderer?.evaluate('window.mingshen.desktopAction("quit")').catch(() => undefined);
  renderer?.close();
  renderer = null;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = await Promise.race([
      new Promise((done) => child.once("exit", () => done(true))),
      sleep(12_000).then(() => false),
    ]);
    assert.equal(exited, true, "Owned Electron did not exit normally");
  }
  child = null;
}

async function verifyStartupHardDeadline() {
  child = spawn(executable, ["--inspect-brk=" + inspectPort, ".", `--remote-debugging-port=${debugPort}`], {
    cwd: desktop,
    env: environment,
    windowsHide: true,
    stdio: "ignore",
  });
  mainInspector = await connectMainInspector();
  const paused = mainInspector.waitEvent("Debugger.paused");
  await mainInspector.send("Debugger.enable");
  await mainInspector.send("Runtime.runIfWaitingForDebugger");
  const event = await paused;
  assert.ok(event.callFrames?.length, "The isolated main process did not pause at startup");
  const injected = await mainInspector.send("Debugger.evaluateOnCallFrame", {
    callFrameId: event.callFrames[0].callFrameId,
    expression: `(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const original=electron.BrowserWindow.prototype.once;
      globalThis.__desktopSmokeReadyEvents=0;
      electron.BrowserWindow.prototype.once=function(name,listener){
        if(name!=="ready-to-show")return original.call(this,name,listener);
        return original.call(this,name,function(...args){
          globalThis.__desktopSmokeReadyEvents++;
          setTimeout(()=>listener.apply(this,args),11000);
        });
      };
      globalThis.__desktopSmokeRestoreReady=()=>{electron.BrowserWindow.prototype.once=original};
      return true;
    })()`,
    returnByValue: true,
  });
  assert.equal(injected.result?.value, true, `Could not install isolated startup delay: ${JSON.stringify(injected.exceptionDetails)}`);
  await mainInspector.send("Debugger.resume");
  startup = await connect(await waitForTarget(debugPort, (item) => item.type === "page" && /startup\.html/i.test(item.url)), "startup");
  await until(startup, 'Boolean(document.querySelector(".startup-presentation__mark"))');
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return electron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes("startup.html")&&w.isVisible())})()`);
  const observedAt = Date.now();
  await screenshot(startup, "startup-deadline-motion-0");
  await sleep(450);
  await screenshot(startup, "startup-deadline-motion-1");
  geometry.push({ name: "startup-motion", ...await assertAnimationFrames(screenshots.at(-2), screenshots.at(-1), "startup-motion", { expectTransparent: false }) });
  await startup.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(200);
  await screenshot(startup, "startup-deadline-reduced-0");
  await sleep(650);
  await screenshot(startup, "startup-deadline-reduced-1");
  geometry.push({ name: "startup-reduced", ...await assertAnimationFrames(screenshots.at(-2), screenshots.at(-1), "startup-reduced", { expectedChanged: false, expectTransparent: false }) });
  await startup.send("Emulation.setEmulatedMedia", { features: [] });
  assert.ok(await mainInspector.evaluate("globalThis.__desktopSmokeReadyEvents>0"), "The fixture did not actually delay the main window ready event");
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return !electron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes("startup.html"))})()`, 10_000);
  const elapsed = Date.now() - observedAt;
  assert.ok(elapsed >= 4_000 && elapsed <= 9_000, `Unexpected startup deadline timing after visibility: ${elapsed}ms`);
  startup.close();
  startup = null;
  renderer = await connectMain();
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return electron.BrowserWindow.getAllWindows().some(w=>w.getTitle?.()==="Mingshen Harness"&&w.isVisible())})()`, 15_000);
  await until(renderer, 'Boolean(document.querySelector(".app-shell"))');
  await mainInspector.evaluate("globalThis.__desktopSmokeRestoreReady?.();delete globalThis.__desktopSmokeRestoreReady;true");
  geometry.push({ name: "startup-hard-deadline", elapsedAfterVisibleMs: elapsed, artificialReadyDelayMs: 11_000 });
  passed.push("With an isolated debugger delaying the main window ready event by 11 seconds, the startup surface timed out and the main window subsequently opened; normal and reduced-motion frames were compared.");
  await quitOwnedElectron();
}

async function verifyLateStartupPresentation() {
  child = spawn(executable, ["--inspect-brk=" + inspectPort, ".", `--remote-debugging-port=${debugPort}`], {
    cwd: desktop,
    env: environment,
    windowsHide: true,
    stdio: "ignore",
  });
  mainInspector = await connectMainInspector();
  const paused = mainInspector.waitEvent("Debugger.paused");
  await mainInspector.send("Debugger.enable");
  await mainInspector.send("Runtime.runIfWaitingForDebugger");
  const event = await paused;
  assert.ok(event.callFrames?.length, "The isolated main process did not pause for the late-startup fixture");
  const injected = await mainInspector.send("Debugger.evaluateOnCallFrame", {
    callFrameId: event.callFrames[0].callFrameId,
    expression: `(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const {app,BrowserWindow}=electron;
      const original={loadFile:BrowserWindow.prototype.loadFile,once:BrowserWindow.prototype.once,show:BrowserWindow.prototype.show,showInactive:BrowserWindow.prototype.showInactive,moveTop:BrowserWindow.prototype.moveTop};
      const fixture=globalThis.__desktopSmokeLate={events:[],sentinelId:null,startupId:null,mainId:null,release:null,ready:false};
      const record=(name,window)=>fixture.events.push({name,id:window?.id??null,at:performance.now(),focused:BrowserWindow.getFocusedWindow()?.id??null,visible:window&&!window.isDestroyed()?window.isVisible():null});
      const release=()=>{if(!fixture.release)return;const load=fixture.release;fixture.release=null;setTimeout(load,35)};
      BrowserWindow.prototype.loadFile=function(path,...args){
        if(!/[\\\\/]startup\\.html$/i.test(String(path)))return original.loadFile.call(this,path,...args);
        fixture.startupId=this.id;
        record("startup-load-requested",this);
        return new Promise((resolve,reject)=>{
          fixture.release=()=>{
            record("startup-load-started",this);
            original.loadFile.call(this,path,...args).then(value=>{record("startup-load-resolved",this);resolve(value)},reject);
          };
          if(fixture.ready)release();
        });
      };
      BrowserWindow.prototype.once=function(name,listener){
        if(name!=="ready-to-show")return original.once.call(this,name,listener);
        return original.once.call(this,name,function(...args){
          if(!/index\\.html/i.test(this.webContents.getURL()))return listener.apply(this,args);
          const window=this;
          const deadline=performance.now()+1500;
          const begin=()=>{
            const sentinel=fixture.sentinelId===null?null:BrowserWindow.fromId(fixture.sentinelId);
            if((!sentinel||!sentinel.isFocused())&&performance.now()<deadline){setTimeout(begin,25);return}
            fixture.mainId=window.id;
            record("main-ready",window);
            const result=listener.apply(window,args);
            fixture.ready=true;
            release();
            return result;
          };
          return begin();
        });
      };
      for(const method of ["show","showInactive","moveTop"]){
        BrowserWindow.prototype[method]=function(...args){
          record(method+"-before",this);
          const result=original[method].apply(this,args);
          record(method+"-after",this);
          if(method==="moveTop"&&this.id===fixture.startupId)setTimeout(()=>record("startup-focus-after-move",this),60);
          return result;
        };
      }
      app.whenReady().then(()=>{
        const sentinel=new BrowserWindow({show:false,width:240,height:120,title:"Mingshen startup focus fixture",skipTaskbar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
        fixture.sentinelId=sentinel.id;
        sentinel.show();
        sentinel.focus();
        record("sentinel-focus-requested",sentinel);
      });
      fixture.restore=()=>{
        for(const [name,method] of Object.entries(original))BrowserWindow.prototype[name]=method;
        const sentinel=fixture.sentinelId===null?null:BrowserWindow.fromId(fixture.sentinelId);
        if(sentinel&&!sentinel.isDestroyed())sentinel.destroy();
      };
      return true;
    })()`,
    returnByValue: true,
  });
  assert.equal(injected.result?.value, true, `Could not install late-startup fixture: ${JSON.stringify(injected.exceptionDetails)}`);
  await mainInspector.send("Debugger.resume");
  startup = await connect(await waitForTarget(debugPort, (item) => item.type === "page" && /startup\.html/i.test(item.url)), "startup");
  await until(startup, 'Boolean(document.querySelector(".startup-presentation__mark"))');
  await until(mainInspector, `(()=>{
    const fixture=globalThis.__desktopSmokeLate;
    return fixture?.events.some(event=>event.name==="showInactive-after"&&event.id===fixture.mainId)&&fixture.events.some(event=>event.name==="startup-focus-after-move");
  })()`);
  const snapshot = await mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const fixture=globalThis.__desktopSmokeLate;
    const main=electron.BrowserWindow.fromId(fixture.mainId);
    const startup=electron.BrowserWindow.fromId(fixture.startupId);
    return {events:fixture.events,sentinelId:fixture.sentinelId,mainId:fixture.mainId,startupId:fixture.startupId,mainVisible:main?.isVisible(),startupVisible:startup?.isVisible(),startupTop:startup?.isAlwaysOnTop()};
  })()`);
  const findEvent = (name, id) => snapshot.events.find((item) => item.name === name && (id === undefined || item.id === id));
  const requested = findEvent("startup-load-requested", snapshot.startupId);
  const ready = findEvent("main-ready", snapshot.mainId);
  const started = findEvent("startup-load-started", snapshot.startupId);
  const resolved = findEvent("startup-load-resolved", snapshot.startupId);
  const shown = findEvent("showInactive-after", snapshot.startupId);
  const underlay = findEvent("showInactive-after", snapshot.mainId);
  assert.ok(requested && ready && started && resolved && shown && underlay, `Missing late-startup observations: ${JSON.stringify(snapshot)}`);
  assert.ok(requested.at <= ready.at && ready.at <= started.at && started.at <= resolved.at && resolved.at <= shown.at && shown.at <= underlay.at, "The intended late-load ordering did not occur");
  assert.ok(shown.at - ready.at < 500, `Startup loaded after its 500ms grace period: ${shown.at - ready.at}ms`);
  assert.equal(snapshot.mainVisible, true, "The late startup surface did not have a visible main-window underlay");
  assert.equal(snapshot.startupVisible, true, "The late startup surface was not visible");
  assert.equal(snapshot.startupTop, true, "The late startup surface was not topmost");
  const focusEstablished = Number.isInteger(snapshot.sentinelId) && ready.focused === snapshot.sentinelId;
  if (focusEstablished) {
    for (const observed of [shown, findEvent("moveTop-after", snapshot.startupId), underlay, findEvent("startup-focus-after-move", snapshot.startupId)]) {
      assert.equal(observed?.focused, snapshot.sentinelId, `A showInactive/moveTop operation changed the fixture's focused window: ${JSON.stringify(observed)}`);
    }
  }
  geometry.push({ name: "startup-late-load", loadAfterReadyMs: started.at - ready.at, shownAfterReadyMs: shown.at - ready.at, focusEstablished, snapshot });
  await screenshot(startup, "startup-late-underlay");
  await until(startup, 'document.querySelector(".startup-presentation")?.dataset.stage==="ready"');
  const firstOpacity = Number(await startup.evaluate('getComputedStyle(document.querySelector(".startup-presentation")).opacity'));
  await sleep(100);
  const secondOpacity = Number(await startup.evaluate('getComputedStyle(document.querySelector(".startup-presentation")).opacity'));
  assert.ok(secondOpacity < firstOpacity, `Startup ready transition did not fade: ${firstOpacity} -> ${secondOpacity}`);
  await until(mainInspector, `(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const fixture=globalThis.__desktopSmokeLate;
    return !electron.BrowserWindow.fromId(fixture.startupId)&&electron.BrowserWindow.fromId(fixture.mainId)?.isVisible()&&fixture.events.some(event=>event.name==="show-after"&&event.id===fixture.mainId);
  })()`);
  startup.close();
  startup = null;
  renderer = await connectMain();
  await until(renderer, 'Boolean(document.querySelector(".app-shell"))');
  await mainInspector.evaluate('globalThis.__desktopSmokeLate.restore();true');
  passed.push(`A debugger-controlled late startup load occurred after main ready and within the 500ms grace period; both real windows were visible, the surface faded and closed, and the main window opened. ${focusEstablished ? "A focused same-process sentinel retained focus through showInactive and moveTop." : "The sentinel could not establish focus, so focus preservation was inconclusive."}`);
  await quitOwnedElectron();
}

async function verifyNormalStartupAndIndexWarmup() {
  child = spawn(executable, ["--inspect-brk=" + inspectPort, ".", `--remote-debugging-port=${debugPort}`], {
    cwd: desktop,
    env: environment,
    windowsHide: true,
    stdio: "ignore",
  });
  mainInspector = await connectMainInspector();
  const paused = mainInspector.waitEvent("Debugger.paused");
  await mainInspector.send("Debugger.enable");
  await mainInspector.send("Runtime.runIfWaitingForDebugger");
  const event = await paused;
  assert.ok(event.callFrames?.length, "The isolated main process did not pause for startup timing");
  const injected = await mainInspector.send("Debugger.evaluateOnCallFrame", {
    callFrameId: event.callFrames[0].callFrameId,
    expression: `(()=>{
      const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json");
      const {BrowserWindow,ipcMain}=require("electron");
      const {DatabaseSync}=require("node:sqlite");
      const original={loadFile:BrowserWindow.prototype.loadFile,showInactive:BrowserWindow.prototype.showInactive,prepare:DatabaseSync.prototype.prepare,handle:ipcMain.handle};
      const fixture=globalThis.__desktopSmokeNormal={events:[],startupId:null};
      const statements=new WeakMap();
      let statementPrototype=null;
      let originalAll=null;
      const visible=()=>{const window=fixture.startupId===null?null:BrowserWindow.fromId(fixture.startupId);return Boolean(window&&!window.isDestroyed()&&window.isVisible())};
      const record=(name,details={})=>fixture.events.push({name,at:performance.now(),splashVisible:visible(),...details});
      BrowserWindow.prototype.loadFile=function(path,...args){
        if(/[\\\\/]startup\\.html$/i.test(String(path))){
          fixture.startupId=this.id;
          this.once("closed",()=>record("startup-closed"));
          const send=this.webContents.send;
          this.webContents.send=function(channel,...values){
            if(channel==="startup-presentation:stage")record("stage",{stage:values[0]});
            return send.call(this,channel,...values);
          };
        }
        return original.loadFile.call(this,path,...args);
      };
      BrowserWindow.prototype.showInactive=function(...args){
        const result=original.showInactive.apply(this,args);
        if(this.id===fixture.startupId)record("startup-shown");
        return result;
      };
      DatabaseSync.prototype.prepare=function(sql,...args){
        const statement=original.prepare.call(this,sql,...args);
        if(!statementPrototype){
          statementPrototype=Object.getPrototypeOf(statement);
          originalAll=statementPrototype.all;
          statementPrototype.all=function(...values){
            const index=statements.get(this);
            if(index)record("sqlite-index-started",{index});
            const rows=originalAll.apply(this,values);
            if(index)record("sqlite-index-returned",{index,rows:rows.length});
            return rows;
          };
        }
        const text=String(sql);
        if(/^\\s*select 1 from sessions indexed by sessions_catalog_idx/i.test(text))statements.set(statement,"workspace");
        if(/^\\s*select 1 from sessions indexed by sessions_agent_mode_catalog_idx/i.test(text))statements.set(statement,"chat");
        return statement;
      };
      ipcMain.handle=function(channel,listener){
        if(channel!=="app:bootstrap")return original.handle.call(this,channel,listener);
        return original.handle.call(this,channel,async function(...args){
          record("bootstrap-started");
          const data=await listener.apply(this,args);
          record("bootstrap-completed",{sessions:data?.sessions?.length??null,providers:data?.providers?.length??null});
          return data;
        });
      };
      fixture.restore=()=>{
        BrowserWindow.prototype.loadFile=original.loadFile;
        BrowserWindow.prototype.showInactive=original.showInactive;
        DatabaseSync.prototype.prepare=original.prepare;
        if(statementPrototype&&originalAll)statementPrototype.all=originalAll;
        ipcMain.handle=original.handle;
      };
      return true;
    })()`,
    returnByValue: true,
  });
  assert.equal(injected.result?.value, true, `Could not install startup observations: ${JSON.stringify(injected.exceptionDetails)}`);
  await mainInspector.send("Debugger.resume");
  startup = await connect(await waitForTarget(debugPort, (item) => item.type === "page" && /startup\.html/i.test(item.url)), "startup");
  await until(mainInspector, 'globalThis.__desktopSmokeNormal.events.some(event=>event.name==="startup-shown")');
  await screenshot(startup, "startup-normal-preparing");
  await until(mainInspector, 'globalThis.__desktopSmokeNormal.events.some(event=>event.name==="startup-closed")', 12_000);
  await until(mainInspector, 'globalThis.__desktopSmokeNormal.events.some(event=>event.name==="bootstrap-completed")', 20_000);
  const observed = await mainInspector.evaluate('globalThis.__desktopSmokeNormal.events');
  const shown = observed.find((entry) => entry.name === "startup-shown");
  const ready = observed.find((entry) => entry.name === "stage" && entry.stage === "ready");
  const closed = observed.find((entry) => entry.name === "startup-closed");
  assert.ok(shown?.splashVisible && ready?.splashVisible && closed, `Normal startup events are incomplete: ${JSON.stringify(observed)}`);
  const beforeExitMs = ready.at - shown.at;
  const totalMs = closed.at - shown.at;
  assert.ok(beforeExitMs >= 4_600 && beforeExitMs <= 6_500, `Normal startup did not remain visible for roughly 4.68s before exit: ${beforeExitMs}ms`);
  assert.ok(totalMs >= 4_900 && totalMs <= 7_500, `Normal startup did not last roughly 5s: ${totalMs}ms`);
  assert.ok(closed.at - ready.at >= 250 && closed.at - ready.at <= 1_500,
    `Normal startup exit transition timing is unexpected: ${closed.at - ready.at}ms`);
  for (const index of ["workspace", "chat"]) {
    const start = observed.find((entry) => entry.name === "sqlite-index-started" && entry.index === index);
    const end = observed.find((entry) => entry.name === "sqlite-index-returned" && entry.index === index);
    assert.ok(start?.splashVisible && end?.splashVisible && start.at >= shown.at && end.at >= start.at && end.at < closed.at,
      `SQLite ${index} index did not successfully execute while splash was visible: ${JSON.stringify(observed)}`);
    if (index === "workspace") assert.ok(end.rows > 0, `The fixture workspace index did not return a row: ${JSON.stringify(end)}`);
  }
  const bootstrap = observed.find((entry) => entry.name === "bootstrap-completed" && entry.splashVisible);
  assert.ok(bootstrap && bootstrap.sessions > 0 && bootstrap.providers > 0,
    `The existing fixture profile was not bootstrapped while splash was visible: ${JSON.stringify(observed)}`);
  geometry.push({ name: "startup-normal-and-index-warmup", beforeExitMs, totalMs, events: observed });
  startup.close();
  startup = null;
  renderer = await connectMain();
  await until(renderer, 'Boolean(document.querySelector(".app-shell"))');
  await mainInspector.evaluate('globalThis.__desktopSmokeNormal.restore();true');
  passed.push(`Normal accepted-profile startup stayed visible ${Math.round(totalMs)}ms; both real SQLite index reads and a fixture-data bootstrap completed while it was visible.`);
  await quitOwnedElectron();
}

async function verifyInitialPolicyTiming(mode) {
  assert.ok(["normal", "skip", "disabled"].includes(mode));
  const isolatedProfile = join(temporary, `policy-${mode}`);
  await mkdir(isolatedProfile, { recursive: true });
  if (mode === "disabled") {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(join(isolatedProfile, "mingshen.db"));
    try {
      database.exec("create table app_settings (key text primary key, value_json text not null, updated_at text not null)");
      database.prepare("insert into app_settings (key, value_json, updated_at) values (?, ?, ?)")
        .run("desktop.startup-animation", "false", new Date().toISOString());
    } finally {
      database.close();
    }
  }
  child = spawn(executable, ["--inspect-brk=" + inspectPort, ".", `--remote-debugging-port=${debugPort}`], {
    cwd: desktop,
    env: { ...environment, MSH_USER_DATA_DIR: isolatedProfile },
    windowsHide: true,
    stdio: "ignore",
  });
  mainInspector = await connectMainInspector();
  const paused = mainInspector.waitEvent("Debugger.paused");
  await mainInspector.send("Debugger.enable");
  await mainInspector.send("Runtime.runIfWaitingForDebugger");
  const event = await paused;
  assert.ok(event.callFrames?.length, `The ${mode} policy fixture did not pause`);
  const injected = await mainInspector.send("Debugger.evaluateOnCallFrame", {
    callFrameId: event.callFrames[0].callFrameId,
    expression: `(()=>{
      const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json");
      const {BrowserWindow,ipcMain}=require("electron");
      const original={loadFile:BrowserWindow.prototype.loadFile,show:BrowserWindow.prototype.show,showInactive:BrowserWindow.prototype.showInactive,handle:ipcMain.handle};
      const fixture=globalThis.__desktopSmokePolicy={events:[],startupId:null,mainId:null};
      const visible=id=>{const window=id===null?null:BrowserWindow.fromId(id);return Boolean(window&&!window.isDestroyed()&&window.isVisible())};
      const windows=()=>BrowserWindow.getAllWindows().map(window=>({id:window.id,webContentsId:window.webContents.id,url:window.webContents.getURL(),visible:window.isVisible(),focused:window.isFocused()}));
      const record=(name,extra={})=>fixture.events.push({name,at:performance.now(),startupId:fixture.startupId,mainId:fixture.mainId,splashVisible:visible(fixture.startupId),mainVisible:visible(fixture.mainId),windows:windows(),...extra});
      BrowserWindow.prototype.loadFile=function(path,...args){
        if(/[\\\\/]startup\\.html$/i.test(String(path))){
          fixture.startupId=this.id;
          record("startup-load");
          this.once("closed",()=>record("startup-closed"));
        }else if(/[\\\\/]index\\.html$/i.test(String(path))){
          fixture.mainId=this.id;
          record("main-load");
        }
        return original.loadFile.call(this,path,...args);
      };
      for(const name of ["show","showInactive"]){
        BrowserWindow.prototype[name]=function(...args){
          if(this.id===fixture.startupId)record("startup-"+name+"-before");
          if(this.id===fixture.mainId)record("main-"+name+"-before");
          const result=original[name].apply(this,args);
          if(this.id===fixture.startupId)record("startup-shown");
          if(this.id===fixture.mainId)record("main-"+name);
          return result;
        };
      }
      ipcMain.handle=function(channel,listener){
        if(!["policy:read","policy:accept"].includes(channel))return original.handle.call(this,channel,listener);
        return original.handle.call(this,channel,async function(...args){
          const name=channel==="policy:read"?"policy-read":"policy-accept";
          const senderId=args[0]?.sender?.id??null;
          const senderWindowId=BrowserWindow.fromWebContents(args[0]?.sender)?.id??null;
          record(name+"-started",{senderId,senderWindowId});
          try{
            const result=await listener.apply(this,args);
            record(name+"-completed",{senderId,senderWindowId});
            return result;
          }catch(cause){
            record(name+"-rejected");
            throw cause;
          }
        });
      };
      fixture.restore=()=>{
        BrowserWindow.prototype.loadFile=original.loadFile;
        BrowserWindow.prototype.show=original.show;
        BrowserWindow.prototype.showInactive=original.showInactive;
        ipcMain.handle=original.handle;
      };
      return true;
    })()`,
    returnByValue: true,
  });
  assert.equal(injected.result?.value, true, `Could not install ${mode} policy observations: ${JSON.stringify(injected.exceptionDetails)}`);
  await mainInspector.send("Debugger.resume");
  if (mode !== "disabled") {
    startup = await connect(await waitForTarget(debugPort, (item) => item.type === "page" && /startup\.html/i.test(item.url)), "startup");
    await until(mainInspector, 'globalThis.__desktopSmokePolicy.events.some(event=>event.name==="startup-shown")');
  }
  renderer = await connectMain();
  await until(renderer, 'Boolean(document.querySelector(".policy-dialog"))');
  assert.equal((await renderer.evaluate('window.mingshen.getDesktopState()')).accepted, false);
  await until(mainInspector, 'globalThis.__desktopSmokePolicy.events.some(event=>event.name==="policy-read-started")');

  const earlyAccept = async () => renderer.evaluate(`(async()=>{
    try{await window.mingshen.acceptPolicies({terms:true,privacy:true,disclaimer:true});return {accepted:true}}
    catch(cause){return {accepted:false,message:String(cause)}}
  })()`);

  if (mode === "normal") {
    await until(mainInspector, `(()=>{
      const events=globalThis.__desktopSmokePolicy.events;
      const shown=events.find(event=>event.name==="startup-shown");
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const window=electron.BrowserWindow.fromId(globalThis.__desktopSmokePolicy.startupId);
      return Boolean(shown&&performance.now()-shown.at>=3000&&window&&!window.isDestroyed()&&window.isVisible());
    })()`, 6_000);
    const whileCovered = await mainInspector.evaluate('globalThis.__desktopSmokePolicy.events');
    assert.ok(!whileCovered.some((entry) => entry.name === "policy-read-completed"),
      `Initial policy content was acknowledged while startup still covered it: ${JSON.stringify(whileCovered)}`);
    const beforeVisible = await earlyAccept();
    assert.equal(beforeVisible.accepted, false, `The backend accepted the policy while it was covered: ${JSON.stringify(beforeVisible)}`);
    assert.match(beforeVisible.message, /Please read the policies for at least five seconds/i);
  } else if (mode === "skip") {
    await clickStartupSkip("initial-policy");
  }

  await until(mainInspector, 'globalThis.__desktopSmokePolicy.events.some(event=>event.name==="policy-read-completed")', 15_000);
  if (startup) {
    await until(mainInspector, 'globalThis.__desktopSmokePolicy.events.some(event=>event.name==="startup-closed")');
    startup.close();
    startup = null;
  }
  await until(mainInspector, 'globalThis.__desktopSmokePolicy.events.some(event=>event.name==="main-show")');
  await until(renderer, `(()=>{
    const body=document.querySelector(".policy-dialog__body");
    return Boolean(body?.textContent?.trim()&&!body.querySelector('[role="status"], [role="alert"]'));
  })()`);
  const bodyVisibleAt = await mainInspector.evaluate('performance.now()');
  assert.equal(await renderer.evaluate('document.querySelectorAll(".policy-dialog input[type=checkbox]").length'), 3);
  await renderer.evaluate('document.querySelectorAll(".policy-dialog input[type=checkbox]").forEach(input=>input.click())');
  const read = await mainInspector.evaluate('globalThis.__desktopSmokePolicy.events.find(event=>event.name==="policy-read-completed")');
  geometry.push({ name: `startup-policy-${mode}-after-read`, events: await mainInspector.evaluate('globalThis.__desktopSmokePolicy.events') });
  assert.ok(read && !read.splashVisible && read.mainVisible, `${mode} policy was acknowledged before the main window was visible: ${JSON.stringify(read)}`);
  const mainShown = await mainInspector.evaluate('globalThis.__desktopSmokePolicy.events.find(event=>event.name==="main-show")');
  assert.ok(mainShown && mainShown.at <= read.at && !mainShown.splashVisible,
    `${mode} policy was acknowledged before the main window was shown: ${JSON.stringify({mainShown,read})}`);
  assert.ok(bodyVisibleAt - read.at < 350, `${mode} policy fixture took too long to observe the rendered document: ${bodyVisibleAt - read.at}ms`);
  const firstButton = await renderer.evaluate(`(()=>{const button=document.querySelector(".policy-dialog .btn--primary");return {disabled:button?.disabled,text:button?.textContent}})()`);
  assert.equal(firstButton.disabled, true, `${mode} policy button was already enabled after content appeared`);
  await screenshot(renderer, `startup-policy-${mode}-countdown`);
  const now = await mainInspector.evaluate('performance.now()');
  await sleep(Math.max(0, 4_450 - (now - bodyVisibleAt)));
  const elapsedBeforeAccept = (await mainInspector.evaluate('performance.now()')) - read.at;
  assert.ok(elapsedBeforeAccept < 4_850, `${mode} policy fixture missed its early-check window: ${elapsedBeforeAccept}ms`);
  const premature = await earlyAccept();
  assert.equal(premature.accepted, false, `${mode} backend accepted before the reading interval: ${JSON.stringify(premature)}`);
  assert.match(premature.message, /Please read the policies for at least five seconds/i);
  assert.equal(await renderer.evaluate('document.querySelector(".policy-dialog .btn--primary")?.disabled'), true,
    `${mode} UI enabled consent before the required reading interval`);
  await until(renderer, 'document.querySelector(".policy-dialog .btn--primary")?.disabled===false', 8_000);
  const finishedAt = await mainInspector.evaluate('performance.now()');
  const elapsedMs = finishedAt - read.at;
  const visibleElapsedMs = finishedAt - bodyVisibleAt;
  assert.ok(elapsedMs >= 4_900 && elapsedMs <= 8_000, `${mode} policy reading time is unexpected: ${elapsedMs}ms`);
  assert.ok(visibleElapsedMs >= 4_700, `${mode} consent button enabled too soon after rendered content: ${visibleElapsedMs}ms`);
  assert.equal((await renderer.evaluate('window.mingshen.getDesktopState()')).accepted, false);
  const observations = await mainInspector.evaluate('globalThis.__desktopSmokePolicy.events');
  assert.ok(observations.some((entry) => entry.name === "policy-accept-rejected"), `${mode} did not record a rejected early acceptance`);
  if (mode === "disabled") {
    assert.equal(observations.some((entry) => entry.name === "startup-load"), false,
      "A startup surface was loaded despite the disabled setting");
  } else {
    const closed = observations.find((entry) => entry.name === "startup-closed");
    assert.ok(closed && read.at >= closed.at, `${mode} policy receipt preceded startup closure`);
  }
  geometry.push({ name: `startup-policy-${mode}`, elapsedBeforeAcceptMs: elapsedBeforeAccept, elapsedFromReceiptMs: elapsedMs, elapsedFromVisibleBodyMs: visibleElapsedMs, firstButton, observations });
  await screenshot(renderer, `startup-policy-${mode}-ready`);
  await clickText(renderer, ".policy-dialog", "同意并继续");
  await until(renderer, 'window.mingshen.getDesktopState().then(state=>state.accepted===true&&state.manualPending===true)');
  await until(renderer, `(()=>{
    const body=document.querySelector(".policy-dialog .document-reader > .policy-dialog__body");
    const manual=body?.querySelector(":scope > .markdown-body");
    const button=[...document.querySelectorAll(".policy-dialog > footer button")].find(item=>item.textContent?.includes("开始使用"));
    return Boolean(manual?.textContent?.trim()&&manual.querySelector("h1")?.textContent?.includes("使用手册")&&!body.querySelector(':scope > [role="status"], :scope > [role="alert"]')&&button&&!button.disabled);
  })()`);
  await clickText(renderer, ".policy-dialog", "开始使用");
  await until(renderer, 'window.mingshen.getDesktopState().then(state=>state.accepted===true&&state.manualPending===false)');
  await mainInspector.evaluate('globalThis.__desktopSmokePolicy.restore();true');
  passed.push(`The isolated ${mode} first-launch profile rejected early backend consent, enabled consent after reading and completed onboarding in its disposable profile.`);
  await quitOwnedElectron();
}

async function focusMain() {
  assert.ok(mainInspector, "Main process inspector is missing");
  const mainUrl = await renderer.evaluate("location.href");
  const snapshot = () => mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    return electron.BrowserWindow.getAllWindows().map(window=>({
      id:window.id,url:window.webContents.getURL(),title:window.getTitle(),destroyed:window.isDestroyed(),
      visible:window.isVisible(),focused:window.isFocused(),alwaysOnTop:window.isAlwaysOnTop(),
      minimized:window.isMinimized(),modal:window.isModal(),parentId:window.getParentWindow()?.id??null,
    }));
  })()`);
  const before = await snapshot();
  let after = null;
  try {
    const matches = before.filter((window) => window.url === mainUrl);
    assert.equal(matches.length, 1, `The connected main renderer did not map to exactly one native window: ${JSON.stringify(before)}`);
    assert.equal(matches[0].visible, true, `The main window is not visible before focusing: ${JSON.stringify(before)}`);
    assert.equal(before.some((window) => window.url.includes("surface=quick-chat") && window.visible), false,
      `The quick-chat window remained visible after hide: ${JSON.stringify(before)}`);
    await mainInspector.evaluate(`(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const main=electron.BrowserWindow.fromId(${matches[0].id});
      if(!main||main.isDestroyed()||main.webContents.getURL()!==${JSON.stringify(mainUrl)})throw new Error("Main renderer identity changed");
      if(main.isMinimized())main.restore();
      main.focus();
      return true;
    })()`);
    await until(mainInspector, `(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const main=electron.BrowserWindow.fromId(${matches[0].id});
      return Boolean(main&&!main.isDestroyed()&&main.webContents.getURL()===${JSON.stringify(mainUrl)}&&main.isFocused());
    })()`, 5_000);
  } finally {
    after = await snapshot();
    geometry.push({ name: "main-focus-native", mainUrl, before, after, documentFocused: await renderer.evaluate("document.hasFocus()") });
  }
}

async function applyInterfaceStyle(style) {
  await click(renderer, 'button[aria-label="打开设置"]');
  await until(renderer, 'Boolean(document.querySelector(".settings-workspace"))');
  await click(renderer, `input[name="interface-style"][value=${JSON.stringify(style)}]`);
  await until(renderer, 'Boolean(document.querySelector(".interface-style-pending"))');
  await clickText(renderer, ".interface-style-pending", "重载并应用");
  renderer.close();
  await sleep(400);
  renderer = await connectMain();
  await until(renderer, `document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}`);
}

async function inspectAndCaptureCompanionSize(size) {
  await setRangeSetting("桌宠大小", size, `window.mingshen.getCompanionPreferences().then(value=>value.size===${size})`);
  await until(mainInspector, `(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const window=electron.BrowserWindow.getAllWindows().find(item=>item.getTitle?.()==="Mingshen Companion");
    if(!window)return false;
    const bounds=window.getBounds();
    return Math.abs(bounds.width-${size})<=1&&Math.abs(bounds.height-${size})<=1;
  })()`);
  const nativeSnapshot = await mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const window=electron.BrowserWindow.getAllWindows().find(item=>item.getTitle?.()==="Mingshen Companion");
    if(!window)return null;
    const bounds=window.getBounds();
    const screen=electron.screen.getDisplayMatching(bounds);
    return { bounds, scaleFactor: screen.scaleFactor, requestedSize: ${size} };
  })()`);
  assert.ok(nativeSnapshot, `Companion BrowserWindow is missing at requested size ${size}`);
  assert.ok(Math.abs(nativeSnapshot.bounds.width-size)<=1, `Native companion width differs by more than DPI rounding: ${JSON.stringify(nativeSnapshot)}`);
  assert.ok(Math.abs(nativeSnapshot.bounds.height-size)<=1, `Native companion height differs by more than DPI rounding: ${JSON.stringify(nativeSnapshot)}`);
  await until(companion, `(()=>{const video=document.querySelector(".companion-video.is-visible");return Boolean(video&&video.readyState>=2&&video.videoWidth>0)})()`);
  const name = `companion-${size}px`;
  await inspectCompanionFrame(name, size);
  await screenshot(companion, name);
  const alpha = await assertTransparentScreenshot(screenshots.at(-1), name);
  geometry.push({ name, requestedSize: size, native: nativeSnapshot, companionAlpha: alpha });
  return alpha;
}

async function verifyCompanionTransitions(size) {
  await companion.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  try {
    await until(companion, 'window.companion.getState().then(state=>state.mood==="idle"&&!state.message&&state.tasks.length===0)');
    await companion.evaluate('document.activeElement?.blur();true');
    await dispatchMouse(companion, "mouseMoved", -8, -8);
    await until(companion, `(()=>{
      const surface=document.querySelector(".companion-surface");
      return !surface.classList.contains("is-hovering")&&!surface.matches(":focus-within")&&
        [".companion-status",".companion-actions"].every(selector=>Number(getComputedStyle(document.querySelector(selector)).opacity)<0.01);
    })()`);
    const armSample = async () => companion.evaluate(`(()=>{
      const sample=window.__desktopSmokeTransition={observations:[],done:false};
      const started=performance.now();
      const frame=()=>{
        const rect=selector=>{
          const element=document.querySelector(selector);
          const box=element.getBoundingClientRect();
          const style=getComputedStyle(element);
          return {selector,left:box.left,top:box.top,right:box.right,bottom:box.bottom,opacity:Number(style.opacity),visibility:style.visibility};
        };
        sample.observations.push({at:performance.now()-started,width:innerWidth,height:innerHeight,status:rect(".companion-status"),actions:rect(".companion-actions")});
        if(performance.now()-started<650)requestAnimationFrame(frame);
        else sample.done=true;
      };
      requestAnimationFrame(frame);
      return true;
    })()`);
    const sample = async (phase) => {
      await sleep(65);
      await screenshot(companion, `companion-${size}-${phase}-transition`, { delay: 0 });
      await until(companion, 'window.__desktopSmokeTransition?.done===true');
      const observations = await companion.evaluate('window.__desktopSmokeTransition.observations');
      for (const current of observations) {
        for (const item of [current.status, current.actions]) {
          if (item.opacity <= 0.01 || item.visibility !== "visible") continue;
          assert.ok(item.left >= -1 && item.top >= -1 && item.right <= current.width + 1 && item.bottom <= current.height + 1,
            `Companion ${size}px ${phase} transition clipped a visible ${item.selector}: ${JSON.stringify(item)}`);
        }
      }
      for (const key of ["status", "actions"]) {
        assert.ok(observations.some((entry) => entry[key].opacity > 0.01 && entry[key].opacity < 0.99),
          `Companion ${size}px ${phase} did not sample a visible ${key} transition`);
      }
      geometry.push({ name: `companion-${size}-${phase}-transition`, observations });
    };

    const point = await companionStagePoint();
    await armSample();
    await dispatchMouse(companion, "mouseMoved", point.x, point.y);
    await until(companion, 'Boolean(document.querySelector(".companion-surface.is-hovering"))');
    await sample("enter");
    assert.equal(await companion.evaluate('document.querySelector(".companion-surface").matches(":focus-within")'), false,
      `Companion ${size}px exit transition fixture retained keyboard focus`);
    await armSample();
    await dispatchMouse(companion, "mouseMoved", -8, -8);
    await until(companion, '!document.querySelector(".companion-surface.is-hovering")');
    await sample("exit");
  } finally {
    await companion.send("Emulation.setEmulatedMedia", { features: [] });
  }
}

async function verifyCompanionFallbackGeometry() {
  let activeProbe = null;
  try {
    await companion.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
    const installed = await companion.evaluate(`(()=>{
      const video=document.querySelector(".companion-video.is-visible");
      if(!video)return false;
      window.__desktopSmokeOriginalVideoPlay=HTMLMediaElement.prototype.play;
      window.__desktopSmokeFallbackClasses=[];
      window.__desktopSmokeFallbackObserver=new MutationObserver(()=>{
        window.__desktopSmokeFallbackClasses.push({at:performance.now(),className:document.querySelector(".companion-surface")?.className});
      });
      window.__desktopSmokeFallbackObserver.observe(document.querySelector(".companion-surface"),{attributes:true,attributeFilter:["class"]});
      HTMLMediaElement.prototype.play=function(){return Promise.reject(new Error("Synthetic decoder failure"))};
      video.dispatchEvent(new Event("error"));
      return true;
    })()`);
    assert.equal(installed, true, "A live video was not available for the decoder-error fixture");
    await until(companion, '!document.querySelector(".companion-surface.has-motion")&&[...document.querySelectorAll(".companion-video")].every(video=>video.paused&&!video.getAttribute("src"))');
    const injectMood = async (mood) => {
      const state = await companion.evaluate("window.companion.getState()");
      state.mood = mood;
      state.message = null;
      state.tasks = [];
      state.manualSleeping = false;
      state.motionRequest = null;
      state.updatedAt = Date.now();
      await mainInspector.evaluate(`(()=>{
        const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
        const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("companion.html"));
        if(!window)throw new Error("Companion window is missing");
        window.webContents.send("companion:state",${JSON.stringify(state)});
        return true;
      })()`);
      await until(companion, `document.querySelector(".companion-surface")?.classList.contains(${JSON.stringify(`mood-${mood}`)})&&!document.querySelector(".companion-surface.has-motion")`);
    };
    const animations = {
      idle: "companion-breathe",
      thinking: "companion-think",
      working: "companion-work",
      waiting: "companion-wait",
      resting: "companion-rest",
      success: "companion-success",
      error: "companion-error",
    };
    for (const size of [96, 176, 320]) {
      await setRangeSetting("桌宠大小", size, `window.mingshen.getCompanionPreferences().then(value=>value.size===${size})`);
      await until(companion, `innerWidth===innerHeight&&Math.abs(innerWidth-${size})<=1`);
      await dispatchMouse(companion, "mouseMoved", -8, -8);
      await injectMood("idle");
      await until(companion, '!document.querySelector(".companion-surface.is-hovering")&&!document.querySelector(".companion-status.is-visible")');
      await mainInspector.evaluate(`(()=>{
        const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
        const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("companion.html"));
        window?.focus();
        return true;
      })()`);
      await until(companion, "document.hasFocus()");
      await companion.evaluate('document.body.tabIndex=-1;document.body.focus();true');
      await until(companion, 'document.activeElement===document.body');
      await until(companion, 'Number(getComputedStyle(document.querySelector(".companion-status")).opacity)<0.01');
      const pixels = await companion.evaluate(`(async()=>{
        const image=document.querySelector(".companion-character");
        await image.decode();
        const canvas=document.createElement("canvas");
        canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext("2d",{willReadFrequently:true});
        context.drawImage(image,0,0);
        const bytes=context.getImageData(0,0,canvas.width,canvas.height).data;
        let transparent=0,visible=0,nonBlack=0;
        for(let index=0;index<bytes.length;index+=4){
          if(bytes[index+3]<=8)transparent++;
          if(bytes[index+3]>=32){visible++;if(bytes[index]+bytes[index+1]+bytes[index+2]>12)nonBlack++}
        }
        return {width:canvas.width,height:canvas.height,transparent,visible,nonBlack};
      })()`);
      assert.ok(pixels.width > 0 && pixels.height > 0 && pixels.transparent > 0 && pixels.visible > 20 && pixels.nonBlack > 20,
        `Companion ${size}px fallback source has no useful transparent and visible pixels: ${JSON.stringify(pixels)}`);
      await screenshot(companion, `companion-${size}-fallback-idle`, { delay: 0 });
      const screenshotAlpha = await assertTransparentScreenshot(screenshots.at(-1), `companion-${size}-fallback-idle`);
      geometry.push({ name: `companion-${size}-fallback-idle`, sourcePixels: pixels, screenshotAlpha });
      await dispatchKey(companion, "keyDown", "Tab", "Tab", 9);
      await dispatchKey(companion, "keyUp", "Tab", "Tab", 9);
      await until(companion, 'document.querySelector(".companion-stage")?.matches(":focus-visible")');
      const focus = await companion.evaluate(`(()=>{
        const element=document.querySelector(".companion-stage");
        const box=element.getBoundingClientRect();
        const style=getComputedStyle(element);
        return {width:innerWidth,height:innerHeight,left:box.left,top:box.top,right:box.right,bottom:box.bottom,boxShadow:style.boxShadow,outline:style.outline,focusVisible:element.matches(":focus-visible")};
      })()`);
      assert.ok(focus.focusVisible && focus.boxShadow.includes("inset"), `Companion ${size}px lacks an inset keyboard-focus ring: ${JSON.stringify(focus)}`);
      assert.ok(focus.left >= -1 && focus.top >= -1 && focus.right <= focus.width + 1 && focus.bottom <= focus.height + 1,
        `Companion ${size}px keyboard focus target escaped its viewport: ${JSON.stringify(focus)}`);
      geometry.push({ name: `companion-${size}-fallback-focus`, ...focus });
      await screenshot(companion, `companion-${size}-fallback-focus`, { delay: 0 });

      await dispatchKey(companion, "keyDown", "Tab", "Tab", 9);
      await dispatchKey(companion, "keyUp", "Tab", "Tab", 9);
      await until(companion, 'document.querySelector(".companion-status")?.matches(":focus-visible")');
      await sleep(250);
      const focusedStatus = await companion.evaluate(`(()=>{
        const surface=document.querySelector(".companion-surface");
        const element=document.querySelector(".companion-status");
        const box=element.getBoundingClientRect();
        const style=getComputedStyle(element);
        return {width:innerWidth,height:innerHeight,left:box.left,top:box.top,right:box.right,bottom:box.bottom,opacity:Number(style.opacity),visibility:style.visibility,outlineStyle:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth),outlineColor:style.outlineColor,focusVisible:element.matches(":focus-visible"),hovering:surface.classList.contains("is-hovering"),showStatus:element.classList.contains("is-visible"),label:element.textContent};
      })()`);
      assert.ok(focusedStatus.focusVisible && !focusedStatus.hovering && !focusedStatus.showStatus,
        `Companion ${size}px status focus fixture was not idle and unhovered: ${JSON.stringify(focusedStatus)}`);
      assert.ok(focusedStatus.opacity > 0.99 && focusedStatus.visibility === "visible" && focusedStatus.outlineStyle !== "none" && focusedStatus.outlineWidth > 0,
        `Companion ${size}px focused status is not visibly indicated: ${JSON.stringify(focusedStatus)}`);
      assert.ok(focusedStatus.left >= -1 && focusedStatus.top >= -1 && focusedStatus.right <= focusedStatus.width + 1 && focusedStatus.bottom <= focusedStatus.height + 1,
        `Companion ${size}px focused status escaped its viewport: ${JSON.stringify(focusedStatus)}`);
      geometry.push({ name: `companion-${size}-idle-status-focus`, ...focusedStatus });
      await screenshot(companion, `companion-${size}-idle-status-focus`, { delay: 0 });
      const keyboardMenu = await captureCompanionMenu({ viaKeyboardStatus: true });
      assert.ok(menuItem(keyboardMenu, "interaction-rest"), `Companion ${size}px status Enter did not open the real menu`);
      await companion.evaluate('document.body.removeAttribute("tabindex");true');

      for (const [mood, animation] of Object.entries(animations)) {
        activeProbe = { size, mood, animation, fraction: null };
        await injectMood(mood);
        // Pause in the same renderer turn that finds the one-shot animation;
        // CDP round trips must not let its natural duration expire first.
        await until(companion, `(()=>{
          const animation=document.querySelector(".companion-figure")?.getAnimations().find(item=>item.animationName===${JSON.stringify(animation)});
          if(!animation)return false;
          animation.pause();
          window.__desktopSmokeFallbackAnimation=animation;
          return true;
        })()`);
        const samples = [];
        for (const fraction of [0, 0.25, 0.45, 0.5, 0.75, 0.99]) {
          activeProbe.fraction = fraction;
          const frame = await companion.evaluate(`(()=>{
            const figure=document.querySelector(".companion-figure");
            const image=document.querySelector(".companion-character");
            const animation=figure.getAnimations().find(item=>item.animationName===${JSON.stringify(animation)});
            if(!animation)throw new Error("Expected fallback animation is missing");
            if(animation!==window.__desktopSmokeFallbackAnimation)throw new Error("Sampled fallback animation was replaced");
            if(!document.querySelector(".companion-surface").classList.contains(${JSON.stringify(`mood-${mood}`)}))throw new Error("Synthetic fallback mood was replaced");
            animation.pause();
            const duration=Number(animation.effect.getTiming().duration);
            animation.currentTime=duration*${fraction};
            const box=image.getBoundingClientRect();
            const style=getComputedStyle(image);
            const ancestors=[];
            for(let node=image;node;node=node.parentElement){
              const css=getComputedStyle(node);
              ancestors.push({tag:node.tagName,className:node.className,display:css.display,visibility:css.visibility,opacity:Number(css.opacity)});
            }
            return {width:innerWidth,height:innerHeight,left:box.left,top:box.top,right:box.right,bottom:box.bottom,imageWidth:box.width,imageHeight:box.height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,visibility:style.visibility,opacity:style.opacity,ancestors,transform:getComputedStyle(figure).transform,fraction:${fraction}};
          })()`);
          assert.equal(frame.visibility, "visible", `Companion ${size}px ${mood} fallback image is hidden`);
          assert.ok(frame.imageWidth > 0 && frame.imageHeight > 0 && frame.naturalWidth > 0 && frame.naturalHeight > 0,
            `Companion ${size}px ${mood} fallback image is not decoded or has no size: ${JSON.stringify(frame)}`);
          assert.ok(frame.ancestors.every((node) => node.display !== "none" && node.visibility === "visible" && node.opacity > 0.01),
            `Companion ${size}px ${mood} fallback image has a hidden ancestor: ${JSON.stringify(frame)}`);
          assert.ok(frame.left >= -1 && frame.top >= -1 && frame.right <= frame.width + 1 && frame.bottom <= frame.height + 1,
            `Companion ${size}px ${mood} fallback image escaped at ${fraction}: ${JSON.stringify(frame)}`);
          samples.push(frame);
          if (mood === "success" && fraction === 0.45) await screenshot(companion, `companion-${size}-fallback-success-peak`, { delay: 0 });
        }
        assert.ok(new Set(samples.map((sample) => sample.transform)).size > 1, `Companion ${size}px ${mood} fallback animation did not move`);
        geometry.push({ name: `companion-${size}-fallback-${mood}`, samples });
      }
    }
  } catch (cause) {
    const snapshot = await companion.evaluate(`(async()=>({
      surface:document.querySelector(".companion-surface")?.className,
      animations:document.querySelector(".companion-figure")?.getAnimations().map(animation=>({name:animation.animationName,playState:animation.playState,currentTime:animation.currentTime,timing:animation.effect.getTiming()})),
      classes:window.__desktopSmokeFallbackClasses,
      controller:await window.companion.getState(),
    }))()`).catch((snapshotError) => ({ snapshotError: String(snapshotError) }));
    geometry.push({ name: "fallback-failure-diagnostic", probe: activeProbe, ...snapshot });
    throw cause;
  } finally {
    await companion.evaluate(`(()=>{
      if(window.__desktopSmokeOriginalVideoPlay)HTMLMediaElement.prototype.play=window.__desktopSmokeOriginalVideoPlay;
      delete window.__desktopSmokeOriginalVideoPlay;
      window.__desktopSmokeFallbackObserver?.disconnect();
      delete window.__desktopSmokeFallbackObserver;
      delete window.__desktopSmokeFallbackClasses;
      delete window.__desktopSmokeFallbackAnimation;
      return true;
    })()`).catch(() => undefined);
    await companion.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => undefined);
    await companion.send("Page.reload").catch(() => undefined);
  }
  await until(companion, 'Boolean(document.querySelector(".companion-surface"))');
  await until(companion, 'Boolean(document.querySelector(".companion-video.is-visible")?.videoWidth)', 20_000);
}

async function saveResult(success, cause) {
  await mkdir(evidence, { recursive: true });
  const path = join(evidence, success ? "result.json" : "failure.json");
  await writeFile(path, JSON.stringify({
    success,
    passed,
    screenshots,
    geometry,
    videoResults,
    fixtureRequests,
    exceptions,
    consoleErrors,
    failure: cause ? String(cause.stack || cause) : null,
    boundaries: [
      "Fresh temporary profile and isolated CDP ports were used.",
      "This smoke does not prove NSIS installation, DPI, GPU, Office COM, accessibility or a complete Windows matrix.",
      "Electron exposes no getter for the companion BrowserWindow's transparent, frameless or skip-taskbar creation options; those native options are not runtime-asserted here.",
      "Captured native menu callbacks are invoked programmatically; this is not an operating-system menu-click or screen-reader test.",
      "Fallback decoder errors and renderer moods are synthetic; six samples per animation do not establish every frame or filter-shadow boundary.",
      "No real model credentials, normal user profile, clipboard or project data were accessed; the task fixture uses loopback SSE and synthetic text only.",
    ],
  }, null, 2));
  return path;
}

async function setViewport(width, height) {
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  await sleep(160);
}

async function waitForWideOrbitLayout() {
  const started = Date.now();
  const observations = [];
  let ready = false;
  do {
    const snapshot = await renderer.evaluate(`(() => {
      const body = document.querySelector(".app-body");
      return {
        width: innerWidth,
        style: document.documentElement.dataset.interfaceStyle || null,
        bodyClass: body?.className || null,
        inspectorDrawer: body?.dataset.inspectorDrawer || null,
        sidebarDrawer: body?.dataset.sidebarDrawer || null,
      };
    })()`);
    observations.push({ elapsedMs: Date.now() - started, ...snapshot });
    ready = snapshot.width === 1440 && snapshot.style === "orbit" && snapshot.inspectorDrawer === "false";
    if (!ready) await sleep(50);
  } while (!ready && Date.now() - started < 5_000);
  geometry.push({ name: "orbit-wide-layout-readiness", ready, observations });
  assert.equal(ready, true, `Orbit wide layout did not leave drawer mode: ${JSON.stringify(observations)}`);
}

async function captureMainLayout(name, { expectedStyle = null } = {}) {
  const result = await renderer.evaluate(`(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element || element.hidden) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || box.width < 1 || box.height < 1) return null;
      return {
        selector,
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const regions = [
      ".desktop-shell",
      ".app-shell",
      ".app-topbar",
      ".app-body",
      ".sidebar-host",
      ".chat-sidebar-host",
      ".chat-view",
      ".composer-wrap",
      ".inspector-host",
      ".task-host",
      ".orbit-tool-rail",
      ".orbit-workspace-header",
      ".orbit-status-bar",
    ].map(rect).filter(Boolean);
    const pairs = [];
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const names = new Set([".sidebar-host", ".chat-sidebar-host", ".chat-view", ".composer-wrap", ".inspector-host", ".task-host"]);
    for (let index = 0; index < regions.length; index += 1) {
      for (let next = index + 1; next < regions.length; next += 1) {
        const a = regions[index];
        const b = regions[next];
        if (names.has(a.selector) && names.has(b.selector) && overlap(a, b)) pairs.push({ a, b });
      }
    }
    const controls = [...document.querySelectorAll(".app-topbar button, .surface-navigation button")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return !element.hidden && style.display !== "none" && style.visibility !== "hidden" && box.width > 1 && box.height > 1;
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          label: element.getAttribute("aria-label") || element.textContent?.trim() || "button",
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          clickable: Boolean(hit && (hit === element || element.contains(hit))),
        };
      });
    const computed = (element) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, colorScheme: style.colorScheme, opacity: style.opacity };
    };
    const titlebar = {
      rootText: getComputedStyle(document.documentElement).getPropertyValue("--text").trim(),
      rootColorScheme: getComputedStyle(document.documentElement).colorScheme,
      body: computed(document.body),
      shell: computed(document.querySelector(".desktop-shell")),
      caption: computed(document.querySelector(".desktop-caption")),
      actions: computed(document.querySelector(".desktop-caption__actions")),
      buttons: [...document.querySelectorAll(".desktop-caption__actions button")].map(element => ({
        label: element.getAttribute("aria-label") || element.getAttribute("title"),
        disabled: element.disabled,
        ...computed(element),
      })),
    };
    return {
      width: innerWidth,
      height: innerHeight,
      style: document.documentElement.dataset.interfaceStyle || null,
      theme: document.documentElement.dataset.theme || null,
      appBody: (() => {
        const element = document.querySelector(".app-body");
        return element ? { className: element.className, ...element.dataset } : null;
      })(),
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
      regions,
      pairs,
      controls,
      titlebar,
    };
  })()`);
  geometry.push({ name, ...result });
  assert.equal(result.documentOverflow, false, `${name}: document overflow`);
  if (expectedStyle) assert.equal(result.style, expectedStyle, `${name}: active interface style`);
  for (const region of result.regions) {
    assert.ok(region.left >= -1 && region.top >= -1 && region.right <= result.width + 1 && region.bottom <= result.height + 1,
      `${name}: ${region.selector} escaped viewport ${JSON.stringify(region)}`);
  }
  assert.deepEqual(result.pairs, [], `${name}: structural regions overlap ${JSON.stringify(result.pairs)}`);
  for (const control of result.controls) {
    assert.ok(control.left >= -1 && control.top >= -1 && control.right <= result.width + 1 && control.bottom <= result.height + 1,
      `${name}: control escaped viewport ${JSON.stringify(control)}`);
    assert.equal(control.clickable, true, `${name}: control is not hit-testable ${JSON.stringify(control)}`);
  }
  await screenshot(renderer, name);
}

async function inspectCompanionFrame(name, requestedSize = null) {
  const result = await companion.evaluate(`(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      let visible = box.width > 0 && box.height > 0;
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        if (ancestor.hidden || ancestorStyle.display === "none" || ancestorStyle.visibility !== "visible" || Number(ancestorStyle.opacity) === 0) {
          visible = false;
          break;
        }
      }
      return { selector, left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
        display: style.display, visibility: style.visibility, opacity: style.opacity, visible };
    };
    const image = document.querySelector(".companion-character");
    const video = document.querySelector(".companion-video.is-visible");
    const figure = document.querySelector(".companion-figure");
    const imageRect = image ? image.getBoundingClientRect() : null;
    const videoRect = video ? video.getBoundingClientRect() : null;
    const figureRect = figure ? figure.getBoundingClientRect() : null;
    return {
      width: innerWidth,
      height: innerHeight,
      imageLoaded: Boolean(image?.complete && image?.naturalWidth > 0 && image?.naturalHeight > 0),
      naturalImage: image ? { width: image.naturalWidth, height: image.naturalHeight } : null,
      videoReady: Boolean(video && video.readyState >= 2 && video.videoWidth > 0),
      motion: video?.dataset.motion ?? null,
      figureRect,
      imageRect,
      videoRect,
      elements: [".companion-surface", ".companion-stage", ".companion-figure", ".companion-video.is-visible", ".companion-status", ".companion-actions"].map(rect).filter(Boolean),
    };
  })()`);
  geometry.push({ name, companion: result });
  assert.equal(result.imageLoaded, true, `${name}: companion image is not loaded`);
  assert.equal(result.videoReady, true, `${name}: active companion video did not decode`);
  assert.equal(result.width, result.height, `${name}: companion viewport is not square`);
  assert.ok(result.width > 0 && result.height > 0, `${name}: companion viewport is empty`);
  if (requestedSize !== null) {
    // BrowserWindow bounds may round at a non-100% Windows scale, but the
    // renderer itself must remain a true square with no CSS stretch.
    assert.equal(result.width, result.height, `${name}: renderer viewport dimensions diverged`);
    assert.ok(Math.abs(result.width / result.height - 1) < 0.0001, `${name}: renderer CSS aspect ratio is not 1:1`);
  }
  for (const element of result.elements) {
    if (!element.visible) continue;
    assert.ok(element.left >= -1 && element.top >= -1 && element.right <= result.width + 1 && element.bottom <= result.height + 1,
      `${name}: companion ${element.selector} escaped viewport ${JSON.stringify(element)}`);
  }
}

async function assertTransparentScreenshot(path, name) {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  let visible = 0;
  let nonBlack = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3];
    const pixel = index / info.channels;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (alpha === 0) transparent += 1;
    else {
      visible += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (data[index] !== 0 || data[index + 1] !== 0 || data[index + 2] !== 0) nonBlack += 1;
    }
  }
  assert.ok(transparent > 0, `${name}: screenshot has no transparent pixels`);
  assert.ok(visible > 20, `${name}: screenshot has no meaningful visible pixels`);
  assert.ok(nonBlack > 20, `${name}: companion artwork is blank/black`);
  assert.ok(maxX >= minX && maxY >= minY && maxX - minX >= 8 && maxY - minY >= 8,
    `${name}: companion artwork bounds are too small`);
  return {
    width: info.width,
    height: info.height,
    transparent,
    visible,
    nonBlack,
    visibleBounds: { left: minX, top: minY, right: maxX, bottom: maxY },
  };
}

async function assertAnimationFrames(firstPath, secondPath, name, { expectedChanged = true, expectTransparent = true } = {}) {
  const { default: sharp } = await import("sharp");
  const first = await sharp(firstPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const second = await sharp(secondPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(first.info.width, second.info.width, `${name}: animation frame widths differ`);
  assert.equal(first.info.height, second.info.height, `${name}: animation frame heights differ`);
  let changed = 0;
  let alphaChanged = 0;
  let firstTransparent = 0;
  let secondTransparent = 0;
  for (let index = 0; index < first.data.length; index += 1) {
    if (first.data[index] !== second.data[index]) changed += 1;
    if ((index + 1) % 4 === 0) {
      if (first.data[index] === 0) firstTransparent += 1;
      if (second.data[index] === 0) secondTransparent += 1;
      if (first.data[index] !== second.data[index]) alphaChanged += 1;
    }
  }
  if (expectTransparent) assert.ok(firstTransparent > 0 && secondTransparent > 0, `${name}: animation screenshots lost transparent pixels`);
  if (expectedChanged) assert.ok(changed > 0, `${name}: two animation frames are pixel-identical`);
  else assert.equal(changed, 0, `${name}: reduced-motion animation still changed ${changed} RGBA values`);
  return { changed, alphaChanged, firstTransparent, secondTransparent };
}

try {
  await mkdir(evidence, { recursive: true });
  const fixturePort = await startFixtureServer();
  child = spawn(executable, ["--inspect=" + inspectPort, ".", `--remote-debugging-port=${debugPort}`], {
    cwd: desktop,
    env: environment,
    windowsHide: true,
    stdio: "ignore",
  });
  mainInspector = await connectMainInspector();
  await waitForTarget(debugPort, (item) => item.type === "page");
  startup = await connect(await waitForTarget(debugPort, (item) => item.type === "page" && /startup\.html/i.test(item.url)), "startup");
  await until(startup, 'Boolean(document.querySelector(".startup-presentation__mark"))');
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return electron.BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().includes("startup.html")&&w.isVisible())})()`);
  assert.equal(await startup.evaluate('document.querySelector(".startup-presentation__skip")?.textContent'), "跳过动画");
  const startupWindow = await mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const startup=electron.BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes("startup.html"));
    const display=electron.screen.getPrimaryDisplay();
    return startup?{bounds:startup.getBounds(),primary:display.bounds,workArea:display.workArea,scaleFactor:display.scaleFactor,visible:startup.isVisible(),top:startup.isAlwaysOnTop()}:null;
  })()`);
  assert.ok(startupWindow, "Startup presentation window was not available");
  const edges = (bounds) => [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height];
  assert.deepEqual({ x: startupWindow.bounds.x, y: startupWindow.bounds.y }, { x: startupWindow.primary.x, y: startupWindow.primary.y }, "Startup presentation origin must match the primary display");
  assert.ok(startupWindow.bounds.x + startupWindow.bounds.width >= startupWindow.primary.x + startupWindow.primary.width &&
    startupWindow.bounds.y + startupWindow.bounds.height >= startupWindow.primary.y + startupWindow.primary.height,
  "Startup presentation must cover the whole primary display, including the taskbar region");
  assert.ok(edges(startupWindow.bounds).every((edge, index) => Math.abs(edge - edges(startupWindow.primary)[index]) <= 1),
    `Startup presentation must cover the primary display to within one DIP of Windows scaling rounding: ${JSON.stringify(startupWindow)}`);
  assert.equal(startupWindow.top, true, "Startup presentation must be topmost");
  geometry.push({ name: "startup-native", ...startupWindow });
  await screenshot(startup, "startup-before-skip");
  await clickStartupSkip("first-launch");
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return !electron.BrowserWindow.getAllWindows().some(window=>window.webContents.getURL().includes("startup.html"))})()`);
  startup.close();
  startup = null;
  renderer = await connectMain();

  await until(renderer, 'Boolean(document.querySelector(".desktop-shell"))');
  const desktopState = await renderer.evaluate('window.mingshen.getDesktopState()');
  if (!desktopState.accepted) {
    await until(renderer, 'Boolean(document.querySelector(".policy-dialog"))');
    await until(renderer, `(()=>{
      const body=document.querySelector(".policy-dialog__body");
      return Boolean(body?.textContent?.trim()&&!body.querySelector('[role="status"], [role="alert"]'));
    })()`);
    await sleep(5_200);
    assert.equal(await renderer.evaluate('document.querySelectorAll(".policy-dialog input[type=checkbox]").length'), 3);
    await renderer.evaluate('document.querySelectorAll(".policy-dialog input[type=checkbox]").forEach(input=>input.click())');
    await clickText(renderer, ".policy-dialog", "同意并继续");
    await until(renderer, 'Boolean(document.querySelector(".policy-dialog__body"))');
    await clickText(renderer, ".policy-dialog", "开始使用");
  }
  // A fresh isolated profile has no model configured, so the renderer would
  // intentionally remain on the provider setup surface instead of rendering
  // the workspace we want to inspect. Install a local, never-called fixture
  // model, then reload through the real bootstrap path.
  await renderer.evaluate(`(async()=>{
    const state=await window.mingshen.bootstrap();
    if(state.providers.some(provider=>provider.models.length>0)) return false;
    const provider=await window.mingshen.createProvider({name:"Desktop layout fixture",baseUrl:"http://127.0.0.1:${fixturePort}/v1",protocol:"openai_responses",authMode:"bearer",apiKey:"layout-fixture",keyLabel:"Fixture",neverReveal:true});
    await window.mingshen.createModel({providerId:provider.id,modelId:"layout-fixture",contextWindow:128000,maxOutputTokens:4096,inputModalities:["text"],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:"disabled"});
    return true;
  })()`);
  await renderer.send("Page.reload");
  await until(renderer, 'Boolean(document.querySelector(".desktop-shell"))');
  await until(renderer, 'Boolean(document.querySelector(".app-shell"))');
  passed.push("Startup uses primary-display bounds and a topmost window; the real skip control closes it and the main workspace opens.");
  assert.equal(await renderer.evaluate('window.mingshen.getStartupAnimationEnabled()'), true);

  if (startupOnly) {
    const workspace = join(temporary, "STARTUP_FIXTURE_WORKSPACE");
    await mkdir(workspace, { recursive: true });
    await renderer.evaluate(`(async()=>{
      const provider=(await window.mingshen.bootstrap()).providers.find(item=>item.name==="Desktop layout fixture");
      await window.mingshen.createSession({providerId:provider.id,modelId:provider.models[0].id,title:"Startup fixture",workspacePath:${JSON.stringify(workspace)},reasoningLevel:null,permissionMode:"request_approval",agentMode:"code"});
    })()`);
    await quitOwnedElectron();
    await verifyNormalStartupAndIndexWarmup();
    for (const mode of ["normal", "skip", "disabled"]) await verifyInitialPolicyTiming(mode);
    await verifyStartupHardDeadline();
    await verifyLateStartupPresentation();
    assert.deepEqual(exceptions, []);
    assert.deepEqual(consoleErrors, []);
    console.log(JSON.stringify({ passed, screenshots, resultPath: await saveResult(true) }, null, 2));
  } else if (captureProbeOnly) {
    const minimized = await mainInspector.evaluate(`(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("index.html")&&!item.webContents.getURL().includes("surface=quick-chat"));
      if(!window)throw new Error("Main window is missing");
      window.minimize();
      return {visible:window.isVisible(),minimized:window.isMinimized(),focused:window.isFocused()};
    })()`);
    const responsive = await renderer.evaluate('Boolean(document.documentElement)');
    let minimizedCapture;
    try {
      await renderer.send("Page.captureScreenshot", { format: "png" }, 2_500);
      minimizedCapture = "completed";
    } catch (cause) {
      minimizedCapture = String(cause);
    }
    const restored = await mainInspector.evaluate(`(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("index.html")&&!item.webContents.getURL().includes("surface=quick-chat"));
      window?.restore();window?.showInactive();
      return {visible:window?.isVisible(),minimized:window?.isMinimized(),focused:window?.isFocused()};
    })()`);
    await screenshot(renderer, "capture-minimized-probe-restored", { delay: 0 });
    geometry.push({ name: "capture-minimized-probe", minimized, responsive, minimizedCapture, restored, restoredScreenshot: screenshots.at(-1) });
    passed.push("The isolated probe compared Runtime.evaluate and CDP screenshot behavior while the main native window was minimized, then restored it without activating it and captured a screenshot.");
    await quitOwnedElectron();
    assert.deepEqual(exceptions, []);
    assert.deepEqual(consoleErrors, []);
    console.log(JSON.stringify({ passed, screenshots, resultPath: await saveResult(true) }, null, 2));
  } else if (diagnosticsOnly) {
    await setViewport(1440, 900);
    await click(renderer, 'button[aria-label="打开设置"]');
    await until(renderer, 'Boolean(document.querySelector(".theme-gallery button.theme-card"))');
    await click(renderer, ".theme-gallery button.theme-card");
    await until(renderer, 'document.documentElement.dataset.theme==="day"');
    await closeSettings();
    await sleep(450);
    await captureMainLayout("diagnostic-day-settled", { expectedStyle: "simple" });
    await renderer.evaluate('window.mingshen.setCompanionPreferences({enabled:true,greetingEnabled:false})');
    companion = await connectCompanion();
    await until(companion, 'Boolean(document.querySelector(".companion-stage"))');
    const menu = await captureCompanionMenu();
    assert.ok(menuItem(menu, "interaction-rest"));
    await invokeCapturedMenu("interaction-rest");
    await until(companion, 'window.companion.getState().then(state=>state.manualSleeping&&state.mood==="sleeping")');
    await companion.evaluate(`(()=>{
      window.__desktopSmokeKeys=[];
      for(const type of ["keydown","keypress","keyup","click"])document.addEventListener(type,event=>window.__desktopSmokeKeys.push({type:event.type,key:event.key??null,code:event.code??null,target:event.target?.className??null,trusted:event.isTrusted,detail:event.detail,defaultPrevented:event.defaultPrevented}),true);
      return true;
    })()`);
    await companion.evaluate('document.querySelector(".companion-stage").focus();true');
    const diagnosticFocus = async (name) => ({
      name,
      native: await inspectWindows(),
      document: await companion.evaluate(`(async()=>({hasFocus:document.hasFocus(),active:document.activeElement?.outerHTML.slice(0,200),state:await window.companion.getState()}))()`),
    });
    geometry.push(await diagnosticFocus("before-unfocused-enter"));
    await dispatchKey(companion, "keyDown", "Enter", "Enter", 13);
    await dispatchKey(companion, "keyUp", "Enter", "Enter", 13);
    await sleep(500);
    const afterUnfocused = await diagnosticFocus("after-unfocused-enter");
    geometry.push(afterUnfocused);
    if (afterUnfocused.document.state.manualSleeping) {
      await mainInspector.evaluate(`(()=>{
        const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
        const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("companion.html"));
        window?.focus();
        return Boolean(window?.isFocused());
      })()`);
      await until(companion, 'document.hasFocus()');
      await companion.evaluate('document.querySelector(".companion-stage").focus();true');
      geometry.push(await diagnosticFocus("before-focused-enter"));
      await dispatchKey(companion, "keyDown", "Enter", "Enter", 13);
      await dispatchKey(companion, "keyUp", "Enter", "Enter", 13);
      await sleep(500);
      const afterFocused = await diagnosticFocus("after-focused-enter");
      geometry.push(afterFocused);
      if (afterFocused.document.state.manualSleeping) {
        await dispatchKey(companion, "keyDown", "Enter", "Enter", 13, { text: "\r", unmodifiedText: "\r" });
        await dispatchKey(companion, "keyUp", "Enter", "Enter", 13);
        await sleep(500);
        const afterText = await diagnosticFocus("after-focused-enter-with-text");
        geometry.push(afterText);
        if (afterText.document.state.manualSleeping) {
          await dispatchKey(companion, "keyDown", " ", "Space", 32, { text: " ", unmodifiedText: " " });
          await dispatchKey(companion, "keyUp", " ", "Space", 32);
          await sleep(500);
          geometry.push(await diagnosticFocus("after-focused-space"));
        }
      }
      geometry.push({ name: "diagnostic-key-events", events: await companion.evaluate("window.__desktopSmokeKeys") });
      assert.equal((await companion.evaluate("window.companion.getState()")).manualSleeping, false, "Focused keyboard input did not wake the sleeping companion");
    }
    passed.push("Old-build diagnostic recorded settled day titlebar computed styles and compared Enter before and after native companion focus.");
    companion.close();
    companion = null;
    await quitOwnedElectron();
    console.log(JSON.stringify({ passed, screenshots, resultPath: await saveResult(true) }, null, 2));
  } else if (quickOnly || mediaOnly) {
    await renderer.evaluate('window.mingshen.setCompanionPreferences({enabled:true,greetingEnabled:false})');
    companion = await connectCompanion();
    await until(companion, 'Boolean(document.querySelector(".companion-video.is-visible")?.videoWidth)', 20_000);
    await verifyCompiledCompanionVideos(mediaOnly ? {} : { limit: 1 });
    await screenshot(companion, mediaOnly ? "media-companion" : "quick-companion");
    passed.push(mediaOnly
      ? "Media-only smoke decoded all 36 manifest motions in the real companion renderer at three sample times, retaining transparent, visible nonblack and changing-frame assertions."
      : "Quick smoke decoded the first manifest motion at three sample times in the real companion renderer.");
    companion.close();
    companion = null;
    await quitOwnedElectron();
    assert.deepEqual(exceptions, []);
    assert.deepEqual(consoleErrors, []);
    console.log(JSON.stringify({ passed, screenshots, resultPath: await saveResult(true) }, null, 2));
  } else if (fallbackOnly) {
    await setViewport(1440, 900);
    await click(renderer, 'button[aria-label="打开设置"]');
    await until(renderer, 'Boolean(document.querySelector(".settings-workspace"))');
    await clickText(renderer, ".settings-nav", "桌面体验");
    await until(renderer, 'Boolean(document.querySelector(".desktop-experience-settings"))');
    await renderer.evaluate('window.mingshen.setCompanionPreferences({enabled:true,greetingEnabled:false,taskHintsEnabled:false})');
    companion = await connectCompanion();
    await until(companion, 'window.companion.getState().then(state=>state.mood==="idle")');
    await until(companion, 'Boolean(document.querySelector(".companion-video.is-visible")?.videoWidth)', 20_000);
    await verifyCompanionFallbackGeometry();
    passed.push("Focused fallback smoke exercised the real decoder-error release, keyboard/status/menu path and all seven CSS mood samples at 96, 176 and 320px.");
    companion.close();
    companion = null;
    await quitOwnedElectron();
    assert.deepEqual(exceptions, []);
    assert.deepEqual(consoleErrors, []);
    console.log(JSON.stringify({ passed, screenshots, resultPath: await saveResult(true) }, null, 2));
  } else {
  await setViewport(1440, 900);
  // Capture the first usable main surface before opening any modal settings.
  // This remains useful even when a later settings selector changes.
  await captureMainLayout("simple-default-1440x900", { expectedStyle: "simple" });
  await click(renderer, 'button[aria-label="打开设置"]');
  await until(renderer, 'Boolean(document.querySelector(".settings-workspace"))');
  await until(renderer, 'Boolean(document.querySelector(".theme-gallery button.theme-card"))');
  await click(renderer, ".theme-gallery button.theme-card");
  await until(renderer, 'document.documentElement.dataset.theme==="day"');
  await closeSettings();
  await captureMainLayout("simple-day-1440x900", { expectedStyle: "simple" });
  await click(renderer, 'button[aria-label="打开设置"]');
  await until(renderer, 'Boolean(document.querySelector(".settings-workspace"))');
  await click(renderer, ".theme-gallery button.theme-card:last-of-type");
  await until(renderer, 'document.documentElement.dataset.theme==="night"');
  await closeSettings();
  await captureMainLayout("simple-night-1440x900", { expectedStyle: "simple" });
  await setViewport(800, 600);
  await captureMainLayout("simple-night-800x600", { expectedStyle: "simple" });
  passed.push("Simple theme day/night at 1440x900 and compact 800x600 geometry are captured and checked for overflow, overlap, offscreen controls and hit testing.");

  await applyInterfaceStyle("orbit");
  await setViewport(1440, 900);
  await waitForWideOrbitLayout();
  await captureMainLayout("orbit-night-1440x900", { expectedStyle: "orbit" });
  passed.push("Orbit theme is applied through the real settings save/reload workflow and its 1440x900 main-window geometry is captured.");
  await applyInterfaceStyle("simple");
  await setViewport(1440, 900);

  await click(renderer, 'button[aria-label="打开设置"]');
  await until(renderer, 'Boolean(document.querySelector(".settings-workspace"))');
  await clickText(renderer, ".settings-nav", "桌面体验");
  await until(renderer, 'Boolean(document.querySelector(".desktop-experience-settings"))');
  await screenshot(renderer, "desktop-settings-default");
  const startupCheckbox = 'input[aria-label="开启启动动画"]';
  await until(renderer, `Boolean(document.querySelector(${JSON.stringify(startupCheckbox)}))`);
  if (await renderer.evaluate(`document.querySelector(${JSON.stringify(startupCheckbox)})?.checked`)) await click(renderer, startupCheckbox);
  await until(renderer, 'window.mingshen.getStartupAnimationEnabled().then(value=>value===false)');
  passed.push("Startup animation can be disabled from Desktop experience settings and the preference is persisted through the real IPC path.");

  const companionBefore = await renderer.evaluate('window.mingshen.getCompanionPreferences()');
  assert.equal(companionBefore.enabled, false);
  await setCompanionSetting("显示桌宠", true);
  await until(renderer, 'window.mingshen.getCompanionPreferences().then(value=>value.enabled===true)');
  companion = await connectCompanion();
  await until(companion, 'Boolean(document.querySelector(".companion-surface"))');
  assert.equal(await companion.evaluate('typeof window.companion'), "object");
  assert.equal(await companion.evaluate('typeof window.mingshen'), "undefined");
  assert.equal(await companion.evaluate('typeof require'), "undefined");
  await until(companion, 'Boolean(document.querySelector(".companion-video.is-visible")?.videoWidth)', 20_000);
  await until(companion, 'window.companion.getState().then(state=>state.mood==="idle")');
  await verifyPreferenceRetry();
  await verifyTitlePrivacySaveRetry();
  await until(companion, 'Boolean(document.querySelector(".companion-video.is-visible")?.videoWidth)', 20_000);
  await until(companion, 'window.companion.getState().then(state=>state.mood==="idle")');
  passed.push("An isolated IPC fixture rejects one save and one hide; the settings UI retains the pending patch through failed and successful visibility actions, then saves it on retry.");
  passed.push("When title privacy is pending or its first save fails, the visible warning agrees with the isolated SQLite value and companion state; retry persists the change and clears the warning.");
  await inspectCompanionFrame("companion-visible");
  await screenshot(companion, "companion-visible");
  await verifyCompiledCompanionVideos();
  passed.push("All 36 manifest clips were decoded in the Electron companion renderer at three sample times, with transparent and visible nonblack pixels and at least one changing sample pair per clip.");

  let menu = await captureCompanionMenu({ viaContextMenu: true });
  assert.ok(menuItem(menu, "quick-chat"), "Right-click did not produce the companion menu");
  assert.ok(menuItem(menu, "interaction-rest"), "Companion menu is missing rest interaction");
  assert.ok(menuItem(menu, "position-locked"), "Companion menu is missing position lock");
  assert.ok(menuItem(menu, "animation-enabled"), "Companion menu is missing animation toggle");
  assert.equal(menuItem(menu, "always-on-top")?.checked, true);
  await invokeCapturedMenu("always-on-top");
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("companion.html"))?.isAlwaysOnTop()===false})()`);
  menu = await captureCompanionMenu();
  assert.equal(menuItem(menu, "always-on-top")?.checked, false);
  await invokeCapturedMenu("always-on-top");
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes("companion.html"))?.isAlwaysOnTop()===true})()`);
  menu = await captureCompanionMenu();
  await invokeCapturedMenu("size-128");
  await until(companion, 'window.companion.getPreferences().then(value=>value.size===128)');
  menu = await captureCompanionMenu();
  await invokeCapturedMenu("size-176");
  await until(companion, 'window.companion.getPreferences().then(value=>value.size===176)');
  menu = await captureCompanionMenu();
  await invokeCapturedMenu("interaction-rest");
  await until(companion, 'window.companion.getState().then(state=>state.manualSleeping&&state.mood==="sleeping")');
  await screenshot(companion, "companion-sleeping");
  menu = await captureCompanionMenu();
  assert.match(menuItem(menu, "interaction-rest")?.label ?? "", /唤醒/);
  await mainInspector.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const window=electron.BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().includes("companion.html"));
    window?.focus();
    return Boolean(window?.isFocused());
  })()`);
  await until(companion, 'document.hasFocus()');
  await companion.evaluate('document.querySelector(".companion-stage")?.focus(); true');
  await dispatchKey(companion, "keyDown", "Enter", "Enter", 13, { text: "\r", unmodifiedText: "\r" });
  await dispatchKey(companion, "keyUp", "Enter", "Enter", 13);
  await until(companion, 'window.companion.getState().then(state=>!state.manualSleeping&&state.motionRequest?.action==="pat")');
  menu = await captureCompanionMenu();
  await invokeCapturedMenu("interaction-dance");
  await until(companion, 'window.companion.getState().then(state=>state.motionRequest?.action==="dance")');
  await until(companion, 'document.querySelector(".companion-video.is-visible")?.dataset.motion==="dance"', 20_000);
  await screenshot(companion, "companion-menu-dance");
  menu = await captureCompanionMenu();
  await invokeCapturedMenu("interaction-cancel");
  await until(companion, 'window.companion.getState().then(state=>state.motionRequest?.action==="cancel_interaction")');
  passed.push("A real right-click reaches the captured native menu; sleep, keyboard pat/wake, dance playback and cancellation invoke the real menu callbacks.");

  menu = await captureCompanionMenu();
  await invokeCapturedMenu("quick-chat");
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return electron.BrowserWindow.getAllWindows().some(w=>w.isVisible()&&w.webContents.getURL().includes("surface=quick-chat"))})()`);
  const quickChat = await renderer.evaluate('window.mingshen.getQuickChatState()');
  assert.equal(quickChat.session?.agentMode, "chat", "Companion quick chat did not create a ChatAgent session");
  await renderer.evaluate('window.mingshen.quickChatAction("hide")');
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return !electron.BrowserWindow.getAllWindows().some(w=>w.isVisible()&&w.webContents.getURL().includes("surface=quick-chat"))})()`);
  await companion.evaluate('window.companion.openQuickChat()');
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return electron.BrowserWindow.getAllWindows().some(w=>w.isVisible()&&w.webContents.getURL().includes("surface=quick-chat"))})()`);
  await renderer.evaluate('window.mingshen.quickChatAction("hide")');
  await until(mainInspector, `(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");return !electron.BrowserWindow.getAllWindows().some(w=>w.isVisible()&&w.webContents.getURL().includes("surface=quick-chat"))})()`);
  passed.push("The captured menu callback and trusted companion bridge both open the real ChatAgent quick-chat window.");

  await verifyRealTaskPrivacy();
  passed.push("A real idle action is interrupted by a task; its live session panel has updating status/time, three checked sizes, collapse/reopen, localization and a clickable route. Disabling titles removes them from IPC and visible content; prompts, output, paths and identifiers remain hidden in both modes.");
  passed.push("A simulated 240x280 work area in the real desktop process constrains the companion's IPC layout, native window and rendered task panel without changing its saved 320px size.");
  passed.push("A running loopback SSE task preserves an uncommitted rest-interval input, appears in the real native menu, routes to its session, and cannot be reopened through the companion bridge after completion.");
  passed.push("The task row receives unsaved-plan, real message-edit and project-memory-edit rejections without losing the drafts, and stays busy until a delayed navigation claim is accepted by the main process.");
  await verifyTransientPlaybackRecovery();
  passed.push("Delayed play probes checked immediate idle release on quiet mode and a real task, including stale promise resolution; one-time playback failures recovered after a new interaction or disabling and re-enabling animation.");

  await renderer.evaluate('window.mingshen.desktopAction("locale","en")');
  await until(companion, 'window.companion.getState().then(state=>state.locale==="en")');
  menu = await captureCompanionMenu();
  assert.equal(menuItem(menu, "open-main")?.label, "Open main window");
  await until(companion, 'document.querySelector(".companion-stage")?.getAttribute("aria-label")?.includes("Pat")');
  await screenshot(companion, "companion-english");
  await renderer.evaluate('window.mingshen.desktopAction("locale","zh-CN")');
  await until(companion, 'window.companion.getState().then(state=>state.locale==="zh")');
  menu = await captureCompanionMenu();
  assert.equal(menuItem(menu, "open-main")?.label, "打开主界面");
  await until(companion, 'document.querySelector(".companion-stage")?.getAttribute("aria-label")?.includes("轻拍")');
  passed.push("Companion renderer and captured native menu change between English and Chinese using the real locale setting.");

  await until(companion, 'window.companion.getState().then(state=>state.mood==="idle")');
  await until(companion, 'Boolean(document.querySelector(".companion-video.is-visible")?.videoWidth)', 20_000);
  await screenshot(companion, "companion-animation-normal-0");
  await sleep(650);
  await screenshot(companion, "companion-animation-normal-1");
  const normalAnimation = await assertAnimationFrames(
    screenshots.at(-2),
    screenshots.at(-1),
    "companion-animation-normal",
  );
  geometry.push({ name: "companion-animation-normal", ...normalAnimation });
  menu = await captureCompanionMenu();
  await invokeCapturedMenu("animation-enabled");
  await until(companion, 'window.companion.getState().then(state=>state.preferences.animationEnabled===false)');
  await until(companion, '[...document.querySelectorAll(".companion-video")].every(video=>video.paused&&!video.getAttribute("src"))');
  await screenshot(companion, "companion-animation-paused-0");
  await sleep(650);
  await screenshot(companion, "companion-animation-paused-1");
  geometry.push({ name: "companion-animation-paused", ...await assertAnimationFrames(screenshots.at(-2), screenshots.at(-1), "companion-animation-paused", { expectedChanged: false }) });
  menu = await captureCompanionMenu();
  await invokeCapturedMenu("animation-enabled");
  await until(companion, 'window.companion.getState().then(state=>state.preferences.animationEnabled===true)');
  await until(companion, 'Boolean(document.querySelector(".companion-video.is-visible")?.videoWidth)', 20_000);
  await companion.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await sleep(120);
  await screenshot(companion, "companion-animation-reduced-0");
  await sleep(650);
  await screenshot(companion, "companion-animation-reduced-1");
  const reducedAnimation = await assertAnimationFrames(
    screenshots.at(-2),
    screenshots.at(-1),
    "companion-animation-reduced",
    { expectedChanged: false },
  );
  geometry.push({ name: "companion-animation-reduced", ...reducedAnimation });
  await companion.send("Emulation.setEmulatedMedia", { features: [] });
  passed.push("Companion moving, explicitly paused and reduced-motion frames were compared; paused video slots release their sources.");

  await setCompanionSetting("桌宠窗口置顶", false);
  await setCompanionSetting("开启问候", false);
  await setCompanionSetting("开启任务提示", false);
  await verifyCompanionDrag();
  const movedPosition = (await inspectWindows()).companion.bounds;
  passed.push("Pointer threshold, movement, pre-existing lock and locking during a drag are exercised with a centered native window; a synthetic pointercancel prevents later movement.");
  await click(renderer, 'button[title="重置保存的位置"]');
  await until(renderer, `window.mingshen.getCompanionPreferences().then(value=>Boolean(value.position&&(${movedPosition ? `value.position.x!==${movedPosition.x}||value.position.y!==${movedPosition.y}` : "true"})))`);
  for (const size of [96, 176, 320]) {
    await inspectAndCaptureCompanionSize(size);
    await verifyCompanionTransitions(size);
  }
  passed.push("At 96, 176 and 320px, animation-frame samples of status and action controls during pointer-enter and pointer-exit remained inside the companion viewport.");
  await verifyCompanionFallbackGeometry();
  passed.push("A synthetic decoder failure revealed the static fallback; keyboard focus, status Enter, source pixels and six sampled times for seven synthetic moods were checked at 96, 176 and 320px, including the current 45% success keyframe.");
  await setRangeSetting("桌宠大小", 208, 'window.mingshen.getCompanionPreferences().then(value=>value.size===208)');
  await setRangeSetting("桌宠透明度", 70, 'window.mingshen.getCompanionPreferences().then(value=>value.opacity===0.7)');
  await screenshot(renderer, "desktop-settings-companion-configured");
  const companionWindow = await inspectWindows();
  assert.ok(companionWindow, "Companion BrowserWindow is missing");
  assert.ok(companionWindow.companion, "Companion BrowserWindow is missing from inspector snapshot");
  assert.equal(companionWindow.companion.visible, true);
  assert.equal(companionWindow.companion.opacity, 0.7);
  assert.equal(companionWindow.companion.alwaysOnTop, false);
  assert.ok(Math.abs(companionWindow.companion.bounds.width - 208) <= 1);
  assert.ok(Math.abs(companionWindow.companion.bounds.height - 208) <= 1);
  passed.push("Desktop companion state, topmost, opacity and size respond to settings; greeting, task hints and position reset are persisted through IPC. Native transparency, framelessness and taskbar behavior remain unverified because Electron exposes no corresponding getters.");

  await closeSettings();
  await verifyChatBulkManagement();
  passed.push("Chat bulk management was exercised in an isolated profile across folded groups, pinned and archived chats: cancel, mixed-state guards, archive/restore, one injected partial failure and retry, active-run rejection/stop, deletion and persisted reload.");
  await verifyChatCatalogFailureRecovery();
  passed.push("Active and archived ChatAgent catalogs rejected an injected failure on the second real page without committing partial rows; batch controls stayed safe and retry loaded every matching session once.");
  await verifyArchiveContextIsolation();
  passed.push("Pure archive and restore succeeded under a targeted SQLite context-query failure; a non-archive session update exercised the injected failure.");
  await verifyQuickChatBatchLifecycle();
  passed.push("Quick-chat new-session handoff and batch archiving locked editing while waiting for drafts; archive save failure and a quick-window revision conflict were resolved and retried, and deletion rejected a late save.");
  await verifyMainChatBatchDraftLifecycle();
  passed.push("Batch archiving waited for a main-window draft, locked the composer with a visible status, blocked failed saves and a genuine cross-window revision conflict, and preserved resolved drafts after retry.");
  companion.close();
  companion = null;
  await quitOwnedElectron();
  // A second launch proves that disabling the animation affects the next startup,
  // while the same temporary profile retains the companion settings.
  child = spawn(executable, ["--inspect=" + inspectPort, ".", `--remote-debugging-port=${debugPort}`], {
    cwd: desktop,
    env: environment,
    windowsHide: true,
    stdio: "ignore",
  });
  await sleep(1_200);
  const secondTargets = await targets(debugPort);
  assert.equal(secondTargets.some((item) => /startup\.html/i.test(item.url)), false);
  mainInspector = await connectMainInspector();
  renderer = await connectMain();
  await until(renderer, 'Boolean(document.querySelector(".app-shell"))');
  await sleep(300);
  assert.equal((await targets(debugPort)).some((item) => /startup\.html/i.test(item.url)), false);
  assert.equal(await renderer.evaluate('window.mingshen.getStartupAnimationEnabled()'), false);
  assert.equal((await renderer.evaluate('window.mingshen.getCompanionPreferences()')).size, 208);
  passed.push("A restart with the same isolated profile does not show the disabled startup surface and retains desktop companion preferences.");

  await renderer.evaluate('window.mingshen.setStartupAnimationEnabled(true)');
  assert.equal(await renderer.evaluate('window.mingshen.getStartupAnimationEnabled()'), true);
  const acceptedStartupState = await renderer.evaluate('window.mingshen.getDesktopState()');
  assert.equal(acceptedStartupState.accepted, true);
  assert.equal(acceptedStartupState.manualPending, false);
  await screenshot(renderer, "main-after-restart");
  await quitOwnedElectron();
  await verifyNormalStartupAndIndexWarmup();
  for (const mode of ["normal", "skip", "disabled"]) await verifyInitialPolicyTiming(mode);
  await verifyStartupHardDeadline();
  await verifyLateStartupPresentation();
  assert.deepEqual(exceptions, []);
  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({ passed, screenshots, resultPath: await saveResult(true) }, null, 2));
  }
} catch (cause) {
  failure = cause;
  finishFixtureResponses();
  const mainWindowState = await mainInspector?.evaluate(`(()=>{
    const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json");
    const {BrowserWindow}=require("electron");
    return {
      windows: BrowserWindow.getAllWindows().map(window=>({
        id:window.id,
        url:window.webContents.getURL(),
        visible:window.isVisible(),
        minimized:window.isMinimized(),
        focused:window.isFocused(),
        destroyed:window.isDestroyed(),
      })),
      policyEvents:globalThis.__desktopSmokePolicy?.events??null,
    };
  })()`).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
  if (mainWindowState) geometry.push({ name: "failure-native-window-state", ...mainWindowState });
  // Preserve the visible renderer state for quick diagnosis when a UI
  // selector or layout assertion fails after the main surface is available.
  await renderer?.evaluate('document.documentElement.dataset.smokeFailure="1"').catch(() => undefined);
  await screenshot(renderer, "failure-renderer").catch(() => undefined);
  await screenshot(companion, "failure-companion").catch(() => undefined);
  await renderer?.evaluate('window.mingshen.desktopAction("quit")').catch(() => undefined);
  await startup?.evaluate('window.startupPresentation.skip()').catch(() => undefined);
  await companion?.close();
  console.error(JSON.stringify({ passed, resultPath: await saveResult(false, cause) }, null, 2));
  throw cause;
} finally {
  finishFixtureResponses();
  startup?.close();
  renderer?.close();
  companion?.close();
  mainInspector?.close();
  if (child) {
    const ended = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((done) => child.once("exit", done));
    await Promise.race([ended, sleep(8_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((done) => execFile(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => done()));
      await Promise.race([ended, sleep(5_000)]);
    }
    assert.ok(child.exitCode !== null || child.signalCode !== null, "Owned Electron did not exit");
  }
  if (fixtureServer.listening) {
    fixtureServer.closeAllConnections();
    await new Promise((done) => fixtureServer.close(done));
  }
  const local = relative(resolve(tmpdir()), resolve(temporary));
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local) && local.startsWith("mingshen-desktop-experience-"), "Unsafe cleanup path");
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

