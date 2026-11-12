import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export async function safeFilePath(root: string, path: string): Promise<string> {
  const target = resolve(root, path);
  const local = relative(resolve(root), target);
  if (
    local
      .split(/[\\/]/)
      .some(
        (part) =>
          part.includes(":") ||
          [...part].some((character) => character.charCodeAt(0) < 32) ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error("Unsafe Windows path segment.");
  if ((await lstat(resolve(root))).isSymbolicLink())
    throw new Error("Linked workspace roots are not allowed.");
  if (
    !local ||
    local === ".." ||
    local.startsWith(`..${sep}`) ||
    isAbsolute(local) ||
    local.split(/[\\/]/).some((part) => part.toLowerCase() === ".git")
  ) {
    throw new Error("文件路径越界或指向 Git 元数据。");
  }
  let cursor = resolve(root);
  for (const part of local.split(sep)) {
    cursor = resolve(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error("文件路径经过符号链接或目录链接。");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}
