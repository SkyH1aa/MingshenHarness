const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateWindowsIcon } = require('./windows-icon.cjs');

const generator = path.join(__dirname, 'generate-icon.ps1');
const approvedPng = path.resolve(__dirname, '../apps/desktop/build/icon.png');
const windowsOnly = { skip: process.platform !== 'win32' };

function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function createFixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mingshen-generate-icon-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), temporary);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const directory = path.join(temporary, '\u539f\u5b50 \u56fe\u6807\u76ee\u5f55');
  fs.mkdirSync(directory);
  const png = path.join(directory, 'approved atom.png');
  const icon = path.join(directory, 'approved atom.ico');
  fs.copyFileSync(approvedPng, png);
  return { directory, icon, png };
}

function generate(png, icon) {
  return execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', generator, '-SourcePath', png, '-OutputPath', icon,
  ], { windowsHide: true, timeout: 30000, encoding: 'utf8', stdio: 'pipe' });
}

test('generates all approved icon sizes and replaces an existing icon in a Chinese path with spaces', windowsOnly, t => {
  const { directory, icon, png } = createFixture(t);
  const artworkHash = hashFile(png);
  generate(png, icon);
  const bytes = fs.readFileSync(icon);
  assert.equal(validateWindowsIcon(bytes), 8);
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => {
    const entry = 6 + index * 16;
    const width = bytes[entry] || 256;
    assert.equal(bytes[entry + 1] || 256, width);
    const offset = bytes.readUInt32LE(entry + 12);
    assert.deepEqual(bytes.subarray(offset, offset + 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    return width;
  }), [16, 20, 24, 32, 48, 64, 128, 256]);
  const oldTime = new Date('2001-01-01T00:00:00.000Z');
  fs.utimesSync(icon, oldTime, oldTime);

  generate(png, icon);
  assert.deepEqual(fs.readFileSync(icon), bytes);
  assert.ok(fs.statSync(icon).mtimeMs > oldTime.getTime());
  assert.equal(hashFile(png), artworkHash);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['approved atom.ico', 'approved atom.png']);
});

test('preserves an existing complete icon when the PNG cannot be decoded', windowsOnly, t => {
  const { directory, icon, png } = createFixture(t);
  generate(png, icon);
  const iconHash = hashFile(icon);
  fs.writeFileSync(png, 'invalid PNG fixture');
  const artworkHash = hashFile(png);

  assert.throws(() => generate(png, icon), error => Number.isInteger(error.status) && error.status !== 0);
  assert.equal(hashFile(icon), iconHash);
  assert.equal(validateWindowsIcon(fs.readFileSync(icon)), 8);
  assert.equal(hashFile(png), artworkHash);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['approved atom.ico', 'approved atom.png']);
});

test('preserves the old icon and removes temporary output when Windows locks the destination exclusively', windowsOnly, t => {
  const { directory, icon, png } = createFixture(t);
  generate(png, icon);
  const iconHash = hashFile(icon);
  const artworkHash = hashFile(png);
  // Keep the exclusive handle in the parent PowerShell while the real generator runs.
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', `
      $lock = [System.IO.File]::Open($env:MSH_ICON_TEST_OUTPUT, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
      try {
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $env:MSH_ICON_TEST_GENERATOR -SourcePath $env:MSH_ICON_TEST_SOURCE -OutputPath $env:MSH_ICON_TEST_OUTPUT 2>&1 | Out-String | Write-Output
        $generationExitCode = $LASTEXITCODE
      } finally { $lock.Dispose() }
      Write-Output ("Generation exit code: " + $generationExitCode)
      if ($generationExitCode -eq 0) { exit 1 }
    `,
  ], {
    windowsHide: true, timeout: 30000, encoding: 'utf8', stdio: 'pipe',
    env: {
      ...process.env,
      MSH_ICON_TEST_GENERATOR: generator,
      MSH_ICON_TEST_SOURCE: png,
      MSH_ICON_TEST_OUTPUT: icon,
    },
  });

  assert.match(output, /Generation exit code: [1-9]\d*/);
  assert.equal(hashFile(icon), iconHash);
  assert.equal(validateWindowsIcon(fs.readFileSync(icon)), 8);
  assert.equal(hashFile(png), artworkHash);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['approved atom.ico', 'approved atom.png']);
});

test('refuses to overwrite the source artwork with Windows icon bytes', windowsOnly, t => {
  const { directory, png } = createFixture(t);
  const artworkHash = hashFile(png);
  assert.throws(() => generate(png, png), error => Number.isInteger(error.status) && error.status !== 0);
  assert.equal(hashFile(png), artworkHash);
  assert.deepEqual(fs.readdirSync(directory), ['approved atom.png']);
});
