import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_FIRST_RESPONSE_TIMEOUT_MS,
  DEFAULT_MODEL_IDLE_TIMEOUT_MS,
  isMeaningfulModelStreamProgress,
  MAX_MODEL_WATCHDOG_TIMEOUT_MS,
  ModelRequestWatchdog,
  type ModelWatchdogTimeoutError,
  normalizeModelWatchdogSettings,
} from "./model-watchdog";

afterEach(() => {
  vi.useRealTimers();
});

describe("model watchdog settings", () => {
  it("defaults to five minutes for the first response and fifteen minutes idle", () => {
    expect(normalizeModelWatchdogSettings(undefined)).toEqual({
      firstResponseTimeoutMs: DEFAULT_MODEL_FIRST_RESPONSE_TIMEOUT_MS,
      idleTimeoutMs: DEFAULT_MODEL_IDLE_TIMEOUT_MS,
    });
    expect(
      normalizeModelWatchdogSettings({
        firstResponseTimeoutMs: 0,
        idleTimeoutMs: 90_000.4,
      }),
    ).toEqual({ firstResponseTimeoutMs: 0, idleTimeoutMs: 90_000 });
  });

  it("rejects invalid values per field and caps accidental overflow", () => {
    expect(
      normalizeModelWatchdogSettings({
        firstResponseTimeoutMs: Number.NaN,
        idleTimeoutMs: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({
      firstResponseTimeoutMs: DEFAULT_MODEL_FIRST_RESPONSE_TIMEOUT_MS,
      idleTimeoutMs: MAX_MODEL_WATCHDOG_TIMEOUT_MS,
    });
    expect(normalizeModelWatchdogSettings({ firstResponseTimeoutMs: -1 })).toMatchObject({
      firstResponseTimeoutMs: DEFAULT_MODEL_FIRST_RESPONSE_TIMEOUT_MS,
    });
  });
});

describe("ModelRequestWatchdog", () => {
  it("fires the first-response timer once and switches to idle after meaningful progress", () => {
    vi.useFakeTimers();
    const timeouts: ModelWatchdogTimeoutError[] = [];
    const watchdog = new ModelRequestWatchdog(
      { firstResponseTimeoutMs: 5_000, idleTimeoutMs: 15_000 },
      (error) => timeouts.push(error),
    );
    watchdog.start();
    vi.advanceTimersByTime(4_999);
    expect(timeouts).toHaveLength(0);
    watchdog.progress();
    vi.advanceTimersByTime(14_999);
    expect(timeouts).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(timeouts).toEqual([
      expect.objectContaining({ name: "TimeoutError", kind: "idle", timeoutMs: 15_000 }),
    ]);
    vi.advanceTimersByTime(60_000);
    expect(timeouts).toHaveLength(1);
    watchdog.stop();
  });

  it("does not arm disabled limits or fire after stop", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const disabled = new ModelRequestWatchdog(
      { firstResponseTimeoutMs: 0, idleTimeoutMs: 0 },
      onTimeout,
    );
    disabled.start();
    disabled.progress();
    vi.advanceTimersByTime(MAX_MODEL_WATCHDOG_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();

    const stopped = new ModelRequestWatchdog(
      { firstResponseTimeoutMs: 1_000, idleTimeoutMs: 1_000 },
      onTimeout,
    );
    stopped.start();
    stopped.stop();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe("meaningful stream progress", () => {
  it("counts visible text, reasoning and tool arguments but not heartbeats or usage", () => {
    expect(isMeaningfulModelStreamProgress({ type: "text_delta", text: "a" })).toBe(true);
    expect(isMeaningfulModelStreamProgress({ type: "reasoning_delta", text: "think" })).toBe(true);
    expect(isMeaningfulModelStreamProgress({ type: "tool_call_arguments_delta", delta: "{" })).toBe(
      true,
    );
    expect(isMeaningfulModelStreamProgress({ type: "tool_call_arguments", arguments: "{}" })).toBe(
      true,
    );
    expect(isMeaningfulModelStreamProgress({ type: "text_delta", text: "" })).toBe(false);
    expect(isMeaningfulModelStreamProgress({ type: "usage" })).toBe(false);
    expect(isMeaningfulModelStreamProgress({ type: "tool_call_started" })).toBe(false);
    expect(isMeaningfulModelStreamProgress({ type: "provider_state" })).toBe(false);
  });
});
