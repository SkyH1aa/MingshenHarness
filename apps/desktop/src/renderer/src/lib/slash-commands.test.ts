import { describe, expect, it, vi } from "vitest";
import type { CustomCommandView, ExtensionView } from "../../../shared/domain";
import { parseBuiltinCommand, slashItems } from "./slash-commands";

vi.mock("../i18n/index", () => ({ tr: (text: string) => text }));

describe("composer slash commands", () => {
  it("reserves builtins, filters, and leaves paths and normal text alone", () => {
    expect(parseBuiltinCommand("/rename New title")).toEqual({
      command: "rename",
      argument: "New title",
    });
    expect(parseBuiltinCommand("/COMPACT")).toEqual({ command: "compact", argument: "" });
    expect(parseBuiltinCommand("Discuss /compact")).toBeNull();
    expect(slashItems("/foo/bar", [], [])).toBeNull();
    expect(slashItems("line\n/compact", [], [])).toBeNull();
    const commands = [
      { id: "collision", name: "compact", description: "Unsafe custom" },
      { id: "review", name: "review", description: "Review" },
    ] as CustomCommandView[];
    expect(slashItems("/compact", commands, [])).toHaveLength(1);
    expect(slashItems("/rev", commands, [])?.[0]?.kind).toBe("custom");
    expect(slashItems("/", commands, [])?.some((item) => item.command === "fork")).toBe(true);
  });
  it("keeps skill and plugin references separate and includes an import recovery action", () => {
    const extensions = [
      { id: "s", type: "skill", name: "Design", description: "UI", enabled: true },
      { id: "p", type: "plugin", name: "GitHub", description: "API", enabled: true },
      { id: "disabled", type: "skill", name: "Disabled", enabled: false },
    ] as ExtensionView[];
    expect(slashItems("/skills ", [], extensions)?.map((item) => item.id)).toEqual([
      "s",
      "manage-extensions",
    ]);
    expect(slashItems("/plugins Git", [], extensions)?.[0]?.id).toBe("p");
    expect(slashItems("/skills unknown", [], extensions)?.[0]?.kind).toBe("manage");
  });
});
