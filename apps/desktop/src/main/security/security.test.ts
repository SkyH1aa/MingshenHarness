import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomCommandService } from "../agents/custom-command-service";
import { type StreamTurnInput, streamModelTurn } from "../providers/model-stream";
import { safeFilePath } from "../workspace/safe-file-path";
import { assertPublicUrl, isPrivateAddress } from "./network-policy";
import { redactSecrets } from "./redact";

afterEach(() => vi.unstubAllGlobals());
describe("Security regression probes", () => {
  it("blocks loopback, private and metadata addresses including mapped IPv6", async () => {
    for (const address of [
      "127.0.0.1",
      "169.254.169.254",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "0.0.0.0",
    ])
      expect(isPrivateAddress(address)).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    for (const url of [
      "http://127.0.0.1/secret",
      "http://2130706433",
      "http://localhost",
      "file:///C:/Windows",
      "http://169.254.169.254/latest/meta-data",
    ])
      await expect(assertPublicUrl(url)).rejects.toThrow();
  });
  it("rejects traversal and Git metadata without modifying the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-security-path-"));
    const workspace = join(root, "work");
    await mkdir(workspace);
    const outside = await mkdtemp(join(tmpdir(), "mingshen-private-"));
    try {
      await writeFile(join(root, "secret"), "keep");
      await writeFile(join(outside, "secret"), "keep");
      for (const path of ["../secret", ".git/config"])
        await expect(safeFilePath(workspace, path)).rejects.toThrow();
      expect(await readFile(join(root, "secret"), "utf8")).toBe("keep");
      await mkdir(join(workspace, ".mingshen", "commands"), { recursive: true });
      await writeFile(join(workspace, ".mingshen", "commands", "x.md"), "@../secret");
      expect(
        (await new CustomCommandService().prepare(workspace, "/x", false))?.prompt,
      ).not.toContain("keep");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
  it.each([403, 502, 503])(
    "preserves HTTP %s response detail while redacting credentials",
    async (status) => {
      const key = "sk-test-private-123456789";
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error: { code: "upstream_error", message: "upstream rejected", api_key: key },
              }),
              { status, statusText: "Upstream error", headers: { "x-request-id": "req-test" } },
            ),
        ),
      );
      const input = {
        provider: {
          name: "Test",
          baseUrl: "https://example.com/v1",
          protocol: "openai_responses",
          authMode: "bearer",
        },
        model: { modelId: "test", maxOutputTokens: 64, toolCalls: true },
        apiKey: key,
        systemPrompt: "test",
        messages: [],
        reasoningLevel: null,
        tools: [],
        signal: new AbortController().signal,
      } as unknown as StreamTurnInput;
      let error = "";
      try {
        for await (const _event of streamModelTurn(input)) {
        }
      } catch (cause) {
        error = String(cause);
      }
      expect(error).toContain(`HTTP ${status}`);
      expect(error).toContain("req-test");
      expect(error).toContain("upstream_error");
      expect(error).not.toContain(key);
      expect(redactSecrets(`Authorization: Bearer ${key}`)).not.toContain(key);
    },
  );
  it("keeps streaming provider error codes and diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            'data: {"type":"error","error":{"code":"server_overloaded","type":"upstream_error","message":"retry later"}}\n\n',
            { headers: { "content-type": "text/event-stream" } },
          ),
      ),
    );
    const input = {
      provider: {
        name: "Fixture",
        baseUrl: "https://example.com/v1",
        protocol: "openai_responses",
        authMode: "bearer",
      },
      model: { modelId: "test", maxOutputTokens: 64, toolCalls: true },
      apiKey: "fixture-secret",
      systemPrompt: "test",
      messages: [],
      reasoningLevel: null,
      tools: [],
      signal: new AbortController().signal,
    } as unknown as StreamTurnInput;
    let error = "";
    try {
      for await (const _event of streamModelTurn(input)) {
      }
    } catch (cause) {
      error = String(cause);
    }
    expect(error).toContain("server_overloaded");
    expect(error).toContain("retry later");
  });
});
