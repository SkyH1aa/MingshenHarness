const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

function inspectBitmap(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString("ascii", 0, 2), "BM", `Invalid BMP signature: ${file}`);
  assert.equal(buffer.readUInt32LE(2), buffer.length, `Invalid BMP byte length: ${file}`);
  assert.equal(buffer.readUInt32LE(10), 54, `Unexpected BMP pixel offset: ${file}`);
  assert.equal(buffer.readUInt32LE(14), 40, `Unexpected BMP DIB header: ${file}`);
  assert.equal(buffer.readUInt16LE(26), 1, `Unexpected BMP plane count: ${file}`);
  assert.equal(buffer.readUInt16LE(28), 24, `Installer bitmap must be 24-bit: ${file}`);

  const width = buffer.readInt32LE(18);
  const height = buffer.readInt32LE(22);
  const stride = Math.ceil((width * 3) / 4) * 4;
  assert.equal(buffer.length, 54 + stride * height, `Invalid BMP pixel data length: ${file}`);
  const pixel = (x, y) => {
    const offset = 54 + (height - y - 1) * stride + x * 3;
    return [buffer[offset + 2], buffer[offset + 1], buffer[offset]];
  };
  return { width, height, pixel, sha256: createHash("sha256").update(buffer).digest("hex") };
}

function checkInstallerVisuals({ desktopDirectory = path.resolve(__dirname, "../apps/desktop") } = {}) {
  const desktop = path.resolve(desktopDirectory);
  const build = path.join(desktop, "build");
  const requireDesktop = createRequire(path.join(desktop, "package.json"));
  const yaml = requireDesktop("yaml");
  const config = yaml.parse(fs.readFileSync(path.join(desktop, "electron-builder.yml"), "utf8"));

  assert.equal(config.win.icon, "build/icon.ico");
  assert.equal(config.nsis.installerIcon, "build/icon.ico");
  assert.equal(config.nsis.uninstallerIcon, "build/icon.ico");
  assert.equal(config.nsis.installerHeader, "build/installer-header.bmp");
  assert.equal(config.nsis.installerSidebar, "build/installer-sidebar.bmp");
  assert.equal(config.nsis.uninstallerSidebar, "build/installer-sidebar.bmp");
  assert.equal(config.nsis.include, "build/installer.nsh");
  assert.deepEqual(config.nsis.installerLanguages, ["en_US", "zh_CN"]);

  for (const name of ["icon.ico", "installer-atom-mark.png"]) {
    const file = path.join(build, name);
    assert.ok(fs.statSync(file).size > 0, `Missing installer image resource: ${file}`);
  }

  const sidebar = inspectBitmap(path.join(build, "installer-sidebar.bmp"));
  const header = inspectBitmap(path.join(build, "installer-header.bmp"));
  assert.deepEqual([sidebar.width, sidebar.height], [164, 314]);
  assert.deepEqual(sidebar.pixel(0, 0), [12, 23, 33]);
  assert.deepEqual([header.width, header.height], [500, 100]);
  assert.deepEqual(header.pixel(0, 0), [247, 251, 252]);

  const frames = [];
  for (let frame = 0; frame < 8; frame += 1) {
    const name = `installer-atom-frame-${String(frame).padStart(2, "0")}.bmp`;
    const bitmap = inspectBitmap(path.join(build, name));
    assert.deepEqual([bitmap.width, bitmap.height], [164, 314], `Invalid animation frame dimensions: ${name}`);
    assert.deepEqual(bitmap.pixel(0, 0), [12, 23, 33], `Unexpected animation frame background: ${name}`);
    frames.push(bitmap.sha256);
  }
  assert.equal(new Set(frames).size, 8, "Installer atom animation frames must all be visually distinct");

  const includePath = path.join(build, "installer.nsh");
  const include = fs.readFileSync(includePath, "utf8");
  assert.match(include, /!macro customWelcomePage[\s\S]*?Page custom mingshenWelcomeCreate(?:\r?\n|$)/);
  assert.doesNotMatch(include, /mingshenWelcomeLeave/);
  assert.match(include, /!include "FileFunc\.nsh"/);
  assert.match(include, /Function mingshenWelcomeCreate[\s\S]*?\$\{GetParameters\} \$0[\s\S]*?\$\{GetOptions\} \$0 "\/updated" \$1[\s\S]*?IfErrors mingshenWelcomeCreatePage[\s\S]*?Abort/);
  assert.match(include, /nsDialogs::Show[\s\S]*?Call mingshenWelcomeCleanup/);
  assert.doesNotMatch(include, /\$\{isUpdated\}/);
  assert.doesNotMatch(include, /TraceFile|MINGSHEN_INSTALLER_FRAME_TRACE/);
  assert.match(include, /\$\{NSD_CreateBitmap\}/);
  assert.match(include, /\$\{NSD_CreateTimer\} mingshenWelcomeTick 120/);
  assert.match(include, /\$\{NSD_KillTimer\} mingshenWelcomeTick/);
  assert.match(
    include,
    /IntCmp \$mingshen\.WelcomeFrame 8 mingshenWelcomeFrameReset mingshenWelcomeFrameReady mingshenWelcomeFrameReset/,
    "Animation counter must wrap at frame 8 and advance through frames 1-7",
  );
  assert.equal((include.match(/installer-atom-frame-\d\d\.bmp/g) || []).length, 8);

  return {
    sidebar: "installer-sidebar.bmp",
    header: "installer-header.bmp",
    frames: frames.length,
    include: "build/installer.nsh",
  };
}

module.exports = { checkInstallerVisuals, inspectBitmap };
