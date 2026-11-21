import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const desktop = resolve("apps/desktop");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-agent-modes-"));
const project = join(temporary, "project"), profile = join(temporary, "profile");
const evidence = resolve(".impeccable/review", `v133-agent-modes-${Date.now()}`);
const passed = [], errors = [], requests = [], screenshots = [];
let officeEvidence = [];
const requireApp = createRequire(join(desktop, "package.json"));
const { zipSync, strToU8 } = requireApp("fflate");
const sleep = ms => new Promise(done => setTimeout(done, ms));
let child, renderer, main, scenario, held;
const finish = (response, text, output) => {
  if (response.destroyed) return;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  if (text) response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`);
  response.end(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", ...(output ? { output } : {}), usage: { input_tokens: 2000, output_tokens: 200, total_tokens: 2200 } } })}\n\n`);
};
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (/会话标题生成|conversation title/i.test(body.instructions ?? "")) { finish(response, "Local mode verification"); return; }
    requests.push(body);
    if (scenario?.hold) { held = response; return; }
    const step = scenario?.steps[scenario.next++];
    if (step) finish(response, "", [{ type: "function_call", name: step.name, arguments: JSON.stringify(step.args), call_id: `mode-${requests.length}-${step.name}` }]);
    else finish(response, "MODE_FIXTURE_COMPLETE");
  } catch (error) { errors.push(String(error)); response.destroy(); }
});

async function connect(port, type) {
  let target;
  for (let i = 0; i < 200; i++) {
    try { target = (await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json())).find(item => item.webSocketDebuggerUrl && (!type || item.type === type)); } catch {}
    if (target) break;
    await sleep(80);
  }
  assert.ok(target, `Missing debugger ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl), pending = new Map();
  let sequence = 0;
  await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 60000);
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}
async function until(expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await renderer.evaluate(expression)) return; await sleep(80); }
  throw new Error(`Timed out: ${expression}`);
}
const api = (name, ...args) => renderer.evaluate(`window.mingshen.${name}(${args.map(value => JSON.stringify(value)).join(",")})`);
async function click(selector) { await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`); await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)}).click();true`); }
async function fill(selector, value) {
  await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  await renderer.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event("input",{bubbles:true}));return true})()`);
}
async function capture(name, width = 1440, height = 960) {
  await renderer.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await until('Boolean(document.querySelector(".app-shell .composer"))');
  await sleep(250);
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`); await writeFile(path, Buffer.from(image.data, "base64")); screenshots.push(path);
  const overflow = await renderer.evaluate("document.documentElement.scrollWidth>innerWidth+2");
  assert.equal(overflow, false, `Horizontal overflow: ${name}`);
  if (await renderer.evaluate('document.querySelector(".app-shell")?.dataset.agentMode==="chat"')) {
    const bounds = await renderer.evaluate('(()=>{const rect=document.querySelector(".composer").getBoundingClientRect();return {width:rect.width,left:rect.left,right:rect.right,viewport:innerWidth}})()');
    assert.ok(bounds.width >= Math.min(500, width - 80) && bounds.left >= 0 && bounds.right <= bounds.viewport + 2, `Unusable Chat composer: ${name} ${JSON.stringify(bounds)}`);
  }
}
async function launch() {
  const environment = { ...process.env, MSH_EXPERIMENTAL: "1", MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: "1", MSH_NOTIFICATION_FIXTURE: "1" };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(), ["--inspect=9462", ".", "--remote-debugging-port=9461"], { cwd: desktop, env: environment, windowsHide: true, stdio: "ignore" });
  main = await connect(9462);
  await main.evaluate('globalThis.__modeFetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__modeFetch(url,options);true');
  renderer = await connect(9461, "page"); await renderer.send("Runtime.enable");
}
async function close() {
  if (!child) return;
  const current = child;
  const ended = current.exitCode !== null ? Promise.resolve() : new Promise(done => current.once("exit", done));
  await renderer?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),100);true').catch(() => {});
  renderer?.close(); main?.close(); await Promise.race([ended, sleep(7000)]);
  if (current.exitCode === null && current.signalCode === null) { current.kill(); await Promise.race([ended, sleep(5000)]); }
  assert.ok(current.exitCode !== null || current.signalCode !== null, "Electron fixture did not exit");
  child = renderer = main = undefined;
}
async function installEventListener() {
  await renderer.evaluate('globalThis.__modeEvents=[];window.mingshen.onRuntimeEvent(event=>globalThis.__modeEvents.push(event));true');
}
async function run(session, steps, attachments = []) {
  scenario = { steps, next: 0 };
  const previous = await api("getSessionMessages", session.id);
  const start = requests.length;
  const { runId } = await api("sendChat", { sessionId: session.id, text: "MODE_FIXTURE: /do-not-execute @unknown. Answer using only permitted content.", attachments });
  await until(`globalThis.__modeEvents.some(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`, 240000);
  const ending = await renderer.evaluate(`globalThis.__modeEvents.find(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`);
  assert.equal(ending.type, "run_completed", JSON.stringify(ending));
  const parts = (await api("getSessionMessages", session.id)).slice(previous.length).flatMap(message => message.parts);
  return { parts, results: parts.filter(part => part.type === "tool_result"), requests: requests.slice(start) };
}

try {
  await mkdir(project, { recursive: true }); await mkdir(evidence, { recursive: true });
  await writeFile(join(project, "source.txt"), "ORIGINAL_SOURCE");
  execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], { windowsHide: true, stdio: "pipe" });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  await launch();
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true');
  for (const text of ["同意并继续", "开始使用"]) {
    const button = `[...document.querySelectorAll(".policy-dialog button")].find(button=>!button.disabled&&button.textContent.trim()===${JSON.stringify(text)})`;
    await until(`Boolean(${button})`); await renderer.evaluate(`${button}.click();true`);
  }
  await until('!document.querySelector(".policy-dialog")'); await installEventListener();
  await renderer.evaluate('localStorage.setItem("mingshen.theme","day");true');
  await renderer.evaluate('(async()=>{for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);await window.mingshen.setModelRetrySettings({maxRetries:0});const saver=await window.mingshen.getTokenSaver();await window.mingshen.setTokenSaver({...saver.settings,enabled:false});await window.mingshen.configureCompletionNotifications({nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false});return true})()');
  const provider = await api("createProvider", { name: "Local modes fixture", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: "openai_responses", authMode: "bearer", apiKey: "local-modes-fixture", keyLabel: "Fixture", neverReveal: true });
  const configured = await api("createModel", { providerId: provider.id, modelId: "modes-fixture", contextWindow: 200000, maxOutputTokens: 8192, inputModalities: ["text", "image"], toolCalls: true, parallelToolCalls: false, reasoningLevels: [], anthropicNoneBehavior: "disabled" });
  const input = { providerId: provider.id, modelId: configured.models[0].id, workspacePath: project, permissionMode: "full_access", executionMode: "host", agentProfileId: "primary", reasoningLevel: null };
  const workspace = await api("createSession", { ...input, title: "Shared workspace", agentMode: "code" });
  await api("setProjectMemoryEnabled", workspace.id, false);
  await renderer.send("Page.reload"); await until('Boolean(document.querySelector("[data-testid=agent-mode-code]"))'); await installEventListener();
  await click('[data-testid="agent-mode-work"]');
  await until(`document.querySelector('.app-shell').dataset.agentMode==="work"`);
  assert.equal((await api("getSession", workspace.id)).agentMode, "work");
  assert.equal((await api("getSession", workspace.id)).workspacePath, project);
  passed.push("Main Code/Work switch preserves the same session and directory");
  await capture("work-day");

  const work = await api("getSession", workspace.id);
  const workbook = await run(work, [
    { name: "use_skill", args: { name: "builtin:work-spreadsheets" } },
    { name: "office_document", args: { operation: "create_spreadsheet", path: "budget.xlsx", workbook: { sheets: [{ name: "Budget", cells: [{ row: 1, column: 1, value: "Input" }, { row: 1, column: 2, value: "Total" }, { row: 2, column: 1, value: 42 }, { row: 2, column: 2, value: { formula: "A2*2" } }], columns: [{ index: 1, width: 20 }, { index: 2, width: 20 }], freeze: { row: 1 }, filter: "A1:B2" }] } } },
    { name: "office_document", args: { operation: "inspect", path: "budget.xlsx" } },
  ]);
  assert.ok(workbook.results.every(result => !result.isError), JSON.stringify(workbook.results));
  assert.ok(workbook.results.some(result => result.output.includes("A2*2")));
  assert.ok(workbook.results.some(result => /Microsoft Office|结构检查/.test(result.output)));
  assert.ok(workbook.requests[0].instructions.includes("WorkAgent"));
  officeEvidence = workbook.results.map(result => ({ callId: result.callId, isError: result.isError, output: result.output, imageCount: result.images?.length ?? 0 }));
  const verification = workbook.results.find(result => result.output.includes("Microsoft Office 验证：verified") && result.output.includes("已导出 PDF"));
  if (verification) {
    assert.ok(workbook.results.some(result => result.images?.length), "Rendered page images must reach model history");
    assert.ok(workbook.requests.some(request => JSON.stringify(request.input).includes("input_image")), "Rendered page images must reach an image-capable provider");
    for (const [index, image] of workbook.results.flatMap(result => result.images ?? []).entries()) {
      await writeFile(join(evidence, `office-page-${index + 1}.png`), Buffer.from(image.dataUrl.split(",")[1], "base64"));
    }
  }
  passed.push("Real Work run loads a Skill on demand, writes XLSX, inspects formulas and runs final Office verification");

  scenario = { hold: true }; held = undefined;
  const running = await api("sendChat", { sessionId: work.id, text: "MODE_HOLD" });
  for (let i = 0; i < 200 && !held; i++) await sleep(50);
  assert.ok(held);
  await until('document.querySelector("[data-testid=agent-mode-code]").disabled');
  const rejected = await renderer.evaluate(`window.mingshen.updateSession({sessionId:${JSON.stringify(work.id)},agentMode:"code"}).then(()=>false,()=>true)`);
  assert.equal(rejected, true);
  await api("stopChat", work.id); held.destroy();
  await until(`globalThis.__modeEvents.some(event=>event.runId===${JSON.stringify(running.runId)}&&event.type==="run_interrupted")`);
  passed.push("Running task locks mode buttons and backend mode updates; manual stop unlocks them");
  await click('[data-testid="agent-mode-code"]');
  await until(`document.querySelector('.app-shell').dataset.agentMode==="code"`);
  const code = await api("getSession", work.id);
  const engineering = await run(code, [
    { name: "use_skill", args: { name: "builtin:code-debugging" } },
    { name: "read_file", args: { path: "source.txt" } },
    { name: "replace_in_file", args: { path: "source.txt", old_text: "ORIGINAL_SOURCE", new_text: "UPDATED_SOURCE" } },
    { name: "run_command", args: { command: "[Console]::Write(('x' * 90000) + 'RECOVERABLE_TAIL')" } },
  ]);
  assert.ok(engineering.results.every(result => !result.isError), JSON.stringify(engineering.results));
  assert.equal(await readFile(join(project, "source.txt"), "utf8"), "UPDATED_SOURCE");
  const large = engineering.results.find(result => result.output.includes("LARGE_OUTPUT_RETAINED"));
  assert.ok(large);
  const recovered = await run(code, [{ name: "read_tool_output", args: { call_id: large.callId, char_offset: 89_000 } }]);
  assert.ok(recovered.results[0].output.includes("RECOVERABLE_TAIL"));
  const snapshots = await api("listSnapshots", code.id);
  assert.ok(snapshots.length >= 3);
  passed.push("Real Code run edits with a finer checkpoint and recovers a large command output by call ID");

  scenario = { hold: true }; held = undefined;
  await renderer.evaluate(`(()=>{
    globalThis.__modeNativeRead=FileReader.prototype.readAsDataURL;
    globalThis.__modeReadQueue=[];
    FileReader.prototype.readAsDataURL=function(file){globalThis.__modeReadQueue.push(()=>globalThis.__modeNativeRead.call(this,file));};
    const transfer=new DataTransfer();transfer.items.add(new File(["PREPARATION_ATTACHMENT"],"preparation.txt",{type:"text/plain"}));
    window.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:transfer}));
    const input=document.querySelector(".composer textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"MODE_PREPARATION_HOLD");
    input.dispatchEvent(new Event("input",{bubbles:true}));return true;
  })()`);
  await until('document.querySelector(".composer").textContent.includes("preparation.txt")');
  await click(".composer .send-button");
  await until('globalThis.__modeReadQueue.length>0');
  await until('document.querySelector("[data-testid=agent-mode-chat]").disabled');
  await click('[data-testid="agent-mode-chat"]');
  assert.equal(await renderer.evaluate('document.querySelector(".app-shell").dataset.agentMode'), "code");
  assert.equal(held, undefined, "Attachment preparation must precede the model request");
  await renderer.evaluate('FileReader.prototype.readAsDataURL=globalThis.__modeNativeRead;globalThis.__modeReadQueue.splice(0).forEach(read=>read());true');
  for (let i = 0; i < 200 && !held; i++) await sleep(50);
  assert.ok(held);
  await until('document.querySelector("[data-testid=agent-mode-chat]").disabled');
  await api("stopChat", code.id); held.destroy();
  await until('!document.querySelector("[data-testid=agent-mode-chat]").disabled');
  passed.push("Attachment preparation locks mode switching before FileReader completes and stays locked until the run stops");

  await main.evaluate(`(()=>{
    const ipcMain=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").ipcMain;
    const handlers=ipcMain._invokeHandlers,original=handlers.get("chat:rewrite");
    if(typeof original!=="function")throw new Error("Missing fixture rewrite handler");
    globalThis.__modeRewriteRelease=undefined;
    handlers.set("chat:rewrite",async(...args)=>{
      const reject=await new Promise(resolve=>{globalThis.__modeRewriteRelease=resolve;});
      globalThis.__modeRewriteRelease=undefined;
      if(reject)throw new Error("MODE_REWRITE_FIXTURE_REJECTED");
      return original(...args);
    });
    globalThis.__modeRestoreRewrite=()=>handlers.set("chat:rewrite",original);return true;
  })()`);
  const preparedMessage = (await api("getSessionMessages", code.id)).find(message => message.role === "user" && message.parts.some(part => part.type === "text" && part.text === "MODE_PREPARATION_HOLD"));
  assert.ok(preparedMessage);
  await click(`[data-message-id="${preparedMessage.id}"] .message-action[aria-label="修改消息"]`);
  await click(".user-message-editor .btn--primary");
  assert.equal(await main.evaluate('typeof globalThis.__modeRewriteRelease==="function"'), true);
  await until('document.querySelector("[data-testid=agent-mode-chat]").disabled');
  await click('[data-testid="agent-mode-chat"]');
  assert.equal(await renderer.evaluate('document.querySelector(".app-shell").dataset.agentMode'), "code");
  await main.evaluate('globalThis.__modeRewriteRelease(true);true');
  await until('document.querySelector(".message--user")?.parentElement.textContent.includes("MODE_REWRITE_FIXTURE_REJECTED")');
  await until('!document.querySelector("[data-testid=agent-mode-chat]").disabled');
  scenario = { hold: true }; held = undefined;
  await click(".user-message-editor .btn--primary");
  assert.equal(await main.evaluate('typeof globalThis.__modeRewriteRelease==="function"'), true);
  await until('document.querySelector("[data-testid=agent-mode-chat]").disabled');
  await main.evaluate('globalThis.__modeRewriteRelease(false);true');
  for (let i = 0; i < 200 && !held; i++) await sleep(50);
  assert.ok(held);
  await api("stopChat", code.id); held.destroy();
  await until('!document.querySelector("[data-testid=agent-mode-chat]").disabled');
  await main.evaluate('globalThis.__modeRestoreRewrite();true');
  passed.push("Editing and resending locks switching before IPC returns, unlocks on failure and stays locked through a successful run");

  await click('[data-testid="agent-mode-chat"]');
  await until('Boolean(document.querySelector("[data-testid=chat-sidebar]"))');
  await click('[data-testid="new-chat"]');
  await until('Boolean(document.querySelector(".chat-session-row--selected"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector("input[name=workspacePath]"))'), false);
  assert.equal(await renderer.evaluate('Boolean(document.querySelector("[data-testid=new-chat-dialog]"))'), false);
  const chats = await api("listSessionPage", { agentMode: "chat", limit: 100 });
  assert.equal(chats.sessions.length, 1);
  const chat = chats.sessions[0];
  assert.equal(chat.workspacePath, null);
  assert.equal((await api("listSessionPage", { agentMode: "workspace", limit: 100 })).sessions.some(item => item.id === chat.id), false);
  const activeLocalPanels = await renderer.evaluate('[...document.querySelectorAll(".inspector-host,.task-host,.workspace-resize")].filter(node=>node.getBoundingClientRect().width>0&&!node.closest("[hidden]")).length');
  assert.equal(activeLocalPanels, 0);
  await capture("chat-day"); await capture("chat-compact", 800, 900);
  passed.push("Chat uses a separate first screen and catalog, with no workspace dialog or visible file/task panels");

  const wordBytes = Buffer.from(zipSync({ "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'), "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>UPLOADED_WORD_ONLY</w:t></w:r></w:p></w:body></w:document>') }));
  const pptBytes = Buffer.from(zipSync({ "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>'), "ppt/slides/slide1.xml": strToU8('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>UPLOADED_PRESENTATION_ONLY</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>') }));
  const pdfObjects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pdfStream = 'BT /F1 12 Tf 20 100 Td (UPLOADED_PDF_ONLY) Tj ET';
  pdfObjects.push(`<< /Length ${Buffer.byteLength(pdfStream)} >>\nstream\n${pdfStream}\nendstream`);
  let pdfText = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of pdfObjects.entries()) { offsets.push(Buffer.byteLength(pdfText)); pdfText += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdfText);
  pdfText += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const attachment = (name, mimeType, bytes, kind = "file") => ({ kind, name, mimeType, size: bytes.length, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` });
  const uploaded = [{ ...attachment("uploaded.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", wordBytes), path: join(project, "source.txt") }, attachment("uploaded.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await readFile(join(project, "budget.xlsx"))), attachment("uploaded.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", pptBytes), attachment("uploaded.pdf", "application/pdf", Buffer.from(pdfText)), attachment("uploaded.png", "image/png", await readFile(join(desktop, "build/icon.png")), "image")];
  const conversation = await run(chat, [
    { name: "read_file", args: { path: join(project, "source.txt") } },
    { name: "run_command", args: { command: "Write-Output SHOULD_NOT_RUN" } },
    { name: "use_skill", args: { name: "builtin:work-word" } },
    { name: "mcp__fixture", args: {} },
    { name: "spawn_subagent", args: { task: "SHOULD_NOT_RUN" } },
  ], uploaded);
  assert.ok(conversation.results.every(result => result.isError && result.output.includes("CHAT_TOOL_DENIED")));
  assert.deepEqual(conversation.requests[0].tools.map(tool => tool.name).sort(), ["web_fetch", "web_search"]);
  const uploads = conversation.parts.filter(part => part.type === "attachment").map(part => part.attachment);
  assert.equal(uploads.length, 5); assert.ok(uploads.every(attachment => !attachment.path));
  assert.ok(uploads[0].extractedContent.text.includes("UPLOADED_WORD_ONLY"));
  assert.ok(uploads[2].extractedContent.text.includes("UPLOADED_PRESENTATION_ONLY"));
  assert.ok(uploads[3].extractedContent.text.includes("UPLOADED_PDF_ONLY"));
  assert.ok(JSON.stringify(conversation.requests[0].input).includes("input_image"));
  assert.equal(await readFile(join(project, "source.txt"), "utf8"), "UPDATED_SOURCE");
  passed.push("Chat reads uploaded DOCX/XLSX/PPTX/PDF/image bytes and rejects malicious local/Skill/MCP/subagent calls in a real model round trip");

  await renderer.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  if (await renderer.evaluate('document.querySelector(".app-body").dataset.chatSidebarOpen!=="true"')) await click('.app-topbar .sidebar-toggle');
  await click('[data-testid="chat-group-create"]');
  await fill('.chat-sidebar__name-editor input', "UI research");
  await renderer.evaluate('document.querySelector(".chat-sidebar__name-editor form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));true');
  await until('Boolean([...document.querySelectorAll("[data-chat-group-id]")].find(group=>group.textContent.includes("UI research")))');
  const uiGroup = (await api("listChatGroups")).find(group => group.name === "UI research");
  assert.ok(uiGroup);
  await click(`[data-chat-group-id="${uiGroup.id}"] [data-testid="chat-group-rename"]`);
  await fill('.chat-sidebar__name-editor input', "UI research revised");
  await renderer.evaluate('document.querySelector(".chat-sidebar__name-editor form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));true');
  await until('Boolean([...document.querySelectorAll("[data-chat-group-id]")].find(group=>group.textContent.includes("UI research revised")))');
  await capture("chat-group-ui");
  await api("removeChatGroup", uiGroup.id);
  passed.push("Chat sidebar creates and renames a group through the actual renderer form");

  const group = await api("createChatGroup", "Research");
  await api("renameChatGroup", group.id, "Research revised");
  await api("updateSession", { sessionId: chat.id, title: "Pinned research", pinned: true, chatGroupId: group.id });
  assert.equal((await api("listSessionPage", { agentMode: "chat", chatGroupId: group.id, query: "Pinned", limit: 100 })).sessions.length, 1);
  await api("updateSession", { sessionId: chat.id, archived: true });
  assert.equal((await api("listSessionPage", { agentMode: "chat", archived: true, limit: 100 })).sessions[0].id, chat.id);
  await api("updateSession", { sessionId: chat.id, archived: false });
  await api("removeChatGroup", group.id); assert.equal((await api("getSession", chat.id)).chatGroupId, null);
  passed.push("Chat group create/rename/move/remove, title search, pin and archive/restore preserve the conversation");

  await renderer.evaluate('(async()=>{const preferences=await window.mingshen.getUiPreferences();await window.mingshen.saveUiPreferences({...preferences,interfaceStyle:"orbit"});return true})()');
  await renderer.evaluate('globalThis.__modeReloadPending=true;true');
  await renderer.send("Page.reload");
  await until('!globalThis.__modeReloadPending&&Boolean(document.querySelector(".app-shell--orbit[data-agent-mode=chat] .composer"))');
  await capture("chat-orbit-day");
  await capture("chat-orbit-compact-day", 800, 900);
  await click(".app-topbar .sidebar-toggle");
  await until('document.querySelector(".app-body").dataset.chatSidebarOpen==="true"');
  await capture("chat-orbit-compact-drawer-day", 800, 900);
  await click(`[data-session-id="${chat.id}"] .chat-session-row__main`);
  await until('document.querySelector(".app-body").dataset.chatSidebarOpen==="false"');
  await capture("chat-orbit-compact-closed-day", 800, 900);
  await renderer.evaluate('document.documentElement.dataset.theme="night";localStorage.setItem("mingshen.theme","night");true');
  await capture("chat-orbit-compact-night", 800, 900);
  await capture("chat-orbit-night");
  await click('[data-testid="agent-mode-code"]'); await capture("code-orbit-night");
  await close(); await launch();
  await until('Boolean(document.querySelector("[data-testid=agent-mode-switcher]"))');
  assert.equal((await api("getSession", chat.id)).title, "Pinned research");
  assert.equal((await api("getSession", code.id)).agentMode, "code");
  passed.push("Modes and conversations persist across a real Electron restart; both interface styles and narrow layouts render");
  assert.deepEqual(errors, []);
  const result = { passed, screenshots, officeEvidence, requests: requests.length, evidence, boundaries: "Synthetic local model and isolated profile; Office COM results are recorded as returned and do not certify visual layout. No formal installer, user database or paid model was used." };
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(join(evidence, "failure.json"), JSON.stringify({ passed, screenshots, officeEvidence, errors, failure: String(error.stack ?? error) }, null, 2)); throw error;
} finally {
  held?.destroy(); await close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  const local = relative(resolve(tmpdir()), temporary); assert.ok(local && !local.startsWith("..") && !isAbsolute(local));
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
