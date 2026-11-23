export class QuickChatTransitionWork {
  private active = 0;
  private readonly waiters = new Set<() => void>();

  get idle(): boolean {
    return this.active === 0;
  }

  begin(): () => void {
    this.active += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.active -= 1;
      if (!this.idle) return;
      for (const waiter of [...this.waiters]) waiter();
    };
  }

  waitForIdle(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error("Transition cancelled."));
    if (this.idle) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.waiters.delete(onIdle);
        signal.removeEventListener("abort", onAbort);
      };
      const onIdle = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Transition cancelled."));
      };
      this.waiters.add(onIdle);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export async function quickChatTransitionReady(
  work: QuickChatTransitionWork,
  signal: AbortSignal,
  hasUnsavedEdit: () => boolean,
): Promise<boolean> {
  do {
    await work.waitForIdle(signal);
  } while (!work.idle);
  if (signal.aborted) throw new Error("Transition cancelled.");
  return !hasUnsavedEdit();
}
