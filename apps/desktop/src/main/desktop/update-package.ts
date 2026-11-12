import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";
import { type Entry, open as openZip, type ZipFile } from "yauzl";
import { assertPublicUrl } from "../security/network-policy";

export const MAX_UPDATE_BYTES = 2 * 1024 ** 3;

export async function fetchUpdateArchive(
  value: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  validate: (url: string | URL) => Promise<URL> = assertPublicUrl,
): Promise<Response> {
  let url = new URL(value);
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Update packages require public HTTPS URLs without credentials.");
    await validate(url);
    // The supplied Electron fetch uses an isolated session without browser cookies.
    const response = await fetcher(url.href, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal,
      headers: { Accept: "application/zip, application/octet-stream" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Update download: HTTP ${response.status} ${response.statusText}`);
      }
      if (!response.body) throw new Error("Empty update package response.");
      return response;
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirect === 5) throw new Error("Invalid or excessive update redirects.");
    url = new URL(location, url);
  }
  throw new Error("Excessive update redirects.");
}

export async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

function validateEntry(entry: Entry, names: Set<string>): void {
  const name = entry.fileName;
  if (
    !name ||
    name.length > 240 ||
    /[\\:]/.test(name) ||
    [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    name.startsWith("/") ||
    name
      .split("/")
      .some(
        (part, i, parts) =>
          part === "." ||
          part === ".." ||
          (!part && i < parts.length - 1) ||
          /[ .]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error(`Unsafe path in update ZIP: ${name.slice(0, 120)}`);
  const key = name.replace(/\/$/, "").normalize("NFC").toLowerCase();
  if (names.has(key)) throw new Error("Duplicate path in update ZIP.");
  names.add(key);
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
  if (mode && mode !== 0x8000 && mode !== 0x4000)
    throw new Error("Links and special files are not allowed in update ZIPs.");
  if (entry.generalPurposeBitFlag & 1) throw new Error("Encrypted update ZIPs are not supported.");
  if (
    entry.uncompressedSize > MAX_UPDATE_BYTES ||
    entry.uncompressedSize > Math.max(1024 ** 2, entry.compressedSize * 200)
  )
    throw new Error("Update ZIP exceeds extraction limits.");
}

export async function extractUpdateInstaller(
  archive: string,
  destination: string,
  version: string,
  signal: AbortSignal,
): Promise<{ path: string; sha256: string }> {
  const zip = await new Promise<ZipFile>((done, reject) => {
    openZip(
      archive,
      { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true },
      (error, value) => (error || !value ? reject(error ?? new Error("Invalid ZIP")) : done(value)),
    );
  });
  let selected: Entry | null = null;
  let total = 0;
  const names = new Set<string>();
  try {
    await new Promise<void>((done, reject) => {
      const fail = (cause: unknown) => {
        cleanup();
        reject(cause);
      };
      const abort = () => fail(signal.reason ?? new Error("Update canceled."));
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        zip.removeListener("error", fail);
      };
      signal.addEventListener("abort", abort, { once: true });
      zip.on("error", fail);
      zip.on("entry", (entry: Entry) => {
        try {
          signal.throwIfAborted();
          validateEntry(entry, names);
          total += entry.uncompressedSize;
          if (names.size > 64 || total > MAX_UPDATE_BYTES)
            throw new Error("Update ZIP exceeds extraction limits.");
          if (entry.fileName !== `MingshenHarness-${version}-x64.exe` || selected)
            throw new Error(
              "Update ZIP must contain only the version-matched x64 Mingshen installer at its root.",
            );
          selected = entry;
          zip.readEntry();
        } catch (cause) {
          fail(cause);
        }
      });
      zip.once("end", () => {
        cleanup();
        done();
      });
      if (signal.aborted) abort();
      else zip.readEntry();
    });
    if (!selected) throw new Error("No installer found in update ZIP.");
    signal.throwIfAborted();
    const input = await new Promise<import("node:stream").Readable>((done, reject) =>
      zip.openReadStream(selected as Entry, (error, stream) =>
        error || !stream ? reject(error ?? new Error("Unable to read installer")) : done(stream),
      ),
    );
    await mkdir(dirname(destination), { recursive: true });
    let written = 0;
    let crc = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length;
        crc = crc32(chunk, crc);
        callback(
          written > MAX_UPDATE_BYTES ? new Error("Extracted installer exceeds size limit.") : null,
          chunk,
        );
      },
    });
    await pipeline(input, sizeGuard, createWriteStream(destination, { flags: "wx", mode: 0o600 }), {
      signal,
    });
    const info = await stat(destination);
    if (crc !== (selected as Entry).crc32) throw new Error("Update installer ZIP CRC-32 mismatch.");
    if (!info.size || info.size !== (selected as Entry).uncompressedSize)
      throw new Error("Installer size mismatch.");
    const handle = await open(destination, "r");
    try {
      const header = Buffer.alloc(64);
      await handle.read(header, 0, 64, 0);
      const offset = header.readUInt32LE(0x3c);
      if (header.toString("ascii", 0, 2) !== "MZ" || offset < 64 || offset > info.size - 6)
        throw new Error("Invalid Windows installer executable.");
      const signature = Buffer.alloc(6);
      await handle.read(signature, 0, 6, offset);
      // NSIS uses an x86 bootstrapper even when the application payload is x64.
      if (
        signature.readUInt32LE(0) !== 0x4550 ||
        ![0x8664, 0x14c].includes(signature.readUInt16LE(4))
      )
        throw new Error("Update installer must be a Windows x86/x64 executable.");
    } finally {
      await handle.close();
    }
    return { path: destination, sha256: await sha256File(destination, signal) };
  } finally {
    zip.close();
  }
}
