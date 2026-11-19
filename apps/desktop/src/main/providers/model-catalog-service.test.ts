import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelConfig, ProviderView } from "../../shared/domain";
import {
  MODEL_CATALOG_PREFERENCES_KEY,
  type MoveCatalogProviderInput,
  type SetCatalogModelStarInput,
} from "../../shared/model-catalog";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { ModelCatalogService } from "./model-catalog-service";

type FixtureProvider = ProviderView & { models: [ModelConfig] };
type FixtureCatalog = [FixtureProvider, FixtureProvider, FixtureProvider, ProviderView];

function createCatalog(repository: Repository): FixtureCatalog {
  const providers = ["Alpha", "Beta", "Gamma", "Empty"].map((name) =>
    repository.insertProvider({
      name,
      baseUrl: "https://catalog.invalid/v1",
      protocol: "openai_responses",
      authMode: "bearer",
      customHeaderName: null,
    }),
  );
  for (const provider of providers.slice(0, 3))
    repository.insertModel({
      providerId: provider.id,
      modelId: "same-wire-model",
      displayName: `${provider.name} model`,
      contextWindow: 100000,
      maxOutputTokens: 1000,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: ["low", "high"],
      anthropicNoneBehavior: "disabled",
    });
  const catalog = repository.listProviders();
  const withModel = (provider: ProviderView | undefined): FixtureProvider => {
    const model = provider?.models[0];
    if (!provider || !model) throw new Error("Catalog model fixture missing.");
    return { ...provider, models: [model] };
  };
  const empty = catalog[3];
  if (!empty) throw new Error("Catalog supplier fixture missing.");
  return [withModel(catalog[0]), withModel(catalog[1]), withModel(catalog[2]), empty];
}

describe("model catalog preferences", () => {
  let database: ReturnType<typeof openDatabase>;
  let repository: Repository;
  let service: ModelCatalogService;
  let providers: ReturnType<typeof createCatalog>;

  beforeEach(() => {
    database = openDatabase(":memory:");
    repository = new Repository(database);
    providers = createCatalog(repository);
    service = new ModelCatalogService(repository);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it("uses creation order for an old installation without writing defaults", () => {
    expect(service.getPreferences()).toEqual({
      providerOrder: providers.map((provider) => provider.id),
      starredModelIds: [],
    });
    expect(repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY)).toBeNull();
    expect(repository.listProviders()).toEqual(providers);
  });

  it("normalizes duplicate, invalid and deleted IDs and appends suppliers missing from saved order", () => {
    const stored = {
      providerOrder: [providers[1].id, providers[1].id, "deleted", null],
      starredModelIds: [
        providers[0].models[0].id,
        "same-wire-model",
        providers[0].models[0].id,
        false,
        "deleted",
      ],
    };
    repository.setSetting(MODEL_CATALOG_PREFERENCES_KEY, stored);
    expect(service.getPreferences()).toEqual({
      providerOrder: [providers[1].id, providers[0].id, providers[2].id, providers[3].id],
      starredModelIds: [providers[0].models[0].id],
    });
    expect(repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY)).toEqual(stored);
  });

  it.each([false, [], "legacy", { providerOrder: 4, starredModelIds: {} }])(
    "recovers safely from malformed persisted preferences %#",
    (stored) => {
      repository.setSetting(MODEL_CATALOG_PREFERENCES_KEY, stored);
      expect(service.getPreferences()).toEqual({
        providerOrder: providers.map((provider) => provider.id),
        starredModelIds: [],
      });
    },
  );

  it("moves by stable IDs over the full catalog and retains suppliers hidden by model filters", () => {
    expect(
      service.moveProvider({
        providerId: providers[2].id,
        beforeProviderId: providers[0].id,
      }).providerOrder,
    ).toEqual([providers[2].id, providers[0].id, providers[1].id, providers[3].id]);
    expect(
      service.moveProvider({
        providerId: providers[2].id,
        beforeProviderId: null,
      }).providerOrder,
    ).toEqual([providers[0].id, providers[1].id, providers[3].id, providers[2].id]);
    const before = database.prepare("select * from app_settings order by key").all();
    service.moveProvider({
      providerId: providers[0].id,
      beforeProviderId: providers[0].id,
    });
    expect(database.prepare("select * from app_settings order by key").all()).toEqual(before);
    expect(repository.listProviders()).toEqual(providers);
  });

  it("merges each precise operation into the latest preferences across service instances", () => {
    const other = new ModelCatalogService(new Repository(database));
    const firstModel = providers[0].models[0].id;
    const secondModel = providers[1].models[0].id;
    service.setModelStar({ modelConfigId: firstModel, starred: true });
    other.moveProvider({ providerId: providers[2].id, beforeProviderId: providers[0].id });
    service.setModelStar({ modelConfigId: secondModel, starred: true });
    const preferences = other.moveProvider({
      providerId: providers[1].id,
      beforeProviderId: providers[2].id,
    });
    expect(preferences).toEqual({
      providerOrder: [providers[1].id, providers[2].id, providers[0].id, providers[3].id],
      starredModelIds: [firstModel, secondModel],
    });
    expect(repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY)).toEqual(preferences);
  });

  it("stars the same wire model at different suppliers independently and handles unstar idempotently", () => {
    const firstModel = providers[0].models[0].id;
    const secondModel = providers[1].models[0].id;
    service.setModelStar({ modelConfigId: firstModel, starred: true });
    service.setModelStar({ modelConfigId: secondModel, starred: true });
    const before = database.prepare("select * from app_settings order by key").all();
    service.setModelStar({ modelConfigId: firstModel, starred: true });
    expect(database.prepare("select * from app_settings order by key").all()).toEqual(before);
    expect(
      service.setModelStar({ modelConfigId: firstModel, starred: false }).starredModelIds,
    ).toEqual([secondModel]);
    const after = database.prepare("select * from app_settings order by key").all();
    service.setModelStar({ modelConfigId: firstModel, starred: false });
    expect(database.prepare("select * from app_settings order by key").all()).toEqual(after);
    expect(providers[0].models[0].modelId).toBe(providers[1].models[0].modelId);
  });

  it("prunes deleted model and provider IDs in persisted preferences", () => {
    for (const provider of [providers[0], providers[1], providers[2]])
      service.setModelStar({ modelConfigId: provider.models[0].id, starred: true });
    service.moveProvider({ providerId: providers[2].id, beforeProviderId: providers[0].id });
    repository.removeModel(providers[0].models[0].id);
    expect(repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY)).toEqual({
      providerOrder: [providers[2].id, providers[0].id, providers[1].id, providers[3].id],
      starredModelIds: [providers[1].models[0].id, providers[2].models[0].id],
    });
    repository.deleteProvider(providers[2].id);
    const expected = {
      providerOrder: [providers[0].id, providers[1].id, providers[3].id],
      starredModelIds: [providers[1].models[0].id],
    };
    expect(repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY)).toEqual(expected);
    expect(service.getPreferences()).toEqual(expected);
    expect(repository.listProviders().map((provider) => provider.id)).toEqual(
      providers
        .filter((provider) => provider.id !== providers[2].id)
        .map((provider) => provider.id),
    );
  });

  it("does not create preferences when deleting providers or models without saved preferences", () => {
    repository.removeModel(providers[0].models[0].id);
    repository.deleteProvider(providers[1].id);
    expect(repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY)).toBeNull();
  });

  it.each(["provider", "model"] as const)(
    "rolls back the %s deletion together with failed preference cleanup",
    (kind) => {
      service.setModelStar({ modelConfigId: providers[0].models[0].id, starred: true });
      const before = repository.listProviders();
      const settings = database.prepare("select * from app_settings order by key").all();
      const write = repository.setSetting.bind(repository);
      vi.spyOn(repository, "setSetting").mockImplementationOnce((key, value) => {
        write(key, value);
        throw new Error("Injected preference persistence failure.");
      });
      expect(() =>
        kind === "provider"
          ? repository.deleteProvider(providers[0].id)
          : repository.removeModel(providers[0].models[0].id),
      ).toThrow("Injected preference persistence failure");
      expect(repository.listProviders()).toEqual(before);
      expect(database.prepare("select * from app_settings order by key").all()).toEqual(settings);
      expect(service.getPreferences().starredModelIds).toEqual([providers[0].models[0].id]);
    },
  );

  it("preserves credentials, model settings, sessions, history, defaults and runtime supplier order", () => {
    database
      .prepare("insert into secrets (id, ciphertext, created_at) values (?, ?, ?)")
      .run("catalog-secret", new Uint8Array([1, 4, 9]), "2026-11-11");
    repository.insertProviderKey({
      providerId: providers[0].id,
      label: "Catalog fixture",
      secretRef: "catalog-secret",
      maskedHint: "***fixture",
      neverReveal: true,
      priority: 0,
    });
    const session = repository.insertSession({
      title: "Preserve the selected model",
      providerId: providers[0].id,
      modelId: providers[0].models[0].id,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "Preserve the prompt",
      reasoningLevel: "high",
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: true,
    });
    repository.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text: "Preserve history" }],
    });
    repository.setSetting("context.model.default", {
      providerId: providers[0].id,
      modelId: providers[0].models[0].id,
    });
    repository.setSetting("permissions.approval-model", { enabled: true, fixture: true });
    const tables = ["providers", "provider_keys", "secrets", "models", "sessions", "messages"];
    const rows = tables.map((table) => database.prepare(`select * from ${table}`).all());
    const originalProviders = repository.listProviders();
    const settings = database.prepare("select * from app_settings order by key").all();
    service.setModelStar({ modelConfigId: providers[1].models[0].id, starred: true });
    service.moveProvider({ providerId: providers[2].id, beforeProviderId: providers[0].id });
    for (const [index, table] of tables.entries())
      expect(database.prepare(`select * from ${table}`).all()).toEqual(rows[index]);
    expect(repository.listProviders()).toEqual(originalProviders);
    expect(
      database
        .prepare("select * from app_settings where key != ? order by key")
        .all(MODEL_CATALOG_PREFERENCES_KEY),
    ).toEqual(settings);
    expect(database.prepare("pragma user_version").get()?.user_version).toBe(9);
    expect(database.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
  });

  it.each([
    null,
    undefined,
    true,
    [],
    {},
    { providerId: "missing", beforeProviderId: null },
    { providerId: 1, beforeProviderId: null },
    { providerId: "", beforeProviderId: null },
    { providerId: "x".repeat(129), beforeProviderId: null },
    { providerId: " fixture ", beforeProviderId: null },
    { providerId: "fixture", beforeProviderId: undefined },
    { providerId: "fixture", beforeProviderId: 3 },
    { providerId: "fixture", beforeProviderId: null, arbitrary: true },
    JSON.parse('{"providerId":"fixture","beforeProviderId":null,"__proto__":{"polluted":true}}'),
  ])("rejects invalid provider operations %# without stored changes", (input) => {
    service.setModelStar({ modelConfigId: providers[0].models[0].id, starred: true });
    const before = database.prepare("select * from app_settings order by key").all();
    expect(() => service.moveProvider(input as MoveCatalogProviderInput)).toThrow();
    expect(database.prepare("select * from app_settings order by key").all()).toEqual(before);
    expect(repository.listProviders()).toEqual(providers);
  });

  it("rejects an unknown reorder target before writing and remains usable", () => {
    expect(() =>
      service.moveProvider({ providerId: providers[0].id, beforeProviderId: "missing" }),
    ).toThrow("不存在");
    expect(repository.getSetting(MODEL_CATALOG_PREFERENCES_KEY)).toBeNull();
    expect(
      service.moveProvider({ providerId: providers[0].id, beforeProviderId: null }).providerOrder,
    ).toEqual([providers[1].id, providers[2].id, providers[3].id, providers[0].id]);
  });

  it.each([
    null,
    undefined,
    true,
    [],
    {},
    { modelConfigId: "missing", starred: true },
    { modelConfigId: 3, starred: true },
    { modelConfigId: "", starred: true },
    { modelConfigId: "x".repeat(129), starred: true },
    { modelConfigId: " fixture ", starred: true },
    { modelConfigId: "fixture", starred: undefined },
    { modelConfigId: "fixture", starred: 1 },
    { modelConfigId: "fixture", starred: "true" },
    { modelConfigId: "fixture", starred: null },
    { modelConfigId: "fixture", starred: true, providerId: "another" },
  ])("rejects invalid star operations %# without stored changes", (input) => {
    service.moveProvider({ providerId: providers[2].id, beforeProviderId: providers[0].id });
    const before = database.prepare("select * from app_settings order by key").all();
    expect(() => service.setModelStar(input as SetCatalogModelStarInput)).toThrow();
    expect(database.prepare("select * from app_settings order by key").all()).toEqual(before);
    expect(repository.listProviders()).toEqual(providers);
  });

  it("persists the shared catalog across database close and reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-model-catalog-"));
    const path = join(root, "catalog.db");
    let disk = openDatabase(path);
    try {
      let repo = new Repository(disk);
      const catalog = createCatalog(repo);
      let preferences = new ModelCatalogService(repo);
      preferences.moveProvider({
        providerId: catalog[2].id,
        beforeProviderId: catalog[0].id,
      });
      const expected = preferences.setModelStar({
        modelConfigId: catalog[1].models[0].id,
        starred: true,
      });
      for (let launch = 0; launch < 2; launch++) {
        disk.close();
        disk = openDatabase(path);
        repo = new Repository(disk);
        preferences = new ModelCatalogService(repo);
        expect(preferences.getPreferences()).toEqual(expected);
        expect(repo.listProviders()).toEqual(catalog);
        expect(disk.prepare("pragma user_version").get()?.user_version).toBe(9);
        expect(disk.prepare("pragma integrity_check").get()?.integrity_check).toBe("ok");
      }
    } finally {
      disk.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
