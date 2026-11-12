import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const debugUrl = process.argv[2] ?? "http://127.0.0.1:9222";
const outputPath = process.argv[3] ?? ".impeccable/review/desktop.png";

const targets = await fetch(`${debugUrl}/json`).then((response) => response.json());
const target = targets.find((item) => item.type === "page");

if (!target?.webSocketDebuggerUrl) {
  throw new Error("No page target with a WebSocket debugger URL was found.");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

const opened = new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) {
    return;
  }
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (!request) {
    return;
  }
  if (message.error) {
    request.reject(new Error(message.error.message));
  } else {
    request.resolve(message.result);
  }
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await opened;
await send("Page.enable");
await send("Runtime.enable");
if (process.argv.includes("--reload")) {
  await send("Page.reload", { ignoreCache: true });
}
await new Promise((resolve) => setTimeout(resolve, 500));

const evalIndex = process.argv.indexOf("--eval");
if (evalIndex >= 0) {
  const expression = process.argv[evalIndex + 1];
  if (!expression) {
    throw new Error("--eval requires a JavaScript expression");
  }
  const evaluation = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails) { socket.close(); throw new Error(evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text); }
  if (evaluation.result?.value !== undefined) {
    console.log(`EVAL: ${JSON.stringify(evaluation.result.value)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
}

const text = await send("Runtime.evaluate", {
  expression: "document.body.innerText",
  returnByValue: true,
});
const screenshot = await send("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
console.log(text.result?.value ?? "");
console.log(`\nScreenshot: ${outputPath}`);
socket.close();
