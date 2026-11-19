import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerDraftAttachment, SaveComposerDraftInput } from "../../shared/composer-draft";
import {
  COMPOSER_DRAFT_CONFLICT_CODE,
  MAX_COMPOSER_ATTACHMENT_BYTES,
} from "../../shared/composer-draft";
import { openDatabase } from "./database";
import { Repository } from "./repository";

const attachment = (
  id: string,
  bytes = Buffer.from([0, 255, 3, 128]),
): ComposerDraftAttachment => ({
  id,
  name: `${id}.bin`,
  mimeType: "application/octet-stream",
  size: bytes.length,
  kind: "file",
  dataUrl: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
  path: `C:\\fixture\\${id}.bin`,
});

function createSession(repository: Repository, parentSessionId?: string) {
  return repository.insertSession({
    title: "Draft fixture",
    providerId: null,
    modelId: null,
    agentProfileId: "primary",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: null,
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
    ...(parentSessionId ? { parentSessionId } : {}),
  });
}

function draft(
  sessionId: string,
  change: Partial<SaveComposerDraftInput> = {},
): SaveComposerDraftInput {
  return {
    sessionId,
    revision: "revision-1",
    text: "  # Pending\n\n$x^2$  ",
    formatted: true,
    attachmentIds: [],
    notificationDraftIds: [],
    ...change,
  };
}

describe("SQLite composer drafts", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
  });
  afterEach(() => database.close());

  it("restores independent text, formatting and exact attachment bytes across database launches", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-composer-db-"));
    const path = join(root, "drafts.db");
    let disk = openDatabase(path);
    try {
      let repo = new Repository(disk);
      const first = createSession(repo);
      const second = createSession(repo);
      const files = [
        attachment("binary"),
        attachment("empty", Buffer.alloc(0)),
        { ...attachment("image"), kind: "image" as const },
        { ...attachment("audio"), kind: "audio" as const },
        { ...attachment("video"), kind: "video" as const },
      ];
      const text = `  # Pending\n\n$x^2$\n${"Keep full draft\n".repeat(4000)}  `;
      repo.saveComposerDraft(
        draft(first.id, {
          text,
          addedAttachments: files,
          attachmentIds: files.map((file) => file.id),
          notificationDraftIds: ["notification-1"],
        }),
      );
      repo.saveComposerDraft(draft(second.id, { text: "Second session", formatted: false }));
      repo.setSetting("fixture.unrelated", { keep: true });
      for (let launch = 0; launch < 2; launch++) {
        disk.close();
        disk = openDatabase(path);
        repo = new Repository(disk);
        expect(repo.getComposerDraft(second.id)).toMatchObject({
          text: "Second session",
          formatted: false,
          attachments: [],
        });
        expect(repo.getComposerDraft(first.id)).toEqual({
          sessionId: first.id,
          revision: "revision-1",
          text,
          formatted: true,
          attachments: files,
          notificationDraftIds: ["notification-1"],
        });
        expect(repo.getSetting(`composer.draft.${first.id}`)).not.toHaveProperty("attachments");
        expect(repo.getSetting("fixture.unrelated")).toEqual({ keep: true });
        expect(disk.prepare("pragma user_version").get()?.user_version).toBe(9);
        expect(disk.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
      }
    } finally {
      disk.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses saved attachment bytes while text changes and removes only detached bytes", () => {
    const first = createSession(repository);
    const second = createSession(repository);
    const file = attachment("same-id");
    for (const session of [first, second])
      repository.saveComposerDraft(
        draft(session.id, { addedAttachments: [file], attachmentIds: [file.id] }),
      );
    const write = vi.spyOn(repository, "setSetting");
    repository.saveComposerDraft(
      draft(first.id, { revision: "revision-2", text: "Edited", attachmentIds: [file.id] }),
    );
    expect(write).toHaveBeenCalledExactlyOnceWith(
      `composer.draft.${first.id}`,
      expect.objectContaining({ text: "Edited", revision: "revision-2" }),
    );
    repository.saveComposerDraft(draft(first.id, { revision: "revision-3", text: "" }));
    expect(repository.getComposerDraft(first.id)).toBeNull();
    expect(repository.getSetting(`composer.draft-attachment.${first.id}.${file.id}`)).toBeNull();
    expect(repository.getComposerDraft(second.id)?.attachments).toEqual([file]);
  });

  it("uses baseRevision inside the savepoint and leaves newer text and attachments untouched", () => {
    const session = createSession(repository);
    const current = attachment("current");
    const stale = attachment("stale");
    repository.saveComposerDraft(
      draft(session.id, {
        baseRevision: null,
        revision: "revision-1",
        text: "Base",
      }),
    );
    repository.saveComposerDraft(
      draft(session.id, {
        baseRevision: "revision-1",
        revision: "revision-2",
        text: "Newer",
        attachmentIds: [current.id],
        addedAttachments: [current],
      }),
    );

    expect(() =>
      repository.saveComposerDraft(
        draft(session.id, {
          baseRevision: "revision-1",
          revision: "stale-revision",
          text: "Stale",
          attachmentIds: [stale.id],
          addedAttachments: [stale],
        }),
      ),
    ).toThrow(COMPOSER_DRAFT_CONFLICT_CODE);

    expect(repository.getComposerDraft(session.id)).toMatchObject({
      revision: "revision-2",
      text: "Newer",
      attachments: [current],
    });
    expect(repository.getSetting(`composer.draft-attachment.${session.id}.${stale.id}`)).toBeNull();
  });

  it("keeps the legacy unconditional save path when baseRevision is omitted", () => {
    const session = createSession(repository);
    repository.saveComposerDraft(
      draft(session.id, {
        baseRevision: null,
        revision: "revision-1",
        text: "Base",
      }),
    );
    repository.saveComposerDraft(
      draft(session.id, {
        revision: "revision-2",
        text: "Legacy overwrite",
      }),
    );
    expect(repository.getComposerDraft(session.id)).toMatchObject({
      revision: "revision-2",
      text: "Legacy overwrite",
    });
  });

  it.each([
    { dataUrl: "data:application/octet-stream;base64,AA==", size: 2 },
    { dataUrl: "data:application/octet-stream;base64,Zh==", size: 1 },
    { dataUrl: "data:application/octet-stream;base64,Zm9=", size: 2 },
    { dataUrl: "data:application/octet-stream;base64,Z g=", size: 2 },
    { dataUrl: "data:application/octet-stream;base64,AA=_", size: 1 },
    { dataUrl: "data:application/octet-stream,raw", size: 3 },
    { dataUrl: "data:application/octet-stream;base64,", size: 1 },
    { dataUrl: "data:application/octet-stream;base64,AA==", size: -1 },
    { dataUrl: "data:application/octet-stream;base64,AA==", size: 1.5 },
    {
      dataUrl: "data:application/octet-stream;base64,AA==",
      size: MAX_COMPOSER_ATTACHMENT_BYTES + 1,
    },
  ])("rejects malformed attachment content without changing a saved draft: %o", (change) => {
    const session = createSession(repository);
    repository.saveComposerDraft(draft(session.id));
    expect(() =>
      repository.saveComposerDraft(
        draft(session.id, {
          revision: "invalid",
          addedAttachments: [{ ...attachment("invalid"), ...change }],
          attachmentIds: ["invalid"],
        }),
      ),
    ).toThrow(/attachment/i);
    expect(repository.getComposerDraft(session.id)?.revision).toBe("revision-1");
    expect(repository.getSetting(`composer.draft-attachment.${session.id}.invalid`)).toBeNull();
  });

  it("rejects missing, foreign and duplicate attachment references without losing old bytes", () => {
    const first = createSession(repository);
    const second = createSession(repository);
    const file = attachment("file");
    repository.saveComposerDraft(
      draft(first.id, { attachmentIds: [file.id], addedAttachments: [file] }),
    );
    for (const input of [
      draft(first.id, { attachmentIds: ["missing"] }),
      draft(second.id, { attachmentIds: [file.id] }),
      draft(first.id, { attachmentIds: [file.id, file.id] }),
      draft(first.id, { attachmentIds: [file.id], addedAttachments: [file, file] }),
      draft(first.id, { addedAttachments: [file] }),
    ])
      expect(() => repository.saveComposerDraft(input)).toThrow();
    expect(repository.getComposerDraft(first.id)?.attachments).toEqual([file]);
    expect(repository.getComposerDraft(second.id)).toBeNull();
  });

  it("rolls attachment additions and metadata back together after a SQLite write failure", () => {
    const session = createSession(repository);
    const old = attachment("old");
    repository.saveComposerDraft(
      draft(session.id, { attachmentIds: [old.id], addedAttachments: [old] }),
    );
    database.exec(`
      create trigger fail_draft_update before update on app_settings
      when new.key = 'composer.draft.${session.id}'
      begin select raise(abort, 'Fixture draft write failed'); end;
    `);
    const added = attachment("added");
    expect(() =>
      repository.saveComposerDraft(
        draft(session.id, {
          revision: "revision-2",
          attachmentIds: [added.id],
          addedAttachments: [added],
        }),
      ),
    ).toThrow("Fixture draft write failed");
    expect(repository.getComposerDraft(session.id)?.attachments).toEqual([old]);
    expect(repository.getComposerDraft(session.id)?.revision).toBe("revision-1");
    expect(repository.getSetting(`composer.draft-attachment.${session.id}.${added.id}`)).toBeNull();
  });

  it("consumes only the accepted revision and leaves a newer draft untouched", () => {
    const session = createSession(repository);
    const file = attachment("file");
    repository.saveComposerDraft(
      draft(session.id, {
        revision: "newer-revision",
        attachmentIds: [file.id],
        addedAttachments: [file],
      }),
    );
    repository.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text: "Accepted older text" }],
      draftRevision: "revision-1",
    });
    expect(repository.clearComposerDraft(session.id, "revision-1")).toBe(false);
    expect(repository.getComposerDraft(session.id)).toMatchObject({
      revision: "newer-revision",
      attachments: [file],
    });
    repository.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text: "Accepted current text" }],
      draftRevision: "newer-revision",
    });
    expect(repository.getMessages(session.id)).toHaveLength(2);
    expect(repository.getComposerDraft(session.id)).toBeNull();
    expect(repository.getSetting(`composer.draft-attachment.${session.id}.${file.id}`)).toBeNull();
  });

  it("consumes a manual child task's parent draft without clearing the child's own draft", () => {
    const parent = createSession(repository);
    const child = createSession(repository, parent.id);
    repository.saveComposerDraft(draft(parent.id, { text: "@general inspect this" }));
    repository.saveComposerDraft(draft(child.id, { text: "Child follow-up" }));
    repository.appendMessage({
      sessionId: child.id,
      role: "user",
      parts: [{ type: "text", text: "inspect this" }],
      draftRevision: "revision-1",
      draftSessionId: parent.id,
    });
    expect(repository.getMessages(child.id)[0]?.parts).toEqual([
      { type: "text", text: "inspect this" },
    ]);
    expect(repository.getComposerDraft(parent.id)).toBeNull();
    expect(repository.getComposerDraft(child.id)?.text).toBe("Child follow-up");
  });

  it.each(["metadata", "attachment"])(
    "rolls an accepted message back if clearing its draft %s fails",
    (failure) => {
      const session = createSession(repository);
      const file = attachment("file");
      repository.saveComposerDraft(
        draft(session.id, { attachmentIds: [file.id], addedAttachments: [file] }),
      );
      const key =
        failure === "metadata"
          ? `composer.draft.${session.id}`
          : `composer.draft-attachment.${session.id}.${file.id}`;
      database.exec(`
      create trigger fail_draft_delete before delete on app_settings
      when old.key = '${key}'
      begin select raise(abort, 'Fixture draft clear failed'); end;
    `);
      expect(() =>
        repository.appendMessage({
          sessionId: session.id,
          role: "user",
          parts: [{ type: "text", text: "Not accepted" }],
          draftRevision: "revision-1",
        }),
      ).toThrow("Fixture draft clear failed");
      expect(repository.getMessages(session.id)).toEqual([]);
      expect(repository.getSession(session.id)?.updatedAt).toBe(session.updatedAt);
      expect(repository.getComposerDraft(session.id)?.attachments).toEqual([file]);
    },
  );

  it("keeps notification import receipts after send and clears them only with explicit removal", () => {
    const session = createSession(repository);
    repository.saveComposerDraft(draft(session.id, { notificationDraftIds: ["notification-1"] }));
    expect(repository.clearComposerDraft(session.id, "revision-1")).toBe(true);
    expect(repository.getComposerDraft(session.id)).toMatchObject({
      text: "",
      attachments: [],
      formatted: false,
      notificationDraftIds: ["notification-1"],
    });
    expect(repository.hasComposerDraft(session.id)).toBe(false);
    repository.removeSession(session.id);
    expect(repository.getSetting(`composer.draft.${session.id}`)).toBeNull();
  });

  it("clears only the deleted session's recoverable tool output namespace", () => {
    const target = createSession(repository);
    const other = createSession(repository);
    repository.setSetting(`tool.output.${target.id}.call-1`, { output: "target" });
    repository.setSetting(`tool.output.${target.id}.call-2`, { output: "target" });
    repository.setSetting(`tool.output.${other.id}.call-1`, { output: "other" });
    repository.setSetting(`fixture.tool.output.${target.id}.call-1`, { output: "unrelated" });

    repository.removeSession(target.id);

    expect(repository.getSetting(`tool.output.${target.id}.call-1`)).toBeNull();
    expect(repository.getSetting(`tool.output.${target.id}.call-2`)).toBeNull();
    expect(repository.getSetting(`tool.output.${other.id}.call-1`)).toEqual({ output: "other" });
    expect(repository.getSetting(`fixture.tool.output.${target.id}.call-1`)).toEqual({
      output: "unrelated",
    });
  });

  it("preserves unreadable metadata for recovery and rejects writes for missing sessions", () => {
    const session = createSession(repository);
    repository.setSetting(`composer.draft.${session.id}`, { text: "Keep damaged record" });
    expect(repository.hasComposerDraft(session.id)).toBe(true);
    expect(() => repository.getComposerDraft(session.id)).toThrow();
    expect(() => repository.saveComposerDraft(draft("missing-session"))).toThrow("会话不存在");
    expect(repository.getSetting("composer.draft.missing-session")).toBeNull();
    expect(repository.getSetting(`composer.draft.${session.id}`)).toEqual({
      text: "Keep damaged record",
    });
  });

  it.each(["legacy", "queue"])(
    "protects pending %s notification replies until their durable import is acknowledged",
    (format) => {
      const first = createSession(repository);
      const second = createSession(repository);
      const reply = {
        id: "notification-1",
        sessionId: first.id,
        text: "Keep failed notification reply",
        error: "Fixture send failed",
      };
      repository.setSetting(
        "desktop.notificationReplyDraft",
        format === "legacy" ? reply : [reply],
      );
      expect(repository.hasComposerDraft(first.id)).toBe(true);
      expect(repository.hasComposerDraft(second.id)).toBe(false);
      repository.removeSetting("desktop.notificationReplyDraft");
      expect(repository.hasComposerDraft(first.id)).toBe(false);
    },
  );

  it.each([null, "unreadable", { sessionId: "missing-text" }, [null]])(
    "conservatively protects sessions when the notification reply queue is damaged: %j",
    (pending) => {
      const session = createSession(repository);
      repository.setSetting("desktop.notificationReplyDraft", pending);
      expect(repository.hasComposerDraft(session.id)).toBe(true);
    },
  );
});
