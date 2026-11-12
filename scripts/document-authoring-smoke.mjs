import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { Worker } from "node:worker_threads";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const desktop = resolve("apps/desktop");
const requireApp = createRequire(join(desktop, "package.json"));
const { strFromU8, unzipSync } = requireApp("fflate");
const { DOMParser } = requireApp("@xmldom/xmldom");
const mammoth = requireApp("mammoth");
const canvas = requireApp("@napi-rs/canvas");
const xlsx = requireApp("xlsx");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-document-authoring-"));
const project = join(temporary, "project");
const deniedProject = join(temporary, "denied-project");
const profile = join(temporary, "profile");
const evidence = resolve(".impeccable/review", `v${version.replaceAll(".", "")}-document-authoring-${Date.now()}`);
const passed = [];
const errors = [];
const requests = [];
const screenshots = [];
const structures = [];
const rendererPort = 9401;
const mainPort = 9402;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const chinese = "\u4e2d\u6587\u53ef\u7f16\u8f91\u6b63\u6587";
const imagePath = "assets/chart.png";
let child;
let main;
let renderer;
let scenario;
let requestSequence = 0;

const commonBlocks = [
  { type: "heading", text: "\u4e00\u3001\u7ed3\u679c\u6982\u89c8", level: 1 },
  { type: "paragraph", text: `${chinese}\uff1b\u5185\u7f6e\u672c\u5730\u5236\u4f5c\uff0c\u65e0\u9700 Office\u3002` },
  { type: "list", ordered: true, items: ["\u53ef\u7f16\u8f91\u6587\u672c", "\u672c\u5730\u56fe\u7247"] },
  {
    type: "table",
    header: true,
    rows: [
      ["\u683c\u5f0f", "\u7ed3\u679c"],
      ["DOCX / PPTX", "\u53ef\u7f16\u8f91"],
      ["PDF", "\u53ef\u9009\u4e2d\u6587\u5b57"],
    ],
  },
  { type: "image", path: imagePath, width: 4, height: 2, alt: "Local authoring chart 1.3.0" },
  { type: "page_break" },
  { type: "heading", text: "\u4e8c\u3001\u7b2c\u4e8c\u9875", level: 1 },
  { type: "paragraph", text: "SECOND_PAGE_130 \u7b2c\u4e8c\u9875\u5206\u9875\u4e0e\u4e2d\u6587\u6838\u9a8c\u3002" },
];
const docxRequest = {
  path: "report.docx",
  title: "\u6587\u6863\u5236\u4f5c\u9a8c\u8bc1 1.3.0",
  author: "Mingshen fixture",
  blocks: commonBlocks,
};
const pdfRequest = {
  ...docxRequest,
  path: "report.pdf",
  title: "\u672c\u5730 PDF \u4e2d\u6587\u62a5\u544a 1.3.0",
};
const pptxRequest = {
  path: "presentation.pptx",
  title: "\u5185\u7f6e\u6f14\u793a\u6587\u7a3f 1.3.0",
  author: "Mingshen fixture",
  slides: [
    {
      title: "\u5185\u7f6e\u6587\u6863\u5236\u4f5c",
      notes: "SPEAKER_NOTES_130 \u4e2d\u6587\u8bb2\u8005\u5907\u6ce8\u3002",
      background: "#FFFFFF",
      blocks: [
        { type: "heading", text: "\u53ef\u7f16\u8f91\u4e2d\u6587\u6f14\u793a", level: 1 },
        { type: "paragraph", text: chinese },
        {
          type: "table",
          header: true,
          rows: [["\u6307\u6807", "\u72b6\u6001"], ["\u5185\u7f6e\u5236\u4f5c", "\u901a\u8fc7"]],
          position: { x: 0.6, y: 2.2, w: 6, h: 1.2 },
        },
        { type: "image", path: imagePath, position: { x: 8, y: 2.2, w: 3.3, h: 1.65 } },
      ],
    },
    {
      title: "\u4ea4\u4ed8\u6838\u9a8c",
      blocks: [
        { type: "heading", text: "\u4e0b\u4e00\u6b65", level: 1 },
        { type: "list", items: ["\u4fdd\u7559\u53ef\u7f16\u8f91\u6587\u672c", "SECOND_SLIDE_130"] },
      ],
    },
  ],
};
const mathBlocks = [
  { type: "equation", latex: String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}` },
  { type: "equation", latex: String.raw`\sum_{i=1}^{n} i^2` },
  { type: "equation", latex: String.raw`\int_0^1 x^2\,dx` },
  { type: "equation", latex: String.raw`A=\begin{pmatrix}1&2\\3&4\end{pmatrix}` },
  { type: "equation", latex: String.raw`\begin{cases}x&x\ge0\\-x&x<0\end{cases}` },
  { type: "equation", latex: String.raw`\begin{aligned}y&=mx+b\\y'&=m\end{aligned}` },
];
const chartBlock = {
  type: "chart",
  chart_type: "column",
  title: "Editable fixture values",
  categories: ["Alpha", "Beta"],
  series: [{ name: "Values", values: [2, 5], color: "#167D8D" }],
};
const markdownBlock = {
  type: "markdown",
  text: [
    "# Markdown heading",
    "",
    "MARKDOWN_131 **Bold** and *italic* with $x^2$ and [source](https://example.com/document-fixture).",
    "",
    "1. First item",
    "   1. Nested item",
    "2. Second item",
    "",
    "| Column A | Column B |",
    "| --- | --- |",
    "| Native | Table |",
    "",
    "```tex",
    "$literal_code$",
    "```",
    "",
    "> Quoted fixture text",
  ].join("\n"),
};
const richDocxRequest = {
  path: "native-math.docx",
  title: `Native document features ${version}`,
  header: "NATIVE_HEADER_131",
  footer: "NATIVE_FOOTER_131",
  page_numbers: true,
  margins: { top: 0.8, bottom: 0.8, left: 0.7, right: 0.7 },
  blocks: [
    { type: "table_of_contents", title: "Contents" },
    { type: "heading", text: "Native equations", level: 1 },
    {
      type: "rich_paragraph",
      runs: [
        { type: "text", text: "INLINE_MATH_131 ", bold: true },
        { type: "equation", latex: String.raw`\frac{1}{2}` },
        { type: "text", text: " with a native note." },
        { type: "footnote", text: "NATIVE_FOOTNOTE_131" },
      ],
    },
    ...mathBlocks,
    { type: "page_break" },
    markdownBlock,
    { type: "page_break" },
    { type: "heading", text: "Editable chart", level: 1 },
    chartBlock,
  ],
};
const tableFormulaRows = [
  ["Fraction", String.raw`\frac{a+b}{c}`],
  ["Box", String.raw`\boxed{x^2+1}`],
  ["Cases", String.raw`\begin{cases}x^2&x\ge0\\-x&x<0\end{cases}`],
  ["Integral", String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`],
  ["Dot accents", String.raw`\dot{x}+\ddot{y}`],
  ["Chinese", String.raw`\text{中文结果}=x+1`],
];
const tableMathRows = [
  ["Structure", "Editable cell content"],
  ...tableFormulaRows.map(([name, latex]) => [
    name,
    { blocks: [{ type: "equation", latex, align: "left" }] },
  ]),
  [
    "Inline mixture",
    {
      blocks: [{
        type: "rich_paragraph",
        runs: [
          { type: "text", text: "TABLE_INLINE_132 中文 ", bold: true },
          { type: "equation", latex: String.raw`\frac{1}{2}` },
          { type: "text", text: " is editable.", italic: true },
        ],
      }],
    },
  ],
  [
    "Markdown",
    {
      blocks: [{
        type: "markdown",
        text: "TABLE_MARKDOWN_132 **Bold** and *italic* with $y^2$ and [source](https://example.com/table-fixture).",
      }],
    },
  ],
  [
    "Multiple blocks",
    {
      blocks: [
        { type: "paragraph", text: "TABLE_CELL_BEFORE_132" },
        { type: "equation", latex: String.raw`\sqrt{x}`, align: "left" },
        { type: "list", ordered: true, items: ["TABLE_FIRST_132", "TABLE_SECOND_132"] },
        { type: "code", text: "$literal_cell_code$" },
        { type: "quote", text: "TABLE_CELL_AFTER_132" },
      ],
    },
  ],
  [
    "Nested Markdown table",
    {
      blocks: [{
        type: "markdown",
        text: "| Nested value | Native formula |\n| --- | --- |\n| TABLE_NESTED_132 | $z^2$ |",
      }],
    },
  ],
  ["Literal string", String.raw`$literal_cell$ \frac{1}{2}`],
];
const tableMathDocxRows = structuredClone(tableMathRows);
tableMathDocxRows[7][1].blocks[0].runs.push({ type: "footnote", text: "TABLE_NATIVE_NOTE_132" });
const tableMathDocxRequest = {
  path: "table-math.docx",
  title: `Editable equations in table cells ${version}`,
  margins: { top: 0.65, bottom: 0.65, left: 0.7, right: 0.7 },
  blocks: [{ type: "table", header: true, rows: tableMathDocxRows }],
};
const tableMathPdfRequest = {
  ...tableMathDocxRequest,
  path: "table-math.pdf",
  blocks: [{ type: "table", header: true, rows: tableMathRows }],
};

function writeEvent(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "document-authoring-fixture" }] }));
      return;
    }
    assert.equal(request.url, "/v1/responses");
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const isAgent = Array.isArray(body.tools) && body.tools.length > 0;
    const record = { number: ++requestSequence, scenario: scenario?.name ?? null, isAgent, body };
    requests.push(record);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (!isAgent) {
      writeEvent(response, { type: "response.output_text.delta", delta: "Local document fixture." });
    } else {
      assert.ok(scenario, "Unexpected Agent request outside a fixture run.");
      assert.ok(body.tools.some((tool) => tool.name === "create_document"), "create_document was not exposed.");
      const step = scenario.steps[scenario.next++];
      if (step) {
        const callId = `document-${scenario.name}-${scenario.next}`;
        writeEvent(response, {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: `fc-${callId}`, call_id: callId, name: step.name, arguments: "" },
        });
        writeEvent(response, {
          type: "response.function_call_arguments.done",
          output_index: 0,
          arguments: JSON.stringify(step.arguments),
        });
      } else {
        writeEvent(response, {
          type: "response.output_text.delta",
          delta: `Document fixture ${scenario.name} completed; the tool result is recorded.`,
        });
      }
    }
    writeEvent(response, {
      type: "response.completed",
      response: { usage: { input_tokens: 1800, output_tokens: 100, total_tokens: 1900 } },
    });
    response.end();
  } catch (error) {
    errors.push(`Fixture provider: ${error instanceof Error ? error.stack : String(error)}`);
    response.destroy();
  }
});

async function available(port) {
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", done);
  });
  await new Promise((done) => probe.close(done));
}

async function connect(port, type) {
  let target;
  for (let index = 0; index < 180; index++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((value) => value.json());
      target = targets.find((item) => item.webSocketDebuggerUrl && (!type || item.type === type));
      if (target) break;
    } catch {}
    await sleep(80);
  }
  assert.ok(target, `No fixture debugger on port ${port}.`);
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
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 60000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

async function until(expression, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await renderer.evaluate(expression)) return;
    await sleep(80);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function launch() {
  await available(rendererPort);
  await available(mainPort);
  const appIndex = process.argv.indexOf("--app");
  const packaged = appIndex >= 0;
  if (packaged) assert.ok(process.argv[appIndex + 1], "--app requires an executable path.");
  const executable = packaged
    ? resolve(process.argv[appIndex + 1])
    : join(desktop, "node_modules/electron/dist/MingshenHarnessExperimental.exe");
  if (!packaged) {
    execFileSync(process.execPath, [resolve("scripts/prepare-experimental-runtime.cjs")], {
      windowsHide: true,
      stdio: "pipe",
    });
  }
  const environment = {
    ...process.env,
    MSH_EXPERIMENTAL: "1",
    MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: "1",
    MSH_NOTIFICATION_FIXTURE: "1",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(executable, [
    `--inspect=${mainPort}`,
    ...(packaged ? [] : ["."]),
    `--remote-debugging-port=${rendererPort}`,
  ], { cwd: desktop, env: environment, windowsHide: true, stdio: "ignore" });
  main = await connect(mainPort);
  await main.evaluate(`globalThis.__documentFixtureFetch=fetch;globalThis.fetch=(url,options)=>String(url).includes("/rest/v1/rpc/")?Promise.resolve(Response.json([])):globalThis.__documentFixtureFetch(url,options);true`);
  renderer = await connect(rendererPort, "page");
  await renderer.send("Runtime.enable");
}

async function closeApp() {
  const current = child;
  if (!current) return;
  const ended = current.exitCode !== null || current.signalCode !== null
    ? Promise.resolve()
    : new Promise((done) => current.once("exit", done));
  await renderer?.evaluate('setTimeout(()=>{void window.mingshen.desktopAction("quit")},100);true').catch(() => {});
  renderer?.close();
  main?.close();
  renderer = undefined;
  main = undefined;
  await Promise.race([ended, sleep(7000)]);
  if (current.exitCode === null && current.signalCode === null) {
    current.kill();
    await Promise.race([ended, sleep(7000)]);
    assert.ok(current.exitCode !== null || current.signalCode !== null, "Fixture Electron did not exit.");
  }
  child = undefined;
}

async function onboard() {
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(input=>input.click());true');
  for (const text of ["\u540c\u610f\u5e76\u7ee7\u7eed", "\u5f00\u59cb\u4f7f\u7528"]) {
    const target = `[...document.querySelectorAll(".policy-dialog button")].find(button=>!button.disabled&&button.textContent.trim()===${JSON.stringify(text)})`;
    await until(`Boolean(${target})`);
    await renderer.evaluate(`${target}.click();true`);
  }
  await until('!document.querySelector(".policy-dialog")');
  await renderer.evaluate(`(async()=>{
    for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
    await window.mingshen.setModelRetrySettings({maxRetries:0});
    const current=await window.mingshen.getTokenSaver();
    await window.mingshen.setTokenSaver({...current.settings,enabled:false});
    await window.mingshen.configureCompletionNotifications({nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false});
    globalThis.__documentEvents=[];
    globalThis.__documentApprovals=[];
    globalThis.__documentApprovalErrors=[];
    window.mingshen.onRuntimeEvent(event=>{
      globalThis.__documentEvents.push(event);
      if(event.type==="approval_required"){
        globalThis.__documentApprovals.push(event.approval);
        void window.mingshen.decideApproval({approvalId:event.approval.id,decision:"deny",feedback:"Denied by local document fixture"})
          .catch(error=>globalThis.__documentApprovalErrors.push(String(error)));
      }
    });
    return true;
  })()`);
}

async function createSession(provider, workspacePath, permissionMode = "full_access") {
  const session = await renderer.evaluate(`window.mingshen.createSession(${JSON.stringify({
    title: `Documents ${permissionMode}`,
    providerId: provider.id,
    modelId: provider.models[0].id,
    workspacePath,
    reasoningLevel: null,
    permissionMode,
    executionMode: "host",
    agentProfileId: "primary",
  })})`);
  await renderer.evaluate(`window.mingshen.setProjectMemoryEnabled(${JSON.stringify(session.id)},false)`);
  return session;
}

async function run(session, name, steps) {
  scenario = { name, steps, next: 0 };
  const previous = await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(session.id)})`);
  const start = requests.length;
  const { runId } = await renderer.evaluate(`window.mingshen.sendChat(${JSON.stringify({
    sessionId: session.id,
    text: `DOCUMENT_AUTHORING_${name}: execute the fixture tools and report their actual result.`,
  })})`);
  await until(`globalThis.__documentEvents.some(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`, 200000);
  const ending = await renderer.evaluate(`globalThis.__documentEvents.find(event=>event.runId===${JSON.stringify(runId)}&&["run_completed","run_failed","run_interrupted"].includes(event.type))`);
  assert.equal(ending.type, "run_completed", JSON.stringify(ending));
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(session.id)})`)).status, "idle");
  const messages = (await renderer.evaluate(`window.mingshen.getSessionMessages(${JSON.stringify(session.id)})`)).slice(previous.length);
  const parts = messages.flatMap((message) => message.parts);
  const toolResults = parts.filter((part) => part.type === "tool_result");
  const calls = parts.filter((part) => part.type === "tool_call");
  assert.deepEqual(calls.map((call) => call.name), steps.map((step) => step.name));
  assert.equal(toolResults.length, steps.length);
  assert.equal(requests.slice(start).filter((request) => request.isAgent).length, steps.length + 1);
  return { parts, calls, toolResults };
}

function stepsFor(args) {
  return [
    { name: "create_document", arguments: args },
    { name: "read_document", arguments: { path: args.path } },
  ];
}

async function inspectPdf(bytes) {
  return await new Promise((done, reject) => {
    const worker = new Worker(join(desktop, "resources/documents/document-worker.cjs"), {
      workerData: {
        bytes,
        extension: ".pdf",
        mode: "vision",
        moduleBase: requireApp.resolve("mammoth/package.json"),
      },
    });
    let settled = false;
    const finish = async (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker.terminate();
      error ? reject(error) : done(value);
    };
    const timer = setTimeout(() => void finish(undefined, new Error("PDF fixture inspection exceeded 90 seconds.")), 90000);
    worker.once("message", (message) => void finish(message.result, message.error ? new Error(message.error) : undefined));
    worker.once("error", (error) => void finish(undefined, error));
    worker.once("exit", () => {
      if (!settled) void finish(undefined, new Error("PDF fixture worker exited without a result."));
    });
  });
}

function archiveXml(archive, path) {
  assert.ok(archive[path], `Missing Office part ${path}`);
  return strFromU8(archive[path]);
}

function parseXml(text) {
  const fail = (message) => { throw new Error(`Invalid fixture output XML: ${message}`); };
  return new DOMParser({ errorHandler: { warning: fail, error: fail, fatalError: fail } })
    .parseFromString(text, "application/xml");
}

function assertCellEquations(archive, expectedEquations) {
  const document = parseXml(archiveXml(archive, "word/document.xml"));
  const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const mathNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const cells = Array.from(document.getElementsByTagNameNS(wordNamespace, "tc"));
  const equations = Array.from(document.getElementsByTagNameNS(mathNamespace, "oMath"));
  let cellEquations = 0;
  for (const equation of equations) {
    let parent = equation.parentNode;
    while (parent && !(parent.namespaceURI === wordNamespace && parent.localName === "tc")) parent = parent.parentNode;
    if (parent) cellEquations++;
  }
  assert.equal(cellEquations, expectedEquations, "Expected native formulas inside actual Word table cells.");
  for (const cell of cells) {
    const last = Array.from(cell.childNodes).filter((node) => node.nodeType === 1).at(-1);
    assert.ok(last?.namespaceURI === wordNamespace && last.localName === "p", "Word cells must end with a paragraph.");
  }
  return { document, cells, equations: equations.length, cellEquations };
}

function assertNativeFootnotes(archive, expectedNotes) {
  const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const document = parseXml(archiveXml(archive, "word/document.xml"));
  const notes = parseXml(archiveXml(archive, "word/footnotes.xml"));
  const references = Array.from(document.getElementsByTagNameNS(wordNamespace, "footnoteReference"))
    .map((node) => node.getAttributeNS(wordNamespace, "id"));
  const ids = Array.from(notes.getElementsByTagNameNS(wordNamespace, "footnote"))
    .map((node) => node.getAttributeNS(wordNamespace, "id"));
  assert.equal(references.length, expectedNotes);
  assert.equal(new Set(references).size, references.length, "Footnotes reused an ID across table cells and the body.");
  for (const reference of references) assert.ok(ids.includes(reference), `Missing native footnote ${reference}.`);
}

function assertOfficeRelationships(archive) {
  let count = 0;
  for (const [path, bytes] of Object.entries(archive).filter(([name]) => name.endsWith(".rels"))) {
    const relationships = Array.from(parseXml(strFromU8(bytes)).getElementsByTagName("Relationship"));
    const ids = relationships.map((node) => node.getAttribute("Id"));
    assert.equal(new Set(ids).size, ids.length, `Duplicate relationship IDs in ${path}`);
    const base = path === "_rels/.rels" ? "" : path.slice(0, path.lastIndexOf("/_rels/"));
    for (const node of relationships) {
      if (node.getAttribute("TargetMode") === "External") continue;
      const target = decodeURI(node.getAttribute("Target"));
      const normalized = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join(base, target));
      assert.ok(archive[normalized], `Unresolved Office relationship ${path}: ${target}`);
      count++;
    }
  }
  return count;
}

function assertEditableChart(archive, label) {
  const charts = Object.entries(archive).filter(([path]) => /charts\/chart[^/]*\.xml$/.test(path));
  const workbooks = Object.entries(archive).filter(([path]) => /embeddings\/[^/]*\.xlsx$/.test(path));
  assert.ok(charts.length > 0, `${label} did not contain a native chart.`);
  assert.ok(workbooks.length > 0, `${label} did not contain the editable chart workbook.`);
  const chartXml = charts.map(([, bytes]) => strFromU8(bytes)).join("\n");
  assert.match(chartXml, /<c:barChart>/);
  assert.match(chartXml, /<c:externalData\b/);
  assert.ok(chartXml.includes("Alpha") && chartXml.includes("Beta"), `${label} chart categories were missing.`);
  const workbook = xlsx.read(workbooks[0][1], { type: "array" });
  const cells = workbook.SheetNames.flatMap((name) =>
    xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }).flat());
  for (const value of ["Alpha", "Beta", 2, 5]) {
    assert.ok(cells.includes(value), `${label} chart workbook is missing ${value}.`);
  }
  return { charts: charts.length, workbooks: workbooks.length };
}

async function savePdfPages(result, prefix) {
  for (const page of result.pageImages) {
    const bytes = Buffer.from(page.dataUrl.slice(page.dataUrl.indexOf(",") + 1), "base64");
    const filename = `${prefix}-page-${page.page}.png`;
    await writeFile(join(evidence, filename), bytes);
    const bitmap = await canvas.loadImage(bytes);
    const raster = canvas.createCanvas(bitmap.width, bitmap.height);
    const context = raster.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let darkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 210 && pixels[index + 1] < 210 && pixels[index + 2] < 210) darkPixels++;
    }
    assert.ok(darkPixels > 500, `${filename} was blank or almost blank.`);
    screenshots.push(filename);
  }
}

async function captureDocxPreview(bytes) {
  const converted = await mammoth.convertToHtml({ buffer: bytes }, {
    convertImage: mammoth.images.imgElement(async (image) => ({
      src: "data:" + image.contentType + ";base64," + await image.read("base64"),
    })),
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><title>DOCX semantic HTML preview</title><style>body{font-family:"Microsoft YaHei",sans-serif;margin:40px;color:#111;background:#fff;line-height:1.55}h1{font-size:26px}h2{font-size:20px}p,li{font-size:15px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px}img{max-width:560px;max-height:260px;object-fit:contain}*{box-sizing:border-box}</style></head><body>${converted.value}</body></html>`;
  await writeFile(join(evidence, "docx-semantic-preview.html"), html, "utf8");
  const image = await main.evaluate(`(async()=>{
    const {BrowserWindow}=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const preview=new BrowserWindow({show:false,width:1000,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    try{
      await preview.loadURL("data:"+"text/html;charset=utf-8,"+encodeURIComponent(${JSON.stringify(html)}));
      await preview.webContents.executeJavaScript("document.fonts.ready");
      return (await preview.webContents.capturePage()).toPNG().toString("base64");
    }finally{preview.destroy();}
  })()`);
  await writeFile(join(evidence, "docx-semantic-preview.png"), Buffer.from(image, "base64"));
  screenshots.push("docx-semantic-preview.png");
}

try {
  await mkdir(join(project, "assets"), { recursive: true });
  await mkdir(deniedProject);
  await mkdir(evidence, { recursive: true });
  const imageCanvas = canvas.createCanvas(640, 320);
  const imageContext = imageCanvas.getContext("2d");
  imageContext.fillStyle = "#FFFFFF";
  imageContext.fillRect(0, 0, 640, 320);
  imageContext.fillStyle = "#111111";
  imageContext.font = "bold 24px sans-serif";
  imageContext.fillText("LOCAL IMAGE 1.3.0", 32, 42);
  for (const [index, [label, height, color]] of [["DOCX", 120, "#238B7B"], ["PPTX", 160, "#5863C6"], ["PDF", 195, "#C74D62"]].entries()) {
    const x = 55 + index * 190;
    imageContext.fillStyle = color;
    imageContext.fillRect(x, 270 - height, 130, height);
    imageContext.fillStyle = "#111111";
    imageContext.font = "18px sans-serif";
    imageContext.fillText(label, x + 36, 300);
  }
  const png = imageCanvas.toBuffer("image/png");
  await writeFile(join(project, imagePath), png);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  await launch();
  await onboard();
  assert.equal((await renderer.evaluate("window.mingshen.getAppInfo()")).version, version);
  for (const locale of ["zh-CN", "en"]) {
    for (const document of ["manual", "changelog"]) {
      const text = await renderer.evaluate(`window.mingshen.readPolicy(${JSON.stringify(document)},${JSON.stringify(locale)})`);
      assert.ok(text.includes(version));
      assert.ok(text.includes("create_document"));
      assert.match(text, /DOCX/i);
      assert.match(text, /PPTX/i);
      assert.match(text, /PDF/);
    }
  }
  passed.push(`${version} identity and bilingual embedded manual/changelog expose document authoring`);
  const provider = await renderer.evaluate(`(async()=>{
    const provider=await window.mingshen.createProvider({
      name:"Local document fixture",
      baseUrl:"http://127.0.0.1:${server.address().port}/v1",
      protocol:"openai_responses",
      authMode:"bearer",
      apiKey:"local-document-authoring-fixture",
      keyLabel:"Fixture",
      neverReveal:true
    });
    return await window.mingshen.createModel({
      providerId:provider.id,modelId:"document-authoring-fixture",contextWindow:200000,maxOutputTokens:16384,
      inputModalities:["text"],toolCalls:true,parallelToolCalls:false,reasoningLevels:[],anthropicNoneBehavior:"disabled"
    });
  })()`);
  const session = await createSession(provider, project);

  const docxRun = await run(session, "CREATE_DOCX", stepsFor(docxRequest));
  assert.ok(docxRun.toolResults.every((result) => !result.isError), JSON.stringify(docxRun.toolResults));
  assert.ok(docxRun.toolResults[1].output.includes(chinese));
  const docxBytes = await readFile(join(project, "report.docx"));
  const docx = unzipSync(docxBytes);
  const documentXml = strFromU8(docx["word/document.xml"]);
  assert.ok(documentXml.includes("<w:tbl>"));
  assert.ok(documentXml.includes('w:type="page"'));
  assert.ok(documentXml.includes('w:w="12240"'));
  assert.ok(Object.entries(docx).some(([name, bytes]) => name.startsWith("word/media/") && Buffer.from(bytes).equals(png)));
  const docxText = (await mammoth.extractRawText({ buffer: docxBytes })).value;
  assert.ok(docxText.includes(chinese));
  assert.ok(docxText.includes("SECOND_PAGE_130"));
  await copyFile(join(project, "report.docx"), join(evidence, "report.docx"));
  await captureDocxPreview(docxBytes);
  passed.push("Real create_document/read_document DOCX round trip: Chinese, native table, image bytes, Letter size and page break");

  const pptxRun = await run(session, "CREATE_PPTX", stepsFor(pptxRequest));
  assert.ok(pptxRun.toolResults.every((result) => !result.isError), JSON.stringify(pptxRun.toolResults));
  assert.ok(pptxRun.toolResults[1].output.includes(chinese));
  const pptxBytes = await readFile(join(project, "presentation.pptx"));
  const pptx = unzipSync(pptxBytes);
  const slide = strFromU8(pptx["ppt/slides/slide1.xml"]);
  assert.ok(slide.includes("<a:tbl>"));
  assert.ok(slide.includes(chinese));
  assert.ok(strFromU8(pptx["ppt/slides/slide2.xml"]).includes("SECOND_SLIDE_130"));
  assert.ok(strFromU8(pptx["ppt/notesSlides/notesSlide1.xml"]).includes("SPEAKER_NOTES_130"));
  assert.ok(Object.entries(pptx).some(([name, bytes]) => name.startsWith("ppt/media/") && Buffer.from(bytes).equals(png)));
  await copyFile(join(project, "presentation.pptx"), join(evidence, "presentation.pptx"));
  passed.push("Real create_document/read_document PPTX round trip: editable Chinese, native table, image bytes, two slides and speaker notes");

  const pdfRun = await run(session, "CREATE_PDF", stepsFor(pdfRequest));
  assert.ok(pdfRun.toolResults.every((result) => !result.isError), JSON.stringify(pdfRun.toolResults));
  assert.ok(pdfRun.toolResults[1].output.replace(/\s/g, "").includes(chinese));
  const pdfBytes = await readFile(join(project, "report.pdf"));
  assert.equal(pdfBytes.subarray(0, 5).toString("ascii"), "%PDF-");
  const pdfResult = await inspectPdf(pdfBytes);
  assert.equal(pdfResult.pdf.totalPages, 2, JSON.stringify(pdfResult.pdf));
  assert.ok(pdfResult.text.replace(/\s/g, "").includes(chinese));
  assert.ok(pdfResult.text.includes("SECOND_PAGE_130"));
  assert.equal(pdfResult.pageImages.length, 2);
  let coloredPixels = 0;
  for (const page of pdfResult.pageImages) {
    const pageBytes = Buffer.from(page.dataUrl.slice(page.dataUrl.indexOf(",") + 1), "base64");
    const filename = `pdf-page-${page.page}.png`;
    await writeFile(join(evidence, filename), pageBytes);
    screenshots.push(filename);
    const bitmap = await canvas.loadImage(pageBytes);
    const raster = canvas.createCanvas(bitmap.width, bitmap.height);
    const context = raster.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let darkPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 210 && pixels[index + 1] < 210 && pixels[index + 2] < 210) darkPixels++;
      if (pixels[index] < 100 && pixels[index + 1] > 110 && pixels[index + 2] > 80 && pixels[index + 1] > pixels[index] * 1.4) coloredPixels++;
    }
    assert.ok(darkPixels > 500, `${filename} was blank or almost blank.`);
  }
  assert.ok(coloredPixels > 500, "The local image did not render in the PDF.");
  await copyFile(join(project, "report.pdf"), join(evidence, "report.pdf"));
  passed.push("Real Chromium PDF round trip: selectable Chinese, table/image, explicit second page and nonblank page PNGs");

  const richDocxRun = await run(session, "CREATE_NATIVE_DOCX", stepsFor(richDocxRequest));
  assert.ok(richDocxRun.toolResults.every((result) => !result.isError), JSON.stringify(richDocxRun.toolResults));
  assert.ok(richDocxRun.toolResults[1].output.includes("Equation 1 (OMML"));
  assert.ok(richDocxRun.toolResults[1].output.includes("MARKDOWN_131"));
  const richDocxBytes = await readFile(join(project, richDocxRequest.path));
  const richDocx = unzipSync(richDocxBytes);
  const nativeXml = archiveXml(richDocx, "word/document.xml");
  const mathNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/math";
  const nativeDocument = parseXml(nativeXml);
  const mathCount = nativeDocument.getElementsByTagNameNS(mathNamespace, "oMath").length;
  assert.equal(mathCount, 8, "Six display formulas, one inline formula and one Markdown formula must remain OMML.");
  for (const name of ["f", "rad", "nary", "m", "sSup"]) {
    assert.ok(nativeDocument.getElementsByTagNameNS(mathNamespace, name).length > 0, `Missing native math structure ${name}`);
  }
  assert.match(nativeXml, /TOC/);
  assert.match(nativeXml, /<w:numPr>/);
  assert.match(nativeXml, /<w:tbl>/);
  assert.ok(nativeXml.includes("$literal_code$"), "Fenced TeX was incorrectly rendered as math.");
  assert.ok(archiveXml(richDocx, "word/footnotes.xml").includes("NATIVE_FOOTNOTE_131"));
  assert.ok(archiveXml(richDocx, "word/header1.xml").includes("NATIVE_HEADER_131"));
  const footerXml = archiveXml(richDocx, "word/footer1.xml");
  assert.ok(footerXml.includes("NATIVE_FOOTER_131") && footerXml.includes("PAGE") && footerXml.includes("NUMPAGES"));
  assert.ok(archiveXml(richDocx, "word/_rels/document.xml.rels").includes("https://example.com/document-fixture"));
  assert.equal(Object.keys(richDocx).filter((path) => /^word\/media\/.+\.(?:png|jpe?g|svg)$/i.test(path)).length, 0);
  structures.push({
    file: richDocxRequest.path,
    equations: mathCount,
    relationships: assertOfficeRelationships(richDocx),
    ...assertEditableChart(richDocx, "DOCX"),
  });
  await copyFile(join(project, richDocxRequest.path), join(evidence, richDocxRequest.path));
  passed.push("Native DOCX: eight OMML formulas, Markdown structure, native notes/TOC/page fields, chart/workbook and valid relationships");

  const tableMathDocxRun = await run(session, "CREATE_TABLE_MATH_DOCX", stepsFor(tableMathDocxRequest));
  assert.ok(tableMathDocxRun.toolResults.every((result) => !result.isError), JSON.stringify(tableMathDocxRun.toolResults));
  assert.ok(tableMathDocxRun.toolResults[1].output.includes("Equation 1 (OMML"));
  assert.ok(tableMathDocxRun.toolResults[1].output.includes("TABLE_CELL_AFTER_132"));
  const tableMathDocx = unzipSync(await readFile(join(project, tableMathDocxRequest.path)));
  const tableMathStructure = assertCellEquations(tableMathDocx, 10);
  assert.equal(tableMathStructure.equations, 10, "The table-only fixture has no formulas outside table cells.");
  assert.equal(tableMathStructure.cells.length, 28, "Twelve outer rows and the nested 2x2 Markdown table must survive.");
  const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const literalCell = tableMathStructure.cells.at(-1);
  assert.ok(literalCell.textContent.includes(String.raw`$literal_cell$ \frac{1}{2}`));
  assert.equal(literalCell.getElementsByTagNameNS(mathNamespace, "oMath").length, 0);
  const multiCell = tableMathStructure.cells.find((cell) => cell.textContent.includes("TABLE_CELL_BEFORE_132"));
  assert.ok(multiCell);
  for (const name of ["numPr", "b", "i", "footnoteReference", "tblHeader"])
    assert.ok(tableMathStructure.document.getElementsByTagNameNS(wordNamespace, name).length > 0, `Missing table rich content ${name}.`);
  const multiText = multiCell.textContent;
  assert.ok(multiText.indexOf("TABLE_CELL_BEFORE_132") < multiText.indexOf("TABLE_FIRST_132"));
  assert.ok(multiText.indexOf("TABLE_SECOND_132") < multiText.indexOf("$literal_cell_code$"));
  assert.ok(multiText.indexOf("$literal_cell_code$") < multiText.indexOf("TABLE_CELL_AFTER_132"));
  const tableText = tableMathStructure.document.documentElement.textContent;
  assert.ok(tableText.includes("中文结果") && tableText.includes("TABLE_NESTED_132"));
  assert.equal(Object.keys(tableMathDocx).filter((path) => path.startsWith("word/media/")).length, 0);
  assert.ok(archiveXml(tableMathDocx, "word/_rels/document.xml.rels").includes("https://example.com/table-fixture"));
  assert.ok(archiveXml(tableMathDocx, "word/footnotes.xml").includes("TABLE_NATIVE_NOTE_132"));
  assertNativeFootnotes(tableMathDocx, 1);
  structures.push({
    file: tableMathDocxRequest.path,
    equations: tableMathStructure.equations,
    cellEquations: tableMathStructure.cellEquations,
    cells: tableMathStructure.cells.length,
    relationships: assertOfficeRelationships(tableMathDocx),
  });
  await copyFile(join(project, tableMathDocxRequest.path), join(evidence, tableMathDocxRequest.path));
  passed.push("Table DOCX: ten OMML formulas inside cells, six notation types, mixed inline text, Markdown/nested table, lists/code/quote, native note/link and literal string compatibility");

  const tableMathPdfRun = await run(session, "CREATE_TABLE_MATH_PDF", stepsFor(tableMathPdfRequest));
  assert.ok(tableMathPdfRun.toolResults.every((result) => !result.isError), JSON.stringify(tableMathPdfRun.toolResults));
  const tableMathPdfBytes = await readFile(join(project, tableMathPdfRequest.path));
  const tableMathPdf = await inspectPdf(tableMathPdfBytes);
  await copyFile(join(project, tableMathPdfRequest.path), join(evidence, tableMathPdfRequest.path));
  await savePdfPages(tableMathPdf, "table-math");
  await writeFile(join(evidence, "table-math-text.txt"), tableMathPdf.text, "utf8");
  assert.ok(tableMathPdf.pdf.totalPages >= 1 && tableMathPdf.pdf.totalPages <= 4, JSON.stringify(tableMathPdf.pdf));
  assert.equal(tableMathPdf.pageImages.length, tableMathPdf.pdf.totalPages);
  const tablePdfText = tableMathPdf.text.normalize("NFKC").replace(/\s/g, "");
  for (const marker of ["TABLE_INLINE_132", "TABLE_MARKDOWN_132", "TABLE_CELL_BEFORE_132", "TABLE_CELL_AFTER_132", "TABLE_NESTED_132", "中文结果"])
    assert.ok(tablePdfText.includes(marker), `Table PDF lost ${marker}.`);
  structures.push({ file: tableMathPdfRequest.path, pages: tableMathPdf.pdf.totalPages });
  passed.push("Real Chromium table PDF: rich cells, formulas/Chinese, literal code, nested Markdown table and every page rasterized without blank output");

  const templateRequest = {
    path: "template.docx",
    header: "TEMPLATE_HEADER_KEEP_131",
    page_numbers: true,
    blocks: [
      { type: "paragraph", text: "TEMPLATE_BEFORE_KEEP_131" },
      { type: "paragraph", text: "{{body}}" },
      {
        type: "rich_paragraph",
        runs: [
          { type: "text", text: "TEMPLATE_AFTER_KEEP_131" },
          { type: "footnote", text: "TEMPLATE_ORIGINAL_NOTE_131" },
        ],
      },
    ],
  };
  const templateRun = await run(session, "CREATE_TEMPLATE", stepsFor(templateRequest));
  assert.ok(templateRun.toolResults.every((result) => !result.isError), JSON.stringify(templateRun.toolResults));
  const templateBytes = await readFile(join(project, templateRequest.path));
  const filledRequest = {
    path: "filled-template.docx",
    template: {
      path: templateRequest.path,
      replacements: [{
        placeholder: "body",
        blocks: [
          { type: "equation", latex: String.raw`\sqrt{x^2+1}` },
          chartBlock,
          { type: "list", ordered: true, items: ["TEMPLATE_FIRST_131", "TEMPLATE_SECOND_131"] },
          {
            type: "rich_paragraph",
            runs: [
              { type: "text", text: "TEMPLATE_INSERTED_131", link: "https://example.com/template-fixture" },
              { type: "footnote", text: "TEMPLATE_ADDED_NOTE_131" },
            ],
          },
          {
            type: "table",
            header: true,
            rows: [
              ["Template cells", "Native content"],
              [
                "Display and inline",
                {
                  blocks: [
                    { type: "equation", latex: String.raw`\frac{m}{n}`, align: "left" },
                    {
                      type: "rich_paragraph",
                      runs: [
                        { type: "text", text: "TEMPLATE_TABLE_132 ", link: "https://example.com/template-table-fixture" },
                        { type: "equation", latex: "v^2" },
                        { type: "footnote", text: "TEMPLATE_TABLE_NOTE_132" },
                      ],
                    },
                  ],
                },
              ],
            ],
          },
        ],
      }],
    },
  };
  const filledRun = await run(session, "FILL_TEMPLATE", stepsFor(filledRequest));
  assert.ok(filledRun.toolResults.every((result) => !result.isError), JSON.stringify(filledRun.toolResults));
  assert.ok(filledRun.toolResults[1].output.includes("TEMPLATE_INSERTED_131"));
  assert.equal(digest(await readFile(join(project, templateRequest.path))), digest(templateBytes), "Template input was modified.");
  const filledBytes = await readFile(join(project, filledRequest.path));
  const filled = unzipSync(filledBytes);
  const filledXml = archiveXml(filled, "word/document.xml");
  assert.ok(filledXml.includes("TEMPLATE_BEFORE_KEEP_131") && filledXml.includes("TEMPLATE_AFTER_KEEP_131"));
  assert.ok(!filledXml.includes("{{body}}"), "Template marker survived replacement.");
  assert.match(filledXml, /<m:rad>/);
  assert.match(filledXml, /<w:numPr>/);
  assert.ok(archiveXml(filled, "word/header1.xml").includes("TEMPLATE_HEADER_KEEP_131"));
  const notesXml = archiveXml(filled, "word/footnotes.xml");
  assert.ok(notesXml.includes("TEMPLATE_ORIGINAL_NOTE_131") && notesXml.includes("TEMPLATE_ADDED_NOTE_131"));
  assert.ok(notesXml.includes("TEMPLATE_TABLE_NOTE_132"));
  assertNativeFootnotes(filled, 3);
  assert.ok(archiveXml(filled, "word/_rels/document.xml.rels").includes("https://example.com/template-fixture"));
  assert.ok(archiveXml(filled, "word/_rels/document.xml.rels").includes("https://example.com/template-table-fixture"));
  const templateXml = archiveXml(unzipSync(templateBytes), "word/document.xml");
  for (const tag of ["pgSz", "pgMar"])
    assert.equal(filledXml.match(new RegExp(`<w:${tag}[^>]+>`))?.[0], templateXml.match(new RegExp(`<w:${tag}[^>]+>`))?.[0], `Template ${tag} changed.`);
  const filledStructure = assertCellEquations(filled, 2);
  assert.equal(filledStructure.equations, 3);
  structures.push({
    file: filledRequest.path,
    equations: filledStructure.equations,
    cellEquations: filledStructure.cellEquations,
    relationships: assertOfficeRelationships(filled),
    ...assertEditableChart(filled, "DOCX template"),
  });
  for (const path of [templateRequest.path, filledRequest.path]) {
    await copyFile(join(project, path), join(evidence, path));
  }
  passed.push("Real DOCX template read/fill: preserved input/page geometry/text/header/original note, plus native formula/chart/new note/list/link and rich table cells");

  const chartPptxRequest = {
    path: "native-chart.pptx",
    title: `Native chart ${version}`,
    slides: [{ title: "Editable chart", blocks: [chartBlock] }],
  };
  const chartPptxRun = await run(session, "CREATE_CHART_PPTX", stepsFor(chartPptxRequest));
  assert.ok(chartPptxRun.toolResults.every((result) => !result.isError), JSON.stringify(chartPptxRun.toolResults));
  const chartPptx = unzipSync(await readFile(join(project, chartPptxRequest.path)));
  structures.push({
    file: chartPptxRequest.path,
    relationships: assertOfficeRelationships(chartPptx),
    ...assertEditableChart(chartPptx, "PPTX"),
  });
  await copyFile(join(project, chartPptxRequest.path), join(evidence, chartPptxRequest.path));
  passed.push("Native PPTX chart: editable embedded workbook, expected data and valid package relationships");

  const mathPdfRequest = {
    path: "formulas.pdf",
    title: `Formula rendering ${version}`,
    header: "PDF_HEADER_131",
    footer: "PDF_FOOTER_131",
    page_numbers: true,
    blocks: [
      { type: "heading", text: "Six formula structures", level: 1 },
      ...mathBlocks,
      { type: "page_break" },
      markdownBlock,
    ],
  };
  const mathPdfRun = await run(session, "CREATE_MATH_PDF", stepsFor(mathPdfRequest));
  assert.ok(mathPdfRun.toolResults.every((result) => !result.isError), JSON.stringify(mathPdfRun.toolResults));
  assert.ok(mathPdfRun.toolResults[1].output.includes("MARKDOWN_131"));
  const mathPdfBytes = await readFile(join(project, mathPdfRequest.path));
  const mathPdf = await inspectPdf(mathPdfBytes);
  assert.equal(mathPdf.pdf.totalPages, 2, JSON.stringify(mathPdf.pdf));
  assert.equal(mathPdf.pageImages.length, 2);
  assert.ok(mathPdf.text.includes("PDF_HEADER_131") && mathPdf.text.includes("PDF_FOOTER_131"));
  await savePdfPages(mathPdf, "formulas");
  await copyFile(join(project, mathPdfRequest.path), join(evidence, mathPdfRequest.path));
  passed.push("Real Chromium formula PDF: six formula structures, Markdown, header/footer/page counters and two nonblank rendered pages");

  const invalidMathRun = await run(session, "UNSUPPORTED_MATH", [{
    name: "create_document",
    arguments: { path: "invalid-formula.docx", blocks: [{ type: "equation", latex: String.raw`\unknowncommand{x}` }] },
  }]);
  assert.equal(invalidMathRun.toolResults[0].isError, true);
  assert.ok(invalidMathRun.toolResults[0].output.includes("NATIVE_EQUATION_UNSUPPORTED"));
  await assert.rejects(readFile(join(project, "invalid-formula.docx")), { code: "ENOENT" });
  passed.push("Unsupported LaTeX returns a specific error and commits no text/image fallback");

  const rejectedCellRequests = [
    {
      name: "UNSUPPORTED_CELL_MATH",
      arguments: { path: "invalid-cell-formula.docx", blocks: [{ type: "table", rows: [[{ blocks: [{ type: "equation", latex: String.raw`\unknowncommand{x}` }] }]] }] },
      error: /NATIVE_EQUATION_UNSUPPORTED/,
    },
    {
      name: "REMOTE_CELL_MARKDOWN",
      arguments: { path: "remote-cell-image.docx", blocks: [{ type: "table", rows: [[{ blocks: [{ type: "markdown", text: "![remote](https://example.com/cell.png)" }] }]] }] },
      error: /MARKDOWN_IMAGE/,
    },
    {
      name: "RICH_CELL_PPTX",
      arguments: { path: "rich-cell.pptx", slides: [{ blocks: [{ type: "table", rows: [[{ blocks: [{ type: "paragraph", text: "Unsupported rich PPTX cell" }] }]] }] }] },
      error: /PPTX/,
    },
    {
      name: "CELL_PDF_FOOTNOTE",
      arguments: { path: "footnote-cell.pdf", blocks: [{ type: "table", rows: [[{ blocks: [{ type: "rich_paragraph", runs: [{ type: "text", text: "Note" }, { type: "footnote", text: "Unsupported PDF footnote" }] }] }]] }] },
      error: /PDF/,
    },
  ];
  for (const fixture of rejectedCellRequests) {
    const result = await run(session, fixture.name, [{ name: "create_document", arguments: fixture.arguments }]);
    assert.equal(result.toolResults[0].isError, true, fixture.name);
    assert.match(result.toolResults[0].output, fixture.error);
    await assert.rejects(readFile(join(project, fixture.arguments.path)), { code: "ENOENT" });
  }
  passed.push("Table cell safety: unsupported native math/remote Markdown image/rich PPTX cell/PDF footnote return explicit errors and leave no output");

  const originalHash = digest(docxBytes);
  const noOverwrite = await run(session, "NO_OVERWRITE", [{ name: "create_document", arguments: docxRequest }]);
  assert.equal(noOverwrite.toolResults[0].isError, true);
  assert.ok(noOverwrite.toolResults[0].output.includes("overwrite:true"));
  assert.equal(digest(await readFile(join(project, "report.docx"))), originalHash);
  passed.push("Default overwrite refusal preserves the original Office bytes");

  const overwrite = await run(session, "OVERWRITE", stepsFor({
    path: "report.docx",
    overwrite: true,
    title: "\u66f4\u65b0\u540e\u7684\u6587\u6863",
    blocks: [{ type: "paragraph", text: "EXPLICIT_OVERWRITE_130 \u663e\u5f0f\u8986\u76d6\u5df2\u6838\u9a8c\u3002" }],
  }));
  assert.ok(overwrite.toolResults.every((result) => !result.isError), JSON.stringify(overwrite.toolResults));
  const replaced = await readFile(join(project, "report.docx"));
  assert.notEqual(digest(replaced), originalHash);
  assert.ok((await mammoth.extractRawText({ buffer: replaced })).value.includes("EXPLICIT_OVERWRITE_130"));
  assert.ok(overwrite.toolResults[1].output.includes("EXPLICIT_OVERWRITE_130"));
  passed.push("Explicit overwrite commits a new complete DOCX and the real read tool sees the replacement");

  const denied = await createSession(provider, deniedProject, "request_approval");
  const deniedRun = await run(denied, "DENIED", [{
    name: "create_document",
    arguments: { path: "denied.docx", blocks: [{ type: "paragraph", text: "Must not be written." }] },
  }]);
  assert.equal(deniedRun.toolResults[0].isError, true);
  assert.match(deniedRun.toolResults[0].output, /Denied by local document fixture|\u62d2\u7edd/);
  await assert.rejects(readFile(join(deniedProject, "denied.docx")), { code: "ENOENT" });
  assert.equal((await renderer.evaluate(`window.mingshen.getSession(${JSON.stringify(denied.id)})`)).permissionMode, "request_approval");
  const approvals = await renderer.evaluate("globalThis.__documentApprovals");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].toolName, "create_document");
  assert.equal(resolve(approvals[0].pathScope), join(deniedProject, "denied.docx"));
  assert.deepEqual(await renderer.evaluate("globalThis.__documentApprovalErrors"), []);
  passed.push("Real request-approval denial leaves no file and does not change the session permission mode");

  assert.deepEqual(errors, []);
  const summary = {
    version,
    passed,
    agentRequests: requests.filter((request) => request.isAgent).length,
    auxiliaryRequests: requests.filter((request) => !request.isAgent).length,
    screenshots,
    structures,
    evidence,
    previewBoundary: "DOCX preview is semantic HTML from the generated DOCX, not a Microsoft Word layout rendering. PDF PNGs render the generated PDF.",
    packaged: process.argv.includes("--app"),
  };
  await writeFile(join(evidence, "result.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await writeFile(join(evidence, "failure.json"), JSON.stringify({
    version,
    passed,
    agentRequests: requests.filter((request) => request.isAgent).length,
    errors,
    screenshots,
    structures,
    failure: error instanceof Error ? error.stack : String(error),
  }, null, 2), "utf8");
  throw error;
} finally {
  await closeApp();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  const local = relative(resolve(tmpdir()), temporary);
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local));
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
