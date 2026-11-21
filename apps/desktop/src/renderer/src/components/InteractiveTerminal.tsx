import { FitAddon } from "@xterm/addon-fit";
import { type IDisposable, type ITheme, Terminal } from "@xterm/xterm";
import { LoaderCircle, Plus, Power, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type InteractiveTerminalEvent,
  type InteractiveTerminalStatus,
  type InteractiveTerminalView,
  MAX_INTERACTIVE_TERMINALS_PER_WINDOW,
} from "../../../shared/terminal";
import { useLocale } from "../i18n";
import "@xterm/xterm/css/xterm.css";
import "./InteractiveTerminal.css";

interface InteractiveTerminalProps {
  sessionId: string;
  active: boolean;
}

interface TerminalRuntime {
  terminal: Terminal;
  fitAddon: FitAddon;
  host: HTMLDivElement;
  resizeObserver: ResizeObserver;
  dataSubscription: IDisposable;
  fitFrame: number | null;
  lastCols: number;
  lastRows: number;
}

interface TerminalScope {
  sessionId: string;
  live: boolean;
  initialized: boolean;
  creating: boolean;
  terminalIds: Set<string>;
  cleanupRequested: Set<string>;
}

const PENDING_OUTPUT_LIMIT = 512 * 1024;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cursorBlinkEnabled(): boolean {
  const motion = document.documentElement.dataset.motion;
  return motion !== "off" && motion !== "reduced";
}

function readTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const variable = (name: string) => styles.getPropertyValue(name).trim();
  const day = document.documentElement.dataset.theme === "day";
  return {
    background: variable("--bg"),
    foreground: variable("--text"),
    cursor: variable("--brand"),
    cursorAccent: variable("--bg"),
    selectionBackground: variable("--brand-soft"),
    selectionInactiveBackground: variable("--surface-hover"),
    black: day ? "#27393a" : "#172225",
    red: variable("--danger"),
    green: variable("--success"),
    yellow: variable("--warning"),
    blue: day ? "#286b9d" : "#72b7ef",
    magenta: day ? "#8b4f90" : "#d59de0",
    cyan: variable("--brand"),
    white: variable("--text"),
    brightBlack: variable("--muted"),
    brightRed: variable("--danger"),
    brightGreen: variable("--success"),
    brightYellow: variable("--warning"),
    brightBlue: day ? "#175985" : "#9fd4ff",
    brightMagenta: day ? "#744379" : "#e4b5ec",
    brightCyan: variable("--brand-strong"),
    brightWhite: day ? "#111b1c" : "#ffffff",
  };
}

function mergeTerminal(
  terminals: InteractiveTerminalView[],
  terminal: InteractiveTerminalView,
): InteractiveTerminalView[] {
  const next = terminals.filter((item) => item.id !== terminal.id);
  next.push(terminal);
  next.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return next;
}

function appendPending(buffer: string, data: string): string {
  if (data.length >= PENDING_OUTPUT_LIMIT) return data.slice(-PENDING_OUTPUT_LIMIT);
  const next = `${buffer}${data}`;
  return next.length > PENDING_OUTPUT_LIMIT ? next.slice(-PENDING_OUTPUT_LIMIT) : next;
}

function statusLabel(status: InteractiveTerminalStatus, en: boolean): string {
  if (status === "running") return en ? "Running" : "运行中";
  if (status === "stopping") return en ? "Stopping" : "正在停止";
  if (status === "exited") return en ? "Exited" : "已退出";
  if (status === "stopped") return en ? "Stopped" : "已停止";
  return en ? "Unavailable" : "不可用";
}

function TerminalPane({
  terminalId,
  active,
  onMount,
}: {
  terminalId: string;
  active: boolean;
  onMount: (terminalId: string, host: HTMLDivElement | null) => void;
}) {
  const mount = useCallback(
    (host: HTMLDivElement | null) => onMount(terminalId, host),
    [onMount, terminalId],
  );
  return (
    <div
      className="interactive-terminal__pane"
      data-terminal-id={terminalId}
      data-active={active ? "true" : "false"}
      hidden={!active}
    >
      <div className="interactive-terminal__canvas" ref={mount} />
    </div>
  );
}

export function InteractiveTerminal({ sessionId, active }: InteractiveTerminalProps) {
  const en = useLocale() === "en";
  const [terminals, setTerminals] = useState<InteractiveTerminalView[]>([]);
  const terminalsRef = useRef<InteractiveTerminalView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const runtimes = useRef(new Map<string, TerminalRuntime>());
  const pendingOutput = useRef(new Map<string, string>());
  const scopeRef = useRef<TerminalScope | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const activeRef = useRef(active);
  activeRef.current = active;

  const isCurrentScope = useCallback(
    (scope: TerminalScope) =>
      scope.live && scopeRef.current === scope && sessionIdRef.current === scope.sessionId,
    [],
  );

  const stopForCleanup = useCallback((scope: TerminalScope, terminalId: string) => {
    if (scope.cleanupRequested.has(terminalId)) return;
    scope.cleanupRequested.add(terminalId);
    void window.mingshen.stopTerminal(terminalId).catch(() => undefined);
  }, []);

  const updateTerminals = useCallback(
    (update: (current: InteractiveTerminalView[]) => InteractiveTerminalView[]) => {
      setTerminals((current) => {
        const next = update(current);
        terminalsRef.current = next;
        return next;
      });
    },
    [],
  );

  const disposeRuntime = useCallback((terminalId: string) => {
    pendingOutput.current.delete(terminalId);
    const runtime = runtimes.current.get(terminalId);
    if (!runtime) return;
    runtimes.current.delete(terminalId);
    if (runtime.fitFrame !== null) cancelAnimationFrame(runtime.fitFrame);
    runtime.resizeObserver.disconnect();
    runtime.dataSubscription.dispose();
    runtime.fitAddon.dispose();
    runtime.terminal.dispose();
  }, []);

  const fitRuntime = useCallback(
    (terminalId: string) => {
      const runtime = runtimes.current.get(terminalId);
      const scope = scopeRef.current;
      if (!runtime) return;
      runtime.fitFrame = null;
      if (runtime.host.clientWidth <= 0 || runtime.host.clientHeight <= 0) return;
      try {
        runtime.fitAddon.fit();
      } catch {
        return;
      }
      const current = terminalsRef.current.find((item) => item.id === terminalId);
      if (
        current?.status !== "running" ||
        (runtime.lastCols === runtime.terminal.cols && runtime.lastRows === runtime.terminal.rows)
      ) {
        return;
      }
      runtime.lastCols = runtime.terminal.cols;
      runtime.lastRows = runtime.terminal.rows;
      void window.mingshen
        .resizeTerminal(terminalId, runtime.terminal.cols, runtime.terminal.rows)
        .catch((cause) => {
          if (scope && isCurrentScope(scope) && activeRef.current) setError(errorText(cause));
        });
    },
    [isCurrentScope],
  );

  const scheduleFit = useCallback(
    (terminalId: string) => {
      const runtime = runtimes.current.get(terminalId);
      if (!runtime || runtime.fitFrame !== null) return;
      runtime.fitFrame = requestAnimationFrame(() => fitRuntime(terminalId));
    },
    [fitRuntime],
  );

  const mountTerminal = useCallback(
    (terminalId: string, host: HTMLDivElement | null) => {
      if (!host) {
        disposeRuntime(terminalId);
        return;
      }
      const existing = runtimes.current.get(terminalId);
      if (existing?.host === host) return;
      if (existing) disposeRuntime(terminalId);
      const scope = scopeRef.current;

      const terminal = new Terminal({
        allowTransparency: false,
        cursorBlink: cursorBlinkEnabled(),
        cursorStyle: "bar",
        cursorWidth: 2,
        fontFamily: '"Cascadia Mono", "Cascadia Code", "IBM Plex Mono", Consolas, monospace',
        fontSize: 13,
        fontWeight: "400",
        fontWeightBold: "600",
        letterSpacing: 0,
        lineHeight: 1.25,
        minimumContrastRatio: 4.5,
        rightClickSelectsWord: true,
        scrollback: 8_000,
        theme: readTheme(),
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(host);
      const dataSubscription = terminal.onData((data) => {
        const current = terminalsRef.current.find((item) => item.id === terminalId);
        if (current?.status !== "running") return;
        void window.mingshen.writeTerminal(terminalId, data).catch((cause) => {
          if (scope && isCurrentScope(scope) && activeRef.current) setError(errorText(cause));
        });
      });
      const resizeObserver = new ResizeObserver(() => scheduleFit(terminalId));
      resizeObserver.observe(host);
      runtimes.current.set(terminalId, {
        terminal,
        fitAddon,
        host,
        resizeObserver,
        dataSubscription,
        fitFrame: null,
        lastCols: 0,
        lastRows: 0,
      });
      const buffered = pendingOutput.current.get(terminalId);
      if (buffered) {
        terminal.write(buffered);
        pendingOutput.current.delete(terminalId);
      }
      scheduleFit(terminalId);
    },
    [disposeRuntime, isCurrentScope, scheduleFit],
  );

  useEffect(() => {
    let scope = scopeRef.current;
    if (!scope || scope.live || scope.sessionId !== sessionId) {
      scope = {
        sessionId,
        live: true,
        initialized: false,
        creating: false,
        terminalIds: new Set(),
        cleanupRequested: new Set(),
      };
      scopeRef.current = scope;
      terminalsRef.current = [];
      setTerminals([]);
      setActiveId(null);
      setClosingIds(new Set());
      setError("");
      setLoading(false);
    } else {
      scope.live = true;
    }
    const ownedScope = scope;
    return () => {
      ownedScope.live = false;
      // React StrictMode replays effects synchronously; only clean up a real departure.
      queueMicrotask(() => {
        if (ownedScope.live) return;
        for (const terminalId of ownedScope.terminalIds) {
          stopForCleanup(ownedScope, terminalId);
          disposeRuntime(terminalId);
        }
      });
    };
  }, [disposeRuntime, sessionId, stopForCleanup]);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    const receive = (event: InteractiveTerminalEvent) => {
      if (!isCurrentScope(scope)) return;
      if (event.type === "output") {
        const runtime = runtimes.current.get(event.terminalId);
        if (runtime) {
          runtime.terminal.write(event.data);
        } else if (scope.terminalIds.has(event.terminalId) || scope.creating) {
          const current = pendingOutput.current.get(event.terminalId) ?? "";
          pendingOutput.current.set(event.terminalId, appendPending(current, event.data));
        }
        return;
      }
      if (event.type === "state") {
        if (event.terminal.sessionId !== sessionId) return;
        scope.terminalIds.add(event.terminal.id);
        updateTerminals((current) =>
          isCurrentScope(scope) ? mergeTerminal(current, event.terminal) : current,
        );
        return;
      }
      if (!scope.terminalIds.delete(event.terminalId)) return;
      updateTerminals((current) => current.filter((item) => item.id !== event.terminalId));
      setClosingIds((current) => {
        if (!current.has(event.terminalId)) return current;
        const next = new Set(current);
        next.delete(event.terminalId);
        return next;
      });
      disposeRuntime(event.terminalId);
    };
    return window.mingshen.onTerminalEvent(receive);
  }, [disposeRuntime, isCurrentScope, sessionId, updateTerminals]);

  const createTerminal = useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope || !isCurrentScope(scope) || scope.creating) return;
    if (scope.terminalIds.size >= MAX_INTERACTIVE_TERMINALS_PER_WINDOW) return;
    scope.creating = true;
    setLoading(true);
    setError("");
    try {
      const terminal = await window.mingshen.createTerminal({ sessionId });
      scope.terminalIds.add(terminal.id);
      if (!isCurrentScope(scope)) {
        stopForCleanup(scope, terminal.id);
        return;
      }
      updateTerminals((current) =>
        isCurrentScope(scope) ? mergeTerminal(current, terminal) : current,
      );
      setActiveId(terminal.id);
    } catch (cause) {
      if (isCurrentScope(scope)) setError(errorText(cause));
    } finally {
      scope.creating = false;
      if (isCurrentScope(scope)) setLoading(false);
    }
  }, [isCurrentScope, sessionId, stopForCleanup, updateTerminals]);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!active || !scope || !isCurrentScope(scope) || scope.initialized) return;
    scope.initialized = true;
    void (async () => {
      setLoading(true);
      try {
        const existing = await window.mingshen.listTerminals(sessionId);
        for (const terminal of existing) scope.terminalIds.add(terminal.id);
        if (!isCurrentScope(scope)) {
          for (const terminal of existing) stopForCleanup(scope, terminal.id);
          return;
        }
        updateTerminals((current) => {
          if (!isCurrentScope(scope)) return current;
          return existing.reduce(
            (next, terminal) =>
              next.some((item) => item.id === terminal.id) ? next : mergeTerminal(next, terminal),
            current,
          );
        });
        if (existing.length) setActiveId(existing.at(-1)?.id ?? null);
        else if (!scope.terminalIds.size) await createTerminal();
      } catch (cause) {
        if (isCurrentScope(scope)) setError(errorText(cause));
      } finally {
        if (isCurrentScope(scope)) setLoading(false);
      }
    })();
  }, [active, createTerminal, isCurrentScope, sessionId, stopForCleanup, updateTerminals]);

  useEffect(() => {
    terminalsRef.current = terminals;
    if (!terminals.length) {
      if (activeId) setActiveId(null);
      return;
    }
    if (!activeId || !terminals.some((terminal) => terminal.id === activeId)) {
      setActiveId(terminals.at(-1)?.id ?? null);
    }
  }, [activeId, terminals]);

  useEffect(() => {
    if (!active || !activeId) return;
    scheduleFit(activeId);
    runtimes.current.get(activeId)?.terminal.focus();
  }, [active, activeId, scheduleFit]);

  useEffect(() => {
    const syncTheme = () => {
      const theme = readTheme();
      const cursorBlink = cursorBlinkEnabled();
      for (const runtime of runtimes.current.values()) {
        runtime.terminal.options.theme = theme;
        runtime.terminal.options.cursorBlink = cursorBlink;
      }
    };
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-interface-style", "data-motion"],
    });
    return () => observer.disconnect();
  }, []);

  const closeTerminal = useCallback(
    async (terminalId: string) => {
      const scope = scopeRef.current;
      if (!scope || !isCurrentScope(scope) || closingIds.has(terminalId)) return;
      setClosingIds((current) => new Set(current).add(terminalId));
      setError("");
      try {
        await window.mingshen.stopTerminal(terminalId);
        if (!isCurrentScope(scope)) return;
        scope.terminalIds.delete(terminalId);
        updateTerminals((current) => current.filter((item) => item.id !== terminalId));
        disposeRuntime(terminalId);
      } catch (cause) {
        if (isCurrentScope(scope)) setError(errorText(cause));
      } finally {
        if (isCurrentScope(scope)) {
          setClosingIds((current) => {
            const next = new Set(current);
            next.delete(terminalId);
            return next;
          });
        }
      }
    },
    [closingIds, disposeRuntime, isCurrentScope, updateTerminals],
  );

  const sessionTerminals = terminals.filter((terminal) => terminal.sessionId === sessionId);
  const activeTerminal = sessionTerminals.find((terminal) => terminal.id === activeId) ?? null;
  const visibleError = error || activeTerminal?.error || "";

  return (
    <section
      className="interactive-terminal"
      data-active={active ? "true" : "false"}
      data-session-id={sessionId}
      aria-label={en ? "Interactive terminal" : "交互式终端"}
    >
      <header className="interactive-terminal__header">
        <div className="interactive-terminal__tabs" role="tablist" aria-label="Terminal tabs">
          {sessionTerminals.map((terminal) => (
            <div
              className="interactive-terminal__tab"
              data-active={terminal.id === activeId ? "true" : "false"}
              data-status={terminal.status}
              key={terminal.id}
            >
              <button
                className="interactive-terminal__tab-main"
                type="button"
                role="tab"
                aria-selected={terminal.id === activeId}
                title={terminal.title}
                onClick={() => setActiveId(terminal.id)}
              >
                <span className="interactive-terminal__status-dot" aria-hidden="true" />
                <span>{terminal.title}</span>
              </button>
              <button
                className="interactive-terminal__tab-close"
                type="button"
                aria-label={
                  en ? `Close and stop ${terminal.title}` : `关闭并终止 ${terminal.title}`
                }
                title={en ? "Close and stop" : "关闭并终止"}
                disabled={closingIds.has(terminal.id) || terminal.status === "stopping"}
                onClick={() => void closeTerminal(terminal.id)}
              >
                {closingIds.has(terminal.id) ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={12} />
                ) : (
                  <X aria-hidden="true" size={12} />
                )}
              </button>
            </div>
          ))}
          <button
            className="interactive-terminal__new"
            type="button"
            aria-label={en ? "New terminal" : "新建终端"}
            title={en ? "New terminal" : "新建终端"}
            disabled={loading || sessionTerminals.length >= MAX_INTERACTIVE_TERMINALS_PER_WINDOW}
            onClick={() => void createTerminal()}
          >
            {loading && !sessionTerminals.length ? (
              <LoaderCircle className="spin" aria-hidden="true" size={14} />
            ) : (
              <Plus aria-hidden="true" size={14} />
            )}
          </button>
        </div>
        <button
          className="interactive-terminal__action"
          type="button"
          aria-label={
            activeTerminal?.status === "error"
              ? en
                ? "Retry stopping active terminal"
                : "重试终止当前终端"
              : en
                ? "Stop active terminal"
                : "终止当前终端"
          }
          title={
            activeTerminal?.status === "error"
              ? en
                ? "Retry stopping"
                : "重试终止"
              : en
                ? "Stop terminal"
                : "终止终端"
          }
          disabled={
            !activeTerminal ||
            (activeTerminal.status !== "running" && activeTerminal.status !== "error") ||
            closingIds.has(activeTerminal.id)
          }
          onClick={() => activeTerminal && void closeTerminal(activeTerminal.id)}
        >
          <Power aria-hidden="true" size={14} />
        </button>
      </header>

      {visibleError ? (
        <div className="interactive-terminal__error" role="alert">
          {visibleError}
        </div>
      ) : null}

      <div className="interactive-terminal__panes">
        {sessionTerminals.map((terminal) => (
          <TerminalPane
            active={terminal.id === activeId}
            key={terminal.id}
            onMount={mountTerminal}
            terminalId={terminal.id}
          />
        ))}
        {!sessionTerminals.length && !loading ? (
          <div className="interactive-terminal__empty">
            <Power aria-hidden="true" size={18} />
            <span>{en ? "No active terminal" : "没有运行中的终端"}</span>
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => void createTerminal()}
            >
              <Plus aria-hidden="true" size={14} />
              {en ? "Open terminal" : "打开终端"}
            </button>
          </div>
        ) : null}
      </div>

      {activeTerminal ? (
        <footer className="interactive-terminal__footer">
          <span
            className="interactive-terminal__status-dot"
            data-status={activeTerminal.status}
            aria-hidden="true"
          />
          <span className="interactive-terminal__status-label">
            {statusLabel(activeTerminal.status, en)}
          </span>
          <span className="interactive-terminal__footer-separator" aria-hidden="true">
            /
          </span>
          <code title={activeTerminal.cwd}>{activeTerminal.cwd}</code>
          {activeTerminal.status === "exited" ? (
            <span className="interactive-terminal__exit-code">
              {en ? "exit" : "退出码"} {activeTerminal.exitCode ?? "?"}
            </span>
          ) : null}
          <span className="interactive-terminal__dimensions">
            {activeTerminal.cols} x {activeTerminal.rows}
          </span>
        </footer>
      ) : null}
    </section>
  );
}
