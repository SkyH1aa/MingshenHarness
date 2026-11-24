import { join } from "node:path";

export interface RuntimeResourcePaths {
  resourceDirectory: string;
  promptDirectory: string;
}

export function resolveRuntimeResourcePaths(input: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): RuntimeResourcePaths {
  return {
    resourceDirectory: input.isPackaged ? input.resourcesPath : join(input.appPath, "resources"),
    promptDirectory: join(input.appPath, "resources", "prompts"),
  };
}

export function resolveExternalResourcePath(
  resourceDirectory: string,
  ...segments: string[]
): string {
  return join(resourceDirectory, ...segments);
}

export function resolveDeveloperSdkPath(resourceDirectory: string): string {
  return resolveExternalResourcePath(resourceDirectory, "sdk", "plugin-dev", "mingshen-plugin.mjs");
}
