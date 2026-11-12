import { describe, expect, it } from "vitest";
import {
  applyModelPresetOnce,
  type ModelPresetDraft,
  parseModelTokenCount,
  setNewModelLongContextBilling,
} from "./model-settings-input";

function draft(modelId = ""): ModelPresetDraft {
  return {
    editingId: null,
    modelId,
    contextWindow: "128000",
    maxOutputTokens: "8192",
    inputModalities: ["text"],
    reasoningLevels: "none",
    presetApplied: false,
    gptLongContextBilling: false,
  };
}

describe("new-model presets", () => {
  it.each(["gpt-6", "gpt-6-flash", "gpt-6.1", "gpt-6.1-sol"])(
    "prefills the requested GPT fields for %s",
    (modelId) => {
      expect(applyModelPresetOnce(draft(modelId))).toMatchObject({
        contextWindow: "1000000",
        maxOutputTokens: "128000",
        inputModalities: ["text", "image", "file"],
        reasoningLevels: "none,low,medium,high,xhigh,max",
        presetApplied: true,
        gptLongContextBilling: false,
      });
    },
  );

  it("prefills DeepSeek fields when a model is chosen from discovery", () => {
    expect(applyModelPresetOnce(draft("deepseek-v4.1-flash"))).toMatchObject({
      contextWindow: "1000000",
      maxOutputTokens: "384000",
      inputModalities: ["text", "image", "file"],
      reasoningLevels: "low,high,max",
      presetApplied: true,
    });
  });

  it.each(["", "gpt-5", "custom-gpt-6", "openai/gpt-6.1", "deepseek", "DeepSeek-v4"])(
    "does not consume the preset for an unrelated ID: %s",
    (modelId) => {
      const initial = draft(modelId);
      expect(applyModelPresetOnce(initial)).toBe(initial);
      expect(initial.presetApplied).toBe(false);
    },
  );

  it("applies when an initially unrelated draft first reaches a matching prefix", () => {
    const initial = applyModelPresetOnce(draft("deep"));
    expect(applyModelPresetOnce({ ...initial, modelId: "deepseek-v4" })).toMatchObject({
      maxOutputTokens: "384000",
      presetApplied: true,
    });
  });

  it("keeps user edits when the model ID changes again, including to another preset family", () => {
    const initial = applyModelPresetOnce(draft("gpt-6"));
    const edited = {
      ...initial,
      modelId: "deepseek-v4",
      contextWindow: "175K",
      maxOutputTokens: "32k",
      inputModalities: ["text"] as ModelPresetDraft["inputModalities"],
      reasoningLevels: "high",
    };
    expect(applyModelPresetOnce(edited)).toBe(edited);
  });

  it("never applies to an existing saved model", () => {
    const existing = { ...draft("gpt-6.1"), editingId: "saved-model" };
    expect(applyModelPresetOnce(existing)).toBe(existing);
  });

  it("changes only the context when explicitly toggling GPT long-context billing", () => {
    const edited = { ...applyModelPresetOnce(draft("gpt-6.1")), maxOutputTokens: "64k" };
    const enabled = setNewModelLongContextBilling(edited, true);
    expect(enabled).toEqual({
      ...edited,
      contextWindow: "200000",
      gptLongContextBilling: true,
    });
    const disabled = setNewModelLongContextBilling(enabled, false);
    expect(disabled.contextWindow).toBe("1000000");
    expect(disabled.maxOutputTokens).toBe("64k");
    expect(applyModelPresetOnce(disabled)).toBe(disabled);
  });

  it.each([
    { ...draft("gpt-6.1"), editingId: "saved-model" },
    draft("deepseek-v4"),
    draft("other-gpt-6"),
  ])("ignores the GPT billing toggle outside a new matching draft", (initial) => {
    expect(setNewModelLongContextBilling(initial, true)).toBe(initial);
  });
});

describe("model token-count input", () => {
  it.each([
    ["128000", 128000],
    ["100k", 100000],
    ["100K", 100000],
    ["1m", 1000000],
    ["1M", 1000000],
    ["1.5m", 1500000],
    ["1.001K", 1001],
    ["0.000001M", 1],
    ["2.0000k", 2000],
    [" 200K ", 200000],
    ["000001M", 1000000],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
    ["9007199254740.991k", Number.MAX_SAFE_INTEGER],
  ])("expands %s to the exact integer %s", (input, expected) => {
    expect(parseModelTokenCount(String(input))).toBe(expected);
  });

  it.each([
    "",
    " ",
    "0",
    "0k",
    "-1k",
    "+100k",
    "1.2",
    "1e6",
    "Infinity",
    "NaN",
    "1g",
    "100kb",
    "1,000",
    "1 m",
    "1mK",
    "0.0001k",
    "9007199254740992",
    "9007199254740.992k",
    "999999999999999999999999m",
  ])("rejects an invalid, fractional or unsafe token count: %s", (input) => {
    expect(parseModelTokenCount(input)).toBeNull();
  });
});
