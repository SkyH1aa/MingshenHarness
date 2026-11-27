import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  FileCheck2,
  FileWarning,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OfficeDeliveryEngine,
  OfficeDeliveryReceipt,
  OfficeDeliveryStageName,
  OfficeDeliveryStageStatus,
} from "../../../shared/office-delivery";
import { getLocale } from "../i18n";
import {
  canContinueOfficeDelivery,
  firstUninspectedOfficePage,
  officeDeliveryStatusLabel,
} from "../lib/office-delivery-panel";
import { ExpandableText } from "./ExpandableText";
import "./office-delivery-panel.css";

const STAGE_LABELS: Record<OfficeDeliveryStageName, { zh: string; en: string }> = {
  package: { zh: "包安全", en: "Package" },
  structure: { zh: "结构", en: "Structure" },
  content: { zh: "内容", en: "Content" },
  formula: { zh: "公式", en: "Formulas" },
  recalculation: { zh: "重算", en: "Recalculation" },
  render: { zh: "渲染", en: "Render" },
  visual: { zh: "视觉", en: "Visual" },
};

const STAGE_STATUS_LABELS: Record<OfficeDeliveryStageStatus, { zh: string; en: string }> = {
  verified: { zh: "通过", en: "Passed" },
  partial: { zh: "部分", en: "Partial" },
  unavailable: { zh: "不可用", en: "Unavailable" },
  failed: { zh: "失败", en: "Failed" },
  not_requested: { zh: "未要求", en: "Not requested" },
  blocked: { zh: "阻止", en: "Blocked" },
};

const ENGINE_LABELS: Record<OfficeDeliveryEngine, { zh: string; en: string }> = {
  microsoft_office: { zh: "Microsoft Office", en: "Microsoft Office" },
  libreoffice: { zh: "LibreOffice", en: "LibreOffice" },
  source_pdf: { zh: "源 PDF", en: "Source PDF" },
  none: { zh: "无渲染器", en: "No renderer" },
};

function localized(zh: string, en: string): string {
  return getLocale() === "en" ? en : zh;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function upsertReceipt(
  receipts: OfficeDeliveryReceipt[],
  receipt: OfficeDeliveryReceipt,
): OfficeDeliveryReceipt[] {
  return [...receipts.filter((item) => item.id !== receipt.id), receipt].sort((left, right) => {
    const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return Number.isFinite(updated) && updated !== 0
      ? updated
      : right.createdAt.localeCompare(left.createdAt);
  });
}

function stageTone(status: OfficeDeliveryStageStatus): string {
  if (status === "verified") return "is-ok";
  if (status === "failed" || status === "blocked") return "is-error";
  if (status === "partial" || status === "unavailable") return "is-warning";
  return "is-muted";
}

export function OfficeDeliveryPanel({ sessionId, busy }: { sessionId: string; busy: boolean }) {
  const [receipts, setReceipts] = useState<OfficeDeliveryReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const next = await window.mingshen.listOfficeDeliveries(sessionId);
      if (sequence === loadSequence.current) setReceipts(next);
    } catch (cause) {
      if (sequence === loadSequence.current) setError(errorMessage(cause));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setReceipts([]);
    setExpanded(new Set());
    setContinuingId(null);
    void load();
    const off = window.mingshen.onRuntimeEvent((event) => {
      if (event.type !== "office_delivery_updated" || event.sessionId !== sessionId) return;
      setReceipts((current) => upsertReceipt(current, event.receipt));
      setError("");
    });
    return () => {
      loadSequence.current += 1;
      off();
    };
  }, [load, sessionId]);

  const resume = async (receipt: OfficeDeliveryReceipt) => {
    const startPage = firstUninspectedOfficePage(receipt);
    if (startPage === null || !canContinueOfficeDelivery(receipt)) return;
    setContinuingId(receipt.id);
    setError("");
    try {
      const updated = await window.mingshen.continueOfficeDelivery({
        sessionId,
        deliveryId: receipt.id,
        startPage,
      });
      setReceipts((current) => upsertReceipt(current, updated));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setContinuingId(null);
    }
  };

  if (!receipts.length && loading) return null;
  if (!receipts.length && !error) return null;

  return (
    <section
      className="office-delivery-panel"
      aria-label={localized("办公交付回执", "Office delivery receipts")}
    >
      <header className="office-delivery-panel__header">
        <div>
          <FileCheck2 aria-hidden="true" size={14} />
          <strong>{localized("办公交付", "Office delivery")}</strong>
          {receipts.length ? <span>{receipts.length}</span> : null}
        </div>
        <button
          className="icon-button"
          type="button"
          disabled={loading}
          title={localized("刷新交付回执", "Refresh delivery receipts")}
          aria-label={localized("刷新交付回执", "Refresh delivery receipts")}
          onClick={() => void load()}
        >
          <RefreshCw className={loading ? "spin" : undefined} aria-hidden="true" size={13} />
        </button>
      </header>

      {error ? (
        <div className="office-delivery-panel__error" role="alert">
          <AlertTriangle aria-hidden="true" size={14} />
          <ExpandableText text={error} tone="error" />
        </div>
      ) : null}

      <ul className="office-delivery-panel__list">
        {receipts.map((receipt) => {
          const isExpanded = expanded.has(receipt.id);
          const canContinue = canContinueOfficeDelivery(receipt);
          const startPage = firstUninspectedOfficePage(receipt);
          const visualTotal = receipt.visual.totalPages;
          const coverage =
            visualTotal && visualTotal > 0
              ? Math.min(100, (receipt.visual.inspectedPages / visualTotal) * 100)
              : null;
          return (
            <li
              className={`office-delivery-panel__item office-delivery-panel__item--${receipt.status}`}
              key={receipt.id}
              data-office-delivery-id={receipt.id}
              data-office-delivery-status={receipt.status}
            >
              <div className="office-delivery-panel__summary">
                <span className="office-delivery-panel__file-icon">
                  {receipt.status === "blocked" || receipt.status === "stale" ? (
                    <FileWarning aria-hidden="true" size={15} />
                  ) : receipt.status === "verified" ? (
                    <CheckCircle2 aria-hidden="true" size={15} />
                  ) : (
                    <Eye aria-hidden="true" size={15} />
                  )}
                </span>
                <button
                  className="office-delivery-panel__identity"
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(receipt.id)) next.delete(receipt.id);
                      else next.add(receipt.id);
                      return next;
                    })
                  }
                >
                  <span>
                    {isExpanded ? (
                      <ChevronDown aria-hidden="true" size={13} />
                    ) : (
                      <ChevronRight aria-hidden="true" size={13} />
                    )}
                    <strong title={receipt.fileName}>{receipt.fileName}</strong>
                  </span>
                  <small>
                    {receipt.format} · {formatBytes(receipt.size)} ·{" "}
                    {ENGINE_LABELS[receipt.engine][getLocale() === "en" ? "en" : "zh"]}
                  </small>
                  <code title={receipt.sha256}>SHA-256 {receipt.sha256}</code>
                </button>
                <span
                  className={`office-delivery-panel__status office-delivery-panel__status--${receipt.status}`}
                >
                  {receipt.status === "blocked" ? (
                    <ShieldAlert aria-hidden="true" size={12} />
                  ) : null}
                  {officeDeliveryStatusLabel(receipt.status, getLocale() === "en" ? "en" : "zh")}
                </span>
              </div>

              <div className="office-delivery-panel__coverage">
                <div>
                  <span>
                    {visualTotal
                      ? localized(
                          `视觉覆盖 ${receipt.visual.inspectedPages}/${visualTotal} 页`,
                          `Visual coverage ${receipt.visual.inspectedPages}/${visualTotal} pages`,
                        )
                      : localized(
                          `已检查 ${receipt.visual.inspectedPages} 页`,
                          `${receipt.visual.inspectedPages} pages inspected`,
                        )}
                  </span>
                  <small>
                    <Clock3 aria-hidden="true" size={11} />
                    {formatTime(receipt.checkedAt ?? receipt.updatedAt)}
                  </small>
                </div>
                <span className="office-delivery-panel__progress" aria-hidden="true">
                  <span style={{ width: `${coverage ?? 0}%` }} />
                </span>
              </div>

              {receipt.status === "stale" ? (
                <p className="office-delivery-panel__notice">
                  <AlertTriangle aria-hidden="true" size={13} />
                  {localized(
                    "最终文件已变化，此回执不再适用于当前文件，请重新执行交付检查。",
                    "The final file changed. This receipt no longer applies; run delivery checks again.",
                  )}
                </p>
              ) : null}

              {canContinue ? (
                <div className="office-delivery-panel__actions">
                  <button
                    className="btn btn--secondary"
                    type="button"
                    disabled={busy || continuingId !== null}
                    title={
                      busy
                        ? localized(
                            "当前任务结束后可继续检查",
                            "You can continue after the current task finishes",
                          )
                        : undefined
                    }
                    onClick={() => void resume(receipt)}
                  >
                    {continuingId === receipt.id ? (
                      <LoaderCircle className="spin" aria-hidden="true" size={13} />
                    ) : (
                      <Play aria-hidden="true" size={13} />
                    )}
                    {localized(`从第 ${startPage} 页继续检查`, `Continue from page ${startPage}`)}
                  </button>
                </div>
              ) : null}

              {isExpanded ? (
                <div className="office-delivery-panel__details">
                  <dl className="office-delivery-panel__metadata">
                    <div>
                      <dt>{localized("检查引擎", "Check engine")}</dt>
                      <dd>{ENGINE_LABELS[receipt.engine][getLocale() === "en" ? "en" : "zh"]}</dd>
                    </div>
                    <div>
                      <dt>{localized("批次", "Batches")}</dt>
                      <dd>{receipt.visual.batchCount}</dd>
                    </div>
                    <div>
                      <dt>{localized("视觉模型", "Vision model")}</dt>
                      <dd title={receipt.visual.modelId ?? undefined}>
                        {receipt.visual.modelId ?? localized("当前会话模型", "Current session")}
                      </dd>
                    </div>
                    <div>
                      <dt>{localized("回执更新时间", "Receipt updated")}</dt>
                      <dd>{formatTime(receipt.updatedAt)}</dd>
                    </div>
                  </dl>

                  <div className="office-delivery-panel__stages">
                    {(Object.keys(STAGE_LABELS) as OfficeDeliveryStageName[]).map((stage) => (
                      <span
                        className={stageTone(receipt.stages[stage])}
                        key={stage}
                        title={`${STAGE_LABELS[stage][getLocale() === "en" ? "en" : "zh"]}: ${
                          STAGE_STATUS_LABELS[receipt.stages[stage]][
                            getLocale() === "en" ? "en" : "zh"
                          ]
                        }`}
                      >
                        {STAGE_LABELS[stage][getLocale() === "en" ? "en" : "zh"]}
                        <small>
                          {
                            STAGE_STATUS_LABELS[receipt.stages[stage]][
                              getLocale() === "en" ? "en" : "zh"
                            ]
                          }
                        </small>
                      </span>
                    ))}
                  </div>

                  {receipt.formulaCoverage ? (
                    <div className="office-delivery-panel__detail-group">
                      <strong>{localized("公式检查覆盖", "Formula coverage")}</strong>
                      <dl className="office-delivery-panel__metadata">
                        <div>
                          <dt>
                            {receipt.formulaCoverage.complete
                              ? localized("公式总数", "Total formulas")
                              : localized("已发现公式", "Formulas found")}
                          </dt>
                          <dd>{receipt.formulaCoverage.formulas.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>{localized("缺失缓存", "Missing caches")}</dt>
                          <dd>{receipt.formulaCoverage.uncachedFormulas.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>{localized("错误结果", "Error results")}</dt>
                          <dd>{receipt.formulaCoverage.errors.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>{localized("已扫描单元格", "Cells scanned")}</dt>
                          <dd>{receipt.formulaCoverage.inspectedCells.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>{localized("统计范围", "Scan coverage")}</dt>
                          <dd>
                            {receipt.formulaCoverage.complete
                              ? localized("完整扫描", "Complete scan")
                              : localized("部分扫描", "Partial scan")}
                          </dd>
                        </div>
                      </dl>
                      {receipt.formulaCoverage.samples.length ? (
                        <>
                          <strong>
                            {localized(
                              `公式样本（${receipt.formulaCoverage.samples.length} 条）`,
                              `Formula samples (${receipt.formulaCoverage.samples.length})`,
                            )}
                          </strong>
                          <ExpandableText
                            text={receipt.formulaCoverage.samples
                              .map(
                                (sample) =>
                                  `${sample.sheet}!${sample.cell}: ${sample.formula}\n${localized("缓存", "Cache")}: ${
                                    sample.cached
                                      ? (sample.result ?? localized("空结果", "Empty result"))
                                      : localized("缺失", "Missing")
                                  }`,
                              )
                              .join("\n\n")}
                          />
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {receipt.structuralSummary ? (
                    <div className="office-delivery-panel__detail-group">
                      <strong>{localized("结构与内容摘要", "Structure and content")}</strong>
                      <ExpandableText text={receipt.structuralSummary} />
                    </div>
                  ) : null}

                  {receipt.issues.length ? (
                    <div className="office-delivery-panel__detail-group">
                      <strong>{localized("发现的问题", "Issues")}</strong>
                      <ul>
                        {receipt.issues.slice(0, 8).map((issue) => (
                          <li
                            className={`is-${issue.severity}`}
                            key={`${issue.code}:${issue.message}`}
                          >
                            <span>{issue.code}</span>
                            {issue.message}
                          </li>
                        ))}
                      </ul>
                      {receipt.issues.length > 8 ? (
                        <small>
                          {localized(
                            `另有 ${receipt.issues.length - 8} 项未展开`,
                            `${receipt.issues.length - 8} more not shown`,
                          )}
                        </small>
                      ) : null}
                    </div>
                  ) : null}

                  {receipt.unverified.length ? (
                    <div className="office-delivery-panel__detail-group">
                      <strong>{localized("未验证项", "Unverified")}</strong>
                      <ul>
                        {receipt.unverified.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {receipt.repairSuggestions.length ? (
                    <div className="office-delivery-panel__detail-group">
                      <strong>{localized("修复建议", "Repair suggestions")}</strong>
                      <ul>
                        {receipt.repairSuggestions.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
