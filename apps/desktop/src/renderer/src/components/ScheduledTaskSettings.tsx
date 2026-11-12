import { CalendarClock, LoaderCircle, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskView,
  SessionView,
} from "../../../shared/domain";
import { getLocale, tr } from "../i18n/index";
import { useDialog } from "./DialogProvider";

interface ScheduledTaskSettingsProps {
  tasks: ScheduledTaskView[];
  sessions: SessionView[];
  onChanged: () => Promise<void>;
}

function formatDate(value: string | null): string {
  if (!value) {
    return tr("\u5C1A\u672A\u8FD0\u884C");
  }
  return new Intl.DateTimeFormat(getLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ScheduledTaskSettings({ tasks, sessions, onChanged }: ScheduledTaskSettingsProps) {
  const { confirm } = useDialog();
  const availableSessions = sessions.filter((session) => !session.archived);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [sessionId, setSessionId] = useState(availableSessions[0]?.id ?? "");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = tasks.filter(
    (task) => filter === "all" || task.enabled === (filter === "active"),
  );

  const resetForm = () => {
    setName("");
    setPrompt("");
    setSessionId(availableSessions[0]?.id ?? "");
    setIntervalMinutes(60);
    setError(null);
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: ScheduledTaskCreateInput = {
        name,
        prompt,
        sessionId,
        intervalMinutes,
        enabled: true,
      };
      await window.mingshen.createScheduledTask(input);
      await onChanged();
      setCreating(false);
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const setEnabled = async (task: ScheduledTaskView, enabled: boolean) => {
    setBusyId(task.id);
    setError(null);
    try {
      await window.mingshen.setScheduledTaskEnabled(task.id, enabled);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (task: ScheduledTaskView) => {
    setBusyId(task.id);
    setError(null);
    try {
      await window.mingshen.runScheduledTaskNow(task.id);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (task: ScheduledTaskView) => {
    const confirmed = await confirm({
      title: tr("\u5220\u9664\u5B9A\u65F6\u4EFB\u52A1"),
      description: tr(
        "\u5C06\u6C38\u4E45\u5220\u9664\u300C{0}\u300D\u3002\u5DF2\u6709\u4F1A\u8BDD\u548C\u5BF9\u8BDD\u8BB0\u5F55\u4E0D\u4F1A\u53D7\u5230\u5F71\u54CD\u3002",
        [task.name],
      ),
      confirmLabel: tr("\u5220\u9664\u4EFB\u52A1"),
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusyId(task.id);
    setError(null);
    try {
      await window.mingshen.removeScheduledTask(task.id);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="settings-page scheduled-settings">
      <section className="settings-block">
        <div className="settings-block__heading scheduled-settings__heading">
          <div>
            <h3>{tr("\u5B9A\u65F6\u4EFB\u52A1")}</h3>
            <p>
              {tr(
                "\u5230\u8FBE\u65F6\u95F4\u540E\uFF0C\u628A\u9884\u8BBE\u63D0\u793A\u8BCD\u53D1\u9001\u5230\u6307\u5B9A\u4F1A\u8BDD\u3002Mingshen \u8FD0\u884C\u671F\u95F4\u6309\u672C\u5730\u65F6\u95F4\u626B\u63CF\uFF0C\u4EFB\u52A1\u4E0E\u4F1A\u8BDD\u6570\u636E\u90FD\u4FDD\u7559\u5728\u672C\u673A\u3002",
              )}
            </p>
          </div>
          <button
            className={creating ? "btn btn--secondary" : "btn btn--primary"}
            type="button"
            onClick={() => {
              setCreating((current) => !current);
              setError(null);
            }}
          >
            {creating ? <X aria-hidden="true" size={14} /> : <Plus aria-hidden="true" size={14} />}
            {creating ? tr("\u53D6\u6D88") : tr("\u65B0\u5EFA\u4EFB\u52A1")}
          </button>
        </div>

        {creating ? (
          <form className="schedule-form" onSubmit={(event) => void createTask(event)}>
            <div className="schedule-form__grid">
              <label className="field">
                <span>{tr("\u4EFB\u52A1\u540D\u79F0")}</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={tr(
                    "\u4F8B\u5982\uFF1A\u6BCF\u65E5\u68C0\u67E5\u5F85\u5904\u7406\u4E8B\u9879",
                  )}
                  maxLength={120}
                  required
                />
              </label>
              <label className="field">
                <span>{tr("\u95F4\u9694\u5206\u949F")}</span>
                <input
                  type="number"
                  min={1}
                  max={10_080}
                  value={intervalMinutes}
                  onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                  required
                />
              </label>
            </div>
            <label className="field">
              <span>{tr("\u76EE\u6807\u4F1A\u8BDD")}</span>
              <select
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                required
              >
                {availableSessions.map((session) => (
                  <option value={session.id} key={session.id}>
                    {session.title}
                    {session.workspacePath ? ` · ${session.workspacePath}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{tr("\u53D1\u9001\u7ED9\u4F1A\u8BDD\u7684\u63D0\u793A\u8BCD")}</span>
              <textarea
                className="schedule-form__prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={tr(
                  "\u5199\u6E05\u695A\u8981\u68C0\u67E5\u4EC0\u4E48\u3001\u5141\u8BB8\u505A\u4EC0\u4E48\u3001\u505A\u5230\u4EC0\u4E48\u7A0B\u5EA6\u3002",
                )}
                required
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="form-actions">
              <button
                className="btn btn--primary"
                type="submit"
                disabled={saving || !sessionId || !name.trim() || !prompt.trim()}
              >
                {saving ? (
                  <LoaderCircle className="spin" aria-hidden="true" size={14} />
                ) : (
                  <CalendarClock aria-hidden="true" size={14} />
                )}
                {tr("\u521B\u5EFA\u4EFB\u52A1")}
              </button>
            </div>
          </form>
        ) : null}

        {!creating && error ? <p className="form-error">{error}</p> : null}

        {tasks.length === 0 ? (
          <div className="extension-empty">
            <CalendarClock aria-hidden="true" size={22} />
            <strong>{tr("\u8FD8\u6CA1\u6709\u5B9A\u65F6\u4EFB\u52A1")}</strong>
            <p>
              {tr(
                "\u4E3A\u5DF2\u6709\u4F1A\u8BDD\u8BBE\u7F6E\u5468\u671F\u63D0\u793A\u8BCD\uFF0CMingshen \u4F1A\u5728\u8FD0\u884C\u671F\u95F4\u81EA\u52A8\u542F\u52A8\u65B0\u56DE\u5408\u3002",
              )}
            </p>
          </div>
        ) : (
          <div className="schedule-list">
            <label className="field catalog-search">
              <span>{tr("状态")}</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">{tr("全部")}</option>
                <option value="active">{tr("已启用")}</option>
                <option value="paused">{tr("已暂停")}</option>
              </select>
            </label>
            {filtered.length === 0 ? <p className="quiet-copy">{tr("没有匹配的记录")}</p> : null}
            {filtered.map((task) => {
              const session = sessions.find((item) => item.id === task.sessionId);
              return (
                <article
                  className={
                    task.enabled ? "schedule-record" : "schedule-record schedule-record--paused"
                  }
                  key={task.id}
                >
                  <span className="schedule-record__marker" aria-hidden="true" />
                  <div className="schedule-record__body">
                    <div className="schedule-record__title">
                      <button
                        className="schedule-record__select"
                        type="button"
                        aria-expanded={selectedId === task.id}
                        onClick={() => setSelectedId(selectedId === task.id ? null : task.id)}
                      >
                        {task.name}
                      </button>
                      <span>{task.enabled ? tr("已启用") : tr("已暂停")}</span>
                    </div>
                    {selectedId === task.id ? (
                      <p className="schedule-record__prompt">{task.prompt}</p>
                    ) : null}
                    <div className="schedule-record__meta">
                      <span>
                        {tr("\u6BCF")}
                        {task.intervalMinutes}
                        {tr("\u5206\u949F")}
                      </span>
                      <span>{session?.title ?? tr("\u4F1A\u8BDD\u5DF2\u4E0D\u5B58\u5728")}</span>
                      <span>
                        {tr("\u4E0B\u6B21")}
                        {formatDate(task.nextRunAt)}
                      </span>
                      <span>
                        {tr("\u4E0A\u6B21")}
                        {formatDate(task.lastRunAt)}
                      </span>
                    </div>
                  </div>
                  <div className="schedule-record__actions">
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      title={tr("\u7ACB\u5373\u8FD0\u884C")}
                      aria-label={tr("\u7ACB\u5373\u8FD0\u884C {0}", [task.name])}
                      disabled={busyId === task.id || !task.enabled}
                      onClick={() => void runNow(task)}
                    >
                      {busyId === task.id ? (
                        <LoaderCircle className="spin" aria-hidden="true" size={14} />
                      ) : (
                        <Play aria-hidden="true" size={14} />
                      )}
                    </button>
                    <button
                      className="icon-button icon-button--small"
                      type="button"
                      title={
                        task.enabled
                          ? tr("\u6682\u505C\u4EFB\u52A1")
                          : tr("\u7EE7\u7EED\u4EFB\u52A1")
                      }
                      aria-label={
                        task.enabled
                          ? tr("\u6682\u505C\u4EFB\u52A1")
                          : tr("\u7EE7\u7EED\u4EFB\u52A1")
                      }
                      disabled={busyId === task.id}
                      onClick={() => void setEnabled(task, !task.enabled)}
                    >
                      {task.enabled ? (
                        <Pause aria-hidden="true" size={14} />
                      ) : (
                        <Play aria-hidden="true" size={14} />
                      )}
                    </button>
                    <button
                      className="icon-button icon-button--small icon-button--danger"
                      type="button"
                      title={tr("\u5220\u9664\u4EFB\u52A1")}
                      aria-label={tr("\u5220\u9664 {0}", [task.name])}
                      disabled={busyId === task.id}
                      onClick={() => void remove(task)}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
