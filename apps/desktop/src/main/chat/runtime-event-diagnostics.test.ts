import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent } from "../../shared/domain";
import type { OfficeDeliveryReceipt } from "../../shared/office-delivery";
import { createRuntimeEventDiagnostics } from "./runtime-event-diagnostics";

const privateText = "PRIVATE_DOCUMENT_CONTENT /home/user/secret.md";

function message(parts: unknown[]): ChatStreamEvent {
  return {
    type: "assistant_message",
    sessionId: "session-1",
    runId: "run-1",
    message: { id: "message-1", parts },
  } as ChatStreamEvent;
}

function toolResult(status: string, code?: string): ChatStreamEvent {
  return message([
    {
      type: "tool_result",
      callId: "call-1",
      output: privateText,
      isError: true,
      outcome: {
        status,
        effect: "none",
        retryable: false,
        codes: code ? [code] : [],
        validation: { status: "validated", source: "builtin" },
        evidence: [],
      },
    },
  ]);
}

function activity(status: "running" | "failed"): ChatStreamEvent {
  return {
    type: "activity",
    activity: {
      id: "run-1:call-1",
      sessionId: "session-1",
      runId: "run-1",
      toolName: "office_document",
      kind: "tool",
      title: privateText,
      detail: privateText,
      status,
      startedAt: "2026-11-27T00:00:00.000Z",
      completedAt: null,
      durationMs: null,
      fileChange: null,
    },
  };
}

function officeReceipt(): OfficeDeliveryReceipt {
  return {
    id: "receipt-1",
    sessionId: "session-1",
    runId: "run-1",
    fileName: privateText,
    format: "DOCX",
    size: 1,
    sha256: "sha",
    source: null,
    status: "blocked",
    stages: {
      package: "failed",
      structure: "not_requested",
      content: "not_requested",
      formula: "not_requested",
      recalculation: "not_requested",
      render: "not_requested",
      visual: "not_requested",
    },
    engine: "none",
    structuralSummary: privateText,
    issues: [
      {
        code: "OFFICE_PACKAGE_INVALID",
        stage: "package",
        severity: "blocking",
        message: privateText,
        repairable: false,
      },
    ],
    unverified: [privateText],
    repairSuggestions: [],
    visual: {
      totalPages: null,
      inspectedPages: 0,
      complete: false,
      batchCount: 0,
      pageNumbers: [],
      modelId: null,
    },
    evidence: { pdfSha256: null, pdfBytes: 0, cachedUntil: null },
    checkedAt: null,
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
    revision: 1,
  };
}

describe("runtime event diagnostics", () => {
  it("records a failed tool once using structured metadata, never arguments or output", () => {
    const error = vi.fn();
    const warning = vi.fn();
    const observe = createRuntimeEventDiagnostics(error, warning);
    observe(
      message([
        { type: "tool_call", callId: "call-1", name: "office_document", arguments: privateText },
      ]),
    );
    observe(activity("running"));
    observe(activity("failed"));
    observe(toolResult("failed", "INVALID_TOOL_ENVELOPE"));
    observe(toolResult("failed", "INVALID_TOOL_ENVELOPE"));
    observe(activity("failed"));
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("tool.result", expect.any(String), {
      sessionId: "session-1",
      runId: "run-1",
      toolName: "office_document",
      status: "failed",
      code: "INVALID_TOOL_ENVELOPE",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(privateText);
    expect(warning).not.toHaveBeenCalled();
  });

  it.each(["denied", "cancelled", "unverified"])("counts %s as a warning", (status) => {
    const error = vi.fn();
    const warning = vi.fn();
    const observe = createRuntimeEventDiagnostics(error, warning);
    observe(
      message([
        { type: "tool_call", callId: "call-1", name: "mcp__sample__tool", arguments: privateText },
      ]),
    );
    observe(activity("failed"));
    observe(toolResult(status));
    expect(error).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[2]).toMatchObject({ status });
    observe(activity("failed"));
    expect(error).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("records a later command failure after an earlier successful tool result", () => {
    const error = vi.fn();
    const observe = createRuntimeEventDiagnostics(error, vi.fn());
    observe(
      message([
        { type: "tool_call", callId: "call-1", name: "exec_command", arguments: privateText },
      ]),
    );
    observe(
      message([{ type: "tool_result", callId: "call-1", output: privateText, isError: false }]),
    );
    observe(activity("failed"));
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toBe("agent.activity");
    expect(JSON.stringify(error.mock.calls)).not.toContain(privateText);
  });

  it("records standalone hook activities without recording their details", () => {
    const error = vi.fn();
    const observe = createRuntimeEventDiagnostics(error, vi.fn());
    const event = activity("failed");
    if (event.type === "activity") event.activity.id = "run-1:hook:PostToolUse:1";
    observe(event);
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.stringify(error.mock.calls)).not.toContain(privateText);
  });

  it.each(["cancelled", "denied"] as const)(
    "counts an explicitly %s hook activity as a warning",
    (status) => {
      const error = vi.fn();
      const warning = vi.fn();
      const observe = createRuntimeEventDiagnostics(error, warning);
      const event = activity("failed");
      if (event.type === "activity") {
        event.activity.id = "run-1:hook:PostToolUse:1";
        event.activity.diagnosticStatus = status;
      }
      observe(event);
      expect(error).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledOnce();
      expect(warning.mock.calls[0]?.[2]).toMatchObject({ status });
    },
  );

  it("records Office issues once per receipt revision with safe codes only", () => {
    const error = vi.fn();
    const warning = vi.fn();
    const observe = createRuntimeEventDiagnostics(error, warning);
    const receipt = officeReceipt();
    const event: ChatStreamEvent = {
      type: "office_delivery_updated",
      sessionId: "session-1",
      runId: "run-1",
      receipt,
    };
    observe(event);
    observe(event);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[2]).toMatchObject({
      operation: "package",
      code: "OFFICE_PACKAGE_INVALID",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(privateText);
    receipt.revision++;
    observe(event);
    expect(error).toHaveBeenCalledTimes(2);
    expect(warning).not.toHaveBeenCalled();
  });

  it("reports unavailable or incomplete Office checks as warnings", () => {
    const error = vi.fn();
    const warning = vi.fn();
    const observe = createRuntimeEventDiagnostics(error, warning);
    const receipt = officeReceipt();
    receipt.status = "unverified";
    receipt.issues = [];
    receipt.stages.package = "verified";
    receipt.stages.render = "unavailable";
    observe({ type: "office_delivery_updated", sessionId: "session-1", runId: "run-1", receipt });
    expect(error).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[2]).toMatchObject({ code: "OFFICE_DELIVERY_NOT_VERIFIED" });
  });
});
