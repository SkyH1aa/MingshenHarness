import { Check, LoaderCircle } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import type { ProviderProtocol, ProviderView } from "../../../shared/domain";
import {
  normalizePromptCachingSettings,
  type PromptCachingSettings,
} from "../../../shared/prompt-caching";
import { useLocale } from "../i18n";
import { runtimeText } from "../i18n/runtime";

export function ProviderCacheFields({
  draft,
  protocol,
  baseUrl,
  disabled = false,
  onChange,
}: {
  draft: PromptCachingSettings;
  protocol: ProviderProtocol;
  baseUrl: string;
  disabled?: boolean;
  onChange: (settings: Partial<PromptCachingSettings>) => void;
}) {
  const en = useLocale() === "en";
  const noteId = useId();
  const anthropic = protocol === "anthropic_messages";
  const nativeGemini = protocol === "gemini_generate_content";
  const gemini = nativeGemini || draft.modelFamily === "gemini";
  const deepseek = draft.modelFamily === "deepseek";
  const supportsTtl =
    anthropic &&
    (draft.mode.startsWith("anthropic_") ||
      (draft.mode === "auto" &&
        (draft.modelFamily === "claude" ||
          ((draft.modelFamily === undefined || draft.modelFamily === "auto") &&
            /^https:\/\/api\.anthropic\.com\/v1\/?$/.test(baseUrl)))));
  const mismatch =
    !nativeGemini &&
    draft.mode === "auto" &&
    ((draft.modelFamily === "claude" && !anthropic) ||
      (draft.modelFamily === "openai" && anthropic) ||
      (gemini && protocol !== "openai_chat_completions"));
  return (
    <>
      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{en ? "Prompt caching" : "提示缓存"}</span>
          <select
            name="cacheMode"
            value={draft.mode}
            disabled={disabled}
            aria-describedby={noteId}
            onChange={(event) =>
              onChange({ mode: event.target.value as PromptCachingSettings["mode"], ttl: "5m" })
            }
          >
            <option value="auto">
              {en ? "Use model family / detect official API" : "按模型体系适配 / 官方自动识别"}
            </option>
            <option value="off">{en ? "No client cache hints" : "不发送缓存参数"}</option>
            {anthropic ? (
              <>
                <option value="anthropic_auto">
                  {en ? "Claude automatic caching" : "Claude 自动缓存"}
                </option>
                <option value="anthropic_breakpoints">
                  {en ? "Claude explicit breakpoints" : "Claude 显式缓存断点"}
                </option>
              </>
            ) : !nativeGemini ? (
              <option value="openai">
                {en ? "OpenAI compatible cache key" : "OpenAI 兼容缓存键"}
              </option>
            ) : null}
          </select>
        </label>
        <label className="field">
          <span>{en ? "Provider model family" : "供应商模型体系"}</span>
          <select
            name="cacheFamily"
            value={nativeGemini ? "gemini" : (draft.modelFamily ?? "auto")}
            disabled={disabled || nativeGemini}
            aria-describedby={noteId}
            onChange={(event) =>
              onChange({
                modelFamily: event.target.value as NonNullable<
                  PromptCachingSettings["modelFamily"]
                >,
                mode: "auto",
                ttl: "5m",
              })
            }
          >
            <option value="auto">{en ? "Detect official API only" : "仅自动识别官方 API"}</option>
            <option value="openai">OpenAI</option>
            <option value="claude">Claude (Anthropic)</option>
            <option value="gemini">Gemini (Google)</option>
            <option value="deepseek">DeepSeek</option>
            <option value="other">{en ? "Other or mixed models" : "其他或混合模型"}</option>
          </select>
        </label>
        {supportsTtl ? (
          <label className="field">
            <span>{en ? "Claude cache lifetime" : "Claude 缓存保留时间"}</span>
            <select
              name="cacheTtl"
              value={draft.ttl}
              disabled={disabled}
              onChange={(event) => onChange({ ttl: event.target.value as "5m" | "1h" })}
            >
              <option value="5m">{en ? "5 minutes (default)" : "5 分钟（默认）"}</option>
              <option value="1h">{en ? "1 hour" : "1 小时"}</option>
            </select>
          </label>
        ) : null}
      </div>
      <p className="form-note" id={noteId}>
        {en
          ? "Choose the family used by every model on this provider. Official endpoints are detected automatically; gateways need an explicit family and must preserve its native fields. OpenAI and Claude use compatible cache hints; Gemini and DeepSeek use automatic prefix caching. The family does not change the API protocol. Use separate providers or Other for mixed models."
          : "选择该供应商全部模型实际使用的体系。官方端点会自动识别，网关需手动选择并支持原生字段透传。OpenAI、Claude 使用对应缓存参数；Gemini、DeepSeek 使用自动前缀缓存。模型体系不会更改 API 协议；混合模型建议拆分供应商或选择“其他”。"}
      </p>
      {(gemini || deepseek) && draft.mode === "auto" ? (
        <p className="form-note">
          {gemini
            ? en
              ? "Gemini supports the native Google protocol and the OpenAI-compatible Chat Completions protocol. Thought signatures are retained for continuation. Cache eligibility depends on the model's minimum prefix length and server policy."
              : "Gemini 支持 Google 原生协议及 OpenAI 兼容 Chat Completions 协议；思考签名随历史保留并回传。是否命中取决于模型的最短前缀要求及服务端策略。"
            : en
              ? "DeepSeek reuses complete cached prefixes automatically. Native reasoning is retained for tool continuation; cache reads use the provider's reported token counts."
              : "DeepSeek 自动复用完整缓存前缀；工具续接会保留原生推理字段，缓存读取量以供应商实际返回的 token 统计为准。"}
        </p>
      ) : null}
      {mismatch ? (
        <p className="form-note" role="status">
          {en
            ? "The selected family and API protocol do not match. No native cache hints will be added automatically. A gateway must translate caching itself; use an explicit compatible mode only when documented."
            : "所选模型体系与 API 协议不匹配，自动模式不会发送原生缓存参数。缓存依赖网关转换；仅在网关文档确认支持时选择显式兼容方式。"}
        </p>
      ) : null}
      {supportsTtl ? (
        <p className="form-note">
          {en
            ? "One hour requires provider support and can cost more for cache writes. Check the provider's pricing before enabling it."
            : "一小时保留需要供应商支持，缓存写入可能产生更高费用，请核对供应商定价后启用。"}
        </p>
      ) : null}
    </>
  );
}

export function ProviderCacheSettings({
  provider,
  onChanged,
}: {
  provider: ProviderView;
  onChanged: () => Promise<void>;
}) {
  const en = useLocale() === "en";
  const [draft, setDraft] = useState(() => normalizePromptCachingSettings(provider.promptCaching));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const change = (settings: Partial<PromptCachingSettings>) => {
    setDraft((current) => ({ ...current, ...settings }));
    setSaved(false);
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await window.mingshen.setProviderPromptCaching(provider.id, draft);
      await onChanged();
      setSaved(true);
    } catch (cause) {
      setError(runtimeText(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="provider-cache-settings" onSubmit={submit}>
      <ProviderCacheFields
        draft={draft}
        protocol={provider.protocol}
        baseUrl={provider.baseUrl}
        disabled={busy}
        onChange={change}
      />
      <p className="form-note">
        {en
          ? "Changes apply to the next run. Omitting client hints does not disable the provider's own implicit caching; no mode guarantees a hit rate."
          : "保存后从下一次运行生效。不发送参数不会关闭供应商自身的隐式缓存；任何方式都不保证固定命中率。"}
      </p>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        {saved ? <span role="status">{en ? "Cache settings saved" : "缓存配置已保存"}</span> : null}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? (
            <LoaderCircle aria-hidden="true" className="spin" size={16} />
          ) : (
            <Check aria-hidden="true" size={16} />
          )}
          {en ? "Save cache settings" : "保存缓存配置"}
        </button>
      </div>
    </form>
  );
}
