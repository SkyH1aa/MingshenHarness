import type { SessionBuiltinCapabilityView, SessionView } from "../../shared/domain";
import {
  MAX_SESSION_BUILTIN_CAPABILITIES,
  sessionBuiltinCapabilitiesSettingKey,
} from "../../shared/session-builtin-capabilities";
import type { Repository } from "../storage/repository";
import { builtinPluginDiscoveryRecords, builtinPluginsForSession } from "./builtin-plugins";
import {
  builtinCapabilityDiscoveryRecords,
  canonicalBuiltinCapabilityIds,
  legacyBuiltinCapabilityIds,
  MAX_WORK_SOURCE_CATALOG_ENTRIES,
} from "./domain-skills";

type CapabilitySelectionRepository = Pick<
  Repository,
  "getSession" | "getSetting" | "listChildSessions" | "removeSetting" | "setSetting"
>;

function storedCapabilityIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.startsWith("builtin:") || item.length > 1000) continue;
    ids.add(item);
    if (ids.size > MAX_SESSION_BUILTIN_CAPABILITIES + MAX_WORK_SOURCE_CATALOG_ENTRIES)
      throw new Error("BUILTIN_CAPABILITY_STORAGE_INVALID: too many stored capability ids.");
  }
  return [...ids];
}

function isBusyStatus(session: SessionView): boolean {
  return session.status === "running" || session.status === "waiting_approval";
}

export class SessionBuiltinCapabilityService {
  constructor(
    private readonly repository: CapabilitySelectionRepository,
    private readonly promptDirectory: string,
    private readonly isSessionBusy: (sessionId: string) => boolean = () => false,
    private readonly availablePluginTools: (
      session: SessionView,
    ) => ReadonlySet<string> | null = () => null,
  ) {}

  async list(sessionId: string): Promise<SessionBuiltinCapabilityView[]> {
    const session = this.requireSelectableSession(sessionId);
    const selectedIds = new Set(this.storedIds(session.id));
    const records = await builtinCapabilityDiscoveryRecords(
      session,
      this.promptDirectory,
      selectedIds,
    );
    const pluginTools = this.availablePluginTools(session);
    records.push(
      ...builtinPluginDiscoveryRecords(
        session,
        pluginTools ?? new Set(),
        selectedIds,
        pluginTools === null,
      ),
    );
    return records.map((record) => ({
      id: record.id,
      type: record.type,
      name: record.name,
      description: record.description,
      source: "builtin",
      family: typeof record.family === "string" ? record.family : null,
      version: typeof record.version === "string" ? record.version : null,
      compatibility: typeof record.compatibility === "string" ? record.compatibility : null,
      sourcePath: typeof record.source_path === "string" ? record.source_path : null,
      sourceSha256: typeof record.source_sha256 === "string" ? record.source_sha256 : null,
      selected: record.session_selected,
    }));
  }

  async set(sessionId: string, capabilityId: string, selected: boolean): Promise<void> {
    if (typeof capabilityId !== "string" || !capabilityId.startsWith("builtin:"))
      throw new Error("BUILTIN_CAPABILITY_INVALID: use an exact built-in capability id.");

    let session: SessionView | null = null;
    let records: Awaited<ReturnType<typeof builtinCapabilityDiscoveryRecords>> = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = this.requireSelectableSession(sessionId);
      this.assertNotBusy(candidate);
      const mode = candidate.agentMode ?? "code";
      const discovered = await builtinCapabilityDiscoveryRecords(candidate, this.promptDirectory);
      const current = this.requireSelectableSession(sessionId);
      this.assertNotBusy(current);
      if ((current.agentMode ?? "code") === mode) {
        session = current;
        records = discovered;
        break;
      }
    }
    if (!session)
      throw new Error("BUILTIN_CAPABILITY_STATE_CHANGED: retry after the session is stable.");
    if (
      !records.some((record) => record.id === capabilityId) &&
      !builtinPluginsForSession(session).some((plugin) => plugin.id === capabilityId)
    )
      throw new Error("BUILTIN_CAPABILITY_UNAVAILABLE: choose a capability from this mode.");

    let next: string[] | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = this.storedIds(session.id);
      const canonicalIds = await canonicalBuiltinCapabilityIds(this.promptDirectory, current);
      const latestSession = this.requireSelectableSession(sessionId);
      this.assertNotBusy(latestSession);
      if ((latestSession.agentMode ?? "code") !== (session.agentMode ?? "code"))
        throw new Error("BUILTIN_CAPABILITY_STATE_CHANGED: retry after the session is stable.");
      if (JSON.stringify(this.storedIds(session.id)) !== JSON.stringify(current)) continue;
      const alreadySelected = canonicalIds.includes(capabilityId);
      next = selected
        ? alreadySelected
          ? current
          : [...current, capabilityId]
        : current.filter((_, index) => canonicalIds[index] !== capabilityId);
      if (
        selected &&
        !alreadySelected &&
        new Set([...canonicalIds, capabilityId]).size > MAX_SESSION_BUILTIN_CAPABILITIES
      )
        throw new Error(
          `BUILTIN_CAPABILITY_LIMIT: select at most ${MAX_SESSION_BUILTIN_CAPABILITIES} built-in capabilities.`,
        );
      break;
    }
    if (!next)
      throw new Error("BUILTIN_CAPABILITY_STATE_CHANGED: retry after the session is stable.");
    const key = sessionBuiltinCapabilitiesSettingKey(session.id);
    if (next.length) this.repository.setSetting(key, next);
    else this.repository.removeSetting(key);
  }

  async selectedIdsForPrompt(session: SessionView): Promise<string[]> {
    if (session.agentMode === "chat") return [];
    const selectedIds = new Set(this.storedIds(session.id));
    if (!selectedIds.size) return [];
    const records = await builtinCapabilityDiscoveryRecords(
      session,
      this.promptDirectory,
      selectedIds,
    );
    const pluginTools = this.availablePluginTools(session);
    records.push(
      ...builtinPluginDiscoveryRecords(
        session,
        pluginTools ?? new Set(),
        selectedIds,
        pluginTools === null,
      ),
    );
    return records.filter((record) => record.session_selected).map((record) => record.id);
  }

  async legacyIdsForCapability(session: SessionView, canonicalId: string): Promise<string[]> {
    if (session.agentMode !== "work") return [];
    return legacyBuiltinCapabilityIds(this.promptDirectory, canonicalId);
  }

  copy(sourceSessionId: string, targetSessionId: string): void {
    const source = this.repository.getSession(sourceSessionId);
    const target = this.repository.getSession(targetSessionId);
    if (!source || !target || target.agentMode === "chat") return;
    const key: string = sessionBuiltinCapabilitiesSettingKey(targetSessionId);
    const sourceIds = this.storedIds(sourceSessionId);
    if (sourceIds.length) this.repository.setSetting(key, sourceIds);
    else this.repository.removeSetting(key);
  }

  private requireSelectableSession(sessionId: string): SessionView {
    const session = this.repository.getSession(sessionId);
    if (!session) throw new Error("会话不存在。");
    if (session.agentMode === "chat")
      throw new Error("CHAT_CAPABILITY_UNAVAILABLE: ChatAgent does not support Skills or Plugins.");
    return session;
  }

  private storedIds(sessionId: string): string[] {
    return storedCapabilityIds(
      this.repository.getSetting(sessionBuiltinCapabilitiesSettingKey(sessionId)),
    );
  }

  private assertNotBusy(root: SessionView): void {
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length) {
      const session = pending.shift();
      if (!session || visited.has(session.id)) continue;
      visited.add(session.id);
      if (isBusyStatus(session) || this.isSessionBusy(session.id))
        throw new Error("会话或其子任务正在运行，请停止或等待完成后再变更技能与插件。");
      pending.push(...this.repository.listChildSessions(session.id));
    }
  }
}
