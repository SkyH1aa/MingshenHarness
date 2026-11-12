const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateWindowsIcon } = require('./windows-icon.cjs');

function iconWithFrame(frame, width = 16, height = 16) {
  const bytes = Buffer.alloc(22 + frame.length);
  bytes.writeUInt16LE(1, 2);
  bytes.writeUInt16LE(1, 4);
  bytes[6] = width === 256 ? 0 : width;
  bytes[7] = height === 256 ? 0 : height;
  bytes.writeUInt16LE(1, 10);
  bytes.writeUInt16LE(32, 12);
  bytes.writeUInt32LE(frame.length, 14);
  bytes.writeUInt32LE(22, 18);
  frame.copy(bytes, 22);
  return bytes;
}

function approvedPngFrame() {
  const bytes = fs.readFileSync(path.resolve(__dirname, '../apps/desktop/build/icon.ico'));
  const offset = bytes.readUInt32LE(18);
  return Buffer.from(bytes.subarray(offset, offset + bytes.readUInt32LE(14)));
}

function dibFrame(bits = 32) {
  const palette = bits <= 8 ? 2 ** bits * 4 : 0;
  const pixels = Math.ceil(16 * bits / 32) * 4 * 16;
  const mask = Math.ceil(16 / 32) * 4 * 16;
  const frame = Buffer.alloc(40 + palette + pixels + mask);
  frame.writeUInt32LE(40, 0);
  frame.writeInt32LE(16, 4);
  frame.writeInt32LE(32, 8);
  frame.writeUInt16LE(1, 12);
  frame.writeUInt16LE(bits, 14);
  frame.writeUInt32LE(pixels, 20);
  return frame;
}

function assertInvalid(bytes, name) {
  assert.throws(() => validateWindowsIcon(bytes), { message: /Invalid|Incomplete/ }, name);
}

test('accepts all generated PNG frames and leaves the icon bytes unchanged', () => {
  const bytes = fs.readFileSync(path.resolve(__dirname, '../apps/desktop/build/icon.ico'));
  const before = Buffer.from(bytes);
  assert.equal(validateWindowsIcon(bytes), 8);
  assert.equal(validateWindowsIcon(iconWithFrame(approvedPngFrame())), 1);
  assert.deepEqual(bytes, before);
});

test('accepts uncompressed Windows bitmap icon frames with supported pixel depths', () => {
  for (const bits of [1, 4, 8, 16, 24, 32])
    assert.equal(validateWindowsIcon(iconWithFrame(dibFrame(bits))), 1, `${bits}-bit DIB`);
});

test('rejects short headers, invalid directories and out-of-bounds frame ranges', () => {
  const valid = iconWithFrame(dibFrame());
  assertInvalid(Buffer.alloc(0), 'empty file');
  assertInvalid(Buffer.alloc(5), 'short header');
  for (const [name, change] of [
    ['reserved header', bytes => bytes.writeUInt16LE(1, 0)],
    ['cursor type', bytes => bytes.writeUInt16LE(2, 2)],
    ['no frames', bytes => bytes.writeUInt16LE(0, 4)],
    ['short frame', bytes => bytes.writeUInt32LE(3, 14)],
    ['frame inside directory', bytes => bytes.writeUInt32LE(6, 18)],
    ['frame outside file', bytes => bytes.writeUInt32LE(bytes.length + 1, 18)],
    ['frame exceeds file', bytes => bytes.writeUInt32LE(0xffffffff, 14)],
  ]) {
    const bytes = Buffer.from(valid);
    change(bytes);
    assertInvalid(bytes, name);
  }
  assertInvalid(valid.subarray(0, 21), 'truncated directory');
  assertInvalid(iconWithFrame(Buffer.alloc(4)), 'unknown image payload');
});

test('rejects malformed PNG dimensions, chunk bounds, checksums and incomplete image data', () => {
  const frame = approvedPngFrame();
  const chunks = [];
  for (let offset = 8; offset < frame.length;) {
    const length = frame.readUInt32BE(offset);
    chunks.push({ offset, end: offset + length + 12, type: frame.toString('ascii', offset + 4, offset + 8) });
    offset += length + 12;
  }
  const image = chunks.find(chunk => chunk.type === 'IDAT');
  assert.ok(image);
  const badChecksum = Buffer.from(frame);
  badChecksum[image.offset + 8] ^= 1;
  const oversizedChunk = Buffer.from(frame);
  oversizedChunk.writeUInt32BE(0xffffffff, image.offset);
  const withoutImage = Buffer.concat([
    frame.subarray(0, 8),
    ...chunks.filter(chunk => chunk.type !== 'IDAT').map(chunk => frame.subarray(chunk.offset, chunk.end)),
  ]);
  for (const [name, malformed] of [
    ['bad checksum', badChecksum],
    ['chunk exceeds payload', oversizedChunk],
    ['missing image data', withoutImage],
    ['missing IEND', frame.subarray(0, frame.length - 12)],
    ['truncated IEND', frame.subarray(0, frame.length - 1)],
    ['trailing bytes', Buffer.concat([frame, Buffer.alloc(1)])],
    ['truncated IHDR', frame.subarray(0, 32)],
  ]) assertInvalid(iconWithFrame(malformed), name);
  assertInvalid(iconWithFrame(frame, 15), 'width differs from icon directory');
  assertInvalid(iconWithFrame(frame, 16, 15), 'height differs from icon directory');
});

test('rejects invalid bitmap fields, truncated pixels, missing masks and incomplete palettes', () => {
  const valid = dibFrame(24);
  for (const [name, change] of [
    ['unknown header', frame => frame.writeUInt32LE(12, 0)],
    ['wrong width', frame => frame.writeInt32LE(15, 4)],
    ['wrong doubled height', frame => frame.writeInt32LE(16, 8)],
    ['wrong planes', frame => frame.writeUInt16LE(2, 12)],
    ['unsupported bit depth', frame => frame.writeUInt16LE(3, 14)],
    ['compressed bitmap', frame => frame.writeUInt32LE(1, 16)],
    ['oversized palette', frame => frame.writeUInt32LE(0xffffffff, 32)],
  ]) {
    const frame = Buffer.from(valid);
    change(frame);
    assertInvalid(iconWithFrame(frame), name);
  }
  assertInvalid(iconWithFrame(valid.subarray(0, 39)), 'short DIB header');
  assertInvalid(iconWithFrame(dibFrame(32).subarray(0, 40 + 16 * 16 * 4 - 1)), 'truncated 32-bit pixels');
  assertInvalid(iconWithFrame(valid.subarray(0, valid.length - 1)), 'incomplete 24-bit mask');
  assertInvalid(iconWithFrame(dibFrame(8).subarray(0, 40 + 256 * 4 - 1)), 'incomplete indexed palette');
});
