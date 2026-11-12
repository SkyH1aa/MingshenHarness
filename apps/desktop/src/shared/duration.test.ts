import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";

describe("elapsed duration", () => {
  it.each([
    [0, "0 秒", "0s"],
    [59, "59 秒", "59s"],
    [60, "1 分 0 秒", "1m 0s"],
    [3599, "59 分 59 秒", "59m 59s"],
    [3600, "1 小时 0 分 0 秒", "1h 0m 0s"],
    [3661, "1 小时 1 分 1 秒", "1h 1m 1s"],
    [90061, "25 小时 1 分 1 秒", "25h 1m 1s"],
    [-1, "0 秒", "0s"],
    [Number.NaN, "0 秒", "0s"],
    [1.9, "1 秒", "1s"],
  ])("formats %s seconds", (value, chinese, english) => {
    expect(formatDuration(value as number)).toBe(chinese);
    expect(formatDuration(value as number, "en")).toBe(english);
  });
});
