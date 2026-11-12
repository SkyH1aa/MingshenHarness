const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { copyRuntimeFile } = require('./package-runtime-copy.cjs');

function denied(code = 'EPERM') {
  return Object.assign(new Error(`Simulated ${code}`), { code });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'mingshen-package-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'original.dll');
  const destination = path.join(root, 'copied.dll');
  const content = Buffer.from('Mingshen runtime fixture\0'.repeat(4000));
  await writeFile(source, content);
  return { source, destination, content };
}

test('falls back from Windows fast-copy EPERM to ordinary I/O and verifies the bytes', async t => {
  const f = await fixture(t);
  await copyRuntimeFile(f.source, f.destination, {
    copyFile: async () => { throw denied(); },
  });
  assert.deepEqual(await readFile(f.destination), f.content);
});

test('retries a temporary sharing error and replaces any partial destination', async t => {
  const f = await fixture(t);
  let tries = 0;
  const delays = [];
  await copyRuntimeFile(f.source, f.destination, {
    copyFile: async () => { throw denied(); },
    streamCopy: async (source, destination) => {
      if (++tries < 3) {
        await writeFile(destination, 'partial');
        throw denied('EBUSY');
      }
      await writeFile(destination, await readFile(source));
    },
    sleep: async ms => { delays.push(ms); },
  });
  assert.equal(tries, 3);
  assert.equal(delays.length, 2);
  assert.deepEqual(await readFile(f.destination), f.content);
});

test('fails after bounded retries and preserves the original filesystem error', async t => {
  const f = await fixture(t);
  let tries = 0;
  await assert.rejects(copyRuntimeFile(f.source, f.destination, {
    copyFile: async () => { throw denied(); },
    streamCopy: async () => { tries++; throw denied('EACCES'); },
    attempts: 3,
    sleep: async () => {},
  }), error => {
    assert.equal(error.code, 'EACCES');
    assert.equal(error.cause.code, 'EACCES');
    assert.match(error.message, /after 3 attempts/);
    assert.ok(error.message.includes(f.source));
    return true;
  });
  assert.equal(tries, 3);
});

test('does not retry a missing source', async t => {
  const f = await fixture(t);
  await assert.rejects(copyRuntimeFile(path.join(f.source, 'missing'), f.destination, {
    sleep: async () => { assert.fail('Unexpected retry'); },
  }), error => ['ENOENT', 'ENOTDIR'].includes(error.code));
});

test('rejects a successful copy that produced different bytes', async t => {
  const f = await fixture(t);
  await assert.rejects(copyRuntimeFile(f.source, f.destination, {
    copyFile: async (_source, destination) => writeFile(destination, 'corrupted'),
  }), /integrity check failed/);
});

test('uses the native Windows copy when both Node copy paths are denied', async t => {
  const f = await fixture(t);
  let nativeCalls = 0;
  await copyRuntimeFile(f.source, f.destination, {
    copyFile: async () => { throw denied(); },
    streamCopy: async () => { throw denied(); },
    nativeCopy: async (source, destination) => {
      nativeCalls++;
      await writeFile(destination, await readFile(source));
    },
  });
  assert.equal(nativeCalls, 1);
  assert.deepEqual(await readFile(f.destination), f.content);
});
