import { useCallback, useEffect, useSyncExternalStore } from "react";
import { ComposerDraftStore } from "./composer-drafts";

export const composerDrafts = new ComposerDraftStore({
  getComposerDraft: (sessionId) => window.mingshen.getComposerDraft(sessionId),
  saveComposerDraft: (input) => window.mingshen.saveComposerDraft(input),
  clearComposerDraft: (sessionId, revision) =>
    window.mingshen.clearComposerDraft(sessionId, revision),
});

const emptyState = {
  ready: false,
  saving: false,
  error: null,
  value: {
    revision: "",
    text: "",
    formatted: false,
    attachments: [],
    notificationDraftIds: [],
  },
};

interface InterfaceReloadIntent {
  onFailure(cause?: unknown): void;
}

let interfaceReloadIntent: InterfaceReloadIntent | null = null;

export async function requestInterfaceReload(
  onFailure: InterfaceReloadIntent["onFailure"],
): Promise<void> {
  // Closing and reopening settings must not start a second navigation for the same renderer.
  if (interfaceReloadIntent) {
    interfaceReloadIntent.onFailure = onFailure;
    return;
  }
  const intent = { onFailure };
  interfaceReloadIntent = intent;
  try {
    await window.mingshen.reloadInterface();
  } catch (cause) {
    if (interfaceReloadIntent === intent) {
      interfaceReloadIntent = null;
      intent.onFailure(cause);
    }
    throw cause;
  }
}

export function useComposerDraft(sessionId: string | null) {
  const subscribe = useCallback(
    (listener: () => void) =>
      sessionId ? composerDrafts.subscribe(sessionId, listener) : () => undefined,
    [sessionId],
  );
  const snapshot = useCallback(
    () => (sessionId ? composerDrafts.state(sessionId) : emptyState),
    [sessionId],
  );
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    if (sessionId) void composerDrafts.load(sessionId).catch(() => undefined);
  }, [sessionId]);
  return state;
}

export function registerComposerDraftLifecycle(): () => void {
  const unsubscribe = window.mingshen.onComposerDraftFlush((requestId, purpose) => {
    if (purpose === "shutdown") interfaceReloadIntent = null;
    void composerDrafts.flushAll().then(
      () => window.mingshen.acknowledgeComposerDraftFlush(requestId),
      (cause: unknown) =>
        window.mingshen.acknowledgeComposerDraftFlush(
          requestId,
          cause instanceof Error ? cause.message : String(cause),
        ),
    );
  });
  const beforeUnload = (event: BeforeUnloadEvent) => {
    const intent = interfaceReloadIntent;
    // Recheck at the actual unload, after asynchronous draft persistence and its IPC reply.
    if (intent && document.querySelector('[data-unsaved="true"]')) {
      event.preventDefault();
      event.returnValue = "";
      interfaceReloadIntent = null;
      intent.onFailure();
      return;
    }
    if (!composerDrafts.hasPending()) {
      if (interfaceReloadIntent === intent) interfaceReloadIntent = null;
      return;
    }
    event.preventDefault();
    event.returnValue = "";
    const fail = (cause: unknown) => {
      if (!intent || interfaceReloadIntent !== intent) return;
      interfaceReloadIntent = null;
      intent.onFailure(cause);
    };
    void composerDrafts.flushAll().then(() => {
      if (interfaceReloadIntent !== intent) return;
      if (intent) void window.mingshen.reloadInterface().catch(fail);
      else window.location.reload();
    }, fail);
  };
  window.addEventListener("beforeunload", beforeUnload);
  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", beforeUnload);
    interfaceReloadIntent = null;
  };
}
