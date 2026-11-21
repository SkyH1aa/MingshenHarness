export type ProviderProtocol =
  | "anthropic_messages"
  | "openai_responses"
  | "openai_chat_completions"
  | "gemini_generate_content";

export type ProviderAuthMode = "bearer" | "x_api_key" | "api_key" | "x_goog_api_key" | "custom";

export type PermissionMode = "request_approval" | "full_access";
export type ApprovalMode = "manual" | "automatic";

export interface ApprovalModelSettings {
  providerId: string | null;
  modelId: string | null;
  fallback?: ModelReference | null;
}

export interface ModelReference {
  providerId: string;
  modelId: string;
}

export interface CompactionModelChoice {
  mode: "default" | "current" | "custom";
  providerId: string | null;
  modelId: string | null;
}

export interface ContextUsageView {
  sessionId: string;
  runId: string;
  state: "ready" | "compacting" | "failed";
  usedTokens: number;
  contextWindow: number;
  source: "provider" | "estimate";
  providerId?: string;
  modelId?: string;
  restored?: boolean;
  estimateScope?: "request" | "local";
  lastCompactedAt: string | null;
  error: string | null;
  notice?: string | null;
  updatedAt: string;
}

export interface ApprovalState {
  revision: number;
  requests: ApprovalRequest[];
}

export interface QuestionState {
  revision: number;
  requests: QuestionRequest[];
}

export type AppLocale = "zh-CN" | "en";

export type AgentProfileRole = "primary" | "plan" | "subagent" | "all";

export type SessionExecutionMode = "host" | "worktree" | "docker";

export type AgentMode = "code" | "work" | "chat";

export type AgentPermissionAction = "allow" | "ask" | "deny";

export type AgentPermissionMap = Record<string, AgentPermissionAction>;

export type InputModality = "text" | "image" | "audio" | "video" | "file";

export type AnthropicNoneBehavior = "disabled" | "between_tools" | "reject";

export type AttachmentKind = "image" | "audio" | "video" | "file";

export interface ChatAttachmentInput {
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  dataUrl: string;
  path?: string;
  extractedContent?: {
    text: string;
    format: string;
    warnings: string[];
    truncated: boolean;
    error?: string;
    parserVersion?: number;
    pdfMode?: "native" | "vision" | "ocr";
    pdf?: { totalPages: number; inspectedPages: number; ocrPages: number };
  };
  /** Generated in main for a model request only; never accepted from renderer or saved. */
  documentPageImages?: Array<{ page: number; dataUrl: string }>;
}

export interface ProviderKeySummary {
  id: string;
  label: string;
  maskedHint: string;
  enabled: boolean;
  priority: number;
  neverReveal: boolean;
  isActive: boolean;
  cooldownUntil: string | null;
}

export interface ModelConfig {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputModalities: InputModality[];
  outputModalities: InputModality[];
  toolCalls: boolean;
  parallelToolCalls: boolean;
  reasoningLevels: string[];
  anthropicNoneBehavior: AnthropicNoneBehavior;
  enabled: boolean;
}

export interface ProviderView {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  authMode: ProviderAuthMode;
  customHeaderName: string | null;
  activeKeyId: string | null;
  keys: ProviderKeySummary[];
  models: ModelConfig[];
  createdAt: string;
  updatedAt: string;
  promptCaching?: import("./prompt-caching").PromptCachingSettings;
}

export interface SessionView {
  id: string;
  childCount?: number;
  title: string;
  parentSessionId: string | null;
  /** Older callers may omit this synthetic field; persisted records always map to code by default. */
  agentMode?: AgentMode;
  chatGroupId?: string | null;
  providerId: string | null;
  modelId: string | null;
  agentProfileId: string;
  workspacePath: string | null;
  systemPrompt: string;
  reasoningLevel: string | null;
  permissionMode: PermissionMode;
  chatNetworkEnabled?: boolean;
  approvalMode?: ApprovalMode;
  compactionModel?: CompactionModelChoice;
  executionMode: SessionExecutionMode;
  patchOnly: boolean;
  status: "idle" | "running" | "waiting_approval" | "interrupted" | "error";
  archived: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

export interface SessionBuiltinCapabilityView {
  id: string;
  type: "skill" | "plugin";
  name: string;
  description: string;
  source: "builtin";
  family: string | null;
  version: string | null;
  compatibility: string | null;
  sourcePath?: string | null;
  sourceSha256?: string | null;
  selected: boolean;
}

/**
 * A replay-safe subset of an OpenAI Responses output item.
 *
 * Reasoning items intentionally carry only the provider-issued encrypted
 * payload and the optional summary; raw hidden reasoning is never persisted.
 * The provider/model scope prevents accidentally replaying opaque state to a
 * different gateway or model.
 */
export interface ResponsesStateItem {
  type: string;
  id?: string;
  status?: string;
  role?: string;
  phase?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  encrypted_content?: string;
  summary?: Array<{
    type: string;
    text?: string;
  }>;
  content?: Array<{
    type: string;
    text?: string;
    refusal?: string;
    annotations?: Array<Record<string, unknown>>;
  }>;
}

/** Provider-issued continuation fields are separate from display-only reasoning. */
export interface ProviderNativeState {
  family: "gemini" | "deepseek";
  protocol: ProviderProtocol;
  providerId: string;
  modelId: string;
  endpointKey: string;
  payload: Record<string, unknown>;
}

export interface ToolResultImage {
  dataUrl: string;
  mimeType: string;
  alt?: string;
}

export interface SessionRetentionSettings {
  days: number | null;
}

export interface SessionRunState {
  sessionId: string;
  runId: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "interrupted" | "failed";
}

export type MessagePart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "reasoning";
      text: string;
      signature?: string;
    }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      arguments: string;
      status: "pending" | "running" | "completed" | "failed" | "denied";
      /** Internal runtime step generated by execute_tool_chain. */
      synthetic?: boolean;
      chainRootCallId?: string;
    }
  | {
      type: "tool_result";
      callId: string;
      output: string;
      isError: boolean;
      images?: ToolResultImage[];
      /** Internal runtime step generated by execute_tool_chain. */
      synthetic?: boolean;
      chainRootCallId?: string;
    }
  | {
      type: "responses_state";
      providerId: string;
      modelId: string;
      endpointKey: string;
      items: ResponsesStateItem[];
    }
  | {
      type: "provider_state";
      state: ProviderNativeState;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "run_summary";
      summary: RunSummary;
    }
  | {
      type: "attachment";
      attachment: ChatAttachmentInput;
    };

export interface SessionMessage {
  id: string;
  sessionId: string;
  seq: number;
  role: "user" | "assistant" | "tool";
  parts: MessagePart[];
  createdAt: string;
}

export type ActivityKind =
  | "read"
  | "edit"
  | "delete"
  | "command"
  | "search"
  | "browser"
  | "github"
  | "subagent"
  | "tool";

export interface FileChange {
  path: string;
  changeType: "created" | "modified" | "deleted";
  additions: number;
  deletions: number;
  diff?: FileDiff | undefined;
}

export interface FileDiffLine {
  type: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface FileDiff {
  lines: FileDiffLine[];
  truncated: boolean;
}

export interface ActivityEvent {
  id: string;
  sessionId: string;
  runId: string;
  toolName: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  fileChange: FileChange | null;
}

export interface RunSummary {
  runId: string;
  durationMs: number;
  toolCount: number;
  fileChanges: FileChange[];
}

export interface AgentProfileView {
  id: string;
  name: string;
  description: string;
  role: AgentProfileRole;
  instructions: string;
  modelId: string | null;
  readOnly: boolean;
  builtin: boolean;
  enabled: boolean;
  hidden: boolean;
  sourcePath: string | null;
  permissions: AgentPermissionMap;
  toolAllowlist: string[];
  temperature: number | null;
  topP: number | null;
  maxSteps: number | null;
  color: string | null;
  applicableModes?: Array<Exclude<AgentMode, "chat">>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfileSaveInput {
  id?: string;
  name: string;
  description: string;
  role: AgentProfileRole;
  instructions: string;
  modelId?: string | null;
  readOnly: boolean;
  enabled: boolean;
  hidden?: boolean;
  sourcePath?: string | null;
  permissions?: AgentPermissionMap;
  toolAllowlist?: string[];
  temperature?: number | null;
  topP?: number | null;
  maxSteps?: number | null;
  color?: string | null;
  applicableModes?: Array<Exclude<AgentMode, "chat">>;
}

export interface ProjectInstructionView {
  path: string;
  scope: string;
  source: "file" | "url" | "config";
  content: string;
  truncated: boolean;
}

export interface LspDiagnostic {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  source: string;
}

export interface DiagnosticsReport {
  ok: boolean;
  engine: string;
  servers: string[];
  durationMs: number;
  diagnostics: LspDiagnostic[];
  error: string | null;
}

export interface TrajectoryEvent {
  id: string;
  runId: string;
  sessionId: string;
  sequence: number;
  type: string;
  summary: string;
  payload: unknown;
  createdAt: string;
}

export interface TrajectoryView {
  runId: string;
  sessionId: string;
  startedAt: string;
  stepSummaries: string[];
  events: TrajectoryEvent[];
}

export interface SnapshotView {
  id: string;
  sessionId: string;
  runId: string;
  workspacePath: string;
  fileCount: number;
  createdAt: string;
}

export interface SnapshotRestoreResult {
  restored: number;
  removed: number;
  safetySnapshotId: string;
}

export interface SessionTodo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
  updatedAt: string;
  dependsOn?: string[];
}

export interface CustomCommandView {
  id: string;
  name: string;
  description: string;
  agent: string | null;
  model: string | null;
  template: string;
  sourcePath: string;
}

export interface ToolingServerStatus {
  id: string;
  name: string;
  kind: "lsp" | "formatter";
  command: string[];
  extensions: string[];
  available: boolean;
  source: "builtin" | "project" | "user";
  error: string | null;
}

export interface AgentRuntimeSettings {
  maxConcurrentSubagents: number;
}

export interface CustomToolView {
  name: string;
  description: string;
  sourcePath: string;
  available: boolean;
  error: string | null;
}

export interface DockerRuntimeSettings {
  image: string;
  dockerfile: string;
  buildContext: string;
}

export interface HeadlessServerStatus {
  running: boolean;
  host: string;
  port: number;
  token: string | null;
  url: string | null;
}

export interface ShareLinkResult {
  url: string;
  expiresAt: string;
}

export interface McpOAuthStartResult {
  authorizationUrl: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  requestUrl: string;
  modelId: string;
  responseText: string;
  responseBody: string;
  error: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    cachedInputTokens?: number | null;
    cacheCreationInputTokens?: number | null;
  } | null;
}

export interface ModelDiscoveryResult {
  modelIds: string[];
  latencyMs: number;
  rawCount: number;
}

export interface BootstrapData {
  sessionCatalog?: {
    revision: number;
    total: number;
    groups: import("./session-catalog").SessionWorkspaceGroup[];
  };
  providers: ProviderView[];
  sessions: SessionView[];
  chatGroups?: ChatGroupView[];
  sessionRuns: SessionRunState[];
  agentProfiles: AgentProfileView[];
  extensions: ExtensionView[];
  scheduledTasks: ScheduledTaskView[];
  mcpServers: McpServerView[];
  approvalState: ApprovalState;
  questionState: QuestionState;
  pendingQuestions: QuestionRequest[];
  contextStates: ContextUsageView[];
}

export interface ProviderCreateInput {
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  authMode: ProviderAuthMode;
  customHeaderName?: string;
  apiKey: string;
  keyLabel: string;
  neverReveal: boolean;
  promptCaching?: import("./prompt-caching").PromptCachingSettings;
}

export interface ProviderUpdateInput {
  providerId: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  authMode?: ProviderAuthMode;
  customHeaderName?: string | null;
}

export interface ProviderAddKeyInput {
  providerId: string;
  label: string;
  apiKey: string;
  neverReveal: boolean;
}

export interface ProviderUpdateKeyInput {
  providerId: string;
  keyId: string;
  label: string;
  apiKey?: string;
  neverReveal: boolean;
}

export interface ModelCreateInput {
  providerId: string;
  modelId: string;
  displayName?: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputModalities: InputModality[];
  outputModalities?: InputModality[];
  toolCalls: boolean;
  parallelToolCalls: boolean;
  reasoningLevels: string[];
  anthropicNoneBehavior: AnthropicNoneBehavior;
}

export type ModelUpdateInput = Omit<ModelCreateInput, "providerId"> & {
  id: string;
};

export interface SessionCreateInput {
  title?: string;
  providerId: string;
  modelId: string;
  agentProfileId?: string;
  agentMode?: AgentMode;
  chatGroupId?: string | null;
  workspacePath: string | null;
  systemPrompt?: string;
  reasoningLevel: string | null;
  permissionMode: PermissionMode;
  chatNetworkEnabled?: boolean;
  approvalMode?: ApprovalMode;
  compactionModel?: CompactionModelChoice;
  executionMode?: SessionExecutionMode;
  patchOnly?: boolean;
  memoryBackend?: import("./project-memory").MemoryBackend;
}

export interface SessionUpdateInput {
  sessionId: string;
  title?: string;
  providerId?: string;
  modelId?: string;
  agentProfileId?: string;
  agentMode?: AgentMode;
  chatGroupId?: string | null;
  workspacePath?: string | null;
  systemPrompt?: string;
  reasoningLevel?: string | null;
  permissionMode?: PermissionMode;
  chatNetworkEnabled?: boolean;
  approvalMode?: ApprovalMode;
  compactionModel?: CompactionModelChoice;
  executionMode?: SessionExecutionMode;
  patchOnly?: boolean;
  archived?: boolean;
  pinned?: boolean;
}

export interface ChatGroupView {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatTurnOptions {
  /** User-provided guidance for this run only. It cannot grant permissions or tools. */
  temporaryInstruction?: string;
}

export interface ChatSendInput extends ChatTurnOptions {
  sessionId: string;
  text: string;
  attachments?: ChatAttachmentInput[];
  draftRevision?: string;
}

export interface ChatRewriteInput {
  sessionId: string;
  messageId: string;
  text: string;
  attachments?: ChatAttachmentInput[];
}

export type ChatStreamEvent =
  | { type: "model_attempt_reset"; sessionId: string; runId: string }
  | { type: "composer_draft_consumed"; sessionId: string; revision: string }
  | {
      type: "run_steering_updated";
      sessionId: string;
      state: import("./run-steering").RunSteeringState | null;
    }
  | { type: "queued_prompts_updated"; sessionId: string }
  | { type: "workbench_updated"; sessionId: string; state: import("./workbench").WorkbenchState }
  | { type: "context_updated"; context: ContextUsageView }
  | { type: "approval_state"; state: ApprovalState }
  | { type: "question_state"; state: QuestionState }
  | { type: "question_resolved"; sessionId: string; questionId: string }
  | {
      type: "run_started";
      sessionId: string;
      runId: string;
      kind?: "compaction";
    }
  | {
      type: "user_message";
      sessionId: string;
      runId: string;
      message: SessionMessage;
    }
  | {
      type: "assistant_delta";
      sessionId: string;
      runId: string;
      text: string;
    }
  | {
      type: "reasoning_delta";
      sessionId: string;
      runId: string;
      text: string;
    }
  | {
      type: "assistant_message";
      sessionId: string;
      runId: string;
      message: SessionMessage;
    }
  | {
      type: "usage";
      sessionId: string;
      runId: string;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
    }
  | {
      type: "run_completed";
      sessionId: string;
      runId: string;
      kind?: "compaction";
    }
  | {
      type: "session_updated";
      session: SessionView;
    }
  | {
      type: "session_removed";
      sessionId: string;
    }
  | {
      type: "run_interrupted";
      sessionId: string;
      runId: string;
    }
  | {
      type: "run_failed";
      sessionId: string;
      runId: string;
      error: string;
    }
  | {
      type: "approval_required";
      sessionId: string;
      runId: string;
      approval: ApprovalRequest;
    }
  | {
      type: "question_required";
      sessionId: string;
      runId: string;
      question: QuestionRequest;
    }
  | {
      type: "activity";
      activity: ActivityEvent;
    }
  | {
      type: "browser_open_requested";
      sessionId: string;
      provider: BrowserProvider;
      url: string;
    }
  | {
      type: "conversation_rewound";
      sessionId: string;
      fromSeq: number;
      session: SessionView;
    }
  | {
      type: "session_todos_updated";
      sessionId: string;
      todos: SessionTodo[];
    };

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  detail: string;
  pathScope: string | null;
  commandPrefix: string | null;
  commandCwd?: string;
  risk: "normal" | "elevated" | "destructive";
  createdAt: string;
  manualOnly?: boolean;
  reviewInput?: string | null;
  review?: { state: "reviewing" | "manual"; reason?: string };
  similarScope?: string;
}

export interface ApprovalDecision {
  approvalId: string;
  decision: "allow_once" | "allow_session" | "allow_similar" | "deny" | "full_access";
  feedback?: string;
  rememberForMs?: number;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionRequest {
  id: string;
  sessionId: string;
  runId: string;
  kind?: "agent" | "file_conflict";
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
  questions?: AgentQuestion[];
  createdAt: string;
}

export interface AgentQuestion {
  id: string;
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface AgentQuestionAnswer {
  id: string;
  selectedOptions: string[];
  otherText: string | null;
}

export interface QuestionAnswer {
  questionId: string;
  answer?: string;
  answers?: AgentQuestionAnswer[];
}

export interface WorkspaceEntry {
  name: string;
  path: string;
  relativePath: string;
  directory: boolean;
  size: number;
}

export interface WorkspaceFile {
  path: string;
  relativePath: string;
  content: string;
  size: number;
}

export interface WorkspaceGitStatus {
  isRepository: boolean;
  branch: string | null;
  statusText: string;
  diffStat: string;
  error: string | null;
}

export interface UserCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type ExtensionType = "skill" | "plugin";

export interface ExtensionView {
  id: string;
  type: ExtensionType;
  name: string;
  description: string;
  sourcePath: string;
  installedPath: string;
  contentHash: string;
  enabled: boolean;
  createdAt: string;
  skillCount: number;
  mcpServerCount: number;
  mcpServerNames: string[];
  hookCount: number;
}

export interface ExtensionImportResult {
  imported: ExtensionView[];
  skipped: number;
  warnings: string[];
}

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  category: "curated" | "experimental" | "system";
  source: "openai" | "composio";
  path: string;
  sourceUrl: string;
  installed: boolean;
}

export interface MarketplaceInstallResult {
  skill: MarketplaceSkill;
  extension: ExtensionView;
}

export type McpTransport = "stdio" | "http";

export interface McpToolSummary {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  parameters: Record<string, unknown>;
}

export interface McpServerView {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  enabled: boolean;
  builtin: boolean;
  command: string;
  args: string[];
  cwd: string;
  url: string;
  timeoutMs: number;
  headerKeys: string[];
  envKeys: string[];
  oauthEnabled: boolean;
  oauthAuthenticated: boolean;
  configured: boolean;
  status: "disconnected" | "connected" | "error";
  tools: McpToolSummary[];
  lastError: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerSaveInput {
  id?: string;
  name: string;
  description: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  timeoutMs?: number;
  headerKeys?: string[];
  envKeys?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
  oauthEnabled?: boolean;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScope?: string;
}

export interface McpServerTestResult {
  ok: boolean;
  latencyMs: number;
  tools: McpToolSummary[];
  error: string | null;
}

export type BrowserProvider = "chrome" | "edge";

export interface BrowserStatus {
  connected: boolean;
  provider: BrowserProvider | null;
  url: string | null;
  title: string | null;
}

export interface GitHubConnectionStatus {
  configured: boolean;
  maskedHint: string | null;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ScheduledTaskView {
  id: string;
  name: string;
  prompt: string;
  sessionId: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskCreateInput {
  name: string;
  prompt: string;
  sessionId: string;
  intervalMinutes: number;
  enabled: boolean;
}
