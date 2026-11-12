import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeBrowserUrl } from "./browser-url";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mingshen-browser-url-"));
  temporaryRoots.push(root);
  const workspace = join(root, "工作区");
  await mkdir(workspace);
  await writeFile(join(workspace, "说明 文件.pdf"), "fixture");
  await mkdir(join(workspace, "docs"));
  await writeFile(join(workspace, "docs", "readme.md"), "fixture");
  return workspace;
}

describe("normalizeBrowserUrl", () => {
  it("preserves web URLs and converts browser searches without a protocol", async () => {
    expect(await normalizeBrowserUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(await normalizeBrowserUrl("example.com")).toBe("https://example.com");
    expect(await normalizeBrowserUrl("hello world")).toBe(
      "https://www.bing.com/search?q=hello%20world",
    );
  });

  it("resolves Windows absolute paths and workspace-relative documents as file URLs", async () => {
    const workspace = await makeWorkspace();
    const absolute = join(workspace, "说明 文件.pdf");
    expect(await normalizeBrowserUrl(absolute, workspace)).toBe(pathToFileURL(absolute).toString());
    expect(await normalizeBrowserUrl("docs/readme.md", workspace)).toBe(
      pathToFileURL(join(workspace, "docs", "readme.md")).toString(),
    );
    expect(await normalizeBrowserUrl(pathToFileURL(absolute).toString(), workspace)).toBe(
      pathToFileURL(absolute).toString(),
    );
  });

  it("keeps local file access inside the current workspace", async () => {
    const workspace = await makeWorkspace();
    const outside = resolve(workspace, "..", "private.pdf");
    await expect(normalizeBrowserUrl(outside, workspace)).rejects.toThrow();
    await expect(normalizeBrowserUrl("../private.pdf", workspace)).rejects.toThrow();
    await expect(normalizeBrowserUrl("file:///C:/Windows/win.ini", workspace)).rejects.toThrow();
    await expect(normalizeBrowserUrl("C:\\Windows\\win.ini")).rejects.toThrow();
    await expect(normalizeBrowserUrl("javascript:alert(1)", workspace)).rejects.toThrow();
  });

  it("supports a workspace-local path even when the target has not been created yet", async () => {
    const workspace = await makeWorkspace();
    const missing = join(workspace, "new-preview.txt");
    expect(await normalizeBrowserUrl(missing, workspace)).toBe(pathToFileURL(missing).toString());
  });
});
