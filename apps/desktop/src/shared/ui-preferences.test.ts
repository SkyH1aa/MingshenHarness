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
  it("keeps legacy layouts unchanged when task panel preferences are absent", () => {
    const legacy = {
      mode: "code",
      sidebarWidth: 228,
      inspectorWidth: 360,
      sidebarOpen: true,
      inspectorOpen: true,
    };
    const saved = normalizeUiPreferences({ projects: { "@orbit:c:\\work": legacy } });
    expect(saved.projects["@orbit:c:\\work"]).toEqual(legacy);
    expect(saved.projects["@orbit:c:\\work"]).not.toHaveProperty("taskPanelHeight");
    expect(saved.projects["@orbit:c:\\work"]).not.toHaveProperty("taskPanelCollapsed");
  });
  it("clamps and rounds valid task panel heights and ignores invalid values", () => {
    const projects = Object.fromEntries(
      [
        ["low", -1],
        ["minimum", 160],
        ["fractional", 255.5],
        ["maximum", 640],
        ["high", 9999],
        ["nan", Number.NaN],
        ["positiveInfinity", Number.POSITIVE_INFINITY],
        ["negativeInfinity", Number.NEGATIVE_INFINITY],
        ["string", "240"],
        ["null", null],
        ["array", [240]],
      ].map(([key, taskPanelHeight]) => [key, { taskPanelHeight }]),
    );
    const normalized = normalizeUiPreferences({ projects }).projects;
    expect(normalized.low?.taskPanelHeight).toBe(160);
    expect(normalized.minimum?.taskPanelHeight).toBe(160);
    expect(normalized.fractional?.taskPanelHeight).toBe(256);
    expect(normalized.maximum?.taskPanelHeight).toBe(640);
    expect(normalized.high?.taskPanelHeight).toBe(640);
    for (const key of ["nan", "positiveInfinity", "negativeInfinity", "string", "null", "array"]) {
      expect(normalized[key]).not.toHaveProperty("taskPanelHeight");
    }
  });
  it("retains only explicit boolean task panel visibility preferences", () => {
    const projects = Object.fromEntries(
      [true, false, "true", 1, null, {}, []].map((taskPanelCollapsed, index) => [
        `p${index}`,
        { taskPanelCollapsed },
      ]),
    );
    const normalized = normalizeUiPreferences({ projects }).projects;
    expect(normalized.p0?.taskPanelCollapsed).toBe(true);
    expect(normalized.p1?.taskPanelCollapsed).toBe(false);
    for (let index = 2; index < 7; index += 1) {
      expect(normalized[`p${index}`]).not.toHaveProperty("taskPanelCollapsed");
    }
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
  it("round-trips task panel preferences independently for each project and style", () => {
    const simpleKey = projectLayoutKey("C:/Work/A");
    const orbitKey = projectLayoutKey("C:/Work/A", "orbit");
    const otherOrbitKey = projectLayoutKey("C:/Work/B", "orbit");
    const saved = normalizeUiPreferences({
      projects: {
        [simpleKey]: { sidebarWidth: 300 },
        [orbitKey]: { taskPanelHeight: 320.8, taskPanelCollapsed: true },
        [otherOrbitKey]: { taskPanelHeight: 200, taskPanelCollapsed: false },
      },
    });
    const restored = normalizeUiPreferences(JSON.parse(JSON.stringify(saved)));
    expect(restored.projects[simpleKey]).not.toHaveProperty("taskPanelHeight");
    expect(restored.projects[simpleKey]).not.toHaveProperty("taskPanelCollapsed");
    expect(restored.projects[orbitKey]).toMatchObject({
      taskPanelHeight: 321,
      taskPanelCollapsed: true,
    });
    expect(restored.projects[otherOrbitKey]).toMatchObject({
      taskPanelHeight: 200,
      taskPanelCollapsed: false,
    });
  });
});
