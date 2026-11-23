import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  MAX_CHAT_ATTACHMENT_TOTAL_BYTES,
  MAX_CHAT_ATTACHMENTS,
} from "../../shared/attachments";
import {
  COMPOSER_DRAFT_CONFLICT_MESSAGE,
  type ComposerDraft,
  type SaveComposerDraftInput,
  validateComposerDraftAttachment,
  validateComposerDraftId,
  validateComposerDraftInput,
} from "../../shared/composer-draft";
import type {
  AgentMode,
  AgentPermissionAction,
  AgentPermissionMap,
  AgentProfileRole,
  AgentProfileView,
  AnthropicNoneBehavior,
  ChatGroupView,
  ExtensionType,
  ExtensionView,
  InputModality,
  McpServerView,
  McpToolSummary,
  McpTransport,
  MessagePart,
  ModelConfig,
  PermissionMode,
  ProviderAuthMode,
  ProviderKeySummary,
  ProviderProtocol,
  ProviderView,
  ScheduledTaskView,
  SessionExecutionMode,
  SessionMessage,
  SessionTodo,
  SessionView,
  TrajectoryEvent,
} from "../../shared/domain";
import {
  MODEL_CATALOG_PREFERENCES_KEY,
  normalizeModelCatalogPreferences,
} from "../../shared/model-catalog";
import {
  normalizePromptCachingSettings,
  type PromptCachingSettings,
  providerPromptCachingKey,
} from "../../shared/prompt-caching";
import { queuedPromptSettingKey } from "../../shared/queued-prompt";
import { sessionBuiltinCapabilitiesSettingKey } from "../../shared/session-builtin-capabilities";
import type {
  SessionCatalogDelta,
  SessionPage,
  SessionPageInput,
} from "../../shared/session-catalog";
import { forkHostContext, hostContextKey } from "../chat/host-context";
import { warmStartupIndexes } from "./startup-index-warmup";

type Row = Record<string, unknown>;
type StoredComposerDraft = Omit<
  SaveComposerDraftInput,
  "sessionId" | "baseRevision" | "addedAttachments"
>;

const composerDraftKey = (sessionId: string) => `composer.draft.${sessionId}`;
const chatNetworkEnabledKey = (sessionId: string) => `chat.network.enabled.${sessionId}`;
const composerAttachmentPrefix = (sessionId: string) => `composer.draft-attachment.${sessionId}.`;
const composerAttachmentKey = (sessionId: string, id: string) =>
  `${composerAttachmentPrefix(sessionId)}${id}`;

interface ModelRecordInput {
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
}

interface SessionRecordInput {
  title: string;
  parentSessionId?: string | null;
  forkedFromMessageId?: string | null;
  agentMode?: AgentMode;
  chatGroupId?: string | null;
  providerId: string | null;
  modelId: string | null;
  agentProfileId: string;
  workspacePath: string | null;
  systemPrompt: string;
  reasoningLevel: string | null;
  permissionMode: PermissionMode;
  executionMode: SessionExecutionMode;
  patchOnly: boolean;
}

interface SessionRecordUpdate {
  title?: string | undefined;
  agentMode?: AgentMode | undefined;
  chatGroupId?: string | null | undefined;
  providerId?: string | undefined;
  modelId?: string | undefined;
  agentProfileId?: string | undefined;
  workspacePath?: string | null | undefined;
  systemPrompt?: string | undefined;
  reasoningLevel?: string | null | undefined;
  permissionMode?: PermissionMode | undefined;
  executionMode?: SessionExecutionMode | undefined;
  patchOnly?: boolean | undefined;
  archived?: boolean | undefined;
  pinned?: boolean | undefined;
  status?: SessionView["status"] | undefined;
}

interface McpServerRecordInput {
  id?: string | undefined;
  name: string;
  description: string;
  transport: McpTransport;
  command: string;
  args: string[];
  cwd: string;
  url: string;
  timeoutMs: number;
  enabled: boolean;
  builtin: boolean;
  headerKeys: string[];
  envKeys: string[];
  secretRef: string | null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asAgentMode(value: unknown): AgentMode {
  return value === "work" || value === "chat" ? value : "code";
}

function asApplicableAgentModes(value: unknown): Array<Exclude<AgentMode, "chat">> {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return ["code", "work"];
  const modes = parsed.filter(
    (item): item is "code" | "work" => item === "code" || item === "work",
  );
  return modes.length ? [...new Set(modes)] : ["code", "work"];
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function asBoolean(value: unknown): boolean {
  return asNumber(value) === 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseModalities(value: unknown): InputModality[] {
  return parseStringArray(value).filter(
    (item): item is InputModality =>
      item === "text" ||
      item === "image" ||
      item === "audio" ||
      item === "video" ||
      item === "file",
  );
}

function parseMessageParts(value: unknown): MessagePart[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as MessagePart[]) : [];
  } catch {
    return [];
  }
}

function parseAgentPermissions(value: unknown): AgentPermissionMap {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, AgentPermissionAction] =>
          entry[1] === "allow" || entry[1] === "ask" || entry[1] === "deny",
      ),
    );
  } catch {
    return {};
  }
}

function parseMcpTools(value: unknown): McpToolSummary[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object"),
          )
          .map((item) => ({
            name: asString(item.name),
            title: asString(item.title),
            description: asString(item.description),
            readOnly: Boolean(item.readOnly),
            parameters:
              item.parameters && typeof item.parameters === "object"
                ? (item.parameters as Record<string, unknown>)
                : { type: "object", additionalProperties: true },
          }))
          .filter((item) => item.name)
      : [];
  } catch {
    return [];
  }
}

export class Repository {
  constructor(private readonly database: DatabaseSync) {}

  warmStartupIndexes(): void {
    warmStartupIndexes(this.database);
  }

  listSettings(prefix: string): Array<{ key: string; value: unknown }> {
    return (
      this.database
        .prepare("select key, value_json from app_settings where substr(key,1,?)=? order by key")
        .all(prefix.length, prefix) as Row[]
    ).flatMap((row) => {
      try {
        return [{ key: asString(row.key), value: JSON.parse(asString(row.value_json)) as unknown }];
      } catch {
        return [];
      }
    });
  }

  recoverInterruptedRuns(): void {
    this.database
      .prepare(
        "update sessions set status = 'interrupted' where status in ('running', 'waiting_approval')",
      )
      .run();
    this.database.prepare("delete from app_settings where key like 'workbench.queued.%'").run();
    const rows = this.database
      .prepare("select key, value_json from app_settings where key like 'workbench.checkpoint.%'")
      .all() as Row[];
    for (const row of rows) {
      try {
        const checkpoint = JSON.parse(asString(row.value_json)) as {
          state: string;
          updatedAt: string;
        };
        if (checkpoint.state !== "running") continue;
        this.setSetting(asString(row.key), {
          ...checkpoint,
          state: "interrupted",
          updatedAt: new Date().toISOString(),
        });
      } catch {
        /* Leave invalid historical metadata available for diagnostics. */
      }
    }
  }

  listMcpServers(): McpServerView[] {
    const rows = this.database
      .prepare("select * from mcp_servers order by builtin desc, name asc")
      .all() as Row[];
    return rows.map((row) => this.mapMcpServer(row));
  }

  getMcpServer(id: string): McpServerView | null {
    const row = this.database.prepare("select * from mcp_servers where id = ?").get(id) as
      | Row
      | undefined;
    return row ? this.mapMcpServer(row) : null;
  }

  getMcpServerSecretRef(id: string): string | null {
    const row = this.database.prepare("select secret_ref from mcp_servers where id = ?").get(id) as
      | { secret_ref: string | null }
      | undefined;
    return row?.secret_ref ?? null;
  }

  updateMcpServerSecretRef(id: string, secretRef: string | null): void {
    this.database
      .prepare("update mcp_servers set secret_ref = ?, updated_at = ? where id = ?")
      .run(secretRef, new Date().toISOString(), id);
  }

  insertMcpServer(input: McpServerRecordInput): McpServerView {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `insert into mcp_servers (
          id, name, description, transport, command, args_json, url, enabled,
          cwd, timeout_ms, builtin, header_keys_json, env_keys_json, secret_ref, status, tools_json,
          last_error, last_connected_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disconnected', '[]', null, null, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        input.transport,
        input.command,
        JSON.stringify(input.args),
        input.url,
        input.enabled ? 1 : 0,
        input.cwd,
        input.timeoutMs,
        input.builtin ? 1 : 0,
        JSON.stringify(input.headerKeys),
        JSON.stringify(input.envKeys),
        input.secretRef,
        now,
        now,
      );
    const server = this.getMcpServer(id);
    if (!server) {
      throw new Error("MCP server insert failed.");
    }
    return server;
  }

  updateMcpServer(id: string, input: McpServerRecordInput): McpServerView {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `update mcp_servers
         set name = ?, description = ?, transport = ?, command = ?, args_json = ?,
             url = ?, enabled = ?, cwd = ?, timeout_ms = ?, header_keys_json = ?, env_keys_json = ?,
             secret_ref = ?, status = 'disconnected', tools_json = '[]',
             last_error = null, updated_at = ?
         where id = ?`,
      )
      .run(
        input.name,
        input.description,
        input.transport,
        input.command,
        JSON.stringify(input.args),
        input.url,
        input.enabled ? 1 : 0,
        input.cwd,
        input.timeoutMs,
        JSON.stringify(input.headerKeys),
        JSON.stringify(input.envKeys),
        input.secretRef,
        now,
        id,
      );
    const server = this.getMcpServer(id);
    if (!server) {
      throw new Error("MCP server 不存在。");
    }
    return server;
  }

  updateMcpServerStatus(
    id: string,
    input: {
      status: McpServerView["status"];
      tools?: McpToolSummary[];
      error?: string | null;
    },
  ): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `update mcp_servers
         set status = ?, tools_json = coalesce(?, tools_json), last_error = ?,
             last_connected_at = case when ? = 'connected' then ? else last_connected_at end,
             updated_at = ?
         where id = ?`,
      )
      .run(
        input.status,
        input.tools ? JSON.stringify(input.tools) : null,
        input.error ?? null,
        input.status,
        now,
        now,
        id,
      );
  }

  removeMcpServer(id: string): string | null {
    const server = this.getMcpServer(id);
    if (!server || server.builtin) {
      return null;
    }
    const secretRef = this.getMcpServerSecretRef(id);
    this.database.prepare("delete from mcp_servers where id = ?").run(id);
    return secretRef;
  }

  listProviders(): ProviderView[] {
    const rows = this.database
      .prepare("select * from providers order by created_at asc")
      .all() as Row[];

    return rows.map((row) => this.mapProvider(row));
  }

  getSetting(key: string): unknown | null {
    const row = this.database
      .prepare("select value_json from app_settings where key = ?")
      .get(key) as { value_json: string } | undefined;
    if (!row) {
      return null;
    }
    try {
      return JSON.parse(row.value_json) as unknown;
    } catch {
      return null;
    }
  }

  hasSetting(key: string): boolean {
    return this.database.prepare("select 1 from app_settings where key = ?").get(key) !== undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.database
      .prepare(
        `insert into app_settings (key, value_json, updated_at)
         values (?, ?, ?)
         on conflict(key) do update set
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  removeSetting(key: string): void {
    this.database.prepare("delete from app_settings where key = ?").run(key);
  }

  runInSavepoint<T>(operation: () => T): T {
    this.database.exec("savepoint mh_atomic_operation");
    try {
      const result = operation();
      this.database.exec("release mh_atomic_operation");
      return result;
    } catch (error) {
      this.database.exec("rollback to mh_atomic_operation; release mh_atomic_operation");
      throw error;
    }
  }

  private removeSettingsWithPrefix(prefix: string): void {
    this.database
      .prepare("delete from app_settings where substr(key, 1, ?) = ?")
      .run(prefix.length, prefix);
  }

  private copyBuiltinCapabilitySelection(sourceSessionId: string, targetSessionId: string): void {
    const sourceKey = sessionBuiltinCapabilitiesSettingKey(sourceSessionId);
    const selected = this.getSetting(sourceKey);
    if (selected === null) return;
    this.setSetting(sessionBuiltinCapabilitiesSettingKey(targetSessionId), selected);
  }

  private composerDraftMetadata(sessionId: string): StoredComposerDraft | null {
    const stored = this.getSetting(composerDraftKey(sessionId));
    if (stored === null) {
      if (
        this.database
          .prepare("select 1 from app_settings where key = ?")
          .get(composerDraftKey(sessionId))
      )
        throw new Error("Saved composer draft could not be read.");
      return null;
    }
    const input = { ...(stored as StoredComposerDraft), sessionId };
    validateComposerDraftInput(input);
    return {
      revision: input.revision,
      text: input.text,
      formatted: input.formatted,
      attachmentIds: input.attachmentIds,
      notificationDraftIds: input.notificationDraftIds,
    };
  }

  getComposerDraft(sessionId: string): ComposerDraft | null {
    validateComposerDraftId(sessionId);
    if (!this.getSession(sessionId)) return null;
    const stored = this.composerDraftMetadata(sessionId);
    if (!stored) return null;
    return {
      sessionId,
      revision: stored.revision,
      text: stored.text,
      formatted: stored.formatted,
      notificationDraftIds: stored.notificationDraftIds,
      attachments: stored.attachmentIds.map((id) => {
        const attachment = validateComposerDraftAttachment(
          this.getSetting(
            composerAttachmentKey(sessionId, id),
          ) as ComposerDraft["attachments"][number],
        );
        if (attachment.id !== id) throw new Error("Invalid saved composer attachment.");
        return attachment;
      }),
    };
  }

  hasComposerDraft(sessionId: string): boolean {
    try {
      const stored = this.composerDraftMetadata(sessionId);
      if (stored && (stored.text.length || stored.attachmentIds.length)) return true;
      const key = "desktop.notificationReplyDraft";
      const pending = this.getSetting(key);
      if (pending === null)
        return Boolean(this.database.prepare("select 1 from app_settings where key = ?").get(key));
      for (const value of Array.isArray(pending) ? pending : [pending]) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return true;
        const draft = value as Record<string, unknown>;
        if (typeof draft.sessionId !== "string" || typeof draft.text !== "string") return true;
        if (draft.sessionId === sessionId && draft.text.length) return true;
      }
      return false;
    } catch {
      // Retention must preserve damaged records for recovery rather than erase their session.
      return true;
    }
  }

  saveComposerDraft(input: SaveComposerDraftInput): void {
    validateComposerDraftInput(input);
    const additions = (input.addedAttachments ?? []).map(validateComposerDraftAttachment);
    const addedIds = new Set(additions.map((attachment) => attachment.id));
    const keptIds = new Set(input.attachmentIds);
    if (
      addedIds.size !== additions.length ||
      additions.some((attachment) => !keptIds.has(attachment.id))
    )
      throw new Error("Invalid composer draft attachment references.");
    if (input.attachmentIds.length > MAX_CHAT_ATTACHMENTS)
      throw new Error(`草稿最多保留 ${MAX_CHAT_ATTACHMENTS} 个附件。`);
    this.database.exec("savepoint save_composer_draft");
    try {
      if (!this.getSession(input.sessionId)) throw new Error("会话不存在。");
      const previous = this.composerDraftMetadata(input.sessionId);
      if (input.baseRevision !== undefined && input.baseRevision !== (previous?.revision ?? null))
        throw new Error(COMPOSER_DRAFT_CONFLICT_MESSAGE);
      const additionsById = new Map(additions.map((attachment) => [attachment.id, attachment]));
      let attachmentBytes = 0;
      for (const id of input.attachmentIds) {
        const added = additionsById.get(id);
        if (added) {
          attachmentBytes += added.size;
          continue;
        }
        const stored = this.getSetting(composerAttachmentKey(input.sessionId, id)) as {
          size?: unknown;
        } | null;
        if (!stored) throw new Error("Saved composer attachment is missing.");
        if (
          !Number.isSafeInteger(stored.size) ||
          (stored.size as number) < 0 ||
          (stored.size as number) > MAX_CHAT_ATTACHMENT_BYTES
        )
          throw new Error("Saved composer attachment size is invalid.");
        attachmentBytes += stored.size as number;
      }
      if (attachmentBytes > MAX_CHAT_ATTACHMENT_TOTAL_BYTES)
        throw new Error("草稿附件总大小不能超过 50 MiB。");
      for (const attachment of additions)
        this.setSetting(composerAttachmentKey(input.sessionId, attachment.id), attachment);
      if (input.text.length || input.attachmentIds.length || input.notificationDraftIds.length)
        this.setSetting(composerDraftKey(input.sessionId), {
          revision: input.revision,
          text: input.text,
          formatted: input.formatted,
          attachmentIds: input.attachmentIds,
          notificationDraftIds: input.notificationDraftIds,
        } satisfies StoredComposerDraft);
      else this.removeSetting(composerDraftKey(input.sessionId));
      for (const id of previous?.attachmentIds ?? [])
        if (!keptIds.has(id)) this.removeSetting(composerAttachmentKey(input.sessionId, id));
      this.database.exec("release save_composer_draft");
    } catch (error) {
      this.database.exec("rollback to save_composer_draft; release save_composer_draft");
      throw error;
    }
  }

  clearComposerDraft(sessionId: string, revision: string): boolean {
    validateComposerDraftId(sessionId);
    validateComposerDraftId(revision);
    this.database.exec("savepoint clear_composer_draft");
    try {
      const current = this.composerDraftMetadata(sessionId);
      const matches = Boolean(current?.revision === revision && this.getSession(sessionId));
      if (matches && current)
        this.saveComposerDraft({
          sessionId,
          baseRevision: revision,
          revision,
          text: "",
          formatted: false,
          attachmentIds: [],
          notificationDraftIds: current.notificationDraftIds,
        });
      this.database.exec("release clear_composer_draft");
      return matches;
    } catch (error) {
      this.database.exec("rollback to clear_composer_draft; release clear_composer_draft");
      throw error;
    }
  }

  listAgentProfiles(): AgentProfileView[] {
    const rows = this.database
      .prepare("select * from agent_profiles order by builtin desc, role asc, name asc")
      .all() as Row[];
    return rows.map((row) => this.mapAgentProfile(row));
  }

  getAgentProfile(id: string): AgentProfileView | null {
    const row = this.database.prepare("select * from agent_profiles where id = ?").get(id) as
      | Row
      | undefined;
    return row ? this.mapAgentProfile(row) : null;
  }

  saveAgentProfile(input: {
    id?: string;
    name: string;
    description: string;
    role: AgentProfileRole;
    instructions: string;
    modelId: string | null;
    readOnly: boolean;
    enabled: boolean;
    hidden?: boolean;
    sourcePath?: string | null;
    contentHash?: string | null;
    permissions?: AgentPermissionMap;
    toolAllowlist?: string[];
    temperature?: number | null;
    topP?: number | null;
    maxSteps?: number | null;
    color?: string | null;
    applicableModes?: Array<Exclude<AgentMode, "chat">>;
    builtin?: boolean;
  }): AgentProfileView {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const existing = input.id ? this.getAgentProfile(input.id) : null;
    const values = [
      input.name,
      input.description,
      input.role,
      input.instructions,
      input.modelId,
      input.readOnly ? 1 : 0,
      input.enabled ? 1 : 0,
      input.hidden ? 1 : 0,
      input.sourcePath?.trim() || null,
      input.contentHash?.trim() || null,
      JSON.stringify(input.permissions ?? {}),
      JSON.stringify(input.toolAllowlist ?? []),
      input.temperature ?? null,
      input.topP ?? null,
      input.maxSteps ?? null,
      input.color?.trim() || null,
      JSON.stringify(input.applicableModes ?? ["code", "work"]),
      now,
    ] as const;
    if (existing?.builtin) {
      this.database
        .prepare(
          `update agent_profiles set
            name = ?, description = ?, role = ?, instructions = ?, model_id = ?,
            read_only = ?, enabled = ?, hidden = ?, source_path = ?, content_hash = ?,
            permissions_json = ?, tool_allowlist_json = ?, temperature = ?, top_p = ?,
            max_steps = ?, color = ?, applicable_modes_json = ?, updated_at = ?
           where id = ?`,
        )
        .run(...values, id);
    } else {
      this.database
        .prepare(
          `insert into agent_profiles (
            id, name, description, role, instructions, model_id, read_only,
            builtin, enabled, hidden, source_path, content_hash, permissions_json,
            tool_allowlist_json, temperature, top_p, max_steps, color,
            applicable_modes_json, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            name = excluded.name,
            description = excluded.description,
            role = excluded.role,
            instructions = excluded.instructions,
            model_id = excluded.model_id,
            read_only = excluded.read_only,
            enabled = excluded.enabled,
            hidden = excluded.hidden,
            source_path = excluded.source_path,
            content_hash = excluded.content_hash,
            permissions_json = excluded.permissions_json,
            tool_allowlist_json = excluded.tool_allowlist_json,
            temperature = excluded.temperature,
            top_p = excluded.top_p,
            max_steps = excluded.max_steps,
            color = excluded.color,
            applicable_modes_json = excluded.applicable_modes_json,
            updated_at = excluded.updated_at`,
        )
        .run(id, ...values.slice(0, 6), input.builtin ? 1 : 0, ...values.slice(6), now);
    }
    const profile = this.getAgentProfile(id);
    if (!profile) {
      throw new Error("Agent 配置写入失败。");
    }
    return profile;
  }

  findAgentProfileBySource(sourcePath: string): AgentProfileView | null {
    const row = this.database
      .prepare("select * from agent_profiles where source_path = ?")
      .get(sourcePath) as Row | undefined;
    return row ? this.mapAgentProfile(row) : null;
  }

  removeAgentProfile(id: string): void {
    const profile = this.getAgentProfile(id);
    if (!profile) {
      return;
    }
    if (profile.builtin) {
      throw new Error("内置 Agent 配置不能删除。");
    }
    this.database.prepare("delete from agent_profiles where id = ?").run(id);
  }

  isProjectTrusted(path: string): boolean {
    const row = this.database
      .prepare("select trusted from project_trust where path = ?")
      .get(path) as { trusted: number } | undefined;
    return row ? asBoolean(row.trusted) : false;
  }

  setProjectTrusted(path: string, trusted: boolean): void {
    this.database
      .prepare(
        `insert into project_trust (path, trusted, updated_at)
         values (?, ?, ?)
         on conflict(path) do update set
           trusted = excluded.trusted,
           updated_at = excluded.updated_at`,
      )
      .run(path, trusted ? 1 : 0, new Date().toISOString());
  }

  listSessionTodos(sessionId: string): SessionTodo[] {
    const rows = this.database
      .prepare(
        `select * from session_todos
         where session_id = ?
         order by
           case priority when 'high' then 0 when 'medium' then 1 else 2 end,
           updated_at asc`,
      )
      .all(sessionId) as Row[];
    return rows.map((row) => ({
      id: asString(row.id),
      content: asString(row.content),
      status: asString(row.status) as SessionTodo["status"],
      priority: asString(row.priority) as SessionTodo["priority"],
      updatedAt: asString(row.updated_at),
    }));
  }

  replaceSessionTodos(
    sessionId: string,
    todos: SessionTodo[],
    planMetadata?: unknown,
  ): SessionTodo[] {
    this.database.exec("savepoint replace_session_todos");
    try {
      this.database.prepare("delete from session_todos where session_id = ?").run(sessionId);
      const updatedAt = new Date().toISOString();
      const insert = this.database.prepare(
        `insert into session_todos (
          session_id, id, content, status, priority, updated_at
        ) values (?, ?, ?, ?, ?, ?)`,
      );
      for (const todo of todos) {
        insert.run(
          sessionId,
          todo.id || randomUUID(),
          todo.content,
          todo.status,
          todo.priority,
          updatedAt,
        );
      }
      if (planMetadata !== undefined) this.setSetting(`workbench.plan.${sessionId}`, planMetadata);
      this.database.exec("release replace_session_todos");
    } catch (error) {
      this.database.exec("rollback to replace_session_todos; release replace_session_todos");
      throw error;
    }
    return this.listSessionTodos(sessionId);
  }

  listChildSessions(parentSessionId: string): SessionView[] {
    const rows = this.database
      .prepare("select * from sessions where parent_session_id = ? order by created_at asc")
      .all(parentSessionId) as Row[];
    return rows.map((row) => this.mapSession(row));
  }

  getProvider(providerId: string): ProviderView | null {
    const row = this.database.prepare("select * from providers where id = ?").get(providerId) as
      | Row
      | undefined;

    return row ? this.mapProvider(row) : null;
  }

  insertProvider(input: {
    name: string;
    baseUrl: string;
    protocol: ProviderProtocol;
    authMode: ProviderAuthMode;
    customHeaderName: string | null;
  }): ProviderView {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.database
      .prepare(
        `insert into providers (
          id, name, base_url, protocol, auth_mode, custom_header_name,
          active_key_id, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, null, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.baseUrl,
        input.protocol,
        input.authMode,
        input.customHeaderName,
        now,
        now,
      );

    const provider = this.getProvider(id);
    if (!provider) {
      throw new Error("Provider insert failed.");
    }

    return provider;
  }

  updateProvider(input: {
    providerId: string;
    name: string;
    baseUrl: string;
    protocol: ProviderProtocol;
    promptCaching?: PromptCachingSettings;
    authMode?: ProviderAuthMode;
    customHeaderName?: string | null;
  }): ProviderView {
    this.database.exec("savepoint update_provider_connection");
    try {
      const previous = this.database
        .prepare(
          "select base_url, protocol, auth_mode, custom_header_name from providers where id = ?",
        )
        .get(input.providerId) as
        | {
            base_url: string;
            protocol: ProviderProtocol;
            auth_mode: ProviderAuthMode;
            custom_header_name: string | null;
          }
        | undefined;
      if (!previous) throw new Error("供应商不存在。");
      const authMode = input.authMode ?? previous.auth_mode;
      const customHeaderName =
        input.customHeaderName === undefined ? previous.custom_header_name : input.customHeaderName;
      const result = this.database
        .prepare(
          "update providers set name = ?, base_url = ?, protocol = ?, auth_mode = ?, custom_header_name = ?, updated_at = ? where id = ?",
        )
        .run(
          input.name,
          input.baseUrl,
          input.protocol,
          authMode,
          customHeaderName,
          new Date().toISOString(),
          input.providerId,
        );
      if (!result.changes) throw new Error("供应商不存在。");
      if (input.promptCaching)
        this.setSetting(providerPromptCachingKey(input.providerId), input.promptCaching);
      if (
        previous.base_url !== input.baseUrl ||
        previous.protocol !== input.protocol ||
        previous.auth_mode !== authMode ||
        previous.custom_header_name !== customHeaderName
      ) {
        const sessions = this.database
          .prepare("select id from sessions where provider_id = ?")
          .all(input.providerId) as Array<{ id: string }>;
        for (const session of sessions)
          for (const name of ["observation", "view", "snapshot", "basis"])
            this.removeSetting(`context.${name}.${session.id}`);
      }
      const provider = this.getProvider(input.providerId);
      if (!provider) throw new Error("供应商不存在。");
      this.database.exec("release update_provider_connection");
      return provider;
    } catch (cause) {
      this.database.exec(
        "rollback to update_provider_connection; release update_provider_connection",
      );
      throw cause;
    }
  }

  deleteProvider(providerId: string): string[] {
    this.database.exec("savepoint delete_provider");
    try {
      const secretRows = this.database
        .prepare("select secret_ref from provider_keys where provider_id = ?")
        .all(providerId) as Array<{ secret_ref: string }>;
      const removed = this.database.prepare("delete from providers where id = ?").run(providerId);
      this.removeSetting(providerPromptCachingKey(providerId));
      if (removed.changes) this.pruneModelCatalogPreferences();
      this.database.exec("release delete_provider");
      return secretRows.map((row) => row.secret_ref);
    } catch (cause) {
      this.database.exec("rollback to delete_provider; release delete_provider");
      throw cause;
    }
  }

  private pruneModelCatalogPreferences(): void {
    const stored = this.getSetting(MODEL_CATALOG_PREFERENCES_KEY);
    if (stored === null) return;
    const preferences = normalizeModelCatalogPreferences(stored, this.listProviders());
    if (JSON.stringify(stored) !== JSON.stringify(preferences))
      this.setSetting(MODEL_CATALOG_PREFERENCES_KEY, preferences);
  }

  insertProviderKey(input: {
    providerId: string;
    label: string;
    secretRef: string;
    maskedHint: string;
    neverReveal: boolean;
    priority: number;
  }): void {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `insert into provider_keys (
          id, provider_id, label, secret_ref, masked_hint, enabled,
          priority, never_reveal, cooldown_until, created_at
        ) values (?, ?, ?, ?, ?, 1, ?, ?, null, ?)`,
      )
      .run(
        id,
        input.providerId,
        input.label,
        input.secretRef,
        input.maskedHint,
        input.priority,
        input.neverReveal ? 1 : 0,
        now,
      );

    const provider = this.getProvider(input.providerId);
    if (!provider?.activeKeyId) {
      this.setActiveKey(input.providerId, id);
    }
  }

  removeProviderKey(providerId: string, keyId: string): string | null {
    const row = this.database
      .prepare("select secret_ref from provider_keys where id = ? and provider_id = ?")
      .get(keyId, providerId) as { secret_ref: string } | undefined;

    if (!row) {
      return null;
    }

    this.database.prepare("delete from provider_keys where id = ?").run(keyId);

    const provider = this.getProvider(providerId);
    if (provider?.activeKeyId === keyId) {
      const next = this.database
        .prepare(
          "select id from provider_keys where provider_id = ? order by priority asc, created_at asc limit 1",
        )
        .get(providerId) as { id: string } | undefined;
      this.database
        .prepare("update providers set active_key_id = ?, updated_at = ? where id = ?")
        .run(next?.id ?? null, new Date().toISOString(), providerId);
    }

    return row.secret_ref;
  }

  updateProviderKey(input: {
    providerId: string;
    keyId: string;
    label: string;
    neverReveal: boolean;
    secretRef?: string;
    maskedHint?: string;
  }): string | null {
    const row = this.database
      .prepare("select secret_ref from provider_keys where id = ? and provider_id = ?")
      .get(input.keyId, input.providerId) as { secret_ref: string } | undefined;
    if (!row) {
      return null;
    }

    this.database
      .prepare(
        `update provider_keys
         set label = ?, never_reveal = ?,
             secret_ref = coalesce(?, secret_ref),
             masked_hint = coalesce(?, masked_hint)
         where id = ? and provider_id = ?`,
      )
      .run(
        input.label,
        input.neverReveal ? 1 : 0,
        input.secretRef ?? null,
        input.maskedHint ?? null,
        input.keyId,
        input.providerId,
      );
    this.database
      .prepare("update providers set updated_at = ? where id = ?")
      .run(new Date().toISOString(), input.providerId);

    return row.secret_ref;
  }

  setActiveKey(providerId: string, keyId: string): void {
    const key = this.database
      .prepare("select id from provider_keys where id = ? and provider_id = ?")
      .get(keyId, providerId);

    if (!key) {
      throw new Error("API Key 不属于该供应商。");
    }

    this.database
      .prepare("update providers set active_key_id = ?, updated_at = ? where id = ?")
      .run(keyId, new Date().toISOString(), providerId);
  }

  getActiveKey(providerId: string): {
    id: string;
    secretRef: string;
    label: string;
  } | null {
    const row = this.database
      .prepare(
        `select pk.id, pk.secret_ref, pk.label
         from providers p
         join provider_keys pk on pk.id = p.active_key_id
         where p.id = ? and pk.enabled = 1`,
      )
      .get(providerId) as { id: string; secret_ref: string; label: string } | undefined;

    return row ? { id: row.id, secretRef: row.secret_ref, label: row.label } : null;
  }

  insertModel(input: ModelRecordInput): void {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.database
      .prepare(
        `insert into models (
          id, provider_id, model_id, display_name, context_window, max_output_tokens,
          input_modalities, output_modalities, tool_calls, parallel_tool_calls,
          reasoning_levels, anthropic_none_behavior, enabled, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        input.providerId,
        input.modelId,
        input.displayName,
        input.contextWindow,
        input.maxOutputTokens,
        JSON.stringify(input.inputModalities),
        JSON.stringify(input.outputModalities),
        input.toolCalls ? 1 : 0,
        input.parallelToolCalls ? 1 : 0,
        JSON.stringify(input.reasoningLevels),
        input.anthropicNoneBehavior,
        now,
        now,
      );
  }

  updateModel(modelId: string, input: Omit<ModelRecordInput, "providerId">): string {
    const row = this.database.prepare("select provider_id from models where id = ?").get(modelId) as
      | { provider_id: string }
      | undefined;

    if (!row) {
      throw new Error("模型配置不存在。");
    }

    this.database
      .prepare(
        `update models set
          model_id = ?, display_name = ?, context_window = ?, max_output_tokens = ?,
          input_modalities = ?, output_modalities = ?, tool_calls = ?,
          parallel_tool_calls = ?, reasoning_levels = ?, anthropic_none_behavior = ?,
          updated_at = ?
        where id = ?`,
      )
      .run(
        input.modelId,
        input.displayName,
        input.contextWindow,
        input.maxOutputTokens,
        JSON.stringify(input.inputModalities),
        JSON.stringify(input.outputModalities),
        input.toolCalls ? 1 : 0,
        input.parallelToolCalls ? 1 : 0,
        JSON.stringify(input.reasoningLevels),
        input.anthropicNoneBehavior,
        new Date().toISOString(),
        modelId,
      );

    return row.provider_id;
  }

  removeModel(modelId: string): string {
    const row = this.database.prepare("select provider_id from models where id = ?").get(modelId) as
      | { provider_id: string }
      | undefined;

    if (!row) {
      throw new Error("模型配置不存在。");
    }

    this.database.exec("savepoint remove_model");
    try {
      this.database.prepare("delete from models where id = ?").run(modelId);
      this.pruneModelCatalogPreferences();
      this.database.exec("release remove_model");
      return row.provider_id;
    } catch (cause) {
      this.database.exec("rollback to remove_model; release remove_model");
      throw cause;
    }
  }

  getModel(modelConfigId: string): ModelConfig | null {
    const row = this.database.prepare("select * from models where id = ?").get(modelConfigId) as
      | Row
      | undefined;

    return row ? this.mapModel(row) : null;
  }

  findExtensionByHash(type: ExtensionType, contentHash: string): ExtensionView | null {
    const row = this.database
      .prepare("select * from agent_extensions where type = ? and content_hash = ?")
      .get(type, contentHash) as Row | undefined;
    return row ? this.mapExtension(row) : null;
  }

  insertExtension(input: {
    id: string;
    type: ExtensionType;
    name: string;
    description: string;
    sourcePath: string;
    installedPath: string;
    manifestJson: string;
    contentHash: string;
  }): ExtensionView {
    this.database
      .prepare(
        `insert into agent_extensions (
          id, type, name, description, source_path, installed_path,
          manifest_json, content_hash, enabled, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        input.id,
        input.type,
        input.name,
        input.description,
        input.sourcePath,
        input.installedPath,
        input.manifestJson,
        input.contentHash,
        new Date().toISOString(),
      );

    const extension = this.getExtension(input.id);
    if (!extension) {
      throw new Error("扩展写入失败。");
    }
    return extension;
  }

  updateExtensionInstall(input: {
    id: string;
    name: string;
    description: string;
    sourcePath: string;
    installedPath: string;
    manifestJson: string;
    contentHash: string;
  }): ExtensionView {
    const result = this.database
      .prepare(
        `update agent_extensions
         set name = ?, description = ?, source_path = ?, installed_path = ?,
             manifest_json = ?, content_hash = ?
         where id = ? and type = 'plugin'`,
      )
      .run(
        input.name,
        input.description,
        input.sourcePath,
        input.installedPath,
        input.manifestJson,
        input.contentHash,
        input.id,
      );
    if (!result.changes) throw new Error("要更新的插件不存在。");
    const extension = this.getExtension(input.id);
    if (!extension) throw new Error("插件更新后无法读取记录。");
    return extension;
  }

  getExtension(extensionId: string): ExtensionView | null {
    const row = this.database
      .prepare("select * from agent_extensions where id = ?")
      .get(extensionId) as Row | undefined;
    return row ? this.mapExtension(row) : null;
  }

  getExtensionManifest(extensionId: string): Record<string, unknown> | null {
    const row = this.database
      .prepare("select manifest_json from agent_extensions where id = ?")
      .get(extensionId) as { manifest_json: string } | undefined;
    if (!row) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(row.manifest_json);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  listExtensions(): ExtensionView[] {
    const rows = this.database
      .prepare("select * from agent_extensions order by type asc, name asc")
      .all() as Row[];
    return rows.map((row) => this.mapExtension(row));
  }

  setExtensionEnabled(extensionId: string, enabled: boolean): void {
    this.database
      .prepare("update agent_extensions set enabled = ? where id = ?")
      .run(enabled ? 1 : 0, extensionId);
  }

  removeExtension(extensionId: string): string | null {
    const extension = this.getExtension(extensionId);
    if (!extension) {
      return null;
    }
    this.database.prepare("delete from agent_extensions where id = ?").run(extensionId);
    return extension.installedPath;
  }

  listSessionExtensionIds(sessionId: string): string[] {
    const rows = this.database
      .prepare(
        `select se.extension_id
         from session_extensions se
         join agent_extensions e on e.id = se.extension_id
         where se.session_id = ? and se.enabled = 1 and e.enabled = 1`,
      )
      .all(sessionId) as Array<{ extension_id: string }>;
    return rows.map((row) => row.extension_id);
  }

  setSessionExtension(sessionId: string, extensionId: string, enabled: boolean): void {
    this.database
      .prepare(
        `insert into session_extensions (session_id, extension_id, enabled)
         values (?, ?, ?)
         on conflict(session_id, extension_id)
         do update set enabled = excluded.enabled`,
      )
      .run(sessionId, extensionId, enabled ? 1 : 0);
  }

  listScheduledTasks(): ScheduledTaskView[] {
    const rows = this.database
      .prepare("select * from scheduled_tasks order by enabled desc, next_run_at asc")
      .all() as Row[];
    return rows.map((row) => this.mapScheduledTask(row));
  }

  getScheduledTask(taskId: string): ScheduledTaskView | null {
    const row = this.database.prepare("select * from scheduled_tasks where id = ?").get(taskId) as
      | Row
      | undefined;
    return row ? this.mapScheduledTask(row) : null;
  }

  insertScheduledTask(input: {
    name: string;
    prompt: string;
    sessionId: string;
    intervalMinutes: number;
    enabled: boolean;
    nextRunAt: string;
  }): ScheduledTaskView {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `insert into scheduled_tasks (
          id, name, prompt, session_id, interval_minutes, enabled,
          last_run_at, next_run_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, null, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.prompt,
        input.sessionId,
        input.intervalMinutes,
        input.enabled ? 1 : 0,
        input.nextRunAt,
        now,
        now,
      );

    const task = this.getScheduledTask(id);
    if (!task) {
      throw new Error("定时任务写入失败。");
    }
    return task;
  }

  setScheduledTaskEnabled(taskId: string, enabled: boolean): ScheduledTaskView {
    const current = this.getScheduledTask(taskId);
    if (!current) {
      throw new Error("定时任务不存在。");
    }
    const now = new Date();
    const nextRunAt =
      enabled && new Date(current.nextRunAt).getTime() <= now.getTime()
        ? new Date(now.getTime() + current.intervalMinutes * 60_000).toISOString()
        : current.nextRunAt;

    this.database
      .prepare(
        "update scheduled_tasks set enabled = ?, next_run_at = ?, updated_at = ? where id = ?",
      )
      .run(enabled ? 1 : 0, nextRunAt, now.toISOString(), taskId);

    const task = this.getScheduledTask(taskId);
    if (!task) {
      throw new Error("定时任务更新失败。");
    }
    return task;
  }

  markScheduledTaskRun(taskId: string, fromTime = new Date()): ScheduledTaskView {
    const current = this.getScheduledTask(taskId);
    if (!current) {
      throw new Error("定时任务不存在。");
    }
    const nextRunAt = new Date(fromTime.getTime() + current.intervalMinutes * 60_000).toISOString();
    this.database
      .prepare(
        `update scheduled_tasks
         set last_run_at = ?, next_run_at = ?, updated_at = ?
         where id = ?`,
      )
      .run(fromTime.toISOString(), nextRunAt, new Date().toISOString(), taskId);

    const task = this.getScheduledTask(taskId);
    if (!task) {
      throw new Error("定时任务更新时间失败。");
    }
    return task;
  }

  removeScheduledTask(taskId: string): void {
    this.database.prepare("delete from scheduled_tasks where id = ?").run(taskId);
  }

  listSessions(): SessionView[] {
    const rows = this.database
      .prepare("select * from sessions order by pinned desc, updated_at desc")
      .all() as Row[];

    return rows.map((row) => this.mapSession(row));
  }

  listWorkspaceSessions(): SessionView[] {
    const rows = this.database
      .prepare(
        "select * from sessions where agent_mode in ('code', 'work') order by pinned desc, updated_at desc",
      )
      .all() as Row[];
    return rows.map((row) => this.mapSession(row));
  }

  sessionRevision(): number {
    return Number(
      this.database.prepare("select coalesce(max(seq),0) as revision from session_changes").get()
        ?.revision ?? 0,
    );
  }

  sessionPage(input: SessionPageInput = {}): SessionPage {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      (input.limit !== undefined && (!Number.isFinite(input.limit) || input.limit < 1)) ||
      (input.query !== undefined && typeof input.query !== "string") ||
      (input.cursor !== undefined &&
        input.cursor !== null &&
        (typeof input.cursor !== "string" || input.cursor.length > 8000)) ||
      (input.workspacePath !== undefined &&
        input.workspacePath !== null &&
        typeof input.workspacePath !== "string") ||
      (input.parentId !== undefined &&
        input.parentId !== null &&
        typeof input.parentId !== "string") ||
      (input.agentMode !== undefined &&
        !["code", "work", "chat", "workspace"].includes(input.agentMode)) ||
      (input.chatGroupId !== undefined &&
        input.chatGroupId !== null &&
        (typeof input.chatGroupId !== "string" || input.chatGroupId.length > 200)) ||
      (input.archived !== undefined && typeof input.archived !== "boolean")
    )
      throw new Error("Invalid session page request.");
    const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 100)));
    const query = (input.query ?? "").trim().slice(0, 500);
    const filters = ["s.archived = ?"];
    const values: Array<string | number | null> = [input.archived ? 1 : 0];
    if (input.agentMode === "workspace") filters.push("s.agent_mode in ('code', 'work')");
    else if (input.agentMode) {
      filters.push("s.agent_mode = ?");
      values.push(input.agentMode);
    } else filters.push("s.agent_mode <> 'chat'");
    if (input.chatGroupId !== undefined) {
      filters.push("s.chat_group_id is ?");
      values.push(input.chatGroupId);
    }
    if (input.parentId !== undefined) {
      filters.push("s.parent_session_id is ?");
      values.push(input.parentId);
    } else if (!query) filters.push("s.parent_session_id is null");
    if (input.workspacePath !== undefined) {
      filters.push("s.workspace_path is ?");
      values.push(input.workspacePath);
    }
    if (query) {
      if (query.length >= 3)
        filters.push(
          "s.rowid in (select rowid from session_title_search where session_title_search match ?)",
        );
      else filters.push("s.title like ? escape '\\'");
      values.push(
        query.length >= 3
          ? `"${query.replaceAll('"', '""')}"`
          : `%${query.replace(/[\\%_]/g, (value) => `\\${value}`)}%`,
      );
    }
    const where = filters.join(" and ");
    const total = Number(
      this.database
        .prepare(`select count(*) as total from sessions s where ${where}`)
        .get(...values)?.total ?? 0,
    );
    let offset = 0;
    let anchor: { pinned: number; time: string; id: string } | null = null;
    if (input.cursor) {
      const decoded = JSON.parse(Buffer.from(input.cursor, "base64url").toString()) as {
        offset?: number;
        query?: string;
        scope?: string;
        revision?: number;
        anchor?: { pinned: number; time: string; id: string };
      };
      const scope = JSON.stringify([
        input.workspacePath,
        input.parentId,
        Boolean(input.archived),
        input.agentMode ?? null,
        input.chatGroupId,
      ]);
      if (
        decoded.query !== query ||
        decoded.scope !== scope ||
        !Number.isSafeInteger(decoded.offset) ||
        Number(decoded.offset) < 0 ||
        Number(decoded.offset) > 1000000
      )
        throw new Error("Invalid session page cursor.");
      if (
        !decoded.anchor ||
        ![0, 1].includes(decoded.anchor.pinned) ||
        typeof decoded.anchor.time !== "string" ||
        typeof decoded.anchor.id !== "string"
      )
        throw new Error("Invalid session page anchor.");
      anchor = decoded.anchor;
      offset = Number(decoded.offset);
    }
    const anchorFilter = anchor
      ? " and (s.pinned < ? or (s.pinned=? and (max(s.last_opened_at,s.updated_at,s.created_at) < ? or (max(s.last_opened_at,s.updated_at,s.created_at)=? and s.id > ?))))"
      : "";
    const rows = this.database
      .prepare(
        `select s.*, (select count(*) from sessions c where c.parent_session_id=s.id and c.archived=0) as child_count from sessions s where ${where}${anchorFilter} order by s.pinned desc, max(s.last_opened_at,s.updated_at,s.created_at) desc, s.id limit ?`,
      )
      .all(
        ...values,
        ...(anchor ? [anchor.pinned, anchor.pinned, anchor.time, anchor.time, anchor.id] : []),
        limit + 1,
      ) as Row[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const revision = this.sessionRevision();
    return {
      sessions: rows.map((row) => this.mapSession(row)),
      total,
      revision,
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({
              offset: offset + rows.length,
              query,
              scope: JSON.stringify([
                input.workspacePath,
                input.parentId,
                Boolean(input.archived),
                input.agentMode ?? null,
                input.chatGroupId,
              ]),
              revision,
              anchor: rows.length
                ? {
                    pinned: asNumber(rows.at(-1)?.pinned),
                    time: [
                      asString(rows.at(-1)?.last_opened_at),
                      asString(rows.at(-1)?.updated_at),
                      asString(rows.at(-1)?.created_at),
                    ]
                      .sort()
                      .at(-1),
                    id: asString(rows.at(-1)?.id),
                  }
                : null,
            }),
          ).toString("base64url")
        : null,
    };
  }

  sessionDelta(after: number, ids: string[]): SessionCatalogDelta {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Array.isArray(ids) ||
      ids.length > 100000 ||
      ids.some((id) => typeof id !== "string" || id.length > 200)
    )
      throw new Error("Invalid session synchronization cursor.");
    const revision = this.sessionRevision();
    const minimum = Number(
      this.database.prepare("select coalesce(min(seq),0) as seq from session_changes").get()?.seq ??
        0,
    );
    if (after > revision || after < minimum - 1)
      return { revision, reset: true, sessions: [], removed: [] };
    const selected = new Set(ids);
    const changes = this.database
      .prepare(
        "select session_id,max(seq) as seq from session_changes where seq>? group by session_id",
      )
      .all(after) as Row[];
    const sessions: SessionView[] = [],
      removed: string[] = [];
    for (const change of changes) {
      const id = asString(change.session_id);
      const session = this.getSession(id);
      // A loaded row can be replaced in place. A new root can change catalog ordering, so the
      // client must reload its page instead of advancing past data it cannot apply.
      if (selected.has(id)) {
        if (!session || session.archived)
          return { revision, reset: true, sessions: [], removed: [] };
        sessions.push(session);
        continue;
      }
      if (!session || session.archived) continue;
      if (session.agentMode === "chat") {
        sessions.push(session);
        continue;
      }
      if (session.parentSessionId) {
        if (!selected.has(session.parentSessionId)) continue;
        const parent = this.getSession(session.parentSessionId);
        if (parent && !parent.archived && parent.agentMode !== "chat") sessions.push(session);
        continue;
      }
      return { revision, reset: true, sessions: [], removed: [] };
    }
    return { revision, reset: false, sessions, removed };
  }

  sessionWorkspacePaths(): string[] {
    return (
      this.database
        .prepare(
          "select distinct workspace_path from sessions where workspace_path is not null and agent_mode in ('code', 'work')",
        )
        .all() as Row[]
    ).map((row) => asString(row.workspace_path));
  }

  sessionGroups(): import("../../shared/session-catalog").SessionWorkspaceGroup[] {
    return (
      this.database
        .prepare(`select workspace_path, count(*) as total, max(max(last_opened_at,updated_at,created_at)) as latest,
      (select count(*) from sessions children join sessions parents on children.parent_session_id=parents.id where parents.workspace_path is roots.workspace_path and children.archived=0) as children
      from sessions roots where archived=0 and parent_session_id is null and agent_mode in ('code', 'work') group by workspace_path order by latest desc`)
        .all() as Row[]
    ).map((row) => ({
      path: asNullableString(row.workspace_path),
      total: asNumber(row.total),
      latest: asString(row.latest),
      children: asNumber(row.children),
    }));
  }

  listChatGroups(): ChatGroupView[] {
    const rows = this.database
      .prepare("select * from chat_groups order by updated_at desc, name collate nocase asc")
      .all() as Row[];
    return rows.map((row) => this.mapChatGroup(row));
  }

  getChatGroup(id: string): ChatGroupView | null {
    const row = this.database.prepare("select * from chat_groups where id = ?").get(id) as
      | Row
      | undefined;
    return row ? this.mapChatGroup(row) : null;
  }

  createChatGroup(name: string): ChatGroupView {
    const normalized = this.validateChatGroupName(name);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare("insert into chat_groups (id, name, created_at, updated_at) values (?, ?, ?, ?)")
      .run(id, normalized, now, now);
    return this.getChatGroup(id) as ChatGroupView;
  }

  renameChatGroup(id: string, name: string): ChatGroupView {
    if (!this.getChatGroup(id)) throw new Error("聊天分组不存在。");
    const normalized = this.validateChatGroupName(name);
    this.database
      .prepare("update chat_groups set name = ?, updated_at = ? where id = ?")
      .run(normalized, new Date().toISOString(), id);
    return this.getChatGroup(id) as ChatGroupView;
  }

  removeChatGroup(id: string): void {
    if (!this.getChatGroup(id)) return;
    this.database.exec("savepoint remove_chat_group");
    try {
      this.database
        .prepare("update sessions set chat_group_id = null, updated_at = ? where chat_group_id = ?")
        .run(new Date().toISOString(), id);
      this.database.prepare("delete from chat_groups where id = ?").run(id);
      this.database.exec("release remove_chat_group");
    } catch (error) {
      this.database.exec("rollback to remove_chat_group; release remove_chat_group");
      throw error;
    }
  }

  getSession(sessionId: string): SessionView | null {
    const row = this.database
      .prepare(
        "select s.*, (select count(*) from sessions c where c.parent_session_id=s.id and c.archived=0) as child_count from sessions s where s.id = ?",
      )
      .get(sessionId) as Row | undefined;

    return row ? this.mapSession(row) : null;
  }

  forkSession(sessionId: string, messageId?: string | null): SessionView {
    const source = this.getSession(sessionId);
    if (!source) throw new Error("会话不存在。");
    const history = this.getMessages(sessionId);
    const target = messageId ? history.find((message) => message.id === messageId) : history.at(-1);
    if (messageId && !target) throw new Error("分支消息不存在或不属于当前会话。");
    const messages = history.filter((message) => message.seq <= (target?.seq ?? 0));
    const pending = new Set<string>();
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === "tool_call") pending.add(part.callId);
        if (part.type === "tool_result") pending.delete(part.callId);
      }
    }
    if (pending.size) throw new Error("当前记录包含未完成的工具调用，请选择完整步骤后再分支。");
    this.database.exec("savepoint fork_conversation");
    try {
      const fork = this.insertSession({
        ...source,
        title: `${source.title.slice(0, 110)} · ${this.getSetting("desktop.locale") === "en" ? "Fork" : "分支"}`,
        parentSessionId: null,
        forkedFromMessageId: target?.id ?? null,
      });
      const mapped = new Map<string, SessionMessage>();
      const insert = this.database.prepare(
        "insert into messages (id, session_id, seq, role, parts_json, created_at) values (?, ?, ?, ?, ?, ?)",
      );
      for (const message of messages) {
        const copied = { ...message, id: randomUUID(), sessionId: fork.id };
        insert.run(
          copied.id,
          fork.id,
          copied.seq,
          copied.role,
          JSON.stringify(copied.parts),
          copied.createdAt,
        );
        mapped.set(message.id, copied);
      }
      // Copied summaries/tool receipts may cite an earlier branch's message IDs.
      // Resolve those IDs only to copies in the new conversation, never to its source.
      const recallAliases = Object.fromEntries(
        [...mapped].map(([id, message]) => [id, message.id]),
      );
      const inheritedAliases = this.getSetting(`tokenSaver.aliases.${source.id}`);
      if (inheritedAliases && typeof inheritedAliases === "object") {
        for (const [alias, id] of Object.entries(inheritedAliases)) {
          const copied = typeof id === "string" ? mapped.get(id) : null;
          if (copied) recallAliases[alias] = copied.id;
        }
      }
      if (mapped.size) this.setSetting(`tokenSaver.aliases.${fork.id}`, recallAliases);
      const hostContext = forkHostContext(this.getSetting(hostContextKey(source.id)), mapped);
      if (hostContext.length) this.setSetting(hostContextKey(fork.id), hostContext);
      for (const extensionId of this.listSessionExtensionIds(source.id))
        this.setSessionExtension(fork.id, extensionId, true);
      this.copyBuiltinCapabilitySelection(source.id, fork.id);
      // Copy durable conversation state only. Pending approvals, grants and tasks are independent.
      if (source.agentMode === "chat" && source.chatNetworkEnabled === false)
        this.setSetting(chatNetworkEnabledKey(fork.id), false);
      if (source.approvalMode === "automatic")
        this.setSetting(`permissions.approval.${fork.id}`, "automatic");
      if (source.compactionModel)
        this.setSetting(`context.model.${fork.id}`, source.compactionModel);
      const checkpoint = this.getSetting(`context.checkpoint.${source.id}`) as {
        id: string;
        throughSeq: number;
        throughId: string;
        summary: string;
        createdAt: string;
      } | null;
      const through = checkpoint ? mapped.get(checkpoint.throughId) : null;
      if (
        checkpoint &&
        through?.seq === checkpoint.throughSeq &&
        typeof checkpoint.summary === "string"
      )
        this.setSetting(`context.checkpoint.${fork.id}`, {
          ...checkpoint,
          id: randomUUID(),
          throughId: through.id,
        });
      const todoInsert = this.database.prepare(
        "insert into session_todos (session_id, id, content, status, priority, updated_at) values (?, ?, ?, ?, ?, ?)",
      );
      if (!messageId || target?.id === history.at(-1)?.id)
        for (const todo of this.listSessionTodos(source.id))
          todoInsert.run(
            fork.id,
            todo.id,
            todo.content,
            todo.status,
            todo.priority,
            todo.updatedAt,
          );
      if (!messageId || target?.id === history.at(-1)?.id) {
        const plan = this.getSetting(`workbench.plan.${source.id}`);
        if (plan) this.setSetting(`workbench.plan.${fork.id}`, plan);
      }
      this.database.exec("release fork_conversation");
      return this.getSession(fork.id) ?? fork;
    } catch (error) {
      this.database.exec("rollback to fork_conversation; release fork_conversation");
      throw error;
    }
  }

  insertSession(input: SessionRecordInput): SessionView {
    const parent = input.parentSessionId ? this.getSession(input.parentSessionId) : null;
    if (input.parentSessionId && !parent) throw new Error("父会话不存在。");
    if (parent?.agentMode === "chat") throw new Error("ChatAgent 不支持子 Agent。");
    const agentMode = input.agentMode ?? parent?.agentMode ?? "code";
    if (parent && agentMode !== parent.agentMode)
      throw new Error("子 Agent 必须继承父会话的 CodeAgent/WorkAgent 模式。");
    const id = randomUUID();
    const now = new Date().toISOString();

    this.database
      .prepare(
        `insert into sessions (
          id, title, parent_session_id, forked_from_message_id,
          agent_mode, chat_group_id,
          provider_id, model_id, agent_profile_id, workspace_path, system_prompt,
          reasoning_level, permission_mode, execution_mode, patch_only,
          status, archived, pinned,
          created_at, updated_at, last_opened_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 0, 0, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.parentSessionId ?? null,
        input.forkedFromMessageId ?? null,
        asAgentMode(agentMode),
        input.chatGroupId ?? null,
        input.providerId,
        input.modelId,
        input.agentProfileId,
        input.workspacePath,
        input.systemPrompt,
        input.reasoningLevel,
        input.permissionMode,
        input.executionMode,
        input.patchOnly ? 1 : 0,
        now,
        now,
        now,
      );

    const session = this.getSession(id);
    if (!session) {
      throw new Error("Session insert failed.");
    }
    if (parent) this.copyBuiltinCapabilitySelection(parent.id, session.id);

    return session;
  }

  updateSession(sessionId: string, update: SessionRecordUpdate): SessionView {
    const current = this.getSession(sessionId);
    if (!current) {
      throw new Error("会话不存在。");
    }

    const next = {
      title: update.title ?? current.title,
      agentMode: update.agentMode ?? current.agentMode ?? "code",
      chatGroupId:
        update.chatGroupId === undefined ? (current.chatGroupId ?? null) : update.chatGroupId,
      providerId: update.providerId ?? current.providerId,
      modelId: update.modelId ?? current.modelId,
      agentProfileId: update.agentProfileId ?? current.agentProfileId,
      workspacePath:
        update.workspacePath === undefined ? current.workspacePath : update.workspacePath,
      systemPrompt: update.systemPrompt ?? current.systemPrompt,
      reasoningLevel:
        update.reasoningLevel === undefined ? current.reasoningLevel : update.reasoningLevel,
      permissionMode: update.permissionMode ?? current.permissionMode,
      executionMode: update.executionMode ?? current.executionMode,
      patchOnly: update.patchOnly ?? current.patchOnly,
      status: update.status ?? current.status,
      archived: update.archived ?? current.archived,
      pinned: update.pinned ?? current.pinned,
    };

    this.database
      .prepare(
        `update sessions set
          title = ?, agent_mode = ?, chat_group_id = ?,
          provider_id = ?, model_id = ?, agent_profile_id = ?, workspace_path = ?,
          system_prompt = ?, reasoning_level = ?, permission_mode = ?,
          execution_mode = ?, patch_only = ?,
          status = ?, archived = ?, pinned = ?, updated_at = ?
        where id = ?`,
      )
      .run(
        next.title,
        next.agentMode,
        next.chatGroupId,
        next.providerId,
        next.modelId,
        next.agentProfileId,
        next.workspacePath,
        next.systemPrompt,
        next.reasoningLevel,
        next.permissionMode,
        next.executionMode,
        next.patchOnly ? 1 : 0,
        next.status,
        next.archived ? 1 : 0,
        next.pinned ? 1 : 0,
        new Date().toISOString(),
        sessionId,
      );

    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error("Session update failed.");
    }

    return session;
  }

  removeSession(sessionId: string): void {
    this.database.prepare("delete from sessions where id = ?").run(sessionId);
    this.database
      .prepare("delete from app_settings where key = ?")
      .run(`permissions.approval.${sessionId}`);
    this.removeSetting(chatNetworkEnabledKey(sessionId));
    for (const name of ["model", "checkpoint", "observation", "view", "snapshot", "basis"])
      this.removeSetting(`context.${name}.${sessionId}`);
    this.removeSetting(`workbench.plan.${sessionId}`);
    this.removeSetting(`workbench.checkpoint.${sessionId}`);
    this.removeSetting(`workbench.queued.${sessionId}`);
    this.removeSetting(`workbench.ledger.${sessionId}`);
    this.removeSetting(`workbench.recovery.${sessionId}`);
    this.removeSetting(`coordination.state.${sessionId}`);
    this.removeSetting(`runSteering.v1.${sessionId}`);
    this.removeSetting(`session.project-context.${sessionId}`);
    this.removeSetting(`tokenSaver.report.${sessionId}`);
    this.removeSetting(`tokenSaver.usage.${sessionId}`);
    this.removeSetting(`tokenSaver.summary.${sessionId}`);
    this.removeSetting(`tokenSaver.aliases.${sessionId}`);
    this.removeSetting(`tokenSaver.input.${sessionId}`);
    this.removeSetting(`tokenSaver.cache.${sessionId}`);
    this.removeSetting(hostContextKey(sessionId));
    this.removeSetting(composerDraftKey(sessionId));
    this.removeSetting(queuedPromptSettingKey(sessionId));
    this.removeSetting(sessionBuiltinCapabilitiesSettingKey(sessionId));
    this.removeSettingsWithPrefix(composerAttachmentPrefix(sessionId));
    this.removeSettingsWithPrefix(`tool.output.${sessionId}.`);
  }

  touchSession(sessionId: string): void {
    this.database
      .prepare("update sessions set last_opened_at = ? where id = ?")
      .run(new Date().toISOString(), sessionId);
  }

  latestSessionRun(sessionId: string): import("../../shared/domain").SessionRunState | null {
    const started = this.database
      .prepare(
        "select run_id, created_at from trajectories where session_id = ? and type = 'run_started' order by created_at desc, rowid desc limit 1",
      )
      .get(sessionId) as Row | undefined;
    if (!started) return null;
    const finished = this.database
      .prepare(
        "select type, created_at from trajectories where session_id = ? and run_id = ? and type in ('run_completed', 'run_interrupted', 'run_failed') order by sequence desc limit 1",
      )
      .get(sessionId, asString(started.run_id)) as Row | undefined;
    return {
      sessionId,
      runId: asString(started.run_id),
      startedAt: asString(started.created_at),
      completedAt: finished ? asString(finished.created_at) : null,
      status:
        finished?.type === "run_completed"
          ? "completed"
          : finished?.type === "run_failed"
            ? "failed"
            : finished
              ? "interrupted"
              : "running",
    };
  }

  getMessages(sessionId: string): SessionMessage[] {
    const rows = this.database
      .prepare("select * from messages where session_id = ? order by seq asc")
      .all(sessionId) as Row[];

    return rows.map((row) => ({
      id: asString(row.id),
      sessionId: asString(row.session_id),
      seq: asNumber(row.seq),
      role: asString(row.role) as SessionMessage["role"],
      parts: parseMessageParts(row.parts_json),
      createdAt: asString(row.created_at),
    }));
  }

  subagentOutput(
    parentId: string,
    sessionId: string,
  ): import("../../shared/workbench").SubagentOutputPreview {
    const child = this.getSession(sessionId);
    if (!this.getSession(parentId) || !child || child.parentSessionId !== parentId)
      throw new Error("子会话不存在或不属于当前会话。");
    // Bound the query and each extracted text; do not transfer attachments or full history.
    const rows = this.database
      .prepare(`
      select m.id, m.seq, cast(p.key as integer) part_index,
        json_extract(p.value, '$.type') kind,
        substr(coalesce(json_extract(p.value, '$.text'), json_extract(p.value, '$.message'), json_extract(p.value, '$.output'), ''), -12000) text,
        length(coalesce(json_extract(p.value, '$.text'), json_extract(p.value, '$.message'), json_extract(p.value, '$.output'), '')) text_length,
        json_extract(p.value, '$.name') tool_name, json_extract(p.value, '$.isError') is_error
      from (select id, seq, parts_json from messages where session_id=? and role in ('assistant','tool') order by seq desc limit 17) m,
        json_each(m.parts_json) p
      where json_extract(p.value, '$.type') in ('text','reasoning','tool_call','tool_result','error')
      order by m.seq desc, cast(p.key as integer) desc limit 25
    `)
      .all(sessionId) as Row[];
    const preview: import("../../shared/workbench").SubagentOutputPreview = {
      sessionId,
      truncated:
        rows.length > 24 ||
        Boolean(
          rows.length &&
            this.database
              .prepare(
                "select 1 from messages where session_id=? and role in ('assistant','tool') and seq<? limit 1",
              )
              .get(sessionId, Math.min(...rows.map((row) => asNumber(row.seq)))),
        ),
      parts: [],
    };
    let remaining = 48000;
    for (const row of rows.slice(0, 24)) {
      if (remaining <= 0) {
        preview.truncated = true;
        break;
      }
      const text = asString(row.text).slice(-remaining);
      const kind = asString(row.kind);
      remaining -= text.length;
      preview.truncated ||= asNumber(row.text_length) > text.length;
      preview.parts.push({
        id: `${asString(row.id)}:${asNumber(row.part_index)}`,
        kind:
          kind === "reasoning"
            ? "reasoning"
            : kind === "error"
              ? "error"
              : kind.startsWith("tool_")
                ? "tool"
                : "text",
        text,
        toolName: typeof row.tool_name === "string" ? row.tool_name : null,
        isError: Boolean(row.is_error) || kind === "error",
      });
    }
    preview.parts.reverse();
    return preview;
  }

  contextHistoryStamp(sessionId: string): string {
    let before = Number.MAX_SAFE_INTEGER;
    const last = this.database.prepare(
      "select id, seq, parts_json from messages where session_id = ? and seq < ? order by seq desc limit 1",
    );
    for (;;) {
      const row = last.get(sessionId, before) as Row | undefined;
      if (!row) return "empty";
      const seq = asNumber(row.seq);
      if (
        parseMessageParts(row.parts_json).some((part) =>
          ["text", "attachment", "tool_call", "tool_result"].includes(part.type),
        )
      )
        return `${asString(row.id)}:${seq}`;
      before = seq;
    }
  }

  getMessage(sessionId: string, messageId: string): SessionMessage | null {
    const row = this.database
      .prepare("select * from messages where session_id = ? and id = ?")
      .get(sessionId, messageId) as Row | undefined;
    if (!row) {
      return null;
    }
    return {
      id: asString(row.id),
      sessionId: asString(row.session_id),
      seq: asNumber(row.seq),
      role: asString(row.role) as SessionMessage["role"],
      parts: parseMessageParts(row.parts_json),
      createdAt: asString(row.created_at),
    };
  }

  deleteMessagesFromSeq(sessionId: string, fromSeq: number): void {
    const deletedRows = this.database
      .prepare("select parts_json from messages where session_id = ? and seq >= ?")
      .all(sessionId, fromSeq) as Row[];
    const deletedCallIds = new Set<string>();
    for (const row of deletedRows) {
      for (const part of parseMessageParts(row.parts_json)) {
        if ("callId" in part && typeof part.callId === "string" && part.callId) {
          deletedCallIds.add(part.callId);
        }
      }
    }
    if (deletedCallIds.size) {
      const outputPrefix = `tool.output.${sessionId}.`;
      const removedOutputIds = new Set(
        [...deletedCallIds].map((callId) => createHash("sha256").update(callId).digest("hex")),
      );
      for (const outputId of removedOutputIds) this.removeSetting(`${outputPrefix}${outputId}`);
      const index = this.getSetting(`${outputPrefix}index`);
      if (Array.isArray(index)) {
        const retained = index.filter(
          (entry) =>
            !(
              entry &&
              typeof entry === "object" &&
              typeof (entry as { id?: unknown }).id === "string" &&
              removedOutputIds.has((entry as { id: string }).id)
            ),
        );
        if (retained.length) this.setSetting(`${outputPrefix}index`, retained);
        else this.removeSetting(`${outputPrefix}index`);
      }
    }
    this.removeSetting(`tokenSaver.report.${sessionId}`);
    this.removeSetting(`tokenSaver.summary.${sessionId}`);
    this.removeSetting(`tokenSaver.input.${sessionId}`);
    this.removeSetting(`tokenSaver.cache.${sessionId}`);
    this.removeSetting(hostContextKey(sessionId));
    this.removeSetting(`workbench.checkpoint.${sessionId}`);
    this.removeSetting(`workbench.ledger.${sessionId}`);
    this.removeSetting(`workbench.recovery.${sessionId}`);
    const checkpoint = this.getSetting(`context.checkpoint.${sessionId}`) as {
      throughSeq?: number;
    } | null;
    if (checkpoint && typeof checkpoint.throughSeq === "number" && fromSeq <= checkpoint.throughSeq)
      this.removeSetting(`context.checkpoint.${sessionId}`);
    this.removeSetting(`context.observation.${sessionId}`);
    this.removeSetting(`context.view.${sessionId}`);
    this.removeSetting(`context.snapshot.${sessionId}`);
    this.removeSetting(`context.basis.${sessionId}`);
    this.database
      .prepare("delete from messages where session_id = ? and seq >= ?")
      .run(sessionId, fromSeq);
  }

  replaceMessagesFromSeq(
    sessionId: string,
    fromSeq: number,
    input: {
      role: SessionMessage["role"];
      parts: MessagePart[];
      draftRevision?: string;
      draftSessionId?: string;
    },
  ): SessionMessage {
    this.database.exec("savepoint replace_conversation_tail");
    try {
      this.deleteMessagesFromSeq(sessionId, fromSeq);
      const message = this.appendMessage({ sessionId, ...input });
      this.database.exec("release replace_conversation_tail");
      return message;
    } catch (error) {
      this.database.exec(
        "rollback to replace_conversation_tail; release replace_conversation_tail",
      );
      throw error;
    }
  }

  appendMessage(input: {
    sessionId: string;
    role: SessionMessage["role"];
    parts: MessagePart[];
    draftRevision?: string;
    draftSessionId?: string;
  }): SessionMessage {
    if (input.draftRevision !== undefined) {
      validateComposerDraftId(input.draftRevision);
      if (input.draftSessionId !== undefined) validateComposerDraftId(input.draftSessionId);
      if (input.role !== "user") throw new Error("Only accepted user messages consume drafts.");
      this.database.exec("savepoint append_composer_message");
    }
    try {
      const nextSeq =
        asNumber(
          (
            this.database
              .prepare("select coalesce(max(seq), 0) + 1 as seq from messages where session_id = ?")
              .get(input.sessionId) as { seq: number } | undefined
          )?.seq,
        ) || 1;
      const id = randomUUID();
      const createdAt = new Date().toISOString();

      this.database
        .prepare(
          `insert into messages (id, session_id, seq, role, parts_json, created_at)
           values (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.sessionId, nextSeq, input.role, JSON.stringify(input.parts), createdAt);
      this.database
        .prepare("update sessions set updated_at = ? where id = ?")
        .run(createdAt, input.sessionId);
      if (input.draftRevision !== undefined) {
        this.clearComposerDraft(input.draftSessionId ?? input.sessionId, input.draftRevision);
        this.database.exec("release append_composer_message");
      }
      return {
        id,
        sessionId: input.sessionId,
        seq: nextSeq,
        role: input.role,
        parts: input.parts,
        createdAt,
      };
    } catch (error) {
      if (input.draftRevision !== undefined)
        this.database.exec("rollback to append_composer_message; release append_composer_message");
      throw error;
    }
  }

  appendTrajectoryEvent(input: {
    sessionId: string;
    runId: string;
    type: string;
    summary: string;
    payload: unknown;
  }): TrajectoryEvent {
    const sequence =
      asNumber(
        (
          this.database
            .prepare(
              "select coalesce(max(sequence), 0) + 1 as sequence from trajectories where run_id = ?",
            )
            .get(input.runId) as { sequence: number } | undefined
        )?.sequence,
      ) || 1;
    const event: TrajectoryEvent = {
      id: randomUUID(),
      runId: input.runId,
      sessionId: input.sessionId,
      sequence,
      type: input.type,
      summary: input.summary,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        `insert into trajectories (
          id, session_id, run_id, sequence, type, summary, payload_json, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.sessionId,
        event.runId,
        event.sequence,
        event.type,
        event.summary,
        JSON.stringify(event.payload),
        event.createdAt,
      );
    return event;
  }

  listTrajectory(sessionId: string, runId?: string): TrajectoryEvent[] {
    const rows = (
      runId
        ? this.database
            .prepare(
              "select * from trajectories where session_id = ? and run_id = ? order by sequence asc",
            )
            .all(sessionId, runId)
        : this.database
            .prepare(
              "select * from trajectories where session_id = ? order by created_at asc, sequence asc",
            )
            .all(sessionId)
    ) as Row[];
    return rows.map((row) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(asString(row.payload_json));
      } catch {
        payload = null;
      }
      return {
        id: asString(row.id),
        runId: asString(row.run_id),
        sessionId: asString(row.session_id),
        sequence: asNumber(row.sequence),
        type: asString(row.type),
        summary: asString(row.summary),
        payload,
        createdAt: asString(row.created_at),
      };
    });
  }

  private mapMcpServer(row: Row): McpServerView {
    const transport = asString(row.transport) as McpTransport;
    const command = asString(row.command);
    const url = asString(row.url);
    return {
      id: asString(row.id),
      name: asString(row.name),
      description: asString(row.description),
      transport,
      enabled: asBoolean(row.enabled),
      builtin: asBoolean(row.builtin),
      command,
      args: parseStringArray(row.args_json),
      cwd: asString(row.cwd),
      url,
      timeoutMs: asNumber(row.timeout_ms) || 30_000,
      headerKeys: parseStringArray(row.header_keys_json),
      envKeys: parseStringArray(row.env_keys_json),
      oauthEnabled: false,
      oauthAuthenticated: false,
      configured:
        (transport === "stdio" ? Boolean(command) : Boolean(url)) &&
        ((parseStringArray(row.header_keys_json).length === 0 &&
          parseStringArray(row.env_keys_json).length === 0) ||
          Boolean(asNullableString(row.secret_ref))),
      status: asString(row.status) as McpServerView["status"],
      tools: parseMcpTools(row.tools_json),
      lastError: asNullableString(row.last_error),
      lastConnectedAt: asNullableString(row.last_connected_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  private mapProvider(row: Row): ProviderView {
    const id = asString(row.id);
    const keyRows = this.database
      .prepare(
        "select * from provider_keys where provider_id = ? order by priority asc, created_at asc",
      )
      .all(id) as Row[];
    const modelRows = this.database
      .prepare("select * from models where provider_id = ? order by display_name asc")
      .all(id) as Row[];
    const activeKeyId = asNullableString(row.active_key_id);

    return {
      id,
      name: asString(row.name),
      baseUrl: asString(row.base_url),
      protocol: asString(row.protocol) as ProviderProtocol,
      authMode: asString(row.auth_mode) as ProviderAuthMode,
      customHeaderName: asNullableString(row.custom_header_name),
      activeKeyId,
      keys: keyRows.map(
        (key): ProviderKeySummary => ({
          id: asString(key.id),
          label: asString(key.label),
          maskedHint: asString(key.masked_hint),
          enabled: asBoolean(key.enabled),
          priority: asNumber(key.priority),
          neverReveal: asBoolean(key.never_reveal),
          isActive: asString(key.id) === activeKeyId,
          cooldownUntil: asNullableString(key.cooldown_until),
        }),
      ),
      models: modelRows.map((model) => this.mapModel(model)),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      promptCaching: normalizePromptCachingSettings(this.getSetting(providerPromptCachingKey(id))),
    };
  }

  private mapModel(row: Row): ModelConfig {
    return {
      id: asString(row.id),
      providerId: asString(row.provider_id),
      modelId: asString(row.model_id),
      displayName: asString(row.display_name),
      contextWindow: asNumber(row.context_window),
      maxOutputTokens: asNumber(row.max_output_tokens),
      inputModalities: parseModalities(row.input_modalities),
      outputModalities: parseModalities(row.output_modalities),
      toolCalls: asBoolean(row.tool_calls),
      parallelToolCalls: asBoolean(row.parallel_tool_calls),
      reasoningLevels: parseStringArray(row.reasoning_levels),
      anthropicNoneBehavior: asString(row.anthropic_none_behavior) as AnthropicNoneBehavior,
      enabled: asBoolean(row.enabled),
    };
  }

  private mapSession(row: Row): SessionView {
    return {
      id: asString(row.id),
      ...(row.child_count !== undefined ? { childCount: asNumber(row.child_count) } : {}),
      title: asString(row.title),
      parentSessionId: asNullableString(row.parent_session_id),
      agentMode: asAgentMode(row.agent_mode),
      chatGroupId: asNullableString(row.chat_group_id),
      providerId: asNullableString(row.provider_id),
      modelId: asNullableString(row.model_id),
      agentProfileId: asString(row.agent_profile_id) || "primary",
      workspacePath: asNullableString(row.workspace_path),
      systemPrompt: asString(row.system_prompt),
      reasoningLevel: asNullableString(row.reasoning_level),
      permissionMode: asString(row.permission_mode) as PermissionMode,
      chatNetworkEnabled: this.getSetting(chatNetworkEnabledKey(asString(row.id))) !== false,
      approvalMode:
        this.getSetting(`permissions.approval.${asString(row.id)}`) === "automatic"
          ? "automatic"
          : "manual",
      compactionModel: (this.getSetting(`context.model.${asString(row.id)}`) as
        | import("../../shared/domain").CompactionModelChoice
        | null) ?? { mode: "default", providerId: null, modelId: null },
      executionMode: (asString(row.execution_mode) || "host") as SessionExecutionMode,
      patchOnly: asBoolean(row.patch_only),
      status: asString(row.status) as SessionView["status"],
      archived: asBoolean(row.archived),
      pinned: asBoolean(row.pinned),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
      lastOpenedAt: asString(row.last_opened_at),
    };
  }

  private mapAgentProfile(row: Row): AgentProfileView {
    return {
      id: asString(row.id),
      name: asString(row.name),
      description: asString(row.description),
      role: asString(row.role) as AgentProfileRole,
      instructions: asString(row.instructions),
      modelId: asNullableString(row.model_id),
      readOnly: asBoolean(row.read_only),
      builtin: asBoolean(row.builtin),
      enabled: asBoolean(row.enabled),
      hidden: asBoolean(row.hidden),
      sourcePath: asNullableString(row.source_path),
      permissions: parseAgentPermissions(row.permissions_json),
      toolAllowlist: parseStringArray(row.tool_allowlist_json),
      temperature: typeof row.temperature === "number" ? row.temperature : null,
      topP: typeof row.top_p === "number" ? row.top_p : null,
      maxSteps: typeof row.max_steps === "number" ? row.max_steps : null,
      color: asNullableString(row.color),
      applicableModes: asApplicableAgentModes(row.applicable_modes_json),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  private mapChatGroup(row: Row): ChatGroupView {
    return {
      id: asString(row.id),
      name: asString(row.name),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  private validateChatGroupName(name: string): string {
    const normalized = name.trim();
    if (!normalized || normalized.length > 80) {
      throw new Error("聊天分组名称长度必须为 1 到 80 个字符。");
    }
    return normalized;
  }

  private mapExtension(row: Row): ExtensionView {
    let manifest: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(asString(row.manifest_json));
      manifest = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      manifest = {};
    }

    const metadata = manifest._mingshen;
    const metadataObject =
      metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
    const skillCount =
      typeof metadataObject.skillCount === "number"
        ? metadataObject.skillCount
        : Array.isArray(manifest.skills)
          ? manifest.skills.length
          : 0;
    const manifestPaths = asRecord(manifest.paths);
    const mcpServers = manifestPaths.mcpServers ?? manifest.mcpServers;
    const hooks = manifestPaths.hooks ?? manifest.hooks;
    const mcpServerNames = Object.keys(asRecord(mcpServers));
    return {
      id: asString(row.id),
      type: asString(row.type) as ExtensionType,
      name: asString(row.name),
      description: asString(row.description),
      sourcePath: asString(row.source_path),
      installedPath: asString(row.installed_path),
      contentHash: asString(row.content_hash),
      enabled: asBoolean(row.enabled),
      createdAt: asString(row.created_at),
      skillCount,
      mcpServerCount:
        typeof metadataObject.mcpServerCount === "number"
          ? metadataObject.mcpServerCount
          : mcpServers && typeof mcpServers === "object"
            ? Object.keys(mcpServers as Record<string, unknown>).length
            : 0,
      mcpServerNames,
      hookCount:
        typeof metadataObject.hookCount === "number"
          ? metadataObject.hookCount
          : Array.isArray(hooks)
            ? hooks.length
            : hooks && typeof hooks === "object"
              ? Object.keys(hooks as Record<string, unknown>).length
              : 0,
    };
  }

  private mapScheduledTask(row: Row): ScheduledTaskView {
    return {
      id: asString(row.id),
      name: asString(row.name),
      prompt: asString(row.prompt),
      sessionId: asString(row.session_id),
      intervalMinutes: asNumber(row.interval_minutes),
      enabled: asBoolean(row.enabled),
      lastRunAt: asNullableString(row.last_run_at),
      nextRunAt: asString(row.next_run_at),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }
}
