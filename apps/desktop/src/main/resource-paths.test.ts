import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveDeveloperSdkPath,
  resolveExternalResourcePath,
  resolveRuntimeResourcePaths,
} from "./resource-paths";

describe("runtime resource paths", () => {
  it("puts packaged prompts inside app.asar while keeping executable resources external", () => {
    const resources = resolve("MingshenHarness", "resources");
    const paths = resolveRuntimeResourcePaths({
      isPackaged: true,
      appPath: join(resources, "app.asar"),
      resourcesPath: resources,
    });

    expect(paths.resourceDirectory).toBe(resources);
    expect(paths.promptDirectory).toBe(join(resources, "app.asar", "resources", "prompts"));
    expect(resolveExternalResourcePath(paths.resourceDirectory, "lsp")).toBe(
      join(resources, "lsp"),
    );
    expect(
      resolveExternalResourcePath(paths.resourceDirectory, "native", "codex-sandbox.exe"),
    ).toBe(join(resources, "native", "codex-sandbox.exe"));
    expect(resolveDeveloperSdkPath(paths.resourceDirectory)).toBe(
      join(resources, "sdk", "plugin-dev", "mingshen-plugin.mjs"),
    );
  });

  it("keeps source-mode resources under the Electron app directory", () => {
    const appPath = resolve("MingshenHarness", "apps", "desktop");
    const paths = resolveRuntimeResourcePaths({
      isPackaged: false,
      appPath,
      resourcesPath: resolve("unused-packaged-resources"),
    });

    expect(paths.resourceDirectory).toBe(join(appPath, "resources"));
    expect(paths.promptDirectory).toBe(join(appPath, "resources", "prompts"));
  });
});
