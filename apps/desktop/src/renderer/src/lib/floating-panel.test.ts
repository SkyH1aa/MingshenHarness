import { describe, expect, it } from "vitest";
import { floatingPanelPosition } from "./floating-panel";

describe("floating menus stay within usable viewport space", () => {
  it.each([120, 340, 600, 650])("fits a long menu near viewport y=%s", (top) => {
    const viewport = { width: 1040, height: 680 };
    const position = floatingPanelPosition(
      { top, bottom: top + 36, left: 950, width: 500 },
      viewport,
      { maxHeight: 480, minWidth: 350 },
    );
    const y = position.top ?? viewport.height - (position.bottom ?? 0) - position.maxHeight;
    expect(y).toBeGreaterThanOrEqual(12);
    expect(y + position.maxHeight).toBeLessThanOrEqual(viewport.height - 12);
    expect(position.left + position.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(position.maxHeight).toBeGreaterThan(200);
  });
  it("uses a bottom anchor above a tall composer and preserves bounded height", () => {
    const position = floatingPanelPosition(
      { top: 160, bottom: 650, left: 280, width: 740 },
      { width: 1040, height: 680 },
      { maxHeight: 560, width: 430, preferAbove: true },
    );
    expect(position.bottom).toBe(526);
    expect(position.maxHeight).toBe(142);
    expect(position.width).toBe(430);
  });
});
