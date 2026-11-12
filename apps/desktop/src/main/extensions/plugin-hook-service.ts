import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ApprovalRequest, SessionView } from "../../shared/domain";
import type { McpService } from "../mcp/mcp-service";
import type { Repository } from "../storage/repository";
import { isDangerousCommand } from "../tools/tool-registry";

interface HookToolCall {
  type: "mcp_tool";
  server: string;
  tool: string;
  input: Record<string, unknown>;
}

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

type HookAction = HookToolCall | HookCommand;

export interface HookExecutionResult {
  event: string;
  status: "completed" | "failed" | "skipped";
  detail: string;
}

export type HookApproval = (request: ApprovalRequest, signal: AbortSignal) => Promise<boolean>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function replacePlaceholders(value: unknown, variables: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([a-z0-9_]+)\}/gi, (_match, name: string) => variables[name] ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => replacePlaceholders(entry, variables));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        replacePlaceholders(entry, variables),
      ]),
    );
  }
  return value;
}

function actionsFromManifest(value: unknown): HookAction[] {
  const actions: HookAction[] = [];
  const walk = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        walk(entry);
      }
      return;
    }
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (record.type === "mcp_tool" && typeof record.server === "string") {
      actions.push({
        type: "mcp_tool",
        server: record.server,
        tool: typeof record.tool === "string" ? record.tool : "",
        input: asRecord(record.input),
      });
      return;
    }
    if (record.type === "command" && typeof record.command === "string") {
      actions.push({
        type: "command",
        command: record.command,
        ...(typeof record.timeout === "number" ? { timeout: record.timeout } : {}),
      });
      return;
    }
    for (const entry of Object.values(record)) {
      walk(entry);
    }
  };
  walk(value);
  return actions;
}

function runCommand(
  command: string,
  cwd: string,
  timeout: number,
  signal: AbortSignal,
): Promise<{ ok: boolean; output: string }> {
  signal.throwIfAborted();
  return new Promise((resolveResult) => {
    const child = spawn(
      process.env.SystemRoot
        ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let settled = false;
    let interrupted: string | null = null;
    let termination: Promise<void> | undefined;
    const finish = (ok: boolean, detail: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolveResult({ ok, output: detail.slice(0, 20_000) });
    };
    const terminate = () => {
      if (termination) return;
      if (child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        termination = new Promise<void>((done) => {
          killer.once("error", () => {
            child.kill();
            done();
          });
          killer.once("close", () => done());
        });
      } else child.kill();
    };
    const abort = () => {
      interrupted = "Hook command cancelled; process tree terminated.";
      terminate();
    };
    const timer = setTimeout(() => {
      interrupted = `Hook command timed out (${timeout} ms); process tree terminated.`;
      terminate();
    }, timeout);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length < 20_000) output = (output + chunk.toString("utf8")).slice(0, 20_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (output.length < 20_000) output = (output + chunk.toString("utf8")).slice(0, 20_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish(false, error.message);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      await termination;
      finish(!interrupted && code === 0, interrupted ?? (output || `exit_code: ${code ?? "null"}`));
    });
  });
}

export class PluginHookService {
  constructor(
    private readonly repository: Repository,
    private readonly mcpService: McpService,
  ) {}

  async run(
    event: "Stop" | "SubagentStop" | "Interrupt",
    session: SessionView,
    runId: string,
    signal: AbortSignal,
    requestApproval: HookApproval,
  ): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = [];
    const extensions = this.repository
      .listSessionExtensionIds(session.id)
      .map((id) => this.repository.getExtension(id))
      .filter((extension) => Boolean(extension?.enabled && extension.type === "plugin"));
    const shellHooksEnabled = this.repository.getSetting("plugin.shellHooksEnabled") === true;

    for (const extension of extensions) {
      if (!extension) {
        continue;
      }
      const manifest = this.repository.getExtensionManifest(extension.id);
      const hooks = asRecord(asRecord(manifest?.hooks).hooks ?? manifest?.hooks);
      const actions = actionsFromManifest(hooks[event]);
      for (const action of actions) {
        signal.throwIfAborted();
        if (action.type === "mcp_tool") {
          const server = this.mcpService.findServerByName(action.server);
          if (!server) {
            results.push({
              event,
              status: "failed",
              detail: `${extension.name}: 找不到 Hook 引用的 MCP Server ${action.server}`,
            });
            continue;
          }
          const input = replacePlaceholders(action.input, {
            hook_event_name: event,
            session_id: session.id,
            turn_id: runId,
            agent_id: session.id,
          }) as Record<string, unknown>;
          const approved = await requestApproval(
            {
              id: randomUUID(),
              sessionId: session.id,
              runId,
              toolCallId: randomUUID(),
              toolName: `hook:${event}:mcp`,
              manualOnly: true,
              summary: `运行插件 MCP Hook：${extension.name}`,
              detail: `${server.name} · ${action.tool}\n${JSON.stringify(input, null, 2).slice(0, 12000)}`,
              pathScope: null,
              commandPrefix: null,
              risk: "elevated",
              createdAt: new Date().toISOString(),
            },
            signal,
          );
          if (!approved) {
            results.push({
              event,
              status: "skipped",
              detail: `${extension.name}: 用户拒绝了 MCP Hook。`,
            });
            continue;
          }
          const result = await this.mcpService.callTool(server.id, action.tool, input, signal);
          results.push({
            event,
            status: result.isError ? "failed" : "completed",
            detail: `${extension.name}: ${result.output}`,
          });
          continue;
        }

        if (!shellHooksEnabled) {
          results.push({
            event,
            status: "skipped",
            detail: `${extension.name}: Shell Hook 默认禁用。`,
          });
          continue;
        }
        if (!session.workspacePath || !this.repository.isProjectTrusted(session.workspacePath)) {
          results.push({
            event,
            status: "skipped",
            detail: `${extension.name}: 当前项目尚未信任。`,
          });
          continue;
        }
        const blocked = isDangerousCommand(action.command);
        if (blocked) {
          results.push({ event, status: "failed", detail: `${extension.name}: ${blocked}` });
          continue;
        }
        const approved = await requestApproval(
          {
            id: randomUUID(),
            sessionId: session.id,
            runId,
            toolCallId: randomUUID(),
            toolName: `hook:${event}`,
            manualOnly: true,
            summary: `运行插件 Shell Hook：${extension.name}`,
            detail: action.command,
            pathScope: null,
            commandPrefix: action.command,
            risk: "elevated",
            createdAt: new Date().toISOString(),
          },
          signal,
        );
        if (!approved) {
          results.push({
            event,
            status: "skipped",
            detail: `${extension.name}: 用户拒绝了 Shell Hook。`,
          });
          continue;
        }
        const result = await runCommand(
          action.command,
          session.workspacePath,
          Math.min(120_000, Math.max(1_000, action.timeout ?? 60_000)),
          signal,
        );
        results.push({
          event,
          status: result.ok ? "completed" : "failed",
          detail: `${extension.name}: ${result.output}`,
        });
      }
    }
    return results;
  }
}
