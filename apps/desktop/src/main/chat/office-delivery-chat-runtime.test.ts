import { describe, expect, it, vi } from "vitest";
import type { ChatStreamEvent, ModelConfig, ProviderView, SessionView } from "../../shared/domain";
import type { OfficeDeliveryReceipt, OfficeDeliverySettings } from "../../shared/office-delivery";
import type { RuntimeRunStatus, RuntimeRunView } from "../../shared/runtime";
import { ManagedPolicyError } from "../policy/managed-policy-service";
import { ChatService, USER_INTERRUPT_REASON } from "./chat-service";

function receipt(
  sha256: string,
  options: {
    issue?: boolean;
    inspectedPages?: number;
    complete?: boolean;
  } = {},
): OfficeDeliveryReceipt {
  const inspectedPages = options.inspectedPages ?? 3;
  return {
    id: "delivery-1",
    sessionId: "session-1",
    runId: "run-visual",
    fileName: "report.docx",
    format: "DOCX",
    size: 128,
    sha256,
    source: null,
    status: options.issue ? "partial" : "unverified",
    stages: {
      package: "verified",
      structure: "verified",
      content: "verified",
      formula: "not_requested",
      recalculation: "not_requested",
      render: "verified",
      visual: "partial",
    },
    engine: "microsoft_office",
    structuralSummary: "Fixture document structure passed.",
    issues: options.issue
      ? [
          {
            code: "OFFICE_VISUAL_ISSUE",
            stage: "visual",
            severity: "warning",
            message: "Page 2 has clipped content.",
            repairable: true,
          },
        ]
      : [],
    unverified: [],
    repairSuggestions: options.issue ? ["Repair page 2 clipping."] : [],
    visual: {
      totalPages: 3,
      inspectedPages,
      complete: options.complete ?? inspectedPages === 3,
      batchCount: 1,
      pageNumbers: Array.from({ length: inspectedPages }, (_, index) => index + 1),
      modelId: "vision-model",
    },
    evidence: {
      pdfSha256: "a".repeat(64),
      pdfBytes: 256,
      cachedUntil: null,
    },
    checkedAt: "2026-11-27T00:00:00.000Z",
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
    revision: 1,
  };
}

function runtimeRun(runId: string, sessionId: string, status: RuntimeRunStatus): RuntimeRunView {
  return {
    runId,
    sessionId,
    status,
    source: "office_visual",
    createdAt: "2026-11-27T00:00:00.000Z",
    startedAt: status === "running" ? "2026-11-27T00:00:01.000Z" : null,
    updatedAt: "2026-11-27T00:00:01.000Z",
    completedAt: ["completed", "failed", "interrupted", "blocked_policy"].includes(status)
      ? "2026-11-27T00:00:02.000Z"
      : null,
    terminalReason: null,
    policyRevision: "revision-1",
    delegatedRunId: null,
    lastEventId: 0,
  };
}

function continuationFixture() {
  const session = {
    id: "session-1",
    title: "Office delivery",
    agentMode: "work",
    providerId: "provider-1",
    modelId: "model-1",
    workspacePath: "C:\\workspace",
    parentSessionId: null,
    executionMode: "host",
    permissionMode: "full_access",
    archived: false,
    status: "idle",
  } as SessionView;
  const model = {
    id: "model-1",
    providerId: "provider-1",
    enabled: true,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
  } as ModelConfig;
  const provider = {
    id: "provider-1",
    name: "Fixture",
    protocol: "openai_responses",
  } as ProviderView;
  const initialReceipt = receipt("1".repeat(64), {
    inspectedPages: 1,
    complete: false,
  });
  const settings: OfficeDeliverySettings = {
    visualEnabled: true,
    visionModelId: "model-1",
    maxRepairRounds: 3,
    batchPages: 12,
    batchMaxBytes: 12 * 1024 * 1024,
    maxPages: 200,
    maxImageBytes: 200 * 1024 * 1024,
  };
  const transitions: Array<{ runId: string; status: RuntimeRunStatus; reason: string | null }> = [];
  const runtime = {
    admitTurn: vi.fn(() => ({
      turnId: "turn-1",
      runId: "run-visual",
      sessionId: session.id,
      idempotencyKey: "key",
      requestHash: "hash",
      source: "office_visual",
      createdAt: "2026-11-27T00:00:00.000Z",
      duplicate: false,
    })),
    markPreparing: vi.fn((runId: string) => runtimeRun(runId, session.id, "preparing")),
    transitionRun: vi.fn((runId: string, status: RuntimeRunStatus, reason: string | null) => {
      transitions.push({ runId, status, reason });
      return runtimeRun(runId, session.id, status);
    }),
    getRun: vi.fn((runId: string) => runtimeRun(runId, session.id, "accepted")),
    recordPolicyDenial: vi.fn((runId: string) => runtimeRun(runId, session.id, "blocked_policy")),
  };
  const officeDelivery = {
    get: vi.fn().mockResolvedValue(initialReceipt),
    check: vi.fn().mockResolvedValue(receipt("1".repeat(64))),
  };
  const managedPolicy = {
    status: vi.fn(() => ({ revision: "policy-2" })),
    effectivePolicy: vi.fn(() => ({ office: {} })),
    assertOperational: vi.fn(),
    assertPermissionMode: vi.fn(),
    assertExecutionMode: vi.fn(),
    assertCapability: vi.fn(),
    assertOfficeMinimum: vi.fn(),
  };
  const repository = {
    getSession: vi.fn(() => session),
    updateSession: vi.fn((_id: string, patch: Partial<SessionView>) => ({
      ...session,
      ...patch,
    })),
    getSetting: vi.fn(() => settings),
    getModel: vi.fn(() => model),
    getProvider: vi.fn(() => provider),
    listChildSessions: vi.fn(() => []),
  };
  const events: ChatStreamEvent[] = [];
  const toolRegistry = {
    cancelRun: vi.fn().mockResolvedValue(undefined),
  };
  const chat = new ChatService({
    repository,
    runtimeService: runtime,
    officeDelivery,
    managedPolicy,
    toolRegistry,
    approvalBroker: { cancelSession: vi.fn() },
    questionBroker: { cancelSession: vi.fn() },
    emit: (event: ChatStreamEvent) => events.push(event),
  } as unknown as ConstructorParameters<typeof ChatService>[0]);
  const internal = chat as unknown as {
    authorizeModelRequest: (
      session: SessionView,
      runId: string,
      model: ModelConfig,
      signal: AbortSignal,
    ) => Promise<void>;
    checkOfficeDeliveryReceipt: (input: {
      session: SessionView;
      runId: string;
      signal: AbortSignal;
      deliveryId: string;
      startPage?: number;
    }) => Promise<OfficeDeliveryReceipt>;
  };
  const authorizeModelRequest = vi.spyOn(internal, "authorizeModelRequest").mockResolvedValue();
  return {
    chat,
    internal,
    authorizeModelRequest,
    events,
    runtime,
    transitions,
    toolRegistry,
    officeDelivery,
    managedPolicy,
    session,
    initialReceipt,
  };
}

describe("Office delivery ChatService runtime", () => {
  it("binds manual visual continuation to one admitted run and settles runtime states", async () => {
    const fixture = continuationFixture();
    const check = vi
      .spyOn(fixture.internal, "checkOfficeDeliveryReceipt")
      .mockResolvedValue(receipt("1".repeat(64), { inspectedPages: 2, complete: false }));

    const result = await fixture.chat.continueOfficeDeliveryVisual({
      sessionId: "session-1",
      deliveryId: "delivery-1",
    });

    expect(result).toMatchObject({ id: "delivery-1", sha256: "1".repeat(64) });
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-visual",
        deliveryId: "delivery-1",
        startPage: 2,
      }),
    );
    expect(fixture.transitions.map((item) => item.status)).toEqual(["running", "completed"]);
    expect(fixture.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "run_started", runId: "run-visual" }),
        expect.objectContaining({ type: "run_completed", runId: "run-visual" }),
      ]),
    );
    expect(fixture.toolRegistry.cancelRun.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.runtime.transitionRun.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY,
    );
  });

  it("records policy denials before the cleaned-up run reaches blocked_policy", async () => {
    const fixture = continuationFixture();
    const denial = Object.assign(
      new Error("POLICY_MODEL_REQUEST_DENIED: model blocked by managed policy"),
      {
        code: "POLICY_MODEL_REQUEST_DENIED",
        revision: "policy-2",
      },
    );
    fixture.authorizeModelRequest.mockRejectedValueOnce(denial);

    await expect(
      fixture.chat.continueOfficeDeliveryVisual({
        sessionId: "session-1",
        deliveryId: "delivery-1",
      }),
    ).rejects.toBe(denial);

    expect(fixture.runtime.recordPolicyDenial).toHaveBeenCalledWith(
      "run-visual",
      expect.objectContaining({
        revision: "policy-2",
        code: "POLICY_MODEL_REQUEST_DENIED",
        scope: "office-visual",
      }),
    );
    expect(fixture.toolRegistry.cancelRun.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.runtime.transitionRun.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY,
    );
    expect(fixture.transitions.at(-1)).toMatchObject({
      runId: "run-visual",
      status: "blocked_policy",
    });
  });

  it("reports cleanup failure as a failed run and does not return success", async () => {
    const fixture = continuationFixture();
    vi.spyOn(fixture.internal, "checkOfficeDeliveryReceipt").mockResolvedValue(
      receipt("1".repeat(64), { inspectedPages: 2, complete: false }),
    );
    const cleanupFailure = new Error("command tree cleanup could not be confirmed");
    fixture.toolRegistry.cancelRun.mockRejectedValueOnce(cleanupFailure);

    await expect(
      fixture.chat.continueOfficeDeliveryVisual({
        sessionId: "session-1",
        deliveryId: "delivery-1",
      }),
    ).rejects.toBe(cleanupFailure);

    expect(fixture.transitions.at(-1)).toMatchObject({
      runId: "run-visual",
      status: "failed",
      reason: cleanupFailure.message,
    });
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        type: "run_failed",
        sessionId: "session-1",
        runId: "run-visual",
        error: cleanupFailure.message,
      }),
    );
  });

  it("denies developer Office checks outside a main host full-access session", async () => {
    const fixture = continuationFixture();
    const check = vi.spyOn(fixture.internal, "checkOfficeDeliveryReceipt");
    fixture.session.executionMode = "docker";

    await expect(
      fixture.chat.checkOfficeDeliveryReceiptFromDeveloperApi({
        deliveryId: "delivery-1",
      }),
    ).rejects.toMatchObject({ code: "POLICY_BLOCKED" });

    expect(check).not.toHaveBeenCalled();
    expect(fixture.runtime.recordPolicyDenial).toHaveBeenCalledWith(
      "run-visual",
      expect.objectContaining({
        code: "POLICY_BLOCKED",
        scope: "developer-api-office-check",
      }),
    );
  });

  it("fails closed when Office verification requires approval", async () => {
    const fixture = continuationFixture();
    fixture.managedPolicy.assertCapability.mockImplementation((capability: string) => {
      if (capability === "office.verify")
        throw new ManagedPolicyError(
          "POLICY_APPROVAL_REQUIRED",
          "Office verification requires explicit approval.",
          "policy-2",
        );
    });
    const check = vi.spyOn(fixture.internal, "checkOfficeDeliveryReceipt");

    await expect(
      fixture.chat.checkOfficeDeliveryReceiptFromDeveloperApi({
        deliveryId: "delivery-1",
      }),
    ).rejects.toMatchObject({ code: "POLICY_APPROVAL_REQUIRED" });

    expect(check).not.toHaveBeenCalled();
    expect(fixture.runtime.recordPolicyDenial).toHaveBeenCalledWith(
      "run-visual",
      expect.objectContaining({
        code: "POLICY_APPROVAL_REQUIRED",
        scope: "developer-api-office-check",
      }),
    );
  });

  it("uses effective policy minimums and rechecks the owning session before every host stage", async () => {
    const fixture = continuationFixture();
    fixture.managedPolicy.effectivePolicy.mockReturnValue({
      office: { minimumStatus: "visually_verified" },
    });

    await fixture.chat.checkOfficeDeliveryReceiptFromDeveloperApi({
      deliveryId: "delivery-1",
    });
    const options = fixture.officeDelivery.check.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      requiredRender: true,
      requiredVisual: true,
    });

    fixture.managedPolicy.assertCapability.mockClear();
    fixture.managedPolicy.assertCapability.mockImplementationOnce(() => {
      throw new ManagedPolicyError(
        "POLICY_BLOCKED",
        "Office verification was revoked before the renderer stage.",
        "policy-3",
      );
    });
    await expect(options?.beforeStage?.("libreoffice")).rejects.toMatchObject({
      code: "POLICY_BLOCKED",
    });
    expect(fixture.managedPolicy.assertCapability).toHaveBeenCalledWith("file.read");
  });

  it("does not return a receipt that misses the managed office minimum", async () => {
    const fixture = continuationFixture();
    vi.spyOn(fixture.internal, "checkOfficeDeliveryReceipt").mockResolvedValue(
      receipt("1".repeat(64), { inspectedPages: 1, complete: false }),
    );
    fixture.managedPolicy.assertOfficeMinimum.mockImplementationOnce(() => {
      throw new ManagedPolicyError(
        "POLICY_BLOCKED",
        "Office delivery has not reached the required visual verification.",
        "policy-2",
      );
    });

    await expect(
      fixture.chat.checkOfficeDeliveryReceiptFromDeveloperApi({
        deliveryId: "delivery-1",
      }),
    ).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(fixture.runtime.recordPolicyDenial).toHaveBeenCalledWith(
      "run-visual",
      expect.objectContaining({
        code: "POLICY_BLOCKED",
        scope: "developer-api-office-check",
      }),
    );
  });

  it("stops the exact accepted visual run and records an interruption", async () => {
    const fixture = continuationFixture();
    let observedSignal: AbortSignal | undefined;
    const check = vi.spyOn(fixture.internal, "checkOfficeDeliveryReceipt").mockImplementation(
      (input) =>
        new Promise<OfficeDeliveryReceipt>((_resolve, reject) => {
          observedSignal = input.signal;
          input.signal.addEventListener(
            "abort",
            () => reject(new Error(String(input.signal.reason))),
            { once: true },
          );
        }),
    );

    const completion = fixture.chat.continueOfficeDeliveryVisual({
      sessionId: "session-1",
      deliveryId: "delivery-1",
    });
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());

    expect(fixture.chat.stopRun("run-visual")).toBe(true);
    expect(observedSignal?.aborted).toBe(true);
    await expect(completion).rejects.toThrow(USER_INTERRUPT_REASON);
    expect(
      fixture.events
        .flatMap((event) =>
          event.type === "runtime_run_updated" && event.runId === "run-visual"
            ? [event.run.status]
            : [],
        )
        .slice(0, 2),
    ).toEqual(["accepted", "preparing"]);
    expect(fixture.transitions.at(-1)).toMatchObject({
      runId: "run-visual",
      status: "interrupted",
    });
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        type: "run_interrupted",
        sessionId: "session-1",
        runId: "run-visual",
      }),
    );
  });

  it("counts a repair round only after the artifact SHA changes", () => {
    const chat = new ChatService({
      repository: {},
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      advanceOfficeDeliveryRepairProgress: (
        progress: {
          checkedSha: string;
          repairRounds: number;
          pendingRepair: boolean;
          promptedRepairSha: string | null;
          reportedReceiptSha: string | null;
          exhausted: boolean;
        },
        receipt: OfficeDeliveryReceipt,
        repairLimit: number,
      ) => { repairable: boolean; shouldContinue: boolean; guidance: string };
    };
    const progress = {
      checkedSha: "",
      repairRounds: 0,
      pendingRepair: false,
      promptedRepairSha: null,
      reportedReceiptSha: null,
      exhausted: false,
    };

    expect(
      internal.advanceOfficeDeliveryRepairProgress(
        progress,
        receipt("1".repeat(64), { issue: true }),
        2,
      ),
    ).toMatchObject({ repairable: true, shouldContinue: true });
    expect(progress.repairRounds).toBe(0);

    expect(
      internal.advanceOfficeDeliveryRepairProgress(
        progress,
        receipt("1".repeat(64), { issue: true }),
        2,
      ),
    ).toMatchObject({ repairable: true, shouldContinue: false });
    expect(progress.repairRounds).toBe(0);

    internal.advanceOfficeDeliveryRepairProgress(
      progress,
      receipt("2".repeat(64), { issue: true }),
      2,
    );
    expect(progress.repairRounds).toBe(1);
    expect(progress.pendingRepair).toBe(true);

    internal.advanceOfficeDeliveryRepairProgress(
      progress,
      receipt("3".repeat(64), { issue: true }),
      2,
    );
    expect(progress.repairRounds).toBe(2);
    expect(progress.exhausted).toBe(true);
    expect(progress.pendingRepair).toBe(false);
  });

  it("filters finalization to the four tracked Office formats and deduplicates paths", async () => {
    const chat = new ChatService({
      repository: {},
      officeDelivery: {},
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const internal = chat as unknown as {
      verifyOfficeDeliveryArtifact: (input: {
        session: SessionView;
        runId: string;
        signal: AbortSignal;
        path: string;
      }) => Promise<OfficeDeliveryReceipt>;
      assertOfficeDeliveryFinalStatus: (value: OfficeDeliveryReceipt) => void;
      finalizeOfficeDeliveryArtifacts: (input: {
        session: SessionView;
        runId: string;
        signal: AbortSignal;
        paths: string[];
      }) => Promise<void>;
    };
    const verify = vi
      .spyOn(internal, "verifyOfficeDeliveryArtifact")
      .mockResolvedValue(receipt("4".repeat(64)));
    vi.spyOn(internal, "assertOfficeDeliveryFinalStatus").mockImplementation(() => undefined);
    const session = {
      id: "session-1",
      agentMode: "work",
      workspacePath: "C:\\workspace",
      parentSessionId: null,
      executionMode: "host",
      permissionMode: "full_access",
    } as SessionView;

    await internal.finalizeOfficeDeliveryArtifacts({
      session,
      runId: "run-final",
      signal: new AbortController().signal,
      paths: ["a.docx", "b.xlsx", "c.pptx", "d.pdf", "notes.txt", "a.docx"],
    });

    expect(verify.mock.calls.map(([input]) => input.path)).toEqual([
      "a.docx",
      "b.xlsx",
      "c.pptx",
      "d.pdf",
    ]);
  });
});
