import { describe, expect, it } from "vitest";
import {
  alignImageStudioDimension,
  DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
  IMAGE_STUDIO_MAX_EXPORT_BYTES,
  IMAGE_STUDIO_MAX_GENERATION_BYTES,
  IMAGE_STUDIO_MAX_IMPORT_BYTES,
  type ImageStudioAsset,
  imageStudioApiParameters,
  imageStudioAssetPromptMetadata,
  imageStudioAssetPromptRestore,
  imageStudioPresetDimensions,
  normalizeImageStudioAssetPromptMetadata,
  normalizeImageStudioGenerationSettings,
  selectImageStudioReferenceIds,
  validateImageStudioGenerationSettings,
  withinImageStudioByteBudget,
} from "./image-studio";

function settings(patch: Partial<typeof DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS> = {}) {
  return { ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS, ...patch };
}

describe("Image Studio resource budgets", () => {
  it("keeps image import and ZIP export at 500 MiB without widening provider generation", () => {
    expect(IMAGE_STUDIO_MAX_IMPORT_BYTES).toBe(500 * 1024 * 1024);
    expect(IMAGE_STUDIO_MAX_EXPORT_BYTES).toBe(500 * 1024 * 1024);
    expect(IMAGE_STUDIO_MAX_GENERATION_BYTES).toBe(100 * 1024 * 1024);
    expect(
      withinImageStudioByteBudget(IMAGE_STUDIO_MAX_IMPORT_BYTES, IMAGE_STUDIO_MAX_IMPORT_BYTES),
    ).toBe(true);
    expect(
      withinImageStudioByteBudget(IMAGE_STUDIO_MAX_IMPORT_BYTES + 1, IMAGE_STUDIO_MAX_IMPORT_BYTES),
    ).toBe(false);
    expect(
      withinImageStudioByteBudget(IMAGE_STUDIO_MAX_EXPORT_BYTES, IMAGE_STUDIO_MAX_EXPORT_BYTES),
    ).toBe(true);
    expect(
      withinImageStudioByteBudget(IMAGE_STUDIO_MAX_EXPORT_BYTES + 1, IMAGE_STUDIO_MAX_EXPORT_BYTES),
    ).toBe(false);
  });
});

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
      referenceEnabled: false,
    });
  });

  it("keeps reference-image mode opt-in while accepting explicit enablement", () => {
    expect(DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS.referenceEnabled).toBe(false);
    expect(normalizeImageStudioGenerationSettings({}).referenceEnabled).toBe(false);
    expect(
      normalizeImageStudioGenerationSettings({
        ...DEFAULT_IMAGE_STUDIO_GENERATION_SETTINGS,
        referenceEnabled: true,
      }).referenceEnabled,
    ).toBe(true);
  });

  it("deduplicates reference ids and keeps only the first three in selection order", () => {
    expect(selectImageStudioReferenceIds(undefined)).toEqual([]);
    expect(
      selectImageStudioReferenceIds(["asset-a", "asset-b", "asset-a", "asset-c", "asset-d"]),
    ).toEqual(["asset-a", "asset-b", "asset-c"]);
  });

  it.each([
    ["a malformed id", ["asset-a", "../outside"]],
    ["a non-array value", "asset-a"],
    [
      "more than the asset-library limit",
      Array.from({ length: 201 }, (_, index) => `asset-${index}`),
    ],
  ])("rejects %s before provider submission", (_name, value) => {
    expect(() => selectImageStudioReferenceIds(value)).toThrow("参考图素材标识无效");
  });

  it("accepts a 200-item library selection and still sends only the first three references", () => {
    const ids = Array.from({ length: 200 }, (_, index) => `asset-${index}`);
    expect(selectImageStudioReferenceIds(ids)).toEqual(ids.slice(0, 3));
  });

  it.each([
    ["legacy quality", settings({ quality: "very_high" as never })],
    ["unpaired auto ratio", settings({ resolution: "auto", aspectRatio: "1:1" })],
    ["mismatched preset ratio", settings({ width: 1_024, height: 1_536 })],
    ["out-of-range dimension", settings({ width: 4_096 })],
    ["unaligned dimensions", settings({ width: 1_030 })],
    ["non-boolean reference mode", settings({ referenceEnabled: "yes" as never })],
    [
      "unsupported aspect",
      settings({ width: 256, height: 1_024, resolution: "custom", aspectRatio: "custom" }),
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => validateImageStudioGenerationSettings(value)).toThrow();
  });
});

function generatedAsset(patch: Partial<ImageStudioAsset> = {}): ImageStudioAsset {
  return {
    id: "prompt-fixture",
    name: "prompt-fixture.png",
    mimeType: "image/png",
    size: 100,
    width: 1,
    height: 1,
    source: "generated",
    createdAt: "2026-11-24T00:00:00.000Z",
    prompt: "Original positive prompt",
    negativePrompt: "Original negative prompt",
    revisedPrompt: "Provider revised prompt",
    promptOrigin: "mingshen_generated",
    promptMetadataVersion: 1,
    model: null,
    ...patch,
  };
}

describe("Image Studio saved prompts", () => {
  it("restores the original positive and negative prompts, not provider revisions", () => {
    expect(imageStudioAssetPromptRestore(generatedAsset())).toEqual({
      prompt: "Original positive prompt",
      negativePrompt: "Original negative prompt",
      replacesNegativePrompt: true,
    });
  });

  it("distinguishes a known empty negative prompt from an unknown legacy value", () => {
    expect(imageStudioAssetPromptRestore(generatedAsset({ negativePrompt: "" }))).toEqual({
      prompt: "Original positive prompt",
      negativePrompt: "",
      replacesNegativePrompt: true,
    });
    expect(imageStudioAssetPromptRestore(generatedAsset({ negativePrompt: null }))).toEqual({
      prompt: "Original positive prompt",
      negativePrompt: null,
      replacesNegativePrompt: false,
    });
  });

  it("does not restore unverifiable legacy prompt text, including provider revisions", () => {
    expect(
      imageStudioAssetPromptRestore(
        generatedAsset({
          negativePrompt: null,
          promptOrigin: null,
          promptMetadataVersion: null,
        }),
      ),
    ).toBeNull();
  });

  it.each(["imported", "paste"] as const)(
    "never restores %s asset prompts even with claimed generated metadata",
    (source) => {
      const asset = generatedAsset({ source });
      expect(imageStudioAssetPromptMetadata(asset)).toBeNull();
      expect(imageStudioAssetPromptRestore(asset)).toBeNull();
    },
  );

  it.each([
    null,
    "",
    "   ",
    "x".repeat(4_001),
    "Old combined prompt\n\nAvoid these elements: old negative",
  ])("does not guess missing or ambiguous legacy prompts (%s)", (prompt) => {
    expect(
      imageStudioAssetPromptRestore(
        generatedAsset({ prompt, promptOrigin: null, promptMetadataVersion: null }),
      ),
    ).toBeNull();
  });

  it("accepts bounded, versioned prompt data and trims fields without losing empty negatives", () => {
    expect(
      normalizeImageStudioAssetPromptMetadata({
        version: 1,
        origin: "mingshen_generated",
        prompt: "  Original prompt  ",
        negativePrompt: "  ",
      }),
    ).toEqual({
      version: 1,
      origin: "mingshen_generated",
      prompt: "Original prompt",
      negativePrompt: "",
    });
    expect(
      imageStudioAssetPromptMetadata(
        generatedAsset({ prompt: "x".repeat(4_000), negativePrompt: "y".repeat(2_000) }),
      ),
    ).not.toBeNull();
  });

  it.each([
    { version: 2 },
    { origin: "external" },
    { prompt: "" },
    { prompt: "x".repeat(4_001) },
    { negativePrompt: "x".repeat(2_001) },
    { negativePrompt: undefined },
    { negativePrompt: false },
  ])("rejects invalid metadata %j", (patch) => {
    expect(
      normalizeImageStudioAssetPromptMetadata({
        version: 1,
        origin: "mingshen_generated",
        prompt: "Original prompt",
        negativePrompt: "negative prompt",
        ...patch,
      }),
    ).toBeNull();
  });
});
