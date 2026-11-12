const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareExperimentalRuntime } = require('./prepare-experimental-runtime.cjs');
const { validateWindowsIcon } = require('./windows-icon.cjs');
const { resolveElectronRuntime } = require('./provision-electron-runtime.cjs');

const desktop = path.resolve(__dirname, '../apps/desktop');
const source = resolveElectronRuntime(desktop).executable;
const approvedPng = path.join(desktop, 'build/icon.png');
const defaultIcon = path.join(desktop, 'build/icon.ico');
const windowsOnly = { skip: process.platform !== 'win32' };

function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function createFixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mingshen-icon-test-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), temporary);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const directory = path.join(temporary, '\u56fe\u6807 \u5b9e\u9a8c\u76ee\u5f55');
  fs.mkdirSync(directory);
  const icon = path.join(directory, 'approved atom.ico');
  const png = path.join(directory, 'approved atom.png');
  const target = path.join(directory, 'MingshenHarnessExperimental.exe');
  fs.copyFileSync(approvedPng, png);
  return { directory, icon, png, target };
}

test('repairs an overwritten executable even when its cached preparation marker is unchanged', windowsOnly, t => {
  const { icon, png, target } = createFixture(t);
  const originalHash = hashFile(source);
  const artworkHash = hashFile(png);
  const defaultIconHash = hashFile(defaultIcon);
  assert.equal(prepareExperimentalRuntime({ icon, target }).changed, true);
  assert.equal(prepareExperimentalRuntime({ icon, target }).changed, false);
  const preparedHash = hashFile(target);
  assert.notEqual(preparedHash, originalHash);
  fs.copyFileSync(source, target);
  assert.equal(prepareExperimentalRuntime({ icon, target }).changed, true);
  assert.equal(hashFile(target), preparedHash);
  assert.equal(hashFile(source), originalHash);
  fs.writeFileSync(`${target}.json`, 'invalid marker');
  assert.equal(prepareExperimentalRuntime({ icon, target }).changed, true);
  assert.throws(() => prepareExperimentalRuntime({ source, target: source, icon }), /must not replace/);
  assert.equal(hashFile(png), artworkHash);
  assert.equal(hashFile(defaultIcon), defaultIconHash);
});

test('regenerates missing, empty and truncated icons from adjacent approved artwork', windowsOnly, async t => {
  const truncatedFrame = Buffer.alloc(26);
  truncatedFrame.writeUInt16LE(1, 2);
  truncatedFrame.writeUInt16LE(1, 4);
  truncatedFrame.writeUInt32LE(8, 14);
  truncatedFrame.writeUInt32LE(22, 18);
  const invalidPayload = Buffer.from(truncatedFrame);
  invalidPayload.writeUInt32LE(4, 14);
  for (const [name, damaged] of [
    ['missing', undefined],
    ['zero bytes', Buffer.alloc(0)],
    ['truncated directory', Buffer.from([0, 0, 1, 0, 8, 0, 16, 16])],
    ['truncated frame', truncatedFrame],
    ['invalid image payload', invalidPayload],
  ]) {
    await t.test(name, t => {
      const { directory, icon, png, target } = createFixture(t);
      const sourceHash = hashFile(source);
      const artworkHash = hashFile(png);
      const defaultIconHash = hashFile(defaultIcon);
      if (damaged !== undefined) fs.writeFileSync(icon, damaged);

      assert.equal(prepareExperimentalRuntime({ icon, target }).changed, true);
      assert.equal(validateWindowsIcon(fs.readFileSync(icon)), 8);
      const iconHash = hashFile(icon);
      const executableHash = hashFile(target);
      const markerHash = hashFile(`${target}.json`);
      const oldTime = new Date('2001-01-01T00:00:00.000Z');
      fs.utimesSync(icon, oldTime, oldTime);
      fs.utimesSync(target, oldTime, oldTime);
      fs.utimesSync(`${target}.json`, oldTime, oldTime);
      const timestamps = [icon, target, `${target}.json`].map(file => fs.statSync(file).mtimeMs);

      assert.equal(prepareExperimentalRuntime({ icon, target }).changed, false);
      assert.deepEqual([icon, target, `${target}.json`].map(file => fs.statSync(file).mtimeMs), timestamps);
      assert.equal(hashFile(icon), iconHash);
      assert.equal(hashFile(target), executableHash);
      assert.equal(hashFile(`${target}.json`), markerHash);
      assert.equal(hashFile(source), sourceHash);
      assert.equal(hashFile(png), artworkHash);
      assert.equal(hashFile(defaultIcon), defaultIconHash);
      assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp')), false);
    });
  }
});

test('reports an icon regeneration failure without replacing the runtime or source artwork', windowsOnly, t => {
  const { directory, icon, png, target } = createFixture(t);
  fs.writeFileSync(icon, Buffer.alloc(0));
  fs.writeFileSync(png, 'invalid PNG fixture');
  fs.writeFileSync(target, 'existing experimental executable fixture');
  fs.writeFileSync(`${target}.json`, 'existing preparation marker fixture');
  const protectedFiles = [source, png, icon, target, `${target}.json`, defaultIcon];
  const before = protectedFiles.map(hashFile);

  assert.throws(
    () => prepareExperimentalRuntime({ icon, target }),
    error => /Cannot regenerate the Windows icon/.test(error.message) && !/DataView|RangeError/.test(error.message),
  );
  assert.deepEqual(protectedFiles.map(hashFile), before);
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp')), false);
});
