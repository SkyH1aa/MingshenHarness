import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  createPlugin,
  upsertMarketplace,
  validatePlugin,
} from "../apps/desktop/resources/sdk/plugin-dev/mingshen-plugin.mjs";
import { experimentalExecutable } from "./experimental-executable.mjs";

const desktop = resolve("apps/desktop");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-local-plugin-"));
const project = join(temporary, "project");
const profile = join(temporary, "profile");
const marketRoot = join(project, "local-plugin-market");
const pluginRoot = join(marketRoot, "plugins", "local-plugin-fixture");
const mcpLog = join(temporary, "local-plugin-mcp-calls.log");
const evidence = resolve(".impeccable/review", `v133-local-plugins-${Date.now()}`);
const pluginName = "local-plugin-fixture";
const marketName = "local-plugin-fixture-market";
const mainInspectPort = 9482;
const rendererDebugPort = 9481;
const pinnedSkillPromptBudgetChars = 64_000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const passed = [];
const errors = [];
const screenshots = [];
const layoutMeasurements = [];
const requests = [];
const approvals = [];
const approvalRecords = [];
const expectedDenials = [];

let child;
let mainInspector;
let renderer;
let scenario;
let held;
let workSession;
let pinnedWorkSession;
let workSources = [];
let workSourceSamples = [];
let historicalWorkSources = [];
let workPdfSources = [];
let protectedReadAudit;
let pinnedCapabilityEvidence;
let marketId;
let extensionId;
let installedPathV1;
let skillIdV1;
let skillIdV2;
let mcpToolV1;
let mcpToolV2;

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
        usage: {
          input_tokens: 2_000,
          output_tokens: 300,
          total_tokens: 2_300,
        },
      },
    })}\n\n`,
  );
};

const server = createServer(async (request, response) => {
  response.on("error", () => undefined);
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const serialized = JSON.stringify(body);
    if (
      /conversation title|\u4f1a\u8bdd\u6807\u9898\u751f\u6210/i.test(
        serialized,
      )
    ) {
      finish(response, "Local plugin verification");
      return;
    }

    requests.push(body);
    if (scenario?.hold) {
      held = response;
      return;
    }
    const step = scenario?.steps[scenario.next++];
    if (step) {
      finish(response, "", [
        {
          type: "function_call",
          name: step.name,
          arguments: JSON.stringify(step.args ?? {}),
          call_id: `local-plugin-${requests.length}-${step.name}`,
        },
      ]);
      return;
    }
    finish(response, "LOCAL_PLUGIN_FIXTURE_COMPLETE");
  } catch (error) {
    errors.push(`Responses fixture: ${String(error)}`);
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

async function connectInspector() {
  const deadline = Date.now() + 30_000;
  let target;
  while (Date.now() < deadline) {
    try {
      target = (await debuggerTargets(mainInspectPort)).find(
        (entry) => entry.webSocketDebuggerUrl,
      );
      if (target) break;
    } catch {
      // Electron inspector is not ready yet.
    }
    await sleep(100);
  }
  assert.ok(target, "Main process inspector did not start");
  return connectTarget(target, "main-process");
}

async function connectRenderer(timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const target = (await debuggerTargets(rendererDebugPort)).find(
        (entry) => entry.type === "page" && entry.webSocketDebuggerUrl,
      );
      if (target) return connectTarget(target, "renderer");
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Renderer did not start: ${String(lastError ?? "timeout")}`);
}

async function until(expression, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await renderer.evaluate(expression)) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(80);
  }
  throw new Error(
    `Timed out: ${expression}${lastError ? `\nLast evaluation error: ${String(lastError)}` : ""}`,
  );
}

function api(name, ...args) {
  return renderer.evaluate(
    `window.mingshen.${name}(${args.map((value) => JSON.stringify(value) ?? "undefined").join(",")})`,
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

async function fill(selector, value) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event("input",{bubbles:true}));
    return true;
  })()`);
}

async function selectWorkspaceSession(session) {
  const mode = session.agentMode === "work" ? "work" : "code";
  const sessionSelector = `[data-session-id="${session.id}"] .session-row`;
  await until(`Boolean(document.querySelector(${JSON.stringify(sessionSelector)}))`);
  await click(sessionSelector);
  await until(
    `document.querySelector(${JSON.stringify(sessionSelector)})?.classList.contains("session-row--selected")`,
  );
  await until(
    `String(document.querySelector(".session-row--selected")?.closest("[data-session-id]")?.dataset.sessionId)===${JSON.stringify(
      session.id,
    )}`,
  );
  await click(`[data-testid="agent-mode-${mode}"]`);
  await until(
    `document.querySelector('[data-testid="agent-mode-${mode}"]')?.getAttribute("aria-pressed")==="true"`,
  );
  await until(
    `window.mingshen.getSession(${JSON.stringify(session.id)}).then(session=>session?.agentMode===${JSON.stringify(mode)})`,
  );
}

async function waitForPaint() {
  await renderer.send("Page.bringToFront");
  await renderer.evaluate(`(async()=>{
    await document.fonts.ready;
    await Promise.race([
      Promise.all(document.getAnimations()
        .filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity)
        .map(animation=>animation.finished.catch(()=>{}))),
      new Promise(done=>setTimeout(done,2000))
    ]);
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    return true;
  })()`);
}

async function setCaptureTheme(theme) {
  const current = await renderer.evaluate(
    'document.documentElement.dataset.theme??"night"',
  );
  if (current === theme) return;
  const icon = theme === "day" ? "sun" : "moon";
  const clicked = await renderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".desktop-caption button")]
      .find(candidate=>candidate.querySelector("svg.lucide-${icon}"));
    if(!button)return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing ${theme} theme control`);
  await until(
    `document.documentElement.dataset.theme===${JSON.stringify(theme)}`,
  );
}

async function setCaptureLocale(locale) {
  const current = await renderer.evaluate(
    'localStorage.getItem("mingshen.locale")??"zh-CN"',
  );
  if (current === locale) return;
  const clicked = await renderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".desktop-caption button")]
      .find(candidate=>candidate.querySelector("svg.lucide-languages"));
    if(!button)return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing locale control for ${locale}`);
  await until(
    `localStorage.getItem("mingshen.locale")===${JSON.stringify(locale)}`,
  );
}

async function captureCurrentScreen(
  name,
  width = 1440,
  height = 960,
  options = {},
) {
  const targetSelector = options.targetSelector ?? ".approval-panel";
  const requiredSelectors = options.requiredSelectors ?? [];
  const overflowSelectors = options.overflowSelectors ?? [];
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until('document.readyState==="complete"');
  await renderer.evaluate(
    `document.querySelector(${JSON.stringify(
      targetSelector,
    )})?.scrollIntoView({block:"center",inline:"nearest"});true`,
  );
  await waitForPaint();
  const measurement = await renderer.evaluate(`(()=>{
    const visible=node=>{
      const bounds=node?.getBoundingClientRect();
      return Boolean(bounds&&bounds.width>0&&bounds.height>0&&bounds.right>0&&bounds.left<innerWidth&&bounds.bottom>0&&bounds.top<innerHeight);
    };
    const target=document.querySelector(${JSON.stringify(targetSelector)});
    const bounds=target?.getBoundingClientRect();
    const required=${JSON.stringify(requiredSelectors)}.map(selector=>({
      selector,
      present:Boolean(document.querySelector(selector)),
      visible:visible(document.querySelector(selector))
    }));
    const overflow=${JSON.stringify(overflowSelectors)}.map(selector=>{
      const node=document.querySelector(selector);
      return node?{selector,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth}:null;
    }).filter(Boolean);
    const foreground=bounds
      ?document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+bounds.height/2)
      :null;
    return {
      targetVisible:Boolean(bounds&&bounds.width>0&&bounds.height>0&&bounds.right>0&&bounds.left<innerWidth&&bounds.bottom>0&&bounds.top<innerHeight),
      targetFullyVisible:Boolean(bounds&&bounds.top>=-2&&bounds.left>=-2&&bounds.bottom<=innerHeight+2&&bounds.right<=innerWidth+2),
      foregroundWithinTarget:Boolean(target&&foreground&&target.contains(foreground)),
      documentOverflow:document.documentElement.scrollWidth>innerWidth+2,
      required,
      overflow,
      bounds:bounds?{top:bounds.top,left:bounds.left,right:bounds.right,bottom:bounds.bottom,width:bounds.width,height:bounds.height}:null
    };
  })()`);
  assert.equal(
    measurement.targetVisible,
    true,
    `Capture target is not visible: ${name} ${targetSelector}`,
  );
  if (options.requireFullyVisible) {
    assert.equal(
      measurement.targetFullyVisible,
      true,
      `Capture target is clipped: ${name} ${JSON.stringify(measurement.bounds)}`,
    );
  }
  if (options.requireForeground === true) {
    assert.equal(
      measurement.foregroundWithinTarget,
      true,
      `Capture target is occluded: ${name} ${targetSelector}`,
    );
  }
  if (options.requireNoDocumentOverflow === true) {
    assert.equal(
      measurement.documentOverflow,
      false,
      `Horizontal page overflow: ${name}`,
    );
  }
  assert.deepEqual(
    measurement.required.filter((entry) => !entry.present || !entry.visible),
    [],
    `Required capture content is missing or clipped: ${name}`,
  );
  assert.equal(
    measurement.overflow.length,
    overflowSelectors.length,
    `Capture overflow target is missing: ${name}`,
  );
  assert.deepEqual(
    measurement.overflow.filter(
      (entry) => entry.scrollWidth > entry.clientWidth + 2,
    ),
    [],
    `Internal horizontal overflow: ${name}`,
  );
  layoutMeasurements.push({
    name,
    width,
    height,
    targetSelector,
    bounds: measurement.bounds,
    required: measurement.required,
    overflow: measurement.overflow,
  });
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
}

async function capture(name, width = 1440, height = 960) {
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await until('document.readyState==="complete"');
  await renderer.evaluate(
    'document.querySelector(\'[data-testid="local-plugin-marketplace"]\')?.scrollIntoView({block:"start"});true',
  );
  await waitForPaint();
  const overflow = await renderer.evaluate(
    "document.documentElement.scrollWidth>innerWidth+2",
  );
  assert.equal(overflow, false, `Horizontal overflow: ${name}`);
  const marketBounds = await renderer.evaluate(`(()=>{
    const market=document.querySelector('[data-testid="local-plugin-marketplace"]');
    const bounds=market?.getBoundingClientRect();
    const scroller=document.querySelector('.settings-content__body');
    return bounds&&scroller?{
      top:bounds.top,bottom:bounds.bottom,height:innerHeight,
      panelWidth:scroller.clientWidth,panelScrollWidth:scroller.scrollWidth,
      marketWidth:market.clientWidth,marketScrollWidth:market.scrollWidth
    }:null;
  })()`);
  assert.ok(
    marketBounds && marketBounds.top >= 0 && marketBounds.top < marketBounds.height / 2,
    `Marketplace must be visible in the screenshot: ${name} ${JSON.stringify(marketBounds)}`,
  );
  assert.ok(
    marketBounds.panelScrollWidth <= marketBounds.panelWidth + 2 &&
      marketBounds.marketScrollWidth <= marketBounds.marketWidth + 2,
    `Marketplace must not overflow its settings pane: ${name} ${JSON.stringify(marketBounds)}`,
  );
  await until(`(()=>{
    const heading=document.querySelector('[data-testid="local-plugin-marketplace"] h3');
    const bounds=heading?.getBoundingClientRect();
    if(!bounds)return false;
    const foreground=document.elementFromPoint(bounds.left+Math.min(8,bounds.width/2),bounds.top+bounds.height/2);
    return Boolean(foreground?.closest('.settings-workspace'));
  })()`);
  layoutMeasurements.push({ name, width, height, ...marketBounds });
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64"));
  screenshots.push(path);
}

function mcpFixtureSource() {
  return `import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

input.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined || message.id === null) return;
  try {
    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "local-plugin-fixture", version: "1.0.0" }
        }
      });
      return;
    }
    if (message.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [{
            name: "echo",
            description: "Return a deterministic local plugin MCP marker.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              additionalProperties: false
            }
          }]
        }
      });
      return;
    }
    if (message.method === "tools/call") {
      const text = String(message.params?.arguments?.text ?? "");
      const logPath = process.env.LOCAL_PLUGIN_MCP_LOG;
      if (logPath) await appendFile(logPath, text + "\\n", "utf8");
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{
            type: "text",
            text: "LOCAL_PLUGIN_MCP_ECHO: " + text
          }],
          isError: false
        }
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "Unknown method: " + String(message.method) }
    });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32603, message: String(error) }
    });
  }
});
`;
}

async function writePluginVersion(version) {
  const marker = version === "0.1.0" ? "V010" : "V020";
  const skillDirectory = join(pluginRoot, "skills", pluginName);
  const commandDirectory = join(pluginRoot, "commands");
  await mkdir(skillDirectory, { recursive: true });
  await mkdir(commandDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    `---
name: ${pluginName}
description: LOCAL_PLUGIN_SKILL_${marker} verifies isolated local plugin discovery and runtime loading.
---

# Local Plugin Fixture ${marker}

LOCAL_PLUGIN_SKILL_BODY_${marker}

Use the fixture result as the only local plugin evidence.
`,
    "utf8",
  );
  await writeFile(
    join(commandDirectory, "review.md"),
    `---
description: LOCAL_PLUGIN_COMMAND_DESCRIPTION_${marker}
---

LOCAL_PLUGIN_COMMAND_${marker}

Review arguments:
$ARGUMENTS
`,
    "utf8",
  );
  await writeFile(join(pluginRoot, "fixture-mcp.mjs"), mcpFixtureSource(), "utf8");
  const manifest = {
    name: pluginName,
    version,
    description: `LOCAL_PLUGIN_DESCRIPTION_${marker} isolated marketplace runtime fixture`,
    skills: [`skills/${pluginName}`],
    commands: {
      review: {
        file: "commands/review.md",
        description: `LOCAL_PLUGIN_COMMAND_DESCRIPTION_${marker}`,
      },
    },
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "prompt",
              text: `LOCAL_PLUGIN_PROMPT_HOOK_${marker}\nPlugin root: \${MINGSHEN_PLUGIN_ROOT}`,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "use_skill",
          hooks: [
            {
              type: "mcp_tool",
              server: "fixture",
              tool: "echo",
              input: { text: `LOCAL_PLUGIN_HOOK_MCP_${marker}` },
            },
          ],
        },
      ],
    },
    mcpServers: {
      fixture: {
        command: process.execPath,
        args: [["$", "{", "MINGSHEN_PLUGIN_ROOT}/fixture-mcp.mjs"].join("")],
        env: {
          LOCAL_PLUGIN_MCP_LOG: mcpLog,
        },
      },
    },
  };
  await writeFile(
    join(pluginRoot, ".mingshen-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return marker;
}

async function completeFirstRun() {
  await until(
    'Boolean(document.querySelector(".policy-consents, .app-shell, .setup-shell"))',
    60_000,
  );
  if (
    await renderer.evaluate(
      'Boolean(document.querySelector(".policy-consents"))',
    )
  ) {
    await renderer.evaluate(
      'document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true',
    );
    for (const text of ["\u540c\u610f\u5e76\u7ee7\u7eed", "\u5f00\u59cb\u4f7f\u7528"]) {
      const button = `[...document.querySelectorAll(".policy-dialog button")].find(button=>!button.disabled&&button.textContent.trim()===${JSON.stringify(text)})`;
      await until(`Boolean(${button})`);
      await renderer.evaluate(`${button}.click();true`);
    }
    await until('!document.querySelector(".policy-dialog")');
  }
  await until(
    'Boolean(document.querySelector(".app-shell, .setup-shell"))',
    60_000,
  );
}

async function installRuntimeListener() {
  await renderer.evaluate(
    "globalThis.__localPluginEvents=[];window.mingshen.onRuntimeEvent(event=>globalThis.__localPluginEvents.push(event));true",
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
      `--inspect=${mainInspectPort}`,
      ".",
      `--remote-debugging-port=${rendererDebugPort}`,
    ],
    {
      cwd: desktop,
      env: environment,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  mainInspector = await connectInspector();
  await mainInspector.evaluate(
    'globalThis.__localPluginFetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__localPluginFetch(url,options);true',
  );
  renderer = await connectRenderer();
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
    ?.evaluate(
      'setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true',
    )
    .catch(() => undefined);
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
  renderer = undefined;
  mainInspector = undefined;
}

async function openExtensionsSettings() {
  const alreadyOpen = await renderer.evaluate(
    'Boolean(document.querySelector(".settings-workspace"))',
  );
  if (!alreadyOpen) {
    const opened = await renderer.evaluate(`(()=>{
      const settings=document.querySelector('[data-orbit-action="settings"]')
        ?? [...document.querySelectorAll("button")].find(button=>button.querySelector("svg.lucide-settings"));
      if(!settings)return false;
      settings.click();
      return true;
    })()`);
    assert.equal(opened, true, "Settings entry is not available");
  }
  await until('Boolean(document.querySelector(".settings-workspace"))');
  const selected = await renderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".settings-nav button")]
      .find(candidate=>candidate.textContent.includes("Skills"));
    if(!button)return false;
    button.click();
    return true;
  })()`);
  assert.equal(selected, true, "Skills and plugins navigation entry is unavailable");
  await until(
    'Boolean(document.querySelector(\'[data-testid="local-plugin-marketplace"]\'))',
  );
}

async function closeSettings() {
  if (
    await renderer.evaluate(
      'Boolean(document.querySelector(".settings-workspace"))',
    )
  ) {
    await click(".settings-scrim");
    await until('!document.querySelector(".settings-workspace")');
  }
}

function approvalWatcher(options = {}) {
  const seen = new Set();
  const current = [];
  const decision = options.decision === "deny" ? "deny" : "allow_once";
  const buttonSelector = decision === "deny" ? ".btn--danger" : ".btn--primary";
  let busy = false;
  let stopped = false;
  const timer = setInterval(async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const approval = await renderer.evaluate(`(()=>{
        const panel=document.querySelector(".approval-panel");
        const button=panel?.querySelector(${JSON.stringify(buttonSelector)});
        if(!panel||!button||button.disabled)return null;
        return {
          text:panel.innerText,
          summary:panel.querySelector(".approval-panel__heading strong")?.textContent??"",
          toolName:panel.querySelector(".approval-panel__heading span")?.textContent??"",
          detail:panel.querySelector(".approval-panel__detail")?.textContent??""
        };
      })()`);
      if (approval && !seen.has(approval.text)) {
        try {
          await options.beforeDecision?.(approval);
        } catch (error) {
          errors.push(`Approval evidence: ${String(error)}`);
        }
        if (options.feedback) {
          await renderer.evaluate(`(()=>{
            const input=document.querySelector(".approval-panel__feedback");
            if(!input)return false;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(
              options.feedback,
            )});
            input.dispatchEvent(new Event("input",{bubbles:true}));
            return true;
          })()`);
          await sleep(80);
        }
        const clicked = await renderer.evaluate(`(()=>{
          const panel=document.querySelector(".approval-panel");
          const button=panel?.querySelector(${JSON.stringify(buttonSelector)});
          if(!button||button.disabled)return false;
          button.click();
          return true;
        })()`);
        if (clicked) {
          seen.add(approval.text);
          current.push(approval);
          approvals.push(approval.text);
          approvalRecords.push(approval);
        }
      }
    } catch (error) {
      errors.push(`Approval fixture: ${String(error)}`);
    } finally {
      busy = false;
    }
  }, 100);
  return {
    approvals: current,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      while (busy) await sleep(20);
    },
  };
}

async function run(session, steps, options = {}) {
  scenario = { steps, next: 0 };
  const previous = await api("getSessionMessages", session.id);
  const start = requests.length;
  const watcher = options.approval
    ? approvalWatcher(options.approval)
    : options.approveHooks
      ? approvalWatcher()
      : null;
  try {
    const { runId } = await api("sendChat", {
      sessionId: session.id,
      text: options.text ?? "LOCAL_PLUGIN_FIXTURE: answer from permitted content.",
      attachments: options.attachments ?? [],
    });
    await until(
      `globalThis.__localPluginEvents.some(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`,
      240_000,
    );
    const ending = await renderer.evaluate(
      `globalThis.__localPluginEvents.find(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`,
    );
    assert.equal(ending.type, "run_completed", JSON.stringify(ending));
    const parts = (await api("getSessionMessages", session.id))
      .slice(previous.length)
      .flatMap((message) => message.parts);
    return {
      parts,
      results: parts.filter((part) => part.type === "tool_result"),
      requests: requests.slice(start),
      approvals: watcher?.approvals.map((approval) => approval.text) ?? [],
      approvalRecords: watcher?.approvals ?? [],
    };
  } finally {
    await watcher?.stop();
    scenario = { steps: [], next: 0 };
  }
}

function builtinPickerMatchesExpression(
  name,
  version = null,
  capabilityId = null,
) {
  const versionTest =
    version === null
      ? "true"
      : `item.querySelector("code")?.textContent.trim()===${JSON.stringify(
          `v${version}`,
        )}`;
  const identityTest =
    capabilityId === null
      ? `item.querySelector(".extension-item__copy strong")?.textContent.trim()===${JSON.stringify(
          name,
        )}&&(${versionTest})`
      : `item.dataset.capabilityId===${JSON.stringify(capabilityId)}`;
  return `[...document.querySelectorAll(".extension-panel .extension-item--builtin")].filter(item=>item.querySelector(".extension-item__copy strong")?.textContent.trim()===${JSON.stringify(
    name,
  )}&&(${identityTest}))`;
}

function builtinChipMatchesExpression(capabilityId) {
  return `[...document.querySelectorAll(".reference-chip--builtin")].filter(chip=>chip.dataset.capabilityId===${JSON.stringify(
    capabilityId,
  )})`;
}

async function openBuiltinPicker(query) {
  const open = await renderer.evaluate(
    'Boolean(document.querySelector(".extension-panel"))',
  );
  if (!open) {
    await click(".extension-trigger:not(.extension-trigger--attachment)");
  }
  await until('Boolean(document.querySelector(".extension-panel__search input"))');
  await fill(".extension-panel__search input", query);
  await until(
    `document.querySelector(".extension-panel__search input")?.value===${JSON.stringify(
      query,
    )}`,
  );
}

async function toggleBuiltinPickerCapability(
  name,
  version = null,
  capabilityId = null,
) {
  await openBuiltinPicker(name);
  const matches = builtinPickerMatchesExpression(name, version, capabilityId);
  await until(`(${matches}).length===1`);
  const selected = await renderer.evaluate(
    `(${matches})[0]?.getAttribute("aria-pressed")==="true"`,
  );
  if (!selected) {
    await until(`(${matches}).length===1&&!(${matches})[0]?.disabled`);
    await renderer.evaluate(`(${matches})[0].click();true`);
  }
  await until(`(${matches})[0]?.getAttribute("aria-pressed")==="true"`);
}

async function selectedBuiltinChipNames() {
  return await renderer.evaluate(
    '[...document.querySelectorAll(".reference-chip--builtin strong")].map(node=>node.textContent.trim())',
  );
}

async function removeBuiltinChip(capabilityId) {
  const matches = builtinChipMatchesExpression(capabilityId);
  await until(`(${matches}).length===1`);
  await renderer.evaluate(`(${matches})[0].click();true`);
  await until(`(${matches}).length===0`);
}

async function selectedBuiltinIds(sessionId) {
  return (await api("listSessionBuiltinCapabilities", sessionId))
    .filter((capability) => capability.selected)
    .map((capability) => capability.id);
}

function builtinPromptContentCharacters(
  capabilityId,
  content,
  sourceCatalogEntry = null,
) {
  const pageEnd = Math.min(content.length, 32_000);
  const sourceDetails = sourceCatalogEntry
    ? [
        `Source path: ${sourceCatalogEntry.sourcePath}`,
        `Variant: ${sourceCatalogEntry.family} / ${sourceCatalogEntry.version ?? "unversioned"}`,
        `Source SHA-256: ${sourceCatalogEntry.sourceSha256}`,
        `Compatibility: ${sourceCatalogEntry.compatibility}`,
        `License disposition: ${sourceCatalogEntry.licenseDisposition}`,
        ...(sourceCatalogEntry.family === "design"
          ? [
              "Shared design systems and craft references remain available through builtin:work-visual-design.",
            ]
          : []),
      ].join("\n")
    : "";
  const continuation =
    pageEnd < content.length
      ? `\nContinue with char_offset:${pageEnd}.`
      : "";
  return (
    `Built-in skill: ${capabilityId}\nResource: SKILL.md\nCharacters: 0-${pageEnd}/${content.length}${sourceDetails ? `\n${sourceDetails}` : ""}\n\n${content.slice(0, pageEnd)}${continuation}`
      .length
  );
}

function parseToolResultJson(result, label) {
  assert.ok(result, `${label}: missing tool result`);
  assert.equal(result.isError, false, `${label}: ${result.output}`);
  const start = String(result.output ?? "").indexOf("{");
  assert.ok(start >= 0, `${label}: no JSON payload in ${result.output}`);
  return JSON.parse(String(result.output).slice(start));
}

async function discoverPages(session, input, label) {
  let offset = 0;
  let total = null;
  let pages = 0;
  const matches = [];
  const ids = new Set();
  const requestBatches = [];
  while (offset !== null) {
    pages += 1;
    assert.ok(pages <= 50, `${label}: pagination did not terminate`);
    const runResult = await run(
      session,
      [
        {
          name: "discover_capabilities",
          args: { ...input, offset },
        },
      ],
      { text: `${label} page ${pages}.` },
    );
    assert.equal(runResult.results.length, 1, JSON.stringify(runResult.results));
    const page = parseToolResultJson(runResult.results[0], `${label} page ${pages}`);
    requestBatches.push(runResult.requests);
    assert.equal(page.offset, offset, `${label}: unexpected page offset`);
    assert.equal(typeof page.total, "number", `${label}: missing total`);
    assert.equal(typeof page.returned, "number", `${label}: missing returned`);
    total ??= page.total;
    assert.equal(page.total, total, `${label}: total changed between pages`);
    for (const match of page.matches ?? []) {
      assert.ok(match.id, `${label}: match without exact id`);
      assert.ok(!ids.has(match.id), `${label}: duplicate id ${match.id}`);
      ids.add(match.id);
      matches.push(match);
    }
    offset = page.next_offset;
  }
  assert.equal(matches.length, total, `${label}: incomplete pagination`);
  return { matches, pages, requestBatches, total };
}

async function loadWorkSources(session, sources, text) {
  assert.ok(sources.length > 0, `${text}: no sources selected`);
  const loaded = await run(
    session,
    sources.map((source) => ({
      name: "use_skill",
      args: { name: source.id },
    })),
    { text },
  );
  assert.equal(loaded.results.length, sources.length, JSON.stringify(loaded.results));
  return loaded;
}

function workSourceBody(output) {
  const separator = String(output ?? "").indexOf("\n\n");
  assert.ok(separator >= 0, `Work source output has no content boundary: ${output}`);
  return String(output).slice(separator + 2);
}

function skillIdFrom(result) {
  const matches = [
    ...result.output.matchAll(/"id"\s*:\s*"([^"]+SKILL\.md)"/gi),
  ];
  assert.equal(matches.length, 1, result.output);
  return matches[0]?.[1] ?? "";
}

function mcpToolFrom(request) {
  const tool = (request?.tools ?? []).find(
    (entry) =>
      String(entry.name ?? "").startsWith("mcp__") &&
      String(entry.name ?? "").endsWith("__echo"),
  );
  assert.ok(tool, "Plugin MCP echo tool was not exposed to the model");
  return tool.name;
}

async function readMcpLog() {
  return await readFile(mcpLog, "utf8").catch(() => "");
}

async function pathExists(path) {
  return await stat(path).then(
    () => true,
    () => false,
  );
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await createPlugin({
    pluginRoot,
    name: pluginName,
    version: "0.1.0",
    description: "Isolated local plugin fixture for the marketplace runtime smoke test.",
    displayName: "Local Plugin Fixture",
  });
  await writePluginVersion("0.1.0");
  const sdkValidation = await validatePlugin(pluginRoot);
  assert.equal(sdkValidation.ok, true, JSON.stringify(sdkValidation.errors));
  assert.equal(sdkValidation.skills.length, 1);
  assert.equal(sdkValidation.commands.length, 1);
  assert.equal(sdkValidation.mcpServers.length, 1);
  assert.deepEqual(
    sdkValidation.hookEvents.sort(),
    ["PostToolUse", "UserPromptSubmit"],
  );
  await upsertMarketplace(marketRoot, marketName, [pluginRoot]);

  execFileSync(
    process.execPath,
    [resolve("scripts/prepare-experimental-runtime.cjs")],
    {
      windowsHide: true,
      stdio: "pipe",
    },
  );
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await launch();
  await renderer.evaluate(
    'localStorage.setItem("mingshen.theme","day");true',
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

  const extensionsBeforeInstall = await api("listExtensions");
  assert.equal(
    extensionsBeforeInstall.some(
      (extension) =>
        extension.type === "plugin" && extension.name === pluginName,
    ),
    false,
    "The external fixture plugin must not be installed before built-in discovery runs",
  );
  assert.deepEqual(
    await api("listLocalPluginMarkets"),
    [],
    "The external fixture marketplace must not be registered before built-in discovery runs",
  );

  const provider = await api("createProvider", {
    name: "Local plugin fixture provider",
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    protocol: "openai_responses",
    authMode: "bearer",
    apiKey: "local-plugin-smoke-isolated-only",
    keyLabel: "Fixture",
    neverReveal: true,
  });
  const configured = await api("createModel", {
    providerId: provider.id,
    modelId: "local-plugin-fixture",
    displayName: "Local plugin fixture",
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    inputModalities: ["text"],
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
    title: "Local plugin code session",
  });
  workSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "work",
    workspacePath: project,
    permissionMode: "request_approval",
    approvalMode: "manual",
    title: "Local plugin protected Work session",
  });
  await api("setProjectMemoryEnabled", codeSession.id, false);
  await api("setProjectMemoryEnabled", workSession.id, false);
  await api("setProjectTrust", project, true);
  await renderer.send("Page.reload");
  await until(
    'Boolean(document.querySelector("[data-testid=agent-mode-code]"))',
    60_000,
  );
  await installRuntimeListener();

  await selectWorkspaceSession(codeSession);
  const codeSkillInventory = await discoverPages(
    codeSession,
    { kind: "skill", limit: 50 },
    "Code built-in skill inventory",
  );
  assert.equal(
    codeSkillInventory.matches.filter(
      (match) => match.builtin_kind === "foundation",
    ).length,
    9,
    JSON.stringify(codeSkillInventory.matches),
  );
  assert.equal(codeSkillInventory.matches.length, 9, JSON.stringify(codeSkillInventory.matches));
  assert.equal(
    codeSkillInventory.matches.filter(
      (match) => match.builtin_kind === "work-source",
    ).length,
    0,
  );
  const codePluginInventory = await discoverPages(
    codeSession,
    { kind: "plugin", limit: 50 },
    "Code built-in plugin inventory",
  );
  assert.deepEqual(
    codePluginInventory.matches.map((match) => match.id).sort(),
    ["builtin:plugin-browser", "builtin:plugin-github"],
  );
  const codeCreatorDiscovery = await run(
    codeSession,
    [
      { name: "discover_capabilities", args: { query: "creator", kind: "skill" } },
      {
        name: "discover_capabilities",
        args: { query: "harness plugin api", kind: "skill" },
      },
    ],
    { text: "Discover the built-in Code creator capabilities." },
  );
  assert.equal(codeCreatorDiscovery.results.length, 2);
  const codeCreators = parseToolResultJson(
    codeCreatorDiscovery.results[0],
    "Code creator discovery",
  );
  const codeCreatorIds = new Set((codeCreators.matches ?? []).map((match) => match.id));
  assert.ok(codeCreatorIds.has("builtin:skill-creator"), JSON.stringify(codeCreators));
  assert.ok(codeCreatorIds.has("builtin:plugin-creator"), JSON.stringify(codeCreators));
  const codePluginApi = parseToolResultJson(
    codeCreatorDiscovery.results[1],
    "Code plugin API discovery",
  );
  assert.ok(
    (codePluginApi.matches ?? []).some(
      (match) => match.id === "builtin:harness-plugin-api",
    ),
    JSON.stringify(codePluginApi),
  );
  passed.push(
    "CodeAgent discovers packaged Skill and plugin creators before any external plugin or marketplace is installed",
  );

  assert.equal(workSession.agentMode, "work");
  assert.equal(workSession.executionMode, "host");
  assert.equal(workSession.permissionMode, "request_approval");
  await selectWorkspaceSession(workSession);
  const workCreatorDiscovery = await run(
    workSession,
    [
      { name: "discover_capabilities", args: { query: "creator", kind: "skill" } },
      {
        name: "discover_capabilities",
        args: { query: "harness plugin api", kind: "skill" },
      },
    ],
    { text: "Discover the built-in Work creator capabilities." },
  );
  assert.equal(workCreatorDiscovery.results.length, 2);
  const workCreators = parseToolResultJson(
    workCreatorDiscovery.results[0],
    "Work creator discovery",
  );
  const workCreatorIds = new Set((workCreators.matches ?? []).map((match) => match.id));
  assert.ok(workCreatorIds.has("builtin:skill-creator"), JSON.stringify(workCreators));
  assert.ok(workCreatorIds.has("builtin:plugin-creator"), JSON.stringify(workCreators));
  const workPluginApi = parseToolResultJson(
    workCreatorDiscovery.results[1],
    "Work plugin API discovery",
  );
  assert.ok(
    (workPluginApi.matches ?? []).some(
      (match) => match.id === "builtin:harness-plugin-api",
    ),
    JSON.stringify(workPluginApi),
  );
  passed.push("WorkAgent discovers the same packaged creators in a protected host session");

  const emptyPath = join(temporary, "empty-path");
  await mkdir(emptyPath, { recursive: true });
  const originalMainPath = await mainInspector.evaluate("process.env.PATH ?? null");
  await mainInspector.evaluate(
    `process.env.PATH=${JSON.stringify(emptyPath)};true`,
  );
  try {
    const mcpLogBeforeApproval = await readMcpLog();
    const pathlessBuiltinTools = await run(
      workSession,
      [
        {
          name: "discover_capabilities",
          args: { query: "word", kind: "skill", limit: 1 },
        },
        { name: "use_skill", args: { name: "builtin:work-word" } },
      ],
      { text: "Use packaged Work capabilities while system PATH is unavailable." },
    );
    assert.equal(pathlessBuiltinTools.results.length, 2);
    assert.equal(
      pathlessBuiltinTools.results[0].isError,
      false,
      pathlessBuiltinTools.results[0].output,
    );
    assert.equal(
      pathlessBuiltinTools.results[1].isError,
      false,
      pathlessBuiltinTools.results[1].output,
    );
    assert.ok(
      pathlessBuiltinTools.results[1].output.includes(
        "Built-in skill: builtin:work-word",
      ),
      pathlessBuiltinTools.results[1].output,
    );
    const localPluginAllowed = await run(
      workSession,
      [
        {
          name: "local_plugin",
          args: { action: "validate", rootPath: pluginRoot },
        },
      ],
      {
        approval: {
          decision: "allow_once",
          beforeDecision: () =>
            captureCurrentScreen("local-plugin-read-approval-allow"),
        },
        text: "Validate the workspace plugin source after an approved read.",
      },
    );
    assert.equal(localPluginAllowed.results.length, 1);
    const allowedPluginPayload = parseToolResultJson(
      localPluginAllowed.results[0],
      "Allowed local_plugin validation",
    );
    assert.equal(allowedPluginPayload.readOnly, true);
    assert.equal(allowedPluginPayload.lifecycleChanged, false);
    assert.equal(allowedPluginPayload.validation.ok, true);
    assert.ok(
      localPluginAllowed.requests.length > 0 &&
        localPluginAllowed.requests.every((request) =>
          (request.tools ?? []).some((tool) => tool.name === "local_plugin"),
        ),
      "local_plugin must be exposed to every Responses turn",
    );
    assert.match(
      localPluginAllowed.requests[0]?.tools?.find(
        (tool) => tool.name === "local_plugin",
      )?.description ?? "",
      /never installs|does not execute plugin code|never execute/i,
    );
    assert.equal(localPluginAllowed.approvalRecords.length, 1);
    assert.equal(localPluginAllowed.approvalRecords[0].toolName, "local_plugin");
    assert.ok(
      localPluginAllowed.approvalRecords[0].summary
        .toLocaleLowerCase("en-US")
        .includes(pluginRoot.toLocaleLowerCase("en-US")),
      localPluginAllowed.approvalRecords[0].summary,
    );
    assert.equal(
      await readMcpLog(),
      mcpLogBeforeApproval,
      "Read-only local_plugin validation must not start a plugin MCP server",
    );

    const localPluginDenied = await run(
      workSession,
      [
        {
          name: "local_plugin",
          args: { action: "validate", rootPath: pluginRoot },
        },
      ],
      {
        approval: {
          decision: "deny",
          feedback: "KEEP_LOCAL_PLUGIN_READ_BLOCKED",
          beforeDecision: () =>
            captureCurrentScreen("local-plugin-read-approval-deny"),
        },
        text: "Do not validate the plugin source when the read is denied.",
      },
    );
    assert.equal(localPluginDenied.results.length, 1);
    assert.equal(localPluginDenied.results[0].isError, true);
    assert.match(localPluginDenied.results[0].output, /\u62d2\u7edd|denied/i);
    assert.ok(
      localPluginDenied.results[0].output.includes(
        "KEEP_LOCAL_PLUGIN_READ_BLOCKED",
      ),
      localPluginDenied.results[0].output,
    );
    assert.ok(!localPluginDenied.results[0].output.includes('"validation"'));
    assert.equal(localPluginDenied.approvalRecords.length, 1);
    assert.equal(localPluginDenied.approvalRecords[0].toolName, "local_plugin");
    assert.ok(
      localPluginDenied.approvalRecords[0].summary
        .toLocaleLowerCase("en-US")
        .includes(pluginRoot.toLocaleLowerCase("en-US")),
      localPluginDenied.approvalRecords[0].summary,
    );
    assert.equal(
      await readMcpLog(),
      mcpLogBeforeApproval,
      "Denied local_plugin validation must not scan or start plugin code",
    );
    protectedReadAudit = {
      allowed: {
        toolName: localPluginAllowed.approvalRecords[0].toolName,
        readOnly: allowedPluginPayload.readOnly,
        lifecycleChanged: allowedPluginPayload.lifecycleChanged,
        validationPresent: Boolean(allowedPluginPayload.validation),
        mcpLogUnchanged: true,
      },
      denied: {
        toolName: localPluginDenied.approvalRecords[0].toolName,
        feedbackEchoed: localPluginDenied.results[0].output.includes(
          "KEEP_LOCAL_PLUGIN_READ_BLOCKED",
        ),
        validationPresent: false,
        mcpLogUnchanged: true,
      },
    };
    passed.push(
      "Built-in discovery/load and protected WorkAgent local_plugin validation work without system PATH, ask before plugin reads, and stop before validation when denied",
    );
  } finally {
    await mainInspector.evaluate(
      originalMainPath === null
        ? "delete process.env.PATH;true"
        : `process.env.PATH=${JSON.stringify(originalMainPath)};true`,
    );
  }

  const workInventory = await discoverPages(
    workSession,
    { kind: "skill", limit: 50 },
    "Work built-in inventory",
  );
  workSources = workInventory.matches.filter(
    (match) => match.builtin_kind === "work-source",
  );
  const workFoundationSkills = workInventory.matches.filter(
    (match) => match.builtin_kind === "foundation",
  );
  const uniqueWorkSourceShas = new Set(
    workSources.map((source) => source.source_sha256),
  );
  assert.ok(
    workInventory.pages > 1,
    `Work inventory must exercise pagination: ${workInventory.pages} page`,
  );
  assert.equal(workSources.length, 124, JSON.stringify(workInventory.matches));
  assert.equal(workFoundationSkills.length, 16, JSON.stringify(workInventory.matches));
  assert.equal(workInventory.matches.length, 140, JSON.stringify(workInventory.matches));
  assert.equal(uniqueWorkSourceShas.size, 104);
  assert.ok(
    workSources.every(
      (source) =>
        source.id?.startsWith("builtin:work-source-") &&
        /^[a-f0-9]{64}$/.test(source.source_sha256 ?? "") &&
        source.source_path &&
        ["adapted", "resource", "reference", "native"].includes(
          source.compatibility,
        ) &&
        ["verbatim", "adapted", "reference-only"].includes(
          source.license_disposition,
        ),
    ),
    "Work source matches must expose exact ids, source hashes and compatibility",
  );
  passed.push(
    "Paginated Work discovery exposes 124 exact source ids backed by 104 unique source bodies",
  );
  const workPluginInventory = await discoverPages(
    workSession,
    { kind: "plugin", limit: 50 },
    "Work built-in plugin inventory",
  );
  assert.deepEqual(
    workPluginInventory.matches.map((match) => match.id).sort(),
    ["builtin:plugin-browser", "builtin:plugin-github"],
  );
  passed.push(
    "Skill and plugin inventory counts are separated: Code has 9 Skills plus 2 plugins, and Work has 16 foundation Skills plus 124 sources and the same 2 plugins",
  );

  const workPdfDiscovery = await discoverPages(
    workSession,
    { query: "pdf", kind: "skill", limit: 2 },
    "Work PDF source discovery",
  );
  assert.ok(workPdfDiscovery.pages > 1, "PDF discovery must exercise pagination");
  workPdfSources = workPdfDiscovery.matches.filter(
    (match) =>
      match.builtin_kind === "work-source" &&
      (match.family === "pdf" ||
        /pdf/i.test(match.name ?? "") ||
        /(^|\/)pdf/i.test(match.source_path ?? "")),
  );
  const pdfShas = new Set(workPdfSources.map((source) => source.source_sha256));
  assert.equal(workPdfSources.length, 10, JSON.stringify(workPdfSources));
  assert.equal(pdfShas.size, 5, JSON.stringify(workPdfSources));
  const legacyPdfViewer = workPdfSources.find(
    (source) =>
      source.source_path === "pdf-1/0.2.1/skills/pdf-viewer/SKILL.md",
  );
  const currentPdfViewer = workPdfSources.find(
    (source) =>
      source.source_path === "pdf-1/0.2.2/skills/pdf-viewer/SKILL.md",
  );
  assert.ok(legacyPdfViewer, JSON.stringify(workPdfSources));
  assert.ok(currentPdfViewer, JSON.stringify(workPdfSources));
  assert.notEqual(legacyPdfViewer.id, currentPdfViewer.id);
  assert.notEqual(
    legacyPdfViewer.source_sha256,
    currentPdfViewer.source_sha256,
  );
  const firstPdfRequest = workPdfDiscovery.requestBatches[0]?.[0];
  assert.ok(
    (firstPdfRequest?.tools ?? []).some(
      (tool) => tool.name === "discover_capabilities",
    ),
    "The PDF query must be initiated through the model-facing discovery tool",
  );
  assert.ok(
    !String(firstPdfRequest?.instructions ?? "").includes(
      "builtin:work-source-",
    ) &&
      !JSON.stringify(firstPdfRequest?.tools ?? []).includes(
        "builtin:work-source-",
      ),
    "The host must not pre-inject catalog source ids into instructions or tools",
  );
  const pdfSelections = [legacyPdfViewer, currentPdfViewer];
  const selectedPdfShas = new Set([
    legacyPdfViewer.source_sha256,
    currentPdfViewer.source_sha256,
  ]);
  for (const source of workPdfSources) {
    if (selectedPdfShas.has(source.source_sha256)) continue;
    selectedPdfShas.add(source.source_sha256);
    pdfSelections.push(source);
    if (pdfSelections.length === 5) break;
  }
  assert.equal(pdfSelections.length, 5);
  assert.equal(
    new Set(pdfSelections.map((source) => source.source_sha256)).size,
    5,
    "The loaded PDF set must contain five distinct source bodies",
  );
  const pdfLoaded = await loadWorkSources(
    workSession,
    pdfSelections,
    "Load all five distinct PDF source bodies returned by paginated discovery.",
  );
  const pdfBodies = new Set();
  pdfSelections.forEach((source, index) => {
    const result = pdfLoaded.results[index];
    assert.equal(result.isError, false, result.output);
    assert.ok(result.output.includes(`Built-in skill: ${source.id}`), result.output);
    const body = workSourceBody(result.output);
    assert.ok(body.length >= 80, result.output);
    pdfBodies.add(body);
  });
  assert.equal(pdfBodies.size, 5);
  const legacyPdfIndex = pdfSelections.findIndex(
    (source) => source.id === legacyPdfViewer.id,
  );
  const currentPdfIndex = pdfSelections.findIndex(
    (source) => source.id === currentPdfViewer.id,
  );
  assert.ok(legacyPdfIndex >= 0 && currentPdfIndex >= 0);
  assert.notEqual(
    workSourceBody(pdfLoaded.results[legacyPdfIndex].output),
    workSourceBody(pdfLoaded.results[currentPdfIndex].output),
  );
  passed.push(
    "The model discovers 10 paginated PDF sources, including both viewer versions, and loads five distinct source bodies by exact id",
  );

  const chosenIds = new Set();
  const chooseUniqueSource = (label, sourcePath) => {
    const source = workSources.find(
      (candidate) =>
        !chosenIds.has(candidate.id) &&
        candidate.source_path === sourcePath,
    );
    assert.ok(source, `Missing Work source sample: ${label} (${sourcePath})`);
    chosenIds.add(source.id);
    return { label, source };
  };
  workSourceSamples = [
    chooseUniqueSource(
      "Word",
      "documents-1/0.2.2/skills/docx/SKILL.md",
    ),
    chooseUniqueSource(
      "Excel",
      "spreadsheets/0.2.2/skills/xlsx/SKILL.md",
    ),
    chooseUniqueSource(
      "PowerPoint",
      "presentations/0.2.2/skills/pptx/SKILL.md",
    ),
    chooseUniqueSource(
      "viewer",
      "documents-1/0.2.2/skills/docx-viewer/SKILL.md",
    ),
    chooseUniqueSource(
      "design",
      "design-1/0.7.2/skills/design/design-resources/design-skeletons/dashboard/SKILL.md",
    ),
  ];
  const sampleSources = workSourceSamples.map((sample) => sample.source);
  const sampleLoad = await loadWorkSources(
    workSession,
    sampleSources,
    "Load the Work Word, Excel, PowerPoint, viewer and design source samples.",
  );
  const sampleBodies = new Set();
  sampleSources.forEach((source, index) => {
    const result = sampleLoad.results[index];
    assert.equal(result.isError, false, result.output);
    assert.ok(result.output.includes(`Built-in skill: ${source.id}`), result.output);
    assert.ok(result.output.includes(`Source path: ${source.source_path}`));
    assert.ok(result.output.includes(`Source SHA-256: ${source.source_sha256}`));
    assert.ok(
      result.output.includes(`Compatibility: ${source.compatibility}`),
    );
    assert.ok(
      result.output.includes(
        `License disposition: ${source.license_disposition}`,
      ),
    );
    const body = workSourceBody(result.output);
    assert.ok(body.length >= 64, result.output);
    sampleBodies.add(body);
  });
  assert.ok(sampleBodies.size >= 4, "Authored Work source families must not collapse into one body");

  historicalWorkSources = [
    "documents-1/0.2.1/skills/docx-viewer/SKILL.md",
    "documents-1/0.2.2/skills/docx-viewer/SKILL.md",
  ].map((sourcePath) => {
    const source = workSources.find(
      (candidate) => candidate.source_path === sourcePath,
    );
    assert.ok(source, `Missing historical Work viewer source: ${sourcePath}`);
    return source;
  });
  assert.equal(
    new Set(historicalWorkSources.map((source) => source.id)).size,
    2,
  );
  assert.equal(
    new Set(historicalWorkSources.map((source) => source.source_sha256)).size,
    1,
  );
  const historicalLoad = await loadWorkSources(
    workSession,
    historicalWorkSources,
    "Load two historical exact ids that share one source SHA.",
  );
  const historicalBodies = historicalLoad.results.map((result) => {
    assert.equal(result.isError, false, result.output);
    return workSourceBody(result.output);
  });
  assert.equal(historicalBodies[0], historicalBodies[1]);
  assert.notEqual(
    historicalLoad.results[0].output,
    historicalLoad.results[1].output,
    "Historical exact ids must retain distinct metadata in the full output",
  );
  passed.push(
    "Word, Excel, PowerPoint, viewer and design samples load on demand; historical same-SHA ids remain exact and compatible",
  );

  pinnedWorkSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "work",
    workspacePath: project,
    permissionMode: "request_approval",
    approvalMode: "manual",
    title: "Pinned capability Work session",
  });
  await api("setProjectMemoryEnabled", pinnedWorkSession.id, false);
  await renderer.send("Page.reload");
  await until(
    'Boolean(document.querySelector("[data-testid=agent-mode-work]"))',
    60_000,
  );
  await installRuntimeListener();
  await selectWorkspaceSession(pinnedWorkSession);

  await toggleBuiltinPickerCapability(
    "work-ppt-master",
    null,
    "builtin:work-ppt-master",
  );
  await toggleBuiltinPickerCapability(
    "work-asd-ste100",
    null,
    "builtin:work-asd-ste100",
  );
  await toggleBuiltinPickerCapability(
    "pdf-viewer",
    "0.2.1",
    legacyPdfViewer.id,
  );
  assert.deepEqual(
    (await selectedBuiltinChipNames()).sort(),
    ["pdf-viewer", "work-asd-ste100", "work-ppt-master"],
  );
  const firstPinnedSelectionIds = await selectedBuiltinIds(pinnedWorkSession.id);
  assert.ok(firstPinnedSelectionIds.includes("builtin:work-ppt-master"));
  assert.ok(firstPinnedSelectionIds.includes("builtin:work-asd-ste100"));
  assert.ok(firstPinnedSelectionIds.includes(legacyPdfViewer.id));
  assert.ok(!firstPinnedSelectionIds.includes(currentPdfViewer.id));

  assert.equal(
    await renderer.evaluate(
      `(${builtinChipMatchesExpression(legacyPdfViewer.id)}).length`,
    ),
    1,
  );
  await removeBuiltinChip(legacyPdfViewer.id);
  assert.deepEqual(
    (await selectedBuiltinIds(pinnedWorkSession.id)).sort(),
    ["builtin:work-asd-ste100", "builtin:work-ppt-master"],
  );
  await toggleBuiltinPickerCapability(
    "pdf-viewer",
    "0.2.2",
    currentPdfViewer.id,
  );
  await click(".extension-trigger:not(.extension-trigger--attachment)");
  await until('!document.querySelector(".extension-panel")');
  assert.deepEqual(
    (await selectedBuiltinChipNames()).sort(),
    ["pdf-viewer", "work-asd-ste100", "work-ppt-master"],
  );

  const pinnedCapabilityIds = [
    "builtin:work-ppt-master",
    "builtin:work-asd-ste100",
    currentPdfViewer.id,
  ];
  const pinnedCapabilities = await api(
    "listSessionBuiltinCapabilities",
    pinnedWorkSession.id,
  );
  assert.deepEqual(
    pinnedCapabilities
      .filter((capability) => capability.selected)
      .map((capability) => capability.id)
      .sort(),
    [...pinnedCapabilityIds].sort(),
  );
  const selectedPdfCapability = pinnedCapabilities.find(
    (capability) => capability.id === currentPdfViewer.id,
  );
  assert.ok(selectedPdfCapability);
  assert.equal(selectedPdfCapability.version, "0.2.2");
  assert.equal(
    selectedPdfCapability.sourcePath,
    currentPdfViewer.source_path,
  );
  assert.equal(
    selectedPdfCapability.sourceSha256,
    currentPdfViewer.source_sha256,
  );
  passed.push(
    "The real capability picker selects PPTMaster, ASD-STE100 and exact PDF viewer 0.2.1, cancels its chip, and replaces it with 0.2.2 while IPC retains the exact ids and source metadata",
  );

  const previousUiPreferences = await api("getUiPreferences");
  const previousTheme = await renderer.evaluate(
    'document.documentElement.dataset.theme??"night"',
  );
  const previousLocale = await renderer.evaluate(
    'localStorage.getItem("mingshen.locale")??"zh-CN"',
  );
  const previousOrbit = await renderer.evaluate(
    'Boolean(document.querySelector(".app-shell--orbit"))',
  );
  await api("saveUiPreferences", {
    ...previousUiPreferences,
    interfaceStyle: "orbit",
  });
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector(".app-shell--orbit"))');
  await installRuntimeListener();
  await selectWorkspaceSession(pinnedWorkSession);
  await setCaptureLocale("zh-CN");
  await setCaptureTheme("day");

  const foundationScreenshotIds = [
    "builtin:work-ppt-master",
    "builtin:work-asd-ste100",
  ];
  const foundationScreenshotSelectors = foundationScreenshotIds.map(
    (id) =>
      `[data-testid="builtin-capability-item"][data-capability-id="${id}"]`,
  );
  await openBuiltinPicker("workagent only");
  await until(
    foundationScreenshotSelectors
      .map((selector) => `Boolean(document.querySelector(${JSON.stringify(selector)}))`)
      .join("&&"),
  );
  await captureCurrentScreen(
    "work-capability-picker-foundations-orbit-day",
    1440,
    960,
    {
      targetSelector: '[data-testid="capability-picker-panel"]',
      requiredSelectors: foundationScreenshotSelectors,
      overflowSelectors: [
        '[data-testid="capability-picker-panel"]',
        ".extension-panel__header",
        ".extension-panel__search",
        ".extension-panel__body",
      ],
      requireFullyVisible: true,
      requireForeground: true,
    },
  );
  await setCaptureTheme("night");
  await captureCurrentScreen(
    "work-capability-picker-foundations-orbit-night",
    1440,
    960,
    {
      targetSelector: '[data-testid="capability-picker-panel"]',
      requiredSelectors: foundationScreenshotSelectors,
      overflowSelectors: [
        '[data-testid="capability-picker-panel"]',
        ".extension-panel__header",
        ".extension-panel__search",
        ".extension-panel__body",
      ],
      requireFullyVisible: true,
      requireForeground: true,
    },
  );
  await setCaptureLocale("en");
  await until(
    'document.querySelector(".extension-panel__header strong")?.textContent.includes("Local and built-in capabilities")',
  );
  await captureCurrentScreen(
    "work-capability-picker-foundations-orbit-english-800",
    800,
    900,
    {
      targetSelector: '[data-testid="capability-picker-panel"]',
      requiredSelectors: foundationScreenshotSelectors,
      overflowSelectors: [
        '[data-testid="capability-picker-panel"]',
        ".extension-panel__header",
        ".extension-panel__search",
        ".extension-panel__body",
      ],
      requireFullyVisible: true,
      requireForeground: true,
    },
  );
  await setCaptureLocale("zh-CN");
  await setCaptureTheme("day");

  const pdfSameNameIds = [legacyPdfViewer.id, currentPdfViewer.id];
  const pdfSameNameSelectors = pdfSameNameIds.map(
    (id) =>
      `[data-testid="builtin-capability-item"][data-capability-id="${id}"]`,
  );
  await openBuiltinPicker("pdf-viewer");
  await until(
    pdfSameNameSelectors
      .map((selector) => `Boolean(document.querySelector(${JSON.stringify(selector)}))`)
      .join("&&"),
  );
  const pdfSameNameItems = await renderer.evaluate(`(()=>{
    return ${JSON.stringify(pdfSameNameIds)}.map(id=>{
      const item=document.querySelector('[data-testid="builtin-capability-item"][data-capability-id="'+id+'"]');
      return item?{id,label:item.querySelector(".extension-item__copy strong")?.textContent.trim()??"",version:item.querySelector("code")?.textContent.trim()??""}:null;
    });
  })()`);
  assert.deepEqual(
    pdfSameNameItems.map((item) => item?.label),
    ["pdf-viewer", "pdf-viewer"],
  );
  assert.deepEqual(
    pdfSameNameItems.map((item) => item?.version),
    ["v0.2.1", "v0.2.2"],
  );
  await captureCurrentScreen(
    "work-capability-picker-pdf-versions-orbit-day",
    1440,
    960,
    {
      targetSelector: '[data-testid="capability-picker-panel"]',
      requiredSelectors: pdfSameNameSelectors,
      overflowSelectors: [
        '[data-testid="capability-picker-panel"]',
        ".extension-panel__header",
        ".extension-panel__search",
        ".extension-panel__body",
      ],
      requireFullyVisible: true,
      requireForeground: true,
    },
  );
  await click(".extension-trigger:not(.extension-trigger--attachment)");
  await until('!document.querySelector(".extension-panel")');
  passed.push(
    "Work capability picker screenshots cover PPTMaster and ASD-STE100 in Orbit day, night and English at 800 pixels, plus both exact PDF viewer versions with the same displayed name",
  );

  const pinnedRun = await run(pinnedWorkSession, [], {
    text: "Use the explicitly pinned Work skills for this response.",
  });
  assert.equal(pinnedRun.requests.length, 1);
  const pinnedInstructions = String(
    pinnedRun.requests[0]?.instructions ?? "",
  );
  assert.match(pinnedInstructions, /SESSION-PINNED SKILLS/);
  assert.match(pinnedInstructions, /CONTROLLED PINNED-SKILL CONTEXT/);
  for (const id of pinnedCapabilityIds) {
    assert.ok(
      pinnedInstructions.includes(`Pinned skill id: ${id}`),
      `Missing pinned metadata for ${id}`,
    );
    assert.ok(
      pinnedInstructions.includes(`--- BEGIN PINNED SKILL ${id} ---`),
      `Missing controlled body for ${id}`,
    );
  }
  assert.ok(pinnedInstructions.includes("# PPT Master Presentation Workflow"));
  assert.ok(
    pinnedInstructions.includes("# Controlled English for WorkAgent Output"),
  );
  assert.ok(
    pinnedInstructions.includes("# PDF Viewer Source 0.2.2/0.2.3"),
  );
  assert.ok(!pinnedInstructions.includes("# PDF Viewer Source 0.2.1"));
  assert.ok(!pinnedInstructions.includes("DEFERRED PINNED SKILLS"));
  assert.equal(
    [...pinnedInstructions.matchAll(/--- BEGIN PINNED SKILL /g)].length,
    3,
  );
  passed.push(
    "The first provider request for a fresh Work session contains pinned metadata and the actual controlled bodies for both foundation skills and the exact selected PDF source",
  );

  const pluginCapabilityId = "builtin:plugin-github";
  const pluginCapability = pinnedCapabilities.find(
    (capability) => capability.id === pluginCapabilityId,
  );
  assert.equal(pluginCapability?.type, "plugin");
  await toggleBuiltinPickerCapability(
    "GitHub API",
    null,
    pluginCapabilityId,
  );
  assert.ok((await selectedBuiltinIds(pinnedWorkSession.id)).includes(pluginCapabilityId));
  await until(`(${builtinChipMatchesExpression(pluginCapabilityId)}).length===1`);
  const pluginPreferenceRun = await run(
    pinnedWorkSession,
    [{ name: "use_skill", args: { name: pluginCapabilityId } }],
    { text: "Use the manually preferred GitHub plugin tools without treating it as a Skill." },
  );
  assert.equal(pluginPreferenceRun.results.length, 1);
  assert.equal(pluginPreferenceRun.results[0].isError, true);
  assert.match(pluginPreferenceRun.results[0].output, /SKILL_NOT_FOUND/);
  assert.ok(pluginPreferenceRun.requests.length > 0);
  assert.deepEqual(
    (pluginPreferenceRun.requests[0]?.tools ?? [])
      .map((tool) => tool.name)
      .sort(),
    (pinnedRun.requests[0]?.tools ?? []).map((tool) => tool.name).sort(),
  );
  for (const request of pluginPreferenceRun.requests) {
    const instructions = String(request.instructions ?? "");
    assert.match(instructions, /MANUALLY PREFERRED BUILTIN PLUGINS/);
    assert.ok(instructions.includes(`"id":"${pluginCapabilityId}"`));
    assert.ok(!instructions.includes('"id":"builtin:plugin-browser"'));
    assert.match(instructions, /Never call use_skill with a plugin id/);
    assert.match(instructions, /github_/);
    assert.ok(!instructions.includes(`Pinned skill id: ${pluginCapabilityId}`));
    assert.ok(!instructions.includes(`BEGIN PINNED SKILL ${pluginCapabilityId}`));
  }
  await setCaptureTheme("night");
  await openBuiltinPicker("GitHub API");
  const pluginPickerSelector =
    `[data-testid="builtin-capability-item"][data-capability-id="${pluginCapabilityId}"]`;
  await until(
    `document.querySelector(${JSON.stringify(pluginPickerSelector)})?.getAttribute("aria-pressed")==="true"`,
  );
  await captureCurrentScreen(
    "work-plugin-picker-selected-orbit-night",
    1440,
    960,
    {
      targetSelector: '[data-testid="capability-picker-panel"]',
      requiredSelectors: [pluginPickerSelector],
      overflowSelectors: [
        '[data-testid="capability-picker-panel"]',
        ".extension-panel__header",
        ".extension-panel__search",
        ".extension-panel__body",
      ],
      requireFullyVisible: true,
      requireForeground: true,
    },
  );
  await click(".extension-trigger:not(.extension-trigger--attachment)");
  await until('!document.querySelector(".extension-panel")');
  const pluginChipSelectors = [
    ...pinnedCapabilityIds,
    pluginCapabilityId,
  ].map((id) => `.reference-chip--builtin[data-capability-id="${id}"]`);
  await until(
    pluginChipSelectors
      .map((selector) => `Boolean(document.querySelector(${JSON.stringify(selector)}))`)
      .join("&&"),
  );
  await captureCurrentScreen(
    "work-capability-chips-with-plugin-orbit-night",
    1440,
    960,
    {
      targetSelector: ".composer__references",
      requiredSelectors: pluginChipSelectors,
      overflowSelectors: [".composer", ".composer__references"],
      requireFullyVisible: true,
      requireForeground: true,
    },
  );
  await removeBuiltinChip(pluginCapabilityId);
  assert.deepEqual(
    (await selectedBuiltinIds(pinnedWorkSession.id)).sort(),
    [...pinnedCapabilityIds].sort(),
  );
  await setCaptureTheme(previousTheme);
  await setCaptureLocale(previousLocale);
  await api("saveUiPreferences", previousUiPreferences);
  await renderer.send("Page.reload");
  await until(
    `Boolean(document.querySelector(".app-shell--orbit"))===${previousOrbit}`,
  );
  await until('Boolean(document.querySelector(".composer"))');
  await installRuntimeListener();
  await selectWorkspaceSession(pinnedWorkSession);
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  passed.push(
    "Built-in plugins are selectable and removable from the real composer UI; Orbit screenshots capture the selected plugin and mixed skill/plugin chips, while the prompt contributes only an exact-ID preferred-tool policy and use_skill rejects the plugin id",
  );

  const gateProfile = await api("saveAgentProfile", {
    name: "Pinned capability gate fixture",
    description: "Smoke-test profile for pinned capability permission gates.",
    role: "primary",
    instructions: "",
    modelId: null,
    readOnly: false,
    enabled: true,
    permissions: {
      read: "allow",
      "use_skill:builtin:work-ppt-master": "ask",
      "use_skill:builtin:work-asd-ste100": "deny",
    },
    toolAllowlist: ["read_file", "use_skill"],
    applicableModes: ["work"],
  });
  try {
    await api("updateSession", {
      sessionId: pinnedWorkSession.id,
      agentProfileId: gateProfile.id,
    });
    const pinnedGateRun = await run(pinnedWorkSession, [], {
      text: "Verify pinned capability permission gates.",
    });
    const pinnedGateInstructions = String(
      pinnedGateRun.requests[0]?.instructions ?? "",
    );
    for (const id of pinnedCapabilityIds) {
      assert.ok(pinnedGateInstructions.includes(`Pinned skill id: ${id}`));
    }
    assert.match(pinnedGateInstructions, /DEFERRED PINNED SKILLS/);
    assert.ok(
      pinnedGateInstructions.includes(
        "Deferred skill id: builtin:work-ppt-master",
      ),
    );
    assert.ok(
      pinnedGateInstructions.includes(
        "Deferred skill id: builtin:work-asd-ste100",
      ),
    );
    assert.ok(
      !pinnedGateInstructions.includes("# PPT Master Presentation Workflow"),
    );
    assert.ok(
      !pinnedGateInstructions.includes(
        "# Controlled English for WorkAgent Output",
      ),
    );
    assert.ok(
      pinnedGateInstructions.includes("# PDF Viewer Source 0.2.2/0.2.3"),
    );

    await api("saveAgentProfile", {
      ...gateProfile,
      permissions: { read: "allow" },
      toolAllowlist: ["web_search"],
    });
    const pinnedBlockedRun = await run(pinnedWorkSession, [], {
      text: "Verify that the whole use_skill tool is blocked by the profile allowlist.",
    });
    const pinnedBlockedInstructions = String(
      pinnedBlockedRun.requests[0]?.instructions ?? "",
    );
    for (const id of pinnedCapabilityIds) {
      assert.ok(pinnedBlockedInstructions.includes(`Pinned skill id: ${id}`));
      assert.ok(
        !pinnedBlockedInstructions.includes(`--- BEGIN PINNED SKILL ${id} ---`),
      );
    }
    assert.ok(
      !pinnedBlockedInstructions.includes("CONTROLLED PINNED-SKILL CONTEXT."),
    );
    assert.ok(
      !pinnedBlockedInstructions.includes("# PPT Master Presentation Workflow"),
    );
    assert.ok(
      !pinnedBlockedInstructions.includes(
        "# Controlled English for WorkAgent Output",
      ),
    );
  } finally {
    await api("updateSession", {
      sessionId: pinnedWorkSession.id,
      agentProfileId: "primary",
    });
    await api("removeAgentProfile", gateProfile.id);
  }
  passed.push(
    "Pinned preload honors default-allow, per-id ask/deny and the whole-tool allowlist while keeping exact ids visible as metadata",
  );

  const sourceCatalog = JSON.parse(
    await readFile(
      join(
        desktop,
        "resources",
        "prompts",
        "skills",
        "work-sources",
        "catalog.json",
      ),
      "utf8",
    ),
  ).entries;
  const discoveredSourceByPath = new Map(
    workSources.map((source) => [source.source_path, source]),
  );
  const selectedSourceIds = new Set(pinnedCapabilityIds);
  const rankedBudgetCandidates = [];
  for (const entry of sourceCatalog) {
    const source = discoveredSourceByPath.get(entry.sourcePath);
    if (!source || selectedSourceIds.has(source.id)) continue;
    const content = await readFile(
      join(desktop, "resources", "prompts", "skills", entry.entry),
      "utf8",
    );
    rankedBudgetCandidates.push({
      source,
      content,
      characters: builtinPromptContentCharacters(source.id, content, entry),
    });
  }
  rankedBudgetCandidates.sort(
    (left, right) => right.characters - left.characters,
  );
  const budgetExtras = [];
  const pptMasterContent = await readFile(
    join(
      desktop,
      "resources",
      "prompts",
      "skills",
      "work-ppt-master.md",
    ),
    "utf8",
  );
  const asdSte100Content = await readFile(
    join(
      desktop,
      "resources",
      "prompts",
      "skills",
      "work-asd-ste100.md",
    ),
    "utf8",
  );
  const pinnedPromptCharactersById = new Map([
    [
      "builtin:work-ppt-master",
      builtinPromptContentCharacters(
        "builtin:work-ppt-master",
        pptMasterContent,
      ),
    ],
    [
      "builtin:work-asd-ste100",
      builtinPromptContentCharacters(
        "builtin:work-asd-ste100",
        asdSte100Content,
      ),
    ],
  ]);
  let estimatedPinnedCharacters =
    pinnedPromptCharactersById.get("builtin:work-ppt-master") +
    pinnedPromptCharactersById.get("builtin:work-asd-ste100");
  const currentPdfCatalogEntry = sourceCatalog.find(
    (entry) => entry.sourcePath === currentPdfViewer.source_path,
  );
  assert.ok(currentPdfCatalogEntry);
  const currentPdfContent = await readFile(
    join(
      desktop,
      "resources",
      "prompts",
      "skills",
      currentPdfCatalogEntry.entry,
    ),
    "utf8",
  );
  const currentPdfPromptCharacters = builtinPromptContentCharacters(
    currentPdfViewer.id,
    currentPdfContent,
    currentPdfCatalogEntry,
  );
  pinnedPromptCharactersById.set(
    currentPdfViewer.id,
    currentPdfPromptCharacters,
  );
  estimatedPinnedCharacters += currentPdfPromptCharacters;
  for (const candidate of rankedBudgetCandidates) {
    if (budgetExtras.length >= 20 || estimatedPinnedCharacters > pinnedSkillPromptBudgetChars * 1.5) break;
    budgetExtras.push(candidate);
    pinnedPromptCharactersById.set(
      candidate.source.id,
      candidate.characters,
    );
    estimatedPinnedCharacters += candidate.characters;
  }
  assert.ok(estimatedPinnedCharacters > pinnedSkillPromptBudgetChars);
  assert.ok(budgetExtras.length > 0);
  for (const { source } of budgetExtras) {
    await api(
      "setSessionBuiltinCapability",
      pinnedWorkSession.id,
      source.id,
      true,
    );
  }
  const budgetSelectedIds = await selectedBuiltinIds(pinnedWorkSession.id);
  assert.equal(budgetSelectedIds.length, pinnedCapabilityIds.length + budgetExtras.length);
  const pinnedBudgetRun = await run(pinnedWorkSession, [], {
    text: "Verify the pinned preload character budget.",
  });
  const pinnedBudgetInstructions = String(
    pinnedBudgetRun.requests[0]?.instructions ?? "",
  );
  for (const id of budgetSelectedIds) {
    assert.ok(pinnedBudgetInstructions.includes(`Pinned skill id: ${id}`));
  }
  const expectedBudgetLoadedIds = [];
  const expectedBudgetDeferredIds = [];
  let expectedBudgetUsedCharacters = 0;
  for (const id of budgetSelectedIds) {
    const characters = pinnedPromptCharactersById.get(id);
    assert.equal(
      Number.isInteger(characters),
      true,
      `Missing pinned prompt length fixture for ${id}`,
    );
    if (
      expectedBudgetUsedCharacters + characters >
      pinnedSkillPromptBudgetChars
    ) {
      expectedBudgetDeferredIds.push(id);
    } else {
      expectedBudgetUsedCharacters += characters;
      expectedBudgetLoadedIds.push(id);
    }
  }
  const budgetLoadedIds = [
    ...pinnedBudgetInstructions.matchAll(
      /--- BEGIN PINNED SKILL (builtin:[^ ]+) ---/g,
    ),
  ].map((match) => match[1]);
  const budgetDeferredIds = [
    ...pinnedBudgetInstructions.matchAll(
      /Deferred skill id: (builtin:[^\r\n]+)/g,
    ),
  ].map((match) => match[1]);
  const budgetLoadedCount = budgetLoadedIds.length;
  const budgetDeferredCount = budgetDeferredIds.length;
  assert.ok(expectedBudgetLoadedIds.length > 0);
  assert.ok(expectedBudgetDeferredIds.length > 0);
  assert.ok(
    expectedBudgetUsedCharacters <= pinnedSkillPromptBudgetChars,
    "Expected pinned preload exceeds the 64k budget",
  );
  assert.deepEqual(budgetLoadedIds, expectedBudgetLoadedIds);
  assert.deepEqual(budgetDeferredIds, expectedBudgetDeferredIds);
  assert.equal(budgetLoadedCount + budgetDeferredCount, budgetSelectedIds.length);
  assert.match(pinnedBudgetInstructions, /DEFERRED PINNED SKILLS/);
  for (const { source } of budgetExtras) {
    await api(
      "setSessionBuiltinCapability",
      pinnedWorkSession.id,
      source.id,
      false,
    );
  }
  assert.deepEqual(
    (await selectedBuiltinIds(pinnedWorkSession.id)).sort(),
    [...pinnedCapabilityIds].sort(),
  );
  await renderer.send("Page.reload");
  await until(
    'Boolean(document.querySelector("[data-testid=agent-mode-work]"))',
    60_000,
  );
  await installRuntimeListener();
  await selectWorkspaceSession(pinnedWorkSession);
  await until(
    `(${builtinChipMatchesExpression(currentPdfViewer.id)}).length===1`,
  );
  passed.push(
    "The 64k pinned preload budget reports loaded and deferred exact ids without losing the selected metadata or persisted selection",
  );

  scenario = { hold: true };
  held = undefined;
  const busyRun = await api("sendChat", {
    sessionId: pinnedWorkSession.id,
    text: "Hold the run while pinned capability locks are checked.",
  });
  for (let index = 0; index < 200 && !held; index += 1) await sleep(50);
  assert.ok(held, "The held provider request did not start");
  await until(
    'document.querySelector(".extension-trigger:not(.extension-trigger--attachment)")?.disabled',
  );
  await until(
    '[...document.querySelectorAll(".reference-chip--builtin")].length===3&&[...document.querySelectorAll(".reference-chip--builtin")].every(chip=>chip.disabled)',
  );
  await until(
    'document.querySelector("[data-testid=agent-mode-code]")?.disabled&&document.querySelector("[data-testid=agent-mode-work]")?.getAttribute("aria-pressed")==="true"&&document.querySelector("[data-testid=agent-mode-chat]")?.disabled',
  );
  const busyModeError = await renderer.evaluate(
    `window.mingshen.updateSession({sessionId:${JSON.stringify(pinnedWorkSession.id)},agentMode:"code"}).then(()=>"",error=>String(error))`,
  );
  assert.match(busyModeError, /\u8bf7\u5148\u505c\u6b62/);
  const busyMutationError = await renderer.evaluate(
    `window.mingshen.setSessionBuiltinCapability(${JSON.stringify(
      pinnedWorkSession.id,
    )},${JSON.stringify(
      currentPdfViewer.id,
    )},false).then(()=>"",error=>String(error))`,
  );
  assert.match(busyMutationError, /\u6b63\u5728\u8fd0\u884c/);
  await renderer.evaluate(
    `(${builtinChipMatchesExpression(currentPdfViewer.id)})[0]?.click();true`,
  );
  await sleep(200);
  assert.deepEqual(
    (await selectedBuiltinIds(pinnedWorkSession.id)).sort(),
    [...pinnedCapabilityIds].sort(),
  );
  await api("stopChat", pinnedWorkSession.id);
  held?.destroy();
  held = undefined;
  await until(
    `globalThis.__localPluginEvents.some(event=>event.runId===${JSON.stringify(
      busyRun.runId,
    )}&&event.type==="run_interrupted")`,
  );
  scenario = { steps: [], next: 0 };
  await until(
    '!document.querySelector(".extension-trigger:not(.extension-trigger--attachment)")?.disabled',
  );
  await until(
    '[...document.querySelectorAll(".reference-chip--builtin")].length===3&&[...document.querySelectorAll(".reference-chip--builtin")].every(chip=>!chip.disabled)',
  );
  passed.push(
    "A live pinned Work run disables capability and mode controls, rejects direct IPC mutation, preserves chips, and unlocks only after manual stop",
  );

  await selectWorkspaceSession({
    ...pinnedWorkSession,
    agentMode: "code",
  });
  await until(
    '![...document.querySelectorAll(".reference-chip--builtin")].some(chip=>["pdf-viewer","work-asd-ste100","work-ppt-master"].includes(chip.querySelector("strong")?.textContent.trim()))',
  );
  const codePinnedCapabilities = await api(
    "listSessionBuiltinCapabilities",
    pinnedWorkSession.id,
  );
  assert.ok(
    !codePinnedCapabilities.some(
      (capability) =>
        capability.id === "builtin:work-ppt-master" ||
        capability.id === "builtin:work-asd-ste100" ||
        capability.id === currentPdfViewer.id,
    ),
  );
  assert.deepEqual(
    codePinnedCapabilities.filter((capability) => capability.selected),
    [],
  );
  await openBuiltinPicker("work-ppt-master");
  assert.equal(
    await renderer.evaluate(
      `${builtinPickerMatchesExpression("work-ppt-master")}.length`,
    ),
    0,
  );
  await click(".extension-trigger:not(.extension-trigger--attachment)");
  const codePinnedRun = await run(
    {
      ...pinnedWorkSession,
      agentMode: "code",
    },
    [{ name: "use_skill", args: { name: currentPdfViewer.id } }],
    { text: "Verify Work-only pinned ids stay unavailable in Code mode." },
  );
  assert.equal(codePinnedRun.results.length, 1);
  assert.equal(codePinnedRun.results[0].isError, true);
  assert.match(codePinnedRun.results[0].output, /SKILL_MODE_UNAVAILABLE/);
  assert.ok(codePinnedRun.requests.length > 0);
  for (const request of codePinnedRun.requests) {
    const codeInstructions = String(request.instructions ?? "");
    for (const id of pinnedCapabilityIds) {
      assert.ok(
        !codeInstructions.includes(id),
        `Code provider instructions leaked pinned Work id ${id}`,
      );
    }
    for (const marker of [
      "SESSION-PINNED SKILLS",
      "CONTROLLED PINNED-SKILL CONTEXT.",
      "BEGIN PINNED SKILL",
      "# PPT Master Presentation Workflow",
      "# Controlled English for WorkAgent Output",
      "# PDF Viewer Source 0.2.2/0.2.3",
      currentPdfViewer.source_path,
      currentPdfViewer.source_sha256,
    ]) {
      assert.ok(
        !codeInstructions.includes(marker),
        `Code provider instructions leaked pinned Work marker ${marker}`,
      );
    }
  }

  const restoredPinnedWork = await api("getSession", pinnedWorkSession.id);
  assert.equal(restoredPinnedWork.agentMode, "code");
  await selectWorkspaceSession(pinnedWorkSession);
  assert.equal(
    (await api("getSession", pinnedWorkSession.id)).agentMode,
    "work",
  );
  await until(
    `[...document.querySelectorAll(".reference-chip--builtin")].length===3`,
  );
  assert.deepEqual(
    (await selectedBuiltinIds(pinnedWorkSession.id)).sort(),
    [...pinnedCapabilityIds].sort(),
  );
  passed.push(
    "Work-only pinned choices disappear in Code mode, return when the same shared workspace session switches back to Work, and Code rejects the exact Work id",
  );

  pinnedCapabilityEvidence = {
    sessionId: pinnedWorkSession.id,
    selectedIds: pinnedCapabilityIds,
    legacyPdfViewerId: legacyPdfViewer.id,
    currentPdfViewerId: currentPdfViewer.id,
    currentPdfViewerSourcePath: currentPdfViewer.source_path,
    currentPdfViewerSourceSha256: currentPdfViewer.source_sha256,
    firstRequestLoadedIds: pinnedCapabilityIds,
    permissionGateDeferredIds: [
      "builtin:work-ppt-master",
      "builtin:work-asd-ste100",
    ],
    allowlistBlockedAllBodies: true,
    estimatedBudgetCharacters: estimatedPinnedCharacters,
    expectedBudgetUsedCharacters,
    expectedBudgetLoadedIds,
    expectedBudgetDeferredIds,
    budgetSelectedCount: budgetSelectedIds.length,
    budgetLoadedCount,
    budgetDeferredCount,
    busyMutationRejected: true,
    busyUiLocked: true,
    codeRequestIsolation: true,
    pluginUiPreferenceVerified: true,
    pluginUseSkillRejected: true,
    newAbilityUiScreenshots: [
      "work-capability-picker-foundations-orbit-day",
      "work-capability-picker-foundations-orbit-night",
      "work-capability-picker-foundations-orbit-english-800",
      "work-capability-picker-pdf-versions-orbit-day",
      "work-plugin-picker-selected-orbit-night",
      "work-capability-chips-with-plugin-orbit-night",
    ],
    modeSwitchRestored: true,
  };

  await selectWorkspaceSession(codeSession);
  const codeWorkSourceIsolation = await run(
    codeSession,
    [
      {
        name: "discover_capabilities",
        args: { query: "pdf", kind: "skill", limit: 50 },
      },
      { name: "use_skill", args: { name: sampleSources[0].id } },
    ],
    { text: "Verify that Work sources are unavailable to CodeAgent." },
  );
  assert.equal(codeWorkSourceIsolation.results.length, 2);
  const codePdfDiscovery = parseToolResultJson(
    codeWorkSourceIsolation.results[0],
    "Code PDF discovery",
  );
  assert.ok(
    !(codePdfDiscovery.matches ?? []).some(
      (match) =>
        match.builtin_kind === "work-source" ||
        String(match.id).startsWith("builtin:work-source-"),
    ),
    JSON.stringify(codePdfDiscovery),
  );
  assert.equal(codeWorkSourceIsolation.results[1].isError, true);
  assert.match(
    codeWorkSourceIsolation.results[1].output,
    /SKILL_MODE_UNAVAILABLE/,
  );
  passed.push("CodeAgent cannot discover or load packaged Work source ids");

  await openExtensionsSettings();
  await until(
    'Boolean(document.querySelector(\'[data-testid="local-plugin-market-path"]\'))',
  );
  await fill('[data-testid="local-plugin-validation-path"]', pluginRoot);
  await click('[data-testid="local-plugin-validate"]');
  await until(
    'Boolean(document.querySelector(\'[data-testid="local-plugin-validation-result"]\'))',
  );
  const validationText = await renderer.evaluate(
    'document.querySelector(\'[data-testid="local-plugin-validation-result"]\').innerText',
  );
  assert.ok(validationText.includes(pluginName), validationText);
  assert.ok(validationText.includes("0.1.0"), validationText);
  assert.ok(
    await renderer.evaluate(
      'Boolean(document.querySelector(\'[data-testid="local-plugin-validation-result"] .local-plugin-marketplace__valid\'))',
    ),
  );

  await fill('[data-testid="local-plugin-market-path"]', marketRoot);
  await click('[data-testid="local-plugin-market-add"]');
  await until(
    `Boolean(document.querySelector('[data-testid="local-plugin-${pluginName}"]'))`,
    60_000,
  );
  const marketError = await renderer.evaluate(
    'document.querySelector(\'[data-testid="local-plugin-marketplace"] .form-error\')?.innerText ?? ""',
  );
  assert.equal(marketError, "");
  await until(
    `Boolean(document.querySelector('[data-testid="local-plugin-install-${pluginName}"]') && !document.querySelector('[data-testid="local-plugin-install-${pluginName}"]').disabled)`,
  );
  await click(`[data-testid="local-plugin-install-${pluginName}"]`);
  await until(
    `Boolean(document.querySelector('[data-testid="local-plugin-toggle-${pluginName}"][role="switch"][aria-checked="true"]'))`,
    90_000,
  );
  const marketSources = await api("listLocalPluginMarkets");
  assert.equal(marketSources.length, 1);
  marketId = marketSources[0].id;
  const marketV1 = await api("getLocalPluginMarket", marketId);
  assert.equal(marketV1.plugins[0].installed, true);
  assert.equal(marketV1.plugins[0].enabled, true);
  const extensionsV1 = await api("listExtensions");
  const pluginV1 = extensionsV1.find(
    (extension) => extension.type === "plugin" && extension.name === pluginName,
  );
  assert.ok(pluginV1);
  extensionId = pluginV1.id;
  installedPathV1 = pluginV1.installedPath;
  assert.equal(pluginV1.enabled, true);
  assert.equal(pluginV1.skillCount, 1);
  assert.equal(pluginV1.mcpServerCount, 1);
  assert.ok(pluginV1.hookCount >= 2);
  await api("setSessionExtension", codeSession.id, extensionId, true);
  assert.ok((await api("listSessionExtensions", codeSession.id)).includes(extensionId));
  await capture("marketplace-v1-installed");
  passed.push(
    "Real Settings UI validates, adds, installs and enables the local marketplace plugin",
  );

  await closeSettings();
  const commandsV1 = await api("listCustomCommands", project);
  assert.ok(
    commandsV1.some(
      (command) =>
        command.name === `${pluginName}:review` &&
        command.template.includes("LOCAL_PLUGIN_COMMAND_V010"),
    ),
  );

  const discoveryV1 = await run(codeSession, [
    {
      name: "discover_capabilities",
      args: { query: "LOCAL_PLUGIN_SKILL_V010" },
    },
  ]);
  const discoveryResult = discoveryV1.results.find((result) =>
    result.output.includes("LOCAL_PLUGIN_SKILL_V010"),
  );
  assert.ok(discoveryResult, JSON.stringify(discoveryV1.results));
  skillIdV1 = skillIdFrom(discoveryResult);
  assert.ok(skillIdV1.startsWith(`${extensionId}/`));
  mcpToolV1 = mcpToolFrom(discoveryV1.requests[0]);
  assert.ok(
    discoveryV1.requests.some((request) =>
      String(request.instructions ?? "").includes(
        "LOCAL_PLUGIN_PROMPT_HOOK_V010",
      ),
    ),
  );

  const runtimeV1 = await run(
    codeSession,
    [
      { name: "use_skill", args: { name: skillIdV1 } },
      {
        name: "local_plugin",
        args: { action: "validate", rootPath: pluginRoot },
      },
      { name: "local_plugin", args: { action: "list_markets" } },
      {
        name: mcpToolV1,
        args: { text: "LOCAL_PLUGIN_MCP_DIRECT_V010" },
      },
    ],
    { approveHooks: true },
  );
  assert.ok(
    runtimeV1.results.every((result) => !result.isError),
    JSON.stringify(runtimeV1.results),
  );
  assert.ok(
    runtimeV1.results.some((result) =>
      result.output.includes("LOCAL_PLUGIN_SKILL_BODY_V010"),
    ),
  );
  const localPluginValidation = runtimeV1.results.find((result) =>
    result.output.includes('"action": "validate"'),
  );
  assert.ok(localPluginValidation);
  assert.ok(localPluginValidation.output.includes('"readOnly": true'));
  assert.ok(localPluginValidation.output.includes('"lifecycleChanged": false'));
  assert.ok(localPluginValidation.output.includes('"validation"'));
  assert.ok(
    runtimeV1.results.some((result) => result.output.includes(marketId)),
  );
  assert.ok(
    runtimeV1.results.some((result) =>
      result.output.includes("LOCAL_PLUGIN_MCP_ECHO"),
    ),
  );
  assert.ok(
    runtimeV1.approvals.some(
      (approval) =>
        /fixture/i.test(approval) && /echo/i.test(approval),
    ),
    JSON.stringify(runtimeV1.approvals),
  );
  const mcpLogV1 = await readMcpLog();
  assert.ok(mcpLogV1.includes("LOCAL_PLUGIN_HOOK_MCP_V010"));
  assert.ok(mcpLogV1.includes("LOCAL_PLUGIN_MCP_DIRECT_V010"));
  passed.push(
    "CodeAgent discovers and loads the exact installed Skill, uses read-only local_plugin, calls plugin MCP and executes an approved PostToolUse MCP Hook",
  );

  const commandRunV1 = await run(codeSession, [], {
    text: `/${pluginName}:review LOCAL_PLUGIN_COMMAND_ARGUMENT_V010`,
  });
  assert.ok(
    commandRunV1.requests.some((request) =>
      JSON.stringify(request).includes("LOCAL_PLUGIN_COMMAND_V010"),
    ),
  );
  assert.ok(
    commandRunV1.requests.some((request) =>
      JSON.stringify(request).includes("LOCAL_PLUGIN_COMMAND_ARGUMENT_V010"),
    ),
  );
  passed.push(
    "The real sendChat path expands the installed plugin command template and arguments",
  );

  await openExtensionsSettings();
  await click(`[data-testid="local-plugin-toggle-${pluginName}"]`);
  await until(
    `document.querySelector('[data-testid="local-plugin-toggle-${pluginName}"]')?.getAttribute("aria-checked")==="false"`,
  );
  assert.equal(
    (await api("listExtensions")).find(
      (extension) => extension.id === extensionId,
    )?.enabled,
    false,
  );
  const commandsDisabled = await api("listCustomCommands", project);
  assert.equal(
    commandsDisabled.some(
      (command) => command.name === `${pluginName}:review`,
    ),
    false,
  );
  const disabledRun = await run(codeSession, [
    {
      name: "discover_capabilities",
      args: { query: "LOCAL_PLUGIN_SKILL_V010" },
    },
    { name: "use_skill", args: { name: skillIdV1 } },
  ]);
  assert.equal(disabledRun.results[0]?.isError, false);
  const disabledDiscoveryOutput = disabledRun.results[0]?.output ?? "";
  const disabledDiscovery = JSON.parse(
    disabledDiscoveryOutput.slice(disabledDiscoveryOutput.indexOf("{")),
  );
  assert.equal(disabledDiscovery.total, 0);
  assert.deepEqual(disabledDiscovery.matches, []);
  assert.equal(disabledRun.results[1]?.isError, true);
  assert.ok(
    !(disabledRun.requests[0]?.tools ?? []).some((tool) =>
      String(tool.name ?? "").startsWith("mcp__"),
    ),
  );
  assert.ok(
    disabledRun.requests.every(
      (request) =>
        !String(request.instructions ?? "").includes(
          "LOCAL_PLUGIN_PROMPT_HOOK_V010",
        ),
    ),
  );
  passed.push(
    "Marketplace switch disables Skills, MCP tools, commands and prompt hooks together",
  );

  await writePluginVersion("0.2.0");
  await upsertMarketplace(marketRoot, marketName, [pluginRoot]);
  await click('[data-testid="local-plugin-market-refresh"]');
  await until(
    `Boolean(document.querySelector('[data-testid="local-plugin-update-${pluginName}"]') && !document.querySelector('[data-testid="local-plugin-update-${pluginName}"]').disabled)`,
    60_000,
  );
  await click(`[data-testid="local-plugin-update-${pluginName}"]`);
  await until(
    `window.mingshen.listExtensions().then(list=>list.some(extension=>extension.id===${JSON.stringify(extensionId)}&&!extension.enabled&&extension.installedPath!==${JSON.stringify(installedPathV1)}))`,
    90_000,
  );
  const updated = (await api("listExtensions")).find(
    (extension) => extension.id === extensionId,
  );
  assert.ok(updated);
  assert.equal(updated.enabled, false);
  assert.notEqual(updated.installedPath, installedPathV1);
  assert.equal(
    (await api("listSessionExtensions", codeSession.id)).includes(extensionId),
    false,
    "Disabled plugin references must be filtered from the active session capabilities",
  );
  const marketV2 = await api("getLocalPluginMarket", marketId);
  assert.equal(marketV2.plugins[0].installedVersion, "0.2.0");
  assert.equal(marketV2.plugins[0].enabled, false);
  assert.equal(marketV2.plugins[0].updateAvailable, false);
  await capture("marketplace-v2-updated-disabled");
  passed.push(
    "Real Settings UI updates the plugin in place, keeping its extension ID, disabled state and session reference",
  );

  await close();
  await launch();
  await installRuntimeListener();
  const persistedPinnedSession = await api("getSession", pinnedWorkSession.id);
  assert.equal(persistedPinnedSession.agentMode, "work");
  assert.deepEqual(
    (await selectedBuiltinIds(pinnedWorkSession.id)).sort(),
    [...pinnedCapabilityEvidence.selectedIds].sort(),
  );
  await selectWorkspaceSession(persistedPinnedSession);
  await until(
    `[...document.querySelectorAll(".reference-chip--builtin")].length===${pinnedCapabilityEvidence.selectedIds.length}`,
  );
  assert.deepEqual(
    (await selectedBuiltinChipNames()).sort(),
    ["pdf-viewer", "work-asd-ste100", "work-ppt-master"],
  );
  pinnedCapabilityEvidence.restartPersisted = true;
  passed.push(
    "A normal Electron restart restores the exact pinned Work ids and visible capability chips",
  );
  await selectWorkspaceSession(codeSession);
  const persistedSources = await api("listLocalPluginMarkets");
  assert.equal(persistedSources.length, 1);
  assert.equal(persistedSources[0].id, marketId);
  const persistedExtensions = await api("listExtensions");
  const persistedPlugin = persistedExtensions.find(
    (extension) => extension.id === extensionId,
  );
  assert.ok(persistedPlugin);
  assert.equal(persistedPlugin.enabled, false);
  assert.equal(persistedPlugin.installedPath, updated.installedPath);
  assert.equal(await pathExists(persistedPlugin.installedPath), true);
  assert.equal(
    await pathExists(installedPathV1),
    false,
    "The previous plugin version must be removed after a normal quit",
  );
  assert.equal(
    (await api("listSessionExtensions", codeSession.id)).includes(extensionId),
    false,
  );
  const persistedMarket = await api("getLocalPluginMarket", marketId);
  assert.equal(persistedMarket.plugins[0].installed, true);
  assert.equal(persistedMarket.plugins[0].enabled, false);
  assert.equal(persistedMarket.plugins[0].installedVersion, "0.2.0");
  await openExtensionsSettings();
  await until(
    'Boolean(document.querySelector(\'[data-testid^="local-plugin-toggle-"]\'))',
  );
  await capture("marketplace-v2-restart-persisted");
  await capture("marketplace-v2-simple-800", 800, 900);
  await renderer.send("Emulation.clearDeviceMetricsOverride");
  passed.push(
    "A normal Electron restart preserves the market, provenance, extension ID, disabled state and session selection",
  );

  await click(`[data-testid="local-plugin-toggle-${pluginName}"]`);
  await until(
    `document.querySelector('[data-testid="local-plugin-toggle-${pluginName}"]')?.getAttribute("aria-checked")==="true"`,
  );
  assert.equal(
    (await api("listExtensions")).find(
      (extension) => extension.id === extensionId,
    )?.enabled,
    true,
  );
  assert.ok(
    (await api("listSessionExtensions", codeSession.id)).includes(extensionId),
    "Re-enabling after an update and restart must restore the persisted session reference",
  );
  await closeSettings();

  const commandsV2 = await api("listCustomCommands", project);
  assert.ok(
    commandsV2.some(
      (command) =>
        command.name === `${pluginName}:review` &&
        command.template.includes("LOCAL_PLUGIN_COMMAND_V020"),
    ),
  );
  const discoveryV2 = await run(codeSession, [
    {
      name: "discover_capabilities",
      args: { query: "LOCAL_PLUGIN_SKILL_V020" },
    },
  ]);
  const discoveryV2Result = discoveryV2.results.find((result) =>
    result.output.includes("LOCAL_PLUGIN_SKILL_V020"),
  );
  assert.ok(discoveryV2Result, JSON.stringify(discoveryV2.results));
  skillIdV2 = skillIdFrom(discoveryV2Result);
  mcpToolV2 = mcpToolFrom(discoveryV2.requests[0]);
  assert.ok(
    discoveryV2.requests.some((request) =>
      String(request.instructions ?? "").includes(
        "LOCAL_PLUGIN_PROMPT_HOOK_V020",
      ),
    ),
  );
  const runtimeV2 = await run(
    codeSession,
    [
      { name: "use_skill", args: { name: skillIdV2 } },
      {
        name: mcpToolV2,
        args: { text: "LOCAL_PLUGIN_MCP_DIRECT_V020" },
      },
    ],
    { approveHooks: true },
  );
  assert.ok(
    runtimeV2.results.every((result) => !result.isError),
    JSON.stringify(runtimeV2.results),
  );
  assert.ok(
    runtimeV2.results.some((result) =>
      result.output.includes("LOCAL_PLUGIN_SKILL_BODY_V020"),
    ),
  );
  assert.ok(
    runtimeV2.results.some((result) =>
      result.output.includes("LOCAL_PLUGIN_MCP_ECHO"),
    ),
  );
  const mcpLogV2 = await readMcpLog();
  assert.ok(mcpLogV2.includes("LOCAL_PLUGIN_HOOK_MCP_V020"));
  assert.ok(mcpLogV2.includes("LOCAL_PLUGIN_MCP_DIRECT_V020"));
  const commandRunV2 = await run(codeSession, [], {
    text: `/${pluginName}:review LOCAL_PLUGIN_COMMAND_ARGUMENT_V020`,
  });
  assert.ok(
    commandRunV2.requests.some((request) =>
      JSON.stringify(request).includes("LOCAL_PLUGIN_COMMAND_V020"),
    ),
  );
  assert.ok(
    commandRunV2.requests.some((request) =>
      JSON.stringify(request).includes("LOCAL_PLUGIN_COMMAND_ARGUMENT_V020"),
    ),
  );
  passed.push(
    "After restart and re-enable, the V0.2.0 Skill, MCP, Hook and command are loaded from the updated install",
  );

  const chatSession = await api("createSession", {
    ...baseSessionInput,
    agentMode: "chat",
    workspacePath: null,
    permissionMode: "request_approval",
    approvalMode: "manual",
    title: "Local plugin Chat isolation",
  });
  const chatRun = await run(chatSession, [
    {
      name: "discover_capabilities",
      args: { query: "LOCAL_PLUGIN_SKILL_V020" },
    },
    { name: "use_skill", args: { name: skillIdV2 } },
    { name: "use_skill", args: { name: sampleSources[0].id } },
    {
      name: "local_plugin",
      args: { action: "validate", rootPath: pluginRoot },
    },
    { name: mcpToolV2, args: { text: "CHAT_MUST_NOT_CALL_MCP" } },
    { name: "read_file", args: { path: join(project, "blocked.txt") } },
  ]);
  assert.equal(chatRun.results.length, 6);
  assert.ok(
    chatRun.results.every(
      (result) =>
        result.isError && result.output.includes("CHAT_TOOL_DENIED"),
    ),
    JSON.stringify(chatRun.results),
  );
  assert.deepEqual(
    (chatRun.requests[0]?.tools ?? []).map((tool) => tool.name).sort(),
    ["web_fetch", "web_search"],
  );
  assert.ok(
    chatRun.requests.every(
      (request) =>
        !JSON.stringify(request).includes("LOCAL_PLUGIN_PROMPT_HOOK_V020"),
    ),
  );
  assert.ok(
    chatRun.requests.every(
      (request) =>
        !JSON.stringify(request).includes("LOCAL_PLUGIN_COMMAND_V020"),
    ),
  );
  const chatBuiltinListError = await renderer.evaluate(
    `window.mingshen.listSessionBuiltinCapabilities(${JSON.stringify(
      chatSession.id,
    )}).then(()=>"",error=>String(error))`,
  );
  assert.match(chatBuiltinListError, /CHAT_CAPABILITY_UNAVAILABLE/);
  const chatBuiltinSetError = await renderer.evaluate(
    `window.mingshen.setSessionBuiltinCapability(${JSON.stringify(
      chatSession.id,
    )},"builtin:work-ppt-master",true).then(()=>"",error=>String(error))`,
  );
  assert.match(chatBuiltinSetError, /CHAT_CAPABILITY_UNAVAILABLE/);
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector("[data-testid=agent-mode-chat]"))');
  await click('[data-testid="agent-mode-chat"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="chat"');
  await until(
    `Boolean(document.querySelector('[data-session-id="${chatSession.id}"] .chat-session-row__main'))`,
    60_000,
  );
  await click(
    `[data-session-id="${chatSession.id}"] .chat-session-row__main`,
  );
  await until(
    'document.querySelector(".app-shell")?.dataset.agentMode==="chat"',
  );
  await until('Boolean(document.querySelector(\'[data-testid="chat-attachments"]\'))');
  assert.equal(
    await renderer.evaluate(
      'Boolean(document.querySelector(".extension-trigger:not(.extension-trigger--attachment)"))',
    ),
    false,
  );
  assert.equal(
    await renderer.evaluate(
      'document.querySelectorAll(".reference-chip--builtin").length',
    ),
    0,
  );
  await installRuntimeListener();
  await click('[data-testid="agent-mode-code"]');
  await until(
    'document.querySelector(".app-shell")?.dataset.agentMode==="code"',
  );
  expectedDenials.push(
    "discover_capabilities",
    "use_skill",
    "use_skill:work-source",
    "local_plugin",
    mcpToolV2,
    "read_file",
    "listSessionBuiltinCapabilities:chat",
    "setSessionBuiltinCapability:chat",
  );
  passed.push(
    "ChatAgent has an attachment-only composer, rejects built-in capability list/set APIs, receives only web_search/web_fetch and rejects installed Skills, Work sources, local_plugin, plugin MCP, commands, hooks and local file tools",
  );

  const uiPreferences = await api("getUiPreferences");
  await api("saveUiPreferences", { ...uiPreferences, interfaceStyle: "orbit" });
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector(".app-shell--orbit"))', 60_000);
  await openExtensionsSettings();
  await capture("marketplace-v2-orbit-day");
  await renderer.evaluate(
    'document.documentElement.dataset.theme="night";localStorage.setItem("mingshen.theme","night");true',
  );
  await capture("marketplace-v2-orbit-night");
  await renderer.evaluate(`(()=>{
    const button=[...document.querySelectorAll(".desktop-caption button")].find(node=>(node.getAttribute("aria-label")??"").includes("English"));
    if(!button)throw new Error("Missing locale switch");
    button.click();return true;
  })()`);
  await until(
    'document.querySelector(\'[data-testid="local-plugin-marketplace"]\')?.textContent.includes("Local plugin development marketplace")',
  );
  await capture("marketplace-v2-orbit-english-800", 800, 900);
  passed.push(
    "The marketplace renders visibly without page overflow in Simple and Orbit, day and night, including English at 800 pixels",
  );

  assert.deepEqual(errors, []);
  const result = {
    ok: true,
    passed,
    evidence,
    screenshots,
    layoutMeasurements,
    modelRequestCount: requests.length,
    approvals,
    approvalRecords,
    expectedDenials,
    protectedReadAudit,
    pinnedCapabilities: pinnedCapabilityEvidence,
    builtInWorkCatalog: {
      inventoryPages: workInventory.pages,
      foundationSkillCount: workFoundationSkills.length,
      sourceCount: workSources.length,
      uniqueSourceCount: new Set(workSources.map((source) => source.source_sha256))
        .size,
      pluginIds: workPluginInventory.matches.map((match) => match.id),
      codeSkillCount: codeSkillInventory.matches.length,
      codePluginIds: codePluginInventory.matches.map((match) => match.id),
      pdfSourceIds: workPdfSources.map((source) => source.id),
      pdfDiscoveryPages: workPdfDiscovery.pages,
      loadedPdfSourceIds: pdfSelections.map((source) => source.id),
      legacyPdfViewerId: legacyPdfViewer.id,
      currentPdfViewerId: currentPdfViewer.id,
      sampleSources: workSourceSamples.map(({ label, source }) => ({
        label,
        id: source.id,
        compatibility: source.compatibility,
        sourceSha256: source.source_sha256,
      })),
      historicalSameShaIds: historicalWorkSources.map((source) => source.id),
    },
    persistence: {
      marketId,
      extensionId,
      disabledAcrossRestart: true,
      sessionReferencePreserved: true,
      installedPathChangedOnUpdate: installedPathV1 !== updated.installedPath,
      currentInstalledPathExists: true,
      staleInstalledPathRemovedOnExit: true,
    },
    mcpCalls: {
      v010: [
        mcpLogV1.includes("LOCAL_PLUGIN_HOOK_MCP_V010")
          ? "LOCAL_PLUGIN_HOOK_MCP_V010"
          : null,
        mcpLogV1.includes("LOCAL_PLUGIN_MCP_DIRECT_V010")
          ? "LOCAL_PLUGIN_MCP_DIRECT_V010"
          : null,
      ].filter(Boolean),
      v020: [
        mcpLogV2.includes("LOCAL_PLUGIN_HOOK_MCP_V020")
          ? "LOCAL_PLUGIN_HOOK_MCP_V020"
          : null,
        mcpLogV2.includes("LOCAL_PLUGIN_MCP_DIRECT_V020")
          ? "LOCAL_PLUGIN_MCP_DIRECT_V020"
          : null,
      ].filter(Boolean),
    },
    boundaries:
      "Synthetic local Responses model, temporary local stdio MCP and isolated Electron profile only. No real API key, user database, paid service, installer or cloud operation is used.",
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
        screenshots,
        layoutMeasurements,
        approvals,
        approvalRecords,
        expectedDenials,
        protectedReadAudit,
        pinnedCapabilities: pinnedCapabilityEvidence,
        requestCount: requests.length,
        errors,
        failure: String(error.stack ?? error),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  throw error;
} finally {
  held?.destroy();
  held = undefined;
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
