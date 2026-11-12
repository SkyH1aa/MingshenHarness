import { normalize, sep } from "node:path";
import type { ApprovalDecision, ApprovalRequest } from "../../shared/domain";

interface TimedRule {
  value: string;
  expiresAt: number | null;
}

interface SessionRules {
  commands: TimedRule[];
  readPaths: TimedRule[];
  writePaths: TimedRule[];
}

function normalizePath(value: string): string {
  return normalize(value).toLocaleLowerCase("en-US");
}

function isActive(rule: TimedRule): boolean {
  return rule.expiresAt === null || rule.expiresAt > Date.now();
}

function pathMatches(candidate: string, scope: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedScope = normalizePath(scope);
  return (
    normalizedCandidate === normalizedScope ||
    normalizedCandidate.startsWith(`${normalizedScope}${sep}`)
  );
}

export class PermissionStore {
  private readonly rules = new Map<string, SessionRules>();
  private readonly similar = new Map<string, Set<string>>();

  similarScope(root: string | null, request: ApprovalRequest): string | null {
    if (!root || request.manualOnly || request.risk === "destructive") return null;
    if (request.pathScope && pathMatches(request.pathScope, root)) {
      const reads = [
        "read_file",
        "read_document",
        "list_files",
        "search_files",
        "glob_files",
        "code_index",
      ];
      const writes = [
        "write_file",
        "replace_in_file",
        "apply_patch",
        "delete_file",
        "create_document",
      ];
      if (reads.includes(request.toolName)) return `read:${normalizePath(root)}`;
      if (writes.includes(request.toolName)) return `write:${normalizePath(root)}`;
    }
    if (request.toolName === "run_command" && request.commandPrefix) {
      const command = request.commandPrefix.trim();
      if (
        !/^[\w./:\\=,+@%~-]+(?:[ \t]+[\w./:\\=,+@%~-]+)*$/.test(command) ||
        !request.commandCwd ||
        !pathMatches(request.commandCwd, root)
      )
        return null;
      const prefix = /^[a-z][\w.-]*(?:\s+[a-z][\w-]*)?(?=\s|$)/i.exec(command)?.[0];
      if (prefix) return `command:${normalizePath(request.commandCwd)}:${prefix.toLowerCase()}`;
    }
    return null;
  }

  rememberSimilar(sessionId: string, scope: string): void {
    const rules = this.similar.get(sessionId) ?? new Set<string>();
    rules.add(scope);
    this.similar.set(sessionId, rules);
  }

  hasSimilar(sessionId: string, scope: string): boolean {
    return this.similar.get(sessionId)?.has(scope) ?? false;
  }

  hasCommand(sessionId: string, command: string): boolean {
    const rules = this.rules.get(sessionId);
    if (!rules) {
      return false;
    }
    rules.commands = rules.commands.filter(isActive);
    return rules.commands.some(
      (rule) =>
        command === rule.value ||
        (command.startsWith(`${rule.value} `) &&
          !/[;&|\r\n`$<>]/.test(command.slice(rule.value.length))),
    );
  }

  hasPath(sessionId: string, path: string, access: "read" | "write"): boolean {
    const rules = this.rules.get(sessionId);
    if (!rules) {
      return false;
    }
    rules.readPaths = rules.readPaths.filter(isActive);
    rules.writePaths = rules.writePaths.filter(isActive);

    const readAllowed =
      rules.readPaths.some((rule) => pathMatches(path, rule.value)) ||
      rules.writePaths.some((rule) => pathMatches(path, rule.value));
    if (access === "read") {
      return readAllowed;
    }

    return rules.writePaths.some((rule) => pathMatches(path, rule.value));
  }

  remember(sessionId: string, request: ApprovalRequest, decision: ApprovalDecision): void {
    if (
      request.manualOnly ||
      decision.decision !== "allow_session" ||
      (!request.pathScope && !request.commandPrefix)
    ) {
      return;
    }

    const rules = this.rules.get(sessionId) ?? {
      commands: [],
      readPaths: [],
      writePaths: [],
    };
    const expiresAt = decision.rememberForMs
      ? Date.now() + Math.max(1_000, decision.rememberForMs)
      : null;

    if (request.commandPrefix) {
      rules.commands.push({ value: request.commandPrefix, expiresAt });
    }
    if (request.pathScope) {
      const target = [
        "write_file",
        "replace_in_file",
        "apply_patch",
        "delete_file",
        "create_document",
      ].includes(request.toolName)
        ? rules.writePaths
        : rules.readPaths;
      target.push({ value: request.pathScope, expiresAt });
    }

    this.rules.set(sessionId, rules);
  }

  clearSession(sessionId: string): void {
    this.rules.delete(sessionId);
    this.similar.delete(sessionId);
  }
}
