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
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExtensionImportResult, ExtensionType, ExtensionView } from "../../../shared/domain";
import { tr } from "../i18n/index";
import { useFloatingPanel } from "../lib/use-floating-panel";

interface ExtensionPickerProps {
  extensions: ExtensionView[];
  selectedIds: string[];
  disabled?: boolean;
  onToggle: (extensionId: string, enabled: boolean) => Promise<void>;
  onImport: () => Promise<ExtensionImportResult | null>;
  onAttachFiles: (files: File[]) => void;
}

const GROUPS: Array<{
  type: ExtensionType;
  label: string;
  icon: typeof BookOpen;
}> = [
  { type: "skill", label: "Skills", icon: BookOpen },
  { type: "plugin", label: "Plugins", icon: Puzzle },
];

export function ExtensionPicker({
  extensions,
  selectedIds,
  disabled = false,
  onToggle,
  onImport,
  onAttachFiles,
}: ExtensionPickerProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<ExtensionType>>(new Set(["skill", "plugin"]));
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
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleExtensions = extensions.filter((extension) => {
    if (!normalizedQuery) {
      return true;
    }
    return `${extension.name} ${extension.description}`
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery);
  });

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

  const toggleGroup = (type: ExtensionType) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const toggleExtension = async (extension: ExtensionView) => {
    if (busyId) {
      return;
    }
    setBusyId(extension.id);
    setError(null);
    try {
      await onToggle(extension.id, !selectedSet.has(extension.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const importLocal = async () => {
    if (importing) {
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
      >
        <Plus aria-hidden="true" size={15} />
        <span>{tr("\u5F15\u7528")}</span>
        {selectedIds.length > 0 ? <code>{selectedIds.length}</code> : null}
      </button>

      {open
        ? createPortal(
            <section
              ref={panelRef}
              className="extension-panel"
              role="dialog"
              aria-label={tr("\u5F15\u7528 Skills \u4E0E Plugins")}
              style={{ ...position, zIndex: 82 }}
            >
              <header className="extension-panel__header">
                <div>
                  <strong>{tr("\u4F1A\u8BDD\u6269\u5C55")}</strong>
                  <small>{tr("\u53EA\u5BF9\u5F53\u524D\u4F1A\u8BDD\u751F\u6548")}</small>
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
                  placeholder={tr("\u641C\u7D22\u5DF2\u5B89\u88C5\u7684 Skills \u4E0E Plugins")}
                  aria-label={tr("\u641C\u7D22\u6269\u5C55")}
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

                {GROUPS.map((group) => {
                  const GroupIcon = group.icon;
                  const items = visibleExtensions.filter(
                    (extension) => extension.type === group.type && extension.enabled,
                  );
                  const isExpanded = Boolean(normalizedQuery) || expanded.has(group.type);
                  return (
                    <section className="extension-group" key={group.type}>
                      <button
                        className="extension-group__toggle"
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => toggleGroup(group.type)}
                      >
                        {isExpanded ? (
                          <ChevronDown aria-hidden="true" size={13} />
                        ) : (
                          <ChevronRight aria-hidden="true" size={13} />
                        )}
                        <GroupIcon aria-hidden="true" size={14} />
                        <span>{tr(group.label)}</span>
                        <code>{items.length}</code>
                      </button>
                      {isExpanded ? (
                        <div className="extension-group__items">
                          {items.length === 0 ? (
                            <p>
                              {normalizedQuery
                                ? tr("\u6CA1\u6709\u5339\u914D\u7684 {0}", [group.label])
                                : tr("\u5C1A\u672A\u6DFB\u52A0\u53EF\u7528\u7684 {0}", [
                                    group.label,
                                  ])}
                            </p>
                          ) : (
                            items.map((extension) => {
                              const selected = selectedSet.has(extension.id);
                              return (
                                <button
                                  className={
                                    selected
                                      ? "extension-item extension-item--selected"
                                      : "extension-item"
                                  }
                                  type="button"
                                  aria-pressed={selected}
                                  key={extension.id}
                                  onClick={() => void toggleExtension(extension)}
                                  disabled={Boolean(busyId)}
                                >
                                  <span className="extension-item__check">
                                    {busyId === extension.id ? (
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
                  onClick={() => void importLocal()}
                  disabled={importing}
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
