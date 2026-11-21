import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const temporary = await mkdtemp(join(tmpdir(), "mingshen-project-review-"));
const project = join(temporary, "project");
const profile = join(temporary, "profile");
const evidence = resolve(".impeccable/review", `v134-project-review-${Date.now()}`);
const screenshots = [];
const passed = [];
const requests = [];
const exceptions = [];
const serviceErrors = [];
const measurements = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const longContext = [
  `omega ${"A long review context keeps the original line selection visible. ".repeat(5)}`,
  `context-tail ${"Additional unchanged text exercises a wrapped multi-line quote. ".repeat(5)}`,
].join("\n");
const trackedContents = (value) => `alpha\n${value}\n${longContext}\n`;
async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_done, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
let child;
let main;
let renderer;
let primary;
let worktreeSession;
let terminalMayExist = false;
let terminalStarted = false;
let failure;

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    requests.push({ url: request.url, body });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Isolated project fixture complete." })}\n\n`);
    response.end(`data: ${JSON.stringify({ type: "response.completed", response: {
      status: "completed", output: [], usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
    } })}\n\n`);
  } catch (cause) {
    serviceErrors.push(String(cause.stack || cause));
    if (!response.headersSent) response.writeHead(500);
    response.end("Fixture provider failure");
  }
});

async function unusedPort() {
  const probe = createPortServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", done);
  });
  const number = probe.address().port;
  await new Promise((done) => probe.close(done));
  return number;
}

async function connect(number, kind) {
  let target;
  for (let attempt = 0; attempt < 200 && !target; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${number}/json`).then((result) => result.json());
      target = targets.find((item) => item.webSocketDebuggerUrl && (kind !== "renderer" || item.type === "page"));
    } catch {}
    if (!target) await sleep(100);
  }
  assert.ok(target, `Missing ${kind} debugger`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data));
    if (kind === "renderer" && value.method === "Runtime.exceptionThrown") {
      exceptions.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    }
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id);
    clearTimeout(waiter.timer);
    if (value.error) waiter.reject(new Error(value.error.message));
    else waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 60_000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    evaluate: async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    close: () => {
      for (const waiter of pending.values()) clearTimeout(waiter.timer);
      socket.close();
    },
  };
}

const api = (name, ...args) => renderer.evaluate(`window.mingshen.${name}(${args.map((arg) => JSON.stringify(arg)).join(",")})`);

async function until(expression, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await renderer.evaluate(expression)) return;
    } catch (cause) {
      if (!/context|reload|destroyed|navigat/i.test(String(cause))) throw cause;
    }
    await sleep(80);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function click(selector) {
  await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled||el.getBoundingClientRect().width<1)return false;el.click();return true})()`);
}

async function fill(selector, text) {
  await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return Boolean(el&&!el.disabled&&el.getBoundingClientRect().width>0)})()`);
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select();return true})()`);
  if (text) await renderer.send("Input.insertText", { text });
  else await key("Backspace", "Backspace", 8);
}

async function key(name, code, windowsVirtualKeyCode, modifiers = 0) {
  await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode, modifiers });
  await renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode, modifiers });
}

async function openPalette() {
  await key("P", "KeyP", 80, 10);
  await until('Boolean(document.querySelector("[data-testid=command-palette-input]"))');
}

async function closePalette() {
  await key("Escape", "Escape", 27);
  await until('!document.querySelector("[data-testid=command-palette]")');
}

async function searchPalette(query) {
  await fill("[data-testid=command-palette-input]", query);
}

async function selectSession(session) {
  await openPalette();
  await searchPalette(session.title);
  await click(`[data-testid="command-palette-session"][data-session-id="${session.id}"]`);
  await until('!document.querySelector("[data-testid=command-palette]")');
  const mode = session.agentMode === "chat" ? "chat" : session.agentMode === "work" ? "work" : "code";
  await until(`document.querySelector('[data-testid="agent-mode-${mode}"]')?.getAttribute('aria-pressed')==='true'`);
  await until(`[...document.querySelectorAll('.topbar-session strong,.orbit-workspace-header__path h1')].some(el=>el.textContent===${JSON.stringify(session.title)})`);
  if (session.id === primary?.id) {
    await until('document.querySelector("[data-testid=chat-composer-input]")?.value.includes("Existing review draft")');
  }
}

async function paletteCommand(id) {
  await openPalette();
  await until(`Boolean(document.querySelector('[data-command-id="${id}"]'))`);
  await click(`[data-command-id="${id}"]`);
  await until(`document.querySelector('.workspace-panel')?.dataset.workspaceTab===${JSON.stringify(id)}`);
}

async function capture(name) {
  await sleep(150);
  const result = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(result.data, "base64"));
  screenshots.push(path);
}

async function measure(name, selector) {
  const result = await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();const h=el.querySelector('.command-palette__search,.local-review__toolbar')?.getBoundingClientRect();return{viewport:{width:innerWidth,height:innerHeight},surface:{left:r.left,right:r.right,top:r.top,width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth},header:h&&{left:h.left,right:h.right,top:h.top,bottom:h.bottom}}})()`);
  assert.ok(result, `Missing geometry for ${name}`);
  assert.ok(result.surface.width > 0 && result.surface.left >= -1 && result.surface.right <= result.viewport.width + 1, JSON.stringify({ name, result }));
  assert.ok(result.header && result.header.left >= -1 && result.header.right <= result.viewport.width + 1, JSON.stringify({ name, result }));
  measurements.push({ name, ...result });
}

async function preparePointer(name, selector, checkReviewOrder = true) {
  await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return Boolean(el&&!el.disabled&&el.getBoundingClientRect().width>0)})()`);
  const before = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});
    const panel=document.querySelector('.review-panel');
    const pending=document.querySelector('[data-testid=local-review-pending]');
    const rect=el.getBoundingClientRect();
    const scroll=node=>node&&({top:node.scrollTop,height:node.scrollHeight,client:node.clientHeight});
    return {target:{top:rect.top,bottom:rect.bottom},panel:scroll(panel),pending:scroll(pending)};
  })()`);
  await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'});true`);
  await sleep(80);
  const result = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});
    const panel=document.querySelector('.review-panel');
    const review=document.querySelector('[data-testid=local-review]');
    const checks=document.querySelector('.review-checks');
    const pending=document.querySelector('[data-testid=local-review-pending]');
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const scroll=node=>node&&({top:node.scrollTop,height:node.scrollHeight,client:node.clientHeight});
    const target=rect(el);
    const insetX=Math.min(3,target.width/4),insetY=Math.min(3,target.height/4);
    const points=[[(target.left+target.right)/2,(target.top+target.bottom)/2],
      [target.left+insetX,target.top+insetY],[target.right-insetX,target.top+insetY],
      [target.left+insetX,target.bottom-insetY],[target.right-insetX,target.bottom-insetY]]
      .map(([x,y])=>{const hit=document.elementFromPoint(x,y);return {x,y,hit:Boolean(hit&&(hit===el||el.contains(hit))),element:hit?.tagName,className:typeof hit?.className==='string'?hit.className:null}});
    const clipping=[];
    for(let node=el.parentElement;node;node=node.parentElement){
      const style=getComputedStyle(node),r=node.getBoundingClientRect();
      const x=/^(auto|scroll|hidden|clip)$/.test(style.overflowX),y=/^(auto|scroll|hidden|clip)$/.test(style.overflowY);
      if(x||y)clipping.push({element:node.tagName,className:typeof node.className==='string'?node.className:null,x,y,left:r.left+node.clientLeft,right:r.left+node.clientLeft+node.clientWidth,top:r.top+node.clientTop,bottom:r.top+node.clientTop+node.clientHeight});
    }
    return {viewport:{width:innerWidth,height:innerHeight},target,review:review&&rect(review),checks:checks&&rect(checks),panel:scroll(panel),pending:scroll(pending),clipping,points};
  })()`);
  const detail = JSON.stringify({ name, before, ...result });
  const { target, viewport } = result;
  assert.ok(target.width > 0 && target.height > 0, detail);
  assert.ok(target.left >= -0.5 && target.top >= -0.5 && target.right <= viewport.width + 0.5 && target.bottom <= viewport.height + 0.5, detail);
  for (const clip of result.clipping) {
    if (clip.x) assert.ok(target.left >= clip.left - 0.5 && target.right <= clip.right + 0.5, detail);
    if (clip.y) assert.ok(target.top >= clip.top - 0.5 && target.bottom <= clip.bottom + 0.5, detail);
  }
  assert.ok(result.points.every((point) => point.hit), detail);
  if (checkReviewOrder) {
    assert.ok(result.review && result.checks, detail);
    assert.ok(target.left >= result.review.left - 0.5 && target.right <= result.review.right + 0.5 && target.top >= result.review.top - 0.5 && target.bottom <= result.review.bottom + 0.5, detail);
    assert.ok(target.bottom <= result.checks.top + 0.5, detail);
  }
  measurements.push({ name, before, ...result });
  return result.points[0];
}

async function pressPointer(point, modifiers = 0) {
  const { x, y } = point;
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
  await renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers });
}

async function waitRun(sessionId, runId) {
  await until(`window.mingshen.getSessionRunState(${JSON.stringify(sessionId)}).then(run=>run&&run.runId===${JSON.stringify(runId)}&&run.status!=='running')`, 90_000);
  const run = await api("getSessionRunState", sessionId);
  assert.equal(run.status, "completed", JSON.stringify(run));
}

async function addComment(side, text) {
  const selector = side === "old"
    ? '.local-review__line--removed[data-review-old-line="2"]'
    : '.local-review__line--added[data-review-new-line="2"]';
  await click(selector);
  await fill("[data-testid=local-review-comment-input]", text);
  await click("[data-testid=local-review-add-comment]");
}

async function reloadSurface(expected = {}) {
  await renderer.evaluate('globalThis.__projectReviewReloadPending=true;true');
  await renderer.send("Page.reload");
  await until(`globalThis.__projectReviewReloadPending===undefined&&Boolean(document.querySelector(".app-shell"))${
    expected.style ? `&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(expected.style)}` : ""
  }${expected.theme ? `&&document.documentElement.dataset.theme===${JSON.stringify(expected.theme)}` : ""}${
    expected.locale ? `&&document.documentElement.lang===${JSON.stringify(expected.locale)}` : ""
  }`);
}

async function configureSurface(style, width, locale, theme) {
  await renderer.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await renderer.evaluate(`(async()=>{await window.mingshen.desktopAction('locale',${JSON.stringify(locale)});const p=await window.mingshen.getUiPreferences();await window.mingshen.saveUiPreferences({...p,interfaceStyle:${JSON.stringify(style)}});localStorage.setItem('mingshen.locale',${JSON.stringify(locale)});localStorage.setItem('mingshen.theme',${JSON.stringify(theme)});return true})()`);
  await reloadSurface({ style, locale, theme });
  await selectSession(primary);
}

async function openSessionSidebar() {
  const inspectorBlocksSidebar = await renderer.evaluate('Boolean(document.querySelector(\'.app-body[data-inspector-drawer="true"] .inspector-host:not([hidden])\') && document.querySelector(".workbench-drawer-scrim:not(.chat-sidebar-scrim)"))');
  if (inspectorBlocksSidebar) {
    const closeInspector = await preparePointer("close-inspector-drawer-before-sidebar", '.inspector-host:not([hidden]) .workspace-panel__header > button.icon-button', false);
    await pressPointer(closeInspector);
    await until('!document.querySelector(".inspector-host:not([hidden])")');
  }
  if (await renderer.evaluate('(()=>{const el=document.querySelector(".sidebar-host:not([hidden]) .session-sidebar");return Boolean(el&&el.getBoundingClientRect().width>0)})()')) return;
  await until(`(()=>{const el=[...document.querySelectorAll('.sidebar-toggle,.orbit-workspace-header > button')].find(item=>item.getBoundingClientRect().width>0);if(!el)return false;el.click();return true})()`);
  await until('(()=>{const el=document.querySelector(".sidebar-host:not([hidden]) .session-sidebar");return Boolean(el&&el.getBoundingClientRect().width>0)})()');
}

async function measureSidebar(name, { project, errors = 0, scrollable = false } = {}) {
  const result = await renderer.evaluate(`(()=>{
    const aside=document.querySelector('.sidebar-host:not([hidden]) .session-sidebar');
    const toggle=aside?.querySelector('.session-view-toggle');
    const search=aside?.querySelector('.session-search');
    const list=aside?.querySelector('.session-groups');
    const footer=aside?.querySelector('.session-sidebar__footer');
    const nav=aside?.querySelector('.project-navigator');
    const alerts=[...(aside?.querySelectorAll('.session-sidebar__error')||[])];
    if(!aside||!toggle||!search||!list||!footer)return null;
    const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const hit=el=>{const r=el.getBoundingClientRect(),n=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);return Boolean(n&&(n===el||el.contains(n)))};
    const originalScroll=list.scrollTop;list.scrollTop=list.scrollHeight;const bottomScroll=list.scrollTop;list.scrollTop=originalScroll;
    return {viewport:{width:innerWidth,height:innerHeight},aside:rect(aside),toggle:rect(toggle),search:rect(search),list:rect(list),footer:rect(footer),project:Boolean(nav),alerts:alerts.map(el=>({...rect(el),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,overflow:getComputedStyle(el).overflowY})),scroll:{height:list.scrollHeight,client:list.clientHeight,bottom:bottomScroll},hits:{toggle:hit(toggle.querySelector('button')),search:hit(search.querySelector('input'))}};
  })()`);
  assert.ok(result, `Missing sidebar geometry for ${name}`);
  assert.equal(result.project, project, JSON.stringify({ name, result }));
  assert.equal(result.alerts.length, errors, JSON.stringify({ name, result }));
  assert.ok(result.aside.width > 0 && result.aside.height > 0 && result.aside.top >= -1 && result.aside.bottom <= result.viewport.height + 1, JSON.stringify({ name, result }));
  assert.ok(result.search.top >= result.toggle.bottom - 1 && result.search.top - result.toggle.bottom <= 24, JSON.stringify({ name, result }));
  const prior = result.alerts.at(-1) || result.search;
  assert.ok(result.list.top >= prior.bottom - 1 && result.list.top - prior.bottom <= 32, JSON.stringify({ name, result }));
  assert.ok(result.list.height > 0 && result.footer.top >= result.list.bottom - 1 && result.footer.bottom <= result.aside.bottom + 1, JSON.stringify({ name, result }));
  assert.ok(result.hits.toggle && result.hits.search, JSON.stringify({ name, result }));
  for (const alert of result.alerts) assert.ok(alert.top >= result.search.bottom - 1 && alert.bottom <= result.aside.bottom + 1 && alert.scrollHeight > alert.clientHeight && alert.overflow === "auto", JSON.stringify({ name, result }));
  if (scrollable) assert.ok(result.scroll.height > result.scroll.client && result.scroll.bottom > 0, JSON.stringify({ name, result }));
  measurements.push({ name, ...result });
}

async function saveResult(success, cause) {
  const path = join(evidence, success ? "result.json" : "failure.json");
  await writeFile(path, JSON.stringify({
    success, passed, screenshots, measurements, requestCount: requests.length,
    requests, exceptions, serviceErrors, failure: cause ? String(cause.stack || cause) : null,
    boundaries: [
      "The project, Git worktree, profile and provider are isolated local fixtures.",
      "One local fixture completion establishes a real worktree and background unread state; no paid provider or real credentials are used.",
      "Screenshots and Chromium geometry checks do not certify all Windows DPI or accessibility configurations.",
    ],
  }, null, 2));
  return path;
}

try {
  await mkdir(join(project, "src"), { recursive: true });
  await mkdir(evidence, { recursive: true });
  await writeFile(join(project, "tracked.txt"), trackedContents("old value"));
  await writeFile(join(project, "src", "needle-fixture.ts"), "export const fixtureNeedle = 42;\n");
  const git = (args, cwd = project) => execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" });
  git(["init", "-b", "main"]);
  git(["config", "user.name", "Local Fixture"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["add", "."]);
  git(["commit", "-m", "Fixture baseline"]);
  await writeFile(join(project, "tracked.txt"), trackedContents("new value"));

  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const mainPort = await unusedPort();
  let rendererPort = await unusedPort();
  while (rendererPort === mainPort) rendererPort = await unusedPort();
  const environment = { ...process.env, MSH_EXPERIMENTAL: "1", MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: "1", MSH_NOTIFICATION_FIXTURE: "1" };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(), [`--inspect=${mainPort}`, ".", `--remote-debugging-port=${rendererPort}`], {
    cwd: resolve("apps/desktop"), env: environment, windowsHide: true, stdio: "ignore",
  });
  main = await connect(mainPort, "main");
  await main.evaluate('(()=>{const original=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):original(url,options);return true})()');
  renderer = await connect(rendererPort, "renderer");
  await renderer.send("Runtime.enable");
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  for (const label of ["同意并继续", "开始使用"]) {
    await until(`(()=>{const el=[...document.querySelectorAll('.policy-dialog button')].find(item=>!item.disabled&&item.textContent.trim()===${JSON.stringify(label)});if(!el)return false;el.click();return true})()`);
  }
  await until('!document.querySelector(".policy-dialog")');
  await renderer.evaluate('(async()=>{for(const s of await window.mingshen.listMcpServers())if(s.enabled)await window.mingshen.setMcpServerEnabled(s.id,false);await window.mingshen.setModelRetrySettings({maxRetries:0});const saver=await window.mingshen.getTokenSaver();await window.mingshen.setTokenSaver({...saver.settings,enabled:false});await window.mingshen.configureCompletionNotifications({nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false});localStorage.setItem("mingshen.theme","day");return true})()');
  const provider = await api("createProvider", { name: "Project review local fixture", protocol: "openai_responses", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, authMode: "bearer", apiKey: "local-review-fixture", keyLabel: "Fixture", neverReveal: true });
  const catalog = await api("createModel", { providerId: provider.id, modelId: "review-fixture", displayName: "Review fixture", contextWindow: 200_000, maxOutputTokens: 2_000, inputModalities: ["text"], toolCalls: true, parallelToolCalls: false, reasoningLevels: [], anthropicNoneBehavior: "disabled" });
  const model = catalog.models.find((item) => item.modelId === "review-fixture");
  assert.ok(model);
  assert.equal((await api("listSessionPage", { agentMode: "workspace", limit: 1 })).total, 0, "The empty-sidebar fixture must not contain workspace sessions");
  await reloadSurface({ style: "simple" });
  await openSessionSidebar();
  await until('Boolean(document.querySelector(".sidebar-host .session-groups .session-list__empty"))');
  await measureSidebar("simple-empty-project-list", { project: false });
  await capture("simple-empty-project-list");
  await renderer.evaluate('(async()=>{const p=await window.mingshen.getUiPreferences();await window.mingshen.saveUiPreferences({...p,interfaceStyle:"orbit"});return true})()');
  await reloadSurface({ style: "orbit" });
  await openSessionSidebar();
  await until('Boolean(document.querySelector(".sidebar-host .session-groups .session-list__empty"))');
  await measureSidebar("orbit-empty-project-list", { project: false });
  await capture("orbit-empty-project-list");
  await renderer.evaluate('(async()=>{const p=await window.mingshen.getUiPreferences();await window.mingshen.saveUiPreferences({...p,interfaceStyle:"simple"});return true})()');
  await reloadSurface({ style: "simple" });
  passed.push("With a configured fixture provider and no workspace sessions, both Simple and Orbit keep their search and empty list directly below the view toggle without a project navigator.");
  await api("setProjectTrust", project, true);
  const input = { workspacePath: project, providerId: provider.id, modelId: model.id, reasoningLevel: null, permissionMode: "full_access", executionMode: "host", agentMode: "code" };
  primary = await api("createSession", { ...input, title: "Primary review fixture" });
  await until(`window.mingshen.getProjectContexts([${JSON.stringify(primary.id)}]).then(r=>r.contexts[${JSON.stringify(primary.id)}]?.branch==='main')`);
  git(["switch", "-c", "review-later"]);
  const history = await api("createSession", { ...input, title: "History selection fixture" });
  worktreeSession = await api("createSession", { ...input, executionMode: "worktree", title: "Background worktree fixture" });
  const chat = await api("createSession", { ...input, workspacePath: null, agentMode: "chat", permissionMode: "request_approval", title: "Chat palette fixture" });
  await api("setProjectMemoryEnabled", worktreeSession.id, false);
  await until(`window.mingshen.getProjectContexts([${JSON.stringify(history.id)}]).then(r=>r.contexts[${JSON.stringify(history.id)}]?.branch==='review-later')`);
  const attachment = Buffer.from("Synthetic review attachment.\n", "utf8");
  await api("saveComposerDraft", {
    sessionId: primary.id, baseRevision: null, revision: "fixture-review-draft", text: "Existing review draft", formatted: false,
    attachmentIds: ["review-attachment"], notificationDraftIds: [],
    addedAttachments: [{ id: "review-attachment", name: "review-fixture.txt", mimeType: "text/plain", size: attachment.length, kind: "file", dataUrl: `data:text/plain;base64,${attachment.toString("base64")}` }],
  });
  await reloadSurface();
  await selectSession(primary);

  const run = await api("sendChat", { sessionId: worktreeSession.id, text: "Complete the isolated worktree fixture without tools." });
  await waitRun(worktreeSession.id, run.runId);
  assert.equal(requests.length, 1, "Only one local completion is expected");
  await until(`window.mingshen.getCompletionNotifications().then(s=>s.unread.some(n=>n.sessionId===${JSON.stringify(worktreeSession.id)}))`);
  await until(`(()=>{const p=[...document.querySelectorAll('[data-testid=project-navigator] [data-project-path]')].find(el=>el.dataset.projectPath===${JSON.stringify(project)});return Boolean(p&&Number(p.dataset.unreadCount)>0)})()`);
  const worktree = join(profile, "worktrees", worktreeSession.id);
  git(["switch", "-c", "review-worktree"], worktree);
  await writeFile(join(worktree, "src", "worktree-search-only.ts"), "export const isolatedWorktree = true;\n");
  await api("updateSession", { sessionId: worktreeSession.id, executionMode: "host" });
  await api("updateSession", { sessionId: worktreeSession.id, executionMode: "worktree" });
  await until(`window.mingshen.getProjectContexts([${JSON.stringify(worktreeSession.id)}]).then(r=>r.contexts[${JSON.stringify(worktreeSession.id)}]?.branch==='review-worktree')`);
  const found = await api("searchWorkspaceFiles", { sessionId: worktreeSession.id, query: "worktree-search-only", limit: 20 });
  assert.equal(resolve(found.root).toLowerCase(), resolve(worktree).toLowerCase());
  assert.ok(found.items.some((item) => item.name === "worktree-search-only.ts"));
  const hostSearch = await api("searchWorkspaceFiles", { sessionId: primary.id, query: "worktree-search-only", limit: 20 });
  assert.equal(hostSearch.items.length, 0);
  passed.push("A real background completion creates the managed worktree and unread project badge; worktree search resolves its actual root, not the host checkout.");

  await reloadSurface();
  await selectSession(primary);
  await click('[data-testid="session-view-toggle"] [data-view-mode="branch"]');
  await until('Boolean(document.querySelector(\'.session-group[data-branch="main"][data-branch-recorded="true"]\'))');
  await until('Boolean(document.querySelector(\'.session-group[data-branch="review-later"][data-branch-recorded="true"]\'))');
  await until('Boolean(document.querySelector(\'.session-group[data-branch="review-worktree"][data-worktree="true"]\'))');
  const contexts = await api("getProjectContexts", [primary.id, history.id, worktreeSession.id]);
  assert.equal(contexts.contexts[primary.id].branch, "main");
  assert.equal(contexts.contexts[history.id].branch, "review-later");
  assert.equal(contexts.contexts[worktreeSession.id].branch, "review-worktree");
  passed.push("Project navigation shows recorded branches, including the established worktree, rather than inventing the current host branch for older sessions.");

  for (let index = 0; index < 24; index++) {
    await api("createSession", { ...input, title: `Sidebar scroll fixture ${String(index).padStart(2, "0")}` });
  }
  for (const [style, width, height, locale, theme] of [
    ["simple", 1440, 900, "zh-CN", "day"],
    ["simple", 800, 600, "en", "night"],
    ["orbit", 1440, 900, "en", "day"],
    ["orbit", 800, 600, "zh-CN", "night"],
  ]) {
    const label = `sidebar-${style}-${width}x${height}-${locale}-${theme}`;
    await configureSurface(style, width, locale, theme);
    await renderer.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await until(`innerWidth===${width}&&innerHeight===${height}`);
    await openSessionSidebar();
    await click('[data-testid="session-view-toggle"] [data-view-mode="project"]');
    await until('document.querySelector(\'[data-view-mode="project"]\')?.getAttribute("aria-pressed")==="true"&&Boolean(document.querySelector(".project-navigator"))');
    const header = '.session-group:first-child .session-group__header';
    await until(`Boolean(document.querySelector(${JSON.stringify(header)}))`);
    if (await renderer.evaluate(`document.querySelector(${JSON.stringify(header)}).getAttribute("aria-expanded")!=="true"`)) await click(header);
    await until('Boolean(document.querySelector(".session-group:first-child .session-group__show-all"))');
    await click('.session-group:first-child .session-group__show-all');
    await until('document.querySelectorAll(".session-group:first-child .session-row").length>=20');
    await measureSidebar(`${label}-expanded`, { project: true, scrollable: true });
    await capture(`${label}-expanded`);
    await click(header);
    await until(`document.querySelector(${JSON.stringify(header)})?.getAttribute("aria-expanded")==="false"`);
    await measureSidebar(`${label}-collapsed`, { project: true });
    await click('[data-testid="session-view-toggle"] [data-view-mode="branch"]');
    await until('document.querySelector(\'[data-view-mode="branch"]\')?.getAttribute("aria-pressed")==="true"&&Boolean(document.querySelector(".session-group[data-branch]"))');
    await measureSidebar(`${label}-branch`, { project: true });
    await renderer.evaluate(`(()=>{const list=document.querySelector('.sidebar-host .session-groups');for(let i=0;i<2;i++){const error=document.createElement('p');error.className='session-sidebar__error form-error';error.setAttribute('role','alert');error.dataset.syntheticSidebarError='true';error.textContent='Synthetic bounded error message. '.repeat(40);list.before(error)}return true})()`);
    await measureSidebar(`${label}-synthetic-errors`, { project: true, errors: 2 });
    await capture(`${label}-synthetic-errors`);
    await renderer.evaluate('document.querySelectorAll("[data-synthetic-sidebar-error]").forEach(el=>el.remove());true');
  }
  passed.push("Real project sessions exercise both views, collapsed and expanded groups, long-list scrolling and usable controls in Simple/Orbit at 1440x900 and 800x600; bounded error geometry uses synthetic alert elements.");

  await configureSurface("simple", 1440, "zh-CN", "day");
  await openPalette();
  await searchPalette("needle-fixture.ts");
  await until('Boolean(document.querySelector("[data-testid=command-palette-file]"))');
  await click('[data-testid="command-palette-file"]');
  await until('document.querySelector(".editor-pane textarea")?.value.includes("fixtureNeedle")');
  await selectSession(history);
  await openPalette();
  await until(`document.querySelector('.command-palette__scope')?.textContent.includes(${JSON.stringify(history.title)})`);
  await closePalette();
  await selectSession(primary);
  passed.push("Native Ctrl+Shift+P searches and opens an actual project file, and selecting a history result changes the active conversation.");

  await openPalette();
  await searchPalette("needle-fixture");
  await sleep(160);
  await closePalette();
  await openPalette();
  await searchPalette("no-such-stale-fixture");
  await sleep(700);
  assert.equal(await renderer.evaluate('document.querySelectorAll("[data-testid=command-palette-file]").length'), 0);
  await closePalette();
  await selectSession(chat);
  await openPalette();
  await until(`document.querySelector('.command-palette__scope')?.textContent.includes(${JSON.stringify(chat.title)})`);
  const chatCommands = await renderer.evaluate('[...document.querySelectorAll("[data-command-id]")].map(el=>el.dataset.commandId)');
  for (const forbidden of ["terminal", "files", "review", "plan", "skills", "plugins"]) assert.ok(!chatCommands.includes(forbidden), forbidden);
  assert.equal(await renderer.evaluate('document.querySelectorAll("[data-testid=command-palette-file]").length'), 0);
  await closePalette();
  await selectSession(primary);
  passed.push("Closing and reopening the palette clears stale search results; Chat excludes workspace and unsafe commands.");

  terminalMayExist = true;
  await paletteCommand("terminal");
  await until(`window.mingshen.listTerminals(${JSON.stringify(primary.id)}).then(items=>items.some(t=>t.status==='running'))`);
  terminalStarted = true;
  await click(".interactive-terminal__tab-close");
  await until(`window.mingshen.listTerminals(${JSON.stringify(primary.id)}).then(items=>items.length===0)`);
  terminalMayExist = false;
  await paletteCommand("review");
  await until('Boolean(document.querySelector(\'[data-testid=local-review] [data-review-file="tracked.txt"]\'))');
  passed.push("Palette commands switch the actual workspace to terminal and review, and the opened shell is stopped.");

  for (const scope of ["branch", "session", "previous", "git"]) {
    await click(`[data-testid="local-review"] [role="tab"][data-review-scope="${scope}"]`);
    await until(`document.querySelector('[data-testid="local-review"]')?.dataset.reviewScope===${JSON.stringify(scope)}&&document.querySelector('[data-testid="local-review"] [role="tab"][aria-selected="true"]')?.dataset.reviewScope===${JSON.stringify(scope)}`);
    const result = await api("getLocalReview", { sessionId: primary.id, scope, ...(scope === "branch" ? { baseRef: "main" } : {}) });
    assert.equal(result.scope, scope);
    if (scope === "branch") {
      assert.equal(result.files.length, 0);
      await until('Boolean(document.querySelector(".local-review__empty"))');
    } else if (scope === "session" || scope === "previous") {
      assert.equal(result.files.length, 0);
      const warning = scope === "session" ? "当前会话还没有可审阅的文件变更" : "当前会话还没有已完成的上一轮变更";
      await until(`document.querySelector('.local-review__warnings')?.textContent.includes(${JSON.stringify(warning)})`);
    } else {
      assert.ok(result.files.some((file) => file.path === "tracked.txt"));
      await until('Boolean(document.querySelector(\'[data-review-file="tracked.txt"]\'))');
    }
  }
  await until('Boolean(document.querySelector(\'.local-review__line--removed[data-review-old-line="2"]\'))');
  const messagesBefore = await api("getSessionMessages", primary.id);
  const draftBefore = await api("getComposerDraft", primary.id);
  assert.equal(draftBefore.text, "Existing review draft");
  assert.deepEqual(draftBefore.attachments.map((item) => item.name), ["review-fixture.txt"]);
  await addComment("old", "STALE_REVIEW_COMMENT");
  await writeFile(join(project, "tracked.txt"), trackedContents("newer value"));
  await click("[data-testid=local-review-submit]");
  await until('Boolean(document.querySelector(".local-review__error[role=alert]"))');
  assert.ok(await renderer.evaluate('document.querySelector("[data-testid=local-review-pending]")?.textContent.includes("STALE_REVIEW_COMMENT")'));
  assert.deepEqual(await api("getComposerDraft", primary.id), draftBefore);
  assert.deepEqual(await api("getSessionMessages", primary.id), messagesBefore);
  await click('.local-review__toolbar button[title="刷新审阅"]');
  await until('Boolean(document.querySelector(\'[data-review-file="tracked.txt"][data-review-stale="true"]\'))');
  await until('document.querySelector(\'.local-review__line--added[data-review-new-line="2"]\')?.textContent.includes("newer value")&&!document.querySelector(\'.local-review__toolbar button[title="刷新审阅"]\')?.disabled');
  await click('[data-review-pending-path="tracked.txt"] button');
  await until('!document.querySelector("[data-testid=local-review-pending]")&&Boolean(document.querySelector(\'[data-review-file="tracked.txt"][data-review-stale="false"]\'))');
  await addComment("old", "REVIEW_OLD_LINE_COMMENT");
  await addComment("new", "REVIEW_NEW_LINE_COMMENT");
  await click("[data-testid=local-review-submit]");
  await until('!document.querySelector("[data-testid=local-review-pending]")');
  await until(`window.mingshen.getComposerDraft(${JSON.stringify(primary.id)}).then(d=>Boolean(d?.text.includes('REVIEW_OLD_LINE_COMMENT')&&d.text.includes('REVIEW_NEW_LINE_COMMENT')))`);
  const draftAfter = await api("getComposerDraft", primary.id);
  assert.ok(draftAfter.text.startsWith("Existing review draft"));
  assert.match(draftAfter.text, /旧行 2-2/);
  assert.match(draftAfter.text, /新行 2-2/);
  assert.deepEqual(draftAfter.attachments.map((item) => item.name), ["review-fixture.txt"]);
  assert.deepEqual(await api("getSessionMessages", primary.id), messagesBefore);
  assert.equal(requests.length, 1);
  passed.push("All four scopes are selected in the UI; stale comments are retained and rejected, while old/new line comments persist into the existing attachment-bearing draft without sending a message.");

  const expectedDraftTexts = ["Existing review draft", "REVIEW_OLD_LINE_COMMENT", "REVIEW_NEW_LINE_COMMENT"];
  const removedDraftTexts = [];
  for (const [style, width, locale, theme] of [
    ["simple", 1440, "zh-CN", "day"],
    ["simple", 800, "en", "night"],
    ["orbit", 1440, "en", "day"],
    ["orbit", 800, "zh-CN", "night"],
  ]) {
    const label = `${style}-${width}-${locale}-${theme}`;
    await configureSurface(style, width, locale, theme);
    await openPalette();
    await measure(`${label}-palette`, ".command-palette");
    await capture(`${label}-palette`);
    await closePalette();
    await paletteCommand("review");
    await click('[data-testid="local-review"] [role="tab"][data-review-scope="git"]');
    await until(`(()=>{const review=document.querySelector('[data-testid="local-review"]');const oldLine=review?.querySelector('.local-review__line--removed[data-review-old-line="2"]');const newLine=review?.querySelector('.local-review__line--added[data-review-new-line="2"]');return Boolean(review?.dataset.reviewScope==='git'&&review.querySelector('[data-review-file="tracked.txt"][data-review-stale="false"]')&&review.querySelector('.local-review__toolbar > button')?.disabled===false&&oldLine?.textContent.includes('old value')&&newLine?.textContent.includes('newer value'))})()`);
    const lines = await renderer.evaluate(`(()=>{const oldLine=document.querySelector('.local-review__line--removed[data-review-old-line="2"]');const newLine=document.querySelector('.local-review__line--added[data-review-new-line="2"]');return {old:oldLine?.dataset.reviewOldLine,new:newLine?.dataset.reviewNewLine}})()`);
    assert.deepEqual(lines, { old: "2", new: "2" });
    const stress = style === "orbit" && width === 1440;
    const oldLine = '.local-review__line--removed[data-review-old-line="2"]';
    await pressPointer(await preparePointer(`${label}-select-old`, oldLine));
    if (stress) {
      const contextLine = '.local-review__line--context[data-review-old-line="4"]';
      await pressPointer(await preparePointer(`${label}-extend-selection`, contextLine), 8);
      await until('document.querySelector(".local-review__selection code")?.textContent.length>300');
      const quote = await renderer.evaluate(`(()=>{const el=document.querySelector('.local-review__selection code');return {length:el.textContent.length,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}})()`);
      assert.ok(quote.scrollHeight > quote.clientHeight, JSON.stringify(quote));
      measurements.push({ name: `${label}-long-quote`, ...quote });
    }
    const count = stress ? 7 : 2;
    const comments = Array.from({ length: count }, (_, index) => `GEOMETRY_${style}_${width}_${index}`);
    await fill("[data-testid=local-review-comment-input]", comments[0]);
    if (stress) await renderer.evaluate('document.querySelector(".review-panel").scrollTop=0;true');
    const firstAdd = await preparePointer(`${label}-add-0`, "[data-testid=local-review-add-comment]");
    if (stress) {
      const geometry = measurements.at(-1);
      assert.ok(geometry.before.panel.height > geometry.before.panel.client && geometry.panel.top > geometry.before.panel.top, JSON.stringify(geometry));
    }
    await measure(`${label}-review`, "[data-testid=local-review]");
    await capture(`${label}-review`);
    await pressPointer(firstAdd);
    await until(`document.querySelector('[data-testid=local-review-pending]')?.textContent.includes(${JSON.stringify(comments[0])})`);
    for (let index = 1; index < count; index++) {
      await pressPointer(await preparePointer(`${label}-select-${index}`, oldLine));
      await fill("[data-testid=local-review-comment-input]", comments[index]);
      await pressPointer(await preparePointer(`${label}-add-${index}`, "[data-testid=local-review-add-comment]"));
      await until(`document.querySelectorAll('[data-review-pending-path="tracked.txt"]').length===${index + 1}`);
    }
    if (stress) {
      const lastRemove = '[data-review-pending-path="tracked.txt"]:last-child button';
      const point = await preparePointer(`${label}-pending-last-remove`, lastRemove);
      const geometry = measurements.at(-1);
      assert.ok(geometry.pending.height > geometry.pending.client && geometry.pending.top > 0, JSON.stringify(geometry));
      await capture(`${label}-review-pending-bottom`);
      await pressPointer(point);
      await until(`document.querySelectorAll('[data-review-pending-path="tracked.txt"]').length===${count - 1}`);
      removedDraftTexts.push(comments.pop());
      await renderer.evaluate('document.querySelector(".review-panel").scrollTop=0;true');
    }
    const submit = await preparePointer(`${label}-submit`, "[data-testid=local-review-submit]");
    if (stress) {
      const geometry = measurements.at(-1);
      assert.ok(geometry.before.panel.height > geometry.before.panel.client && geometry.panel.top > geometry.before.panel.top, JSON.stringify(geometry));
      assert.ok(geometry.before.pending.top > geometry.pending.top, JSON.stringify(geometry));
      await capture(`${label}-review-pending-submit`);
    }
    await pressPointer(submit);
    await until('!document.querySelector("[data-testid=local-review-pending]")');
    expectedDraftTexts.push(...comments);
    await until(`window.mingshen.getComposerDraft(${JSON.stringify(primary.id)}).then(d=>${JSON.stringify(expectedDraftTexts)}.every(text=>d?.text.includes(text)))`);
    const persisted = await api("getComposerDraft", primary.id);
    assert.ok(expectedDraftTexts.every((text) => persisted.text.includes(text)));
    assert.ok(removedDraftTexts.every((text) => !persisted.text.includes(text)));
    assert.deepEqual(persisted.attachments.map((item) => item.name), ["review-fixture.txt"]);
    assert.deepEqual(await api("getSessionMessages", primary.id), messagesBefore);
  }
  passed.push("Palette and loaded review screenshots cover Simple and Orbit at 1440/800 with Chinese/English and day/night combinations; real pointer clicks submit comments without obscuring the execution area.");
  passed.push("The Orbit 1440 review scrolls to a long selected quote, seven pending comments, the last remove control and the submit button; six comments persist in the existing attachment-bearing draft.");
  assert.equal(requests.length, 1);
  assert.deepEqual(exceptions, []);
  assert.deepEqual(serviceErrors, []);
} catch (cause) {
  failure = cause;
  if (renderer) await capture("failure").catch(() => undefined);
  console.error(JSON.stringify({ passed, resultPath: await saveResult(false, cause), body: await renderer?.evaluate("document.body.innerText").catch(() => null) }, null, 2));
  throw cause;
} finally {
  const cleanupErrors = [];
  if (child) {
    const owned = child;
    const ended = owned.exitCode !== null || owned.signalCode !== null ? Promise.resolve() : new Promise((done) => owned.once("exit", done));
    if (terminalMayExist && renderer && primary) {
      try {
        await withTimeout(
          renderer.evaluate(`(async()=>{const terminals=await window.mingshen.listTerminals(${JSON.stringify(primary.id)});for(const terminal of terminals)await window.mingshen.stopTerminal(terminal.id);return {observed:terminals.length>0,empty:(await window.mingshen.listTerminals(${JSON.stringify(primary.id)})).length===0}})()`).then((result) => {
            if (!result.empty || (!terminalStarted && !result.observed)) throw new Error("Terminal creation or cleanup was not confirmed");
          }),
          8_000,
          "Terminal cleanup timed out",
        );
        terminalMayExist = false;
      } catch (cause) {
        cleanupErrors.push(`Terminal cleanup was not confirmed: ${String(cause)}`);
      }
    } else if (terminalMayExist) {
      cleanupErrors.push("Terminal cleanup was not confirmed because the renderer is unavailable");
    }
    await renderer?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),50);true').catch(() => {});
    await withTimeout(ended, 8_000, "Graceful Electron shutdown timed out").catch(() => undefined);
    renderer?.close();
    main?.close();
    if (owned.exitCode === null && owned.signalCode === null) {
      if (process.platform === "win32") {
        await new Promise((done) => execFile(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(owned.pid), "/T", "/F"], { windowsHide: true, timeout: 5_000 }, (error) => {
          if (error && owned.exitCode === null && owned.signalCode === null) cleanupErrors.push(`Electron tree cleanup failed: ${String(error)}`);
          done();
        }));
      } else {
        owned.kill();
      }
      await withTimeout(ended, 5_000, "Electron tree shutdown timed out").catch(() => undefined);
    }
    if (owned.exitCode === null && owned.signalCode === null) cleanupErrors.push("Owned Electron did not exit");
  }
  server.closeAllConnections();
  if (server.listening) await new Promise((done) => server.close(done));
  const local = relative(resolve(tmpdir()), resolve(temporary));
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local), "Unsafe cleanup path");
  if (cleanupErrors.length) {
    const cleanupFailure = new Error(`${cleanupErrors.join("; ")}. Fixture retained at ${temporary}${failure ? `; original failure: ${String(failure)}` : ""}`);
    await saveResult(false, cleanupFailure).catch(() => undefined);
    throw cleanupFailure;
  }
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
console.log(JSON.stringify({ passed, screenshots, measurements, requestCount: requests.length, resultPath: await saveResult(true) }, null, 2));
