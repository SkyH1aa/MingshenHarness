import { useCallback, useEffect, useState } from "react";
import type { TokenSaverSnapshot } from "../../../shared/token-saver";

export function useTokenSaver(sessionId?: string | null) {
  const [snapshot, setSnapshot] = useState<TokenSaverSnapshot | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const value = await window.mingshen.getTokenSaver(sessionId);
      setSnapshot(value);
      setError("");
      return value;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, [sessionId]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void window.mingshen
        .getTokenSaver(sessionId)
        .then((value) => {
          if (active) {
            setSnapshot(value);
            setError("");
          }
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    setSnapshot(null);
    load();
    const off = window.mingshen.onRuntimeEvent((event) => {
      const id =
        event.type === "context_updated"
          ? event.context.sessionId
          : "sessionId" in event
            ? event.sessionId
            : null;
      if (
        !sessionId ||
        id !== sessionId ||
        !["context_updated", "usage", "run_completed", "conversation_rewound"].includes(event.type)
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      off();
    };
  }, [sessionId]);
  return { snapshot, error, refresh };
}
