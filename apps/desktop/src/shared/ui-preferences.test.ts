import { describe, expect, it } from "vitest";
import { normalizeUiPreferences, projectLayoutKey } from "./ui-preferences";

describe("workspace layout preferences", () => {
  it("defaults safely and clamps persisted dimensions", () => {
    expect(normalizeUiPreferences(null)).toMatchObject({
      interfaceStyle: "simple",
      defaultLayout: "chat",
      motion: "system",
      composerRichPaste: true,
      projects: {},
    });
    const result = normalizeUiPreferences({
      defaultLayout: "agents",
      motion: "off",
      projects: {
        project: {
          mode: "code",
          sidebarWidth: -1,
          inspectorWidth: 9999,
          sidebarOpen: false,
          inspectorOpen: true,
        },
        bad: null,
      },
    });
    expect(result.projects.project).toEqual({
      mode: "code",
      sidebarWidth: 220,
      inspectorWidth: 720,
      sidebarOpen: false,
      inspectorOpen: true,
    });
    expect(result.projects.bad).toBeUndefined();
    expect(result.motion).toBe("off");
  });
  it("enables formatted paste for old preferences and preserves an explicit opt-out", () => {
    expect(normalizeUiPreferences({}).composerRichPaste).toBe(true);
    expect(normalizeUiPreferences({ composerRichPaste: true }).composerRichPaste).toBe(true);
    const disabled = normalizeUiPreferences({ composerRichPaste: false });
    expect(disabled.composerRichPaste).toBe(false);
    expect(normalizeUiPreferences({ ...disabled, motion: "off" }).composerRichPaste).toBe(false);
    expect(normalizeUiPreferences(JSON.parse(JSON.stringify(disabled))).composerRichPaste).toBe(
      false,
    );
    for (const composerRichPaste of ["false", 0, null, {}, []]) {
      expect(normalizeUiPreferences({ composerRichPaste }).composerRichPaste).toBe(true);
    }
  });
  it("retains disabled formatted paste in legacy saves without overriding explicit changes", () => {
    const persisted = normalizeUiPreferences({
      interfaceStyle: "orbit",
      composerRichPaste: false,
    });
    const legacy = { defaultLayout: "code", motion: "off", projects: {} };
    expect(
      normalizeUiPreferences(legacy, persisted.interfaceStyle, persisted.composerRichPaste),
    ).toMatchObject({
      interfaceStyle: "orbit",
      composerRichPaste: false,
      defaultLayout: "code",
      motion: "off",
    });
    expect(
      normalizeUiPreferences({ ...legacy, composerRichPaste: true }, "orbit", false)
        .composerRichPaste,
    ).toBe(true);
    expect(
      normalizeUiPreferences({ ...legacy, composerRichPaste: false }, "orbit", true)
        .composerRichPaste,
    ).toBe(false);
    expect(
      normalizeUiPreferences({ ...legacy, composerRichPaste: "false" }, "orbit", false)
        .composerRichPaste,
    ).toBe(true);
  });
  it("accepts both styles and defaults old or invalid saved styles to simple", () => {
    expect(normalizeUiPreferences({}).interfaceStyle).toBe("simple");
    expect(normalizeUiPreferences({ interfaceStyle: "simple" }).interfaceStyle).toBe("simple");
    expect(normalizeUiPreferences({ interfaceStyle: "orbit" }).interfaceStyle).toBe("orbit");
    for (const interfaceStyle of ["unknown", null, false, 2, {}, ["orbit"]]) {
      expect(normalizeUiPreferences({ interfaceStyle }).interfaceStyle).toBe("simple");
    }
  });
  it("preserves the persisted style for legacy saves without overriding explicit choices", () => {
    const persisted = normalizeUiPreferences({ interfaceStyle: "orbit" });
    const legacy = { defaultLayout: "code", motion: "off", projects: {} };
    const updated = normalizeUiPreferences(legacy, persisted.interfaceStyle);
    expect(updated).toMatchObject({
      interfaceStyle: "orbit",
      defaultLayout: "code",
      motion: "off",
    });
    expect(
      normalizeUiPreferences({ ...legacy, interfaceStyle: "simple" }, "orbit").interfaceStyle,
    ).toBe("simple");
    expect(
      normalizeUiPreferences({ ...legacy, interfaceStyle: "invalid" }, "orbit").interfaceStyle,
    ).toBe("simple");
  });
  it("bounds stored projects and rejects non-finite dimensions", () => {
    const projects = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [
        `p${i}`,
        { mode: "invalid", sidebarWidth: Number.NaN, inspectorWidth: Number.POSITIVE_INFINITY },
      ]),
    );
    const result = normalizeUiPreferences({ projects });
    expect(Object.keys(result.projects)).toHaveLength(250);
    expect(result.projects.p299).toMatchObject({
      mode: "chat",
      sidebarWidth: 260,
      inspectorWidth: 460,
    });
  });
  it("maps Windows project spelling consistently without conflating projects", () => {
    expect(projectLayoutKey("C:/Work/MyProject/")).toBe(projectLayoutKey("c:\\work\\myproject"));
    expect(projectLayoutKey(null)).toBe("@unassigned");
    expect(projectLayoutKey("C:/Work/A")).not.toBe(projectLayoutKey("C:/Work/B"));
  });
  it("keeps Light Trails layout choices separate from the original layout", () => {
    expect(projectLayoutKey("C:/Work/A", "orbit")).toBe(projectLayoutKey("c:\\work\\a\\", "orbit"));
    expect(projectLayoutKey("C:/Work/A", "orbit")).not.toBe(projectLayoutKey("C:/Work/A"));
    expect(projectLayoutKey(null, "orbit")).toBe("@orbit:@unassigned");
    const simple = {
      ...normalizeUiPreferences(null),
      projects: {
        [projectLayoutKey("C:/Work/A")]: {
          mode: "chat",
          sidebarWidth: 300,
          inspectorWidth: 600,
          sidebarOpen: false,
          inspectorOpen: false,
        },
        [projectLayoutKey("C:/Work/A", "orbit")]: {
          mode: "code",
          sidebarWidth: 228,
          inspectorWidth: 360,
          sidebarOpen: true,
          inspectorOpen: true,
        },
      },
    };
    const saved = normalizeUiPreferences(simple);
    expect(saved.projects[projectLayoutKey("C:/Work/A")]?.sidebarWidth).toBe(300);
    expect(saved.projects[projectLayoutKey("C:/Work/A", "orbit")]?.sidebarWidth).toBe(228);
  });
});
