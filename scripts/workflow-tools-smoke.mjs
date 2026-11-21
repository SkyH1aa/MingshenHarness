import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as portServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const temporary = await mkdtemp(join(tmpdir(), "mingshen-workflow-tools-"));
const project = join(temporary, "project");
const evidence = resolve(".impeccable/review", `v134-workflow-tools-${Date.now()}`);
const profile = join(temporary, "profile");
const passed = [], requests = [], exceptions = [], screenshots = [], serviceErrors = [], approvals = [], workerIntervals = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let child, main, renderer, session, model, provider;
let maxConcurrentWorkers = 0, concurrentWorkers = 0;
let holdPlanning = false;
let holdDraft = false;

const suggestions = {
  suggestions: [
    {
      title: "Strengthen regression coverage",
      summary: "Add focused boundary and integration checks for the actual project workflow.",
      rationale: "The repository contains a working baseline and needs evidence for future changes.",
      steps: ["Inspect current tests and ownership", "Add checks for uncovered boundary conditions"],
      risks: ["Avoid tests that only mirror the implementation"],
      verification: ["Run the targeted regression suite and inspect its actual output"],
    },
    {
      title: "Improve operational documentation",
      summary: "Document setup, failure recovery and supported deployment prerequisites for maintainers.",
      rationale: "Clear operational guidance reduces recovery time without changing production code.",
      steps: ["Review the existing README and runtime entry", "Write concrete startup and recovery steps"],
      risks: ["Do not claim integrations that were not exercised"],
      verification: ["Check every documented command and local link"],
    },
    {
      title: "Measure the user workflow",
      summary: "Measure repeated project actions before making a targeted performance improvement.",
      rationale: "The next performance decision should come from observed workflow latency and limits.",
      steps: ["Identify the slowest repeated action", "Capture a reproducible local measurement"],
      risks: ["Keep private user content out of the measurements"],
      verification: ["Compare repeatable before and after measurements"],
    },
  ],
};

function finish(response, text, output = []) {
  if (response.destroyed) return;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  if (text) response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`);
  response.end(`data: ${JSON.stringify({ type: "response.completed", response: {
    status: "completed", output, usage: { input_tokens: 500, output_tokens: 120, total_tokens: 620 },
  } })}\n\n`);
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const instructions = body.instructions || "";
    const input = body.input || [];
    const userText = input.filter((item) => item.role === "user").map((item) => JSON.stringify(item.content)).join("\n");
    const calls = input.filter((item) => item.type === "function_call");
    const has = (name) => calls.some((item) => item.name === name);
    const tool = (name, args) => ({ type: "function_call", name, call_id: `fixture-${requests.length}-${name}`, arguments: JSON.stringify(args) });
    requests.push({ url: request.url, body, at: Date.now() });
    if (instructions.includes("[PROJECT_MEMORY_SUMMARY]")) {
      assert.deepEqual(body.tools ?? [], []);
      return finish(response, "The isolated project workflow was inspected through explicit local fixtures. Draft refinement preserved the supplied intent, temporary guidance applied only to its accepted turn, and repository evidence informed the next planning choices. Verification records distinguish completed work from missing evidence. Future changes should preserve file boundaries, approval requirements, draft persistence and independently confirmed runtime results.");
    }
    if (instructions.includes("draft editor for Mingshen Harness")) {
      assert.deepEqual(body.tools ?? [], []);
      if (holdDraft) return;
      return finish(response, "Polished workflow draft with all original constraints preserved.");
    }
    if (userText.includes("AUTODRIVE_EVIDENCE_JSON")) {
      assert.deepEqual(body.tools ?? [], []);
      if (holdPlanning) return;
      return finish(response, JSON.stringify(suggestions));
    }
    if (userText.includes("子任务：") && /WORKFLOW_WORKER_[AB]/.test(userText)) {
      const worker = userText.includes("WORKFLOW_WORKER_A") ? "A" : "B";
      if (!has("read_file")) {
        const interval = { worker, start: Date.now(), end: null };
        workerIntervals.push(interval);
        concurrentWorkers += 1;
        maxConcurrentWorkers = Math.max(maxConcurrentWorkers, concurrentWorkers);
        await sleep(250);
        concurrentWorkers -= 1;
        interval.end = Date.now();
        return finish(response, "", [tool("read_file", { path: "src/example.ts" })]);
      }
      if (!has("request_verification") && !userText.includes("WORKFLOW_COORDINATION_BLOCKED")) return finish(response, "", [tool("request_verification", { commands: [`Write-Output 'WORKFLOW_VERIFIED_${worker}'`] })]);
      return finish(response, `Worker ${worker} inspected src/example.ts and requested explicit verification.`);
    }
    if (userText.includes("独立复核协同目标：WORKFLOW_COORDINATION")) {
      if (!has("read_file")) return finish(response, "", [tool("read_file", { path: "src/example.ts" })]);
      return finish(response, JSON.stringify({ verdict: "passed", summary: "The assigned evidence and parent verification were checked.", evidence: ["src/example.ts was read by QA", "Parent verification contains WORKFLOW_VERIFIED_A and WORKFLOW_VERIFIED_B"] }));
    }
    if (userText.includes("WORKFLOW_COORDINATION")) {
      if (!has("coordinate_agents")) return finish(response, "", [tool("coordinate_agents", {
        goal: `${userText.includes("WORKFLOW_COORDINATION_BLOCKED") ? "WORKFLOW_COORDINATION_BLOCKED" : "WORKFLOW_COORDINATION"}: independently inspect two project concerns`,
        qa_criteria: "Read the actual source and require successful explicit parent verification.",
        tasks: [
          { label: "Source boundary", agent: "implementation", task: "WORKFLOW_WORKER_A: read src/example.ts and report its export.", context: "Do not modify files." },
          { label: "Safety boundary", agent: "data", task: "WORKFLOW_WORKER_B: read src/example.ts and report safety evidence.", context: "Do not modify files." },
        ],
      })]);
      if (!has("read_file")) return finish(response, "", [tool("read_file", { path: "README.md" })]);
      if (!has("wait_subagents")) return finish(response, "", [tool("wait_subagents", {})]);
      return finish(response, "WORKFLOW_COORDINATION_FINISHED");
    }
    return finish(response, "WORKFLOW_TURN_FINISHED");
  } catch (cause) {
    serviceErrors.push(cause.stack || String(cause));
    if (!response.headersSent) response.writeHead(500);
    response.end("Local workflow fixture failed.");
  }
});

async function port() {
  const probe = portServer();
  await new Promise((done, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", done); });
  const number = probe.address().port;
  await new Promise((done) => probe.close(done));
  return number;
}

async function connect(number, kind) {
  let target;
  for (let attempt = 0; attempt < 200 && !target; attempt++) {
    try {
      target = (await fetch(`http://127.0.0.1:${number}/json`).then((value) => value.json())).find((item) => item.webSocketDebuggerUrl && (kind !== "renderer" || item.type === "page"));
    } catch {}
    if (!target) await sleep(100);
  }
  assert.ok(target, `Missing ${kind} debugger`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data));
    if (kind === "renderer" && value.method === "Runtime.exceptionThrown") exceptions.push(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text);
    const waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id); clearTimeout(waiter.timer);
    value.error ? waiter.reject(new Error(value.error.message)) : waiter.done(value.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60_000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    evaluate: async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    close: () => { for (const waiter of pending.values()) clearTimeout(waiter.timer); socket.close(); },
  };
}

const api = (name, ...args) => renderer.evaluate(`window.mingshen.${name}(${args.map((value) => JSON.stringify(value)).join(",")})`);
async function until(expression, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await renderer.evaluate(expression)) return; }
    catch (cause) { if (!/context|reload|destroyed|navigat/i.test(String(cause))) throw cause; }
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
  else {
    await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    await renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  }
}
async function capture(name) {
  await sleep(150);
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64")); screenshots.push(path);
}
async function taskDockGeometry() {
  return renderer.evaluate(`(()=>{const panel=document.querySelector(".task-host--docked"),handle=document.querySelector(".panel-resize--bottom"),body=document.querySelector(".app-body");return{viewport:{width:innerWidth,height:innerHeight},height:panel?.getBoundingClientRect().height,aria:handle?.getAttribute("aria-valuenow"),maximum:handle?.getAttribute("aria-valuemax"),override:body?.style.getPropertyValue("--orbit-task-height-override"),taskHeight:body&&getComputedStyle(body).getPropertyValue("--orbit-task-height"),collapsed:body?.dataset.taskCollapsed}})()`);
}
async function expectTaskDock(height) {
  try {
    await until(`(()=>{const p=document.querySelector(".task-host--docked"),h=document.querySelector(".panel-resize--bottom");return Boolean(p&&h&&Math.abs(p.getBoundingClientRect().height-${height})<2&&Number(h.getAttribute("aria-valuenow"))===${height})})()`);
  } catch (cause) {
    throw new Error(`${cause.message}\nTask dock geometry: ${JSON.stringify(await taskDockGeometry())}`);
  }
}
async function waitRun(runId) {
  const deadline = Date.now() + 60_000, approved = new Set();
  while (Date.now() < deadline) {
    for (const request of (await api("getApprovalState")).requests) {
      if (approved.has(request.id)) continue;
      assert.equal(request.sessionId, session.id, "Only the owned parent may request verification approval");
      assert.equal(request.toolName, "run_command");
      assert.match(request.detail, /Write-Output 'WORKFLOW_VERIFIED_[AB]'/);
      const verificationSession = await api("getSession", request.sessionId);
      assert.equal(verificationSession.workspacePath, project);
      assert.equal(verificationSession.executionMode, "host");
      if (request.commandCwd !== undefined) assert.equal(request.commandCwd, project);
      else {
        const parameters = JSON.parse(request.detail);
        assert.match(parameters.command, /^Write-Output 'WORKFLOW_VERIFIED_[AB]'$/);
        assert.deepEqual(Object.keys(parameters).sort(), ["command", "timeout_ms"]);
        assert.equal(parameters.timeout_ms, 120000);
      }
      approved.add(request.id); approvals.push(request);
      await api("decideApproval", { approvalId: request.id, decision: "allow_once" });
    }
    const run = await api("getSessionRunState", session.id);
    if (run && (!runId || run.runId === runId) && run.status !== "running") {
      assert.equal(run.status, "completed", JSON.stringify(run));
      return;
    }
    await sleep(80);
  }
  throw new Error(`Owned workflow run did not settle: ${runId}`);
}
async function send(text, instruction) {
  const accepted = await api("sendChat", { sessionId: session.id, text, ...(instruction ? { temporaryInstruction: instruction } : {}) });
  await waitRun(accepted?.runId);
}
async function saveResult(success, cause) {
  const resultPath = join(evidence, success ? "result.json" : "failure.json");
  await writeFile(resultPath, JSON.stringify({ success, passed, maxConcurrentWorkers, workerIntervals, approvals, requests, exceptions, serviceErrors, screenshots,
    failure: cause ? String(cause.stack || cause) : null,
    boundaries: ["Owned isolated project/profile and synthetic local provider only.", "No paid provider, real credential, user profile, installer, cloud write or repository commit.", "UI screenshots and viewport measurements do not certify the complete Windows DPI/accessibility matrix."],
  }, null, 2));
  return resultPath;
}

try {
  await mkdir(join(project, "src"), { recursive: true });
  await mkdir(evidence, { recursive: true });
  await writeFile(join(project, "README.md"), "# Workflow fixture\nA small isolated project for workbench verification.\n");
  await writeFile(join(project, "src/example.ts"), "export const answer = 41;\n");
  const git = (args) => execFileSync("git", args, { cwd: project, windowsHide: true, stdio: "pipe" });
  git(["init", "-b", "main"]); git(["config", "user.name", "Local Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  git(["add", "."]); git(["commit", "-m", "Fixture baseline"]);
  await writeFile(join(project, "src/example.ts"), "export const answer = 42;\n");
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const mainPort = await port(); let rendererPort = await port();
  while (rendererPort === mainPort) rendererPort = await port();
  const environment = { ...process.env, MSH_EXPERIMENTAL: "1", MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: "1", MSH_NOTIFICATION_FIXTURE: "1" };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(), [`--inspect=${mainPort}`, ".", `--remote-debugging-port=${rendererPort}`], { cwd: resolve("apps/desktop"), env: environment, windowsHide: true, stdio: "ignore" });
  main = await connect(mainPort, "main");
  await main.evaluate('(()=>{const original=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):original(url,options);return true})()');
  renderer = await connect(rendererPort, "renderer"); await renderer.send("Runtime.enable");
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  for (const label of ["同意并继续", "开始使用"]) await until(`(()=>{const el=[...document.querySelectorAll(".policy-dialog button")].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(label)});if(!el)return false;el.click();return true})()`);
  await until('!document.querySelector(".policy-dialog")');
  await renderer.evaluate('(async()=>{for(const s of await window.mingshen.listMcpServers())if(s.enabled)await window.mingshen.setMcpServerEnabled(s.id,false);await window.mingshen.setModelRetrySettings({maxRetries:0});const saver=await window.mingshen.getTokenSaver();await window.mingshen.setTokenSaver({...saver.settings,enabled:false});await window.mingshen.configureCompletionNotifications({nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false});localStorage.setItem("mingshen.theme","day");return true})()');
  provider = await api("createProvider", { name: "Workflow local fixture", protocol: "openai_responses", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, authMode: "bearer", apiKey: "synthetic-workflow-key", keyLabel: "Fixture", neverReveal: true });
  const catalog = await api("createModel", { providerId: provider.id, modelId: "workflow-fixture", displayName: "Workflow fixture", contextWindow: 200_000, maxOutputTokens: 12_000, inputModalities: ["text"], toolCalls: true, parallelToolCalls: true, reasoningLevels: [], anthropicNoneBehavior: "disabled" });
  model = catalog.models.find((item) => item.modelId === "workflow-fixture");
  await api("setProjectTrust", project, true);
  session = await api("createSession", { title: "Workflow tools fixture", workspacePath: project, providerId: provider.id, modelId: model.id, reasoningLevel: null, permissionMode: "full_access", executionMode: "host", agentMode: "code" });
  await renderer.send("Page.reload"); await until('Boolean(document.querySelector(".app-shell"))');
  await until('Boolean(document.querySelector("[data-testid=composer-assist-controls]"))');

  await fill("[data-testid=chat-composer-input]", "  Workflow draft that preserves its material constraints.  ");
  await click("[data-testid=composer-polish-trigger]");
  await until('Boolean(document.querySelector("[data-testid=draft-polish-dialog]"))');
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), "  Workflow draft that preserves its material constraints.  ");
  await click("[data-testid=draft-polish-apply]");
  await until('document.querySelector("[data-testid=chat-composer-input]")?.value.startsWith("Polished workflow draft")');
  assert.equal(requests.filter((item) => item.body.instructions?.includes("draft editor")).length, 1);
  passed.push("Draft refinement uses an empty tool catalog, preserves the source until preview acceptance and applies the confirmed result.");

  holdDraft = true;
  const cancellationDraft = "  Preserve this draft when refinement is cancelled.  ";
  await fill("[data-testid=chat-composer-input]", cancellationDraft);
  const previousPolishes = requests.filter((item) => item.body.instructions?.includes("draft editor")).length;
  await click("[data-testid=composer-polish-trigger]");
  const polishDeadline = Date.now() + 15_000;
  while (requests.filter((item) => item.body.instructions?.includes("draft editor")).length === previousPolishes) {
    assert.ok(Date.now() < polishDeadline, "Cancellable draft request never reached the local provider");
    await sleep(80);
  }
  await click("[data-testid=draft-polish-cancel]");
  await until('!document.querySelector("[data-testid=draft-polish-cancel]")&&!document.querySelector("[data-testid=draft-polish-dialog]")');
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), cancellationDraft);
  holdDraft = false;
  passed.push("Cancelling draft refinement aborts an in-flight request and retains the complete original draft without a late preview.");

  await api("setProjectTone", { sessionId: session.id, preset: "concise" });
  await fill("[data-testid=chat-composer-input]", "");
  await send("WORKFLOW_FIRST_TURN", "WORKFLOW_ONE_TURN_ONLY");
  await send("WORKFLOW_SECOND_TURN");
  const turns = requests.filter((item) => !item.body.instructions?.includes("draft editor") && JSON.stringify(item.body.input).includes("WORKFLOW_FIRST_TURN"));
  assert.ok(turns.some((item) => item.body.instructions?.includes("WORKFLOW_ONE_TURN_ONLY")));
  assert.ok(turns.some((item) => JSON.stringify(item.body.input).includes("WORKFLOW_SECOND_TURN") && !item.body.instructions?.includes("WORKFLOW_ONE_TURN_ONLY")));
  passed.push("Temporary guidance affects one accepted run, project tone remains workspace scoped, and later history does not inherit the temporary system context.");

  const review = await api("getLocalReview", { sessionId: session.id, scope: "git" });
  const changed = review.files.find((item) => item.path.replaceAll("\\", "/") === "src/example.ts");
  assert.ok(changed?.diff?.lines.some((line) => line.type === "added" && line.newLine === 1));
  const comment = { path: changed.path, version: changed.version, side: "new", startLine: 1, endLine: 1, text: "Keep this answer covered by a focused regression check." };
  const formatted = await api("submitLocalReviewComments", { request: { sessionId: session.id, scope: "git" }, comments: [comment] });
  assert.equal(formatted.ok, true); assert.match(formatted.formattedText, /src[\\/]example\.ts/);
  await writeFile(join(project, "src/example.ts"), "export const answer = 43;\n");
  const stale = await api("submitLocalReviewComments", { request: { sessionId: session.id, scope: "git" }, comments: [comment] });
  assert.equal(stale.ok, false); assert.ok(stale.staleFiles.length);
  passed.push("Git review has actual numbered diffs, formats a valid line comment and rejects a comment after the file changes.");

  for (const scope of ["branch", "session", "previous"]) {
    const result = await api("getLocalReview", { sessionId: session.id, scope, ...(scope === "branch" ? { baseRef: "main" } : {}) });
    assert.equal(result.scope, scope);
  }
  passed.push("All four local review scopes respond through the real desktop IPC.");

  await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: "P", code: "KeyP", modifiers: 10, windowsVirtualKeyCode: 80 });
  await renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: "P", code: "KeyP", modifiers: 10, windowsVirtualKeyCode: 80 });
  await until('Boolean(document.querySelector(".command-palette"))');
  await capture("command-palette-day");
  await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until('!document.querySelector(".command-palette")');
  passed.push("Ctrl+Shift+P opens the real unified command palette and Escape dismisses it.");

  const historyBeforePlanning = await api("getSessionMessages", session.id);
  const sourceBeforePlanning = await readFile(join(project, "src/example.ts"), "utf8");
  await fill("[data-testid=chat-composer-input]", "Existing project notes.");
  if (!(await renderer.evaluate('Boolean(document.querySelector("[data-testid=autodrive-suggest]"))')))
    await click(".task-workbench__toggle");
  await click("[data-testid=autodrive-suggest]");
  await until('document.querySelectorAll("[data-autodrive-choice]").length>=3');
  const planningRequest = requests.findLast((item) => JSON.stringify(item.body.input).includes("AUTODRIVE_EVIDENCE_JSON"));
  assert.ok(planningRequest, "Missing actual AutoDrive request");
  assert.equal(planningRequest.body.model, model.modelId);
  assert.ok(JSON.stringify(planningRequest.body.input).includes("src/example.ts"));
  assert.deepEqual(planningRequest.body.tools ?? [], []);
  await capture("autodrive-three-proposals-day");
  await click('[data-autodrive-choice="suggestion-2"]');
  await click("[data-testid=autodrive-apply]");
  await until('!document.querySelector("[data-testid=autodrive-dialog]")&&document.querySelector("[data-testid=chat-composer-input]")?.value.includes("Improve operational documentation")');
  assert.ok((await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]").value')).startsWith("Existing project notes."));
  assert.deepEqual(await api("getSessionMessages", session.id), historyBeforePlanning);
  assert.equal(await readFile(join(project, "src/example.ts"), "utf8"), sourceBeforePlanning);
  passed.push("AutoDrive uses the current model and bounded real source evidence without tools or file/history changes, presents three proposals and appends only the chosen direction to the existing draft.");

  holdPlanning = true;
  const priorPlanningRequests = requests.filter((item) => JSON.stringify(item.body.input).includes("AUTODRIVE_EVIDENCE_JSON")).length;
  const planningDraft = await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]").value');
  await click("[data-testid=autodrive-suggest]");
  const planningDeadline = Date.now() + 15_000;
  while (requests.filter((item) => JSON.stringify(item.body.input).includes("AUTODRIVE_EVIDENCE_JSON")).length === priorPlanningRequests) {
    assert.ok(Date.now() < planningDeadline, "Cancellable AutoDrive request never reached the local provider");
    await sleep(80);
  }
  await click("[data-testid=autodrive-cancel]");
  await until('!document.querySelector("[data-testid=autodrive-cancel]")&&!document.querySelector("[data-testid=autodrive-suggest]").disabled');
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]").value'), planningDraft);
  assert.deepEqual(await api("getSessionMessages", session.id), historyBeforePlanning);
  assert.equal(await readFile(join(project, "src/example.ts"), "utf8"), sourceBeforePlanning);
  holdPlanning = false;
  passed.push("Cancelling an in-flight AutoDrive provider request releases the UI without replacing the draft, history or project source.");

  await send("WORKFLOW_COORDINATION");
  const coordinated = await api("getAgentCoordination", session.id);
  assert.equal(coordinated.phase, "completed", JSON.stringify(coordinated));
  assert.equal(coordinated.qa.status, "passed");
  assert.equal(coordinated.verification.status, "passed");
  assert.ok(coordinated.tasks.every((item) => item.status === "completed"));
  assert.equal(new Set([...coordinated.tasks.map((item) => item.childSessionId), coordinated.qa.childSessionId]).size, 3);
  assert.ok(maxConcurrentWorkers >= 2, "Workers did not actually overlap");
  const independentParents = requests.filter((item) => item.body.input?.some((entry) => entry.type === "function_call" && entry.name === "coordinate_agents") && !JSON.stringify(item.body.input).includes("子任务："));
  const firstWorkerResponse = Math.min(...workerIntervals.map((item) => item.end));
  assert.ok(independentParents.some((parent) => parent.at < firstWorkerResponse && parent.body.input.some((entry) => entry.type === "function_call_output" && String(entry.output).includes("协同任务已安排"))), "The parent did not continue after delegation and before workers produced a response");
  assert.equal(await readFile(join(project, "src/example.ts"), "utf8"), sourceBeforePlanning);
  await until('document.querySelector("[data-testid=agent-coordination]")?.dataset.quality==="passed"');
  await capture("coordination-real-parallel-qa");
  passed.push("Two actual worker sessions overlap while the parent continues, explicit verification commands run with ordinary approval, and a separate QA session produces persisted passed quality and live UI state.");

  const successfulSession = session;
  session = await api("createSession", { title: "Blocked verification fixture", workspacePath: project, providerId: provider.id, modelId: model.id, reasoningLevel: null, permissionMode: "full_access", executionMode: "host", agentMode: "code" });
  await send("WORKFLOW_COORDINATION_BLOCKED");
  const blockedCoordination = await api("getAgentCoordination", session.id);
  assert.equal(blockedCoordination.phase, "failed", JSON.stringify(blockedCoordination));
  assert.equal(blockedCoordination.verification.status, "blocked");
  assert.equal(blockedCoordination.qa.status, "failed");
  await api("removeSession", session.id);
  session = successfulSession;
  passed.push("When workers request no actual verification, verification stays blocked, a model's passed QA statement is downgraded to failed and the coordination is not reported completed.");

  const preferences = await api("getUiPreferences");
  const orbitProjectKey = `@orbit:${project.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase()}`;
  await api("saveUiPreferences", { ...preferences, interfaceStyle: "orbit", projects: { ...preferences.projects, [orbitProjectKey]: {
    mode: "code", sidebarWidth: 228, inspectorWidth: 400, sidebarOpen: true, inspectorOpen: true,
    taskPanelHeight: 600, taskPanelCollapsed: false,
  } } });
  await renderer.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector(".orbit-tool-rail"))');
  await expectTaskDock(600);
  await capture("orbit-task-height-restored");
  await renderer.send("Page.reload");
  await until('Boolean(document.querySelector(".orbit-tool-rail"))');
  await expectTaskDock(600);
  assert.equal((await api("getUiPreferences")).projects[orbitProjectKey]?.taskPanelHeight, 600);
  passed.push("Orbit task dock restores its saved 600px size and matching splitter accessibility value across consecutive reloads.");

  await renderer.evaluate('document.querySelector(".panel-resize--bottom").focus();true');
  await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
  await renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", code: "Home", windowsVirtualKeyCode: 36 });
  await expectTaskDock(160);
  await renderer.evaluate('window.__workflowTerminalOutput={};window.__workflowTerminalUnsubscribe=window.mingshen.onTerminalEvent(e=>{if(e.type==="output")window.__workflowTerminalOutput[e.terminalId]=(window.__workflowTerminalOutput[e.terminalId]||"")+e.data});true');
  await click('[data-orbit-action="terminal"]');
  await until('document.querySelectorAll(".interactive-terminal__tab").length===1&&Boolean(document.querySelector(".xterm-helper-textarea"))');
  const firstTerminal = (await api("listTerminals", session.id))[0];
  assert.ok(firstTerminal.pid > 0); assert.equal(firstTerminal.cwd, project);
  await renderer.evaluate('document.querySelector(".interactive-terminal__pane[data-active=true] .xterm-helper-textarea").focus();true');
  await renderer.send("Input.insertText", { text: "Write-Output ('WORKFLOW_TERMINAL_'+'A')" });
  await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(`window.__workflowTerminalOutput[${JSON.stringify(firstTerminal.id)}]?.includes("WORKFLOW_TERMINAL_A")`);
  await click(".interactive-terminal__new");
  await until('document.querySelectorAll(".interactive-terminal__tab").length===2');
  const twoTerminals = await api("listTerminals", session.id);
  assert.equal(twoTerminals.length, 2); assert.equal(new Set(twoTerminals.map((item) => item.pid)).size, 2);
  assert.equal(await renderer.evaluate('(()=>{const s=document.querySelector(".interactive-terminal__status-label");return Boolean(s&&getComputedStyle(s).whiteSpace==="nowrap"&&s.getBoundingClientRect().height<20)})()'), true, "Narrow terminal status should stay on one line");
  await capture("orbit-real-shell-tabs");
  await click(".interactive-terminal__tab:first-child .interactive-terminal__tab-main");
  assert.equal(await renderer.evaluate(`document.querySelector('.interactive-terminal__pane[data-active=true]')?.dataset.terminalId===${JSON.stringify(firstTerminal.id)}`), true);
  await click(".interactive-terminal__tab:first-child .interactive-terminal__tab-close");
  await until('document.querySelectorAll(".interactive-terminal__tab").length===1');
  await click(".interactive-terminal__tab-close");
  await until(`window.mingshen.listTerminals(${JSON.stringify(session.id)}).then(items=>items.length===0)`);
  for (const terminal of twoTerminals) {
    await until(`window.mingshen.listTerminals(${JSON.stringify(session.id)}).then(items=>!items.some(item=>item.id===${JSON.stringify(terminal.id)}))`);
    assert.equal(await main.evaluate(`(()=>{try{process.kill(${terminal.pid},0);return true}catch{return false}})()`), false, "Closed owned shell must actually exit");
  }
  await renderer.evaluate('window.__workflowTerminalUnsubscribe();true');
  passed.push("The real xterm surface accepts keyboard input, two independent PowerShell tabs run in the project, tab switching works and closing each tab confirms process exit.");

  assert.deepEqual(exceptions, []); assert.deepEqual(serviceErrors, []);
  console.log(JSON.stringify({ passed, screenshots, resultPath: await saveResult(true) }, null, 2));
} catch (cause) {
  await capture("failure").catch(() => undefined);
  console.error(JSON.stringify({ passed, resultPath: await saveResult(false, cause), body: await renderer?.evaluate("document.body.innerText").catch(() => null) }, null, 2));
  throw cause;
} finally {
  if (child) {
    const owned = child;
    const ended = owned.exitCode !== null ? Promise.resolve() : new Promise((done) => owned.once("exit", done));
    await renderer?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),50);true').catch(() => {});
    await Promise.race([ended, sleep(8000)]);
    renderer?.close(); main?.close();
    if (owned.exitCode === null && owned.signalCode === null) { owned.kill(); await Promise.race([ended, sleep(5000)]); }
    assert.ok(owned.exitCode !== null || owned.signalCode !== null, "Owned Electron did not exit");
  }
  server.closeAllConnections(); if (server.listening) await new Promise((done) => server.close(done));
  const local = relative(resolve(tmpdir()), temporary);
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local), "Unsafe cleanup path");
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
