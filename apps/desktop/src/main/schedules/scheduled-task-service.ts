import type { ScheduledTaskCreateInput, ScheduledTaskView } from "../../shared/domain";
import type { ChatService } from "../chat/chat-service";
import type { Repository } from "../storage/repository";

const SCAN_INTERVAL_MS = 15_000;

function normalizedInterval(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10_080) {
    throw new Error("定时间隔必须是 1 到 10080 分钟之间的整数。");
  }
  return value;
}

export class ScheduledTaskService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly activeTaskIds = new Set<string>();
  private readonly pendingRuns = new Set<Promise<void>>();
  private disposed = false;

  constructor(
    private readonly repository: Repository,
    private readonly chatService: ChatService,
  ) {}

  start(): void {
    if (this.timer || this.disposed) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), SCAN_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  list(): ScheduledTaskView[] {
    return this.repository.listScheduledTasks();
  }

  create(input: ScheduledTaskCreateInput): ScheduledTaskView {
    if (!this.repository.getSession(input.sessionId)) {
      throw new Error("定时任务关联的会话不存在。");
    }
    const name = input.name.trim();
    const prompt = input.prompt.trim();
    if (!name || name.length > 120) {
      throw new Error("任务名称长度必须为 1 到 120 个字符。");
    }
    if (!prompt) {
      throw new Error("定时任务提示词不能为空。");
    }

    const intervalMinutes = normalizedInterval(input.intervalMinutes);
    return this.repository.insertScheduledTask({
      name,
      prompt,
      sessionId: input.sessionId,
      intervalMinutes,
      enabled: input.enabled,
      nextRunAt: new Date(Date.now() + intervalMinutes * 60_000).toISOString(),
    });
  }

  setEnabled(taskId: string, enabled: boolean): ScheduledTaskView {
    return this.repository.setScheduledTaskEnabled(taskId, enabled);
  }

  remove(taskId: string): void {
    this.repository.removeScheduledTask(taskId);
  }

  async runNow(taskId: string): Promise<void> {
    const task = this.repository.getScheduledTask(taskId);
    if (!task) {
      throw new Error("定时任务不存在。");
    }
    await this.runTask(task);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await Promise.allSettled(this.pendingRuns);
  }

  private async tick(): Promise<void> {
    if (this.disposed) return;
    const now = Date.now();
    for (const task of this.repository.listScheduledTasks()) {
      if (this.disposed) return;
      if (
        !task.enabled ||
        this.activeTaskIds.has(task.id) ||
        new Date(task.nextRunAt).getTime() > now
      ) {
        continue;
      }
      await this.runTask(task);
    }
  }

  private runTask(task: ScheduledTaskView): Promise<void> {
    if (
      this.disposed ||
      this.activeTaskIds.has(task.id) ||
      !this.repository.getSession(task.sessionId)
    )
      return Promise.resolve();
    const pending = this.executeTask(task);
    this.pendingRuns.add(pending);
    const cleanup = () => this.pendingRuns.delete(pending);
    void pending.then(cleanup, cleanup);
    return pending;
  }

  private async executeTask(task: ScheduledTaskView): Promise<void> {
    this.activeTaskIds.add(task.id);
    try {
      this.repository.markScheduledTaskRun(task.id);
      await this.chatService.send({ sessionId: task.sessionId, text: task.prompt });
    } catch (error) {
      if (this.disposed || !this.repository.getSession(task.sessionId)) return;
      const message = error instanceof Error ? error.message : String(error);
      const notice = this.repository.appendMessage({
        sessionId: task.sessionId,
        role: "assistant",
        parts: [{ type: "error", message: `定时任务「${task.name}」未能启动：${message}` }],
      });
      this.chatService.emitMessage(notice);
    } finally {
      this.activeTaskIds.delete(task.id);
    }
  }
}
