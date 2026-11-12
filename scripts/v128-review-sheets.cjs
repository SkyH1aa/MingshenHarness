const { createRequire } = require('node:module');
const { readdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const appRequire = createRequire(resolve('apps/desktop/package.json'));
const { createCanvas, loadImage } = appRequire('@napi-rs/canvas');

async function main() {
  const root = resolve('.impeccable/review');
  const names = (await readdir(root)).filter(name => name.endsWith('.png'));
  const groups = {
    layouts: names.filter(name => /^v128-(chat|code|agents)-(en|zh-CN)-/.test(name)),
    settings: names.filter(name => /^v128-settings-\d+-/.test(name)).sort((a, b) =>
      Number(a.match(/settings-(\d+)/)[1]) - Number(b.match(/settings-(\d+)/)[1])),
  };
  for (const [group, files] of Object.entries(groups)) {
    const columns = 3, width = 480, height = 330, label = 28;
    const canvas = createCanvas(columns * width, Math.ceil(files.length / columns) * height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#343438'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < files.length; i++) {
      const image = await loadImage(resolve(root, files[i]));
      const scale = Math.min(width / image.width, (height - label) / image.height);
      const x = (i % columns) * width, y = Math.floor(i / columns) * height;
      context.fillStyle = '#ffffff'; context.font = '13px Segoe UI';
      context.fillText(files[i], x + 8, y + 19);
      context.drawImage(image, x + (width - image.width * scale) / 2, y + label,
        image.width * scale, image.height * scale);
    }
    const target = resolve(root, `v128-sheet-${group}.png`);
    await writeFile(target, canvas.toBuffer('image/png'));
    console.log(target);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
