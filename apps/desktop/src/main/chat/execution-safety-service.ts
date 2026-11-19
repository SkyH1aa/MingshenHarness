import { createHash } from "node:crypto";
import type { Repository } from "../storage/repository";

export const READ_EVIDENCE_TOOLS = new Set([
  "read_file",
  "read_document",
  "list_files",
  "search_files",
  "glob_files",
  "code_index",
  "lsp",
  "office_document",
]);
export const LOCAL_EDIT_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "apply_patch",
  "delete_file",
  "create_document",
]);
export function toolFingerprint(name: string, args: Record<string, unknown>): string {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, stable(item)]),
          )
        : value;
  return createHash("sha256")
    .update(name)
    .update(JSON.stringify(stable(args)))
    .digest("hex");
}
interface Confirmed {
  callId: string;
  fingerprint: string;
  output: string;
  isError: boolean;
}
interface Recovery {
  sessionId: string;
  confirmed: Confirmed[];
  recoveredFingerprints: Set<string>;
  uncertain: string[];
  evidence: string[];
  resolved: boolean;
}

export class ExecutionSafetyService {
  private readonly runs = new Map<string, Recovery>();
  constructor(private readonly repository: Repository) {}
  begin(sessionId: string, runId: string): void {
    const checkpoint = this.repository.getSetting(`workbench.checkpoint.${sessionId}`) as {
      state?: string;
      uncertainTools?: Array<{ callId: string; state?: string }>;
    } | null;
    const prior = this.repository.getSetting(`workbench.ledger.${sessionId}`) as Confirmed[] | null;
    const barrier = this.repository.getSetting(`workbench.recovery.${sessionId}`) as {
      uncertain?: string[];
    } | null;
    const recovering =
      Boolean(barrier) || checkpoint?.state === "interrupted" || checkpoint?.state === "failed";
    const uncertain = [
      ...new Set([
        ...(barrier?.uncertain ?? []),
        ...(recovering
          ? (checkpoint?.uncertainTools ?? [])
              .filter((tool) => tool.state === "executing")
              .map((tool) => tool.callId)
          : []),
      ]),
    ];
    this.runs.set(runId, {
      sessionId,
      confirmed: recovering ? (prior ?? []) : [],
      recoveredFingerprints: new Set(
        recovering ? (prior ?? []).map((item) => item.fingerprint) : [],
      ),
      uncertain,
      evidence: [],
      resolved: !uncertain.length && !barrier,
    });
    if (uncertain.length)
      this.repository.setSetting(`workbench.recovery.${sessionId}`, { uncertain });
    if (!recovering) this.repository.setSetting(`workbench.ledger.${sessionId}`, []);
  }
  inspect(runId: string): Recovery | undefined {
    return this.runs.get(runId);
  }
  before(
    runId: string,
    name: string,
    args: Record<string, unknown>,
    mutating: boolean,
  ): { output: string; isError: boolean } | null {
    const state = this.runs.get(runId);
    if (!state || !mutating) return null;
    const fingerprint = toolFingerprint(name, args);
    const previous = state.recoveredFingerprints.has(fingerprint)
      ? state.confirmed.find((item) => item.fingerprint === fingerprint)
      : null;
    if (previous)
      return {
        output: `Confirmed operation ${previous.callId} was already completed. It was NOT replayed. Previous result:\n${previous.output}`,
        isError: previous.isError,
      };
    if (!state.resolved)
      return {
        output: `RECOVERY_INSPECTION_REQUIRED: ${state.uncertain.join(", ")}. Inspect real state with read tools, then call resolve_interrupted with those successful inspection call IDs. Side effects remain blocked.`,
        isError: true,
      };
    return null;
  }
  completed(
    sessionId: string,
    runId: string,
    callId: string,
    name: string,
    args: Record<string, unknown>,
    result: { output: string; isError: boolean },
    mutating: boolean,
  ): void {
    const state = this.runs.get(runId);
    if (!state) return;
    if (!mutating && !result.isError && (READ_EVIDENCE_TOOLS.has(name) || name.startsWith("mcp__")))
      state.evidence.push(callId);
    if (mutating && !result.isError) {
      state.confirmed.push({
        callId,
        fingerprint: toolFingerprint(name, args),
        output: "See the confirmed tool result in the preserved conversation history.",
        isError: false,
      });
      state.confirmed = state.confirmed.slice(-2000);
      this.repository.setSetting(`workbench.ledger.${sessionId}`, state.confirmed);
    }
  }
  canResolve(runId: string, evidence: string[]): boolean {
    const state = this.runs.get(runId);
    return Boolean(state && evidence.length && evidence.every((id) => state.evidence.includes(id)));
  }
  markUncertain(runId: string, callId: string): void {
    const state = this.runs.get(runId);
    if (!state) return;
    state.uncertain = [...new Set([...state.uncertain, callId])];
    state.resolved = false;
    state.evidence = [];
    this.repository.setSetting(`workbench.recovery.${state.sessionId}`, {
      uncertain: state.uncertain,
    });
  }
  resolve(runId: string): void {
    const state = this.runs.get(runId);
    if (state) {
      state.resolved = true;
      state.uncertain = [];
      this.repository.removeSetting(`workbench.recovery.${state.sessionId}`);
    }
  }
  finish(runId: string): void {
    this.runs.delete(runId);
  }
}
