import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LspDiagnosticsService } from "./lsp-diagnostics-service";
import { ProjectConfigService } from "./project-config-service";
import { ProjectToolingService } from "./project-tooling-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ProjectToolingService", () => {
  it("does not run Python or Rust formatters on unrelated edited files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-formatter-filter-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "pyproject.toml"), "");
    await writeFile(join(root, "Cargo.toml"), "");
    await writeFile(join(root, "notes.txt"), "notes");
    await writeFile(join(root, "sample.py"), "pass\n");
    const service = new ProjectToolingService(
      {} as LspDiagnosticsService,
      new ProjectConfigService(join(root, "user")),
    );
    expect(await service.detectFormatter(root, [join(root, "notes.txt")])).toBeNull();
    expect(
      (await service.detectFormatter(root, [join(root, "sample.py"), join(root, "notes.txt")]))
        ?.files,
    ).toEqual(["sample.py"]);
  });
  it("skips document-only diagnostics even inside a TypeScript and Rust project", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-document-checks-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, "tsconfig.json"), "{}");
    await writeFile(join(root, "Cargo.toml"), "");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { typecheck: "exit 1" } }),
    );
    const files = ["notes.txt", "report.docx", "slides.pptx", "report.pdf"].map((file) =>
      join(root, file),
    );
    for (const file of files) await writeFile(file, "document");
    const diagnostics = vi.fn();
    const service = new ProjectToolingService(
      { diagnostics } as unknown as LspDiagnosticsService,
      new ProjectConfigService(join(root, "user")),
    );
    expect(await service.diagnosticPaths(root, files)).toEqual([]);
    expect(await service.diagnostics(root, files)).toMatchObject({
      ok: true,
      engine: "not-applicable",
      diagnostics: [],
      error: null,
    });
    expect(diagnostics).not.toHaveBeenCalled();
  });
  it("does not announce diagnostics for code files without an applicable engine", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-unconfigured-checks-"));
    temporaryDirectories.push(root);
    const files = ["setup.ps1", "index.html", "style.css", "query.sql"].map((file) =>
      join(root, file),
    );
    for (const file of files) await writeFile(file, "source");
    const diagnostics = vi.fn().mockResolvedValue(null);
    const onStart = vi.fn();
    const service = new ProjectToolingService(
      { diagnostics } as unknown as LspDiagnosticsService,
      new ProjectConfigService(join(root, "user")),
    );
    expect(await service.diagnosticPaths(root, files)).toEqual(files);
    expect(await service.diagnostics(root, files, onStart)).toMatchObject({
      ok: true,
      engine: "not-configured",
      diagnostics: [],
      error: null,
    });
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
  });
  it("announces a TypeScript compiler fallback before executing the configured project check", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-compiler-check-"));
    temporaryDirectories.push(root);
    const file = join(root, "code.ts");
    await writeFile(file, "const value: string = 1;\n");
    const bin = join(root, "node_modules", "typescript", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, "tsc"),
      'console.log("code.ts(1,1): error TS2322: Incorrect type"); process.exitCode = 1;',
    );
    const onStart = vi.fn();
    const service = new ProjectToolingService(
      { diagnostics: vi.fn().mockResolvedValue(null) } as unknown as LspDiagnosticsService,
      new ProjectConfigService(join(root, "user")),
    );
    expect(await service.diagnostics(root, [file], onStart)).toMatchObject({
      ok: false,
      engine: "TypeScript Language Service",
      diagnostics: [expect.objectContaining({ path: file, severity: "error" })],
      error: expect.stringContaining("TS2322"),
    });
    expect(onStart).toHaveBeenCalledOnce();
  });
  it("filters unsupported and deleted files before passing them to Prettier", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-prettier-filter-"));
    temporaryDirectories.push(root);
    await writeFile(join(root, ".prettierrc"), "{}");
    const bin = join(root, "node_modules", "prettier", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "prettier.cjs"), "");
    await writeFile(join(root, "notes.txt"), "notes");
    await writeFile(join(root, "report.docx"), "document");
    await writeFile(join(root, "code.ts"), "const value = 1;");
    const service = new ProjectToolingService(
      {} as LspDiagnosticsService,
      new ProjectConfigService(join(root, "user")),
    );
    expect(
      await service.detectFormatter(root, [join(root, "notes.txt"), join(root, "report.docx")]),
    ).toBeNull();
    expect(
      (
        await service.detectFormatter(root, [
          join(root, "notes.txt"),
          join(root, "code.ts"),
          join(root, "deleted.ts"),
        ])
      )?.files,
    ).toEqual(["code.ts"]);
    expect(
      await service.diagnosticPaths(root, [
        join(root, "notes.txt"),
        join(root, "code.ts"),
        join(root, "deleted.ts"),
      ]),
    ).toEqual([join(root, "code.ts")]);
  });
  it("allows an explicitly configured language server for a custom document extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-explicit-diagnostics-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, ".mingshen"));
    await writeFile(
      join(root, ".mingshen", "config.json"),
      JSON.stringify({
        lsp: { prose: { command: ["prose-checker"], extensions: [".txt"] } },
      }),
    );
    const file = join(root, "notes.txt");
    await writeFile(file, "notes");
    const report = {
      ok: false,
      engine: "prose",
      servers: ["prose"],
      durationMs: 1,
      diagnostics: [
        {
          path: file,
          line: 1,
          column: 1,
          severity: "warning",
          message: "A real prose warning",
          source: "prose",
        },
      ],
      error: null,
    };
    const diagnostics = vi.fn().mockResolvedValue(report);
    const service = new ProjectToolingService(
      { diagnostics } as unknown as LspDiagnosticsService,
      new ProjectConfigService(join(root, "user")),
    );
    expect(await service.diagnostics(root, [file])).toEqual(report);
    expect(diagnostics).toHaveBeenCalledWith(
      root,
      [file],
      expect.arrayContaining([expect.objectContaining({ id: "prose" })]),
      undefined,
    );
  });
  it("runs a project-configured custom formatter", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-formatter-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, ".mingshen"));
    const formatter = join(root, "format.mjs");
    await writeFile(
      formatter,
      `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], "formatted\\n");`,
      "utf8",
    );
    await writeFile(
      join(root, ".mingshen", "config.json"),
      JSON.stringify({
        formatter: {
          demo: {
            command: [process.execPath, formatter, "$FILE"],
            extensions: [".demo"],
          },
        },
      }),
      "utf8",
    );
    const file = join(root, "sample.demo");
    await writeFile(file, "unformatted\n", "utf8");
    const lsp = {
      diagnostics: vi.fn().mockResolvedValue(null),
    } as unknown as LspDiagnosticsService;
    const service = new ProjectToolingService(lsp, new ProjectConfigService(join(root, "user")));
    const detected = await service.detectFormatter(root, [file]);
    expect(detected?.id).toBe("demo");
    const result = await service.format(root, detected as NonNullable<typeof detected>);
    expect(result.ok).toBe(true);
    await expect(readFile(file, "utf8")).resolves.toBe("formatted\n");
  });
});
