const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("yaml");

const desktop = path.resolve(__dirname, "../apps/desktop");
const build = path.join(desktop, "build");

function readBmp(name) {
  const buffer = fs.readFileSync(path.join(build, name));
  assert.equal(buffer.toString("ascii", 0, 2), "BM");
  assert.equal(buffer.readUInt32LE(2), buffer.length);
  assert.equal(buffer.readUInt32LE(10), 54);
  assert.equal(buffer.readUInt32LE(14), 40);
  assert.equal(buffer.readUInt16LE(26), 1);
  assert.equal(buffer.readUInt16LE(28), 24);

  const width = buffer.readInt32LE(18);
  const height = buffer.readInt32LE(22);
  const stride = Math.ceil((width * 3) / 4) * 4;
  assert.equal(buffer.length, 54 + stride * height);
  return {
    width,
    height,
    pixel(x, y) {
      const offset = 54 + (height - y - 1) * stride + x * 3;
      return [buffer[offset + 2], buffer[offset + 1], buffer[offset]];
    },
  };
}

function findMakensis() {
  const cache = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "electron-builder", "Cache")
    : null;
  if (!cache || !fs.existsSync(cache)) return null;

  const pending = [cache];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const resolved = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "makensis.exe") return resolved;
      if (entry.isDirectory() && !entry.name.startsWith(".")) pending.push(resolved);
    }
  }
  return null;
}

test("installer bitmaps use the required NSIS dimensions and expected palettes", () => {
  const sidebar = readBmp("installer-sidebar.bmp");
  const header = readBmp("installer-header.bmp");

  assert.deepEqual([sidebar.width, sidebar.height], [164, 314]);
  assert.deepEqual(sidebar.pixel(0, 0), [12, 23, 33]);
  assert.deepEqual([header.width, header.height], [500, 100]);
  assert.deepEqual(header.pixel(0, 0), [247, 251, 252]);
});

test("installer atom animation contains eight valid NSIS sidebars", () => {
  for (let frame = 0; frame < 8; frame += 1) {
    const bitmap = readBmp(`installer-atom-frame-${String(frame).padStart(2, "0")}.bmp`);
    assert.deepEqual([bitmap.width, bitmap.height], [164, 314]);
    assert.deepEqual(bitmap.pixel(0, 0), [12, 23, 33]);
    assert.ok(fs.statSync(path.join(build, `installer-atom-frame-${String(frame).padStart(2, "0")}.bmp`)).size > 0);
  }
});

test("NSIS keeps the existing app icons and uses generated brand art for assisted pages", () => {
  const config = yaml.parse(fs.readFileSync(path.join(desktop, "electron-builder.yml"), "utf8"));
  assert.equal(config.win.icon, "build/icon.ico");
  assert.equal(config.nsis.installerIcon, "build/icon.ico");
  assert.equal(config.nsis.uninstallerIcon, "build/icon.ico");
  assert.equal(config.nsis.installerHeader, "build/installer-header.bmp");
  assert.equal(config.nsis.installerSidebar, "build/installer-sidebar.bmp");
  assert.equal(config.nsis.uninstallerSidebar, "build/installer-sidebar.bmp");
  assert.equal(config.nsis.include, "build/installer.nsh");
  assert.deepEqual(config.nsis.installerLanguages, ["en_US", "zh_CN"]);
  for (const filename of [
    "icon.ico",
    "installer-atom-mark.png",
    "installer-header.bmp",
    "installer-sidebar.bmp",
    ...Array.from({ length: 8 }, (_, frame) => `installer-atom-frame-${String(frame).padStart(2, "0")}.bmp`),
  ])
    assert.ok(fs.statSync(path.join(build, filename)).size > 0, `Missing build resource: ${filename}`);
});

test("NSIS retains retryable 7z extraction and packages prompts inside app.asar", () => {
  const config = yaml.parse(fs.readFileSync(path.join(desktop, "electron-builder.yml"), "utf8"));
  assert.equal(config.asar, true);
  assert.equal(Object.hasOwn(config.nsis, "useZip"), false);
  assert.equal(Object.hasOwn(config.nsis, "differentialPackage"), false);
  assert.ok(
    config.files.includes("resources/prompts/**/*"),
    "Prompt and Skill resources must be packaged inside app.asar",
  );
  assert.ok(
    !config.extraResources.some(entry => entry?.from === "resources/prompts"),
    "Prompt and Skill resources must not be extracted as extra resources",
  );

  const extractionTemplate = path.resolve(
    __dirname,
    "../node_modules/app-builder-lib/templates/nsis/include/extractAppPackage.nsh",
  );
  const extraction = fs.readFileSync(extractionTemplate, "utf8");
  assert.match(
    extraction,
    /!macro decompress[\s\S]*?!else[\s\S]*?extractUsing7za "\$PLUGINSDIR\\app-\$packageArch\.7z"[\s\S]*?!endif/,
    "electron-builder must use its default staged 7z extraction branch",
  );
  assert.match(extraction, /CopyFiles \/SILENT "\$PLUGINSDIR\\7z-out\\\*" \$OUTDIR/);
  assert.match(extraction, /\$R1 < 5/);
});

test("update handoff carries both Electron and legacy NSIS update flags", () => {
  const include = fs.readFileSync(path.join(build, "installer.nsh"), "utf8");
  assert.match(include, /\$\{GetOptions\} \$0 "--updated" \$1/);
  assert.match(include, /\$\{GetOptions\} \$0 "\/updated" \$1/);
  const main = fs.readFileSync(path.join(desktop, "src/main/index.ts"), "utf8");
  assert.match(
    main,
    /app\.relaunch\(\{ execPath: updateInstaller, args: \["--updated"\] \}\)/,
  );
});

test("custom NSIS welcome page compiles in an isolated UI-only fixture", t => {
  const makensis = findMakensis();
  if (!makensis) {
    t.skip("electron-builder NSIS compiler cache is unavailable");
    return;
  }

  const keepFixture = process.env.MINGSHEN_KEEP_INSTALLER_FIXTURE === "1";
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "MingshenHarness-installer-ui-"));
  const scriptPath = path.join(fixture, "installer-ui.nsi");
  const config = yaml.parse(fs.readFileSync(path.join(desktop, "electron-builder.yml"), "utf8"));
  const languageMacros = new Map([
    ["en_US", "English"],
    ["zh_CN", "SimpChinese"],
  ]);
  const languages = config.nsis.installerLanguages;
  assert.ok(Array.isArray(languages) && languages.length > 0);
  const muiLanguages = languages.map(language => languageMacros.get(language));
  assert.ok(muiLanguages.every(Boolean), `No NSIS language macro mapping for: ${languages.join(", ")}`);
  const script = [
    "Unicode true",
    'Name "Mingshen Installer UI Fixture"',
    `OutFile "${path.join(fixture, "installer-ui-fixture.exe")}"`,
    '!include "MUI2.nsh"',
    `!define BUILD_RESOURCES_DIR "${build}"`,
    `!include "${path.join(build, "installer.nsh")}"`,
    "!insertmacro customWelcomePage",
    "!insertmacro MUI_PAGE_INSTFILES",
    ...muiLanguages.map(language => `!insertmacro MUI_LANGUAGE "${language}"`),
    "Section \"UI fixture only\"",
    "SectionEnd",
    "",
  ].join("\n");

  try {
    fs.writeFileSync(scriptPath, script);
    const result = spawnSync(makensis, ["/V2", "/WX", scriptPath], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /warning\s+\d+:/i);
    assert.ok(fs.statSync(path.join(fixture, "installer-ui-fixture.exe")).size > 0);
    if (keepFixture) console.log(`NSIS UI fixture retained at ${fixture}`);
  } finally {
    if (!keepFixture) fs.rmSync(fixture, { recursive: true, force: true });
  }
});
