import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { executeOfficeDocument, type OfficeDocumentResult } from "../documents/office-document";
import { PermissionStore } from "../permissions/permission-store";
import { stopGuardedWorkspaceIo } from "../workspace/guarded-workspace-io";
import { type ToolExecutionContext, ToolRegistry } from "./tool-registry";

vi.mock("../documents/office-document", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../documents/office-document")>()),
  executeOfficeDocument: vi.fn(),
}));

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mingshen-office-gateway-"));
  roots.push(root);
  const beforeFileWrite = vi.fn(async (_path: string, _hash: string) => {});
  const observeFile = vi.fn();
  const context: ToolExecutionContext = {
    session: {
      id: "office-session",
      agentMode: "work",
      workspacePath: root,
      permissionMode: "full_access",
      executionMode: "host",
    } as SessionView,
    runId: "office-run",
    toolCallId: "office-call",
    toolName: "office_document",
    signal: new AbortController().signal,
    permissions: new PermissionStore(),
    beforeFileWrite,
    observeFile,
    requestApproval: async () => {
      throw new Error("Unexpected approval in full access fixture.");
    },
  };
  return { root, context, beforeFileWrite, observeFile, registry: new ToolRegistry() };
}

beforeEach(() => {
  vi.mocked(executeOfficeDocument).mockReset();
});

afterEach(async () => {
  await stopGuardedWorkspaceIo();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("Office gateway verification and host commits", () => {
  it.each(["unavailable", "partial", "failed"] as const)(
    "preserves %s verification as an incomplete tool result",
    async (status) => {
      const f = await fixture();
      await writeFile(join(f.root, "source.xlsx"), "office-source");
      const verification: NonNullable<OfficeDocumentResult["verification"]> = {
        status,
        render: status === "partial" ? "verified" : status,
        recalculation: status,
      };
      vi.mocked(executeOfficeDocument).mockResolvedValueOnce({
        output: "Only the recorded verification checks completed.",
        warnings: [],
        verification,
      });
      const result = await f.registry.execute(
        "office_document",
        { operation: "verify", path: "source.xlsx", render: true, recalculate: true },
        f.context,
      );
      expect(result.isError).toBe(true);
      expect(result.officeVerification).toEqual(verification);
      expect(f.beforeFileWrite).not.toHaveBeenCalled();
      expect(await readdir(f.root)).toEqual(["source.xlsx"]);
    },
    30_000,
  );

  it("reports a completed verification separately from its textual output", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "source.xlsx"), "office-source");
    vi.mocked(executeOfficeDocument).mockResolvedValueOnce({
      output: "Office checks completed; visual review is still a separate action.",
      warnings: [],
      verification: { status: "verified", render: "verified", recalculation: "verified" },
    });
    const result = await f.registry.execute(
      "office_document",
      { operation: "verify", path: "source.xlsx", render: true, recalculate: true },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    expect(result.officeVerification?.status).toBe("verified");
  }, 30_000);

  it("overwrites a relative host output using its workspace hash", async () => {
    const f = await fixture();
    const target = join(f.root, "existing.xlsx");
    const original = Buffer.from("original workbook");
    const updated = Buffer.from("updated workbook");
    await writeFile(target, original);
    vi.mocked(executeOfficeDocument).mockResolvedValueOnce({
      output: "Created workbook.",
      warnings: [],
      bytes: updated,
    });
    const result = await f.registry.execute(
      "office_document",
      {
        operation: "create_spreadsheet",
        path: "existing.xlsx",
        overwrite: true,
        workbook: { sheets: [{ name: "Data", cells: [] }] },
      },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    expect(await readFile(target)).toEqual(updated);
    expect(f.beforeFileWrite).toHaveBeenCalledExactlyOnceWith(
      target,
      createHash("sha256").update(original).digest("hex"),
    );
    expect(result.fileChange).toMatchObject({ path: target, changeType: "modified" });
    expect(await readdir(f.root)).toEqual(["existing.xlsx"]);
  }, 30_000);

  it("preserves a host output changed after preparation and emits no committed receipt", async () => {
    const f = await fixture();
    const target = join(f.root, "existing.xlsx");
    const external = Buffer.from("updated by another editor");
    await writeFile(target, "original workbook");
    f.beforeFileWrite.mockImplementationOnce(async () => {
      await writeFile(target, external);
    });
    vi.mocked(executeOfficeDocument).mockResolvedValueOnce({
      output: "Created workbook.",
      warnings: [],
      bytes: Buffer.from("agent-generated workbook"),
    });
    const result = await f.registry.execute(
      "office_document",
      {
        operation: "create_spreadsheet",
        path: "existing.xlsx",
        overwrite: true,
        workbook: { sheets: [{ name: "Data", cells: [] }] },
      },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(await readFile(target)).toEqual(external);
    expect(result.fileChange).toBeUndefined();
    expect(f.observeFile).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual(["existing.xlsx"]);
  }, 30_000);
});
