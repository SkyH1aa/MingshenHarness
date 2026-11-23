const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const SURFACE_NAMES = ["index", "startup", "companion"];
const PRELOAD_FILES = SURFACE_NAMES.map((name) => `out/preload/${name}.js`);
const RENDERER_HTML_FILES = SURFACE_NAMES.map((name) => `out/renderer/${name}.html`);
const SOURCE_PRELOAD_FILES = SURFACE_NAMES.map((name) => `src/preload/${name}.ts`);
const SOURCE_RENDERER_HTML_FILES = SURFACE_NAMES.map((name) => `src/renderer/${name}.html`);
const COMPANION_ASSET_BASENAME = "atom-companion";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBM_SIGNATURE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const COMPANION_MOTIONS_MANIFEST = "src/renderer/companion-assets/motions/manifest.json";
const COMPANION_MOTION_IDS = Object.freeze([
  "idle_breathe", "look_around", "greet_wave", "nod", "shake_head", "pat", "stretch",
  "dance", "jump", "drink", "thinking_enter", "thinking_loop", "thinking_exit",
  "working_enter", "working_loop", "working_exit", "waiting", "success", "error",
  "sleep_start", "sleep_loop", "sleep_end", "drag_pickup", "drag_loop", "drop_land",
  "turn_left", "walk_left", "stop_left", "turn_right", "walk_right", "stop_right",
  "listen", "notify", "read_enter", "read_loop", "read_exit",
]);

// Each sandbox preload currently imports Electron only. Any extra dependency,
// including a Node builtin or a generated relative chunk, must be reviewed here.
const ALLOWED_PRELOAD_MODULES = new Set(["electron"]);

function normalizeEntry(value) {
  return String(value).replaceAll("\\", "/").replace(/^\/+/, "");
}

function asBuffer(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value);
  throw new TypeError("Desktop surface reader must return a Buffer, Uint8Array, string, or null");
}

function assertFile(readFile, files, relative, label = relative) {
  const normalized = normalizeEntry(relative);
  assert.ok(files.has(normalized), `Missing desktop surface file: ${label} (${normalized})`);
  const value = asBuffer(readFile(normalized));
  assert.ok(value && value.length > 0, `Empty desktop surface file: ${label} (${normalized})`);
  return value;
}

function isLocalReference(reference) {
  if (!reference || reference.startsWith("#")) return false;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return false;
  return true;
}

function referencePath(reference, baseDirectory) {
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  const joined = withoutQuery.startsWith("/")
    ? path.posix.join("", withoutQuery)
    : path.posix.join(baseDirectory, withoutQuery);
  return normalizeEntry(joined);
}

function rendererReferences(html) {
  const references = [];
  const pattern = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    const reference = match[1];
    if (isLocalReference(reference)) references.push(reference);
  }
  return references;
}

function lexicalTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      const quote = character;
      const start = index;
      index += 1;
      let value = "";
      while (index < source.length) {
        const current = source[index];
        if (current === "\\") {
          const escaped = source[index + 1];
          if (escaped == null) break;
          value += escaped;
          index += 2;
          continue;
        }
        if (current === quote) {
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      tokens.push({ type: "string", value, start });
      continue;
    }
    if (character === "`") {
      // Template literals can contain arbitrary expressions. They are not a
      // valid static preload dependency, so skip them as one lexical token.
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          break;
        }
        index += 1;
      }
      tokens.push({ type: "template", value: source.slice(start, index), start });
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push({ type: "identifier", value: source.slice(start, index), start });
      continue;
    }
    tokens.push({ type: "punctuation", value: character, start: index });
    index += 1;
  }
  return tokens;
}

function staticModuleDependencies(source, { strict = true } = {}) {
  const dependencies = [];
  function add(dependency) {
    if (!dependencies.includes(dependency)) dependencies.push(dependency);
  }
  const tokens = lexicalTokens(source);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    const next = tokens[index + 1];
    if ((token.value === "require" || token.value === "import") && next?.value === "(") {
      const argument = tokens[index + 2];
      if (!strict && argument?.type !== "string") continue;
      assert.ok(
        argument?.type === "string",
        "Sandbox preload must use only statically analyzable module dependencies",
      );
      add(argument.value);
      continue;
    }
    if ((token.value === "import" || token.value === "export") && next?.type === "string") {
      add(next.value);
      continue;
    }
    if (token.value === "import" || token.value === "export") {
      for (let cursor = index + 1; cursor < Math.min(tokens.length, index + 80); cursor += 1) {
        if (tokens[cursor].value === ";") break;
        if (tokens[cursor].type === "identifier" && tokens[cursor].value === "from") {
          const argument = tokens[cursor + 1];
          assert.ok(argument?.type === "string", "Sandbox preload import must be statically analyzable");
          add(argument.value);
          break;
        }
      }
    }
  }
  return dependencies;
}

function companionRendererScripts(readFile, files) {
  const htmlPath = "out/renderer/companion.html";
  const html = assertFile(readFile, files, htmlPath).toString("utf8");
  const pending = [...html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter(isLocalReference)
    .map((reference) => referencePath(reference, path.posix.dirname(htmlPath)));
  const visited = new Set();
  const scripts = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.ok(file.startsWith("out/renderer/"), `Companion module escapes renderer output: ${file}`);
    const source = assertFile(readFile, files, file, "companion renderer module").toString("utf8");
    scripts.push(source);
    for (const dependency of staticModuleDependencies(source, { strict: false })) {
      if (!dependency.startsWith(".") && !dependency.startsWith("/")) continue;
      pending.push(referencePath(dependency, path.posix.dirname(file)));
    }
  }
  return scripts;
}

function checkPreloadDependencies(readFile, files, relative) {
  const source = assertFile(readFile, files, relative, `preload ${path.posix.basename(relative)}`).toString(
    "utf8",
  );
  const dependencies = staticModuleDependencies(source);
  for (const dependency of dependencies) {
    assert.ok(
      ALLOWED_PRELOAD_MODULES.has(dependency),
      `Sandbox preload ${relative} has an unsupported dependency: ${dependency}`,
    );
    assert.ok(
      !dependency.startsWith(".") && !dependency.startsWith("/"),
      `Sandbox preload ${relative} has a relative code-split dependency: ${dependency}`,
    );
  }
  return { file: relative, dependencies };
}

function expectedSha256(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return createHash("sha256").update(value).digest("hex");
  if (typeof value === "string") {
    if (/^[a-f\d]{64}$/i.test(value)) return value.toLowerCase();
    if (fs.existsSync(value) && fs.statSync(value).isFile())
      return createHash("sha256").update(fs.readFileSync(value)).digest("hex");
    throw new TypeError("expectedCompanionAsset must be a SHA-256 digest, file path, or bytes");
  }
  if (typeof value === "object") {
    if (value.sha256 != null) {
      assert.match(String(value.sha256), /^[a-f\d]{64}$/i, "Invalid companion asset SHA-256 digest");
      return String(value.sha256).toLowerCase();
    }
    for (const key of ["buffer", "source", "path"]) {
      if (value[key] != null) return expectedSha256(value[key]);
    }
  }
  throw new TypeError("Unsupported expectedCompanionAsset value");
}

function isPng(buffer) {
  return buffer.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.equals(buffer.subarray(0, PNG_SIGNATURE.length));
}

function companionAssetCandidates(files) {
  return [...files].filter((entry) => {
    const normalized = normalizeEntry(entry);
    return new RegExp(`(?:^|/)assets/${COMPANION_ASSET_BASENAME}(?:-[^/]+)?\\.png$`, "i").test(normalized);
  });
}

function checkCompanionAsset(readFile, files, expectedCompanionAsset) {
  const candidates = companionAssetCandidates(files);
  assert.equal(candidates.length, 1, `Expected exactly one compiled companion PNG, found ${candidates.length}`);
  const asset = candidates[0];
  const bytes = assertFile(readFile, files, asset, "compiled companion asset");
  assert.ok(isPng(bytes), `Compiled companion asset is not a PNG: ${asset}`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expected = expectedSha256(expectedCompanionAsset);
  if (expected) assert.equal(digest, expected, `Stale compiled companion asset: ${asset}`);
  return { file: asset, sha256: digest, bytes: bytes.length };
}

function companionMotionManifest(value) {
  const manifest = typeof value === "string"
    ? JSON.parse(fs.readFileSync(value, "utf8"))
    : value;
  assert.ok(manifest && typeof manifest === "object", "Companion motion manifest is required");
  assert.equal(manifest.version, 1, "Unsupported companion motion manifest version");
  assert.ok(
    Number.isInteger(manifest.canvas?.width) && manifest.canvas.width > 0 &&
      Number.isInteger(manifest.canvas?.height) && manifest.canvas.height > 0,
    "Invalid companion motion canvas",
  );
  assert.ok(Number.isFinite(manifest.fps) && manifest.fps > 0, "Invalid companion motion frame rate");
  assert.ok(Array.isArray(manifest.motions), "Companion motions must be an array");
  assert.equal(manifest.motions.length, COMPANION_MOTION_IDS.length, "Expected all 36 companion motions");
  const ids = new Set();
  for (const motion of manifest.motions) {
    assert.ok(COMPANION_MOTION_IDS.includes(motion.id), `Unknown companion motion: ${motion.id}`);
    assert.ok(!ids.has(motion.id), `Duplicate companion motion: ${motion.id}`);
    ids.add(motion.id);
    assert.equal(motion.file, `${motion.id}.webm`, `Invalid companion motion filename: ${motion.id}`);
    assert.match(motion.sha256 ?? "", /^[a-f\d]{64}$/, `Invalid companion motion hash: ${motion.id}`);
    assert.ok(Number.isSafeInteger(motion.bytes) && motion.bytes > 0, `Invalid companion motion size: ${motion.id}`);
    assert.ok(Number.isFinite(motion.duration) && motion.duration > 0, `Invalid companion motion duration: ${motion.id}`);
    assert.equal(typeof motion.loop, "boolean", `Invalid companion motion loop setting: ${motion.id}`);
  }
  return manifest;
}

function checkMotionBytes(bytes, motion, label) {
  assert.ok(WEBM_SIGNATURE.equals(bytes.subarray(0, WEBM_SIGNATURE.length)), `Not a WebM: ${label}`);
  assert.equal(bytes.length, motion.bytes, `Companion motion size mismatch: ${label}`);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    motion.sha256,
    `Stale companion motion: ${label}`,
  );
}

function checkCompanionMotions(readFile, files, expectedManifest) {
  const manifest = companionMotionManifest(expectedManifest);
  const emittedScripts = companionRendererScripts(readFile, files);
  const motions = manifest.motions.map((motion) => {
    const candidates = [...files].filter((entry) =>
      new RegExp(`^out/renderer/assets/${motion.id}(?:-[^/]+)?\\.webm$`).test(entry),
    );
    assert.equal(candidates.length, 1, `Expected one compiled companion motion: ${motion.id}`);
    const asset = candidates[0];
    const bytes = assertFile(readFile, files, asset, `companion motion ${motion.id}`);
    checkMotionBytes(bytes, motion, asset);
    assert.ok(
      emittedScripts.some((script) => script.includes(path.posix.basename(asset))),
      `Companion motion is not referenced by the renderer: ${motion.id}`,
    );
    return { id: motion.id, file: asset, bytes: bytes.length, sha256: motion.sha256 };
  });
  return { count: motions.length, bytes: motions.reduce((sum, motion) => sum + motion.bytes, 0), motions };
}

/**
 * Validate all files needed by the three Electron renderer surfaces after Vite
 * has emitted them. `readFile` should accept a normalized package-relative path
 * and return bytes or null; `files` is the corresponding normalized file set.
 */
function checkDesktopSurfaceRuntime({ readFile, files, expectedCompanionAsset, expectedCompanionMotions } = {}) {
  assert.equal(typeof readFile, "function", "Desktop surface reader is required");
  assert.ok(files && typeof files.has === "function", "Desktop surface file set is required");

  const normalizedFiles = new Set([...files].map(normalizeEntry));
  const preloadChecks = PRELOAD_FILES.map((file) => checkPreloadDependencies(readFile, normalizedFiles, file));
  const htmlChecks = [];
  for (const file of RENDERER_HTML_FILES) {
    const html = assertFile(readFile, normalizedFiles, file, `renderer ${path.posix.basename(file)}`).toString("utf8");
    const baseDirectory = path.posix.dirname(file);
    const references = rendererReferences(html);
    const resolved = references.map((reference) => {
      const target = referencePath(reference, baseDirectory);
      assertFile(readFile, normalizedFiles, target, `renderer reference ${reference}`);
      return target;
    });
    htmlChecks.push({ file, references: resolved });
  }

  return {
    preloads: preloadChecks,
    renderer: htmlChecks,
    companionAsset: checkCompanionAsset(readFile, normalizedFiles, expectedCompanionAsset),
    companionMotions: checkCompanionMotions(
      readFile,
      normalizedFiles,
      expectedCompanionMotions ?? path.resolve(__dirname, "../apps/desktop", COMPANION_MOTIONS_MANIFEST),
    ),
  };
}

function sourceRoot(root) {
  const resolved = path.resolve(root || process.cwd());
  if (fs.existsSync(path.join(resolved, "src", "renderer", "index.html"))) return resolved;
  const desktop = path.join(resolved, "apps", "desktop");
  if (fs.existsSync(path.join(desktop, "src", "renderer", "index.html"))) return desktop;
  throw new Error(`Unable to locate apps/desktop sources under ${resolved}`);
}

function checkDesktopSurfaceSources(root) {
  const desktop = sourceRoot(root);
  const readFile = (relative) => {
    const file = path.join(desktop, relative.replaceAll("/", path.sep));
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  };
  const files = new Set([
    ...SOURCE_PRELOAD_FILES,
    ...SOURCE_RENDERER_HTML_FILES,
    "src/renderer/companion-assets/atom-companion.png",
  ]);
  for (const file of files) assertFile(readFile, files, file, `source ${file}`);

  const sourceReferences = [];
  for (const file of SOURCE_RENDERER_HTML_FILES) {
    const html = readFile(file).toString("utf8");
    const base = path.posix.dirname(file);
    for (const reference of rendererReferences(html)) {
      const target = referencePath(reference, base);
      // Vite source HTML uses /src/... paths rooted at src/renderer.
      const sourceTarget = target.startsWith("src/renderer/") ? target : `src/renderer/${target}`;
      const candidate = path.join(desktop, sourceTarget.replaceAll("/", path.sep));
      assert.ok(fs.existsSync(candidate) && fs.statSync(candidate).isFile(), `Missing source renderer reference: ${reference}`);
      sourceReferences.push(sourceTarget);
    }
  }

  const companionAsset = path.join(desktop, "src", "renderer", "companion-assets", "atom-companion.png");
  const companionBytes = fs.readFileSync(companionAsset);
  assert.ok(isPng(companionBytes), "Source companion artwork must be a PNG");
  const manifest = companionMotionManifest(path.join(desktop, COMPANION_MOTIONS_MANIFEST));
  const motions = manifest.motions.map((motion) => {
    const file = path.join(desktop, path.posix.dirname(COMPANION_MOTIONS_MANIFEST), motion.file);
    assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing source companion motion: ${motion.id}`);
    checkMotionBytes(fs.readFileSync(file), motion, file);
    return motion;
  });
  return {
    root: desktop,
    preloads: SOURCE_PRELOAD_FILES,
    renderer: SOURCE_RENDERER_HTML_FILES.map((file) => ({ file })),
    sourceReferences,
    companionAsset: {
      file: path.relative(desktop, companionAsset).replaceAll(path.sep, "/"),
      sha256: createHash("sha256").update(companionBytes).digest("hex"),
      bytes: companionBytes.length,
    },
    companionMotions: { ...manifest, motions },
  };
}

module.exports = {
  ALLOWED_PRELOAD_MODULES,
  PRELOAD_FILES,
  RENDERER_HTML_FILES,
  SOURCE_PRELOAD_FILES,
  SOURCE_RENDERER_HTML_FILES,
  COMPANION_MOTION_IDS,
  COMPANION_MOTIONS_MANIFEST,
  checkDesktopSurfaceRuntime,
  checkDesktopSurfaceSources,
  companionAssetCandidates,
  rendererReferences,
  staticModuleDependencies,
};

if (require.main === module) {
  const desktop = sourceRoot(path.resolve(__dirname, ".."));
  const source = checkDesktopSurfaceSources(desktop);
  const output = path.join(desktop, "out");
  const files = new Set();
  function collect(directory, relative = "") {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const next = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) collect(path.join(directory, entry.name), next);
      else files.add(next);
    }
  }
  collect(output, "out");
  const readFile = (relative) => {
    const file = path.join(desktop, relative.replaceAll("/", path.sep));
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  };
  const runtime = checkDesktopSurfaceRuntime({
    readFile,
    files,
    expectedCompanionAsset: source.companionAsset.sha256,
    expectedCompanionMotions: source.companionMotions,
  });
  console.log(`Desktop surfaces passed: ${runtime.preloads.length} preloads, ${runtime.renderer.length} HTML entries, ${runtime.companionMotions.count} verified motions (${runtime.companionMotions.bytes} bytes), ${runtime.companionAsset.file}`);
}
