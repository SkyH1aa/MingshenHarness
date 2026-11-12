import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectConfigService } from "./project-config-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const root of temporaryDirectories.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ProjectConfigService", () => {
  it("loads JSONC instructions, custom LSP, formatter and Docker settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "mingshen-config-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, ".mingshen"), { recursive: true });
    await writeFile(
      join(root, ".mingshen", "config.jsonc"),
      `{
        // project rules
        "instructions": ["docs/*.md"],
        "lsp": {
          "python": {
            "command": ["pyright-langserver", "--stdio"],
            "extensions": [".py"],
            "initialization": { "python": { "analysis": {} } }
          }
        },
        "formatter": {
          "black": {
            "command": ["black", "$FILE"],
            "extensions": [".py"]
          }
        },
        "mcp": {
          "context7": {
            "type": "remote",
            "url": "https://mcp.context7.com/mcp",
            "enabled": true,
            "oauth": { "scope": "tools:read" }
          }
        },
        "docker": {
          "image": "example/agent:latest",
          "dockerfile": "Dockerfile",
          "buildContext": "."
        }
      }`,
      "utf8",
    );
    const config = await new ProjectConfigService(join(root, "user")).load(root);
    expect(config.instructions).toContain("docs/*.md");
    expect(config.lspServers[0]).toMatchObject({
      id: "python",
      command: ["pyright-langserver", "--stdio"],
    });
    expect(config.formatters[0]?.extensions).toEqual([".py"]);
    expect(config.mcpServers[0]).toMatchObject({
      id: "context7",
      transport: "http",
      oauthEnabled: true,
      oauthScope: "tools:read",
    });
    expect(config.docker.image).toBe("example/agent:latest");
  });
});
