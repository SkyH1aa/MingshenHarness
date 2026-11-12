import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { AgentProfileService } from "./agent-profile-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
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
});
