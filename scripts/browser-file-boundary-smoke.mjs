import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { experimentalExecutable } from "./experimental-executable.mjs";

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function removeTemporary(path) {
  const root = resolve(tmpdir());
  const target = resolve(path);
  assert.ok(target.startsWith(`${root}\\`), `Unsafe temporary cleanup target: ${target}`);
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

const workspace = await mkdtemp(join(tmpdir(), "mingshen-browser-file-workspace-"));
const outside = await mkdtemp(join(tmpdir(), "mingshen-browser-file-outside-"));
const profile = await mkdtemp(join(tmpdir(), "mingshen-browser-file-profile-"));
const outsideRelative = `../${outside.split(/[\\/]/).at(-1)}`;
const indexUrl = pathToFileURL(join(workspace, "index.html")).toString();
const port = await freePort();

await writeFile(
  join(workspace, "inside.js"),
  "globalThis.insideScriptLoaded = true;\n",
  "utf8",
);
await writeFile(
  join(workspace, "inside.css"),
  "body { color: rgb(12, 34, 56); }\n",
  "utf8",
);
await writeFile(
  join(workspace, "index.html"),
  `<!doctype html>
<html>
  <head>
    <title>Workspace boundary fixture</title>
    <link rel="stylesheet" href="inside.css">
    <script src="inside.js"></script>
    <script src="${outsideRelative}/outside.js"></script>
  </head>
  <body>
    <h1 id="inside-marker">INSIDE_ALLOWED</h1>
    <img id="outside-image" src="${outsideRelative}/outside.svg" alt="">
    <iframe id="outside-frame" src="${outsideRelative}/outside.html"></iframe>
    <script>
      globalThis.__boundary = { fetchResult: "pending", frameResult: "pending" };
      fetch("${outsideRelative}/secret.txt")
        .then(async (response) => {
          globalThis.__boundary.fetchResult = { ok: response.ok, text: await response.text() };
        })
        .catch((error) => {
          globalThis.__boundary.fetchResult = { error: String(error) };
        });
      addEventListener("load", () => {
        try {
          globalThis.__boundary.frameResult =
            document.querySelector("#outside-frame").contentDocument?.body?.innerText ?? "";
        } catch (error) {
          globalThis.__boundary.frameResult = { error: String(error) };
        }
      });
    </script>
  </body>
</html>`,
  "utf8",
);
await writeFile(join(outside, "outside.js"), "globalThis.outsideScriptLoaded = true;\n", "utf8");
await writeFile(
  join(outside, "outside.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>',
  "utf8",
);
await writeFile(
  join(outside, "outside.html"),
  "<!doctype html><body>OUTSIDE_FRAME_SECRET</body>",
  "utf8",
);
await writeFile(join(outside, "secret.txt"), "OUTSIDE_FETCH_SECRET", "utf8");

const env = {
  ...process.env,
  MSH_EXPERIMENTAL: "1",
  MSH_DEBUG_PORT: String(port),
  MSH_DISABLE_AUTO_DEPENDENCIES: "1",
  MSH_NOTIFICATION_FIXTURE: "1",
  MSH_USER_DATA_DIR: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  experimentalExecutable(),
  [
    resolve("apps/desktop"),
    "--mingshen-experimental",
    `--mingshen-user-data=${profile}`,
  ],
  {
    cwd: resolve("apps/desktop"),
    env,
    windowsHide: true,
    stdio: "ignore",
  },
);

let socket;
let requestId = 0;
const pending = new Map();
try {
  let target;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) =>
        response.json(),
      );
      target = targets.find((candidate) => candidate.type === "page");
      if (target) break;
    } catch {
      // The development runtime may still be starting.
    }
    await sleep(100);
  }
  assert.ok(target, "Electron renderer did not expose a CDP page target.");

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolveSend, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveSend(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
      );
    }
    return response.result.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate("Boolean(document.querySelector('.policy-dialog'))")) break;
    await sleep(100);
  }
  assert.equal(await evaluate("Boolean(document.querySelector('.policy-dialog'))"), true);
  await sleep(5_200);
  assert.equal(
    await evaluate(`(() => {
      document.querySelectorAll('.policy-dialog input[type=checkbox]').forEach((input) => input.click());
      const button = [...document.querySelectorAll('.policy-dialog button')]
        .find((candidate) => candidate.textContent.includes('同意并继续'));
      if (!button) return false;
      button.click();
      return true;
    })()`),
    true,
  );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (
      await evaluate(`Boolean(
        [...document.querySelectorAll('.policy-dialog button')]
          .find((button) => button.textContent.includes('开始使用'))
      )`)
    ) {
      break;
    }
    await sleep(100);
  }
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('.policy-dialog button')]
      .find((candidate) => candidate.textContent.includes('开始使用'));
    button?.click();
    return Boolean(button);
  })()`);

  const sessionId = await evaluate(`(async () => {
    const provider = await window.mingshen.createProvider({
      name: 'Browser boundary fixture',
      baseUrl: 'http://127.0.0.1:9/v1',
      protocol: 'openai_responses',
      authMode: 'bearer',
      apiKey: 'local-browser-boundary-fixture',
      keyLabel: 'Fixture',
      neverReveal: true
    });
    const configured = await window.mingshen.createModel({
      providerId: provider.id,
      modelId: 'browser-boundary',
      displayName: 'Browser boundary',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      inputModalities: ['text'],
      outputModalities: ['text'],
      toolCalls: false,
      parallelToolCalls: false,
      reasoningLevels: [],
      anthropicNoneBehavior: 'disabled'
    });
    for (const server of await window.mingshen.listMcpServers()) {
      if (server.enabled) await window.mingshen.setMcpServerEnabled(server.id, false);
    }
    return (await window.mingshen.createSession({
      title: 'Browser file boundary',
      providerId: provider.id,
      modelId: configured.models[0].id,
      workspacePath: ${JSON.stringify(workspace)},
      permissionMode: 'full_access',
      reasoningLevel: null
    })).id;
  })()`);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (
      await evaluate(
        `Boolean(document.querySelector('[data-session-id="${sessionId}"] .chat-session-row__main, [data-session-id="${sessionId}"] .session-row'))`,
      )
    ) {
      break;
    }
    await sleep(100);
  }
  assert.equal(
    await evaluate(`(() => {
      const row = document.querySelector(
        '[data-session-id="${sessionId}"] .chat-session-row__main, [data-session-id="${sessionId}"] .session-row'
      );
      row?.click();
      return Boolean(row);
    })()`),
    true,
  );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (
      await evaluate(
        `document.querySelector('.chat-session-row--selected, .session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId === ${JSON.stringify(sessionId)}`,
      )
    ) {
      break;
    }
    await sleep(100);
  }
  assert.equal(
    await evaluate(
      `document.querySelector('.chat-session-row--selected, .session-row--selected')?.closest('[data-session-id]')?.dataset.sessionId === ${JSON.stringify(sessionId)}`,
    ),
    true,
  );
  await evaluate(
    `window.mingshen.openBrowser(${JSON.stringify(sessionId)}, 'edge', ${JSON.stringify(indexUrl)})`,
  );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await evaluate("Boolean(document.querySelector('webview'))")) break;
    await sleep(100);
  }
  assert.equal(await evaluate("Boolean(document.querySelector('webview'))"), true);

  let result;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      result = await evaluate(`document.querySelector('webview').executeJavaScript(\`(() => ({
        title: document.title,
        insideMarker: document.querySelector('#inside-marker')?.textContent ?? '',
        insideScriptLoaded: globalThis.insideScriptLoaded === true,
        outsideScriptLoaded: globalThis.outsideScriptLoaded === true,
        outsideImageWidth: document.querySelector('#outside-image')?.naturalWidth ?? -1,
        frameResult: globalThis.__boundary?.frameResult ?? null,
        fetchResult: globalThis.__boundary?.fetchResult ?? null,
        insideColor: getComputedStyle(document.body).color
      }))()\`)`);
      if (result.title === "Workspace boundary fixture") break;
    } catch {
      // The guest is still navigating.
    }
    await sleep(100);
  }
  assert.ok(result, "Browser guest did not finish loading.");
  assert.equal(result.insideMarker, "INSIDE_ALLOWED");
  assert.equal(result.insideScriptLoaded, true);
  assert.equal(result.outsideScriptLoaded, false);
  assert.equal(result.outsideImageWidth, 0);
  assert.ok(!JSON.stringify(result.frameResult).includes("OUTSIDE_FRAME_SECRET"));
  assert.ok(!JSON.stringify(result.fetchResult).includes("OUTSIDE_FETCH_SECRET"));
  assert.equal(result.insideColor, "rgb(12, 34, 56)");

  const address = await evaluate(
    "document.querySelector('.browser-dock__address input')?.value ?? ''",
  );
  assert.ok(address.startsWith("file:"));
  assert.ok(!address.includes("mingshenLocalFileApproval"));
  assert.ok(!address.includes(encodeURIComponent("mingshenLocalFileApproval")));

  console.log(
    JSON.stringify(
      {
        ok: true,
        passed: [
          "workspace top document and assets load",
          "workspace outside script is blocked",
          "workspace outside image is blocked",
          "workspace outside iframe content is unavailable",
          "workspace outside fetch does not expose content",
          "internal approval capability is absent from the visible address",
        ],
        result,
        address,
      },
      null,
      2,
    ),
  );
  await evaluate("void window.mingshen.desktopAction('quit'); true").catch(() => undefined);
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    sleep(5_000),
  ]);
} finally {
  socket?.close();
  if (child.exitCode === null) child.kill();
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    sleep(3_000),
  ]);
  await removeTemporary(workspace);
  await removeTemporary(outside);
  await removeTemporary(profile);
}
