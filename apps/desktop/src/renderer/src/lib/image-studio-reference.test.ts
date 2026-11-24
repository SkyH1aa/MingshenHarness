import { describe, expect, it } from "vitest";
import { promoteImageStudioReferenceIds } from "./image-studio-reference";

describe("promoteImageStudioReferenceIds", () => {
  it("places newly imported references first without duplicating old selections", () => {
    expect(promoteImageStudioReferenceIds(["old", "shared"], ["new", "shared"])).toEqual([
      "new",
      "shared",
      "old",
    ]);
  });

  it("preserves the existing selection order when nothing new was imported", () => {
    expect(promoteImageStudioReferenceIds(["first", "second"], [])).toEqual(["first", "second"]);
  });

  it("keeps the shared selection safely bounded", () => {
    expect(promoteImageStudioReferenceIds(["old-1", "old-2"], ["new-1", "new-2"], 3)).toEqual([
      "new-1",
      "new-2",
      "old-1",
    ]);
  });
});
