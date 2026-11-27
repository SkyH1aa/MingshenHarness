import { IPC_CHANNELS } from "../../shared/ipc";
import { recordRuntimeError, recordRuntimeWarning } from "./runtime-log";

type InterfaceSurface = "ipc" | "local-api";
type Severity = "error" | "warn";

interface InterfaceIssue {
  code: string;
  severity: Severity;
  status?: number;
  warningCount?: number;
}

const TEST_OPERATIONS = new Set<string>([
  IPC_CHANNELS.providerTest,
  IPC_CHANNELS.mcpTest,
  IPC_CHANNELS.diagnosticsRun,
]);

const EXPECTED_REJECTIONS = new Set<string>([
  IPC_CHANNELS.desktopShortcutsSet,
  IPC_CHANNELS.localReviewSubmit,
]);

const WARNING_OPERATIONS = new Set<string>([
  IPC_CHANNELS.extensionsImport,
  IPC_CHANNELS.imageStudioGenerate,
  IPC_CHANNELS.imageStudioImport,
  IPC_CHANNELS.imageStudioRemoveAsset,
  IPC_CHANNELS.imageStudioRemoveAssets,
  IPC_CHANNELS.localPluginUpdatesCheck,
  IPC_CHANNELS.localPluginMarketAdd,
  IPC_CHANNELS.localPluginMarketRefresh,
  IPC_CHANNELS.localPluginInstall,
  IPC_CHANNELS.localPluginUpdate,
]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Inspect only documented result envelopes; never walk arbitrary user data. */
export function inspectInterfaceResult(
  surface: InterfaceSurface,
  operation: string,
  value: unknown,
): InterfaceIssue | null {
  const result = recordValue(value);
  if (!result) return null;

  if (surface === "ipc" && TEST_OPERATIONS.has(operation) && result.ok === false) {
    const status =
      typeof result.status === "number" &&
      Number.isInteger(result.status) &&
      result.status >= 100 &&
      result.status <= 599
        ? result.status
        : undefined;
    return { code: "INTERFACE_TEST_FAILED", severity: "error", ...(status ? { status } : {}) };
  }
  if (surface === "ipc" && EXPECTED_REJECTIONS.has(operation) && result.ok === false) {
    return { code: "INTERFACE_REQUEST_REJECTED", severity: "warn" };
  }
  if (surface === "ipc" && operation === IPC_CHANNELS.localPluginValidate) {
    const validation = recordValue(result.validation);
    if ((result.kind === "plugin" || result.kind === "marketplace") && validation?.ok === false) {
      return { code: "PLUGIN_VALIDATION_FAILED", severity: "warn" };
    }
  }
  if (surface === "ipc" && operation === IPC_CHANNELS.workspaceRunCommand) {
    if (
      typeof result.exitCode === "number" &&
      Number.isInteger(result.exitCode) &&
      result.exitCode !== 0
    ) {
      return { code: "USER_COMMAND_NONZERO_EXIT", severity: "warn" };
    }
  }

  const isOfficeCheck =
    (surface === "ipc" && operation === IPC_CHANNELS.officeDeliveryContinue) ||
    (surface === "local-api" && operation === "POST /v1/office/receipts");
  if (isOfficeCheck) {
    const receipt = surface === "local-api" ? (recordValue(result.receipt) ?? result) : result;
    const stages = recordValue(receipt.stages);
    const failedStage =
      stages &&
      ["package", "structure", "content", "formula", "recalculation", "render", "visual"].some(
        (stage) => stages[stage] === "failed",
      );
    if (failedStage) return { code: "OFFICE_DELIVERY_CHECK_FAILED", severity: "error" };
    if (receipt.status === "blocked") return { code: "OFFICE_DELIVERY_BLOCKED", severity: "warn" };
  }

  if (surface === "ipc" && WARNING_OPERATIONS.has(operation) && Array.isArray(result.warnings)) {
    const count = result.warnings.length;
    if (count > 0) {
      return { code: "INTERFACE_WARNINGS", severity: "warn", warningCount: Math.min(count, 1000) };
    }
  }
  return null;
}

/** Record metadata only: result text, bodies, paths and identifiers are not copied. */
export function recordInterfaceResult(
  surface: InterfaceSurface,
  operation: string,
  value: unknown,
): boolean {
  const issue = inspectInterfaceResult(surface, operation, value);
  if (!issue) return false;
  const context = {
    operation,
    code: issue.code,
    ...(issue.status === undefined ? {} : { status: issue.status }),
  };
  const message =
    issue.warningCount === undefined
      ? "Interface operation returned an unsuccessful result."
      : `Interface operation returned ${issue.warningCount} warning(s).`;
  if (issue.severity === "warn") recordRuntimeWarning(`${surface}.result`, message, context);
  else recordRuntimeError(`${surface}.result`, message, context);
  return true;
}
