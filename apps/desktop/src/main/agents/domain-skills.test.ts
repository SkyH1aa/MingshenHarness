import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionView } from "../../shared/domain";
import type { ExtensionService } from "../extensions/extension-service";
import {
  builtinCapabilityDiscoveryRecords,
  type CapabilityDiscoveryRecord,
  domainSkillCatalog,
  loadDomainSkill,
  mergeCapabilityDiscoveryRecords,
} from "./domain-skills";

const temporaryDirectories: string[] = [];
const codeSession = { agentMode: "code" } as SessionView;
const extensions = {} as ExtensionService;

function ensureDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is undefined`);
  return value;
}

async function makePromptDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-domain-skills-"));
  temporaryDirectories.push(root);
  const skillRoot = join(root, "skills", "code-debugging");
  await mkdir(join(skillRoot, "references"), { recursive: true });
  await writeFile(join(root, "skills", "code-debugging.md"), "ENTRY\n", "utf8");
  return root;
}

async function makeWorkSourcePromptDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-work-sources-"));
  temporaryDirectories.push(root);
  const skills = join(root, "skills");
  const commonEntry = join(skills, "work-sources", "entries", "shared", "SKILL.md");
  const editor = join(skills, "work-sources", "pdf-editor");
  const reader = join(skills, "work-sources", "pdf-reader");
  await mkdir(join(skills, "work-sources", "entries", "shared"), { recursive: true });
  await mkdir(join(editor, "references"), { recursive: true });
  await mkdir(join(reader, "references"), { recursive: true });
  await writeFile(commonEntry, "# Shared PDF source\n\nPDF source body.\n", "utf8");
  await writeFile(join(editor, "references", "routes.md"), "EDITOR ROUTES", "utf8");
  await writeFile(join(reader, "references", "routes.md"), "READER ROUTES", "utf8");
  const sharedSha = "a".repeat(64);
  await writeFile(
    join(skills, "work-sources", "catalog.json"),
    JSON.stringify({
      schemaVersion: 1,
      sourceArchiveSha256: "b".repeat(64),
      entries: [
        {
          id: "builtin:work-source-pdf-0-2-3-editor-11111111",
          name: "pdf",
          description: "Create and edit polished PDF documents from native layouts.",
          family: "pdf",
          version: "0.2.3",
          sourcePath: "pdf/0.2.3/skills/pdf-editor/SKILL.md",
          sourceSha256: sharedSha,
          entry: "work-sources/entries/shared/SKILL.md",
          resourceRoot: "work-sources/pdf-editor",
          compatibility: "native",
          licenseDisposition: "adapted",
          tags: ["editor", "native-layout"],
        },
        {
          id: "builtin:work-source-pdf-0-2-3-reader-22222222",
          name: "pdf",
          description: "Read, extract, inspect and summarize existing PDF documents.",
          family: "pdf",
          version: "0.2.3",
          sourcePath: "pdf/0.2.3/skills/pdf-reader/SKILL.md",
          sourceSha256: sharedSha,
          entry: "work-sources/entries/shared/SKILL.md",
          resourceRoot: "work-sources/pdf-reader",
          compatibility: "adapted",
          licenseDisposition: "adapted",
          tags: ["reader", "extraction"],
        },
        {
          id: "builtin:work-source-pdf-loose-forms-33333333",
          name: "pdf-forms",
          description: "Inspect and fill PDF forms without changing their layout.",
          family: "pdf",
          version: null,
          sourcePath: "pdf-reading/SKILL.md",
          sourceSha256: "c".repeat(64),
          entry: "work-sources/entries/shared/SKILL.md",
          resourceRoot: "work-sources/pdf-editor",
          compatibility: "reference",
          licenseDisposition: "reference-only",
          tags: ["forms", "acroform"],
        },
      ],
    }),
    "utf8",
  );
  return root;
}

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("built-in domain skill resources", () => {
  it("locates the installed SDK for creator workflows independently of the user's workspace", async () => {
    const promptDirectory = resolve("resources/prompts");
    const output = await loadDomainSkill(
      codeSession,
      { name: "builtin:plugin-creator" },
      promptDirectory,
      extensions,
    );
    expect(output).toContain(resolve("resources/sdk/plugin-dev/mingshen-plugin.mjs"));
    expect(output).toContain("may be unavailable to sandboxed commands or PATH");
    expect(output).toContain(
      "local_plugin inspect/validate as the authoritative runtime preflight",
    );
    expect(output).toContain("must not rely on node/run_command");
    expect(output).toContain("Installation and lifecycle changes remain explicit user actions");
  });

  it("exposes every copied design entry through the on-demand resource loader", async () => {
    const promptDirectory = resolve("resources/prompts");
    const manifest = JSON.parse(
      await readFile(
        resolve(promptDirectory, "skills/work-visual-design/references/design-entry-manifest.json"),
        "utf8",
      ),
    ) as {
      entryCount: number;
      skeletonCount: number;
      subskillCount: number;
      entries: Array<{ kind: "skeleton" | "subskill"; targetResource: string }>;
    };

    expect(manifest.entryCount).toBe(82);
    expect(manifest.skeletonCount).toBe(74);
    expect(manifest.subskillCount).toBe(8);
    expect(new Set(manifest.entries.map((entry) => entry.targetResource)).size).toBe(82);

    for (const entry of manifest.entries) {
      const output = await loadDomainSkill(
        { agentMode: "work" } as SessionView,
        { name: "builtin:work-visual-design", resource: entry.targetResource },
        promptDirectory,
        extensions,
      );
      expect(output).toContain("Built-in skill: builtin:work-visual-design");
      expect(output).toContain("Resource: references/");
      expect(output.length).toBeGreaterThan(100);
    }
  });

  it("loads packaged Office and Code references by skill-scoped relative paths", async () => {
    const promptDirectory = resolve("resources/prompts");
    const resources = [
      ["builtin:code-engineering", "references/large-change-execution.md", "code"],
      ["builtin:code-debugging", "references/failure-forensics.md", "code"],
      ["builtin:code-verification", "references/test-design.md", "code"],
      ["builtin:code-frontend", "references/visual-acceptance.md", "code"],
      ["builtin:code-platform", "references/release-safety.md", "code"],
      ["builtin:work-word", "work-word/references/editorial-quality.md", "work"],
      ["builtin:work-word", "references/document-routes.md", "work"],
      ["builtin:work-spreadsheets", "references/report-surfaces.md", "work"],
      ["builtin:work-spreadsheets", "references/workbook-routes.md", "work"],
      ["builtin:work-presentations", "work-presentations/references/story-and-layout.md", "work"],
      ["builtin:work-presentations", "references/deck-routes.md", "work"],
      ["builtin:work-pdf", "references/pdf-production.md", "work"],
      ["builtin:work-pdf", "references/pdf-preflight.md", "work"],
      [
        "builtin:work-visual-design",
        "references/design-resources/design-skeletons/dashboard/SKILL.md",
        "work",
      ],
      ["builtin:work-visual-design", "references/template-catalog.md", "work"],
      ["builtin:work-visual-design", "references/design-entry-manifest.json", "work"],
      ["builtin:work-visualization", "references/chart-selection.md", "work"],
      ["builtin:work-visualization", "references/templates/chart-explainer.html", "work"],
      ["builtin:work-image-sourcing", "references/sourcing-and-rights.md", "work"],
      ["builtin:plugin-creator", "references/local-plugin-development.md", "work"],
      ["builtin:harness-plugin-api", "references/interface-template.md", "code"],
      ["builtin:artifact-quality", "references/format-acceptance.md", "work"],
    ] as const;

    for (const [name, resource, agentMode] of resources) {
      const localResource = resource.includes("/references/")
        ? resource.split("/references/").at(-1)
        : resource.startsWith("references/")
          ? resource.slice("references/".length)
          : resource;
      const output = await loadDomainSkill(
        { agentMode } as SessionView,
        { name, resource },
        promptDirectory,
        extensions,
      );
      expect(output).toContain(`Built-in skill: ${name}`);
      expect(output).toContain(`Resource: references/${localResource}`);
      expect(output.length).toBeGreaterThan(100);
    }
  });

  it("keeps PPT Master and ASD-STE100 Work-only and loadable through manual ids", async () => {
    const promptDirectory = resolve("resources/prompts");
    const work = { agentMode: "work" } as SessionView;
    const code = { agentMode: "code" } as SessionView;
    const chat = { agentMode: "chat" } as SessionView;
    const workRecords = await builtinCapabilityDiscoveryRecords(work, promptDirectory);
    const codeRecords = await builtinCapabilityDiscoveryRecords(code, promptDirectory);
    const ids = ["builtin:work-ppt-master", "builtin:work-asd-ste100"];

    for (const id of ids) {
      expect(workRecords.some((entry) => entry.id === id)).toBe(true);
      expect(codeRecords.some((entry) => entry.id === id)).toBe(false);
      expect(domainSkillCatalog(work)).toContain(id);
      expect(domainSkillCatalog(code)).not.toContain(id);
      expect(await loadDomainSkill(work, { name: id }, promptDirectory, extensions)).toContain(
        `Built-in skill: ${id}`,
      );
      await expect(
        loadDomainSkill(code, { name: id }, promptDirectory, extensions),
      ).rejects.toThrow("SKILL_MODE_UNAVAILABLE");
      await expect(
        loadDomainSkill(chat, { name: id }, promptDirectory, extensions),
      ).rejects.toThrow("CHAT_TOOL_DENIED");
    }

    expect(
      await loadDomainSkill(
        work,
        { name: "builtin:work-ppt-master", resource: "references/source/SKILL.md" },
        promptDirectory,
        extensions,
      ),
    ).toContain("# PPT Master Skill");
    expect(
      await loadDomainSkill(
        work,
        {
          name: "builtin:work-asd-ste100",
          resource: "references/source/references/writing-rules.md",
        },
        promptDirectory,
        extensions,
      ),
    ).toContain("ASD-STE100");
  });

  it("rejects traversal, absolute paths, binary data and oversized references", async () => {
    const promptDirectory = await makePromptDirectory();
    const references = join(promptDirectory, "skills", "code-debugging", "references");
    await mkdir(join(references, "nested"), { recursive: true });
    await writeFile(join(references, "nested", "guide.md"), "SAFE-GUIDE", "utf8");
    await writeFile(join(references, "binary.bin"), Buffer.from([1, 0, 2]));
    await writeFile(join(references, "invalid-utf8.bin"), Buffer.from([0xff, 0xfe, 0xfd]));
    await writeFile(join(references, "large.md"), "");
    await truncate(join(references, "large.md"), 2 * 1024 * 1024 + 1);

    expect(
      await loadDomainSkill(
        codeSession,
        { name: "builtin:code-debugging", resource: "references/nested/guide.md" },
        promptDirectory,
        extensions,
      ),
    ).toContain("SAFE-GUIDE");
    expect(
      await loadDomainSkill(
        codeSession,
        { name: "builtin:code-debugging", resource: "../outside.md" },
        promptDirectory,
        extensions,
      ).catch((error: Error) => error.message),
    ).toContain("SKILL_RESOURCE_PATH_INVALID");
    expect(
      await loadDomainSkill(
        codeSession,
        { name: "builtin:code-debugging", resource: "C:\\outside.md" },
        promptDirectory,
        extensions,
      ).catch((error: Error) => error.message),
    ).toContain("SKILL_RESOURCE_PATH_INVALID");
    await expect(
      loadDomainSkill(
        codeSession,
        { name: "builtin:code-debugging", resource: "references/binary.bin" },
        promptDirectory,
        extensions,
      ),
    ).rejects.toThrow("SKILL_RESOURCE_NOT_TEXT");
    await expect(
      loadDomainSkill(
        codeSession,
        { name: "builtin:code-debugging", resource: "references/invalid-utf8.bin" },
        promptDirectory,
        extensions,
      ),
    ).rejects.toThrow("SKILL_RESOURCE_NOT_TEXT");
    await expect(
      loadDomainSkill(
        codeSession,
        { name: "builtin:code-debugging", resource: "references/large.md" },
        promptDirectory,
        extensions,
      ),
    ).rejects.toThrow("SKILL_RESOURCE_TOO_LARGE");
  });

  it.runIf(process.platform !== "win32")(
    "rejects references that escape through a directory link",
    async () => {
      const promptDirectory = await makePromptDirectory();
      const outside = join(promptDirectory, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "secret.md"), "OUTSIDE", "utf8");
      const link = join(
        promptDirectory,
        "skills",
        "code-debugging",
        "references",
        "linked-outside",
      );
      await symlink(outside, link, "dir");

      try {
        await expect(
          loadDomainSkill(
            codeSession,
            {
              name: "builtin:code-debugging",
              resource: "references/linked-outside/secret.md",
            },
            promptDirectory,
            extensions,
          ),
        ).rejects.toThrow("SKILL_RESOURCE_ESCAPE");
      } finally {
        await rmdir(link).catch(() => undefined);
      }
    },
    20_000,
  );

  it("keeps surrogate pairs intact across 32k UTF-16 pages and rejects split offsets", async () => {
    const promptDirectory = await makePromptDirectory();
    const content = `${"a".repeat(31_999)}😀tail`;
    await writeFile(
      join(promptDirectory, "skills", "code-debugging", "references", "pagination.md"),
      content,
      "utf8",
    );

    const first = await loadDomainSkill(
      codeSession,
      { name: "builtin:code-debugging", resource: "references/pagination.md" },
      promptDirectory,
      extensions,
    );
    expect(first).toContain(`Characters: 0-31999/${content.length}`);
    expect(first).toContain("Continue with char_offset:31999.");
    expect(first).not.toMatch(
      /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );

    const second = await loadDomainSkill(
      codeSession,
      {
        name: "builtin:code-debugging",
        resource: "references/pagination.md",
        char_offset: 31_999,
      },
      promptDirectory,
      extensions,
    );
    expect(second).toContain(`Characters: 31999-${content.length}/${content.length}`);
    expect(second).toContain("😀tail");

    await expect(
      loadDomainSkill(
        codeSession,
        {
          name: "builtin:code-debugging",
          resource: "references/pagination.md",
          char_offset: 32_000,
        },
        promptDirectory,
        extensions,
      ),
    ).rejects.toThrow("SKILL_RESOURCE_OFFSET_INVALID");
  });
});

describe("built-in capability discovery", () => {
  it("merges packaged Work sources and installed capabilities with stable pages", async () => {
    const promptDirectory = await makeWorkSourcePromptDirectory();
    const workSession = { agentMode: "work" } as SessionView;
    const builtins = await builtinCapabilityDiscoveryRecords(workSession, promptDirectory);
    const installed: CapabilityDiscoveryRecord[] = [
      {
        type: "skill",
        id: "extension-id/skills/ledger/SKILL.md",
        name: "ledger-audit",
        description: "Audit spreadsheet formulas and ledger reconciliations.",
        session_selected: true,
        source: "installed",
        searchable: "ledger formula spreadsheet reconciliation",
      },
      {
        type: "plugin",
        id: "renderer-plugin",
        name: "slide-renderer",
        description: "Render and inspect presentation files.",
        session_selected: false,
        source: "installed",
        searchable: "presentation renderer",
      },
    ];

    expect(builtins.filter((entry) => entry.builtin_kind === "work-source")).toHaveLength(3);
    expect(builtins.some((entry) => entry.id === "builtin:work-pdf")).toBe(true);
    expect(
      builtins.some(
        (entry) =>
          entry.id === "builtin:work-source-pdf-0-2-3-reader-22222222" &&
          entry.source_path === "pdf/0.2.3/skills/pdf-reader/SKILL.md" &&
          entry.source_sha256 === "a".repeat(64) &&
          entry.license_disposition === "adapted",
      ),
    ).toBe(true);

    const first = mergeCapabilityDiscoveryRecords(installed, builtins, {
      query: "pdf",
      kind: "skill",
      offset: 0,
      limit: 2,
    });
    const firstPayload = JSON.parse(first.slice(first.indexOf("{"))) as {
      total: number;
      offset: number;
      returned: number;
      next_offset: number | null;
      matches: Array<{ id: string }>;
    };
    expect(firstPayload).toMatchObject({
      total: 4,
      offset: 0,
      returned: 2,
      next_offset: 2,
    });

    const second = mergeCapabilityDiscoveryRecords(installed, builtins, {
      query: "pdf",
      kind: "skill",
      offset: 2,
      limit: 2,
    });
    const secondPayload = JSON.parse(second.slice(second.indexOf("{"))) as typeof firstPayload;
    expect(secondPayload).toMatchObject({
      total: 4,
      offset: 2,
      returned: 2,
      next_offset: null,
    });
    expect(
      new Set([...firstPayload.matches, ...secondPayload.matches].map((item) => item.id)).size,
    ).toBe(4);

    const installedMatch = mergeCapabilityDiscoveryRecords(installed, builtins, {
      query: "ledger formula",
      kind: "all",
      offset: 0,
      limit: 20,
    });
    expect(installedMatch).toContain('"name": "ledger-audit"');
    expect(installedMatch).toContain('"source": "installed"');
    expect(installedMatch).not.toContain("builtin:work-source-pdf-0-2-3-editor");

    const pluginOnly = mergeCapabilityDiscoveryRecords(installed, builtins, {
      query: "presentation",
      kind: "plugin",
      offset: 0,
      limit: 20,
    });
    expect(pluginOnly).toContain('"name": "slide-renderer"');
    expect(pluginOnly).not.toContain('"type": "skill"');

    for (const query of ["skill", "技能", "内置", "创建技能", "创建插件", "pdf阅读"]) {
      const result = mergeCapabilityDiscoveryRecords(installed, builtins, {
        query,
        kind: "skill",
        offset: 0,
        limit: 20,
      });
      expect(result).not.toContain('"total": 0');
      expect(result).toContain('"type": "skill"');
    }
    expect(
      mergeCapabilityDiscoveryRecords(installed, builtins, {
        query: "acroform",
        kind: "skill",
        offset: 0,
        limit: 20,
      }),
    ).toContain('"version": null');
  });

  it("does not expose packaged Work sources to Code or Chat", async () => {
    const promptDirectory = await makeWorkSourcePromptDirectory();
    const code = await builtinCapabilityDiscoveryRecords(
      { agentMode: "code" } as SessionView,
      promptDirectory,
    );
    const work = await builtinCapabilityDiscoveryRecords(
      { agentMode: "work" } as SessionView,
      promptDirectory,
    );
    const chat = await builtinCapabilityDiscoveryRecords(
      { agentMode: "chat" } as SessionView,
      promptDirectory,
    );
    expect(code.filter((entry) => entry.builtin_kind === "foundation")).toHaveLength(9);
    expect(work.filter((entry) => entry.builtin_kind === "foundation")).toHaveLength(16);
    expect(code.some((entry) => entry.builtin_kind === "work-source")).toBe(false);
    expect(work.filter((entry) => entry.builtin_kind === "work-source")).toHaveLength(3);
    expect(code.some((entry) => entry.id === "builtin:code-debugging")).toBe(true);
    expect(chat).toEqual([]);
    expect(domainSkillCatalog({ agentMode: "work" } as SessionView)).toContain(
      "Packaged Work source variants are searchable by capability, source name, family and version",
    );
    await expect(
      loadDomainSkill(
        { agentMode: "code" } as SessionView,
        { name: "builtin:work-source-pdf-0-2-3-editor-11111111" },
        promptDirectory,
        extensions,
      ),
    ).rejects.toThrow("SKILL_MODE_UNAVAILABLE");
  });

  it("retains the physical inventory but discovers and loads only active Work source versions", async () => {
    const promptDirectory = resolve("resources/prompts");
    const work = { agentMode: "work" } as SessionView;
    const code = { agentMode: "code" } as SessionView;
    const chat = { agentMode: "chat" } as SessionView;
    const catalog = JSON.parse(
      await readFile(resolve(promptDirectory, "skills/work-sources/catalog.json"), "utf8"),
    ) as {
      entries: Array<{
        id: string;
        name: string;
        description: string;
        family: string;
        version: string | null;
        sourcePath: string;
        sourceSha256: string;
        entry: string;
        resourceRoot: string;
      }>;
    };
    const entries = catalog.entries;
    expect(entries).toHaveLength(124);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(124);
    expect(new Set(entries.map((entry) => entry.name)).size).toBe(93);
    expect(new Set(entries.map((entry) => entry.sourceSha256)).size).toBe(104);
    expect(entries.every((entry) => !entry.id.includes("."))).toBe(true);
    expect(
      entries.every(
        (entry) =>
          !entry.entry.startsWith("skills/") &&
          !entry.resourceRoot.startsWith("skills/") &&
          entry.id.endsWith(entry.sourceSha256.slice(0, 8)),
      ),
    ).toBe(true);

    const mainDesign = ensureDefined(
      entries.find((entry) => entry.sourcePath === "design-1/0.7.2/skills/design/SKILL.md"),
      "main design source",
    );
    const mainDesignBody = await readFile(
      join(promptDirectory, "skills", mainDesign.entry),
      "utf8",
    );
    expect(mainDesignBody).toContain('resource:"references/template-catalog.md"');
    expect(mainDesignBody).not.toContain('resource:"references/design-resources/SKILL.md"');
    expect(
      await loadDomainSkill(
        work,
        { name: mainDesign.id, resource: "SOURCE.md" },
        promptDirectory,
        extensions,
      ),
    ).toContain("Source representation: native workflow adapter");

    const designResourceEntries = entries.filter((entry) =>
      entry.sourcePath.includes("/skills/design/design-resources/"),
    );
    expect(designResourceEntries).toHaveLength(82);
    for (const entry of designResourceEntries) {
      const body = await readFile(join(promptDirectory, "skills", entry.entry), "utf8");
      const route = ensureDefined(
        body.match(/resource:"(references\/design-resources\/[^"]+)"/)?.[1],
        `${entry.sourcePath} design resource route`,
      );
      expect(
        await loadDomainSkill(
          work,
          { name: "builtin:work-visual-design", resource: route },
          promptDirectory,
          extensions,
        ),
      ).toContain("Built-in skill: builtin:work-visual-design");
    }

    const nonDesignEntries = entries.filter(
      (entry) => !entry.sourcePath.includes("/skills/design/design-resources/"),
    );
    expect(new Set(nonDesignEntries.map((entry) => entry.resourceRoot)).size).toBe(22);
    for (const entry of nonDesignEntries) {
      const body = await readFile(join(promptDirectory, "skills", entry.entry), "utf8");
      expect(body).not.toMatch(/SECRET_|Version 0\.1\.7/);
    }

    const pdfEntries = entries.filter((entry) => ["pdf", "pdf-reading"].includes(entry.family));
    expect(pdfEntries).toHaveLength(10);
    expect(new Set(pdfEntries.map((entry) => entry.sourceSha256)).size).toBe(5);
    const representativePdfPaths = [
      "pdf-1/0.2.3/skills/pdf/SKILL.md",
      "pdf-1/0.2.3/skills/pdf-viewer/SKILL.md",
      "pdf-reading/SKILL.md",
      "pdf/SKILL.md",
      "pdf-1/0.2.1/skills/pdf-viewer/SKILL.md",
    ];
    expect(
      representativePdfPaths.map(
        (sourcePath) => pdfEntries.find((entry) => entry.sourcePath === sourcePath)?.sourceSha256,
      ),
    ).toEqual([
      "0016a97a781a002c6feecd8f98cf92ce6b21dcf6e3d2b76c233a0560df8cb7d1",
      "7552e6cc9bbcc43d9e22669135c0a82583e32707d8f807a4dcb3a3aa984498f4",
      "e2081f071b4f56fb0fd994dad13c3b7b1dc35d7f3655707ae38ccaf230b787b6",
      "d1c7caf5f35eb7d37877dd7fc33a095037be2b34fb5d2f7f4d43bde3165bb4ee",
      "430308a58a63ea551c71df2819fd0940984af9e03eba8073d1d80822eab592b5",
    ]);
    const sharedPdfProduction = ensureDefined(
      pdfEntries.find((entry) => entry.sourcePath === "pdf-1/0.2.3/skills/pdf/SKILL.md"),
      "shared PDF production source",
    );
    expect(
      await loadDomainSkill(work, { name: sharedPdfProduction.id }, promptDirectory, extensions),
    ).toContain("This adaptation may be shared by multiple source versions with identical bytes.");

    const builtins = await builtinCapabilityDiscoveryRecords(work, promptDirectory);
    const sourceRecords = builtins.filter((entry) => entry.builtin_kind === "work-source");
    expect(sourceRecords).toHaveLength(98);
    expect(new Set(sourceRecords.map((entry) => entry.source_sha256)).size).toBe(98);
    const activeSourcePaths = new Set(sourceRecords.map((entry) => entry.source_path));
    for (const sourcePath of representativePdfPaths.slice(0, 4))
      expect(activeSourcePaths.has(sourcePath)).toBe(true);
    expect(activeSourcePaths.has(representativePdfPaths[4])).toBe(false);
    expect(activeSourcePaths.has("documents-1/0.2.2/skills/docx/SKILL.md")).toBe(true);
    expect(activeSourcePaths.has("docx/SKILL.md")).toBe(true);

    const discoveredIds: string[] = [];
    let offset = 0;
    do {
      const pageText = mergeCapabilityDiscoveryRecords([], builtins, {
        query: "work-source",
        kind: "skill",
        offset,
        limit: 50,
      });
      const page = JSON.parse(pageText.slice(pageText.indexOf("{"))) as {
        total: number;
        next_offset: number | null;
        matches: Array<{ id: string }>;
      };
      expect(page.total).toBe(98);
      discoveredIds.push(...page.matches.map((entry) => entry.id));
      offset = page.next_offset ?? 0;
      if (page.next_offset === null) break;
    } while (offset < 200);
    expect(discoveredIds).toHaveLength(98);
    expect(new Set(discoveredIds).size).toBe(98);

    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    for (const record of sourceRecords) {
      const source = entryById.get(record.id);
      expect(source).toBeDefined();
      const output = await loadDomainSkill(work, { name: record.id }, promptDirectory, extensions);
      expect(output).toContain(`Built-in skill: ${record.id}`);
      expect(output).toContain(`Source path: ${source?.sourcePath}`);
      expect(output).toContain(`Source SHA-256: ${source?.sourceSha256}`);
      expect(output).toContain(`Variant: ${source?.family} / ${source?.version ?? "unversioned"}`);
      await expect(
        loadDomainSkill(code, { name: record.id }, promptDirectory, extensions),
      ).rejects.toThrow("SKILL_MODE_UNAVAILABLE");
      await expect(
        loadDomainSkill(chat, { name: record.id }, promptDirectory, extensions),
      ).rejects.toThrow("CHAT_TOOL_DENIED");
    }

    const representativeByRoot = new Map<string, string>();
    for (const entry of entries)
      if (!representativeByRoot.has(entry.resourceRoot))
        representativeByRoot.set(entry.resourceRoot, entry.sourceSha256);
    expect(representativeByRoot.size).toBe(104);
    for (const [root, sha] of representativeByRoot) {
      const provenance = await readFile(join(promptDirectory, "skills", root, "SOURCE.md"), "utf8");
      expect(provenance).toContain(sha);
    }
  }, 60_000);

  it("compares semantic versions and preserves separate sources, variants and unknown versions", async () => {
    const promptDirectory = await makeWorkSourcePromptDirectory();
    const catalogPath = join(promptDirectory, "skills", "work-sources", "catalog.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    const base = catalog.entries[0];
    const versions = ["0.2.9", "0.2.10-alpha.2", "0.2.10-alpha.10", "0.2.10"];
    const versioned = versions.map((version, index) => ({
      ...base,
      id: `builtin:work-source-version-${index}`,
      version,
      sourcePath: `same-package/${version}/skills/pdf/SKILL.md`,
    }));
    catalog.entries = [
      ...versioned,
      {
        ...versioned[0],
        id: "builtin:work-source-other-package",
        sourcePath: "other-package/0.2.9/skills/pdf/SKILL.md",
      },
      {
        ...versioned[0],
        id: "builtin:work-source-other-variant",
        sourcePath: "same-package/0.2.9/skills/pdf-viewer/SKILL.md",
      },
      {
        ...versioned[0],
        id: "builtin:work-source-invalid-version",
        version: "0.02.9",
        sourcePath: "same-package/0.02.9/skills/pdf/SKILL.md",
      },
      {
        ...versioned[0],
        id: "builtin:work-source-unversioned",
        version: null,
        sourcePath: "same-package/skills/pdf/SKILL.md",
      },
    ];
    await writeFile(catalogPath, JSON.stringify(catalog), "utf8");
    const work = { agentMode: "work" } as SessionView;
    const records = await builtinCapabilityDiscoveryRecords(
      work,
      promptDirectory,
      new Set(["builtin:work-source-version-0"]),
    );
    expect(
      records.filter((item) => item.builtin_kind === "work-source").map((item) => item.id),
    ).toEqual([
      "builtin:work-source-version-3",
      "builtin:work-source-other-package",
      "builtin:work-source-other-variant",
      "builtin:work-source-invalid-version",
      "builtin:work-source-unversioned",
    ]);
    expect(
      records.find((item) => item.id === "builtin:work-source-version-3")?.session_selected,
    ).toBe(true);
    await expect(
      loadDomainSkill(work, { name: "builtin:work-source-version-0" }, promptDirectory, extensions),
    ).rejects.toThrow(
      "SKILL_VERSION_SUPERSEDED: use the current skill builtin:work-source-version-3",
    );

    catalog.entries = versioned.slice(0, 3);
    await writeFile(catalogPath, JSON.stringify(catalog), "utf8");
    const prereleases = await builtinCapabilityDiscoveryRecords(work, promptDirectory);
    expect(
      prereleases.filter((item) => item.builtin_kind === "work-source").map((item) => item.id),
    ).toEqual(["builtin:work-source-version-2"]);
  });

  it("loads exact Work source aliases and their own on-demand resources", async () => {
    const promptDirectory = await makeWorkSourcePromptDirectory();
    const work = { agentMode: "work" } as SessionView;
    const editor = await loadDomainSkill(
      work,
      { name: "builtin:work-source-pdf-0-2-3-editor-11111111" },
      promptDirectory,
      extensions,
    );
    const reader = await loadDomainSkill(
      work,
      { name: "builtin:work-source-pdf-0-2-3-reader-22222222" },
      promptDirectory,
      extensions,
    );
    expect(editor).toContain("Shared PDF source");
    expect(reader).toContain("Shared PDF source");
    expect(editor).toContain("Source path: pdf/0.2.3/skills/pdf-editor/SKILL.md");
    expect(editor).toContain("Variant: pdf / 0.2.3");
    expect(editor).toContain(`Source SHA-256: ${"a".repeat(64)}`);
    expect(editor).toContain("Compatibility: native");
    expect(editor).toContain("License disposition: adapted");
    expect(editor).not.toContain("Host developer SDK CLI");

    expect(
      await loadDomainSkill(
        work,
        {
          name: "builtin:work-source-pdf-0-2-3-editor-11111111",
          resource: "references/routes.md",
        },
        promptDirectory,
        extensions,
      ),
    ).toContain("EDITOR ROUTES");
    expect(
      await loadDomainSkill(
        work,
        {
          name: "builtin:work-source-pdf-0-2-3-reader-22222222",
          resource: "references/routes.md",
        },
        promptDirectory,
        extensions,
      ),
    ).toContain("READER ROUTES");
    await expect(
      loadDomainSkill(
        work,
        {
          name: "builtin:work-source-pdf-0-2-3-editor-11111111",
          resource: "../work-sources/pdf-reader/references/routes.md",
        },
        promptDirectory,
        extensions,
      ),
    ).rejects.toThrow("SKILL_RESOURCE_PATH_INVALID");
  });

  it("rejects invalid or duplicate Work source catalog identities", async () => {
    const promptDirectory = await makeWorkSourcePromptDirectory();
    const catalogPath = join(promptDirectory, "skills", "work-sources", "catalog.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      entries: unknown[];
    };
    catalog.entries = [catalog.entries[0], catalog.entries[0]];
    await writeFile(catalogPath, JSON.stringify(catalog), "utf8");
    await expect(
      builtinCapabilityDiscoveryRecords({ agentMode: "work" } as SessionView, promptDirectory),
    ).rejects.toThrow("WORK_SOURCE_CATALOG_INVALID: duplicate id");
  });
});
