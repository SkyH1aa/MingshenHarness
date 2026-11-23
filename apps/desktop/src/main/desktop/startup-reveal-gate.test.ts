import { describe, expect, it, vi } from "vitest";
import {
  readPolicyAfterReveal,
  StartupRevealGate,
  StartupVisibilityConfirmation,
  waitForStartupVisibility,
} from "./startup-reveal-gate";

describe("startup reveal gate", () => {
  it("does not confirm show until the native visibility state catches up", async () => {
    const gate = new StartupRevealGate();
    const read = vi.fn(async () => "policy");
    const pending = readPolicyAfterReveal({
      waitForReveal: true,
      gate,
      isCurrent: () => true,
      read,
    });
    let visible = false;
    let releaseDelay: (() => void) | undefined;
    const confirming = waitForStartupVisibility({
      isCurrent: () => true,
      isVisible: () => visible,
      delay: () => new Promise<void>((resolve) => (releaseDelay = resolve)),
    }).then((confirmed) => {
      if (confirmed) gate.reveal();
    });
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    visible = true;
    releaseDelay?.();
    await confirming;
    await expect(pending).resolves.toBe("policy");
    expect(read).toHaveBeenCalledOnce();
  });

  it("abandons visibility confirmation when shutdown or window replacement starts", async () => {
    let current = true;
    const visible = vi.fn(() => false);
    const delay = vi.fn(async () => {
      current = false;
    });
    await expect(
      waitForStartupVisibility({ isCurrent: () => current, isVisible: visible, delay }),
    ).resolves.toBe(false);
    expect(visible).toHaveBeenCalledOnce();
    expect(delay).toHaveBeenCalledOnce();
  });

  it("bounds visibility polling without treating an invisible window as shown", async () => {
    const delay = vi.fn(async () => undefined);
    await expect(
      waitForStartupVisibility({
        isCurrent: () => true,
        isVisible: () => false,
        delay,
        attempts: 3,
      }),
    ).resolves.toBe(false);
    expect(delay).toHaveBeenCalledTimes(3);
  });

  it("waits for actual reveal before reading a first-run policy", async () => {
    const gate = new StartupRevealGate();
    const read = vi.fn(async () => "policy");
    const pending = readPolicyAfterReveal({
      waitForReveal: true,
      gate,
      isCurrent: () => true,
      read,
    });
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    gate.reveal();
    await expect(pending).resolves.toBe("policy");
    expect(read).toHaveBeenCalledOnce();
  });

  it("allows a visibility retry after a bounded invisible timeout", async () => {
    const gate = new StartupRevealGate();
    const read = vi.fn(async () => "policy");
    const pending = readPolicyAfterReveal({
      waitForReveal: true,
      gate,
      isCurrent: () => true,
      read,
    });
    const rejected = expect(pending).rejects.toThrow("not shown");
    const confirmed = await waitForStartupVisibility({
      isCurrent: () => true,
      isVisible: () => false,
      delay: async () => undefined,
      attempts: 1,
    });
    if (!confirmed) gate.cancelPending();
    await rejected;
    expect(read).not.toHaveBeenCalled();
    const retry = readPolicyAfterReveal({
      waitForReveal: true,
      gate,
      isCurrent: () => true,
      read,
    });
    if (await waitForStartupVisibility({ isCurrent: () => true, isVisible: () => true }))
      gate.reveal();
    await expect(retry).resolves.toBe("policy");
    expect(read).toHaveBeenCalledOnce();
  });

  it("cancels pending reads on close and rechecks the active window", async () => {
    const gate = new StartupRevealGate();
    const read = vi.fn(async () => "policy");
    const first = readPolicyAfterReveal({
      waitForReveal: true,
      gate,
      isCurrent: () => true,
      read,
    });
    const second = readPolicyAfterReveal({
      waitForReveal: true,
      gate,
      isCurrent: () => true,
      read,
    });
    const canceled = Promise.all([
      expect(first).rejects.toThrow("not shown"),
      expect(second).rejects.toThrow("not shown"),
    ]);
    gate.close();
    await canceled;
    await expect(gate.wait()).rejects.toThrow("closed");
    expect(read).not.toHaveBeenCalled();

    const replaced = new StartupRevealGate();
    const oldRequest = readPolicyAfterReveal({
      waitForReveal: true,
      gate: replaced,
      isCurrent: () => false,
      read,
    });
    replaced.reveal();
    await expect(oldRequest).rejects.toThrow("no longer available");
    expect(read).not.toHaveBeenCalled();
  });

  it("allows a fresh waiter after canceled shutdown and skips waiting for existing users", async () => {
    const gate = new StartupRevealGate();
    const pending = gate.wait();
    const rejected = expect(pending).rejects.toThrow("not shown");
    gate.cancelPending();
    await rejected;
    const fresh = gate.wait();
    gate.reveal();
    await expect(fresh).resolves.toBeUndefined();
    await expect(
      readPolicyAfterReveal({
        waitForReveal: false,
        gate: new StartupRevealGate(),
        isCurrent: () => true,
        read: async () => "manual",
      }),
    ).resolves.toBe("manual");
  });
});

describe("startup visibility confirmation", () => {
  it("waits for native visibility and allows retry after an invisible timeout", async () => {
    vi.useFakeTimers();
    try {
      let visible = false;
      const onVisible = vi.fn();
      const onFailure = vi.fn();
      const confirmation = new StartupVisibilityConfirmation({
        isCurrent: () => true,
        isVisible: () => visible,
        onVisible,
        onFailure,
        attempts: 2,
      });
      confirmation.request();
      await vi.advanceTimersByTimeAsync(50);
      expect(onFailure).toHaveBeenCalledOnce();
      expect(onVisible).not.toHaveBeenCalled();
      confirmation.request();
      visible = true;
      await vi.advanceTimersByTimeAsync(25);
      expect(onVisible).toHaveBeenCalledOnce();
      expect(onFailure).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets reload or canceled shutdown restart without old results affecting new waiters", async () => {
    vi.useFakeTimers();
    try {
      let visible = false;
      const onVisible = vi.fn();
      const onFailure = vi.fn();
      const confirmation = new StartupVisibilityConfirmation({
        isCurrent: () => true,
        isVisible: () => visible,
        onVisible,
        onFailure,
        attempts: 2,
      });
      confirmation.request();
      confirmation.cancel();
      visible = true;
      confirmation.request();
      await vi.advanceTimersByTimeAsync(100);
      expect(onVisible).toHaveBeenCalledOnce();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces restore and explicit retry while a confirmation is still pending", async () => {
    vi.useFakeTimers();
    try {
      let visible = false;
      const onVisible = vi.fn();
      const onFailure = vi.fn();
      const confirmation = new StartupVisibilityConfirmation({
        isCurrent: () => true,
        isVisible: () => visible,
        onVisible,
        onFailure,
        attempts: 2,
      });
      confirmation.request();
      confirmation.request();
      confirmation.request();
      await vi.advanceTimersByTimeAsync(50);
      expect(onFailure).not.toHaveBeenCalled();
      visible = true;
      await vi.advanceTimersByTimeAsync(100);
      expect(onVisible).toHaveBeenCalledOnce();
      expect(onFailure).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
