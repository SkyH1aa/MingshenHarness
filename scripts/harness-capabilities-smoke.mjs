import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "mingshen-capabilities-"));
const workspace = join(temporary, "workspace");
const evidence = resolve(".impeccable/review/v130-harness-capabilities");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const requests = [], failures = [], passed = [], counts = new Map();
const native = [
  { id: "reason-fixture", type: "reasoning", encrypted_content: "opaque-local-fixture", summary: [] },
  { id: "progress-fixture", type: "message", role: "assistant", phase: "commentary",
    content: [{ type: "output_text", text: "Inspecting the requested lines.", annotations: [] }] },
];
let app, main, renderer, browserPixels;
const server = createServer(async (request, response) => {
  if (request.url === "/page") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end('<!doctype html><html><head><title>Pixel verification</title></head><body style="margin:0;background:#fff;font:28px Arial"><div style="background:#c32338;color:white;padding:40px">VISIBLE PIXEL EVIDENCE</div><div style="height:240px;background:#39a875"></div><p>Local browser fixture</p></body></html>');
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    const history = body.input ?? [];
    const scenario = JSON.stringify(history).match(/CASE:([a-z]+)/)?.[1];
    assert.ok(scenario, "Every local model request identifies its fixture task.");
    const round = (counts.get(scenario) ?? 0) + 1;
    counts.set(scenario, round);
    const results = history.filter((item) => item.type === "function_call_output");
    const last = results.at(-1);
    const call = (name, args, suffix = name) => ({
      type: "function_call", call_id: `${scenario}-${round}-${suffix}`, name, arguments: JSON.stringify(args),
    });
    let output = [], text = "Completed with checked evidence.";
    if (scenario === "native") {
      if (round === 1) output = [...native,
        call("read_file", { path: "long.txt", start_line: 3000, limit: 2 }, "a"),
        call("read_file", { path: "long.txt", start_line: 4000, limit: 2 }, "b")];
      else if (round === 2) {
        assert.deepEqual(history.filter((item) => native.some((original) => original.id === item.id)), native);
        assert.ok(results.some((item) => String(item.output).includes("LINE-3000")));
        assert.ok(results.some((item) => String(item.output).includes("LINE-4000")));
        output = [{ type: "message", id: "progress-only", role: "assistant", phase: "commentary",
          content: [{ type: "output_text", text: "The investigation is complete; preparing the result.", annotations: [] }] }];
      } else {
        assert.ok(history.some((item) => item.id === "progress-only" && item.phase === "commentary"));
        assert.match(JSON.stringify(history), /MODEL_CONTINUATION_REQUIRED/);
      }
    } else if (scenario === "terminal") {
      if (round === 1) output = [call("exec_command", {
        command: "node interactive.cjs", yield_time_ms: 300, timeout_ms: 20000,
      })];
      else {
        const id = String(last?.output).match(/command_session: ([a-f0-9-]+)/)?.[1];
        assert.ok(id, "A real process returned its owned command handle.");
        const wire = JSON.stringify(results);
        const sent = history.some((item) => item.type === "function_call" && item.name === "write_stdin" &&
          JSON.parse(item.arguments).chars === "HELLO\n");
        if (!wire.includes("INPUT:HELLO")) {
          assert.ok(round <= 20, "The process must produce its expected output within bounded polling.");
          output = [call("write_stdin", {
            session_id: id, yield_time_ms: 1000,
            ...(!sent && wire.includes("READY") ? { chars: "HELLO\n" } : {}),
          })];
        }
      }
    } else if (scenario === "vision") {
      if (round === 1) output = [call("browser_open", { url: `http://127.0.0.1:${server.address().port}/page` })];
      else if (round === 2) output = [call("browser_snapshot", {})];
      else if (round === 3) {
        assert.match(String(last?.output), /Pixel verification/);
        output = [call("browser_screenshot", {})];
      } else {
        const image = results.flatMap((item) => Array.isArray(item.output) ? item.output : [])
          .find((item) => item.type === "input_image");
        assert.ok(image, "Browser pixels enter the following real Responses request.");
        browserPixels = Buffer.from(image.image_url.split(",")[1], "base64");
        assert.equal(browserPixels.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.ok(browserPixels.length > 2000, "The screenshot includes rendered content.");
        await writeFile(join(evidence, "browser-model-input.png"), browserPixels);
      }
    } else if (scenario === "relay") {
      if (round === 1) output = [call("spawn_subagent", {
        agent: "general", task: "CASE:relaychild Queue the project check and report it as pending.", label: "Verification fixture",
      })];
      else if (round === 2) output = [call("wait_subagents", {})];
      else assert.match(JSON.stringify(results), /RELAY_VERIFIED/);
    } else if (scenario === "relaychild") {
      assert.ok(body.tools.some((tool) => tool.name === "request_verification"));
      if (round === 1) output = [call("request_verification", { commands: ["node -e \"console.log('RELAY_VERIFIED')\""] })];
      else {
        assert.match(String(last?.output), /NOT executed/);
        text = "The check is queued for the parent; no verification result claimed.";
      }
    } else throw new Error(`Unknown case ${scenario}`);
    if (!output.length) output = [{
      type: "message", id: `${scenario}-final`, role: "assistant", phase: "final_answer",
      content: [{ type: "output_text", text, annotations: [] }],
    }];
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ type: "response.completed", response: {
      status: "completed", output, usage: { input_tokens: 5000, output_tokens: 100, total_tokens: 5100 },
    } })}\n\n`);
  } catch (error) {
    failures.push(error.stack ?? String(error));
    response.writeHead(500);
    response.end("Local fixture assertion failed.");
  }
});

async function connect(port, type) {
  let target;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((value) => value.json());
      target = targets.find((item) => item.webSocketDebuggerUrl && (!type || item.type === type));
      if (target) break;
    } catch {}
    await sleep(80);
  }
  assert.ok(target, `No debugger on ${port}.`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let next = 0;
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)), waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timer);
    message.error ? waiting.reject(new Error(message.error.message)) : waiting.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)); }, 60000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send, close: () => socket.close(),
    evaluate: async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
  };
}
async function until(expression) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await renderer.evaluate(expression)) return;
    await sleep(80);
  }
  throw new Error(`Timed out: ${expression}`);
}

try {
  await mkdir(workspace, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await writeFile(join(workspace, "long.txt"), Array.from({ length: 4500 }, (_, index) => `LINE-${index + 1}`).join("\n"));
  await writeFile(join(workspace, "interactive.cjs"), "process.stdout.write('READY\\n');process.stdin.setEncoding('utf8');process.stdin.once('data',text=>{process.stdout.write('INPUT:'+text.trim()+'\\n');process.exit(0)});");
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], { windowsHide: true, stdio: "pipe" });
  const env = { ...process.env, MSH_EXPERIMENTAL: "1", MSH_USER_DATA_DIR: join(temporary, "profile"), MSH_DISABLE_AUTO_DEPENDENCIES: "1", MSH_NOTIFICATION_FIXTURE: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  app = spawn(resolve("apps/desktop/node_modules/electron/dist/MingshenHarnessExperimental.exe"),
    ["--inspect=9468", ".", "--remote-debugging-port=9467"],
    { cwd: resolve("apps/desktop"), env, windowsHide: true, stdio: "ignore" });
  main = await connect(9468);
  await main.evaluate("globalThis.__capabilityFetch=fetch;globalThis.fetch=(url,options)=>String(url).includes('/rest/v1/rpc/')?Promise.resolve(Response.json([])):globalThis.__capabilityFetch(url,options);true");
  renderer = await connect(9467, "page");
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  for (const text of ["同意并继续", "开始使用"]) {
    const button = `[...document.querySelectorAll(".policy-dialog button")].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(text)})`;
    await until(`Boolean(${button})`);
    await renderer.evaluate(`${button}.click();true`);
  }
  await until('!document.querySelector(".policy-dialog") && Boolean(window.mingshen?.createProvider)');
  const configuration = await renderer.evaluate(`(async()=>{
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const p=await window.mingshen.createProvider({name:'Local capability fixture',baseUrl:'http://127.0.0.1:${server.address().port}/v1',protocol:'openai_responses',authMode:'bearer',apiKey:'local-capability-fixture',keyLabel:'Fixture',neverReveal:true});
    const result=await window.mingshen.createModel({providerId:p.id,modelId:'capability-fixture',contextWindow:200000,maxOutputTokens:4096,inputModalities:['text','image'],toolCalls:true,parallelToolCalls:true,reasoningLevels:[],anthropicNoneBehavior:'disabled'});
    return {providerId:p.id,modelId:result.models[0].id};
  })()`);
  for (const scenario of ["native", "terminal", "vision", "relay"]) {
    const session = await renderer.evaluate(`window.mingshen.createSession(${JSON.stringify({
      ...configuration, title: `Capability ${scenario}`, workspacePath: workspace,
      reasoningLevel: null, permissionMode: "full_access", executionMode: "host", agentProfileId: "primary",
    })})`);
    await renderer.evaluate(`window.mingshen.setProjectMemoryEnabled(${JSON.stringify(session.id)},false)`);
    await renderer.send("Page.reload");
    await until(`[...document.querySelectorAll(".session-row__title")].some(el=>el.textContent===${JSON.stringify(session.title)})`);
    await renderer.evaluate(`[...document.querySelectorAll(".session-row__title")].find(el=>el.textContent===${JSON.stringify(session.title)}).click();true`);
    await renderer.evaluate(`window.mingshen.sendChat({sessionId:${JSON.stringify(session.id)},text:'CASE:${scenario} Complete this controlled local capability check.'})`);
    await until(`window.mingshen.getSession(${JSON.stringify(session.id)}).then(s=>s.status==='idle'||s.status==='error')`);
    const status = await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(session.id)})`);
    const messages = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(session.id)})`);
    assert.deepEqual(failures, []);
    assert.equal(status.status, "idle", JSON.stringify(messages.flatMap((message) => message.parts).filter((part) => part.type === "error")));
    assert.ok(!messages.flatMap((message) => message.parts).some((part) => part.type === "tool_result" && part.isError));
    if (scenario === "native") assert.ok(messages.flatMap((message) => message.parts).some((part) => part.type === "responses_state" && part.endpointKey));
    if (scenario === "vision") {
      assert.ok(messages.flatMap((message) => message.parts).some((part) => part.type === "tool_result" && part.images?.length));
      const screenshot = await renderer.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(evidence, "desktop-browser.png"), Buffer.from(screenshot.data, "base64"));
    }
    passed.push(scenario);
  }
  assert.ok(browserPixels);
  assert.equal((await readFile(join(evidence, "browser-model-input.png"))).compare(browserPixels), 0);
  const report = { version, passed, requests: requests.length, rounds: Object.fromEntries(counts), failures };
  await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "wire-fixture.json"), JSON.stringify({
    rounds: Object.fromEntries(counts), failures, requests,
  }, null, 2));
  if (app) {
    const closed = app.exitCode !== null || app.signalCode !== null ? Promise.resolve() : new Promise((done) => app.once("exit", done));
    await renderer?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true').catch(() => {});
    renderer?.close();
    main?.close();
    await Promise.race([closed, sleep(8000)]);
    if (app.exitCode === null && app.signalCode === null) { app.kill(); await closed; }
  }
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  assert.ok(temporary.startsWith(resolve(tmpdir()) + sep));
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
