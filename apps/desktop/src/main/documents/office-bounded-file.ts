import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

export async function readBoundedOfficeFile(
  filePath: string,
  label: string,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes >= Number.MAX_SAFE_INTEGER)
    throw new Error("Invalid Office file read limit.");
  const beforePath = await lstat(filePath, { bigint: true });
  if (!beforePath.isFile()) throw new Error(`${label} is not a regular file.`);
  const handle = await open(
    filePath,
    process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.dev !== beforePath.dev ||
      before.ino !== beforePath.ino ||
      before.size !== beforePath.size ||
      before.mtimeNs !== beforePath.mtimeNs ||
      before.ctimeNs !== beforePath.ctimeNs
    )
      throw new Error(`${label} changed before it could be read.`);
    if (before.size > BigInt(maxBytes))
      throw new Error(`${label} exceeds the ${maxBytes}-byte read limit.`);

    // One extra byte detects growth without allocating or reading an enlarged file.
    const bytes = Buffer.allocUnsafe(Number(before.size) + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte read limit.`);
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(filePath, { bigint: true });
    if (
      total !== Number(before.size) ||
      !afterPath.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      afterPath.dev !== after.dev ||
      afterPath.ino !== after.ino ||
      afterPath.size !== after.size ||
      afterPath.mtimeNs !== after.mtimeNs ||
      afterPath.ctimeNs !== after.ctimeNs
    )
      throw new Error(`${label} changed while it was being read.`);
    return bytes.subarray(0, total);
  } finally {
    await handle.close();
  }
}
