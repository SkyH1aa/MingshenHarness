import type {
  CompanionInteraction,
  CompanionPreferences,
  CompanionState,
  CompanionTaskSummary,
} from "../../shared/desktop-companion";
import { compareCompanionTasks } from "../../shared/desktop-companion";

export type CompanionMenuInteraction = CompanionInteraction;

export interface CompanionMenuState {
  locale: CompanionState["locale"];
  tasks: readonly CompanionTaskSummary[];
  preferences: Pick<
    CompanionPreferences,
    | "alwaysOnTop"
    | "positionLocked"
    | "animationEnabled"
    | "size"
    | "opacity"
    | "taskPanelEnabled"
    | "showSessionTitles"
    | "quietMode"
  >;
  manualSleeping: CompanionState["manualSleeping"];
}

type CompanionMenuPatch = Partial<CompanionMenuState["preferences"] & { position: null }>;
type MenuOperation = () => unknown;

export interface CompanionMenuHandlers {
  openMain: MenuOperation;
  openQuickChat: MenuOperation;
  openSession: (sessionId: string) => unknown;
  openSettings: MenuOperation;
  setPreferences: (patch: CompanionMenuPatch) => unknown;
  interact: (action: CompanionMenuInteraction) => unknown;
  hide: MenuOperation;
  disable: MenuOperation;
  onError?: (error: unknown) => unknown;
}

// A narrow, runtime-independent subset of Electron's MenuItemConstructorOptions.
export interface CompanionMenuItem {
  id: string;
  label?: string;
  type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
  checked?: boolean;
  enabled?: boolean;
  submenu?: CompanionMenuItem[];
  click?: () => void;
}

const INTERACTIONS: readonly {
  action: Exclude<
    CompanionMenuInteraction,
    | "sleep"
    | "wake"
    | "cancel_interaction"
    | "preview_thinking"
    | "preview_working"
    | "preview_waiting"
    | "preview_success"
    | "preview_error"
    | "preview_sleep"
  >;
  zh: string;
  en: string;
}[] = [
  { action: "greet_wave", zh: "挥手问候", en: "Wave hello" },
  { action: "pat", zh: "摸摸头", en: "Pat" },
  { action: "nod", zh: "点头", en: "Nod" },
  { action: "shake_head", zh: "摇头", en: "Shake head" },
  { action: "look_around", zh: "四处张望", en: "Look around" },
  { action: "stretch", zh: "伸懒腰", en: "Stretch" },
  { action: "dance", zh: "跳舞", en: "Dance" },
  { action: "jump", zh: "跳一跳", en: "Jump" },
  { action: "drink", zh: "喝水", en: "Drink" },
  { action: "listen", zh: "倾听", en: "Listen" },
  { action: "notify", zh: "提醒", en: "Notify" },
  { action: "read_enter", zh: "开始阅读", en: "Start reading" },
  { action: "read_exit", zh: "结束阅读", en: "Finish reading" },
  { action: "walk_left", zh: "向左行走", en: "Walk left" },
  { action: "walk_right", zh: "向右行走", en: "Walk right" },
];

const STATE_PREVIEWS: readonly {
  action: Extract<CompanionMenuInteraction, `preview_${string}`>;
  zh: string;
  en: string;
}[] = [
  { action: "preview_thinking", zh: "思考", en: "Thinking" },
  { action: "preview_working", zh: "工作", en: "Working" },
  { action: "preview_waiting", zh: "等待", en: "Waiting" },
  { action: "preview_success", zh: "完成", en: "Success" },
  { action: "preview_error", zh: "出错", en: "Error" },
  { action: "preview_sleep", zh: "睡眠", en: "Sleep" },
];

const MENU_TASK_LIMIT = 20;
const SIZES = [96, 128, 176, 240, 320] as const;
const OPACITIES = [0.35, 0.5, 0.75, 1] as const;

export function buildCompanionMenu(
  state: CompanionMenuState,
  handlers: CompanionMenuHandlers,
): CompanionMenuItem[] {
  const text = (zh: string, en: string) => (state.locale === "en" ? en : zh);
  const report = (error: unknown) => {
    if (!handlers.onError) {
      console.error("Desktop companion menu action failed:", error);
      return;
    }
    try {
      void Promise.resolve(handlers.onError(error)).catch((reportError: unknown) => {
        console.error("Desktop companion menu error reporting failed:", reportError, error);
      });
    } catch (reportError) {
      console.error("Desktop companion menu error reporting failed:", reportError, error);
    }
  };
  const run = (operation: MenuOperation) => () => {
    try {
      void Promise.resolve(operation()).catch(report);
    } catch (error) {
      report(error);
    }
  };
  const tasks = [...state.tasks].sort(compareCompanionTasks);
  const taskItems: CompanionMenuItem[] = tasks.slice(0, MENU_TASK_LIMIT).map((task, index) => {
    const status = {
      thinking: text("思考中", "Thinking"),
      working: text("执行中", "Working"),
      waiting: text("等待处理", "Waiting"),
    }[task.status];
    return {
      id: `task-${index + 1}`,
      label: `${task.title ? task.title.replace(/&/g, "&&") : `${text("任务", "Task")} ${index + 1}`} · ${status}`,
      click: run(() => handlers.openSession(task.sessionId)),
    };
  });
  if (tasks.length === 0) {
    taskItems.push({
      id: "tasks-empty",
      label: text("暂无运行中的任务", "No active tasks"),
      enabled: false,
    });
  } else if (tasks.length > MENU_TASK_LIMIT) {
    const remaining = tasks.length - MENU_TASK_LIMIT;
    taskItems.push({
      id: "tasks-more",
      label: text(`还有 ${remaining} 项，打开主界面`, `${remaining} more, open main window`),
      click: run(handlers.openMain),
    });
  }

  const interactionItems: CompanionMenuItem[] = INTERACTIONS.map(({ action, zh, en }) => ({
    id: `interaction-${action}`,
    label: text(zh, en),
    click: run(() => handlers.interact(action)),
  }));
  interactionItems.push(
    { id: "interaction-separator", type: "separator" },
    {
      id: "interaction-rest",
      label: state.manualSleeping ? text("唤醒", "Wake up") : text("休息", "Rest"),
      click: run(() => handlers.interact(state.manualSleeping ? "wake" : "sleep")),
    },
    {
      id: "interaction-cancel",
      label: text("结束互动", "Stop interaction"),
      click: run(() => handlers.interact("cancel_interaction")),
    },
  );

  return [
    {
      id: "open-main",
      label: text("打开主界面", "Open main window"),
      click: run(handlers.openMain),
    },
    {
      id: "quick-chat",
      label: text("快捷对话 (ChatAgent)", "Quick chat (ChatAgent)"),
      click: run(handlers.openQuickChat),
    },
    { id: "navigation-separator", type: "separator" },
    {
      id: "tasks",
      label: text(`当前任务 (${tasks.length})`, `Active tasks (${tasks.length})`),
      submenu: taskItems,
    },
    { id: "interactions", label: text("互动", "Interact"), submenu: interactionItems },
    {
      id: "state-previews",
      label: text("状态预览", "Preview states"),
      submenu: STATE_PREVIEWS.map(({ action, zh, en }) => ({
        id: `interaction-${action}`,
        label: text(zh, en),
        click: run(() => handlers.interact(action)),
      })),
    },
    { id: "appearance-separator", type: "separator" },
    {
      id: "always-on-top",
      type: "checkbox",
      label: text("置顶显示", "Always on top"),
      checked: state.preferences.alwaysOnTop,
      click: run(() => handlers.setPreferences({ alwaysOnTop: !state.preferences.alwaysOnTop })),
    },
    {
      id: "position-locked",
      type: "checkbox",
      label: text("锁定位置", "Lock position"),
      checked: state.preferences.positionLocked,
      click: run(() =>
        handlers.setPreferences({ positionLocked: !state.preferences.positionLocked }),
      ),
    },
    {
      id: "reset-position",
      label: text("重置位置", "Reset position"),
      click: run(() => handlers.setPreferences({ position: null })),
    },
    {
      id: "size",
      label: text("大小", "Size"),
      submenu: SIZES.map((size) => ({
        id: `size-${size}`,
        type: "radio",
        label: `${size} px`,
        checked: state.preferences.size === size,
        click: run(() => handlers.setPreferences({ size })),
      })),
    },
    {
      id: "opacity",
      label: text("不透明度", "Opacity"),
      submenu: OPACITIES.map((opacity) => ({
        id: `opacity-${Math.round(opacity * 100)}`,
        type: "radio",
        label: `${Math.round(opacity * 100)}%`,
        checked: state.preferences.opacity === opacity,
        click: run(() => handlers.setPreferences({ opacity })),
      })),
    },
    {
      id: "animation-enabled",
      type: "checkbox",
      label: text("播放动画", "Play animations"),
      checked: state.preferences.animationEnabled,
      click: run(() =>
        handlers.setPreferences({ animationEnabled: !state.preferences.animationEnabled }),
      ),
    },
    {
      id: "task-panel-enabled",
      type: "checkbox",
      label: text("显示任务面板", "Show task panel"),
      checked: state.preferences.taskPanelEnabled,
      click: run(() =>
        handlers.setPreferences({ taskPanelEnabled: !state.preferences.taskPanelEnabled }),
      ),
    },
    {
      id: "show-session-titles",
      type: "checkbox",
      label: text("显示会话标题", "Show session titles"),
      checked: state.preferences.showSessionTitles,
      click: run(() =>
        handlers.setPreferences({ showSessionTitles: !state.preferences.showSessionTitles }),
      ),
    },
    {
      id: "quiet-mode",
      type: "checkbox",
      label: text("免打扰", "Quiet mode"),
      checked: state.preferences.quietMode,
      click: run(() => handlers.setPreferences({ quietMode: !state.preferences.quietMode })),
    },
    { id: "settings-separator", type: "separator" },
    {
      id: "settings",
      label: text("桌面体验设置", "Desktop experience settings"),
      click: run(handlers.openSettings),
    },
    { id: "hide", label: text("暂时隐藏", "Hide for now"), click: run(handlers.hide) },
    { id: "disable", label: text("关闭桌宠", "Turn off companion"), click: run(handlers.disable) },
  ];
}
