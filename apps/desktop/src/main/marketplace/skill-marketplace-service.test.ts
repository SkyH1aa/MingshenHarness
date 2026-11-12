import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExtensionService } from "../extensions/extension-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { SkillMarketplaceService } from "./skill-marketplace-service";

describe("SkillMarketplaceService", () => {
  it.runIf(process.env.MINGSHEN_MARKETPLACE_E2E === "1")(
    "reads openai/skills from GitHub and installs a selected skill",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-marketplace-"));
      const database = openDatabase(join(root, "test.db"));
      const repository = new Repository(database);
      const extensions = new ExtensionService(repository, join(root, "extensions"));
      const marketplace = new SkillMarketplaceService(join(root, "market"), extensions);
      try {
        const skills = await marketplace.list("openai", true);
        expect(skills.length).toBeGreaterThan(20);
        const screenshotSkill = skills.find((skill) => skill.path === "skills/.curated/screenshot");
        expect(screenshotSkill).toBeDefined();

        const installed = await marketplace.install("openai", "skills/.curated/screenshot");
        expect(installed.extension.type).toBe("skill");
        expect(installed.extension.installedPath).toBeTruthy();
        expect(extensions.list().some((extension) => extension.id === installed.extension.id)).toBe(
          true,
        );

        const communitySkills = await marketplace.list("composio", true);
        expect(communitySkills.length).toBeGreaterThan(20);
        expect(communitySkills.every((skill) => skill.source === "composio")).toBe(true);
        const communityInstall = await marketplace.install(
          "composio",
          communitySkills[0]?.path ?? "",
        );
        expect(communityInstall.extension.type).toBe("skill");
      } finally {
        database.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
