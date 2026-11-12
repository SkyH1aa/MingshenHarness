import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  configurationFingerprint,
  gradeTask,
  loadBaseline,
  observationsFromMessages,
  prepareTaskWorkspace,
  runLiveBaseline,
  runOfflineBaseline,
  summarizeReport,
  validateLiveConfig,
} from "./harness-eval.mjs";

const model = {
  protocol: "openai_responses",
  modelId: "actual-model-id",
  reasoning: "low",
  contextWindow: 200000,
  maxOutputTokens: 30000,
};

test("model fingerprints include actual routing and every generation budget", () => {
  const fingerprint = configurationFingerprint(model);
  assert.equal(fingerprint, configurationFingerprint({ ...model, displayName: "Different UI label" }));
  for (const change of [
    { protocol: "openai_chat_completions" },
    { modelId: "other-backend-id" },
    { reasoning: "high" },
    { contextWindow: 128000 },
    { maxOutputTokens: 4096 },
    { endpoint: "https://other.example/v1" },
  ]) assert.notEqual(fingerprint, configurationFingerprint({ ...model, ...change }));
  assert.throws(() => configurationFingerprint({ ...model, modelId: "" }));
  assert.throws(() => configurationFingerprint({ ...model, maxOutputTokens: 0 }));
});

test("fixed offline baseline is reproducible and never claims a paid model evaluation", async () => {
  const suite = await loadBaseline();
  assert.deepEqual(suite.tasks.map(task => task.id), ["responses-state", "visual-inspection", "long-command", "file-pagination", "multiagent", "history-retention"]);
  const first = await runOfflineBaseline(suite);
  const second = await runOfflineBaseline(suite);
  assert.deepEqual(first, second);
  assert.equal(first.summary.total, 12);
  assert.equal(first.summary.passed, 12);
  assert.equal(first.summary.failed, 0);
  assert.equal(first.modelQualityMeasured, false);
  assert.ok(first.runs.every(run => run.evidenceSource === "synthetic_fixture"));
  assert.ok(first.runs.every(run => run.metrics.totalTokens === null && run.metrics.durationMs === null));
  assert.ok(first.comparisons.every(pair => pair.comparable === false));
});

test("missing telemetry is incomplete, different artifacts fail, and unchanged inputs are checked", async () => {
  const suite = await loadBaseline();
  const task = suite.tasks[0];
  const workspace = await mkdtemp(resolve(tmpdir(), "mingshen-eval-grader-"));
  try {
    const inputHashes = await prepareTaskWorkspace(workspace, task);
    const run = { workspace, inputHashes, configuration: model, variant: "test", tools: task.fixtureTools, evidenceSource: "live_local_api" };
    const missing = await gradeTask(task, run);
    assert.equal(missing.status, "fail");
    assert.equal(missing.checks.find(check => check.id === "state-replay").status, "not_observed");
    await writeFile(resolve(workspace, "input/state.json"), '{"changed":true}');
    const changed = await gradeTask(task, run);
    assert.equal(changed.checks.find(check => check.id === "input:input/state.json").status, "fail");
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("grader rejects escaped artifact paths", async () => {
  const workspace = await mkdtemp(resolve(tmpdir(), "mingshen-eval-path-"));
  try {
    const task = { id: "escape", inputs: {}, prompts: ["Test"], checks: [{ id: "escape", kind: "artifact_text", path: "../outside.txt", contains: ["secret"] }] };
    const result = await gradeTask(task, { workspace, configuration: model, variant: "test" });
    assert.equal(result.status, "fail");
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("tool evidence requires completed execution and bounded read evidence ignores pending calls", async () => {
  const task = { id: "tool", prompts: ["Test"], checks: [{ id: "executed", kind: "tools", names: ["read_file"], minimum: 1 }] };
  for (const status of [undefined, "pending", "running", "failed", "denied", "completed"]) {
    const tool = { type: "tool_call", name: "read_file", arguments: '{"path":"input/large.txt","start_line":601,"limit":100}', status };
    const data = observationsFromMessages([{ parts: [tool] }]);
    assert.equal(data.observations.boundedFileRead, status === "completed");
    const result = await gradeTask(task, { configuration: model, variant: "test", ...data });
    assert.equal(result.status, status === "completed" ? "pass" : "fail");
  }
});

test("captured Responses state and returned images are not confused with wire replay", () => {
  const data = observationsFromMessages([{ parts: [
    { type: "responses_state", items: [{ type: "reasoning", encrypted_content: "opaque-fixture" }] },
    { type: "tool_result", images: [{ dataUrl: "data:image/png;base64,fixture" }], isError: false },
    { type: "tool_call", name: "read_file", arguments: JSON.stringify({ path: "input/large.txt", start_line: 601, end_line: 700 }), status: "completed" },
  ] }]);
  assert.equal(data.observations.responsesStateCaptured, true);
  assert.equal(data.observations.imageResultCaptured, true);
  assert.equal(data.observations.boundedFileRead, true);
  assert.equal(Object.hasOwn(data.observations, "responsesReplay"), false);
  assert.equal(Object.hasOwn(data.observations, "nativeImageInput"), false);
});

test("A/B comparisons reject mismatched models and unobserved Token Saver settings", () => {
  const suite = { tasks: [{ id: "task" }], applicationVersion: "1.3.0" };
  const first = { taskId: "task", taskFingerprint: "same-task", evidenceSource: "live_local_api", status: "pass", modelConfigurationFingerprint: "one", tokenSaver: false, tokenSaverVerified: true };
  const second = { ...first, tokenSaver: true, tokenSaverVerified: false };
  assert.equal(summarizeReport(suite, [first, second], "live_local_api").comparisons[0].comparable, false);
  assert.equal(summarizeReport(suite, [first, { ...second, tokenSaverVerified: true, modelConfigurationFingerprint: "two" }], "live_local_api").comparisons[0].comparable, false);
  assert.equal(summarizeReport(suite, [first, { ...second, tokenSaverVerified: true }], "live_local_api").comparisons[0].comparable, true);
});

test("live mode requires explicit opt-in and only accepts an isolated loopback API", () => {
  const config = { isolatedProfile: true, variants: [{
    name: "test", apiUrl: "http://127.0.0.1:4096", tokenEnv: "MINGSHEN_EVAL_TOKEN",
    providerId: "provider", modelId: "model", reasoning: "low",
  }] };
  assert.throws(() => validateLiveConfig(config, {}), /MINGSHEN_HARNESS_EVAL_LIVE/);
  const env = { MINGSHEN_HARNESS_EVAL_LIVE: "1", MINGSHEN_EVAL_TOKEN: "local-test-only" };
  assert.equal(validateLiveConfig(config, env)[0].bearer, "local-test-only");
  assert.throws(() => validateLiveConfig({ ...config, isolatedProfile: false }, env), /isolated/);
  for (const apiUrl of ["http://example.com:4096", "http://localhost:4096", "http://user:pass@127.0.0.1:4096", "http://127.0.0.1:4096/?token=secret"])
    assert.throws(() => validateLiveConfig({ ...config, variants: [{ ...config.variants[0], apiUrl }] }, env));
});

test("live adapter exercises the actual local API contract using only its own temporary session", async () => {
  const suite = await loadBaseline();
  const task = suite.tasks[0];
  const requests = [];
  let workspace;
  let deleted = false;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    requests.push([request.method, request.url]);
    assert.equal(request.headers.authorization, "Bearer local-test-only");
    response.setHeader("Content-Type", "application/json");
    let value;
    if (request.url === "/provider") value = [{
      id: "provider", baseUrl: "https://fixture.invalid/v1", protocol: "openai_responses",
      models: [{ ...model, id: "config-model", enabled: true, inputModalities: ["text", "image"] }],
    }];
    else if (request.method === "POST" && request.url === "/session") {
      workspace = body.workspacePath;
      assert.ok(workspace.includes("mingshen-harness-eval-live-"));
      assert.equal(body.reasoningLevel, "low");
      assert.equal(body.modelId, "config-model");
      value = { id: "owned-session" };
    } else if (request.method === "POST" && request.url === "/session/owned-session/message") {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(resolve(workspace, "out"), { recursive: true });
      await writeFile(resolve(workspace, "out/state.json"), task.fixtureOutputs["out/state.json"]);
      value = { runId: "fixture-run" };
    } else if (request.method === "GET" && request.url === "/session/owned-session") value = { status: "idle" };
    else if (request.url === "/session/owned-session/message") value = [{ parts: [
      { type: "tool_call", name: "read_file", arguments: '{"path":"input/state.json"}', status: "completed" },
      { type: "responses_state", items: [{ type: "reasoning", encrypted_content: "opaque-never-in-report" }] },
    ] }];
    else if (request.url === "/session/owned-session/trajectory") value = [{ events: [{ type: "usage", payload: { inputTokens: 110, outputTokens: 10, totalTokens: 120 } }] }];
    else if (request.method === "DELETE" && request.url === "/session/owned-session") { deleted = true; value = true; }
    else { response.statusCode = 404; value = {}; }
    response.end(JSON.stringify(value));
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  try {
    const report = await runLiveBaseline({ isolatedProfile: true, variants: [{
      name: "local-test", apiUrl: `http://127.0.0.1:${server.address().port}`, tokenEnv: "MINGSHEN_EVAL_TOKEN",
      providerId: "provider", modelId: "config-model", reasoning: "low",
    }] }, { ...suite, tasks: [task] }, { MINGSHEN_HARNESS_EVAL_LIVE: "1", MINGSHEN_EVAL_TOKEN: "local-test-only" });
    assert.equal(report.runs[0].configuration.modelId, "actual-model-id");
    assert.equal(report.runs[0].status, "incomplete");
    assert.equal(report.runs[0].metrics.totalTokens, 120);
    assert.equal(report.runs[0].tokenSaverVerified, false);
    assert.equal(report.summary.taskSuccessRate, 0);
    assert.equal(deleted, true);
    assert.equal(JSON.stringify(report).includes("local-test-only"), false);
    assert.equal(JSON.stringify(report).includes("opaque-never-in-report"), false);
    assert.ok(requests.every(([, path]) => path === "/provider" || path === "/session" || path.startsWith("/session/owned-session")));
    await assert.rejects(readFile(resolve(workspace, "out/state.json")), /ENOENT/);
  } finally { await new Promise(done => server.close(done)); }
});
