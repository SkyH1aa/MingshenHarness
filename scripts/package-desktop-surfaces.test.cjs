const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  checkDesktopSurfaceRuntime,
  checkDesktopSurfaceSources,
  COMPANION_MOTION_IDS,
} = require("./package-desktop-surfaces.cjs");

const ROOT = path.resolve(__dirname, "..");
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fixture-png"),
]);

function runtimeFixture() {
  const entries = new Map();
  const add = (name, value) => entries.set(name, Buffer.isBuffer(value) ? value : Buffer.from(value));
  for (const name of ["index", "startup", "companion"])
    add(`out/preload/${name}.js`, 'const electron = require("electron");');

  add(
    "out/renderer/index.html",
    '<script type="module" src="./assets/index.js"></script><link rel="stylesheet" href="./assets/index.css">',
  );
  add(
    "out/renderer/startup.html",
    '<link rel="modulepreload" href="./assets/startup-shared.js"><script type="module" src="./assets/startup.js"></script>',
  );
  add("out/renderer/companion.html", '<script type="module" src="./assets/companion.js"></script>');
  for (const name of [
    "index.js",
    "index.css",
    "startup-shared.js",
    "startup.js",
    "companion.js",
  ])
    add(`out/renderer/assets/${name}`, "fixture");
  add("out/renderer/assets/atom-companion-abc123.png", PNG);
  const motions = COMPANION_MOTION_IDS.map((id) => {
    const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from(id)]);
    const basename = `${id}-abc123.webm`;
    add(`out/renderer/assets/${basename}`, bytes);
    return {
      id,
      file: `${id}.webm`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      duration: 5,
      loop: id.endsWith("loop"),
    };
  });
  add("out/renderer/assets/companion.js", JSON.stringify(motions.map(({ id }) => `${id}-abc123.webm`)));

  return {
    entries,
    readFile: (relative) => entries.get(relative) ?? null,
    files: new Set(entries.keys()),
    expectedCompanionMotions: { version: 1, canvas: { width: 720, height: 720 }, fps: 24, motions },
  };
}

function companionHash() {
  return createHash("sha256").update(PNG).digest("hex");
}

test("checks all desktop preload, renderer, and companion runtime files", () => {
  const fixture = runtimeFixture();
  const result = checkDesktopSurfaceRuntime({
    ...fixture,
    expectedCompanionAsset: companionHash(),
  });
  assert.equal(result.preloads.length, 3);
  assert.equal(result.renderer.length, 3);
  assert.equal(result.companionAsset.file, "out/renderer/assets/atom-companion-abc123.png");
  assert.equal(result.companionMotions.count, 36);
});

test("rejects a missing companion preload instead of relying on the host source tree", () => {
  const fixture = runtimeFixture();
  fixture.entries.delete("out/preload/companion.js");
  fixture.files.delete("out/preload/companion.js");
  assert.throws(
    () => checkDesktopSurfaceRuntime(fixture),
    /Missing desktop surface file: preload companion\.js/,
  );
});

test("rejects HTML entries that point at an omitted module or stylesheet", () => {
  const fixture = runtimeFixture();
  fixture.entries.delete("out/renderer/assets/index.css");
  fixture.files.delete("out/renderer/assets/index.css");
  assert.throws(
    () => checkDesktopSurfaceRuntime(fixture),
    /Missing desktop surface file: renderer reference \.\/assets\/index\.css/,
  );
});

test("rejects sandbox preloads that import generated relative chunks", () => {
  const fixture = runtimeFixture();
  fixture.entries.set(
    "out/preload/startup.js",
    'const electron = require("electron"); require("./chunks/startup-C123.js");',
  );
  assert.throws(
    () => checkDesktopSurfaceRuntime(fixture),
    /unsupported dependency: \.\/chunks\/startup-C123\.js/,
  );
});

test("rejects ordinary packages and undeclared builtins from sandbox preloads", () => {
  const fixture = runtimeFixture();
  fixture.entries.set("out/preload/index.js", 'const electron = require("electron"); require("node:path");');
  assert.throws(
    () => checkDesktopSurfaceRuntime(fixture),
    /unsupported dependency: node:path/,
  );
  fixture.entries.set("out/preload/index.js", 'const electron = require("electron"); require("left-pad");');
  assert.throws(
    () => checkDesktopSurfaceRuntime(fixture),
    /unsupported dependency: left-pad/,
  );
});

test("rejects an empty, non-PNG, or stale companion asset", () => {
  const fixture = runtimeFixture();
  fixture.entries.set("out/renderer/assets/atom-companion-abc123.png", Buffer.from("not png"));
  assert.throws(() => checkDesktopSurfaceRuntime(fixture), /not a PNG/);

  fixture.entries.set("out/renderer/assets/atom-companion-abc123.png", PNG);
  assert.throws(
    () => checkDesktopSurfaceRuntime({ ...fixture, expectedCompanionAsset: Buffer.from("old artwork") }),
    /Stale compiled companion asset/,
  );
});

test("checks source HTML, preload, and companion artwork entry points", () => {
  assert.doesNotThrow(() => checkDesktopSurfaceSources(ROOT));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "msh-desktop-surfaces-source-"));
  try {
    const desktop = path.join(temporary, "apps", "desktop");
    for (const file of [
      "src/preload/index.ts",
      "src/preload/startup.ts",
      "src/preload/companion.ts",
      "src/renderer/index.html",
      "src/renderer/startup.html",
      "src/renderer/companion.html",
      "src/renderer/companion-assets/atom-companion.png",
    ]) {
      const target = path.join(desktop, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.endsWith(".png") ? PNG : "fixture");
    }
    fs.writeFileSync(
      path.join(desktop, "src/renderer/index.html"),
      '<script type="module" src="/src/main.tsx"></script>',
    );
    assert.throws(
      () => checkDesktopSurfaceSources(temporary),
      /Missing source renderer reference: \/src\/main\.tsx/,
    );
  } finally {
    const safeTempRoot = fs.realpathSync(os.tmpdir());
    const target = fs.realpathSync(temporary);
    const relative = path.relative(safeTempRoot, target);
    assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`));
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("rejects missing, duplicate, and unreferenced compiled motion assets", () => {
  const missing = runtimeFixture();
  missing.files.delete("out/renderer/assets/pat-abc123.webm");
  assert.throws(() => checkDesktopSurfaceRuntime(missing), /Expected one compiled companion motion: pat/);

  const duplicate = runtimeFixture();
  duplicate.files.add("out/renderer/assets/pat-old.webm");
  assert.throws(() => checkDesktopSurfaceRuntime(duplicate), /Expected one compiled companion motion: pat/);

  const unreferenced = runtimeFixture();
  unreferenced.entries.set("out/renderer/assets/companion.js", Buffer.from("no video references"));
  assert.throws(() => checkDesktopSurfaceRuntime(unreferenced), /not referenced by the renderer/);
});

test("rejects stale, malformed, and incomplete motion assets and manifests", () => {
  const stale = runtimeFixture();
  stale.entries.set("out/renderer/assets/pat-abc123.webm", Buffer.from("stale"));
  assert.throws(() => checkDesktopSurfaceRuntime(stale), /Not a WebM/);

  const wrongHash = runtimeFixture();
  wrongHash.expectedCompanionMotions.motions[0].sha256 = "0".repeat(64);
  assert.throws(() => checkDesktopSurfaceRuntime(wrongHash), /Stale companion motion/);

  const incomplete = runtimeFixture();
  incomplete.expectedCompanionMotions.motions.pop();
  assert.throws(() => checkDesktopSurfaceRuntime(incomplete), /Expected all 36 companion motions/);

  const wrongSize = runtimeFixture();
  wrongSize.expectedCompanionMotions.motions[0].bytes += 1;
  assert.throws(() => checkDesktopSurfaceRuntime(wrongSize), /size mismatch/);
});

test("only accepts video references reachable from the companion renderer entry", () => {
  const fixture = runtimeFixture();
  const references = fixture.entries.get("out/renderer/assets/companion.js");
  fixture.entries.set("out/renderer/assets/orphan.js", references);
  fixture.files.add("out/renderer/assets/orphan.js");
  fixture.entries.set("out/renderer/assets/companion.js", Buffer.from("no video references"));
  assert.throws(() => checkDesktopSurfaceRuntime(fixture), /not referenced by the renderer/);

  fixture.entries.set("out/renderer/assets/companion.js", Buffer.from('import "./orphan.js";'));
  assert.equal(checkDesktopSurfaceRuntime(fixture).companionMotions.count, 36);

  fixture.entries.set("out/renderer/assets/companion.js", Buffer.from('import("./orphan.js");'));
  assert.equal(checkDesktopSurfaceRuntime(fixture).companionMotions.count, 36);
});
