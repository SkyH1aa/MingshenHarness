import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type {
  FileChange,
  SessionMessage,
  SessionRunState,
  SessionView,
  TrajectoryEvent,
} from "../../shared/domain";
import { createFileDiff } from "./file-diff";
import { stopGuardedWorkspaceIo } from "./guarded-workspace-io";
import { LocalReviewService } from "./local-review-service";

const exec = promisify(execFile);
const roots: string[] = [];

afterAll(async () => {
  await stopGuardedWorkspaceIo();
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function gitRepository() {
  const root = await mkdtemp(join(tmpdir(), "mingshen-local-review-"));
  roots.push(root);
  const git = async (...args: string[]) =>
    (await exec("git.exe", args, { cwd: root, windowsHide: true })).stdout;
  await git("init");
  await git("config", "user.name", "Test");
  await git("config", "user.email", "test@example.invalid");
  await git("config", "core.autocrlf", "false");
  await git("branch", "-M", "main");
  await writeFile(join(root, "tracked.txt"), "alpha\nbeta\ngamma\n");
  await git("add", ".");
  await git("commit", "-m", "fixture");
  return { root, git };
}

function session(workspacePath: string): SessionView {
  return {
    id: "session-review",
    title: "Review",
    parentSessionId: null,
    agentMode: "code",
    chatGroupId: null,
    providerId: null,
    modelId: null,
    agentProfileId: "primary",
    workspacePath,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "full_access",
    executionMode: "host",
    patchOnly: false,
    status: "idle",
    archived: false,
    pinned: false,
    createdAt: "2026-11-20T00:00:00.000Z",
    updatedAt: "2026-11-20T00:00:00.000Z",
    lastOpenedAt: "2026-11-20T00:00:00.000Z",
  };
}

function message(seq: number, runId: string, fileChanges: FileChange[]): SessionMessage {
  return {
    id: `message-${seq}`,
    sessionId: "session-review",
    seq,
    role: "assistant",
    parts: [
      {
        type: "run_summary",
        summary: {
          runId,
          durationMs: 1,
          toolCount: 1,
          fileChanges,
        },
      },
    ],
    createdAt: `2026-11-20T00:00:0${seq}.000Z`,
  };
}

function repository(input: {
  workspacePath: string;
  messages?: SessionMessage[];
  trajectory?: TrajectoryEvent[];
  latestRun?: SessionRunState | null;
  sessionOverrides?: Partial<SessionView>;
}) {
  return {
    getSession: (id: string) =>
      id === "session-review"
        ? { ...session(input.workspacePath), ...input.sessionOverrides }
        : null,
    getMessages: () => input.messages ?? [],
    listTrajectory: () => input.trajectory ?? [],
    latestSessionRun: () => input.latestRun ?? null,
  } as never;
}

describe("LocalReviewService", () => {
  it("lists working changes and untracked files with valid selectable lines", async () => {
    const { root, git } = await gitRepository();
    await writeFile(join(root, "tracked.txt"), "alpha\nchanged\ngamma\n");
    await writeFile(join(root, "new.txt"), "first\nsecond\n");
    const statusBefore = await git("status", "--porcelain=v1");
    const service = new LocalReviewService(repository({ workspacePath: root }));

    const snapshot = await service.get({
      sessionId: "session-review",
      scope: "git",
    });
    const tracked = snapshot.files.find((file) => file.path === "tracked.txt");
    const untracked = snapshot.files.find((file) => file.path === "new.txt");

    expect(snapshot.currentBranch).toBe("main");
    expect(tracked?.changeType).toBe("modified");
    expect(tracked?.diff?.lines.some((line) => line.type === "added")).toBe(true);
    expect(untracked?.changeType).toBe("created");
    expect(untracked?.diff).not.toBeNull();
    expect(untracked?.additions).toBe(2);

    const added = tracked?.diff?.lines.find((line) => line.type === "added");
    const removed = tracked?.diff?.lines.find((line) => line.type === "removed");
    expect(added?.newLine).toBe(2);
    expect(removed?.oldLine).toBe(2);
    const result = await service.submit({
      request: { sessionId: "session-review", scope: "git" },
      comments: [
        {
          path: "tracked.txt",
          version: tracked?.version ?? "",
          side: "new",
          startLine: added?.newLine ?? 0,
          endLine: added?.newLine ?? 0,
          text: "请保留这一行并补充校验。",
        },
        {
          path: "tracked.txt",
          version: tracked?.version ?? "",
          side: "old",
          startLine: removed?.oldLine ?? 0,
          endLine: removed?.oldLine ?? 0,
          text: "被替换的内容需要保持兼容。",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.formattedText).toContain("新行 2-2");
    expect(result.formattedText).toContain("旧行 2-2");
    expect(result.formattedText).toContain("changed");
    expect(result.formattedText).toContain("beta");
    expect(result.formattedText).toContain(`Diff 版本：${tracked?.version}`);
    expect(await git("status", "--porcelain=v1")).toBe(statusBefore);
  }, 20_000);

  it("preserves separate working diff hunks and shifted line numbers", async () => {
    const { root, git } = await gitRepository();
    const original = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`);
    await writeFile(join(root, "tracked.txt"), `${original.join("\n")}\n`);
    await git("add", ".");
    await git("commit", "-m", "multi hunk baseline");
    const changed = [...original];
    changed[9] = "first changed";
    changed[99] = "last changed";
    changed.splice(60, 0, "inserted");
    await writeFile(join(root, "tracked.txt"), `${changed.join("\n")}\n`);
    const service = new LocalReviewService(repository({ workspacePath: root }));

    const snapshot = await service.get({ sessionId: "session-review", scope: "git" });
    const lines = snapshot.files[0]?.diff?.lines ?? [];
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "removed", oldLine: 10, text: "line 10" }),
        expect.objectContaining({ type: "added", newLine: 10, text: "first changed" }),
        expect.objectContaining({ type: "added", newLine: 61, text: "inserted" }),
        expect.objectContaining({ type: "removed", oldLine: 100, text: "line 100" }),
        expect.objectContaining({ type: "added", newLine: 101, text: "last changed" }),
      ]),
    );
    expect(lines.some((line) => line.text === "line 35")).toBe(false);
  }, 20_000);

  it("pins HEAD even if another process commits while a review is loading", async () => {
    const { root, git } = await gitRepository();
    const initialHead = (await git("rev-parse", "HEAD")).trim();
    await writeFile(join(root, "tracked.txt"), "alpha\ncommitted during review\ngamma\n");
    const service = new LocalReviewService(repository({ workspacePath: root }));
    const internals = service as unknown as {
      workingStatuses: (directory: string, head: string | null) => Promise<unknown>;
    };
    const original = internals.workingStatuses.bind(service);
    let capturedHead: string | null = null;
    internals.workingStatuses = async (directory, head) => {
      capturedHead = head;
      await git("add", ".");
      await git("commit", "-m", "concurrent change");
      return original(directory, head);
    };

    const snapshot = await service.get({ sessionId: "session-review", scope: "git" });
    expect(capturedHead).toBe(initialHead);
    expect(snapshot.files[0]?.diff?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "removed", oldLine: 2, text: "beta" }),
        expect.objectContaining({ type: "added", newLine: 2, text: "committed during review" }),
      ]),
    );
  }, 20_000);

  it("reviews staged and untracked additions in an unborn repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-unborn-review-"));
    roots.push(root);
    const git = async (...args: string[]) =>
      (await exec("git.exe", args, { cwd: root, windowsHide: true })).stdout;
    await git("init");
    await writeFile(join(root, "staged.txt"), "staged\n");
    await git("add", "staged.txt");
    await writeFile(join(root, "untracked.txt"), "untracked\n");
    const service = new LocalReviewService(repository({ workspacePath: root }));

    const snapshot = await service.get({ sessionId: "session-review", scope: "git" });
    expect(snapshot.files.map((file) => file.path)).toEqual(["staged.txt", "untracked.txt"]);
    expect(snapshot.files.every((file) => file.diff?.lines[0]?.newLine === 1)).toBe(true);
  }, 20_000);

  it("does not expose selectable lines for a changed binary blob", async () => {
    const { root, git } = await gitRepository();
    await writeFile(join(root, "binary.bin"), Buffer.from([1, 0, 2]));
    await git("add", ".");
    await git("commit", "-m", "binary baseline");
    await writeFile(join(root, "binary.bin"), Buffer.from([1, 0, 3]));
    const service = new LocalReviewService(repository({ workspacePath: root }));

    const snapshot = await service.get({ sessionId: "session-review", scope: "git" });
    expect(snapshot.files.find((file) => file.path === "binary.bin")?.diff).toBeNull();
    expect(snapshot.warnings.join("\n")).toContain("二进制");
  }, 20_000);

  it("suppresses a working diff whose input exceeds the line budget", async () => {
    const { root, git } = await gitRepository();
    await writeFile(join(root, "tracked.txt"), "baseline\n");
    await git("add", ".");
    await git("commit", "-m", "line budget baseline");
    await writeFile(join(root, "tracked.txt"), "x\n".repeat(100_001));
    const service = new LocalReviewService(repository({ workspacePath: root }));

    const snapshot = await service.get({ sessionId: "session-review", scope: "git" });
    expect(snapshot.files[0]?.diff).toBeNull();
    expect(snapshot.warnings.join("\n")).toContain("行数限制");
  }, 20_000);

  it.skipIf(process.platform !== "win32")(
    "does not expose a Git working file replaced by an external hard link",
    async () => {
      const { root } = await gitRepository();
      const outside = await mkdtemp(join(tmpdir(), "mingshen-review-hardlink-outside-"));
      roots.push(outside);
      await writeFile(join(outside, "secret.txt"), "outside secret\n");
      await rm(join(root, "tracked.txt"));
      await link(join(outside, "secret.txt"), join(root, "tracked.txt"));
      const service = new LocalReviewService(repository({ workspacePath: root }));

      const snapshot = await service.get({ sessionId: "session-review", scope: "git" });
      expect(snapshot.files[0]?.diff).toBeNull();
      expect(snapshot.warnings.join("\n")).toContain("链接");
    },
    20_000,
  );

  it("rejects old line numbers when the target file changes after review", async () => {
    const { root } = await gitRepository();
    await writeFile(join(root, "tracked.txt"), "alpha\nreviewed\ngamma\n");
    const service = new LocalReviewService(repository({ workspacePath: root }));
    const snapshot = await service.get({
      sessionId: "session-review",
      scope: "git",
    });
    const file = snapshot.files.find((candidate) => candidate.path === "tracked.txt");
    const added = file?.diff?.lines.find((line) => line.type === "added");

    await writeFile(join(root, "tracked.txt"), "alpha\nchanged again\ngamma\n");
    const result = await service.submit({
      request: { sessionId: "session-review", scope: "git" },
      comments: [
        {
          path: "tracked.txt",
          version: file?.version ?? "",
          side: "new",
          startLine: added?.newLine ?? 2,
          endLine: added?.newLine ?? 2,
          text: "旧行号意见不应进入输入框。",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.staleFiles).toEqual(["tracked.txt"]);
    expect(result.formattedText).toBeNull();
  }, 20_000);

  it("uses merge-base for a committed branch comparison", async () => {
    const { root, git } = await gitRepository();
    await git("checkout", "-b", "feature/review");
    await writeFile(join(root, "tracked.txt"), "alpha\nbranch change\ngamma\n");
    await git("add", ".");
    await git("commit", "-m", "feature");
    await writeFile(join(root, "tracked.txt"), "alpha\nworktree override\ngamma\n");
    const service = new LocalReviewService(repository({ workspacePath: root }));

    const snapshot = await service.get({
      sessionId: "session-review",
      scope: "branch",
      baseRef: "main",
    });
    const file = snapshot.files.find((candidate) => candidate.path === "tracked.txt");

    expect(snapshot.baseRef).toBe("main");
    expect(snapshot.currentBranch).toBe("feature/review");
    expect(file?.diff?.lines.some((line) => line.text === "branch change")).toBe(true);
    expect(file?.diff?.lines.some((line) => line.text === "worktree override")).toBe(false);
  }, 20_000);

  it("distinguishes the latest completed turn from the whole session", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-session-review-"));
    roots.push(root);
    const firstDiff = createFileDiff("old\n", "first\n").diff ?? undefined;
    const secondDiff = createFileDiff("old\n", "second\n").diff ?? undefined;
    const messages = [
      message(1, "run-1", [
        {
          path: "first.md",
          changeType: "modified",
          additions: 1,
          deletions: 1,
          diff: firstDiff,
        },
      ]),
      message(2, "run-2", [
        {
          path: "second.md",
          changeType: "modified",
          additions: 1,
          deletions: 1,
          diff: secondDiff,
        },
      ]),
    ];
    const service = new LocalReviewService(
      repository({
        workspacePath: root,
        messages,
        latestRun: {
          sessionId: "session-review",
          runId: "run-2",
          startedAt: "2026-11-20T00:00:02.000Z",
          completedAt: "2026-11-20T00:00:03.000Z",
          status: "completed",
        },
      }),
    );

    const sessionReview = await service.get({
      sessionId: "session-review",
      scope: "session",
    });
    const previousReview = await service.get({
      sessionId: "session-review",
      scope: "previous",
    });

    expect(sessionReview.files.map((file) => file.path)).toEqual(["first.md", "second.md"]);
    expect(previousReview.files.map((file) => file.path)).toEqual(["second.md"]);
    expect(previousReview.runId).toBe("run-2");
  }, 10_000);

  it("keeps Git and branch results within a nested workspace", async () => {
    const { root, git } = await gitRepository();
    const workspace = join(root, "project");
    await mkdir(workspace);
    await writeFile(join(workspace, "inside.txt"), "inside baseline\n");
    await writeFile(join(root, "outside.txt"), "outside baseline\n");
    await git("add", ".");
    await git("commit", "-m", "workspace baseline");
    await git("checkout", "-b", "feature/nested");
    await writeFile(join(workspace, "inside.txt"), "inside branch\n");
    await writeFile(join(root, "outside.txt"), "outside branch\n");
    await git("add", ".");
    await git("commit", "-m", "branch changes");
    await writeFile(join(workspace, "inside.txt"), "inside working\n");
    await writeFile(join(root, "outside.txt"), "outside working\n");
    await writeFile(join(workspace, "new.txt"), "new inside\n");
    const service = new LocalReviewService(repository({ workspacePath: workspace }));

    const working = await service.get({ sessionId: "session-review", scope: "git" });
    const branch = await service.get({
      sessionId: "session-review",
      scope: "branch",
      baseRef: "main",
    });

    expect(working.root).toBe(workspace);
    expect(working.files.map((file) => file.path)).toEqual(["inside.txt", "new.txt"]);
    expect(working.files.find((file) => file.path === "inside.txt")?.diff?.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "inside working" })]),
    );
    expect(branch.files.map((file) => file.path)).toEqual(["inside.txt"]);
    expect(branch.files[0]?.diff?.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: "inside branch" })]),
    );
    await expect(
      service.get({ sessionId: "session-review", scope: "branch", baseRef: "--help" }),
    ).rejects.toThrow("所选基准分支不存在");
  }, 30_000);

  it("uses only the actual worktree for worktree sessions", async () => {
    const { root, git } = await gitRepository();
    const parent = await mkdtemp(join(tmpdir(), "mingshen-review-worktree-"));
    roots.push(parent);
    const worktree = join(parent, "worktree");
    await git("worktree", "add", "--detach", worktree, "HEAD");
    await writeFile(join(root, "tracked.txt"), "host change\n");
    await writeFile(join(worktree, "tracked.txt"), "worktree change\n");
    const source = repository({
      workspacePath: root,
      sessionOverrides: { executionMode: "worktree" },
    });

    await expect(
      new LocalReviewService(source).get({ sessionId: "session-review", scope: "git" }),
    ).rejects.toThrow("worktree 不可用");
    const service = new LocalReviewService(source, () => worktree);
    const snapshot = await service.get({ sessionId: "session-review", scope: "git" });
    expect(snapshot.workspacePath).toBe(worktree);
    expect(snapshot.root).toBe(worktree);
    expect(snapshot.files[0]?.diff?.lines.some((line) => line.text === "worktree change")).toBe(
      true,
    );
    expect(snapshot.files[0]?.diff?.lines.some((line) => line.text === "host change")).toBe(false);
  }, 30_000);

  it.skipIf(process.platform !== "win32")(
    "does not expose a recorded diff through a junction, hard link or oversized file",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-review-guard-"));
      const outside = await mkdtemp(join(tmpdir(), "mingshen-review-outside-"));
      roots.push(root, outside);
      await writeFile(join(outside, "secret.txt"), "outside secret\n");
      await symlink(outside, join(root, "linked"), "junction");
      await link(join(outside, "secret.txt"), join(root, "hard.txt"));
      await writeFile(join(root, "large.txt"), Buffer.alloc(16 * 1024 * 1024 + 1, 65));
      const diff = createFileDiff("old\n", "outside secret\n").diff ?? undefined;
      const changes = ["linked/secret.txt", "hard.txt", "large.txt"].map((path) => ({
        path,
        changeType: "modified" as const,
        additions: 1,
        deletions: 1,
        diff,
      }));
      const service = new LocalReviewService(
        repository({ workspacePath: root, messages: [message(1, "run-1", changes)] }),
      );
      const snapshot = await service.get({ sessionId: "session-review", scope: "session" });

      expect(snapshot.files).toHaveLength(3);
      expect(snapshot.files.every((file) => file.diff === null)).toBe(true);
      expect(snapshot.warnings.join("\n")).toMatch(/链接/);
      expect(snapshot.warnings.join("\n")).toMatch(/16 MiB/);
    },
    30_000,
  );
});
