const assert = require("node:assert/strict");
const path = require("node:path");

const { spawn } = require(path.resolve(__dirname, "../node_modules/node-pty"));

let output = "";
let inputSent = false;
let resizeSent = false;
let finished = false;

function finish(exitCode) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  setTimeout(() => process.exit(exitCode), 25);
}

const timeout = setTimeout(() => {
  console.error("PTY_SMOKE_TIMEOUT");
  try {
    terminal.kill();
  } catch {
    // The process may already have exited.
  }
  finish(1);
}, 10_000);

const terminal = spawn(
  "powershell.exe",
  [
    "-NoLogo",
    "-NoProfile",
    "-Command",
    "[Console]::Out.WriteLine('MSH_PTY_READY'); $line=[Console]::In.ReadLine(); [Console]::Out.WriteLine(\"MSH_PTY_INPUT=$line\"); Start-Sleep -Milliseconds 100",
  ],
  {
    name: "xterm-256color",
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      PATHEXT: process.env.PATHEXT,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      COMSPEC: process.env.COMSPEC,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      USERPROFILE: process.env.USERPROFILE,
    },
    useConpty: true,
  },
);

assert.ok(Number.isInteger(terminal.pid) && terminal.pid > 0, "PTY did not return a process ID");

terminal.onData((data) => {
  output += data;
  if (!inputSent && output.includes("MSH_PTY_READY")) {
    inputSent = true;
    terminal.write("hello-terminal\r");
    terminal.resize(120, 40);
    resizeSent = true;
  }
});

terminal.onExit(({ exitCode }) => {
  try {
    assert.equal(exitCode, 0, `Unexpected PTY exit code: ${exitCode}`);
    assert.equal(inputSent, true, "PTY output readiness was not observed");
    assert.equal(resizeSent, true, "PTY resize was not issued");
    assert.match(output, /MSH_PTY_INPUT=hello-terminal/, "PTY did not echo the written input");
    console.log(
      JSON.stringify({
        ok: true,
        pid: terminal.pid,
        initialSize: "100x30",
        resizedTo: "120x40",
        outputObserved: output.includes("MSH_PTY_READY"),
        inputEchoed: output.includes("MSH_PTY_INPUT=hello-terminal"),
        exitCode,
      }),
    );
    finish(0);
  } catch (error) {
    console.error(error);
    console.error(output);
    finish(1);
  }
});
