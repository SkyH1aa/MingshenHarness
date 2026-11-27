import { ChevronRight, Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  RuntimeLogBreakdown,
  RuntimeLogStatistics,
  RuntimeLogStatus,
} from "../../../shared/runtime-log";
import { tr } from "../i18n";
import "./runtime-log-settings.css";

function LogBreakdown({
  title,
  nameLabel,
  rows,
}: {
  title: string;
  nameLabel: string;
  rows: RuntimeLogBreakdown[];
}) {
  return (
    <details className="runtime-log-breakdown">
      <summary>
        <ChevronRight size={15} aria-hidden="true" />
        {title}
      </summary>
      {rows.length ? (
        <section
          className="runtime-log-breakdown__scroll"
          aria-label={title}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The independently scrolling table needs keyboard access.
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{nameLabel}</th>
                <th scope="col">{tr("错误")}</th>
                <th scope="col">{tr("警告")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <th scope="row">{row.name}</th>
                  <td>{row.errors}</td>
                  <td>{row.warnings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <p className="form-note">{tr("当前没有可统计的记录。")}</p>
      )}
    </details>
  );
}

export function RuntimeLogStatisticsView({ statistics }: { statistics: RuntimeLogStatistics }) {
  const { errors, warnings, omitted, damaged, bySource, byOperation } = statistics;
  return (
    <div className="runtime-log-statistics">
      <dl className="runtime-log-details">
        <div>
          <dt>{tr("留存记录")}</dt>
          <dd>{tr("{0} 个错误 · {1} 个警告", [errors, warnings])}</dd>
        </div>
        <div>
          <dt>{tr("已知遗漏")}</dt>
          <dd>
            {tr("错误 {0} · 警告 {1} · 级别未知 {2}", [
              omitted.errors,
              omitted.warnings,
              omitted.unknown,
            ])}
          </dd>
        </div>
        <div>
          <dt>{tr("损坏记录")}</dt>
          <dd>{damaged}</dd>
        </div>
      </dl>
      <p className="form-note">
        {tr("统计仅包含当前留存日志记录，不代表去重后的故障数或历史总数。")}
      </p>
      <LogBreakdown title={tr("按来源查看")} nameLabel={tr("来源")} rows={bySource} />
      <LogBreakdown title={tr("按接口查看")} nameLabel={tr("接口")} rows={byOperation} />
    </div>
  );
}

export function RuntimeLogSettings() {
  const [status, setStatus] = useState<RuntimeLogStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exported, setExported] = useState("");
  const refresh = useCallback(async () => {
    setError("");
    try {
      setStatus(await window.mingshen.getRuntimeLogStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const exportLogs = async () => {
    setBusy(true);
    setError("");
    setExported("");
    try {
      const path = await window.mingshen.exportRuntimeLogs();
      if (path) setExported(path);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-page runtime-log-settings">
      <section className="settings-block">
        <div className="settings-block__heading">
          <h3>{tr("本地运行日志")}</h3>
          <button
            type="button"
            className="icon-button"
            title={tr("刷新日志状态")}
            aria-label={tr("刷新日志状态")}
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        <p className="quiet-copy">
          {tr(
            "记录网络、模型、审批、压缩、工具与界面运行异常，仅保存在此电脑。导出后可自行发送给开发者排查。",
          )}
        </p>
        <dl className="runtime-log-details">
          <div>
            <dt>{tr("日志位置")}</dt>
            <dd>{status?.directory ?? "—"}</dd>
          </div>
          <div>
            <dt>{tr("磁盘占用")}</dt>
            <dd>
              {status
                ? `${(status.bytes / 1024 / 1024).toFixed(2)} MiB / ${status.maxBytes / 1024 / 1024} MiB`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>{tr("保留时间")}</dt>
            <dd>{status ? tr("最多 {0} 天，超过容量自动轮换", [status.retentionDays]) : "—"}</dd>
          </div>
        </dl>
        {status ? <RuntimeLogStatisticsView statistics={status.statistics} /> : null}
        <p className="form-note">
          {tr(
            "导出不附带完整聊天、附件或源文件，已识别的密钥与鉴权信息会被脱敏。第三方错误仍可能包含路径或其他敏感内容，请在分享前检查。",
          )}
        </p>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => void exportLogs()}
        >
          <Download size={15} />
          {tr(busy ? "正在导出日志" : "导出运行日志")}
        </button>
        {exported ? (
          <p className="form-note" role="status">
            {tr("日志已导出：{0}", [exported])}
          </p>
        ) : null}
        {error || status?.lastError ? (
          <p className="form-error" role="alert">
            {error || status?.lastError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
