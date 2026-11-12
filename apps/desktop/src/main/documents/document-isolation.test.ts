import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { ToolRegistry } from "../tools/tool-registry";
import { NativeSandboxService } from "../workspace/native-sandbox-service";

const { scannedPdf } = createRequire(import.meta.url)(
  resolve("../../scripts/fixtures/document-fixtures.cjs"),
) as { scannedPdf: () => Buffer };

describe("Real isolated document reads", () => {
  it.runIf(process.env.MINGSHEN_DOCUMENT_E2E === "1")(
    "reads scan PDFs and legacy DOC through the selected approved backend",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-document-isolation-"));
      const { mkdir } = await import("node:fs/promises");
      const workspace = join(root, "workspace");
      await mkdir(workspace);
      try {
        await writeFile(join(workspace, "scan.pdf"), scannedPdf());
        await writeFile(
          join(workspace, "legacy.doc"),
          await readFile(resolve("../../scripts/fixtures/legacy-word-test01.doc")),
        );
        const backend = process.env.MINGSHEN_DOCUMENT_BACKEND === "docker" ? "docker" : "host";
        const registry = new ToolRegistry(
          new NativeSandboxService(
            resolve("resources/native/codex-sandbox.exe"),
            join(root, "profiles"),
          ),
        );
        const context = {
          session: {
            id: "doc-live",
            workspacePath: workspace,
            permissionMode: "request_approval",
            executionMode: backend,
          } as SessionView,
          runId: "run",
          toolCallId: "call",
          toolName: "read_document",
          signal: AbortSignal.timeout(120000),
          permissions: new PermissionStore(),
          dockerImage: "mcr.microsoft.com/powershell:lts-alpine",
          requestApproval: async () => ({ approvalId: "test", decision: "allow_once" as const }),
        };
        for (const [name, expected] of [
          ["scan.pdf", "Offline PDF scan evidence 127"],
          ["legacy.doc", "Unicode characters"],
        ]) {
          const result = await registry.execute("read_document", { path: name }, context);
          expect(result.isError, result.output).toBe(false);
          expect(result.output).toContain(expected);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    120000,
  );
});
