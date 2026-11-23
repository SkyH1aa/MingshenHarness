import type { SessionUpdateInput, SessionView } from "../../shared/domain";

interface SessionUpdateCompletion {
  restoreContext(sessionId: string): Promise<unknown>;
  getSession(sessionId: string): SessionView | null;
  emitUpdated(session: SessionView): void;
}

interface SessionArchivePreparation {
  isBusy(sessionId: string): boolean;
  quickSessionId(): string | null;
  flushMainDraft(): Promise<void>;
  flushQuickDraft(): Promise<void>;
}

export async function prepareSessionArchive(
  sessionId: string,
  preparation: SessionArchivePreparation,
): Promise<void> {
  const checkBusy = () => {
    if (preparation.isBusy(sessionId)) throw new Error("请先停止会话及其子任务，再归档。");
  };
  checkBusy();
  await preparation.flushMainDraft();
  checkBusy();
  if (preparation.quickSessionId() === sessionId) {
    await preparation.flushQuickDraft();
    checkBusy();
  }
}

export async function completeSessionUpdate(
  input: SessionUpdateInput,
  completion: SessionUpdateCompletion,
): Promise<SessionView | null> {
  const archiveOnly =
    typeof input.archived === "boolean" &&
    Object.keys(input).every((key) => key === "sessionId" || key === "archived");
  if (!archiveOnly) await completion.restoreContext(input.sessionId);
  const updated = completion.getSession(input.sessionId);
  if (updated) completion.emitUpdated(updated);
  return updated;
}
