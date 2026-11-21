import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const desktop = resolve("apps/desktop");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-chat-group-create-"));
const profile = join(temporary, "profile");
const evidence = resolve(".impeccable/review", `v134-chat-group-create-${Date.now()}`);
const passed = [];
const rendererExceptions = [];
const serverErrors = [];
const modelRequests = [];
const screenshots = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const longGroupName =
  "国际化产品研究发布材料跨团队评审工作区 / International Release Review";
const expectedCreateChannel = "session:create-in-chat-group";

let child;
let main;
let renderer;
let rendererPort;

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    modelRequests.push({
      url: request.url,
      method: request.method,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end("Unexpected model request in ChatAgent create smoke.");
  } catch (cause) {
    serverErrors.push(cause instanceof Error ? cause.stack : String(cause));
    if (!response.headersSent) response.writeHead(500);
    response.end("Fixture error.");
  }
});

async function availablePort() {
  const probe = createPortServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", done);
  });
  const port = probe.address().port;
  await new Promise((done, reject) => probe.close((cause) => (cause ? reject(cause) : done())));
  return port;
}

async function connect(port, surface) {
  let target;
  for (let index = 0; index < 200; index++) {
    try {
      target = (await fetch(`http://127.0.0.1:${port}/json`).then((value) => value.json())).find(
        (item) => item.webSocketDebuggerUrl && (surface !== "renderer" || item.type === "page"),
      );
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
    const value = JSON.parse(String(event.data));
    if (surface === "renderer" && value.method === "Runtime.exceptionThrown") {
      rendererExceptions.push(
        value.params.exceptionDetails.exception?.description ||
          value.params.exceptionDetails.text ||
          "Unknown renderer exception",
      );
    }
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id);
    clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
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
    await sleep(70);
  }
  throw new Error(`Timed out: ${expression}${lastError ? ` (${lastError})` : ""}`);
}

const api = (name, ...args) =>
  renderer.evaluate(
    `window.mingshen.${name}(${args.map((value) => JSON.stringify(value)).join(",")})`,
  );

async function click(selector) {
  const target = `(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    if(!element||element.disabled)return false;
    const rect=element.getBoundingClientRect();
    if(rect.width<1||rect.height<1)return false;
    element.click();
    return true;
  })()`;
  await until(target);
}

async function fill(selector, value) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)});
    const prototype=input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,"value").set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event("input",{bubbles:true}));
    return true;
  })()`);
}

async function viewport(width, height) {
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await renderer.evaluate('window.dispatchEvent(new Event("resize"));true');
  await sleep(180);
}

async function ensureChatMode() {
  await until('Boolean(document.querySelector("[data-testid=agent-mode-chat]"))');
  if ((await renderer.evaluate('document.querySelector(".app-shell")?.dataset.agentMode')) !== "chat") {
    await click('[data-testid="agent-mode-chat"]');
  }
  await until(
    'document.querySelector(".app-shell")?.dataset.agentMode==="chat"&&Boolean(document.querySelector("[data-testid=chat-sidebar]"))',
  );
}

async function ensureChatSidebar(open = true) {
  await ensureChatMode();
  await until('Boolean(document.querySelector(".chat-sidebar-host"))');
  const currentlyOpen = await renderer.evaluate(
    '!document.querySelector(".chat-sidebar-host")?.hidden',
  );
  if (currentlyOpen !== open) await click(".app-topbar .sidebar-toggle");
  await until(
    `document.querySelector(".chat-sidebar-host")?.hidden===${JSON.stringify(!open)}`,
  );
}

async function capture(name, width = 1440, height = 900) {
  await viewport(width, height);
  await ensureChatSidebar(true);
  await sleep(180);
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
  return path;
}

async function chatIds() {
  const page = await api("listSessionPage", { agentMode: "chat", limit: 100 });
  return page.sessions.map((session) => session.id);
}

async function selectedId() {
  return renderer.evaluate(
    'document.querySelector(".chat-session-row--selected")?.dataset.sessionId??null',
  );
}

async function waitForNewSelection(previousIds) {
  await until(`(()=>{
    const id=document.querySelector(".chat-session-row--selected")?.dataset.sessionId;
    return Boolean(id)&&!${JSON.stringify(previousIds)}.includes(id);
  })()`);
  return selectedId();
}

async function clickGroupNew(groupId) {
  const selector = `section[data-chat-group-id="${groupId ?? ""}"] [data-testid="chat-group-new"]`;
  await click(selector);
  return selector;
}

async function assertNoNewChatDialog(label) {
  assert.equal(
    await renderer.evaluate('Boolean(document.querySelector("[data-testid=new-chat-dialog]"))'),
    false,
    `${label}: the complete new-chat dialog must not open`,
  );
}

async function createDefaultProviderFixtures() {
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const providerA = await api("createProvider", {
    name: "Chat group primary fixture",
    baseUrl,
    protocol: "openai_responses",
    authMode: "bearer",
    apiKey: "synthetic-chat-group-primary",
    keyLabel: "Synthetic fixture",
    neverReveal: true,
  });
  const providerAModels = await api("createModel", {
    providerId: providerA.id,
    modelId: "chat-default-fixture",
    displayName: "Chat default fixture",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: ["low", "high"],
    anthropicNoneBehavior: "disabled",
  });
  const defaultModel = providerAModels.models.find(
    (model) => model.modelId === "chat-default-fixture",
  );
  assert.ok(defaultModel);

  const providerAOtherModels = await api("createModel", {
    providerId: providerA.id,
    modelId: "chat-other-fixture",
    displayName: "Chat other fixture",
    contextWindow: 128000,
    maxOutputTokens: 8192,
    inputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: ["low", "high"],
    anthropicNoneBehavior: "disabled",
  });
  const otherModel = providerAOtherModels.models.find(
    (model) => model.modelId === "chat-other-fixture",
  );
  assert.ok(otherModel);

  const providerB = await api("createProvider", {
    name: "Chat group latest fixture",
    baseUrl,
    protocol: "openai_responses",
    authMode: "bearer",
    apiKey: "synthetic-chat-group-latest",
    keyLabel: "Synthetic fixture",
    neverReveal: true,
  });
  const providerBModels = await api("createModel", {
    providerId: providerB.id,
    modelId: "chat-latest-fixture",
    displayName: "Chat latest fixture",
    contextWindow: 200000,
    maxOutputTokens: 12000,
    inputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: ["low", "high"],
    anthropicNoneBehavior: "disabled",
  });
  const latestModel = providerBModels.models.find(
    (model) => model.modelId === "chat-latest-fixture",
  );
  assert.ok(latestModel);

  const providerBCompaction = await api("createModel", {
    providerId: providerB.id,
    modelId: "chat-compaction-fixture",
    displayName: "Chat compaction fixture",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const compactionModel = providerBCompaction.models.find(
    (model) => model.modelId === "chat-compaction-fixture",
  );
  assert.ok(compactionModel);

  const providerC = await api("createProvider", {
    name: "Chat group invalid fixture",
    baseUrl,
    protocol: "openai_responses",
    authMode: "bearer",
    apiKey: "synthetic-chat-group-invalid",
    keyLabel: "Synthetic fixture",
    neverReveal: true,
  });
  const providerCModels = await api("createModel", {
    providerId: providerC.id,
    modelId: "chat-invalid-fixture",
    displayName: "Chat invalid fixture",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const invalidModel = providerCModels.models.find(
    (model) => model.modelId === "chat-invalid-fixture",
  );
  assert.ok(invalidModel);

  return {
    providerA,
    defaultModel,
    otherModel,
    providerB,
    latestModel,
    compactionModel,
    providerC,
    invalidModel,
  };
}

async function installCreateHandlerFixture() {
  await main.evaluate(`(()=>{
    if(globalThis.__chatCreateInstalled)return true;
    const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json");
    const ipcMain=require("electron").ipcMain;
    const handlers=ipcMain._invokeHandlers;
    const original=handlers.get(${JSON.stringify(expectedCreateChannel)});
    if(typeof original!=="function")throw new Error("Missing create-in-group handler");
    globalThis.__chatCreateOriginal=original;
    globalThis.__chatCreateCalls=0;
    globalThis.__chatCreateGate=null;
    globalThis.__chatCreateRelease=null;
    handlers.set(${JSON.stringify(expectedCreateChannel)},async(...args)=>{
      globalThis.__chatCreateCalls+=1;
      if(globalThis.__chatCreateGate)await globalThis.__chatCreateGate;
      return globalThis.__chatCreateOriginal(...args);
    });
    globalThis.__chatCreateHold=()=>{
      globalThis.__chatCreateCalls=0;
      globalThis.__chatCreateGate=new Promise(resolve=>{globalThis.__chatCreateRelease=resolve;});
    };
    globalThis.__chatCreateOpen=()=>{
      const release=globalThis.__chatCreateRelease;
      globalThis.__chatCreateGate=null;
      globalThis.__chatCreateRelease=null;
      if(release)release();
    };
    globalThis.__chatCreateRestore=()=>{
      handlers.set(${JSON.stringify(expectedCreateChannel)},globalThis.__chatCreateOriginal);
      globalThis.__chatCreateInstalled=false;
    };
    globalThis.__chatCreateInstalled=true;
    return true;
  })()`);
}

async function holdCreate() {
  await main.evaluate("globalThis.__chatCreateHold();true");
}

async function releaseCreate() {
  await main.evaluate("globalThis.__chatCreateOpen();true");
}

async function createCalls() {
  return main.evaluate("globalThis.__chatCreateCalls");
}

async function restoreCreateHandler() {
  await main.evaluate("globalThis.__chatCreateRestore();true");
}

async function assertLongGroupGeometry(label) {
  const state = await renderer.evaluate(`(async()=>{
    const sidebar=document.querySelector(".chat-sidebar");
    const longHeading=[...document.querySelectorAll("[data-chat-group-id] .chat-session-group__heading")]
      .find(element=>element.title===${JSON.stringify(longGroupName)});
    const section=longHeading?.closest("[data-chat-group-id]");
    if(!sidebar||!longHeading||!section)return null;
    longHeading.scrollIntoView({block:"center",inline:"nearest"});
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    const heading=longHeading;
    const header=section.querySelector(".chat-session-group__header");
    const controls=[...header.querySelectorAll("button")];
    const box=element=>{
      const rect=element.getBoundingClientRect();
      const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
      return {
        left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,
        width:rect.width,height:rect.height,
        foreground:Boolean(hit&&element.contains(hit)),
      };
    };
    const titleSpan=heading.querySelector("span");
    return {
      viewport:{width:innerWidth,height:innerHeight},
      overflow:document.documentElement.scrollWidth>innerWidth+2,
      sidebar:box(sidebar),
      heading:box(heading),
      controls:controls.map(box),
      headingTitle:heading.title,
      titleText:titleSpan?.textContent,
      titleClientWidth:titleSpan?.clientWidth??0,
      titleScrollWidth:titleSpan?.scrollWidth??0,
      textOverflow:titleSpan?getComputedStyle(titleSpan).textOverflow:null,
      whiteSpace:titleSpan?getComputedStyle(titleSpan).whiteSpace:null,
    };
  })()`);
  assert.ok(state, `${label}: long group header is missing`);
  assert.equal(state.overflow, false, `${label}: page has horizontal overflow`);
  assert.equal(state.headingTitle, longGroupName, `${label}: full group name must remain in title`);
  assert.equal(state.textOverflow, "ellipsis", `${label}: group title must ellipsize`);
  assert.equal(state.whiteSpace, "nowrap", `${label}: group title must stay on one line`);
  assert.ok(
    state.titleScrollWidth > state.titleClientWidth,
    `${label}: fixture group title should exercise ellipsis (${JSON.stringify(state)})`,
  );
  assert.equal(state.controls.length, 4, `${label}: group heading and three actions expected`);
  assert.ok(
    state.heading.width >= 1 && state.heading.height >= 1,
    `${label}: group heading is not visible`,
  );
  assert.ok(
    state.controls.every(
      (control) =>
        control.width >= 30 &&
        control.height >= 30 &&
        control.foreground &&
        control.left >= state.sidebar.left - 1 &&
        control.right <= state.sidebar.right + 1 &&
        control.top >= state.sidebar.top - 1 &&
        control.bottom <= state.sidebar.bottom + 1,
    ),
    `${label}: a group action is clipped or not pointer-reachable (${JSON.stringify(state)})`,
  );
  const ordered = state.controls;
  for (let index = 1; index < ordered.length; index++) {
    assert.ok(
      ordered[index - 1].right <= ordered[index].left + 1,
      `${label}: group heading and actions overlap (${JSON.stringify(state)})`,
    );
  }
}

async function applyPresentation({ locale, theme, style }) {
  await renderer.evaluate(`(async()=>{
    await window.mingshen.desktopAction("locale",${JSON.stringify(locale)});
    const preferences=await window.mingshen.getUiPreferences();
    await window.mingshen.saveUiPreferences({...preferences,interfaceStyle:${JSON.stringify(style)}});
    localStorage.setItem("mingshen.locale",${JSON.stringify(locale)});
    localStorage.setItem("mingshen.theme",${JSON.stringify(theme)});
    globalThis.__chatGroupReloadPending=true;
    return true;
  })()`);
  await renderer.send("Page.reload");
  await until(`globalThis.__chatGroupReloadPending===undefined&&
    document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}&&
    Boolean(document.querySelector(".app-shell"))`);
  await ensureChatMode();
  await ensureChatSidebar(true);
}

async function assertNoUnexpectedRequests(label) {
  assert.equal(modelRequests.length, 0, `${label}: unexpected model request(s)`);
  assert.deepEqual(serverErrors, [], `${label}: fixture server errors`);
}

async function close() {
  if (!child) return;
  const current = child;
  const ended =
    current.exitCode !== null ? Promise.resolve() : new Promise((done) => current.once("exit", done));
  await renderer
    ?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true')
    .catch(() => {});
  await renderer?.close().catch(() => {});
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
  child = renderer = main = undefined;
}

async function writeResult(success, failure = null) {
  const resultPath = join(evidence, success ? "result.json" : "failure.json");
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        version,
        success,
        passed,
        modelRequests,
        rendererExceptions,
        serverErrors,
        screenshots,
        ...(failure
          ? { failure: failure instanceof Error ? (failure.stack ?? failure.message) : String(failure) }
          : {}),
        boundaries: [
          "Synthetic local provider configuration, isolated Electron profile and owned local HTTP fixture.",
          "No message is sent to a model; zero network requests is a hard assertion.",
          "Layout coverage is Chromium CDP viewport geometry at 1440x900 and 800x900, not the complete Windows DPI/accessibility matrix.",
          "No installer, update, cloud write, user profile, user database or real API key is used.",
        ],
      },
      null,
      2,
    ),
  );
  return resultPath;
}

try {
  await mkdir(evidence, { recursive: true });
  execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], {
    cwd: resolve("."),
    windowsHide: true,
    stdio: "pipe",
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
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
    globalThis.__chatGroupOriginalFetch=fetch;
    globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")
      ?Promise.resolve(Response.json([]))
      :globalThis.__chatGroupOriginalFetch(url,options);
    return true;
  })()`);
  renderer = await connect(rendererPort, "renderer");
  await renderer.send("Runtime.enable");

  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate(
    'document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true',
  );
  for (const text of ["同意并继续", "开始使用"]) {
    const button = `[...document.querySelectorAll(".policy-dialog button")].find(button=>!button.disabled&&button.textContent.trim()===${JSON.stringify(text)})`;
    await until(`Boolean(${button})`);
    await renderer.evaluate(`${button}.click();true`);
  }
  await until('!document.querySelector(".policy-dialog")');

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
    const preferences=await window.mingshen.getUiPreferences();
    await window.mingshen.saveUiPreferences({
      ...preferences,interfaceStyle:"simple",defaultLayout:"chat"
    });
    localStorage.setItem("mingshen.locale","zh-CN");
    localStorage.setItem("mingshen.theme","day");
    return true;
  })()`);

  const fixtures = await createDefaultProviderFixtures();
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector(".app-shell"))');
  await ensureChatMode();
  await ensureChatSidebar(true);

  assert.equal((await chatIds()).length, 0);
  let before = await chatIds();
  await click('[data-testid="new-chat"]');
  const defaultFromTop = await waitForNewSelection(before);
  const topSession = await api("getSession", defaultFromTop);
  assert.equal(topSession.providerId, fixtures.providerA.id);
  assert.equal(topSession.modelId, fixtures.defaultModel.id);
  assert.equal(topSession.chatGroupId, null);
  assert.deepEqual(await api("getSessionMessages", topSession.id), []);
  await assertNoNewChatDialog("top new chat");
  passed.push("No-chat state: the top plus creates directly with the first enabled text model and no dialog");

  await api("removeSession", topSession.id);
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector(".app-shell"))');
  await ensureChatMode();
  await ensureChatSidebar(true);
  assert.equal((await chatIds()).length, 0);
  before = await chatIds();
  await click(".chat-view--empty .empty-work button");
  const defaultFromEmpty = await waitForNewSelection(before);
  const emptyStateSession = await api("getSession", defaultFromEmpty);
  assert.equal(emptyStateSession.providerId, fixtures.providerA.id);
  assert.equal(emptyStateSession.modelId, fixtures.defaultModel.id);
  assert.deepEqual(await api("getSessionMessages", emptyStateSession.id), []);
  await assertNoNewChatDialog("empty-state new chat");
  passed.push("No-chat state: the empty-state action creates directly with the same default model");

  await api("removeSession", emptyStateSession.id);
  const currentGroup = await api("createChatGroup", "Current release research");
  const otherGroup = await api("createChatGroup", "Other active research");
  const emptyGroup = await api("createChatGroup", "Empty fallback research");
  const invalidGroup = await api("createChatGroup", "Invalid template research");
  const longGroup = await api("createChatGroup", longGroupName);

  const olderPinned = await api("createSession", {
    title: "Older pinned template",
    providerId: fixtures.providerA.id,
    modelId: fixtures.defaultModel.id,
    agentMode: "chat",
    chatGroupId: currentGroup.id,
    workspacePath: null,
    systemPrompt: "OLDER_PINNED_TEMPLATE",
    reasoningLevel: "low",
    permissionMode: "request_approval",
  });
  await api("updateSession", { sessionId: olderPinned.id, pinned: true });
  await sleep(25);

  const latestCurrent = await api("createSession", {
    title: "Latest current-group template",
    providerId: fixtures.providerB.id,
    modelId: fixtures.latestModel.id,
    agentMode: "chat",
    chatGroupId: currentGroup.id,
    workspacePath: null,
    systemPrompt: "LATEST_CURRENT_TEMPLATE",
    reasoningLevel: "high",
    permissionMode: "request_approval",
    compactionModel: {
      mode: "custom",
      providerId: fixtures.providerB.id,
      modelId: fixtures.compactionModel.id,
    },
  });
  await sleep(25);

  const otherSource = await api("createSession", {
    title: "Other-group template",
    providerId: fixtures.providerA.id,
    modelId: fixtures.otherModel.id,
    agentMode: "chat",
    chatGroupId: otherGroup.id,
    workspacePath: null,
    systemPrompt: "OTHER_GROUP_TEMPLATE",
    reasoningLevel: "low",
    permissionMode: "request_approval",
  });
  await sleep(25);

  await api("createSession", {
    title: "Invalid group older valid",
    providerId: fixtures.providerA.id,
    modelId: fixtures.defaultModel.id,
    agentMode: "chat",
    chatGroupId: invalidGroup.id,
    workspacePath: null,
    systemPrompt: "INVALID_OLDER_VALID",
    reasoningLevel: "low",
    permissionMode: "request_approval",
  });
  await sleep(25);
  const invalidLatest = await api("createSession", {
    title: "Invalid group latest template",
    providerId: fixtures.providerC.id,
    modelId: fixtures.invalidModel.id,
    agentMode: "chat",
    chatGroupId: invalidGroup.id,
    workspacePath: null,
    systemPrompt: "INVALID_LATEST_TEMPLATE",
    reasoningLevel: null,
    permissionMode: "request_approval",
  });
  await api("removeModel", fixtures.invalidModel.id);
  await sleep(25);

  const ungroupedSource = await api("createSession", {
    title: "Ungrouped template",
    providerId: fixtures.providerA.id,
    modelId: fixtures.otherModel.id,
    agentMode: "chat",
    chatGroupId: null,
    workspacePath: null,
    systemPrompt: "UNGROUPED_TEMPLATE",
    reasoningLevel: "high",
    permissionMode: "request_approval",
  });
  await sleep(25);
  const archivedSource = await api("createSession", {
    title: "Archived newest excluded template",
    providerId: fixtures.providerA.id,
    modelId: fixtures.defaultModel.id,
    agentMode: "chat",
    chatGroupId: otherGroup.id,
    workspacePath: null,
    systemPrompt: "ARCHIVED_TEMPLATE_MUST_NOT_BE_USED",
    reasoningLevel: "low",
    permissionMode: "request_approval",
  });
  await api("updateSession", { sessionId: archivedSource.id, archived: true });

  await api("saveComposerDraft", {
    sessionId: latestCurrent.id,
    baseRevision: null,
    revision: "chat-group-source-draft",
    text: "SOURCE_TEMPLATE_DRAFT_MUST_NOT_COPY",
    formatted: false,
    attachmentIds: ["source-attachment"],
    addedAttachments: [
      {
        id: "source-attachment",
        name: "source-only.png",
        mimeType: "image/png",
        size: 68,
        kind: "image",
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl6sAAAAASUVORK5CYII=",
      },
    ],
    notificationDraftIds: [],
  });

  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector(".app-shell"))');
  await ensureChatMode();
  await ensureChatSidebar(true);
  assert.ok((await chatIds()).length >= 6);

  before = await chatIds();
  await clickGroupNew(emptyGroup.id);
  const emptyFallbackId = await waitForNewSelection(before);
  const emptyFallback = await api("getSession", emptyFallbackId);
  assert.equal(emptyFallback.chatGroupId, emptyGroup.id);
  assert.equal(emptyFallback.providerId, ungroupedSource.providerId);
  assert.equal(emptyFallback.modelId, ungroupedSource.modelId);
  assert.equal(emptyFallback.systemPrompt, "UNGROUPED_TEMPLATE");
  assert.equal(emptyFallback.reasoningLevel, "high");
  assert.notEqual(emptyFallback.systemPrompt, "ARCHIVED_TEMPLATE_MUST_NOT_BE_USED");
  assert.deepEqual(await api("getSessionMessages", emptyFallback.id), []);
  assert.equal(await api("getComposerDraft", emptyFallback.id), null);
  await assertNoNewChatDialog("empty group fallback");
  passed.push(
    "Empty group: falls back to the latest non-archived Chat, excludes archived newest data, and copies no messages/draft",
  );

  const currentSection = `section[data-chat-group-id="${currentGroup.id}"]`;
  await renderer.evaluate(`(()=>{
    const heading=document.querySelector(${JSON.stringify(`${currentSection} .chat-session-group__heading`)});
    if(heading?.getAttribute("aria-expanded")==="true")heading.click();
    return true;
  })()`);
  await until(
    `document.querySelector(${JSON.stringify(`${currentSection} .chat-session-group__heading`)})?.getAttribute("aria-expanded")==="false"`,
  );
  await fill(".chat-sidebar__search input", "NO_MATCHING_CHAT_SHOULD_REMAIN");
  await until(
    'document.querySelector(".chat-sidebar__search input")?.value==="NO_MATCHING_CHAT_SHOULD_REMAIN"',
  );

  await installCreateHandlerFixture();
  await holdCreate();
  before = await chatIds();
  await renderer.evaluate(`(()=>{
    const button=document.querySelector(${JSON.stringify(`${currentSection} [data-testid="chat-group-new"]`)});
    if(!button)throw new Error("Missing current-group create button");
    button.click();
    button.click();
    return true;
  })()`);
  await until(
    `document.querySelector(${JSON.stringify(`${currentSection} [data-testid="chat-group-new"]`)})?.getAttribute("aria-busy")==="true"`,
  );
  assert.equal(
    await renderer.evaluate(
      `document.querySelector(${JSON.stringify(`${currentSection} [data-testid="chat-group-new"]`)})?.disabled`,
    ),
    true,
  );
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-testid=new-chat]")?.disabled'),
    true,
  );
  assert.equal(await createCalls(), 1, "Rapid double activation must call the create IPC once");
  await releaseCreate();
  const currentCreatedId = await waitForNewSelection(before);
  const currentCreated = await api("getSession", currentCreatedId);
  assert.equal(currentCreated.chatGroupId, currentGroup.id);
  assert.equal(currentCreated.providerId, fixtures.providerB.id);
  assert.equal(currentCreated.modelId, fixtures.latestModel.id);
  assert.equal(currentCreated.systemPrompt, "LATEST_CURRENT_TEMPLATE");
  assert.equal(currentCreated.reasoningLevel, "high");
  assert.deepEqual(currentCreated.compactionModel, {
    mode: "custom",
    providerId: fixtures.providerB.id,
    modelId: fixtures.compactionModel.id,
  });
  assert.notEqual(currentCreated.providerId, olderPinned.providerId);
  assert.notEqual(currentCreated.systemPrompt, "OLDER_PINNED_TEMPLATE");
  assert.deepEqual(await api("getSessionMessages", currentCreated.id), []);
  assert.equal(await api("getComposerDraft", currentCreated.id), null);
  const sourceDraft = await api("getComposerDraft", latestCurrent.id);
  assert.equal(sourceDraft.text, "SOURCE_TEMPLATE_DRAFT_MUST_NOT_COPY");
  assert.deepEqual(
    sourceDraft.attachments.map((attachment) => attachment.name),
    ["source-only.png"],
  );
  assert.equal(
    await renderer.evaluate('document.querySelector(".chat-sidebar__search input")?.value'),
    "",
  );
  assert.equal(
    await renderer.evaluate(
      `document.querySelector(${JSON.stringify(`${currentSection} .chat-session-group__heading`)})?.getAttribute("aria-expanded")`,
    ),
    "true",
  );
  await assertNoNewChatDialog("current-group create");
  passed.push(
    "Current group: newest updatedAt template wins over pinned older data; model/settings inherit while history/draft/attachments stay isolated",
  );
  passed.push(
    "Current group: collapsed/search state is reset, loading disables all create controls, and double activation creates once",
  );

  before = await chatIds();
  await clickGroupNew(otherGroup.id);
  const otherCreatedId = await waitForNewSelection(before);
  const otherCreated = await api("getSession", otherCreatedId);
  assert.equal(otherCreated.chatGroupId, otherGroup.id);
  assert.equal(otherCreated.providerId, otherSource.providerId);
  assert.equal(otherCreated.modelId, otherSource.modelId);
  assert.equal(otherCreated.systemPrompt, "OTHER_GROUP_TEMPLATE");
  await assertNoNewChatDialog("other-group create");
  passed.push("Other group: later updates in a different group do not change its own template source");

  before = await chatIds();
  await clickGroupNew(null);
  const ungroupedCreatedId = await waitForNewSelection(before);
  const ungroupedCreated = await api("getSession", ungroupedCreatedId);
  assert.equal(ungroupedCreated.chatGroupId, null);
  assert.equal(ungroupedCreated.providerId, ungroupedSource.providerId);
  assert.equal(ungroupedCreated.modelId, ungroupedSource.modelId);
  assert.equal(ungroupedCreated.systemPrompt, "UNGROUPED_TEMPLATE");
  await assertNoNewChatDialog("ungrouped create");
  passed.push("Ungrouped heading plus: uses the latest ungrouped Chat rather than a newer grouped Chat");

  await viewport(800, 900);
  await ensureChatSidebar(true);
  await holdCreate();
  const countBeforeInvalid = (await chatIds()).length;
  const invalidSelector = `section[data-chat-group-id="${invalidGroup.id}"] [data-testid="chat-group-new"]`;
  await click(invalidSelector);
  await until(
    `document.querySelector(${JSON.stringify(invalidSelector)})?.getAttribute("aria-busy")==="true"`,
  );
  await ensureChatSidebar(false);
  assert.equal(
    await renderer.evaluate('document.querySelector(".chat-sidebar-host")?.hidden'),
    true,
  );
  await releaseCreate();
  await until('!document.querySelector(".chat-sidebar-host")?.hidden');
  await until('Boolean(document.querySelector(".chat-sidebar__error"))');
  const invalidError = await renderer.evaluate(
    'document.querySelector(".chat-sidebar__error")?.textContent??""',
  );
  assert.match(invalidError, /已失效/);
  assert.equal((await chatIds()).length, countBeforeInvalid);
  await assertNoNewChatDialog("invalid template");
  await capture("invalid-template-800-zh-day", 800, 900);
  await restoreCreateHandler();
  passed.push(
    "Invalid template: fails visibly without a fallback session or dialog; a narrow-screen drawer reopens to reveal the error",
  );

  const recoveredProvider = await api("createModel", {
    providerId: fixtures.providerC.id,
    modelId: "chat-invalid-fixture",
    displayName: "Chat invalid fixture restored",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const recoveredModel = recoveredProvider.models.find(
    (model) => model.modelId === "chat-invalid-fixture",
  );
  assert.ok(recoveredModel);
  await api("updateSession", {
    sessionId: invalidLatest.id,
    providerId: fixtures.providerC.id,
    modelId: recoveredModel.id,
  });
  before = await chatIds();
  await click(invalidSelector);
  const recoveredCreatedId = await waitForNewSelection(before);
  const recoveredCreated = await api("getSession", recoveredCreatedId);
  assert.equal(recoveredCreated.chatGroupId, invalidGroup.id);
  assert.equal(recoveredCreated.providerId, fixtures.providerC.id);
  assert.equal(recoveredCreated.modelId, recoveredModel.id);
  assert.equal(recoveredCreated.systemPrompt, "INVALID_LATEST_TEMPLATE");
  await until('!document.querySelector(".chat-sidebar__error")');
  assert.equal(
    await renderer.evaluate('document.querySelector(".chat-sidebar-host")?.hidden'),
    true,
  );
  await assertNoNewChatDialog("recovered invalid template");
  passed.push(
    "Invalid template recovery: repairing the latest source allows an explicit retry and clears the visible error",
  );

  for (const style of ["simple", "orbit"]) {
    for (const locale of ["zh-CN", "en"]) {
      for (const theme of ["day", "night"]) {
        await applyPresentation({ locale, theme, style });
        await viewport(1440, 900);
        await ensureChatSidebar(true);
        await assertLongGroupGeometry(`${style} ${locale} ${theme} 1440x900`);
        await capture(`${style}-${locale}-${theme}-1440`, 1440, 900);

        await viewport(800, 900);
        await ensureChatSidebar(true);
        await assertLongGroupGeometry(`${style} ${locale} ${theme} 800x900 drawer`);
        await capture(`${style}-${locale}-${theme}-800-drawer`, 800, 900);
      }
    }
  }
  passed.push(
    "Simple and Orbit styles retain separate, pointer-reachable group title/plus/rename/delete controls in Chinese/English, day/night, and 1440/800 drawer layouts",
  );

  await assertNoUnexpectedRequests("final");
  assert.deepEqual(rendererExceptions, []);
  const resultPath = await writeResult(true);
  console.log(
    JSON.stringify(
      {
        version,
        passed,
        modelRequestCount: modelRequests.length,
        rendererExceptionCount: rendererExceptions.length,
        screenshots,
        resultPath,
      },
      null,
      2,
    ),
  );
} catch (cause) {
  const resultPath = await writeResult(false, cause).catch(() => null);
  console.error(
    JSON.stringify(
      {
        passed,
        modelRequests: modelRequests.map((request) => ({
          url: request.url,
          method: request.method,
        })),
        rendererExceptions,
        serverErrors,
        body: await renderer?.evaluate("document.body.innerText").catch(() => null),
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
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local), "Unsafe cleanup path");
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
