import type { ChatStreamEvent } from "../../shared/domain";
import type { OfficeDeliveryStageName } from "../../shared/office-delivery";
import { recordRuntimeError, recordRuntimeWarning } from "../diagnostics/runtime-log";

type Context = {
  sessionId?: string;
  runId?: string;
  toolName?: string;
  operation?: string;
  code?: string;
  status?: string;
};
type Recorder = (source: string, message: string, context: Context) => void;

const MAX_IDENTITIES = 4096;
const OFFICE_FAILURE_CODES = new Set([
  "OFFICE_PACKAGE_INVALID",
  "OFFICE_STRUCTURE_INVALID",
  "PDF_PACKAGE_INVALID",
  "VISUAL_INSPECTION_FAILED",
]);

function boundedSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > MAX_IDENTITIES) map.delete(map.keys().next().value as K);
}

function safeName(value: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,99}$/.test(value) ? value : "unknown";
}

function safeCode(value: string | undefined, fallback: string): string {
  return value && /^[A-Z][A-Z0-9_]{1,79}$/.test(value) ? value : fallback;
}

/** Records structured tool and Office failures without copying their content into logs. */
export function createRuntimeEventDiagnostics(
  error: Recorder = recordRuntimeError,
  warning: Recorder = recordRuntimeWarning,
): (event: ChatStreamEvent) => void {
  const toolNames = new Map<string, string>();
  const toolCalls = new Map<string, true>();
  const failedToolCalls = new Map<string, true>();
  const recordedToolResults = new Map<string, true>();
  const seenOfficeIssues = new Map<string, true>();
  const officeOnce = (key: string, record: () => void): void => {
    if (seenOfficeIssues.has(key)) return;
    boundedSet(seenOfficeIssues, key, true);
    record();
  };

  return (event) => {
    if (event.type === "run_failed") {
      error("chat.run", event.error, { sessionId: event.sessionId, runId: event.runId });
    }
    if (event.type === "activity") {
      const activity = event.activity;
      boundedSet(toolNames, activity.id, safeName(activity.toolName));
      // Tool activities and their structured result describe the same operation.
      // The result can distinguish policy refusal/cancellation from a real failure.
      if (
        activity.status === "failed" &&
        !toolCalls.has(activity.id) &&
        !failedToolCalls.has(activity.id)
      ) {
        const record = activity.diagnosticStatus ? warning : error;
        record("agent.activity", "Agent activity did not complete successfully.", {
          sessionId: activity.sessionId,
          runId: activity.runId,
          toolName: safeName(activity.toolName),
          code: "ACTIVITY_FAILED",
          ...(activity.diagnosticStatus ? { status: activity.diagnosticStatus } : {}),
        });
      }
    }
    if (event.type === "assistant_message") {
      for (const part of event.message.parts) {
        if (part.type === "tool_call") {
          boundedSet(toolNames, `${event.runId}:${part.callId}`, safeName(part.name));
          boundedSet(toolCalls, `${event.runId}:${part.callId}`, true);
        }
        if (part.type === "tool_result") {
          const key = `${event.runId}:${part.callId}`;
          toolCalls.delete(key);
          if (part.isError) boundedSet(failedToolCalls, key, true);
        }
        if (
          part.type === "tool_result" &&
          part.isError &&
          !recordedToolResults.has(`${event.runId}:${part.callId}`)
        ) {
          boundedSet(recordedToolResults, `${event.runId}:${part.callId}`, true);
          const status = part.outcome?.status ?? "failed";
          const code = safeCode(part.outcome?.codes[0], "TOOL_RESULT_FAILED");
          const record =
            status === "denied" || status === "cancelled" || status === "unverified"
              ? warning
              : error;
          record("tool.result", "Tool execution did not complete successfully.", {
            sessionId: event.sessionId,
            runId: event.runId,
            toolName: toolNames.get(`${event.runId}:${part.callId}`) ?? "unknown",
            status,
            code,
          });
        }
        if (part.type === "error")
          error("chat.message", part.message, {
            sessionId: event.sessionId,
            runId: event.runId,
          });
      }
    }
    if (event.type === "office_delivery_updated") {
      const receipt = event.receipt;
      const base = `${receipt.id}:${receipt.revision}`;
      const stagesWithIssues = new Set<OfficeDeliveryStageName>();
      for (const issue of receipt.issues) {
        if (issue.severity === "info") continue;
        stagesWithIssues.add(issue.stage);
        const code = safeCode(issue.code, "OFFICE_DELIVERY_ISSUE");
        officeOnce(`${base}:issue:${issue.stage}:${code}`, () => {
          const record = OFFICE_FAILURE_CODES.has(code) ? error : warning;
          record("office.delivery", "Office delivery check reported an issue.", {
            sessionId: event.sessionId,
            runId: event.runId,
            operation: issue.stage,
            status: receipt.status,
            code,
          });
        });
      }
      for (const [stage, status] of Object.entries(receipt.stages)) {
        if (status !== "failed" || stagesWithIssues.has(stage as OfficeDeliveryStageName)) continue;
        officeOnce(`${base}:stage:${stage}`, () => {
          error("office.delivery", "Office delivery stage failed.", {
            sessionId: event.sessionId,
            runId: event.runId,
            operation: stage,
            status,
            code: "OFFICE_STAGE_FAILED",
          });
        });
      }
      if (
        ["partial", "unverified", "stale", "blocked"].includes(receipt.status) &&
        stagesWithIssues.size === 0 &&
        !Object.values(receipt.stages).includes("failed")
      )
        officeOnce(`${base}:status:${receipt.status}`, () => {
          warning("office.delivery", "Office delivery was not fully verified.", {
            sessionId: event.sessionId,
            runId: event.runId,
            status: receipt.status,
            code:
              receipt.status === "blocked"
                ? "OFFICE_DELIVERY_BLOCKED"
                : "OFFICE_DELIVERY_NOT_VERIFIED",
          });
        });
    }
  };
}
