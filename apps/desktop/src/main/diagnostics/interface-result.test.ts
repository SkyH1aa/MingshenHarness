import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "../../shared/ipc";
import { inspectInterfaceResult, recordInterfaceResult } from "./interface-result";
import { recordRuntimeError, recordRuntimeWarning } from "./runtime-log";

vi.mock("./runtime-log", () => ({
  recordRuntimeError: vi.fn(),
  recordRuntimeWarning: vi.fn(),
}));

describe("structured interface diagnostics", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([IPC_CHANNELS.providerTest, IPC_CHANNELS.mcpTest, IPC_CHANNELS.diagnosticsRun])(
    "records documented failed test result for %s without result text",
    (operation) => {
      expect(
        recordInterfaceResult("ipc", operation, {
          ok: false,
          status: 503,
          output: "fixture private input",
          responseBody: "fixture private response",
        }),
      ).toBe(true);
      expect(recordRuntimeError).toHaveBeenCalledWith(
        "ipc.result",
        "Interface operation returned an unsuccessful result.",
        { operation, code: "INTERFACE_TEST_FAILED", status: 503 },
      );
      expect(JSON.stringify(vi.mocked(recordRuntimeError).mock.calls)).not.toContain(
        "fixture private",
      );
    },
  );

  it("recognizes nested plugin validation failure without recording issue contents", () => {
    expect(
      recordInterfaceResult("ipc", IPC_CHANNELS.localPluginValidate, {
        kind: "plugin",
        validation: { ok: false, errors: [{ message: "fixture private plugin path" }] },
      }),
    ).toBe(true);
    expect(recordRuntimeWarning).toHaveBeenCalledWith("ipc.result", expect.any(String), {
      operation: IPC_CHANNELS.localPluginValidate,
      code: "PLUGIN_VALIDATION_FAILED",
    });
    expect(JSON.stringify(vi.mocked(recordRuntimeWarning).mock.calls)).not.toContain(
      "fixture private",
    );
  });

  it("counts user-facing rejections and warnings without including warning text", () => {
    expect(
      recordInterfaceResult("ipc", IPC_CHANNELS.desktopShortcutsSet, {
        ok: false,
        errors: { quickChat: { message: "fixture private key" } },
      }),
    ).toBe(true);
    expect(
      recordInterfaceResult("ipc", IPC_CHANNELS.imageStudioGenerate, {
        warnings: ["fixture private asset", { detail: "fixture private prompt" }],
      }),
    ).toBe(true);
    expect(vi.mocked(recordRuntimeWarning).mock.calls).toEqual([
      [
        "ipc.result",
        "Interface operation returned an unsuccessful result.",
        { operation: IPC_CHANNELS.desktopShortcutsSet, code: "INTERFACE_REQUEST_REJECTED" },
      ],
      [
        "ipc.result",
        "Interface operation returned 2 warning(s).",
        { operation: IPC_CHANNELS.imageStudioGenerate, code: "INTERFACE_WARNINGS" },
      ],
    ]);
    expect(JSON.stringify(vi.mocked(recordRuntimeWarning).mock.calls)).not.toContain(
      "fixture private",
    );
  });

  it("reports actual office check failures on the two write operations but not historical reads", () => {
    const receipt = { status: "partial", stages: { render: "failed" }, fileName: "private.docx" };
    expect(inspectInterfaceResult("ipc", IPC_CHANNELS.officeDeliveryContinue, receipt)).toEqual({
      code: "OFFICE_DELIVERY_CHECK_FAILED",
      severity: "error",
    });
    expect(inspectInterfaceResult("local-api", "POST /v1/office/receipts", receipt)).toEqual({
      code: "OFFICE_DELIVERY_CHECK_FAILED",
      severity: "error",
    });
    expect(
      inspectInterfaceResult("local-api", "POST /v1/office/receipts", {
        receipt,
        visualBatch: { pages: ["fixture private image"] },
      }),
    ).toEqual({ code: "OFFICE_DELIVERY_CHECK_FAILED", severity: "error" });
    expect(inspectInterfaceResult("local-api", "GET /v1/office/receipts", receipt)).toBeNull();
    expect(inspectInterfaceResult("ipc", IPC_CHANNELS.officeDeliveriesList, [receipt])).toBeNull();
    expect(
      inspectInterfaceResult("ipc", IPC_CHANNELS.officeDeliveryContinue, {
        status: "partial",
        stages: { render: "unavailable" },
      }),
    ).toBeNull();
  });

  it("does not inspect arbitrary data, nested user content, history or already-logged updates", () => {
    for (const [operation, result] of [
      [IPC_CHANNELS.workspaceRead, { content: { ok: false, success: false, errors: ["data"] } }],
      [IPC_CHANNELS.sessionMessages, [{ status: "failed", isError: true }]],
      [IPC_CHANNELS.localPluginMarketsList, { validation: { ok: false } }],
      [IPC_CHANNELS.terminalList, [{ status: "error" }]],
      [IPC_CHANNELS.updateCheck, { state: "error", error: "already recorded" }],
      [IPC_CHANNELS.workspaceGitStatus, { error: "not a repository" }],
    ] as const) {
      expect(recordInterfaceResult("ipc", operation, result)).toBe(false);
    }
    expect(recordRuntimeError).not.toHaveBeenCalled();
    expect(recordRuntimeWarning).not.toHaveBeenCalled();
  });

  it("classifies a nonzero user command as a warning, without command or output", () => {
    expect(
      recordInterfaceResult("ipc", IPC_CHANNELS.workspaceRunCommand, {
        exitCode: 2,
        stdout: "fixture private stdout",
        stderr: "fixture private stderr",
      }),
    ).toBe(true);
    expect(recordRuntimeWarning).toHaveBeenCalledWith("ipc.result", expect.any(String), {
      operation: IPC_CHANNELS.workspaceRunCommand,
      code: "USER_COMMAND_NONZERO_EXIT",
    });
    expect(JSON.stringify(vi.mocked(recordRuntimeWarning).mock.calls)).not.toContain(
      "fixture private",
    );
  });
});
