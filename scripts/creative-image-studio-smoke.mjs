import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as portServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const require = createRequire(resolve("apps/desktop/package.json"));
const { createCanvas } = require("@napi-rs/canvas");
const { unzipSync } = require("fflate");
const temporary = await mkdtemp(join(tmpdir(), "mingshen-creative-image-"));
const project = join(temporary, "project-a");
const otherProject = join(temporary, "project-b");
const profile = join(temporary, "profile");
const evidence = resolve(".impeccable/review", `v136-creative-image-${Date.now()}`);
const passed = [], requests = [], exceptions = [], serviceErrors = [], screenshots = [], geometry = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let child, main, renderer, session, secondSession, provider, textModel, imageModel;
let holdPolish = false;
const heldPolish = [];
let holdImage = false;
const heldImages = [];

function fixturePng(background, accent) {
  const canvas = createCanvas(128, 96);
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, 128, 96);
  context.fillStyle = accent;
  context.fillRect(12, 14, 48, 62);
  context.fillStyle = "#ffffff";
  context.fillRect(76, 24, 36, 38);
  return canvas.toBuffer("image/png");
}

const generatedPng = fixturePng("#005a55", "#ef6556");
const importedPng = fixturePng("#ca5e1f", "#2578a5");
const referencePngs = [
  importedPng,
  fixturePng("#6d3c9a", "#f1c453"),
  fixturePng("#235c8f", "#79d6b5"),
  fixturePng("#7a283e", "#f4a261"),
];
const manualReferencePng = fixturePng("#3f6f32", "#d8e26d");
const referenceFileNames = [
  "reference-a.png",
  "reference-b.png",
  "reference-c.png",
  "reference-d.png",
];
const polishedText = "Polished fixture: a copper vessel on a clear teal stage, soft side lighting.";
const reverseText = "Reverse fixture: geometric color blocks with a bright rectangular accent.";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function pngDimensions(bytes) {
  assert.ok(
    bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "Expected a validated PNG entry",
  );
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    assert.equal(request.method, "POST");
    const raw = Buffer.concat(chunks);
    if (request.url === "/v1/images/edits") {
      const contentType = String(request.headers["content-type"] ?? "");
      assert.match(contentType, /^multipart\/form-data; boundary=/);
      const form = await new Response(raw, { headers: { "content-type": contentType } }).formData();
      const fields = Object.fromEntries(
        [...form.entries()]
          .filter(([, value]) => typeof value === "string")
          .map(([key, value]) => [key, String(value)]),
      );
      const uploaded = [];
      for (const [field, value] of form.entries()) {
        if (field !== "image" && field !== "image[]") continue;
        assert.notEqual(typeof value, "string", "Reference upload must be a file");
        const bytes = Buffer.from(await value.arrayBuffer());
        uploaded.push({
          field,
          name: value.name,
          type: value.type,
          size: bytes.length,
          sha256: digest(bytes),
        });
      }
      const record = {
        url: request.url,
        kind: "reference-image",
        model: fields.model,
        hasImage: uploaded.length > 0,
        toolCount: 0,
        settled: false,
        fields,
        files: uploaded,
        clientClosed: false,
      };
      response.once("close", () => {
        if (!response.writableEnded) record.clientClosed = true;
      });
      requests.push(record);
      assert.ok(uploaded.length >= 1 && uploaded.length <= 3, JSON.stringify(uploaded));
      assert.deepEqual(
        uploaded.map((file) => file.field),
        uploaded.length === 1 ? ["image"] : uploaded.map(() => "image[]"),
        "A single reference uses image; multiple references use repeated image[] fields",
      );
      assert.equal(fields.model, "studio-image");
      assert.match(fields.prompt, /Polished fixture/);
      assert.equal(fields.n, "1");
      assert.equal(fields.size, "1024x1024");
      assert.equal(fields.quality, "auto");
      assert.ok(
        !Object.hasOwn(fields, "response_format"),
        "The image edit API omits legacy response_format",
      );
      if (holdImage) await new Promise((done) => heldImages.push(done));
      if (response.destroyed) {
        record.settled = true;
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          data: [
            {
              b64_json: generatedPng.toString("base64"),
              revised_prompt: "Generated reference fixture",
            },
          ],
        }),
      );
      record.settled = true;
      return;
    }
    const body = JSON.parse(raw.toString("utf8") || "{}");
    assert.deepEqual(body.tools ?? [], [], "Studio requests must not expose tools");
    const hasImage = JSON.stringify(body.input ?? []).includes("input_image");
    const kind = request.url === "/v1/images/generations" ? "image" : hasImage ? "reverse" : "polish";
    const record = {
      url: request.url,
      kind,
      model: body.model,
      hasImage,
      toolCount: (body.tools ?? []).length,
      settled: false,
      files: [],
      fields:
        kind === "image"
          ? { n: body.n, size: body.size, quality: body.quality }
          : undefined,
      clientClosed: false,
    };
    response.once("close", () => {
      if (!response.writableEnded) record.clientClosed = true;
    });
    requests.push(record);
    if (kind === "image") {
      assert.equal(body.n, 1);
      assert.ok(!Object.hasOwn(body, "response_format"), "The current image API omits legacy response_format");
      assert.match(body.prompt, /Polished fixture/);
      if (holdImage) await new Promise((done) => heldImages.push(done));
      if (response.destroyed) {
        record.settled = true;
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ b64_json: generatedPng.toString("base64"), revised_prompt: "Generated local fixture" }] }));
      record.settled = true;
      return;
    }
    assert.equal(request.url, "/v1/responses");
    if (hasImage) {
      const images = body.input.flatMap((item) => item.content ?? []).filter((item) => item.type === "input_image");
      assert.equal(images.length, 1);
      assert.match(images[0].image_url, /^data:image\/png;base64,/);
    }
    const text = hasImage ? reverseText : polishedText;
    if (kind === "polish" && holdPolish) {
      await new Promise((done) => heldPolish.push(done));
      if (response.destroyed) { record.settled = true; return; }
    }
    if (body.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`);
      response.end(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 20, output_tokens: 20, total_tokens: 40 } } })}\n\n`);
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] }));
    }
    record.settled = true;
  } catch (cause) {
    serviceErrors.push(cause.stack || String(cause));
    if (!response.headersSent) response.writeHead(500);
    response.end("Local studio fixture failed.");
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
      target = (await fetch(`http://127.0.0.1:${number}/json`).then((value) => value.json())).find(
        (item) =>
          item.webSocketDebuggerUrl &&
          (kind === "main"
            ? item.type === "node"
            : item.type === "page" && /\/renderer\/index\.html(?:[?#]|$)/.test(item.url)),
      );
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

async function scopedObject(objectId, name) {
  const properties = await main.send("Runtime.getProperties", { objectId, ownProperties: false });
  const scopes = properties.internalProperties?.find((item) => item.name === "[[Scopes]]")?.value?.objectId;
  if (!scopes) return null;
  const list = await main.send("Runtime.getProperties", { objectId: scopes, ownProperties: true });
  for (const scope of list.result) {
    if (!scope.value?.objectId) continue;
    const values = await main.send("Runtime.getProperties", { objectId: scope.value.objectId, ownProperties: true });
    const match = values.result.find((item) => item.name === name && item.value?.objectId);
    if (match) return match.value.objectId;
  }
  return null;
}
async function installReleaseFixture() {
  const handler = await main.send("Runtime.evaluate", {
    expression: `process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").ipcMain._invokeHandlers.get("updates:download")`,
  });
  assert.ok(handler.result.objectId, "Update IPC handler is unavailable");
  const listener = await scopedObject(handler.result.objectId, "listener");
  const updater = (listener && await scopedObject(listener, "updates")) || await scopedObject(handler.result.objectId, "updates");
  assert.ok(updater, "UpdateService is unavailable in the IPC handler scope");
  const result = await main.send("Runtime.callFunctionOn", {
    objectId: updater,
    functionDeclaration: `function(){
      globalThis.__studioReleaseRequests=[];
      this.fetcher=async (target,options)=>{
        const url=new URL(String(target));
        if(url.protocol!=="https:"||!/^\\/rest\\/v1\\/rpc\\/mingshen_get_latest_release(?:_v2)?$/.test(url.pathname)||options?.method!=="POST")throw new Error("Unexpected release fixture request: "+url.href);
        globalThis.__studioReleaseRequests.push(url.pathname);
        return Response.json([{version:"1.3.7",download_page_url:"https://example.com/releases",notes:"Local release fixture",published_at:"2026-11-23T00:00:00.000Z",package_format:"page"}]);
      };
      return true;
    }`,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  assert.equal(result.result.value, true);
}

const api = (name, ...args) => renderer.evaluate(`window.mingshen.${name}(${args.map((value) => JSON.stringify(value)).join(",")})`);
async function until(expression, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await renderer.evaluate(expression)) return; }
    catch (cause) { if (!/context|reload|destroyed|navigat/i.test(String(cause))) throw cause; }
    await sleep(60);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function waitForRequestCount(kind, count) {
  const deadline = Date.now() + 30_000;
  while (requests.filter((request) => request.kind === kind).length < count) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${kind} fixture request`);
    await sleep(60);
  }
}
async function waitForRequestSettled(kind, count) {
  const deadline = Date.now() + 30_000;
  while (!requests.filter((request) => request.kind === kind)[count - 1]?.settled) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${kind} fixture response ${count}`);
    await sleep(60);
  }
}
function releasePolish() {
  holdPolish = false;
  for (const done of heldPolish.splice(0)) done();
}
function releaseImage() {
  holdImage = false;
  for (const done of heldImages.splice(0)) done();
}
async function click(selector) {
  await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled||el.closest('[hidden]'))return false;const style=getComputedStyle(el),rect=el.getBoundingClientRect();if(style.display==='none'||style.visibility!=='visible'||rect.width<1||rect.height<1)return false;el.scrollIntoView({block:"nearest",inline:"nearest"});el.click();return true})()`);
}
async function controlChecked(selector) {
  return renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el)return null;
    if(el instanceof HTMLInputElement&&el.type==="checkbox")return el.checked;
    const input=el.querySelector?.('input[type="checkbox"]');
    if(input instanceof HTMLInputElement)return input.checked;
    const state=el.getAttribute("aria-checked")??el.getAttribute("aria-pressed");
    return state==="true";
  })()`);
}
async function clearImageAssetSelection() {
  const selected = await renderer.evaluate(
    'document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length',
  );
  if (!selected) return;
  const batchClear = await renderer.evaluate(
    '(()=>{const el=document.querySelector("[data-testid=image-assets-clear-selection]");return Boolean(el&&!el.disabled&&!el.closest("[hidden]"))})()',
  );
  if (batchClear) await click("[data-testid=image-assets-clear-selection]");
  else {
    while (
      (await renderer.evaluate(
        'document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length',
      )) > 0
    )
      await renderer.evaluate(
        'document.querySelector("[data-testid=image-asset] .image-asset__select[aria-pressed=true]")?.click();true',
      );
  }
  await until(
    'document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length===0',
  );
}
async function selectImageAssetIds(ids) {
  await clearImageAssetSelection();
  for (const id of ids)
    await click(
      `[data-testid=image-asset][data-asset-id="${id}"] .image-asset__select[aria-pressed=false]`,
    );
  await until(
    `document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length===${ids.length}`,
  );
}
async function untilFile(path, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const bytes = await readFile(path);
      if (bytes.length) return bytes;
    } catch {}
    await sleep(80);
  }
  throw new Error(`Timed out waiting for file: ${path}`);
}
async function installSaveDialogFixture(filePath) {
  await main.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const descriptor=Object.getOwnPropertyDescriptor(electron.dialog,"showSaveDialog");
    globalThis.__studioSaveDialogDescriptor=descriptor;
    Object.defineProperty(electron.dialog,"showSaveDialog",{configurable:true,enumerable:descriptor?.enumerable??true,writable:true,value:async()=>({canceled:false,filePath:${JSON.stringify(filePath)}})});
    return true;
  })()`);
}
async function restoreSaveDialogFixture() {
  await main.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const descriptor=globalThis.__studioSaveDialogDescriptor;
    if(descriptor)Object.defineProperty(electron.dialog,"showSaveDialog",descriptor);
    else delete electron.dialog.showSaveDialog;
    delete globalThis.__studioSaveDialogDescriptor;
    return true;
  })()`);
}
async function pointerClick(selector) {
  const point = await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled||el.closest('[hidden]'))return null;const r=el.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,hit=document.elementFromPoint(x,y);return{x,y,width:r.width,height:r.height,hitOk:Boolean(hit&&(el===hit||el.contains(hit))),hit:hit?.outerHTML.slice(0,180)}})()`);
  assert.ok(point && point.width > 0 && point.height > 0 && point.hitOk, `Cannot hit ${selector}: ${JSON.stringify(point)}`);
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
}
async function fill(selector, text) {
  await until(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return Boolean(el&&!el.disabled&&el.getBoundingClientRect().width>0)})()`);
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:"nearest"});el.focus();el.select();return true})()`);
  if (text) await renderer.send("Input.insertText", { text });
  else {
    await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    await renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  }
}
async function selectOption(selector, value) {
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||![...el.options].some(option=>option.value===${JSON.stringify(value)}))throw new Error("Missing select option");el.value=${JSON.stringify(value)};el.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
  await until(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`);
}
async function creativeFields() {
  return renderer.evaluate(`(()=>({fields:[...document.querySelectorAll('[data-testid=creative-draft-form] .creative-field-grid input,[data-testid=creative-draft-form] .creative-field-grid textarea')].map(el=>el.value),sections:[...document.querySelectorAll('[data-testid=creative-sections] .creative-section')].map(el=>({title:el.querySelector('input').value,notes:el.querySelector('textarea').value}))}))()`);
}
async function installClipboardCapture() {
  await renderer.evaluate(`(()=>{
    const original=Object.getOwnPropertyDescriptor(navigator,'clipboard');
    window.__creativeClipboardText=null;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__creativeClipboardText=text}}});
    window.__restoreCreativeClipboard=()=>{if(original)Object.defineProperty(navigator,'clipboard',original);else delete navigator.clipboard};
    return true;
  })()`);
}
async function setFiles(selector, files) {
  await until(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});return Boolean(input&&input instanceof HTMLInputElement&&input.type==="file")})()`);
  const root = await renderer.send("DOM.getDocument", { depth: -1 });
  const node = await renderer.send("DOM.querySelector", { nodeId: root.root.nodeId, selector });
  assert.ok(node.nodeId, `Missing file input ${selector}`);
  await renderer.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files });
}
async function capture(name) {
  await sleep(180);
  const image = await renderer.send("Page.captureScreenshot", { format: "png" });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(image.data, "base64")); screenshots.push(path);
}
async function key(name, code, windowsVirtualKeyCode, modifiers = 0) {
  await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode, modifiers });
  await renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode, modifiers });
}
async function selectSession(target, expectedMode = "work") {
  await key("P", "KeyP", 80, 10);
  await until('Boolean(document.querySelector("[data-testid=command-palette-input]"))');
  await fill("[data-testid=command-palette-input]", target.title);
  await click(`[data-testid="command-palette-session"][data-session-id="${target.id}"]`);
  await until('!document.querySelector("[data-testid=command-palette]")');
  await until(`document.querySelector('[data-testid="agent-mode-${expectedMode}"]')?.getAttribute('aria-pressed')==='true'`);
  await until(`[...document.querySelectorAll('.topbar-session strong,.orbit-workspace-header__path h1')].some(el=>el.getBoundingClientRect().width>0&&el.textContent===${JSON.stringify(target.title)})`);
  await until('document.querySelector(".app-body")?.hidden===false');
}
async function reload() {
  const marker = `studio-reload-${Date.now()}-${Math.random()}`;
  await renderer.evaluate(`window.__studioReloadMarker=${JSON.stringify(marker)};true`);
  await renderer.send("Page.reload");
  await until(`window.__studioReloadMarker!==${JSON.stringify(marker)}&&Boolean(document.querySelector(".app-shell"))`);
}
async function openSurface(name) {
  await click(`[data-surface-action="${name}"]`);
  await until(`(()=>{const host=document.querySelector('.app-studio-host[data-app-surface="${name}"]'),button=document.querySelector('[data-surface-action="${name}"]');return Boolean(host&&host.getBoundingClientRect().width>0&&button?.getAttribute('aria-pressed')==='true')})()`);
  if (name === "image-studio") await until('Boolean(document.querySelector(".image-studio__header"))');
  else if (name === "workstation") await until('Boolean(document.querySelector("[data-testid=creative-draft-form] input"))');
}
async function conversation() {
  await click('.surface-navigation button:first-child');
  await until('(()=>{const body=document.querySelector(".app-body"),input=body?.querySelector("[data-testid=chat-composer-input]");return Boolean(body&&!body.hidden&&input&&input.getBoundingClientRect().width>0)})()');
}
async function pickModel(ariaLabel, id, modelId) {
  await click(`.image-studio [aria-label="${ariaLabel}"]`);
  await until('Boolean(document.querySelector(".model-picker__panel"))');
  await until(`(()=>{const panel=document.querySelector('.model-picker__panel');if(!panel)return false;if(panel.querySelector('[data-model-config-id="${id}"]'))return true;const provider=[...panel.querySelectorAll('.model-picker__provider-toggle')].find(el=>el.querySelector('strong')?.textContent==='Studio local fixture');if(provider?.getAttribute('aria-expanded')==='false')provider.click();return false})()`);
  await click(`.model-picker__panel [data-model-config-id="${id}"]`);
  await until(`!document.querySelector(".model-picker__panel")&&document.querySelector('.image-studio [aria-label="${ariaLabel}"]')?.title.includes(${JSON.stringify(modelId)})`);
}
async function installDownloadCapture() {
  await renderer.evaluate(`(()=>{
    window.__studioDownloads=[];
    const blobs=new Map();
    const createObjectURL=URL.createObjectURL, revokeObjectURL=URL.revokeObjectURL;
    URL.createObjectURL=function(blob){const url=createObjectURL.call(this,blob);blobs.set(url,blob);return url};
    URL.revokeObjectURL=function(url){blobs.delete(url);return revokeObjectURL.call(this,url)};
    const original=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){
      if(!this.href.startsWith("blob:"))return original.call(this);
      const name=this.download, blob=blobs.get(this.href);
      if(!blob){window.__studioDownloads.push({name,error:"Missing captured download blob"});return}
      void new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);
      }).then(data=>window.__studioDownloads.push({name,data}),error=>window.__studioDownloads.push({name,error:String(error)}));
    };
    return true;
  })()`);
}
async function downloaded(index) {
  await until(`window.__studioDownloads?.length>${index}`);
  const item = await renderer.evaluate(`window.__studioDownloads[${index}]`);
  assert.ok(item.data && !item.error, JSON.stringify(item));
  return { name: item.name, dataUrl: item.data, bytes: Buffer.from(item.data.split(",")[1], "base64") };
}
async function measure(surface, name) {
  const result = await renderer.evaluate(`(()=>{
    const root=document.querySelector(${JSON.stringify(surface)}),box=root?.getBoundingClientRect();
    const controls=[...root.querySelectorAll(${JSON.stringify(surface.includes("creative") ? ".creative-workstation__header button" : ".image-studio__header button")})]
      .filter(el=>getComputedStyle(el).display!=="none"&&el.getBoundingClientRect().width>0)
      .map(el=>{const r=el.getBoundingClientRect();return{label:el.getAttribute("aria-label")||el.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom}});
    return {width:innerWidth,height:innerHeight,root:box&&{left:box.left,right:box.right,top:box.top,bottom:box.bottom},controls};
  })()`);
  assert.ok(result.root && result.root.right <= result.width + 1 && result.root.left >= -1, `${name}: root exceeds viewport`);
  for (const control of result.controls) assert.ok(control.left >= -1 && control.right <= result.width + 1, `${name}: control outside viewport ${JSON.stringify(control)}`);
  geometry.push({ name, ...result });
}
async function measureCaption(name) {
  const result = await renderer.evaluate(`(()=>{
    const root=document.querySelector(".desktop-caption"),bounds=root?.getBoundingClientRect();
    if(!root||!bounds)return null;
    const selector='button,a[href],input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="tab"],[tabindex]:not([tabindex="-1"]),[role="status"],.connection-state,.orbit-topbar-state';
    const visible=el=>{const style=getComputedStyle(el),box=el.getBoundingClientRect();return !el.closest('[hidden],[inert],[aria-hidden="true"]')&&style.display!=="none"&&style.visibility==="visible"&&box.width>0&&box.height>0};
    const nodes=[...root.querySelectorAll(selector)].filter(visible);
    const describe=el=>({tag:el.tagName.toLowerCase(),className:typeof el.className==="string"?el.className:"",testId:el.getAttribute("data-testid"),role:el.getAttribute("role"),label:el.getAttribute("aria-label")||el.getAttribute("title")||el.textContent.trim()});
    const controls=nodes.map(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);return{...describe(el),left:r.left,right:r.right,top:r.top,bottom:r.bottom,hit:hit?describe(hit):null,hitOk:Boolean(hit&&(el===hit||el.contains(hit)))}});
    const overlaps=[];
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      if(nodes[i].contains(nodes[j])||nodes[j].contains(nodes[i]))continue;
      const a=controls[i],b=controls[j];
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5)overlaps.push({first:a,second:b});
    }
    const count=selector=>[...root.querySelectorAll(selector)].filter(visible).length;
    return{width:innerWidth,height:innerHeight,root:{left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom},controls,overlaps,required:{warning:count('[data-testid="desktop-shortcut-warning"]'),update:count('.desktop-update-trigger'),surfaces:count('.surface-navigation > button'),modes:count('[data-testid="agent-mode-switcher"] button'),shellActions:count('.desktop-caption__actions > button'),topbarActions:count('.topbar-actions > button')}};
  })()`);
  assert.ok(result, `${name}: caption is missing`);
  geometry.push({ name: `${name}-caption`, ...result });
  assert.equal(result.required.warning, 1, `${name}: shortcut warning is missing`);
  assert.equal(result.required.update, 1, `${name}: available-update control is missing`);
  assert.equal(result.required.surfaces, 3, `${name}: workspace navigation is incomplete`);
  assert.equal(result.required.modes, 3, `${name}: agent-mode navigation is incomplete`);
  assert.equal(result.required.shellActions, 6, `${name}: desktop actions are incomplete`);
  assert.ok(result.required.topbarActions >= 3, `${name}: topbar actions are incomplete`);
  for (const control of result.controls) {
    assert.ok(control.left >= -1 && control.right <= result.width + 1 && control.top >= -1 && control.bottom <= result.height + 1, `${name}: caption item outside viewport ${JSON.stringify(control)}`);
    assert.ok(control.top >= result.root.top - 1 && control.bottom <= result.root.bottom + 1, `${name}: caption item outside caption ${JSON.stringify(control)}`);
    assert.ok(control.hitOk, `${name}: caption center is covered ${JSON.stringify(control)}`);
  }
  assert.deepEqual(result.overlaps, [], `${name}: caption items overlap ${JSON.stringify(result.overlaps)}`);
}
async function assertCreativeHit(selector, name, clipSelector = ".creative-editor__scroll") {
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error("Missing creative control");el.scrollIntoView({block:"nearest",inline:"nearest"});return true})()`);
  await sleep(50);
  const result = await renderer.evaluate(`(()=>{
    const el=document.querySelector(${JSON.stringify(selector)}),clip=document.querySelector(${JSON.stringify(clipSelector)});
    const box=el.getBoundingClientRect(),bounds=clip.getBoundingClientRect(),style=getComputedStyle(el);
    const hit=document.elementFromPoint((box.left+box.right)/2,(box.top+box.bottom)/2);
    const rect=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
    return{width:innerWidth,height:innerHeight,box:rect(box),bounds:rect(bounds),display:style.display,visibility:style.visibility,hitOk:Boolean(hit&&(hit===el||el.contains(hit))),hit:hit?.outerHTML.slice(0,180)};
  })()`);
  geometry.push({ name, ...result });
  const { box, bounds } = result;
  assert.ok(result.display !== "none" && result.visibility === "visible" && box.width > 0 && box.height > 0, `${name}: control is hidden`);
  assert.ok(box.left >= -1 && box.right <= result.width + 1 && box.top >= -1 && box.bottom <= result.height + 1, `${name}: control outside viewport ${JSON.stringify(result)}`);
  assert.ok(box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1, `${name}: control clipped by panel ${JSON.stringify(result)}`);
  assert.ok(result.hitOk, `${name}: control is covered ${JSON.stringify(result)}`);
  return box;
}
async function setCreativePanel(selector, expanded) {
  const current = await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed')`);
  assert.ok(current === "true" || current === "false", `Missing creative panel control ${selector}`);
  if ((current === "true") !== expanded) await pointerClick(selector);
  await until(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed')===${JSON.stringify(String(expanded))}`);
}
async function exerciseCreativeControls(name, width) {
  const library = '[data-testid=creative-library-toggle]', preview = '[data-testid=creative-preview-toggle]';
  const brief = '[data-testid=creative-mode-brief]', detailed = '[data-testid=creative-mode-detailed]';
  const promptSummary = '[data-testid=creative-prompt-preview] summary';
  const expandedEvidence = [
    "workstation-orbit-zh-CN-day-1440",
    "workstation-orbit-zh-CN-night-680",
    "workstation-simple-en-night-800",
  ].includes(name);
  await setCreativePanel(library, false); await setCreativePanel(preview, false);
  const first = await assertCreativeHit(brief, `${name}-brief`);
  const second = await assertCreativeHit(detailed, `${name}-detailed`);
  assert.ok(Math.min(first.right, second.right) - Math.max(first.left, second.left) <= 0.5 || Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) <= 0.5, `${name}: mode controls overlap`);
  const initiallyDetailed = await renderer.evaluate(`document.querySelector(${JSON.stringify(detailed)}).getAttribute('aria-pressed')==='true'`);
  const alternate = initiallyDetailed ? brief : detailed;
  await assertCreativeHit(alternate, `${name}-alternate`); await pointerClick(alternate);
  await until(`document.querySelector(${JSON.stringify(alternate)})?.getAttribute('aria-pressed')==='true'`);
  if (expandedEvidence) await capture(`${name}-brief`);
  const restore = initiallyDetailed ? detailed : brief;
  await assertCreativeHit(restore, `${name}-restore`); await pointerClick(restore);
  await until(`document.querySelector(${JSON.stringify(restore)})?.getAttribute('aria-pressed')==='true'`);
  await assertCreativeHit(promptSummary, `${name}-prompt-summary`); await pointerClick(promptSummary);
  await until('document.querySelector("[data-testid=creative-prompt-preview]")?.open===true');
  await assertCreativeHit('[data-testid=creative-prompt-preview] .creative-prompt__actions button', `${name}-copy`);
  if (expandedEvidence) {
    const textSelector = '[data-testid=creative-prompt-text]';
    const box = await assertCreativeHit(textSelector, `${name}-prompt-expanded`);
    const scrollBefore = await renderer.evaluate('(()=>{const el=document.querySelector("[data-testid=creative-prompt-text]");return{top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight}})()');
    assert.ok(scrollBefore.height > scrollBefore.client, `${name}: the full prompt should exercise scrolling`);
    await capture(`${name}-prompt-expanded-top`);
    await renderer.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2, deltaX: 0, deltaY: scrollBefore.height });
    await until('(()=>{const el=document.querySelector("[data-testid=creative-prompt-text]");return el.scrollTop>=el.scrollHeight-el.clientHeight-2})()');
    const scrollAfter = await renderer.evaluate('(()=>{const el=document.querySelector("[data-testid=creative-prompt-text]");return{top:el.scrollTop,height:el.scrollHeight,client:el.clientHeight,text:el.textContent}})()');
    assert.ok(scrollAfter.text.includes("builtin:artifact-quality"), `${name}: full prompt lost its recommended skills`);
    geometry.push({ name: `${name}-prompt-native-scroll`, before: scrollBefore, after: { ...scrollAfter, text: undefined } });
    await capture(`${name}-prompt-expanded-bottom`);
    await renderer.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2, deltaX: 0, deltaY: -scrollAfter.height });
    await until('document.querySelector("[data-testid=creative-prompt-text]").scrollTop<=1');
  }
  await assertCreativeHit(promptSummary, `${name}-prompt-summary-open`); await pointerClick(promptSummary);
  await setCreativePanel(library, true);
  await assertCreativeHit('[data-testid=creative-search]', `${name}-search`, ".creative-library");
  await assertCreativeHit('[data-testid=creative-category]', `${name}-category`, ".creative-library");
  await assertCreativeHit('[data-testid=creative-format-filter]', `${name}-format`, ".creative-library");
  if (expandedEvidence) await capture(`${name}-library-open`);
  await setCreativePanel(preview, true);
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(library)}).getAttribute('aria-pressed')`), String(width > 1080), `${name}: unexpected simultaneous drawer state`);
  await assertCreativeHit('.creative-preview .creative-panel__heading button', `${name}-preview-close`, ".creative-preview");
  if (expandedEvidence) await capture(`${name}-preview-open`);
  if (width <= 1080) await setCreativePanel(preview, false);
}
async function measureStudioControls(name, libraryOpen, inspectorOpen, overlay = false) {
  const result = await renderer.evaluate(`(()=>{
    const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.closest('[hidden]')&&s.display!=='none'&&s.visibility==='visible'&&r.width>0&&r.height>0};
    const describe=el=>{const r=rect(el),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);return{label:el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent.trim(),...r,hitOk:Boolean(hit&&(el===hit||el.contains(hit)))}};
    const toolbar=document.querySelector('.image-workspace__toolbar'),viewport=document.querySelector('.image-viewport');
    const library=document.querySelector('#image-studio-library'),inspector=document.querySelector('#image-studio-inspector');
    const controls=[...document.querySelectorAll('.image-workspace__tools > button,.image-workspace__tools > span')].filter(visible).map(describe);
    const header=[...document.querySelectorAll('.image-studio__header button')].filter(visible).map(describe);
    return{width:innerWidth,height:innerHeight,toolbar:rect(toolbar),viewport:rect(viewport),controls,header,
      library:{open:visible(library),expanded:document.querySelector('[data-testid=image-library-toggle]').getAttribute('aria-expanded'),box:visible(library)?rect(library):null},
      inspector:{open:visible(inspector),expanded:document.querySelector('[data-testid=image-inspector-toggle]').getAttribute('aria-expanded'),box:visible(inspector)?rect(inspector):null}};
  })()`);
  geometry.push({ name: `${name}-studio-controls`, ...result });
  assert.equal(result.library.open, libraryOpen, `${name}: unexpected library visibility`);
  assert.equal(result.library.expanded, String(libraryOpen), `${name}: library aria-expanded mismatch`);
  assert.equal(result.inspector.open, inspectorOpen, `${name}: unexpected inspector visibility`);
  assert.equal(result.inspector.expanded, String(inspectorOpen), `${name}: inspector aria-expanded mismatch`);
  assert.equal(result.controls.length, 7, `${name}: canvas controls are incomplete`);
  for (const item of [...result.controls, ...result.header]) {
    assert.ok(item.left >= -1 && item.right <= result.width + 1 && item.top >= -1 && item.bottom <= result.height + 1, `${name}: control outside viewport ${JSON.stringify(item)}`);
    assert.ok(item.hitOk, `${name}: covered control ${JSON.stringify(item)}`);
  }
  for (const group of [result.controls, result.header]) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j];
    assert.ok(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 0.5 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 0.5, `${name}: controls overlap ${JSON.stringify([a, b])}`);
  }
  for (const panel of [result.library.box, result.inspector.box].filter(Boolean)) {
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    assert.ok(!overlaps(panel, result.toolbar), `${name}: a panel covers the canvas toolbar`);
    if (!overlay) assert.ok(!overlaps(panel, result.viewport), `${name}: a panel covers the canvas viewport`);
  }
}
async function setStudioPanel(selector, expanded) {
  const current = await renderer.evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded')`);
  assert.ok(current === "true" || current === "false", `Missing panel control ${selector}`);
  if ((current === "true") !== expanded) await pointerClick(selector);
  await until(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded')===${JSON.stringify(String(expanded))}`);
}
async function assertFittedCanvas(name) {
  const frame = await renderer.evaluate(`(()=>{
    const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const viewport=document.querySelector('.image-viewport'),surface=document.querySelector('.image-canvas-surface'),image=surface?.querySelector('.image-canvas-layer img');
    const canvas=rect(surface),view=rect(viewport),imageBox=image&&rect(image),hit=document.elementFromPoint(canvas.left+3,canvas.top+3);
    return{canvas,viewport:view,image:imageBox,naturalWidth:image?.naturalWidth,naturalHeight:image?.naturalHeight,decoded:Boolean(image?.complete&&image.naturalWidth>0),surfaceHit:Boolean(hit&&(hit===surface||surface.contains(hit)))};
  })()`);
  geometry.push({ name: `${name}-fitted-canvas`, ...frame });
  const within = (inner, outer) => inner.left >= outer.left - 1 && inner.top >= outer.top - 1 && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
  assert.ok(frame.decoded && frame.image && frame.naturalWidth === 128 && frame.naturalHeight === 96, `${name}: fixture image is not decoded`);
  assert.ok(within(frame.canvas, frame.viewport), `${name}: explicit fit did not frame the fixture canvas ${JSON.stringify(frame)}`);
  assert.ok(within(frame.image, frame.canvas) && frame.surfaceHit, `${name}: fitted image is outside or canvas is covered ${JSON.stringify(frame)}`);
}
async function exerciseStudioControls(name, width) {
  const library = '[data-testid=image-library-toggle]', inspector = '[data-testid=image-inspector-toggle]';
  const fit = '.image-workspace__tools button[aria-label="适应画布"],.image-workspace__tools button[aria-label="Fit canvas"]';
  const zoom = '.image-workspace__tools button[aria-label="放大"],.image-workspace__tools button[aria-label="Zoom in"]';
  const initiallyOpen = width > 920;
  await measureStudioControls(`${name}-initial`, initiallyOpen, initiallyOpen);
  await setStudioPanel(library, false); await setStudioPanel(inspector, false);
  await measureStudioControls(`${name}-closed`, false, false);
  await setStudioPanel(library, true);
  await until('Boolean(document.querySelector("[data-testid=image-asset] img")?.complete)');
  await measureStudioControls(`${name}-library`, true, false);
  await setStudioPanel(inspector, true);
  await measureStudioControls(`${name}-both`, true, true);
  await setStudioPanel(library, false);
  await measureStudioControls(`${name}-inspector`, false, true);
  await setStudioPanel(inspector, false);
  await pointerClick(fit); await assertFittedCanvas(`${name}-closed`);
  const beforeZoom = await renderer.evaluate('document.querySelector(".image-canvas-surface").style.transform');
  await pointerClick(zoom);
  await until(`document.querySelector('.image-canvas-surface')?.style.transform!==${JSON.stringify(beforeZoom)}`);
  const beforePan = await renderer.evaluate('document.querySelector(".image-canvas-surface").style.transform');
  const point = await renderer.evaluate('(()=>{const r=document.querySelector(".image-viewport").getBoundingClientRect();return{x:r.left+8,y:r.top+8}})()');
  await renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 24, y: point.y + 16, button: "left", buttons: 1 });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 24, y: point.y + 16, button: "left", buttons: 0, clickCount: 1 });
  await until(`document.querySelector('.image-canvas-surface')?.style.transform!==${JSON.stringify(beforePan)}`);
  const downloadIndex = await renderer.evaluate('window.__studioDownloads.length');
  await pointerClick('[data-testid=image-export-png]');
  const png = await downloaded(downloadIndex);
  assert.match(png.name, /\.png$/i);
  assert.ok(png.bytes.length > 100 && png.dataUrl.startsWith('data:image/png;base64,'), `${name}: pointer PNG export failed`);
  await until('!document.querySelector("[data-testid=image-export-png]")?.disabled');
  await setStudioPanel(library, initiallyOpen); await setStudioPanel(inspector, initiallyOpen);
  await pointerClick(fit); await assertFittedCanvas(`${name}-restored`);
}
async function saveResult(success, cause) {
  await mkdir(evidence, { recursive: true });
  const resultPath = join(evidence, success ? "result.json" : "failure.json");
  await writeFile(resultPath, JSON.stringify({ success, passed, requests, exceptions, serviceErrors, screenshots, geometry,
    failure: cause ? String(cause.stack || cause) : null,
    boundaries: ["Owned temporary project and profile; only a local synthetic provider is permitted.", "Release metadata and shortcut registration status are isolated fixtures; no remote release, update download or installation is tested.", "Blob downloads are captured and decoded by the fixture; native OS download UI is not exercised.", "Viewport screenshots do not certify the full Windows DPI or accessibility matrix.", "No paid provider, real credential, normal user profile, installer, cloud write or repository commit."],
  }, null, 2));
  return resultPath;
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(otherProject, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await writeFile(join(project, "README.md"), "# Isolated creative fixture\n");
  await writeFile(join(otherProject, "README.md"), "# Isolated second workspace\n");
  const referenceFiles = referenceFileNames.map((name) => join(temporary, name));
  const imageFile = referenceFiles[0];
  const manualReferenceFile = join(temporary, "manual-reference.png");
  await Promise.all(referenceFiles.map((path, index) => writeFile(path, referencePngs[index])));
  await writeFile(manualReferenceFile, manualReferencePng);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
  const mainPort = await port(); let rendererPort = await port();
  while (rendererPort === mainPort) rendererPort = await port();
  const environment = { ...process.env, MSH_EXPERIMENTAL: "1", MSH_USER_DATA_DIR: profile, MSH_DISABLE_AUTO_DEPENDENCIES: "1", MSH_NOTIFICATION_FIXTURE: "1" };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(experimentalExecutable(), [`--inspect=${mainPort}`, ".", `--remote-debugging-port=${rendererPort}`], { cwd: resolve("apps/desktop"), env: environment, windowsHide: true, stdio: "ignore" });
  main = await connect(mainPort, "main");
  await main.evaluate(`(()=>{const original=fetch;globalThis.fetch=(url,options)=>{const target=String(typeof url==="string"?url:url.url);if(target.includes("/rest/v1/rpc/"))return Promise.resolve(Response.json([]));if(new URL(target).origin!==${JSON.stringify(fixtureOrigin)})throw new Error("Blocked non-fixture network request: "+target);return original(url,options)};return true})()`);
  renderer = await connect(rendererPort, "renderer"); await renderer.send("Runtime.enable");
  await until('Boolean(document.querySelector(".policy-consents"))');
  await main.evaluate(`(()=>{const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");globalThis.__studioUncapturedDownloads=0;electron.session.defaultSession.on("will-download",event=>{event.preventDefault();globalThis.__studioUncapturedDownloads++});return true})()`);
  await installReleaseFixture();
  await renderer.evaluate('document.querySelectorAll(".policy-consents input").forEach(el=>el.click());true');
  for (const label of ["同意并继续", "开始使用"]) await until(`(()=>{const el=[...document.querySelectorAll(".policy-dialog button")].find(el=>!el.disabled&&el.textContent.trim()===${JSON.stringify(label)});if(!el)return false;el.click();return true})()`);
  await until('!document.querySelector(".policy-dialog")');
  await until('(async()=>{const status=await window.mingshen.getUpdateStatus();return status?.state==="available"&&status.release?.version==="1.3.7"})()');
  await until('Boolean(document.querySelector("#update-title"))');
  await click('.close-dialog[aria-labelledby="update-title"] .close-dialog__actions button');
  await until('!document.querySelector("#update-title")');
  assert.ok((await main.evaluate('globalThis.__studioReleaseRequests.length')) > 0, "The local release fixture was not requested");
  await renderer.evaluate('(async()=>{for(const s of await window.mingshen.listMcpServers())if(s.enabled)await window.mingshen.setMcpServerEnabled(s.id,false);await window.mingshen.setModelRetrySettings({maxRetries:0});await window.mingshen.configureCompletionNotifications({nativeEnabled:false,taskbarEnabled:false,showPreview:false,sound:false});localStorage.setItem("mingshen.theme","day");return true})()');
  provider = await api("createProvider", { name: "Studio local fixture", protocol: "openai_responses", baseUrl: `${fixtureOrigin}/v1`, authMode: "bearer", apiKey: "synthetic-local-fixture", keyLabel: "Fixture", neverReveal: true });
  let catalog = await api("createModel", { providerId: provider.id, modelId: "studio-text", displayName: "Studio vision fixture", contextWindow: 200_000, maxOutputTokens: 4096, inputModalities: ["text", "image"], outputModalities: ["text"], toolCalls: true, parallelToolCalls: false, reasoningLevels: [], anthropicNoneBehavior: "disabled" });
  textModel = catalog.models.find((item) => item.modelId === "studio-text");
  catalog = await api("createModel", { providerId: provider.id, modelId: "studio-image", displayName: "Studio image fixture", contextWindow: 1, maxOutputTokens: 1, inputModalities: ["text"], outputModalities: ["image"], toolCalls: false, parallelToolCalls: false, reasoningLevels: [], anthropicNoneBehavior: "disabled" });
  imageModel = catalog.models.find((item) => item.modelId === "studio-image");
  assert.ok(textModel && imageModel);
  await api("setProjectTrust", project, true); await api("setProjectTrust", otherProject, true);
  session = await api("createSession", { title: "Creative fixture A", workspacePath: project, providerId: provider.id, modelId: textModel.id, reasoningLevel: null, permissionMode: "full_access", executionMode: "host", agentMode: "work" });
  secondSession = await api("createSession", { title: "Creative fixture B", workspacePath: otherProject, providerId: provider.id, modelId: textModel.id, reasoningLevel: null, permissionMode: "full_access", executionMode: "host", agentMode: "work" });
  await renderer.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await reload();
  await selectSession(session); await openSurface("workstation");

  assert.match(await renderer.evaluate('document.querySelector("[data-testid=creative-category] option[value=all]").textContent'), /\(780\)/);
  await selectOption("[data-testid=creative-category]", "learning");
  await selectOption("[data-testid=creative-format-filter]", "DOCX");
  await fill("[data-testid=creative-search]", "单课教案 builtin:work-word");
  await until('document.querySelectorAll("[data-testid=creative-template-item]").length===12');
  assert.ok((await renderer.evaluate('[...document.querySelectorAll("[data-testid=creative-template-item]")].every(el=>el.textContent.includes("单课教案"))')));
  assert.doesNotMatch(await renderer.evaluate('document.querySelector("[data-testid=creative-template-list]").textContent'), /投资人|入门教学/);
  await fill("[data-testid=creative-search]", "单课教案 fixture-no-such-skill");
  await until('document.querySelectorAll("[data-testid=creative-template-item]").length===0&&document.querySelector(".creative-library__empty")?.textContent.includes("没有匹配")');
  await fill("[data-testid=creative-search]", "");
  await selectOption("[data-testid=creative-category]", "all");
  await selectOption("[data-testid=creative-format-filter]", "all");
  let pageClicks = 0;
  const lateTemplate = '[data-testid=creative-template-item][data-template-id="expense-reimbursement--executive"]';
  while (!(await renderer.evaluate(`Boolean(document.querySelector(${JSON.stringify(lateTemplate)}))`))) {
    assert.ok(pageClicks < 11, "The late template was not found in the 780-item paginated catalog");
    const previousCount = await renderer.evaluate('document.querySelectorAll("[data-testid=creative-template-item]").length');
    await click(".creative-library__more");
    await until(`document.querySelectorAll("[data-testid=creative-template-item]").length>${previousCount}`);
    pageClicks++;
  }
  assert.ok(pageClicks > 0, "The pagination fixture must select a template beyond the first page");
  await click(lateTemplate);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click('[role=alertdialog] .btn--primary');
  await until(`document.querySelector(${JSON.stringify(lateTemplate)})?.getAttribute("aria-pressed")==="true"`);
  await until('document.querySelector("[data-testid=creative-mode-detailed]")?.getAttribute("aria-pressed")==="true"');
  assert.match(await renderer.evaluate('document.querySelector("[data-testid=creative-recommended-skills]").textContent'), /builtin:work-spreadsheets/);
  const skillDetails = await renderer.evaluate(`(()=>[...document.querySelectorAll('[data-testid=creative-recommended-skills] li')].map(item=>({id:item.querySelector('code')?.textContent,name:item.querySelector('strong')?.textContent,reason:item.querySelector('p')?.textContent})))()`);
  assert.ok(skillDetails.some((skill) => skill.id === "builtin:work-spreadsheets" && skill.name && skill.reason?.trim().length > 4), JSON.stringify(skillDetails));
  assert.ok((await renderer.evaluate('document.querySelector("[data-testid=creative-description]")?.textContent.trim().length')) > 20);
  passed.push("The exact 780-entry catalog supports multi-keyword, skill, category and format filtering, an empty result, and selecting a late-page reimbursement template with real skill IDs and reasons.");

  const subject = '[data-testid=creative-draft-form] .creative-field-grid label:nth-child(2) input';
  const title = '[data-testid=creative-draft-form] .creative-field-grid label:nth-child(1) input';
  const sectionTitle = '[data-testid=creative-sections] .creative-section:first-child input';
  const sectionNotes = '[data-testid=creative-sections] .creative-section:first-child textarea';
  const storageKey = `mingshen.creative-workspace-draft.v1:${project.trim().replaceAll("\\", "/").toLocaleLowerCase()}`;
  const editedFields = [
    [title, "Mode fixture title"],
    [subject, "Mode fixture subject"],
    ['[data-testid=creative-draft-form] .creative-field-grid label:nth-child(3) input', "Mode fixture audience"],
    ['[data-testid=creative-draft-form] .creative-field-grid label:nth-child(4) input', "XLSX"],
    ['[data-testid=creative-draft-form] .creative-field-grid label:nth-child(5) textarea', "Mode fixture purpose"],
    ['[data-testid=creative-draft-form] .creative-field-grid label:nth-child(6) textarea', "Mode fixture source"],
    ['[data-testid=creative-draft-form] .creative-field-grid label:nth-child(7) input', "Mode fixture style"],
    ['[data-testid=creative-draft-form] .creative-field-grid label:nth-child(8) input', "Mode fixture constraints"],
    [sectionTitle, "Mode fixture section"],
    [sectionNotes, "Mode fixture section notes"],
  ];
  for (const [selector, value] of editedFields) await fill(selector, value);
  const deliverable = '[data-testid=creative-draft-form] .creative-field-grid label:nth-child(4) input';
  await fill(deliverable, "DOCX");
  await until('document.querySelector("[data-testid=creative-recommended-skills]")?.textContent.includes("builtin:work-word")');
  assert.match(await renderer.evaluate('document.querySelector("[data-testid=creative-format-status]").textContent'), /XLSX.*适配/);
  assert.match(await renderer.evaluate('document.querySelector("[data-testid=creative-prompt-text]").textContent'), /builtin:work-word/);
  await fill(deliverable, "unknown-fixture-format");
  await until('document.querySelector("[data-testid=creative-format-status]")?.textContent.includes("未识别")');
  assert.doesNotMatch(await renderer.evaluate('document.querySelector("[data-testid=creative-recommended-skills]").textContent'), /builtin:work-spreadsheets/);
  await fill(deliverable, ".xlsx");
  await until('!document.querySelector("[data-testid=creative-format-status]")&&document.querySelector("[data-testid=creative-recommended-skills]")?.textContent.includes("builtin:work-spreadsheets")');
  await fill(deliverable, "Excel");
  await until('!document.querySelector("[data-testid=creative-format-status]")&&document.querySelector("[data-testid=creative-recommended-skills]")?.textContent.includes("builtin:work-spreadsheets")');
  await fill(deliverable, "XLSX");
  await until('document.querySelector("[data-testid=creative-recommended-skills]")?.textContent.includes("builtin:work-spreadsheets")');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector("[data-testid=creative-format-status]"))'), false);
  const beforeModeChange = await creativeFields();
  await click("[data-testid=creative-mode-brief]");
  await until('document.querySelector("[data-testid=creative-mode-brief]")?.getAttribute("aria-pressed")==="true"');
  assert.deepEqual(await creativeFields(), beforeModeChange);
  await click('.creative-workstation__actions button[title="撤销"]');
  await until('document.querySelector("[data-testid=creative-mode-detailed]")?.getAttribute("aria-pressed")==="true"');
  assert.deepEqual(await creativeFields(), beforeModeChange);
  await click('.creative-workstation__actions button[title="重做"]');
  await until('document.querySelector("[data-testid=creative-mode-brief]")?.getAttribute("aria-pressed")==="true"');
  assert.deepEqual(await creativeFields(), beforeModeChange);
  await click("[data-testid=creative-mode-detailed]");
  await until(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})||"null")?.promptMode==="detailed"`);
  await reload(); await selectSession(session); await openSurface("workstation");
  await until('document.querySelector("[data-testid=creative-mode-detailed]")?.getAttribute("aria-pressed")==="true"');
  assert.deepEqual(await creativeFields(), beforeModeChange);
  const legacyDraft = JSON.parse(await renderer.evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`));
  delete legacyDraft.promptMode;
  const legacyDraftFile = join(temporary, "legacy-mode-draft.json");
  await writeFile(legacyDraftFile, JSON.stringify(legacyDraft));
  await setFiles('.creative-file-input', [legacyDraftFile]);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click('[role=alertdialog] .btn--primary');
  await until('document.querySelector("[data-testid=creative-mode-brief]")?.getAttribute("aria-pressed")==="true"');
  assert.deepEqual(await creativeFields(), beforeModeChange);
  await until(`(()=>{const draft=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})||"null");return Boolean(draft&&draft.title==="Mode fixture title"&&!Object.hasOwn(draft,"promptMode"))})()`);
  await reload(); await selectSession(session); await openSurface("workstation");
  await until('document.querySelector("[data-testid=creative-mode-brief]")?.getAttribute("aria-pressed")==="true"');
  assert.deepEqual(await creativeFields(), beforeModeChange);
  await click("[data-testid=creative-mode-detailed]");
  await until(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})||"null")?.promptMode==="detailed"`);
  passed.push("Changing the template mode, undo/redo and detailed-mode reload preserve every edited field and section note; imported legacy drafts remain brief after reload.");
  await renderer.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(subject)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"Immediate fixture edit A");el.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector('[data-surface-action="image-studio"]').click();return true})()`);
  await until('Boolean(document.querySelector(".app-studio-host[data-app-surface=image-studio] .image-studio__header"))');
  await openSurface("workstation");
  await until(`document.querySelector(${JSON.stringify(subject)})?.value==="Immediate fixture edit A"`);
  await conversation(); await selectSession(secondSession); await openSurface("workstation");
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(subject)}).value`), "");
  await conversation(); await selectSession(session); await openSurface("workstation");
  await until(`document.querySelector(${JSON.stringify(subject)})?.value==="Immediate fixture edit A"`);
  await reload();
  await selectSession(session); await openSurface("workstation");
  await until(`document.querySelector(${JSON.stringify(subject)})?.value==="Immediate fixture edit A"`);
  passed.push("The last keystroke survives immediate surface unmount and reload, while an empty second workspace does not inherit it.");

  const originalSectionTitle = await renderer.evaluate(`document.querySelector(${JSON.stringify(sectionTitle)}).value`);
  await fill(sectionTitle, "");
  await conversation(); await openSurface("workstation");
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(sectionTitle)}).value`), "");
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(subject)}).value`), "Immediate fixture edit A");
  assert.equal(await renderer.evaluate('Boolean(document.querySelector("[data-testid=creative-storage-blocked]"))'), false);
  await fill(sectionTitle, originalSectionTitle);
  passed.push("A temporarily empty section title and the rest of the draft survive an immediate surface change.");

  await renderer.evaluate(`(()=>{window.__studioOriginalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===${JSON.stringify(storageKey)})throw new Error("fixture write failure");return window.__studioOriginalSetItem.call(this,key,value)};return true})()`);
  await fill(subject, "Unsaved write-failure fixture");
  await until('Boolean(document.querySelector("[data-testid=creative-save-retry]"))');
  await until('document.querySelector(".creative-workstation__error")?.textContent.includes("fixture write failure")');
  await conversation(); await openSurface("workstation");
  await until(`document.querySelector(${JSON.stringify(subject)})?.value==="Unsaved write-failure fixture"`);
  assert.match(await renderer.evaluate('document.querySelector(".creative-workstation__error").textContent'), /未保存|本次运行/);
  await renderer.evaluate('Storage.prototype.setItem=window.__studioOriginalSetItem;delete window.__studioOriginalSetItem;true');
  await click("[data-testid=creative-save-retry]");
  await until(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})||"null")?.subject==="Unsaved write-failure fixture"`);
  await until('!document.querySelector("[data-testid=creative-save-retry]")');
  await fill(subject, "Immediate fixture edit A");
  passed.push("A failed local-storage write survives surface unmount in the running renderer, shows an unsaved warning and persists on explicit retry.");

  await fill("[data-testid=creative-search]", "单课教案");
  await click("[data-testid=creative-template-item]:nth-child(3)");
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click('[role=alertdialog] .btn--secondary');
  await until('!document.querySelector("[role=alertdialog]")');
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(subject)}).value`), "Immediate fixture edit A");
  await click("[data-testid=creative-template-item]:nth-child(3)");
  await click('[role=alertdialog] .btn--primary');
  await until(`document.querySelector(${JSON.stringify(subject)})?.value===""`);
  await click('.creative-workstation__actions button[title="撤销"]');
  await until(`document.querySelector(${JSON.stringify(subject)})?.value==="Immediate fixture edit A"`);

  await installDownloadCapture(); await click("[data-testid=creative-export]");
  const exportedDraft = await downloaded(0);
  const importedDraft = JSON.parse(exportedDraft.bytes.toString("utf8"));
  importedDraft.title = "Imported fixture draft";
  const draftFile = join(temporary, "draft.json");
  await writeFile(draftFile, JSON.stringify(importedDraft));
  const titleBeforeImport = await renderer.evaluate(`document.querySelector(${JSON.stringify(title)}).value`);
  await setFiles('.creative-file-input', [draftFile]);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click('[role=alertdialog] .btn--secondary');
  await until('!document.querySelector("[role=alertdialog]")');
  assert.equal(await renderer.evaluate(`document.querySelector(${JSON.stringify(title)}).value`), titleBeforeImport);
  await setFiles('.creative-file-input', [draftFile]);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click('[role=alertdialog] .btn--primary');
  await until(`document.querySelector(${JSON.stringify(title)})?.value==="Imported fixture draft"`);
  await click('.creative-workstation__actions button[title="撤销"]');
  await until(`document.querySelector(${JSON.stringify(title)})?.value===${JSON.stringify(titleBeforeImport)}`);
  await click('.creative-workstation__actions button[title="重做"]');
  await until(`document.querySelector(${JSON.stringify(title)})?.value==="Imported fixture draft"`);
  passed.push("Template replacement and validated JSON import require confirmation; cancel preserves the draft and replacement remains undoable.");

  await conversation();
  const validRaw = await renderer.evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`);
  assert.ok(validRaw);
  await renderer.evaluate(`localStorage.setItem(${JSON.stringify(storageKey)},"{broken");true`);
  await openSurface("workstation"); await until('Boolean(document.querySelector("[data-testid=creative-storage-blocked]"))');
  await fill(subject, "Unsaved damaged-store edit"); await sleep(350); await conversation();
  assert.equal(await renderer.evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`), "{broken");
  await renderer.evaluate(`localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(validRaw)});true`);
  await renderer.evaluate(`(()=>{window.__studioOriginalGetItem=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key===${JSON.stringify(storageKey)})throw new Error("fixture read failure");return window.__studioOriginalGetItem.call(this,key)};return true})()`);
  await openSurface("workstation"); await until('Boolean(document.querySelector("[data-testid=creative-storage-blocked]"))');
  await fill(subject, "Unsaved unreadable-store edit"); await sleep(350); await conversation();
  await renderer.evaluate('Storage.prototype.getItem=window.__studioOriginalGetItem;delete window.__studioOriginalGetItem;true');
  assert.equal(await renderer.evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`), validRaw);
  passed.push("Malformed or unreadable local storage pauses autosave and the original raw value survives editing and unmount.");

  await fill("[data-testid=chat-composer-input]", "Existing composer text.");
  await click("[data-testid=capability-picker-trigger]");
  await fill("[data-testid=capability-picker-search]", "pdf");
  const latestViewer = '[data-testid=builtin-capability-item][data-capability-id="builtin:work-source-pdf-0-2-3-pdf-viewer-7552e6cc"]';
  await until(`Boolean(document.querySelector(${JSON.stringify(latestViewer)}))`);
  const pdfIds = await renderer.evaluate(`(()=>[...document.querySelectorAll('[data-testid=capability-group-builtin-skill] [data-testid=builtin-capability-item]')].map(item=>item.dataset.capabilityId))()`);
  for (const expected of [
    "builtin:work-source-pdf-0-2-3-pdf-viewer-7552e6cc",
    "builtin:work-source-pdf-0-2-3-pdf-0016a97a",
    "builtin:work-source-pdf-reading-loose-pdf-reading-e2081f07",
    "builtin:work-source-pdf-loose-pdf-d1c7caf5",
    "builtin:work-pdf",
  ]) assert.equal(pdfIds.filter((id) => id === expected).length, 1, `Missing distinct PDF skill: ${expected}`);
  for (const old of ["builtin:work-source-pdf-0-2-1-pdf-viewer-430308a5", "builtin:work-source-pdf-0-2-2-pdf-viewer-7552e6cc", "builtin:work-source-pdf-0-2-2-pdf-0016a97a"]) {
    assert.ok(!pdfIds.includes(old), `An older version is still offered: ${old}`);
  }
  await click(latestViewer);
  await until(`document.querySelector(${JSON.stringify(latestViewer)})?.getAttribute("aria-pressed")==="true"&&Boolean(document.querySelector('[data-testid=capability-chip][data-capability-id="builtin:work-source-pdf-0-2-3-pdf-viewer-7552e6cc"]'))`);
  await click(latestViewer);
  await until(`document.querySelector(${JSON.stringify(latestViewer)})?.getAttribute("aria-pressed")==="false"&&!document.querySelector('[data-testid=capability-chip][data-capability-id="builtin:work-source-pdf-0-2-3-pdf-viewer-7552e6cc"]')`);
  passed.push("The WorkAgent capability picker offers only the latest same-source PDF versions, retains distinct PDF variants, and can manually select and remove the viewer skill.");
  await setFiles('[data-testid=capability-picker-panel] input[type=file]', [imageFile]);
  await until('document.querySelectorAll(".draft-attachment").length===1');
  const beforeMessages = await api("getSessionMessages", session.id);
  await until(`(async()=>(await window.mingshen.getComposerDraft(${JSON.stringify(session.id)}))?.attachments.length===1)()`);
  const savedComposer = await api("getComposerDraft", session.id);
  await api("saveComposerDraft", { sessionId: session.id, baseRevision: savedComposer.revision, revision: `fixture-conflict-${Date.now()}`, text: savedComposer.text, formatted: savedComposer.formatted, attachmentIds: savedComposer.attachments.map((attachment) => attachment.id), notificationDraftIds: savedComposer.notificationDraftIds });
  await openSurface("workstation");
  await click("[data-testid=creative-prompt-preview] summary");
  const previewPrompt = await renderer.evaluate('document.querySelector("[data-testid=creative-prompt-text]").textContent');
  const hanCount = (previewPrompt.match(/\p{Script=Han}/gu) ?? []).length;
  assert.ok(hanCount >= 800, `Detailed prompt contains only ${hanCount} Chinese characters`);
  const promptSkills = await renderer.evaluate(`(()=>[...document.querySelectorAll('[data-testid=creative-recommended-skills] li')].map(item=>({id:item.querySelector('code')?.textContent,reason:item.querySelector('p')?.textContent})))()`);
  assert.ok(promptSkills.length > 0);
  for (const skill of promptSkills) {
    assert.ok(skill.id && skill.reason?.trim() && previewPrompt.includes(skill.id) && previewPrompt.includes(skill.reason), `Prompt does not include the displayed skill and reason: ${JSON.stringify(skill)}`);
  }
  await installClipboardCapture();
  await click('[data-testid=creative-prompt-preview] button[aria-label="复制完整提示词"]');
  await until('typeof window.__creativeClipboardText==="string"');
  assert.equal(await renderer.evaluate('window.__creativeClipboardText'), previewPrompt);
  await click("[data-testid=creative-submit]");
  await until('Boolean(document.querySelector("[data-app-surface=workstation] .creative-workstation__error"))');
  assert.match(await renderer.evaluate('document.querySelector("[data-app-surface=workstation] .creative-workstation__error").textContent'), /无法交给 WorkAgent/);
  assert.equal(await renderer.evaluate('document.querySelector(".app-body")?.hidden'), true);
  assert.deepEqual(await api("getSessionMessages", session.id), beforeMessages);
  await conversation(); await until('Boolean(document.querySelector(".composer-error--draft-conflict > button"))');
  await click('.composer-error--draft-conflict > button:first-of-type');
  await until('!document.querySelector(".composer-error--draft-conflict")');
  await openSurface("workstation");
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=creative-prompt-text]").textContent'), previewPrompt);
  await click("[data-testid=creative-submit]");
  await until('!document.querySelector(".app-body")?.hidden&&document.querySelector("[data-testid=chat-composer-input]")?.value.includes("Existing composer text.")&&document.querySelector("[data-testid=chat-composer-input]").value.includes("【工作请求】")');
  await until(`(async()=>{const draft=await window.mingshen.getComposerDraft(${JSON.stringify(session.id)});return Boolean(draft&&draft.text.includes("Existing composer text.")&&draft.text.split("【工作请求】").length===2&&draft.attachments.length===1)})()`);
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]").value.split("【工作请求】").length-1'), 1);
  assert.ok((await renderer.evaluate('document.querySelector("[data-testid=chat-composer-input]").value')).endsWith(previewPrompt), "The handoff differs from the preview and clipboard fixture");
  assert.equal(await renderer.evaluate('document.querySelectorAll(".draft-attachment").length'), 1);
  assert.match(await renderer.evaluate('document.querySelector(".draft-attachment").textContent'), /reference-a\.png/);
  assert.deepEqual(await api("getSessionMessages", session.id), beforeMessages);
  await renderer.evaluate('window.__restoreCreativeClipboard();delete window.__restoreCreativeClipboard;true');
  passed.push("The detailed prompt contains at least 800 Chinese characters and its real skills and reasons; preview, isolated clipboard capture and successful handoff are identical, with no system clipboard access.");
  passed.push("A WorkAgent handoff conflict stays visible on the creative surface; after explicit resolution, retry appends only once, retains the attachment and sends no message.");

  const sharedProfile = await api("saveAgentProfile", {
    name: "Creative handoff shared fixture",
    description: "Enabled Code and Work profile for creative handoff verification.",
    role: "primary",
    instructions: "CREATIVE_HANDOFF_SHARED_FIXTURE",
    modelId: null,
    readOnly: false,
    enabled: true,
    hidden: false,
    permissions: { read: "deny", edit: "deny", bash: "ask", websearch: "deny" },
    toolAllowlist: [],
    applicableModes: ["code", "work"],
  });
  const codeOnlyProfile = await api("saveAgentProfile", {
    name: "Creative handoff code-only fixture",
    description: "Enabled Code-only profile must not be silently replaced during handoff.",
    role: "primary",
    instructions: "CREATIVE_HANDOFF_CODE_ONLY_FIXTURE",
    modelId: null,
    readOnly: false,
    enabled: true,
    hidden: false,
    permissions: { read: "ask", edit: "deny", bash: "deny", webfetch: "deny" },
    toolAllowlist: [],
    applicableModes: ["code"],
  });
  const sharedProfileSession = await api("createSession", {
    title: "Creative shared profile handoff",
    workspacePath: project,
    providerId: provider.id,
    modelId: textModel.id,
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    agentMode: "code",
    agentProfileId: sharedProfile.id,
  });
  const codeOnlyProfileSession = await api("createSession", {
    title: "Creative code-only profile handoff",
    workspacePath: project,
    providerId: provider.id,
    modelId: textModel.id,
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    agentMode: "code",
    agentProfileId: codeOnlyProfile.id,
  });
  await reload();
  await selectSession(sharedProfileSession, "code");
  await fill("[data-testid=chat-composer-input]", "Existing shared-profile draft.");
  await until(`(async()=>{const draft=await window.mingshen.getComposerDraft(${JSON.stringify(sharedProfileSession.id)});return draft?.text==="Existing shared-profile draft."})()`);
  await conversation();
  const sharedHistoryBefore = await api("getSessionMessages", sharedProfileSession.id);
  await openSurface("workstation");
  const sharedPrompt = await renderer.evaluate('document.querySelector("[data-testid=creative-prompt-text]").textContent');
  await click("[data-testid=creative-submit]");
  await until(`(async()=>{const value=await window.mingshen.getSession(${JSON.stringify(sharedProfileSession.id)});return value?.agentMode==="work"&&value?.agentProfileId===${JSON.stringify(sharedProfile.id)}})()`);
  const sharedProfileSessionAfter = await api("getSession", sharedProfileSession.id);
  assert.equal(sharedProfileSessionAfter.agentMode, "work");
  assert.equal(sharedProfileSessionAfter.agentProfileId, sharedProfile.id);
  assert.equal(sharedProfileSessionAfter.permissionMode, "full_access");
  assert.equal(sharedProfileSessionAfter.status, "idle");
  const profilesAfterHandoff = await api("listAgentProfiles");
  assert.deepEqual(profilesAfterHandoff.find((item) => item.id === sharedProfile.id)?.permissions, sharedProfile.permissions);
  assert.deepEqual(profilesAfterHandoff.find((item) => item.id === sharedProfile.id)?.applicableModes, ["code", "work"]);
  const sharedDraftAfter = await api("getComposerDraft", sharedProfileSession.id);
  assert.equal(sharedDraftAfter.text.split("【工作请求】").length - 1, 1);
  assert.ok(sharedDraftAfter.text.startsWith("Existing shared-profile draft."));
  assert.ok(sharedDraftAfter.text.endsWith(sharedPrompt));
  assert.deepEqual(await api("getSessionMessages", sharedProfileSession.id), sharedHistoryBefore);

  await conversation();
  await selectSession(codeOnlyProfileSession, "code");
  await fill("[data-testid=chat-composer-input]", "Existing code-only draft must remain unchanged.");
  await until(`(async()=>{const draft=await window.mingshen.getComposerDraft(${JSON.stringify(codeOnlyProfileSession.id)});return draft?.text==="Existing code-only draft must remain unchanged."})()`);
  await conversation();
  const codeOnlySessionBefore = await api("getSession", codeOnlyProfileSession.id);
  const codeOnlyDraftBefore = await api("getComposerDraft", codeOnlyProfileSession.id);
  const codeOnlyHistoryBefore = await api("getSessionMessages", codeOnlyProfileSession.id);
  await openSurface("workstation");
  await click("[data-testid=creative-submit]");
  await until('Boolean(document.querySelector("[data-app-surface=workstation] .creative-workstation__error"))');
  assert.match(await renderer.evaluate('document.querySelector("[data-app-surface=workstation] .creative-workstation__error").textContent'), /不适用于 WorkAgent/);
  const codeOnlySessionAfter = await api("getSession", codeOnlyProfileSession.id);
  assert.equal(codeOnlySessionAfter.agentMode, codeOnlySessionBefore.agentMode);
  assert.equal(codeOnlySessionAfter.agentProfileId, codeOnlyProfile.id);
  assert.equal(codeOnlySessionAfter.permissionMode, codeOnlySessionBefore.permissionMode);
  assert.equal(codeOnlySessionAfter.status, "idle");
  assert.deepEqual(await api("getComposerDraft", codeOnlyProfileSession.id), codeOnlyDraftBefore);
  assert.deepEqual(await api("getSessionMessages", codeOnlyProfileSession.id), codeOnlyHistoryBefore);
  const profilesAfterReject = await api("listAgentProfiles");
  assert.deepEqual(profilesAfterReject.find((item) => item.id === codeOnlyProfile.id)?.permissions, codeOnlyProfile.permissions);
  assert.deepEqual(profilesAfterReject.find((item) => item.id === codeOnlyProfile.id)?.applicableModes, ["code"]);
  passed.push("Creative handoff preserves a Code/Work profile and its denied permissions while appending only an unsent draft; a Code-only profile is rejected without changing mode, profile, composer draft or history.");

  await openSurface("image-studio"); await until('Boolean(document.querySelector("[data-testid=image-studio]"))');
  await pickModel("图片生成模型", imageModel.id, imageModel.modelId); await pickModel("语言模型", textModel.id, textModel.modelId);
  await click("[data-testid=image-canvas-new]");
  await until('Boolean(document.querySelector(".image-canvas-surface"))');
  await fill("[data-testid=image-prompt]", "Original fixture: a vessel on a stage.");
  await click("[data-testid=image-polish]");
  await until('Boolean(document.querySelector("[data-testid=image-prompt-preview]"))');
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=image-prompt]").value'), "Original fixture: a vessel on a stage.");
  await click("[data-testid=image-prompt-discard]");
  await until('!document.querySelector("[data-testid=image-prompt-preview]")');
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=image-prompt]").value'), "Original fixture: a vessel on a stage.");
  await click("[data-testid=image-polish]"); await until('Boolean(document.querySelector("[data-testid=image-prompt-preview]"))');
  await click("[data-testid=image-prompt-apply]");
  await until(`document.querySelector("[data-testid=image-prompt]")?.value===${JSON.stringify(polishedText)}`);
  await click("[data-testid=image-generate]");
  await until('(()=>{const image=document.querySelector(".image-canvas-layer img");return document.querySelectorAll("[data-testid=image-asset]").length===1&&image?.complete&&image.naturalWidth>0})()', 60_000);
  await until('Boolean(document.querySelector("[data-testid=image-generation-warning]"))');
  assert.match(await renderer.evaluate('document.querySelector("[data-testid=image-generation-warning]").textContent'), /供应商返回 128×96/);
  await click('[data-testid="image-generation-warning"] button[aria-label="关闭警告"]');
  await until('!document.querySelector("[data-testid=image-generation-warning]")');
  await click('[data-testid="image-inspector-toggle"]');
  await until('document.querySelector("#image-studio-inspector")?.hidden===false');
  await until('Boolean(document.querySelector("[data-testid=image-polish]:not(:disabled)"))');
  assert.ok(requests.some((request) => request.kind === "image"));
  assert.ok(requests.filter((request) => request.kind === "polish").length >= 2);
  passed.push("Polish returns a tool-free preview that can be discarded or explicitly applied; a valid provider image saves and displays at its returned dimensions with a visible mismatch warning.");

  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();const asset=workspace.assets.find(item=>item.source==="generated");return Boolean(asset&&asset.prompt===${JSON.stringify(polishedText)}&&asset.negativePrompt===""&&asset.revisedPrompt==="Generated local fixture"&&asset.promptOrigin==="mingshen_generated"&&asset.promptMetadataVersion===1)})()`);
  const promptWorkspace = await api("getImageStudioWorkspace");
  const generatedPromptAsset = promptWorkspace.assets.find((asset) => asset.source === "generated");
  assert.ok(generatedPromptAsset, "The generated fixture must retain its original prompt metadata");
  assert.equal(generatedPromptAsset.prompt, polishedText);
  assert.equal(generatedPromptAsset.negativePrompt, "");
  assert.equal(generatedPromptAsset.revisedPrompt, "Generated local fixture");
  const generatedPromptButton = `[data-testid=image-asset][data-asset-id="${generatedPromptAsset.id}"] [data-testid=image-asset-import-prompt]`;
  await until(`document.querySelector(${JSON.stringify(`[data-testid=image-asset][data-asset-id="${generatedPromptAsset.id}"] [data-testid=image-asset-prompt-state]`)})?.textContent.includes("负向")`);
  await fill("[data-testid=image-prompt]", "Workspace prompt before prompt restore");
  await fill("[data-testid=image-negative-prompt]", "Workspace negative before prompt restore");
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt==="Workspace prompt before prompt restore"&&workspace.negativePrompt==="Workspace negative before prompt restore"})()`);

  await click(generatedPromptButton);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  assert.match(await renderer.evaluate('document.querySelector("#mingshen-dialog-description").textContent'), /负面提示词|清空/);
  await click("[role=alertdialog] .mingshen-dialog__actions button.btn--secondary");
  await until('!document.querySelector("[role=alertdialog]")');
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=image-prompt]").value'), "Workspace prompt before prompt restore");
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=image-negative-prompt]").value'), "Workspace negative before prompt restore");

  await click(generatedPromptButton);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click("[role=alertdialog] .mingshen-dialog__actions button.btn--primary");
  await until(`document.querySelector("[data-testid=image-prompt]")?.value===${JSON.stringify(polishedText)}&&document.querySelector("[data-testid=image-negative-prompt]")?.value===""`);
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt===${JSON.stringify(polishedText)}&&workspace.negativePrompt===""})()`);
  assert.match(await renderer.evaluate(`document.querySelector(${JSON.stringify(`[data-testid=image-asset][data-asset-id="${generatedPromptAsset.id}"] .image-asset__prompt-state`)})?.textContent ?? ""`), /正向与负向|positive and negative/i);
  await click(generatedPromptButton);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click("[role=alertdialog] .mingshen-dialog__actions button.btn--secondary");
  await until('!document.querySelector("[role=alertdialog]")');

  await api("saveImageStudioWorkspace", {
    ...promptWorkspace,
    assets: promptWorkspace.assets.map((asset) =>
      asset.id === generatedPromptAsset.id
        ? {
            ...asset,
            prompt: "Renderer must not replace the trusted asset prompt",
            negativePrompt: "Renderer must not replace the trusted negative prompt",
            promptOrigin: null,
            promptMetadataVersion: null,
          }
        : asset,
    ),
  });
  const protectedAsset = (await api("getImageStudioWorkspace")).assets.find(
    (asset) => asset.id === generatedPromptAsset.id,
  );
  assert.equal(protectedAsset.prompt, polishedText);
  assert.equal(protectedAsset.negativePrompt, "");
  assert.equal(protectedAsset.promptOrigin, "mingshen_generated");
  assert.equal(protectedAsset.promptMetadataVersion, 1);
  passed.push("Generated assets persist original positive and negative prompts separately from provider revisions; overwrite prompts require confirmation, cancel preserves both fields, confirmed empty-negative restores clear only that field, and stale renderer workspace snapshots cannot forge or replace main-process-owned asset prompt metadata.");

  holdPolish = true;
  let polishCount = requests.filter((request) => request.kind === "polish").length;
  await click("[data-testid=image-polish]"); await waitForRequestCount("polish", polishCount + 1);
  await fill("[data-testid=image-prompt]", "Changed while the fixture request was pending.");
  releasePolish(); await waitForRequestSettled("polish", polishCount + 1);
  await until('Boolean(document.querySelector("[data-testid=image-prompt-preview]"))');
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=image-prompt-apply]").disabled'), true);
  await click("[data-testid=image-prompt-discard]");
  await until('!document.querySelector("[data-testid=image-prompt-preview]")');
  holdPolish = true;
  polishCount = requests.filter((request) => request.kind === "polish").length;
  await click("[data-testid=image-polish]"); await waitForRequestCount("polish", polishCount + 1);
  await openSurface("workstation"); releasePolish(); await waitForRequestSettled("polish", polishCount + 1); await openSurface("image-studio");
  await until('Boolean(document.querySelector("[data-testid=image-prompt-preview]"))');
  await until('document.querySelector("[data-testid=image-prompt]")?.value==="Changed while the fixture request was pending."');
  await click("[data-testid=image-prompt-discard]");
  await until('!document.querySelector("[data-testid=image-prompt-preview]")');
  await fill("[data-testid=image-prompt]", polishedText);
  passed.push("A stale polish preview cannot replace a newer prompt; the hidden studio remains mounted and retains a completed preview until it is explicitly discarded.");

  await renderer.evaluate('(()=>{const button=document.querySelector("[data-testid=image-asset] .image-asset__select");if(button?.getAttribute("aria-pressed")!=="true")button?.click();return true})()');
  await until('document.querySelector("[data-testid=image-asset] .image-asset__select")?.getAttribute("aria-pressed")==="true"');
  await click("[data-testid=image-reverse]");
  await until('Boolean(document.querySelector("[data-testid=image-prompt-preview]"))');
  assert.equal(await renderer.evaluate('document.querySelector("[data-testid=image-prompt]").value'), polishedText);
  await click("[data-testid=image-prompt-apply]");
  await until(`document.querySelector("[data-testid=image-prompt]")?.value===${JSON.stringify(reverseText)}`);
  assert.ok(requests.some((request) => request.kind === "reverse" && request.hasImage && request.toolCount === 0));
  await setFiles("[data-testid=image-import-input]", [imageFile]);
  await until('document.querySelectorAll("[data-testid=image-asset]").length===2');
  const importedPromptWorkspace = await api("getImageStudioWorkspace");
  const importedPromptAsset = importedPromptWorkspace.assets.find(
    (asset) => asset.source === "imported" && asset.name === "reference-a.png",
  );
  assert.ok(importedPromptAsset, "The external image import fixture is missing");
  assert.match(
    await renderer.evaluate(`document.querySelector(${JSON.stringify(`[data-testid=image-asset][data-asset-id="${importedPromptAsset.id}"] [data-testid=image-asset-prompt-state]`)})?.textContent ?? ""`),
    /无生成提示词|No generated prompt/i,
  );
  await fill("[data-testid=image-prompt]", "External import positive must stay");
  await fill("[data-testid=image-negative-prompt]", "External import negative must stay");
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt==="External import positive must stay"&&workspace.negativePrompt==="External import negative must stay"})()`);
  await click(
    `[data-testid=image-asset][data-asset-id="${importedPromptAsset.id}"] [data-testid=image-asset-import-prompt]`,
  );
  await until('Boolean(document.querySelector(".image-studio__error[role=alert]"))');
  assert.match(
    await renderer.evaluate('document.querySelector(".image-studio__error[role=alert]").textContent'),
    /外部导入|无法确认|external|imported|verified/i,
  );
  assert.equal(await renderer.evaluate('Boolean(document.querySelector("[role=alertdialog]"))'), false);
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-testid=image-prompt]").value'),
    "External import positive must stay",
  );
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-testid=image-negative-prompt]").value'),
    "External import negative must stay",
  );
  await click('.image-studio__error[role=alert] button[aria-label="关闭"]');
  passed.push("Externally imported images never expose recoverable generation prompts; importing their unavailable prompts keeps both current workspace fields unchanged and shows an explicit explanation.");
  await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset] .image-asset__select").forEach(button=>{if(button.getAttribute("aria-pressed")!=="true")button.click()});true');
  await until('document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length===2');
  passed.push("Vision reverse uses an actual selected image and a tool-free request, previews the result, and local image import adds a second independent frame.");

  await setFiles("[data-testid=image-import-input]", referenceFiles.slice(1));
  await until('document.querySelectorAll("[data-testid=image-asset]").length===5');
  await fill("[data-testid=image-prompt]", polishedText);
  while (true) {
    const selectedCount = await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length');
    if (selectedCount === 0) break;
    await renderer.evaluate('document.querySelector("[data-testid=image-asset] .image-asset__select[aria-pressed=true]")?.click()');
    await until(`document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length===${selectedCount - 1}`);
  }
  for (const name of referenceFileNames) {
    await click(`[data-testid=image-asset] .image-asset__select[title="${name}"]`);
  }
  await until('document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length===4');
  assert.equal(await controlChecked("[data-testid=image-reference-toggle]"), false);
  await click("[data-testid=image-reference-toggle]");
  await until('document.querySelectorAll("[data-testid=image-reference-item]").length===3');
  assert.deepEqual(
    await renderer.evaluate('[...document.querySelectorAll("[data-testid=image-reference-item] figcaption")].map(item=>item.textContent.trim())'),
    referenceFileNames.slice(0, 3),
  );
  assert.match(
    await renderer.evaluate('document.querySelector("[data-testid=image-reference-overflow]")?.textContent ?? ""'),
    /已选 4 张，仅前 3 张会参与本次生成/,
  );
  let referenceCount = requests.filter((request) => request.kind === "reference-image").length;
  const assetCountBeforeReference = await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset]").length');
  await click("[data-testid=image-generate]");
  await waitForRequestCount("reference-image", referenceCount + 1);
  await waitForRequestSettled("reference-image", referenceCount + 1);
  await until(`document.querySelectorAll("[data-testid=image-asset]").length>${assetCountBeforeReference}`);
  const orderedEdit = requests.filter((request) => request.kind === "reference-image").at(-1);
  assert.deepEqual(orderedEdit.files.map((file) => file.name), [
    "reference-1.png",
    "reference-2.png",
    "reference-3.png",
  ]);
  assert.deepEqual(orderedEdit.files.map((file) => file.sha256), referencePngs.slice(0, 3).map(digest));
  assert.ok(orderedEdit.files.every((file) => file.type === "image/png" && file.size > 0));
  passed.push("Reference generation is opt-in, preserves selection order, caps four selected assets to the first three, and sends their exact bytes as repeated multipart image[] files.");

  if (await renderer.evaluate('document.querySelector("#image-studio-inspector")?.hidden')) {
    await click("[data-testid=image-inspector-toggle]");
    await until('document.querySelector("#image-studio-inspector")?.hidden===false');
  }
  if (await controlChecked("[data-testid=image-reference-toggle]")) {
    await click("[data-testid=image-reference-toggle]");
  }
  await until('document.querySelectorAll("[data-testid=image-reference-item]").length===0');
  const imageRequestCount = requests.filter((request) => request.kind === "image").length;
  const assetsBeforeDisabledImage = await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset]").length');
  await click("[data-testid=image-generate]");
  await waitForRequestCount("image", imageRequestCount + 1);
  await waitForRequestSettled("image", imageRequestCount + 1);
  await until(`document.querySelectorAll("[data-testid=image-asset]").length===${assetsBeforeDisabledImage + 1}`);
  const disabledEdit = requests.filter((request) => request.kind === "image").at(-1);
  assert.equal(disabledEdit.url, "/v1/images/generations");
  assert.deepEqual(disabledEdit.files, []);
  passed.push("Disabling reference mode keeps selected assets in the library but sends a JSON text-to-image request with no uploaded files.");

  if (await renderer.evaluate('document.querySelector("#image-studio-inspector")?.hidden')) {
    await click("[data-testid=image-inspector-toggle]");
    await until('document.querySelector("#image-studio-inspector")?.hidden===false');
  }
  const assetsBeforeBackgroundGeneration = await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset]").length');
  const workspaceBeforeBackground = await api("getImageStudioWorkspace");
  const existingBackgroundAssetIds = new Set(workspaceBeforeBackground.assets.map((asset) => asset.id));
  const backgroundImageCount = requests.filter((request) => request.kind === "image").length;
  holdImage = true;
  await click("[data-testid=image-generate]");
  await waitForRequestCount("image", backgroundImageCount + 1);
  await until('document.querySelector(".image-studio")?.getAttribute("data-navigation-busy")==="true"');
  await click('[data-testid="agent-mode-chat"]');
  await until('document.querySelector(".app-shell")?.dataset.agentMode==="chat"&&document.querySelector(".app-topbar")?.dataset.appSurface==="conversation"');
  await until('document.querySelector(".app-studio-host[data-app-surface=image-studio]")?.hidden===true&&Boolean(document.querySelector("[data-app-surface=image-studio] .image-studio"))');
  const backgroundImageRequest = requests.filter((request) => request.kind === "image")[backgroundImageCount];
  assert.equal(backgroundImageRequest.settled, false);
  assert.equal(backgroundImageRequest.clientClosed, false, "Switching to ChatAgent must not cancel the provider request");
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-app-surface=image-studio] .image-studio")?.getAttribute("data-navigation-busy")'),
    "false",
  );
  await openSurface("workstation");
  assert.equal(backgroundImageRequest.clientClosed, false, "Switching to the workstation must not cancel the provider request");
  releaseImage();
  await waitForRequestSettled("image", backgroundImageCount + 1);
  await until(`document.querySelectorAll("[data-app-surface=image-studio] [data-testid=image-asset]").length===${assetsBeforeBackgroundGeneration + 1}`);
  await openSurface("image-studio");
  const workspaceAfterBackground = await api("getImageStudioWorkspace");
  const backgroundAsset = workspaceAfterBackground.assets.find((asset) => !existingBackgroundAssetIds.has(asset.id));
  assert.ok(backgroundAsset, "The provider result must be persisted in the local asset library");
  const activeDocument = workspaceAfterBackground.documents.find(
    (document) => document.id === workspaceAfterBackground.activeDocumentId,
  );
  const backgroundLayer = activeDocument?.layers.find((layer) => layer.assetId === backgroundAsset.id);
  assert.ok(backgroundLayer, "The provider result must also be added to the active canvas");
  const backgroundAssetData = await api("getImageStudioAssetData", backgroundAsset.id);
  assert.match(backgroundAssetData?.dataUrl ?? "", /^data:image\/png;base64,/);
  await until(`Boolean(document.querySelector('[data-app-surface="image-studio"] [data-layer-id="${backgroundLayer.id}"] img'))`);
  await until(`[...document.querySelectorAll('[data-app-surface="image-studio"] .image-asset__name')].some(item=>item.textContent.trim()===${JSON.stringify(backgroundAsset.name)})`);
  assert.equal(backgroundImageRequest.clientClosed, false);
  passed.push("A delayed image generation survives switching to ChatAgent and the workstation, does not block other navigation, and saves into the local asset library and active canvas when the provider responds.");

  const batchWorkspaceBefore = await api("getImageStudioWorkspace");
  const batchGeneratedAsset = batchWorkspaceBefore.assets.find(
    (asset) => asset.id === generatedPromptAsset.id,
  );
  const batchImportedAsset = batchWorkspaceBefore.assets.find(
    (asset) => asset.id === importedPromptAsset.id,
  );
  assert.ok(batchGeneratedAsset, "The generated prompt fixture must still exist for batch removal");
  assert.ok(batchImportedAsset, "The imported prompt fixture must still exist for batch removal");
  assert.equal(batchGeneratedAsset.promptMetadataVersion, 1);
  assert.equal(batchGeneratedAsset.prompt, polishedText);
  assert.equal(batchGeneratedAsset.negativePrompt, "");
  await clearImageAssetSelection();
  await until(
    'Boolean(document.querySelector("[data-testid=image-assets-select-all]:not(:disabled)"))',
  );
  await click("[data-testid=image-assets-select-all]");
  const visibleAssetCount = await renderer.evaluate(
    'document.querySelectorAll("[data-testid=image-asset]").length',
  );
  await until(
    `document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length===${Math.min(visibleAssetCount, 200)}`,
  );
  await clearImageAssetSelection();
  await selectImageAssetIds([batchGeneratedAsset.id, batchImportedAsset.id]);
  for (const selector of [
    "[data-testid=image-assets-export]",
    "[data-testid=image-assets-add]",
    "[data-testid=image-assets-delete]",
  ])
    await until(
      `(()=>{const el=document.querySelector(${JSON.stringify(selector)});return Boolean(el&&!el.disabled&&!el.closest("[hidden]"))})()`,
    );

  const batchExportFile = join(temporary, "selected-assets.zip");
  try {
    await installSaveDialogFixture(batchExportFile);
    await renderer.evaluate(`(()=>{
      window.__imageStudioExportProgress=[];
      window.__imageStudioExportProgressUiSeen=false;
      window.__imageStudioExportProgressObserver=new MutationObserver(()=>{
        if(document.querySelector('[data-testid="image-export-progress"]'))
          window.__imageStudioExportProgressUiSeen=true;
      });
      window.__imageStudioExportProgressObserver.observe(document.body,{childList:true,subtree:true});
      window.mingshen.onImageStudioExportProgress(progress=>window.__imageStudioExportProgress.push(progress));
    })()`);
    await click("[data-testid=image-assets-export]");
    const archiveBytes = await untilFile(batchExportFile);
    const exportProgress = await renderer.evaluate(`(()=>{
      window.__imageStudioExportProgressObserver?.disconnect();
      return {events:window.__imageStudioExportProgress??[],uiSeen:window.__imageStudioExportProgressUiSeen===true};
    })()`);
    assert.equal(exportProgress.uiSeen, true, "The batch export progress bar must be rendered");
    assert.deepEqual(
      exportProgress.events.map((event) => event.phase),
      ["packing", "packing", "packing", "finalizing", "complete"],
    );
    assert.equal(exportProgress.events.at(-1)?.completedAssets, 2);
    assert.equal(exportProgress.events.at(-1)?.completedBytes, generatedPng.length + importedPng.length);
    const archive = unzipSync(new Uint8Array(archiveBytes));
    const entries = Object.entries(archive);
    assert.equal(entries.length, 2);
    assert.equal(new Set(entries.map(([name]) => name.toLocaleLowerCase("en-US"))).size, 2);
    for (const [name, bytes] of entries) {
      assert.ok(name && !name.startsWith(".") && !/[\\/]/.test(name), `Unsafe ZIP entry: ${name}`);
      assert.equal(name.includes(".."), false, `Unsafe ZIP entry: ${name}`);
      assert.equal(/\.(?:json|txt|md)$/i.test(name), false, `Prompt metadata leaked as ${name}`);
      assert.deepEqual(pngDimensions(Buffer.from(bytes)), { width: 128, height: 96 });
    }
    assert.deepEqual(
      entries.map(([, bytes]) => digest(Buffer.from(bytes))).sort(),
      [digest(generatedPng), digest(importedPng)].sort(),
      "The batch ZIP must contain the exact selected image bytes",
    );
  } finally {
    await restoreSaveDialogFixture();
  }

  const batchWorkspaceForDocument = await api("getImageStudioWorkspace");
  const documentBeforeBatchAdd = batchWorkspaceForDocument.documents.find(
    (document) => document.id === batchWorkspaceForDocument.activeDocumentId,
  );
  const layersBeforeBatchAdd = documentBeforeBatchAdd?.layers.length ?? 0;
  await click("[data-testid=image-assets-add]");
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();const document=workspace.documents.find(item=>item.id===workspace.activeDocumentId);return Boolean(document&&document.layers.length===${layersBeforeBatchAdd + 2}&&[${JSON.stringify(batchGeneratedAsset.id)},${JSON.stringify(batchImportedAsset.id)}].every(id=>document.layers.some(layer=>layer.assetId===id)))})()`);
  await until(`document.querySelectorAll(".image-canvas-layer").length===${layersBeforeBatchAdd + 2}`);
  await until('(()=>{const images=[...document.querySelectorAll(".image-canvas-layer img")];return images.length>0&&images.slice(-2).every(image=>image.complete&&image.naturalWidth===128&&image.naturalHeight===96)})()');

  await click("[data-testid=image-assets-delete]");
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click("[role=alertdialog] .mingshen-dialog__actions button.btn--danger-solid");
  await until('Boolean(document.querySelector(".image-studio__error[role=alert]"))');
  assert.match(
    await renderer.evaluate('document.querySelector(".image-studio__error[role=alert]").textContent'),
    /引用|批量删除|reference|batch/i,
  );
  let referencedWorkspace = await api("getImageStudioWorkspace");
  assert.ok(referencedWorkspace.assets.some((asset) => asset.id === batchGeneratedAsset.id));
  assert.ok(referencedWorkspace.assets.some((asset) => asset.id === batchImportedAsset.id));
  await click('.image-studio__error[role=alert] button[aria-label="关闭"]');

  await click("[data-testid=image-assets-delete]");
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click("[role=alertdialog] .mingshen-dialog__actions button.btn--secondary");
  await until('!document.querySelector("[role=alertdialog]")');
  let cancelledWorkspace = await api("getImageStudioWorkspace");
  assert.ok(cancelledWorkspace.assets.some((asset) => asset.id === batchGeneratedAsset.id));
  assert.ok(cancelledWorkspace.assets.some((asset) => asset.id === batchImportedAsset.id));

  await sleep(500);
  const workspaceBeforeLayerCleanup = await api("getImageStudioWorkspace");
  const documentsWithoutBatchLayers = workspaceBeforeLayerCleanup.documents.map((document) => ({
    ...document,
    layers: document.layers
      .filter(
        (layer) =>
          layer.assetId !== batchGeneratedAsset.id && layer.assetId !== batchImportedAsset.id,
      )
      .map((layer, index) => ({ ...layer, zIndex: index })),
  }));
  await api("saveImageStudioWorkspace", {
    ...workspaceBeforeLayerCleanup,
    documents: documentsWithoutBatchLayers,
  });
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.documents.every(document=>document.layers.every(layer=>layer.assetId!==${JSON.stringify(batchGeneratedAsset.id)}&&layer.assetId!==${JSON.stringify(batchImportedAsset.id)}))})()`);

  const promptStateBeforeBatchDelete = await api("getImageStudioWorkspace");
  await click("[data-testid=image-assets-delete]");
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click("[role=alertdialog] .mingshen-dialog__actions button.btn--danger-solid");
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return !workspace.assets.some(asset=>asset.id===${JSON.stringify(batchGeneratedAsset.id)}||asset.id===${JSON.stringify(batchImportedAsset.id)})})()`);
  const workspaceAfterBatchDelete = await api("getImageStudioWorkspace");
  assert.equal(workspaceAfterBatchDelete.prompt, promptStateBeforeBatchDelete.prompt);
  assert.equal(workspaceAfterBatchDelete.negativePrompt, promptStateBeforeBatchDelete.negativePrompt);
  assert.equal(
    workspaceAfterBatchDelete.selectedAssetIds.includes(batchGeneratedAsset.id),
    false,
  );
  assert.equal(
    workspaceAfterBatchDelete.selectedAssetIds.includes(batchImportedAsset.id),
    false,
  );
  assert.equal(
    workspaceAfterBatchDelete.assets.find((asset) => asset.id === batchGeneratedAsset.id),
    undefined,
  );
  await reload();
  await selectSession(session);
  await openSurface("image-studio");
  const reloadedAfterBatchDelete = await api("getImageStudioWorkspace");
  assert.equal(
    reloadedAfterBatchDelete.assets.find((asset) => asset.id === batchGeneratedAsset.id),
    undefined,
    "Deleting a generated asset must delete its bundled prompt metadata persistently",
  );
  assert.equal(
    reloadedAfterBatchDelete.assets.find((asset) => asset.id === batchImportedAsset.id),
    undefined,
  );
  passed.push("Image assets support ordered select-all, a 200-item ZIP batch export with per-asset progress and validated PNG entries without prompt sidecars, multi-layer insertion into the active canvas, all-or-nothing referenced deletion, cancel without state loss, and persistent batch deletion of image records together with their bundled prompt metadata.");

  if (await renderer.evaluate('document.querySelector("#image-studio-inspector")?.hidden')) {
    await click("[data-testid=image-inspector-toggle]");
    await until('document.querySelector("#image-studio-inspector")?.hidden===false');
  }
  await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").forEach(button=>button.click());true');
  await until('document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length===0');
  assert.ok(await renderer.evaluate('Boolean(document.querySelector("[data-testid=image-reference-upload]"))'));
  const assetCountBeforeManualReference = await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset]").length');
  await setFiles("[data-testid=image-reference-input]", [manualReferenceFile]);
  await until(`document.querySelectorAll("[data-testid=image-asset]").length>${assetCountBeforeManualReference}`);
  await until('document.querySelectorAll("[data-testid=image-reference-item]").length===1');
  assert.equal(await controlChecked("[data-testid=image-reference-toggle]"), true);
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-testid=image-reference-item] figcaption")?.textContent.trim()'),
    "manual-reference.png",
  );
  referenceCount = requests.filter((request) => request.kind === "reference-image").length;
  await click("[data-testid=image-generate]");
  await waitForRequestCount("reference-image", referenceCount + 1);
  await waitForRequestSettled("reference-image", referenceCount + 1);
  const manualEdit = requests.filter((request) => request.kind === "reference-image").at(-1);
  assert.equal(manualEdit.files.length, 1);
  assert.equal(manualEdit.files[0].field, "image");
  assert.equal(manualEdit.files[0].sha256, digest(manualReferencePng));
  passed.push("Manual reference upload imports into the local library, selects the new image, enables reference mode, and sends a single multipart image field with the exact uploaded bytes.");

  const composerAttachmentsBeforeDrop = (await api("getComposerDraft", session.id)).attachments.map((item) => item.id);
  const assetCountBeforeDrop = await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset]").length');
  await renderer.evaluate(`(()=>{const transfer=new DataTransfer();const bytes=Uint8Array.from(atob(${JSON.stringify(referencePngs[3].toString("base64"))}),character=>character.charCodeAt(0));transfer.items.add(new File([bytes],"dropped-reference.png",{type:"image/png"}));window.__studioImageDrop=transfer;document.querySelector('[data-testid="image-studio"]').dispatchEvent(new DragEvent("dragenter",{bubbles:true,dataTransfer:transfer}));return true})()`);
  await until('Boolean(document.querySelector("[data-testid=image-drop-overlay]"))');
  await renderer.evaluate('document.querySelector("[data-testid=image-studio]").dispatchEvent(new DragEvent("dragover",{bubbles:true,dataTransfer:window.__studioImageDrop}));document.querySelector("[data-testid=image-studio]").dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:window.__studioImageDrop}));true');
  await until(`document.querySelectorAll("[data-testid=image-asset]").length===${assetCountBeforeDrop + 1}`);
  await until('!document.querySelector("[data-testid=image-drop-overlay]")');
  const droppedWorkspace = await api("getImageStudioWorkspace");
  assert.ok(
    droppedWorkspace.assets.some((asset) => asset.name === "dropped-reference.png"),
    "The dragged image should be registered in the local asset library",
  );
  assert.deepEqual(
    (await api("getComposerDraft", session.id)).attachments.map((item) => item.id),
    composerAttachmentsBeforeDrop,
  );
  passed.push("Dragging a PNG file onto Image Studio shows the drop target and imports it into the local asset library without navigating away.");

  if (await renderer.evaluate('document.querySelector("#image-studio-inspector")?.hidden')) {
    await click("[data-testid=image-inspector-toggle]");
    await until('document.querySelector("#image-studio-inspector")?.hidden===false');
  }
  if (await controlChecked("[data-testid=image-reference-toggle]")) {
    await click("[data-testid=image-reference-toggle]");
  }
  while (true) {
    const selectedCount = await renderer.evaluate('document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length');
    if (selectedCount >= 2) break;
    await renderer.evaluate('document.querySelector("[data-testid=image-asset] .image-asset__select[aria-pressed=false]")?.click()');
    await until(`document.querySelectorAll("[data-testid=image-asset] .image-asset__select[aria-pressed=true]").length===${selectedCount + 1}`);
  }

  await click('.image-workspace__tools button[aria-label="适应画布"]');
  await until('Boolean(document.querySelector(".image-canvas-layer img"))');
  const beforeZoom = await renderer.evaluate('document.querySelector(".image-canvas-surface").style.transform');
  await click('.image-workspace__tools button[aria-label="放大"]');
  await until(`document.querySelector(".image-canvas-surface")?.style.transform!==${JSON.stringify(beforeZoom)}`);
  const beforePan = await renderer.evaluate('document.querySelector(".image-canvas-surface").style.transform');
  const point = await renderer.evaluate('(()=>{const r=document.querySelector(".image-viewport").getBoundingClientRect();return{x:r.left+12,y:r.top+12}})()');
  await renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 35, y: point.y + 24, button: "left", buttons: 1 });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 35, y: point.y + 24, button: "left", buttons: 0, clickCount: 1 });
  await until(`document.querySelector(".image-canvas-surface")?.style.transform!==${JSON.stringify(beforePan)}`);
  const layerPoint = await renderer.evaluate('(()=>{const r=document.querySelector(".image-canvas-layer").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()');
  await renderer.send("Input.dispatchMouseEvent", { type: "mousePressed", x: layerPoint.x, y: layerPoint.y, button: "left", buttons: 1, clickCount: 1 });
  await renderer.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: layerPoint.x, y: layerPoint.y, button: "left", buttons: 0, clickCount: 1 });
  await until('Boolean(document.querySelector(".image-layer-controls input[type=number]"))');
  await renderer.evaluate('(()=>{const input=document.querySelector(".image-layer-controls input[type=number]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"120");input.dispatchEvent(new Event("input",{bubbles:true}));return true})()');
  await until('document.querySelector(".image-canvas-layer--selected")?.style.left==="120px"');
  passed.push("Canvas zoom, pointer pan and selected layer position edit change the real rendered canvas state.");

  // The profile handoff reload replaced the renderer and its earlier download capture.
  await installDownloadCapture();
  const pngDownloadIndex = await renderer.evaluate('window.__studioDownloads.length');
  await click("[data-testid=image-export-png]");
  const png = await downloaded(pngDownloadIndex);
  assert.match(png.name, /\.png$/i);
  const pngCheck = await renderer.evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(png.bytes.toString("base64"))}),char=>char.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:"image/png"}));const canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext("2d");context.drawImage(image,0,0);const data=context.getImageData(0,0,image.width,image.height).data;const colors=new Set();for(let i=0;i<data.length;i+=64)colors.add(data[i]+","+data[i+1]+","+data[i+2]+","+data[i+3]);image.close();return{width:canvas.width,height:canvas.height,colors:colors.size}})()`);
  assert.ok(pngCheck.width > 0 && pngCheck.height > 0 && pngCheck.colors > 1, JSON.stringify(pngCheck));
  const gifDownloadIndex = await renderer.evaluate('window.__studioDownloads.length');
  await click("[data-testid=image-export-gif]");
  const gif = await downloaded(gifDownloadIndex);
  assert.match(gif.name, /\.gif$/i);
  const gifCheck = await renderer.evaluate(`(async()=>{const data=Uint8Array.from(atob(${JSON.stringify(gif.bytes.toString("base64"))}),char=>char.charCodeAt(0));if(typeof ImageDecoder!=="function")throw new Error("ImageDecoder unavailable");const decoder=new ImageDecoder({data,type:"image/gif"});await decoder.tracks.ready;const count=decoder.tracks.selectedTrack.frameCount;const samples=[];let width=0,height=0;for(let index=0;index<Math.min(2,count);index++){const frame=await decoder.decode({frameIndex:index});width=frame.image.displayWidth;height=frame.image.displayHeight;const canvas=document.createElement("canvas");canvas.width=16;canvas.height=16;const context=canvas.getContext("2d");context.drawImage(frame.image,0,0,16,16);samples.push(Array.from(context.getImageData(0,0,16,16).data).join(","));frame.image.close()}decoder.close();return{count,width,height,distinct:samples.length===2&&samples[0]!==samples[1]}})()`);
  assert.ok(gifCheck.count >= 2 && gifCheck.width > 0 && gifCheck.height > 0 && gifCheck.distinct, JSON.stringify(gifCheck));
  const bundleDownloadIndex = await renderer.evaluate('window.__studioDownloads.length');
  await click("[data-testid=image-bundle-export]");
  const bundleDownload = await downloaded(bundleDownloadIndex);
  const bundle = JSON.parse(bundleDownload.bytes.toString("utf8"));
  assert.ok(bundle.canvas.layers.length >= 1 && bundle.assets.length >= 1);
  assert.ok(bundle.assets.every((asset) => asset.dataUrl.startsWith("data:image/")));
  const bundleFile = join(temporary, "canvas-bundle.json");
  await writeFile(bundleFile, bundleDownload.bytes);
  const tabCount = await renderer.evaluate('document.querySelectorAll(".image-workspace__tabs [role=tab]").length');
  await setFiles("[data-testid=image-bundle-input]", [bundleFile]);
  await until(`(()=>{const selected=document.querySelector('.image-workspace__tabs [role=tab][aria-selected=true]'),image=document.querySelector('.image-canvas-layer img');return document.querySelectorAll('.image-workspace__tabs [role=tab]').length===${tabCount + 1}&&selected?.textContent.includes('导入')&&image?.complete&&image.naturalWidth===128&&image.naturalHeight===96})()`);
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.documents.length===${tabCount + 1}&&workspace.documents.some(doc=>doc.id===workspace.activeDocumentId&&doc.name.includes('导入')&&doc.layers.length>0)})()`);
  passed.push("PNG and multi-frame GIF exports decode to nonblank media; a self-contained JSON canvas bundle imports with its image layer intact.");

  const lifecycleCanvas = await api("getImageStudioWorkspace");
  const lifecycleCanvasId = lifecycleCanvas.activeDocumentId;
  assert.ok(lifecycleCanvasId);
  await renderer.evaluate('(()=>{const library=document.querySelector("#image-studio-library");if(library?.hidden)document.querySelector("[data-testid=image-library-toggle]")?.click();return true})()');
  await until('!document.querySelector("#image-studio-library")?.hidden');
  await click('[data-testid="image-library-canvases-tab"]');
  const sourceRow = `.image-canvas-project[data-canvas-id="${lifecycleCanvasId}"]`;
  await until(`Boolean(document.querySelector(${JSON.stringify(sourceRow)}))`);
  await click(`${sourceRow} button[title="重命名"]`);
  await fill(`${sourceRow} input`, "Lifecycle fixture");
  await renderer.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await renderer.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(`document.querySelector(${JSON.stringify(`${sourceRow} .image-canvas-project__open strong`)})?.textContent==="Lifecycle fixture"`);
  const searchSelector = ".image-library__search input";
  await fill(searchSelector, "Lifecycle fixture");
  await until(`document.querySelectorAll("[data-testid=image-canvas-project]").length===1`);
  await fill(searchSelector, "");

  const sourceTabClose = `[data-testid="image-canvas-tab"][data-canvas-id="${lifecycleCanvasId}"] .image-workspace__tab-close`;
  await main.evaluate(`(()=>{
    const handlers=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").ipcMain._invokeHandlers;
    const channel="image-studio:canvas-close", original=handlers.get(channel);
    if(typeof original!=="function")throw new Error("Canvas close IPC handler is unavailable");
    globalThis.__studioCanvasCloseHandler=original;
    let release;
    globalThis.__studioCanvasCloseGate=new Promise(resolve=>{release=resolve});
    globalThis.__releaseStudioCanvasClose=release;
    handlers.set(channel,async(...args)=>{await globalThis.__studioCanvasCloseGate;return original(...args)});
    return true;
  })()`);
  await click(sourceTabClose);
  await until('document.querySelector("[data-testid=image-studio]")?.inert===true');
  assert.deepEqual(
    await renderer.evaluate('({inert:document.querySelector("[data-testid=image-studio]").inert,busy:document.querySelector("[data-testid=image-studio]").getAttribute("aria-busy")})'),
    { inert: true, busy: "true" },
    "Canvas editing must pause while a file-backed mutation is pending",
  );
  await main.evaluate('globalThis.__releaseStudioCanvasClose?.();true');
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return !workspace.documents.some(doc=>doc.id===${JSON.stringify(lifecycleCanvasId)})})()`);
  assert.ok((await api("listImageStudioCanvases")).some((item) => item.id === lifecycleCanvasId));
  await click(`${sourceRow} .image-canvas-project__open`);
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.activeDocumentId===${JSON.stringify(lifecycleCanvasId)}&&workspace.documents.some(doc=>doc.id===workspace.activeDocumentId)})()`);

  await click(`${sourceRow} button[title="复制画布"]`);
  await until(`(async()=>{const projects=await window.mingshen.listImageStudioCanvases();return projects.some(item=>item.id!==${JSON.stringify(lifecycleCanvasId)}&&item.name.includes("副本"))})()`);
  const duplicateProject = (await api("listImageStudioCanvases")).find(
    (item) => item.id !== lifecycleCanvasId && item.name.includes("副本"),
  );
  assert.ok(duplicateProject?.available);
  const duplicateCanvas = (await api("getImageStudioWorkspace")).documents.find(
    (document) => document.id === duplicateProject.id,
  );
  assert.ok(duplicateCanvas?.layers.length);
  const duplicateRow = `.image-canvas-project[data-canvas-id="${duplicateProject.id}"]`;
  await click(`${duplicateRow} .image-canvas-project__delete`);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click('[role="alertdialog"] .mingshen-dialog__actions button.btn--danger-solid');
  await until(`(async()=>{const projects=await window.mingshen.listImageStudioCanvases();return !projects.some(item=>item.id===${JSON.stringify(duplicateProject.id)})})()`);
  await until(`(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.activeDocumentId===${JSON.stringify(lifecycleCanvasId)}})()`);
  await click('[data-testid="image-library-assets-tab"]');
  passed.push("The local canvas library searches and renames imported projects, closes tabs without deleting files, reopens them, duplicates layer references, and confirms permanent project deletion.");

  await main.evaluate(`(()=>{
    const handlers=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").ipcMain._invokeHandlers;
    const original=handlers.get("desktop:state");
    if(typeof original!=="function")throw new Error("Desktop state IPC handler is unavailable");
    globalThis.__studioDesktopStateHandler=original;
    handlers.set("desktop:state",async(...args)=>{
      const state=await original(...args);
      if(!state?.shortcuts)throw new Error("Desktop shortcut status is unavailable");
      return {...state,shortcuts:{...state.shortcuts,quickChat:false}};
    });
    return true;
  })()`);
  for (const style of ["simple", "orbit"]) {
    for (const locale of ["zh-CN", "en"]) {
      for (const theme of ["day", "night"]) {
        await renderer.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await api("saveUiPreferences", { ...(await api("getUiPreferences")), interfaceStyle: style });
        await renderer.evaluate(`(async()=>{await window.mingshen.desktopAction("locale",${JSON.stringify(locale)});localStorage.setItem("mingshen.locale",${JSON.stringify(locale)});localStorage.setItem("mingshen.theme",${JSON.stringify(theme)});return true})()`);
        await reload();
        await until(`Boolean(document.querySelector(".app-shell"))&&document.documentElement.dataset.interfaceStyle===${JSON.stringify(style)}&&document.documentElement.dataset.theme===${JSON.stringify(theme)}`);
        await until('Boolean(document.querySelector("[data-testid=desktop-shortcut-warning]"))&&Boolean(document.querySelector(".desktop-update-trigger"))');
        assert.equal((await api("getUpdateStatus")).state, "available");
        await installDownloadCapture();
        await selectSession(session);
        for (const [width, height] of [[1440, 900], [800, 600]]) {
          await renderer.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
          for (const surface of ["workstation", "image-studio"]) {
            await openSurface(surface);
            const heading = surface === "workstation" ? ".creative-workstation__identity strong" : ".image-studio__title strong";
            const expected = surface === "workstation" ? (locale === "en" ? "Creative workstation" : "创作工作站") : (locale === "en" ? "Image Studio" : "生图工作台");
            await until(`document.querySelector(${JSON.stringify(heading)})?.textContent===${JSON.stringify(expected)}`);
            if (surface === "image-studio") await until('(()=>{const layers=[...document.querySelectorAll(".image-canvas-layer")];return layers.length>0&&layers.every(layer=>{const img=layer.querySelector("img");return img?.complete&&img.naturalWidth>0})})()');
            const name = `${surface}-${style}-${locale}-${theme}-${width}`;
            if (surface === "workstation") {
              await exerciseCreativeControls(name, width);
              if (width === 800) {
                await renderer.send("Emulation.setDeviceMetricsOverride", { width: 680, height: 600, deviceScaleFactor: 1, mobile: false });
                const compactName = `${surface}-${style}-${locale}-${theme}-680`;
                await exerciseCreativeControls(compactName, 680);
                await measure(".creative-workstation", compactName);
                await measureCaption(compactName);
                await capture(compactName);
                await renderer.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
              }
            }
            if (surface === "image-studio") {
              await exerciseStudioControls(name, width);
              if (style === "simple" && locale === "zh-CN" && theme === "day" && width === 800) {
                await renderer.send("Emulation.setDeviceMetricsOverride", { width: 680, height: 600, deviceScaleFactor: 1, mobile: false });
                await measureStudioControls(`${name}-680-closed`, false, false, true);
                await setStudioPanel('[data-testid=image-library-toggle]', true);
                await measureStudioControls(`${name}-680-library`, true, false, true);
                await setStudioPanel('[data-testid=image-inspector-toggle]', true);
                await measureStudioControls(`${name}-680-inspector`, false, true, true);
                await setStudioPanel('[data-testid=image-inspector-toggle]', false);
                await renderer.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
                await pointerClick('.image-workspace__tools button[aria-label="适应画布"]');
                await assertFittedCanvas(`${name}-680-restored`);
              }
            }
            await measure(surface === "workstation" ? ".creative-workstation" : ".image-studio", name);
            await measureCaption(name);
            await capture(name);
          }
        }
      }
    }
  }
  passed.push("Workstation mode, prompt, copy, filtering and side panels remain reachable without clipping or overlap at 1440/800/680 in both styles, languages and themes.");
  passed.push("Canvas side panels toggle through real pointer input without covering controls; explicit fit, zoom, pan and PNG export work at desktop and 800px, with a 680px drawer boundary check.");
  passed.push("Both surfaces have 40 viewport screenshots plus 15 expanded-prompt, brief-mode and open-panel captures, with caption geometry for Simple/Orbit, Chinese/English, day/night, 1440/800 and additional 680px workstation views; native wheel input reaches the prompt end in three representative layouts.");
  assert.equal(await main.evaluate('globalThis.__studioUncapturedDownloads'), 0, "A fixture download escaped renderer capture");
  assert.deepEqual(exceptions, []); assert.deepEqual(serviceErrors, []);
  console.log(JSON.stringify({ passed, screenshots, requests, resultPath: await saveResult(true) }, null, 2));
} catch (cause) {
  if (renderer) await capture("failure").catch(() => undefined);
  console.error(JSON.stringify({ passed, resultPath: await saveResult(false, cause), body: await renderer?.evaluate("document.body.innerText").catch(() => null) }, null, 2));
  throw cause;
} finally {
  releasePolish();
  releaseImage();
  await main?.evaluate(`(()=>{const original=globalThis.__studioDesktopStateHandler;if(original){process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").ipcMain._invokeHandlers.set("desktop:state",original);delete globalThis.__studioDesktopStateHandler}return true})()`).catch(() => {});
  await main?.evaluate(`(()=>{const original=globalThis.__studioCanvasCloseHandler;if(original){globalThis.__releaseStudioCanvasClose?.();process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").ipcMain._invokeHandlers.set("image-studio:canvas-close",original);delete globalThis.__studioCanvasCloseHandler;delete globalThis.__studioCanvasCloseGate;delete globalThis.__releaseStudioCanvasClose}return true})()`).catch(() => {});
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
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local) && local.startsWith("mingshen-creative-image-"), "Unsafe cleanup path");
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
