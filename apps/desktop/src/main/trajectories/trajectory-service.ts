import type { ChatStreamEvent, TrajectoryView } from "../../shared/domain";
import type { Repository } from "../storage/repository";

function summarize(event: ChatStreamEvent): string {
  switch (event.type) {
    case "model_attempt_reset":
      return "网络请求重试，清理未完成的模型输出";
    case "workbench_updated":
      return "更新任务计划与恢复点";
    case "approval_state":
      return "同步待审批操作";
    case "question_resolved":
      return "用户问题已处理";
    case "question_state":
      return "同步待回答问题";
    case "context_updated":
      return "更新上下文状态";
    case "composer_draft_consumed":
      return "已发送草稿";
    case "run_started":
      return event.kind === "compaction" ? "开始手动压缩上下文" : "Agent 开始执行";
    case "user_message":
      return "收到用户消息";
    case "assistant_delta":
      return "模型输出文本";
    case "reasoning_delta":
      return "模型思考";
    case "assistant_message":
      return "写入助手回复";
    case "usage":
      return "更新 token 用量";
    case "activity":
      return `${event.activity.title} · ${event.activity.status}`;
    case "approval_required":
      return `等待批准：${event.approval.summary}`;
    case "question_required":
      return `询问用户：${event.question.question}`;
    case "browser_open_requested":
      return `打开内置浏览器：${event.url}`;
    case "conversation_rewound":
      return "回退会话";
    case "session_todos_updated":
      return `更新待办：${event.todos.length} 项`;
    case "run_completed":
      return event.kind === "compaction" ? "上下文压缩完成" : "Agent 执行完成";
    case "run_interrupted":
      return "Agent 执行已中断";
    case "run_failed":
      return `Agent 执行失败：${event.error}`;
    case "session_updated":
      return `会话状态：${event.session.status}`;
    case "session_removed":
      return "删除会话";
  }
}

export class TrajectoryService {
  constructor(private readonly repository: Repository) {}

  record(event: ChatStreamEvent): void {
    if (
      event.type === "session_updated" ||
      event.type === "workbench_updated" ||
      event.type === "browser_open_requested" ||
      event.type === "conversation_rewound" ||
      event.type === "session_todos_updated" ||
      event.type === "session_removed" ||
      event.type === "approval_state" ||
      event.type === "question_resolved" ||
      event.type === "question_state" ||
      event.type === "context_updated" ||
      event.type === "composer_draft_consumed"
    ) {
      return;
    }
    const sessionId = event.type === "activity" ? event.activity.sessionId : event.sessionId;
    const runId = event.type === "activity" ? event.activity.runId : event.runId;
    this.repository.appendTrajectoryEvent({
      sessionId,
      runId,
      type: event.type,
      summary: summarize(event),
      payload: event,
    });
  }

  list(sessionId: string, runId?: string): TrajectoryView[] {
    const events = this.repository.listTrajectory(sessionId, runId);
    const groups = new Map<string, TrajectoryView>();
    for (const event of events) {
      const current = groups.get(event.runId);
      if (current) {
        current.events.push(event);
      } else {
        groups.set(event.runId, {
          runId: event.runId,
          sessionId: event.sessionId,
          startedAt: event.createdAt,
          stepSummaries: [],
          events: [event],
        });
      }
    }
    return [...groups.values()]
      .map((trajectory) => ({
        ...trajectory,
        stepSummaries: buildStepSummaries(trajectory.events),
      }))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  getRun(sessionId: string, runId: string): TrajectoryView | null {
    return this.list(sessionId, runId)[0] ?? null;
  }
}

function buildStepSummaries(events: TrajectoryView["events"]): string[] {
  const summaries: string[] = [];
  let last = "";
  for (const event of events) {
    if (
      event.type === "assistant_delta" ||
      event.type === "reasoning_delta" ||
      event.type === "usage" ||
      event.summary === last
    ) {
      continue;
    }
    summaries.push(event.summary);
    last = event.summary;
  }
  return summaries;
}
