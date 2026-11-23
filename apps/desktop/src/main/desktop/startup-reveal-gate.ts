export class StartupRevealGate {
  private revealed = false;
  private closed = false;
  private readonly waiters = new Set<(revealed: boolean) => void>();

  async wait(): Promise<void> {
    if (this.closed) throw new Error("The main window closed before it was shown.");
    if (this.revealed) return;
    const revealed = await new Promise<boolean>((resolve) => this.waiters.add(resolve));
    if (!revealed) throw new Error("The main window was not shown.");
  }

  reveal(): void {
    if (this.closed) return;
    this.revealed = true;
    this.settleWaiters(true);
  }

  cancelPending(): void {
    this.settleWaiters(false);
  }

  close(): void {
    this.closed = true;
    this.settleWaiters(false);
  }

  private settleWaiters(revealed: boolean): void {
    for (const resolve of this.waiters) resolve(revealed);
    this.waiters.clear();
  }
}

export async function waitForStartupVisibility(options: {
  isCurrent(): boolean;
  isVisible(): boolean;
  delay?: () => Promise<void>;
  attempts?: number;
}): Promise<boolean> {
  const delay = options.delay ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
  const attempts = options.attempts ?? 80;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!options.isCurrent()) return false;
    if (options.isVisible()) return true;
    await delay();
  }
  return options.isCurrent() && options.isVisible();
}

export class StartupVisibilityConfirmation {
  private revision = 0;
  private active = false;
  private recheck = false;

  constructor(
    private readonly options: {
      isCurrent(): boolean;
      isVisible(): boolean;
      onVisible(): void;
      onFailure(cause: unknown): void;
      delay?: () => Promise<void>;
      attempts?: number;
    },
  ) {}

  request(): void {
    if (!this.options.isCurrent()) return;
    if (this.active) {
      this.recheck = true;
      return;
    }
    this.active = true;
    this.recheck = false;
    void this.confirm(this.revision);
  }

  cancel(): void {
    this.revision++;
    this.active = false;
    this.recheck = false;
  }

  private async confirm(revision: number): Promise<void> {
    const isCurrent = () => revision === this.revision && this.options.isCurrent();
    try {
      const visible = await waitForStartupVisibility({ ...this.options, isCurrent });
      if (!isCurrent()) return;
      if (visible && this.options.isVisible()) {
        this.recheck = false;
        this.options.onVisible();
      } else if (!this.recheck) {
        this.options.onFailure(new Error("The main window did not become visible."));
      }
    } catch (cause) {
      if (isCurrent() && !this.recheck) this.options.onFailure(cause);
    } finally {
      if (revision === this.revision) {
        this.active = false;
        if (this.recheck && this.options.isCurrent()) this.request();
      }
    }
  }
}

export async function readPolicyAfterReveal<T>(options: {
  waitForReveal: boolean;
  gate: StartupRevealGate;
  isCurrent(): boolean;
  read(): Promise<T>;
}): Promise<T> {
  if (options.waitForReveal) await options.gate.wait();
  if (!options.isCurrent()) throw new Error("The main window is no longer available.");
  return options.read();
}
