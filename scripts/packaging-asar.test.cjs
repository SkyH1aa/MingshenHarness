const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const { test } = require('node:test');
const asar = require('@electron/asar');
const { extractAsarDirectory, listResourceFiles } = require('./check-package.cjs');

function inside(root, target) {
  const local = path.relative(root, target);
  return Boolean(local) && local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local);
}

test('extracts the packaged prompt reference tree from app.asar with exact bytes', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mingshen-prompt-asar-'));
  const target = fs.realpathSync(temporary);
  t.after(() => {
    assert.ok(inside(fs.realpathSync(os.tmpdir()), target));
    fs.rmSync(target, { recursive: true, force: true });
  });

  const source = path.join(target, 'source');
  const skill = path.join(source, 'resources/prompts/skills/plugin-creator');
  const reference = path.join(skill, 'references/local-plugin-development.md');
  const promptRoot = path.join(source, 'resources/prompts');
  const archive = path.join(target, 'app.asar');
  const destination = path.join(target, 'extracted/prompts');
  fs.mkdirSync(path.dirname(reference), { recursive: true });
  fs.writeFileSync(path.join(source, 'resources/prompts/skills/plugin-creator.md'), 'Sibling skill file\n');
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '# Plugin Creator\n');
  fs.writeFileSync(reference, 'ASAR reference bytes\n');

  const stream = await asar.createPackageWithOptions(source, archive, {});
  await finished(stream);

  const files = extractAsarDirectory(asar, archive, 'resources/prompts', destination);
  assert.deepEqual(files, [
    'skills/plugin-creator.md',
    'skills/plugin-creator/references/local-plugin-development.md',
    'skills/plugin-creator/SKILL.md',
  ]);
  assert.deepEqual(files, listResourceFiles(promptRoot));
  assert.equal(
    fs.readFileSync(path.join(destination, 'skills/plugin-creator/references/local-plugin-development.md'), 'utf8'),
    'ASAR reference bytes\n',
  );
});
