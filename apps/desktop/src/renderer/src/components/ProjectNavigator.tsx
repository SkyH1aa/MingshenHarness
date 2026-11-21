import { Folder } from "lucide-react";
import { useLocale } from "../i18n";
import "./ProjectNavigator.css";

export interface ProjectNavigatorItem {
  workspacePath: string;
  label: string;
  unreadCount: number;
  active: boolean;
}

export interface ProjectNavigatorProps {
  projects: readonly ProjectNavigatorItem[];
  activeWorkspacePath?: string | null | undefined;
  onSelectProject: (workspacePath: string) => void;
  className?: string | undefined;
}

function projectInitials(label: string): string {
  const words = label
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length > 1)
    return words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("");
  return Array.from(label.trim()).slice(0, 2).join("").toLocaleUpperCase();
}

export function ProjectNavigator({
  projects,
  activeWorkspacePath,
  onSelectProject,
  className,
}: ProjectNavigatorProps) {
  const en = useLocale() === "en";
  if (!projects.length) return null;
  return (
    <nav
      className={["project-navigator", className].filter(Boolean).join(" ")}
      data-testid="project-navigator"
      aria-label={en ? "Projects" : "项目"}
    >
      {projects.map((project) => {
        const active =
          project.active ||
          Boolean(
            activeWorkspacePath &&
              project.workspacePath.replaceAll("\\", "/").toLocaleLowerCase() ===
                activeWorkspacePath.replaceAll("\\", "/").toLocaleLowerCase(),
          );
        return (
          <button
            className="project-navigator__item"
            data-active={active ? "true" : "false"}
            data-project-path={project.workspacePath}
            data-unread-count={project.unreadCount}
            type="button"
            key={project.workspacePath}
            title={`${project.label}\n${project.workspacePath}`}
            aria-label={
              project.unreadCount
                ? en
                  ? `${project.label}, ${project.unreadCount} unread`
                  : `${project.label}，${project.unreadCount} 个未读`
                : project.label
            }
            aria-current={active ? "page" : undefined}
            onClick={() => onSelectProject(project.workspacePath)}
          >
            <Folder aria-hidden="true" size={13} />
            <span aria-hidden="true">{projectInitials(project.label) || "?"}</span>
            {project.unreadCount > 0 ? (
              <strong aria-hidden="true">
                {project.unreadCount > 99 ? "99+" : project.unreadCount}
              </strong>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
