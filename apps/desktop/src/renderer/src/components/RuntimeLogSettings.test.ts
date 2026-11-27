import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeLogStatistics } from "../../../shared/runtime-log";
import { RuntimeLogStatisticsView } from "./RuntimeLogSettings";

vi.mock("../i18n", () => ({
  tr: (text: string, values: unknown[] = []) =>
    text.replace(/\{(\d+)\}/g, (_match, index: string) => String(values[Number(index)] ?? "")),
}));

function statistics(overrides: Partial<RuntimeLogStatistics> = {}): RuntimeLogStatistics {
  return {
    errors: 3,
    warnings: 2,
    omitted: { errors: 4, warnings: 5, unknown: 6 },
    damaged: 7,
    bySource: [{ name: "ipc.request", errors: 3, warnings: 2 }],
    byOperation: [{ name: "image-studio:generate", errors: 3, warnings: 1 }],
    ...overrides,
  };
}

describe("runtime log statistics", () => {
  it("shows retained records separately from omitted and damaged entries", () => {
    const html = renderToStaticMarkup(
      createElement(RuntimeLogStatisticsView, { statistics: statistics() }),
    );
    expect(html).toContain("3 个错误 · 2 个警告");
    expect(html).toContain("<dt>已知遗漏</dt>");
    expect(html).toContain("错误 4 · 警告 5 · 级别未知 6");
    expect(html).toContain("<dt>损坏记录</dt><dd>7</dd>");
    expect(html).toContain("不代表去重后的故障数或历史总数");
    expect(html).toContain("ipc.request");
    expect(html).toContain("image-studio:generate");
    expect(html).toContain('aria-label="按接口查看"');
    expect(html).toContain('tabindex="0"');
    expect(html.match(/<details class="runtime-log-breakdown">/g)).toHaveLength(2);
  });

  it("keeps empty breakdowns explicit and escapes long names", () => {
    const name = `<unsafe>${"x".repeat(256)}`;
    const html = renderToStaticMarkup(
      createElement(RuntimeLogStatisticsView, {
        statistics: statistics({ bySource: [], byOperation: [{ name, errors: 0, warnings: 1 }] }),
      }),
    );
    expect(html).toContain("当前没有可统计的记录。");
    expect(html).toContain("&lt;unsafe&gt;");
    expect(html).not.toContain("<unsafe>");
    expect(html).toContain("x".repeat(256));
  });
});
