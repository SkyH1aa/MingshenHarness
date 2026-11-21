export type CoordinationPhase =
  | "planned"
  | "executing"
  | "qa"
  | "completed"
  | "failed"
  | "cancelled";

export type CoordinationTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type CoordinationQaStatus = "not_run" | "running" | "passed" | "failed" | "blocked";
export type CoordinationVerificationStatus =
  | "not_run"
  | "running"
  | "passed"
  | "failed"
  | "blocked";

export interface CoordinationTaskView {
  id: string;
  label: string;
  agentProfileId: string;
  scope: string;
  status: CoordinationTaskStatus;
  childSessionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  summary: string;
}

export interface CoordinationQaView {
  status: CoordinationQaStatus;
  agentProfileId: string;
  childSessionId: string | null;
  criteria: string;
  summary: string;
  evidence: string[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface CoordinationVerificationView {
  status: CoordinationVerificationStatus;
  commands: string[];
  summary: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CoordinationStateView {
  sessionId: string;
  runId: string;
  goal: string;
  phase: CoordinationPhase;
  tasks: CoordinationTaskView[];
  verification: CoordinationVerificationView;
  qa: CoordinationQaView;
  createdAt: string;
  updatedAt: string;
}

export interface CoordinationQaVerdict {
  verdict: "passed" | "failed" | "blocked";
  summary: string;
  evidence: string[];
}

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string"
    ? value.replaceAll("\u0000", "").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

export function parseCoordinationQaVerdict(raw: string): CoordinationQaVerdict {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const start = (fenced?.[1] ?? trimmed).indexOf("{");
  const end = (fenced?.[1] ?? trimmed).lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("QA did not return a structured JSON verdict.");
  let value: unknown;
  try {
    value = JSON.parse((fenced?.[1] ?? trimmed).slice(start, end + 1));
  } catch {
    throw new Error("QA returned invalid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("QA verdict must be an object.");
  const record = value as Record<string, unknown>;
  if (!["passed", "failed", "blocked"].includes(String(record.verdict)))
    throw new Error("QA verdict must be passed, failed or blocked.");
  const summary = cleanText(record.summary, 2_000);
  const evidence = Array.isArray(record.evidence)
    ? [...new Set(record.evidence.map((item) => cleanText(item, 800)).filter(Boolean))].slice(0, 12)
    : [];
  if (!summary || !evidence.length)
    throw new Error("QA verdict requires a summary and at least one evidence item.");
  return {
    verdict: record.verdict as CoordinationQaVerdict["verdict"],
    summary,
    evidence,
  };
}
