const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");
const vm = require("node:vm");

const previewRoot = __dirname;
const repositoryRoot = path.resolve(previewRoot, "../../..");
const assetsRoot = path.join(previewRoot, "assets");
const desktopRequire = createRequire(
  path.join(repositoryRoot, "apps/desktop/package.json"),
);
const React = desktopRequire("react");
const { renderToStaticMarkup } = desktopRequire("react-dom/server");
const lucide = desktopRequire("lucide-react");
const lucidePackagePath = desktopRequire.resolve("lucide-react/package.json");
const lucidePackage = JSON.parse(fs.readFileSync(lucidePackagePath, "utf8"));
const lucideRoot = path.dirname(lucidePackagePath);
const brandSource = path.join(
  repositoryRoot,
  "apps/desktop/src/renderer/src/assets/brand-icon.png",
);
const brandHash =
  "841eb6f7c648f81ab218fad16e055bf84fb8fcd53660a931da3e3e41ef1c95e2";

const iconExports = {
  activity: "Activity",
  "arrow-up": "ArrowUp",
  "arrow-up-right": "ArrowUpRight",
  bot: "Bot",
  brain: "Brain",
  check: "Check",
  "chevron-down": "ChevronDown",
  "chevron-right": "ChevronRight",
  code: "Code",
  copy: "Copy",
  cpu: "Cpu",
  "file-code": "FileCode",
  files: "Files",
  flask: "FlaskConical",
  folder: "Folder",
  "git-branch": "GitBranch",
  "git-pull-request": "GitPullRequest",
  "hard-drive": "HardDrive",
  info: "Info",
  layers: "Layers",
  "list-checks": "ListChecks",
  messages: "MessagesSquare",
  moon: "Moon",
  network: "Network",
  orbit: "Orbit",
  "panel-left": "PanelLeft",
  "panel-right": "PanelRight",
  pause: "Pause",
  play: "Play",
  plus: "Plus",
  search: "Search",
  settings: "Settings",
  shield: "Shield",
  "shield-check": "ShieldCheck",
  sparkles: "Sparkles",
  sun: "Sun",
  terminal: "Terminal",
  workflow: "Workflow",
  x: "X",
  zap: "Zap",
};

function sha256(filePath) {
  return createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

assert.equal(lucidePackage.version, "1.66.0");
assert.equal(sha256(brandSource), brandHash, "Confirmed brand icon changed");

const requestedIcons = new Set();
for (const sourceName of ["index.html", "preview.js"]) {
  const sourcePath = path.join(previewRoot, sourceName);
  if (!fs.existsSync(sourcePath)) continue;
  const source = fs.readFileSync(sourcePath, "utf8");
  for (const match of source.matchAll(/<use\s+href="#([a-z0-9-]+)"/g)) {
    requestedIcons.add(match[1]);
  }
}
assert.ok(requestedIcons.size > 0, "No preview icon references found");
for (const id of requestedIcons) {
  assert.ok(Object.hasOwn(iconExports, id), `Missing icon mapping: ${id}`);
}

const icons = {};
for (const [id, exportName] of Object.entries(iconExports)) {
  assert.ok(lucide[exportName], `Lucide export missing: ${exportName}`);
  const rendered = renderToStaticMarkup(
    React.createElement(lucide[exportName], {
      size: 24,
      strokeWidth: 1.6,
    }),
  );
  const innerStart = rendered.indexOf(">") + 1;
  const innerEnd = rendered.lastIndexOf("</svg>");
  assert.ok(rendered.startsWith("<svg ") && innerEnd > innerStart);
  const inner = rendered.slice(innerStart, innerEnd);
  assert.ok(inner.length > 0, `Empty icon: ${id}`);
  assert.doesNotMatch(inner, /<script\b|\bon[a-z]+\s*=|(?:href|src)=/i);
  icons[id] =
    '<g fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    inner +
    "</g>";
}

const sprite =
  '<svg xmlns="http://www.w3.org/2000/svg">\n' +
  `<!-- Generated from lucide-react ${lucidePackage.version}; see LUCIDE-LICENSE.txt. -->\n` +
  Object.entries(icons)
    .map(
      ([id, inner]) =>
        `  <symbol id="${id}" viewBox="0 0 24 24">${inner}</symbol>`,
    )
    .join("\n") +
  "\n</svg>\n";
const scriptJson = JSON.stringify(icons, null, 2).replace(
  /[<>&\u2028\u2029]/g,
  (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
);
const script =
  `// Generated from lucide-react ${lucidePackage.version}; see LUCIDE-LICENSE.txt.\n` +
  `window.HARNESS_ICONS = Object.freeze(${scriptJson});\n`;

fs.mkdirSync(assetsRoot, { recursive: true });
fs.writeFileSync(path.join(assetsRoot, "icons.svg"), sprite, "utf8");
fs.writeFileSync(path.join(assetsRoot, "icons.js"), script, "utf8");
fs.copyFileSync(brandSource, path.join(assetsRoot, "brand-icon.png"));
fs.copyFileSync(
  path.join(lucideRoot, "LICENSE"),
  path.join(assetsRoot, "LUCIDE-LICENSE.txt"),
);

const context = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(assetsRoot, "icons.js"), "utf8"),
  context,
  { timeout: 1000 },
);
assert.equal(Object.keys(context.window.HARNESS_ICONS).length, 40);
for (const id of requestedIcons) {
  assert.equal(context.window.HARNESS_ICONS[id], icons[id]);
  assert.ok(sprite.includes(`<symbol id="${id}" `));
}
assert.equal(sha256(path.join(assetsRoot, "brand-icon.png")), brandHash);
assert.equal(
  sha256(path.join(assetsRoot, "LUCIDE-LICENSE.txt")),
  sha256(path.join(lucideRoot, "LICENSE")),
);
console.log(
  `Generated ${Object.keys(icons).length} Lucide icons; ` +
    `verified ${requestedIcons.size} referenced icons, brand PNG SHA-256 ${brandHash}, ` +
    "and the unmodified Lucide license.",
);
