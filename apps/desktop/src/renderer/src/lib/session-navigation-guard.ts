interface NavigationElement {
  getAttribute(name: string): string | null;
}

export interface SessionNavigationDocument {
  querySelector(selectors: string): NavigationElement | null;
}

export interface SessionNavigationGuardInput {
  document: SessionNavigationDocument;
  selectedSessionId: string | null;
  currentRoot: string | null;
  targetSessionId: string | null;
  targetRoot?: string | null | undefined;
  busy: boolean;
  leavingStudio: boolean;
}

export type SessionNavigationBlock = {
  reason: "busy" | "unsaved_plan" | "unsaved_edits";
  sessionId: string | null;
};

export function sessionNavigationBlock({
  document,
  selectedSessionId,
  currentRoot,
  targetSessionId,
  targetRoot,
  busy,
  leavingStudio,
}: SessionNavigationGuardInput): SessionNavigationBlock | null {
  if (
    busy ||
    (leavingStudio && document.querySelector('.image-studio[data-navigation-busy="true"]'))
  ) {
    return { reason: "busy", sessionId: null };
  }

  const plan = document.querySelector('.task-workbench[data-unsaved="true"]');
  if (plan) {
    const planSessionId = plan.getAttribute("data-task-session");
    if (planSessionId === null || planSessionId !== targetSessionId) {
      return { reason: "unsaved_plan", sessionId: planSessionId };
    }
  }

  if (
    leavingStudio &&
    (document.querySelector('.image-studio[data-navigation-unsaved="true"]') ||
      document.querySelector('.creative-workstation[data-navigation-unsaved="true"]'))
  ) {
    return { reason: "unsaved_edits", sessionId: null };
  }

  if (
    selectedSessionId !== targetSessionId &&
    (document.querySelector('.message--user[data-unsaved="true"]') ||
      document.querySelector('.project-diary[data-unsaved="true"]'))
  ) {
    return { reason: "unsaved_edits", sessionId: null };
  }

  if (
    targetRoot !== undefined &&
    currentRoot !== targetRoot &&
    document.querySelector('.workspace-panel[data-unsaved="true"]')
  ) {
    return { reason: "unsaved_edits", sessionId: null };
  }

  return null;
}
