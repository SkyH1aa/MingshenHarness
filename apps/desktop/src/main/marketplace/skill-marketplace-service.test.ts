import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ExtensionService } from "../extensions/extension-service";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { SkillMarketplaceService } from "./skill-marketplace-service";

describe("SkillMarketplaceService", () => {
  it.each([
    { files: 20_000, expectedError: "64 MiB" },
    { files: 20_001, expectedError: "20000" },
  ])(
    "checks $files cached skill files before downloading or importing",
    async ({ files, expectedError }) => {
      const root = await mkdtemp(join(tmpdir(), "mingshen-marketplace-limits-"));
      const database = openDatabase(join(root, "test.db"));
      const extensions = new ExtensionService(new Repository(database), join(root, "extensions"));
      const marketplace = new SkillMarketplaceService(root, extensions);
      const skillPath = "skills/.curated/large-skill";
      const fetchMock = vi.fn(() => Promise.reject(new Error("Unexpected network access")));
      vi.stubGlobal("fetch", fetchMock);
      try {
        await writeFile(
          join(root, "openai-skills-cache.json"),
          JSON.stringify({
            fetchedAt: new Date().toISOString(),
            treeSha: "offline-test-tree",
            tree: Array.from({ length: files }, (_, index) => ({
              path: `${skillPath}/${index === 0 ? "SKILL.md" : `asset-${index}.txt`}`,
              type: "blob",
              size: 4096,
            })),
            skills: [{ id: skillPath, name: "large-skill", path: skillPath, source: "openai" }],
          }),
        );

        await expect(marketplace.install("openai", skillPath)).rejects.toThrow(expectedError);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(extensions.list()).toEqual([]);
        expect((await readdir(root)).some((name) => name.startsWith("install-"))).toBe(false);
        await expect(access(join(root, "extensions"))).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        vi.unstubAllGlobals();
        database.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

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
