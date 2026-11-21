import { describe, expect, it, vi } from "vitest";
import { COMPOSER_DRAFT_CONFLICT_MESSAGE } from "../../../shared/composer-draft";
import { ComposerDraftHandoff } from "./composer-draft-handoff";
import { ComposerDraftStore } from "./composer-drafts";

function fixture() {
  const save = vi.fn(async () => undefined);
  const drafts = new ComposerDraftStore({
    getComposerDraft: async () => null,
    saveComposerDraft: save,
    clearComposerDraft: async () => true,
  });
  return { drafts, save, handoff: new ComposerDraftHandoff(drafts) };
}

describe("composer draft handoff", () => {
  it("serializes concurrent handoffs and keeps the existing draft metadata", async () => {
    const { drafts, handoff } = fixture();
    await drafts.load("a");
    drafts.update("a", (value) => ({
      ...value,
      text: "Existing",
      formatted: true,
      notificationDraftIds: ["notice"],
    }));
    await Promise.all([handoff.append("a", "First"), handoff.append("a", "Second")]);
    expect(drafts.state("a").value).toMatchObject({
      text: "Existing\n\nFirst\n\nSecond",
      formatted: false,
      notificationDraftIds: ["notice"],
    });
  });

  it("retries a failed persistence without duplicating comments or newer edits", async () => {
    const { drafts, save, handoff } = fixture();
    save.mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(handoff.append("a", "Review comment")).rejects.toThrow("Disk unavailable");
    drafts.update("a", (value) => ({ ...value, text: `${value.text}\nUser edit` }));
    await handoff.append("a", "Review comment");
    expect(drafts.state("a").value.text).toBe("Review comment\nUser edit");
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "Review comment\nUser edit" }),
    );
  });

  it("allows a removed failed insertion to be deliberately re-added", async () => {
    const { drafts, save, handoff } = fixture();
    save.mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(handoff.append("a", "Proposal")).rejects.toThrow();
    drafts.update("a", (value) => ({ ...value, text: "Replacement" }));
    await handoff.append("a", "Proposal");
    expect(drafts.state("a").value.text).toBe("Replacement\n\nProposal");
  });

  it("does not duplicate a saved request when later session verification fails", async () => {
    const { drafts, handoff } = fixture();
    await handoff.append("a", "Creative request");
    handoff.rememberUnconfirmed("a", "Creative request");
    drafts.update("a", (value) => ({ ...value, text: `${value.text}\nNew edit` }));
    await handoff.append("a", "Creative request");
    expect(drafts.state("a").value.text).toBe("Creative request\nNew edit");
  });

  it("retains existing text and attachments through a conflict and retries without duplication", async () => {
    const { drafts, save, handoff } = fixture();
    const attachment = {
      id: "attachment",
      kind: "file" as const,
      file: new File(["A"], "evidence.txt", { type: "text/plain" }),
      dataUrl: "data:text/plain;base64,QQ==",
    };
    await drafts.load("a");
    drafts.update("a", (value) => ({
      ...value,
      text: "Existing",
      attachments: [attachment],
      notificationDraftIds: ["notice"],
    }));
    await drafts.flush("a");
    save.mockRejectedValueOnce(new Error(COMPOSER_DRAFT_CONFLICT_MESSAGE));

    await expect(handoff.append("a", "Creative request")).rejects.toThrow(
      COMPOSER_DRAFT_CONFLICT_MESSAGE,
    );
    expect(drafts.state("a")).toMatchObject({
      conflict: true,
      value: {
        text: "Existing\n\nCreative request",
        attachments: [attachment],
        notificationDraftIds: ["notice"],
      },
    });
    await expect(handoff.append("a", "Creative request")).rejects.toThrow("草稿冲突");
    expect(drafts.state("a").value.text).toBe("Existing\n\nCreative request");

    await drafts.resolveConflict("a", "overwrite");
    await handoff.append("a", "Creative request");
    expect(drafts.state("a").value).toMatchObject({
      text: "Existing\n\nCreative request",
      attachments: [attachment],
      notificationDraftIds: ["notice"],
    });
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "Existing\n\nCreative request",
        attachmentIds: ["attachment"],
      }),
    );
  });
});
