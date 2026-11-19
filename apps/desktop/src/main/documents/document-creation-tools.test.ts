import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { Document, Packer, Paragraph } from "docx";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequest, SessionView } from "../../shared/domain";
import { PermissionStore } from "../permissions/permission-store";
import { type ToolExecutionContext, ToolRegistry } from "../tools/tool-registry";
import { DockerService } from "../workspace/docker-service";
import type { NativeSandboxService } from "../workspace/native-sandbox-service";
import { readDocxStructure } from "./document-edit";
import { extractDocumentBuffer } from "./document-extractor";
import { printDocumentPdf } from "./document-pdf";

vi.mock("./document-pdf", () => ({
  printDocumentPdf: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rm: vi.fn(original.rm) };
});

type FileOperationRequest = Parameters<NativeSandboxService["fileOperation"]>[1];

const roots: string[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const pdf = Buffer.from("%PDF-1.7\n% local print fixture\n%%EOF\n");
const chineseText = "\u4e2d\u6587\u62a5\u544a\u6b63\u6587";

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixture(session: Partial<SessionView> = {}) {
  const root = await mkdtemp(join(tmpdir(), "mingshen-document-tools-"));
  roots.push(root);
  const files = new Map<string, Buffer>();
  const fileOperation = vi.fn(
    async (workspace: string, request: FileOperationRequest, signal: AbortSignal) => {
      signal.throwIfAborted();
      expect(workspace).toBe(root);
      const current = files.get(request.path);
      if (request.operation === "hash") return current ? hash(current) : "missing";
      if (request.operation === "read_binary") {
        if (!current) throw new Error("FILE_NOT_FOUND");
        return current.toString("base64");
      }
      if (request.operation === "write_binary") {
        const expected = current ? hash(current) : "missing";
        if (request.expectedHash !== expected)
          throw new Error("Target changed before binary write");
        const bytes = Buffer.from(request.content ?? "", "base64");
        expect(bytes.toString("base64")).toBe(request.content);
        files.set(request.path, bytes);
        return null;
      }
      throw new Error(`Unexpected file operation: ${request.operation}`);
    },
  );
  const nativeSandbox = {
    fileOperation,
    run: vi.fn(async () => {
      throw new Error("Document creation must not execute commands.");
    }),
  } as unknown as NativeSandboxService;
  const controller = new AbortController();
  const beforeFileWrite = vi.fn(async (_path: string, _version: string) => {});
  const observeFile = vi.fn((_path: string, _version: string) => {});
  const onEffectStart = vi.fn();
  const requestApproval = vi.fn(async (request: ApprovalRequest) => ({
    approvalId: request.id,
    decision: "allow_once" as const,
  }));
  const context: ToolExecutionContext = {
    session: {
      id: "documents",
      workspacePath: root,
      permissionMode: "full_access",
      executionMode: "host",
      ...session,
    } as SessionView,
    runId: "document-run",
    toolCallId: "document-call",
    toolName: "create_document",
    signal: controller.signal,
    permissions: new PermissionStore(),
    beforeFileWrite,
    observeFile,
    onEffectStart,
    requestApproval,
  };
  return {
    root,
    files,
    fileOperation,
    nativeSandbox,
    controller,
    context,
    beforeFileWrite,
    observeFile,
    onEffectStart,
    requestApproval,
    registry: new ToolRegistry(nativeSandbox),
  };
}

const body = [{ type: "paragraph", text: chineseText }];

beforeEach(() => {
  vi.mocked(printDocumentPdf).mockReset();
  vi.mocked(printDocumentPdf).mockResolvedValue(pdf);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("create_document tool", () => {
  const oldDraftSpec = (bytes: Buffer, path = "revised.docx") => ({
    path,
    overwrite: true,
    edit: {
      path: "old.docx",
      expected_sha256: hash(bytes),
      operations: [
        { type: "replace_text", paragraph: 1, old_text: "original", new_text: "updated" },
      ],
    },
  });
  const templateSpec = (path = "filled.docx", placeholder = "body") => ({
    path,
    overwrite: true,
    template: {
      path: "template.docx",
      replacements: [
        { placeholder, blocks: [{ type: "equation", latex: String.raw`\frac{1}{2}` }] },
      ],
    },
  });
  const templateBytes = () =>
    Packer.toBuffer(
      new Document({
        sections: [{ children: [new Paragraph("Keep original"), new Paragraph("{{body}}")] }],
      }),
    );

  it("reads structured anchors and edits old drafts through the native read/write gateway", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    const original = await templateBytes();
    f.files.set("old.docx", original);
    const read = await f.registry.execute(
      "read_document",
      { path: "old.docx", structure: true },
      { ...f.context, toolName: "read_document" },
    );
    expect(read.isError, read.output).toBe(false);
    expect(read.output).toContain(`Source SHA-256: ${hash(original)}`);
    expect(read.output).toContain('"paragraph":1');
    expect(read.output).toContain('"text":"Keep original"');
    const result = await f.registry.execute("create_document", oldDraftSpec(original), f.context);
    expect(result.isError, result.output).toBe(false);
    const updated = f.files.get("revised.docx");
    if (!updated) throw new Error("Expected revised document.");
    expect((await readDocxStructure(updated)).text).toContain("Keep updated");
    expect(f.files.get("old.docx")).toEqual(original);
    expect(f.fileOperation.mock.calls.map(([, operation]) => operation.operation)).toEqual([
      "read_binary",
      "hash",
      "read_binary",
      "write_binary",
    ]);
    expect(f.beforeFileWrite).toHaveBeenCalledWith(join(f.root, "revised.docx"), "missing");
    await expect(readFile(join(f.root, "revised.docx"))).rejects.toThrow("ENOENT");
  });

  it("requires independent old draft read permission and performs no write on denial", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    const original = await templateBytes();
    f.files.set("old.docx", original);
    f.context.requestApproval = vi.fn(async (request: ApprovalRequest) => ({
      approvalId: request.id,
      decision: request.toolName === "read_file" ? ("deny" as const) : ("allow_once" as const),
      feedback: "Old draft read denied",
    }));
    const result = await f.registry.execute("create_document", oldDraftSpec(original), f.context);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Old draft read denied");
    expect(f.files.has("revised.docx")).toBe(false);
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    expect(f.onEffectStart).not.toHaveBeenCalled();
  });

  it("preserves an output if the draft digest is stale", async () => {
    const f = await fixture();
    const original = await templateBytes();
    await writeFile(join(f.root, "old.docx"), original);
    await writeFile(join(f.root, "revised.docx"), original);
    const spec = oldDraftSpec(original);
    spec.edit.expected_sha256 = "0".repeat(64);
    const result = await f.registry.execute("create_document", spec, f.context);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("DOCUMENT_SOURCE_CHANGED");
    expect(await readFile(join(f.root, "revised.docx"))).toEqual(original);
    expect(await readdir(f.root)).toEqual(["old.docx", "revised.docx"]);
    expect(f.onEffectStart).not.toHaveBeenCalled();
  });

  it("refuses in-place old draft edits changed after preparation", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    const original = await templateBytes();
    f.files.set("old.docx", original);
    const external = Buffer.from("External draft edit");
    f.beforeFileWrite.mockImplementation(async () => {
      f.files.set("old.docx", external);
    });
    const result = await f.registry.execute(
      "create_document",
      oldDraftSpec(original, "old.docx"),
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Target changed");
    expect(f.files.get("old.docx")).toEqual(external);
  });

  it("returns paginated structured paragraphs through the host read path", async () => {
    const f = await fixture();
    const original = await templateBytes();
    await writeFile(join(f.root, "old.docx"), original);
    const result = await f.registry.execute(
      "read_document",
      {
        path: "old.docx",
        structure: true,
        start_line: 5,
        limit: 1,
      },
      { ...f.context, toolName: "read_document" },
    );
    expect(result.isError, result.output).toBe(false);
    expect(result.output).toContain(`Source SHA-256: ${hash(original)}`);
    expect(result.output).toContain('"paragraph":1');
    expect(result.output).not.toContain('"paragraph":2');
  });

  it("requires independent template read approval and writes nothing on denial", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    f.files.set("template.docx", await templateBytes());
    f.context.requestApproval = vi.fn(async (request: ApprovalRequest) => ({
      approvalId: request.id,
      decision: request.toolName === "read_file" ? ("deny" as const) : ("allow_once" as const),
      feedback: "Template read denied",
    }));
    const result = await f.registry.execute("create_document", templateSpec(), f.context);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Template read denied");
    expect(f.fileOperation.mock.calls.map(([, operation]) => operation.operation)).toEqual([
      "hash",
    ]);
    expect(f.files.has("filled.docx")).toBe(false);
    expect(f.onEffectStart).not.toHaveBeenCalled();
  });

  it("fills templates entirely through the protected binary gateway", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    const original = await templateBytes();
    f.files.set("template.docx", original);
    const result = await f.registry.execute("create_document", templateSpec(), f.context);
    expect(result.isError, result.output).toBe(false);
    expect(f.fileOperation.mock.calls.map(([, operation]) => operation.operation)).toEqual([
      "hash",
      "read_binary",
      "write_binary",
    ]);
    expect(f.files.get("template.docx")).toEqual(original);
    const output = f.files.get("filled.docx");
    if (!output) throw new Error("Template output was not written.");
    const content = strFromU8(unzipSync(output)["word/document.xml"] ?? new Uint8Array());
    expect(content).toContain("<m:f>");
    expect(content).toContain("Keep original");
    expect(content).not.toContain("{{body}}");
    await expect(readFile(join(f.root, "filled.docx"))).rejects.toThrow("ENOENT");
  });

  it("writes native equation cells through the protected binary gateway", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    const result = await f.registry.execute(
      "create_document",
      {
        path: "table.docx",
        blocks: [
          {
            type: "table",
            rows: [
              [
                "Result",
                {
                  blocks: [
                    { type: "paragraph", text: "Editable calculation" },
                    { type: "equation", latex: String.raw`\frac{1}{2}` },
                  ],
                },
              ],
            ],
          },
        ],
      },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    const bytes = f.files.get("table.docx");
    if (!bytes) throw new Error("Rich table output was not written.");
    const content = strFromU8(unzipSync(bytes)["word/document.xml"] ?? new Uint8Array());
    const document = new DOMParser().parseFromString(content, "text/xml");
    const cells = Array.from(document.getElementsByTagName("w:tc"));
    const formulaCell = cells.find((cell) => cell.getElementsByTagName("m:f").length > 0);
    expect(formulaCell?.textContent).toContain("Editable calculation");
    expect(f.fileOperation.mock.calls.map(([, operation]) => operation.operation)).toEqual([
      "hash",
      "write_binary",
    ]);
    expect(f.requestApproval).toHaveBeenCalledOnce();
    expect(f.onEffectStart).toHaveBeenCalledOnce();
    await expect(readFile(join(f.root, "table.docx"))).rejects.toThrow("ENOENT");
  });

  it.each([
    {
      block: { type: "equation", latex: String.raw`\unknowncommand{x}` },
      error: "NATIVE_EQUATION_UNSUPPORTED",
    },
    {
      block: { type: "markdown", text: "![remote](https://example.com/image.png)" },
      error: "MARKDOWN_IMAGE",
    },
  ])(
    "preserves existing output on table cell generation error: $error",
    async ({ block, error }) => {
      const f = await fixture();
      const path = join(f.root, "table.docx");
      const original = await templateBytes();
      await writeFile(path, original);
      const result = await f.registry.execute(
        "create_document",
        {
          path: "table.docx",
          overwrite: true,
          blocks: [{ type: "table", rows: [[{ blocks: [block] }]] }],
        },
        f.context,
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain(error);
      expect(await readFile(path)).toEqual(original);
      expect(await readdir(f.root)).toEqual(["table.docx"]);
      expect(f.beforeFileWrite).not.toHaveBeenCalled();
      expect(f.onEffectStart).not.toHaveBeenCalled();
    },
  );

  it("preserves an in-place template changed after reading", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    f.files.set("template.docx", await templateBytes());
    const external = Buffer.from("External edit");
    f.beforeFileWrite.mockImplementation(async () => {
      f.files.set("template.docx", external);
    });
    const result = await f.registry.execute(
      "create_document",
      templateSpec("template.docx"),
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Target changed");
    expect(f.files.get("template.docx")).toEqual(external);
    expect(f.observeFile).not.toHaveBeenCalled();
  });

  it("does not commit a template with missing placeholders", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    f.files.set("template.docx", await templateBytes());
    const result = await f.registry.execute(
      "create_document",
      templateSpec("filled.docx", "missing"),
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("TEMPLATE_PLACEHOLDER_INVALID");
    expect(f.files.has("filled.docx")).toBe(false);
    expect(f.onEffectStart).not.toHaveBeenCalled();
  });
  it("reports committed output when only temporary cleanup fails", async () => {
    const f = await fixture();
    vi.mocked(rm).mockRejectedValueOnce(
      Object.assign(new Error("Temporary file is locked"), { code: "EPERM" }),
    );
    const result = await f.registry.execute(
      "create_document",
      { path: "saved.docx", blocks: body },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    expect(result.output).toContain("临时文件清理失败");
    const bytes = await readFile(join(f.root, "saved.docx"));
    expect((await extractDocumentBuffer(bytes, "saved.docx")).text).toContain(chineseText);
    expect(f.observeFile).toHaveBeenCalledExactlyOnceWith(join(f.root, "saved.docx"), hash(bytes));
    expect(result.fileChange?.changeType).toBe("created");
  });

  it("writes a real editable DOCX with Chinese, a native table, page break and local image", async () => {
    const f = await fixture();
    await mkdir(join(f.root, "images"));
    await writeFile(join(f.root, "images", "pixel.png"), png);
    const path = join(f.root, "reports", "report.docx");
    const result = await f.registry.execute(
      "create_document",
      {
        path: "reports/report.docx",
        title: "\u751f\u6210\u62a5\u544a",
        author: "Mingshen",
        blocks: [
          { type: "heading", text: "\u7b2c\u4e00\u8282", level: 1 },
          ...body,
          { type: "list", ordered: true, items: ["\u7b2c\u4e00\u9879", "\u7b2c\u4e8c\u9879"] },
          {
            type: "table",
            header: true,
            rows: [
              ["\u9879\u76ee", "\u7ed3\u679c"],
              ["\u9a8c\u8bc1", "\u901a\u8fc7"],
            ],
          },
          { type: "image", path: "images/pixel.png", width: 1, height: 1, alt: "Pixel" },
          { type: "page_break" },
          { type: "paragraph", text: "\u7b2c\u4e8c\u9875" },
        ],
      },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    expect(result.fileChange).toEqual({
      path,
      changeType: "created",
      additions: 0,
      deletions: 0,
    });
    const output = await readFile(path);
    const parsed = await extractDocumentBuffer(output, path);
    expect(parsed.text).toContain("\u751f\u6210\u62a5\u544a");
    expect(parsed.text).toContain(chineseText);
    expect(parsed.text).toContain("\u9a8c\u8bc1");
    expect(parsed.text).toContain("\u7b2c\u4e8c\u9875");
    const archive = unzipSync(output);
    const document = strFromU8(archive["word/document.xml"] ?? new Uint8Array());
    expect(document).toContain("<w:tbl>");
    expect(document).toContain('w:type="page"');
    expect(document).toContain('w:w="12240"');
    expect(document).toContain('w:h="15840"');
    const image = Object.entries(archive).find(([name]) => name.startsWith("word/media/"));
    expect(Buffer.from(image?.[1] ?? [])).toEqual(png);
    expect(f.beforeFileWrite).toHaveBeenCalledExactlyOnceWith(path, "missing");
    expect(f.observeFile).toHaveBeenCalledExactlyOnceWith(path, hash(output));
    expect(f.onEffectStart).toHaveBeenCalledOnce();
    expect(f.fileOperation).not.toHaveBeenCalled();
    expect(f.requestApproval).not.toHaveBeenCalled();
    expect(await readdir(join(f.root, "reports"))).toEqual(["report.docx"]);
  });

  it("writes real PPTX slides with editable Chinese text, table, notes and image bytes", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "pixel.png"), png);
    const result = await f.registry.execute(
      "create_document",
      {
        path: "presentation.pptx",
        title: "\u9879\u76ee\u6f14\u793a",
        slides: [
          {
            title: "\u9879\u76ee\u7ed3\u679c",
            notes: "\u8bb2\u8005\u5907\u6ce8",
            blocks: [
              { type: "heading", text: "\u7ed3\u679c\u6982\u89c8", level: 1 },
              { type: "paragraph", text: chineseText },
              {
                type: "table",
                rows: [
                  ["\u6307\u6807", "\u72b6\u6001"],
                  ["\u6587\u6863", "\u901a\u8fc7"],
                ],
                position: { x: 0.6, y: 2, w: 6, h: 1.2 },
              },
              { type: "image", path: "pixel.png", position: { x: 8, y: 2, w: 1, h: 1 } },
            ],
          },
          { blocks: [{ type: "paragraph", text: "\u4e0b\u4e00\u6b65" }] },
        ],
      },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    const path = join(f.root, "presentation.pptx");
    const output = await readFile(path);
    const parsed = await extractDocumentBuffer(output, path);
    expect(parsed.text).toContain(chineseText);
    expect(parsed.text).toContain("\u4e0b\u4e00\u6b65");
    const archive = unzipSync(output);
    const slide = strFromU8(archive["ppt/slides/slide1.xml"] ?? new Uint8Array());
    expect(slide).toContain("<a:tbl>");
    expect(slide).toContain(chineseText);
    expect(strFromU8(archive["ppt/notesSlides/notesSlide1.xml"] ?? new Uint8Array())).toContain(
      "\u8bb2\u8005\u5907\u6ce8",
    );
    const images = Object.entries(archive).filter(([name]) => name.startsWith("ppt/media/"));
    expect(images.some(([, bytes]) => Buffer.from(bytes).equals(png))).toBe(true);
    expect(f.observeFile).toHaveBeenCalledExactlyOnceWith(path, hash(output));
    expect(f.fileOperation).not.toHaveBeenCalled();
  });

  it("passes escaped local HTML and Letter settings to the PDF printer before saving", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "pixel.png"), png);
    const result = await f.registry.execute(
      "create_document",
      {
        path: "report.pdf",
        title: "\u4e2d\u6587 PDF",
        blocks: [
          { type: "paragraph", text: "<script>unsafe</script>" },
          { type: "image", path: "pixel.png" },
        ],
      },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    expect(printDocumentPdf).toHaveBeenCalledOnce();
    const [html, request, signal] = vi.mocked(printDocumentPdf).mock.calls[0] ?? [];
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(html).toContain(png.toString("base64"));
    expect(html).toContain("default-src 'none'");
    expect(request).toMatchObject({ page_size: "Letter", orientation: "portrait" });
    expect(signal).toBe(f.controller.signal);
    expect(await readFile(join(f.root, "report.pdf"))).toEqual(pdf);
  });

  it("does not read or write files when the output approval is denied", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    f.context.requestApproval = vi.fn(async (request: ApprovalRequest) => ({
      approvalId: request.id,
      decision: "deny" as const,
      feedback: "Denied for this test",
    }));
    const result = await f.registry.execute(
      "create_document",
      { path: "denied.docx", blocks: body },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Denied for this test");
    expect(f.fileOperation).not.toHaveBeenCalled();
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    expect(f.onEffectStart).not.toHaveBeenCalled();
    expect(f.observeFile).not.toHaveBeenCalled();
    await expect(readFile(join(f.root, "denied.docx"))).rejects.toThrow("ENOENT");
  });

  it("requires a separate image read approval and stops when it is denied", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    const outputPath = join(f.root, "image.docx");
    const imagePath = join(f.root, "virtual.png");
    f.files.set("virtual.png", png);
    const approvals: ApprovalRequest[] = [];
    f.context.requestApproval = vi.fn(async (request: ApprovalRequest) => {
      approvals.push(request);
      return {
        approvalId: request.id,
        decision: request.pathScope === outputPath ? ("allow_once" as const) : ("deny" as const),
        feedback: "Image access denied",
      };
    });
    const result = await f.registry.execute(
      "create_document",
      { path: "image.docx", blocks: [{ type: "image", path: "virtual.png" }] },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Image access denied");
    expect(approvals.map((request) => [request.pathScope, request.risk])).toEqual([
      [outputPath, "elevated"],
      [imagePath, "normal"],
    ]);
    expect(f.fileOperation.mock.calls.map(([, request]) => request.operation)).toEqual(["hash"]);
    expect(f.files.has("image.docx")).toBe(false);
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    expect(f.onEffectStart).not.toHaveBeenCalled();
    await expect(readFile(outputPath)).rejects.toThrow("ENOENT");
  });

  it("remembers output writes and image reads without granting image write permission", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    f.files.set("virtual.png", png);
    const approvals: ApprovalRequest[] = [];
    f.context.requestApproval = vi.fn(async (request: ApprovalRequest) => {
      approvals.push(request);
      return { approvalId: request.id, decision: "allow_session" as const };
    });
    const result = await f.registry.execute(
      "create_document",
      { path: "image.docx", blocks: [{ type: "image", path: "virtual.png" }] },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    expect(approvals.map((request) => request.toolName)).toEqual(["create_document", "read_file"]);
    expect(f.context.permissions.hasPath("documents", join(f.root, "image.docx"), "write")).toBe(
      true,
    );
    expect(f.context.permissions.hasPath("documents", join(f.root, "virtual.png"), "read")).toBe(
      true,
    );
    expect(f.context.permissions.hasPath("documents", join(f.root, "virtual.png"), "write")).toBe(
      false,
    );
  });

  it.each([
    {
      name: "native approval",
      permissionMode: "request_approval" as const,
      executionMode: "host" as const,
    },
    {
      name: "native child",
      permissionMode: "full_access" as const,
      executionMode: "host" as const,
      parentSessionId: "parent",
    },
    { name: "Docker", permissionMode: "full_access" as const, executionMode: "docker" as const },
  ])("uses binary gateways without host target or asset reads in $name mode", async (session) => {
    const f = await fixture(session);
    const dockerOperation = vi
      .spyOn(DockerService.prototype, "fileOperation")
      .mockImplementation(async (_image, workspace, request, signal) =>
        f.fileOperation(workspace, request, signal),
      );
    f.files.set("virtual.png", png);
    const result = await f.registry.execute(
      "create_document",
      {
        path: session.executionMode === "docker" ? "/workspace/virtual.docx" : "virtual.docx",
        blocks: [
          ...body,
          {
            type: "image",
            path: session.executionMode === "docker" ? "/workspace/virtual.png" : "virtual.png",
          },
        ],
      },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    const operations = f.fileOperation.mock.calls.map(([, request]) => request);
    expect(operations.map((request) => request.operation)).toEqual([
      "hash",
      "read_binary",
      "write_binary",
    ]);
    expect(operations.map((request) => request.path)).toEqual([
      "virtual.docx",
      "virtual.png",
      "virtual.docx",
    ]);
    expect(operations[2]?.expectedHash).toBe("missing");
    const output = f.files.get("virtual.docx");
    expect(output).toBeDefined();
    expect((await extractDocumentBuffer(output ?? Buffer.alloc(0), "virtual.docx")).text).toContain(
      chineseText,
    );
    expect(f.beforeFileWrite).toHaveBeenCalledExactlyOnceWith(
      join(f.root, "virtual.docx"),
      "missing",
    );
    expect(f.observeFile).toHaveBeenCalledExactlyOnceWith(
      join(f.root, "virtual.docx"),
      hash(output ?? Buffer.alloc(0)),
    );
    await expect(readFile(join(f.root, "virtual.docx"))).rejects.toThrow("ENOENT");
    await expect(readFile(join(f.root, "virtual.png"))).rejects.toThrow("ENOENT");
    if (session.executionMode === "docker") expect(dockerOperation).toHaveBeenCalledTimes(3);
    else expect(dockerOperation).not.toHaveBeenCalled();
  });

  it("uses the current gateway hash for an explicit overwrite and observes only committed bytes", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    const original = Buffer.from("old virtual document");
    f.files.set("existing.docx", original);
    const result = await f.registry.execute(
      "create_document",
      { path: "existing.docx", overwrite: true, blocks: body },
      f.context,
    );
    expect(result.isError, result.output).toBe(false);
    expect(result.fileChange?.changeType).toBe("modified");
    expect(f.beforeFileWrite).toHaveBeenCalledExactlyOnceWith(
      join(f.root, "existing.docx"),
      hash(original),
    );
    const writes = f.fileOperation.mock.calls.filter(
      ([, request]) => request.operation === "write_binary",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1].expectedHash).toBe(hash(original));
    const output = f.files.get("existing.docx");
    expect(output).not.toEqual(original);
    expect(f.observeFile).toHaveBeenCalledExactlyOnceWith(
      join(f.root, "existing.docx"),
      hash(output ?? Buffer.alloc(0)),
    );
    await expect(readFile(join(f.root, "existing.docx"))).rejects.toThrow("ENOENT");
  });

  it("does not overwrite an external change rejected by the binary gateway", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    const original = Buffer.from("original document");
    const external = Buffer.from("external edit");
    f.files.set("conflict.docx", original);
    f.beforeFileWrite.mockImplementation(async () => {
      f.files.set("conflict.docx", external);
    });
    const result = await f.registry.execute(
      "create_document",
      { path: "conflict.docx", overwrite: true, blocks: body },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Target changed before binary write");
    expect(f.files.get("conflict.docx")).toEqual(external);
    expect(f.observeFile).not.toHaveBeenCalled();
    expect(result.fileChange).toBeUndefined();
    await expect(readFile(join(f.root, "conflict.docx"))).rejects.toThrow("ENOENT");
  });

  it("preserves existing host output unless overwrite is explicitly enabled", async () => {
    const f = await fixture();
    const path = join(f.root, "existing.docx");
    const original = Buffer.from("do not replace");
    await writeFile(path, original);
    const denied = await f.registry.execute(
      "create_document",
      { path: "existing.docx", blocks: body },
      f.context,
    );
    expect(denied.isError).toBe(true);
    expect(denied.output).toContain("overwrite:true");
    expect(await readFile(path)).toEqual(original);
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    const allowed = await f.registry.execute(
      "create_document",
      { path: "existing.docx", overwrite: true, blocks: body },
      f.context,
    );
    expect(allowed.isError, allowed.output).toBe(false);
    expect(allowed.fileChange?.changeType).toBe("modified");
    expect(f.beforeFileWrite).toHaveBeenCalledExactlyOnceWith(path, hash(original));
    const output = await readFile(path);
    expect((await extractDocumentBuffer(output, path)).text).toContain(chineseText);
    expect(f.observeFile).toHaveBeenCalledExactlyOnceWith(path, hash(output));
    expect(await readdir(f.root)).toEqual(["existing.docx"]);
  });

  it("preserves external host changes and removes its temporary file on a version conflict", async () => {
    const f = await fixture();
    const path = join(f.root, "conflict.docx");
    await writeFile(path, Buffer.from("original document"));
    const external = Buffer.from("edited outside Harness");
    f.beforeFileWrite.mockImplementation(async () => {
      await writeFile(path, external);
    });
    const result = await f.registry.execute(
      "create_document",
      { path: "conflict.docx", overwrite: true, blocks: body },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("EXTERNAL_FILE_CHANGED");
    expect(await readFile(path)).toEqual(external);
    expect(await readdir(f.root)).toEqual(["conflict.docx"]);
    expect(f.observeFile).not.toHaveBeenCalled();
  });

  it("does not save after cancellation during PDF rendering", async () => {
    const f = await fixture();
    vi.mocked(printDocumentPdf).mockImplementationOnce(async () => {
      f.controller.abort(new Error("Cancelled document generation"));
      return pdf;
    });
    const result = await f.registry.execute(
      "create_document",
      { path: "cancelled.pdf", blocks: body },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Cancelled document generation");
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    expect(f.onEffectStart).not.toHaveBeenCalled();
    expect(f.observeFile).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual([]);
  });

  it("stops an already cancelled request before approval or isolation", async () => {
    const f = await fixture({ permissionMode: "request_approval" });
    f.controller.abort(new Error("Already cancelled"));
    const result = await f.registry.execute(
      "create_document",
      { path: "cancelled.docx", blocks: body },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Already cancelled");
    expect(f.requestApproval).not.toHaveBeenCalled();
    expect(f.fileOperation).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual([]);
  });

  it("leaves no new output when printing fails", async () => {
    const f = await fixture();
    vi.mocked(printDocumentPdf).mockRejectedValueOnce(new Error("Local print failed"));
    const result = await f.registry.execute(
      "create_document",
      { path: "failed.pdf", blocks: body },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Local print failed");
    expect(await readdir(f.root)).toEqual([]);
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    expect(f.observeFile).not.toHaveBeenCalled();
  });

  it("rejects invalid image bytes without leaving a partial Office document", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "invalid.png"), "not a PNG");
    const result = await f.registry.execute(
      "create_document",
      { path: "failed.docx", blocks: [{ type: "image", path: "invalid.png" }] },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(await readdir(f.root)).toEqual(["invalid.png"]);
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    expect(f.observeFile).not.toHaveBeenCalled();
  });

  it.each([
    "../outside.docx",
    ".git/output.docx",
    ".harness-memory/output.docx",
    ".harness-tencent-memory/output.docx",
    "https://example.invalid/output.docx",
  ])("rejects protected output path %s before approval or generation", async (path) => {
    const f = await fixture({ permissionMode: "request_approval" });
    const result = await f.registry.execute("create_document", { path, blocks: body }, f.context);
    expect(result.isError).toBe(true);
    expect(f.requestApproval).not.toHaveBeenCalled();
    expect(f.fileOperation).not.toHaveBeenCalled();
    expect(printDocumentPdf).not.toHaveBeenCalled();
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual([]);
  });

  it("rejects an image outside the workspace even in full access mode", async () => {
    const f = await fixture();
    const result = await f.registry.execute(
      "create_document",
      { path: "report.docx", blocks: [{ type: "image", path: "../outside.png" }] },
      f.context,
    );
    expect(result.isError).toBe(true);
    expect(f.beforeFileWrite).not.toHaveBeenCalled();
    expect(f.fileOperation).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual([]);
  });
});
