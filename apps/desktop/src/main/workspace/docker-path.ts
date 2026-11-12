import { existsSync } from "node:fs";
import { join } from "node:path";
export function dockerExecutable(): string {
  for (const root of [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "DockerDesktop") : "",
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "Docker", "Docker") : "",
  ]) {
    const bin = join(root, "resources", "bin");
    const executable = join(bin, "docker.exe");
    if (root && existsSync(executable)) {
      if (!(process.env.PATH ?? "").split(";").includes(bin))
        process.env.PATH = `${bin};${process.env.PATH ?? ""}`;
      return executable;
    }
  }
  return "docker.exe";
}
