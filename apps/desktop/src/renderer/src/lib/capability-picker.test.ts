import { describe, expect, it } from "vitest";
import {
  builtinCapabilityMeta,
  builtinCapabilitySourceDetail,
  capabilityMatchesQuery,
  capabilitySelectionCounts,
} from "./capability-picker";

describe("capability picker", () => {
  it("searches built-in metadata with every query term", () => {
    const capability = {
      id: "builtin:work-ppt-master",
      name: "PPT Master",
      description: "Create polished presentation decks",
      family: "presentations",
      version: "1.2.0",
      compatibility: "native",
      sourcePath: "presentations/skills/ppt-master",
      sourceSha256: "0123456789abcdef".repeat(4),
    };

    expect(capabilityMatchesQuery(capability, "ppt presentation")).toBe(true);
    expect(capabilityMatchesQuery(capability, "1.2 native")).toBe(true);
    expect(capabilityMatchesQuery(capability, "ppt-master 012345")).toBe(true);
    expect(capabilityMatchesQuery(capability, "PPTMaster")).toBe(true);
    expect(capabilityMatchesQuery(capability, "work_ppt-master")).toBe(true);
    expect(capabilityMatchesQuery(capability, "spreadsheet")).toBe(false);
    expect(capabilityMatchesQuery(capability, "   ")).toBe(true);
    expect(
      capabilityMatchesQuery(
        {
          id: "builtin:work-asd-ste100",
          name: "work-asd-ste100",
          description: "Controlled technical English",
        },
        "asdste100",
      ),
    ).toBe(true);
  });

  it("summarizes built-in and installed selections independently", () => {
    expect(
      capabilitySelectionCounts(
        [{ selected: true }, { selected: false }, { selected: true }],
        ["a", "a", "b"],
      ),
    ).toEqual({ builtin: 2, installed: 2, total: 4 });
  });

  it("uses version, compatibility, then family as compact metadata", () => {
    expect(
      builtinCapabilityMeta({
        family: "presentations",
        version: "1.2.0",
        compatibility: "native",
      }),
    ).toBe("v1.2.0");
    expect(
      builtinCapabilityMeta({
        family: "presentations",
        version: null,
        compatibility: "adapted",
      }),
    ).toBe("adapted");
    expect(
      builtinCapabilityMeta({
        family: "presentations",
        version: null,
        compatibility: null,
      }),
    ).toBe("presentations");
  });

  it("shows a short source fingerprint for same-name capabilities", () => {
    expect(
      builtinCapabilitySourceDetail({
        sourcePath: "pdf/pdf-viewer/0.2.1/SKILL.md",
        sourceSha256: "0123456789abcdef".repeat(4),
      }),
    ).toBe("pdf/pdf-viewer/0.2.1/SKILL.md · 0123456789ab");
  });
});
