const { crc32 } = require('node:zlib');

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function validateIconFrame(frame, width, height) {
  if (frame.subarray(0, 8).equals(pngSignature)) {
    if (frame.length < 33 || frame.readUInt32BE(8) !== 13 ||
        frame.toString('ascii', 12, 16) !== 'IHDR' ||
        frame.readUInt32BE(16) !== width || frame.readUInt32BE(20) !== height)
      throw new Error('Invalid Windows icon PNG dimensions.');
    let offset = 8;
    let hasImage = false;
    while (offset + 12 <= frame.length) {
      const length = frame.readUInt32BE(offset);
      if (length > frame.length - offset - 12) break;
      const end = offset + 12 + length;
      if (crc32(frame.subarray(offset + 4, end - 4)) !== frame.readUInt32BE(end - 4))
        throw new Error('Invalid Windows icon PNG checksum.');
      const type = frame.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT' && length > 0) hasImage = true;
      if (type === 'IEND') {
        if (length === 0 && hasImage && end === frame.length) return;
        break;
      }
      offset = end;
    }
    throw new Error('Incomplete Windows icon PNG data.');
  }
  // resedit otherwise accepts unknown payloads as raw images without validation.
  if (frame.length >= 40 && frame.readUInt32LE(0) === 40) {
    const bits = frame.readUInt16LE(14);
    const colors = frame.readUInt32LE(32) || (bits <= 8 ? 2 ** bits : 0);
    const pixels = Math.ceil(width * bits / 32) * 4 * height;
    const mask = bits === 32 ? 0 : Math.ceil(width / 32) * 4 * height;
    if (frame.readInt32LE(4) === width && frame.readInt32LE(8) === height * 2 &&
        frame.readUInt16LE(12) === 1 && [1, 4, 8, 16, 24, 32].includes(bits) &&
        frame.readUInt32LE(16) === 0 && 40 + colors * 4 + pixels + mask <= frame.length)
      return;
  }
  throw new Error('Invalid Windows icon image data.');
}

function validateWindowsIcon(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1)
    throw new Error('Invalid Windows icon header.');
  const count = bytes.readUInt16LE(4);
  const directoryEnd = 6 + 16 * count;
  if (!count || directoryEnd > bytes.length)
    throw new Error('Invalid Windows icon directory.');
  for (let index = 0; index < count; index++) {
    const entry = 6 + 16 * index;
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (length < 4 || offset < directoryEnd || offset > bytes.length ||
        length > bytes.length - offset)
      throw new Error(`Invalid Windows icon frame ${index + 1}.`);
    validateIconFrame(bytes.subarray(offset, offset + length), bytes[entry] || 256, bytes[entry + 1] || 256);
  }
  return count;
}

module.exports = { validateWindowsIcon };
