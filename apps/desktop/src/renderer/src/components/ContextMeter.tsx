import { ArrowDownToLine, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ContextUsageView, ModelConfig, ProviderView } from "../../../shared/domain";
import { tr } from "../i18n/index";
import { useFloatingPanel } from "../lib/use-floating-panel";
import { useTokenSaver } from "../lib/use-token-saver";
import { TokenSaverStats } from "./TokenSaverStats";

export function ContextMeter({
  context,
  model,
  provider,
  running,
  canCompact,
  openRequest = 0,
  onCompact,
  onSettings,
  sessionId,
}: {
  sessionId: string;
  context: ContextUsageView | null;
  model: ModelConfig | undefined;
  provider: ProviderView | undefined;
  running: boolean;
  canCompact: boolean;
  openRequest?: number;
  onCompact: () => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { snapshot, error } = useTokenSaver(sessionId);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = useFloatingPanel(open, trigger, panel, {
    width: 340,
    maxHeight: 560,
    preferAbove: true,
  });
  const valid =
    context && model && context.modelId === model.id && context.providerId === provider?.id;
  const used = valid ? context.usedTokens : null;
  const percent = used === null || !model ? null : Math.floor((used / model.contextWindow) * 100);
  const formatK = (count: number) =>
    `${(count / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  useEffect(() => {
    if (openRequest) setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="context-meter"
        type="button"
        title={tr("查看上下文详情")}
        aria-label={tr("查看上下文详情")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        CTX {percent === null ? "—" : percent === 0 && used ? "<1%" : `${percent}%`}
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              className="context-details"
              role="dialog"
              aria-label={tr("上下文详情")}
              style={position}
              onKeyDown={(event) => {
                if (event.key !== "Tab") return;
                const items = [
                  ...(panel.current?.querySelectorAll<HTMLElement>(
                    "button:not(:disabled), summary, [tabindex='0']",
                  ) ?? []),
                ].filter((item) => item.getClientRects().length > 0);
                if (event.shiftKey && document.activeElement === items[0]) {
                  event.preventDefault();
                  items.at(-1)?.focus();
                } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
                  event.preventDefault();
                  items[0]?.focus();
                }
              }}
            >
              <header>
                <strong>{tr("上下文窗口")}</strong>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  aria-label={tr("关闭")}
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <X size={14} />
                </button>
              </header>
              <div className="context-details__usage">
                <strong>{used === null ? "—" : formatK(used)}</strong>
                <span>/ {model ? formatK(model.contextWindow) : "—"} tokens</span>
              </div>
              <progress
                value={Math.min(100, percent ?? 0)}
                max={100}
                aria-label={tr("上下文占用")}
              />
              <dl>
                <div>
                  <dt>{tr("已使用")}</dt>
                  <dd>{percent === null ? tr("尚未测量") : `${percent}%`}</dd>
                </div>
                <div>
                  <dt>{tr("计数来源")}</dt>
                  <dd>
                    {valid && context.source === "provider"
                      ? tr("供应商用量校准")
                      : valid && context.estimateScope === "local"
                        ? tr("本地上下文估算")
                        : tr("请求估算")}
                  </dd>
                </div>
                {valid && context.restored ? (
                  <div>
                    <dt>{tr("恢复状态")}</dt>
                    <dd>{tr("已从本地记录恢复")}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{tr("自动压缩阈值")}</dt>
                  <dd>85%</dd>
                </div>
                <div>
                  <dt>{tr("当前模型")}</dt>
                  <dd>
                    {provider?.name} / {model?.displayName ?? "—"}
                  </dd>
                </div>
                {context?.lastCompactedAt ? (
                  <div>
                    <dt>{tr("上次压缩")}</dt>
                    <dd>{new Date(context.lastCompactedAt).toLocaleString()}</dd>
                  </div>
                ) : null}
              </dl>
              {valid && context.estimateScope === "local" ? (
                <p>
                  {tr(
                    "基于已保存历史和内置提示估算，尚未加载的项目指令与扩展内容可能有差异；下次请求时重新校准。",
                  )}
                </p>
              ) : null}
              {used === null ? (
                <p>{tr("当前模型配置无效时无法计算上下文，请重新选择可用模型。")}</p>
              ) : null}
              <details className="token-saver-context">
                <summary>
                  Token Saver
                  {snapshot?.report ? ` · ${tr("估算减少")} ${snapshot.report.savedPercent}%` : ""}
                </summary>
                {error ? (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                ) : null}
                {snapshot ? (
                  <TokenSaverStats key={sessionId} snapshot={snapshot} sessionId={sessionId} />
                ) : null}
              </details>
              <footer>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => {
                    setOpen(false);
                    onSettings();
                  }}
                >
                  <Settings2 size={14} />
                  {tr("压缩设置")}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={running || !canCompact}
                  onClick={() => {
                    setOpen(false);
                    onCompact();
                  }}
                >
                  <ArrowDownToLine size={14} />
                  {tr("立即压缩")}
                </button>
              </footer>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
