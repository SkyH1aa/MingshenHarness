import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const require = createRequire(import.meta.url);
const desktopRequire = createRequire(join(resolve("apps/desktop"), "package.json"));
const { scannedPdf } = require("./fixtures/document-fixtures.cjs");
const ExcelJS = desktopRequire("exceljs");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-runtime-governance-ui-"));
const profile = join(temporary, "profile");
const project = join(temporary, "project");
const disabledProgramFiles = join(temporary, "disabled-program-files");
const disabledSystemRoot = join(temporary, "disabled-system-root");
const evidence = resolve(".impeccable/review", `v137-runtime-governance-ui-${Date.now()}`);
const passed = [];
const skipped = [];
const errors = [];
const screenshots = [];
const layoutMeasurements = [];
const overflowDiagnostics = [];
const officeReceiptSnapshots = {
  pdf: null,
  xlsx: null,
  pdfError: null,
  xlsxError: null,
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let child;
let mainInspector;
let renderer;
let headlessStarted = false;
let activeRendererPort;
let failureDiagnostics = null;

async function freePort() {
  const server = createNetServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((done) => server.close(done));
  return port;
}

async function connectTarget(target, label, requestTimeoutMs = 30_000) {
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
  const rejectPending = (cause) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(cause);
    }
    pending.clear();
  };
  socket.addEventListener("close", () => rejectPending(new Error(`CDP target closed: ${label}`)));
  socket.addEventListener("error", () => rejectPending(new Error(`CDP socket failed: ${label}`)));
  const send = (method, params = {}) =>
    new Promise((done, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error(`CDP socket is not open: ${label}`));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${label} ${method}`));
      }, requestTimeoutMs);
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
          `Evaluation failed: ${label}`,
      );
    }
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

async function debuggerTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  assert.ok(response.ok, `Debugger target list failed on ${port}`);
  return await response.json();
}

async function waitForTarget(port, predicate, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const target = (await debuggerTargets(port)).find(predicate);
      if (target) return target;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Debugger target did not start on ${port}: ${String(lastError ?? "timeout")}`);
}

async function connectRenderer(port) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = (await debuggerTargets(port)).filter(
        (candidate) =>
          candidate.type === "page" &&
          candidate.webSocketDebuggerUrl &&
          /\/renderer\/index\.html(?:[?#]|$)/.test(candidate.url),
      );
      for (const target of targets) {
        const client = await connectTarget(target, "renderer", 8_000);
        let matched = false;
        try {
          const href = await client.evaluate("location.href");
          if (/\/renderer\/index\.html(?:[?#]|$)/.test(href)) {
            await client.send("Runtime.enable", {}, 8_000);
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
    await sleep(120);
  }
  throw new Error(`Cannot connect renderer: ${String(lastError ?? "timeout")}`);
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

async function clickText(text) {
  const target = `[...document.querySelectorAll("button")].find(node=>!node.disabled&&node.textContent.trim()===${JSON.stringify(text)})`;
  await until(renderer, `Boolean(${target})`);
  await renderer.evaluate(`${target}.click();true`);
}

async function completeFirstRun() {
  await until(
    renderer,
    'Boolean(document.querySelector(".policy-consents, .app-shell, .setup-shell"))',
    60_000,
  );
  if (await renderer.evaluate('Boolean(document.querySelector(".policy-consents"))')) {
    await renderer.evaluate(
      'document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true',
    );
    for (const text of ["\u540c\u610f\u5e76\u7ee7\u7eed", "\u5f00\u59cb\u4f7f\u7528"]) {
      await clickText(text);
    }
    await until(renderer, '!document.querySelector(".policy-dialog")');
  }
  await until(
    renderer,
    'Boolean(document.querySelector(".app-shell, .setup-shell"))',
    60_000,
  );
}

async function capture(name, width, height) {
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(220);
  const layout = await renderer.evaluate(`(()=>{
    const selectors=[".settings-workspace",".settings-content",".runtime-governance",".office-delivery-panel"];
    const rectOf=node=>{
      if(!node)return null;
      const rect=node.getBoundingClientRect();
      return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};
    };
    const intersects=(left,right)=>
      Boolean(left&&right&&Math.min(left.right,right.right)-Math.max(left.left,right.left)>1&&
        Math.min(left.bottom,right.bottom)-Math.max(left.top,right.top)>1);
    const caption=rectOf(document.querySelector(".desktop-caption"));
    const captionWorkspace=rectOf(document.querySelector(".desktop-caption__workspace"));
    const captionActions=rectOf(document.querySelector(".desktop-caption__actions"));
    const toolbarNode=document.querySelector(".desktop-caption .app-topbar");
    const toolbarRect=rectOf(toolbarNode);
    const initialToolbarScrollLeft=toolbarNode?.scrollLeft??0;
    const probeControl=node=>{
      if(!toolbarNode||!toolbarRect)return null;
      const initialRect=rectOf(node);
      if(initialRect&&(initialRect.left<toolbarRect.left-1||initialRect.right>toolbarRect.right+1)){
        const target=Math.max(
          0,
          Math.min(
            toolbarNode.scrollWidth-toolbarNode.clientWidth,
            toolbarNode.scrollLeft+initialRect.left-toolbarRect.left-
              Math.max(0,(toolbarNode.clientWidth-initialRect.width)/2)
          )
        );
        toolbarNode.scrollLeft=target;
      }
      const rect=rectOf(node);
      const point=rect
        ? document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)
        : null;
      return {
        label:(node.getAttribute("aria-label")||node.getAttribute("title")||node.textContent||"")
          .trim().replace(/\\s+/g," ").slice(0,120),
        rect,
        visibleInToolbar:Boolean(
          rect&&toolbarRect&&
          rect.left>=toolbarRect.left-1&&
          rect.right<=toolbarRect.right+1&&
          rect.top>=toolbarRect.top-1&&
          rect.bottom<=toolbarRect.bottom+1
        ),
        hitTest:Boolean(point&&(point===node||node.contains(point))),
        hitTag:point?point.tagName.toLowerCase():null,
        disabled:node.disabled===true,
        overlapsCaptionActions:intersects(rect,captionActions)
      };
    };
    const appToolbarControls=[...(toolbarNode?.querySelectorAll("button,select,[role=button]")??[])]
      .map(probeControl).filter(Boolean);
    if(toolbarNode)toolbarNode.scrollLeft=initialToolbarScrollLeft;
    const captionActionControls=[...(document.querySelectorAll(".desktop-caption__actions button")??[])]
      .map(node=>{
        const rect=rectOf(node);
        const point=rect
          ? document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)
          : null;
        return {
          label:(node.getAttribute("aria-label")||node.getAttribute("title")||node.textContent||"")
            .trim().replace(/\\s+/g," ").slice(0,120),
          rect,
          hitTest:Boolean(point&&(point===node||node.contains(point))),
          hitTag:point?point.tagName.toLowerCase():null,
          disabled:node.disabled===true
        };
      });
    const captionChrome={
      caption,
      workspace:captionWorkspace,
      actions:captionActions,
      toolbar:{
        rect:toolbarRect,
        clientWidth:toolbarNode?.clientWidth??null,
        scrollWidth:toolbarNode?.scrollWidth??null,
        initialScrollLeft:initialToolbarScrollLeft,
        maxScrollLeft:toolbarNode?Math.max(0,toolbarNode.scrollWidth-toolbarNode.clientWidth):null
      },
      workspaceActionsOverlap:intersects(captionWorkspace,captionActions),
      appToolbarControls,
      captionActionControls
    };
    const boxes=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(node=>{
      return {selector,...rectOf(node)};
    })).filter(box=>box.width>0&&box.height>0);
    const overflowElements=[...document.querySelectorAll("body *")].map(node=>{
      const rect=node.getBoundingClientRect();
      return {
        tag:node.tagName.toLowerCase(),
        id:node.id||null,
        className:typeof node.className==="string"?node.className:null,
        left:rect.left,
        right:rect.right,
        width:rect.width,
        scrollWidth:node.scrollWidth,
        clientWidth:node.clientWidth,
        text:(node.textContent||"").trim().slice(0,160)
      };
    }).filter(item=>item.right>innerWidth+2||item.left<-2)
      .sort((left,right)=>right.right-left.right)
      .slice(0,40);
    return {
      viewport:{width:innerWidth,height:innerHeight},
      overflowX:document.documentElement.scrollWidth>innerWidth+2,
      document:{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth},
      body:{clientWidth:document.body.clientWidth,scrollWidth:document.body.scrollWidth},
      overflowElements,
      captionChrome,
      boxes,
      text:document.body.innerText
    };
  })()`);
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
  layoutMeasurements.push({
    name,
    width,
    height,
    overflowX: layout.overflowX,
    captionChrome: layout.captionChrome,
    boxes: layout.boxes,
  });
  if (layout.overflowX) {
    overflowDiagnostics.push({
      name,
      width,
      height,
      viewport: layout.viewport,
      document: layout.document,
      body: layout.body,
      overflowElements: layout.overflowElements,
    });
  }
  assert.equal(layout.overflowX, false, `Horizontal overflow in ${name}`);
  assert.ok(layout.captionChrome?.workspace, `Missing caption workspace geometry in ${name}`);
  assert.ok(layout.captionChrome?.actions, `Missing caption actions geometry in ${name}`);
  assert.equal(
    layout.captionChrome.workspaceActionsOverlap,
    false,
    `Caption workspace overlaps native window actions in ${name}`,
  );
  assert.ok(
    layout.captionChrome.workspace.right <= layout.captionChrome.actions.left + 2,
    `Caption workspace crosses native window actions in ${name}: ${layout.captionChrome.workspace.right} > ${layout.captionChrome.actions.left}`,
  );
  assert.ok(
    layout.captionChrome.appToolbarControls.length > 0,
    `No application toolbar controls were measured in ${name}`,
  );
  for (const control of layout.captionChrome.appToolbarControls) {
    assert.equal(
      control.overlapsCaptionActions,
      false,
      `Toolbar control ${control.label} overlaps native window actions in ${name}`,
    );
    assert.equal(
      control.visibleInToolbar,
      true,
      `Toolbar control ${control.label} cannot be scrolled fully into view in ${name}`,
    );
    assert.equal(
      control.hitTest,
      true,
      `Toolbar control ${control.label} is not hit-testable after scrolling in ${name}`,
    );
  }
  for (const control of layout.captionChrome.captionActionControls) {
    assert.equal(
      control.hitTest,
      true,
      `Native caption action ${control.label} is not hit-testable in ${name}`,
    );
  }
  for (const box of layout.boxes) {
    assert.ok(box.left >= -2, `${box.selector} left overflow in ${name}: ${box.left}`);
    assert.ok(
      box.right <= width + 2,
      `${box.selector} right overflow in ${name}: ${box.right} > ${width}`,
    );
  }
  return layout;
}

async function captureFailureDiagnostics() {
  if (!renderer) return null;
  const viewport = await renderer.evaluate(
    "({width:innerWidth,height:innerHeight,scrollX,scrollY,activeElement:document.activeElement?.tagName??null})",
  );
  const dom = await renderer.evaluate(`(()=>{
    const rectOf=node=>{
      if(!node)return null;
      const rect=node.getBoundingClientRect();
      return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height};
    };
    const taskWorkbenches=[...document.querySelectorAll(".task-workbench")].map(node=>({
      sessionId:node.getAttribute("data-task-session"),
      docked:node.getAttribute("data-task-docked"),
      collapsed:node.getAttribute("data-task-collapsed"),
      text:(node.innerText||"").trim().slice(0,4000),
      rect:rectOf(node),
      toggle:{
        present:Boolean(node.querySelector(":scope > .task-workbench__header > button.task-workbench__toggle")),
        expanded:node.querySelector(":scope > .task-workbench__header > button.task-workbench__toggle")?.getAttribute("aria-expanded")??null
      },
      bodyPresent:Boolean(node.querySelector(":scope > .task-workbench__body")),
      receiptIds:[...node.querySelectorAll(".office-delivery-panel [data-office-delivery-id]")]
        .map(item=>item.getAttribute("data-office-delivery-id"))
    }));
    const officePanels=[...document.querySelectorAll(".office-delivery-panel")].map(node=>({
      rect:rectOf(node),
      receiptIds:[...node.querySelectorAll("[data-office-delivery-id]")]
        .map(item=>item.getAttribute("data-office-delivery-id")),
      text:(node.innerText||"").trim().slice(0,4000),
      hiddenAncestor:Boolean(node.closest("[hidden]")),
      display:getComputedStyle(node).display,
      visibility:getComputedStyle(node).visibility
    }));
    return {
      href:location.href,
      settingsOpen:Boolean(document.querySelector(".settings-workspace")),
      selectedSessionIds:[
        ...document.querySelectorAll(".session-row--selected, .chat-session-row--selected")
      ].map(node=>node.closest("[data-session-id]")?.getAttribute("data-session-id")??node.getAttribute("data-session-id")),
      taskHosts:[...document.querySelectorAll(".task-host")].map(node=>({
        hidden:node.hidden,
        className:node.className,
        rect:rectOf(node)
      })),
      taskWorkbenches,
      officePanels,
      iframeCount:document.querySelectorAll("iframe").length,
      bodyText:(document.body.innerText||"").slice(0,16000)
    };
  })()`);
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const screenshotPath = join(evidence, "failure-current-ui.png");
  await writeFile(screenshotPath, Buffer.from(image.data, "base64"));
  screenshots.push(screenshotPath);
  return { viewport, dom, screenshotPath };
}

async function launch() {
  const inspectPort = await freePort();
  let rendererPort = await freePort();
  while (rendererPort === inspectPort) rendererPort = await freePort();
  const isolatedPath = (process.env.PATH ?? process.env.Path ?? "")
    .split(delimiter)
    .filter((entry) => entry && !/(libreoffice|soffice)/i.test(entry))
    .join(delimiter);
  const environment = {
    ...process.env,
    MSH_EXPERIMENTAL: "1",
    MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: "1",
    MSH_NOTIFICATION_FIXTURE: "1",
  };
  for (const key of Object.keys(environment)) {
    if (["path", "programfiles", "programfiles(x86)"].includes(key.toLowerCase()))
      delete environment[key];
  }
  environment.PATH = isolatedPath;
  environment.ProgramFiles = disabledProgramFiles;
  environment["ProgramFiles(x86)"] = disabledProgramFiles;
  delete environment.ELECTRON_RUN_AS_NODE;
  execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], {
    windowsHide: true,
    stdio: "pipe",
  });
  child = spawn(
    experimentalExecutable(),
    [
      `--inspect=${inspectPort}`,
      ".",
      `--remote-debugging-port=${rendererPort}`,
    ],
    {
      cwd: resolve("apps/desktop"),
      env: environment,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  const inspectorTarget = await waitForTarget(
    inspectPort,
    (candidate) => Boolean(candidate.webSocketDebuggerUrl),
    60_000,
  );
  mainInspector = await connectTarget(inspectorTarget, "main-process");
  await mainInspector.evaluate(
    'globalThis.__governanceFetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__governanceFetch(url,options);true',
  );
  renderer = await connectRenderer(rendererPort);
  await completeFirstRun();
  activeRendererPort = rendererPort;
  return { inspectPort, rendererPort };
}

async function openRuntimeGovernance() {
  const opened = await renderer.evaluate(`(()=>{
    const target=[...document.querySelectorAll("button")].find(node=>
      node.getAttribute("aria-label")==="\u6253\u5f00\u8bbe\u7f6e"||
      node.getAttribute("title")==="\u8bbe\u7f6e"||
      /open settings/i.test(node.getAttribute("aria-label")||"")||
      /^settings$/i.test(node.getAttribute("title")||"")||
      node.matches('[data-orbit-action="settings"]')
    );
    if(!target)return false;
    target.click();
    return true;
  })()`);
  assert.equal(opened, true, "Settings entry is missing");
  await until(renderer, 'Boolean(document.querySelector(".settings-workspace"))');
  await clickText("\u8fd0\u884c\u4e0e\u96c6\u6210");
  await until(
    renderer,
    'Boolean(document.querySelector("#runtime-policy-heading")&&document.querySelector("#watchdog-heading")&&document.querySelector("#office-delivery-heading"))',
    60_000,
  );
}

async function closeSettings() {
  await renderer.evaluate(
    'document.querySelector(".settings-content__header button[aria-label=\\"\\u5173\\u95ed\\u8bbe\\u7f6e\\"]")?.click();true',
  );
  await until(renderer, '!document.querySelector(".settings-workspace")');
}

async function reloadRenderer() {
  await renderer.send("Page.reload").catch(() => undefined);
  renderer.close();
  renderer = await connectRenderer(activeRendererPort);
  await until(renderer, 'Boolean(document.querySelector(".app-shell"))', 60_000);
}

async function requestJson(baseUrl, token, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${pathname} failed (${response.status}): ${text}`);
  }
  return body;
}

async function createFormulaWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mingshen Harness governance fixture";
  workbook.created = new Date("2026-11-27T00:00:00.000Z");
  workbook.modified = workbook.created;
  const sheet = workbook.addWorksheet("FormulaCoverage");
  sheet.columns = [
    { key: "case", width: 24 },
    { key: "value", width: 18 },
  ];
  sheet.getCell("A1").value = "Case";
  sheet.getCell("B1").value = "Value";
  sheet.getCell("A2").value = "Cached formula";
  sheet.getCell("B2").value = { formula: "SUM(2,3)", result: 5 };
  sheet.getCell("A3").value = "Uncached formula";
  sheet.getCell("B3").value = { formula: "SUM(B2,4)" };
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function forceOfficePowerShellLaunchFailure() {
  await mainInspector.evaluate(`(()=>{
    globalThis.__governanceOriginalSystemRoot=process.env.SystemRoot;
    process.env.SystemRoot=${JSON.stringify(disabledSystemRoot)};
    return process.env.SystemRoot;
  })()`);
}

async function restoreOfficePowerShellEnvironment() {
  await mainInspector.evaluate(`(()=>{
    if(typeof globalThis.__governanceOriginalSystemRoot==="string")
      process.env.SystemRoot=globalThis.__governanceOriginalSystemRoot;
    else delete process.env.SystemRoot;
    delete globalThis.__governanceOriginalSystemRoot;
    return true;
  })()`);
}

async function expandOfficeReceipt(deliveryId) {
  await until(
    renderer,
    `Boolean(document.querySelector('.office-delivery-panel [data-office-delivery-id="${deliveryId}"] .office-delivery-panel__identity'))`,
    60_000,
  );
  await renderer.evaluate(`(()=>{
    const item=document.querySelector('.office-delivery-panel [data-office-delivery-id="${deliveryId}"]');
    const button=item?.querySelector(".office-delivery-panel__identity");
    if(!button)return false;
    if(button.getAttribute("aria-expanded")!=="true")button.click();
    return true;
  })()`);
  await until(
    renderer,
    `Boolean(document.querySelector('.office-delivery-panel [data-office-delivery-id="${deliveryId}"] .office-delivery-panel__details'))`,
  );
}

async function scrollToFormulaCoverage(deliveryId) {
  const found = await renderer.evaluate(`(()=>{
    const item=document.querySelector('.office-delivery-panel [data-office-delivery-id="${deliveryId}"]');
    const group=[...(item?.querySelectorAll(".office-delivery-panel__detail-group")??[])]
      .find(node=>node.querySelector("strong")?.textContent.includes("公式检查覆盖"));
    if(!group)return false;
    const scroller=group.closest(".task-workbench__body");
    if(!scroller)return false;
    const groupRect=group.getBoundingClientRect();
    const scrollerRect=scroller.getBoundingClientRect();
    scroller.scrollTop=Math.max(0,scroller.scrollTop+groupRect.top-scrollerRect.top-8);
    return true;
  })()`);
  assert.equal(found, true, "XLSX formula coverage section is missing");
  await sleep(180);
}

async function formulaCoveragePanel(deliveryId) {
  const value = await renderer.evaluate(`(()=>{
    const item=document.querySelector('.office-delivery-panel [data-office-delivery-id="${deliveryId}"]');
    const group=[...(item?.querySelectorAll(".office-delivery-panel__detail-group")??[])]
      .find(node=>node.querySelector("strong")?.textContent.includes("公式检查覆盖"));
    if(!group)return null;
    const rect=group.getBoundingClientRect();
    const scroller=group.closest(".task-workbench__body");
    if(!scroller)return null;
    const scrollerRect=scroller.getBoundingClientRect();
    const visible={
      left:Math.max(0,rect.left,scrollerRect.left),
      right:Math.min(innerWidth,rect.right,scrollerRect.right),
      top:Math.max(0,rect.top,scrollerRect.top),
      bottom:Math.min(innerHeight,rect.bottom,scrollerRect.bottom)
    };
    visible.width=Math.max(0,visible.right-visible.left);
    visible.height=Math.max(0,visible.bottom-visible.top);
    const point=visible.width>0&&visible.height>0
      ? document.elementFromPoint(visible.left+visible.width/2,visible.top+Math.min(visible.height/2,24))
      : null;
    return {
      text:group.innerText,
      rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},
      visible,
      hitTest:Boolean(point&&(point===group||group.contains(point))),
      hitTag:point?.tagName.toLowerCase()??null,
      hitClass:typeof point?.className==="string"?point.className:null,
      hitText:(point?.textContent||"").trim().replace(/\\s+/g," ").slice(0,160),
      viewport:{width:innerWidth,height:innerHeight},
      metadata:[...group.querySelectorAll(".office-delivery-panel__metadata > div")].map(node=>({
        label:node.querySelector("dt")?.textContent?.trim()??"",
        value:node.querySelector("dd")?.textContent?.trim()??""
      }))
    };
  })()`);
  assert.ok(value, "XLSX formula coverage section is unavailable");
  assert.ok(value.rect.width > 0 && value.rect.height > 0, "XLSX formula coverage is not visible");
  assert.ok(value.rect.left >= -2, "XLSX formula coverage overflows left");
  assert.ok(
    value.rect.right <= value.viewport.width + 2,
    `XLSX formula coverage overflows right: ${value.rect.right} > ${value.viewport.width}`,
  );
  assert.ok(
    value.visible.width > 0 && value.visible.height >= 80,
    `XLSX formula coverage has insufficient visible area: ${JSON.stringify(value.visible)}`,
  );
  assert.equal(
    value.hitTest,
    true,
    `XLSX formula coverage is covered by another surface: ${JSON.stringify(value)}`,
  );
  return value;
}

async function selectSession(sessionId) {
  const selected = await renderer.evaluate(`(()=>{
    const id=${JSON.stringify(sessionId)};
    const direct=[...document.querySelectorAll("[data-session-id]")]
      .find(node=>node.dataset.sessionId===id);
    const button=direct?.querySelector(".session-row, .chat-session-row__main, button")
      ??[...document.querySelectorAll(".session-row, .chat-session-row__main")]
        .find(node=>node.closest("[data-session-id]")?.dataset.sessionId===id);
    if(!button)return false;
    button.click();
    return true;
  })()`);
  assert.equal(selected, true, "Created Office fixture session is not visible in the sidebar");
  await until(
    renderer,
    `document.querySelector(".session-row--selected")?.closest("[data-session-id]")?.dataset.sessionId===${JSON.stringify(sessionId)}||document.querySelector(".chat-session-row--selected")?.dataset.sessionId===${JSON.stringify(sessionId)}`,
    60_000,
  );
}

async function openTaskWorkbench(sessionId) {
  const selector = `.task-workbench[data-task-session=${JSON.stringify(sessionId)}]`;
  await until(renderer, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, 60_000);
  const state = await renderer.evaluate(`(()=>{
    const root=document.querySelector(${JSON.stringify(selector)});
    if(!root)return {rootFound:false};
    const toggle=root.querySelector(":scope > .task-workbench__header > button.task-workbench__toggle");
    const bodyBefore=Boolean(root.querySelector(":scope > .task-workbench__body"));
    const expandedBefore=toggle?.getAttribute("aria-expanded")??null;
    if(toggle&&expandedBefore!=="true")toggle.click();
    return {
      rootFound:true,
      toggleFound:Boolean(toggle),
      expandedBefore,
      bodyBefore
    };
  })()`);
  assert.equal(state.rootFound, true, "Office fixture task workbench is missing");
  assert.ok(
    state.bodyBefore || state.toggleFound,
    "Office fixture task workbench has neither an expanded body nor an expand control",
  );
}

async function dismissResponsiveDrawers() {
  const actions = await renderer.evaluate(`(()=>{
    const buttons=[...document.querySelectorAll("button")];
    const appBody=document.querySelector(".app-body");
    const sidebar=buttons.find(node=>
      node.getAttribute("aria-label")==="\\u6536\\u8d77\\u4f1a\\u8bdd\\u680f"
    );
    const inspector=buttons.find(node=>
      node.getAttribute("aria-label")==="\\u5173\\u95ed\\u9762\\u677f"&&
      node.getAttribute("aria-expanded")==="true"
    )??(
      appBody?.classList.contains("app-body--workspace")
        ? buttons.find(node=>
            node.getAttribute("aria-label")==="\\u6253\\u5f00\\u5de5\\u4f5c\\u533a"&&
            node.getAttribute("title")==="\\u5de5\\u4f5c\\u533a"
          )
        : null
    );
    sidebar?.click();
    inspector?.click();
    return {sidebar:Boolean(sidebar),inspector:Boolean(inspector)};
  })()`);
  await until(
    renderer,
    `(()=>{
      const sidebar=document.querySelector(".sidebar-host");
      const scrim=document.querySelector(".workbench-drawer-scrim");
      return (!sidebar||sidebar.hidden)&&!scrim;
    })()`,
    10_000,
  );
  return actions;
}

async function scrollTaskTargetToStart(selector) {
  const result = await renderer.evaluate(`(()=>{
    const target=document.querySelector(${JSON.stringify(selector)});
    const scroller=target?.closest(".task-workbench__body");
    if(!target||!scroller)return {targetFound:Boolean(target),scrollerFound:Boolean(scroller)};
    const targetRect=target.getBoundingClientRect();
    const scrollerRect=scroller.getBoundingClientRect();
    scroller.scrollTop=Math.max(0,scroller.scrollTop+targetRect.top-scrollerRect.top-8);
    return {
      targetFound:true,
      scrollerFound:true,
      scrollTop:scroller.scrollTop,
      scrollHeight:scroller.scrollHeight,
      clientHeight:scroller.clientHeight
    };
  })()`);
  assert.equal(result.targetFound, true, `Missing scroll target: ${selector}`);
  assert.equal(result.scrollerFound, true, `Missing task workbench scroller for: ${selector}`);
  await sleep(180);
  return result;
}

async function assertTaskTargetVisible(selector, label, minVisibleHeight = 24) {
  const result = await renderer.evaluate(`(()=>{
    const target=document.querySelector(${JSON.stringify(selector)});
    if(!target)return {found:false};
    const rect=target.getBoundingClientRect();
    let visible={
      left:Math.max(0,rect.left),
      right:Math.min(innerWidth,rect.right),
      top:Math.max(0,rect.top),
      bottom:Math.min(innerHeight,rect.bottom)
    };
    for(let node=target.parentElement;node;node=node.parentElement){
      const style=getComputedStyle(node);
      if(style.overflowX!=="visible"||style.overflowY!=="visible"){
        const clip=node.getBoundingClientRect();
        visible={
          left:Math.max(visible.left,clip.left),
          right:Math.min(visible.right,clip.right),
          top:Math.max(visible.top,clip.top),
          bottom:Math.min(visible.bottom,clip.bottom)
        };
      }
      if(node===document.body)break;
    }
    const width=Math.max(0,visible.right-visible.left);
    const height=Math.max(0,visible.bottom-visible.top);
    const point=width>0&&height>0
      ? document.elementFromPoint(visible.left+width/2,visible.top+Math.min(height/2,24))
      : null;
    return {
      found:true,
      rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},
      visible:{...visible,width,height},
      hitTest:Boolean(point&&(point===target||target.contains(point))),
      hitTag:point?.tagName.toLowerCase()??null,
      hitClass:typeof point?.className==="string"?point.className:null,
      hitText:(point?.textContent||"").trim().replace(/\\s+/g," ").slice(0,160)
    };
  })()`);
  assert.equal(result.found, true, `${label} is missing`);
  assert.ok(
    result.visible.width > 0 && result.visible.height >= minVisibleHeight,
    `${label} has insufficient visible area: ${JSON.stringify(result.visible)}`,
  );
  assert.ok(result.visible.left >= -2, `${label} overflows left`);
  assert.ok(result.visible.right <= 482, `${label} overflows right`);
  assert.equal(
    result.hitTest,
    true,
    `${label} is covered by another surface: ${JSON.stringify(result)}`,
  );
  return result;
}

async function close() {
  if (!child) return;
  const current = child;
  const ended =
    current.exitCode !== null
      ? Promise.resolve()
      : new Promise((done) => current.once("exit", done));
  if (headlessStarted) {
    await renderer?.evaluate("window.mingshen.stopHeadlessServer()").catch(() => undefined);
  }
  await renderer
    ?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true')
    .catch(() => undefined);
  renderer?.close();
  mainInspector?.close();
  await Promise.race([ended, sleep(7_000)]);
  if (current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(5_000)]);
  }
  assert.ok(
    current.exitCode !== null || current.signalCode !== null,
    "Electron governance fixture did not exit",
  );
  child = undefined;
  renderer = undefined;
  mainInspector = undefined;
}

let result;
try {
  await Promise.all([
    mkdir(profile, { recursive: true }),
    mkdir(project, { recursive: true }),
    mkdir(evidence, { recursive: true }),
  ]);
  const ports = await launch();

  const pdf = scannedPdf({ pages: 2, mixed: true });
  const fileName = "governance-fixture.pdf";
  const pdfPath = join(project, fileName);
  await writeFile(pdfPath, pdf);
  const xlsxFileName = "governance-formula-coverage.xlsx";
  const xlsx = await createFormulaWorkbook();
  await writeFile(join(project, xlsxFileName), xlsx);
  const fixture = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({
      name:"Governance Office fixture",
      baseUrl:"http://127.0.0.1:9/v1",
      protocol:"openai_responses",
      authMode:"bearer",
      apiKey:"local-governance-office-fixture-only",
      keyLabel:"Fixture",
      neverReveal:true
    });
    const configured=await window.mingshen.createModel({
      providerId:provider.id,
      modelId:"governance-office",
      displayName:"Governance Office",
      contextWindow:128000,
      maxOutputTokens:4096,
      inputModalities:["text"],
      toolCalls:true,
      parallelToolCalls:false,
      reasoningLevels:[],
      anthropicNoneBehavior:"disabled"
    });
    await window.mingshen.setProjectTrust(${JSON.stringify(project)},true);
    const session=await window.mingshen.createSession({
      title:"GOVERNANCE_OFFICE_FIXTURE",
      workspacePath:${JSON.stringify(project)},
      providerId:provider.id,
      modelId:configured.models[0].id,
      agentMode:"code",
      permissionMode:"full_access",
      executionMode:"host",
      reasoningLevel:null
    });
    return {sessionId:session.id};
  })()`);
  await reloadRenderer();
  await openRuntimeGovernance();

  const governance = await renderer.evaluate("window.mingshen.getRuntimeGovernance()");
  assert.equal(governance.watchdog.firstResponseTimeoutMs, 300_000);
  assert.equal(governance.watchdog.idleTimeoutMs, 900_000);
  assert.equal(governance.managedPolicy.effective.status.machine.state, "missing");
  assert.equal(governance.managedPolicy.effective.status.user.state, "missing");
  assert.equal(governance.office.visualEnabled, true);
  assert.equal(governance.office.maxRepairRounds, 3);
  assert.equal(governance.office.batchPages, 12);
  assert.equal(governance.office.maxPages, 200);
  const overview = await capture("runtime-governance-overview-1440x900", 1440, 900);
  for (const text of [
    "\u8fd0\u884c\u6cbb\u7406",
    "\u673a\u5668\u7ba1\u7406\u5458\u7b56\u7565",
    "\u5f53\u524d\u7528\u6237\u5e94\u7528\u7b56\u7565",
    "\u6a21\u578b\u8fde\u63a5\u7b49\u5f85",
  ]) {
    assert.ok(overview.text.includes(text), `Runtime governance UI is missing ${text}`);
  }

  await renderer.evaluate(
    'document.querySelector("#office-delivery-heading")?.scrollIntoView({block:"start"});true',
  );
  await sleep(180);
  const officeSettings = await capture("runtime-governance-office-1440x900", 1440, 900);
  for (const text of [
    "Office \u4ea4\u4ed8\u68c0\u67e5",
    "\u542f\u7528\u89c6\u89c9\u590d\u6838",
    "\u6bcf\u6279\u9875\u6570",
    "\u6bcf\u8f6e\u56fe\u7247\u9884\u7b97",
  ]) {
    assert.ok(officeSettings.text.includes(text), `Office delivery settings are missing ${text}`);
  }
  await renderer.evaluate(
    'document.querySelector("#runtime-policy-heading")?.scrollIntoView({block:"start"});true',
  );
  await sleep(160);
  await capture("runtime-governance-overview-800x900", 800, 900);
  await capture("runtime-governance-overview-480x900", 480, 900);
  passed.push(
    "Runtime governance settings render real watchdog, machine/user policy sources and Office budgets without horizontal overflow at 1440, 800 and 480 pixels",
  );

  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await closeSettings();

  await renderer.evaluate(`window.mingshen.setOfficeDeliverySettings({
      visualEnabled:false,
      visionModelId:null,
      maxRepairRounds:0,
      batchPages:12,
      batchMaxBytes:12*1024*1024,
      maxPages:200,
      maxImageBytes:200*1024*1024
    })`);

  const server = await renderer.evaluate(
    'window.mingshen.startHeadlessServer("127.0.0.1",0)',
  );
  headlessStarted = true;
  assert.equal(server.running, true);
  assert.ok(server.token && server.url);
  const capabilities = await requestJson(server.url, server.token, "/v1/capabilities");
  assert.equal(capabilities.officeReceipts, true);

  const prepared = await requestJson(server.url, server.token, "/v1/office/receipts", {
    method: "POST",
    body: JSON.stringify({
      action: "prepare",
      sessionId: fixture.sessionId,
      path: fileName,
    }),
  });
  assert.equal(prepared.duplicate, false);
  assert.equal(prepared.receipt.fileName, fileName);
  assert.equal(prepared.receipt.sha256, createHash("sha256").update(pdf).digest("hex"));

  const checked = await requestJson(server.url, server.token, "/v1/office/receipts", {
    method: "POST",
    body: JSON.stringify({
      action: "check",
      deliveryId: prepared.receipt.id,
    }),
  });
  officeReceiptSnapshots.pdf = checked;
  await writeFile(
    join(evidence, "office-receipt-pdf.json"),
    JSON.stringify(checked, null, 2),
  );
  assert.equal(checked.format, "PDF");
  assert.equal(checked.engine, "source_pdf");
  assert.equal(checked.stages.package, "verified");
  assert.equal(checked.stages.structure, "verified");
  assert.equal(checked.stages.render, "verified");
  assert.equal(checked.stages.visual, "unavailable");
  assert.ok(checked.unverified.some((entry) => /Visual inspection is disabled/i.test(entry)));

  const preparedXlsx = await requestJson(server.url, server.token, "/v1/office/receipts", {
    method: "POST",
    body: JSON.stringify({
      action: "prepare",
      sessionId: fixture.sessionId,
      path: xlsxFileName,
    }),
  });
  assert.equal(preparedXlsx.duplicate, false);
  assert.equal(preparedXlsx.receipt.fileName, xlsxFileName);
  assert.equal(preparedXlsx.receipt.sha256, createHash("sha256").update(xlsx).digest("hex"));

  let checkedXlsx;
  await forceOfficePowerShellLaunchFailure();
  try {
    checkedXlsx = await requestJson(server.url, server.token, "/v1/office/receipts", {
      method: "POST",
      body: JSON.stringify({
        action: "check",
        deliveryId: preparedXlsx.receipt.id,
      }),
    });
    officeReceiptSnapshots.xlsx = checkedXlsx;
    await writeFile(
      join(evidence, "office-receipt-xlsx.json"),
      JSON.stringify(checkedXlsx, null, 2),
    );
  } catch (error) {
    officeReceiptSnapshots.xlsxError = String(error.stack ?? error);
    throw error;
  } finally {
    await restoreOfficePowerShellEnvironment();
  }
  assert.equal(checkedXlsx.format, "XLSX");
  assert.equal(checkedXlsx.engine, "none");
  assert.equal(checkedXlsx.status, "unverified");
  assert.equal(checkedXlsx.stages.recalculation, "failed");
  assert.equal(checkedXlsx.stages.render, "unavailable");
  assert.equal(checkedXlsx.stages.visual, "unavailable");
  assert.equal(checkedXlsx.stages.formula, "partial");
  assert.match(
    checkedXlsx.structuralSummary,
    /Microsoft Office 验证：failed/,
    "XLSX receipt must preserve the failed Microsoft Office verifier result",
  );
  assert.match(
    checkedXlsx.structuralSummary,
    /ENOENT|spawn|PowerShell|找不到/i,
    "XLSX receipt must preserve the controlled PowerShell launch diagnostic",
  );
  assert.ok(checkedXlsx.formulaCoverage, "XLSX receipt must expose formulaCoverage");
  assert.deepEqual(
    {
      complete: checkedXlsx.formulaCoverage.complete,
      inspectedCells: checkedXlsx.formulaCoverage.inspectedCells,
      formulas: checkedXlsx.formulaCoverage.formulas,
      uncachedFormulas: checkedXlsx.formulaCoverage.uncachedFormulas,
      errors: checkedXlsx.formulaCoverage.errors,
    },
    {
      complete: true,
      inspectedCells: 6,
      formulas: 2,
      uncachedFormulas: 1,
      errors: 0,
    },
  );
  assert.ok(checkedXlsx.formulaCoverage.sampleLimit >= 2);
  assert.equal(checkedXlsx.formulaCoverage.samples.length, 2);
  const cachedFormulaSample = checkedXlsx.formulaCoverage.samples.find(
    (sample) => sample.sheet === "FormulaCoverage" && sample.cell === "B2",
  );
  const uncachedFormulaSample = checkedXlsx.formulaCoverage.samples.find(
    (sample) => sample.sheet === "FormulaCoverage" && sample.cell === "B3",
  );
  assert.deepEqual(cachedFormulaSample, {
    sheet: "FormulaCoverage",
    cell: "B2",
    formula: "SUM(2,3)",
    cached: true,
    result: "5",
  });
  assert.deepEqual(uncachedFormulaSample, {
    sheet: "FormulaCoverage",
    cell: "B3",
    formula: "SUM(B2,4)",
    cached: false,
    result: null,
  });
  assert.ok(
    checkedXlsx.unverified.some((entry) =>
      /formula caches were inspected but not proven/i.test(entry),
    ),
  );

  const listed = await renderer.evaluate(
    `window.mingshen.listOfficeDeliveries(${JSON.stringify(fixture.sessionId)})`,
  );
  assert.equal(listed.length, 2);
  assert.ok(listed.some((receipt) => receipt.id === checked.id));
  assert.ok(listed.some((receipt) => receipt.id === checkedXlsx.id));

  await selectSession(fixture.sessionId);
  await openTaskWorkbench(fixture.sessionId);
  await until(
    renderer,
    `Boolean(document.querySelector('.office-delivery-panel [data-office-delivery-id="${checked.id}"]'))&&Boolean(document.querySelector('.office-delivery-panel [data-office-delivery-id="${checkedXlsx.id}"]'))`,
    60_000,
  );
  await expandOfficeReceipt(checked.id);
  const officeLayout = await capture("office-delivery-receipt-1440x900", 1440, 900);
  for (const text of [
    fileName,
    "SHA-256",
    "\u5305\u5b89\u5168",
    "\u7ed3\u6784",
    "\u6e32\u67d3",
    "\u89c6\u89c9",
    "\u672a\u9a8c\u8bc1\u9879",
  ]) {
    assert.ok(officeLayout.text.includes(text), `Office delivery panel is missing ${text}`);
  }
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width: 480,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(240);
  await dismissResponsiveDrawers();
  await scrollTaskTargetToStart(
    `.office-delivery-panel [data-office-delivery-id="${checked.id}"]`,
  );
  await assertTaskTargetVisible(
    `.office-delivery-panel [data-office-delivery-id="${checked.id}"] .office-delivery-panel__identity`,
    "Narrow PDF delivery receipt",
    32,
  );
  await capture("office-delivery-receipt-480x900", 480, 900);
  passed.push(
    "A controlled two-page PDF round-trips through the authenticated /v1 Office receipt API and the real panel renders hash, stages, render coverage and explicit unverified visual evidence without horizontal overflow at 1440 and 480 pixels",
  );

  await expandOfficeReceipt(checkedXlsx.id);
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(180);
  await scrollToFormulaCoverage(checkedXlsx.id);
  const formulaWideLayout = await capture("office-delivery-xlsx-formulas-1440x900", 1440, 900);
  const formulaWide = await formulaCoveragePanel(checkedXlsx.id);
  assert.equal(formulaWide.viewport.width, 1440);
  assert.ok(formulaWide.text.includes("公式检查覆盖"));
  assert.ok(formulaWide.text.includes("公式样本（2 条）"));
  const wideMetadata = Object.fromEntries(
    formulaWide.metadata.map((entry) => [entry.label, entry.value]),
  );
  assert.equal(wideMetadata["公式总数"], "2");
  assert.equal(wideMetadata["缺失缓存"], "1");
  assert.equal(wideMetadata["错误结果"], "0");
  assert.equal(wideMetadata["已扫描单元格"], "6");
  assert.equal(wideMetadata["统计范围"], "完整扫描");
  for (const expected of [
    "FormulaCoverage!B2: SUM(2,3)",
    "FormulaCoverage!B3: SUM(B2,4)",
    "缓存: 5",
    "缓存: 缺失",
  ])
    assert.ok(formulaWide.text.includes(expected), `Formula panel is missing ${expected}`);
  assert.ok(formulaWideLayout.text.includes(xlsxFileName));

  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width: 480,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(240);
  await dismissResponsiveDrawers();
  await scrollToFormulaCoverage(checkedXlsx.id);
  const formulaNarrowLayout = await capture("office-delivery-xlsx-formulas-480x900", 480, 900);
  const formulaNarrow = await formulaCoveragePanel(checkedXlsx.id);
  assert.equal(formulaNarrow.viewport.width, 480);
  for (const expected of [
    "公式总数",
    "缺失缓存",
    "错误结果",
    "已扫描单元格",
    "完整扫描",
    "FormulaCoverage!B2: SUM(2,3)",
    "FormulaCoverage!B3: SUM(B2,4)",
  ])
    assert.ok(formulaNarrow.text.includes(expected), `Narrow formula panel is missing ${expected}`);
  assert.ok(formulaNarrowLayout.text.includes(xlsxFileName));
  passed.push(
    "A real cached+uncached-formula XLSX round-trips through the authenticated /v1 Office receipt API while a controlled Microsoft Office PowerShell launch failure is recorded as failed recalculation, unavailable render, unverified overall status and complete formulaCoverage, and the formula section remains visible without horizontal overflow at 1440 and 480 pixels",
  );

  skipped.push(
    "Quick Chat runtime lifecycle was not rerun in this focused governance UI fixture; run scripts/quick-chat-smoke.mjs separately.",
  );

  result = {
    version: JSON.parse(await readFile(resolve("package.json"), "utf8")).version,
    passed,
    skipped,
    errors,
    screenshots,
    layoutMeasurements,
    officeReceiptSnapshots,
    ports,
    fixture: {
      sessionId: fixture.sessionId,
      deliveryId: checked.id,
      fileName,
      bytes: pdf.length,
      sha256: checked.sha256,
      format: checked.format,
      status: checked.status,
      engine: checked.engine,
      stages: checked.stages,
      unverified: checked.unverified,
      xlsx: {
        deliveryId: checkedXlsx.id,
        fileName: xlsxFileName,
        bytes: xlsx.length,
        sha256: checkedXlsx.sha256,
        format: checkedXlsx.format,
        status: checkedXlsx.status,
        engine: checkedXlsx.engine,
        stages: checkedXlsx.stages,
        formulaCoverage: checkedXlsx.formulaCoverage,
        unverified: checkedXlsx.unverified,
      },
    },
    quickChatLifecycleEvidence: null,
    boundaries:
      "Isolated Electron profile and temporary workspace. The PDF receipt is checked from its source pages. The XLSX formula receipt deliberately forces the Microsoft Office PowerShell launcher to fail by pointing SystemRoot at a missing directory and hides LibreOffice discovery; this proves failure reporting, not that either product is uninstalled. Visual review is disabled and no paid vision provider is exercised. Installation and upgrade were not exercised.",
  };
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await mkdir(evidence, { recursive: true });
  try {
    failureDiagnostics = await captureFailureDiagnostics();
  } catch (diagnosticError) {
    failureDiagnostics = { error: String(diagnosticError.stack ?? diagnosticError) };
  }
  await writeFile(
    join(evidence, "failure.json"),
    JSON.stringify(
      {
        passed,
        skipped,
        errors,
        screenshots,
        layoutMeasurements,
        overflowDiagnostics,
        officeReceiptSnapshots,
        failureDiagnostics,
        failure: String(error.stack ?? error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await close().catch(() => undefined);
  const resolvedTemporary = resolve(temporary);
  const resolvedBase = resolve(tmpdir()) + sep;
  if (resolvedTemporary.startsWith(resolvedBase)) {
    await rm(resolvedTemporary, { recursive: true, force: true }).catch(() => undefined);
  }
}
