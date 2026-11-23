const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const workspace = path.resolve(__dirname, "..");
const build = path.join(workspace, "apps", "desktop", "build");
const icon = path.join(build, "icon.png");
const atomMark = path.join(build, "installer-atom-mark.png");

function encodeBmp24({ data, width, height }) {
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowStride * height;
  const output = Buffer.alloc(54 + pixelBytes);
  output.write("BM", 0, 2, "ascii");
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixelBytes, 34);
  output.writeInt32LE(2835, 38);
  output.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - y - 1;
    const rowOffset = 54 + y * rowStride;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * width + x) * 4;
      const targetOffset = rowOffset + x * 3;
      output[targetOffset] = data[sourceOffset + 2];
      output[targetOffset + 1] = data[sourceOffset + 1];
      output[targetOffset + 2] = data[sourceOffset];
    }
  }
  return output;
}

async function toAlphaPng(input, width, height, opacity) {
  const { data, info } = await sharp(input)
    .resize(width, height, { fit: "contain" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 3; offset < data.length; offset += 4) {
    data[offset] = Math.round(data[offset] * opacity);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function createAtomMark() {
  const { data, info } = await sharp(icon)
    .extract({ left: 250, top: 230, width: 524, height: 560 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(info.width * info.height * 4);

  for (let source = 0, target = 0; source < data.length; source += 4, target += 4) {
    const red = data[source];
    const green = data[source + 1];
    const blue = data[source + 2];
    const opacity = Math.max(0, Math.min(1, (
      (red - 27) / 177 + (green - 28) / 199 + (blue - 36) / 195
    ) / 3));
    output[target] = 204;
    output[target + 1] = 227;
    output[target + 2] = 231;
    output[target + 3] = Math.round(opacity * data[source + 3]);
  }

  await sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim()
    .png()
    .toFile(atomMark);
}

function sidebarSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
    <rect width="164" height="314" fill="#0c1721"/>
    <path d="M0 226H164" stroke="#1e3744" stroke-width="1"/>
    <path d="M0 244H164" stroke="#15313e" stroke-width="1"/>
    <path d="M18 0V314M42 0V314M130 0V314M148 0V314" stroke="#102832" stroke-width="1"/>
    <path d="M-18 116C16 94 53 96 83 116s68 22 99 1" fill="none" stroke="#18b8c7" stroke-opacity=".22" stroke-width="2"/>
    <path d="M-22 122C15 102 51 103 82 122s68 21 104 0" fill="none" stroke="#5ee4e7" stroke-opacity=".16" stroke-width="1"/>
    <text x="18" y="240" fill="#b9e9ec" font-family="Segoe UI,Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="1.1">MINGSHEN</text>
    <text x="18" y="258" fill="#6dd4dc" font-family="Segoe UI,Arial,sans-serif" font-size="10" letter-spacing="1.2">HARNESS</text>
    <text x="18" y="284" fill="#7c9aa3" font-family="Segoe UI,Arial,sans-serif" font-size="8">LOCAL-FIRST AI WORKSPACE</text>
  </svg>`;
}

function headerSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100" viewBox="0 0 500 100">
    <rect width="500" height="100" fill="#f7fbfc"/>
    <path d="M0 78H500" stroke="#d9e9eb" stroke-width="1"/>
    <path d="M350 0h150v100H350z" fill="#e9f6f7"/>
    <path d="M355 13h137M355 23h98M355 33h122" stroke="#b5e1e5" stroke-width="1"/>
    <text x="106" y="43" fill="#12343d" font-family="Segoe UI,Arial,sans-serif" font-size="20" font-weight="600" letter-spacing=".2">Mingshen Harness</text>
    <text x="108" y="64" fill="#4f7780" font-family="Segoe UI,Arial,sans-serif" font-size="10" letter-spacing="1.2">A CALMER WAY TO BUILD WITH AGENTS</text>
  </svg>`;
}

function sidebarBaseSvg(frame = 0) {
  // The installer mark uses a real orbital phase so every frame carries a
  // different state, rather than mirroring a symmetric pulse waveform.
  const rotation = -32 + frame * 45;
  const angle = (rotation * Math.PI) / 180;
  const centerX = 82;
  const centerY = 73;
  const radiusX = 51;
  const radiusY = 24;
  const electronX = centerX + radiusX * Math.cos(angle);
  const electronY = centerY + radiusY * Math.sin(angle);
  const glow = 0.48 + ((frame % 3) * 0.08);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
    <rect width="164" height="314" fill="#0c1721"/>
    <path d="M0 226H164" stroke="#1e3744" stroke-width="1"/>
    <path d="M0 244H164" stroke="#15313e" stroke-width="1"/>
    <path d="M18 0V314M42 0V314M130 0V314M148 0V314" stroke="#102832" stroke-width="1"/>
    <path d="M-18 116C16 94 53 96 83 116s68 22 99 1" fill="none" stroke="#18b8c7" stroke-opacity=".22" stroke-width="2"/>
    <path d="M-22 122C15 102 51 103 82 122s68 21 104 0" fill="none" stroke="#5ee4e7" stroke-opacity=".16" stroke-width="1"/>
    <ellipse cx="${centerX}" cy="${centerY}" rx="${radiusX}" ry="${radiusY}" transform="rotate(${rotation} ${centerX} ${centerY})" fill="none" stroke="#9cebed" stroke-opacity=".28" stroke-width="1" stroke-dasharray="4 5"/>
    <circle cx="${electronX.toFixed(2)}" cy="${electronY.toFixed(2)}" r="2.8" fill="#d5fbfc" fill-opacity="${glow.toFixed(2)}"/>
    <circle cx="${electronX.toFixed(2)}" cy="${electronY.toFixed(2)}" r="5.5" fill="none" stroke="#49d8df" stroke-opacity=".22" stroke-width="1"/>
    <text x="18" y="240" fill="#b9e9ec" font-family="Segoe UI,Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="1.1">MINGSHEN</text>
    <text x="18" y="258" fill="#6dd4dc" font-family="Segoe UI,Arial,sans-serif" font-size="10" letter-spacing="1.2">HARNESS</text>
    <text x="18" y="284" fill="#7c9aa3" font-family="Segoe UI,Arial,sans-serif" font-size="8">LOCAL-FIRST AI WORKSPACE</text>
  </svg>`;
}

async function writeBmp(name, svg, iconSize, iconLeft, iconTop) {
  const base = sharp(Buffer.from(svg));
  const mark = await sharp(atomMark).resize(iconSize, iconSize, { fit: "contain" }).png().toBuffer();
  const image = await base.composite([{ input: mark, left: iconLeft, top: iconTop }]).flatten({ background: "#f7fbfc" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  await fs.writeFile(path.join(build, name), encodeBmp24({ data: image.data, width: image.info.width, height: image.info.height }));
}

async function writeSidebarFrame(frame) {
  const phase = (frame / 8) * Math.PI * 2;
  const pulse = (Math.sin(phase) + 1) / 2;
  const size = Math.round(84 + pulse * 13);
  const left = Math.round(40 - (size - 92) / 2);
  const top = Math.round(30 - (size - 92) / 2);
  const opacity = 0.68 + pulse * 0.32;
  const mark = await toAlphaPng(atomMark, size, size, opacity);
  const image = await sharp(Buffer.from(sidebarBaseSvg(frame)))
    .composite([
      { input: mark, left, top },
    ])
    .flatten({ background: "#0c1721" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const filename = `installer-atom-frame-${String(frame).padStart(2, "0")}.bmp`;
  await fs.writeFile(path.join(build, filename), encodeBmp24({
    data: image.data,
    width: image.info.width,
    height: image.info.height,
  }));
}

async function main() {
  await fs.access(icon);
  await fs.mkdir(build, { recursive: true });
  await createAtomMark();
  // The sidebar uses the dark product surface; the header intentionally stays light
  // so the existing MUI wizard text remains readable in Windows high-contrast modes.
  const side = await sharp(Buffer.from(sidebarSvg())).composite([
    { input: await sharp(atomMark).resize(92, 92, { fit: "contain" }).png().toBuffer(), left: 36, top: 26 },
  ]).flatten({ background: "#0c1721" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  await fs.writeFile(path.join(build, "installer-sidebar.bmp"), encodeBmp24({ data: side.data, width: side.info.width, height: side.info.height }));
  await writeBmp("installer-header.bmp", headerSvg(), 64, 24, 8);
  await Promise.all(Array.from({ length: 8 }, (_, frame) => writeSidebarFrame(frame)));
  console.log("Generated installer-sidebar.bmp (164x314), installer-header.bmp (500x100), and 8 atom animation frames");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
