import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { DOCKER_SECURITY_ARGS, DockerService } from "./docker-service";

const fake = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: fake.spawn,
  execFile: fake.execFile,
}));

describe("Docker file worker protocol", () => {
  it("does not resolve cancellation until the CLI exits and container removal is confirmed", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    fake.spawn.mockReturnValue(child);
    let confirmCleanup: () => void = () => {};
    fake.execFile.mockImplementation((_command, _args, _options, callback) => {
      confirmCleanup = () => callback(null, "removed", "");
      return new EventEmitter();
    });
    const controller = new AbortController();
    const pending = new DockerService().fileOperation(
      "image",
      "C:\\project",
      { operation: "write", path: "a.txt", content: "x" },
      controller.signal,
    );
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const rejected = expect(pending).rejects.toThrow("cancelled; container stopped");
    await vi.waitFor(() => expect(fake.spawn).toHaveBeenCalled());
    controller.abort();
    await new Promise((done) => setTimeout(done, 10));
    expect(settled).toBe(false);
    child.emit("close", 1);
    await vi.waitFor(() => expect(fake.execFile).toHaveBeenCalled());
    expect(settled).toBe(false);
    confirmCleanup();
    await rejected;
  });
  it("mounts only the workspace with a read-only root and streams JSON over stdin", async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    let input = "";
    child.stdin.on("data", (chunk) => {
      input += chunk.toString();
    });
    fake.spawn.mockImplementation(() => {
      setImmediate(() => {
        child.stdout.write(JSON.stringify({ ok: true, value: "inside container" }));
        child.emit("close", 0);
      });
      return child;
    });
    const result = await new DockerService().fileOperation(
      "image",
      "C:\\project",
      { operation: "read", path: "src/a.ts" },
      new AbortController().signal,
    );
    expect(result).toBe("inside container");
    expect(JSON.parse(input)).toEqual({ operation: "read", path: "src/a.ts" });
    const args = fake.spawn.mock.calls[0]?.[1] as string[];
    for (const option of DOCKER_SECURITY_ARGS) expect(args).toContain(option);
    expect(args).toContain("--network=none");
    expect(args).toContain("type=bind,source=C:\\project,target=/workspace");
    expect(args.join(" ")).not.toContain("docker.sock");
    const script = Buffer.from(args.at(-1) ?? "", "base64").toString("utf16le");
    expect(script).toContain("Symbolic links are not allowed");
    expect(script).toContain("Path outside workspace");
    expect(script).toContain("'read_binary'");
    expect(script).toContain("26214400");
    expect(script).toContain("'write_binary'");
    expect(script).toContain("'hash'");
    expect(script).toContain("File]::Replace");
  });
  it("rejects malformed binary writes before starting a container", async () => {
    fake.spawn.mockClear();
    await expect(
      new DockerService().fileOperation(
        "image",
        "C:\\project",
        {
          operation: "write_binary",
          path: "report.pdf",
          content: "not-base64",
          expectedHash: "missing",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("canonical base64");
    expect(fake.spawn).not.toHaveBeenCalled();
  });
  it("normalizes binary write hashes and streams the payload without command-line arguments", async () => {
    fake.spawn.mockClear();
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    let input = "";
    child.stdin.on("data", (chunk) => {
      input += chunk.toString();
    });
    fake.spawn.mockImplementation(() => {
      setImmediate(() => {
        child.stdout.write(JSON.stringify({ ok: true, value: "ok" }));
        child.emit("close", 0);
      });
      return child;
    });
    await expect(
      new DockerService().fileOperation(
        "image",
        "C:\\project",
        {
          operation: "write_binary",
          path: "report.pdf",
          content: "AQI=",
          expectedHash: "A".repeat(64),
        },
        new AbortController().signal,
      ),
    ).resolves.toBe("ok");
    expect(JSON.parse(input)).toEqual({
      operation: "write_binary",
      path: "report.pdf",
      content: "AQI=",
      expectedHash: "a".repeat(64),
    });
    const args = fake.spawn.mock.calls[0]?.[1] as string[];
    expect(args.join(" ")).not.toContain("AQI=");
    expect(args.join(" ")).not.toContain("report.pdf");
  });
  it("propagates worker failures instead of reporting a successful file operation", async () => {
    fake.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      setImmediate(() => {
        child.stdout.write(JSON.stringify({ ok: false, error: "permission denied" }));
        child.emit("close", 1);
      });
      return child;
    });
    await expect(
      new DockerService().fileOperation(
        "image",
        "C:\\project",
        { operation: "read", path: "src/a.ts" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("permission denied");
  });
  it("preserves daemon connection errors when Docker produces no JSON", async () => {
    fake.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      setImmediate(() => {
        child.stderr.write("Cannot connect to the Docker daemon");
        child.emit("close", 125);
      });
      return child;
    });
    const result = new DockerService().fileOperation(
      "image",
      "C:\\project",
      { operation: "read_binary", path: "scan.pdf" },
      new AbortController().signal,
    );
    await expect(result).rejects.toThrow("Cannot connect to the Docker daemon");
    await expect(result).rejects.not.toThrow("Unexpected end of JSON");
  });
  it("rejects successful JSON from a process that exits unsuccessfully", async () => {
    fake.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      setImmediate(() => {
        child.stdout.write(JSON.stringify({ ok: true, value: "unconfirmed" }));
        child.emit("close", 1);
      });
      return child;
    });
    await expect(
      new DockerService().fileOperation(
        "image",
        "C:\\project",
        { operation: "read_binary", path: "scan.pdf" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("result not accepted");
  });
});
