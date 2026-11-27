import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { IMAGE_STUDIO_MAX_SINGLE_BYTES } from "../../shared/image-studio";
import { isPrivateAddress } from "../security/network-policy";
import type { ImageGenerationPayload } from "./image-generation";
import { detectImage } from "./image-validation";

const MAX_REMOTE_IMAGE_URL_LENGTH = 8_192;
const MAX_REMOTE_IMAGE_REDIRECTS = 5;
export const REMOTE_IMAGE_TIMEOUT_MS = 90_000;
export const REMOTE_IMAGE_HOST_CHECK_TIMEOUT_MS = 5_000;
const ALLOWED_REMOTE_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/octet-stream",
]);

export interface ImageGenerationRemotePayload {
  url: string;
  revisedPrompt: string | null;
}

interface ResolvedAddress {
  address: string;
  family: number;
}

export interface RemoteImageResponse {
  statusCode: number;
  statusMessage: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy: (error?: Error) => void;
}

export interface RemoteImageRequestRuntime {
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  request: (
    url: URL,
    pinnedAddress: string,
    family: number,
    signal: AbortSignal,
  ) => Promise<RemoteImageResponse>;
}

export interface RemoteImageHostCheckOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  resolve?: RemoteImageRequestRuntime["resolve"];
}

function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0);
}

function isIpv4InCidr(address: string, network: string, prefix: number): boolean {
  const value = ipv4Number(address);
  const base = ipv4Number(network);
  if (value === null || base === null) return false;
  const blockSize = 2 ** (32 - prefix);
  return Math.floor(value / blockSize) === Math.floor(base / blockSize);
}

function ipv6Number(address: string): bigint | null {
  if (isIP(address) !== 6 || address.includes("%")) return null;
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const ipv4 = ipv4Number(normalized.slice(separator + 1));
    if (separator < 0 || ipv4 === null) return null;
    normalized = `${normalized.slice(0, separator)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fillCount = 8 - left.length - right.length;
  if ((halves.length === 1 && fillCount !== 0) || (halves.length === 2 && fillCount < 1))
    return null;
  const groups = [...left, ...Array.from({ length: fillCount }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function isIpv6InCidr(address: string, network: string, prefix: number): boolean {
  const value = ipv6Number(address);
  const base = ipv6Number(network);
  if (value === null || base === null) return false;
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
}

function isUnsafeRemoteImageAddress(address: string): boolean {
  if (isPrivateAddress(address)) return true;
  if (isIP(address) === 4) {
    return [
      ["192.0.2.0", 24],
      ["192.88.99.0", 24],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
    ].some(([network, prefix]) => isIpv4InCidr(address, String(network), Number(prefix)));
  }
  if (isIP(address) !== 6 || !isIpv6InCidr(address, "2000::", 3)) return true;
  return [
    ["::", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
  ].some(([network, prefix]) => isIpv6InCidr(address, String(network), Number(prefix)));
}

function normalizeRemoteContentType(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  return first.split(";")[0]?.trim().toLowerCase() || null;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function contentLength(value: string | string[] | undefined): number | null {
  const raw = headerValue(value)?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validateRemoteImageUrl(value: string): URL {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_REMOTE_IMAGE_URL_LENGTH)
    throw new Error("供应商返回的图片 URL 为空或过长。");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("供应商返回的图片 URL 格式无效。");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("图片下载只接受不含凭据的公开 HTTPS URL。");
  const hostname = normalizedHostname(url);
  if (
    !hostname ||
    hostname.toLowerCase() === "localhost" ||
    /\.(?:localhost|local|internal)$/i.test(hostname)
  )
    throw new Error("图片 URL 指向本地或私有网络目标，已拒绝。");
  if (isIP(hostname) && isUnsafeRemoteImageAddress(hostname))
    throw new Error("图片 URL 指向本地或私有网络目标，已拒绝。");
  return url;
}

export function normalizeRemoteImageUrl(value: string): string {
  return validateRemoteImageUrl(value).href;
}

async function resolvePublicAddresses(
  hostname: string,
  resolver: RemoteImageRequestRuntime["resolve"],
  signal: AbortSignal,
): Promise<ResolvedAddress[]> {
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await new Promise<ResolvedAddress[]>((resolveAddresses, reject) => {
        const onAbort = () => {
          signal.removeEventListener("abort", onAbort);
          reject(signal.reason ?? new Error("图片下载已取消。"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        // System DNS lookup cannot be cancelled; abandon late results without opening a socket.
        void Promise.resolve()
          .then(() => {
            signal.throwIfAborted();
            return resolver(hostname);
          })
          .then(
            (results) => {
              signal.removeEventListener("abort", onAbort);
              resolveAddresses(results);
            },
            (error: unknown) => {
              signal.removeEventListener("abort", onAbort);
              reject(error);
            },
          );
      });
  if (
    !addresses.length ||
    addresses.some(
      (entry) =>
        ![4, 6].includes(entry.family) ||
        isIP(entry.address) !== entry.family ||
        isUnsafeRemoteImageAddress(entry.address),
    )
  )
    throw new Error("图片 URL 的 DNS 结果包含私有、回环或无效地址，已拒绝下载。");
  return addresses;
}

export async function assertPublicRemoteImageHost(
  value: string,
  options: RemoteImageHostCheckOptions = {},
): Promise<void> {
  const url = validateRemoteImageUrl(value);
  const controller = new AbortController();
  const abortFromCaller = () =>
    controller.abort(options.signal?.reason ?? new Error("图片 URL 主机校验已取消。"));
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const requestedTimeout = options.timeoutMs;
  const timeoutMs =
    typeof requestedTimeout === "number" &&
    Number.isFinite(requestedTimeout) &&
    requestedTimeout > 0
      ? Math.min(60_000, Math.max(1, requestedTimeout))
      : REMOTE_IMAGE_HOST_CHECK_TIMEOUT_MS;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("图片 URL 主机校验超时。"));
  }, timeoutMs);
  timeout.unref?.();
  try {
    await resolvePublicAddresses(
      normalizedHostname(url),
      options.resolve ?? ((hostname) => lookup(hostname, { all: true, verbatim: true })),
      controller.signal,
    );
    controller.signal.throwIfAborted();
  } catch (error) {
    if (timedOut) throw new Error(`图片 URL 主机解析超过 ${Math.ceil(timeoutMs / 1_000)} 秒限制。`);
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function createLinkedAbort(signal: AbortSignal): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal.reason ?? new Error("图片下载已取消。"));
  if (signal.aborted) abortFromCaller();
  else signal.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`图片下载超过 ${REMOTE_IMAGE_TIMEOUT_MS / 1_000} 秒限制。`));
  }, REMOTE_IMAGE_TIMEOUT_MS);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abortFromCaller);
    },
  };
}

function nodeRemoteImageRuntime(
  resolver: RemoteImageRequestRuntime["resolve"],
): RemoteImageRequestRuntime {
  return {
    resolve: resolver,
    request: (url, pinnedAddress, family, signal) =>
      new Promise((resolveResponse, reject) => {
        const request = httpsRequest(
          url,
          {
            method: "GET",
            agent: false,
            signal,
            headers: {
              Accept: "image/png, image/jpeg, image/webp, image/gif, application/octet-stream",
              "Accept-Encoding": "identity",
            },
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [{ address: pinnedAddress, family }]);
              else callback(null, pinnedAddress, family);
            },
          },
          (response) => {
            resolveResponse({
              statusCode: response.statusCode ?? 0,
              statusMessage: response.statusMessage,
              headers: response.headers,
              body: response,
              destroy: (error) => response.destroy(error),
            });
          },
        );
        request.once("error", reject);
        request.end();
      }),
  };
}

async function readRemoteImageBody(
  response: RemoteImageResponse,
  signal: AbortSignal,
  timedOut: () => boolean,
): Promise<{ bytes: Buffer; declaredMimeType: string | null }> {
  const declaredLength = contentLength(response.headers["content-length"]);
  if (declaredLength !== null && declaredLength > IMAGE_STUDIO_MAX_SINGLE_BYTES) {
    response.destroy();
    throw new Error("供应商远程图片超过单图 25 MiB 限制。");
  }
  const contentType = normalizeRemoteContentType(response.headers["content-type"]);
  if (contentType && !ALLOWED_REMOTE_IMAGE_CONTENT_TYPES.has(contentType)) {
    response.destroy();
    throw new Error("图片 URL 返回的内容类型不是受支持的图片。");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      if (signal.aborted) throw signal.reason ?? new Error("图片下载已取消。");
      total += chunk.byteLength;
      if (total > IMAGE_STUDIO_MAX_SINGLE_BYTES) {
        response.destroy();
        throw new Error("供应商远程图片超过单图 25 MiB 限制。");
      }
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (timedOut()) {
      throw new Error(`图片下载超过 ${REMOTE_IMAGE_TIMEOUT_MS / 1_000} 秒限制。`);
    }
    if (signal.aborted) throw signal.reason ?? error;
    throw error;
  }
  if (!total) throw new Error("供应商返回的远程图片为空。");
  return {
    bytes: Buffer.concat(chunks, total),
    declaredMimeType:
      contentType && contentType !== "application/octet-stream"
        ? contentType === "image/jpg"
          ? "image/jpeg"
          : contentType
        : null,
  };
}

export async function fetchRemoteImage(
  value: string,
  signal: AbortSignal,
  runtime: RemoteImageRequestRuntime = nodeRemoteImageRuntime((hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
  ),
): Promise<ImageGenerationPayload> {
  const linked = createLinkedAbort(signal);
  try {
    let url = validateRemoteImageUrl(value);
    for (let redirect = 0; redirect <= MAX_REMOTE_IMAGE_REDIRECTS; redirect += 1) {
      linked.signal.throwIfAborted();
      const hostname = normalizedHostname(url);
      const addresses = await resolvePublicAddresses(hostname, runtime.resolve, linked.signal);
      linked.signal.throwIfAborted();
      const pinned = addresses[0];
      if (!pinned) throw new Error("图片 URL 没有可用的公网地址。");
      const response = await runtime.request(url, pinned.address, pinned.family, linked.signal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = headerValue(response.headers.location);
        response.destroy();
        if (!location || redirect === MAX_REMOTE_IMAGE_REDIRECTS)
          throw new Error("图片下载重定向无效或次数过多。");
        url = validateRemoteImageUrl(new URL(location, url).href);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.destroy();
        throw new Error(
          `图片下载失败：HTTP ${response.statusCode}${response.statusMessage ? ` ${response.statusMessage}` : ""}。`,
        );
      }
      const { bytes, declaredMimeType } = await readRemoteImageBody(
        response,
        linked.signal,
        linked.timedOut,
      );
      const image = await detectImage(bytes, declaredMimeType ?? undefined);
      return {
        base64: bytes.toString("base64"),
        mimeType: image.mimeType,
        byteLength: bytes.length,
        revisedPrompt: null,
        width: image.width,
        height: image.height,
        extension: image.extension,
      };
    }
    throw new Error("图片下载重定向次数过多。");
  } catch (error) {
    if (linked.timedOut())
      throw new Error(`图片下载超过 ${REMOTE_IMAGE_TIMEOUT_MS / 1_000} 秒限制。`);
    throw error;
  } finally {
    linked.dispose();
  }
}
