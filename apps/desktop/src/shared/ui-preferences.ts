export type WorkbenchLayout = "chat" | "code" | "agents";
export type InterfaceStyle = "simple" | "orbit";
export interface ProjectLayout {
  mode: WorkbenchLayout;
  sidebarWidth: number;
  inspectorWidth: number;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
}
export interface UiPreferences {
  interfaceStyle: InterfaceStyle;
  defaultLayout: WorkbenchLayout;
  motion: "system" | "off";
  composerRichPaste: boolean;
  projects: Record<string, ProjectLayout>;
}
export const DEFAULT_PROJECT_LAYOUT: ProjectLayout = {
  mode: "chat",
  sidebarWidth: 260,
  inspectorWidth: 460,
  sidebarOpen: true,
  inspectorOpen: false,
};
export function normalizeUiPreferences(
  input: unknown,
  fallbackInterfaceStyle: InterfaceStyle = "simple",
  fallbackComposerRichPaste = true,
): UiPreferences {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const mode = (item: unknown): WorkbenchLayout =>
    item === "code" || item === "agents" ? item : "chat";
  const dimension = (item: unknown, fallback: number, min: number, max: number) =>
    typeof item === "number" && Number.isFinite(item)
      ? Math.round(Math.max(min, Math.min(max, item)))
      : fallback;
  const projects: Record<string, ProjectLayout> = Object.create(null);
  if (value.projects && typeof value.projects === "object") {
    for (const [key, item] of Object.entries(value.projects).slice(-250)) {
      if (!key || key.length > 4096 || !item || typeof item !== "object") continue;
      const project = item as Record<string, unknown>;
      projects[key] = {
        mode: mode(project.mode),
        sidebarWidth: dimension(project.sidebarWidth, 260, 220, 320),
        inspectorWidth: dimension(project.inspectorWidth, 460, 360, 720),
        sidebarOpen: project.sidebarOpen !== false,
        inspectorOpen: project.inspectorOpen === true,
      };
    }
  }
  return {
    interfaceStyle:
      value.interfaceStyle === undefined
        ? fallbackInterfaceStyle
        : value.interfaceStyle === "orbit"
          ? "orbit"
          : "simple",
    defaultLayout: mode(value.defaultLayout),
    motion: value.motion === "off" ? "off" : "system",
    composerRichPaste:
      value.composerRichPaste === undefined
        ? fallbackComposerRichPaste
        : value.composerRichPaste !== false,
    projects,
  };
}
export function projectLayoutKey(
  workspace: string | null,
  style: InterfaceStyle = "simple",
): string {
  const project =
    workspace?.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase() || "@unassigned";
  return style === "orbit" ? `@orbit:${project}` : project;
}
