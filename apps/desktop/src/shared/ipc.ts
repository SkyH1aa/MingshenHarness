import type { AutoDriveResult } from "./autodrive";
import type { ComposerDraft, SaveComposerDraftInput } from "./composer-draft";
import type { CoordinationStateView } from "./coordination";
import type {
  CompletionNotificationSettings,
  CompletionNotificationState,
  DependencyProgress,
  PolicyConsent,
  PolicyDocument,
  UpdateStatus,
} from "./desktop";
import type { CompanionPreferences, CompanionState } from "./desktop-companion";
import type {
  AgentProfileSaveInput,
  AgentProfileView,
  AgentRuntimeSettings,
  ApprovalDecision,
  ApprovalModelSettings,
  ApprovalState,
  BootstrapData,
  BrowserProvider,
  BrowserStatus,
  ChatRewriteInput,
  ChatSendInput,
  ChatStreamEvent,
  ConnectionTestResult,
  CustomCommandView,
  CustomToolView,
  DiagnosticsReport,
  DockerRuntimeSettings,
  ExtensionImportResult,
  ExtensionView,
  GitHubConnectionStatus,
  HeadlessServerStatus,
  MarketplaceInstallResult,
  MarketplaceSkill,
  McpOAuthStartResult,
  McpServerSaveInput,
  McpServerTestResult,
  McpServerView,
  ModelCreateInput,
  ModelDiscoveryResult,
  ModelReference,
  ModelUpdateInput,
  ProjectInstructionView,
  ProviderAddKeyInput,
  ProviderCreateInput,
  ProviderUpdateInput,
  ProviderUpdateKeyInput,
  ProviderView,
  QuestionAnswer,
  QuestionState,
  ScheduledTaskCreateInput,
  ScheduledTaskView,
  SessionBuiltinCapabilityView,
  SessionCreateInput,
  SessionMessage,
  SessionRetentionSettings,
  SessionRunState,
  SessionTodo,
  SessionUpdateInput,
  SessionView,
  ShareLinkResult,
  SnapshotRestoreResult,
  SnapshotView,
  ToolingServerStatus,
  TrajectoryView,
  UserCommandResult,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceGitStatus,
} from "./domain";
import type {
  DraftAssistSettings,
  DraftPolishInput,
  DraftPolishResult,
  ProjectToneInput,
  ProjectToneView,
} from "./draft-assist";
import type {
  ImageStudioAssetData,
  ImageStudioAssetRemovalResult,
  ImageStudioCanvasSummary,
  ImageStudioExportProgress,
  ImageStudioGenerateInput,
  ImageStudioGenerateResult,
  ImageStudioImportFile,
  ImageStudioPolishInput,
  ImageStudioRemoteImageInput,
  ImageStudioRemotePreview,
  ImageStudioReversePromptInput,
  ImageStudioServiceResult,
  ImageStudioWorkspace,
} from "./image-studio";
import type {
  LocalPluginDirectoryInspection,
  LocalPluginInstallResult,
  LocalPluginMarketSource,
  LocalPluginMarketView,
  LocalPluginUpdateCheckResult,
} from "./local-plugins";
import type {
  LocalReviewCommentsInput,
  LocalReviewCommentsResult,
  LocalReviewRequest,
  LocalReviewSnapshot,
} from "./local-review";
import type { EffectiveManagedPolicy, ManagedPolicyLayer } from "./managed-policy";
import type {
  ModelCatalogPreferences,
  MoveCatalogProviderInput,
  SetCatalogModelStarInput,
} from "./model-catalog";
import type { ModelRetrySettings } from "./model-retry";
import type { ModelWatchdogSettings } from "./model-watchdog";
import type { OfficeDeliveryReceipt, OfficeDeliverySettings } from "./office-delivery";
import type {
  ProjectMemoryConfiguration,
  ProjectMemoryConfigurationInput,
  ProjectMemoryEdit,
  ProjectMemorySelection,
  ProjectMemoryView,
} from "./project-memory";
import type {
  SessionProjectContexts,
  WorkspaceFileSearchInput,
  WorkspaceFileSearchResult,
} from "./project-navigation";
import type {
  QueuedPromptAddInput,
  QueuedPromptContinueResult,
  QueuedPromptReorderInput,
  QueuedPromptUpdateInput,
  QueuedPromptView,
} from "./queued-prompt";
import type {
  DesktopShortcutSettings,
  DesktopShortcutState,
  DesktopShortcutStatus,
  DesktopShortcutUpdateResult,
  QuickChatAction,
  QuickChatState,
} from "./quick-chat";
import type { RunSteeringInput, RunSteeringReceipt, RunSteeringState } from "./run-steering";
import type { RendererErrorReport, RuntimeLogStatus } from "./runtime-log";
import type { SessionBatchTarget } from "./session-catalog";
import type {
  InteractiveTerminalCreateInput,
  InteractiveTerminalEvent,
  InteractiveTerminalView,
} from "./terminal";
import type { TokenSaverSettings, TokenSaverSnapshot } from "./token-saver";
import type { UiPreferences } from "./ui-preferences";

export type CompanionSessionNavigationFailure =
  | "busy"
  | "unsaved_plan"
  | "unsaved_edits"
  | "unavailable"
  | "failed";

export type CompanionSessionNavigationResult = {
  requestId: string;
  accepted: false;
  reason: CompanionSessionNavigationFailure;
};

export const IPC_CHANNELS = {
  tokenSaverGet: "token-saver:get",
  tokenSaverSet: "token-saver:set",
  tokenSaverRecall: "token-saver:recall",
  editCommand: "composer:edit-command",
  projectMemoryGet: "memory:get",
  projectMemorySelection: "memory:selection",
  projectMemoryConfigurationGet: "memory:configuration-get",
  projectMemoryConfigurationSet: "memory:configuration-set",
  projectMemoryEdit: "memory:edit",
  projectMemoryCommand: "memory:command",
  projectMemoryEnabled: "memory:enabled",
  modelRetryGet: "models:retry-get",
  modelRetrySet: "models:retry-set",
  runtimeGovernanceGet: "runtime:governance-get",
  modelWatchdogSet: "models:watchdog-set",
  managedPolicyUserSet: "runtime:managed-policy-user-set",
  officeDeliverySettingsSet: "office:delivery-settings-set",
  officeDeliveriesList: "office:deliveries-list",
  officeDeliveryContinue: "office:delivery-continue",
  uiPreferencesGet: "ui:preferences-get",
  uiPreferencesSave: "ui:preferences-save",
  uiReloadInterface: "ui:reload-interface",
  runtimeLogStatus: "runtime-log:status",
  runtimeLogExport: "runtime-log:export",
  runtimeLogReport: "runtime-log:report",
  desktopState: "desktop:state",
  desktopAction: "desktop:action",
  desktopEvent: "desktop:event",
  companionSessionNavigationPreflight: "companion:session-navigation-preflight",
  companionSessionNavigationClaim: "companion:session-navigation-claim",
  companionSessionNavigationResult: "companion:session-navigation-result",
  desktopShortcutsGet: "desktop:shortcuts-get",
  desktopShortcutsSet: "desktop:shortcuts-set",
  desktopShortcutRecording: "desktop:shortcut-recording",
  startupAnimationGet: "desktop:startup-animation-get",
  startupAnimationSet: "desktop:startup-animation-set",
  quickChatState: "quick-chat:state",
  quickChatAction: "quick-chat:action",
  quickChatEvent: "quick-chat:event",
  quickChatTransition: "quick-chat:transition",
  quickChatTransitionAck: "quick-chat:transition-ack",
  completionState: "notifications:state",
  completionConfigure: "notifications:configure",
  completionActiveSession: "notifications:active-session",
  completionMarkAllRead: "notifications:mark-all-read",
  completionEvent: "notifications:event",
  completionDraftAck: "notifications:draft-ack",
  policyRead: "policy:read",
  policyAccept: "policy:accept",
  runtimeDependencies: "runtime:dependencies",
  runtimeInstall: "runtime:install",
  runtimeProgress: "runtime:progress",
  updateStatus: "updates:status",
  updateCheck: "updates:check",
  updateDownload: "updates:download",
  updateCancel: "updates:cancel",
  updateInstall: "updates:install",
  updateEvent: "updates:event",
  appInfo: "app:info",
  bootstrap: "app:bootstrap",
  workspaceChoose: "workspace:choose",
  modelCatalogGet: "model:catalog-get",
  modelCatalogProviderMove: "model:catalog-provider-move",
  modelCatalogStarSet: "model:catalog-star-set",
  providerCreate: "provider:create",
  providerUpdate: "provider:update",
  providerPromptCachingSet: "provider:prompt-caching-set",
  providerRemove: "provider:remove",
  providerAddKey: "provider:key-add",
  providerUpdateKey: "provider:key-update",
  providerRemoveKey: "provider:key-remove",
  providerSetActiveKey: "provider:key-set-active",
  providerFetchModels: "provider:models-fetch",
  providerTest: "provider:test",
  modelCreate: "model:create",
  modelUpdate: "model:update",
  modelRemove: "model:remove",
  imageStudioGet: "image-studio:get",
  imageStudioSave: "image-studio:save",
  imageStudioCanvasesList: "image-studio:canvases-list",
  imageStudioCanvasOpen: "image-studio:canvas-open",
  imageStudioCanvasClose: "image-studio:canvas-close",
  imageStudioCanvasRename: "image-studio:canvas-rename",
  imageStudioCanvasDuplicate: "image-studio:canvas-duplicate",
  imageStudioCanvasDelete: "image-studio:canvas-delete",
  imageStudioCanvasFolder: "image-studio:canvas-folder",
  imageStudioAssetData: "image-studio:asset-data",
  imageStudioImport: "image-studio:import",
  imageStudioRemoveAsset: "image-studio:remove-asset",
  imageStudioExportAsset: "image-studio:export-asset",
  imageStudioRemoveAssets: "image-studio:remove-assets",
  imageStudioExportAssets: "image-studio:export-assets",
  imageStudioExportProgress: "image-studio:export-progress",
  imageStudioGenerate: "image-studio:generate",
  imageStudioRemotePreview: "image-studio:remote-preview",
  imageStudioRemoteOpenExternal: "image-studio:remote-open-external",
  imageStudioRemoteSave: "image-studio:remote-save",
  imageStudioRemoteDiscard: "image-studio:remote-discard",
  imageStudioPolishPrompt: "image-studio:polish-prompt",
  imageStudioReversePrompt: "image-studio:reverse-prompt",
  imageStudioCancel: "image-studio:cancel",
  sessionCreate: "session:create",
  sessionCreateInWorkspace: "session:create-in-workspace",
  sessionCreateInChatGroup: "session:create-in-chat-group",
  sessionFork: "session:fork",
  sessionOpenWorkspace: "session:open-workspace",
  sessionUpdate: "session:update",
  sessionRemove: "session:remove",
  sessionMessages: "session:messages",
  sessionOpened: "session:opened",
  sessionRunState: "session:run-state",
  projectContexts: "project:contexts",
  sessionRetentionGet: "session:retention-get",
  sessionRetentionSet: "session:retention-set",
  chatSend: "chat:send",
  runSteeringGet: "chat:steering-get",
  runSteeringSend: "chat:steering-send",
  autoDriveSuggest: "chat:autodrive-suggest",
  autoDriveCancel: "chat:autodrive-cancel",
  agentCoordinationGet: "chat:coordination-get",
  composerDraftGet: "composer:draft-get",
  composerDraftSave: "composer:draft-save",
  composerDraftClear: "composer:draft-clear",
  composerDraftChanged: "composer:draft-changed",
  composerDraftFlushRequest: "composer:draft-flush-request",
  composerDraftFlushAck: "composer:draft-flush-ack",
  draftAssistSettingsGet: "draft-assist:settings-get",
  draftAssistSettingsSet: "draft-assist:settings-set",
  draftAssistPolish: "draft-assist:polish",
  draftAssistCancel: "draft-assist:cancel",
  projectToneGet: "draft-assist:project-tone-get",
  projectToneSet: "draft-assist:project-tone-set",
  chatRewrite: "chat:rewrite",
  chatStop: "chat:stop",
  queuedPromptList: "chat:queue-list",
  queuedPromptAdd: "chat:queue-add",
  queuedPromptUpdate: "chat:queue-update",
  queuedPromptReorder: "chat:queue-reorder",
  queuedPromptRemove: "chat:queue-remove",
  queuedPromptContinue: "chat:queue-continue",
  queuedPromptBeginEdit: "chat:queue-begin-edit",
  queuedPromptEndEdit: "chat:queue-end-edit",
  chatCompact: "chat:compact",
  approvalDecide: "approval:decide",
  approvalState: "approval:state",
  approvalModelGet: "approval:model-get",
  approvalModelSet: "approval:model-set",
  approvalAutomatic: "approval:automatic",
  compactionModelGet: "context:model-get",
  compactionModelSet: "context:model-set",
  compactionFallbackGet: "context:fallback-get",
  compactionFallbackSet: "context:fallback-set",
  contextUsage: "context:usage",
  questionAnswer: "question:answer",
  questionState: "question:state",
  runtimeEvent: "runtime:event",
  workspaceList: "workspace:list",
  workspaceSearchFiles: "workspace:search-files",
  workspaceRead: "workspace:read",
  workspaceReadAbsolute: "workspace:read-absolute",
  workspaceWrite: "workspace:write",
  workspaceWriteAbsolute: "workspace:write-absolute",
  workspaceGitStatus: "workspace:git-status",
  gitChanges: "git:changes",
  gitLatestBackup: "git:latest-backup",
  gitDiscard: "git:discard",
  gitRestoreUndo: "git:restore-undo",
  workspaceRunCommand: "workspace:run-command",
  localReviewGet: "local-review:get",
  localReviewSubmit: "local-review:submit",
  terminalList: "terminal:list",
  terminalCreate: "terminal:create",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalStop: "terminal:stop",
  terminalEvent: "terminal:event",
  extensionsList: "extensions:list",
  extensionsChooseDirectory: "extensions:choose-directory",
  extensionsImport: "extensions:import",
  extensionsSetEnabled: "extensions:set-enabled",
  extensionsRemove: "extensions:remove",
  sessionExtensionsList: "session-extensions:list",
  sessionExtensionsSet: "session-extensions:set",
  sessionBuiltinCapabilitiesList: "session-builtin-capabilities:list",
  sessionBuiltinCapabilitySet: "session-builtin-capability:set",
  scheduledTasksList: "scheduled-tasks:list",
  scheduledTasksCreate: "scheduled-tasks:create",
  scheduledTasksSetEnabled: "scheduled-tasks:set-enabled",
  scheduledTasksRemove: "scheduled-tasks:remove",
  scheduledTasksRunNow: "scheduled-tasks:run-now",
  marketplaceList: "marketplace:list",
  marketplaceInstall: "marketplace:install",
  localPluginValidate: "local-plugins:validate",
  localPluginMarketsList: "local-plugins:markets-list",
  localPluginUpdatesCheck: "local-plugins:updates-check",
  localPluginMarketAdd: "local-plugins:market-add",
  localPluginMarketGet: "local-plugins:market-get",
  localPluginMarketRefresh: "local-plugins:market-refresh",
  localPluginMarketRemove: "local-plugins:market-remove",
  localPluginInstall: "local-plugins:install",
  localPluginUpdate: "local-plugins:update",
  mcpList: "mcp:list",
  mcpSave: "mcp:save",
  mcpRemove: "mcp:remove",
  mcpSetEnabled: "mcp:set-enabled",
  mcpTest: "mcp:test",
  mcpOAuthStart: "mcp:oauth-start",
  agentProfilesList: "agents:profiles-list",
  agentProfileSave: "agents:profile-save",
  agentProfileRemove: "agents:profile-remove",
  projectInstructions: "agents:project-instructions",
  projectTrustGet: "workspace:trust-get",
  projectTrustSet: "workspace:trust-set",
  diagnosticsRun: "workspace:diagnostics-run",
  snapshotsList: "workspace:snapshots-list",
  snapshotRestore: "workspace:snapshot-restore",
  trajectoriesList: "trajectories:list",
  trajectoryExport: "trajectories:export",
  customCommandsList: "commands:list",
  sessionTodos: "session-todos:list",
  workbenchGet: "workbench:get",
  subagentOutput: "workbench:subagent-output",
  workbenchPlanUpdate: "workbench:plan-update",
  workbenchResume: "workbench:resume",
  projectPlansList: "workbench:plans-list",
  projectPlanSave: "workbench:plan-save",
  projectPlanApply: "workbench:plan-apply",
  projectPlanRemove: "workbench:plan-remove",
  sessionPage: "session:page",
  sessionDelta: "session:delta",
  sessionGet: "session:get",
  sessionGroups: "session:groups",
  chatGroupsList: "chat-groups:list",
  chatGroupCreate: "chat-groups:create",
  chatGroupRename: "chat-groups:rename",
  chatGroupRemove: "chat-groups:remove",
  toolingStatus: "tooling:status",
  customToolsList: "tools:custom-list",
  agentRuntimeSettingsGet: "agents:runtime-settings-get",
  agentRuntimeSettingsSet: "agents:runtime-settings-set",
  dockerSettingsGet: "docker:settings-get",
  dockerSettingsSet: "docker:settings-set",
  headlessServerStatus: "server:status",
  headlessServerStart: "server:start",
  headlessServerStop: "server:stop",
  sessionShare: "session:share",
  sessionExport: "session:export",
  pluginHooksGet: "extensions:plugin-hooks-get",
  pluginHooksSet: "extensions:plugin-hooks-set",
  browserOpen: "browser:open",
  browserRegisterWebContents: "browser:register-web-contents",
  browserStatus: "browser:status",
  browserClose: "browser:close",
  openExternalUrl: "system:open-external-url",
  openLocalPath: "system:open-local-path",
  githubConnectionStatus: "github:connection-status",
  githubSetToken: "github:set-token",
  githubDeviceStart: "github:device-start",
  githubDevicePending: "github:device-pending",
  githubDevicePoll: "github:device-poll",
  githubDeviceCancel: "github:device-cancel",
  githubDisconnect: "github:disconnect",
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: "win32" | "darwin" | "linux";
  isPackaged: boolean;
}

export type ComposerDraftFlushPurpose = "save" | "shutdown" | "interface-reload";

export interface MingshenDesktopApi {
  getTokenSaver(sessionId?: string | null): Promise<TokenSaverSnapshot>;
  setTokenSaver(settings: TokenSaverSettings): Promise<TokenSaverSettings>;
  recallContext(
    sessionId: string,
    messageId: string,
    partIndex: number,
    startLine?: number,
    charOffset?: number,
  ): Promise<string>;
  getProjectMemory(sessionId: string): Promise<ProjectMemoryView>;
  getProjectMemorySelection(workspacePath: string | null): Promise<ProjectMemorySelection>;
  getProjectMemoryConfiguration(workspacePath: string): Promise<ProjectMemoryConfiguration>;
  setProjectMemoryConfiguration(
    input: ProjectMemoryConfigurationInput,
  ): Promise<ProjectMemoryConfiguration>;
  editProjectMemory(input: ProjectMemoryEdit): Promise<void>;
  projectMemoryCommand(sessionId: string, command: string): Promise<string>;
  setProjectMemoryEnabled(sessionId: string, enabled: boolean): Promise<void>;
  editCommand(command: "copy" | "cut" | "paste" | "selectAll"): Promise<void>;
  getModelRetrySettings(): Promise<ModelRetrySettings>;
  setModelRetrySettings(settings: ModelRetrySettings): Promise<ModelRetrySettings>;
  getRuntimeGovernance(): Promise<{
    watchdog: ModelWatchdogSettings;
    managedPolicy: {
      effective: EffectiveManagedPolicy;
      user: ManagedPolicyLayer | null;
    };
    office: OfficeDeliverySettings;
  }>;
  setModelWatchdogSettings(settings: ModelWatchdogSettings): Promise<ModelWatchdogSettings>;
  saveManagedUserPolicy(layer: ManagedPolicyLayer | null): Promise<void>;
  setOfficeDeliverySettings(settings: OfficeDeliverySettings): Promise<OfficeDeliverySettings>;
  listOfficeDeliveries(sessionId: string): Promise<OfficeDeliveryReceipt[]>;
  continueOfficeDelivery(input: {
    sessionId: string;
    deliveryId: string;
    startPage?: number;
  }): Promise<OfficeDeliveryReceipt>;
  getUiPreferences(): Promise<UiPreferences>;
  saveUiPreferences(preferences: UiPreferences): Promise<void>;
  reloadInterface(): Promise<void>;
  getRuntimeLogStatus(): Promise<RuntimeLogStatus>;
  exportRuntimeLogs(): Promise<string | null>;
  reportRuntimeError(report: RendererErrorReport): Promise<void>;
  getCompletionNotifications(): Promise<CompletionNotificationState>;
  acknowledgeNotificationDraft(id: string): Promise<void>;
  configureCompletionNotifications(
    settings: CompletionNotificationSettings,
  ): Promise<CompletionNotificationState>;
  setActiveNotificationSession(sessionId: string | null): Promise<void>;
  markAllCompletionNotificationsRead(): Promise<CompletionNotificationState>;
  onCompletionNotifications(listener: (state: CompletionNotificationState) => void): () => void;
  getRuntimeDependencies(): Promise<{
    native: boolean;
    nativeDetail: string;
    wsl: boolean;
    wslDetail: string;
    docker: boolean;
    dockerDetail: string;
    browserdo: boolean;
    browserDetail: string;
  }>;
  installRuntimeDependency(name: "docker" | "embiody" | "wsl"): Promise<string>;
  onDependencyProgress(listener: (progress: DependencyProgress) => void): () => void;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  cancelUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
  onUpdateEvent(listener: (event: { status: UpdateStatus; notify: boolean }) => void): () => void;
  getDesktopState(): Promise<{
    accepted: boolean;
    manualPending: boolean;
    policyVersion: string;
    locale: "zh-CN" | "en";
    closeAction: "ask" | "tray" | "quit";
    githubClientId: string;
    maximized: boolean;
    shortcuts?: DesktopShortcutStatus;
    shortcutBindings?: DesktopShortcutSettings;
  }>;
  getDesktopShortcutSettings(): Promise<DesktopShortcutState>;
  setDesktopShortcutSettings(
    settings: DesktopShortcutSettings,
  ): Promise<DesktopShortcutUpdateResult>;
  setDesktopShortcutRecording(recording: boolean): Promise<void>;
  getStartupAnimationEnabled(): Promise<boolean>;
  setStartupAnimationEnabled(enabled: boolean): Promise<boolean>;
  getCompanionState(): Promise<CompanionState>;
  getCompanionPreferences(): Promise<CompanionPreferences>;
  setCompanionPreferences(patch: Partial<CompanionPreferences>): Promise<CompanionPreferences>;
  showCompanion(): Promise<void>;
  hideCompanion(): Promise<void>;
  onCompanionState(listener: (state: CompanionState) => void): () => void;
  preflightCompanionSessionNavigation(requestId: string, sessionId: string): boolean;
  claimCompanionSessionNavigation(requestId: string, sessionId: string): boolean;
  reportCompanionSessionNavigation(result: CompanionSessionNavigationResult): Promise<void>;
  getQuickChatState(): Promise<QuickChatState>;
  quickChatAction(action: QuickChatAction): Promise<QuickChatState | null>;
  onQuickChatState(listener: (state: QuickChatState) => void): () => void;
  onQuickChatTransition(listener: (requestId: string, locked: boolean) => void): () => void;
  acknowledgeQuickChatTransition(requestId: string, error?: string): void;
  desktopAction(
    action:
      | "minimize"
      | "show"
      | "maximize"
      | "close"
      | "tray"
      | "quit"
      | "cancel-close"
      | "locale"
      | "close-preference"
      | "manual"
      | "finish-onboarding",
    value?: string,
    remember?: boolean,
  ): Promise<void>;
  onDesktopEvent(
    listener: (event: {
      type:
        | "close-request"
        | "select-session"
        | "window-state"
        | "shortcuts-changed"
        | "open-manual"
        | "open-provider-settings"
        | "open-desktop-settings"
        | "composer-draft-error"
        | "notification-reply-failed";
      sessionId?: string;
      requestId?: string;
      maximized?: boolean;
      tasks?: number;
      runningConversations?: number;
      text?: string;
      error?: string;
      draftId?: string;
    }) => void,
  ): () => void;
  readPolicy(document: PolicyDocument, locale?: "en" | "zh-CN"): Promise<string>;
  acceptPolicies(consent: PolicyConsent): Promise<void>;
  getAppInfo(): Promise<AppInfo>;
  bootstrap(options?: { paged?: boolean; selectedId?: string | null }): Promise<BootstrapData>;
  listSessionPage(
    input: import("./session-catalog").SessionPageInput,
  ): Promise<import("./session-catalog").SessionPage>;
  getSessionDelta(
    after: number,
    ids: string[],
  ): Promise<import("./session-catalog").SessionCatalogDelta>;
  getSession(sessionId: string): Promise<SessionView | null>;
  getProjectContexts(sessionIds: string[]): Promise<SessionProjectContexts>;
  searchWorkspaceFiles(input: WorkspaceFileSearchInput): Promise<WorkspaceFileSearchResult>;
  listSessionGroups(): Promise<import("./session-catalog").SessionWorkspaceGroup[]>;
  listChatGroups(): Promise<import("./domain").ChatGroupView[]>;
  createChatGroup(name: string): Promise<import("./domain").ChatGroupView>;
  renameChatGroup(id: string, name: string): Promise<import("./domain").ChatGroupView>;
  removeChatGroup(id: string): Promise<void>;
  chooseWorkspace(): Promise<string | null>;
  getModelCatalogPreferences(): Promise<ModelCatalogPreferences>;
  moveCatalogProvider(input: MoveCatalogProviderInput): Promise<ModelCatalogPreferences>;
  setCatalogModelStar(input: SetCatalogModelStarInput): Promise<ModelCatalogPreferences>;
  createProvider(input: ProviderCreateInput): Promise<ProviderView>;
  updateProvider(input: ProviderUpdateInput): Promise<ProviderView>;
  setProviderPromptCaching(
    providerId: string,
    settings: import("./prompt-caching").PromptCachingSettings,
  ): Promise<ProviderView>;
  removeProvider(providerId: string): Promise<void>;
  addProviderKey(input: ProviderAddKeyInput): Promise<ProviderView>;
  updateProviderKey(input: ProviderUpdateKeyInput): Promise<ProviderView>;
  removeProviderKey(providerId: string, keyId: string): Promise<ProviderView>;
  setActiveProviderKey(providerId: string, keyId: string): Promise<ProviderView>;
  fetchProviderModels(providerId: string): Promise<ModelDiscoveryResult>;
  testProvider(providerId: string, modelConfigId: string): Promise<ConnectionTestResult>;
  createModel(input: ModelCreateInput): Promise<ProviderView>;
  updateModel(input: ModelUpdateInput): Promise<ProviderView>;
  removeModel(modelConfigId: string): Promise<ProviderView>;
  getImageStudioWorkspace(): Promise<ImageStudioWorkspace>;
  saveImageStudioWorkspace(workspace: ImageStudioWorkspace): Promise<ImageStudioWorkspace>;
  listImageStudioCanvases(): Promise<ImageStudioCanvasSummary[]>;
  openImageStudioCanvas(canvasId: string): Promise<ImageStudioWorkspace>;
  closeImageStudioCanvas(canvasId: string): Promise<ImageStudioWorkspace>;
  renameImageStudioCanvas(canvasId: string, name: string): Promise<ImageStudioWorkspace>;
  duplicateImageStudioCanvas(canvasId: string): Promise<ImageStudioWorkspace>;
  deleteImageStudioCanvas(canvasId: string): Promise<ImageStudioWorkspace>;
  revealImageStudioCanvasFolder(): Promise<void>;
  getImageStudioAssetData(assetId: string): Promise<ImageStudioAssetData>;
  importImageStudioAssets(files: ImageStudioImportFile[]): Promise<ImageStudioWorkspace>;
  removeImageStudioAsset(assetId: string): Promise<ImageStudioWorkspace>;
  exportImageStudioAsset(assetId: string): Promise<string | null>;
  removeImageStudioAssets(assetIds: string[]): Promise<ImageStudioAssetRemovalResult>;
  exportImageStudioAssets(assetIds: string[], requestId: string): Promise<string | null>;
  onImageStudioExportProgress(listener: (progress: ImageStudioExportProgress) => void): () => void;
  generateImageStudioImage(input: ImageStudioGenerateInput): Promise<ImageStudioGenerateResult>;
  previewImageStudioRemoteImage(
    input: ImageStudioRemoteImageInput,
  ): Promise<ImageStudioRemotePreview>;
  openImageStudioRemoteImage(input: ImageStudioRemoteImageInput): Promise<void>;
  saveImageStudioRemoteImage(
    input: ImageStudioRemoteImageInput,
  ): Promise<ImageStudioGenerateResult>;
  discardImageStudioRemoteImages(ids: string[]): Promise<void>;
  polishImageStudioPrompt(input: ImageStudioPolishInput): Promise<ImageStudioServiceResult>;
  reverseImageStudioPrompt(input: ImageStudioReversePromptInput): Promise<ImageStudioServiceResult>;
  cancelImageStudioRequest(requestId: string): Promise<void>;
  createSession(input: SessionCreateInput): Promise<SessionView>;
  createSessionInWorkspace(
    workspacePath: string | null,
    agentMode?: "code" | "work",
  ): Promise<SessionView>;
  createChatSessionInGroup(groupId: string | null): Promise<SessionView>;
  forkSession(sessionId: string, messageId?: string): Promise<SessionView>;
  openSessionWorkspace(sessionId: string): Promise<void>;
  updateSession(input: SessionUpdateInput, expected?: SessionBatchTarget[]): Promise<SessionView>;
  removeSession(sessionId: string, expected?: SessionBatchTarget[]): Promise<void>;
  getSessionMessages(sessionId: string): Promise<SessionMessage[]>;
  markSessionOpened(sessionId: string | null): Promise<void>;
  getSessionRunState(sessionId: string): Promise<SessionRunState | null>;
  getSessionRetention(): Promise<SessionRetentionSettings>;
  setSessionRetention(settings: SessionRetentionSettings): Promise<SessionRetentionSettings>;
  sendChat(input: ChatSendInput): Promise<{ runId: string }>;
  getRunSteering(sessionId: string): Promise<RunSteeringState | null>;
  steerRun(input: RunSteeringInput): Promise<RunSteeringReceipt>;
  getAutoDriveSuggestions(sessionId: string): Promise<AutoDriveResult>;
  cancelAutoDrive(sessionId: string): Promise<void>;
  getAgentCoordination(sessionId: string): Promise<CoordinationStateView | null>;
  getComposerDraft(sessionId: string): Promise<ComposerDraft | null>;
  saveComposerDraft(input: SaveComposerDraftInput): Promise<void>;
  clearComposerDraft(sessionId: string, revision: string): Promise<boolean>;
  onComposerDraftFlush(
    listener: (requestId: string, purpose: ComposerDraftFlushPurpose, sessionId?: string) => void,
  ): () => void;
  acknowledgeComposerDraftFlush(requestId: string, error?: string): void;
  getDraftAssistSettings(): Promise<DraftAssistSettings>;
  setDraftAssistSettings(settings: DraftAssistSettings): Promise<DraftAssistSettings>;
  polishDraft(input: DraftPolishInput): Promise<DraftPolishResult>;
  cancelDraftPolish(requestId: string): Promise<void>;
  getProjectTone(sessionId: string): Promise<ProjectToneView>;
  setProjectTone(input: ProjectToneInput): Promise<ProjectToneView>;
  onComposerDraftChanged(
    listener: (change: { sessionId: string; revision: string | null }) => void,
  ): () => void;
  rewriteAndSendChat(input: ChatRewriteInput): Promise<{ runId: string }>;
  stopChat(sessionId: string, runId?: string): Promise<void>;
  listQueuedPrompts(sessionId: string): Promise<QueuedPromptView[]>;
  addQueuedPrompt(input: QueuedPromptAddInput): Promise<QueuedPromptView>;
  updateQueuedPrompt(input: QueuedPromptUpdateInput): Promise<QueuedPromptView>;
  reorderQueuedPrompts(input: QueuedPromptReorderInput): Promise<QueuedPromptView[]>;
  removeQueuedPrompt(sessionId: string, itemId: string): Promise<void>;
  continueQueuedPrompt(sessionId: string, itemId: string): Promise<QueuedPromptContinueResult>;
  beginQueuedPromptEdit(sessionId: string, itemId: string): Promise<string>;
  endQueuedPromptEdit(sessionId: string, editId: string, abandon?: boolean): Promise<void>;
  compactChat(sessionId: string): Promise<{ runId: string }>;
  decideApproval(input: ApprovalDecision): Promise<void>;
  getApprovalState(): Promise<ApprovalState>;
  getQuestionState(): Promise<QuestionState>;
  getApprovalModelSettings(): Promise<ApprovalModelSettings>;
  setApprovalModelSettings(settings: ApprovalModelSettings): Promise<ApprovalModelSettings>;
  startAutomaticApproval(sessionId: string): Promise<SessionView>;
  getGlobalCompactionModel(): Promise<ModelReference | null>;
  setGlobalCompactionModel(model: ModelReference | null): Promise<ModelReference | null>;
  getCompactionFallbackModel(): Promise<ModelReference | null>;
  setCompactionFallbackModel(model: ModelReference | null): Promise<ModelReference | null>;
  getContextUsage(sessionId: string): Promise<import("./domain").ContextUsageView | null>;
  answerQuestion(input: QuestionAnswer): Promise<void>;
  onRuntimeEvent(listener: (event: ChatStreamEvent) => void): () => void;
  listWorkspace(root: string, relativePath: string): Promise<WorkspaceEntry[]>;
  readWorkspaceFile(root: string, relativePath: string): Promise<WorkspaceFile>;
  readAbsoluteFile(path: string): Promise<WorkspaceFile>;
  writeWorkspaceFile(root: string, relativePath: string, content: string): Promise<void>;
  writeAbsoluteFile(path: string, content: string): Promise<void>;
  getGitStatus(root: string): Promise<WorkspaceGitStatus>;
  getGitChanges(root: string): Promise<{ root: string; paths: string[] }>;
  getLatestGitBackup(root: string): Promise<string | null>;
  discardGitChanges(root: string, paths?: string[]): Promise<{ backupId: string; paths: string[] }>;
  restoreGitUndo(root: string, backupId: string): Promise<void>;
  runUserCommand(root: string, command: string): Promise<UserCommandResult>;
  getLocalReview(input: LocalReviewRequest): Promise<LocalReviewSnapshot>;
  submitLocalReviewComments(input: LocalReviewCommentsInput): Promise<LocalReviewCommentsResult>;
  listTerminals(sessionId: string): Promise<InteractiveTerminalView[]>;
  createTerminal(input: InteractiveTerminalCreateInput): Promise<InteractiveTerminalView>;
  writeTerminal(terminalId: string, data: string): Promise<void>;
  resizeTerminal(terminalId: string, cols: number, rows: number): Promise<InteractiveTerminalView>;
  stopTerminal(terminalId: string): Promise<void>;
  onTerminalEvent(listener: (event: InteractiveTerminalEvent) => void): () => void;
  listExtensions(): Promise<ExtensionView[]>;
  chooseExtensionDirectory(): Promise<string | null>;
  importExtensions(sourceDirectory: string): Promise<ExtensionImportResult>;
  setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void>;
  removeExtension(extensionId: string): Promise<void>;
  listSessionExtensions(sessionId: string): Promise<string[]>;
  setSessionExtension(sessionId: string, extensionId: string, enabled: boolean): Promise<void>;
  listSessionBuiltinCapabilities(sessionId: string): Promise<SessionBuiltinCapabilityView[]>;
  setSessionBuiltinCapability(
    sessionId: string,
    capabilityId: string,
    selected: boolean,
  ): Promise<void>;
  listScheduledTasks(): Promise<ScheduledTaskView[]>;
  createScheduledTask(input: ScheduledTaskCreateInput): Promise<ScheduledTaskView>;
  setScheduledTaskEnabled(taskId: string, enabled: boolean): Promise<ScheduledTaskView>;
  removeScheduledTask(taskId: string): Promise<void>;
  runScheduledTaskNow(taskId: string): Promise<void>;
  listMarketplaceSkills(
    source: MarketplaceSkill["source"],
    forceRefresh?: boolean,
  ): Promise<MarketplaceSkill[]>;
  installMarketplaceSkill(
    source: MarketplaceSkill["source"],
    path: string,
  ): Promise<MarketplaceInstallResult>;
  validateLocalPlugin(rootPath: string): Promise<LocalPluginDirectoryInspection>;
  listLocalPluginMarkets(): Promise<LocalPluginMarketSource[]>;
  checkLocalPluginUpdates(): Promise<LocalPluginUpdateCheckResult>;
  addLocalPluginMarket(path: string): Promise<LocalPluginMarketView>;
  getLocalPluginMarket(id: string): Promise<LocalPluginMarketView>;
  refreshLocalPluginMarket(id: string): Promise<LocalPluginMarketView>;
  removeLocalPluginMarket(id: string): Promise<void>;
  installLocalPlugin(marketId: string, pluginName: string): Promise<LocalPluginInstallResult>;
  updateLocalPlugin(marketId: string, pluginName: string): Promise<LocalPluginInstallResult>;
  listMcpServers(): Promise<McpServerView[]>;
  saveMcpServer(input: McpServerSaveInput): Promise<McpServerView>;
  removeMcpServer(id: string): Promise<void>;
  setMcpServerEnabled(id: string, enabled: boolean): Promise<McpServerView>;
  testMcpServer(id: string): Promise<McpServerTestResult>;
  startMcpOAuth(id: string): Promise<McpOAuthStartResult>;
  listAgentProfiles(): Promise<AgentProfileView[]>;
  saveAgentProfile(input: AgentProfileSaveInput): Promise<AgentProfileView>;
  removeAgentProfile(id: string): Promise<void>;
  discoverProjectInstructions(workspacePath: string): Promise<ProjectInstructionView[]>;
  getProjectTrust(workspacePath: string): Promise<boolean>;
  setProjectTrust(workspacePath: string, trusted: boolean): Promise<void>;
  runDiagnostics(workspacePath: string, changedPaths: string[]): Promise<DiagnosticsReport>;
  listSnapshots(sessionId: string): Promise<SnapshotView[]>;
  restoreSnapshot(snapshotId: string, workspacePath: string): Promise<SnapshotRestoreResult>;
  listTrajectories(sessionId: string, runId?: string): Promise<TrajectoryView[]>;
  exportTrajectory(
    sessionId: string,
    runId: string,
    format: "json" | "markdown",
  ): Promise<string | null>;
  listCustomCommands(workspacePath: string | null): Promise<CustomCommandView[]>;
  listSessionTodos(sessionId: string): Promise<SessionTodo[]>;
  getWorkbench(sessionId: string): Promise<import("./workbench").WorkbenchState>;
  getSubagentOutput(
    parentId: string,
    sessionId: string,
  ): Promise<import("./workbench").SubagentOutputPreview>;
  updatePlan(
    input: import("./workbench").PlanUpdateInput,
  ): Promise<import("./workbench").SessionPlan>;
  resumeTask(sessionId: string): Promise<{ runId: string }>;
  listProjectPlans(workspacePath: string | null): Promise<import("./workbench").SavedProjectPlan[]>;
  saveProjectPlan(
    sessionId: string,
    name: string,
    id?: string,
  ): Promise<import("./workbench").SavedProjectPlan>;
  applyProjectPlan(
    sessionId: string,
    planId: string,
    revision: number,
    resetCompleted?: boolean,
  ): Promise<import("./workbench").SessionPlan>;
  removeProjectPlan(id: string): Promise<void>;
  getToolingStatus(workspacePath: string): Promise<ToolingServerStatus[]>;
  listCustomTools(workspacePath: string | null): Promise<CustomToolView[]>;
  getAgentRuntimeSettings(): Promise<AgentRuntimeSettings>;
  setAgentRuntimeSettings(settings: AgentRuntimeSettings): Promise<AgentRuntimeSettings>;
  getDockerSettings(): Promise<DockerRuntimeSettings>;
  setDockerSettings(settings: DockerRuntimeSettings): Promise<void>;
  getHeadlessServerStatus(): Promise<HeadlessServerStatus>;
  startHeadlessServer(host?: string, port?: number): Promise<HeadlessServerStatus>;
  stopHeadlessServer(): Promise<void>;
  createSessionShare(sessionId: string): Promise<ShareLinkResult>;
  exportSession(sessionId: string, format: "json" | "markdown"): Promise<string | null>;
  getPluginShellHooksEnabled(): Promise<boolean>;
  setPluginShellHooksEnabled(enabled: boolean): Promise<void>;
  openBrowser(sessionId: string, provider: BrowserProvider, url?: string): Promise<BrowserStatus>;
  registerBrowserWebContents(
    sessionId: string,
    provider: BrowserProvider,
    webContentsId: number,
  ): Promise<BrowserStatus>;
  getBrowserStatus(sessionId: string): Promise<BrowserStatus>;
  closeBrowser(sessionId: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  openLocalPath(path: string, workspacePath?: string | null): Promise<void>;
  getGitHubStatus(): Promise<GitHubConnectionStatus>;
  startGitHubAuthorization(
    clientId: string,
  ): Promise<{ userCode: string; verificationUrl: string; expiresAt: number }>;
  getGitHubAuthorization(): Promise<{
    userCode: string;
    verificationUrl: string;
    expiresAt: number;
  } | null>;
  pollGitHubAuthorization(): Promise<{
    status: "pending" | "connected";
    connection?: GitHubConnectionStatus;
  }>;
  cancelGitHubAuthorization(): Promise<void>;
  setGitHubToken(token: string): Promise<GitHubConnectionStatus>;
  disconnectGitHub(): Promise<void>;
}
