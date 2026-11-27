import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createPortServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { experimentalExecutable } from "./experimental-executable.mjs";

const require = createRequire(resolve("apps/desktop/package.json"));
const { createCanvas } = require("@napi-rs/canvas");

const temporary = await mkdtemp(join(tmpdir(), "mingshen-v137-image-unread-"));
const profile = join(temporary, "profile");
const workspace = join(temporary, "workspace");
const evidence = resolve(".impeccable/review", `v137-image-unread-${Date.now()}`);
const passed = [];
const requests = [];
const serviceErrors = [];
const exceptions = [];
const screenshots = [];
const geometry = [];
const remotePrompt = "V137_REMOTE_POSITIVE: cobalt workshop, clear glass, soft daylight";
const remoteNegative = "V137_REMOTE_NEGATIVE: watermark, blur, extra limbs";
const laterPrompt = "V137_LATER_WORKSPACE_POSITIVE: current prompt must not replace generation provenance";
const laterNegative = "V137_LATER_WORKSPACE_NEGATIVE: current negative must not replace generation provenance";
const normalPrompt = "V137_NORMAL_POSITIVE: exact local Base64 fixture";
const normalNegative = "V137_NORMAL_NEGATIVE: no text, no blur";
const concurrentPrompts = [
  "V137_CONCURRENT_A: first isolated render",
  "V137_CONCURRENT_B: second isolated render",
  "V137_CONCURRENT_C: third isolated render",
];
const concurrentProviderWaiters = new Map();
const concurrentDraft = "V137_CONCURRENT_DRAFT: newest local prompt must survive every response";
const lateCancelPrompts = [
  "V137_LATE_CANCEL_A: committed cancellation boundary",
  "V137_LATE_CANCEL_B: parallel committed result",
  "V137_LATE_CANCEL_C: parallel committed result",
];
const deferredCloseDraft = "V137_DEFERRED_CLOSE_DRAFT: prompt typed while close IPC is held";
const deferredCloseNegative = "V137_DEFERRED_CLOSE_NEGATIVE: preserve this draft without reopening canvas";
const layoutPrompt = "V137_REMOTE_LAYOUT: responsive review fixture";
const layoutNegative = "V137_LAYOUT_NEGATIVE: clipping and overlap";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let child;
let main;
let renderer;
let provider;
let imageProvider;
let textModel;
let imageModel;
let codeSession;
let workSession;
let chatSession;
let remoteAsset;
let normalAsset;
let raceCanvasId;

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

const mockedRemotePng = fixturePng("#064f4d", "#ff845e");
const normalPng = fixturePng("#6d3c9a", "#f1c453");

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const record = {
      method: request.method,
      path: url.pathname,
      body: null,
      settled: false,
    };
    requests.push(record);

    if (request.method === "GET" && url.pathname === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "v137-image" }] }));
      record.settled = true;
      return;
    }

    assert.equal(request.method, "POST", `Unexpected fixture request: ${request.method} ${url.pathname}`);
    if (url.pathname === "/v1/images/edits") {
      const multipart = await new Response(raw, {
        headers: { "content-type": request.headers["content-type"] },
      }).formData();
      assert.equal(multipart.get("model"), "v137-image");
      assert.equal(multipart.get("n"), "1");
      const reference = multipart.get("image");
      assert.ok(reference instanceof Blob, "A single edit reference must use image");
      assert.equal(reference.type, "image/png");
      assert.deepEqual(Buffer.from(await reference.arrayBuffer()), normalPng);
      assert.equal(multipart.getAll("image[]").length, 0);
      record.body = { model: multipart.get("model"), referenceCount: 1 };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ b64_json: normalPng.toString("base64") }] }));
      record.settled = true;
      return;
    }
    const body = JSON.parse(raw.toString("utf8") || "{}");
    record.body = {
      model: body.model,
      stream: body.stream,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      imageCount: body.n,
    };

    if (url.pathname === "/v1/images/generations") {
      assert.equal(body.model, "v137-image", "Unexpected image model");
      for (const field of ["messages", "input", "stream", "async", "response_format", "max_tokens", "max_output_tokens"])
        assert.equal(field in body, false, `Images request must not contain ${field}`);
      if (String(body.prompt ?? "").includes("V137_REMOTE")) {
        assert.equal(body.n, 3, "Remote candidate fixture requires three requested images");
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              {
                url: "https://images.example.com/v137-a.png",
                revised_prompt: "v137 remote revised A",
              },
              {
                url: "https://images.example.com/v137-b.png",
                revised_prompt: "v137 remote revised B",
              },
              {
                url: "https://images.example.com/v137-c.png",
                revised_prompt: "v137 remote revised C",
              },
            ],
          }),
        );
      } else {
        assert.equal(body.n, 1, "Normal image fixture must request one image");
        const concurrentIndex = concurrentPrompts.findIndex(
          (prompt) => body.prompt === prompt || body.prompt.startsWith(`${prompt}\n`),
        );
        if (concurrentIndex >= 0) {
          await new Promise((done) => {
            concurrentProviderWaiters.set(concurrentIndex, done);
            response.once("close", done);
          });
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              {
                b64_json: normalPng.toString("base64"),
                revised_prompt: concurrentIndex >= 0
                  ? `v137 concurrent revised ${body.prompt}`
                  : "v137 normal revised fixture",
              },
            ],
          }),
        );
      }
      record.settled = true;
      return;
    }

    assert.equal(url.pathname, "/v1/responses", "Unexpected fixture endpoint");
    assert.equal(body.model, "v137-text", "Unexpected text model");
    const text = "V137 local completion fixture.";
    if (body.stream !== false) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`,
      );
      response.end(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: { status: "completed", output: [], usage: { input_tokens: 8, output_tokens: 6, total_tokens: 14 } },
        })}\n\n`,
      );
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text }] }],
        }),
      );
    }
    record.settled = true;
  } catch (cause) {
    serviceErrors.push(cause.stack || String(cause));
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("V137 local fixture rejected the request.");
  }
});

async function freePort() {
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
  for (let attempt = 0; attempt < 240 && !target; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${number}/json`).then((value) => value.json());
      target = targets.find(
        (item) =>
          item.webSocketDebuggerUrl &&
          (kind === "main"
            ? item.type === "node"
            : item.type === "page" && /\/renderer\/index\.html(?:[?#]|$)/.test(item.url)),
      );
    } catch {}
    if (!target) await sleep(100);
  }
  assert.ok(target, `Missing ${kind} debugger target on ${number}`);

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
      exceptions.push({
        kind,
        text:
          message.params.exceptionDetails.exception?.description ||
          message.params.exceptionDetails.text,
      });
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((done, reject) => {
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
    async evaluate(expression) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        );
      return result.result.value;
    },
    close() {
      for (const waiter of pending.values()) clearTimeout(waiter.timer);
      socket.close();
    },
  };
}

async function scopedObject(objectId, name) {
  const properties = await main.send("Runtime.getProperties", {
    objectId,
    ownProperties: false,
  });
  const scopes = properties.internalProperties?.find((item) => item.name === "[[Scopes]]")?.value
    ?.objectId;
  if (!scopes) return null;
  const list = await main.send("Runtime.getProperties", {
    objectId: scopes,
    ownProperties: true,
  });
  for (const scope of list.result) {
    if (!scope.value?.objectId) continue;
    const values = await main.send("Runtime.getProperties", {
      objectId: scope.value.objectId,
      ownProperties: true,
    });
    const match = values.result.find((item) => item.name === name && item.value?.objectId);
    if (match) return match.value.objectId;
  }
  return null;
}

async function discoverImageStudioService() {
  const handler = await main.send("Runtime.evaluate", {
    expression: `process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron").ipcMain._invokeHandlers.get("image-studio:remote-preview")`,
  });
  assert.ok(handler.result.objectId, "image-studio:remote-preview handler is unavailable");

  let scopeObject = handler.result.objectId;
  let servicesObject = await scopedObject(scopeObject, "services");
  if (!servicesObject) {
    let requireServices = await scopedObject(scopeObject, "requireServices");
    // The common diagnostics boundary closes over the original main-process handler.
    if (!requireServices) {
      scopeObject = await scopedObject(scopeObject, "listener");
      assert.ok(scopeObject, "The instrumented IPC listener is unavailable");
      requireServices = await scopedObject(scopeObject, "requireServices");
    }
    assert.ok(requireServices, "Could not resolve image studio services from the IPC handler scope");
    const called = await main.send("Runtime.callFunctionOn", {
      objectId: requireServices,
      functionDeclaration: "function(){return this();}",
      returnByValue: false,
    });
    if (called.exceptionDetails)
      throw new Error(
        called.exceptionDetails.exception?.description || called.exceptionDetails.text,
      );
    servicesObject = called.result.objectId;
  }
  assert.ok(servicesObject, "Application services could not be resolved");
  const stored = await main.send("Runtime.callFunctionOn", {
    objectId: servicesObject,
    functionDeclaration: `function(){
      globalThis.__v137ImageStudioService=this.imageStudioService;
      return Boolean(
        globalThis.__v137ImageStudioService &&
        globalThis.__v137ImageStudioService.pendingRemoteImages instanceof Map
      );
    }`,
    returnByValue: true,
  });
  if (stored.exceptionDetails)
    throw new Error(stored.exceptionDetails.exception?.description || stored.exceptionDetails.text);
  assert.equal(stored.result.value, true, "Image Studio service was not discoverable");
}

async function installNetworkGuard(fixtureOrigin) {
  await main.evaluate(`(()=>{
    if(globalThis.__v137OriginalFetch)throw new Error("Network guard was installed twice");
    globalThis.__v137OriginalFetch=globalThis.fetch;
    globalThis.__v137BlockedFetches=[];
    globalThis.fetch=(input,options)=>{
      const target=String(input&&typeof input==="object"&&"url" in input?input.url:input);
      const url=new URL(target);
      if(url.origin===${JSON.stringify(fixtureOrigin)})return globalThis.__v137OriginalFetch(input,options);
      if(/\\/rest\\/v1\\/rpc\\//.test(url.pathname))return Promise.resolve(Response.json([]));
      globalThis.__v137BlockedFetches.push(url.href);
      return Promise.reject(new Error("V137 smoke blocked non-fixture network request: "+url.href));
    };
    return true;
  })()`);
}

async function installDnsFixture() {
  const installed = await main.evaluate(`(()=>{
    const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json");
    const dns=require("node:dns/promises");
    if(globalThis.__v137OriginalDnsLookup)throw new Error("DNS fixture was installed twice");
    globalThis.__v137OriginalDnsLookup=dns.lookup;
    globalThis.__v137DnsFixtureCalls=[];
    dns.lookup=async function(hostname,options){
      if(hostname==="images.example.com"){
        globalThis.__v137DnsFixtureCalls.push({hostname,options});
        return [
          {address:"93.184.216.34",family:4},
          {address:"2606:4700:4700::1111",family:6}
        ];
      }
      return globalThis.__v137OriginalDnsLookup.call(this,hostname,options);
    };
    return true;
  })()`);
  assert.equal(installed, true);
}

async function installBadgeCapture() {
  const installed = await main.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    const window=electron.BrowserWindow.getAllWindows().find(item=>
      !item.isDestroyed()&&/\\/renderer\\/index\\.html(?:[?#]|$)/.test(item.webContents.getURL())
    );
    if(!window)throw new Error("Main renderer window is unavailable for overlay capture");
    globalThis.__v137NotificationWindow=window;
    globalThis.__v137BadgeCalls=[];
    globalThis.__v137OverlayCalls=[];
    globalThis.__v137OriginalSetBadgeCount=electron.app.setBadgeCount;
    globalThis.__v137OverlayDescriptor=Object.getOwnPropertyDescriptor(window,"setOverlayIcon");
    electron.app.setBadgeCount=function(count){
      const call={count,at:Date.now(),ok:true,error:null};
      globalThis.__v137BadgeCalls.push(call);
      try{return globalThis.__v137OriginalSetBadgeCount.call(electron.app,count)}
      catch(error){call.ok=false;call.error=String(error);throw error}
    };
    window.setOverlayIcon=function(image,description){
      const call={
        description:String(description??""),
        hasImage:Boolean(image),
        size:image?image.getSize():null,
        at:Date.now(),
        ok:true,
        error:null,
      };
      globalThis.__v137OverlayCalls.push(call);
      try{
        const original=globalThis.__v137OverlayDescriptor?.value ||
          Object.getPrototypeOf(window).setOverlayIcon;
        return original.call(window,image,description);
      }catch(error){call.ok=false;call.error=String(error);throw error}
    };
    return true;
  })()`);
  assert.equal(installed, true);
}

async function installRemotePreviewMock() {
  const installed = await main.evaluate(`(()=>{
    const handlers=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron")
      .ipcMain._invokeHandlers;
    const channel="image-studio:remote-preview";
    const original=handlers.get(channel);
    if(typeof original!=="function")throw new Error("Remote preview IPC handler is unavailable");
    if(!globalThis.__v137ImageStudioService)throw new Error("Image Studio service was not discovered");
    globalThis.__v137OriginalRemotePreview=original;
    globalThis.__v137RemotePreviewMockCalls=[];
    globalThis.__v137FailPreviewOnce=false;
    globalThis.__v137MockRemoteBase64=${JSON.stringify(mockedRemotePng.toString("base64"))};
    handlers.set(channel,async function(event,input){
      const call={id:input?.id??null,requestId:input?.requestId??null,status:"requested"};
      globalThis.__v137RemotePreviewMockCalls.push(call);
      if(globalThis.__v137FailPreviewOnce){
        globalThis.__v137FailPreviewOnce=false;
        call.status="synthetic-error";
        throw new Error("V137 synthetic preview failure once");
      }
      if(globalThis.__v137HoldNextRemotePreview){
        globalThis.__v137HoldNextRemotePreview=false;
        call.status="held";
        await new Promise(resolve=>{globalThis.__v137ReleaseRemotePreview=resolve});
        globalThis.__v137ReleaseRemotePreview=null;
      }
      const pending=globalThis.__v137ImageStudioService.pendingRemoteImages.get(input?.id);
      if(!pending)throw new Error("V137 pending remote image is unavailable");
      if(!pending.preview){
        const bytes=Buffer.from(globalThis.__v137MockRemoteBase64,"base64");
        const preview={
          base64:bytes.toString("base64"),
          mimeType:"image/png",
          width:128,
          height:96,
          extension:"png",
          byteLength:bytes.length,
          revisedPrompt:null,
        };
        pending.preview=preview;
        pending.group.remoteBytes+=bytes.length;
        globalThis.__v137ImageStudioService.pendingRemotePreviewBytes+=bytes.length;
      }
      const result=await original.call(this,event,input);
      call.status="success";
      return result;
    });
    return true;
  })()`);
  assert.equal(installed, true);
}

async function installRemoteOpenCapture() {
  const installed = await main.evaluate(`(()=>{
    const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
    if(globalThis.__v137OriginalOpenExternal)throw new Error("Remote open capture was installed twice");
    globalThis.__v137OriginalOpenExternal=electron.shell.openExternal;
    globalThis.__v137OpenExternalCalls=[];
    globalThis.__v137FailOpenExternalOnce=false;
    electron.shell.openExternal=async function(url){
      const call={url:String(url),status:"requested"};
      globalThis.__v137OpenExternalCalls.push(call);
      if(globalThis.__v137FailOpenExternalOnce){
        globalThis.__v137FailOpenExternalOnce=false;
        call.status="synthetic-error";
        throw new Error("V137 synthetic browser open failure once");
      }
      call.status="success";
    };
    return true;
  })()`);
  assert.equal(installed, true);
}

async function installGenerateResponseGate() {
  const installed = await main.evaluate(`(()=>{
    const handlers=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron")
      .ipcMain._invokeHandlers;
    const channel="image-studio:generate";
    const original=handlers.get(channel);
    if(typeof original!=="function")throw new Error("Image generation IPC handler is unavailable");
    if(globalThis.__v137OriginalImageGenerate)throw new Error("Generation gate was installed twice");
    globalThis.__v137OriginalImageGenerate=original;
    globalThis.__v137HoldConcurrentA=false;
    globalThis.__v137ConcurrentAResponseHeld=false;
    globalThis.__v137ReleaseConcurrentAResponse=null;
    globalThis.__v137HoldLateCommittedResponses=false;
    globalThis.__v137HeldLateCommittedCount=0;
    globalThis.__v137LateCommittedReleases=new Map();
    const lateCancelPrompts=${JSON.stringify(lateCancelPrompts)};
    handlers.set(channel,async function(event,input){
      const result=await original.call(this,event,input);
      if(globalThis.__v137HoldConcurrentA&&input?.prompt===${JSON.stringify(concurrentPrompts[0])}){
        globalThis.__v137ConcurrentAResponseHeld=true;
        await new Promise(resolve=>{globalThis.__v137ReleaseConcurrentAResponse=resolve});
        globalThis.__v137ReleaseConcurrentAResponse=null;
      }
      const lateIndex=lateCancelPrompts.indexOf(input?.prompt);
      if(globalThis.__v137HoldLateCommittedResponses&&lateIndex>=0){
        globalThis.__v137HeldLateCommittedCount+=1;
        await new Promise(resolve=>{globalThis.__v137LateCommittedReleases.set(lateIndex,resolve)});
        globalThis.__v137LateCommittedReleases.delete(lateIndex);
      }
      return result;
    });
    return true;
  })()`);
  assert.equal(installed, true);
}

async function installCanvasCloseGate() {
  const installed = await main.evaluate(`(()=>{
    const handlers=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron")
      .ipcMain._invokeHandlers;
    const channel="image-studio:canvas-close";
    const original=handlers.get(channel);
    if(typeof original!=="function")throw new Error("Canvas close IPC handler is unavailable");
    if(globalThis.__v137OriginalCanvasClose)throw new Error("Canvas close gate was installed twice");
    globalThis.__v137OriginalCanvasClose=original;
    globalThis.__v137HoldCanvasClose=false;
    globalThis.__v137CanvasCloseHeld=false;
    globalThis.__v137ReleaseCanvasClose=null;
    handlers.set(channel,async function(...args){
      if(globalThis.__v137HoldCanvasClose){
        globalThis.__v137HoldCanvasClose=false;
        globalThis.__v137CanvasCloseHeld=true;
        await new Promise(resolve=>{globalThis.__v137ReleaseCanvasClose=resolve});
        globalThis.__v137ReleaseCanvasClose=null;
      }
      return original.apply(this,args);
    });
    return true;
  })()`);
  assert.equal(installed, true);
}

async function installRemoteSaveCommitGate() {
  const installed = await main.evaluate(`(()=>{
    const handlers=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron")
      .ipcMain._invokeHandlers;
    const channel="image-studio:remote-save";
    const original=handlers.get(channel);
    if(typeof original!=="function")throw new Error("Remote save IPC handler is unavailable");
    if(globalThis.__v137OriginalRemoteSave)throw new Error("Remote save gate was installed twice");
    globalThis.__v137OriginalRemoteSave=original;
    globalThis.__v137HoldNextRemoteSaveCommit=false;
    globalThis.__v137RemoteSaveCommitHeld=false;
    globalThis.__v137ReleaseRemoteSaveCommit=null;
    handlers.set(channel,async function(...args){
      const result=await original.apply(this,args);
      if(globalThis.__v137HoldNextRemoteSaveCommit){
        globalThis.__v137HoldNextRemoteSaveCommit=false;
        globalThis.__v137RemoteSaveCommitHeld=true;
        await new Promise(resolve=>{globalThis.__v137ReleaseRemoteSaveCommit=resolve});
        globalThis.__v137ReleaseRemoteSaveCommit=null;
      }
      return result;
    });
    return true;
  })()`);
  assert.equal(installed, true);
}

async function installWorkspaceSaveGate() {
  const installed = await main.evaluate(`(()=>{
    const handlers=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron")
      .ipcMain._invokeHandlers;
    const channel="image-studio:save";
    const original=handlers.get(channel);
    if(typeof original!=="function")throw new Error("Image Studio save IPC handler is unavailable");
    if(globalThis.__v137OriginalWorkspaceSave)throw new Error("Workspace save gate was installed twice");
    globalThis.__v137OriginalWorkspaceSave=original;
    globalThis.__v137HoldNextWorkspaceSave=false;
    globalThis.__v137WorkspaceSaveGateStarted=false;
    globalThis.__v137ReleaseWorkspaceSave=null;
    handlers.set(channel,async function(...args){
      if(globalThis.__v137HoldNextWorkspaceSave){
        globalThis.__v137HoldNextWorkspaceSave=false;
        globalThis.__v137WorkspaceSaveGateStarted=true;
        await new Promise(resolve=>{globalThis.__v137ReleaseWorkspaceSave=resolve});
        globalThis.__v137ReleaseWorkspaceSave=null;
      }
      return original.apply(this,args);
    });
    return true;
  })()`);
  assert.equal(installed, true);
}

const api = (name, ...args) =>
  renderer.evaluate(`window.mingshen.${name}(${args.map((value) => JSON.stringify(value)).join(",")})`);

async function until(expression, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await renderer.evaluate(expression)) return;
    } catch (cause) {
      if (!/context|reload|destroyed|navigat/i.test(String(cause))) throw cause;
    }
    await sleep(60);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function untilMain(expression, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await main.evaluate(expression)) return;
    await sleep(60);
  }
  throw new Error(`Timed out in main process: ${expression}`);
}

async function click(selector) {
  await until(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    if(!element||element.disabled||element.closest("[hidden]"))return false;
    const style=getComputedStyle(element),box=element.getBoundingClientRect();
    if(style.display==="none"||style.visibility!=="visible"||box.width<1||box.height<1)return false;
    element.scrollIntoView({block:"nearest",inline:"nearest"});
    element.click();
    return true;
  })()`);
}

async function pointerClick(selector) {
  const point = await renderer.evaluate(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    if(!element||element.disabled||element.closest("[hidden]"))return null;
    element.scrollIntoView({block:"nearest",inline:"nearest"});
    const box=element.getBoundingClientRect();
    const x=(box.left+box.right)/2,y=(box.top+box.bottom)/2;
    const hit=document.elementFromPoint(x,y);
    return {
      x,y,width:box.width,height:box.height,
      hitOk:Boolean(hit&&(hit===element||element.contains(hit))),
      hit:hit?.outerHTML.slice(0,180)??null,
    };
  })()`);
  assert.ok(
    point && point.width > 0 && point.height > 0 && point.hitOk,
    `Cannot pointer-click ${selector}: ${JSON.stringify(point)}`,
  );
  await renderer.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await renderer.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await renderer.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function fill(selector, text) {
  await until(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    return Boolean(element&&!element.disabled&&element.getBoundingClientRect().width>0);
  })()`);
  await renderer.evaluate(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({block:"nearest"});
    element.focus();
    element.select();
    return true;
  })()`);
  if (text) await renderer.send("Input.insertText", { text });
  else {
    await renderer.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    await renderer.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
  }
}

async function setValue(selector, value) {
  await renderer.evaluate(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    if(!element)throw new Error("Missing input: "+${JSON.stringify(selector)});
    const prototype=element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(prototype,"value").set;
    setter.call(element,${JSON.stringify(value)});
    element.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:${JSON.stringify(value)}}));
    return true;
  })()`);
  await until(
    `document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`,
  );
}

async function selectValue(selector, value) {
  await renderer.evaluate(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)});
    if(!(element instanceof HTMLSelectElement))throw new Error("Missing select");
    element.value=${JSON.stringify(value)};
    element.dispatchEvent(new Event("change",{bubbles:true}));
    return true;
  })()`);
  await until(`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(value)}`);
}

async function assertImageOnlyForm() {
  const state = await renderer.evaluate(`(()=>{
    const form=document.querySelector(".model-form"),check=form?.querySelector(".model-form__image-only input");
    const visible=element=>Boolean(element&&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0&&!element.closest("[hidden]"));
    return {
      checked:check?.checked,disabled:check?.disabled,
      visibleTokenFields:[...form.querySelectorAll('[name="contextWindow"],[name="maxOutputTokens"]')].filter(visible).length,
      visibleFieldsets:[...form.querySelectorAll("fieldset")].filter(visible).length,
    };
  })()`);
  assert.deepEqual(state, { checked: true, disabled: true, visibleTokenFields: 0, visibleFieldsets: 0 });
}

async function clickButtonText(text) {
  await until(`(()=>{
    const element=[...document.querySelectorAll("button")].find(
      item=>!item.disabled&&item.textContent.trim()===${JSON.stringify(text)}
    );
    if(!element)return false;
    element.click();
    return true;
  })()`);
}

async function reload() {
  const marker = `v137-reload-${Date.now()}-${Math.random()}`;
  await renderer.evaluate(`window.__v137ReloadMarker=${JSON.stringify(marker)};true`);
  await renderer.send("Page.reload");
  await until(
    `window.__v137ReloadMarker!==${JSON.stringify(marker)}&&Boolean(document.querySelector(".app-shell"))`,
  );
}

async function activateMode(mode) {
  if ((await renderer.evaluate("document.querySelector('.app-shell')?.dataset.agentMode")) !== mode)
    await pointerClick(`[data-testid=agent-mode-${mode}]`);
  await until(`document.querySelector(".app-shell")?.dataset.agentMode===${JSON.stringify(mode)}`);
}

async function openSurface(name) {
  await click(`[data-surface-action="${name}"]`);
  await until(`(()=>{
    const host=document.querySelector('.app-studio-host[data-app-surface="${name}"]');
    const button=document.querySelector('[data-surface-action="${name}"]');
    return Boolean(
      host&&host.getBoundingClientRect().width>0&&
      button?.getAttribute("aria-pressed")==="true"
    );
  })()`);
  if (name === "image-studio")
    await until('Boolean(document.querySelector(".image-studio__header"))');
  if (name === "workstation")
    await until('Boolean(document.querySelector(".creative-workstation__header"))');
}

async function conversation() {
  await click(".surface-navigation button:first-child");
  await until(
    'document.querySelector(".app-body")?.hidden===false&&Boolean(document.querySelector("[data-testid=chat-composer-input]"))',
  );
}

async function capture(name) {
  await sleep(120);
  const result = await renderer.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const path = join(evidence, `${name}.png`);
  await writeFile(path, Buffer.from(result.data, "base64"));
  screenshots.push(path);
}

async function setViewport(width, height) {
  await renderer.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(100);
}

async function setLocaleFromCaption(locale) {
  const current = await renderer.evaluate("document.documentElement.lang");
  if (current !== locale) {
    await renderer.evaluate(
      `document.querySelector('.desktop-caption button[aria-label="中文 / English"]')?.click();true`,
    );
  }
  await until(`document.documentElement.lang===${JSON.stringify(locale)}`);
}

async function measureUnreadTopbar(name, expectedCount = 3) {
  const result = await renderer.evaluate(`(()=>{
    const topbar=document.querySelector(".app-topbar");
    const button=document.querySelector(".notification-read-all");
    const badge=document.querySelector(".notification-read-all__count");
    if(!topbar||!button||!badge)return null;
    const rect=element=>{const box=element.getBoundingClientRect();return{
      left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height
    }};
    const topbarBox=rect(topbar),buttonBox=rect(button),badgeBox=rect(badge);
    const centerX=(buttonBox.left+buttonBox.right)/2,centerY=(buttonBox.top+buttonBox.bottom)/2;
    const hit=document.elementFromPoint(centerX,centerY);
    let badgeVisible=badgeBox.left>=0&&badgeBox.right<=innerWidth&&
      badgeBox.top>=0&&badgeBox.bottom<=innerHeight;
    for(let ancestor=badge.parentElement;ancestor;ancestor=ancestor.parentElement){
      const style=getComputedStyle(ancestor),box=rect(ancestor);
      if(/hidden|clip|scroll|auto/.test(style.overflowX)&&
        (badgeBox.left<box.left-1||badgeBox.right>box.right+1))badgeVisible=false;
      if(/hidden|clip|scroll|auto/.test(style.overflowY)&&
        (badgeBox.top<box.top-1||badgeBox.bottom>box.bottom+1))badgeVisible=false;
    }
    return {
      width:innerWidth,height:innerHeight,
      documentWidth:document.documentElement.scrollWidth,
      bodyWidth:document.body.scrollWidth,
      topbar:topbarBox,button:buttonBox,badge:badgeBox,
      count:badge.textContent.trim(),
      disabled:button.disabled,
      insideTopbar:
        buttonBox.left>=topbarBox.left-1&&buttonBox.right<=topbarBox.right+1&&
        buttonBox.top>=topbarBox.top-1&&buttonBox.bottom<=topbarBox.bottom+1,
      badgeVisible,
      hitOk:Boolean(hit&&(button===hit||button.contains(hit))),
    };
  })()`);
  assert.ok(result, `${name}: unread topbar controls are missing`);
  assert.equal(result.count, String(expectedCount), `${name}: unread count mismatch`);
  assert.equal(result.disabled, false, `${name}: clear control must be enabled`);
  assert.ok(result.insideTopbar, `${name}: clear control left the topbar`);
  assert.ok(result.badgeVisible, `${name}: unread badge is clipped by the viewport or an ancestor`);
  assert.ok(result.hitOk, `${name}: unread clear control is covered`);
  assert.ok(result.button.left >= -1 && result.button.right <= result.width + 1);
  assert.ok(
    result.documentWidth <= result.width + 1 && result.bodyWidth <= result.width + 1,
    `${name}: horizontal clipping`,
  );
  geometry.push({ name: `${name}-unread`, ...result });
}

async function measureRemoteDialog(name) {
  const result = await renderer.evaluate(`(()=>{
    const dialog=document.querySelector("[data-testid=image-remote-dialog]");
    const preview=document.querySelector("[data-testid=image-remote-preview]");
    const footer=document.querySelector(".image-remote__actions");
    const controls=[...document.querySelectorAll(
      "[data-testid=image-remote-later],[data-testid=image-remote-discard],[data-testid=image-remote-open-browser],[data-testid=image-remote-save]"
    )];
    if(!dialog||!preview||!footer||controls.length!==4)return null;
    const rect=element=>{const box=element.getBoundingClientRect();return{
      left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height
    }};
    const describe=element=>{
      const box=rect(element),hit=document.elementFromPoint(
        (box.left+box.right)/2,(box.top+box.bottom)/2
      );
      return {
        label:element.getAttribute("data-testid"),
        ...box,
        hitOk:Boolean(hit&&(element===hit||element.contains(hit))),
      };
    };
    const boxes=controls.map(describe);
    const overlaps=[];
    for(let index=0;index<boxes.length;index++)for(let next=index+1;next<boxes.length;next++){
      const left=Math.max(boxes[index].left,boxes[next].left);
      const right=Math.min(boxes[index].right,boxes[next].right);
      const top=Math.max(boxes[index].top,boxes[next].top);
      const bottom=Math.min(boxes[index].bottom,boxes[next].bottom);
      if(right-left>0.5&&bottom-top>0.5)overlaps.push([boxes[index].label,boxes[next].label]);
    }
    return {
      width:innerWidth,height:innerHeight,
      documentWidth:document.documentElement.scrollWidth,
      bodyWidth:document.body.scrollWidth,
      dialog:rect(dialog),preview:rect(preview),footer:rect(footer),controls:boxes,overlaps,
    };
  })()`);
  assert.ok(result, `${name}: remote dialog controls are incomplete`);
  const insideViewport = (box) =>
    box.left >= -1 &&
    box.top >= -1 &&
    box.right <= result.width + 1 &&
    box.bottom <= result.height + 1;
  assert.ok(insideViewport(result.dialog), `${name}: dialog exceeds viewport`);
  assert.ok(insideViewport(result.preview), `${name}: preview exceeds viewport`);
  assert.ok(insideViewport(result.footer), `${name}: footer exceeds viewport`);
  assert.equal(result.overlaps.length, 0, `${name}: footer controls overlap`);
  for (const control of result.controls) {
    assert.ok(control.width > 0 && control.height > 0, `${name}: empty control`);
    assert.ok(insideViewport(control), `${name}: control exceeds viewport`);
    assert.ok(control.hitOk, `${name}: control is covered`);
  }
  assert.ok(
    result.documentWidth <= result.width + 1 && result.bodyWidth <= result.width + 1,
    `${name}: horizontal clipping`,
  );
  geometry.push({ name: `${name}-remote`, ...result });
}

async function setInspector(expanded) {
  const current = await renderer.evaluate(
    'document.querySelector("#image-studio-inspector")?.hidden===false',
  );
  if (current !== expanded) await click("[data-testid=image-inspector-toggle]");
  await until(
    `document.querySelector("#image-studio-inspector")?.hidden===${JSON.stringify(!expanded)}`,
  );
}

async function setLibrary(expanded) {
  const current = await renderer.evaluate(
    'document.querySelector("#image-studio-library")?.hidden===false',
  );
  if (current !== expanded) await click("[data-testid=image-library-toggle]");
  await until(
    `document.querySelector("#image-studio-library")?.hidden===${JSON.stringify(!expanded)}`,
  );
}

async function completeUnreadSession(session, token) {
  await api("setActiveNotificationSession", null);
  await api("sendChat", { sessionId: session.id, text: token });
  await until(
    `(async()=>{const state=await window.mingshen.getCompletionNotifications();return state.unread.some(item=>item.sessionId===${JSON.stringify(session.id)})})()`,
    60_000,
  );
}

async function saveResult(success, cause) {
  await mkdir(evidence, { recursive: true });
  const resultPath = join(evidence, success ? "result.json" : "failure.json");
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        success,
        passed,
        requests,
        exceptions,
        serviceErrors,
        screenshots,
        geometry,
        failure: cause ? String(cause.stack || cause) : null,
        boundaries: [
          "Uses an isolated temporary profile and workspace plus a loopback-only synthetic provider.",
          "Only the remote-preview PNG payload is injected in the main process; pending registration, prompt provenance, candidate save, asset persistence and SQLite writes remain on production paths.",
          "The real HTTPS/DNS/private-address/redirect downloader is intentionally not exercised; those security rules remain covered by unit tests.",
          "Badge and overlay invocation is observed through Electron methods; native taskbar pixels are not visually verified.",
          "Viewport geometry is not a full Windows DPI, screen-reader or accessibility certification.",
          "No user database, real credential, paid provider, remote asset, installer, cloud write or Git change is used.",
        ],
      },
      null,
      2,
    ),
  );
  return resultPath;
}

try {
  await mkdir(workspace, { recursive: true });
  await mkdir(profile, { recursive: true });
  await mkdir(evidence, { recursive: true });
  await writeFile(join(workspace, "README.md"), "# V137 isolated smoke workspace\n");

  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
  const mainPort = await freePort();
  let rendererPort = await freePort();
  while (rendererPort === mainPort) rendererPort = await freePort();

  let executable;
  try {
    executable = experimentalExecutable();
  } catch (cause) {
    throw new Error(
      `${cause instanceof Error ? cause.message : String(cause)} Build the current desktop out files before running this smoke.`,
    );
  }
  const environment = {
    ...process.env,
    MSH_EXPERIMENTAL: "1",
    MSH_USER_DATA_DIR: profile,
    MSH_DISABLE_AUTO_DEPENDENCIES: "1",
    MSH_NOTIFICATION_FIXTURE: "1",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  child = spawn(
    executable,
    [`--inspect=${mainPort}`, ".", `--remote-debugging-port=${rendererPort}`],
    {
      cwd: resolve("apps/desktop"),
      env: environment,
      windowsHide: true,
      stdio: "ignore",
    },
  );

  main = await connect(mainPort, "main");
  await main.send("Runtime.enable");
  main.evaluate = async (expression) => {
    const result = await main.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    return result.result.value;
  };
  await installDnsFixture();
  await installNetworkGuard(fixtureOrigin);

  renderer = await connect(rendererPort, "renderer");
  await renderer.send("Runtime.enable");
  await renderer.send("Page.enable");
  await until('Boolean(document.querySelector(".policy-consents"))');
  await renderer.evaluate(
    `Promise.resolve(window.mingshen.readPolicy("terms","zh-CN")).catch(()=>null)`,
  );
  await sleep(5_200);
  await renderer.evaluate(
    'document.querySelectorAll(".policy-consents input").forEach((input)=>input.click());true',
  );
  await clickButtonText("同意并继续");
  await until('Boolean([...document.querySelectorAll(".policy-dialog button")].find(button=>button.textContent.trim()==="开始使用"&&!button.disabled))');
  await clickButtonText("开始使用");
  await until('!document.querySelector(".policy-dialog")');
  if (await renderer.evaluate('Boolean(document.querySelector("#update-title"))')) {
    await clickButtonText(await renderer.evaluate("document.documentElement.lang === 'en' ? 'Later' : '稍后再说'"));
    await until('!document.querySelector("#update-title")');
  }
  await until('Boolean(document.querySelector(".setup-shell"))');
  await renderer.evaluate(
    'localStorage.setItem("mingshen.agent-mode","code");localStorage.setItem("mingshen.theme","day");true',
  );

  await installBadgeCapture();
  await renderer.evaluate(
    `(async()=>{
      for(const server of await window.mingshen.listMcpServers())if(server.enabled)await window.mingshen.setMcpServerEnabled(server.id,false);
      await window.mingshen.setModelRetrySettings({maxRetries:0});
      await window.mingshen.configureCompletionNotifications({
        nativeEnabled:false,
        approvalEnabled:false,
        questionEnabled:false,
        taskbarEnabled:true,
        showPreview:false,
        sound:false
      });
      return true;
    })()`,
  );

  await setViewport(1440, 900);
  await fill('.provider-form input[placeholder="Chatgpt Pro"]', "V137 Images protocol fixture");
  await fill('.provider-form input[placeholder="https://api.your-domain.com/v1"]', `${fixtureOrigin}/v1`);
  await fill('.provider-form input[placeholder="sk-..."]', `fixture-${randomUUID()}`);
  await selectValue(".provider-form select", "openai_images");
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".provider-form [name=cacheMode]"))'), false);
  await capture("images-provider-create");
  await pointerClick('.provider-form button[type="submit"]');
  await until('Boolean(document.querySelector(".provider-section"))&&!document.querySelector(".provider-form")');
  imageProvider = (await api("bootstrap")).providers.find(item => item.name === "V137 Images protocol fixture");
  assert.equal(imageProvider?.protocol, "openai_images");
  await clickButtonText("手动添加");
  await assertImageOnlyForm();
  await fill('.model-form input[placeholder="gpt-6.1-sol"]', "v137-image-manual");
  await pointerClick('.model-form button[type="submit"]');
  await until('Boolean(document.querySelector(".app-shell"))&&!document.querySelector(".model-form")');
  imageProvider = (await api("bootstrap")).providers.find(item => item.id === imageProvider.id);
  const manualModel = imageProvider.models.find(item => item.modelId === "v137-image-manual");
  assert.deepEqual(manualModel.outputModalities, ["image"]);
  assert.equal(manualModel.toolCalls, false);
  assert.deepEqual(manualModel.reasoningLevels, []);
  passed.push("Creating an OpenAI Images provider through the real UI hides caching fields; manually added models are automatically checked and locked to image-only with no visible token or modality configuration.");
  await pointerClick('.app-topbar button[aria-label="打开设置"]');
  await clickButtonText("供应商与模型");
  await until('Boolean(document.querySelector(".provider-models"))');
  await clickButtonText("拉取模型列表");
  await until('Boolean(document.querySelector(".discovered-models .model-chip"))');
  await pointerClick(".discovered-models .model-chip");
  await assertImageOnlyForm();
  await capture("images-provider-discovered-model");
  await pointerClick('.model-form button[type="submit"]');
  await until('!document.querySelector(".model-form")');
  imageProvider = (await api("bootstrap")).providers.find(item => item.id === imageProvider.id);
  imageModel = imageProvider.models.find(item => item.modelId === "v137-image");
  assert.deepEqual(imageModel.outputModalities, ["image"]);
  assert.equal(imageModel.parallelToolCalls, false);
  await clickButtonText("连接");
  await until('Boolean(document.querySelector(".provider-connection-settings"))');
  assert.equal(await renderer.evaluate('Boolean(document.querySelector(".provider-cache-settings"))'), false);
  await capture("images-provider-connection");
  await pointerClick('.settings-content__header button[aria-label="关闭设置"]');
  await until('!document.querySelector(".settings-workspace")');
  passed.push("Models selected from provider discovery are also image-only; saved Images providers expose connection settings without text-cache controls.");

  provider = await api("createProvider", {
    name: "V137 isolated provider",
    baseUrl: `${fixtureOrigin}/v1`,
    protocol: "openai_responses",
    authMode: "bearer",
    apiKey: `fixture-${randomUUID()}`,
    keyLabel: "Local fixture",
    neverReveal: true,
  });
  let catalog = await api("createModel", {
    providerId: provider.id,
    modelId: "v137-text",
    displayName: "V137 text fixture",
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    inputModalities: ["text"],
    outputModalities: ["text"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  textModel = catalog.models.find((model) => model.modelId === "v137-text");
  catalog = await api("createModel", {
    providerId: provider.id,
    modelId: "v137-image",
    displayName: "V137 image fixture",
    contextWindow: 1,
    maxOutputTokens: 1,
    inputModalities: ["text"],
    outputModalities: ["image"],
    toolCalls: false,
    parallelToolCalls: false,
    reasoningLevels: [],
    anthropicNoneBehavior: "disabled",
  });
  const legacyImageModel = catalog.models.find((model) => model.modelId === "v137-image");
  assert.ok(textModel && imageModel, "Synthetic text and image models were not created");
  await api("setProjectTrust", workspace, true);

  const sessionInput = {
    providerId: provider.id,
    modelId: textModel.id,
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
  };
  codeSession = await api("createSession", {
    ...sessionInput,
    title: "V137 code root",
    workspacePath: workspace,
    agentMode: "code",
  });
  workSession = await api("createSession", {
    ...sessionInput,
    title: "V137 work root",
    workspacePath: workspace,
    agentMode: "work",
  });
  chatSession = await api("createSession", {
    ...sessionInput,
    title: "V137 chat root",
    workspacePath: null,
    agentMode: "chat",
    chatNetworkEnabled: false,
  });
  assert.deepEqual(
    [codeSession.agentMode, workSession.agentMode, chatSession.agentMode],
    ["code", "work", "chat"],
  );

  await api("desktopAction", "tray");
  await api("setActiveNotificationSession", null);
  await completeUnreadSession(codeSession, "V137_UNREAD_CODE");
  await completeUnreadSession(workSession, "V137_UNREAD_WORK");
  await completeUnreadSession(chatSession, "V137_UNREAD_CHAT");
  const unreadState = await api("getCompletionNotifications");
  assert.deepEqual(
    new Set(unreadState.unread.map((item) => item.sessionId)),
    new Set([codeSession.id, workSession.id, chatSession.id]),
    "All three root Agent modes must contribute unread state",
  );
  assert.equal(unreadState.badgeCount, 3);
  await until(
    `(async()=>{const state=await window.mingshen.getCompletionNotifications();return state.unread.length===3&&state.badgeCount===3})()`,
  );
  await untilMain(
    'globalThis.__v137BadgeCalls?.some(call=>call.count===3&&call.ok)&&globalThis.__v137OverlayCalls?.some(call=>call.hasImage&&/3 unread/.test(call.description)&&call.ok)',
  );
  await main.evaluate('globalThis.__v137NotificationWindow.showInactive();true');
  assert.equal(
    await main.evaluate('globalThis.__v137NotificationWindow.isVisible()&&!globalThis.__v137NotificationWindow.isMinimized()'),
    true,
    "The desktop smoke window must be visible for screenshot and pointer checks",
  );
  passed.push(
    "Code, Work and Chat root runs create three persisted unread completions; production notification state, badge count 3, non-null overlay image and descriptions are observed through Electron.",
  );

  await reload();
  await until(
    `document.querySelector(".notification-read-all__count")?.textContent.trim()==="3"`,
  );
  for (const mode of ["code", "work", "chat"]) {
    await activateMode(mode);
    await until(
      `document.querySelector(".notification-read-all__count")?.textContent.trim()==="3"`,
    );
  }
  passed.push("The global unread count remains 3 when switching Code, Work and Chat before any clear action.");

  await activateMode("code");
  await setViewport(1440, 900);
  await setLocaleFromCaption("zh-CN");
  await measureUnreadTopbar("unread-zh-1440");
  await capture("unread-zh-1440");
  await setViewport(800, 600);
  await measureUnreadTopbar("unread-zh-800");
  await capture("unread-zh-800");
  await setViewport(680, 600);
  await measureUnreadTopbar("unread-zh-680");
  await capture("unread-zh-680");
  await setLocaleFromCaption("en");
  await setViewport(800, 600);
  await measureUnreadTopbar("unread-en-800");
  await capture("unread-en-800");
  await setViewport(680, 600);
  await measureUnreadTopbar("unread-en-680");
  await capture("unread-en-680");
  await setLocaleFromCaption("zh-CN");
  await setViewport(1440, 900);
  await activateMode("code");

  await pointerClick(".notification-read-all");
  await until(
    `(async()=>{const state=await window.mingshen.getCompletionNotifications();return state.unread.length===0&&state.badgeCount===0})()`,
  );
  await until(
    'document.querySelector(".notification-read-all")?.disabled===true&&!document.querySelector(".notification-read-all__count")',
  );
  await untilMain(
    'globalThis.__v137BadgeCalls?.some(call=>call.count===0&&call.ok)&&globalThis.__v137OverlayCalls?.some(call=>!call.hasImage&&call.description===""&&call.ok)',
  );
  const persistedUnread = await main.evaluate(`(()=>{
    const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json");
    const {app}=require("electron"),path=require("node:path");
    if(path.resolve(app.getPath("userData"))!==path.resolve(${JSON.stringify(profile)}))
      throw new Error("Smoke is not using its isolated profile");
    const {DatabaseSync}=process.getBuiltinModule("node:sqlite");
    const db=new DatabaseSync(path.join(app.getPath("userData"),"mingshen.db"),{readOnly:true});
    try{
      const row=db.prepare("select value_json from app_settings where key=?").get("desktop.completions");
      return row?JSON.parse(row.value_json):null;
    }finally{db.close()}
  })()`);
  assert.deepEqual(persistedUnread, []);
  for (const mode of ["code", "work", "chat"]) {
    await activateMode(mode);
    await until('document.querySelector(".notification-read-all")?.disabled===true');
  }
  await reload();
  await until(
    `(async()=>{const state=await window.mingshen.getCompletionNotifications();return state.unread.length===0&&state.badgeCount===0})()`,
  );
  await until('document.querySelector(".notification-read-all")?.disabled===true');
  passed.push(
    "The real topbar clear control removes all three unread records, writes an empty desktop.completions setting, clears badge/overlay state, and stays cleared through mode switches and reload.",
  );

  await activateMode("code");
  let imageWorkspace = await api("getImageStudioWorkspace");
  imageWorkspace = await api("saveImageStudioWorkspace", {
    ...imageWorkspace,
    imageModel: { providerId: imageProvider.id, modelId: imageModel.id },
    textModel: { providerId: provider.id, modelId: textModel.id },
    prompt: remotePrompt,
    negativePrompt: remoteNegative,
    generation: {
      ...imageWorkspace.generation,
      imageCount: 3,
      referenceEnabled: false,
      transparentBackground: false,
    },
  });
  assert.equal(imageWorkspace.generation.imageCount, 3);

  await openSurface("image-studio");
  await setViewport(1440, 900);
  await click("[data-testid=image-canvas-new]");
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return Boolean(workspace.activeDocumentId&&workspace.documents.some(document=>document.id===workspace.activeDocumentId))})()`,
  );
  raceCanvasId = (await api("getImageStudioWorkspace")).activeDocumentId;
  assert.ok(raceCanvasId, "The image-studio race fixture canvas was not created");
  await setInspector(true);
  await pointerClick('.image-studio__model-row button[aria-label="语言模型"]');
  await until('Boolean(document.querySelector(".model-picker__panel"))');
  const textPicker = await renderer.evaluate('document.querySelector(".model-picker__panel")?.innerText??""');
  assert.match(textPicker, /V137 isolated provider/);
  assert.doesNotMatch(textPicker, /V137 Images protocol fixture/);
  await pointerClick('.image-studio__model-row button[aria-label="语言模型"]');
  await until('!document.querySelector(".model-picker__panel")');
  passed.push("Image Studio keeps the dedicated Images model separate from the language-model picker, which contains only the text provider.");
  await until(
    `document.querySelector("[data-testid=image-prompt]")?.value===${JSON.stringify(remotePrompt)}`,
  );
  await until(
    `document.querySelector("[data-testid=image-negative-prompt]")?.value===${JSON.stringify(remoteNegative)}`,
  );
  await discoverImageStudioService();
  await installRemotePreviewMock();
  await installRemoteOpenCapture();
  await installGenerateResponseGate();
  await installCanvasCloseGate();
  await installRemoteSaveCommitGate();
  await installWorkspaceSaveGate();

  const queuedCancelPrompt = "V137_QUEUED_CANCEL: must never reach the provider";
  const queuedRequestCount = requests.length;
  await main.evaluate("globalThis.__v137HoldNextWorkspaceSave=true");
  await fill("[data-testid=image-prompt]", queuedCancelPrompt);
  await click("[data-testid=image-generate]");
  await untilMain("globalThis.__v137WorkspaceSaveGateStarted===true", 60_000);
  await until(
    'document.querySelectorAll("[data-testid=image-generation-request][data-status=running]").length===1',
  );
  await renderer.evaluate(`(()=>{
    const request=document.querySelector("[data-testid=image-generation-request][data-status=running]");
    const cancel=request?.querySelector("[data-testid=image-generation-cancel]");
    if(!(cancel instanceof HTMLButtonElement))throw new Error("Queued-cancel control is unavailable");
    cancel.click();
    return true;
  })()`);
  await until(
    `[...document.querySelectorAll("[data-testid=image-generation-request]")].some(item=>item.textContent.includes(${JSON.stringify(queuedCancelPrompt)})&&item.getAttribute("data-status")==="cancelled")`,
  );
  assert.equal(
    await main.evaluate("globalThis.__v137ImageStudioService.activeGenerationRequests.size"),
    0,
    "A request cancelled before dispatch must not occupy a backend generation slot",
  );
  await main.evaluate("globalThis.__v137ReleaseWorkspaceSave()");
  await sleep(250);
  assert.equal(
    requests
      .slice(queuedRequestCount)
      .some(
        (request) =>
          typeof request.body?.prompt === "string" &&
          request.body.prompt.includes(queuedCancelPrompt),
      ),
    false,
    "A generation cancelled while workspace flush was pending must never reach the provider",
  );
  await until('Boolean(document.querySelector("[data-testid=image-generation-clear-finished]"))');
  await pointerClick("[data-testid=image-generation-clear-finished]");
  await until('!document.querySelector("[data-testid=image-generation-request]")');
  passed.push(
    "A generation queued behind a deferred workspace save can be cancelled before IPC dispatch; it releases the local slot, never reaches the provider, and is removed without consuming a backend generation slot.",
  );

  await setValue("[data-testid=image-prompt]", remotePrompt);
  await setValue("[data-testid=image-negative-prompt]", remoteNegative);
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt===${JSON.stringify(remotePrompt)}&&workspace.negativePrompt===${JSON.stringify(remoteNegative)}})()`,
  );
  await main.evaluate("globalThis.__v137HoldNextRemotePreview=true");
  await click("[data-testid=image-generate]");
  await until('Boolean(document.querySelector("[data-testid=image-remote-dialog]"))', 60_000);
  await until(
    'Boolean(document.querySelector(".image-remote__preview [role=status]")&&document.querySelector("[data-testid=image-remote-open-browser]")&&!document.querySelector("[data-testid=image-remote-open-browser]").disabled)',
    60_000,
  );
  const openBaseline = {
    assets: (await api("getImageStudioWorkspace")).assets.length,
    prompt: (await api("getImageStudioWorkspace")).prompt,
    pending: await main.evaluate("globalThis.__v137ImageStudioService.pendingRemoteImages.size"),
  };
  assert.equal(openBaseline.pending, 3, "The initial remote review queue must contain all three candidates");
  await capture("remote-browser-loading");
  await pointerClick("[data-testid=image-remote-open-browser]");
  await untilMain("globalThis.__v137OpenExternalCalls.length===1");
  await untilMain("globalThis.__v137DnsFixtureCalls.length===1");
  assert.deepEqual(
    await main.evaluate("globalThis.__v137DnsFixtureCalls[0]"),
    { hostname: "images.example.com", options: { all: true, verbatim: true } },
  );
  assert.deepEqual(
    await main.evaluate("globalThis.__v137OpenExternalCalls[0]"),
    { url: "https://images.example.com/v137-a.png", status: "success" },
  );
  const openDuringLoadingWorkspace = await api("getImageStudioWorkspace");
  assert.equal(openDuringLoadingWorkspace.assets.length, openBaseline.assets);
  assert.equal(openDuringLoadingWorkspace.prompt, openBaseline.prompt);
  assert.equal(
    await main.evaluate("globalThis.__v137ImageStudioService.pendingRemoteImages.size"),
    openBaseline.pending,
  );
  await main.evaluate("globalThis.__v137ReleaseRemotePreview()");
  await until(
    'Boolean(document.querySelector("[data-testid=image-remote-preview]")?.complete&&document.querySelector("[data-testid=image-remote-preview]")?.naturalWidth>0)',
    60_000,
  );
  assert.equal(
    await renderer.evaluate(
      'document.querySelectorAll("[data-testid^=image-remote-candidate-]").length',
    ),
    3,
  );
  await click("[data-testid=image-remote-prompts] summary");
  const initialProvenance = await renderer.evaluate(
    'document.querySelector("[data-testid=image-remote-prompts]")?.innerText??""',
  );
  assert.match(initialProvenance, new RegExp(remotePrompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    initialProvenance,
    new RegExp(remoteNegative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(initialProvenance, /v137 remote revised A/);
  await pointerClick("[data-testid=image-remote-open-browser]");
  await untilMain("globalThis.__v137OpenExternalCalls.length===2");
  assert.equal(
    await main.evaluate("globalThis.__v137OpenExternalCalls[1].url"),
    "https://images.example.com/v137-a.png",
  );
  passed.push(
    "A real URL-only image response opens the remote review dialog; the staged loading fixture can open candidate one in the captured system browser without saving it, changing prompts or consuming its pending record; the same control remains available after the preview becomes ready.",
  );

  await click("[data-testid=image-remote-later]");
  await until(
    '!document.querySelector("[data-testid=image-remote-dialog]")&&Boolean(document.querySelector("[data-testid=image-remote-pending]"))',
  );
  await click("[data-testid=image-remote-pending]");
  await until('Boolean(document.querySelector("[data-testid=image-remote-preview]"))');
  await setValue("[data-testid=image-prompt]", laterPrompt);
  await setValue("[data-testid=image-negative-prompt]", laterNegative);
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt===${JSON.stringify(laterPrompt)}&&workspace.negativePrompt===${JSON.stringify(laterNegative)}})()`,
  );

  await main.evaluate(
    'globalThis.__v137FailPreviewOnce=true;true',
  );
  await pointerClick("[data-testid=image-remote-discard]");
  await until(
    'Boolean(document.querySelector(".image-remote__state[role=alert] button"))',
    60_000,
  );
  await untilMain(
    `globalThis.__v137ImageStudioService.pendingRemoteImages.size===${openBaseline.pending - 1}`,
  );
  assert.match(
    await renderer.evaluate(
      'document.querySelector(".image-remote__state[role=alert]")?.innerText??""',
    ),
    /V137 synthetic preview failure once/,
  );
  const openErrorBaseline = await api("getImageStudioWorkspace");
  await main.evaluate("globalThis.__v137FailOpenExternalOnce=true");
  await pointerClick("[data-testid=image-remote-open-browser]");
  await until('Boolean(document.querySelector("[data-testid=image-remote-open-error]"))', 60_000);
  await capture("remote-browser-open-error");
  assert.match(
    await renderer.evaluate(
      'document.querySelector("[data-testid=image-remote-open-error]")?.innerText??""',
    ),
    /V137 synthetic browser open failure once/,
  );
  assert.match(
    await renderer.evaluate(
      'document.querySelector(".image-remote__state[role=alert]")?.innerText??""',
    ),
    /V137 synthetic preview failure once/,
  );
  const openErrorWorkspace = await api("getImageStudioWorkspace");
  assert.equal(openErrorWorkspace.assets.length, openErrorBaseline.assets.length);
  assert.equal(openErrorWorkspace.prompt, openErrorBaseline.prompt);
  assert.equal(
    await main.evaluate("globalThis.__v137ImageStudioService.pendingRemoteImages.size"),
    openBaseline.pending - 1,
  );
  await pointerClick("[data-testid=image-remote-open-browser]");
  await until('!document.querySelector("[data-testid=image-remote-open-error]")');
  await untilMain("globalThis.__v137OpenExternalCalls.length===4");
  assert.equal(
    await main.evaluate("globalThis.__v137OpenExternalCalls[2].url"),
    "https://images.example.com/v137-b.png",
  );
  assert.equal(
    await main.evaluate("globalThis.__v137OpenExternalCalls[3].url"),
    "https://images.example.com/v137-b.png",
  );
  await pointerClick(".image-remote__state[role=alert] button");
  await until(
    'Boolean(document.querySelector("[data-testid=image-remote-preview]"))',
    60_000,
  );
  if (!(await renderer.evaluate('Boolean(document.querySelector("[data-testid=image-remote-prompts]")?.open)'))) {
    await click("[data-testid=image-remote-prompts] summary");
  }
  const retryProvenance = await renderer.evaluate(
    'document.querySelector("[data-testid=image-remote-prompts]")?.innerText??""',
  );
  assert.match(retryProvenance, /v137 remote revised B/);

  const assetsBeforeRemoteSave = (await api("getImageStudioWorkspace")).assets.length;
  await main.evaluate("globalThis.__v137HoldNextRemoteSaveCommit=true");
  await pointerClick("[data-testid=image-remote-save]");
  await untilMain("globalThis.__v137RemoteSaveCommitHeld===true", 60_000);
  await pointerClick("[data-testid=image-remote-later]");
  await until('!document.querySelector("[data-testid=image-remote-dialog]")');
  await main.evaluate("globalThis.__v137HoldCanvasClose=true");
  await pointerClick(
    `[data-testid=image-canvas-tab][data-canvas-id="${raceCanvasId}"] .image-workspace__tab-close`,
  );
  await untilMain("globalThis.__v137CanvasCloseHeld===true", 60_000);
  await main.evaluate("globalThis.__v137ReleaseRemoteSaveCommit()");
  await main.evaluate("globalThis.__v137ReleaseCanvasClose()");
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.assets.length===${assetsBeforeRemoteSave + 1}})()`,
    60_000,
  );
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return !workspace.documents.some(document=>document.id===${JSON.stringify(raceCanvasId)})})()`,
    60_000,
  );
  assert.equal(
    await renderer.evaluate(
      `!document.querySelector('[data-testid=image-canvas-tab][data-canvas-id="${raceCanvasId}"]')`,
    ),
    true,
    "The remote-save callback must not recreate a canvas closed while its IPC was pending",
  );
  const workspaceAfterRemoteSave = await api("getImageStudioWorkspace");
  remoteAsset = workspaceAfterRemoteSave.assets.find(
    (asset) =>
      asset.prompt === remotePrompt &&
      asset.negativePrompt === remoteNegative &&
      asset.revisedPrompt === "v137 remote revised B",
  );
  assert.ok(remoteAsset, "The second remote candidate was not persisted with generation provenance");
  assert.notEqual(remoteAsset.prompt, laterPrompt);
  assert.notEqual(remoteAsset.negativePrompt, laterNegative);
  assert.equal(remoteAsset.promptOrigin, "mingshen_generated");
  assert.equal(remoteAsset.promptMetadataVersion, 1);
  await untilMain('globalThis.__v137ImageStudioService.pendingRemoteImages.size===1');
  await until(
    'document.querySelector("[data-testid=image-studio]")?.getAttribute("data-navigation-busy")!=="true"',
  );
  await pointerClick("[data-testid=image-remote-pending]");
  await until(
    'Boolean(document.querySelector("[data-testid=image-remote-dialog]"))&&Boolean(document.querySelector("[data-testid=image-remote-preview]"))&&!document.querySelector(".image-remote__tabs")',
    60_000,
  );
  await pointerClick("[data-testid=image-remote-discard]");
  await until(
    '!document.querySelector("[data-testid=image-remote-dialog]")&&!document.querySelector("[data-testid=image-remote-pending]")',
  );
  assert.equal(
    await main.evaluate("globalThis.__v137ImageStudioService.pendingRemoteImages.size"),
    0,
  );
  passed.push(
    "Later-process single-candidate failure exposes a real retry path; retrying and saving exercises the unmodified remote-save IPC and SQLite provenance path, then discarding the final candidate leaves no pending remote records.",
  );

  await setInspector(true);
  await fill("[data-testid=image-prompt]", normalPrompt);
  await fill("[data-testid=image-negative-prompt]", normalNegative);
  await click(".image-choice-grid--count button:nth-child(1)");
  await until(
    'document.querySelector(".image-choice-grid--count button:nth-child(1)")?.getAttribute("aria-pressed")==="true"',
  );
  const assetsBeforeNormal = (await api("getImageStudioWorkspace")).assets.length;
  await click("[data-testid=image-generate]");
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.assets.length===${assetsBeforeNormal + 1}})()`,
    60_000,
  );
  const workspaceAfterNormal = await api("getImageStudioWorkspace");
  normalAsset = workspaceAfterNormal.assets.find(
    (asset) =>
      asset.prompt === normalPrompt &&
      asset.negativePrompt === normalNegative &&
      asset.revisedPrompt === "v137 normal revised fixture",
  );
  assert.ok(normalAsset, "The normal Base64 image was not saved with prompt metadata");
  assert.equal(normalAsset.promptOrigin, "mingshen_generated");
  assert.equal(normalAsset.promptMetadataVersion, 1);
  passed.push(
    "A normal provider Base64 image still saves through the ordinary asset path with its own positive, negative and revised prompt metadata.",
  );

  const edited = await api("generateImageStudioImage", {
    requestId: `edit-${randomUUID()}`,
    model: { providerId: imageProvider.id, modelId: imageModel.id },
    prompt: "V137_REFERENCE_EDIT: preserve the selected fixture",
    generation: { ...workspaceAfterNormal.generation, imageCount: 1, referenceEnabled: true },
    referenceAssetIds: [normalAsset.id],
  });
  assert.equal(edited.generatedAssets.length, 1);
  assert.equal(requests.at(-1).path, "/v1/images/edits");
  const legacyGenerated = await api("generateImageStudioImage", {
    requestId: `legacy-${randomUUID()}`,
    model: { providerId: provider.id, modelId: legacyImageModel.id },
    prompt: "V137_LEGACY: Responses image configuration remains supported",
    generation: { ...workspaceAfterNormal.generation, imageCount: 1, referenceEnabled: false },
  });
  assert.equal(legacyGenerated.generatedAssets.length, 1);
  await api("saveImageStudioWorkspace", {
    ...await api("getImageStudioWorkspace"),
    prompt: normalPrompt,
    negativePrompt: normalNegative,
  });
  await reload();
  await openSurface("image-studio");
  passed.push("The dedicated Images protocol sends references as real multipart edits, while an existing Responses image-only configuration still generates through the Images JSON endpoint; neither sends text-chat or custom asynchronous fields.");

  const expectedAssetIds = [remoteAsset.id, normalAsset.id].sort();
  const currentAssetIds = () =>
    api("getImageStudioWorkspace").then((value) =>
      value.assets
        .map((asset) => asset.id)
        .filter((id) => expectedAssetIds.includes(id))
        .sort(),
    );
  assert.deepEqual(await currentAssetIds(), expectedAssetIds);
  await conversation();
  await openSurface("workstation");
  await openSurface("image-studio");
  assert.deepEqual(await currentAssetIds(), expectedAssetIds);
  await reload();
  await activateMode("code");
  await openSurface("image-studio");
  assert.deepEqual(await currentAssetIds(), expectedAssetIds);
  passed.push(
    "Both saved assets remain available across Conversation, Workstation and Image Studio transitions and after a full renderer reload.",
  );

  const importedForStaleResponse = await api("importImageStudioAssets", [
    {
      name: "V137 stale response sentinel.png",
      dataUrl: `data:image/png;base64,${normalPng.toString("base64")}`,
      source: "imported",
    },
  ]);
  const staleResponseAsset = importedForStaleResponse.assets.find(
    (asset) => asset.name === "V137 stale response sentinel.png",
  );
  assert.ok(staleResponseAsset, "The stale-response sentinel asset was not imported");
  await reload();
  await activateMode("code");
  await openSurface("image-studio");
  await setViewport(1440, 900);
  await setInspector(true);
  const assetsBeforeConcurrent = (await api("getImageStudioWorkspace")).assets.length;
  await main.evaluate("globalThis.__v137HoldConcurrentA=true");
  for (const [index, prompt] of concurrentPrompts.entries()) {
    await fill("[data-testid=image-prompt]", prompt);
    await fill("[data-testid=image-negative-prompt]", `V137_CONCURRENT_NEGATIVE_${index + 1}`);
    await click("[data-testid=image-generate]");
    await until(
      `document.querySelectorAll("[data-testid=image-generation-request][data-status=running]").length===${index + 1}`,
    );
  }
  const concurrentProviderDeadline = Date.now() + 45_000;
  while (concurrentProviderWaiters.size < 3 && Date.now() < concurrentProviderDeadline) {
    await sleep(25);
  }
  await untilMain("globalThis.__v137ImageStudioService.activeGenerationRequests.size===3");
  assert.equal(concurrentProviderWaiters.size, 3, "All three requests must reach the provider before any result is released");
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-testid=image-generate]")?.disabled'),
    true,
    "A fourth generation must be blocked while three are active",
  );
  assert.equal(
    await renderer.evaluate(
      'document.querySelector("[data-testid=image-generation-active-count]")?.textContent?.includes("3/3")',
    ),
    true,
  );
  await renderer.evaluate('document.querySelector("[data-testid=image-generation-request]")?.scrollIntoView({block:"center"});true');
  await capture("generation-three-active-1440");
  await setViewport(680, 600);
  await setLibrary(false);
  await setInspector(true);
  await renderer.evaluate('document.querySelector("[data-testid=image-generation-request]")?.scrollIntoView({block:"center"});true');
  await capture("generation-three-active-680");
  await setViewport(1440, 900);
  await setLibrary(true);
  await setInspector(true);
  await fill("[data-testid=image-prompt]", concurrentDraft);
  await renderer.evaluate(`(()=>{
    const request=[...document.querySelectorAll("[data-testid=image-generation-request]")]
      .find(item=>item.textContent.includes(${JSON.stringify(concurrentPrompts[2])}));
    const cancel=request?.querySelector("[data-testid=image-generation-cancel]");
    if(!(cancel instanceof HTMLButtonElement))throw new Error("Concurrent request cancel control is unavailable");
    cancel.click();
    return true;
  })()`);
  await until(
    `[...document.querySelectorAll("[data-testid=image-generation-request]")].some(item=>item.textContent.includes(${JSON.stringify(concurrentPrompts[2])})&&item.getAttribute("data-status")==="cancelled")`,
  );
  concurrentProviderWaiters.get(0)();
  concurrentProviderWaiters.get(1)();
  await untilMain("globalThis.__v137ConcurrentAResponseHeld===true", 60_000);
  await until(
    `[...document.querySelectorAll("[data-testid=image-generation-request]")].some(item=>item.textContent.includes(${JSON.stringify(concurrentPrompts[1])})&&item.getAttribute("data-status")==="completed")`,
  );
  assert.equal(
    await renderer.evaluate(
      `[...document.querySelectorAll("[data-testid=image-generation-request]")].some(item=>item.textContent.includes(${JSON.stringify(concurrentPrompts[1])})&&item.getAttribute("data-status")==="completed")`,
    ),
    true,
    "The faster response must complete before the held older response is released",
  );
  const staleDeleteSelector = `[data-testid=image-asset][data-asset-id="${staleResponseAsset.id}"] .image-asset__actions button:last-child`;
  await until(`Boolean(document.querySelector(${JSON.stringify(staleDeleteSelector)}))`);
  await pointerClick(staleDeleteSelector);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click('[role="alertdialog"] .mingshen-dialog__actions .btn--danger-solid');
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return !workspace.assets.some(asset=>asset.id===${JSON.stringify(staleResponseAsset.id)})})()`,
  );
  await until(
    `!document.querySelector('[data-testid=image-asset][data-asset-id="${staleResponseAsset.id}"]')`,
  );
  await pointerClick('[data-surface-action="workstation"]');
  await until(
    'document.querySelector("[data-app-surface=image-studio]")?.hidden===true',
  );
  await main.evaluate("globalThis.__v137ReleaseConcurrentAResponse()");
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.assets.length===${assetsBeforeConcurrent + 1}})()`,
    60_000,
  );
  await pointerClick("[data-surface-action=image-studio]");
  await until(
    'document.querySelector("[data-app-surface=image-studio]")?.hidden===false',
  );
  await until(
    'document.querySelectorAll("[data-testid=image-generation-request][data-status=running]").length===0',
  );
  assert.equal(
    await renderer.evaluate(
      'document.querySelectorAll("[data-testid=image-generation-request][data-status=completed]").length',
    ),
    2,
  );
  assert.equal(
    await renderer.evaluate(
      'document.querySelectorAll("[data-testid=image-generation-request][data-status=cancelled]").length',
    ),
    1,
  );
  const workspaceAfterOutOfOrder = await api("getImageStudioWorkspace");
  assert.equal(
    workspaceAfterOutOfOrder.assets.some((asset) => asset.id === staleResponseAsset.id),
    false,
    "A stale generate response must not resurrect an asset deleted after its server snapshot",
  );
  assert.equal(
    await renderer.evaluate(
      `Boolean(document.querySelector('[data-testid=image-asset][data-asset-id="${staleResponseAsset.id}"]'))`,
    ),
    false,
  );
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt===${JSON.stringify(concurrentDraft)}})()`,
  );
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-testid=image-prompt]")?.value'),
    concurrentDraft,
  );
  assert.equal(
    await main.evaluate("globalThis.__v137ImageStudioService.activeGenerationRequests.size"),
    0,
  );
  await setInspector(true);
  await pointerClick("[data-testid=image-generation-clear-finished]");
  await until('!document.querySelector("[data-testid=image-generation-request]")');
  await fill("[data-testid=image-prompt]", normalPrompt);
  await fill("[data-testid=image-negative-prompt]", normalNegative);
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt===${JSON.stringify(normalPrompt)}&&workspace.negativePrompt===${JSON.stringify(normalNegative)}})()`,
  );
  passed.push(
    "Three real synthetic image requests run concurrently, a fourth is blocked, one request can be cancelled without touching the others, the faster response completes before an intentionally held older response, a non-generated asset deleted in between is not resurrected by the stale response snapshot, the held request finishes while Image Studio is hidden behind Workstation, and no response overwrites the newer prompt draft.",
  );

  await setInspector(true);
  await click("[data-testid=image-canvas-new]");
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return Boolean(workspace.activeDocumentId&&workspace.documents.some(document=>document.id===workspace.activeDocumentId))})()`,
  );
  const lateRaceCanvasId = (await api("getImageStudioWorkspace")).activeDocumentId;
  assert.ok(lateRaceCanvasId, "The late-cancellation fixture canvas was not created");
  await click(".image-choice-grid--count button:nth-child(1)");
  await until(
    'document.querySelector(".image-choice-grid--count button:nth-child(1)")?.getAttribute("aria-pressed")==="true"',
  );
  const assetsBeforeLateCancel = (await api("getImageStudioWorkspace")).assets.length;
  await main.evaluate("globalThis.__v137HoldLateCommittedResponses=true");
  for (const [index, prompt] of lateCancelPrompts.entries()) {
    await fill("[data-testid=image-prompt]", prompt);
    await fill("[data-testid=image-negative-prompt]", `V137_LATE_CANCEL_NEGATIVE_${index + 1}`);
    await click("[data-testid=image-generate]");
    await until(
      `document.querySelectorAll("[data-testid=image-generation-request][data-status=running]").length===${index + 1}`,
    );
  }
  await untilMain("globalThis.__v137HeldLateCommittedCount===3", 60_000);
  assert.equal(
    await renderer.evaluate(
      'document.querySelector("[data-testid=image-generation-active-count]")?.textContent?.includes("3/3")',
    ),
    true,
  );
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-testid=image-generate]")?.disabled'),
    true,
  );

  await main.evaluate("globalThis.__v137HoldCanvasClose=true");
  await pointerClick(
    `[data-testid=image-canvas-tab][data-canvas-id="${lateRaceCanvasId}"] .image-workspace__tab-close`,
  );
  await untilMain("globalThis.__v137CanvasCloseHeld===true", 60_000);
  await setValue("[data-testid=image-prompt]", deferredCloseDraft);
  await setValue("[data-testid=image-negative-prompt]", deferredCloseNegative);
  await until(
    `document.querySelector("[data-testid=image-prompt]")?.value===${JSON.stringify(deferredCloseDraft)}&&document.querySelector("[data-testid=image-negative-prompt]")?.value===${JSON.stringify(deferredCloseNegative)}`,
  );
  await renderer.evaluate(`(()=>{
    const request=[...document.querySelectorAll("[data-testid=image-generation-request]")]
      .find(item=>item.textContent.includes(${JSON.stringify(lateCancelPrompts[0])}));
    const cancel=request?.querySelector("[data-testid=image-generation-cancel]");
    if(!(cancel instanceof HTMLButtonElement))throw new Error("Late-cancel control is unavailable");
    cancel.click();
    return true;
  })()`);
  await until(
    `[...document.querySelectorAll("[data-testid=image-generation-request]")].some(item=>item.textContent.includes(${JSON.stringify(lateCancelPrompts[0])})&&item.getAttribute("data-status")==="cancelling")`,
  );
  assert.equal(
    await renderer.evaluate(
      'document.querySelector("[data-testid=image-generation-active-count]")?.textContent?.includes("3/3")',
    ),
    true,
    "A cancelling request must keep its concurrency slot until its original promise settles",
  );
  assert.equal(
    await renderer.evaluate('document.querySelector("[data-testid=image-generate]")?.disabled'),
    true,
  );

  await main.evaluate("globalThis.__v137LateCommittedReleases.get(0)?.()");
  await sleep(120);
  assert.equal(
    await renderer.evaluate(
      `[...document.querySelectorAll("[data-testid=image-generation-request]")].some(item=>item.textContent.includes(${JSON.stringify(lateCancelPrompts[0])})&&item.getAttribute("data-status")==="cancelling")`,
    ),
    true,
    "A committed result must wait behind the in-flight canvas close",
  );
  await main.evaluate("globalThis.__v137ReleaseCanvasClose()");
  await until(
    `!document.querySelector('[data-testid=image-canvas-tab][data-canvas-id="${lateRaceCanvasId}"]')`,
    60_000,
  );
  await until(
    `[...document.querySelectorAll("[data-testid=image-generation-request]")].some(item=>item.textContent.includes(${JSON.stringify(lateCancelPrompts[0])})&&item.getAttribute("data-status")==="completed"&&item.textContent.includes("取消较晚"))`,
    60_000,
  );
  await main.evaluate("globalThis.__v137HoldLateCommittedResponses=false");
  await main.evaluate("globalThis.__v137LateCommittedReleases.get(1)?.()");
  await main.evaluate("globalThis.__v137LateCommittedReleases.get(2)?.()");
  await until(
    'document.querySelectorAll("[data-testid=image-generation-request][data-status=running],[data-testid=image-generation-request][data-status=cancelling]").length===0',
    60_000,
  );
  const lateCancelWorkspace = await api("getImageStudioWorkspace");
  assert.equal(
    lateCancelWorkspace.documents.some((document) => document.id === lateRaceCanvasId),
    false,
    "Neither the deferred close nor later generation responses may recreate the closed canvas",
  );
  assert.equal(lateCancelWorkspace.prompt, deferredCloseDraft);
  assert.equal(lateCancelWorkspace.negativePrompt, deferredCloseNegative);
  assert.equal(lateCancelWorkspace.assets.length, assetsBeforeLateCancel + 3);
  assert.equal(
    lateCancelPrompts.every((prompt) =>
      lateCancelWorkspace.assets.some((asset) => asset.prompt === prompt),
    ),
    true,
    "Every committed result must survive a late cancellation request",
  );
  passed.push(
    "Three post-commit generation responses are held behind IPC; a prompt and negative prompt are edited while a real canvas close is held, cancelling one keeps all 3/3 slots occupied, and the canonical close plus later generation merges persist the drafts without recreating or reopening the closed canvas.",
  );

  await setInspector(true);
  await fill("[data-testid=image-prompt]", normalPrompt);
  await fill("[data-testid=image-negative-prompt]", normalNegative);
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt===${JSON.stringify(normalPrompt)}&&workspace.negativePrompt===${JSON.stringify(normalNegative)}})()`,
  );
  const promptImport = `[data-testid=image-asset][data-asset-id="${remoteAsset.id}"] [data-testid=image-asset-import-prompt]`;
  await until(`Boolean(document.querySelector(${JSON.stringify(promptImport)}))`);
  await pointerClick(promptImport);
  await until('Boolean(document.querySelector("[role=alertdialog]"))');
  await click('[role="alertdialog"] .mingshen-dialog__actions .btn--primary');
  await until(
    `document.querySelector("[data-testid=image-prompt]")?.value===${JSON.stringify(remotePrompt)}&&document.querySelector("[data-testid=image-negative-prompt]")?.value===${JSON.stringify(remoteNegative)}`,
  );
  await until(
    `(async()=>{const workspace=await window.mingshen.getImageStudioWorkspace();return workspace.prompt===${JSON.stringify(remotePrompt)}&&workspace.negativePrompt===${JSON.stringify(remoteNegative)}})()`,
  );
  const restoredWorkspace = await api("getImageStudioWorkspace");
  assert.equal(restoredWorkspace.prompt, remotePrompt);
  assert.equal(restoredWorkspace.negativePrompt, remoteNegative);
  passed.push(
    "The saved remote asset's import-prompt action confirms the application dialog and restores its generation-time positive and negative prompts into the workspace.",
  );

  await setViewport(1440, 900);
  await setInspector(true);
  await fill("[data-testid=image-prompt]", layoutPrompt);
  await fill("[data-testid=image-negative-prompt]", layoutNegative);
  await click(".image-choice-grid--count button:nth-child(3)");
  await until(
    'document.querySelector(".image-choice-grid--count button:nth-child(3)")?.getAttribute("aria-pressed")==="true"',
  );
  await click("[data-testid=image-generate]");
  await until('Boolean(document.querySelector("[data-testid=image-remote-dialog]"))', 60_000);
  await until(
    'Boolean(document.querySelector("[data-testid=image-remote-preview]")?.complete&&document.querySelector("[data-testid=image-remote-preview]")?.naturalWidth>0)',
    60_000,
  );
  await setLocaleFromCaption("zh-CN");
  await setViewport(1440, 900);
  await measureRemoteDialog("remote-zh-1440");
  await capture("remote-zh-1440");
  await setViewport(800, 600);
  await measureRemoteDialog("remote-zh-800");
  await capture("remote-zh-800");
  await setViewport(680, 600);
  await measureRemoteDialog("remote-zh-680");
  await capture("remote-zh-680");
  await setLocaleFromCaption("en");
  await setViewport(800, 600);
  await measureRemoteDialog("remote-en-800");
  await capture("remote-en-800");
  await setViewport(680, 600);
  await measureRemoteDialog("remote-en-680");
  await capture("remote-en-680");
  passed.push(
    "Remote review screenshots and geometry pass at Chinese 1440/800/680 and English 800/680; dialog, preview and footer stay in viewport, footer controls do not overlap or become covered, and compact layouts do not scroll horizontally.",
  );

  await setLocaleFromCaption("zh-CN");
  await setViewport(1440, 900);
  while (await renderer.evaluate('Boolean(document.querySelector("[data-testid=image-remote-dialog]"))')) {
    const count = await main.evaluate(
      "globalThis.__v137ImageStudioService.pendingRemoteImages.size",
    );
    assert.ok(count > 0, "The review dialog must have a pending remote candidate");
    await pointerClick("[data-testid=image-remote-discard]");
    await untilMain(`globalThis.__v137ImageStudioService.pendingRemoteImages.size===${count - 1}`);
    if (count <= 1)
      await until('!document.querySelector("[data-testid=image-remote-dialog]")');
    else
      await until(
        `Boolean(document.querySelector("[data-testid=image-remote-dialog]"))&&Boolean(document.querySelector("[data-testid=image-remote-discard]")&&!document.querySelector("[data-testid=image-remote-discard]").disabled)&&document.querySelectorAll("[data-testid^=image-remote-candidate-]").length===${count > 2 ? count - 1 : 0}`,
      );
  }
  assert.equal(
    await main.evaluate("globalThis.__v137ImageStudioService.pendingRemoteImages.size"),
    0,
  );
  assert.equal((await api("getCompletionNotifications")).unread.length, 0);
  assert.equal((await api("getCompletionNotifications")).badgeCount, 0);

  const previousWheelDocumentId = (await api("getImageStudioWorkspace")).activeDocumentId;
  await click("[data-testid=image-canvas-new]");
  await until(`window.mingshen.getImageStudioWorkspace().then(state=>state.activeDocumentId!==${JSON.stringify(previousWheelDocumentId)}&&state.documents.some(document=>document.id===state.activeDocumentId))`);
  const canvasBeforeWheel = await api("getImageStudioWorkspace");
  const wheelCanvasId = canvasBeforeWheel.activeDocumentId;
  const wheelCanvas = canvasBeforeWheel.documents.find((canvas) => canvas.id === wheelCanvasId);
  assert.ok(wheelCanvas, "The wheel regression fixture needs an active canvas");
  const viewportPoint = await renderer.evaluate(`(()=>{
    const element=document.querySelector(".image-viewport");
    const box=element.getBoundingClientRect();
    return {x:box.left+box.width/2,y:box.top+box.height/2};
  })()`);
  await renderer.send("Input.dispatchMouseEvent", {
    type: "mouseWheel", ...viewportPoint, deltaX: 0, deltaY: -120,
  });
  await until(`window.mingshen.getImageStudioWorkspace().then(state=>state.documents.find(canvas=>canvas.id===${JSON.stringify(wheelCanvasId)})?.zoom>${wheelCanvas.zoom})`);
  await renderer.send("Input.dispatchMouseEvent", {
    type: "mouseWheel", ...viewportPoint, deltaX: 0, deltaY: 120, modifiers: 2,
  });
  await until(`window.mingshen.getImageStudioWorkspace().then(state=>{const zoom=state.documents.find(canvas=>canvas.id===${JSON.stringify(wheelCanvasId)})?.zoom;return zoom>${wheelCanvas.zoom * 0.98}&&zoom<${wheelCanvas.zoom * 1.01}})`);
  await conversation();
  await openSurface("image-studio");
  await renderer.send("Input.dispatchMouseEvent", {
    type: "mouseWheel", ...viewportPoint, deltaX: 0, deltaY: -120,
  });
  await until(`window.mingshen.getImageStudioWorkspace().then(state=>state.documents.find(canvas=>canvas.id===${JSON.stringify(wheelCanvasId)})?.zoom>${wheelCanvas.zoom})`);
  await capture("diagnostics-wheel-canvas");
  passed.push("Real Chromium wheel and Ctrl+wheel zoom the active canvas and remain effective after switching work surfaces without passive-listener warnings.");

  const diagnosticExport = join(temporary, "diagnostics-export.json");
  const exportDiagnostics = async () => {
    await main.evaluate(`(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      globalThis.__v137OriginalDiagnosticSave=electron.dialog.showSaveDialog;
      electron.dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(diagnosticExport)}});
      return true;
    })()`);
    try { await api("exportRuntimeLogs"); }
    finally {
      await main.evaluate(`(()=>{
        const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
        electron.dialog.showSaveDialog=globalThis.__v137OriginalDiagnosticSave;
        delete globalThis.__v137OriginalDiagnosticSave;
        return true;
      })()`);
    }
    return JSON.parse(await readFile(diagnosticExport, "utf8"));
  };
  const diagnosticBaseline = await exportDiagnostics();
  const failuresFor = (report, source, operation) => report.entries.filter((entry) =>
    entry.source === source && (!operation || entry.context.operation === operation));
  const failedAsset = await renderer.evaluate(`window.mingshen.getImageStudioAssetData("v137-missing-diagnostic-asset").then(()=>false,()=>true)`);
  assert.equal(failedAsset, true, "A missing asset should reject through the real IPC boundary");
  const invalidPlugin = await api("validateLocalPlugin", workspace);
  assert.equal(invalidPlugin.kind, "plugin");
  assert.equal(invalidPlugin.validation.ok, false, "The workspace has no plugin manifest");
  const apiStatus = await api("startHeadlessServer", "127.0.0.1", 0);
  assert.equal(apiStatus.running, true);
  assert.ok(apiStatus.token);
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${apiStatus.port}/v1/capabilities`);
    assert.equal(unauthorized.status, 401);
    await unauthorized.arrayBuffer();
    const missingRun = await fetch(`http://127.0.0.1:${apiStatus.port}/v1/runs/v137-missing-run`, {
      headers: { Authorization: `Bearer ${apiStatus.token}` },
    });
    assert.equal(missingRun.status, 404);
    await missingRun.arrayBuffer();
  } finally { await api("stopHeadlessServer"); }
  const diagnosticReport = await exportDiagnostics();
  assert.equal(diagnosticReport.maxBytes, 15 * 1024 * 1024);
  assert.ok(diagnosticReport.statistics.errors > 0);
  assert.ok(diagnosticReport.statistics.warnings > 0);
  assert.equal(
    failuresFor(diagnosticReport, "ipc.request", "image-studio:asset-data").length -
      failuresFor(diagnosticBaseline, "ipc.request", "image-studio:asset-data").length,
    1,
  );
  assert.equal(
    diagnosticReport.entries.filter((entry) => entry.source === "main.console.error" &&
      entry.message.includes("Error occurred in handler for 'image-studio:asset-data':")).length,
    0,
    "Electron must not duplicate an IPC failure in the stored diagnostics",
  );
  assert.ok(failuresFor(diagnosticReport, "ipc.result", "local-plugins:validate").length >
    failuresFor(diagnosticBaseline, "ipc.result", "local-plugins:validate").length);
  assert.ok(diagnosticReport.entries.some((entry) => entry.source === "local-api.response" && entry.context.status === 401));
  assert.ok(diagnosticReport.entries.some((entry) => entry.source === "local-api.response" && entry.context.status === 404));
  assert.ok(!JSON.stringify(diagnosticReport).includes(apiStatus.token));
  assert.ok(!diagnosticReport.entries.some((entry) => /Unable to preventDefault inside passive event listener|console-message.*deprecated/.test(entry.message)));
  assert.equal(diagnosticReport.statistics.errors + diagnosticReport.statistics.warnings,
    diagnosticReport.entries.filter((entry) => entry.source !== "logs.read").length);
  passed.push("Real IPC and /v1 failures enter the exported 15 MiB diagnostics: missing asset once, invalid plugin envelope, unauthorized API and missing run; Electron echo, token and passive/deprecated-console warnings are absent.");

  await pointerClick('.app-topbar button[aria-label="打开设置"]');
  await clickButtonText("运行日志");
  await until('Boolean(document.querySelector(".runtime-log-statistics"))');
  await renderer.evaluate('document.querySelectorAll(".runtime-log-breakdown").forEach(item=>item.open=true);true');
  await setViewport(1040, 680);
  for (const [locale, name] of [["zh-CN", "diagnostics-zh-1040"], ["en", "diagnostics-en-1040"]]) {
    await setLocaleFromCaption(locale);
    const layout = await renderer.evaluate(`(()=>{
      const root=document.querySelector(".runtime-log-settings");
      const rect=root.getBoundingClientRect();
      const rows=[...root.querySelectorAll("table th,table td,dd")];
      return {documentWidth:document.documentElement.scrollWidth,width:innerWidth,
        rootWidth:root.clientWidth,rootScrollWidth:root.scrollWidth,
        rowsFit:rows.every(element=>element.scrollWidth<=element.clientWidth+2),
        inside:rect.left>=-1&&rect.right<=innerWidth+1,
        text:root.innerText};
    })()`);
    assert.ok(layout.inside && layout.rowsFit && layout.rootScrollWidth <= layout.rootWidth + 1 && layout.documentWidth <= layout.width + 1, `${name}: log statistics overflow`);
    assert.match(layout.text, /15 MiB/);
    if (locale === "en") assert.doesNotMatch(layout.text, /[\u4e00-\u9fff]/);
    geometry.push({ name, ...layout, text: undefined });
    await capture(name);
  }
  passed.push("Runtime logs show retained error/warning, dropped/damaged and expandable source/operation tables in Chinese and English at 1040x680 with no horizontal overflow.");

  assert.deepEqual(exceptions, [], "Renderer/main CDP observed an uncaught exception");
  assert.deepEqual(serviceErrors, [], "The local synthetic provider rejected a request");
  assert.deepEqual(
    await main.evaluate("globalThis.__v137BlockedFetches"),
    [],
    "A non-fixture fetch was attempted",
  );
  passed.push(
    "Final cleanup discards all layout-only remote candidates and confirms no pending remote, unread, badge, network, renderer-exception or synthetic-service residue.",
  );

  const resultPath = await saveResult(true);
  console.log(
    JSON.stringify(
      {
        success: true,
        passed,
        screenshots,
        requests: requests.map((item) => ({
          path: item.path,
          model: item.body?.model,
          imageCount: item.body?.imageCount,
        })),
        resultPath,
      },
      null,
      2,
    ),
  );
} catch (cause) {
  if (renderer) await capture("failure").catch(() => undefined);
  console.error(
    JSON.stringify(
      {
        passed,
        resultPath: await saveResult(false, cause),
        body: await renderer?.evaluate("document.body.innerText").catch(() => null),
      },
      null,
      2,
    ),
  );
  throw cause;
} finally {
  await main
    ?.evaluate(`(()=>{
      const electron=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");
      if(globalThis.__v137OriginalSetBadgeCount){
        electron.app.setBadgeCount=globalThis.__v137OriginalSetBadgeCount;
      }
      const window=globalThis.__v137NotificationWindow;
      if(window&&!window.isDestroyed()){
        const descriptor=globalThis.__v137OverlayDescriptor;
        if(descriptor)Object.defineProperty(window,"setOverlayIcon",descriptor);
        else delete window.setOverlayIcon;
      }
      if(globalThis.__v137OriginalRemotePreview){
        electron.ipcMain._invokeHandlers.set("image-studio:remote-preview",globalThis.__v137OriginalRemotePreview);
      }
      if(globalThis.__v137OriginalImageGenerate){
        electron.ipcMain._invokeHandlers.set("image-studio:generate",globalThis.__v137OriginalImageGenerate);
      }
      if(globalThis.__v137OriginalCanvasClose){
        electron.ipcMain._invokeHandlers.set("image-studio:canvas-close",globalThis.__v137OriginalCanvasClose);
      }
      if(globalThis.__v137OriginalRemoteSave){
        electron.ipcMain._invokeHandlers.set("image-studio:remote-save",globalThis.__v137OriginalRemoteSave);
      }
      if(globalThis.__v137OriginalWorkspaceSave){
        electron.ipcMain._invokeHandlers.set("image-studio:save",globalThis.__v137OriginalWorkspaceSave);
      }
      if(globalThis.__v137OriginalOpenExternal){
        electron.shell.openExternal=globalThis.__v137OriginalOpenExternal;
      }
      if(globalThis.__v137OriginalDnsLookup){
        const require=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json");
        require("node:dns/promises").lookup=globalThis.__v137OriginalDnsLookup;
      }
      if(globalThis.__v137OriginalFetch)globalThis.fetch=globalThis.__v137OriginalFetch;
      return true;
    })()`)
    .catch(() => undefined);

  if (child) {
    const owned = child;
    const ended =
      owned.exitCode !== null
        ? Promise.resolve()
        : new Promise((done) => owned.once("exit", done));
    await renderer
      ?.evaluate('setTimeout(()=>void window.mingshen.desktopAction("quit"),50);true')
      .catch(() => undefined);
    await Promise.race([ended, sleep(8_000)]);
    renderer?.close();
    main?.close();
    if (owned.exitCode === null && owned.signalCode === null) {
      owned.kill();
      await Promise.race([ended, sleep(5_000)]);
    }
    assert.ok(owned.exitCode !== null || owned.signalCode !== null, "Owned Electron did not exit");
  }

  server.closeAllConnections();
  if (server.listening) await new Promise((done) => server.close(done));
  const local = relative(resolve(tmpdir()), temporary);
  assert.ok(
    local &&
      !local.startsWith("..") &&
      !isAbsolute(local) &&
      local.startsWith("mingshen-v137-image-unread-"),
    "Unsafe temporary cleanup path",
  );
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
