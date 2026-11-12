import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { isDangerousCommand, ToolRegistry } from "./tool-registry";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ToolRegistry document reading", () => {
  it("permits project format commands while blocking disk formatting", () => {
    expect(isDangerousCommand("pnpm format")).toBeNull();
    expect(isDangerousCommand("ruff format src")).toBeNull();
    expect(isDangerousCommand("format.com C: /q")).toBeTruthy();
    expect(isDangerousCommand("Format-Volume -DriveLetter D")).toBeTruthy();
    expect(isDangerousCommand("shutdown /s /t 0")).toBeTruthy();
  });
  it("exposes a non-recursive subagent tool contract", () => {
    const descriptor = new ToolRegistry()
      .descriptors()
      .find((tool) => tool.name === "spawn_subagent");

    expect(descriptor?.description).toContain("cannot create another subagent");
    expect(descriptor?.parameters).toMatchObject({
      required: ["task"],
    });
  });

  it("exposes the built-in GitHub plugin tools without a GitHub browser shortcut", () => {
    const names = new ToolRegistry().descriptors().map((tool) => tool.name);
    expect(names).toContain("github_search_repositories");
    expect(names).toContain("github_list_pull_requests");
    expect(names).toContain("github_list_issues");
    expect(names).toContain("github_list_workflow_runs");
    expect(names).not.toContain("browser_github_search");
  });

  it("extracts DOCX through read_file without a shell command", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-tool-test-"));
    tempDirectories.push(root);
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>DOCX through read_file</w:t></w:r></w:p>
        </w:body>
      </w:document>`;
    const docx = zipSync({
      "[Content_Types].xml": strToU8(`<?xml version="1.0"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Default Extension="xml" ContentType="application/xml"/>
          <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        </Types>`),
      "_rels/.rels": strToU8(`<?xml version="1.0"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
        </Relationships>`),
      "word/document.xml": strToU8(documentXml),
    });
    await writeFile(join(root, "sample.docx"), docx);

    const session: SessionView = {
      id: "019ae23e-37d1-7e1f-8ed4-4dc56f380001",
      title: "Test",
      parentSessionId: null,
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
      status: "idle",
      archived: false,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };

    const result = await new ToolRegistry().execute(
      "read_file",
      { path: "sample.docx" },
      {
        session,
        runId: "run",
        toolCallId: "call",
        toolName: "read_file",
        signal: new AbortController().signal,
        permissions: new PermissionStore(),
        requestApproval: async () => {
          throw new Error("approval should not be requested in full access mode");
        },
      },
    );

    expect(result.isError).toBe(false);
    expect(result.output).toContain("DOCX through read_file");
  });

  it("reports created and modified file changes from editing tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-tool-test-"));
    tempDirectories.push(root);
    const session: SessionView = {
      id: "019ae23e-37d1-7e1f-8ed4-4dc56f380003",
      title: "Test",
      parentSessionId: null,
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
      status: "idle",
      archived: false,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    const context = {
      session,
      runId: "run",
      toolCallId: "call",
      toolName: "write_file",
      signal: new AbortController().signal,
      permissions: new PermissionStore(),
      requestApproval: async () => {
        throw new Error("approval should not be requested in full access mode");
      },
    };
    const registry = new ToolRegistry();

    const created = await registry.execute(
      "write_file",
      { path: "sample.ts", content: "line one\nline two" },
      context,
    );
    expect(created.fileChange).toMatchObject({
      changeType: "created",
      additions: 2,
      deletions: 0,
    });

    const modified = await registry.execute(
      "replace_in_file",
      { path: "sample.ts", old_text: "line two", new_text: "line two changed" },
      context,
    );
    expect(modified.fileChange).toMatchObject({
      changeType: "modified",
      additions: 1,
      deletions: 1,
    });

    const deleted = await registry.execute("delete_file", { path: "sample.ts" }, context);
    expect(deleted.fileChange).toMatchObject({
      changeType: "deleted",
      additions: 0,
      deletions: 2,
    });
  });

  it("applies Codex-style patches across add and update blocks", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-patch-test-"));
    tempDirectories.push(root);
    const session: SessionView = {
      id: "019ae23e-37d1-7e1f-8ed4-4dc56f380004",
      title: "Patch",
      parentSessionId: null,
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: true,
      status: "idle",
      archived: false,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    const result = await new ToolRegistry().execute(
      "apply_patch",
      {
        patch: [
          "*** Begin Patch",
          "*** Add File: sample.ts",
          "+const value = 1;",
          "*** Update File: sample.ts",
          "@@",
          "-const value = 1;",
          "+const value = 2;",
          "*** End Patch",
        ].join("\n"),
      },
      {
        session,
        runId: "run",
        toolCallId: "call",
        toolName: "apply_patch",
        signal: new AbortController().signal,
        permissions: new PermissionStore(),
        requestApproval: async () => {
          throw new Error("approval should not be requested in full access mode");
        },
      },
    );

    expect(result.isError).toBe(false);
    expect(result.fileChanges).toHaveLength(2);
    await expect(readFile(join(root, "sample.ts"), "utf8")).resolves.toBe("const value = 2;");
  });

  it("redirects document workaround commands to the built-in reader", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-tool-test-"));
    tempDirectories.push(root);
    const session: SessionView = {
      id: "019ae23e-37d1-7e1f-8ed4-4dc56f380002",
      title: "Test",
      parentSessionId: null,
      providerId: "provider",
      modelId: "model",
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
      status: "idle",
      archived: false,
      pinned: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };

    const result = await new ToolRegistry().execute(
      "run_command",
      {
        command: "$zip=[System.IO.Compression.ZipFile]::OpenRead('sample.docx'); $zip.Dispose()",
      },
      {
        session,
        runId: "run",
        toolCallId: "call",
        toolName: "run_command",
        signal: new AbortController().signal,
        permissions: new PermissionStore(),
        requestApproval: async () => {
          throw new Error("approval should not be requested for a blocked workaround");
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain("read_document");
  });
});
