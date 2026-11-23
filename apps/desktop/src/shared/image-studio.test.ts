import { describe, expect, it } from "vitest";
import {
  alignImageStudioDimension,
  DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
  imageStudioApiParameters,
  imageStudioPresetDimensions,
  normalizeImageStudioGenerationSettings,
  validateImageStudioGenerationSettings,
} from "./image-studio";

function settings(patch: Partial<typeof DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS> = {}) {
  return { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS, ...patch };
}

describe("Image Studio generation settings", () => {
  it("uses supported quality values and maps resolution, count and transparency to the API", () => {
    expect(
      imageStudioApiParameters(
        settings({
          quality: "xhigh",
          width: 1_024,
          height: 1_536,
          resolution: "custom",
          aspectRatio: "2:3",
          imageCount: 3,
          transparentBackground: true,
        }),
      ),
    ).toEqual({
      n: 3,
      size: "1024x1536",
      quality: "xhigh",
      background: "transparent",
      output_format: "png",
    });
  });

  it("maps automatic resolution to the provider's auto size", () => {
    expect(
      imageStudioApiParameters(
        settings({ resolution: "auto", aspectRatio: "auto", imageCount: 2 }),
      ),
    ).toEqual({ n: 2, size: "auto", quality: "auto" });
  });

  it("keeps aligned preset dimensions within the supported UHD edge", () => {
    expect(imageStudioPresetDimensions("1k", "2:3", true)).toEqual({
      width: 688,
      height: 1_024,
    });
    expect(imageStudioPresetDimensions("4k", "16:9", true)).toEqual({
      width: 3_840,
      height: 2_160,
    });
    expect(imageStudioPresetDimensions("4k", "21:9", true)).toEqual({
      width: 3_840,
      height: 1_648,
    });
    expect(alignImageStudioDimension(3_839)).toBe(3_840);
  });

  it("normalizes older workspace settings and clamps image count and dimensions", () => {
    expect(normalizeImageStudioGenerationSettings({ imageCount: 15, width: 9_000 })).toMatchObject({
      imageCount: 10,
      width: 3_840,
      height: 1_024,
      quality: "auto",
      alignTo16: true,
    });
  });

  it.each([
    ["legacy quality", settings({ quality: "very_high" as never })],
    ["unpaired auto ratio", settings({ resolution: "auto", aspectRatio: "1:1" })],
    ["mismatched preset ratio", settings({ width: 1_024, height: 1_536 })],
    ["out-of-range dimension", settings({ width: 4_096 })],
    ["unaligned dimensions", settings({ width: 1_030 })],
    [
      "unsupported aspect",
      settings({ width: 256, height: 1_024, resolution: "custom", aspectRatio: "custom" }),
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => validateImageStudioGenerationSettings(value)).toThrow();
  });
});
