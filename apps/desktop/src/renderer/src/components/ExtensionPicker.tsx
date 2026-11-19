import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Paperclip,
  Plus,
  Puzzle,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ExtensionImportResult,
  ExtensionView,
  SessionBuiltinCapabilityView,
} from "../../../shared/domain";
import { MAX_SESSION_BUILTIN_CAPABILITIES } from "../../../shared/session-builtin-capabilities";
import { tr } from "../i18n/index";
import {
  builtinCapabilityMeta,
  builtinCapabilitySourceDetail,
  CAPABILITY_GROUPS,
  capabilityMatchesQuery,
  capabilitySelectionCounts,
} from "../lib/capability-picker";
import { useFloatingPanel } from "../lib/use-floating-panel";

interface ExtensionPickerProps {
  builtinCapabilities: SessionBuiltinCapabilityView[];
  extensions: ExtensionView[];
  selectedIds: string[];
  disabled?: boolean;
  attachmentsOnly?: boolean;
  onToggle: (extensionId: string, enabled: boolean) => Promise<void>;
  onToggleBuiltin: (capabilityId: string, selected: boolean) => Promise<void>;
  onImport: () => Promise<ExtensionImportResult | null>;
  onAttachFiles: (files: File[]) => void;
}

export function ExtensionPicker({
  builtinCapabilities,
  extensions,
  selectedIds,
  disabled = false,
  attachmentsOnly = false,
  onToggle,
  onToggleBuiltin,
  onImport,
  onAttachFiles,
}: ExtensionPickerProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(CAPABILITY_GROUPS.map((group) => group.key)),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useFloatingPanel(open, triggerRef, panelRef, {
    width: 430,
    maxHeight: 560,
    preferAbove: true,
    anchorComposer: true,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedSet = new Set(selectedIds);
  const normalizedQuery = query.trim();
  const visibleExtensions = extensions.filter((extension) =>
    capabilityMatchesQuery(extension, normalizedQuery),
  );
  const visibleBuiltinCapabilities = builtinCapabilities.filter((capability) =>
    capabilityMatchesQuery(capability, normalizedQuery),
  );
  const selectionCounts = capabilitySelectionCounts(builtinCapabilities, selectedIds);
  const builtinLimitReached = selectionCounts.builtin >= MAX_SESSION_BUILTIN_CAPABILITIES;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const toggleOpen = () => {
    if (disabled) {
      return;
    }
    if (!open && triggerRef.current) {
      setError(null);
      setNotice(null);
    }
    setOpen((current) => !current);
  };

  const toggleGroup = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (attachmentsOnly) {
    return (
      <>
        <button
          className="extension-trigger extension-trigger--attachment"
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          title={tr("上传附件")}
          data-testid="chat-attachments"
        >
          <Paperclip aria-hidden="true" size={15} />
          <span>{tr("附件")}</span>
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.pptx"
          disabled={disabled}
          onChange={(event) => {
            onAttachFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
          data-testid="chat-attachment-input"
        />
      </>
    );
  }

  const toggleExtension = async (extension: ExtensionView) => {
    if (busyId) {
      return;
    }
    setBusyId(`installed:${extension.id}`);
    setError(null);
    try {
      await onToggle(extension.id, !selectedSet.has(extension.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const toggleBuiltinCapability = async (capability: SessionBuiltinCapabilityView) => {
    if (busyId) {
      return;
    }
    const busyKey = `builtin:${capability.id}`;
    setBusyId(busyKey);
    setError(null);
    try {
      await onToggleBuiltin(capability.id, !capability.selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const importLocal = async () => {
    if (disabled || importing) {
      return;
    }
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await onImport();
      if (result) {
        const pieces = [tr("\u5DF2\u5BFC\u5165 {0} \u9879", [result.imported.length])];
        if (result.skipped > 0) {
          pieces.push(tr("\u8DF3\u8FC7 {0} \u9879\u91CD\u590D\u5185\u5BB9", [result.skipped]));
        }
        setNotice(pieces.join("，"));
        if (result.warnings.length > 0) {
          setError(result.warnings.join("\n"));
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        className={open ? "extension-trigger extension-trigger--open" : "extension-trigger"}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggleOpen}
        title={tr("\u5F15\u7528 Skills \u4E0E Plugins")}
        aria-label={tr("\u5F15\u7528 Skills \u4E0E Plugins")}
        data-testid="capability-picker-trigger"
      >
        <Plus aria-hidden="true" size={15} />
        <span>{tr("\u5F15\u7528")}</span>
        {selectionCounts.total > 0 ? <code>{selectionCounts.total}</code> : null}
      </button>

      {open
        ? createPortal(
            <section
              ref={panelRef}
              className="extension-panel"
              role="dialog"
              aria-label={tr("\u5F15\u7528 Skills \u4E0E Plugins")}
              data-testid="capability-picker-panel"
              style={{ ...position, zIndex: 82 }}
            >
              <header className="extension-panel__header">
                <div>
                  <strong>{tr("\u672C\u5730\u4E0E\u5185\u7F6E\u80FD\u529B")}</strong>
                  <small>{tr("勾选项优先，其他启用项可自动发现")}</small>
                </div>
                <button
                  className="icon-button icon-button--small"
                  type="button"
                  aria-label={tr("\u5173\u95ED")}
                  onClick={() => setOpen(false)}
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </header>

              <label className="extension-panel__search">
                <Search aria-hidden="true" size={14} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={tr(
                    "\u641C\u7D22\u5185\u7F6E\u548C\u5DF2\u5B89\u88C5\u7684 Skills \u4E0E Plugins",
                  )}
                  aria-label={tr("\u641C\u7D22\u672C\u5730\u4E0E\u5185\u7F6E\u80FD\u529B")}
                  data-testid="capability-picker-search"
                />
              </label>

              <div className="extension-panel__body">
                <button
                  className="extension-attachment-action"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                >
                  <span>
                    <Paperclip aria-hidden="true" size={15} />
                  </span>
                  <span>
                    <strong>{tr("\u4E0A\u4F20\u9644\u4EF6")}</strong>
                    <small>
                      {tr(
                        "\u56FE\u7247\u3001\u97F3\u9891\u3001\u89C6\u9891\u3001\u6587\u6863\u6216\u4EE3\u7801\u6587\u4EF6\uFF0C\u5355\u6587\u4EF6\u4E0D\u8D85\u8FC7 25 MiB",
                      )}
                    </small>
                  </span>
                  <Plus aria-hidden="true" size={14} />
                </button>
                <input
                  ref={fileInputRef}
                  className="visually-hidden"
                  type="file"
                  multiple
                  disabled={disabled}
                  onChange={(event) => {
                    onAttachFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                    setOpen(false);
                  }}
                />

                {CAPABILITY_GROUPS.map((group) => {
                  const builtinItems =
                    group.source === "builtin"
                      ? visibleBuiltinCapabilities
                          .filter((capability) => capability.type === group.type)
                          .sort(
                            (left, right) =>
                              Number(right.selected) - Number(left.selected) ||
                              left.name.localeCompare(right.name, "zh-CN"),
                          )
                      : [];
                  const installedItems =
                    group.source === "installed"
                      ? visibleExtensions
                          .filter((extension) => extension.type === group.type && extension.enabled)
                          .sort(
                            (left, right) =>
                              Number(selectedSet.has(right.id)) -
                                Number(selectedSet.has(left.id)) ||
                              left.name.localeCompare(right.name, "zh-CN"),
                          )
                      : [];
                  const itemCount =
                    group.source === "builtin" ? builtinItems.length : installedItems.length;
                  const selectedCount =
                    group.source === "builtin"
                      ? builtinItems.filter((capability) => capability.selected).length
                      : installedItems.filter((extension) => selectedSet.has(extension.id)).length;
                  const isExpanded = Boolean(normalizedQuery) || expanded.has(group.key);
                  const GroupIcon =
                    group.type === "plugin"
                      ? Puzzle
                      : group.source === "builtin"
                        ? Sparkles
                        : BookOpen;
                  return (
                    <section
                      className="extension-group"
                      data-testid={`capability-group-${group.key}`}
                      key={group.key}
                    >
                      <button
                        className="extension-group__toggle"
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => toggleGroup(group.key)}
                      >
                        {isExpanded ? (
                          <ChevronDown aria-hidden="true" size={13} />
                        ) : (
                          <ChevronRight aria-hidden="true" size={13} />
                        )}
                        <GroupIcon aria-hidden="true" size={14} />
                        <span>{tr(group.label)}</span>
                        <code>
                          {selectedCount}/{itemCount}
                        </code>
                      </button>
                      {isExpanded ? (
                        <div className="extension-group__items">
                          {itemCount === 0 ? (
                            <p>
                              {normalizedQuery
                                ? tr("\u6CA1\u6709\u5339\u914D\u7684 {0}", [tr(group.label)])
                                : group.source === "builtin"
                                  ? tr(
                                      "\u5F53\u524D\u6A21\u5F0F\u6CA1\u6709\u53EF\u7528\u7684 {0}",
                                      [tr(group.label)],
                                    )
                                  : tr("\u5C1A\u672A\u6DFB\u52A0\u53EF\u7528\u7684 {0}", [
                                      tr(group.label),
                                    ])}
                            </p>
                          ) : group.source === "builtin" ? (
                            builtinItems.map((capability) => {
                              const selected = capability.selected;
                              const busyKey = `builtin:${capability.id}`;
                              const meta = builtinCapabilityMeta(capability);
                              const sourceDetail = builtinCapabilitySourceDetail(capability);
                              const sourceTitle = [
                                capability.sourcePath
                                  ? `${tr("来源路径")}：${capability.sourcePath}`
                                  : null,
                                capability.sourceSha256
                                  ? `SHA-256：${capability.sourceSha256}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join("\n");
                              return (
                                <button
                                  className={
                                    selected
                                      ? "extension-item extension-item--builtin extension-item--selected"
                                      : "extension-item extension-item--builtin"
                                  }
                                  type="button"
                                  aria-pressed={selected}
                                  data-testid="builtin-capability-item"
                                  data-capability-id={capability.id}
                                  data-capability-type={capability.type}
                                  key={capability.id}
                                  title={[
                                    capability.name,
                                    capability.description,
                                    meta,
                                    sourceTitle,
                                    !selected && builtinLimitReached
                                      ? tr(
                                          "\u6700\u591A\u5F15\u7528 {0} \u4E2A\u5185\u7F6E\u80FD\u529B",
                                          [MAX_SESSION_BUILTIN_CAPABILITIES],
                                        )
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                  onClick={() => void toggleBuiltinCapability(capability)}
                                  disabled={
                                    disabled ||
                                    Boolean(busyId) ||
                                    (!selected && builtinLimitReached)
                                  }
                                >
                                  <span className="extension-item__check">
                                    {busyId === busyKey ? (
                                      <LoaderCircle className="spin" aria-hidden="true" size={13} />
                                    ) : selected ? (
                                      <Check aria-hidden="true" size={13} />
                                    ) : null}
                                  </span>
                                  <span className="extension-item__copy">
                                    <strong>{capability.name}</strong>
                                    <small>{capability.description}</small>
                                    {sourceDetail ? (
                                      <span className="extension-item__source" title={sourceTitle}>
                                        {sourceDetail}
                                      </span>
                                    ) : null}
                                  </span>
                                  {meta ? <code>{meta}</code> : null}
                                </button>
                              );
                            })
                          ) : (
                            installedItems.map((extension) => {
                              const selected = selectedSet.has(extension.id);
                              const busyKey = `installed:${extension.id}`;
                              return (
                                <button
                                  className={
                                    selected
                                      ? "extension-item extension-item--selected"
                                      : "extension-item"
                                  }
                                  type="button"
                                  aria-pressed={selected}
                                  data-testid="installed-capability-item"
                                  data-capability-id={extension.id}
                                  data-capability-type={extension.type}
                                  key={extension.id}
                                  onClick={() => void toggleExtension(extension)}
                                  disabled={disabled || Boolean(busyId)}
                                >
                                  <span className="extension-item__check">
                                    {busyId === busyKey ? (
                                      <LoaderCircle className="spin" aria-hidden="true" size={13} />
                                    ) : selected ? (
                                      <Check aria-hidden="true" size={13} />
                                    ) : null}
                                  </span>
                                  <span className="extension-item__copy">
                                    <strong>{extension.name}</strong>
                                    <small>
                                      {extension.description ||
                                        tr("{0} \u4E2A\u6280\u80FD\u5165\u53E3", [
                                          extension.skillCount,
                                        ])}
                                    </small>
                                  </span>
                                  {extension.mcpServerCount > 0 ? (
                                    <code>MCP {extension.mcpServerCount}</code>
                                  ) : null}
                                </button>
                              );
                            })
                          )}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>

              {notice ? <p className="extension-panel__notice">{notice}</p> : null}
              {error ? <p className="extension-panel__error">{error}</p> : null}

              <footer className="extension-panel__footer">
                <button
                  className="btn btn--secondary"
                  type="button"
                  data-testid="capability-import"
                  onClick={() => void importLocal()}
                  disabled={disabled || importing}
                >
                  {importing ? (
                    <LoaderCircle className="spin" aria-hidden="true" size={14} />
                  ) : (
                    <Upload aria-hidden="true" size={14} />
                  )}
                  {tr("\u5BFC\u5165\u672C\u5730\u76EE\u5F55")}
                </button>
              </footer>
            </section>,
            document.body,
          )
        : null}
    </>
  );
}
