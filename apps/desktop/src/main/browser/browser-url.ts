import { stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { safeFilePath } from "../workspace/safe-file-path";

const localFileExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".doc",
  ".docx",
  ".go",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".pdf",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

export async function normalizeBrowserUrl(
  value: string,
  workspacePath?: string | null,
): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "about:blank") {
    return "about:blank";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return new URL(trimmed).toString();
  }

  if (/^file:/i.test(trimmed)) {
    return await localFileUrl(fileURLToPath(new URL(trimmed)), workspacePath);
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed)) {
    throw new Error("仅支持 http、https 和当前工作区内的本地文件。");
  }

  if (isAbsolute(trimmed) || /^[a-z]:[\\/]/i.test(trimmed)) {
    return await localFileUrl(trimmed, workspacePath);
  }

  const looksLikePath = trimmed.startsWith(".") || /[\\/]/.test(trimmed);
  const hasLocalFileExtension = localFileExtensions.has(extname(trimmed).toLowerCase());
  if (workspacePath && (looksLikePath || hasLocalFileExtension)) {
    return await localFileUrl(trimmed, workspacePath);
  }

  if (trimmed.includes(" ")) {
    return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`;
  }

  return `https://${trimmed}`;
}

async function localFileUrl(value: string, workspacePath?: string | null): Promise<string> {
  if (!workspacePath) {
    throw new Error("打开本地文件需要先为当前会话选择工作目录。");
  }

  const root = resolve(workspacePath);
  const target = resolve(root, value);
  const relativePath = relative(root, target);
  const safePath = await safeFilePath(root, relativePath);
  try {
    const metadata = await stat(safePath);
    if (!metadata.isFile()) {
      throw new Error("浏览器预览仅支持打开工作区内的文件。");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return pathToFileURL(safePath).toString();
}
