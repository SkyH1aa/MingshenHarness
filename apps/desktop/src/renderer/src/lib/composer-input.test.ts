import { describe, expect, it } from "vitest";
import { isPasteInputType, shouldOpenPastePreview } from "./composer-input";

describe("composer paste preview", () => {
  it("recognizes only explicit paste input types", () => {
    expect(isPasteInputType("insertFromPaste")).toBe(true);
    expect(isPasteInputType("insertFromPasteAsQuotation")).toBe(true);
    expect(isPasteInputType("insertText")).toBe(false);
    expect(isPasteInputType("insertCompositionText")).toBe(false);
    expect(isPasteInputType(undefined)).toBe(false);
    expect(isPasteInputType(null)).toBe(false);
  });

  it("opens preview only for a pending paste when rich paste is enabled", () => {
    expect(
      shouldOpenPastePreview({
        inputType: "insertFromPaste",
        pastePending: true,
        richPasteEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldOpenPastePreview({
        inputType: "insertCompositionText",
        pastePending: true,
        richPasteEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenPastePreview({
        inputType: "insertText",
        pastePending: true,
        richPasteEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldOpenPastePreview({
        inputType: "insertText",
        pastePending: false,
        richPasteEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenPastePreview({
        inputType: "insertFromPaste",
        pastePending: false,
        richPasteEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenPastePreview({
        inputType: "insertFromPaste",
        pastePending: true,
        richPasteEnabled: false,
      }),
    ).toBe(false);
  });
});
