import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../../shared/release";
import { isNewerVersion, parseRelease, UpdateService } from "./update-service";

const metadata = [
  {
    version: "8.8.8",
    download_page_url: "https://example.com/",
    notes: "Test release",
    published_at: "2026-11-03T00:00:00Z",
  },
];
afterEach(() => vi.useRealTimers());
describe("Release checks", () => {
  it("compares numeric components and rejects invalid versions and download schemes", () => {
    expect(isNewerVersion("1.10.0", "1.9.999")).toBe(true);
    expect(isNewerVersion("1.2.1", "1.2.1")).toBe(false);
    expect(() => isNewerVersion("1.1000.0", "1.2.1")).toThrow();
    expect(() =>
      parseRelease([{ ...metadata[0], download_page_url: "javascript:alert(1)" }]),
    ).toThrow();
    expect(() => parseRelease([...metadata, ...metadata])).toThrow("latest");
  });
  it("checks at startup and every 24 hours, deduplicates notices and keeps errors visible", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(metadata)));
    const events: Array<{ state: string; notify: boolean }> = [];
    const service = new UpdateService(
      (status, notify) => events.push({ state: status.state, notify }),
      fetcher,
    );
    service.start();
    await service.check();
    expect(service.status()).toMatchObject({
      state: "available",
      currentVersion: APP_VERSION,
      release: { version: "8.8.8", downloadUrl: "https://example.com/" },
    });
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.notify)).toHaveLength(1);
    fetcher.mockResolvedValueOnce(new Response("failed", { status: 503 }));
    expect((await service.check()).error).toContain("503");
    service.stop();
  });
  it("returns current without notifying when the installed version is latest", async () => {
    const emit = vi.fn();
    const service = new UpdateService(
      emit,
      vi.fn(async () => new Response(JSON.stringify([{ ...metadata[0], version: APP_VERSION }]))),
    );
    expect((await service.check()).state).toBe("current");
    expect(emit.mock.calls.every(([, notify]) => !notify)).toBe(true);
  });
});
