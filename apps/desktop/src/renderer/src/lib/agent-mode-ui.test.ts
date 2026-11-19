import { describe, expect, it } from "vitest";
import {
  isAllowedChatAttachment,
  profileApplicableModes,
  profileSupportsAgentMode,
  updateSessionLockSet,
} from "./agent-mode-ui";

describe("agent mode UI rules", () => {
  it("keeps legacy profiles applicable to both workspace modes", () => {
    expect(profileApplicableModes({})).toEqual(["code", "work"]);
    expect(profileSupportsAgentMode({}, "code")).toBe(true);
    expect(profileSupportsAgentMode({}, "work")).toBe(true);
  });

  it("filters custom profiles by their declared workspace modes", () => {
    const profile: { applicableModes?: Array<"code" | "work"> } = {
      applicableModes: ["work"],
    };
    expect(profileSupportsAgentMode(profile, "work")).toBe(true);
    expect(profileSupportsAgentMode(profile, "code")).toBe(false);
  });

  it("allows only raster images and office-document attachments in ChatAgent", () => {
    expect(isAllowedChatAttachment({ name: "screen.png", type: "image/png" })).toBe(true);
    expect(isAllowedChatAttachment({ name: "photo.jpg", type: "image/jpeg" })).toBe(true);
    expect(isAllowedChatAttachment({ name: "brief.PDF", type: "" })).toBe(true);
    expect(isAllowedChatAttachment({ name: "notes.doc", type: "" })).toBe(true);
    expect(isAllowedChatAttachment({ name: "model.xlsx", type: "" })).toBe(true);
    expect(isAllowedChatAttachment({ name: "deck.pptx", type: "" })).toBe(true);
    expect(isAllowedChatAttachment({ name: "legacy.ppt", type: "" })).toBe(false);
    expect(isAllowedChatAttachment({ name: "vector.svg", type: "image/svg+xml" })).toBe(false);
    expect(isAllowedChatAttachment({ name: "script.ts", type: "text/plain" })).toBe(false);
    expect(isAllowedChatAttachment({ name: "voice.mp3", type: "audio/mpeg" })).toBe(false);
  });

  it("updates mode locks per session without releasing another session", () => {
    const initial = new Set(["session-a"]);
    const both = updateSessionLockSet(initial, "session-b", true);
    const onlyB = updateSessionLockSet(both, "session-a", false);

    expect([...initial]).toEqual(["session-a"]);
    expect([...both]).toEqual(["session-a", "session-b"]);
    expect([...onlyB]).toEqual(["session-b"]);
    expect(updateSessionLockSet(onlyB, "missing", false)).toBe(onlyB);
  });
});
