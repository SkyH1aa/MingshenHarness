const { app, BrowserWindow, nativeImage, shell } = require('electron');
const { resolve } = require('node:path');
const { mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const assert = require('node:assert/strict');

app.setName('Mingshen Taskbar Probe');
app.setAppUserModelId('com.mingshen.harness.icon-probe');
app.whenReady().then(async () => {
  const imagePath = resolve(__dirname, '../apps/desktop/build/icon.png');
  const icoPath = resolve(__dirname, '../apps/desktop/build/icon.ico');
  const png = nativeImage.createFromPath(imagePath);
  const ico = nativeImage.createFromPath(icoPath);
  assert.equal(png.isEmpty(), false);
  assert.equal(ico.isEmpty(), false);
  const fileIcon = await app.getFileIcon(process.execPath, { size: 'large' });
  const window = new BrowserWindow({ show: false, icon: icoPath, width: 800, height: 600 });
  window.setAppDetails({ appId: 'com.mingshen.harness.icon-probe', appIconPath: icoPath, appIconIndex: 0, relaunchDisplayName: 'Mingshen Taskbar Probe' });
  console.log(JSON.stringify({ pid: process.pid, handle: window.getNativeWindowHandle().readBigUInt64LE().toString(), png: { empty: png.isEmpty(), size: png.getSize() }, ico: { empty: ico.isEmpty(), size: ico.getSize() } }));
  mkdirSync(resolve(__dirname, '../.tmp/icon-probe'), { recursive: true });
  writeFileSync(resolve(__dirname, '../.tmp/icon-probe/taskbar-file-icon.png'), fileIcon.toPNG());
  console.log(shell.readShortcutLink(resolve(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs/Mingshen Harness Dev.lnk')));
  console.log('ELECTRON_SHORTCUT', shell.readShortcutLink(resolve(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs/Electron.lnk')));
  const builder = require.resolve('electron-builder', { paths: [resolve(__dirname, '../apps/desktop')] });
  const library = require.resolve('app-builder-lib', { paths: [require('node:path').dirname(builder)] });
  const resedit = require(require.resolve('resedit', { paths: [require('node:path').dirname(library)] }));
  const resources = resedit.NtExecutableResource.from(resedit.NtExecutable.from(readFileSync(process.execPath), { ignoreCert: true }));
  const icons = resedit.Data.IconFile.from(readFileSync(icoPath));
  const embedded = resources.entries.filter(entry => entry.type === 3);
  for (const icon of icons.icons)
    assert.ok(embedded.some(entry => Buffer.from(entry.bin).equals(Buffer.from(icon.data.bin || icon.data.generate()))), 'Executable must contain every approved icon size');
  const product = resedit.Resource.VersionInfo.fromEntries(resources.entries)[0];
  assert.equal(product.getStringValues({ lang: 1033, codepage: 1200 }).ProductName, 'Mingshen Harness Dev');
  console.log('PASS: Approved icon sizes and Mingshen product identity are embedded in the experimental executable.');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
