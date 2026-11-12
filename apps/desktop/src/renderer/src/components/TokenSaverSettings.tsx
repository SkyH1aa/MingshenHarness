import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DEFAULT_TOKEN_SAVER_SETTINGS,
  type TokenSaverSettings as Settings,
  tokenSaverSettingsSchema,
} from "../../../shared/token-saver";
import { tr } from "../i18n/index";
import { useTokenSaver } from "../lib/use-token-saver";
import { TokenSaverStats } from "./TokenSaverStats";

export function TokenSaverSettings({ sessionId }: { sessionId: string | null }) {
  const { snapshot, error, refresh } = useTokenSaver(sessionId);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [validation, setValidation] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    if (snapshot && !draft) setDraft(snapshot.settings);
  }, [snapshot, draft]);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((old) => (old ? { ...old, [key]: value } : old));
    setNotice("");
    setValidation(null);
  };
  const save = async () => {
    if (!draft) return;
    const parsed = tokenSaverSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const key = String(issue?.path[0] ?? "summarizeAfterTurns");
      const labels: Record<string, string> = {
        keepRecentTurns: "保留最近原文轮数须为 1–20 的整数。",
        summarizeAfterTurns:
          issue?.code === "custom"
            ? "摘要触发轮数必须大于保留原文轮数。"
            : "摘要触发轮数须为 6–100 的整数。",
        minimumSummaryTokens: "最少估算 tokens 须为 1024–32000 的整数。",
        maxToolResultChars: "工具结果字符预算须为 4000–64000 的整数。",
      };
      setValidation({ key, message: tr(labels[key] ?? "请检查 Token Saver 设置。") });
      setNotice("");
      requestAnimationFrame(() => {
        const field = document.getElementById(`token-saver-${key}`);
        field?.closest("details")?.setAttribute("open", "");
        field?.focus();
      });
      return;
    }
    setValidation(null);
    setBusy(true);
    setNotice("");
    try {
      setDraft(await window.mingshen.setTokenSaver(parsed.data));
      await refresh();
      setNotice(
        tr("Token Saver 配置已保存。请求优化在下一次模型请求生效，系统提示模块在下一轮对话生效。"),
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (key: keyof Settings, label: string) => (
    <label className="setting-row setting-row--interactive">
      <span className="setting-row__label">
        <strong>{tr(label)}</strong>
      </span>
      <input
        id={`token-saver-${key}`}
        type="checkbox"
        checked={Boolean(draft?.[key])}
        disabled={busy || !draft}
        onChange={(event) => set(key, event.target.checked)}
      />
    </label>
  );
  const number = (
    key: "keepRecentTurns" | "summarizeAfterTurns" | "minimumSummaryTokens" | "maxToolResultChars",
    label: string,
    min: number,
    max: number,
  ) => (
    <label className="field">
      <span>{tr(label)}</span>
      <input
        id={`token-saver-${key}`}
        type="number"
        min={min}
        max={max}
        step={1}
        required
        aria-invalid={validation?.key === key || undefined}
        aria-describedby={validation?.key === key ? "token-saver-validation" : undefined}
        value={draft && Number.isFinite(draft[key]) ? draft[key] : ""}
        disabled={busy || !draft}
        onChange={(event) => set(key, event.target.valueAsNumber)}
      />
      {validation?.key === key ? (
        <small id="token-saver-validation" className="form-error" role="alert">
          {validation.message}
        </small>
      ) : null}
    </label>
  );
  return (
    <section className="settings-block token-saver-settings" aria-label="Token Saver">
      <div className="settings-block__heading">
        <div>
          <h3>Token Saver</h3>
          <p>{tr("内置插件 · 精简请求副本，保留本地原始历史；不改变权限、审批和工具执行顺序。")}</p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="form-error">
          {error}
          <button type="button" className="btn btn--ghost" onClick={() => void refresh()}>
            <RefreshCw size={14} />
            {tr("重试")}
          </button>
        </p>
      ) : null}
      {toggle("enabled", "启用 Token Saver")}
      <fieldset disabled={busy || !draft || !draft.enabled} className="token-saver-fields">
        {toggle("historySummaries", "按轮次自动生成历史摘要")}
        <div className="token-saver-grid">
          {number("keepRecentTurns", "保留最近原文轮数", 1, 20)}
          {number("summarizeAfterTurns", "达到多少轮后摘要", 6, 100)}
          {number("minimumSummaryTokens", "待摘要历史最少估算 tokens", 1024, 32000)}
          <label className="field">
            <span>{tr("回复长度")}</span>
            <select
              value={draft?.outputMode ?? "minimal"}
              onChange={(event) => set("outputMode", event.target.value as Settings["outputMode"])}
            >
              <option value="minimal">{tr("极简（默认）")}</option>
              <option value="auto">{tr("自动")}</option>
              <option value="standard">{tr("标准")}</option>
              <option value="detailed">{tr("详细")}</option>
            </select>
          </label>
        </div>
        <p className="form-note">
          {tr(
            "默认达到 12 轮且旧历史至少 2048 tokens 后生成摘要，保留最近 5 轮。摘要使用现有主备压缩模型并产生额外用量；85% 窗口保护独立保留，必要时可压缩更近历史。用户明确要求详细时优先服从。",
          )}
        </p>
        {toggle("deduplicate", "精确重复内容改为引用")}
        {toggle("compactStructured", "无损精简 JSON / 安全 YAML")}
        {toggle("promptModules", "精简运行时提示并按任务加载代码提示")}
        <details>
          <summary>{tr("高级摘录（默认关闭）")}</summary>
          <p className="form-note">
            {tr(
              "仅作用于较早历史。保留最新轮次、用户约束、错误和工具配对；摘录带原文召回入口。启用前请按任务评估细节需求。",
            )}
          </p>
          {toggle("filterHistory", "摘录低相关的历史助手解释")}
          {toggle("codeOutlines", "历史助手长代码使用 AST 提纲")}
          {toggle("trimToolResults", "摘录历史成功工具的过长结果")}
          {number("maxToolResultChars", "工具结果保留字符预算", 4000, 64000)}
        </details>
      </fieldset>
      <div className="token-saver-actions">
        <button
          className="btn btn--ghost"
          type="button"
          disabled={busy || !draft}
          onClick={() => {
            setDraft({ ...DEFAULT_TOKEN_SAVER_SETTINGS });
            setValidation(null);
            setNotice("");
          }}
        >
          {tr("恢复默认")}
        </button>
        <button
          className="btn btn--secondary"
          type="button"
          disabled={busy || !draft}
          onClick={() => void save()}
        >
          <Save size={14} />
          {busy ? tr("正在保存…") : tr("保存 Token Saver")}
        </button>
      </div>
      {notice ? (
        <p role="status" className="form-note">
          {notice}
        </p>
      ) : null}
      {snapshot ? (
        <TokenSaverStats key={sessionId} snapshot={snapshot} sessionId={sessionId} />
      ) : null}
    </section>
  );
}
