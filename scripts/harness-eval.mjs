import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { deflateSync } from "node:zlib";

export const baselinePath = fileURLToPath(new URL("./fixtures/harness-eval/baseline.json", import.meta.url));
const fixtureConfig = {
  protocol: "openai_responses",
  modelId: "offline-fixture-no-model",
  reasoning: "low",
  contextWindow: 200000,
  maxOutputTokens: 30000,
  source: "fixture",
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest("hex");
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function configurationFingerprint(config) {
  assert.ok(["openai_responses", "openai_chat_completions", "anthropic_messages"].includes(config.protocol), "Invalid model protocol");
  assert.ok(typeof config.modelId === "string" && config.modelId.length > 0, "Actual provider modelId is required");
  assert.ok(config.reasoning === null || typeof config.reasoning === "string", "Resolved reasoning is required");
  for (const key of ["contextWindow", "maxOutputTokens"])
    assert.ok(Number.isSafeInteger(config[key]) && config[key] > 0, `Invalid ${key}`);
  return hash({
    protocol: config.protocol,
    modelId: config.modelId,
    reasoning: config.reasoning,
    contextWindow: config.contextWindow,
    maxOutputTokens: config.maxOutputTokens,
    endpoint: config.endpoint ?? null,
  });
}

export async function loadBaseline(path = baselinePath) {
  const suite = JSON.parse(await readFile(path, "utf8"));
  assert.equal(suite.version, 1, "Unsupported baseline version");
  assert.equal(suite.applicationVersion, "1.3.0", "Baseline version drift");
  assert.ok(Array.isArray(suite.tasks) && suite.tasks.length > 0 && suite.tasks.length <= 30);
  const ids = new Set();
  for (const task of suite.tasks) {
    assert.match(task.id, /^[a-z][a-z0-9-]{0,63}$/);
    assert.ok(!ids.has(task.id), "Duplicate task ID");
    ids.add(task.id);
    assert.ok(Array.isArray(task.prompts) && task.prompts.length > 0 && task.prompts.every(text => typeof text === "string" && text.length <= 16000));
    assert.ok(Array.isArray(task.checks) && task.checks.length > 0);
    for (const check of task.checks)
      assert.ok(["artifact_json", "artifact_text", "tools", "observation"].includes(check.kind), "Unsupported check kind");
  }
  return suite;
}

function scopedPath(root, path) {
  assert.ok(typeof path === "string" && path && !isAbsolute(path), "Artifact path must be relative");
  const target = resolve(root, path);
  const rel = relative(root, target);
  assert.ok(rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel), "Artifact escapes workspace");
  return target;
}

async function writeScoped(root, path, content) {
  const target = scopedPath(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function readScopedBytes(root, path) {
  const rootReal = await realpath(root);
  const target = await realpath(scopedPath(root, path));
  const rel = relative(rootReal, target);
  assert.ok(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "Artifact link escapes workspace");
  assert.ok((await stat(target)).size <= 1024 * 1024, "Artifact exceeds 1 MiB");
  return readFile(target);
}

async function readScoped(root, path) {
  return (await readScopedBytes(root, path)).toString("utf8");
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function imageFixture() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(32, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < 32; y++) {
    const row = Buffer.alloc(1 + 64 * 3);
    for (let x = 0; x < 64; x++) {
      row[1 + x * 3] = x < 32 ? 255 : 0;
      row[2 + x * 3] = x < 32 ? 0 : 255;
      row[3 + x * 3] = 255;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function prepareTaskWorkspace(root, task) {
  const inputs = { ...task.inputs };
  if (task.id === "file-pagination")
    inputs["input/large.txt"] = Array.from({ length: 750 }, (_, index) =>
      index === 636 ? "MINGSHEN_RELEASE_1.3.0" : `Evidence row ${index + 1}: ordinary fixture content.`).join("\n") + "\n";
  if (task.id === "visual-inspection") inputs["input/evidence.png"] = imageFixture();
  for (const [path, content] of Object.entries(inputs)) await writeScoped(root, path, content);
  return Object.fromEntries(Object.entries(inputs).map(([path, content]) => [path, createHash("sha256").update(content).digest("hex")]));
}

export function observationsFromMessages(messages) {
  const parts = messages.flatMap(message => message.parts ?? []);
  const tools = parts.filter(part => part.type === "tool_call").map(part => {
    let args = {};
    try { args = JSON.parse(part.arguments); } catch {}
    return { name: part.name, arguments: args, status: part.status };
  });
  const pageCalls = tools.filter(tool => tool.name === "read_file" && tool.status === "completed" && /large\.txt$/i.test(String(tool.arguments.path)));
  const boundedFileRead = pageCalls.length ? pageCalls.every(tool => {
    const start = tool.arguments.start_line ?? tool.arguments.startLine;
    const end = tool.arguments.end_line ?? tool.arguments.endLine;
    const limit = tool.arguments.limit ?? tool.arguments.line_count;
    return start === 601 && (end === 700 || limit === 100);
  }) : false;
  return {
    tools,
    observations: {
      boundedFileRead,
      imageResultCaptured: parts.some(part => part.type === "tool_result" && !part.isError && part.images?.length),
      responsesStateCaptured: parts.some(part => part.type === "responses_state" && part.items?.length),
      // Stored output items and image results alone do not prove what went back
      // onto the wire. Leave replay/native input unobserved without wire traces.
    },
  };
}

export async function gradeTask(task, run) {
  const checks = [];
  for (const check of task.checks) {
    let status = "pass";
    let detail = "Verified";
    try {
      if (check.kind === "artifact_json")
        assert.deepEqual(JSON.parse(await readScoped(run.workspace, check.path)), check.equals, "JSON artifact differs");
      else if (check.kind === "artifact_text") {
        const text = await readScoped(run.workspace, check.path);
        let offset = 0;
        for (const expected of check.contains) {
          const found = text.indexOf(expected, offset);
          assert.ok(found >= 0, "Expected artifact text missing or out of order");
          offset = found + expected.length;
        }
      } else if (check.kind === "tools") {
        const count = (run.tools ?? []).filter(tool => check.names.includes(tool.name) && tool.status === "completed").length;
        assert.ok(count >= check.minimum, `Only ${count} matching tool calls`);
      } else if (!Object.hasOwn(run.observations ?? {}, check.key)) {
        status = "not_observed";
        detail = "Required telemetry is unavailable; this is not a pass.";
      } else
        assert.deepEqual(run.observations[check.key], check.equals, "Observed behavior differs");
    } catch (error) {
      status = "fail";
      detail = error instanceof Error && error.code === "ENOENT" ? "Required artifact is missing" : "Expected task evidence did not match";
    }
    checks.push({ id: check.id, kind: check.kind, status, detail });
  }
  for (const [path, expected] of Object.entries(run.inputHashes ?? {})) {
    let unchanged = false;
    try { unchanged = hash(await readScopedBytes(run.workspace, path)) === expected; } catch {}
    checks.push({ id: `input:${path}`, kind: "input_integrity", status: unchanged ? "pass" : "fail", detail: unchanged ? "Input preserved" : "Input changed or missing" });
  }
  const failed = checks.some(check => check.status === "fail");
  const unobserved = checks.some(check => check.status === "not_observed");
  return {
    taskId: task.id,
    taskFingerprint: hash({ id: task.id, inputs: run.inputHashes ?? task.inputs, prompts: task.prompts, checks: task.checks }),
    variant: run.variant,
    status: failed ? "fail" : unobserved ? "incomplete" : "pass",
    checks,
    configuration: run.configuration,
    modelConfigurationFingerprint: configurationFingerprint(run.configuration),
    tokenSaver: run.tokenSaver ?? null,
    tokenSaverVerified: run.tokenSaverVerified === true,
    evidenceSource: run.evidenceSource,
    metrics: {
      durationMs: finite(run.metrics?.durationMs) ? run.metrics.durationMs : null,
      inputTokens: finite(run.metrics?.inputTokens) ? run.metrics.inputTokens : null,
      outputTokens: finite(run.metrics?.outputTokens) ? run.metrics.outputTokens : null,
      totalTokens: finite(run.metrics?.totalTokens) ? run.metrics.totalTokens : null,
      usageScope: run.metrics?.usageScope ?? "not_measured",
    },
  };
}

export function summarizeReport(suite, runs, mode) {
  const count = status => runs.filter(run => run.status === status).length;
  const observed = runs.filter(run => ["pass", "fail"].includes(run.status));
  const attempted = runs.filter(run => run.status !== "skipped");
  const pairs = [];
  for (const task of suite.tasks) {
    const entries = runs.filter(run => run.taskId === task.id);
    if (entries.length !== 2) continue;
    const [first, second] = entries;
    const sameConfig = first.modelConfigurationFingerprint === second.modelConfigurationFingerprint;
    const comparable = first.evidenceSource === "live_local_api" && second.evidenceSource === "live_local_api" && sameConfig && first.taskFingerprint === second.taskFingerprint && first.tokenSaverVerified && second.tokenSaverVerified && first.tokenSaver !== second.tokenSaver;
    pairs.push({ taskId: task.id, comparable, sameModelConfiguration: sameConfig,
      reason: comparable ? "Matched live task/model configuration and observed opposite Token Saver settings" : "Requires live evidence, matched task/model configuration and verified opposite Token Saver settings" });
  }
  return {
    schemaVersion: 1,
    applicationVersion: suite.applicationVersion,
    suiteFingerprint: hash(suite),
    mode,
    modelQualityMeasured: mode === "live_local_api",
    summary: {
      total: runs.length,
      passed: count("pass"),
      failed: count("fail"),
      incomplete: count("incomplete"),
      skipped: count("skipped"),
      taskSuccessRate: attempted.length ? count("pass") / attempted.length : null,
      evidenceCoverage: attempted.length ? observed.length / attempted.length : null,
    },
    comparisons: pairs,
    limitations: mode === "offline_fixture"
      ? ["Synthetic fixtures exercise grading and report reproducibility only. No model was called; fixture success is not model capability or paid A/B evidence."]
      : ["Local API metadata verifies the configured model, not the provider's actual internal backend.", "No wire telemetry or Token Saver configuration endpoint exists in the current local API. Missing observations are incomplete, and Token Saver A/B comparisons remain unverified.", "Usage is from available main-session trajectory events; retries, compaction, title, memory and subagent consumption may be missing. Do not treat it as total billing."],
    runs,
  };
}

export async function runOfflineBaseline(suite) {
  suite ??= await loadBaseline();
  const root = await mkdtemp(resolve(tmpdir(), "mingshen-harness-eval-offline-"));
  const runs = [];
  try {
    for (const tokenSaver of [false, true]) {
      for (const task of suite.tasks) {
        const workspace = resolve(root, `${task.id}-${tokenSaver ? "on" : "off"}`);
        await mkdir(workspace);
        const inputHashes = await prepareTaskWorkspace(workspace, task);
        for (const [path, content] of Object.entries(task.fixtureOutputs)) await writeScoped(workspace, path, content);
        const tools = task.fixtureTools.map(tool => ({ ...tool, status: "completed" }));
        runs.push(await gradeTask(task, {
          workspace, inputHashes, tools, observations: { responsesReplay: true, nativeImageInput: true, boundedFileRead: true },
          variant: tokenSaver ? "token-saver-on" : "token-saver-off", tokenSaver, tokenSaverVerified: true,
          configuration: fixtureConfig, evidenceSource: "synthetic_fixture", metrics: { usageScope: "not_measured" },
        }));
      }
    }
    return summarizeReport(suite, runs, "offline_fixture");
  } finally { await rm(root, { recursive: true, force: true }); }
}

function localEndpoint(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:", "Only the existing HTTP loopback API is supported");
  assert.equal(url.hostname, "127.0.0.1", "Local API must use 127.0.0.1");
  assert.ok(url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "Invalid local API URL");
  return url.origin;
}

export function validateLiveConfig(config, environment = process.env) {
  assert.equal(environment.MINGSHEN_HARNESS_EVAL_LIVE, "1", "Live model requests require MINGSHEN_HARNESS_EVAL_LIVE=1");
  assert.equal(config.isolatedProfile, true, "Use an explicitly configured isolated evaluation profile");
  assert.ok(Array.isArray(config.variants) && config.variants.length >= 1 && config.variants.length <= 2);
  return config.variants.map(variant => {
    const apiUrl = localEndpoint(variant.apiUrl);
    assert.match(variant.tokenEnv, /^[A-Z][A-Z0-9_]{2,127}$/);
    const bearer = environment[variant.tokenEnv];
    assert.ok(typeof bearer === "string" && bearer.length > 0, "Local API bearer token environment variable is unset");
    assert.ok(typeof variant.providerId === "string" && variant.providerId);
    assert.ok(typeof variant.modelId === "string" && variant.modelId);
    assert.ok(variant.reasoning === null || typeof variant.reasoning === "string");
    assert.ok(typeof variant.name === "string" && /^[a-zA-Z0-9_-]{1,48}$/.test(variant.name));
    const timeoutMs = variant.timeoutMs ?? 180000;
    assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 3600000);
    return { ...variant, apiUrl, bearer, timeoutMs };
  });
}

async function api(variant, path, method = "GET", input) {
  const response = await fetch(`${variant.apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${variant.bearer}`, ...(input ? { "Content-Type": "application/json" } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Local API ${method} failed with HTTP ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

function trajectoryUsage(trajectories) {
  const entries = trajectories.flatMap(trajectory => trajectory.events ?? []).filter(event => event.type === "usage").map(event => event.payload);
  const sum = key => entries.length && entries.every(entry => finite(entry?.[key])) ? entries.reduce((total, entry) => total + entry[key], 0) : null;
  return { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), totalTokens: sum("totalTokens"), usageScope: "available_main_session_usage_events" };
}

export async function runLiveBaseline(config, suite, environment = process.env) {
  suite ??= await loadBaseline();
  const variants = validateLiveConfig(config, environment);
  const root = await mkdtemp(resolve(tmpdir(), "mingshen-harness-eval-live-"));
  const runs = [];
  let retainWorkspace = false;
  try {
    for (const variant of variants) {
      const providers = await api(variant, "/provider");
      const provider = providers.find(item => item.id === variant.providerId);
      const model = provider?.models.find(item => item.id === variant.modelId && item.enabled);
      assert.ok(provider && model, "Evaluation provider/model not found or disabled");
      const endpoint = new URL(provider.baseUrl);
      assert.ok(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, "Provider endpoint must not contain credentials");
      const configuration = {
        protocol: provider.protocol, modelId: model.modelId, reasoning: variant.reasoning,
        contextWindow: model.contextWindow, maxOutputTokens: model.maxOutputTokens,
        endpoint: endpoint.href, source: "local_api_provider_metadata",
      };
      configurationFingerprint(configuration);
      for (const task of suite.tasks) {
        if (task.requires === "openai_responses" && provider.protocol !== task.requires ||
            task.requires === "image" && !model.inputModalities.includes("image")) {
          runs.push({ taskId: task.id, variant: variant.name, status: "skipped", reason: `Model does not meet ${task.requires}`, checks: [], configuration, modelConfigurationFingerprint: configurationFingerprint(configuration) });
          continue;
        }
        const workspace = resolve(root, `${task.id}-${variant.name}`);
        await mkdir(workspace);
        const inputHashes = await prepareTaskWorkspace(workspace, task);
        const started = Date.now();
        let session;
        let failure = null;
        let messages = [];
        let trajectories = [];
        try {
          session = await api(variant, "/session", "POST", {
            title: `Harness eval ${task.id} ${randomUUID()}`,
            providerId: variant.providerId, modelId: variant.modelId,
            workspacePath: workspace, agentProfileId: variant.agentProfileId ?? "mingshen",
            permissionMode: "full_access", executionMode: "host", reasoningLevel: variant.reasoning,
            systemPrompt: "This is a bounded evaluation in a disposable workspace. Work only in this workspace, preserve input files, do not access credentials or any other project, and do not add dependencies. Perform the requested tool actions and verify artifacts.",
          });
          const sid = encodeURIComponent(session.id);
          for (const prompt of task.prompts) {
            await api(variant, `/session/${sid}/message`, "POST", { text: prompt });
            const deadline = Date.now() + variant.timeoutMs;
            while (true) {
              const current = await api(variant, `/session/${sid}`);
              if (current.status === "idle") break;
              if (current.status === "waiting_approval") throw new Error("Evaluation needs user approval");
              if (current.status === "error" || current.status === "interrupted") throw new Error("Evaluation run failed or was interrupted");
              if (Date.now() >= deadline) throw new Error("Evaluation timed out");
              await delay(200);
            }
          }
          messages = await api(variant, `/session/${sid}/message`);
          trajectories = await api(variant, `/session/${sid}/trajectory`);
        } catch (error) {
          failure = error instanceof Error ? error.message : "Evaluation failed";
        } finally {
          if (session?.id) {
            const sid = encodeURIComponent(session.id);
            if (failure) await api(variant, `/session/${sid}/abort`, "POST").catch(() => {});
            try { await api(variant, `/session/${sid}`, "DELETE"); }
            catch {
              retainWorkspace = true;
              failure ??= "Evaluation session cleanup was not confirmed; its disposable workspace was retained.";
            }
          }
        }
        const observations = observationsFromMessages(messages);
        const run = await gradeTask(task, {
          workspace, inputHashes, ...observations, variant: variant.name,
          configuration, evidenceSource: "live_local_api", tokenSaver: null, tokenSaverVerified: false,
          metrics: { durationMs: Date.now() - started, ...trajectoryUsage(trajectories) },
        });
        if (failure) {
          run.status = "fail";
          run.checks.push({ id: "run-completed", kind: "runtime", status: "fail", detail: failure });
        }
        runs.push(run);
      }
    }
    const report = summarizeReport(suite, runs, "live_local_api");
    if (retainWorkspace) report.cleanup = { workspaceRetained: root, reason: "Session deletion was not confirmed" };
    return report;
  } finally { if (!retainWorkspace) await rm(root, { recursive: true, force: true }); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("node scripts/harness-eval.mjs [--output report.json]\nnode scripts/harness-eval.mjs --live controlled-config.json [--output report.json]\nDefault is offline synthetic grading fixtures; live requires MINGSHEN_HARNESS_EVAL_LIVE=1 and an isolated local API profile. No user DB or provider key is read.");
    return;
  }
  const option = name => {
    const index = args.indexOf(name);
    if (index < 0) return null;
    assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `Missing ${name} value`);
    return args[index + 1];
  };
  const livePath = option("--live");
  if (livePath) assert.equal(process.env.MINGSHEN_HARNESS_EVAL_LIVE, "1", "Live mode is opt-in");
  const report = livePath
    ? await runLiveBaseline(JSON.parse(await readFile(resolve(livePath), "utf8")))
    : await runOfflineBaseline();
  const output = option("--output");
  if (output) await writeFile(resolve(output), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
  if (report.summary.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
