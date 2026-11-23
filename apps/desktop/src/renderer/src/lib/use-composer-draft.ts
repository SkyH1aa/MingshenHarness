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
  conflict: false,
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
    if (!sessionId) return;
    const returningToLoadedSession = composerDrafts.state(sessionId).ready;
    void composerDrafts.load(sessionId).then(
      () => {
        if (returningToLoadedSession)
          void composerDrafts.refreshIfClean(sessionId).catch(() => undefined);
      },
      () => undefined,
    );
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        void composerDrafts.refreshIfClean(sessionId).catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [sessionId]);
  return state;
}

export function registerComposerDraftLifecycle(): () => void {
  const unsubscribeChanges = window.mingshen.onComposerDraftChanged(({ sessionId, revision }) => {
    void composerDrafts.refreshIfClean(sessionId, revision).catch(() => undefined);
  });
  const unsubscribe = window.mingshen.onComposerDraftFlush((requestId, purpose, sessionId) => {
    if (purpose === "shutdown") interfaceReloadIntent = null;
    const pending = sessionId
      ? composerDrafts.flushIfPresent(sessionId)
      : composerDrafts.flushAll();
    void pending.then(
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
    unsubscribeChanges();
    unsubscribe();
    window.removeEventListener("beforeunload", beforeUnload);
    interfaceReloadIntent = null;
  };
}
