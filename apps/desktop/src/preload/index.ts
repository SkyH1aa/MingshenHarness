import { contextBridge, ipcRenderer } from "electron";
import type { ChatStreamEvent } from "../shared/domain";
import type { ComposerDraftFlushPurpose, MingshenDesktopApi } from "../shared/ipc";
import { IPC_CHANNELS } from "../shared/ipc";

const composerDraftFlushListeners = new Set<
  (requestId: string, purpose: ComposerDraftFlushPurpose) => void
>();
ipcRenderer.on(
  IPC_CHANNELS.composerDraftFlushRequest,
  (_event, requestId: unknown, purpose: unknown) => {
    if (typeof requestId !== "string") return;
    const flushPurpose =
      purpose === "interface-reload" || purpose === "save" ? purpose : "shutdown";
    // Before the renderer starts there can be no unsaved in-memory input.
    if (!composerDraftFlushListeners.size)
      ipcRenderer.send(IPC_CHANNELS.composerDraftFlushAck, requestId);
    else for (const listener of composerDraftFlushListeners) listener(requestId, flushPurpose);
  },
);

const api: MingshenDesktopApi = {
  getProjectMemory: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.projectMemoryGet, sessionId),
  getProjectMemorySelection: (workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectMemorySelection, workspacePath),
  getProjectMemoryConfiguration: (workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectMemoryConfigurationGet, workspacePath),
  setProjectMemoryConfiguration: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectMemoryConfigurationSet, input),
  editProjectMemory: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectMemoryEdit, input),
  projectMemoryCommand: (sessionId, command) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectMemoryCommand, sessionId, command),
  setProjectMemoryEnabled: (sessionId, enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectMemoryEnabled, sessionId, enabled),
  editCommand: (command) => ipcRenderer.invoke(IPC_CHANNELS.editCommand, command),
  getUiPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.uiPreferencesGet),
  saveUiPreferences: (preferences) =>
    ipcRenderer.invoke(IPC_CHANNELS.uiPreferencesSave, preferences),
  reloadInterface: () => ipcRenderer.invoke(IPC_CHANNELS.uiReloadInterface),
  getRuntimeLogStatus: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeLogStatus),
  exportRuntimeLogs: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeLogExport),
  reportRuntimeError: (report) => ipcRenderer.invoke(IPC_CHANNELS.runtimeLogReport, report),
  getCompletionNotifications: () => ipcRenderer.invoke(IPC_CHANNELS.completionState),
  acknowledgeNotificationDraft: (id) => ipcRenderer.invoke(IPC_CHANNELS.completionDraftAck, id),
  configureCompletionNotifications: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.completionConfigure, settings),
  setActiveNotificationSession: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.completionActiveSession, sessionId),
  onCompletionNotifications: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
      listener(state);
    ipcRenderer.on(IPC_CHANNELS.completionEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.completionEvent, handler);
  },
  getRuntimeDependencies: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeDependencies),
  installRuntimeDependency: (name) => ipcRenderer.invoke(IPC_CHANNELS.runtimeInstall, name),
  getUpdateStatus: () => ipcRenderer.invoke(IPC_CHANNELS.updateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.updateCheck),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateDownload),
  cancelUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateCancel),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.updateInstall),
  onUpdateEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value);
    ipcRenderer.on(IPC_CHANNELS.updateEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateEvent, handler);
  },
  onDependencyProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value);
    ipcRenderer.on(IPC_CHANNELS.runtimeProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.runtimeProgress, handler);
  },
  getDesktopState: () => ipcRenderer.invoke(IPC_CHANNELS.desktopState),
  getDesktopShortcutSettings: () => ipcRenderer.invoke(IPC_CHANNELS.desktopShortcutsGet),
  setDesktopShortcutSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.desktopShortcutsSet, settings),
  setDesktopShortcutRecording: (recording) =>
    ipcRenderer.invoke(IPC_CHANNELS.desktopShortcutRecording, recording),
  getQuickChatState: () => ipcRenderer.invoke(IPC_CHANNELS.quickChatState),
  quickChatAction: (action) => ipcRenderer.invoke(IPC_CHANNELS.quickChatAction, action),
  onQuickChatState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
      listener(state);
    ipcRenderer.on(IPC_CHANNELS.quickChatEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.quickChatEvent, handler);
  },
  desktopAction: (action, value, remember) =>
    ipcRenderer.invoke(IPC_CHANNELS.desktopAction, action, value, remember),
  readPolicy: (document, locale) => ipcRenderer.invoke(IPC_CHANNELS.policyRead, document, locale),
  acceptPolicies: (consent) => ipcRenderer.invoke(IPC_CHANNELS.policyAccept, consent),
  onDesktopEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value);
    ipcRenderer.on(IPC_CHANNELS.desktopEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.desktopEvent, handler);
  },
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo),
  bootstrap: (options) => ipcRenderer.invoke(IPC_CHANNELS.bootstrap, options),
  listSessionPage: (input) => ipcRenderer.invoke(IPC_CHANNELS.sessionPage, input),
  getSessionDelta: (after, ids) => ipcRenderer.invoke(IPC_CHANNELS.sessionDelta, after, ids),
  getSession: (id) => ipcRenderer.invoke(IPC_CHANNELS.sessionGet, id),
  getProjectContexts: (sessionIds) => ipcRenderer.invoke(IPC_CHANNELS.projectContexts, sessionIds),
  searchWorkspaceFiles: (input) => ipcRenderer.invoke(IPC_CHANNELS.workspaceSearchFiles, input),
  listSessionGroups: () => ipcRenderer.invoke(IPC_CHANNELS.sessionGroups),
  listChatGroups: () => ipcRenderer.invoke(IPC_CHANNELS.chatGroupsList),
  createChatGroup: (name) => ipcRenderer.invoke(IPC_CHANNELS.chatGroupCreate, name),
  renameChatGroup: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.chatGroupRename, id, name),
  removeChatGroup: (id) => ipcRenderer.invoke(IPC_CHANNELS.chatGroupRemove, id),
  chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceChoose),
  getModelCatalogPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.modelCatalogGet),
  moveCatalogProvider: (input) => ipcRenderer.invoke(IPC_CHANNELS.modelCatalogProviderMove, input),
  setCatalogModelStar: (input) => ipcRenderer.invoke(IPC_CHANNELS.modelCatalogStarSet, input),
  createProvider: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerCreate, input),
  updateProvider: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerUpdate, input),
  setProviderPromptCaching: (providerId, settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerPromptCachingSet, providerId, settings),
  removeProvider: (providerId) => ipcRenderer.invoke(IPC_CHANNELS.providerRemove, providerId),
  addProviderKey: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerAddKey, input),
  updateProviderKey: (input) => ipcRenderer.invoke(IPC_CHANNELS.providerUpdateKey, input),
  removeProviderKey: (providerId, keyId) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerRemoveKey, providerId, keyId),
  setActiveProviderKey: (providerId, keyId) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerSetActiveKey, providerId, keyId),
  fetchProviderModels: (providerId) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerFetchModels, providerId),
  testProvider: (providerId, modelConfigId) =>
    ipcRenderer.invoke(IPC_CHANNELS.providerTest, providerId, modelConfigId),
  createModel: (input) => ipcRenderer.invoke(IPC_CHANNELS.modelCreate, input),
  updateModel: (input) => ipcRenderer.invoke(IPC_CHANNELS.modelUpdate, input),
  removeModel: (modelConfigId) => ipcRenderer.invoke(IPC_CHANNELS.modelRemove, modelConfigId),
  getImageStudioWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.imageStudioGet),
  saveImageStudioWorkspace: (workspace) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioSave, workspace),
  getImageStudioAssetData: (assetId) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioAssetData, assetId),
  importImageStudioAssets: (files) => ipcRenderer.invoke(IPC_CHANNELS.imageStudioImport, files),
  removeImageStudioAsset: (assetId) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioRemoveAsset, assetId),
  generateImageStudioImage: (input) => ipcRenderer.invoke(IPC_CHANNELS.imageStudioGenerate, input),
  polishImageStudioPrompt: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioPolishPrompt, input),
  reverseImageStudioPrompt: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioReversePrompt, input),
  cancelImageStudioRequest: (requestId) =>
    ipcRenderer.invoke(IPC_CHANNELS.imageStudioCancel, requestId),
  createSession: (input) => ipcRenderer.invoke(IPC_CHANNELS.sessionCreate, input),
  createSessionInWorkspace: (workspacePath, agentMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionCreateInWorkspace, workspacePath, agentMode),
  createChatSessionInGroup: (groupId) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionCreateInChatGroup, groupId),
  forkSession: (sessionId, messageId) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionFork, sessionId, messageId),
  openSessionWorkspace: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionOpenWorkspace, sessionId),
  updateSession: (input, expected) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionUpdate, input, expected),
  removeSession: (sessionId, expected) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionRemove, sessionId, expected),
  getSessionMessages: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionMessages, sessionId),
  markSessionOpened: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionOpened, sessionId),
  getSessionRunState: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionRunState, sessionId),
  getSessionRetention: () => ipcRenderer.invoke(IPC_CHANNELS.sessionRetentionGet),
  setSessionRetention: (settings) => ipcRenderer.invoke(IPC_CHANNELS.sessionRetentionSet, settings),
  sendChat: (input) => ipcRenderer.invoke(IPC_CHANNELS.chatSend, input),
  getAutoDriveSuggestions: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.autoDriveSuggest, sessionId),
  cancelAutoDrive: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.autoDriveCancel, sessionId),
  getAgentCoordination: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentCoordinationGet, sessionId),
  getComposerDraft: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.composerDraftGet, sessionId),
  saveComposerDraft: (input) => ipcRenderer.invoke(IPC_CHANNELS.composerDraftSave, input),
  clearComposerDraft: (sessionId, revision) =>
    ipcRenderer.invoke(IPC_CHANNELS.composerDraftClear, sessionId, revision),
  getDraftAssistSettings: () => ipcRenderer.invoke(IPC_CHANNELS.draftAssistSettingsGet),
  setDraftAssistSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.draftAssistSettingsSet, settings),
  polishDraft: (input) => ipcRenderer.invoke(IPC_CHANNELS.draftAssistPolish, input),
  cancelDraftPolish: (requestId) => ipcRenderer.invoke(IPC_CHANNELS.draftAssistCancel, requestId),
  getProjectTone: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.projectToneGet, sessionId),
  setProjectTone: (input) => ipcRenderer.invoke(IPC_CHANNELS.projectToneSet, input),
  onComposerDraftFlush: (listener) => {
    composerDraftFlushListeners.add(listener);
    return () => {
      composerDraftFlushListeners.delete(listener);
    };
  },
  acknowledgeComposerDraftFlush: (requestId, error) =>
    ipcRenderer.send(IPC_CHANNELS.composerDraftFlushAck, requestId, error),
  onComposerDraftChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: unknown, revision: unknown) => {
      if (typeof sessionId !== "string" || (revision !== null && typeof revision !== "string"))
        return;
      listener({ sessionId, revision });
    };
    ipcRenderer.on(IPC_CHANNELS.composerDraftChanged, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.composerDraftChanged, handler);
  },
  rewriteAndSendChat: (input) => ipcRenderer.invoke(IPC_CHANNELS.chatRewrite, input),
  stopChat: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.chatStop, sessionId),
  getRunSteering: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.runSteeringGet, sessionId),
  steerRun: (input) => ipcRenderer.invoke(IPC_CHANNELS.runSteeringSend, input),
  listQueuedPrompts: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.queuedPromptList, sessionId),
  addQueuedPrompt: (input) => ipcRenderer.invoke(IPC_CHANNELS.queuedPromptAdd, input),
  updateQueuedPrompt: (input) => ipcRenderer.invoke(IPC_CHANNELS.queuedPromptUpdate, input),
  reorderQueuedPrompts: (input) => ipcRenderer.invoke(IPC_CHANNELS.queuedPromptReorder, input),
  removeQueuedPrompt: (sessionId, itemId) =>
    ipcRenderer.invoke(IPC_CHANNELS.queuedPromptRemove, sessionId, itemId),
  continueQueuedPrompt: (sessionId, itemId) =>
    ipcRenderer.invoke(IPC_CHANNELS.queuedPromptContinue, sessionId, itemId),
  beginQueuedPromptEdit: (sessionId, itemId) =>
    ipcRenderer.invoke(IPC_CHANNELS.queuedPromptBeginEdit, sessionId, itemId),
  endQueuedPromptEdit: (sessionId, editId, abandon) =>
    ipcRenderer.invoke(IPC_CHANNELS.queuedPromptEndEdit, sessionId, editId, abandon),
  compactChat: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.chatCompact, sessionId),
  getContextUsage: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.contextUsage, sessionId),
  decideApproval: (input) => ipcRenderer.invoke(IPC_CHANNELS.approvalDecide, input),
  getApprovalState: () => ipcRenderer.invoke(IPC_CHANNELS.approvalState),
  getQuestionState: () => ipcRenderer.invoke(IPC_CHANNELS.questionState),
  getApprovalModelSettings: () => ipcRenderer.invoke(IPC_CHANNELS.approvalModelGet),
  getGlobalCompactionModel: () => ipcRenderer.invoke(IPC_CHANNELS.compactionModelGet),
  setGlobalCompactionModel: (model) => ipcRenderer.invoke(IPC_CHANNELS.compactionModelSet, model),
  getCompactionFallbackModel: () => ipcRenderer.invoke(IPC_CHANNELS.compactionFallbackGet),
  setCompactionFallbackModel: (model) =>
    ipcRenderer.invoke(IPC_CHANNELS.compactionFallbackSet, model),
  setApprovalModelSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.approvalModelSet, input),
  startAutomaticApproval: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.approvalAutomatic, sessionId),
  answerQuestion: (input) => ipcRenderer.invoke(IPC_CHANNELS.questionAnswer, input),
  onRuntimeEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatStreamEvent) => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.runtimeEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.runtimeEvent, handler);
    };
  },
  listWorkspace: (root, relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceList, root, relativePath),
  readWorkspaceFile: (root, relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceRead, root, relativePath),
  readAbsoluteFile: (path) => ipcRenderer.invoke(IPC_CHANNELS.workspaceReadAbsolute, path),
  writeWorkspaceFile: (root, relativePath, content) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceWrite, root, relativePath, content),
  writeAbsoluteFile: (path, content) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceWriteAbsolute, path, content),
  getGitStatus: (root) => ipcRenderer.invoke(IPC_CHANNELS.workspaceGitStatus, root),
  getGitChanges: (root) => ipcRenderer.invoke(IPC_CHANNELS.gitChanges, root),
  getLatestGitBackup: (root) => ipcRenderer.invoke(IPC_CHANNELS.gitLatestBackup, root),
  discardGitChanges: (root, paths) => ipcRenderer.invoke(IPC_CHANNELS.gitDiscard, root, paths),
  restoreGitUndo: (root, backupId) =>
    ipcRenderer.invoke(IPC_CHANNELS.gitRestoreUndo, root, backupId),
  runUserCommand: (root, command) =>
    ipcRenderer.invoke(IPC_CHANNELS.workspaceRunCommand, root, command),
  getLocalReview: (input) => ipcRenderer.invoke(IPC_CHANNELS.localReviewGet, input),
  submitLocalReviewComments: (input) => ipcRenderer.invoke(IPC_CHANNELS.localReviewSubmit, input),
  listTerminals: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.terminalList, sessionId),
  createTerminal: (input) => ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, input),
  writeTerminal: (terminalId, data) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalInput, terminalId, data),
  resizeTerminal: (terminalId, cols, rows) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalResize, terminalId, cols, rows),
  stopTerminal: (terminalId) => ipcRenderer.invoke(IPC_CHANNELS.terminalStop, terminalId),
  onTerminalEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value);
    ipcRenderer.on(IPC_CHANNELS.terminalEvent, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalEvent, handler);
  },
  listExtensions: () => ipcRenderer.invoke(IPC_CHANNELS.extensionsList),
  chooseExtensionDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.extensionsChooseDirectory),
  importExtensions: (sourceDirectory) =>
    ipcRenderer.invoke(IPC_CHANNELS.extensionsImport, sourceDirectory),
  setExtensionEnabled: (extensionId, enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.extensionsSetEnabled, extensionId, enabled),
  removeExtension: (extensionId) => ipcRenderer.invoke(IPC_CHANNELS.extensionsRemove, extensionId),
  listSessionExtensions: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionExtensionsList, sessionId),
  setSessionExtension: (sessionId, extensionId, enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionExtensionsSet, sessionId, extensionId, enabled),
  listSessionBuiltinCapabilities: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionBuiltinCapabilitiesList, sessionId),
  setSessionBuiltinCapability: (sessionId, capabilityId, selected) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionBuiltinCapabilitySet, sessionId, capabilityId, selected),
  listScheduledTasks: () => ipcRenderer.invoke(IPC_CHANNELS.scheduledTasksList),
  createScheduledTask: (input) => ipcRenderer.invoke(IPC_CHANNELS.scheduledTasksCreate, input),
  setScheduledTaskEnabled: (taskId, enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.scheduledTasksSetEnabled, taskId, enabled),
  removeScheduledTask: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.scheduledTasksRemove, taskId),
  runScheduledTaskNow: (taskId) => ipcRenderer.invoke(IPC_CHANNELS.scheduledTasksRunNow, taskId),
  listMarketplaceSkills: (source, forceRefresh) =>
    ipcRenderer.invoke(IPC_CHANNELS.marketplaceList, source, forceRefresh),
  installMarketplaceSkill: (source, path) =>
    ipcRenderer.invoke(IPC_CHANNELS.marketplaceInstall, source, path),
  validateLocalPlugin: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.localPluginValidate, rootPath),
  listLocalPluginMarkets: () => ipcRenderer.invoke(IPC_CHANNELS.localPluginMarketsList),
  addLocalPluginMarket: (path) => ipcRenderer.invoke(IPC_CHANNELS.localPluginMarketAdd, path),
  getLocalPluginMarket: (id) => ipcRenderer.invoke(IPC_CHANNELS.localPluginMarketGet, id),
  refreshLocalPluginMarket: (id) => ipcRenderer.invoke(IPC_CHANNELS.localPluginMarketRefresh, id),
  removeLocalPluginMarket: (id) => ipcRenderer.invoke(IPC_CHANNELS.localPluginMarketRemove, id),
  installLocalPlugin: (marketId, pluginName) =>
    ipcRenderer.invoke(IPC_CHANNELS.localPluginInstall, marketId, pluginName),
  updateLocalPlugin: (marketId, pluginName) =>
    ipcRenderer.invoke(IPC_CHANNELS.localPluginUpdate, marketId, pluginName),
  listMcpServers: () => ipcRenderer.invoke(IPC_CHANNELS.mcpList),
  saveMcpServer: (input) => ipcRenderer.invoke(IPC_CHANNELS.mcpSave, input),
  removeMcpServer: (id) => ipcRenderer.invoke(IPC_CHANNELS.mcpRemove, id),
  setMcpServerEnabled: (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.mcpSetEnabled, id, enabled),
  testMcpServer: (id) => ipcRenderer.invoke(IPC_CHANNELS.mcpTest, id),
  startMcpOAuth: (id) => ipcRenderer.invoke(IPC_CHANNELS.mcpOAuthStart, id),
  listAgentProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.agentProfilesList),
  saveAgentProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.agentProfileSave, input),
  removeAgentProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.agentProfileRemove, id),
  discoverProjectInstructions: (workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectInstructions, workspacePath),
  getProjectTrust: (workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectTrustGet, workspacePath),
  setProjectTrust: (workspacePath, trusted) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectTrustSet, workspacePath, trusted),
  runDiagnostics: (workspacePath, changedPaths) =>
    ipcRenderer.invoke(IPC_CHANNELS.diagnosticsRun, workspacePath, changedPaths),
  listSnapshots: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.snapshotsList, sessionId),
  restoreSnapshot: (snapshotId, workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.snapshotRestore, snapshotId, workspacePath),
  listTrajectories: (sessionId, runId) =>
    ipcRenderer.invoke(IPC_CHANNELS.trajectoriesList, sessionId, runId),
  exportTrajectory: (sessionId, runId, format) =>
    ipcRenderer.invoke(IPC_CHANNELS.trajectoryExport, sessionId, runId, format),
  listCustomCommands: (workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.customCommandsList, workspacePath),
  listSessionTodos: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionTodos, sessionId),
  getWorkbench: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.workbenchGet, sessionId),
  getSubagentOutput: (parentId, sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.subagentOutput, parentId, sessionId),
  updatePlan: (input) => ipcRenderer.invoke(IPC_CHANNELS.workbenchPlanUpdate, input),
  resumeTask: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.workbenchResume, sessionId),
  listProjectPlans: (path) => ipcRenderer.invoke(IPC_CHANNELS.projectPlansList, path),
  saveProjectPlan: (id, name, planId) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectPlanSave, id, name, planId),
  applyProjectPlan: (id, planId, revision, reset) =>
    ipcRenderer.invoke(IPC_CHANNELS.projectPlanApply, id, planId, revision, reset),
  removeProjectPlan: (id) => ipcRenderer.invoke(IPC_CHANNELS.projectPlanRemove, id),
  getToolingStatus: (workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.toolingStatus, workspacePath),
  listCustomTools: (workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.customToolsList, workspacePath),
  getModelRetrySettings: () => ipcRenderer.invoke(IPC_CHANNELS.modelRetryGet),
  getTokenSaver: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.tokenSaverGet, sessionId),
  setTokenSaver: (settings) => ipcRenderer.invoke(IPC_CHANNELS.tokenSaverSet, settings),
  recallContext: (sessionId, messageId, partIndex, startLine, charOffset) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.tokenSaverRecall,
      sessionId,
      messageId,
      partIndex,
      startLine,
      charOffset,
    ),
  setModelRetrySettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.modelRetrySet, settings),
  getAgentRuntimeSettings: () => ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeSettingsGet),
  setAgentRuntimeSettings: (settings) =>
    ipcRenderer.invoke(IPC_CHANNELS.agentRuntimeSettingsSet, settings),
  getDockerSettings: () => ipcRenderer.invoke(IPC_CHANNELS.dockerSettingsGet),
  setDockerSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.dockerSettingsSet, settings),
  getHeadlessServerStatus: () => ipcRenderer.invoke(IPC_CHANNELS.headlessServerStatus),
  startHeadlessServer: (host, port) =>
    ipcRenderer.invoke(IPC_CHANNELS.headlessServerStart, host, port),
  stopHeadlessServer: () => ipcRenderer.invoke(IPC_CHANNELS.headlessServerStop),
  createSessionShare: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.sessionShare, sessionId),
  exportSession: (sessionId, format) =>
    ipcRenderer.invoke(IPC_CHANNELS.sessionExport, sessionId, format),
  getPluginShellHooksEnabled: () => ipcRenderer.invoke(IPC_CHANNELS.pluginHooksGet),
  setPluginShellHooksEnabled: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.pluginHooksSet, enabled),
  openBrowser: (sessionId, provider, url) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserOpen, sessionId, provider, url),
  registerBrowserWebContents: (sessionId, provider, webContentsId) =>
    ipcRenderer.invoke(IPC_CHANNELS.browserRegisterWebContents, sessionId, provider, webContentsId),
  getBrowserStatus: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.browserStatus, sessionId),
  closeBrowser: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.browserClose, sessionId),
  openExternalUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url),
  openLocalPath: (path, workspacePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.openLocalPath, path, workspacePath),
  getGitHubStatus: () => ipcRenderer.invoke(IPC_CHANNELS.githubConnectionStatus),
  startGitHubAuthorization: (clientId) =>
    ipcRenderer.invoke(IPC_CHANNELS.githubDeviceStart, clientId),
  getGitHubAuthorization: () => ipcRenderer.invoke(IPC_CHANNELS.githubDevicePending),
  pollGitHubAuthorization: () => ipcRenderer.invoke(IPC_CHANNELS.githubDevicePoll),
  cancelGitHubAuthorization: () => ipcRenderer.invoke(IPC_CHANNELS.githubDeviceCancel),
  setGitHubToken: (token) => ipcRenderer.invoke(IPC_CHANNELS.githubSetToken, token),
  disconnectGitHub: () => ipcRenderer.invoke(IPC_CHANNELS.githubDisconnect),
};

contextBridge.exposeInMainWorld("mingshen", api);
