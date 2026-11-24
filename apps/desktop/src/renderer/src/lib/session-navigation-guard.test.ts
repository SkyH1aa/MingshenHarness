import { DOMImplementation } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  type SessionNavigationDocument,
  type SessionNavigationGuardInput,
  sessionNavigationBlock,
} from "./session-navigation-guard";

function fixture() {
  const document = new DOMImplementation().createDocument(null, "body", null);
  const root = document.documentElement;

  const add = (className: string, attributes: Record<string, string> = {}) => {
    const element = document.createElement("div");
    element.setAttribute("class", className);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    root.appendChild(element);
    return element;
  };

  const query: SessionNavigationDocument = {
    querySelector(selector) {
      const match = /^\.([\w-]+)\[([\w-]+)="([^"]*)"\]$/.exec(selector);
      if (!match) throw new Error(`Unsupported selector: ${selector}`);
      const [, className, name, value] = match;
      if (!className || !name || value === undefined) {
        throw new Error(`Incomplete selector: ${selector}`);
      }
      const elements = document.getElementsByTagName("*");
      for (let i = 0; i < elements.length; i += 1) {
        const element = elements.item(i);
        if (
          element?.getAttribute("class")?.split(/\s+/).includes(className) &&
          element.hasAttribute(name) &&
          element.getAttribute(name) === value
        )
          return {
            getAttribute: (attribute) =>
              element.hasAttribute(attribute) ? element.getAttribute(attribute) : null,
          };
      }
      return null;
    },
  };

  const input: SessionNavigationGuardInput = {
    document: query,
    selectedSessionId: "current",
    currentRoot: "C:\\work\\project",
    targetSessionId: "target",
    targetRoot: "C:\\work\\project",
    busy: false,
    leavingStudio: false,
  };
  return { add, input };
}

describe("session navigation guard", () => {
  it("permits navigation without pending edits", () => {
    const { input } = fixture();
    expect(sessionNavigationBlock(input)).toBeNull();
  });

  it("blocks while the caller is busy", () => {
    const { input } = fixture();
    expect(sessionNavigationBlock({ ...input, busy: true })).toEqual({
      reason: "busy",
      sessionId: null,
    });
  });

  it("protects a plan belonging to another session", () => {
    const { add, input } = fixture();
    add("task-workbench", { "data-unsaved": "true", "data-task-session": "current" });
    expect(sessionNavigationBlock(input)).toEqual({
      reason: "unsaved_plan",
      sessionId: "current",
    });
    expect(sessionNavigationBlock({ ...input, targetSessionId: "current" })).toBeNull();
  });

  it("protects a plan whose owning session is missing", () => {
    const { add, input } = fixture();
    add("task-workbench", { "data-unsaved": "true" });
    expect(sessionNavigationBlock({ ...input, targetSessionId: null })).toEqual({
      reason: "unsaved_plan",
      sessionId: null,
    });
  });

  it.each(["message--user", "project-diary"])(
    "protects unsaved %s when the selected session changes",
    (className) => {
      const { add, input } = fixture();
      add(className, { "data-unsaved": "true" });
      expect(sessionNavigationBlock(input)).toEqual({ reason: "unsaved_edits", sessionId: null });
      expect(sessionNavigationBlock({ ...input, targetSessionId: "current" })).toBeNull();
    },
  );

  it.each(["message--user", "project-diary"])(
    "protects a hidden mounted %s editor, while allowing the same session",
    (className) => {
      const { add, input } = fixture();
      add(className, { "data-unsaved": "true", hidden: "" });
      expect(sessionNavigationBlock(input)).toEqual({ reason: "unsaved_edits", sessionId: null });
      expect(sessionNavigationBlock({ ...input, targetSessionId: "current" })).toBeNull();
    },
  );

  it("ignores clean editors and unrelated unsaved elements", () => {
    const { add, input } = fixture();
    add("message--user", { "data-unsaved": "false" });
    add("message--assistant", { "data-unsaved": "true" });
    add("project-diary", { "data-unsaved": "false" });
    add("workspace-panel", { "data-unsaved": "false" });
    add("task-workbench", { "data-unsaved": "false", "data-task-session": "current" });
    expect(sessionNavigationBlock(input)).toBeNull();
  });

  it("protects a file edit only when the target root is known and different", () => {
    const { add, input } = fixture();
    add("workspace-panel", { "data-unsaved": "true" });
    expect(sessionNavigationBlock(input)).toBeNull();
    expect(sessionNavigationBlock({ ...input, targetRoot: undefined })).toBeNull();
    expect(sessionNavigationBlock({ ...input, targetRoot: "C:\\work\\other" })).toEqual({
      reason: "unsaved_edits",
      sessionId: null,
    });
    expect(sessionNavigationBlock({ ...input, targetRoot: null })).toEqual({
      reason: "unsaved_edits",
      sessionId: null,
    });
  });

  it("protects a hidden mounted file editor across roots", () => {
    const { add, input } = fixture();
    add("workspace-panel", { "data-unsaved": "true", hidden: "" });
    expect(sessionNavigationBlock(input)).toBeNull();
    expect(sessionNavigationBlock({ ...input, targetRoot: "C:\\work\\other" })).toEqual({
      reason: "unsaved_edits",
      sessionId: null,
    });
  });

  it("compares root strings as the workspace panel does", () => {
    const { add, input } = fixture();
    add("workspace-panel", { "data-unsaved": "true" });
    expect(sessionNavigationBlock({ ...input, targetRoot: "c:\\work\\project" })).toEqual({
      reason: "unsaved_edits",
      sessionId: null,
    });
    expect(sessionNavigationBlock({ ...input, currentRoot: null, targetRoot: null })).toBeNull();
  });

  it("blocks an image operation when leaving even for the selected session", () => {
    const { add, input } = fixture();
    add("image-studio", { "data-navigation-busy": "true" });
    const sameSession = { ...input, targetSessionId: "current" };
    expect(sessionNavigationBlock(sameSession)).toBeNull();
    expect(sessionNavigationBlock({ ...sameSession, leavingStudio: true })).toEqual({
      reason: "busy",
      sessionId: null,
    });
  });

  it("does not let a hidden background image request block session navigation", () => {
    const { add, input } = fixture();
    add("image-studio", { "data-navigation-busy": "false" });
    expect(
      sessionNavigationBlock({ ...input, targetSessionId: "next", leavingStudio: true }),
    ).toBeNull();
  });

  it.each(["image-studio", "creative-workstation"])(
    "protects unsaved %s content when leaving even for the selected session",
    (className) => {
      const { add, input } = fixture();
      add(className, { "data-navigation-unsaved": "true" });
      const sameSession = { ...input, targetSessionId: "current" };
      expect(sessionNavigationBlock(sameSession)).toBeNull();
      expect(sessionNavigationBlock({ ...sameSession, leavingStudio: true })).toEqual({
        reason: "unsaved_edits",
        sessionId: null,
      });
    },
  );

  it("prioritizes busy, then a plan, then other unsaved edits", () => {
    const { add, input } = fixture();
    const image = add("image-studio", {
      "data-navigation-busy": "true",
      "data-navigation-unsaved": "true",
    });
    const plan = add("task-workbench", {
      "data-unsaved": "true",
      "data-task-session": "current",
    });
    add("message--user", { "data-unsaved": "true" });
    const leavingStudio = { ...input, leavingStudio: true };
    expect(sessionNavigationBlock(leavingStudio)).toEqual({ reason: "busy", sessionId: null });
    image.setAttribute("data-navigation-busy", "false");
    expect(sessionNavigationBlock(leavingStudio)).toEqual({
      reason: "unsaved_plan",
      sessionId: "current",
    });
    plan.setAttribute("data-unsaved", "false");
    expect(sessionNavigationBlock(leavingStudio)).toEqual({
      reason: "unsaved_edits",
      sessionId: null,
    });
  });
});
