import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ChatStreamEvent } from "../shared/domain";
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
import { recordRuntimeError } from "./diagnostics/runtime-log";
import { ExtensionService } from "./extensions/extension-service";
import { PluginHookService } from "./extensions/plugin-hook-service";
import { ImageStudioService } from "./image-studio/image-studio-service";
import { LocalPluginMarketplaceService } from "./marketplace/local-plugin-marketplace-service";
import { SkillMarketplaceService } from "./marketplace/skill-marketplace-service";
import { McpService } from "./mcp/mcp-service";
import { ApprovalBroker } from "./permissions/approval-broker";
import { PermissionStore } from "./permissions/permission-store";
import { QuestionBroker } from "./permissions/question-broker";
import { ProviderService } from "./providers/provider-service";
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

export function createAppServices(input: {
  databasePath: string;
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
  const trajectoryService = new TrajectoryService(repository);
  let headlessServerService: HeadlessServerService | null = null;
  let queuedPromptService: QueuedPromptService | null = null;
  const emit = (event: ChatStreamEvent): void => {
    if (event.type === "run_started") {
      const session = repository.getSession(event.sessionId);
      if (session && !session.parentSessionId)
        queuedPromptService?.runStarted(event.sessionId, event.runId, event.kind);
    }
    if (event.type === "session_updated") queuedPromptService?.sessionChanged(event.session.id);
    if (event.type === "session_removed") queuedPromptService?.forgetSession(event.sessionId);
    if (event.type === "run_failed")
      queuedPromptService?.runFailed(event.sessionId, event.runId, event.error);
    if (event.type === "run_failed")
      recordRuntimeError("chat.run", event.error, {
        sessionId: event.sessionId,
        runId: event.runId,
      });
    if (event.type === "activity" && event.activity.status === "failed")
      recordRuntimeError("agent.activity", event.activity.detail, {
        sessionId: event.activity.sessionId,
        runId: event.activity.runId,
        toolName: event.activity.toolName,
      });
    if (event.type === "assistant_message")
      for (const part of event.message.parts) {
        if (part.type === "tool_result" && part.isError)
          recordRuntimeError("tool.result", part.output, {
            sessionId: event.sessionId,
            runId: event.runId,
          });
        if (part.type === "error")
          recordRuntimeError("chat.message", part.message, {
            sessionId: event.sessionId,
            runId: event.runId,
          });
      }
    trajectoryService.record(event);
    headlessServerService?.recordEvent(event);
    input.emit(event);
  };
  const secretStore = new SecretStore(database);
  const providerService = new ProviderService(repository, secretStore);
  const draftAssistService = new DraftAssistService(repository, providerService);
  const agentProfileService = new AgentProfileService(repository);
  const customCommandService = new CustomCommandService(repository);
  let chatService: ChatService | null = null;
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
  const marketplaceService = new SkillMarketplaceService(
    join(input.userDataDirectory, "marketplace"),
    extensionService,
  );
  const localPluginMarketplaceService = new LocalPluginMarketplaceService(
    repository,
    extensionService,
    input.extensionDirectory,
  );
  const browserService = new BrowserService(
    join(input.userDataDirectory, "browser-captures"),
    emit,
    (sessionId) => repository.getSession(sessionId)?.workspacePath ?? null,
  );
  const githubService = new GitHubService(repository, secretStore);
  const mcpService = new McpService(repository, secretStore, input.appVersion);
  const pluginHookService = new PluginHookService(repository, mcpService);
  const imageStudioService = new ImageStudioService(
    repository,
    providerService,
    input.userDataDirectory,
  );
  const projectConfigService = new ProjectConfigService(input.userDataDirectory);
  const projectInstructionService = new ProjectInstructionService(
    input.userDataDirectory,
    projectConfigService,
  );
  const lspDiagnosticsService = new LspDiagnosticsService(
    join(dirname(input.promptDirectory), "lsp"),
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
      join(dirname(input.promptDirectory), "native", "codex-sandbox.exe"),
      join(input.userDataDirectory, "native-sandbox"),
    ),
  );
  const customToolService = new CustomToolService(repository);
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
    providerService,
    agentProfileService,
    sessionBuiltinCapabilityService,
    customCommandService,
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

  return {
    database,
    repository,
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
