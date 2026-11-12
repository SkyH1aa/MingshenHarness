import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { type ToolExecutionContext, ToolRegistry } from "../tools/tool-registry";
import { DockerService } from "../workspace/docker-service";
import type { NativeSandboxService } from "../workspace/native-sandbox-service";

const { scannedPdf } = createRequire(import.meta.url)(
  resolve("../../scripts/fixtures/document-fixtures.cjs"),
) as { scannedPdf: () => Buffer };
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("approved document tools", () => {
  it.each(["native", "docker"] as const)(
    "reads approved PDF/DOC bytes through %s and preserves OCR warnings",
    async (backend) => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-doc-tools-"));
      roots.push(root);
      const pdf = scannedPdf();
      const doc = await readFile(resolve("../../scripts/fixtures/legacy-word-test01.doc"));
      const fileOperation = vi.fn(async (_root, request: { operation: string; path: string }) => {
        expect(request.operation).toBe("read_binary");
        return (request.path.endsWith(".pdf") ? pdf : doc).toString("base64");
      });
      const docker = vi
        .spyOn(DockerService.prototype, "fileOperation")
        .mockImplementation(async (_image, path, request) => fileOperation(path, request));
      const registry = new ToolRegistry({ fileOperation } as unknown as NativeSandboxService);
      const requestApproval = vi.fn(async (request) => ({
        approvalId: request.id,
        decision: "deny" as "deny" | "allow_once",
      }));
      const context: ToolExecutionContext = {
        session: {
          id: "document-test",
          workspacePath: root,
          permissionMode: "request_approval",
          executionMode: backend === "docker" ? "docker" : "host",
        } as SessionView,
        runId: "run",
        toolCallId: "call",
        toolName: "read_document",
        permissions: new PermissionStore(),
        signal: new AbortController().signal,
        requestApproval,
        dockerImage: "fixture-image",
      };
      expect((await registry.execute("read_document", { path: "scan.pdf" }, context)).isError).toBe(
        true,
      );
      expect(fileOperation).not.toHaveBeenCalled();
      requestApproval.mockImplementation(async (request) => ({
        approvalId: request.id,
        decision: "allow_once",
      }));
      const result = await registry.execute("read_document", { path: "scan.pdf" }, context);
      expect(result.isError).toBe(false);
      expect(result.output).toContain("Offline PDF scan evidence 127");
      expect(result.output).toContain("Handwriting");
      expect(
        (await registry.execute("read_file", { path: "legacy.doc" }, context)).output,
      ).toContain("Unicode characters");
      expect(requestApproval).toHaveBeenCalledTimes(3);
      expect(fileOperation).toHaveBeenCalledTimes(2);
      expect(docker).toHaveBeenCalledTimes(backend === "docker" ? 2 : 0);
    },
    30000,
  );
});
