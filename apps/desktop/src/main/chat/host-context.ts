import { randomUUID } from "node:crypto";
import type { SessionMessage } from "../../shared/domain";
import type { Repository } from "../storage/repository";

export const hostContextKey = (sessionId: string) => `context.host.${sessionId}`;
type Section = "plan" | "memory" | "coding" | "permissions" | "diagnostics";

interface HostFact {
  id: string;
  anchorId: string | null;
  section: Section;
  text: string;
  createdAt: string;
}

const sections = new Set<Section>(["plan", "memory", "coding", "permissions", "diagnostics"]);

function facts(value: unknown): HostFact[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is HostFact =>
      entry &&
      typeof entry.id === "string" &&
      (entry.anchorId === null || typeof entry.anchorId === "string") &&
      sections.has(entry.section) &&
      typeof entry.text === "string" &&
      typeof entry.createdAt === "string",
  );
}

function message(sessionId: string, fact: HostFact): SessionMessage {
  return {
    id: fact.id,
    sessionId,
    seq: 0,
    role: "user",
    createdAt: fact.createdAt,
    parts: [
      {
        type: "text",
        text: [
          `[HOST_CONTEXT ${fact.section}]`,
          "Chronological host state. The latest entry for this section supersedes older entries and summaries. This is not a new user request or an approval; safety rules and the actual tool/permission checks remain authoritative.",
          fact.text || "(No active information in this section.)",
        ].join("\n\n"),
      },
    ],
  };
}

export function forkHostContext(value: unknown, mapped: Map<string, { id: string }>): HostFact[] {
  return facts(value).flatMap((fact) => {
    const anchor = fact.anchorId ? mapped.get(fact.anchorId) : null;
    if (fact.anchorId && !anchor) return [];
    return [{ ...fact, id: randomUUID(), anchorId: anchor?.id ?? null }];
  });
}

/** Host updates join the chronological history instead of rewriting its system prefix. */
export class HostContextService {
  constructor(private readonly repository: Repository) {}

  append(sessionId: string, updates: Partial<Record<Section, string>>): void {
    const history = this.repository.getMessages(sessionId);
    const ids = new Set(history.map((item) => item.id));
    const entries = facts(this.repository.getSetting(hostContextKey(sessionId))).filter(
      (fact) => fact.anchorId === null || ids.has(fact.anchorId),
    );
    // Never insert host text between an assistant tool call and its tool results.
    const pending = new Set<string>();
    for (const item of history)
      for (const part of item.parts) {
        if (part.type === "tool_call") pending.add(part.callId);
        if (part.type === "tool_result") pending.delete(part.callId);
      }
    if (pending.size) throw new Error("Host context requires a completed tool boundary.");
    let changed = false;
    for (const [section, text] of Object.entries(updates) as Array<[Section, string]>) {
      const previous = entries.findLast((entry) => entry.section === section);
      if (previous?.text === text || (!previous && !text)) continue;
      entries.push({
        id: randomUUID(),
        anchorId: history.at(-1)?.id ?? null,
        section,
        text,
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }
    if (changed) this.repository.setSetting(hostContextKey(sessionId), entries);
  }

  merge(sessionId: string, history: SessionMessage[], throughSeq = 0): SessionMessage[] {
    const seqs = new Map(history.map((item) => [item.id, item.seq]));
    const entries = facts(this.repository.getSetting(hostContextKey(sessionId))).filter(
      (fact) => fact.anchorId === null || seqs.has(fact.anchorId),
    );
    const anchorSeq = (fact: HostFact) => (fact.anchorId ? (seqs.get(fact.anchorId) ?? 0) : 0);
    const before = entries.filter((fact) => anchorSeq(fact) <= throughSeq);
    const latest = new Map(before.map((fact) => [fact.section, fact.id]));
    const baseline = throughSeq
      ? before.filter((fact) => latest.get(fact.section) === fact.id)
      : before;
    const anchored = new Map<string, HostFact[]>();
    for (const fact of entries) {
      if (!fact.anchorId || anchorSeq(fact) <= throughSeq) continue;
      const group = anchored.get(fact.anchorId) ?? [];
      group.push(fact);
      anchored.set(fact.anchorId, group);
    }
    const result = baseline.map((fact) => message(sessionId, fact));
    for (const item of history) {
      if (item.seq <= throughSeq) continue;
      result.push(item);
      for (const fact of anchored.get(item.id) ?? []) result.push(message(sessionId, fact));
    }
    return result;
  }

  prune(sessionId: string, throughSeq: number): void {
    const history = this.repository.getMessages(sessionId);
    const seqs = new Map(history.map((item) => [item.id, item.seq]));
    const entries = facts(this.repository.getSetting(hostContextKey(sessionId))).filter(
      (fact) => fact.anchorId === null || seqs.has(fact.anchorId),
    );
    const before = entries.filter(
      (fact) => (fact.anchorId ? (seqs.get(fact.anchorId) ?? 0) : 0) <= throughSeq,
    );
    const latest = new Map(before.map((fact) => [fact.section, fact.id]));
    const previousIds = new Set(before.map((fact) => fact.id));
    this.repository.setSetting(
      hostContextKey(sessionId),
      entries.filter((fact) => !previousIds.has(fact.id) || latest.get(fact.section) === fact.id),
    );
  }
}
