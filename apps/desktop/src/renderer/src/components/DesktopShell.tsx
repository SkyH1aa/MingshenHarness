import {
  BookOpen,
  Check,
  CircleAlert,
  Download,
  Languages,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type {
  DependencyProgress,
  PolicyConsent,
  PolicyDocument,
  UpdateStatus,
} from "../../../shared/desktop";
import {
  DEFAULT_DESKTOP_SHORTCUTS,
  formatDesktopShortcut,
} from "../../../shared/desktop-shortcuts";
import { setLocale, useLocale } from "../i18n";
import { tr } from "../i18n/index";
import { MarkdownLite } from "./MarkdownLite";
import { UpdateControls, updateLabel } from "./UpdateControls";

export function DesktopShell({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const [state, setState] = useState<Awaited<
    ReturnType<typeof window.mingshen.getDesktopState>
  > | null>(null);
  const [close, setClose] = useState<{ tasks: number; running: number } | null>(null);
  const [remember, setRemember] = useState(false);
  const [seconds, setSeconds] = useState(5);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [agreed, setAgreed] = useState<PolicyConsent>({
    terms: false,
    privacy: false,
    disclaimer: false,
  });
  const [document, setDocument] =
    useState<Exclude<PolicyDocument, "manual" | "changelog">>("terms");
  const [referenceDocument, setReferenceDocument] = useState<"manual" | "changelog">("manual");
  const [documentError, setDocumentError] = useState("");
  const [documentRetry, setDocumentRetry] = useState(0);
  const documentBody = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState("");
  const [headings, setHeadings] = useState<Array<{ id: string; title: string }>>([]);
  const [manual, setManual] = useState(false);
  const [legal, setLegal] = useState(false);
  const [error, setError] = useState("");
  const [stateRetry, setStateRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [dependency, setDependency] = useState<DependencyProgress | null>(null);
  const accepted = state?.accepted;
  const showReference = accepted === true && manual;
  const reviewingPolicy = accepted === true && legal;
  const dismissDocument = useCallback(async () => {
    if (state?.manualPending) {
      if (!showReference || referenceDocument !== "manual") {
        setReferenceDocument("manual");
        setManual(true);
        setLegal(false);
        return;
      }
      if (!content || documentError || busy) return;
      setBusy(true);
      try {
        await window.mingshen.desktopAction("finish-onboarding");
        setState((current) => (current ? { ...current, manualPending: false } : current));
      } catch (cause) {
        setError(String(cause));
        return;
      } finally {
        setBusy(false);
      }
    }
    setManual(false);
    setLegal(false);
  }, [state?.manualPending, showReference, referenceDocument, content, documentError, busy]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stateRetry explicitly retries failed startup state loading.
  useEffect(() => {
    let active = true;
    setError("");
    void window.mingshen
      .getDesktopState()
      .then((next) => {
        if (!active) return;
        setState(next);
        setLocale(next.locale);
        if (next.manualPending) {
          setReferenceDocument("manual");
          setManual(true);
        }
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [stateRetry]);
  useEffect(() => {
    if (accepted !== false && !manual && !legal && close === null && !updateOpen) return;
    const keyboard = (event: KeyboardEvent) => {
      const dialog = [
        ...window.document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
      ].at(-1);
      if (!dialog) return;
      const buttons = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
        ),
      ];
      if (event.key === "Tab" && buttons.length) {
        const first = buttons[0];
        const last = buttons.at(-1);
        if (
          !dialog.contains(window.document.activeElement) ||
          (event.shiftKey && window.document.activeElement === first)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && window.document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      if (event.key === "Escape") {
        if (close !== null) {
          setClose(null);
          void window.mingshen.desktopAction("cancel-close");
        } else if (accepted) {
          void dismissDocument();
          setUpdateOpen(false);
        }
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [accepted, manual, legal, close, updateOpen, dismissDocument]);
  useEffect(
    () =>
      window.mingshen.onDesktopEvent((event) => {
        if (event.type === "close-request")
          setClose({ tasks: event.tasks ?? 0, running: event.runningConversations ?? 0 });
        if (event.type === "open-manual") {
          setReferenceDocument("manual");
          setManual(true);
          setLegal(false);
        }
        if (event.type === "window-state")
          setState((current) =>
            current ? { ...current, maximized: event.maximized ?? false } : current,
          );
        if (event.type === "shortcuts-changed") {
          void window.mingshen
            .getDesktopState()
            .then(setState)
            .catch((cause) => setError(String(cause)));
        }
      }),
    [],
  );
  useEffect(
    () =>
      window.mingshen.onUpdateEvent((event) => {
        setUpdate(event.status);
        if (event.notify && ["available", "error"].includes(event.status.state))
          setUpdateOpen(true);
      }),
    [],
  );
  useEffect(() => {
    if (!accepted) return;
    let active = true;
    void window.mingshen
      .getUpdateStatus()
      .then((next) => {
        if (active) setUpdate(next);
      })
      .catch((cause) => setError(String(cause)));
    return () => {
      active = false;
    };
  }, [accepted]);
  useEffect(() => window.mingshen.onDependencyProgress(setDependency), []);
  useEffect(() => {
    if (accepted !== false || openedAt === null) return;
    const start = openedAt;
    const timer = setInterval(
      () => setSeconds(Math.max(0, Math.ceil(5 - (performance.now() - start) / 1000))),
      100,
    );
    return () => clearInterval(timer);
  }, [accepted, openedAt]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: documentRetry reloads a failed local document on request.
  useEffect(() => {
    let active = true;
    if (accepted === false || manual || legal) {
      setContent("");
      setDocumentError("");
      void window.mingshen
        .readPolicy(manual && accepted ? referenceDocument : document, locale)
        .then((next) => {
          if (active) {
            setContent(next);
            setOpenedAt((current) => current ?? performance.now());
          }
        })
        .catch((cause) => {
          if (active) setDocumentError(String(cause));
        });
    }
    return () => {
      active = false;
    };
  }, [accepted, document, referenceDocument, manual, legal, locale, documentRetry]);
  useEffect(() => {
    if (content) documentBody.current?.scrollTo(0, 0);
    setHeadings(
      [...(documentBody.current?.querySelectorAll<HTMLHeadingElement>("h2[id]") ?? [])].map(
        (heading) => ({ id: heading.id, title: heading.textContent ?? "" }),
      ),
    );
  }, [content]);
  useEffect(() => {
    const open = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (name === "manual" || name === "changelog") {
        setReferenceDocument(name);
        setManual(true);
        setLegal(false);
      } else if (name === "terms" || name === "privacy" || name === "disclaimer") {
        setDocument(name);
        setManual(false);
        setLegal(true);
      }
    };
    window.addEventListener("mingshen:document", open);
    return () => window.removeEventListener("mingshen:document", open);
  }, []);
  const action = (value: "minimize" | "maximize" | "close" | "tray" | "quit" | "cancel-close") => {
    void window.mingshen
      .desktopAction(value, undefined, remember)
      .catch((cause) => setError(String(cause)));
    if (value === "tray" || value === "cancel-close") setClose(null);
  };
  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await window.mingshen.acceptPolicies(agreed);
      setContent("");
      setState((current) =>
        current ? { ...current, accepted: true, manualPending: true } : current,
      );
      setReferenceDocument("manual");
      setManual(true);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const unavailableShortcuts = state?.shortcuts
    ? [
        ...(!state.shortcuts.quickChat
          ? [
              formatDesktopShortcut(
                state.shortcutBindings?.quickChat ?? DEFAULT_DESKTOP_SHORTCUTS.quickChat,
              ),
            ]
          : []),
        ...(!state.shortcuts.toggleMain
          ? [
              formatDesktopShortcut(
                state.shortcutBindings?.toggleMain ?? DEFAULT_DESKTOP_SHORTCUTS.toggleMain,
              ),
            ]
          : []),
      ]
    : [];
  return (
    <div className="desktop-shell">
      <header className="desktop-caption">
        <div id="workbench-titlebar" className="desktop-caption__workspace">
          <span className="desktop-caption__name">Mingshen Harness</span>
        </div>
        <div className="desktop-caption__actions">
          {unavailableShortcuts.length ? (
            <span
              className="desktop-caption__shortcut-warning"
              data-testid="desktop-shortcut-warning"
              role="status"
              title={tr("全局快捷键未注册：{0}。可能已被其他应用占用，可从托盘打开。", [
                unavailableShortcuts.join("、"),
              ])}
              aria-label={tr("全局快捷键未注册：{0}。可能已被其他应用占用，可从托盘打开。", [
                unavailableShortcuts.join("、"),
              ])}
            >
              <CircleAlert size={15} strokeWidth={1.8} aria-hidden="true" />
            </span>
          ) : null}
          {update?.release && !["idle", "current", "checking"].includes(update.state) ? (
            <button
              type="button"
              className="desktop-update-trigger"
              title={updateLabel(update)}
              aria-label={tr("软件更新")}
              onClick={() => setUpdateOpen(true)}
            >
              <Download size={14} />
              <span>{updateLabel(update)}</span>
            </button>
          ) : null}
          <button
            type="button"
            title={tr("使用手册与更新日志")}
            aria-label={tr("使用手册与更新日志")}
            disabled={!accepted}
            onClick={() => {
              setReferenceDocument("manual");
              setManual(true);
              setLegal(false);
            }}
          >
            <BookOpen size={15} />
          </button>
          <button
            type="button"
            title={tr("\u4E2D\u6587 / English")}
            aria-label={tr("\u4E2D\u6587 / English")}
            onClick={() => {
              const locale =
                window.localStorage.getItem("mingshen.locale") === "en" ? "zh-CN" : "en";
              setLocale(locale);
              void window.mingshen.desktopAction("locale", locale);
            }}
          >
            <Languages size={15} />
          </button>
          <button
            type="button"
            title={tr("最小化")}
            aria-label={tr("最小化")}
            onClick={() => action("minimize")}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            title={state?.maximized ? tr("还原窗口") : tr("最大化")}
            aria-label={state?.maximized ? tr("还原窗口") : tr("最大化")}
            onClick={() => action("maximize")}
          >
            {state?.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            className="desktop-caption__close"
            type="button"
            title={tr("关闭")}
            aria-label={tr("关闭")}
            onClick={() => action("close")}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="desktop-content">
        {state?.accepted ? (
          children
        ) : (
          <div className="app-loading">
            {state === null && error ? (
              <>
                <p className="form-error" role="alert">
                  {error}
                </p>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setStateRetry((count) => count + 1)}
                >
                  {tr("重新加载")}
                </button>
              </>
            ) : (
              <>
                <LoaderCircle size={20} className="spin" />
                <span>{tr("请阅读并同意协议")}</span>
              </>
            )}
          </div>
        )}
      </div>
      {dependency && state?.accepted && !manual && !legal && dependency.stage !== "ready" ? (
        <aside className="dependency-notice" aria-live="polite">
          <div>
            <strong>
              {dependency.name === "wsl"
                ? "WSL2"
                : dependency.name === "docker"
                  ? "Docker Desktop"
                  : "Embiody"}{" "}
              · {tr(dependency.stage === "error" ? "依赖安装需要处理" : "已开启自动下载与安装")}
            </strong>
            <p>{dependency.detail}</p>
            {dependency.stage === "downloading" ? (
              <progress
                max={dependency.total || undefined}
                value={dependency.total ? dependency.received : undefined}
              />
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            title={tr("关闭")}
            onClick={() => setDependency(null)}
          >
            <X size={16} />
          </button>
        </aside>
      ) : null}
      {state && (!state.accepted || manual || legal) ? (
        <div className="mingshen-dialog-backdrop desktop-dialog-backdrop">
          <section
            className="policy-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="policy-title"
          >
            <header>
              <h2 id="policy-title">
                {showReference
                  ? tr(referenceDocument === "changelog" ? "更新日志" : "使用手册")
                  : reviewingPolicy
                    ? tr(
                        document === "terms"
                          ? "服务协议"
                          : document === "privacy"
                            ? "隐私政策"
                            : "免责协议",
                      )
                    : tr("请阅读并同意协议")}
              </h2>
              {showReference || reviewingPolicy ? (
                <button
                  className="icon-button"
                  type="button"
                  title={tr("关闭")}
                  disabled={Boolean(state.manualPending && (!content || documentError || busy))}
                  onClick={() => void dismissDocument()}
                >
                  <X size={18} />
                </button>
              ) : (
                <div className="segmented-control">
                  <button
                    type="button"
                    className={
                      document === "terms"
                        ? "segmented-control__item segmented-control__item--active"
                        : "segmented-control__item"
                    }
                    onClick={() => setDocument("terms")}
                    aria-pressed={document === "terms"}
                  >
                    {tr("服务协议")}
                  </button>
                  <button
                    type="button"
                    className={
                      document === "privacy"
                        ? "segmented-control__item segmented-control__item--active"
                        : "segmented-control__item"
                    }
                    onClick={() => setDocument("privacy")}
                    aria-pressed={document === "privacy"}
                  >
                    {tr("隐私政策")}
                  </button>
                  <button
                    type="button"
                    className={
                      document === "disclaimer"
                        ? "segmented-control__item segmented-control__item--active"
                        : "segmented-control__item"
                    }
                    onClick={() => setDocument("disclaimer")}
                    aria-pressed={document === "disclaimer"}
                  >
                    {tr("免责协议")}
                  </button>
                </div>
              )}
            </header>
            {showReference ? (
              <nav className="policy-dialog__navigation" aria-label={tr("文档")}>
                <div className="segmented-control">
                  {(["manual", "changelog"] as const).map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`segmented-control__item${referenceDocument === name ? " segmented-control__item--active" : ""}`}
                      aria-pressed={referenceDocument === name}
                      onClick={() => setReferenceDocument(name)}
                    >
                      {tr(name === "manual" ? "使用手册" : "更新日志")}
                    </button>
                  ))}
                </div>
              </nav>
            ) : null}
            <div
              className={
                showReference ? "document-reader" : "document-reader document-reader--policy"
              }
            >
              {showReference && headings.length ? (
                <nav className="document-reader__contents" aria-label={tr("目录")}>
                  {headings.map((heading) => (
                    <button
                      type="button"
                      key={heading.id}
                      onClick={() => {
                        const target = [
                          ...(documentBody.current?.querySelectorAll<HTMLElement>("[id]") ?? []),
                        ].find((item) => item.id === heading.id);
                        if (target && documentBody.current)
                          documentBody.current.scrollTop +=
                            target.getBoundingClientRect().top -
                            documentBody.current.getBoundingClientRect().top -
                            16;
                      }}
                    >
                      {heading.title}
                    </button>
                  ))}
                </nav>
              ) : null}
              <div className="policy-dialog__body" ref={documentBody}>
                {documentError ? (
                  <div role="alert">
                    <p className="form-error">{documentError}</p>
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => setDocumentRetry((count) => count + 1)}
                    >
                      {tr("重新加载")}
                    </button>
                  </div>
                ) : !content ? (
                  <p role="status">{tr("正在加载文档")}</p>
                ) : (
                  <MarkdownLite
                    text={content}
                    documentNavigation
                    onOpenFile={(path) => {
                      if (path.includes("TERMS_OF_SERVICE")) {
                        setDocument("terms");
                        setManual(false);
                        setLegal(Boolean(accepted));
                      } else if (path.includes("PRIVACY_POLICY")) {
                        setDocument("privacy");
                        setManual(false);
                        setLegal(Boolean(accepted));
                      } else if (path.includes("DISCLAIMER")) {
                        setDocument("disclaimer");
                        setManual(false);
                        setLegal(Boolean(accepted));
                      } else if (path.includes("USER_GUIDE") || path.includes("CHANGELOG")) {
                        if (!accepted) return;
                        setReferenceDocument(path.includes("CHANGELOG") ? "changelog" : "manual");
                        setManual(true);
                        setLegal(false);
                      }
                    }}
                  />
                )}
              </div>
            </div>
            <footer>
              {error ? <p className="form-error">{error}</p> : null}
              {showReference || reviewingPolicy ? (
                <button
                  className="btn btn--primary"
                  type="button"
                  disabled={Boolean(state.manualPending && (!content || documentError || busy))}
                  onClick={() => void dismissDocument()}
                >
                  {manual && referenceDocument === "manual" ? tr("开始使用") : tr("关闭")}
                </button>
              ) : (
                <>
                  <div className="policy-consents">
                    {(["terms", "privacy", "disclaimer"] as const).map((name) => (
                      <label key={name}>
                        <input
                          type="checkbox"
                          checked={agreed[name]}
                          onChange={(event) =>
                            setAgreed((current) => ({ ...current, [name]: event.target.checked }))
                          }
                        />
                        <span>{tr("我已阅读并同意")}</span>
                        <button
                          className="policy-document-link"
                          type="button"
                          onClick={() => setDocument(name)}
                        >
                          {tr(
                            name === "terms"
                              ? "服务协议"
                              : name === "privacy"
                                ? "隐私政策"
                                : "免责协议",
                          )}
                        </button>
                      </label>
                    ))}
                  </div>
                  <div className="settings-actions">
                    <button
                      className="btn btn--secondary"
                      type="button"
                      onClick={() => action("quit")}
                    >
                      {tr("不同意并退出")}
                    </button>
                    <button
                      className="btn btn--primary"
                      type="button"
                      disabled={
                        !agreed.terms ||
                        busy ||
                        !agreed.privacy ||
                        !agreed.disclaimer ||
                        seconds > 0 ||
                        !content ||
                        Boolean(documentError)
                      }
                      onClick={() => void accept()}
                    >
                      <Check size={14} />
                      {seconds > 0 ? tr("请阅读 {0} 秒", [seconds]) : tr("同意并继续")}
                    </button>
                  </div>
                </>
              )}
            </footer>
          </section>
        </div>
      ) : null}
      {close !== null ? (
        <div className="mingshen-dialog-backdrop desktop-dialog-backdrop">
          <section
            className="close-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="close-title"
          >
            <header className="close-dialog__heading">
              <div>
                <h2 id="close-title">{tr("关闭 Mingshen Harness")}</h2>
                <p>
                  {tr(
                    "当前有 {0} 个会话正在运行（含等待审批），另有 {1} 个已启用的定时任务。最小化到托盘可继续运行；彻底退出将停止所有任务。",
                    [close.running, close.tasks],
                  )}
                </p>
              </div>
            </header>
            <label className="close-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              {tr("记住此选择")}
            </label>
            <footer className="close-dialog__actions">
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => action("cancel-close")}
              >
                {tr("取消")}
              </button>
              <button className="btn btn--secondary" type="button" onClick={() => action("quit")}>
                {tr("彻底退出")}
              </button>
              <button className="btn btn--primary" type="button" onClick={() => action("tray")}>
                {tr("最小化到托盘")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {updateOpen && update?.release && state?.accepted && !manual && !legal && close === null ? (
        <div className="mingshen-dialog-backdrop desktop-dialog-backdrop">
          <section
            className="close-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
          >
            <header className="close-dialog__heading">
              <h2 id="update-title">
                {tr("发现新版本")} {update.release.version}
              </h2>
              <p>
                {tr("当前版本")} {update.currentVersion} ·{" "}
                {new Date(update.release.publishedAt).toLocaleDateString(locale)}
              </p>
            </header>
            <div className="update-dialog__notes">{update.release.notes}</div>
            <UpdateControls status={update} onChange={setUpdate} />
            <footer className="close-dialog__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setUpdateOpen(false)}
              >
                {tr(["available", "error"].includes(update.state) ? "稍后再说" : "后台继续")}
              </button>
            </footer>
            {error ? <p className="form-error">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
