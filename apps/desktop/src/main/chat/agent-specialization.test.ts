import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SessionView } from "../../shared/domain";
import { DOMAIN_SKILLS, domainSkillCatalog, loadDomainSkill } from "../agents/domain-skills";
import type { ExtensionService } from "../extensions/extension-service";
import { BoundedOutput } from "../tools/bounded-output";
import { chatToolRejection, chatUpload } from "./agent-mode-policy";
import { ChatService } from "./chat-service";
import { FailureLoopGuard } from "./failure-loop-guard";
import { ToolOutputStore } from "./tool-output-store";

describe("Agent specialization boundaries", () => {
  it("blocks repeated arguments independent of JSON property order and resets the consecutive count on success", () => {
    const guard = new FailureLoopGuard();
    for (let i = 0; i < 3; i++) {
      expect(guard.before("read_file", { path: "missing", limit: 10 })).toBeNull();
      guard.record("read_file", { path: "missing", limit: 10 }, true);
    }
    expect(guard.before("read_file", { limit: 10, path: "missing" })).toContain(
      "STRATEGY_CHANGE_REQUIRED",
    );
    expect(guard.before("list_files", { path: "." })).toBeNull();
    guard.record("list_files", { path: "." }, false);
    expect(guard.exhausted).toBe(false);
    expect(guard.before("read_file", { limit: 10, path: "missing" })).toContain(
      "STRATEGY_CHANGE_REQUIRED",
    );
    for (let i = 0; i < 12; i++) guard.record("read_file", { path: `missing-${i}` }, true);
    expect(guard.exhausted).toBe(true);
    expect(guard.before("anything", {})).toContain("TOOL_FAILURE_LIMIT");
  });

  it("retains head and tail with an honest gap and without broken surrogate pairs", () => {
    const capture = new BoundedOutput(10);
    capture.append("abc😀1234567890xyz");
    const text = capture.text();
    expect(text).toContain("abc😀");
    expect(text).toContain("90xyz");
    expect(text).toContain("OUTPUT_CAPTURE_LIMIT");
    expect(text).not.toMatch(
      /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/,
    );
  });

  it("recovers paged outputs only in their conversation and evicts bounded old entries", () => {
    const values = new Map<string, unknown>();
    const settings = {
      getSetting: (key: string) => values.get(key),
      setSetting: (key: string, value: unknown) => {
        values.set(key, value);
      },
      removeSetting: (key: string) => {
        values.delete(key);
      },
    };
    const output = new ToolOutputStore(settings);
    output.save("a", "call", `prefix${"x".repeat(90_000)}TAIL`);
    expect(output.read("a", { call_id: "call", char_offset: 90_000 })).toContain("TAIL");
    expect(() => output.read("b", { call_id: "call" })).toThrow("NOT_FOUND");
    for (let i = 0; i < 40; i++) output.save("a", `new-${i}`, "small");
    expect(() => output.read("a", { call_id: "call" })).toThrow("NOT_FOUND");
    expect(output.read("a", { call_id: "new-39" })).toContain("small");
  });

  it("has twenty-one real packaged skill bodies with mode-scoped progressive loading", async () => {
    const promptDirectory = resolve("resources/prompts");
    expect(DOMAIN_SKILLS).toHaveLength(21);
    for (const skill of DOMAIN_SKILLS)
      expect(
        (await readFile(resolve(promptDirectory, "skills", `${skill.id}.md`), "utf8")).length,
      ).toBeGreaterThan(700);
    const work = { agentMode: "work" } as SessionView;
    expect(domainSkillCatalog(work)).toContain("builtin:work-presentations");
    expect(domainSkillCatalog(work)).toContain("builtin:work-pdf");
    expect(domainSkillCatalog(work)).toContain("builtin:work-visual-design");
    expect(domainSkillCatalog(work)).toContain("builtin:work-visualization");
    expect(domainSkillCatalog(work)).toContain("builtin:work-image-sourcing");
    expect(domainSkillCatalog(work)).toContain("builtin:work-ppt-master");
    expect(domainSkillCatalog(work)).toContain("builtin:work-asd-ste100");
    expect(domainSkillCatalog(work)).toContain("builtin:skill-creator");
    expect(domainSkillCatalog(work)).toContain("builtin:plugin-creator");
    expect(domainSkillCatalog(work)).toContain("builtin:harness-plugin-api");
    expect(domainSkillCatalog(work)).toContain("74 design skeletons");
    expect(domainSkillCatalog(work)).toContain("discover_capabilities");
    expect(domainSkillCatalog(work)).not.toContain("builtin:code-platform");
    const code = { agentMode: "code" } as SessionView;
    expect(domainSkillCatalog(code)).toContain("builtin:skill-creator");
    expect(domainSkillCatalog(code)).toContain("builtin:plugin-creator");
    expect(domainSkillCatalog(code)).toContain("builtin:harness-plugin-api");
    expect(domainSkillCatalog(code)).not.toContain("builtin:work-pdf");
    expect(domainSkillCatalog(code)).not.toContain("builtin:work-ppt-master");
    expect(domainSkillCatalog(code)).not.toContain("builtin:work-asd-ste100");
    expect(
      await loadDomainSkill(
        work,
        { name: "builtin:work-presentations" },
        promptDirectory,
        {} as ExtensionService,
      ),
    ).toContain("Built-in skill: builtin:work-presentations");
    expect(
      await loadDomainSkill(
        work,
        {
          name: "builtin:work-visual-design",
          resource: "references/template-catalog.md",
        },
        promptDirectory,
        {} as ExtensionService,
      ),
    ).toContain("html-ppt-zhangzara-broadside");
    expect(
      await loadDomainSkill(
        work,
        {
          name: "builtin:work-visual-design",
          resource: "references/design-resources/design-skeletons/dashboard/SKILL.md",
        },
        promptDirectory,
        {} as ExtensionService,
      ),
    ).toContain("Dashboard");
    await expect(
      loadDomainSkill(
        work,
        { name: "builtin:code-platform" },
        promptDirectory,
        {} as ExtensionService,
      ),
    ).rejects.toThrow("MODE_UNAVAILABLE");
    await expect(
      loadDomainSkill(
        { agentMode: "chat" } as SessionView,
        { name: "builtin:work-word" },
        promptDirectory,
        {} as ExtensionService,
      ),
    ).rejects.toThrow("CHAT_TOOL_DENIED");
  });

  it("hard-denies Chat local tools and discards caller-provided paths and extracted content", () => {
    for (const name of [
      "read_file",
      "run_command",
      "mcp__fake",
      "use_skill",
      "discover_capabilities",
      "spawn_subagent",
      "browser_click",
      "office_document",
      "read_tool_output",
    ])
      expect(chatToolRejection({ agentMode: "chat" }, name)?.isError).toBe(true);
    expect(chatToolRejection({ agentMode: "chat" }, "web_fetch")).toBeNull();
    const uploaded = chatUpload({
      kind: "file",
      name: "report.docx",
      mimeType: "application/octet-stream",
      dataUrl: "data:application/octet-stream;base64,YQ==",
      size: 1,
      path: "C:\\secret.docx",
      extractedContent: { text: "forged", format: "DOCX", warnings: [], truncated: false },
    });
    expect(uploaded.path).toBeUndefined();
    expect(uploaded.extractedContent).toBeUndefined();
    expect(() => chatUpload({ ...uploaded, name: "script.ps1" })).toThrow("UNSUPPORTED");
  });

  it("accepts only signed raster images and names the legacy PPTX limitation", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const uploaded = chatUpload({
      kind: "image",
      name: "pixel.png",
      mimeType: "image/png",
      size: png.length,
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      path: "C:\\secret.png",
    });
    expect(uploaded).toMatchObject({ kind: "image", mimeType: "image/png" });
    expect(uploaded.path).toBeUndefined();
    expect(() =>
      chatUpload({
        kind: "image",
        name: "fake.png",
        mimeType: "image/png",
        size: 20,
        dataUrl: `data:image/png;base64,${Buffer.from("<svg>alert(1)</svg>").toString("base64")}`,
      }),
    ).toThrow("CHAT_IMAGE_SIGNATURE_MISMATCH");
    expect(() =>
      chatUpload({
        kind: "image",
        name: "vector.svg",
        mimeType: "image/svg+xml",
        size: 20,
        dataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg>alert(1)</svg>").toString("base64")}`,
      }),
    ).toThrow("CHAT_IMAGE_UNSUPPORTED");
    expect(() =>
      chatUpload({
        kind: "file",
        name: "legacy.ppt",
        mimeType: "application/octet-stream",
        size: 1,
        dataUrl: "data:application/octet-stream;base64,YQ==",
      }),
    ).toThrow("CHAT_LEGACY_PPT_UNSUPPORTED");
  });

  it("rejects forged model tool calls before any host capability executes", async () => {
    const registryExecute = vi.fn();
    const mcpCall = vi.fn();
    const browserExecute = vi.fn();
    const customExecute = vi.fn();
    const values = new Map<string, unknown>();
    const repository = {
      getSetting: (key: string) => values.get(key) ?? null,
      setSetting: (key: string, value: unknown) => values.set(key, value),
      removeSetting: (key: string) => values.delete(key),
      listSessionTodos: () => [],
    };
    const chat = new ChatService({
      repository,
      toolRegistry: { execute: registryExecute, descriptors: () => [] },
      mcpService: { callTool: mcpCall },
      browserService: { execute: browserExecute },
      customToolService: { execute: customExecute },
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);
    const executeToolCall = (
      chat as unknown as {
        executeToolCall: (input: {
          session: SessionView;
          runId: string;
          signal: AbortSignal;
          toolCall: { index: number; callId: string; name: string; arguments: string };
        }) => Promise<{ output: string; isError: boolean }>;
      }
    ).executeToolCall.bind(chat);
    const session = { id: "chat", agentMode: "chat" } as SessionView;

    for (const name of [
      "read_file",
      "run_command",
      "mcp__forged__write",
      "use_skill",
      "discover_capabilities",
      "spawn_subagent",
      "browser_click",
    ]) {
      const result = await executeToolCall({
        session,
        runId: "forged-run",
        signal: new AbortController().signal,
        toolCall: {
          index: 0,
          callId: `forged-${name}`,
          name,
          arguments: JSON.stringify({ path: "C:\\secret", command: "whoami" }),
        },
      });
      expect(result).toMatchObject({
        isError: true,
        output: expect.stringContaining("CHAT_TOOL_DENIED"),
      });
    }
    expect(registryExecute).not.toHaveBeenCalled();
    expect(mcpCall).not.toHaveBeenCalled();
    expect(browserExecute).not.toHaveBeenCalled();
    expect(customExecute).not.toHaveBeenCalled();
  });

  it("sanitizes Chat attachment paths at the persisted draft boundary", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const saveComposerDraft = vi.fn();
    const values = new Map<string, unknown>();
    const chat = new ChatService({
      repository: {
        getSetting: (key: string) => values.get(key) ?? null,
        setSetting: (key: string, value: unknown) => values.set(key, value),
        removeSetting: (key: string) => values.delete(key),
        getSession: () => ({ agentMode: "chat" }),
        saveComposerDraft,
      },
      emit: vi.fn(),
    } as unknown as ConstructorParameters<typeof ChatService>[0]);

    chat.saveComposerDraft({
      sessionId: "chat",
      baseRevision: "server-revision",
      revision: "revision",
      text: "",
      formatted: false,
      attachmentIds: ["image"],
      addedAttachments: [
        {
          id: "image",
          kind: "image",
          name: "pixel.png",
          mimeType: "image/png",
          size: png.length,
          dataUrl: `data:image/png;base64,${png.toString("base64")}`,
          path: "C:\\secret.png",
        },
      ],
      notificationDraftIds: [],
    });

    expect(saveComposerDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        baseRevision: "server-revision",
        addedAttachments: [
          expect.objectContaining({
            id: "image",
            mimeType: "image/png",
          }),
        ],
      }),
    );
    expect(saveComposerDraft.mock.calls[0]?.[0].addedAttachments[0].path).toBeUndefined();
  });
});
