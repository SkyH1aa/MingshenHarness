import { afterEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../storage/repository";
import type { SecretStore } from "../storage/secret-store";
import { GitHubService } from "./github-service";

describe("GitHubService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("completes browser device authorization, encrypts token, and handles pending responses", async () => {
    const settings = new Map<string, unknown>();
    const secrets = new Map<string, string>();
    const repository = {
      getSetting: (key: string) => settings.get(key),
      setSetting: (key: string, value: unknown) => settings.set(key, value),
      removeSetting: (key: string) => settings.delete(key),
    } as unknown as Repository;
    const store = {
      store: (token: string) => {
        secrets.set("ref", token);
        return { secretRef: "ref" };
      },
      read: (key: string) => secrets.get(key),
      remove: (key: string) => secrets.delete(key),
    } as unknown as SecretStore;
    let poll = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/device/code"))
          return Response.json({
            device_code: "private-code",
            user_code: "ABCD-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          });
        if (url.endsWith("/access_token"))
          return Response.json(
            ++poll === 1 ? { error: "authorization_pending" } : { access_token: "private-token" },
          );
        return Response.json({ login: "ming", name: "Ming" });
      }),
    );
    vi.useFakeTimers();
    const service = new GitHubService(repository, store);
    const started = await service.startDeviceAuthorization("MingshenClient");
    expect(started.userCode).toBe("ABCD-1234");
    expect(service.getDeviceAuthorization()).toEqual(started);
    expect(JSON.stringify(started)).not.toContain("private-code");
    vi.setSystemTime(Date.now() + 5_001);
    expect((await service.pollDeviceAuthorization()).status).toBe("pending");
    vi.setSystemTime(Date.now() + 5_001);
    expect((await service.pollDeviceAuthorization()).connection?.login).toBe("ming");
    expect(service.tokenForMcp()).toBe("private-token");
    expect(service.getDeviceAuthorization()).toBeNull();
    expect(JSON.stringify(settings.get("github.connection"))).not.toContain("private-token");
    await service.disconnect();
    expect(service.tokenForMcp()).toBeNull();
    expect(secrets.size).toBe(0);
  });

  it("cancels a pending poll and keeps only the public code available for UI restoration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          device_code: "private-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          interval: 5,
          expires_in: 900,
        }),
      ),
    );
    const service = new GitHubService(
      { setSetting: vi.fn() } as unknown as Repository,
      {} as SecretStore,
    );
    const started = await service.startDeviceAuthorization("MingshenClient");
    expect(service.getDeviceAuthorization()).toEqual(started);
    expect(JSON.stringify(service.getDeviceAuthorization())).not.toContain("private-code");
    const poll = service.pollDeviceAuthorization();
    const rejected = expect(poll).rejects.toThrow();
    service.cancelDeviceAuthorization();
    await rejected;
    expect(service.getDeviceAuthorization()).toBeNull();
  });

  it("rejects unexpected authorization origins and provider failures", async () => {
    const service = new GitHubService(
      { setSetting: vi.fn() } as unknown as Repository,
      {} as SecretStore,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          device_code: "code",
          user_code: "code",
          verification_uri: "https://example.com/steal",
        }),
      ),
    );
    await expect(service.startDeviceAuthorization("MingshenClient")).rejects.toThrow("无效");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "incorrect_client_credentials" }, { status: 400 })),
    );
    await expect(service.startDeviceAuthorization("MingshenClient")).rejects.toThrow(
      "incorrect_client_credentials",
    );
  });

  it("does not restore a device flow when cancellation occurs during its initial request", async () => {
    let respond!: (response: Response) => void;
    const request = new Promise<Response>((done) => {
      respond = done;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => request),
    );
    const save = vi.fn();
    const service = new GitHubService(
      { setSetting: save } as unknown as Repository,
      {} as SecretStore,
    );
    const start = service.startDeviceAuthorization("MingshenClient");
    const rejected = expect(start).rejects.toThrow();
    service.cancelDeviceAuthorization();
    respond(
      Response.json({
        device_code: "private-code",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
      }),
    );
    await rejected;
    expect(service.getDeviceAuthorization()).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it.runIf(process.env.MINGSHEN_GITHUB_E2E === "1")(
    "searches public GitHub repositories",
    async () => {
      const service = new GitHubService(
        { getSetting: () => null } as unknown as Repository,
        {} as SecretStore,
      );
      const result = await service.searchRepositories("playwright browser automation", 5);
      expect(result.isError).toBe(false);
      expect(result.output).toContain("github.com/");
      expect(result.output).toContain("stars");

      const pullRequests = await service.execute("github_list_pull_requests", {
        repo: "openai/plugins",
        state: "open",
      });
      expect(pullRequests.isError).toBe(false);
      expect(pullRequests.output.length).toBeGreaterThan(0);
    },
    45_000,
  );
});
