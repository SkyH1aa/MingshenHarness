import type {
  AgentMode,
  AgentProfileView,
  ChatGroupView,
  SessionCreateInput,
  SessionUpdateInput,
  SessionView,
} from "../../shared/domain";
import {
  canonicalProjectMemoryRoot,
  commitProjectMemoryBackend,
  projectMemorySelection,
  validateProjectMemoryBackend,
} from "../agents/project-memory-config";
import type { SessionBuiltinCapabilityService } from "../agents/session-builtin-capability-service";
import { validateCompactionChoice } from "../chat/compaction-config";
import { projectPermission, setApprovalMode } from "../permissions/project-permissions";
import type { Repository } from "../storage/repository";

function validateTitle(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw new Error("会话标题长度必须为 1 到 120 个字符。");
  }
  return normalized;
}

function normalizeAgentMode(value: unknown): AgentMode {
  if (value === undefined) return "code";
  if (value === "code" || value === "work" || value === "chat") return value;
  throw new Error("无效的 Agent 模式。");
}

function profileSupportsMode(profile: AgentProfileView, mode: AgentMode): boolean {
  if (mode === "chat") return profile.id === "primary";
  return (profile.applicableModes ?? ["code", "work"]).includes(mode);
}

function compatibleWorkspaceProfile(
  repository: Repository,
  requestedId: string,
  mode: Exclude<AgentMode, "chat">,
): string {
  const requested = repository.getAgentProfile(requestedId);
  if (requested?.enabled && profileSupportsMode(requested, mode)) return requested.id;
  const primary = repository.getAgentProfile("primary");
  if (primary?.enabled && profileSupportsMode(primary, mode)) return primary.id;
  const fallback = repository
    .listAgentProfiles()
    .find((profile) => profile.enabled && profileSupportsMode(profile, mode));
  if (!fallback)
    throw new Error(`没有适用于 ${mode === "work" ? "WorkAgent" : "CodeAgent"} 的 Agent 配置。`);
  return fallback.id;
}

export class SessionService {
  constructor(
    private readonly repository: Repository,
    private readonly builtinCapabilities?: SessionBuiltinCapabilityService,
  ) {}

  list(): SessionView[] {
    return this.repository.listSessions();
  }

  projectMemorySelection(workspacePath: string | null) {
    if (workspacePath !== null && typeof workspacePath !== "string")
      throw new Error("Invalid project directory.");
    return projectMemorySelection(this.repository, workspacePath);
  }

  createInWorkspace(workspacePath: string | null, requestedMode?: "code" | "work"): SessionView {
    if (workspacePath !== null && typeof workspacePath !== "string") {
      throw new Error("工作目录无效。");
    }
    const key = (path: string | null) => (path ? canonicalProjectMemoryRoot(path) : "");
    const source = this.repository
      .listSessions()
      .filter(
        (session) =>
          !session.archived &&
          !session.parentSessionId &&
          session.agentMode !== "chat" &&
          key(session.workspacePath) === key(workspacePath),
      )
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (!source) {
      throw new Error("该工作目录没有可继承配置的主会话，请先通过“新对话”创建。");
    }
    const sourceModel = source.modelId ? this.repository.getModel(source.modelId) : null;
    if (
      !source.providerId ||
      !sourceModel ||
      sourceModel.providerId !== source.providerId ||
      !this.repository.getProvider(source.providerId)
    ) {
      throw new Error("上一会话的供应商或模型已被删除，请先重新配置该会话。");
    }

    const mode: Exclude<AgentMode, "chat"> =
      requestedMode ?? (source.agentMode === "work" ? "work" : "code");
    const extensionIds = this.repository.listSessionExtensionIds(source.id);
    const session = this.create({
      providerId: source.providerId,
      modelId: sourceModel.id,
      agentProfileId: compatibleWorkspaceProfile(this.repository, source.agentProfileId, mode),
      agentMode: mode,
      workspacePath: source.workspacePath,
      systemPrompt: source.systemPrompt,
      reasoningLevel: source.reasoningLevel,
      permissionMode: source.permissionMode,
      approvalMode: source.approvalMode ?? "manual",
      compactionModel: source.compactionModel ?? {
        mode: "default",
        providerId: null,
        modelId: null,
      },
      executionMode: source.executionMode,
      patchOnly: source.patchOnly,
      memoryBackend: projectMemorySelection(this.repository, source.workspacePath).backend,
    });
    try {
      for (const extensionId of extensionIds) {
        this.repository.setSessionExtension(session.id, extensionId, true);
      }
      this.builtinCapabilities?.copy(source.id, session.id);
    } catch (error) {
      this.repository.removeSession(session.id);
      throw error;
    }
    return session;
  }

  create(input: SessionCreateInput): SessionView {
    const provider = this.repository.getProvider(input.providerId);
    if (!provider) {
      throw new Error("供应商不存在。");
    }

    const model = this.repository.getModel(input.modelId);
    if (!model || model.providerId !== input.providerId) {
      throw new Error("模型配置不存在或不属于该供应商。");
    }

    if (input.reasoningLevel && !model.reasoningLevels.includes(input.reasoningLevel)) {
      throw new Error("所选思考等级不被该模型支持。");
    }

    const mode = normalizeAgentMode(input.agentMode);
    const requestedProfileId = input.agentProfileId?.trim() || "primary";
    const agentProfileId = mode === "chat" ? "primary" : requestedProfileId;
    if (mode !== "chat") {
      const profile = this.repository.getAgentProfile(agentProfileId);
      if (!profile?.enabled || !profileSupportsMode(profile, mode))
        throw new Error("所选 Agent 配置不存在、已禁用或不适用于当前模式。");
    }

    const compactionModel = input.compactionModel
      ? validateCompactionChoice(this.repository, input.compactionModel)
      : null;
    const workspacePath = input.workspacePath?.trim() || null;
    const chatGroupId = input.chatGroupId?.trim() || null;
    if (mode === "chat") {
      if (workspacePath !== null)
        throw new Error("ChatAgent 不使用工作目录，不能创建或继承本地文件上下文。");
      if (requestedProfileId !== "primary") throw new Error("ChatAgent 不使用自定义 Agent 配置。");
      if (input.executionMode && input.executionMode !== "host")
        throw new Error("ChatAgent 仅支持宿主聊天，不能启用 worktree 或 Docker。");
      if (input.patchOnly) throw new Error("ChatAgent 不提供文件修改或 Patch 模式。");
      if (chatGroupId && !this.repository.getChatGroup(chatGroupId))
        throw new Error("聊天分组不存在。");
    } else if (chatGroupId) {
      throw new Error("聊天分组仅适用于 ChatAgent。");
    }
    const memoryBackend =
      mode === "chat"
        ? null
        : validateProjectMemoryBackend(this.repository, workspacePath, input.memoryBackend);
    const session = this.repository.insertSession({
      title: validateTitle(input.title) ?? "新会话",
      agentMode: mode,
      chatGroupId,
      providerId: input.providerId,
      modelId: input.modelId,
      agentProfileId,
      workspacePath,
      systemPrompt: input.systemPrompt?.trim() ?? "",
      reasoningLevel: input.reasoningLevel,
      permissionMode:
        mode === "chat"
          ? "request_approval"
          : (projectPermission(this.repository, input.workspacePath) ?? input.permissionMode),
      executionMode: mode === "chat" ? "host" : (input.executionMode ?? "host"),
      patchOnly: mode === "chat" ? false : (input.patchOnly ?? false),
    });
    try {
      if (mode !== "chat" && input.approvalMode === "automatic")
        setApprovalMode(this.repository, session.id, "automatic");
      if (compactionModel)
        this.repository.setSetting(`context.model.${session.id}`, compactionModel);
      if (memoryBackend) commitProjectMemoryBackend(this.repository, workspacePath, memoryBackend);
    } catch (error) {
      this.repository.removeSession(session.id);
      throw error;
    }
    return this.repository.getSession(session.id) ?? session;
  }

  update(input: SessionUpdateInput): SessionView {
    const current = this.repository.getSession(input.sessionId);
    if (!current) {
      throw new Error("会话不存在。");
    }
    const currentMode = normalizeAgentMode(current.agentMode);
    const mode = input.agentMode === undefined ? currentMode : normalizeAgentMode(input.agentMode);
    if (mode !== currentMode && (mode === "chat" || currentMode === "chat"))
      throw new Error("ChatAgent 与 CodeAgent/WorkAgent 不能直接互换，请使用对应的会话页面。");
    const modeChanging = mode !== currentMode;
    if (
      modeChanging &&
      [current, ...this.descendants(current.id)].some((session) =>
        ["running", "waiting_approval"].includes(session.status),
      )
    )
      throw new Error("请先停止会话及其子任务，再切换 CodeAgent/WorkAgent 模式。");
    const workspacePath =
      input.workspacePath === undefined
        ? current.workspacePath
        : input.workspacePath?.trim() || null;
    const chatGroupId =
      input.chatGroupId === undefined
        ? (current.chatGroupId ?? null)
        : input.chatGroupId?.trim() || null;
    if (mode === "chat") {
      if (workspacePath !== null) throw new Error("ChatAgent 不使用工作目录。");
      if (input.agentProfileId && input.agentProfileId !== "primary")
        throw new Error("ChatAgent 不使用自定义 Agent 配置。");
      if (input.executionMode && input.executionMode !== "host")
        throw new Error("ChatAgent 仅支持宿主聊天。");
      if (input.patchOnly === true) throw new Error("ChatAgent 不提供文件修改模式。");
      if (input.permissionMode && input.permissionMode !== "request_approval")
        throw new Error("ChatAgent 固定使用受限聊天权限。");
      if (chatGroupId && !this.repository.getChatGroup(chatGroupId))
        throw new Error("聊天分组不存在。");
    } else if (chatGroupId) {
      throw new Error("聊天分组仅适用于 ChatAgent。");
    }
    const moving =
      input.workspacePath !== undefined &&
      (workspacePath ? canonicalProjectMemoryRoot(workspacePath) : "") !==
        (current.workspacePath ? canonicalProjectMemoryRoot(current.workspacePath) : "");
    if (
      moving &&
      [current, ...this.descendants(current.id)].some((session) =>
        ["running", "waiting_approval"].includes(session.status),
      )
    )
      throw new Error("Stop the conversation before changing its project directory.");
    if (moving && current.parentSessionId)
      throw new Error("Subagents inherit their parent project's memory backend.");
    const sourceBackend = moving
      ? projectMemorySelection(this.repository, current.workspacePath).backend
      : null;
    const destinationBackend = moving
      ? validateProjectMemoryBackend(
          this.repository,
          workspacePath,
          projectMemorySelection(this.repository, workspacePath).locked ? undefined : sourceBackend,
        )
      : null;
    const title = validateTitle(input.title);
    const compactionModel = input.compactionModel
      ? validateCompactionChoice(this.repository, input.compactionModel)
      : null;

    const providerId = input.providerId ?? current.providerId;
    const modelId = input.modelId ?? current.modelId;

    if ((input.providerId !== undefined || input.modelId !== undefined) && providerId && modelId) {
      const model = this.repository.getModel(modelId);
      if (!model || model.providerId !== providerId) {
        throw new Error("模型配置不存在或不属于该供应商。");
      }
    }

    const agentProfileId =
      mode === "chat" ? "primary" : (input.agentProfileId ?? current.agentProfileId);
    if (mode !== "chat" && (input.agentProfileId || modeChanging)) {
      const profile = this.repository.getAgentProfile(agentProfileId);
      if (!profile?.enabled || !profileSupportsMode(profile, mode))
        throw new Error("所选 Agent 配置不存在、已禁用或不适用于当前模式。");
    }

    if (
      input.archived === true &&
      [current, ...this.descendants(current.id)].some((session) =>
        ["running", "waiting_approval"].includes(session.status),
      )
    )
      throw new Error("请先停止会话及其子任务，再归档。");
    // Resolve both project configurations before changing any conversation state.
    if (moving && sourceBackend)
      commitProjectMemoryBackend(this.repository, current.workspacePath, sourceBackend);
    if (destinationBackend)
      commitProjectMemoryBackend(this.repository, workspacePath, destinationBackend);
    if (input.archived !== undefined) {
      for (const child of this.descendants(current.id)) {
        this.repository.updateSession(child.id, { archived: input.archived });
        if (!input.archived) this.repository.touchSession(child.id);
      }
      if (!input.archived) this.repository.touchSession(current.id);
      if (input.archived) {
        const ids = new Set([current.id, ...this.descendants(current.id).map((child) => child.id)]);
        for (const task of this.repository.listScheduledTasks())
          if (task.enabled && ids.has(task.sessionId))
            this.repository.setScheduledTaskEnabled(task.id, false);
      }
    }
    if (compactionModel)
      this.repository.setSetting(`context.model.${input.sessionId}`, compactionModel);
    const session = this.repository.updateSession(input.sessionId, {
      title,
      agentMode: mode,
      chatGroupId,
      providerId: input.providerId,
      modelId: input.modelId,
      agentProfileId: mode === "chat" ? "primary" : input.agentProfileId,
      workspacePath: input.workspacePath === undefined ? undefined : workspacePath,
      systemPrompt: input.systemPrompt,
      reasoningLevel: input.reasoningLevel,
      permissionMode: mode === "chat" ? "request_approval" : input.permissionMode,
      executionMode: mode === "chat" ? "host" : input.executionMode,
      patchOnly: mode === "chat" ? false : input.patchOnly,
      archived: input.archived,
      pinned: input.pinned,
    });
    return session;
  }

  private descendants(sessionId: string): SessionView[] {
    return this.repository
      .listChildSessions(sessionId)
      .flatMap((child) => [child, ...this.descendants(child.id)]);
  }

  listChatGroups(): ChatGroupView[] {
    return this.repository.listChatGroups();
  }

  createChatGroup(name: string): ChatGroupView {
    return this.repository.createChatGroup(name);
  }

  renameChatGroup(id: string, name: string): ChatGroupView {
    return this.repository.renameChatGroup(id, name);
  }

  removeChatGroup(id: string): void {
    this.repository.removeChatGroup(id);
  }

  remove(sessionId: string): void {
    this.repository.removeSession(sessionId);
  }

  getMessages(sessionId: string) {
    if (!this.repository.getSession(sessionId)) {
      return [];
    }
    return this.repository.getMessages(sessionId);
  }
}
