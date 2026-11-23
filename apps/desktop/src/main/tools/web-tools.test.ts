import { afterEach, describe, expect, it, vi } from "vitest";

const { publicFetchMock } = vi.hoisted(() => ({ publicFetchMock: vi.fn() }));

vi.mock("../security/network-policy", async (importOriginal) => {
  const original = await importOriginal<typeof import("../security/network-policy")>();
  return { ...original, publicFetch: publicFetchMock };
});

import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { ToolRegistry } from "./tool-registry";

afterEach(() => {
  vi.useRealTimers();
  publicFetchMock.mockReset();
});

function webContext(signal = new AbortController().signal) {
  return {
    session: {
      id: "web-session",
      agentMode: "chat",
      chatNetworkEnabled: true,
      workspacePath: null,
      permissionMode: "request_approval",
      executionMode: "host",
    } as SessionView,
    runId: "run",
    toolCallId: "call",
    toolName: "web_search",
    signal,
    permissions: new PermissionStore(),
    requestApproval: vi.fn(),
  };
}

function response(body: string, status = 200): Response {
  return new Response(body, { status });
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const rejectOnAbort = () => reject(signal.reason);
    if (signal.aborted) rejectOnAbort();
    else signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
}

describe("web tool request budgets", () => {
  it("falls back to Bing after a recoverable DuckDuckGo error using the same budget", async () => {
    publicFetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(
        response(
          "<rss><item><title>Result</title><link>https://example.com</link><description>Snippet</description></item></rss>",
        ),
      );

    const result = await new ToolRegistry().execute(
      "web_search",
      { query: "test query" },
      webContext(),
    );

    expect(result).toMatchObject({ isError: false });
    expect(result.output).toContain("https://example.com");
    expect(publicFetchMock).toHaveBeenCalledTimes(2);
    const firstSignal = publicFetchMock.mock.calls[0]?.[1]?.signal;
    const fallbackSignal = publicFetchMock.mock.calls[1]?.[1]?.signal;
    expect(fallbackSignal).toBe(firstSignal);
  });

  it("does not restart the 90-second budget when Bing fallback begins", async () => {
    vi.useFakeTimers();
    const firstRequest = deferred<Response>();
    publicFetchMock
      .mockImplementationOnce((_url: URL | string, init: RequestInit) => {
        init.signal?.addEventListener("abort", () => firstRequest.reject(init.signal?.reason), {
          once: true,
        });
        return firstRequest.promise;
      })
      .mockImplementationOnce((_url: URL | string, init: RequestInit) =>
        waitForAbort(init.signal as AbortSignal),
      );

    const pending = new ToolRegistry().execute("web_search", { query: "test query" }, webContext());
    await vi.advanceTimersByTimeAsync(70_000);
    firstRequest.reject(new Error("temporary DuckDuckGo failure"));
    await vi.advanceTimersByTimeAsync(19_999);
    expect(publicFetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({
      isError: true,
      output: "网页搜索超时（90 秒上限）。",
    });
    expect(publicFetchMock).toHaveBeenCalledTimes(2);
    expect(publicFetchMock.mock.calls[1]?.[1]?.signal).toBe(
      publicFetchMock.mock.calls[0]?.[1]?.signal,
    );
  });

  it("distinguishes user cancellation during Bing fallback and does not issue another request", async () => {
    const controller = new AbortController();
    publicFetchMock
      .mockRejectedValueOnce(new Error("DuckDuckGo is unavailable"))
      .mockImplementationOnce((_url: URL | string, init: RequestInit) =>
        waitForAbort(init.signal as AbortSignal),
      );

    const pending = new ToolRegistry().execute(
      "web_search",
      { query: "test query" },
      webContext(controller.signal),
    );
    await vi.waitFor(() => expect(publicFetchMock).toHaveBeenCalledTimes(2));
    controller.abort(new Error("run cancelled"));

    await expect(pending).resolves.toMatchObject({
      isError: true,
      output: "网页搜索已取消。",
    });
    expect(publicFetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the same 90-second timeout and distinguishes it from external cancellation in web_fetch", async () => {
    vi.useFakeTimers();
    publicFetchMock.mockImplementation((_url: URL | string, init: RequestInit) =>
      waitForAbort(init.signal as AbortSignal),
    );
    const context = { ...webContext(), toolName: "web_fetch" };
    const pending = new ToolRegistry().execute(
      "web_fetch",
      { url: "https://example.com" },
      context,
    );
    await vi.advanceTimersByTimeAsync(89_999);
    expect(publicFetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toMatchObject({
      isError: true,
      output: "网页读取超时（90 秒上限）。",
    });
  });

  it("bounds response body reads after the web server has returned headers", async () => {
    vi.useFakeTimers();
    const body = deferred<string>();
    publicFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => body.promise,
    });

    const pending = new ToolRegistry().execute(
      "web_fetch",
      { url: "https://example.com" },
      { ...webContext(), toolName: "web_fetch" },
    );
    await vi.waitFor(() => expect(publicFetchMock).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(90_000);

    await expect(pending).resolves.toMatchObject({
      isError: true,
      output: "网页读取超时（90 秒上限）。",
    });
  });

  it("reports web_fetch cancellation distinctly from its request timeout", async () => {
    const controller = new AbortController();
    publicFetchMock.mockImplementationOnce((_url: URL | string, init: RequestInit) =>
      waitForAbort(init.signal as AbortSignal),
    );

    const pending = new ToolRegistry().execute(
      "web_fetch",
      { url: "https://example.com" },
      { ...webContext(controller.signal), toolName: "web_fetch" },
    );
    await vi.waitFor(() => expect(publicFetchMock).toHaveBeenCalledOnce());
    controller.abort(new Error("run cancelled"));

    await expect(pending).resolves.toMatchObject({
      isError: true,
      output: "网页读取已取消。",
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
