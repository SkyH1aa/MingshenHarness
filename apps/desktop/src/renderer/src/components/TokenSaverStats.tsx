import { useState } from "react";
import type { PromptCacheChange } from "../../../shared/prompt-cache-diagnostics";
import type { TokenSaverSnapshot, TokenUsageKind } from "../../../shared/token-saver";
import { tr } from "../i18n/index";

const count = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
const kinds: Array<[TokenUsageKind, string]> = [
  ["agent", "对话与工具推理"],
  ["compaction", "上下文摘要"],
  ["approval", "模型审批"],
  ["memory", "项目记忆摘要"],
  ["title", "标题生成"],
];
const strategies = {
  duplicate: "重复内容引用",
  structured: "结构化数据精简",
  relevance: "相关性摘录",
  code: "历史代码提纲",
  tool: "历史工具结果摘录",
};
const cacheChanges: Record<PromptCacheChange, string> = {
  first_observation: "首次观察，已建立本地比较基线",
  process_restart: "应用已重启，已重新建立比较基线",
  provider: "供应商发生变化",
  protocol: "请求协议发生变化",
  endpoint: "请求地址发生变化",
  model: "模型发生变化",
  authentication: "认证配置发生变化",
  tools: "工具列表或定义发生变化",
  system: "系统提示发生变化",
  history: "已有历史内容发生变化",
  history_truncated: "历史前缀已截短",
  append_only: "历史仅追加，已有前缀保持一致",
  unchanged: "请求前缀保持一致",
  comparison_limit: "超出本地比较范围，无法确认完整前缀",
};
const cacheOutcomes = {
  unknown: "供应商未报告有效缓存读取量",
  none: "供应商报告零缓存读取",
  partial: "供应商报告部分输入来自缓存",
  full: "供应商报告全部输入来自缓存",
};
interface Page {
  content: string;
  start_line: number;
  char_offset: number;
  next_char_offset: number | null;
  next_start_line: number | null;
}

export function TokenSaverStats({
  snapshot,
  sessionId,
}: {
  snapshot: TokenSaverSnapshot;
  sessionId: string | null;
}) {
  const [source, setSource] = useState<{ messageId: string; partIndex: number; page: Page } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { report, historySummary, usage, cacheDiagnostics } = snapshot;
  const entries = kinds.filter(([kind]) => usage[kind]);
  const diagnostics = kinds.filter(([kind]) => cacheDiagnostics?.[kind]);
  const total = entries.reduce((sum, [kind]) => sum + (usage[kind]?.totalTokens ?? 0), 0);
  const unmeasured = entries.reduce(
    (sum, [kind]) => sum + (usage[kind]?.unmeasuredRequests ?? 0),
    0,
  );
  const partial = entries.reduce((sum, [kind]) => sum + (usage[kind]?.partialRequests ?? 0), 0);
  const failed = entries.reduce((sum, [kind]) => sum + (usage[kind]?.failedRequests ?? 0), 0);
  const requests = entries.reduce((sum, [kind]) => sum + (usage[kind]?.requests ?? 0), 0);
  const cached = entries.reduce((sum, [kind]) => sum + (usage[kind]?.cachedInputTokens ?? 0), 0);
  const created = entries.reduce(
    (sum, [kind]) => sum + (usage[kind]?.cacheCreationInputTokens ?? 0),
    0,
  );
  const measured = entries.reduce(
    (sum, [kind]) => sum + (usage[kind]?.cacheMeasuredRequests ?? 0),
    0,
  );
  const measuredInput = entries.reduce(
    (sum, [kind]) => sum + (usage[kind]?.cacheMeasuredInputTokens ?? 0),
    0,
  );
  const creationMeasured = entries.reduce(
    (sum, [kind]) => sum + (usage[kind]?.cacheCreationMeasuredRequests ?? 0),
    0,
  );
  const rate = (read: number, input: number) =>
    input > 0 ? `${((read / input) * 100).toFixed(1)}%` : tr("未报告");
  const recall = async (messageId: string, partIndex: number, startLine = 1, charOffset = 0) => {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      const page = JSON.parse(
        await window.mingshen.recallContext(sessionId, messageId, partIndex, startLine, charOffset),
      ) as Page;
      setSource({ messageId, partIndex, page });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="token-saver-stats">
      {!sessionId ? (
        <p>{tr("选择会话后查看用量与优化记录。")}</p>
      ) : (
        <>
          <dl>
            <div>
              <dt>{tr("累计已报告用量")}</dt>
              <dd>{count(total)} tokens</dd>
            </div>
            <div>
              <dt>{tr("供应商缓存读取")}</dt>
              <dd data-cache="read">{measured ? `${count(cached)} tokens` : tr("未报告")}</dd>
            </div>
            <div>
              <dt>{tr("供应商缓存写入")}</dt>
              <dd data-cache="write">
                {creationMeasured ? `${count(created)} tokens` : tr("未报告")}
              </dd>
            </div>
            <div>
              <dt>{tr("已报告请求缓存命中率")}</dt>
              <dd data-cache="rate">{rate(cached, measuredInput)}</dd>
            </div>
            <div>
              <dt>{tr("缓存读取数据覆盖")}</dt>
              <dd data-cache="coverage">{tr("{0} / {1} 次请求", [measured, requests])}</dd>
            </div>
            {report ? (
              <>
                <div>
                  <dt>{tr("最近请求精简估算")}</dt>
                  <dd>
                    {count(report.beforeTokens)} → {count(report.afterTokens)}
                  </dd>
                </div>
                <div>
                  <dt>{tr("估算减少")}</dt>
                  <dd>
                    {count(report.savedTokens)} tokens ({report.savedPercent}%)
                  </dd>
                </div>
              </>
            ) : (
              <div>
                <dt>{tr("最近请求精简估算")}</dt>
                <dd>{tr("尚无记录")}</dd>
              </div>
            )}
            {historySummary ? (
              <div>
                <dt>{tr("上次分段摘要估算")}</dt>
                <dd>
                  {count(historySummary.beforeTokens)} → {count(historySummary.afterTokens)}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="form-note">
            {tr(
              "估算仅比较最近请求在相同提示与工具下精简前后的输入，不是账单或未启用插件的真实费用；摘要请求另计。关闭插件不会撤销已有摘要，原始记录仍可召回。",
            )}
          </p>
          <p className="form-note">
            {tr(
              "缓存命中率 = 已报告缓存读取 tokens / 这些请求的完整输入 tokens；未报告及旧记录不计入分母，明确报告零命中才记为零。缓存写入单独显示，CTX 仍计完整上下文；不等同于费用节省率。",
            )}
          </p>
          <p className="form-note">
            {tr(
              "为复用供应商前缀缓存，已发送的历史表示保持不变；上下文摘要、配置或历史内容修改后才重建。单次精简估算为零不代表供应商缓存未命中。",
            )}
          </p>
          <details data-cache-diagnostics>
            <summary>{tr("缓存前缀诊断")}</summary>
            <p className="form-note">
              {tr(
                "比较同一会话、同一用途相邻实际请求的结构，不代表供应商缓存仍有效。历史块数不是 tokens；保留期限、最低长度和路由仍由供应商决定。",
              )}
            </p>
            {diagnostics.length ? (
              <ul className="token-saver-diagnostics">
                {diagnostics.map(([kind, label]) => {
                  const diagnostic = cacheDiagnostics?.[kind];
                  if (!diagnostic) return null;
                  return (
                    <li key={kind} data-cache-kind={kind}>
                      <strong>{tr(label)}</strong>
                      <p data-cache-change={diagnostic.change}>
                        {tr(cacheChanges[diagnostic.change])}
                      </p>
                      <p>
                        {tr("匹配历史块 {0} / {1} · 本次 {2} 块", [
                          diagnostic.matchedBlocks,
                          diagnostic.previousBlocks,
                          diagnostic.currentBlocks,
                        ])}
                      </p>
                      <p data-cache-outcome={diagnostic.cacheOutcome}>
                        {tr(cacheOutcomes[diagnostic.cacheOutcome])}
                        {diagnostic.cachedInputTokens !== null && diagnostic.inputTokens !== null
                          ? ` · ${count(diagnostic.cachedInputTokens)} / ${count(diagnostic.inputTokens)} tokens`
                          : ""}
                      </p>
                      {diagnostic.settingsChanged ? (
                        <p>{tr("推理或生成参数已变化；是否影响缓存取决于供应商。")}</p>
                      ) : null}
                      {diagnostic.cachePolicyChanged ? (
                        <p>{tr("缓存策略或断点已变化；移动断点不等于历史内容变化。")}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>{tr("实际发送模型请求后显示诊断。")}</p>
            )}
          </details>
          <details>
            <summary>{tr("实际用量明细")}</summary>
            <div className="token-saver-table-wrap">
              <table className="token-saver-table">
                <thead>
                  <tr>
                    <th>{tr("用途")}</th>
                    <th>{tr("请求数")}</th>
                    <th>{tr("输入")}</th>
                    <th>{tr("输出")}</th>
                    <th>{tr("缓存读取")}</th>
                    <th>{tr("缓存写入")}</th>
                    <th>{tr("缓存命中率")}</th>
                    <th>{tr("读取数据覆盖")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([kind, label]) => {
                    const value = usage[kind];
                    return value ? (
                      <tr key={kind}>
                        <th scope="row">{tr(label)}</th>
                        <td>{count(value.requests)}</td>
                        <td>{count(value.inputTokens)}</td>
                        <td>{count(value.outputTokens)}</td>
                        <td>
                          {value.cacheMeasuredRequests
                            ? count(value.cachedInputTokens ?? 0)
                            : tr("未报告")}
                        </td>
                        <td>
                          {value.cacheCreationMeasuredRequests
                            ? count(value.cacheCreationInputTokens ?? 0)
                            : tr("未报告")}
                        </td>
                        <td>
                          {rate(value.cachedInputTokens ?? 0, value.cacheMeasuredInputTokens ?? 0)}
                        </td>
                        <td>
                          {tr("{0} / {1} 次请求", [
                            value.cacheMeasuredRequests ?? 0,
                            value.requests,
                          ])}
                        </td>
                      </tr>
                    ) : null;
                  })}
                </tbody>
              </table>
            </div>
            <p className="form-note">
              {tr("从启用此版本起累计，含重试和失败请求已返回的用量；供应商未报告的部分不估填。")}
            </p>
            <p>
              {tr("未报告 {0} 次 · 部分报告 {1} 次 · 失败或中断 {2} 次", [
                unmeasured,
                partial,
                failed,
              ])}
            </p>
          </details>
          <details>
            <summary>
              {tr("最近请求优化记录")} ({report?.changes.length ?? 0})
            </summary>
            {report?.changes.length ? (
              <ul className="token-saver-changes">
                {report.changes.map((change) => (
                  <li key={`${change.messageId}:${change.partIndex}`}>
                    <span>
                      {tr(strategies[change.strategy])} · {change.beforeTokens} →{" "}
                      {change.afterTokens}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy}
                      onClick={() => void recall(change.messageId, change.partIndex)}
                    >
                      {tr("查看原文")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{tr("本次没有可安全精简的历史；最近轮次和关键约束优先保留。")}</p>
            )}
            {report?.omittedChangeCount ? (
              <p>{tr("另有 {0} 条记录未在此展开。", [report.omittedChangeCount])}</p>
            ) : null}
          </details>
          {source ? (
            <div className="token-saver-source">
              <strong>{tr("历史原文（只读）")}</strong>
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable original excerpt must be keyboard accessible. */}
              <pre tabIndex={0}>{source.page.content}</pre>
              <div className="token-saver-actions">
                <button type="button" className="btn btn--ghost" onClick={() => setSource(null)}>
                  {tr("关闭原文")}
                </button>
                {source.page.next_char_offset !== null || source.page.next_start_line !== null ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy}
                    onClick={() =>
                      void recall(
                        source.messageId,
                        source.partIndex,
                        source.page.next_char_offset !== null
                          ? source.page.start_line
                          : (source.page.next_start_line ?? 1),
                        source.page.next_char_offset ?? 0,
                      )
                    }
                  >
                    {tr("下一段原文")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <p className="form-note">
            {tr(
              "节省建议：先使用代码索引、行范围和现有 diff；只有步骤已确定时才合并工具。高级摘录可能遗漏细节，需要时先召回原文。",
            )}
          </p>
        </>
      )}
    </div>
  );
}
