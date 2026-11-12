import { Download, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import type { UpdateStatus } from "../../../shared/desktop";
import { tr } from "../i18n";

export function updateLabel(status: UpdateStatus | null): string {
  switch (status?.state) {
    case "current":
      return tr("当前已是最新版本");
    case "checking":
      return tr("正在检查更新");
    case "available":
      return tr("发现新版本");
    case "downloading":
      return tr("正在下载更新");
    case "verifying":
      return tr("正在校验更新包");
    case "extracting":
      return tr("正在解压安装包");
    case "ready":
      return status.waitingForTasks
        ? tr("等待 {0} 个运行中的会话结束后安装", [status.waitingForTasks])
        : tr("更新已就绪");
    case "installing":
      return tr("正在退出并启动安装程序");
    case "error":
      return tr("软件更新失败");
    default:
      return tr("启动时和每 24 小时自动检查更新");
  }
}

export function UpdateControls({
  status,
  onChange,
}: {
  status: UpdateStatus;
  onChange: (next: UpdateStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const release = status.release;
  const running = ["downloading", "verifying", "extracting"].includes(status.state);
  const zip = release?.packageFormat === "zip";
  const automatic = zip && Boolean(release.packageSha256);
  const invoke = async (action: () => Promise<UpdateStatus>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onChange(await action());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const received = status.received ?? 0;
  const total = status.total;
  return (
    <div className="update-controls">
      <p className="update-controls__state" role="status">
        {updateLabel(status)}
      </p>
      {running ? (
        <div className="update-controls__progress">
          <progress
            aria-label={tr("更新下载进度")}
            value={total ? received : undefined}
            max={total ?? 1}
          />
          <span>
            {(received / 1024 ** 2).toFixed(1)} MiB
            {total
              ? ` / ${(total / 1024 ** 2).toFixed(1)} MiB (${Math.min(100, Math.floor((received / total) * 100))}%)`
              : ""}
          </span>
        </div>
      ) : null}
      {status.error || error ? (
        <p className="form-error" role="alert">
          {error || status.error}
        </p>
      ) : null}
      {release && ["available", "error"].includes(status.state) ? (
        <>
          <p className="quiet-copy">
            {tr(
              automatic
                ? "确认后将在后台下载 ZIP，校验并解压；会话结束后自动退出并运行安装程序。"
                : zip
                  ? "此更新缺少 SHA-256，请联系发布者补全；可手动下载。"
                  : "此版本使用旧版下载网页，请在浏览器中手动更新。",
            )}
          </p>
          <div className="update-controls__actions">
            {automatic ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void invoke(() => window.mingshen.downloadUpdate())}
              >
                <Download size={14} />
                {tr(status.state === "error" ? "重新下载更新" : "自动下载并安装")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setError("");
                void window.mingshen
                  .openExternalUrl(release.downloadUrl)
                  .catch((cause) => setError(String(cause)));
              }}
            >
              <ExternalLink size={14} />
              {tr(zip ? "手动下载" : "打开下载页面")}
            </button>
          </div>
        </>
      ) : null}
      {running || status.state === "ready" ? (
        <div className="update-controls__actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => void invoke(() => window.mingshen.cancelUpdate())}
          >
            <X size={14} />
            {tr("取消更新")}
          </button>
          {status.state === "ready" && !status.installWhenIdle ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void invoke(() => window.mingshen.installUpdate())}
            >
              {tr("安装更新")}
            </button>
          ) : null}
        </div>
      ) : null}
      {status.state === "installing" ? <LoaderCircle size={16} className="spin" /> : null}
    </div>
  );
}
