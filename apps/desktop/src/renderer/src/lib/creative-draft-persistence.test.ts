import { afterEach, describe, expect, it, vi } from "vitest";
import { CREATIVE_TEMPLATES, createCreativeDraft } from "../../../shared/creative-templates";
import { loadCreativeDraft, openCreativeDraftStorage } from "./creative-draft-persistence";

function draft(title: string) {
  const template = CREATIVE_TEMPLATES[0];
  if (!template) throw new Error("Missing creative template fixture");
  return { ...createCreativeDraft(template, "zh-CN"), title };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

afterEach(() => vi.useRealTimers());

describe("creative draft persistence", () => {
  it("flushes the latest edit on exit and leaves an empty workspace independent", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const onResult = vi.fn();
    expect(loadCreativeDraft(() => storage, "A")).toEqual({ status: "missing" });
    const { autosave: first } = openCreativeDraftStorage(() => storage, "A", onResult);
    first.schedule(draft("first"));
    first.schedule(draft("last"));

    expect(first.flush()).toEqual({ status: "saved" });
    expect(loadCreativeDraft(() => storage, "A")).toMatchObject({
      status: "restored",
      draft: { title: "last" },
    });
    expect(loadCreativeDraft(() => storage, "B")).toEqual({ status: "missing" });
    const { autosave: second } = openCreativeDraftStorage(() => storage, "B", onResult);
    expect(second.flush()).toBeNull();
    vi.runAllTimers();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.values.has("B")).toBe(false);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("debounces changes and writes the latest draft once", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const onResult = vi.fn();
    const { autosave } = openCreativeDraftStorage(() => storage, "A", onResult);
    autosave.schedule(draft("first"));
    vi.advanceTimersByTime(200);
    autosave.schedule(draft("last"));
    vi.advanceTimersByTime(239);
    expect(storage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(storage.values.get("A") ?? "null")).toMatchObject({ title: "last" });
    expect(onResult).toHaveBeenCalledWith({ status: "saved" });
    expect(autosave.flush()).toBeNull();
  });

  it("restores incomplete section titles and preserves their whitespace", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const current = draft("editing");
    current.sections = [
      { id: "empty", title: "", notes: "Unfinished title" },
      { id: "blank", title: "   ", notes: "Whitespace-only title" },
      { id: "padded", title: "  Section  ", notes: "Padded title" },
    ];
    const { autosave } = openCreativeDraftStorage(() => storage, "A", vi.fn());
    autosave.schedule(current);
    expect(autosave.flush()).toEqual({ status: "saved" });

    expect(loadCreativeDraft(() => storage, "A")).toEqual({
      status: "restored",
      draft: current,
    });
  });

  it.each(["brief", "detailed"] as const)(
    "round-trips the %s template mode together with edited fields and notes",
    (promptMode) => {
      vi.useFakeTimers();
      const storage = memoryStorage();
      const current = draft("Custom title");
      current.promptMode = promptMode;
      current.subject = "User subject";
      current.sections[0] = { id: "section", title: "Custom section", notes: "User notes" };
      const { autosave } = openCreativeDraftStorage(() => storage, "mode", vi.fn());
      autosave.schedule(current);
      expect(autosave.flush()).toEqual({ status: "saved" });
      expect(loadCreativeDraft(() => storage, "mode")).toEqual({
        status: "restored",
        draft: current,
      });
    },
  );

  it("keeps legacy drafts without a template mode readable as brief", () => {
    const storage = memoryStorage();
    const { promptMode: _promptMode, ...legacy } = draft("Legacy title");
    storage.values.set("legacy", JSON.stringify(legacy));
    const loaded = loadCreativeDraft(() => storage, "legacy");
    expect(loaded.status).toBe("restored");
    if (loaded.status !== "restored") throw new Error("Legacy draft did not restore");
    expect(loaded.draft.promptMode ?? "brief").toBe("brief");
    expect(loaded.draft.title).toBe("Legacy title");
    expect(loaded.draft.sections).toEqual(legacy.sections);
  });

  it.each(["", "{broken", JSON.stringify({ version: 99 })])(
    "never overwrites invalid stored data (%s)",
    (raw) => {
      vi.useFakeTimers();
      const storage = memoryStorage();
      storage.values.set("A", raw);
      const { load, autosave } = openCreativeDraftStorage(() => storage, "A", vi.fn());
      expect(load).toEqual({
        status: "blocked",
        reason: "invalid",
      });
      autosave.schedule(draft("replacement"));
      vi.runAllTimers();
      expect(autosave.flush()).toBeNull();
      expect(storage.values.get("A")).toBe(raw);
      expect(storage.setItem).not.toHaveBeenCalled();
    },
  );

  it("blocks writes after a failed storage read", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error("read denied");
    });
    const { load, autosave } = openCreativeDraftStorage(() => storage, "A", vi.fn());
    expect(load).toEqual({
      status: "blocked",
      reason: "unreadable",
    });
    autosave.schedule(draft("replacement"));
    vi.runAllTimers();
    expect(autosave.flush()).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("does not retry a storage getter that failed during load", () => {
    vi.useFakeTimers();
    const getStorage = vi.fn((): Storage => {
      throw new Error("storage unavailable");
    });
    const { load, autosave } = openCreativeDraftStorage(getStorage, "A", vi.fn());
    expect(load).toEqual({ status: "blocked", reason: "unreadable" });
    autosave.schedule(draft("replacement"));
    vi.runAllTimers();
    expect(autosave.flush()).toBeNull();
    expect(getStorage).toHaveBeenCalledTimes(1);
  });

  it("retains a failed pending write for an explicit flush retry", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const failure = new Error("quota exceeded");
    storage.setItem.mockImplementationOnce(() => {
      throw failure;
    });
    const onResult = vi.fn();
    const { autosave } = openCreativeDraftStorage(() => storage, "A", onResult);
    autosave.schedule(draft("retry me"));
    vi.advanceTimersByTime(240);
    expect(onResult).toHaveBeenCalledWith({ status: "error", error: failure });
    expect(autosave.flush()).toEqual({ status: "saved" });
    expect(loadCreativeDraft(() => storage, "A")).toMatchObject({
      status: "restored",
      draft: { title: "retry me" },
    });
  });

  it("restores a failed unmount write across instances and clears it after a successful retry", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const old = draft("previously saved");
    storage.values.set("cross-instance", JSON.stringify(old));
    const first = openCreativeDraftStorage(() => storage, "cross-instance", vi.fn());
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("write denied");
    });
    first.autosave.schedule(draft("unsaved change"));
    expect(first.autosave.flush()).toMatchObject({ status: "error" });
    expect(JSON.parse(storage.values.get("cross-instance") ?? "null")).toEqual(old);

    const second = openCreativeDraftStorage(() => storage, "cross-instance", vi.fn());
    expect(second.load).toMatchObject({ status: "restored", draft: old });
    expect(second.recovered).toMatchObject({ draft: { title: "unsaved change" } });
    expect(second.autosave.flush()).toEqual({ status: "saved" });
    expect(openCreativeDraftStorage(() => storage, "cross-instance", vi.fn()).recovered).toBeNull();
    expect(loadCreativeDraft(() => storage, "cross-instance")).toMatchObject({
      status: "restored",
      draft: { title: "unsaved change" },
    });
  });

  it("keeps a failed draft editable without overwriting a subsequently unreadable or invalid value", () => {
    vi.useFakeTimers();
    const storage = memoryStorage();
    const key = "cross-instance-blocked";
    const first = openCreativeDraftStorage(() => storage, key, vi.fn());
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("write denied");
    });
    first.autosave.schedule(draft("original failure"));
    expect(first.autosave.flush()).toMatchObject({ status: "error" });
    storage.values.set(key, "{broken");

    const blocked = openCreativeDraftStorage(() => storage, key, vi.fn());
    expect(blocked.load).toEqual({ status: "blocked", reason: "invalid" });
    expect(blocked.recovered).toMatchObject({ draft: { title: "original failure" } });
    blocked.autosave.schedule(draft("edited while blocked"));
    vi.runAllTimers();
    expect(blocked.autosave.flush()).toBeNull();
    expect(storage.values.get(key)).toBe("{broken");

    storage.getItem.mockImplementationOnce(() => {
      throw new Error("read denied");
    });
    const unreadable = openCreativeDraftStorage(() => storage, key, vi.fn());
    expect(unreadable.load).toEqual({ status: "blocked", reason: "unreadable" });
    expect(unreadable.recovered).toMatchObject({ draft: { title: "edited while blocked" } });
    expect(unreadable.autosave.flush()).toBeNull();
    expect(storage.values.get(key)).toBe("{broken");

    storage.values.set(key, JSON.stringify(draft("stored value")));
    const retry = openCreativeDraftStorage(() => storage, key, vi.fn());
    expect(retry.autosave.flush()).toEqual({ status: "saved" });
    expect(loadCreativeDraft(() => storage, key)).toMatchObject({
      status: "restored",
      draft: { title: "edited while blocked" },
    });
    expect(openCreativeDraftStorage(() => storage, key, vi.fn()).recovered).toBeNull();
  });
});
