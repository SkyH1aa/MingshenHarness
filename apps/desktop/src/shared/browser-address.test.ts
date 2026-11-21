import { describe, expect, it } from "vitest";
import { displayBrowserUrl } from "./browser-address";

describe("displayBrowserUrl", () => {
  it("removes the internal local-file approval capability from visible addresses", () => {
    expect(
      displayBrowserUrl(
        "file:///C:/workspace/report.html?section=summary&mingshenLocalFileApproval=secret",
      ),
    ).toBe("file:///C:/workspace/report.html?section=summary");
  });

  it("preserves ordinary URLs and maps blank pages to an empty address", () => {
    expect(displayBrowserUrl("https://example.test/path?q=visible")).toBe(
      "https://example.test/path?q=visible",
    );
    expect(displayBrowserUrl("about:blank")).toBe("");
    expect(displayBrowserUrl(null)).toBe("");
  });
});
