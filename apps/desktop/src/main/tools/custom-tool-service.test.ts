import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/database";
import { Repository } from "../storage/repository";
import { CustomToolService } from "./custom-tool-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("CustomToolService", () => {
  it("lists trusted tool metadata without executing module top-level code", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-tool-list-"));
    temporaryDirectories.push(root);
    const tools = join(root, ".opencode", "tools");
    await mkdir(tools, { recursive: true });
    const marker = join(root, "executed.txt");
    await writeFile(
      join(tools, "unsafe.ts"),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default { description: 'test', args: {}, execute: async () => 'test' };`,
    );
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    try {
      expect((await new CustomToolService(repository).list(root)).length).toBe(1);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      database.close();
    }
  });
  it("loads an OpenCode-compatible TypeScript tool from a trusted project", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-tool-"));
    temporaryDirectories.push(root);
    const tools = join(root, ".opencode", "tools");
    await mkdir(tools, { recursive: true });
    await writeFile(
      join(tools, "math.ts"),
      `
        import { tool } from "@opencode-ai/plugin";

        export default tool({
          description: "Add two numbers",
          args: {
            a: tool.schema.number(),
            b: tool.schema.number(),
          },
          async execute(args, context) {
            return String(args.a + args.b) + ":" + context.directory;
          },
        });
      `,
      "utf8",
    );
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    const service = new CustomToolService(repository);
    try {
      const descriptors = await service.descriptors(root);
      expect(descriptors.map((entry) => entry.name)).toContain("math");
      const session = repository.insertSession({
        title: "custom tool",
        providerId: "provider",
        modelId: "model",
        agentProfileId: "primary",
        workspacePath: root,
        systemPrompt: "",
        reasoningLevel: null,
        permissionMode: "full_access",
        executionMode: "host",
        patchOnly: false,
      });
      const result = await service.execute(
        "math",
        { a: 2, b: 3 },
        {
          session,
          messageId: "message",
        },
      );
      expect(result.isError).toBe(false);
      expect(result.output).toBe(`5:${root}`);
    } finally {
      database.close();
    }
  }, 20_000);
  it("validates declared custom-tool output and returns it as trusted settlement evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-output-schema-"));
    temporaryDirectories.push(root);
    const tools = join(root, ".mingshen", "tools");
    await mkdir(tools, { recursive: true });
    const outputSchema = JSON.stringify({
      type: "object",
      required: ["value"],
      properties: { value: { type: "number" } },
      additionalProperties: false,
    });
    await writeFile(
      join(tools, "valid.ts"),
      `export default {description:'valid output',args:{},readOnly:true,outputSchema:${outputSchema},execute:async()=>({value:3})};`,
    );
    await writeFile(
      join(tools, "invalid.ts"),
      `export default {description:'invalid output',args:{},readOnly:true,outputSchema:${outputSchema},execute:async()=>({value:'wrong'})};`,
    );
    await writeFile(
      join(tools, "zod.ts"),
      `import { tool } from '@opencode-ai/plugin'; export default tool({description:'zod output',args:{},readOnly:true,outputSchema:tool.schema.object({value:tool.schema.number()}),execute:async()=>({value:5})});`,
    );
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    const service = new CustomToolService(repository);
    const session = repository.insertSession({
      title: "custom output",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
    });
    try {
      const valid = await service.execute("valid", {}, { session, messageId: "valid" });
      expect(valid).toMatchObject({
        isError: false,
        status: "success",
        effect: "confirmed",
        validation: { status: "validated", source: "custom" },
        outcome: { status: "success", effect: "confirmed" },
      });
      expect(await service.outputSchema("valid", root)).toEqual(JSON.parse(outputSchema));
      expect(await service.isReadOnly("valid", root)).toBe(false);
      expect(await service.isReadOnly("missing", root)).toBeNull();

      const invalid = await service.execute("invalid", {}, { session, messageId: "invalid" });
      expect(invalid).toMatchObject({
        isError: true,
        status: "failed",
        effect: "uncertain",
        validation: { status: "invalid", source: "custom" },
        outcome: { status: "failed" },
      });
      expect(invalid.codes).toContain("INVALID_OUTPUT");

      const zodOutput = await service.execute("zod", {}, { session, messageId: "zod" });
      expect(zodOutput).toMatchObject({
        isError: false,
        status: "success",
        validation: { status: "validated", source: "custom" },
      });
    } finally {
      database.close();
    }
  }, 20_000);
  it("checks managed policy before executing trusted custom code", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-policy-"));
    temporaryDirectories.push(root);
    const directory = join(root, ".mingshen", "tools");
    await mkdir(directory, { recursive: true });
    const marker = join(root, "executed.txt");
    await writeFile(
      join(directory, "blocked.ts"),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'metadata'); export default {description:'blocked',args:{},execute:async()=> 'ok'};`,
    );
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    const service = new CustomToolService(repository);
    const calls: string[] = [];
    service.setManagedPolicy({
      assertCapability(capability) {
        calls.push(capability);
      },
      assertToolAllowed(name) {
        calls.push(name);
        throw new Error("managed policy denied this tool");
      },
    });
    const session = repository.insertSession({
      title: "custom policy",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
    });
    try {
      const result = await service.execute("blocked", {}, { session, messageId: "blocked" });
      expect(result).toMatchObject({
        isError: true,
        status: "denied",
        effect: "none",
        outcome: { status: "denied", effect: "none" },
      });
      expect(result.output).toContain("TOOL_POLICY_DENIED");
      expect(calls).toEqual(["blocked"]);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      database.close();
    }
  }, 20_000);
  it("checks policy before discovering custom tool metadata code", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-discovery-policy-"));
    temporaryDirectories.push(root);
    const directory = join(root, ".mingshen", "tools");
    await mkdir(directory, { recursive: true });
    const marker = join(root, "metadata-executed.txt");
    await writeFile(
      join(directory, "metadata.ts"),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default {description:'metadata',args:{},execute:async()=> 'ok'};`,
    );
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    const service = new CustomToolService(repository);
    const calls: string[] = [];
    service.setManagedPolicy({
      assertCapability(capability) {
        calls.push(capability);
        if (capability === "tool.execute") throw new Error("managed policy denied discovery");
      },
      assertToolAllowed(name) {
        calls.push(name);
      },
    });
    try {
      await expect(service.descriptors(root)).rejects.toThrow("managed policy denied discovery");
      expect(calls).toEqual(["tool.execute"]);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      database.close();
    }
  }, 20_000);
  it("does not treat an unapproved ask gate as approval during custom tool execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-approval-"));
    temporaryDirectories.push(root);
    const directory = join(root, ".mingshen", "tools");
    await mkdir(directory, { recursive: true });
    const marker = join(root, "metadata-executed.txt");
    await writeFile(
      join(directory, "guarded.ts"),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default {description:'guarded',args:{},execute:async()=> 'ok'};`,
    );
    const database = openDatabase(join(root, "test.db"));
    const repository = new Repository(database);
    repository.setProjectTrusted(root, true);
    const service = new CustomToolService(repository);
    let commandApproved: boolean | undefined;
    service.setManagedPolicy({
      assertCapability(capability, options) {
        if (capability === "command.execute") {
          commandApproved = options?.approved;
          if (options?.approved !== true) throw new Error("POLICY_APPROVAL_REQUIRED");
        }
      },
      assertToolAllowed(_name, options) {
        if (options?.approved !== true) throw new Error("POLICY_APPROVAL_REQUIRED");
      },
    });
    const session = repository.insertSession({
      title: "custom approval",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
    });
    try {
      const result = await service.execute("guarded", {}, { session, messageId: "guarded" });
      expect(result).toMatchObject({ isError: true, status: "denied", effect: "none" });
      expect(commandApproved).toBeUndefined();
      await expect(access(marker)).rejects.toThrow();
    } finally {
      database.close();
    }
  }, 20_000);
  it("terminates cancelled workers and keeps concurrent invocations in separate runtime files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-custom-cancel-"));
    temporaryDirectories.push(root);
    const directory = join(root, ".mingshen", "tools");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "slow.ts"),
      `export default {description:'slow',args:{},execute:async()=>{await new Promise(done=>setTimeout(done,30000));return 'late'}};`,
    );
    const db = openDatabase(":memory:"),
      repo = new Repository(db);
    repo.setProjectTrusted(root, true);
    const service = new CustomToolService(repo);
    const session = repo.insertSession({
      title: "worker",
      providerId: null,
      modelId: null,
      agentProfileId: "primary",
      workspacePath: root,
      systemPrompt: "",
      reasoningLevel: null,
      permissionMode: "full_access",
      executionMode: "host",
      patchOnly: false,
    });
    try {
      await service.descriptors(root);
      const a = new AbortController(),
        b = new AbortController();
      const one = service.execute("slow", {}, { session, messageId: "one", signal: a.signal });
      const two = service.execute("slow", {}, { session, messageId: "two", signal: b.signal });
      await new Promise((done) => setTimeout(done, 200));
      const runtime = join(directory, ".mingshen-runtime-cache");
      expect((await readdir(runtime)).filter((name) => name.endsWith("-execute.mjs"))).toHaveLength(
        2,
      );
      a.abort();
      b.abort();
      const results = await Promise.all([one, two]);
      expect(
        results.every((result) => result.isError && result.output.includes("terminated")),
      ).toBe(true);
      expect((await readdir(runtime)).filter((name) => name.endsWith("-execute.mjs"))).toHaveLength(
        0,
      );
    } finally {
      db.close();
    }
  }, 10000);
});
