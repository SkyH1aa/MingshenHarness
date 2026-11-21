import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  FolderOpen,
  GitFork,
  ListTodo,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActivityEvent, SessionTodo, SessionView } from "../../../shared/domain";
import type { SavedProjectPlan, SessionPlan, WorkbenchState } from "../../../shared/workbench";
import { useLocale } from "../i18n";
import { tr } from "../i18n/index";
import { runtimeText } from "../i18n/runtime";
import type { LiveRun } from "../lib/chat-types";
import { planStepState } from "../lib/plan-status";
import { AgentWorkflowPanel } from "./AgentWorkflowPanel";
import { ExpandableText } from "./ExpandableText";
import { SubagentOutput } from "./SubagentOutput";
import { useUiPreferences } from "./UiPreferences";

export interface TaskWorkbenchViewRequest {
  sessionId: string | null;
  tab: "plan" | "agents" | "library";
  requestKey: number;
  notice?: string;
}

function agentSessionState(session: SessionView, queued: boolean): string {
  return tr(
    queued
      ? "排队中"
      : session.status === "running"
        ? "运行中"
        : session.status === "waiting_approval"
          ? "等待用户处理"
          : session.status === "idle"
            ? "已完成"
            : session.status === "interrupted"
              ? "已中断"
              : "任务失败",
  );
}

export function TaskWorkbench({
  session,
  sessions,
  activities,
  liveBySession,
  onSelect,
  onOpenFile,
  docked = false,
  viewRequest,
  collapsed = false,
  onToggleCollapsed,
  onReveal,
  onEditingChange,
  onDraft,
}: {
  session: SessionView;
  sessions: SessionView[];
  activities: Record<string, ActivityEvent[]>;
  liveBySession: Record<string, LiveRun>;
  onSelect(id: string): void;
  onOpenFile(path: string): void;
  docked?: boolean;
  viewRequest?: TaskWorkbenchViewRequest | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onReveal?: () => void;
  onEditingChange?: (editing: boolean) => void;
  onDraft?: (text: string) => Promise<void> | void;
}) {
  const orbit = useUiPreferences().activeStyle === "orbit";
  const en = useLocale() === "en";
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [tab, setTab] = useState<"plan" | "agents" | "library">("plan");
  const [library, setLibrary] = useState<SavedProjectPlan[]>([]);
  const [planName, setPlanName] = useState("");
  const [resetSteps, setResetSteps] = useState(false);
  const [loadedChildren, setLoadedChildren] = useState<SessionView[]>([]);
  const [childrenCursor, setChildrenCursor] = useState<string | null>(null);
  const [childrenTotal, setChildrenTotal] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<SessionTodo[] | null>(null);
  const [editRevision, setEditRevision] = useState(0);
  const [dependencyDrafts, setDependencyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [queuedIds, setQueuedIds] = useState<Set<string>>(new Set());
  const [restoredActivities, setRestoredActivities] = useState<Record<string, ActivityEvent>>({});
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const workbenchBody = useRef<HTMLDivElement>(null);
  const outputToReveal = useRef<string | null>(null);
  const receivedEvent = useRef(false);
  const handledViewRequest = useRef<number | null>(null);
  useEffect(() => {
    onEditingChange?.(editing !== null);
  }, [editing, onEditingChange]);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
  useEffect(() => {
    if (
      !viewRequest ||
      viewRequest.sessionId !== session.id ||
      handledViewRequest.current === viewRequest.requestKey
    )
      return;
    handledViewRequest.current = viewRequest.requestKey;
    setTab(viewRequest.tab);
    setExpanded(true);
    if (viewRequest.notice) setError(viewRequest.notice);
    onReveal?.();
  }, [viewRequest, session.id, onReveal]);
  useEffect(() => {
    const id = outputToReveal.current;
    if (!id || !expandedAgents.has(id)) return;
    outputToReveal.current = null;
    const body = workbenchBody.current;
    const row = document.getElementById(`agent-output-${id}`)?.parentElement;
    if (!body || !row) return;
    const bounds = body.getBoundingClientRect();
    const top = row.getBoundingClientRect().top;
    body.scrollTop += top - bounds.top;
  }, [expandedAgents]);
  const children = [
    ...new Map([...loadedChildren, ...sessions].map((item) => [item.id, item])).values(),
  ].filter((child) => child.parentSessionId === session.id && !child.archived);
  useEffect(() => {
    if (tab === "library")
      void window.mingshen
        .listProjectPlans(session.workspacePath)
        .then(setLibrary)
        .catch((cause) => setError(String(cause)));
  }, [tab, session.workspacePath]);
  useEffect(() => {
    let alive = true;
    void window.mingshen
      .listSessionPage({ parentId: session.id, limit: 200 })
      .then((page) => {
        if (alive) {
          setLoadedChildren(page.sessions);
          setChildrenCursor(page.nextCursor);
          setChildrenTotal(page.total);
        }
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [session.id]);
  const childIds = children.map((child) => child.id).join(",");
  useEffect(() => {
    if (tab !== "agents" && !(orbit && docked && tab === "plan")) return;
    let alive = true;
    for (const id of childIds.split(",").filter(Boolean)) {
      void window.mingshen
        .getWorkbench(id)
        .then((value) => {
          if (alive)
            setQueuedIds((current) => {
              const next = new Set(current);
              if (value.queued) next.add(id);
              else next.delete(id);
              return next;
            });
        })
        .catch(() => {});
      void window.mingshen
        .getSessionRunState(id)
        .then(async (run) => {
          if (!run) return;
          const trajectories = await window.mingshen.listTrajectories(id, run.runId);
          const event = trajectories[0]?.events.filter((event) => event.type === "activity").at(-1)
            ?.payload as { activity?: ActivityEvent } | undefined;
          if (alive && event?.activity)
            setRestoredActivities((current) => ({
              ...current,
              [id]: event.activity as ActivityEvent,
            }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [childIds, tab, orbit, docked]);
  useEffect(() => {
    let alive = true;
    void window.mingshen
      .getWorkbench(session.id)
      .then((next) => {
        if (alive && !receivedEvent.current) setState(next);
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    const off = window.mingshen.onRuntimeEvent((event) => {
      if (event.type === "session_removed")
        setLoadedChildren((items) => items.filter((item) => item.id !== event.sessionId));
      if (event.type === "session_updated" && event.session.parentSessionId === session.id)
        setLoadedChildren((items) => [
          ...items.filter((item) => item.id !== event.session.id),
          event.session,
        ]);
      if (event.type === "workbench_updated" && event.sessionId === session.id) {
        receivedEvent.current = true;
        setState(event.state);
      }
      if (event.type === "workbench_updated")
        setQueuedIds((current) => {
          const next = new Set(current);
          if (event.state.queued) next.add(event.sessionId);
          else next.delete(event.sessionId);
          return next;
        });
    });
    return () => {
      alive = false;
      off();
    };
  }, [session.id]);
  const plan = state?.plan;
  const steps = plan?.steps ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const resumable =
    state?.checkpoint &&
    state.checkpoint.state !== "completed" &&
    !["running", "waiting_approval"].includes(session.status);
  const perform = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
      setState(await window.mingshen.getWorkbench(session.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const update = async (next: Partial<SessionPlan>) => {
    if (!plan) return;
    await window.mingshen.updatePlan({ sessionId: session.id, revision: plan.revision, ...next });
  };
  const beginEdit = () => {
    setEditing(steps.map((step) => ({ ...step })));
    setDependencyDrafts({});
    setEditRevision(plan?.revision ?? 0);
  };
  if (
    !docked &&
    steps.length === 0 &&
    children.length === 0 &&
    childrenTotal === 0 &&
    !resumable &&
    !error &&
    !(onDraft && session.workspacePath && !session.parentSessionId)
  )
    return null;
  return (
    <section
      className={`task-workbench${docked ? " task-workbench--docked" : ""}${orbit ? " task-workbench--orbit" : ""}`}
      aria-label={tr("任务与并行 Agent")}
      data-task-view={tab}
      data-task-session={session.id}
      data-task-docked={docked}
      data-task-collapsed={orbit && docked && collapsed}
      data-unsaved={editing !== null || undefined}
    >
      <header className="task-workbench__header">
        {orbit && docked ? (
          <div className="task-workbench__toggle task-workbench__heading">
            <ListTodo aria-hidden="true" size={15} />
            <strong>{en ? "Tasks" : "任务"}</strong>
            <span>
              {completed} / {steps.length}
            </span>
            {plan?.reviewRequired ? (
              <span className="task-workbench__paused">{tr("待确认沿用")}</span>
            ) : plan?.paused ? (
              <span className="task-workbench__paused">{tr("已暂停")}</span>
            ) : null}
          </div>
        ) : (
          <button
            className="task-workbench__toggle"
            type="button"
            aria-expanded={expanded || docked}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <ListTodo size={15} />
            <strong>{tr("任务计划")}</strong>
            <span>
              {completed}/{steps.length}
            </span>
            {steps.find((step) => step.status === "in_progress") ? (
              <span className="task-workbench__current">
                {steps.find((step) => step.status === "in_progress")?.content}
              </span>
            ) : null}
            {plan?.reviewRequired ? (
              <span className="task-workbench__paused">{tr("待确认沿用")}</span>
            ) : plan?.paused ? (
              <span className="task-workbench__paused">{tr("已暂停")}</span>
            ) : null}
          </button>
        )}
        <button
          type="button"
          className="task-workbench__agents"
          aria-label={tr("查看子 Agent 任务树")}
          onClick={() => {
            setTab("agents");
            setExpanded(true);
            onReveal?.();
          }}
          title={tr("查看子 Agent 任务树")}
        >
          <GitFork size={14} />
          <span>{Math.max(children.length, childrenTotal)} Agent</span>
        </button>
        {resumable ? (
          <button
            className="btn btn--ghost"
            type="button"
            disabled={busy}
            title={tr("从恢复点继续")}
            aria-label={tr("从恢复点继续")}
            onClick={() => void perform(() => window.mingshen.resumeTask(session.id))}
          >
            <Play size={13} />
            <span className={orbit ? "visually-hidden" : undefined}>{tr("从恢复点继续")}</span>
          </button>
        ) : null}
        {orbit && docked && onToggleCollapsed ? (
          <button
            type="button"
            className="icon-button task-workbench__collapse"
            data-task-action="collapse"
            aria-expanded={!collapsed}
            aria-label={
              en
                ? collapsed
                  ? "Expand tasks"
                  : "Collapse tasks"
                : collapsed
                  ? "展开任务区"
                  : "收起任务区"
            }
            title={
              en
                ? collapsed
                  ? "Expand tasks"
                  : "Collapse tasks"
                : collapsed
                  ? "展开任务区"
                  : "收起任务区"
            }
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <ChevronUp aria-hidden="true" size={16} />
            ) : (
              <ChevronDown aria-hidden="true" size={16} />
            )}
          </button>
        ) : null}
      </header>
      {expanded || docked ? (
        <>
          <div className="task-workbench__toolbar" role="tablist" aria-label={tr("任务视图")}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "plan"}
              data-task-tab="plan"
              title={tr("计划与待办")}
              onClick={() => setTab("plan")}
            >
              {orbit ? (en ? "Plan" : "计划") : tr("计划与待办")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "agents"}
              data-task-tab="agents"
              title={tr("Agent 任务树")}
              onClick={() => setTab("agents")}
            >
              {orbit ? "Agent" : tr("Agent 任务树")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "library"}
              data-task-tab="library"
              title={tr("项目计划库")}
              onClick={() => setTab("library")}
            >
              <FolderOpen size={13} />
              {orbit ? (en ? "Library" : "计划库") : tr("项目计划库")}
            </button>
            <span />
            {tab === "plan" && !editing ? (
              <>
                <button
                  className="icon-button"
                  type="button"
                  title={tr("编辑计划")}
                  aria-label={tr("编辑计划")}
                  onClick={beginEdit}
                >
                  <ListTodo size={14} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy || !plan}
                  title={tr(plan?.paused ? "继续计划" : "暂停计划")}
                  aria-label={tr(plan?.paused ? "继续计划" : "暂停计划")}
                  onClick={() => void perform(() => update({ paused: !plan?.paused }))}
                >
                  {plan?.paused ? <Play size={14} /> : <Pause size={14} />}
                </button>
              </>
            ) : null}
          </div>
          <div className="task-workbench__body" ref={workbenchBody} role="tabpanel">
            {onDraft && session.workspacePath && !session.parentSessionId ? (
              <AgentWorkflowPanel
                key={session.id}
                session={session}
                disabled={
                  busy ||
                  editing !== null ||
                  session.status === "running" ||
                  session.status === "waiting_approval"
                }
                onDraft={onDraft}
              />
            ) : null}
            {tab === "plan" ? (
              editing ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      const resolvedSteps = editing.map((step) => {
                        const draft = dependencyDrafts[step.id];
                        if (draft === undefined) return step;
                        const numbers = draft.trim() ? draft.trim().split(/[,，\s]+/) : [];
                        const dependsOn = numbers.map((number) => {
                          const target = /^\d+$/.test(number) ? editing[Number(number) - 1] : null;
                          if (!target) throw new Error(tr("依赖编号必须指向现有步骤。"));
                          return target.id;
                        });
                        return { ...step, dependsOn };
                      });
                      await window.mingshen.updatePlan({
                        sessionId: session.id,
                        revision: editRevision,
                        steps: resolvedSteps,
                      });
                      setEditing(null);
                    });
                  }}
                >
                  {editing.map((step, index) => (
                    <div className="plan-edit-row" key={step.id}>
                      <input
                        aria-label={tr("步骤 {0}", [index + 1])}
                        value={step.content}
                        maxLength={4000}
                        required
                        onChange={(event) =>
                          setEditing(
                            (items) =>
                              items?.map((item) =>
                                item.id === step.id
                                  ? { ...item, content: event.target.value }
                                  : item,
                              ) ?? null,
                          )
                        }
                      />
                      <select
                        aria-label={tr("步骤状态")}
                        value={step.status}
                        onChange={(event) =>
                          setEditing(
                            (items) =>
                              items?.map((item) =>
                                item.id === step.id
                                  ? { ...item, status: event.target.value as SessionTodo["status"] }
                                  : item,
                              ) ?? null,
                          )
                        }
                      >
                        {["pending", "in_progress", "completed", "cancelled"].map((status) => (
                          <option value={status} key={status}>
                            {tr(
                              status === "pending"
                                ? "待开始"
                                : status === "in_progress"
                                  ? "进行中"
                                  : status === "completed"
                                    ? "已完成"
                                    : "已取消",
                            )}
                          </option>
                        ))}
                      </select>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={tr("删除步骤")}
                        onClick={() =>
                          setEditing(
                            (items) =>
                              items
                                ?.filter((item) => item.id !== step.id)
                                .map((item) => ({
                                  ...item,
                                  dependsOn: item.dependsOn?.filter((id) => id !== step.id) ?? [],
                                })) ?? null,
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                      <label className="plan-edit-row__dependencies">
                        {tr("依赖步骤")}
                        <input
                          aria-label={tr("步骤 {0} 的依赖编号", [index + 1])}
                          placeholder="1, 2"
                          value={
                            dependencyDrafts[step.id] ??
                            (step.dependsOn ?? [])
                              .map((id) => editing.findIndex((item) => item.id === id) + 1)
                              .join(", ")
                          }
                          onChange={(event) => {
                            setDependencyDrafts((current) => ({
                              ...current,
                              [step.id]: event.target.value,
                            }));
                          }}
                        />
                      </label>
                    </div>
                  ))}
                  <footer className="plan-edit-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={editing.length >= 200}
                      onClick={() =>
                        setEditing((items) => [
                          ...(items ?? []),
                          {
                            id: crypto.randomUUID(),
                            content: "",
                            status: "pending",
                            priority: "medium",
                            updatedAt: new Date().toISOString(),
                            dependsOn: [],
                          },
                        ])
                      }
                    >
                      <Plus size={13} />
                      {tr("添加步骤")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        setEditing(null);
                        setError("");
                      }}
                    >
                      <X size={13} />
                      {tr("取消")}
                    </button>
                    <button type="submit" className="btn btn--primary" disabled={busy}>
                      <Save size={13} />
                      {tr("保存计划")}
                    </button>
                  </footer>
                </form>
              ) : steps.length ? (
                <ol className="plan-steps">
                  {steps.map((step, index) => {
                    const display = planStepState(
                      step,
                      session,
                      plan?.paused ?? false,
                      plan?.reviewRequired,
                    );
                    return (
                      <li
                        key={step.id}
                        className={`plan-step plan-step--${step.status}${display.spinning ? "" : " plan-step--static"}`}
                        data-step-state={display.label}
                      >
                        <button
                          type="button"
                          className="icon-button"
                          disabled={busy}
                          aria-label={tr(
                            step.status === "completed" ? "标记为待开始" : "标记为已完成",
                          )}
                          onClick={() =>
                            void perform(() =>
                              update({
                                steps: steps.map((item) =>
                                  item.id === step.id
                                    ? {
                                        ...item,
                                        status:
                                          item.status === "completed" ? "pending" : "completed",
                                      }
                                    : item,
                                ),
                              }),
                            )
                          }
                        >
                          {step.status === "completed" ? (
                            <Check size={14} />
                          ) : display.spinning ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : step.status === "in_progress" ? (
                            <Pause size={14} />
                          ) : orbit ? (
                            <Circle size={14} />
                          ) : (
                            <Square size={14} />
                          )}
                        </button>
                        <span>
                          <strong>
                            {orbit ? "" : `${index + 1}. `}
                            {step.content}
                          </strong>
                          {step.dependsOn?.length ? (
                            <small>
                              {tr("依赖步骤")}{" "}
                              {step.dependsOn
                                .map((id) => steps.findIndex((item) => item.id === id) + 1)
                                .join(", ")}
                            </small>
                          ) : null}
                        </span>
                        <small>{tr(display.label)}</small>
                        <button
                          type="button"
                          className="icon-button"
                          disabled={busy}
                          aria-pressed={plan?.breakpoints.includes(step.id)}
                          aria-label={tr("开始此步骤前暂停")}
                          title={tr("开始此步骤前暂停")}
                          onClick={() =>
                            void perform(() =>
                              update({
                                breakpoints: plan?.breakpoints.includes(step.id)
                                  ? plan.breakpoints.filter((id) => id !== step.id)
                                  : [...(plan?.breakpoints ?? []), step.id],
                              }),
                            )
                          }
                        >
                          <Pause size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="task-workbench__empty">{tr("暂无计划")}</p>
              )
            ) : tab === "library" ? (
              <div className="project-plan-library">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      await window.mingshen.saveProjectPlan(session.id, planName || session.title);
                      setLibrary(await window.mingshen.listProjectPlans(session.workspacePath));
                      setPlanName("");
                    });
                  }}
                >
                  <input
                    aria-label={tr("计划名称")}
                    placeholder={tr("计划名称")}
                    maxLength={120}
                    value={planName}
                    onChange={(event) => setPlanName(event.target.value)}
                  />
                  <button type="submit" className="btn btn--ghost" disabled={busy || !steps.length}>
                    <Save size={13} />
                    {tr("保存当前计划")}
                  </button>
                </form>
                <label>
                  <input
                    type="checkbox"
                    checked={resetSteps}
                    onChange={(event) => setResetSteps(event.target.checked)}
                  />
                  {tr("绑定时重置完成状态")}
                </label>
                {library.map((saved) => (
                  <div className="project-plan-library__row" key={saved.id}>
                    <span>
                      <strong>{saved.name}</strong>
                      <small>
                        {saved.plan.steps.filter((step) => step.status === "completed").length}/
                        {saved.plan.steps.length} · {new Date(saved.savedAt).toLocaleString()}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy || ["running", "waiting_approval"].includes(session.status)}
                      onClick={() =>
                        void perform(() =>
                          window.mingshen.applyProjectPlan(
                            session.id,
                            saved.id,
                            plan?.revision ?? 0,
                            resetSteps,
                          ),
                        )
                      }
                    >
                      <GitFork size={13} />
                      {tr("绑定到此会话")}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={busy}
                      title={tr("删除保存的计划")}
                      aria-label={tr("删除保存的计划")}
                      onClick={() =>
                        void perform(async () => {
                          await window.mingshen.removeProjectPlan(saved.id);
                          setLibrary(await window.mingshen.listProjectPlans(session.workspacePath));
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {!library.length ? (
                  <p className="task-workbench__empty">{tr("暂无保存的项目计划")}</p>
                ) : null}
              </div>
            ) : (
              <ul className="agent-task-tree">
                {[session, ...children].map((child) => {
                  const activity =
                    [...(activities[child.id] ?? [])]
                      .reverse()
                      .find((item) => item.status === "running") ??
                    activities[child.id]?.at(-1) ??
                    restoredActivities[child.id];
                  const status = agentSessionState(child, queuedIds.has(child.id));
                  const isChild = child.id !== session.id;
                  const open = expandedAgents.has(child.id);
                  const active = ["running", "waiting_approval"].includes(child.status);
                  return (
                    <li
                      key={child.id}
                      className={isChild ? "agent-task-tree__child" : ""}
                      data-agent-session={child.id}
                    >
                      <div className="agent-task-tree__row">
                        {isChild ? (
                          <button
                            type="button"
                            className="icon-button agent-task-tree__expand"
                            aria-expanded={open}
                            aria-controls={`agent-output-${child.id}`}
                            aria-label={tr(open ? "收起 {0} 的输出" : "展开 {0} 的输出", [
                              child.title,
                            ])}
                            title={tr(open ? "收起子 Agent 输出" : "展开子 Agent 输出")}
                            onClick={() => {
                              outputToReveal.current = open ? null : child.id;
                              setExpandedAgents((current) => {
                                const next = new Set(current);
                                if (next.has(child.id)) next.delete(child.id);
                                else next.add(child.id);
                                return next;
                              });
                            }}
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        ) : (
                          <span className="agent-task-tree__root-space" />
                        )}
                        <GitFork size={14} />
                        <div className="agent-task-tree__identity">
                          <button
                            type="button"
                            className="agent-task-tree__name"
                            title={tr("打开会话：{0}", [child.title])}
                            onClick={() => onSelect(child.id)}
                          >
                            {runtimeText(child.title)}
                          </button>
                          {active && activity ? (
                            <ExpandableText
                              key={activity.id}
                              text={[runtimeText(activity.title), runtimeText(activity.detail)]
                                .filter(Boolean)
                                .join("\n\n")}
                              preview={runtimeText(activity.title)}
                              className="agent-task-tree__activity"
                              tone={activity.status === "failed" ? "error" : undefined}
                            />
                          ) : null}
                        </div>
                        <code>{status}</code>
                      </div>
                      {isChild && open ? (
                        <div id={`agent-output-${child.id}`}>
                          <SubagentOutput
                            parentId={session.id}
                            session={child}
                            live={liveBySession[child.id] ?? null}
                            onOpenFile={onOpenFile}
                            onOpenSession={() => onSelect(child.id)}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                {childrenCursor ? (
                  <li>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const page = await window.mingshen.listSessionPage({
                            parentId: session.id,
                            limit: 200,
                            cursor: childrenCursor,
                          });
                          setLoadedChildren((items) => [
                            ...new Map(
                              [...items, ...page.sessions].map((item) => [item.id, item]),
                            ).values(),
                          ]);
                          setChildrenCursor(page.nextCursor);
                          setChildrenTotal(page.total);
                        })
                      }
                    >
                      {tr("加载更多子 Agent")}
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
            {state?.checkpoint && resumable ? (
              <p className="task-workbench__checkpoint">
                {tr("已保存 {0} 个工具边界", [state.checkpoint.completedTools])}
                {state.checkpoint.uncertainTools.length
                  ? ` · ${tr("有 {0} 项结果需重新核实", [state.checkpoint.uncertainTools.length])}`
                  : ""}
              </p>
            ) : null}
          </div>
          {orbit && docked && tab === "plan" && !editing && children.length > 0 ? (
            <section className="orbit-agent-summary" aria-label={tr("Agent 任务树")}>
              <header>
                <GitFork aria-hidden="true" size={13} />
                <span>Agent</span>
                <button
                  type="button"
                  title={tr("查看子 Agent 任务树")}
                  onClick={() => setTab("agents")}
                >
                  {Math.max(children.length, childrenTotal)}
                  <ChevronRight aria-hidden="true" size={13} />
                </button>
              </header>
              {children.slice(0, 3).map((child) => (
                <button
                  className="orbit-agent-summary__row"
                  type="button"
                  key={child.id}
                  data-agent-session={child.id}
                  data-agent-status={queuedIds.has(child.id) ? "queued" : child.status}
                  aria-label={tr("展开 {0} 的输出", [child.title])}
                  title={tr("展开 {0} 的输出", [child.title])}
                  onClick={() => {
                    setTab("agents");
                    outputToReveal.current = child.id;
                    setExpandedAgents((current) => new Set([...current, child.id]));
                  }}
                >
                  <GitFork aria-hidden="true" size={13} />
                  <span>{runtimeText(child.title)}</span>
                  <small>{agentSessionState(child, queuedIds.has(child.id))}</small>
                  <ChevronRight aria-hidden="true" size={13} />
                </button>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
      {error ? (
        <div className="form-error" role="alert">
          <ExpandableText text={runtimeText(error)} tone="error" />
        </div>
      ) : null}
    </section>
  );
}
