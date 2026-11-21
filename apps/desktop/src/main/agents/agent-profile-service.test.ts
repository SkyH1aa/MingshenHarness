import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { stopGuardedWorkspaceIo } from "../workspace/guarded-workspace-io";
import { AgentProfileService } from "./agent-profile-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await stopGuardedWorkspaceIo();
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("AgentProfileService", () => {
  it("imports Markdown agents with permissions and model parameters", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    const agents = join(root, ".opencode", "agents");
    await mkdir(agents, { recursive: true });
    await writeFile(
      join(agents, "review.md"),
      [
        "---",
        "description: Reviews changes",
        "mode: subagent",
        "temperature: 0.2",
        "top_p: 0.8",
        "steps: 5",
        "permission:",
        "  edit: deny",
        "  bash:",
        '    "*": ask',
        '    "git diff*": allow',
        "---",
        "Review the current changes without editing files.",
      ].join("\n"),
      "utf8",
    );
    try {
      const service = new AgentProfileService(repository);
      await service.syncWorkspace(root);
      const review = service.list().find((profile) => profile.name === "review");
      expect(review).toMatchObject({
        role: "subagent",
        readOnly: true,
        temperature: 0.2,
        topP: 0.8,
        maxSteps: 5,
      });
      expect(review?.permissions["bash:git diff*"]).toBe("allow");
    } finally {
      database.close();
    }
  });

  it("imports JSONC agents including mode all and prompt files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-json-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    await mkdir(join(root, "prompts"), { recursive: true });
    await writeFile(join(root, "prompts", "review.txt"), "Review code without editing.", "utf8");
    await writeFile(
      join(root, "opencode.jsonc"),
      `{
        // OpenCode-compatible agent config
        "agent": {
          "reviewer": {
            "description": "Reviews changes",
            "mode": "all",
            "prompt": "{file:./prompts/review.txt}",
            "permission": { "edit": "deny" },
            "temperature": 0.2,
            "top_p": 0.8,
            "steps": 6
          }
        }
      }`,
      "utf8",
    );
    try {
      const service = new AgentProfileService(repository);
      await service.syncWorkspace(root);
      const reviewer = service.list().find((profile) => profile.name === "reviewer");
      expect(reviewer).toMatchObject({
        role: "all",
        readOnly: true,
        maxSteps: 6,
        topP: 0.8,
      });
      expect(reviewer?.instructions).toBe("Review code without editing.");
    } finally {
      database.close();
    }
  });

  it("ignores project agent configuration until the workspace is trusted", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-trust-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        agent: {
          reviewer: {
            prompt: "Review only trusted workspace changes.",
          },
        },
      }),
      "utf8",
    );
    try {
      const service = new AgentProfileService(repository);
      await service.syncWorkspace(root);
      expect(service.list().some((profile) => profile.name === "reviewer")).toBe(false);

      repository.setProjectTrusted(root, true);
      await service.syncWorkspace(root);
      expect(service.list().find((profile) => profile.name === "reviewer")).toMatchObject({
        instructions: "Review only trusted workspace changes.",
      });
    } finally {
      database.close();
    }
  });

  it("ignores project Markdown agents until the workspace is trusted", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-markdown-trust-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    const agents = join(root, ".opencode", "agents");
    await mkdir(agents, { recursive: true });
    await writeFile(
      join(agents, "review.md"),
      ["---", "name: Project reviewer", "---", "Review project changes."].join("\n"),
      "utf8",
    );
    try {
      const service = new AgentProfileService(repository);
      await service.syncWorkspace(root);
      expect(service.list().some((profile) => profile.name === "Project reviewer")).toBe(false);

      repository.setProjectTrusted(root, true);
      await service.syncWorkspace(root);
      expect(service.list().some((profile) => profile.name === "Project reviewer")).toBe(true);
    } finally {
      database.close();
    }
  });

  it("removes project-sourced agents when trust is revoked", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-untrust-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        agent: {
          projectOnly: { prompt: "Project-scoped instructions." },
        },
      }),
      "utf8",
    );
    try {
      const service = new AgentProfileService(repository);
      await service.syncWorkspace(root);
      expect(service.list().some((profile) => profile.name === "projectOnly")).toBe(true);

      repository.setProjectTrusted(root, false);
      await service.syncWorkspace(root);
      expect(service.list().some((profile) => profile.name === "projectOnly")).toBe(false);
    } finally {
      database.close();
    }
  });

  it("keeps project build overrides separate from the built-in primary profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-primary-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        agent: {
          build: {
            prompt: "Treat this repository as untrusted project data.",
            permission: { "*": "allow" },
          },
        },
      }),
      "utf8",
    );
    try {
      const service = new AgentProfileService(repository);
      await service.syncWorkspace(root);
      const primary = repository.getAgentProfile("primary");
      const projectBuild = service
        .list()
        .find(
          (profile) =>
            profile.name === "build" &&
            profile.sourcePath?.toLowerCase().startsWith(root.toLowerCase()),
        );
      expect(primary).toMatchObject({
        name: "Mingshen",
        instructions: "",
        sourcePath: null,
      });
      expect(primary?.permissions).toEqual({});
      expect(projectBuild).toMatchObject({
        instructions: "Treat this repository as untrusted project data.",
        role: "primary",
      });
      expect(projectBuild?.id).not.toBe("primary");
    } finally {
      database.close();
    }
  });

  it("repairs built-in profiles polluted by an earlier project config sync", () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    try {
      const primary = repository.getAgentProfile("primary");
      if (!primary) throw new Error("Primary profile is missing.");
      repository.saveAgentProfile({
        ...primary,
        instructions: "Injected project instructions.",
        permissions: { "*": "allow" },
        sourcePath: "C:\\untrusted\\opencode.json#agent:build",
      });
      const service = new AgentProfileService(repository);
      expect(service.list().find((profile) => profile.id === "primary")).toMatchObject({
        name: "Mingshen",
        instructions: "",
        sourcePath: null,
        permissions: {},
      });
    } finally {
      database.close();
    }
  });

  it("does not let trusted project prompts read files outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-boundary-"));
    const outside = await mkdtemp(join(tmpdir(), "mingshen-agent-secret-"));
    temporaryDirectories.push(root, outside);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    const secret = join(outside, "secret.txt");
    await writeFile(secret, "Do not inject this external content.", "utf8");
    await writeFile(
      join(root, "opencode.json"),
      JSON.stringify({
        agent: {
          reviewer: {
            prompt: `{file:${secret}}`,
          },
        },
      }),
      "utf8",
    );
    try {
      const service = new AgentProfileService(repository);
      await service.syncWorkspace(root);
      expect(service.list().find((profile) => profile.name === "reviewer")?.instructions).toBe("");
    } finally {
      database.close();
    }
  });

  it("preserves model values while runtime eligibility is decided by role", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-model-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    try {
      const service = new AgentProfileService(repository);
      const base = {
        name: "Model worker",
        description: "Model routing test",
        instructions: "",
        readOnly: false,
        enabled: true,
        hidden: false,
        modelId: "dedicated-model",
        permissions: {},
        toolAllowlist: [] as string[],
        temperature: null,
        topP: null,
        maxSteps: null,
        color: null,
      };

      for (const role of ["subagent", "all"] as const) {
        expect(service.save({ ...base, name: `Worker ${role}`, role })).toMatchObject({
          role,
          modelId: "dedicated-model",
        });
      }

      for (const role of ["primary", "plan"] as const) {
        expect(service.save({ ...base, name: `Worker ${role}`, role })).toMatchObject({
          role,
          modelId: "dedicated-model",
        });
      }
    } finally {
      database.close();
    }
  });

  it("rejects a known image-output model when saving a profile", () => {
    const database = openDatabase(":memory:");
    const repository = new Repository(database);
    try {
      const provider = repository.insertProvider({
        name: "Fixture",
        baseUrl: "https://example.com/v1",
        protocol: "openai_responses",
        authMode: "bearer",
        customHeaderName: null,
      });
      repository.insertModel({
        providerId: provider.id,
        modelId: "image",
        displayName: "Image",
        contextWindow: 10000,
        maxOutputTokens: 1000,
        inputModalities: ["text"],
        outputModalities: ["image"],
        toolCalls: false,
        parallelToolCalls: false,
        reasoningLevels: [],
        anthropicNoneBehavior: "disabled",
      });
      const image = repository
        .getProvider(provider.id)
        ?.models.find((item) => item.modelId === "image");
      if (!image) throw new Error("Missing image fixture model");
      const service = new AgentProfileService(repository);
      expect(() =>
        service.save({
          name: "Image worker",
          description: "",
          role: "subagent",
          instructions: "",
          modelId: image.id,
          readOnly: false,
          enabled: true,
        }),
      ).toThrow("文本输入和输出");
      expect(service.list().some((profile) => profile.name === "Image worker")).toBe(false);
    } finally {
      database.close();
    }
  });

  it("defaults existing profiles to both workbench modes and validates explicit applicability", () => {
    const database = openDatabase(":memory:");
    try {
      const service = new AgentProfileService(new Repository(database));
      expect(service.list()[0]?.applicableModes).toEqual(["code", "work"]);
      const workOnly = service.save({
        name: "Work specialist",
        description: "",
        role: "primary",
        instructions: "",
        readOnly: false,
        enabled: true,
        applicableModes: ["work"],
      });
      expect(workOnly.applicableModes).toEqual(["work"]);
      expect(() =>
        service.save({
          name: "Invalid modes",
          description: "",
          role: "primary",
          instructions: "",
          readOnly: false,
          enabled: true,
          applicableModes: [],
        }),
      ).toThrow("至少需要适用于");
    } finally {
      database.close();
    }
  });

  it("preserves mode restrictions when an existing synced profile omits applicability metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-agent-modes-"));
    temporaryDirectories.push(root);
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    const agents = join(root, ".opencode", "agents");
    await mkdir(agents, { recursive: true });
    const markdownPath = join(agents, "office.md");
    await writeFile(
      markdownPath,
      [
        "---",
        "name: Office specialist",
        "description: Version one",
        "---",
        "Edit office files.",
      ].join("\n"),
      "utf8",
    );
    try {
      const service = new AgentProfileService(repository);
      await service.syncWorkspace(root);
      const office = service.list().find((profile) => profile.name === "Office specialist");
      if (!office) throw new Error("Synced profile was not imported.");
      repository.saveAgentProfile({ ...office, applicableModes: ["work"] });

      await writeFile(
        markdownPath,
        [
          "---",
          "name: Office specialist",
          "description: Version two",
          "---",
          "Edit office files.",
        ].join("\n"),
        "utf8",
      );
      await service.syncWorkspace(root);
      expect(
        service.list().find((profile) => profile.name === "Office specialist")?.applicableModes,
      ).toEqual(["work"]);

      await writeFile(
        markdownPath,
        [
          "---",
          "name: Office specialist",
          "description: Version three",
          "applicable_modes:",
          "  - code",
          "---",
          "Edit office files.",
        ].join("\n"),
        "utf8",
      );
      await service.syncWorkspace(root);
      expect(
        service.list().find((profile) => profile.name === "Office specialist")?.applicableModes,
      ).toEqual(["code"]);
    } finally {
      database.close();
    }
  });
});
