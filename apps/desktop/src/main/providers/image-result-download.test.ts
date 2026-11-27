import { afterEach, describe, expect, it, vi } from "vitest";
import { IMAGE_STUDIO_MAX_SINGLE_BYTES } from "../../shared/image-studio";
import {
  assertPublicRemoteImageHost,
  fetchRemoteImage,
  normalizeRemoteImageUrl,
  REMOTE_IMAGE_HOST_CHECK_TIMEOUT_MS,
  REMOTE_IMAGE_TIMEOUT_MS,
  type RemoteImageRequestRuntime,
  type RemoteImageResponse,
} from "./image-result-download";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, "base64");

function response(
  statusCode: number,
  headers: Record<string, string | string[] | undefined>,
  chunks: Uint8Array[] = [],
): RemoteImageResponse {
  return {
    statusCode,
    statusMessage: "Fixture",
    headers,
    body: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    destroy: vi.fn(),
  };
}

function runtimeWith(
  request: RemoteImageRequestRuntime["request"],
  resolve: RemoteImageRequestRuntime["resolve"] = async () => [
    { address: "93.184.216.34", family: 4 },
  ],
): RemoteImageRequestRuntime {
  return { resolve, request };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("remote image download", () => {
  it("checks every A and AAAA address before considering an external host public", async () => {
    const resolve = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    await expect(
      assertPublicRemoteImageHost("https://cdn.example.test/image.png", { resolve }),
    ).resolves.toBeUndefined();
    expect(resolve).toHaveBeenCalledWith("cdn.example.test");
  });

  it("rejects an external host when any A or AAAA address is private", async () => {
    const resolve = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      assertPublicRemoteImageHost("https://cdn.example.test/image.png", { resolve }),
    ).rejects.toThrow("DNS 结果包含私有");
  });

  it("bounds the external host check when DNS does not settle", async () => {
    vi.useFakeTimers();
    const resolve = vi.fn(() => new Promise<never>(() => undefined));
    const checking = assertPublicRemoteImageHost("https://cdn.example.test/image.png", {
      resolve,
    });
    const failure = expect(checking).rejects.toThrow("主机解析超过 5 秒限制");
    await vi.advanceTimersByTimeAsync(REMOTE_IMAGE_HOST_CHECK_TIMEOUT_MS);
    await failure;
  });

  it("downloads and validates a public HTTPS image while pinning the checked DNS address", async () => {
    const request = vi.fn(
      async (_url: URL, _address: string, _family: number, _signal: AbortSignal) =>
        response(200, { "content-type": "image/png" }, [
          TINY_PNG.subarray(0, 16),
          TINY_PNG.subarray(16),
        ]),
    );
    const result = await fetchRemoteImage(
      "https://cdn.example.test/generated.png",
      new AbortController().signal,
      runtimeWith(request),
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toBe("93.184.216.34");
    expect(request.mock.calls[0]?.[2]).toBe(4);
    expect(result).toMatchObject({
      mimeType: "image/png",
      byteLength: TINY_PNG.length,
      revisedPrompt: null,
      base64: TINY_PNG_BASE64,
    });
  });

  it("rejects any private address in an all-address DNS result before opening a socket", async () => {
    const request = vi.fn();
    const runtime = runtimeWith(request, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(
      fetchRemoteImage("https://cdn.example.test/image.png", new AbortController().signal, runtime),
    ).rejects.toThrow("DNS 结果包含私有");
    expect(request).not.toHaveBeenCalled();
  });

  it("rechecks every redirect and blocks a redirect to loopback", async () => {
    const request = vi.fn(async () => response(302, { location: "https://127.0.0.1/secret.png" }));
    await expect(
      fetchRemoteImage(
        "https://cdn.example.test/image.png",
        new AbortController().signal,
        runtimeWith(request),
      ),
    ).rejects.toThrow("本地或私有网络");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://cdn.example.test/image.png",
    "https://user:password@cdn.example.test/image.png",
    "file:///C:/secret.png",
    "https://localhost/image.png",
    "https://service.internal/image.png",
    "https://127.0.0.1/image.png",
    "https://10.0.0.8/image.png",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/image.png",
    "https://[fd00::1]/image.png",
  ])("rejects an unsafe URL %s", async (url) => {
    await expect(
      fetchRemoteImage(url, new AbortController().signal, runtimeWith(vi.fn())),
    ).rejects.toThrow();
  });

  it.each([
    "https://127.0.0.1/image.png",
    "https://10.0.0.8/image.png",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/image.png",
    "https://[fd00::1]/image.png",
  ])("synchronously normalizes away a literal private URL %s", (url) => {
    expect(() => normalizeRemoteImageUrl(url)).toThrow("本地或私有网络");
  });

  it.each([
    ["192.0.2.7", 4],
    ["198.51.100.8", 4],
    ["203.0.113.9", 4],
    ["100.64.0.1", 4],
    ["100::1", 6],
    ["3fff::1", 6],
    ["5f00::1", 6],
  ] as const)("rejects reserved address %s before opening a socket", async (address, family) => {
    const request = vi.fn();
    const runtime = runtimeWith(request, async () => [{ address, family }]);
    await expect(
      fetchRemoteImage("https://cdn.example.test/image.png", new AbortController().signal, runtime),
    ).rejects.toThrow("DNS 结果包含私有");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects declared and streamed bodies above the 25 MiB limit", async () => {
    const declared = response(200, {
      "content-type": "image/png",
      "content-length": String(IMAGE_STUDIO_MAX_SINGLE_BYTES + 1),
    });
    await expect(
      fetchRemoteImage(
        "https://cdn.example.test/too-large.png",
        new AbortController().signal,
        runtimeWith(async () => declared),
      ),
    ).rejects.toThrow("25 MiB");
    expect(declared.destroy).toHaveBeenCalled();

    const oversized = Buffer.alloc(IMAGE_STUDIO_MAX_SINGLE_BYTES + 1);
    const streamed = response(200, { "content-type": "image/png" }, [oversized]);
    await expect(
      fetchRemoteImage(
        "https://cdn.example.test/stream-too-large.png",
        new AbortController().signal,
        runtimeWith(async () => streamed),
      ),
    ).rejects.toThrow("25 MiB");
    expect(streamed.destroy).toHaveBeenCalled();
  });

  it("rejects non-image content types and HTML disguised as a missing image type", async () => {
    await expect(
      fetchRemoteImage(
        "https://cdn.example.test/page.html",
        new AbortController().signal,
        runtimeWith(async () =>
          response(200, { "content-type": "text/html" }, [Buffer.from("<html>")]),
        ),
      ),
    ).rejects.toThrow("内容类型不是受支持的图片");

    await expect(
      fetchRemoteImage(
        "https://cdn.example.test/fake.png",
        new AbortController().signal,
        runtimeWith(async () => response(200, {}, [Buffer.from("<html>not an image</html>")])),
      ),
    ).rejects.toThrow("图片内容损坏");
  });

  it("does not open a request after caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("user canceled"));
    const request = vi.fn();
    await expect(
      fetchRemoteImage(
        "https://cdn.example.test/image.png",
        controller.signal,
        runtimeWith(request),
      ),
    ).rejects.toThrow("user canceled");
    expect(request).not.toHaveBeenCalled();
  });

  it("aborts a stalled request at the 90 second hard timeout", async () => {
    vi.useFakeTimers();
    const request = vi.fn(
      async (_url: URL, _address: string, _family: number, signal: AbortSignal) =>
        new Promise<RemoteImageResponse>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), {
            once: true,
          });
        }),
    );
    const assertion = expect(
      fetchRemoteImage(
        "https://cdn.example.test/slow.png",
        new AbortController().signal,
        runtimeWith(request),
      ),
    ).rejects.toThrow("90 秒限制");
    await vi.advanceTimersByTimeAsync(REMOTE_IMAGE_TIMEOUT_MS);
    await assertion;
  });

  it("times out a DNS lookup that never settles before opening a socket", async () => {
    vi.useFakeTimers();
    const request = vi.fn();
    const resolver = vi.fn(() => new Promise<never>(() => undefined));
    const assertion = expect(
      fetchRemoteImage(
        "https://cdn.example.test/slow-dns.png",
        new AbortController().signal,
        runtimeWith(request, resolver),
      ),
    ).rejects.toThrow("90 秒限制");

    await vi.advanceTimersByTimeAsync(REMOTE_IMAGE_TIMEOUT_MS);
    await assertion;
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("cancels a pending DNS lookup and ignores its later result", async () => {
    const controller = new AbortController();
    const request = vi.fn();
    let completeLookup: ((addresses: { address: string; family: number }[]) => void) | undefined;
    const resolver = vi.fn(
      () =>
        new Promise<{ address: string; family: number }[]>((resolve) => {
          completeLookup = resolve;
        }),
    );
    const assertion = expect(
      fetchRemoteImage(
        "https://cdn.example.test/cancel-dns.png",
        controller.signal,
        runtimeWith(request, resolver),
      ),
    ).rejects.toThrow("user canceled DNS");
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    controller.abort(new Error("user canceled DNS"));
    await assertion;
    completeLookup?.([{ address: "93.184.216.34", family: 4 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects excessive redirect chains", async () => {
    const request = vi.fn(async (url: URL) =>
      response(302, { location: `${url.origin}/loop.png` }),
    );
    await expect(
      fetchRemoteImage(
        "https://cdn.example.test/start.png",
        new AbortController().signal,
        runtimeWith(request),
      ),
    ).rejects.toThrow("重定向");
    expect(request).toHaveBeenCalledTimes(6);
  });
});
