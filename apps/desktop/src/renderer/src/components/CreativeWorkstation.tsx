import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Search,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildCreativeTemplatePrompt,
  CREATIVE_TEMPLATE_CATEGORIES,
  CREATIVE_TEMPLATES,
  type CreativeDraftSection,
  type CreativeTemplate,
  type CreativeTemplateCategory,
  type CreativeTemplateFormat,
  type CreativeWorkspaceDraft,
  createCreativeDraft,
  creativeCategoryLabel,
  creativeSkillsForDraft,
  findCreativeTemplate,
  parseCreativeDeliverableFormat,
  parseCreativeWorkspaceDraft,
} from "../../../shared/creative-templates";
import { useLocale } from "../i18n";
import { openCreativeDraftStorage } from "../lib/creative-draft-persistence";
import { indexCreativeTemplates, searchCreativeTemplates } from "../lib/creative-template-search";
import { CopyButton } from "./CopyButton";
import { useDialog } from "./DialogProvider";
import "../creative-workstation.css";

export interface CreativeWorkstationProps {
  onUseTemplate(prompt: string): Promise<void> | void;
  workspacePath: string | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type CategoryFilter = CreativeTemplateCategory | "all";
type FormatFilter = CreativeTemplateFormat | "all";
type DraftTextField =
  | "title"
  | "subject"
  | "audience"
  | "purpose"
  | "sourceMaterials"
  | "deliverable"
  | "style"
  | "constraints";

interface HistoryMarker {
  group: string;
  at: number;
}

const STORAGE_PREFIX = "mingshen.creative-workspace-draft.v1";
const TEMPLATE_PAGE_SIZE = 72;
const HISTORY_LIMIT = 100;
const HISTORY_GROUP_WINDOW = 700;
const FIRST_TEMPLATE = CREATIVE_TEMPLATES[0] ?? null;

function cloneDraft(draft: CreativeWorkspaceDraft): CreativeWorkspaceDraft {
  return {
    ...draft,
    sections: draft.sections.map((section) => ({ ...section })),
  };
}

function storageKeyForWorkspace(workspacePath: string | null): string {
  const workspace = workspacePath?.trim().replaceAll("\\", "/").toLocaleLowerCase();
  return `${STORAGE_PREFIX}:${workspace || "__no-workspace__"}`;
}

function sectionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `section-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeFileStem(title: string): string {
  const value = title
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 60);
  return value || "creative-workspace";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function DraftField({
  label,
  value,
  onChange,
  maxLength,
  multiline = false,
  rows = 3,
  wide = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  multiline?: boolean;
  rows?: number;
  wide?: boolean;
  placeholder?: string;
}) {
  const fieldId = useId();
  return (
    <label className={`creative-field${wide ? " creative-field--wide" : ""}`} htmlFor={fieldId}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          id={fieldId}
          value={value}
          maxLength={maxLength}
          rows={rows}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={fieldId}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function PreviewList({
  icon,
  title,
  items,
}: {
  icon: ReactNode;
  title: string;
  items: readonly string[];
}) {
  return (
    <section className="creative-preview__group">
      <h3>
        {icon}
        {title}
      </h3>
      <ol>
        {items.map((item, index) => (
          <li key={item}>
            <span aria-hidden="true">{index + 1}</span>
            <p>{item}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CreativeWorkstation({ onUseTemplate, workspacePath }: CreativeWorkstationProps) {
  const locale = useLocale();
  const { confirm } = useDialog();
  const en = locale === "en";
  const tx = useCallback((zh: string, english: string) => (en ? english : zh), [en]);
  const initialCompact =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 1080px)").matches;
  const [compact, setCompact] = useState(initialCompact);
  const [libraryOpen, setLibraryOpen] = useState(!initialCompact);
  const [previewOpen, setPreviewOpen] = useState(!initialCompact);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [format, setFormat] = useState<FormatFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(TEMPLATE_PAGE_SIZE);
  const [storedDraft, setDraft] = useState<CreativeWorkspaceDraft | null>(null);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [blockedStorage, setBlockedStorage] = useState<"invalid" | "unreadable" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<CreativeWorkspaceDraft | null>(null);
  const persistenceRef = useRef<{
    key: string;
    writable: boolean;
    autosave: ReturnType<typeof openCreativeDraftStorage>["autosave"];
  } | null>(null);
  const flushErrorRef = useRef<string | null>(null);
  const undoRef = useRef<CreativeWorkspaceDraft[]>([]);
  const redoRef = useRef<CreativeWorkspaceDraft[]>([]);
  const historyMarkerRef = useRef<HistoryMarker | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const localeRef = useRef(locale);
  const txRef = useRef(tx);
  localeRef.current = locale;
  txRef.current = tx;

  const storageKey = useMemo(() => storageKeyForWorkspace(workspacePath), [workspacePath]);
  const draft = loadedStorageKey === storageKey ? storedDraft : null;
  const templateId = draft?.templateId;
  const activeTemplate = useMemo(
    () => (templateId ? findCreativeTemplate(templateId) : null),
    [templateId],
  );
  const categoryCounts = useMemo(() => {
    const counts = new Map<CreativeTemplateCategory, number>();
    for (const template of CREATIVE_TEMPLATES) {
      counts.set(template.category, (counts.get(template.category) ?? 0) + 1);
    }
    return counts;
  }, []);
  const formatCounts = useMemo(() => {
    const counts = new Map<CreativeTemplateFormat, number>();
    for (const template of CREATIVE_TEMPLATES) {
      counts.set(template.format, (counts.get(template.format) ?? 0) + 1);
    }
    return counts;
  }, []);
  const templateSearchIndex = useMemo(
    () => indexCreativeTemplates(CREATIVE_TEMPLATES, locale),
    [locale],
  );
  const filteredTemplates = useMemo(() => {
    return searchCreativeTemplates(templateSearchIndex, search, category, format, locale);
  }, [category, format, locale, search, templateSearchIndex]);
  const visibleTemplates = filteredTemplates.slice(0, visibleLimit);
  const prompt = useMemo(
    () =>
      activeTemplate && draft
        ? buildCreativeTemplatePrompt(activeTemplate, draft, locale, workspacePath)
        : "",
    [activeTemplate, draft, locale, workspacePath],
  );
  const promptCharacterCount = useMemo(() => Array.from(prompt).length, [prompt]);
  const promptMode = draft?.promptMode ?? "brief";
  const chosenFormat = draft?.deliverable.trim() ?? "";
  const parsedFormat = parseCreativeDeliverableFormat(chosenFormat);
  const formatChanged = Boolean(
    chosenFormat && activeTemplate && parsedFormat !== activeTemplate.format,
  );
  const knownFormat = parsedFormat !== null;
  const recommendedSkills = useMemo(
    () => (activeTemplate && draft ? creativeSkillsForDraft(activeTemplate, draft) : []),
    [activeTemplate, draft],
  );

  const showNotice = useCallback((message: string) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 2_400);
  }, []);
  const showNoticeRef = useRef(showNotice);
  showNoticeRef.current = showNotice;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1080px)");
    const sync = () => {
      setCompact(query.matches);
      setLibraryOpen(!query.matches);
      setPreviewOpen(!query.matches);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useLayoutEffect(() => {
    setLoadedStorageKey(null);
    undoRef.current = [];
    redoRef.current = [];
    historyMarkerRef.current = null;
    setError(flushErrorRef.current);
    flushErrorRef.current = null;
    setNotice(null);

    const getStorage = () => window.localStorage;
    const {
      load: loaded,
      recovered,
      autosave,
    } = openCreativeDraftStorage(getStorage, storageKey, (result) => {
      if (result.status === "saved") {
        setSaveState("saved");
      } else {
        setSaveState("error");
        setError(
          txRef.current(
            `自动保存失败：${errorText(result.error)}。未保存草稿暂存于本次运行中；刷新或退出前请重试或导出。`,
            `Autosave failed: ${errorText(result.error)}. The unsaved draft is held in this running app; retry or export it before reloading or quitting.`,
          ),
        );
      }
    });
    const writable = loaded.status !== "blocked";
    const active = { key: storageKey, writable, autosave };
    persistenceRef.current = active;
    setBlockedStorage(loaded.status === "blocked" ? loaded.reason : null);
    setSaveState(writable && !recovered ? "idle" : "error");
    if (recovered) {
      setError(
        txRef.current(
          `已恢复未保存的草稿：${errorText(recovered.error)}。草稿暂存于本次运行中；刷新或退出前请重试或导出。`,
          `Recovered an unsaved draft: ${errorText(recovered.error)}. It is held in this running app; retry or export it before reloading or quitting.`,
        ),
      );
    }
    const next =
      recovered?.draft ??
      (loaded.status === "restored"
        ? loaded.draft
        : FIRST_TEMPLATE
          ? createCreativeDraft(FIRST_TEMPLATE, localeRef.current)
          : null);
    draftRef.current = next;
    setDraft(next);
    setLoadedStorageKey(storageKey);
    if (!recovered && loaded.status === "restored")
      showNoticeRef.current(txRef.current("已恢复自动保存的草稿", "Restored the autosaved draft"));
    const flushBeforeUnload = () => {
      const result = autosave.flush();
      if (result?.status === "error") {
        setSaveState("error");
        setError(
          txRef.current(
            `自动保存失败：${errorText(result.error)}。未保存草稿暂存于本次运行中；刷新或退出前请重试或导出。`,
            `Autosave failed: ${errorText(result.error)}. The unsaved draft is held in this running app; retry or export it before reloading or quitting.`,
          ),
        );
      }
    };
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);
      const result = autosave.flush();
      if (result?.status === "error") {
        flushErrorRef.current = txRef.current(
          `离开上一工作区时保存草稿失败：${errorText(result.error)}。请在刷新或退出前返回该工作区重试或导出。`,
          `Could not save the previous workspace draft: ${errorText(result.error)}. Return to that workspace and retry or export before reloading or quitting.`,
        );
      }
      if (persistenceRef.current === active) persistenceRef.current = null;
    };
  }, [storageKey]);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  const applyDraft = (next: CreativeWorkspaceDraft) => {
    const active = persistenceRef.current;
    if (!active || active.key !== storageKey) return;
    draftRef.current = next;
    setDraft(next);
    active.autosave.schedule(next);
    if (active.writable) setSaveState("saving");
  };

  const retrySave = () => {
    const active = persistenceRef.current;
    if (!active || active.key !== storageKey) return;
    const result = active.autosave.flush();
    if (result?.status === "saved") {
      setSaveState("saved");
      setError(null);
      showNotice(tx("草稿已保存", "Draft saved"));
    } else if (result?.status === "error") {
      setSaveState("error");
      setError(
        tx(
          `自动保存失败：${errorText(result.error)}。未保存草稿暂存于本次运行中；刷新或退出前请重试或导出。`,
          `Autosave failed: ${errorText(result.error)}. The unsaved draft is held in this running app; retry or export it before reloading or quitting.`,
        ),
      );
    }
  };

  const commitDraft = (
    update: (current: CreativeWorkspaceDraft) => CreativeWorkspaceDraft,
    group: string,
  ) => {
    const current = draftRef.current;
    if (!current || persistenceRef.current?.key !== storageKey) return;
    const next = update(current);
    if (next === current) return;
    const now = Date.now();
    const marker = historyMarkerRef.current;
    if (!marker || marker.group !== group || now - marker.at > HISTORY_GROUP_WINDOW) {
      undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), cloneDraft(current)];
    }
    redoRef.current = [];
    historyMarkerRef.current = { group, at: now };
    const stamped = { ...next, updatedAt: new Date(now).toISOString() };
    applyDraft(stamped);
    setError(null);
    setNotice(null);
  };

  const undo = () => {
    const current = draftRef.current;
    const previous = undoRef.current.pop();
    if (!current || !previous) return;
    redoRef.current.push(cloneDraft(current));
    historyMarkerRef.current = null;
    applyDraft(previous);
    setError(null);
  };

  const redo = () => {
    const current = draftRef.current;
    const next = redoRef.current.pop();
    if (!current || !next) return;
    undoRef.current.push(cloneDraft(current));
    historyMarkerRef.current = null;
    applyDraft(next);
    setError(null);
  };

  const confirmReplacement = async (kind: "template" | "import") => {
    const active = persistenceRef.current;
    const before = draftRef.current;
    if (!active || active.key !== storageKey || !before) return false;
    const accepted = await confirm({
      title: tx("替换当前草稿？", "Replace the current draft?"),
      description:
        kind === "template"
          ? tx(
              "应用模板会替换当前草稿的内容。你可以先导出草稿，也可以在替换后撤销。",
              "Applying a template replaces the current draft. Export it first, or undo the replacement afterward.",
            )
          : tx(
              "导入会替换当前草稿的内容。你可以先导出草稿，也可以在替换后撤销。",
              "Importing replaces the current draft. Export it first, or undo the replacement afterward.",
            ),
      confirmLabel: tx("替换草稿", "Replace draft"),
    });
    return accepted && persistenceRef.current === active && draftRef.current === before;
  };

  const selectTemplate = async (template: CreativeTemplate) => {
    if (!(await confirmReplacement("template"))) return;
    const next = createCreativeDraft(template, locale);
    commitDraft(() => next, `template:${template.id}`);
    if (compact) setLibraryOpen(false);
  };

  const updateField = (field: DraftTextField, value: string) => {
    commitDraft((current) => ({ ...current, [field]: value }), `field:${field}`);
  };

  const updatePromptMode = (mode: "brief" | "detailed") => {
    commitDraft(
      (current) =>
        (current.promptMode ?? "brief") === mode ? current : { ...current, promptMode: mode },
      `prompt-mode:${mode}`,
    );
  };

  const updateSection = (
    id: string,
    patch: Partial<Pick<CreativeDraftSection, "title" | "notes">>,
    field: "title" | "notes",
  ) => {
    commitDraft(
      (current) => ({
        ...current,
        sections: current.sections.map((section) =>
          section.id === id ? { ...section, ...patch } : section,
        ),
      }),
      `section:${field}:${id}`,
    );
  };

  const addSection = () => {
    commitDraft(
      (current) =>
        current.sections.length >= 30
          ? current
          : {
              ...current,
              sections: [
                ...current.sections,
                {
                  id: sectionId(),
                  title: tx("新章节", "New section"),
                  notes: "",
                },
              ],
            },
      "section:add",
    );
  };

  const removeSection = (id: string) => {
    commitDraft(
      (current) =>
        current.sections.length <= 1
          ? current
          : {
              ...current,
              sections: current.sections.filter((section) => section.id !== id),
            },
      `section:remove:${id}`,
    );
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const current = draftRef.current;
    const section = current?.sections[index];
    if (!current || !section) return;
    const target = index + direction;
    if (target < 0 || target >= current.sections.length) return;
    commitDraft((value) => {
      const sections = [...value.sections];
      const moved = sections[index];
      const displaced = sections[target];
      if (!moved || !displaced) return value;
      sections[index] = displaced;
      sections[target] = moved;
      return { ...value, sections };
    }, `section:move:${section.id}`);
  };

  const importDraft = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const active = persistenceRef.current;
    if (!active || active.key !== storageKey) return;
    setError(null);
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error(tx("导入文件不能超过 5 MiB。", "The import file must not exceed 5 MiB."));
      }
      const parsed = parseCreativeWorkspaceDraft(JSON.parse(await file.text()) as unknown);
      if (!parsed) {
        throw new Error(
          tx(
            "草稿 JSON 未通过校验。请确认模板仍存在且字段长度符合限制。",
            "The draft JSON failed validation. Check the template and field limits.",
          ),
        );
      }
      if (persistenceRef.current !== active || !(await confirmReplacement("import"))) return;
      commitDraft(() => parsed, "json:import");
      if (compact) setLibraryOpen(false);
      showNotice(tx("草稿已导入并通过校验", "Draft imported and validated"));
    } catch (cause) {
      if (persistenceRef.current === active)
        setError(tx(`导入失败：${errorText(cause)}`, `Import failed: ${errorText(cause)}`));
    }
  };

  const exportDraft = () => {
    if (!draft) return;
    try {
      const blob = new Blob([JSON.stringify(draft, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileStem(draft.title)}.creative-draft.json`;
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showNotice(tx("草稿 JSON 已导出", "Draft JSON exported"));
    } catch (cause) {
      setError(tx(`导出失败：${errorText(cause)}`, `Export failed: ${errorText(cause)}`));
    }
  };

  const submitToWorkAgent = async () => {
    if (!draft || !activeTemplate || submitting) return;
    if (draft.sections.some((section) => !section.title.trim())) {
      setError(tx("章节标题不能为空。", "Section titles cannot be empty."));
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await onUseTemplate(prompt);
      showNotice(
        tx(
          "提示词已加入 WorkAgent 输入框，尚未发送。",
          "The prompt was added to the WorkAgent composer and was not sent.",
        ),
      );
    } catch (cause) {
      setError(
        tx(
          `无法交给 WorkAgent：${errorText(cause)}`,
          `Could not hand off to WorkAgent: ${errorText(cause)}`,
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLibrary = () => {
    const next = !libraryOpen;
    setLibraryOpen(next);
    if (next && compact) setPreviewOpen(false);
  };

  const togglePreview = () => {
    const next = !previewOpen;
    setPreviewOpen(next);
    if (next && compact) setLibraryOpen(false);
  };

  const saveLabel =
    blockedStorage && loadedStorageKey === storageKey
      ? tx("自动保存已暂停", "Autosave paused")
      : saveState === "saving"
        ? tx("保存中", "Saving")
        : saveState === "saved"
          ? tx("已保存", "Saved")
          : saveState === "error"
            ? tx("保存失败", "Save failed")
            : tx("本地草稿", "Local draft");

  return (
    <section
      className="creative-workstation"
      data-testid="creative-workstation"
      data-compact={compact}
      data-library-open={libraryOpen}
      data-preview-open={previewOpen}
      aria-label={tx("Mingshen 创作工作站", "Mingshen creative workstation")}
    >
      <header className="creative-workstation__header">
        <div className="creative-workstation__identity">
          <span className="creative-workstation__mark" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <span>
            <strong>{tx("创作工作站", "Creative workstation")}</strong>
            <small>
              {tx(
                `${CREATIVE_TEMPLATES.length} 个模板 · 本地草稿`,
                `${CREATIVE_TEMPLATES.length} templates · local draft`,
              )}
            </small>
          </span>
        </div>
        <div className="creative-workstation__actions">
          <button
            className="creative-icon-button"
            type="button"
            data-testid="creative-library-toggle"
            aria-label={tx("显示或收起模板目录", "Show or hide template library")}
            title={tx("模板目录", "Template library")}
            aria-pressed={libraryOpen}
            onClick={toggleLibrary}
          >
            <PanelLeft aria-hidden="true" size={15} />
          </button>
          <button
            className="creative-icon-button"
            type="button"
            data-testid="creative-preview-toggle"
            aria-label={tx("显示或收起模板预览", "Show or hide template preview")}
            title={tx("模板预览", "Template preview")}
            aria-pressed={previewOpen}
            onClick={togglePreview}
          >
            <PanelRight aria-hidden="true" size={15} />
          </button>
          <span className="creative-workstation__divider" aria-hidden="true" />
          <button
            className="creative-icon-button"
            type="button"
            aria-label={tx("撤销", "Undo")}
            title={tx("撤销", "Undo")}
            disabled={!undoRef.current.length}
            onClick={undo}
          >
            <Undo2 aria-hidden="true" size={15} />
          </button>
          <button
            className="creative-icon-button"
            type="button"
            aria-label={tx("重做", "Redo")}
            title={tx("重做", "Redo")}
            disabled={!redoRef.current.length}
            onClick={redo}
          >
            <Redo2 aria-hidden="true" size={15} />
          </button>
          <button
            className="creative-button creative-button--quiet"
            type="button"
            data-testid="creative-import"
            aria-label={tx("导入草稿 JSON", "Import draft JSON")}
            title={tx("导入草稿 JSON", "Import draft JSON")}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden="true" size={14} />
            <span className="creative-button__label">{tx("导入", "Import")}</span>
          </button>
          <button
            className="creative-button creative-button--quiet"
            type="button"
            data-testid="creative-export"
            aria-label={tx("导出草稿 JSON", "Export draft JSON")}
            title={tx("导出草稿 JSON", "Export draft JSON")}
            disabled={!draft}
            onClick={exportDraft}
          >
            <Download aria-hidden="true" size={14} />
            <span className="creative-button__label">{tx("导出", "Export")}</span>
          </button>
          <input
            ref={fileInputRef}
            className="creative-file-input"
            type="file"
            accept="application/json,.json"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void importDraft(event)}
          />
        </div>
      </header>

      <div className="creative-workstation__status" aria-live="polite">
        <span
          className={`creative-save-state creative-save-state--${saveState}`}
          data-testid="creative-save-state"
        >
          <i aria-hidden="true" />
          {saveLabel}
        </span>
        {saveState === "error" && !blockedStorage && draft ? (
          <button
            className="creative-button creative-button--quiet"
            type="button"
            data-testid="creative-save-retry"
            onClick={retrySave}
          >
            {tx("重试保存", "Retry save")}
          </button>
        ) : null}
        {notice ? <span className="creative-workstation__notice">{notice}</span> : null}
      </div>

      {blockedStorage && loadedStorageKey === storageKey ? (
        <div
          className="creative-workstation__error"
          role="alert"
          data-testid="creative-storage-blocked"
        >
          <span>
            {blockedStorage === "invalid"
              ? tx("本地草稿格式无效。", "The local draft is invalid.")
              : tx("无法读取本地草稿。", "The local draft could not be read.")}{" "}
            {tx(
              "原始数据未被覆盖，自动保存已暂停。更改尚未保存，请在离开前导出草稿。",
              "The original data was not overwritten and autosave is paused. Changes are unsaved; export the draft before leaving.",
            )}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="creative-workstation__error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label={tx("关闭错误", "Dismiss error")}
            title={tx("关闭", "Dismiss")}
            onClick={() => setError(null)}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}

      <div className="creative-workstation__body">
        {compact && (libraryOpen || previewOpen) ? (
          <button
            className="creative-workstation__scrim"
            type="button"
            aria-label={tx("关闭侧栏", "Close side panel")}
            onClick={() => {
              setLibraryOpen(false);
              setPreviewOpen(false);
            }}
          />
        ) : null}

        <aside
          className="creative-library"
          data-open={libraryOpen}
          aria-label={tx("模板目录", "Template library")}
        >
          <div className="creative-panel__heading">
            <span>
              <FileText aria-hidden="true" size={15} />
              <strong>{tx("模板目录", "Template library")}</strong>
            </span>
            <button
              className="creative-icon-button"
              type="button"
              aria-label={tx("收起模板目录", "Collapse template library")}
              title={tx("收起", "Collapse")}
              onClick={() => setLibraryOpen(false)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
          <div className="creative-library__filters">
            <label className="creative-search">
              <Search aria-hidden="true" size={14} />
              <span className="creative-visually-hidden">{tx("搜索模板", "Search templates")}</span>
              <input
                type="search"
                data-testid="creative-search"
                value={search}
                placeholder={tx("搜索名称、用途、技能", "Search name, use, or skill")}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setVisibleLimit(TEMPLATE_PAGE_SIZE);
                }}
              />
            </label>
            <label className="creative-category-select">
              <span>{tx("分类", "Category")}</span>
              <select
                data-testid="creative-category"
                value={category}
                aria-label={tx("模板分类", "Template category")}
                onChange={(event) => {
                  setCategory(event.target.value as CategoryFilter);
                  setVisibleLimit(TEMPLATE_PAGE_SIZE);
                }}
              >
                <option value="all">
                  {tx("全部模板", "All templates")} ({CREATIVE_TEMPLATES.length})
                </option>
                {CREATIVE_TEMPLATE_CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {creativeCategoryLabel(item.id, locale)} ({categoryCounts.get(item.id) ?? 0})
                  </option>
                ))}
              </select>
            </label>
            <label className="creative-category-select">
              <span>{tx("格式", "Format")}</span>
              <select
                data-testid="creative-format-filter"
                value={format}
                aria-label={tx("模板格式", "Template format")}
                onChange={(event) => {
                  setFormat(event.target.value as FormatFilter);
                  setVisibleLimit(TEMPLATE_PAGE_SIZE);
                }}
              >
                <option value="all">{tx("全部格式", "All formats")}</option>
                {[...formatCounts].map(([item, count]) => (
                  <option key={item} value={item}>
                    {item} ({count})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="creative-library__result-count">
            <span>
              {tx(
                `找到 ${filteredTemplates.length} 个模板`,
                `${filteredTemplates.length} templates found`,
              )}
            </span>
            {filteredTemplates.length > visibleTemplates.length ? (
              <small>
                {tx(`显示 ${visibleTemplates.length}`, `Showing ${visibleTemplates.length}`)}
              </small>
            ) : null}
          </div>
          <div className="creative-library__list" data-testid="creative-template-list">
            {visibleTemplates.map((template) => {
              const selected = template.id === draft?.templateId;
              return (
                <button
                  key={template.id}
                  type="button"
                  className="creative-template"
                  data-testid="creative-template-item"
                  data-template-id={template.id}
                  aria-pressed={selected}
                  onClick={() => void selectTemplate(template)}
                >
                  <span className="creative-template__top">
                    <strong>{en ? template.nameEn : template.name}</strong>
                    <b>{template.format}</b>
                  </span>
                  <span className="creative-template__category">
                    {creativeCategoryLabel(template.category, locale)}
                  </span>
                  <span className="creative-template__summary">
                    {en ? template.summaryEn : template.summary}
                  </span>
                  {selected ? (
                    <span className="creative-template__selected">
                      <CheckCircle2 aria-hidden="true" size={12} />
                      {tx("当前模板", "Current")}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {!visibleTemplates.length ? (
              <div className="creative-library__empty">
                <Search aria-hidden="true" size={20} />
                <strong>{tx("没有匹配模板", "No matching templates")}</strong>
                <span>
                  {tx("调整关键词、分类或格式后重试。", "Try another query, category, or format.")}
                </span>
              </div>
            ) : null}
            {filteredTemplates.length > visibleTemplates.length ? (
              <button
                className="creative-library__more"
                type="button"
                onClick={() => setVisibleLimit((value) => value + TEMPLATE_PAGE_SIZE)}
              >
                <Plus aria-hidden="true" size={14} />
                {tx(
                  `再显示 ${Math.min(TEMPLATE_PAGE_SIZE, filteredTemplates.length - visibleTemplates.length)} 个`,
                  `Show ${Math.min(TEMPLATE_PAGE_SIZE, filteredTemplates.length - visibleTemplates.length)} more`,
                )}
              </button>
            ) : null}
          </div>
        </aside>

        <main
          className="creative-editor"
          data-testid="creative-draft-form"
          aria-label={tx("创作草稿编辑器", "Creative draft editor")}
        >
          {draft && activeTemplate ? (
            <>
              <div className="creative-editor__scroll">
                <section className="creative-editor__intro">
                  <div>
                    <span className="creative-kicker">
                      {creativeCategoryLabel(activeTemplate.category, locale)}
                    </span>
                    <h1>{en ? activeTemplate.nameEn : activeTemplate.name}</h1>
                    <p>{en ? activeTemplate.summaryEn : activeTemplate.summary}</p>
                  </div>
                  <span className="creative-format-badge">{activeTemplate.format}</span>
                </section>

                <section
                  className="creative-template-options"
                  aria-labelledby="creative-mode-title"
                >
                  <div className="creative-template-options__heading">
                    <h2 id="creative-mode-title">{tx("模板版本", "Template version")}</h2>
                    <fieldset
                      className="creative-mode-toggle"
                      aria-labelledby="creative-mode-title"
                    >
                      <button
                        type="button"
                        data-testid="creative-mode-brief"
                        aria-pressed={promptMode === "brief"}
                        onClick={() => updatePromptMode("brief")}
                      >
                        {tx("简略", "Brief")}
                      </button>
                      <button
                        type="button"
                        data-testid="creative-mode-detailed"
                        aria-pressed={promptMode === "detailed"}
                        onClick={() => updatePromptMode("detailed")}
                      >
                        {tx("详细", "Detailed")}
                      </button>
                    </fieldset>
                  </div>
                  <p
                    className="creative-template-options__description"
                    data-testid="creative-description"
                  >
                    {promptMode === "detailed"
                      ? en
                        ? activeTemplate.detailedDescriptionEn
                        : activeTemplate.detailedDescription
                      : en
                        ? activeTemplate.summaryEn
                        : activeTemplate.summary}
                  </p>
                  {formatChanged ? (
                    <p
                      className="creative-template-options__format"
                      data-testid="creative-format-status"
                    >
                      {knownFormat
                        ? tx(
                            `模板建议格式：${activeTemplate.format}；当前按所选格式适配。`,
                            `Suggested format: ${activeTemplate.format}; adapting to the selected format.`,
                          )
                        : tx(
                            `模板建议格式：${activeTemplate.format}；当前格式未识别，请确认交付要求。`,
                            `Suggested format: ${activeTemplate.format}; the current format is not recognized. Confirm the deliverable.`,
                          )}
                    </p>
                  ) : null}
                  <details className="creative-prompt" data-testid="creative-prompt-preview">
                    <summary>
                      <span>
                        <ChevronRight aria-hidden="true" size={14} />
                        {tx("完整提示词", "Full prompt")}
                      </span>
                      <span>
                        {tx(`${promptCharacterCount} 字符`, `${promptCharacterCount} characters`)}
                      </span>
                    </summary>
                    <div className="creative-prompt__content">
                      <div className="creative-prompt__actions">
                        <CopyButton
                          className="creative-icon-button"
                          label={tx("复制完整提示词", "Copy full prompt")}
                          text={prompt}
                        />
                      </div>
                      <pre data-testid="creative-prompt-text">{prompt}</pre>
                    </div>
                  </details>
                  {recommendedSkills.length ? (
                    <section className="creative-skills" data-testid="creative-recommended-skills">
                      <h3>
                        <BookOpen aria-hidden="true" size={14} />
                        {tx("推荐技能", "Recommended skills")}
                      </h3>
                      <ul>
                        {recommendedSkills.map((skill) => (
                          <li key={skill.id}>
                            <div>
                              <strong>{en ? skill.nameEn : skill.name}</strong>
                              <code>{skill.id}</code>
                            </div>
                            <p>{en ? skill.reasonEn : skill.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </section>

                <fieldset className="creative-fieldset">
                  <legend>{tx("工作请求", "Work request")}</legend>
                  <div className="creative-field-grid">
                    <DraftField
                      wide
                      label={tx("草稿标题", "Draft title")}
                      value={draft.title}
                      maxLength={200}
                      onChange={(value) => updateField("title", value)}
                    />
                    <DraftField
                      wide
                      label={tx("主题", "Subject")}
                      value={draft.subject}
                      maxLength={2_000}
                      placeholder={tx(
                        "要具体制作什么，核心问题或决定是什么？",
                        "What should be created, and what decision or question is central?",
                      )}
                      onChange={(value) => updateField("subject", value)}
                    />
                    <DraftField
                      label={tx("受众", "Audience")}
                      value={draft.audience}
                      maxLength={1_000}
                      onChange={(value) => updateField("audience", value)}
                    />
                    <DraftField
                      label={tx("交付格式", "Deliverable")}
                      value={draft.deliverable}
                      maxLength={300}
                      onChange={(value) => updateField("deliverable", value)}
                    />
                    <DraftField
                      wide
                      multiline
                      rows={3}
                      label={tx("目的", "Purpose")}
                      value={draft.purpose}
                      maxLength={3_000}
                      onChange={(value) => updateField("purpose", value)}
                    />
                    <DraftField
                      wide
                      multiline
                      rows={4}
                      label={tx("现有资料", "Source materials")}
                      value={draft.sourceMaterials}
                      maxLength={12_000}
                      placeholder={tx(
                        "列出工作区文件、事实来源、数据口径和仍缺少的信息。",
                        "List workspace files, evidence, data definitions, and known gaps.",
                      )}
                      onChange={(value) => updateField("sourceMaterials", value)}
                    />
                    <DraftField
                      label={tx("风格", "Style")}
                      value={draft.style}
                      maxLength={1_000}
                      onChange={(value) => updateField("style", value)}
                    />
                    <DraftField
                      label={tx("约束", "Constraints")}
                      value={draft.constraints}
                      maxLength={3_000}
                      placeholder={tx(
                        "合规、时间、品牌或不可偏离边界",
                        "Compliance, timing, brand, or hard boundaries",
                      )}
                      onChange={(value) => updateField("constraints", value)}
                    />
                  </div>
                </fieldset>

                <section
                  className="creative-sections"
                  data-testid="creative-sections"
                  aria-labelledby="creative-sections-title"
                >
                  <div className="creative-sections__heading">
                    <div>
                      <h2 id="creative-sections-title">{tx("章节与备注", "Sections and notes")}</h2>
                      <p>
                        {tx(
                          `${draft.sections.length} / 30 个章节，可调整顺序和补充制作要求。`,
                          `${draft.sections.length} / 30 sections. Reorder them or add production notes.`,
                        )}
                      </p>
                    </div>
                    <button
                      className="creative-button creative-button--quiet"
                      type="button"
                      disabled={draft.sections.length >= 30}
                      onClick={addSection}
                    >
                      <Plus aria-hidden="true" size={14} />
                      {tx("添加章节", "Add section")}
                    </button>
                  </div>
                  <div className="creative-sections__list">
                    {draft.sections.map((section, index) => (
                      <article className="creative-section" key={section.id}>
                        <div className="creative-section__order" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </div>
                        <div className="creative-section__content">
                          <label>
                            <span>{tx("章节标题", "Section title")}</span>
                            <input
                              value={section.title}
                              maxLength={200}
                              onChange={(event) =>
                                updateSection(section.id, { title: event.target.value }, "title")
                              }
                            />
                          </label>
                          <label>
                            <span>{tx("备注", "Notes")}</span>
                            <textarea
                              value={section.notes}
                              maxLength={8_000}
                              rows={2}
                              placeholder={tx(
                                "本页目标、必须出现的内容、证据或设计限制",
                                "Objective, required content, evidence, or design limits",
                              )}
                              onChange={(event) =>
                                updateSection(section.id, { notes: event.target.value }, "notes")
                              }
                            />
                          </label>
                        </div>
                        <div className="creative-section__actions">
                          <button
                            className="creative-icon-button"
                            type="button"
                            aria-label={tx("上移章节", "Move section up")}
                            title={tx("上移", "Move up")}
                            disabled={index === 0}
                            onClick={() => moveSection(index, -1)}
                          >
                            <ArrowUp aria-hidden="true" size={14} />
                          </button>
                          <button
                            className="creative-icon-button"
                            type="button"
                            aria-label={tx("下移章节", "Move section down")}
                            title={tx("下移", "Move down")}
                            disabled={index === draft.sections.length - 1}
                            onClick={() => moveSection(index, 1)}
                          >
                            <ArrowDown aria-hidden="true" size={14} />
                          </button>
                          <button
                            className="creative-icon-button creative-icon-button--danger"
                            type="button"
                            aria-label={tx("删除章节", "Delete section")}
                            title={tx("删除", "Delete")}
                            disabled={draft.sections.length <= 1}
                            onClick={() => removeSection(section.id)}
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              <footer className="creative-editor__footer">
                <div className="creative-editor__workspace">
                  <span>{tx("工作目录", "Workspace")}</span>
                  <code title={workspacePath ?? undefined}>
                    {workspacePath || tx("由 WorkAgent 选择", "Chosen by WorkAgent")}
                  </code>
                </div>
                <button
                  className="creative-button creative-button--primary creative-submit"
                  type="button"
                  data-testid="creative-submit"
                  disabled={submitting}
                  onClick={() => void submitToWorkAgent()}
                >
                  {submitting ? (
                    <LoaderCircle className="creative-spin" aria-hidden="true" size={15} />
                  ) : (
                    <Send aria-hidden="true" size={15} />
                  )}
                  {submitting
                    ? tx("正在交给 WorkAgent…", "Handing to WorkAgent…")
                    : tx("交给 WorkAgent 执行", "Hand to WorkAgent")}
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
              </footer>
            </>
          ) : (
            <div className="creative-editor__empty">
              <Sparkles aria-hidden="true" size={24} />
              <h2>{tx("没有可用模板", "No templates available")}</h2>
              <p>
                {tx(
                  "请检查共享模板目录是否已正确加载。",
                  "Check that the shared template catalog loaded correctly.",
                )}
              </p>
            </div>
          )}
        </main>

        <aside
          className="creative-preview"
          data-testid="creative-template-preview"
          data-open={previewOpen}
          aria-label={tx("模板预览", "Template preview")}
        >
          <div className="creative-panel__heading">
            <span>
              <Workflow aria-hidden="true" size={15} />
              <strong>{tx("模板预览", "Template preview")}</strong>
            </span>
            <button
              className="creative-icon-button"
              type="button"
              aria-label={tx("收起模板预览", "Collapse template preview")}
              title={tx("收起", "Collapse")}
              onClick={() => setPreviewOpen(false)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
          {activeTemplate ? (
            <div className="creative-preview__scroll">
              <div className="creative-preview__hero">
                <span className="creative-kicker">
                  {creativeCategoryLabel(activeTemplate.category, locale)}
                </span>
                <h2>{en ? activeTemplate.nameEn : activeTemplate.name}</h2>
                <p>{en ? activeTemplate.summaryEn : activeTemplate.summary}</p>
                <dl>
                  <div>
                    <dt>{tx("格式", "Format")}</dt>
                    <dd>{activeTemplate.format}</dd>
                  </div>
                  <div>
                    <dt>{tx("章节", "Sections")}</dt>
                    <dd>{activeTemplate.sections.length}</dd>
                  </div>
                  <div>
                    <dt>{tx("验收项", "Checks")}</dt>
                    <dd>{activeTemplate.acceptance.length}</dd>
                  </div>
                </dl>
              </div>
              <section className="creative-preview__group">
                <h3>
                  <FileText aria-hidden="true" size={14} />
                  {tx("章节结构", "Section structure")}
                </h3>
                <ol>
                  {activeTemplate.sections.map((section, index) => (
                    <li key={section.id}>
                      <span aria-hidden="true">{index + 1}</span>
                      <div>
                        <strong>{en ? section.titleEn : section.title}</strong>
                        <p>{en ? section.intentEn : section.intent}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              <PreviewList
                icon={<CheckCircle2 aria-hidden="true" size={14} />}
                title={tx("验收标准", "Acceptance criteria")}
                items={en ? activeTemplate.acceptanceEn : activeTemplate.acceptance}
              />
              <PreviewList
                icon={<Workflow aria-hidden="true" size={14} />}
                title={tx("工作流", "Workflow")}
                items={en ? activeTemplate.workflowEn : activeTemplate.workflow}
              />
            </div>
          ) : (
            <div className="creative-preview__empty">
              <FileText aria-hidden="true" size={22} />
              <span>{tx("选择模板后查看结构。", "Select a template to inspect it.")}</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
