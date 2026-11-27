import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderProtocol, ProviderUpdateInput } from "../../shared/domain";
import { type PromptCachingSettings, providerPromptCachingKey } from "../../shared/prompt-caching";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import type { SecretStore } from "../storage/secret-store";
import { ProviderService } from "./provider-service";

const databases: ReturnType<typeof openDatabase>[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const database of databases.splice(0)) database.close();
});

function setup(protocol: ProviderProtocol = "openai_responses") {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  const provider = repository.insertProvider({
    name: "Saved gateway",
    baseUrl: "https://gateway.invalid/v1",
    protocol,
    authMode: "custom",
    customHeaderName: "x-fixture-key",
  });
  const secrets = { store: vi.fn(), read: vi.fn(), remove: vi.fn() };
  const service = new ProviderService(repository, secrets as unknown as SecretStore);
  const input: ProviderUpdateInput = {
    providerId: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
  };
  return { database, repository, provider, secrets, service, input };
}

function insertSessionWithContext(
  repository: Repository,
  providerId: string,
  parentSessionId: string | null = null,
) {
  const session = repository.insertSession({
    title: "Calibrated conversation",
    parentSessionId,
    providerId,
    modelId: null,
    agentProfileId: "primary",
    workspacePath: null,
    systemPrompt: "",
    reasoningLevel: "low",
    permissionMode: "request_approval",
    executionMode: "host",
    patchOnly: false,
  });
  repository.appendMessage({
    sessionId: session.id,
    role: "user",
    parts: [{ type: "text", text: "Preserve the original history." }],
  });
  const settings = {
    [`context.observation.${session.id}`]: { providerId, usedTokens: 90000 },
    [`context.view.${session.id}`]: { sessionId: session.id, usedTokens: 90000 },
    [`context.snapshot.${session.id}`]: "previous-connection-signature",
    [`context.basis.${session.id}`]: { providerId, fixedTokens: 1000, ratio: 2 },
    [`context.checkpoint.${session.id}`]: {
      id: "preserved-checkpoint",
      summary: "Preserve the compacted history.",
    },
    [`context.model.${session.id}`]: { providerId, modelId: "saved-compaction-model" },
    [`tokenSaver.usage.${session.id}`]: { totalSavedTokens: 1234 },
  };
  for (const [key, value] of Object.entries(settings)) repository.setSetting(key, value);
  return { session, settings, messages: repository.getMessages(session.id) };
}

describe("saved provider connection editing", () => {
  it("renames in place without changing credentials, models, sessions or message history", () => {
    const { database, repository, provider, secrets, service, input } = setup();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    database
      .prepare("insert into secrets (id, ciphertext, created_at) values (?, ?, ?)")
      .run("fixture-secret", new Uint8Array([1, 2, 3]), "2026-11-09");
    repository.insertProviderKey({
      providerId: provider.id,
      label: "Fixture key",
      secretRef: "fixture-secret",
      maskedHint: "***fixture",
      neverReveal: true,
      priority: 0,
    });
    repository.insertModel({
      providerId: provider.id,
      modelId: "fixture-model",
      displayName: "Fixture",
      contextWindow: 100000,
      maxOutputTokens: 4000,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      toolCalls: true,
      parallelToolCalls: true,
      reasoningLevels: ["low", "high"],
      anthropicNoneBehavior: "disabled",
    });
    const before = service.getProvider(provider.id);
    const model = before.models[0];
    if (!model) throw new Error("Fixture model missing.");
    const session = repository.insertSession({
      title: "Preserved conversation",
      providerId: provider.id,
      modelId: model.id,
      agentProfileId: "primary",
      workspacePath: null,
      systemPrompt: "",
      reasoningLevel: "low",
      permissionMode: "request_approval",
      executionMode: "host",
      patchOnly: false,
    });
    repository.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text: "Preserve this history." }],
    });
    const messages = repository.getMessages(session.id);
    const savedSession = repository.getSession(session.id);
    const secretRows = database.prepare("select * from secrets").all();
    const keyRows = database.prepare("select * from provider_keys").all();
    const modelRows = database.prepare("select * from models").all();
    const renamed = service.updateProvider({ ...input, name: "  Gateway '); --  " });

    expect(renamed).toEqual({
      ...before,
      name: "Gateway '); --",
      updatedAt: expect.any(String),
    });
    expect(new Repository(database).getProvider(provider.id)).toEqual(renamed);
    expect(database.prepare("select * from secrets").all()).toEqual(secretRows);
    expect(database.prepare("select * from provider_keys").all()).toEqual(keyRows);
    expect(database.prepare("select * from models").all()).toEqual(modelRows);
    expect(repository.getSession(session.id)).toEqual(savedSession);
    expect(repository.getMessages(session.id)).toEqual(messages);
    expect(repository.getSetting(providerPromptCachingKey(provider.id))).toBeNull();
    expect(secrets.store).not.toHaveBeenCalled();
    expect(secrets.read).not.toHaveBeenCalled();
    expect(secrets.remove).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["anthropic_messages", "openai_responses", "openai_chat_completions"] as const)(
    "accepts %s and normalizes the saved address",
    (protocol) => {
      const { provider, service, input } = setup();
      const updated = service.updateProvider({
        ...input,
        name: "Updated connection",
        baseUrl: "  http://127.0.0.1:43210/api/v1///  ",
        protocol,
      });
      expect(updated).toMatchObject({
        id: provider.id,
        name: "Updated connection",
        baseUrl: "http://127.0.0.1:43210/api/v1",
        protocol,
        authMode: "custom",
        customHeaderName: "x-fixture-key",
        createdAt: provider.createdAt,
      });
    },
  );

  it("blocks address or protocol changes during active tasks while allowing equivalent-URL renames", () => {
    const { provider, service, input } = setup();
    const before = service.getProvider(provider.id);
    expect(() =>
      service.updateProvider({ ...input, baseUrl: "https://another.invalid/v1" }, true),
    ).toThrow("等待所有会话结束");
    expect(() =>
      service.updateProvider({ ...input, protocol: "anthropic_messages" }, true),
    ).toThrow("等待所有会话结束");
    expect(service.getProvider(provider.id)).toEqual(before);
    expect(
      service.updateProvider(
        { ...input, name: "Renamed while running", baseUrl: `${input.baseUrl}///` },
        true,
      ),
    ).toMatchObject({ id: provider.id, name: "Renamed while running", baseUrl: input.baseUrl });
  });

  it("preserves context calibration for a name-only change and an equivalent address", () => {
    const { repository, provider, service, input } = setup();
    const { settings } = insertSessionWithContext(repository, provider.id);
    service.updateProvider({
      ...input,
      name: "Renamed without changing connection",
      baseUrl: `${input.baseUrl}///`,
    });
    for (const [key, value] of Object.entries(settings))
      expect(repository.getSetting(key)).toEqual(value);
  });

  it.each([{ baseUrl: "https://another.invalid/v1" }, { protocol: "anthropic_messages" as const }])(
    "invalidates only matching-provider context estimates after connection change %#",
    (change) => {
      const { repository, provider, service, input } = setup();
      const otherProvider = repository.insertProvider({
        name: "Other gateway",
        baseUrl: "https://other.invalid/v1",
        protocol: "openai_responses",
        authMode: "bearer",
        customHeaderName: null,
      });
      const parent = insertSessionWithContext(repository, provider.id);
      const child = insertSessionWithContext(repository, provider.id, parent.session.id);
      const otherChild = insertSessionWithContext(repository, otherProvider.id, parent.session.id);
      const otherParent = insertSessionWithContext(repository, otherProvider.id);
      const nestedChild = insertSessionWithContext(repository, provider.id, otherParent.session.id);
      repository.updateSession(child.session.id, { archived: true });
      const affected = [parent, child, nestedChild].map((fixture) => ({
        ...fixture,
        savedSession: repository.getSession(fixture.session.id),
      }));

      service.updateProvider({ ...input, ...change });

      for (const fixture of affected) {
        for (const name of ["observation", "view", "snapshot", "basis"])
          expect(repository.getSetting(`context.${name}.${fixture.session.id}`)).toBeNull();
        for (const key of [
          `context.checkpoint.${fixture.session.id}`,
          `context.model.${fixture.session.id}`,
          `tokenSaver.usage.${fixture.session.id}`,
        ])
          expect(repository.getSetting(key)).toEqual(fixture.settings[key]);
        expect(repository.getSession(fixture.session.id)).toEqual(fixture.savedSession);
        expect(repository.getMessages(fixture.session.id)).toEqual(fixture.messages);
      }
      for (const fixture of [otherChild, otherParent])
        for (const [key, value] of Object.entries(fixture.settings))
          expect(repository.getSetting(key)).toEqual(value);
    },
  );

  it.each([
    null,
    undefined,
    false,
    [],
    {},
    { providerId: 42 },
    { providerId: "" },
    { providerId: "x".repeat(129) },
    { name: null },
    { name: " " },
    { name: "x".repeat(81) },
    { baseUrl: null },
    { baseUrl: 42 },
    { baseUrl: `https://gateway.invalid/v1/${"x".repeat(2048)}` },
    { baseUrl: "file:///v1" },
    { baseUrl: "https://gateway.invalid/api" },
    { baseUrl: "https://user:password@gateway.invalid/v1" },
    { baseUrl: "https://gateway.invalid/v1?key=fixture" },
    { baseUrl: "https://gateway.invalid/v1#fragment" },
    { protocol: "messages" },
    { protocol: null },
    { protocol: 1 },
    { apiKey: "replacement-is-not-allowed" },
    { authMode: "invalid" },
    { authMode: "custom", customHeaderName: "invalid header" },
    { authMode: "custom", customHeaderName: 42 },
  ])("rejects invalid update %# without any stored changes", (invalid) => {
    const { provider, repository, service, input } = setup();
    const before = service.getProvider(provider.id);
    const update =
      invalid && typeof invalid === "object" && !Array.isArray(invalid)
        ? Object.keys(invalid).length
          ? { ...input, ...invalid }
          : invalid
        : invalid;
    expect(() => service.updateProvider(update as ProviderUpdateInput)).toThrow();
    expect(repository.listProviders()).toEqual([before]);
    expect(repository.getSetting(providerPromptCachingKey(provider.id))).toBeNull();
  });

  it("rejects an unknown provider and leaves the connection transaction usable", () => {
    const { provider, repository, service, input } = setup();
    expect(() => service.updateProvider({ ...input, providerId: "missing" })).toThrow("不存在");
    expect(() => repository.updateProvider({ ...input, providerId: "missing" })).toThrow("不存在");
    expect(service.updateProvider({ ...input, name: "Still editable" }).id).toBe(provider.id);
  });

  it.each([
    [
      "openai_responses",
      "openai_chat_completions",
      { mode: "openai", ttl: "5m", modelFamily: "openai" },
      { mode: "openai", ttl: "5m", modelFamily: "openai" },
    ],
    [
      "openai_responses",
      "anthropic_messages",
      { mode: "openai", ttl: "5m", modelFamily: "openai" },
      { mode: "auto", ttl: "5m", modelFamily: "openai" },
    ],
    [
      "anthropic_messages",
      "openai_responses",
      { mode: "anthropic_breakpoints", ttl: "1h", modelFamily: "claude" },
      { mode: "auto", ttl: "5m", modelFamily: "claude" },
    ],
    [
      "anthropic_messages",
      "openai_chat_completions",
      { mode: "off", ttl: "1h", modelFamily: "other" },
      { mode: "auto", ttl: "5m", modelFamily: "other" },
    ],
  ] satisfies Array<
    [ProviderProtocol, ProviderProtocol, PromptCachingSettings, PromptCachingSettings]
  >)(
    "keeps cache settings compatible when changing %s to %s",
    (protocol, nextProtocol, settings, expected) => {
      const { provider, repository, service, input } = setup(protocol);
      service.setPromptCaching(provider.id, settings);
      const writeSetting = vi.spyOn(repository, "setSetting");
      const updated = service.updateProvider({ ...input, protocol: nextProtocol });
      expect(updated.promptCaching).toEqual(expected);
      expect(repository.getSetting(providerPromptCachingKey(provider.id))).toEqual(expected);
      expect(writeSetting).toHaveBeenCalledTimes(settings.mode === expected.mode ? 0 : 1);
    },
  );

  it.each(["auto", "off"] as const)(
    "clears persisted %s cache settings when switching to OpenAI Images",
    (mode) => {
      const { provider, repository, service, input } = setup("openai_responses");
      service.setPromptCaching(provider.id, { mode, ttl: "5m" });
      expect(repository.hasSetting(providerPromptCachingKey(provider.id))).toBe(true);

      const updated = service.updateProvider({ ...input, protocol: "openai_images" });

      expect(updated.protocol).toBe("openai_images");
      expect(repository.hasSetting(providerPromptCachingKey(provider.id))).toBe(false);
    },
  );

  it("rolls back an OpenAI Images protocol switch when cache cleanup fails", () => {
    const { provider, repository, service, input } = setup("openai_responses");
    const settings: PromptCachingSettings = { mode: "off", ttl: "5m" };
    service.setPromptCaching(provider.id, settings);
    const before = service.getProvider(provider.id);
    vi.spyOn(repository, "removeSetting").mockImplementationOnce(() => {
      throw new Error("Injected cache cleanup failure.");
    });

    expect(() => service.updateProvider({ ...input, protocol: "openai_images" })).toThrow(
      "Injected cache cleanup failure",
    );
    expect(service.getProvider(provider.id)).toEqual(before);
    expect(repository.getSetting(providerPromptCachingKey(provider.id))).toEqual(settings);
  });

  it("rolls back both connection and cache changes when cache persistence fails", () => {
    const { provider, repository, service, input } = setup();
    const settings: PromptCachingSettings = {
      mode: "openai",
      ttl: "5m",
      modelFamily: "openai",
    };
    service.setPromptCaching(provider.id, settings);
    const before = service.getProvider(provider.id);
    const writeSetting = repository.setSetting.bind(repository);
    vi.spyOn(repository, "setSetting").mockImplementationOnce((key, value) => {
      writeSetting(key, value);
      throw new Error("Injected cache write failure.");
    });
    expect(() =>
      service.updateProvider({
        ...input,
        name: "Must roll back",
        baseUrl: "https://another.invalid/v1",
        protocol: "anthropic_messages",
      }),
    ).toThrow("Injected cache write failure");
    expect(service.getProvider(provider.id)).toEqual(before);
    expect(repository.getSetting(providerPromptCachingKey(provider.id))).toEqual(settings);
    expect(
      service.updateProvider({ ...input, protocol: "anthropic_messages" }).promptCaching,
    ).toEqual({ ...settings, mode: "auto", ttl: "5m" });
  });

  it("rolls back connection, cache and partial calibration cleanup together", () => {
    const { database, repository, provider, service, input } = setup();
    const settings: PromptCachingSettings = {
      mode: "openai",
      ttl: "5m",
      modelFamily: "openai",
    };
    service.setPromptCaching(provider.id, settings);
    const parent = insertSessionWithContext(repository, provider.id);
    insertSessionWithContext(repository, provider.id, parent.session.id);
    const before = service.getProvider(provider.id);
    const savedSettings = database.prepare("select * from app_settings order by key").all();
    const removeSetting = repository.removeSetting.bind(repository);
    let removals = 0;
    const cleanup = vi.spyOn(repository, "removeSetting").mockImplementation((key) => {
      removeSetting(key);
      if (++removals === 2) throw new Error("Injected calibration cleanup failure.");
    });
    expect(() =>
      service.updateProvider({
        ...input,
        name: "Must roll back everything",
        baseUrl: "https://another.invalid/v1",
        protocol: "anthropic_messages",
      }),
    ).toThrow("Injected calibration cleanup failure");
    expect(removals).toBe(2);
    expect(service.getProvider(provider.id)).toEqual(before);
    expect(database.prepare("select * from app_settings order by key").all()).toEqual(
      savedSettings,
    );
    cleanup.mockRestore();
    expect(
      service.updateProvider({ ...input, protocol: "anthropic_messages" }).promptCaching,
    ).toEqual({ ...settings, mode: "auto", ttl: "5m" });
    expect(repository.getSetting(`context.observation.${parent.session.id}`)).toBeNull();
    expect(repository.getSetting(`context.checkpoint.${parent.session.id}`)).toEqual(
      parent.settings[`context.checkpoint.${parent.session.id}`],
    );
  });
});
