const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { copyFile } = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');

const retryable = new Set(['EPERM', 'EACCES', 'EBUSY']);

async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function streamCopy(source, destination) {
  await pipeline(createReadStream(source), createWriteStream(destination, { flags: 'w' }));
}

async function copyRuntimeFile(source, destination, options = {}) {
  const fastCopy = options.copyFile ?? copyFile;
  const bufferedCopy = options.streamCopy ?? streamCopy;
  const sleep = options.sleep ?? delay;
  const attempts = options.attempts ?? 6;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      try {
        await fastCopy(source, destination);
      } catch (error) {
        if (!retryable.has(error.code)) throw error;
        options.onFallback?.(error.code);
        // Windows fast-copy can fail while ordinary file I/O remains available.
        try {
          await bufferedCopy(source, destination);
        } catch (streamError) {
          if (!retryable.has(streamError.code) || !options.nativeCopy) throw streamError;
          try {
            await options.nativeCopy(source, destination);
          } catch (nativeError) {
            streamError.nativeError = nativeError.message;
            throw streamError;
          }
        }
      }
      const [original, copied] = await Promise.all([hashFile(source), hashFile(destination)]);
      if (original !== copied) throw new Error(`Runtime copy integrity check failed: ${destination}`);
      return;
    } catch (error) {
      if (!retryable.has(error.code)) throw error;
      lastError = error;
      if (attempt + 1 < attempts) await sleep(Math.min(200 * 2 ** attempt, 2000));
    }
  }
  const error = new Error(
    `Unable to copy Electron runtime after ${attempts} attempts (${lastError.code}).\nSource: ${source}\nDestination: ${destination}\n${lastError.message}${lastError.nativeError ? `\nWindows copy: ${lastError.nativeError}` : ''}`,
    { cause: lastError },
  );
  error.code = lastError.code;
  throw error;
}

module.exports = { copyRuntimeFile };
