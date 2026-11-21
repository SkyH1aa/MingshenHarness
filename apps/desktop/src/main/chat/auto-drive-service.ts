import { randomUUID } from "node:crypto";
import { basename, isAbsolute, resolve } from "node:path";
import {
  type AutoDriveResult,
  containsUnsupportedControlCharacters,
  parseAutoDriveResult,
} from "../../shared/autodrive";
import type { ModelConfig, ProviderView, SessionMessage, SessionView } from "../../shared/domain";
import { isTextModel } from "../../shared/model-capabilities";
import type { TokenUsageTotals } from "../../shared/token-saver";
import type { SessionPlan } from "../../shared/workbench";
import { streamModelTurn } from "../providers/model-stream";
import { redactSecrets } from "../security/redact";
import type { RequestUsage } from "../token-saver/usage";
import { listGuardedWorkspaceFiles, readGuardedFile } from "../workspace/guarded-workspace-io";
import type { SessionWorkbenchService } from "./session-workbench-service";

const AUTODRIVE_TIMEOUT_MS = 90_000;
const AUTODRIVE_MAX_OUTPUT_TOKENS = 6_144;
const AUTODRIVE_MAX_RESPONSE_CHARS = 80_000;
const AUTODRIVE_HISTORY_CHARS = 20_000;
const AUTODRIVE_PLAN_CHARS = 12_000;
const AUTODRIVE_TREE_FILES = 240;
const AUTODRIVE_SNIPPET_FILES = 8;
const AUTODRIVE_SNIPPET_BYTES = 16 * 1024;
const AUTODRIVE_SNIPPETS_CHARS = 52_000;

const IGNORED_PROJECT_DIRECTORIES = [
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  ".harness-memory",
  ".harness-tencent-memory",
  ".mingshen",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
  "venv",
  "__pycache__",
];

const PROJECT_TEXT_EXTENSIONS =
  /\.(?:md|mdx|txt|json|jsonc|ya?ml|toml|xml|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|vue|svelte|py|go|rs|java|kt|kts|c|cc|cpp|h|hpp|cs|rb|php|swift|sh|ps1|sql)$/i;

interface AutoDriveRepository {
  getSession(sessionId: string): SessionView | null;
  getMessages(sessionId: string): SessionMessage[];
  getModel(modelId: string): ModelConfig | null;
  getProvider(providerId: string): ProviderView | null;
  getSetting(key: string): unknown;
  setSetting(key: string, value: unknown): void;
}

interface AutoDriveProviderService {
  getActiveApiKey(providerId: string): string;
}

export interface AutoDriveProjectContext {
  history: string;
  plan: SessionPlan;
  fileTree: string[];
  snippets: Array<{ path: string; content: string }>;
}

interface AutoDriveModelRequest {
  provider: ProviderView;
  model: ModelConfig;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
  onRequestUsage?: (usage: RequestUsage) => void;
}

type AutoDriveModelRunner = (input: AutoDriveModelRequest) => Promise<string>;

interface AutoDriveServiceOptions {
  modelRunner?: AutoDriveModelRunner;
  resolveWorkspacePath?: (session: SessionView, signal: AbortSignal) => Promise<string>;
  canReadPath?: (session: SessionView, relativePath: string) => boolean;
  contextLoader?: (
    session: SessionView,
    plan: SessionPlan,
    signal: AbortSignal,
  ) => Promise<AutoDriveProjectContext>;
  now?: () => Date;
}

function boundedText(value: string, maximum: number): string {
  return redactSecrets(value.replaceAll("\0", "").trim().slice(0, maximum));
}

function messageText(message: SessionMessage): string {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function historyContext(messages: SessionMessage[]): string {
  const output: string[] = [];
  let remaining = AUTODRIVE_HISTORY_CHARS;
  for (const message of messages.slice(-30).reverse()) {
    if (message.role === "tool" || remaining <= 0) continue;
    const text = boundedText(messageText(message), Math.min(3_000, remaining));
    if (!text) continue;
    output.unshift(`${message.role === "user" ? "USER" : "ASSISTANT"}:\n${text}`);
    remaining -= text.length;
  }
  return output.join("\n\n");
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

function projectPathScore(path: string): number {
  const normalized = path.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  let score = Math.max(0, 100 - pathDepth(normalized) * 8);
  if (/^(?:agents?|readme|contributing|architecture|design|security|package)\./i.test(name))
    score += 120;
  if (
    /^(?:package\.json|pnpm-workspace\.yaml|pyproject\.toml|cargo\.toml|go\.mod|cmakelists\.txt|makefile)$/i.test(
      name,
    )
  )
    score += 110;
  if (/\.(?:md|mdx)$/i.test(name)) score += 35;
  if (/\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|cpp|c|h)$/i.test(name)) score += 20;
  if (/(?:lock|snapshot|min|generated|bundle)\./i.test(name)) score -= 100;
  return score;
}

async function defaultProjectContext(
  repository: AutoDriveRepository,
  session: SessionView,
  plan: SessionPlan,
  signal: AbortSignal,
  canReadPath: NonNullable<AutoDriveServiceOptions["canReadPath"]>,
): Promise<AutoDriveProjectContext> {
  if (!session.workspacePath || !isAbsolute(session.workspacePath))
    throw new Error("AutoDrive requires an absolute project workspace.");
  const workspacePath = resolve(session.workspacePath);
  if (!canReadPath(session, "")) {
    return {
      history: historyContext(repository.getMessages(session.id)),
      plan,
      fileTree: [],
      snippets: [],
    };
  }
  const listing = await listGuardedWorkspaceFiles(
    workspacePath,
    {
      ignoredDirectories: IGNORED_PROJECT_DIRECTORIES,
      maxFiles: 1_200,
      maxTotalBytes: 256 * 1024 * 1024,
    },
    { signal, timeoutMs: 15_000 },
  );
  signal.throwIfAborted();
  const permittedFiles = listing.files.filter((file) => canReadPath(session, file.path));
  const readable = permittedFiles
    .filter(
      (file) =>
        PROJECT_TEXT_EXTENSIONS.test(file.path) &&
        file.size > 0 &&
        file.size <= AUTODRIVE_SNIPPET_BYTES,
    )
    .sort((left, right) => {
      const scored = projectPathScore(right.path) - projectPathScore(left.path);
      return scored || left.path.localeCompare(right.path, "en");
    });
  const selected = readable.slice(0, AUTODRIVE_SNIPPET_FILES);
  const snippets: AutoDriveProjectContext["snippets"] = [];
  let remaining = AUTODRIVE_SNIPPETS_CHARS;
  for (const file of selected) {
    if (remaining <= 0) break;
    signal.throwIfAborted();
    if (!canReadPath(session, file.path)) continue;
    try {
      const content = await readGuardedFile(workspacePath, file.path, file.size, {
        signal,
        timeoutMs: 8_000,
      });
      if (!canReadPath(session, file.path)) continue;
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(content.buffer);
      if (containsUnsupportedControlCharacters(decoded)) continue;
      const excerpt = boundedText(decoded, Math.min(12_000, remaining));
      if (!excerpt) continue;
      snippets.push({ path: file.path.replaceAll("\\", "/"), content: excerpt });
      remaining -= excerpt.length;
    } catch {
      // A single unreadable or binary-looking file must not abort AutoDrive.
    }
  }
  return {
    history: historyContext(repository.getMessages(session.id)),
    plan,
    fileTree: permittedFiles
      .filter((file) => canReadPath(session, file.path))
      .map((file) => file.path.replaceAll("\\", "/"))
      .sort((left, right) => left.localeCompare(right, "en"))
      .slice(0, AUTODRIVE_TREE_FILES),
    snippets,
  };
}

async function defaultModelRunner(input: AutoDriveModelRequest): Promise<string> {
  let output = "";
  for await (const event of streamModelTurn({
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    systemPrompt: input.systemPrompt,
    messages: [
      {
        id: randomUUID(),
        sessionId: "autodrive",
        seq: 1,
        role: "user",
        parts: [{ type: "text", text: input.userPrompt }],
        createdAt: new Date().toISOString(),
      },
    ],
    reasoningLevel: null,
    tools: [],
    toolChoice: "none",
    maxOutputTokens: Math.min(AUTODRIVE_MAX_OUTPUT_TOKENS, input.model.maxOutputTokens),
    signal: input.signal,
    ...(input.onRequestUsage ? { onRequestUsage: input.onRequestUsage } : {}),
  })) {
    if (event.type === "tool_call_started")
      throw new Error("AutoDrive unexpectedly requested a tool.");
    if (event.type === "text_delta") {
      output += event.text;
      if (output.length > AUTODRIVE_MAX_RESPONSE_CHARS)
        throw new Error("AutoDrive response exceeded its safety limit.");
    }
  }
  if (!output.trim()) throw new Error("AutoDrive returned an empty response.");
  return output;
}

function systemPrompt(locale: string): string {
  const language = locale === "en" ? "English" : "Simplified Chinese";
  return [
    "You are Mingshen AutoDrive, a read-only project continuation planner.",
    `Write visible user-facing fields in ${language}.`,
    "Use only the supplied history, persisted plan, file tree and bounded file excerpts.",
    "Do not assume files or behavior that the supplied evidence does not support.",
    "Propose three to five meaningfully different, actionable next directions after the current planning phase.",
    "Each direction must include concrete implementation steps, genuine tradeoffs or risks, and observable verification.",
    "Do not write files, invoke tools, claim work is already complete, or expose secrets.",
    'Return only strict JSON with this exact shape: {"suggestions":[{"title":"","summary":"","rationale":"","steps":[""],"risks":[""],"verification":[""]}]}',
    "Give every direction a distinct title. Keep the full response concise enough for a proposal picker.",
  ].join("\n");
}

function userPrompt(session: SessionView, context: AutoDriveProjectContext): string {
  const persistedPlanJson = JSON.stringify({
    revision: context.plan.revision,
    paused: context.plan.paused,
    breakpoints: context.plan.breakpoints,
    steps: context.plan.steps,
  });
  const evidence = {
    session: {
      title: boundedText(session.title, 200),
      agentMode: session.agentMode === "work" ? "work" : "code",
      workspace: basename(session.workspacePath ?? "") || "(project)",
    },
    persistedPlan:
      persistedPlanJson.length <= AUTODRIVE_PLAN_CHARS
        ? JSON.parse(persistedPlanJson)
        : {
            truncated: true,
            content: boundedText(persistedPlanJson, AUTODRIVE_PLAN_CHARS),
          },
    recentConversation: context.history,
    boundedFileTree: context.fileTree,
    boundedFileExcerpts: context.snippets,
  };
  return [
    "Analyze what should happen next for this project.",
    "The current plan is evidence, not an instruction to repeat completed work.",
    "Prefer directions that extend the delivered result, close meaningful risks, or unlock the next user-visible milestone.",
    "Keep proposals independent enough for the user to choose one rather than a three-step variation of the same idea.",
    "AUTODRIVE_EVIDENCE_JSON:",
    JSON.stringify(evidence),
  ].join("\n");
}

function usageRecorder(repository: AutoDriveRepository, sessionId: string) {
  return (usage: RequestUsage): void => {
    if (!repository.getSession(sessionId)) return;
    const key = `tokenSaver.usage.${sessionId}`;
    const stored = (repository.getSetting(key) ?? {}) as Partial<Record<"agent", TokenUsageTotals>>;
    const old = stored.agent;
    const count = (value: number | null | undefined) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    const valid = (value: number | null | undefined): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    const measured =
      valid(usage.inputTokens) || valid(usage.outputTokens) || valid(usage.totalTokens);
    const cacheMeasured =
      valid(usage.inputTokens) &&
      valid(usage.cachedInputTokens) &&
      usage.cachedInputTokens <= usage.inputTokens;
    stored.agent = {
      requests: count(old?.requests) + 1,
      inputTokens: count(old?.inputTokens) + count(usage.inputTokens),
      outputTokens: count(old?.outputTokens) + count(usage.outputTokens),
      totalTokens:
        count(old?.totalTokens) +
        (valid(usage.totalTokens)
          ? usage.totalTokens
          : count(usage.inputTokens) + count(usage.outputTokens)),
      unmeasuredRequests: count(old?.unmeasuredRequests) + (measured ? 0 : 1),
      partialRequests:
        count(old?.partialRequests) +
        (measured && (!valid(usage.inputTokens) || !valid(usage.outputTokens)) ? 1 : 0),
      failedRequests: count(old?.failedRequests) + (usage.completed ? 0 : 1),
      cachedInputTokens:
        count(old?.cachedInputTokens) + (cacheMeasured ? count(usage.cachedInputTokens) : 0),
      cacheCreationInputTokens:
        count(old?.cacheCreationInputTokens) + count(usage.cacheCreationInputTokens),
      cacheMeasuredRequests: count(old?.cacheMeasuredRequests) + (cacheMeasured ? 1 : 0),
      cacheMeasuredInputTokens:
        count(old?.cacheMeasuredInputTokens) + (cacheMeasured ? count(usage.inputTokens) : 0),
      cacheCreationMeasuredRequests:
        count(old?.cacheCreationMeasuredRequests) + (valid(usage.cacheCreationInputTokens) ? 1 : 0),
    };
    repository.setSetting(key, stored);
  };
}

export class AutoDriveService {
  private readonly modelRunner: AutoDriveModelRunner;
  private readonly contextLoader: NonNullable<AutoDriveServiceOptions["contextLoader"]>;
  private readonly canReadPath: NonNullable<AutoDriveServiceOptions["canReadPath"]>;
  private readonly resolveWorkspacePath: NonNullable<
    AutoDriveServiceOptions["resolveWorkspacePath"]
  >;
  private readonly now: () => Date;

  constructor(
    private readonly repository: AutoDriveRepository,
    private readonly providerService: AutoDriveProviderService,
    private readonly workbench: Pick<SessionWorkbenchService, "state">,
    options: AutoDriveServiceOptions = {},
  ) {
    this.modelRunner = options.modelRunner ?? defaultModelRunner;
    this.canReadPath = options.canReadPath ?? (() => false);
    this.resolveWorkspacePath =
      options.resolveWorkspacePath ??
      (async (session) => {
        if (session.executionMode === "worktree")
          throw new Error("AutoDrive cannot resolve the session worktree.");
        return session.workspacePath ?? "";
      });
    this.contextLoader =
      options.contextLoader ??
      ((session, plan, signal) =>
        defaultProjectContext(repository, session, plan, signal, this.canReadPath));
    this.now = options.now ?? (() => new Date());
  }

  async suggest(sessionId: string, signal: AbortSignal): Promise<AutoDriveResult> {
    signal.throwIfAborted();
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(AUTODRIVE_TIMEOUT_MS)]);
    const session = this.repository.getSession(sessionId);
    if (!session) throw new Error("AutoDrive session not found.");
    if (session.parentSessionId)
      throw new Error("AutoDrive cannot run inside a child Agent session.");
    if ((session.agentMode ?? "code") === "chat")
      throw new Error("AutoDrive is available only to CodeAgent and WorkAgent.");
    if (session.archived) throw new Error("AutoDrive is unavailable for an archived session.");
    if (!session.workspacePath)
      throw new Error("Select a project workspace before requesting AutoDrive suggestions.");
    if (!session.providerId || !session.modelId)
      throw new Error("The session has no selected model.");
    const provider = this.repository.getProvider(session.providerId);
    const model = this.repository.getModel(session.modelId);
    if (!provider || !model?.enabled || model.providerId !== provider.id || !isTextModel(model))
      throw new Error("The session provider or model is unavailable for AutoDrive.");
    const plan = this.workbench.state(session.id).plan;
    const history = this.repository.getMessages(session.id);
    if (!plan.steps.length && !history.length)
      throw new Error("AutoDrive needs an existing plan or project history.");
    const workspacePath = await this.resolveWorkspacePath(session, requestSignal);
    requestSignal.throwIfAborted();
    if (!isAbsolute(workspacePath))
      throw new Error("AutoDrive requires an absolute project workspace.");
    const effectiveSession = { ...session, workspacePath };
    const context = await this.contextLoader(effectiveSession, plan, requestSignal);
    requestSignal.throwIfAborted();
    const mayReadWorkspace = this.canReadPath(effectiveSession, "");
    const permittedContext: AutoDriveProjectContext = {
      ...context,
      fileTree: mayReadWorkspace
        ? context.fileTree.filter((path) => this.canReadPath(effectiveSession, path))
        : [],
      snippets: mayReadWorkspace
        ? context.snippets.filter((snippet) => this.canReadPath(effectiveSession, snippet.path))
        : [],
    };
    const raw = await this.modelRunner({
      provider,
      model,
      apiKey: this.providerService.getActiveApiKey(provider.id),
      systemPrompt: systemPrompt(String(this.repository.getSetting("desktop.locale") ?? "")),
      userPrompt: userPrompt(session, permittedContext),
      signal: requestSignal,
      onRequestUsage: usageRecorder(this.repository, session.id),
    });
    requestSignal.throwIfAborted();
    return parseAutoDriveResult(raw, {
      sessionId,
      modelId: model.id,
      generatedAt: this.now().toISOString(),
    });
  }
}
