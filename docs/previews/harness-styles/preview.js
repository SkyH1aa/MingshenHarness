(() => {
  "use strict";

  const root = document.documentElement;
  const byId = (id) => document.getElementById(id);
  const all = (selector, within = document) => [...within.querySelectorAll(selector)];
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const svgNamespace = "http://www.w3.org/2000/svg";
  const iconAttributes = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  };

  function mountIcon(svg, id) {
    for (const [name, value] of Object.entries(iconAttributes)) svg.setAttribute(name, value);
    svg.dataset.icon = id;
    const markup = window.HARNESS_ICONS?.[id];
    if (typeof markup === "string") {
      // This map contains only the locally generated Lucide SVG asset markup.
      const parsed = new DOMParser().parseFromString(
        `<svg xmlns="${svgNamespace}">${markup}</svg>`,
        "image/svg+xml",
      );
      if (!parsed.querySelector("parsererror")) {
        svg.replaceChildren(...[...parsed.documentElement.childNodes].map((node) => document.importNode(node, true)));
      }
    } else if (!svg.querySelector("use")) {
      const use = document.createElementNS(svgNamespace, "use");
      use.setAttribute("href", `#${id}`);
      svg.replaceChildren(use);
    }
    return svg;
  }

  function icon(id) {
    return mountIcon(document.createElementNS(svgNamespace, "svg"), id);
  }

  function mountIcons(within = document) {
    for (const svg of all("svg", within)) {
      const reference = svg.querySelector("use");
      const href = reference?.getAttribute("href") || reference?.getAttribute("xlink:href");
      const id = href?.split("#").at(-1) || svg.dataset.icon;
      if (id) mountIcon(svg, id);
    }
  }

  const styleCaptions = {
    orbit: "光轨 · 精密工作台",
    prism: "折光 · 轻透工作面",
    pulse: "脉冲 · 任务协作台",
  };
  const allowed = {
    style: Object.keys(styleCaptions),
    theme: ["night", "day"],
    motion: ["full", "reduced", "off"],
    view: ["chat", "code", "agents"],
  };
  const query = new URLSearchParams(location.search);
  const options = Object.fromEntries(
    Object.entries(allowed).map(([key, values]) => {
      const requested = query.get(key);
      const current = root.dataset[key];
      return [key, values.includes(requested) ? requested : values.includes(current) ? current : values[0]];
    }),
  );
  let toastTimer;

  function toast(message) {
    clearTimeout(toastTimer);
    byId("toast-text").textContent = message;
    byId("toast").hidden = false;
    toastTimer = setTimeout(() => {
      byId("toast").hidden = true;
    }, 3200);
  }

  function syncAppearance() {
    for (const [key, value] of Object.entries(options)) root.dataset[key] = value;
    for (const button of all("[data-style-choice]")) {
      button.setAttribute("aria-pressed", String(button.dataset.styleChoice === options.style));
    }
    for (const button of all("[data-view-choice]")) {
      button.setAttribute("aria-pressed", String(button.dataset.viewChoice === options.view));
    }
    for (const button of all("[data-rail-view]")) {
      const selected = button.dataset.railView === options.view;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    byId("style-caption").textContent = styleCaptions[options.style];
    byId("motion-select").value = options.motion;
    byId("dialog-style").value = options.style;
    byId("dialog-theme").value = options.theme;
    byId("dialog-motion").value = options.motion;
    const themeAction = options.theme === "night" ? "切换为日间" : "切换为夜间";
    byId("theme-toggle").setAttribute("aria-label", themeAction);
    byId("theme-toggle").title = themeAction;
    root.style.colorScheme = options.theme === "night" ? "dark" : "light";
  }

  function setAppearance(key, value) {
    if (!allowed[key]?.includes(value)) return;
    options[key] = value;
    syncAppearance();
    if (key === "style" || key === "view") syncPanels();
    positionOpenMenu();
  }

  const mobileMedia = window.matchMedia("(max-width: 760px)");
  const compactMedia = window.matchMedia("(max-width: 1100px)");
  const pulseSidebarMedia = window.matchMedia("(max-width: 1340px)");
  let sessionsVisible = true;
  let inspectorVisible = true;
  let sessionsOpen = false;
  let inspectorOpen = false;
  let drawerTrigger = null;

  function sessionsUseDrawer() {
    return mobileMedia.matches
      || (compactMedia.matches && options.view === "agents")
      || (!compactMedia.matches && pulseSidebarMedia.matches && options.style === "pulse");
  }

  function inspectorForcedInline() {
    return mobileMedia.matches && options.view === "code";
  }

  function inspectorUsesDrawer() {
    return compactMedia.matches && !inspectorForcedInline();
  }

  function activeDrawer() {
    if (sessionsUseDrawer() && sessionsOpen) return byId("session-sidebar");
    if (inspectorUsesDrawer() && inspectorOpen) return byId("inspector");
    return null;
  }

  function syncPanels() {
    const previousFocus = document.activeElement;
    const sessionsDrawer = sessionsUseDrawer();
    const inspectorDrawer = inspectorUsesDrawer();
    if (!sessionsDrawer) sessionsOpen = false;
    if (!inspectorDrawer) inspectorOpen = false;
    const sessionsShown = sessionsDrawer ? sessionsOpen : sessionsVisible;
    const inspectorShown = inspectorForcedInline() || (inspectorDrawer ? inspectorOpen : inspectorVisible);
    root.dataset.sessionsVisible = sessionsVisible ? "yes" : "no";
    root.dataset.inspectorVisible = inspectorVisible ? "yes" : "no";
    root.dataset.sessionsOpen = sessionsDrawer && sessionsOpen ? "yes" : "no";
    root.dataset.inspectorOpen = inspectorDrawer && inspectorOpen ? "yes" : "no";
    byId("drawer-scrim").hidden = !activeDrawer();
    byId("session-sidebar").inert = !sessionsShown;
    byId("inspector").inert = !inspectorShown;
    byId("open-sessions").setAttribute("aria-expanded", String(sessionsShown));
    byId("open-sessions").setAttribute("aria-controls", "session-sidebar");
    byId("open-sessions").setAttribute("aria-label", sessionsShown ? "收起项目与会话" : "显示项目与会话");
    byId("inspector-toggle").setAttribute("aria-expanded", String(inspectorShown));
    byId("inspector-toggle").setAttribute("aria-controls", "inspector");
    const inspectorAction = inspectorForcedInline() ? "返回对话视图" : inspectorShown ? "收起工具面板" : "显示工具面板";
    byId("inspector-toggle").setAttribute("aria-label", inspectorAction);
    byId("inspector-toggle").title = inspectorAction;
    if (!sessionsShown && byId("session-sidebar").contains(previousFocus)) {
      byId("open-sessions").focus({ preventScroll: true });
    } else if (!inspectorShown && byId("inspector").contains(previousFocus)) {
      byId("inspector-toggle").focus({ preventScroll: true });
    }
    if (!activeDrawer()) drawerTrigger = null;
  }

  function closeDrawers(restoreFocus = false) {
    const trigger = drawerTrigger;
    sessionsOpen = false;
    inspectorOpen = false;
    drawerTrigger = null;
    syncPanels();
    if (restoreFocus && trigger) trigger.focus({ preventScroll: true });
  }

  function openInspector(focus = false) {
    inspectorVisible = true;
    sessionsOpen = false;
    if (inspectorUsesDrawer()) {
      inspectorOpen = true;
      drawerTrigger = byId("inspector-toggle");
    } else inspectorOpen = false;
    closeMenu();
    syncPanels();
    if (focus) {
      document.querySelector('[data-inspector-tab][aria-selected="true"]').focus({ preventScroll: true });
    }
  }

  function setView(value) {
    closeMenu();
    setAppearance("view", value);
    if (value === "code") openInspector();
    else closeDrawers();
  }

  const inspectorTabs = all("[data-inspector-tab]");
  let inspectorTab = "changes";

  function selectInspectorTab(value, focus = false) {
    if (!inspectorTabs.some((tab) => tab.dataset.inspectorTab === value)) return;
    inspectorTab = value;
    for (const tab of inspectorTabs) {
      const selected = tab.dataset.inspectorTab === value;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      byId(tab.getAttribute("aria-controls")).hidden = !selected;
      if (selected && focus) tab.focus({ preventScroll: true });
    }
  }

  const files = {
    "local-store": {
      name: "local-store.ts",
      lines: [
        [24, "export function deduplicate("],
        [25, "  records: MemoryRecord[],"],
        [26, "): MemoryRecord[] {"],
        [27, "-  return unique(records);", "removed"],
        [27, "+  const seen = new Map();", "added"],
        [28, "+  for (const record of records) {", "added"],
        [29, "+    const key = identity(record);", "added"],
        [30, "+    mergeLatest(seen, key, record);", "added"],
        [31, "+  }", "added"],
        [32, "+  return [...seen.values()];", "added"],
        [33, "}"],
      ],
    },
    "dedup-test": {
      name: "dedup.test.ts",
      lines: [
        [12, 'import { deduplicate } from "./local-store";'],
        [13, ""],
        [14, '+it("keeps the latest source revision", () => {', "added"],
        [15, "+  const records = [older, newer];", "added"],
        [16, "+  expect(deduplicate(records)).toEqual([newer]);", "added"],
        [17, "+});", "added"],
        [18, ""],
        [19, '+it("keeps different projects separate", () => {', "added"],
        [20, "+  const records = [projectA, projectB];", "added"],
        [21, "+  expect(deduplicate(records)).toHaveLength(2);", "added"],
        [22, "+});", "added"],
      ],
    },
    retrieval: {
      name: "retrieval.ts",
      lines: [
        [8, "export function retrieve("],
        [9, "  records: MemoryRecord[],"],
        [10, "  projectId: string,"],
        [11, "  query: string,"],
        [12, ") {"],
        [13, "  return records"],
        [14, "    .filter((record) => record.projectId === projectId)"],
        [15, "    .filter((record) => matches(record, query))"],
        [16, "    .slice(0, 5);"],
        [17, "}"],
      ],
    },
  };
  let selectedFile = "local-store";

  function renderFile(value) {
    if (!Object.hasOwn(files, value)) return;
    selectedFile = value;
    const file = files[value];
    byId("code-file-label").textContent = file.name;
    const fragment = document.createDocumentFragment();
    for (const [lineNumber, text, change] of file.lines) {
      const line = make("div", `code-line${change ? ` ${change}-line` : ""}`);
      line.append(make("span", "", String(lineNumber)), make("code", "", text));
      fragment.append(line);
    }
    byId("code-preview").replaceChildren(fragment);
    for (const button of all("[data-open-file]")) {
      button.classList.toggle("is-selected", button.dataset.openFile === value);
      button.setAttribute("aria-pressed", String(button.dataset.openFile === value));
    }
  }

  function openFile(value) {
    const focusWasInFiles = byId("panel-files").contains(document.activeElement);
    renderFile(value);
    selectInspectorTab("changes");
    openInspector(inspectorUsesDrawer() || focusWasInFiles);
  }

  const sessions = [
    { id: "memory", title: "本地记忆引擎优化", summary: "去重策略与检索边界", time: "现在", fixture: true },
    {
      id: "ui", title: "工作台界面探索", summary: "布局与日夜主题", time: "刚刚",
      introduction: "对比界面布局与日夜主题，保留清晰的正文层级。",
      response: "这是界面探索示例会话。切换光轨、折光或脉冲后，当前草稿和选择会保留。",
    },
    {
      id: "docs", title: "整理项目文档", summary: "使用手册与维护记录", time: "昨天",
      introduction: "整理项目使用手册与维护记录，区分实现状态和验证边界。",
      response: "这是文档整理示例会话。页面中的文件、消息和执行结果均为本地示例。",
    },
  ].map((session) => ({
    ...session,
    draft: "",
    reference: false,
    messages: [],
    model: "工作台示例模型",
    agent: "Mingshen",
    permission: "approval",
    reasoning: 2,
  }));
  const reasoningLevels = ["低", "中", "高", "最高"];
  let sessionId = "memory";
  let newSessionCount = 0;
  let composing = false;
  const currentSession = () => sessions.find((session) => session.id === sessionId);

  function renderSessionList() {
    const search = byId("session-search").value.trim().toLocaleLowerCase();
    const fragment = document.createDocumentFragment();
    let matches = 0;
    for (const session of sessions) {
      const button = make("button", `session-item${session.id === sessionId ? " is-current" : ""}`);
      button.type = "button";
      button.dataset.session = session.id;
      button.hidden = !`${session.title} ${session.summary}`.toLocaleLowerCase().includes(search);
      if (!button.hidden) matches += 1;
      if (session.id === sessionId) button.setAttribute("aria-current", "true");
      const isRunning = session.fixture && ["fixture", "running"].includes(demo.phase);
      button.append(make("span", `session-dot${isRunning ? " running" : ""}`));
      const copy = make("span", "session-copy");
      copy.append(make("strong", "", session.title), make("span", "", session.summary));
      button.append(copy, make("span", "session-time", session.time));
      fragment.append(button);
    }
    byId("session-list").replaceChildren(fragment);
    byId("empty-search").hidden = matches > 0;
    byId("session-count").textContent = String(sessions.length);
  }

  function messageNode(role, text, time, reference = false) {
    const article = make(role === "user" ? "div" : "article", `${role === "user" ? "user" : "assistant"}-message demo-message`);
    const meta = make("div", "message-meta");
    if (role === "user") {
      meta.append(make("span", "user-avatar", "M"), make("span", "", "你"));
    } else {
      const image = document.createElement("img");
      image.src = "assets/brand-icon.png";
      image.width = 24;
      image.height = 24;
      image.alt = "";
      meta.append(image, make("span", "", "Mingshen"), make("span", "agent-role", "示例回复"));
    }
    if (time) meta.append(make("time", "", time));
    article.append(meta);
    const body = role === "user" ? article : make("div", "assistant-body");
    const paragraph = make("p", "", text);
    paragraph.style.whiteSpace = "pre-wrap";
    body.append(paragraph);
    if (reference) body.append(make("p", "message-reference", "引用：local-store.ts（示例）"));
    if (body !== article) article.append(body);
    return article;
  }

  function renderMessages() {
    const session = currentSession();
    byId("initial-user-message").hidden = !session.fixture;
    byId("initial-assistant-message").hidden = !session.fixture;
    byId("working-indicator").hidden = !session.fixture;
    const dock = document.querySelector(".task-dock");
    dock.hidden = false;
    const emptyTasks = byId("empty-tasks");
    if (emptyTasks) emptyTasks.hidden = Boolean(session.fixture);
    dock.querySelector(".task-list").hidden = !session.fixture;
    dock.querySelector(".task-dock-footer").hidden = !session.fixture;
    const fragment = document.createDocumentFragment();
    if (session.introduction) {
      fragment.append(messageNode("user", session.introduction, "10:38"), messageNode("assistant", session.response, "10:38"));
    }
    if (!session.fixture && !session.introduction && session.messages.length === 0) {
      const empty = make("div", "empty-conversation");
      const image = document.createElement("img");
      image.src = "assets/brand-icon.png";
      image.width = 48;
      image.height = 48;
      image.alt = "";
      empty.append(image, make("p", "", "新对话"), make("span", "", "本地示例 · 无模型连接"));
      fragment.append(empty);
    }
    for (const message of session.messages) {
      fragment.append(messageNode(message.role, message.text, message.time, message.reference));
    }
    byId("extra-messages").replaceChildren(fragment);
    renderDemo();
  }

  function syncComposer() {
    const session = currentSession();
    byId("composer-input").value = session.draft;
    byId("send-button").disabled = !session.draft.trim();
    byId("model-label").textContent = session.model;
    byId("agent-label").textContent = session.agent;
    for (const button of all("[data-model]")) button.setAttribute("aria-checked", String(button.dataset.model === session.model));
    for (const button of all("[data-agent]")) button.setAttribute("aria-checked", String(button.dataset.agent === session.agent));
    mountIcon(byId("model-button").querySelector("svg"), session.model === "轻量示例模型" ? "zap" : "cpu");
    mountIcon(byId("agent-button").querySelector("svg"), session.agent === "Plan" ? "list-checks" : session.agent === "测试 Agent" ? "flask" : "bot");
    const permission = session.permission === "approval" ? "请求批准" : "完全访问";
    byId("permission-button").querySelector("span").textContent = permission;
    byId("permission-button").setAttribute("aria-label", `示例权限：${permission}，点击切换`);
    byId("permission-button").setAttribute("aria-pressed", String(session.permission === "full"));
    byId("permission-button").title = `示例权限：${permission}`;
    byId("reasoning-label").textContent = reasoningLevels[session.reasoning];
    byId("reasoning-button").setAttribute("aria-label", `思考等级：${reasoningLevels[session.reasoning]}，点击切换`);
    byId("reasoning-button").title = `思考等级：${reasoningLevels[session.reasoning]}`;
    byId("reference-label").textContent = session.reference ? "已引用 local-store.ts · 示例" : "示例内容 · 无模型连接";
    byId("attach-button").setAttribute("aria-pressed", String(session.reference));
    byId("attach-button").setAttribute("aria-label", session.reference ? "移除示例引用" : "添加示例引用");
    byId("attach-button").title = session.reference ? "移除示例引用" : "添加示例引用";
  }

  function switchSession(value, focusComposer = false) {
    if (!sessions.some((session) => session.id === value)) return;
    currentSession().draft = byId("composer-input").value;
    sessionId = value;
    composing = false;
    root.dataset.sessionKind = value === "memory" ? "memory" : "other";
    byId("session-title").textContent = currentSession().title;
    byId("composer-input").placeholder = currentSession().fixture ? "继续这项任务…" : "输入演示消息…";
    closeMenu();
    renderSessionList();
    renderMessages();
    syncComposer();
    closeDrawers();
    byId("conversation-scroll").scrollTop = 0;
    if (focusComposer) byId("composer-input").focus({ preventScroll: true });
  }

  function sendMessage() {
    const session = currentSession();
    const text = byId("composer-input").value.trim();
    if (!text || composing) return;
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    session.messages.push({ role: "user", text, time, reference: session.reference });
    session.messages.push({
      role: "assistant",
      text: session.agent === "Plan"
        ? "这条示例消息已保留在当前页面。Plan 选择已生效；此预览不调用模型，也不会读取或修改项目文件。"
        : "这条示例消息已保留在当前页面。你可以继续比较界面或查看示例文件；此预览没有调用模型。",
      time,
    });
    if (!session.fixture && !session.introduction && session.messages.length === 2) {
      session.title = text.replace(/\s+/g, " ").slice(0, 18);
      byId("session-title").textContent = session.title;
    }
    session.draft = "";
    session.reference = false;
    renderMessages();
    renderSessionList();
    syncComposer();
    const scroll = byId("conversation-scroll");
    scroll.scrollTop = scroll.scrollHeight;
    byId("composer-input").focus({ preventScroll: true });
  }

  const menuEntries = [
    { button: byId("model-button"), menu: byId("model-menu"), key: "model" },
    { button: byId("agent-button"), menu: byId("agent-menu"), key: "agent" },
  ];
  let openMenu = null;

  function closeMenu(restoreFocus = false) {
    if (!openMenu) return;
    const previous = openMenu;
    previous.menu.hidden = true;
    previous.button.setAttribute("aria-expanded", "false");
    openMenu = null;
    if (restoreFocus) previous.button.focus({ preventScroll: true });
  }

  function positionOpenMenu() {
    if (!openMenu) return;
    const { button, menu } = openMenu;
    const margin = 12;
    const anchor = button.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    menu.style.position = "fixed";
    menu.style.maxWidth = `${Math.max(0, viewportWidth - margin * 2)}px`;
    menu.style.maxHeight = `${Math.max(0, viewportHeight - margin * 2)}px`;
    menu.style.overflowY = "auto";
    const width = menu.getBoundingClientRect().width;
    const spaceBelow = viewportHeight - anchor.bottom - margin - 8;
    const spaceAbove = anchor.top - margin - 8;
    const height = menu.scrollHeight;
    const below = spaceBelow >= height || spaceBelow >= spaceAbove;
    menu.style.maxHeight = `${Math.max(0, below ? spaceBelow : spaceAbove)}px`;
    const measuredHeight = menu.getBoundingClientRect().height;
    const left = Math.max(margin, Math.min(anchor.left, viewportWidth - width - margin));
    const desiredTop = below ? anchor.bottom + 8 : anchor.top - measuredHeight - 8;
    const top = Math.max(margin, Math.min(desiredTop, viewportHeight - measuredHeight - margin));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.bottom = "auto";
  }

  function showMenu(entry, focus = true, last = false) {
    if (openMenu === entry) {
      closeMenu(true);
      return;
    }
    closeMenu();
    openMenu = entry;
    entry.menu.hidden = false;
    entry.button.setAttribute("aria-expanded", "true");
    positionOpenMenu();
    if (focus) {
      const items = all('[role="menuitemradio"]', entry.menu);
      const selected = last ? items.at(-1) : items.find((item) => item.getAttribute("aria-checked") === "true") || items[0];
      selected?.focus({ preventScroll: true });
    }
  }

  for (const entry of menuEntries) {
    entry.button.addEventListener("click", () => showMenu(entry));
    entry.button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      if (openMenu === entry) {
        const items = all('[role="menuitemradio"]', entry.menu);
        (event.key === "ArrowUp" ? items.at(-1) : items[0])?.focus({ preventScroll: true });
      } else showMenu(entry, true, event.key === "ArrowUp");
    });
    entry.menu.addEventListener("click", (event) => {
      const item = event.target.closest(`[data-${entry.key}]`);
      if (!item) return;
      currentSession()[entry.key] = item.dataset[entry.key];
      syncComposer();
      closeMenu(true);
    });
    entry.menu.addEventListener("keydown", (event) => {
      const items = all('[role="menuitemradio"]', entry.menu);
      const index = items.indexOf(document.activeElement);
      let next;
      if (event.key === "ArrowDown") next = (index + 1) % items.length;
      else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      items[next].focus({ preventScroll: true });
      items[next].scrollIntoView({ block: "nearest" });
    });
  }

  const demo = { phase: "fixture", completed: 1, timer: null, deadline: 0, remaining: 1200 };

  function taskSymbol(node, state) {
    node.className = `task-symbol ${state}`;
    if (state === "complete") node.replaceChildren(icon("check"));
    else if (state === "paused") node.replaceChildren(icon("pause"));
    else if (state === "running") node.replaceChildren(make("span", "mini-spinner"));
    else node.replaceChildren();
  }

  function renderDemo() {
    const running = demo.phase === "running" || demo.phase === "fixture";
    const complete = demo.completed === 3;
    const fixture = Boolean(currentSession().fixture);
    root.dataset.runState = demo.phase;
    root.dataset.phase = String(demo.completed);
    for (const node of all("[data-phase-node]")) {
      const phase = Number(node.dataset.phaseNode);
      node.dataset.state = phase < demo.completed ? "complete" : phase === demo.completed ? "active" : "pending";
    }
    byId("task-fraction").textContent = fixture ? `${demo.completed} / 3` : "无任务";
    for (const task of all("[data-task]")) {
      const index = Number(task.dataset.task);
      const state = index < demo.completed ? "complete" : index === demo.completed ? running ? "running" : "paused" : "pending";
      task.classList.toggle("is-running", state === "running");
      task.classList.toggle("is-complete", state === "complete");
      task.dataset.state = state;
      taskSymbol(task.querySelector(".task-symbol"), state);
      task.querySelector(".task-state").textContent = {
        complete: "已完成", running: "进行中", paused: "已暂停", pending: "待执行",
      }[state];
    }
    const label = complete ? "示例已完成 · 3 项任务" : demo.phase === "paused" ? "示例已暂停" : demo.completed === 2 ? "示例：正在运行回归检查" : "示例：正在核对边界条件";
    byId("working-label").textContent = label;
    byId("working-indicator").classList.toggle("is-paused", demo.phase === "paused");
    byId("working-indicator").classList.toggle("is-complete", complete);
    byId("working-indicator").querySelector(".working-mark").hidden = !running;
    byId("active-tool-label").textContent = complete ? "示例回归检查完成" : demo.completed === 2 ? "运行示例回归检查" : "核对记录合并边界";
    byId("active-tool-code").textContent = demo.completed >= 2 ? "pnpm test -- dedup" : "memory.deduplicate";
    byId("active-tool-state").textContent = complete ? "已完成" : demo.phase === "paused" ? "已暂停" : "进行中";
    const activeActivity = document.querySelector(".active-activity");
    const node = activeActivity.querySelector(".activity-node");
    node.className = `activity-node ${complete ? "complete" : running ? "running" : "paused"}`;
    node.replaceChildren(complete ? icon("check") : running ? make("span", "mini-spinner") : icon("pause"));
    activeActivity.classList.toggle("is-complete", complete);
    activeActivity.classList.toggle("is-paused", demo.phase === "paused");
    byId("child-agent-state").textContent = complete ? "示例已完成" : demo.completed === 2 ? demo.phase === "paused" ? "已暂停" : "示例检查中" : "等待验证";
    const terminal = byId("terminal-active");
    const terminalMark = make("span", complete ? "terminal-ok" : "terminal-wait", complete ? "PASS" : ">");
    const terminalText = complete ? " 示例结果：3 项检查通过（未执行真实命令）" : demo.phase === "paused" ? " 示例执行已暂停" : demo.completed === 2 ? " 示例：正在检查检索结果" : " 示例：正在检查内容更新边界";
    terminal.replaceChildren(terminalMark, document.createTextNode(terminalText));
    if (running) terminal.append(make("span", "terminal-cursor"));
    const action = complete ? "重播" : running ? "暂停" : "继续";
    const actionTitle = `${action}示例执行`;
    byId("pause-run").replaceChildren(icon(running ? "pause" : "play"), make("span", "", action));
    byId("pause-run").title = actionTitle;
    byId("pause-run").setAttribute("aria-label", actionTitle);
    byId("replay-button").replaceChildren(icon(demo.phase === "running" ? "pause" : "play"));
    const replayTitle = demo.phase === "fixture" ? "播放示例执行" : demo.phase === "running" ? "暂停示例执行" : complete ? "重播示例执行" : "继续示例执行";
    byId("replay-button").disabled = !fixture;
    byId("replay-button").title = fixture ? replayTitle : "当前会话没有示例任务";
    byId("replay-button").setAttribute("aria-label", fixture ? replayTitle : "当前会话没有示例任务");
    const sessionDot = document.querySelector('[data-session="memory"] .session-dot');
    sessionDot?.classList.toggle("running", running);
  }

  function pauseDemo() {
    if (demo.phase === "complete" || demo.phase === "paused") return;
    if (demo.timer !== null) {
      demo.remaining = Math.max(0, demo.deadline - Date.now());
      clearTimeout(demo.timer);
      demo.timer = null;
    }
    demo.phase = "paused";
    renderDemo();
  }

  function scheduleDemo() {
    if (document.hidden || demo.phase !== "running") return;
    demo.deadline = Date.now() + demo.remaining;
    demo.timer = setTimeout(() => {
      demo.timer = null;
      if (document.hidden) {
        pauseDemo();
        return;
      }
      demo.completed += 1;
      demo.phase = demo.completed === 3 ? "complete" : "running";
      demo.remaining = 1500;
      renderDemo();
      if (demo.phase === "running") scheduleDemo();
    }, demo.remaining);
  }

  function playDemo() {
    if (demo.phase === "running") {
      pauseDemo();
      return;
    }
    if (demo.phase === "complete") {
      demo.completed = 1;
      demo.remaining = 1200;
    }
    if (document.hidden) {
      demo.phase = "paused";
      renderDemo();
      return;
    }
    demo.phase = "running";
    renderDemo();
    scheduleDemo();
  }

  const dialogTriggers = new Map();

  function openDialog(id, trigger) {
    closeMenu();
    closeDrawers();
    syncAppearance();
    const dialog = byId(id);
    dialogTriggers.set(dialog, trigger);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      dialogTriggers.get(dialog)?.focus({ preventScroll: true });
    }
  }

  for (const dialog of all("dialog")) {
    dialog.addEventListener("close", () => dialogTriggers.get(dialog)?.focus({ preventScroll: true }));
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
    });
  }

  for (const button of all("[data-style-choice]")) button.addEventListener("click", () => setAppearance("style", button.dataset.styleChoice));
  for (const button of all("[data-view-choice]")) button.addEventListener("click", () => setView(button.dataset.viewChoice));
  for (const button of all("[data-rail-view]")) button.addEventListener("click", () => setView(button.dataset.railView));
  byId("theme-toggle").addEventListener("click", () => setAppearance("theme", options.theme === "night" ? "day" : "night"));
  byId("motion-select").addEventListener("change", (event) => setAppearance("motion", event.target.value));
  for (const key of ["style", "theme", "motion"]) {
    byId(`dialog-${key}`).addEventListener("change", (event) => setAppearance(key, event.target.value));
  }
  byId("settings-button").addEventListener("click", (event) => openDialog("settings-dialog", event.currentTarget));
  byId("info-button").addEventListener("click", (event) => openDialog("info-dialog", event.currentTarget));
  for (const button of all("[data-close-dialog]")) button.addEventListener("click", () => closeDialog(button.closest("dialog")));
  byId("open-sessions").addEventListener("click", () => {
    closeMenu();
    if (sessionsUseDrawer()) {
      const opening = !sessionsOpen;
      closeDrawers();
      sessionsOpen = opening;
      drawerTrigger = opening ? byId("open-sessions") : null;
    } else sessionsVisible = !sessionsVisible;
    syncPanels();
    if (sessionsUseDrawer() && sessionsOpen) byId("session-search").focus({ preventScroll: true });
  });
  byId("close-sessions").addEventListener("click", () => {
    if (sessionsUseDrawer()) closeDrawers(true);
    else {
      sessionsVisible = false;
      syncPanels();
      byId("open-sessions").focus({ preventScroll: true });
    }
  });
  byId("inspector-toggle").addEventListener("click", () => {
    if (inspectorForcedInline()) {
      setView("chat");
      byId("inspector-toggle").focus({ preventScroll: true });
    } else if (inspectorUsesDrawer()) {
      if (inspectorOpen) closeDrawers(true);
      else openInspector(true);
    } else {
      inspectorVisible = !inspectorVisible;
      syncPanels();
    }
  });
  byId("close-inspector").addEventListener("click", () => {
    if (inspectorForcedInline()) setView("chat");
    else if (inspectorUsesDrawer()) closeDrawers(true);
    else {
      inspectorVisible = false;
      syncPanels();
      byId("inspector-toggle").focus({ preventScroll: true });
    }
  });
  byId("drawer-scrim").addEventListener("click", () => closeDrawers(true));
  for (const tab of inspectorTabs) tab.addEventListener("click", () => selectInspectorTab(tab.dataset.inspectorTab));
  document.querySelector(".inspector-tabs").addEventListener("keydown", (event) => {
    const current = inspectorTabs.findIndex((tab) => tab.dataset.inspectorTab === inspectorTab);
    let next;
    if (event.key === "ArrowRight") next = (current + 1) % inspectorTabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + inspectorTabs.length) % inspectorTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = inspectorTabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectInspectorTab(inspectorTabs[next].dataset.inspectorTab, true);
  });
  for (const button of all("[data-open-file]")) button.addEventListener("click", () => openFile(button.dataset.openFile));
  byId("rail-terminal").addEventListener("click", () => {
    selectInspectorTab("terminal");
    openInspector(true);
  });
  byId("rail-files").addEventListener("click", () => {
    selectInspectorTab("files");
    openInspector(true);
  });
  byId("session-search").addEventListener("input", renderSessionList);
  byId("session-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-session]");
    if (button) switchSession(button.dataset.session);
  });
  byId("new-session").addEventListener("click", () => {
    newSessionCount += 1;
    const id = `new-${newSessionCount}`;
    const existing = currentSession();
    sessions.unshift({
      id, title: `新对话 ${newSessionCount}`, summary: "当前页面内的演示草稿", time: "现在",
      draft: "", reference: false, messages: [],
      model: existing.model, agent: existing.agent, permission: existing.permission, reasoning: existing.reasoning,
    });
    byId("session-search").value = "";
    setView("chat");
    switchSession(id, true);
  });
  byId("home-button").addEventListener("click", () => {
    byId("session-search").value = "";
    setView("chat");
    switchSession("memory");
  });
  byId("composer-input").addEventListener("input", (event) => {
    currentSession().draft = event.target.value;
    byId("send-button").disabled = !event.target.value.trim();
  });
  byId("composer-input").addEventListener("compositionstart", () => { composing = true; });
  byId("composer-input").addEventListener("compositionend", () => {
    composing = false;
    currentSession().draft = byId("composer-input").value;
    byId("send-button").disabled = !currentSession().draft.trim();
  });
  byId("composer-input").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.ctrlKey || event.isComposing || composing || event.keyCode === 229) return;
    event.preventDefault();
    sendMessage();
  });
  byId("composer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });
  byId("attach-button").addEventListener("click", () => {
    currentSession().reference = !currentSession().reference;
    syncComposer();
    toast(currentSession().reference ? "已添加示例文件引用" : "已移除示例引用");
  });
  byId("permission-button").addEventListener("click", () => {
    currentSession().permission = currentSession().permission === "approval" ? "full" : "approval";
    syncComposer();
    toast(`示例权限：${currentSession().permission === "approval" ? "请求批准" : "完全访问"}`);
  });
  byId("reasoning-button").addEventListener("click", () => {
    currentSession().reasoning = (currentSession().reasoning + 1) % reasoningLevels.length;
    syncComposer();
  });
  byId("pause-run").addEventListener("click", () => {
    if (demo.phase === "fixture" || demo.phase === "running") pauseDemo();
    else playDemo();
  });
  byId("replay-button").addEventListener("click", playDemo);
  byId("copy-code").addEventListener("click", async () => {
    const button = byId("copy-code");
    const text = files[selectedFile].lines
      .filter(([, , change]) => change !== "removed")
      .map(([, line, change]) => change === "added" ? line.slice(1) : line)
      .join("\n");
    button.disabled = true;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      const field = make("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.setAttribute("aria-hidden", "true");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.append(field);
      field.select();
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      field.remove();
    }
    button.disabled = false;
    button.focus({ preventScroll: true });
    toast(copied ? "已复制示例代码" : "浏览器未允许复制，请选中示例代码后按 Ctrl+C");
  });
  document.addEventListener("pointerdown", (event) => {
    if (openMenu && !openMenu.menu.contains(event.target) && !openMenu.button.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openMenu) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab" && openMenu) {
      const trigger = openMenu.button;
      closeMenu();
      trigger.focus({ preventScroll: true });
    }
    const drawer = activeDrawer();
    if (!drawer || document.querySelector("dialog[open]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawers(true);
    } else if (event.key === "Tab") {
      const panel = drawer;
      const focusable = all('button, input, select, textarea, summary, a[href], [tabindex="0"]', panel)
        .filter((element) => !element.disabled && element.getClientRects().length > 0 && !element.closest("[hidden]"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      }
    }
  });
  window.addEventListener("resize", () => {
    syncPanels();
    positionOpenMenu();
  });
  document.addEventListener("scroll", positionOpenMenu, true);
  document.addEventListener("visibilitychange", () => {
    root.dataset.background = document.hidden ? "yes" : "no";
    if (document.hidden && demo.phase === "running") pauseDemo();
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(toastTimer);
    if (demo.phase === "running") pauseDemo();
  });

  mountIcons();
  syncAppearance();
  syncPanels();
  selectInspectorTab("changes");
  renderFile("local-store");
  renderSessionList();
  renderMessages();
  syncComposer();
  root.dataset.background = document.hidden ? "yes" : "no";
  root.dataset.sessionKind = "memory";
  document.querySelector(".task-dock-heading strong").textContent = "示例任务";
  document.querySelector(".activity-heading > span").textContent = "示例执行记录";
  byId("working-label").setAttribute("aria-live", "polite");
  renderDemo();
})();
