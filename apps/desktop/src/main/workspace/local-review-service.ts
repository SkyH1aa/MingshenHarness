import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { formatPatch, OMIT_HEADERS, type StructuredPatch, structuredPatch } from "diff";
import type {
  FileChange,
  FileDiff,
  FileDiffLine,
  SessionMessage,
  SessionView,
  TrajectoryEvent,
} from "../../shared/domain";
import type {
  LocalReviewCommentDraft,
  LocalReviewCommentsInput,
  LocalReviewCommentsResult,
  LocalReviewFile,
  LocalReviewRequest,
  LocalReviewSnapshot,
} from "../../shared/local-review";
import type { Repository } from "../storage/repository";
import { inspectGuardedPaths, readGuardedFile, statGuardedPath } from "./guarded-workspace-io";

const exec = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_REVIEW_FILES = 80;
const MAX_DIFF_LINES = 4_000;
const MAX_LINE_CHARACTERS = 2_000;
const MAX_FINGERPRINT_BYTES = 16 * 1024 * 1024;
const MAX_DIFF_INPUT_BYTES = 2_000_000;
const MAX_DIFF_INPUT_LINES = 100_000;
const MAX_DIFF_EDIT_LENGTH = 4_000;
const DIFF_TIMEOUT_MS = 500;
const MAX_COMMENTS = 20;
const MAX_COMMENT_CHARACTERS = 4_000;
const MAX_TOTAL_COMMENT_CHARACTERS = 20_000;
const MAX_QUOTE_CHARACTERS = 2_000;
const SESSION_PATH = /^[^:]+$/;

interface GitResult {
  stdout: string;
  stderr: string;
}

interface NameStatus {
  changeType: LocalReviewFile["changeType"];
  path: string;
}

interface SnapshotContext {
  workspacePath: string;
  root: string;
  gitPrefix: string;
  isRepository: boolean;
  currentBranch: string | null;
  baseRef: string | null;
  branches: string[];
  headCommit: string | null;
  baseCommit: string | null;
  warnings: string[];
  truncated: boolean;
  runId: string | null;
  scopeIsBranch: boolean;
}

interface ReviewSource {
  status: NameStatus;
  diff: FileDiff | null;
  additions: number;
  deletions: number;
  workingHash: string | null;
}

interface WorkingFile {
  hash: string | null;
  buffer: Buffer | null;
  warning: string | null;
}

type ReviewRepository = Pick<
  Repository,
  "getSession" | "getMessages" | "listTrajectory" | "latestSessionRun"
>;

function splitNullSeparated(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function normalizeGitPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function isSafeReviewPath(value: string): boolean {
  if (
    !value ||
    value.length > 1_000 ||
    isAbsolute(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("\0") ||
    value.split(/[\\/]/).some((part) => part === ".." || part.toLowerCase() === ".git")
  ) {
    return false;
  }
  return SESSION_PATH.test(value);
}

function isObjectId(value: string | null): value is string {
  return value !== null && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
}

function isSafeRefName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 250 &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.includes("//") &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 32 || code === 127 || "~^:?*[\\".includes(character);
    }) &&
    value.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"))
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? normalizeGitPath(left).toLocaleLowerCase("en-US") ===
        normalizeGitPath(right).toLocaleLowerCase("en-US")
    : normalizeGitPath(left) === normalizeGitPath(right);
}

function changeTypeForStatus(status: string): LocalReviewFile["changeType"] {
  if (status === "A") return "created";
  if (status === "D") return "deleted";
  return "modified";
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exceedsDiffLineLimit(value: Buffer): boolean {
  let lines = value.length ? 1 : 0;
  for (const byte of value) {
    if (byte === 10 && ++lines > MAX_DIFF_INPUT_LINES) return true;
  }
  return false;
}

async function guardedTextDiff(before: Buffer, after: Buffer): Promise<string | undefined> {
  const patch = await new Promise<StructuredPatch | undefined>((done) => {
    structuredPatch(
      "file",
      "file",
      before.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
      after.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
      undefined,
      undefined,
      {
        context: 3,
        timeout: DIFF_TIMEOUT_MS,
        maxEditLength: MAX_DIFF_EDIT_LENGTH,
        callback: done,
      },
    );
  });
  return patch ? formatPatch(patch, OMIT_HEADERS) : undefined;
}

function truncateDiff(diff: FileDiff | null): { diff: FileDiff | null; truncated: boolean } {
  if (!diff) return { diff: null, truncated: false };
  let truncated = diff.truncated;
  const lines = diff.lines.slice(0, MAX_DIFF_LINES).map((line) => {
    if (line.text.length <= MAX_LINE_CHARACTERS) return line;
    truncated = true;
    return { ...line, text: line.text.slice(0, MAX_LINE_CHARACTERS) };
  });
  if (diff.lines.length > MAX_DIFF_LINES) truncated = true;
  return { diff: { lines, truncated }, truncated };
}

function createdFileDiff(value: string): {
  additions: number;
  deletions: number;
  diff: FileDiff | null;
} {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (!normalized) return { additions: 0, deletions: 0, diff: null };
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let truncated = lines.length > MAX_DIFF_LINES;
  const visible = lines.slice(0, MAX_DIFF_LINES).map((text, index) => {
    if (text.length > MAX_LINE_CHARACTERS) truncated = true;
    return {
      type: "added" as const,
      oldLine: null,
      newLine: index + 1,
      text: text.slice(0, MAX_LINE_CHARACTERS),
    };
  });
  return {
    additions: lines.length,
    deletions: 0,
    diff: { lines: visible, truncated },
  };
}

function normalizeDiff(value: FileDiff | undefined): { diff: FileDiff | null; truncated: boolean } {
  return truncateDiff(value ?? null);
}

function parseUnifiedDiff(value: string): { diff: FileDiff | null; truncated: boolean } {
  const lines: FileDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let inHunk = false;
  let truncated = false;

  for (const rawLine of value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
    if (header) {
      if (lines.length >= MAX_DIFF_LINES) {
        truncated = true;
        break;
      }
      oldLine = Number(header[1]);
      oldRemaining = header[2] === undefined ? 1 : Number(header[2]);
      newLine = Number(header[3]);
      newRemaining = header[4] === undefined ? 1 : Number(header[4]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    const marker = rawLine[0] ?? "";
    const text = rawLine.slice(1);
    const shortened =
      text.length > MAX_LINE_CHARACTERS ? `${text.slice(0, MAX_LINE_CHARACTERS)}` : text;
    if (shortened !== text) truncated = true;

    if (marker === " " && oldRemaining > 0 && newRemaining > 0) {
      lines.push({ type: "context", oldLine, newLine, text: shortened });
      oldLine += 1;
      newLine += 1;
      oldRemaining -= 1;
      newRemaining -= 1;
    } else if (marker === "-" && oldRemaining > 0) {
      lines.push({ type: "removed", oldLine, newLine: null, text: shortened });
      oldLine += 1;
      oldRemaining -= 1;
    } else if (marker === "+" && newRemaining > 0) {
      lines.push({ type: "added", oldLine: null, newLine, text: shortened });
      newLine += 1;
      newRemaining -= 1;
    } else if (marker === "\\") {
      continue;
    } else {
      inHunk = false;
      continue;
    }
    if (lines.length >= MAX_DIFF_LINES) {
      truncated = true;
      break;
    }
    if (oldRemaining <= 0 && newRemaining <= 0) inHunk = false;
  }

  return {
    diff: lines.length ? { lines, truncated } : null,
    truncated,
  };
}

function mergeFileChanges(changes: FileChange[]): FileChange[] {
  const merged = new Map<string, FileChange>();
  for (const change of changes) {
    const key =
      process.platform === "win32"
        ? normalizeGitPath(change.path).toLocaleLowerCase("en-US")
        : normalizeGitPath(change.path);
    merged.set(key, { ...change, path: normalizeGitPath(change.path) });
  }
  return [...merged.values()];
}

function activityFileChanges(events: TrajectoryEvent[]): FileChange[] {
  const changes: FileChange[] = [];
  for (const event of events) {
    if (event.type !== "activity") continue;
    const payload = event.payload as { activity?: { fileChange?: FileChange | null } } | null;
    if (payload?.activity?.fileChange) changes.push(payload.activity.fileChange);
  }
  return changes;
}

function sessionSummaries(messages: SessionMessage[]): Array<{
  runId: string;
  fileChanges: FileChange[];
}> {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "run_summary"
        ? [{ runId: part.summary.runId, fileChanges: part.summary.fileChanges }]
        : [],
    ),
  );
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  callback: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length || 1) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await callback(values[index] as T, index);
    }
  });
  await Promise.all(workers);
  return output;
}

export class LocalReviewService {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly worktreePath: (sessionId: string) => string | null = () => null,
  ) {}

  private async git(root: string, args: string[]): Promise<GitResult> {
    const result = await exec(
      "git.exe",
      ["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "--literal-pathspecs", ...args],
      {
        cwd: root,
        env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
      },
    );
    return { stdout: result.stdout, stderr: result.stderr };
  }

  private async gitBuffer(root: string, args: string[]): Promise<Buffer> {
    const result = await exec(
      "git.exe",
      ["-c", "core.hooksPath=NUL", "-c", "core.fsmonitor=false", "--literal-pathspecs", ...args],
      {
        cwd: root,
        env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_DIFF_INPUT_BYTES,
        encoding: "buffer",
      },
    );
    return result.stdout;
  }

  private async gitOptional(root: string, args: string[]): Promise<string | null> {
    try {
      return (await this.git(root, args)).stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async gitOptionalRaw(root: string, args: string[]): Promise<string | null> {
    try {
      const output = (await this.git(root, args)).stdout;
      return output || null;
    } catch {
      return null;
    }
  }

  private async repositoryRoot(workspacePath: string): Promise<string | null> {
    const root = await this.gitOptional(workspacePath, ["rev-parse", "--show-toplevel"]);
    if (!root || !isAbsolute(root)) return null;
    const resolvedRoot = resolve(root);
    const local = relative(resolvedRoot, workspacePath);
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error("Git 仓库根目录与当前工作目录不匹配。");
    }
    return resolvedRoot;
  }

  private async resolveCommit(root: string, revision: string): Promise<string | null> {
    const output = await this.gitOptional(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${revision}^{commit}`,
    ]);
    return isObjectId(output) ? output.toLowerCase() : null;
  }

  private async branches(root: string): Promise<string[]> {
    const output = await this.gitOptional(root, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes",
    ]);
    return output
      ? [
          ...new Set(
            output
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter((value) => isSafeRefName(value) && !value.endsWith("/HEAD")),
          ),
        ].slice(0, 250)
      : [];
  }

  private chooseBaseRef(currentBranch: string | null, branches: string[]): string | null {
    const candidates = ["main", "master", "origin/main", "origin/master"];
    return (
      candidates.find((branch) => branch !== currentBranch && branches.includes(branch)) ??
      branches.find((branch) => branch !== currentBranch) ??
      null
    );
  }

  private async parseNameStatus(output: string): Promise<NameStatus[]> {
    const tokens = splitNullSeparated(output);
    const statuses: NameStatus[] = [];
    for (let index = 0; index + 1 < tokens.length; index += 2) {
      const status = tokens[index]?.slice(0, 1) ?? "";
      const path = tokens[index + 1] ?? "";
      if (!status || !isSafeReviewPath(path)) continue;
      statuses.push({ changeType: changeTypeForStatus(status), path: normalizeGitPath(path) });
    }
    return statuses;
  }

  private async workingStatuses(root: string, head: string | null): Promise<NameStatus[]> {
    if (!head) {
      const indexed = (await this.gitOptionalRaw(root, ["ls-files", "-z", "--", "."])) ?? "";
      const untracked =
        (await this.gitOptionalRaw(root, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
          ".",
        ])) ?? "";
      return [...new Set([...splitNullSeparated(indexed), ...splitNullSeparated(untracked)])]
        .filter(isSafeReviewPath)
        .map((path) => ({ changeType: "created" as const, path: normalizeGitPath(path) }));
    }

    const tracked = await this.parseNameStatus(
      (
        await this.git(root, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--relative",
          "--no-renames",
          "--name-status",
          "-z",
          head,
          "--",
          ".",
        ])
      ).stdout,
    );
    const untrackedOutput =
      (await this.gitOptionalRaw(root, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
      ])) ?? "";
    const statuses = new Map<string, NameStatus>();
    for (const item of tracked) statuses.set(normalizeGitPath(item.path), item);
    for (const path of splitNullSeparated(untrackedOutput)) {
      if (isSafeReviewPath(path)) {
        statuses.set(normalizeGitPath(path), {
          changeType: "created",
          path: normalizeGitPath(path),
        });
      }
    }
    return [...statuses.values()];
  }

  private async readWorkingFile(root: string, path: string): Promise<WorkingFile> {
    try {
      const metadata = await statGuardedPath(root, path);
      if (metadata.state === "missing") return { hash: "missing", buffer: null, warning: null };
      if (metadata.directory) {
        return { hash: null, buffer: null, warning: `${path} 不是普通文件。` };
      }
      if (metadata.size > MAX_FINGERPRINT_BYTES) {
        return { hash: null, buffer: null, warning: `${path} 超过 16 MiB，无法安全审阅。` };
      }
      const file = await readGuardedFile(root, path, MAX_FINGERPRINT_BYTES);
      return { hash: file.sha256, buffer: file.buffer, warning: null };
    } catch (error) {
      return { hash: null, buffer: null, warning: `${path} 无法安全读取：${String(error)}` };
    }
  }

  private async gitFileDiff(
    context: SnapshotContext,
    status: NameStatus,
    revisionArgs: string[],
    workingScope: boolean,
    warnings: string[],
  ): Promise<ReviewSource> {
    const root = context.root;
    const working = await this.readWorkingFile(root, status.path);
    if (working.warning) {
      warnings.push(working.warning);
      return { status, diff: null, additions: 0, deletions: 0, workingHash: null };
    }
    if (status.changeType === "created" && workingScope) {
      const buffer = working.buffer;
      if (
        !buffer ||
        buffer.length > MAX_DIFF_INPUT_BYTES ||
        buffer.includes(0) ||
        exceedsDiffLineLimit(buffer)
      ) {
        warnings.push(
          !buffer
            ? `${status.path} 不存在，未生成逐行 diff。`
            : buffer.includes(0)
              ? `${status.path} 是二进制文件。`
              : `${status.path} 超过逐行 diff 的大小或行数限制。`,
        );
        return { status, diff: null, additions: 0, deletions: 0, workingHash: working.hash };
      }
      const created = createdFileDiff(buffer.toString("utf8").replace(/^\uFEFF/, ""));
      if (created.diff?.truncated) warnings.push(`${status.path} 的 diff 已截断。`);
      return {
        status,
        diff: created.diff,
        additions: created.additions,
        deletions: created.deletions,
        workingHash: working.hash,
      };
    }

    try {
      let output: string;
      if (workingScope) {
        const gitPath = context.gitPrefix ? `${context.gitPrefix}/${status.path}` : status.path;
        const blob = context.headCommit
          ? await this.gitBlob(root, context.headCommit, gitPath)
          : null;
        if (!blob) throw new Error("固定 HEAD 中没有可读取的文件对象。");
        const kind = await this.gitOptional(root, ["cat-file", "-t", blob]);
        const sizeText = await this.gitOptional(root, ["cat-file", "-s", blob]);
        const size = sizeText && /^\d+$/.test(sizeText) ? Number(sizeText) : NaN;
        if (kind !== "blob" || !Number.isSafeInteger(size) || size > MAX_DIFF_INPUT_BYTES) {
          throw new Error("提交中的文件不是有界的普通 blob。");
        }
        const before = await this.gitBuffer(root, ["cat-file", "blob", blob]);
        const after = working.buffer ?? Buffer.alloc(0);
        if (
          before.length !== size ||
          after.length > MAX_DIFF_INPUT_BYTES ||
          before.includes(0) ||
          after.includes(0) ||
          exceedsDiffLineLimit(before) ||
          exceedsDiffLineLimit(after)
        ) {
          throw new Error("文件为二进制内容或超过逐行 diff 的大小或行数限制。");
        }
        const bounded = await guardedTextDiff(before, after);
        if (bounded === undefined) throw new Error("逐行 diff 超过时间或变更量限制。");
        output = bounded;
      } else {
        output = (
          await this.git(root, [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-renames",
            "--relative",
            "--unified=3",
            ...revisionArgs,
            "--",
            status.path,
          ])
        ).stdout;
      }
      const parsed = parseUnifiedDiff(output);
      const additions = parsed.diff?.lines.filter((line) => line.type === "added").length ?? 0;
      const deletions = parsed.diff?.lines.filter((line) => line.type === "removed").length ?? 0;
      if (parsed.truncated) warnings.push(`${status.path} 的 diff 已截断。`);
      if (!parsed.diff && /binary files|GIT binary patch/i.test(output)) {
        warnings.push(`${status.path} 是二进制文件，未显示逐行内容。`);
      }
      return {
        status,
        diff: parsed.diff,
        additions,
        deletions,
        workingHash: working.hash,
      };
    } catch (error) {
      warnings.push(`${status.path} 的 diff 无法读取或超过大小预算。${String(error)}`);
      return { status, diff: null, additions: 0, deletions: 0, workingHash: working.hash };
    }
  }

  private async gitBlob(root: string, revision: string, path: string): Promise<string | null> {
    const output = await this.gitOptional(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${revision}:${path}`,
    ]);
    return isObjectId(output) ? output.toLowerCase() : null;
  }

  private async versionFor(
    context: SnapshotContext,
    source: ReviewSource,
    identity: string,
  ): Promise<string> {
    const gitPath = context.gitPrefix
      ? `${context.gitPrefix}/${source.status.path}`
      : source.status.path;
    const headBlob =
      context.isRepository && context.headCommit
        ? await this.gitBlob(context.root, context.headCommit, gitPath)
        : null;
    const baseBlob =
      context.isRepository && context.baseCommit && context.scopeIsBranch
        ? await this.gitBlob(context.root, context.baseCommit, gitPath)
        : null;
    return hashJson({
      identity,
      path: source.status.path,
      changeType: source.status.changeType,
      additions: source.additions,
      deletions: source.deletions,
      diff: source.diff,
      workingHash: source.workingHash,
      headBlob,
      baseBlob,
    });
  }

  private async buildGitSources(
    context: SnapshotContext,
    scope: "git" | "branch",
  ): Promise<ReviewSource[]> {
    if (!context.isRepository) {
      context.warnings.push("当前工作目录不是 Git 仓库。");
      return [];
    }
    let statuses: NameStatus[];
    let revisionArgs: string[];
    if (scope === "branch") {
      if (!context.baseCommit || !context.headCommit) {
        context.warnings.push("没有可用于分支比较的基准或 HEAD。");
        return [];
      }
      const mergeBase = await this.gitOptional(context.root, [
        "merge-base",
        context.baseCommit,
        context.headCommit,
      ]);
      if (!isObjectId(mergeBase)) {
        context.warnings.push("所选分支与当前 HEAD 没有共同祖先。");
        return [];
      }
      context.baseCommit = mergeBase.toLowerCase();
      statuses = await this.parseNameStatus(
        (
          await this.git(context.root, [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--relative",
            "--name-status",
            "-z",
            mergeBase,
            context.headCommit,
            "--",
            ".",
          ])
        ).stdout,
      );
      revisionArgs = [mergeBase, context.headCommit];
    } else {
      statuses = await this.workingStatuses(context.root, context.headCommit);
      revisionArgs = context.headCommit ? [context.headCommit] : [];
    }

    const sorted = statuses.sort((left, right) => left.path.localeCompare(right.path));
    if (sorted.length > MAX_REVIEW_FILES) {
      context.truncated = true;
      context.warnings.push(
        `变更文件超过 ${MAX_REVIEW_FILES} 个，仅显示前 ${MAX_REVIEW_FILES} 个文件。`,
      );
    }
    return mapWithConcurrency(sorted.slice(0, MAX_REVIEW_FILES), 3, (status) =>
      this.gitFileDiff(context, status, revisionArgs, scope === "git", context.warnings),
    );
  }

  private normalizeSessionChangePath(
    workspacePath: string,
    value: string,
    warnings: string[],
  ): string | null {
    if (!isAbsolute(value)) {
      return isSafeReviewPath(value) ? normalizeGitPath(value) : null;
    }
    const local = relative(workspacePath, value);
    if (
      !local ||
      local === ".." ||
      local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(local) ||
      !isSafeReviewPath(local)
    ) {
      warnings.push("已忽略工作区外的历史文件变更。");
      return null;
    }
    return normalizeGitPath(local);
  }

  private async sessionSources(
    session: SessionView,
    scope: "session" | "previous",
    context: SnapshotContext,
  ): Promise<ReviewSource[]> {
    const summaries = sessionSummaries(this.repository.getMessages(session.id));
    const latestRun = this.repository.latestSessionRun(session.id);
    let changes: FileChange[];
    if (scope === "previous") {
      changes = summaries.at(-1)?.fileChanges ?? [];
      context.runId = summaries.at(-1)?.runId ?? latestRun?.runId ?? null;
      if (!summaries.length) context.warnings.push("当前会话还没有已完成的上一轮变更。");
    } else {
      changes = summaries.flatMap((summary) => summary.fileChanges);
      context.runId = latestRun?.runId ?? summaries.at(-1)?.runId ?? null;
      if (latestRun?.status === "running") {
        changes.push(
          ...activityFileChanges(this.repository.listTrajectory(session.id, latestRun.runId)),
        );
      }
      if (!summaries.length && latestRun?.status !== "running") {
        context.warnings.push("当前会话还没有可审阅的文件变更。");
      }
    }

    const merged = mergeFileChanges(changes);
    const sources: ReviewSource[] = [];
    for (const change of merged) {
      const path = this.normalizeSessionChangePath(
        context.workspacePath,
        change.path,
        context.warnings,
      );
      if (!path) continue;
      const normalized = normalizeDiff(change.diff);
      if (normalized.truncated) context.warnings.push(`${path} 的 diff 已截断。`);
      sources.push({
        status: { changeType: change.changeType, path },
        diff: normalized.diff,
        additions: Math.max(0, change.additions),
        deletions: Math.max(0, change.deletions),
        workingHash: null,
      });
    }
    sources.sort((left, right) => left.status.path.localeCompare(right.status.path));
    if (sources.length > MAX_REVIEW_FILES) {
      context.truncated = true;
      context.warnings.push(
        `变更文件超过 ${MAX_REVIEW_FILES} 个，仅显示前 ${MAX_REVIEW_FILES} 个文件。`,
      );
    }
    return mapWithConcurrency(sources.slice(0, MAX_REVIEW_FILES), 3, async (source) => {
      const working = await this.readWorkingFile(context.root, source.status.path);
      if (working.warning) {
        context.warnings.push(working.warning);
        return { ...source, diff: null, workingHash: null };
      }
      return { ...source, workingHash: working.hash };
    });
  }

  private sessionWorkspace(session: SessionView): string {
    if (!session.workspacePath) throw new Error("当前会话没有工作目录。");
    const path =
      session.executionMode === "worktree" ? this.worktreePath(session.id) : session.workspacePath;
    if (!path) throw new Error("当前会话的 worktree 不可用，无法审阅。");
    if (!isAbsolute(path)) throw new Error("当前会话的工作目录不是绝对路径。");
    return resolve(path);
  }

  async get(input: LocalReviewRequest): Promise<LocalReviewSnapshot> {
    this.validateRequest(input);
    const session = this.repository.getSession(input.sessionId);
    if (!session) throw new Error("会话不存在。");
    if (session.agentMode === "chat") throw new Error("ChatAgent 不开放本地 diff 审阅。");
    const workspacePath = this.sessionWorkspace(session);
    await inspectGuardedPaths(workspacePath, []);
    const gitRoot = await this.repositoryRoot(workspacePath);
    const root = workspacePath;
    const gitPrefix = gitRoot ? normalizeGitPath(relative(gitRoot, workspacePath)) : "";
    const isRepository = Boolean(gitRoot);
    const branchOutput = isRepository
      ? await this.gitOptional(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])
      : null;
    const currentBranch = branchOutput && isSafeRefName(branchOutput) ? branchOutput : null;
    const branches = isRepository ? await this.branches(root) : [];
    let baseRef = input.baseRef?.trim() || null;
    if (input.scope === "branch") {
      if (!baseRef) baseRef = this.chooseBaseRef(currentBranch, branches);
      if (baseRef && !branches.includes(baseRef)) throw new Error("所选基准分支不存在。");
    } else {
      baseRef = null;
    }
    const headCommit = isRepository ? await this.resolveCommit(root, "HEAD") : null;
    const baseCommit = isRepository && baseRef ? await this.resolveCommit(root, baseRef) : null;
    if (input.scope === "branch" && baseRef && !baseCommit) {
      throw new Error("所选基准分支没有有效提交。");
    }

    const context: SnapshotContext = {
      workspacePath,
      root,
      gitPrefix,
      isRepository,
      currentBranch,
      baseRef,
      branches,
      headCommit,
      baseCommit,
      warnings: [],
      truncated: false,
      runId: null,
      scopeIsBranch: input.scope === "branch",
    };
    const sources =
      input.scope === "session" || input.scope === "previous"
        ? await this.sessionSources(session, input.scope, context)
        : await this.buildGitSources(context, input.scope);
    const identity = [
      input.scope,
      context.root,
      context.baseRef ?? "",
      context.headCommit ?? "",
      context.runId ?? "",
    ].join(":");
    const files = await mapWithConcurrency(sources, 4, async (source) => ({
      path: source.status.path,
      absolutePath: resolve(context.root, source.status.path),
      changeType: source.status.changeType,
      additions: source.additions,
      deletions: source.deletions,
      diff: source.diff,
      version: await this.versionFor(context, source, identity),
    }));

    const current = this.repository.getSession(input.sessionId);
    if (
      !current ||
      current.executionMode !== session.executionMode ||
      current.workspacePath !== session.workspacePath ||
      this.sessionWorkspace(current) !== workspacePath
    ) {
      throw new Error("会话工作目录已变化，请重新加载审阅。");
    }

    return {
      sessionId: session.id,
      scope: input.scope,
      workspacePath,
      root,
      isRepository,
      currentBranch: context.currentBranch,
      baseRef: context.baseRef,
      branches: context.branches,
      generatedAt: new Date().toISOString(),
      files,
      warnings: [...new Set(context.warnings)].slice(0, 20),
      truncated: context.truncated,
      runId: context.runId,
    };
  }

  async submit(input: LocalReviewCommentsInput): Promise<LocalReviewCommentsResult> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("无效的代码审查请求。");
    }
    this.validateRequest(input.request);
    if (
      !Array.isArray(input.comments) ||
      input.comments.length === 0 ||
      input.comments.length > MAX_COMMENTS
    ) {
      throw new Error(`每条消息最多包含 ${MAX_COMMENTS} 条代码审查意见。`);
    }
    if (
      input.comments.reduce(
        (total, comment) => total + (typeof comment?.text === "string" ? comment.text.length : 0),
        0,
      ) > MAX_TOTAL_COMMENT_CHARACTERS
    ) {
      throw new Error("代码审查意见总长度超过限制。");
    }
    const snapshot = await this.get(input.request);
    const stale = new Set<string>();
    const sections: string[] = [];

    for (const comment of input.comments) {
      const invalidReason = this.validateComment(comment, snapshot);
      if (invalidReason) {
        stale.add(typeof comment?.path === "string" ? comment.path : "未知文件");
        continue;
      }
      const file = snapshot.files.find((candidate) => samePath(candidate.path, comment.path));
      const quote = file?.diff ? this.selectionQuote(file.diff, comment) : null;
      if (!file || !quote) {
        stale.add(comment.path);
        continue;
      }
      sections.push(
        [
          `## ${sections.length + 1}. ${file.path}`,
          "",
          `范围：${comment.side === "old" ? "旧" : "新"}行 ${comment.startLine}-${comment.endLine}`,
          `Diff 版本：${file.version}`,
          "",
          "选中内容：",
          "```text",
          quote,
          "```",
          "",
          "意见：",
          comment.text.trim(),
        ].join("\n"),
      );
    }

    if (stale.size) {
      return {
        ok: false,
        staleFiles: [...stale],
        formattedText: null,
      };
    }
    return {
      ok: true,
      staleFiles: [],
      formattedText: [
        "请处理以下代码审查意见。修改前先重新读取当前文件，以当前内容为准。",
        "",
        sections.join("\n\n"),
      ].join("\n"),
    };
  }

  private validateRequest(input: LocalReviewRequest): void {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      typeof input.sessionId !== "string" ||
      !input.sessionId ||
      input.sessionId.length > 200 ||
      !["git", "branch", "session", "previous"].includes(input.scope) ||
      (input.baseRef !== undefined &&
        input.baseRef !== null &&
        (typeof input.baseRef !== "string" || input.baseRef.length > 250))
    ) {
      throw new Error("无效的代码审查范围。");
    }
  }

  private validateComment(
    comment: LocalReviewCommentDraft,
    snapshot: LocalReviewSnapshot,
  ): string | null {
    if (
      !comment ||
      typeof comment !== "object" ||
      Array.isArray(comment) ||
      typeof comment.path !== "string" ||
      !isSafeReviewPath(comment.path) ||
      typeof comment.version !== "string" ||
      !/^[a-f0-9]{64}$/i.test(comment.version) ||
      (comment.side !== "old" && comment.side !== "new") ||
      !Number.isInteger(comment.startLine) ||
      !Number.isInteger(comment.endLine) ||
      comment.startLine < 1 ||
      comment.endLine < comment.startLine ||
      comment.endLine - comment.startLine > 499 ||
      typeof comment.text !== "string" ||
      !comment.text.trim() ||
      comment.text.length > MAX_COMMENT_CHARACTERS
    ) {
      return "invalid";
    }
    const file = snapshot.files.find((candidate) => samePath(candidate.path, comment.path));
    if (!file || file.version !== comment.version) return "stale";
    return null;
  }

  private selectionQuote(diff: FileDiff, comment: LocalReviewCommentDraft): string | null {
    const selected = diff.lines.filter((line) => {
      const number = comment.side === "old" ? line.oldLine : line.newLine;
      return number !== null && number >= comment.startLine && number <= comment.endLine;
    });
    const numbers = selected
      .map((line) => (comment.side === "old" ? line.oldLine : line.newLine))
      .filter((line): line is number => line !== null);
    if (
      !numbers.length ||
      numbers.length !== comment.endLine - comment.startLine + 1 ||
      numbers[0] !== comment.startLine ||
      numbers.at(-1) !== comment.endLine
    ) {
      return null;
    }
    const text = selected
      .map((line) => line.text)
      .join("\n")
      .slice(0, MAX_QUOTE_CHARACTERS);
    return text || "（空行）";
  }
}
