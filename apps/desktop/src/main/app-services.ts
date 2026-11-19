import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ChatStreamEvent } from "../shared/domain";
import { AgentProfileService } from "./agents/agent-profile-service";
import { CustomCommandService } from "./agents/custom-command-service";
import { LspDiagnosticsService } from "./agents/lsp-diagnostics-service";
import { ProjectConfigService } from "./agents/project-config-service";
import { ProjectInstructionService } from "./agents/project-instruction-service";
import { ProjectToolingService } from "./agents/project-tooling-service";
import { SessionBuiltinCapabilityService } from "./agents/session-builtin-capability-service";
import { BrowserService } from "./browser/browser-service";
import { GitHubService } from "./browser/github-service";
import { ChatService } from "./chat/chat-service";
import { QueuedPromptService } from "./chat/queued-prompt-service";
import { recordRuntimeError } from "./diagnostics/runtime-log";
import { ExtensionService } from "./extensions/extension-service";
import { PluginHookService } from "./extensions/plugin-hook-service";
import { LocalPluginMarketplaceService } from "./marketplace/local-plugin-marketplace-service";
import { SkillMarketplaceService } from "./marketplace/skill-marketplace-service";
import { McpService } from "./mcp/mcp-service";
import { ApprovalBroker } from "./permissions/approval-broker";
import { PermissionStore } from "./permissions/permission-store";
import { QuestionBroker } from "./permissions/question-broker";
import { ProviderService } from "./providers/provider-service";
import { ScheduledTaskService } from "./schedules/scheduled-task-service";
import { HeadlessServerService } from "./server/headless-server-service";
import { SessionRetentionService } from "./sessions/session-retention-service";
import { SessionService } from "./sessions/session-service";
import { openDatabase } from "./storage/database";
import { Repository } from "./storage/repository";
import { SecretStore } from "./storage/secret-store";
import { CustomToolService } from "./tools/custom-tool-service";
import { ToolRegistry } from "./tools/tool-registry";
import { TrajectoryService } from "./trajectories/trajectory-service";
import { DockerService } from "./workspace/docker-service";
import { GitChangeService } from "./workspace/git-change-service";
import { NativeSandboxService } from "./workspace/native-sandbox-service";
import { SnapshotService } from "./workspace/snapshot-service";
import { WorkspaceService } from "./workspace/workspace-service";
import { WorktreeService } from "./workspace/worktree-service";

export interface AppServices {
  database: DatabaseSync;
  repository: Repository;
  providerService: ProviderService;
  agentProfileService: AgentProfileService;
  sessionBuiltinCapabilityService: SessionBuiltinCapabilityService;
  customCommandService: CustomCommandService;
  sessionService: SessionService;
  sessionRetentionService: SessionRetentionService;
  extensionService: ExtensionService;
  marketplaceService: SkillMarketplaceService;
  localPluginMarketplaceService: LocalPluginMarketplaceService;
  browserService: BrowserService;
  githubService: GitHubService;
  mcpService: McpService;
  pluginHookService: PluginHookService;
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
  workspaceService: WorkspaceService;
  gitChangeService: GitChangeService;
  dispose(): Promise<void>;
}

export function createAppServices(input: {
  databasePath: string;
  promptDirectory: string;
  extensionDirectory: string;
  userDataDirectory: string;
  appVersion: string;
  emit: (event: ChatStreamEvent) => void;
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
  const agentProfileService = new AgentProfileService(repository);
  const customCommandService = new CustomCommandService(repository);
  let chatService: ChatService | null = null;
  const sessionBuiltinCapabilityService = new SessionBuiltinCapabilityService(
    repository,
    input.promptDirectory,
    (sessionId) => chatService?.isSessionBusy(sessionId) ?? false,
    (session) => chatService?.availableBuiltinPluginToolNames(session) ?? new Set(),
  );
  const sessionService = new SessionService(repository, sessionBuiltinCapabilityService);
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
  const worktreeService = new WorktreeService(join(input.userDataDirectory, "worktrees"));
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
  const gitChangeService = new GitChangeService(join(input.userDataDirectory, "git-undo"));
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
    agentProfileService,
    sessionBuiltinCapabilityService,
    customCommandService,
    sessionService,
    sessionRetentionService,
    extensionService,
    marketplaceService,
    localPluginMarketplaceService,
    browserService,
    githubService,
    mcpService,
    pluginHookService,
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
    workspaceService,
    gitChangeService,
    dispose: async () => {
      queuedPromptServiceInstance.dispose();
      await sessionRetentionService.dispose();
      const stopSchedules = scheduledTaskService.dispose();
      const stopServer = headlessServerService?.stop();
      const stopChat = chatServiceInstance.shutdown();
      browserService.dispose();
      mcpService.dispose();
      await Promise.all([stopSchedules, stopServer, stopChat]);
      try {
        const cleanup = await localPluginMarketplaceService.cleanupStaleVersions();
        if (cleanup.errors.length) recordRuntimeError("plugins.cleanup", cleanup.errors.join("\n"));
      } catch (cause) {
        recordRuntimeError("plugins.cleanup", cause);
      }
      database.close();
    },
  };
}
