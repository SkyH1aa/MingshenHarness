import { realpath } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ChatStreamEvent } from "../shared/domain";
import { RUNTIME_TERMINAL_STATUSES } from "../shared/runtime";
import type { InteractiveTerminalEvent } from "../shared/terminal";
import { AgentProfileService } from "./agents/agent-profile-service";
import { CustomCommandService } from "./agents/custom-command-service";
import { DraftAssistService } from "./agents/draft-assist-service";
import { LspDiagnosticsService } from "./agents/lsp-diagnostics-service";
import { ProjectConfigService } from "./agents/project-config-service";
import { ProjectInstructionService } from "./agents/project-instruction-service";
import { ProjectToolingService } from "./agents/project-tooling-service";
import { SessionBuiltinCapabilityService } from "./agents/session-builtin-capability-service";
import { runAppServicesShutdown } from "./app-services-shutdown";
import { BrowserService } from "./browser/browser-service";
import { GitHubService } from "./browser/github-service";
import { ChatService } from "./chat/chat-service";
import { QueuedPromptService } from "./chat/queued-prompt-service";
import { createRuntimeEventDiagnostics } from "./chat/runtime-event-diagnostics";
import { recordRuntimeError } from "./diagnostics/runtime-log";
import { OfficeDeliveryService } from "./documents/office-delivery-service";
import { ExtensionService } from "./extensions/extension-service";
import { PluginHookService } from "./extensions/plugin-hook-service";
import { ImageStudioService } from "./image-studio/image-studio-service";
import { LocalPluginMarketplaceService } from "./marketplace/local-plugin-marketplace-service";
import { SkillMarketplaceService } from "./marketplace/skill-marketplace-service";
import { McpService } from "./mcp/mcp-service";
import { ApprovalBroker } from "./permissions/approval-broker";
import { PermissionStore } from "./permissions/permission-store";
import { QuestionBroker } from "./permissions/question-broker";
import { ManagedPolicyError, ManagedPolicyService } from "./policy/managed-policy-service";
import { ProviderService } from "./providers/provider-service";
import { resolveExternalResourcePath } from "./resource-paths";
import { RuntimeService } from "./runtime/runtime-service";
import { ScheduledTaskService } from "./schedules/scheduled-task-service";
import { HeadlessServerService } from "./server/headless-server-service";
import { ProjectNavigationService } from "./sessions/project-navigation-service";
import { SessionRetentionService } from "./sessions/session-retention-service";
import { SessionService } from "./sessions/session-service";
import { openDatabase } from "./storage/database";
import { Repository } from "./storage/repository";
import { SecretStore } from "./storage/secret-store";
import { TerminalService } from "./terminal/terminal-service";
import { CustomToolService } from "./tools/custom-tool-service";
import { ToolRegistry } from "./tools/tool-registry";
import { TrajectoryService } from "./trajectories/trajectory-service";
import { PlanClaimError, PlanClaimService } from "./workbench/plan-claim-service";
import { DockerService } from "./workspace/docker-service";
import { GitChangeService } from "./workspace/git-change-service";
import { stopGuardedWorkspaceIo } from "./workspace/guarded-workspace-io";
import { LocalReviewService } from "./workspace/local-review-service";
import { NativeSandboxService } from "./workspace/native-sandbox-service";
import { SnapshotService } from "./workspace/snapshot-service";
import { WorkspaceSearchService } from "./workspace/workspace-search-service";
import { WorkspaceService } from "./workspace/workspace-service";
import { WorktreeService } from "./workspace/worktree-service";

export interface AppServices {
  database: DatabaseSync;
  repository: Repository;
  runtimeService: RuntimeService;
  managedPolicy: ManagedPolicyService;
  planClaims: PlanClaimService;
  officeDelivery: OfficeDeliveryService;
  emitEvent(event: ChatStreamEvent): void;
  providerService: ProviderService;
  draftAssistService: DraftAssistService;
  agentProfileService: AgentProfileService;
  sessionBuiltinCapabilityService: SessionBuiltinCapabilityService;
  customCommandService: CustomCommandService;
  projectNavigationService: ProjectNavigationService;
  sessionService: SessionService;
  sessionRetentionService: SessionRetentionService;
  extensionService: ExtensionService;
  marketplaceService: SkillMarketplaceService;
  localPluginMarketplaceService: LocalPluginMarketplaceService;
  browserService: BrowserService;
  githubService: GitHubService;
  mcpService: McpService;
  pluginHookService: PluginHookService;
  imageStudioService: ImageStudioService;
  projectConfigService: ProjectConfigService;
  projectInstructionService: ProjectInstructionService;
  projectToolingService: ProjectToolingService;
  lspDiagnosticsService: LspDiagnosticsService;
  snapshotService: SnapshotService;
  worktreeService: WorktreeService;
  dockerService: DockerService;
  trajectoryService: TrajectoryService;
  headlessServerService: HeadlessServerService;
  scheduledTaskService: ScheduledTaskService;
  chatService: ChatService;
  queuedPromptService: QueuedPromptService;
  customToolService: CustomToolService;
  approvalBroker: ApprovalBroker;
  questionBroker: QuestionBroker;
  terminalService: TerminalService;
  workspaceService: WorkspaceService;
  workspaceSearchService: WorkspaceSearchService;
  gitChangeService: GitChangeService;
  localReviewService: LocalReviewService;
  dispose(): Promise<void>;
}

type DeveloperHandler = (
  request: IncomingMessage,
  url: URL,
  body: Record<string, unknown>,
) => unknown | Promise<unknown>;

const developerResult = (httpStatus: number, json: unknown) => ({ httpStatus, json });

const policyError = (error: unknown) => {
  const managedError = error instanceof ManagedPolicyError ? error : null;
  return developerResult(403, {
    error: managedError?.message ?? (error instanceof Error ? error.message : String(error)),
    code: managedError?.code ?? "DEVELOPER_API_DENIED",
    ...(managedError ? { policyRevision: managedError.revision } : {}),
    ...(managedError?.sources.length ? { policySources: managedError.sources } : {}),
  });
};

const claimError = (error: unknown) => {
  if (error instanceof ManagedPolicyError) return policyError(error);
  const code = error instanceof PlanClaimError ? error.code : null;
  const status =
    code === "session_not_found" || code === "step_not_found" || code === "claim_not_found"
      ? 404
      : code === "claim_owner_mismatch"
        ? 403
        : code
          ? 409
          : 400;
  return developerResult(status, {
    error: error instanceof Error ? error.message : String(error),
    code: code ? `PLAN_CLAIM_${code.toUpperCase()}` : "PLAN_CLAIM_INVALID",
  });
};

const requiredText = (body: Record<string, unknown>, key: string): string | null => {
  const value = body[key];
  return typeof value === "string" && value.trim() && !value.includes("\0") ? value.trim() : null;
};

export interface TaskClaimsHandlerInput {
  planClaims: PlanClaimService;
  chatService: ChatService;
  runtimeService: RuntimeService;
  repository: Repository;
}

export function createTaskClaimsHandler(input: TaskClaimsHandlerInput): DeveloperHandler {
  return (request, url, body) => {
    if ((request.method ?? "GET") === "GET") {
      const claimId = url.searchParams.get("claimId");
      if (claimId) {
        const claim = input.planClaims.getClaim(claimId);
        return claim
          ? claim
          : developerResult(404, {
              error: "Plan step claim was not found.",
              code: "PLAN_CLAIM_NOT_FOUND",
            });
      }
      const ownerRunId = url.searchParams.get("ownerRunId");
      if (ownerRunId) {
        const includeTerminal = ["1", "true"].includes(
          (url.searchParams.get("includeTerminal") ?? "").toLowerCase(),
        );
        try {
          return input.planClaims.listOwnerRunClaims(ownerRunId, includeTerminal);
        } catch (error) {
          return claimError(error);
        }
      }
      const sessionId = url.searchParams.get("sessionId") ?? "";
      if (!sessionId) {
        return developerResult(400, {
          error: "sessionId or ownerRunId is required to list plan step claims.",
          code: "PLAN_CLAIM_SESSION_REQUIRED",
        });
      }
      const includeTerminal = ["1", "true"].includes(
        (url.searchParams.get("includeTerminal") ?? "").toLowerCase(),
      );
      try {
        return input.planClaims.listClaims(sessionId, includeTerminal);
      } catch (error) {
        return claimError(error);
      }
    }
    const action = requiredText(body, "action");
    try {
      if (action === "claim") {
        const sessionId = requiredText(body, "sessionId");
        const runId = requiredText(body, "runId");
        const ownerSessionId = requiredText(body, "ownerSessionId") ?? sessionId;
        const stepId = requiredText(body, "stepId");
        const revision = body.revision;
        if (!sessionId || !runId || !ownerSessionId || !stepId || !Number.isSafeInteger(revision)) {
          return developerResult(400, {
            error: "claim requires sessionId, runId, stepId and an integer revision.",
            code: "PLAN_CLAIM_INVALID",
          });
        }
        const run = input.runtimeService.getRun(runId);
        if (run.sessionId !== ownerSessionId) {
          return developerResult(409, {
            error: "The run does not belong to the declared owner session.",
            code: "PLAN_CLAIM_OWNER_RUN_MISMATCH",
          });
        }
        if (RUNTIME_TERMINAL_STATUSES.has(run.status)) {
          return developerResult(409, {
            error: "A terminal run cannot claim new plan work.",
            code: "PLAN_CLAIM_RUN_TERMINAL",
          });
        }
        if (!input.chatService.isPlanClaimRunActive(ownerSessionId, runId)) {
          return developerResult(409, {
            error: "The run is admitted but has no matching live ChatService executor.",
            code: "PLAN_CLAIM_RUN_NOT_ACTIVE",
          });
        }
        const agentProfileId =
          typeof body.agentProfileId === "string"
            ? body.agentProfileId
            : input.repository.getSession(ownerSessionId)?.agentProfileId;
        return developerResult(
          201,
          input.planClaims.begin({
            sessionId,
            runId,
            ownerSessionId,
            stepId,
            revision: Number(revision),
            ...(agentProfileId ? { agentProfileId } : {}),
          }),
        );
      }
      if (action === "heartbeat") {
        const claimId = requiredText(body, "claimId");
        const ownerRunId = requiredText(body, "ownerRunId");
        if (!claimId || !ownerRunId)
          return developerResult(400, {
            error: "heartbeat requires claimId and ownerRunId.",
            code: "PLAN_CLAIM_INVALID",
          });
        const claim = input.planClaims.getClaim(claimId);
        if (!claim)
          return developerResult(404, {
            error: "Plan step claim was not found.",
            code: "PLAN_CLAIM_NOT_FOUND",
          });
        const run = input.runtimeService.getRun(ownerRunId);
        if (claim.ownerRunId !== ownerRunId || run.sessionId !== claim.ownerSessionId)
          return developerResult(403, {
            error: "The run does not own this plan step claim.",
            code: "PLAN_CLAIM_OWNER_RUN_MISMATCH",
          });
        if (RUNTIME_TERMINAL_STATUSES.has(run.status))
          return developerResult(409, {
            error: "A terminal run cannot renew a plan step claim.",
            code: "PLAN_CLAIM_RUN_TERMINAL",
          });
        if (!input.chatService.isPlanClaimRunActive(claim.ownerSessionId, ownerRunId))
          return developerResult(409, {
            error: "The run is admitted but has no matching live ChatService executor.",
            code: "PLAN_CLAIM_RUN_NOT_ACTIVE",
          });
        return developerResult(200, input.planClaims.heartbeat({ claimId, ownerRunId }));
      }
      if (action === "settle") {
        const claimId = requiredText(body, "claimId");
        const ownerRunId = requiredText(body, "ownerRunId");
        const status = requiredText(body, "status");
        const expectedVersion = body.expectedVersion;
        if (
          !claimId ||
          !ownerRunId ||
          !status ||
          !["completed", "released"].includes(status) ||
          !Number.isSafeInteger(expectedVersion) ||
          Number(expectedVersion) < 1
        ) {
          return developerResult(400, {
            error:
              "settle requires claimId, ownerRunId, status completed or released, and the positive integer claimVersion read as expectedVersion; use recover for stale or cancelled claims.",
            code: "PLAN_CLAIM_INVALID",
          });
        }
        const evidence = Array.isArray(body.evidence)
          ? body.evidence.filter((item): item is string => typeof item === "string")
          : undefined;
        return developerResult(
          200,
          input.chatService.settlePlanClaim({
            claimId,
            ownerRunId,
            status: status as "completed" | "released",
            expectedVersion: Number(expectedVersion),
            ...(typeof body.summary === "string" ? { summary: body.summary } : {}),
            ...(evidence ? { evidence } : {}),
          }),
        );
      }
      if (action === "recover") {
        const sessionId = requiredText(body, "sessionId");
        const claimId = requiredText(body, "claimId");
        const expectedVersion = body.expectedVersion;
        const summary = requiredText(body, "summary");
        const inspectionCallIds = Array.isArray(body.inspectionCallIds)
          ? body.inspectionCallIds.filter((item): item is string => typeof item === "string")
          : undefined;
        if (!sessionId || !claimId || !Number.isSafeInteger(expectedVersion) || !summary) {
          return developerResult(400, {
            error:
              "recover requires sessionId, claimId, an integer expectedVersion and a factual summary.",
            code: "PLAN_CLAIM_INVALID",
          });
        }
        return developerResult(
          200,
          input.chatService.recoverPlanClaim({
            sessionId,
            claimId,
            expectedVersion: Number(expectedVersion),
            summary,
            ...(inspectionCallIds?.length ? { inspectionCallIds } : {}),
          }),
        );
      }
      return developerResult(400, {
        error: "action must be claim, heartbeat, settle or recover.",
        code: "PLAN_CLAIM_ACTION_INVALID",
      });
    } catch (error) {
      return claimError(error);
    }
  };
}

export function createAppServices(input: {
  databasePath: string;
  resourceDirectory: string;
  promptDirectory: string;
  extensionDirectory: string;
  userDataDirectory: string;
  appVersion: string;
  emit: (event: ChatStreamEvent) => void;
  emitTerminal?: (ownerId: number, event: InteractiveTerminalEvent) => void;
}): AppServices {
  const database = openDatabase(input.databasePath);
  const repository = new Repository(database);
  repository.recoverInterruptedRuns();
  const runtimeService = new RuntimeService(database, repository);
  runtimeService.recoverInterruptedRuns();
  const managedPolicy = new ManagedPolicyService(repository);
  let chatService: ChatService | null = null;
  const planClaims = new PlanClaimService(database, repository, (sessionId) =>
    chatService?.workbench.publishState(sessionId),
  );
  const officeDelivery = new OfficeDeliveryService({
    database,
    evidenceDirectory: join(input.userDataDirectory, "office-deliveries"),
  });
  void officeDelivery
    .cleanupEvidenceCache()
    .catch((error) => recordRuntimeError("office.cache", error));
  runtimeService.setCapabilities({ policy: true, taskClaims: true, officeReceipts: true });
  const trajectoryService = new TrajectoryService(repository);
  let headlessServerService: HeadlessServerService | null = null;
  let queuedPromptService: QueuedPromptService | null = null;
  const recordEventDiagnostics = createRuntimeEventDiagnostics();
  const emit = (event: ChatStreamEvent): void => {
    const eventRunId =
      "runId" in event && typeof event.runId === "string"
        ? event.runId
        : event.type === "activity"
          ? event.activity.runId
          : null;
    let previousRunStatus: import("../shared/runtime").RuntimeRunStatus | null = null;
    if (eventRunId) {
      try {
        previousRunStatus = runtimeService.getRun(eventRunId).status;
      } catch {
        // Some legacy events can create their runtime record on first persistence.
      }
    }
    const envelope = runtimeService.recordEvent(event);
    if (event.type === "run_started") {
      const session = repository.getSession(event.sessionId);
      if (session && !session.parentSessionId)
        queuedPromptService?.runStarted(event.sessionId, event.runId, event.kind);
    }
    if (event.type === "session_updated") queuedPromptService?.sessionChanged(event.session.id);
    if (event.type === "session_removed") queuedPromptService?.forgetSession(event.sessionId);
    if (event.type === "run_failed")
      queuedPromptService?.runFailed(event.sessionId, event.runId, event.error);
    recordEventDiagnostics(event);
    trajectoryService.record(event);
    headlessServerService?.recordEvent(event);
    input.emit(event);
    if (event.type !== "runtime_run_updated" && envelope.runId) {
      try {
        const run = runtimeService.getRun(envelope.runId);
        if (run.status !== previousRunStatus) {
          input.emit({
            type: "runtime_run_updated",
            sessionId: run.sessionId,
            runId: run.runId,
            run,
          });
        }
      } catch {
        // Never synthesize a run that persistence did not create.
      }
    }
  };
  const secretStore = new SecretStore(database);
  const providerService = new ProviderService(repository, secretStore);
  providerService.setManagedPolicy(managedPolicy);
  const draftAssistService = new DraftAssistService(repository, providerService);
  draftAssistService.setManagedPolicy(managedPolicy);
  const agentProfileService = new AgentProfileService(repository);
  const customCommandService = new CustomCommandService(repository);
  customCommandService.setManagedPolicy(managedPolicy);
  const sessionBuiltinCapabilityService = new SessionBuiltinCapabilityService(
    repository,
    input.promptDirectory,
    (sessionId) => chatService?.isSessionBusy(sessionId) ?? false,
    (session) => chatService?.availableBuiltinPluginToolNames(session) ?? new Set(),
  );
  const worktreeService = new WorktreeService(join(input.userDataDirectory, "worktrees"));
  const projectNavigationService = new ProjectNavigationService(repository, (sessionId) =>
    worktreeService.get(sessionId),
  );
  const sessionService = new SessionService(
    repository,
    sessionBuiltinCapabilityService,
    projectNavigationService,
  );
  const extensionService = new ExtensionService(repository, input.extensionDirectory);
  extensionService.setManagedPolicy(managedPolicy);
  const marketplaceService = new SkillMarketplaceService(
    join(input.userDataDirectory, "marketplace"),
    extensionService,
  );
  marketplaceService.setManagedPolicy(managedPolicy);
  const localPluginMarketplaceService = new LocalPluginMarketplaceService(
    repository,
    extensionService,
    input.extensionDirectory,
  );
  localPluginMarketplaceService.setManagedPolicy(managedPolicy);
  const browserService = new BrowserService(
    join(input.userDataDirectory, "browser-captures"),
    emit,
    (sessionId) => repository.getSession(sessionId)?.workspacePath ?? null,
  );
  browserService.setManagedPolicy(managedPolicy);
  const githubService = new GitHubService(repository, secretStore);
  githubService.setManagedPolicy(managedPolicy);
  const mcpService = new McpService(repository, secretStore, input.appVersion);
  mcpService.setManagedPolicy(managedPolicy);
  const pluginHookService = new PluginHookService(repository, mcpService);
  pluginHookService.setManagedPolicy(managedPolicy);
  const imageStudioService = new ImageStudioService(
    repository,
    providerService,
    input.userDataDirectory,
  );
  imageStudioService.setManagedPolicy(managedPolicy);
  const projectConfigService = new ProjectConfigService(input.userDataDirectory);
  const projectInstructionService = new ProjectInstructionService(
    input.userDataDirectory,
    projectConfigService,
  );
  const lspDiagnosticsService = new LspDiagnosticsService(
    resolveExternalResourcePath(input.resourceDirectory, "lsp"),
  );
  const projectToolingService = new ProjectToolingService(
    lspDiagnosticsService,
    projectConfigService,
  );
  const snapshotService = new SnapshotService(join(input.userDataDirectory, "snapshots"));
  const terminalService = new TerminalService({
    sessions: repository,
    worktreePath: (sessionId) => worktreeService.get(sessionId),
    ...(input.emitTerminal ? { emit: input.emitTerminal } : {}),
  });
  terminalService.setManagedPolicy(managedPolicy);
  const dockerService = new DockerService();
  const approvalBroker = new ApprovalBroker((state) => emit({ type: "approval_state", state }));
  const questionBroker = new QuestionBroker(
    (request) =>
      emit({ type: "question_resolved", sessionId: request.sessionId, questionId: request.id }),
    (state) => emit({ type: "question_state", state }),
  );
  const permissions = new PermissionStore();
  const toolRegistry = new ToolRegistry(
    new NativeSandboxService(
      resolveExternalResourcePath(input.resourceDirectory, "native", "codex-sandbox.exe"),
      join(input.userDataDirectory, "native-sandbox"),
    ),
  );
  const customToolService = new CustomToolService(repository);
  customToolService.setManagedPolicy(managedPolicy);
  const workspaceService = new WorkspaceService();
  const workspaceSearchService = new WorkspaceSearchService((sessionId) =>
    worktreeService.get(sessionId),
  );
  const gitChangeService = new GitChangeService(join(input.userDataDirectory, "git-undo"));
  const localReviewService = new LocalReviewService(repository, (sessionId) =>
    worktreeService.get(sessionId),
  );
  const chatServiceInstance = new ChatService({
    repository,
    runtimeService,
    managedPolicy,
    planClaims,
    officeDelivery,
    providerService,
    agentProfileService,
    sessionBuiltinCapabilityService,
    customCommandService,
    resourceDirectory: input.resourceDirectory,
    promptDirectory: input.promptDirectory,
    appVersion: input.appVersion,
    toolRegistry,
    customToolService,
    approvalBroker,
    questionBroker,
    permissions,
    extensionService,
    localPluginMarketplaceService,
    browserService,
    githubService,
    mcpService,
    pluginHookService,
    projectConfigService,
    projectInstructionService,
    projectToolingService,
    lspDiagnosticsService,
    snapshotService,
    worktreeService,
    dockerService,
    emit,
    onRunSettled: (input) => queuedPromptService?.runSettled(input),
    onRunStopped: (sessionId) => queuedPromptService?.pause(sessionId),
    beforeSessionRemoved: async (sessionId) => {
      const cleanup = await Promise.allSettled([
        terminalService.disposeSession(sessionId),
        draftAssistService.disposeSession(sessionId),
      ]);
      const failures = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length) throw new AggregateError(failures, "会话资源清理未确认，请重试。");
    },
    onSessionRemoved: (sessionId) => projectNavigationService.forget(sessionId),
    onDelegatedSubagentRunStarted: ({ sessionId, runId }) =>
      queuedPromptService?.runStarted(sessionId, runId),
  });
  chatService = chatServiceInstance;
  const queuedPromptServiceInstance = new QueuedPromptService(repository, {
    isSessionBusy: (sessionId) => chatServiceInstance.isSessionBusy(sessionId),
    send: (input) => chatServiceInstance.sendQueuedPrompt(input),
    changed: (sessionId) => emit({ type: "queued_prompts_updated", sessionId }),
  });
  queuedPromptService = queuedPromptServiceInstance;
  const scheduledTaskService = new ScheduledTaskService(repository, chatServiceInstance);
  const sessionRetentionService = new SessionRetentionService(repository, chatServiceInstance);
  const headlessService = new HeadlessServerService(
    repository,
    sessionService,
    chatServiceInstance,
    agentProfileService,
    customCommandService,
    projectToolingService,
    mcpService,
    trajectoryService,
    approvalBroker,
    questionBroker,
    emit,
  );
  headlessServerService = headlessService;
  headlessService.setRuntimeService(runtimeService);
  headlessService.setRunCanceller((runId) => {
    try {
      if (RUNTIME_TERMINAL_STATUSES.has(runtimeService.getRun(runId).status)) return false;
    } catch {
      return false;
    }
    return chatServiceInstance.stopRun(runId);
  });
  const officeError = (error: unknown) => {
    if (error instanceof ManagedPolicyError) return policyError(error);
    const message = error instanceof Error ? error.message : String(error);
    const status = /does not exist|not found|ENOENT/i.test(message)
      ? 404
      : /invalid|required|limited|unsupported|must |only supports|outside the session workspace/i.test(
            message,
          )
        ? 400
        : 409;
    return developerResult(status, {
      error: message,
      code: status === 404 ? "OFFICE_RECEIPT_NOT_FOUND" : "OFFICE_RECEIPT_FAILED",
    });
  };
  const workspaceFile = async (sessionId: string, value: unknown): Promise<string> => {
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || isAbsolute(value)) {
      throw new Error("Office delivery paths must be relative to the session workspace.");
    }
    const session = repository.getSession(sessionId);
    if (!session) throw new Error("Office delivery session does not exist.");
    const workspacePath =
      session.executionMode === "worktree"
        ? (worktreeService.get(session.id) ?? session.workspacePath)
        : session.workspacePath;
    if (!workspacePath) throw new Error("Office delivery session has no workspace.");
    const [workspaceRoot, target] = await Promise.all([
      realpath(workspacePath),
      realpath(resolve(workspacePath, value)),
    ]);
    const relativeTarget = relative(workspaceRoot, target);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(relativeTarget)
    ) {
      throw new Error("Office delivery path is outside the session workspace.");
    }
    return target;
  };
  const officeDeliveryOperations = new Map<string, Promise<unknown>>();
  const withOfficeDeliveryLock = async <T>(
    deliveryId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = officeDeliveryOperations.get(deliveryId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    officeDeliveryOperations.set(deliveryId, current);
    try {
      return await current;
    } finally {
      if (officeDeliveryOperations.get(deliveryId) === current)
        officeDeliveryOperations.delete(deliveryId);
    }
  };
  headlessService.setDeveloperHandlers({
    capabilities: () => ({
      policy: true,
      taskClaims: true,
      officeReceipts: true,
      taskClaimActions: ["claim", "heartbeat", "settle", "recover"],
      officeReceiptActions: ["prepare", "check"],
    }),
    assertAccess: ({ operation }) => {
      try {
        if (operation === "diagnostic" && managedPolicy.status().state === "invalid") {
          return { allowed: true };
        }
        managedPolicy.assertOperational("开发者 API");
        managedPolicy.assertCapability("developer.api");
        return { allowed: true };
      } catch (error) {
        const denial = policyError(error);
        const value =
          denial.json && typeof denial.json === "object"
            ? (denial.json as Record<string, unknown>)
            : {};
        return {
          allowed: false,
          status: denial.httpStatus,
          code: String(value.code ?? "DEVELOPER_API_DENIED"),
          reason: String(value.error ?? "Developer API access was denied by managed policy."),
          ...(typeof value.policyRevision === "string" ? { revision: value.policyRevision } : {}),
          ...(Array.isArray(value.policySources) ? { policySources: value.policySources } : {}),
        };
      }
    },
    policyEffective: () => managedPolicy.effectivePolicy(),
    taskClaims: createTaskClaimsHandler({
      planClaims,
      chatService: chatServiceInstance,
      runtimeService,
      repository,
    }),
    officeReceipts: async (_request, url, body) => {
      if ((_request.method ?? "GET") === "GET") {
        const deliveryId = url.searchParams.get("deliveryId");
        try {
          if (deliveryId) return await officeDelivery.get(deliveryId);
          const sessionId = url.searchParams.get("sessionId") ?? "";
          if (!sessionId) {
            return developerResult(400, {
              error: "sessionId is required to list office delivery receipts.",
              code: "OFFICE_RECEIPT_SESSION_REQUIRED",
            });
          }
          const limit = Number(url.searchParams.get("limit") ?? 20);
          return await officeDelivery.list(sessionId, Number.isSafeInteger(limit) ? limit : 20);
        } catch (error) {
          return officeError(error);
        }
      }
      const action = requiredText(body, "action");
      try {
        if (action === "prepare") {
          const sessionId = requiredText(body, "sessionId");
          const runId = requiredText(body, "runId");
          if (!sessionId) {
            return developerResult(400, {
              error: "prepare requires sessionId.",
              code: "OFFICE_RECEIPT_INVALID",
            });
          }
          if (runId && runtimeService.getRun(runId).sessionId !== sessionId) {
            return developerResult(409, {
              error: "The receipt run does not belong to the declared session.",
              code: "OFFICE_RECEIPT_RUN_MISMATCH",
            });
          }
          const artifactPath = await workspaceFile(sessionId, body.path);
          const sourcePath =
            typeof body.sourcePath === "string" && body.sourcePath.trim()
              ? await workspaceFile(sessionId, body.sourcePath)
              : undefined;
          return developerResult(
            201,
            await chatServiceInstance.prepareOfficeDeliveryReceiptFromDeveloperApi({
              sessionId,
              ...(runId ? { runId } : {}),
              path: artifactPath,
              ...(sourcePath ? { sourcePath } : {}),
            }),
          );
        }
        const deliveryId = requiredText(body, "deliveryId");
        if (!deliveryId) {
          return developerResult(400, {
            error: `${action ?? "This action"} requires deliveryId.`,
            code: "OFFICE_RECEIPT_INVALID",
          });
        }
        if (action === "check") {
          return developerResult(
            200,
            await withOfficeDeliveryLock(deliveryId, () =>
              chatServiceInstance.checkOfficeDeliveryReceiptFromDeveloperApi({
                deliveryId,
                ...(Number.isSafeInteger(body.visualStartPage)
                  ? { startPage: Number(body.visualStartPage) }
                  : {}),
              }),
            ),
          );
        }
        if (action === "visual-batch" || action === "record-visual")
          return developerResult(403, {
            error:
              "External visual-batch and record-visual evidence is not trusted as host verification. Use action=check so MingshenHarness runs its own bounded render and vision inspection.",
            code: "OFFICE_EXTERNAL_VISUAL_EVIDENCE_UNTRUSTED",
            hostVerified: false,
          });
        return developerResult(400, {
          error: "action must be prepare or check.",
          code: "OFFICE_RECEIPT_ACTION_INVALID",
        });
      } catch (error) {
        return officeError(error);
      }
    },
  });

  return {
    database,
    repository,
    runtimeService,
    managedPolicy,
    planClaims,
    officeDelivery,
    emitEvent: emit,
    providerService,
    draftAssistService,
    agentProfileService,
    sessionBuiltinCapabilityService,
    customCommandService,
    projectNavigationService,
    sessionService,
    sessionRetentionService,
    extensionService,
    marketplaceService,
    localPluginMarketplaceService,
    browserService,
    githubService,
    mcpService,
    pluginHookService,
    imageStudioService,
    lspDiagnosticsService,
    projectConfigService,
    projectInstructionService,
    projectToolingService,
    snapshotService,
    worktreeService,
    dockerService,
    trajectoryService,
    headlessServerService: headlessService,
    scheduledTaskService,
    chatService: chatServiceInstance,
    queuedPromptService: queuedPromptServiceInstance,
    customToolService,
    approvalBroker,
    questionBroker,
    terminalService,
    workspaceService,
    workspaceSearchService,
    gitChangeService,
    localReviewService,
    dispose: async () => {
      await runAppServicesShutdown({
        steps: [
          { name: "terminals", run: () => terminalService.dispose() },
          { name: "draft-assist", run: () => draftAssistService.dispose() },
          { name: "image-studio", run: () => imageStudioService.dispose() },
          { name: "project-navigation", run: () => projectNavigationService.dispose() },
          { name: "queued-prompts", run: () => queuedPromptServiceInstance.dispose() },
          { name: "session-retention", run: () => sessionRetentionService.dispose() },
          { name: "schedules", run: () => scheduledTaskService.dispose() },
          { name: "server", run: () => headlessServerService?.stop() },
          { name: "chat", run: () => chatServiceInstance.shutdown() },
          { name: "office-evidence", run: () => officeDelivery.cleanupEvidenceCache() },
          { name: "browser", run: () => browserService.dispose() },
          { name: "mcp", run: () => mcpService.dispose() },
        ],
        stopWorkspaceIo: stopGuardedWorkspaceIo,
        cleanupPlugins: () => localPluginMarketplaceService.cleanupStaleVersions(),
        closeDatabase: () => database.close(),
        report: (scope, error) => recordRuntimeError(scope, error),
      });
    },
  };
}
