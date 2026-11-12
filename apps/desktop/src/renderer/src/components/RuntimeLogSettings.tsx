import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RuntimeLogStatus } from "../../../shared/runtime-log";
import { tr } from "../i18n";

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
