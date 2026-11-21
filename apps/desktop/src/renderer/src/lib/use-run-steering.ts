import { useEffect, useMemo, useState } from "react";
import type { RunSteeringState } from "../../../shared/run-steering";

export function useRunSteering(sessionId: string | null): RunSteeringState | null {
  const selection = useMemo(() => ({ sessionId }), [sessionId]);
  const [snapshot, setSnapshot] = useState<{
    selection: typeof selection;
    state: RunSteeringState | null;
  } | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    let generation = 0;
    const unsubscribe = window.mingshen.onRuntimeEvent((event) => {
      if (event.type !== "run_steering_updated" || event.sessionId !== sessionId) return;
      generation += 1;
      if (active) setSnapshot({ selection, state: event.state });
    });
    const requestGeneration = generation;
    void window.mingshen
      .getRunSteering(sessionId)
      .then((next) => {
        if (active && generation === requestGeneration) setSnapshot({ selection, state: next });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [selection, sessionId]);

  return snapshot?.selection === selection && snapshot.state?.sessionId === sessionId
    ? snapshot.state
    : null;
}
