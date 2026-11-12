import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { extname, join, posix } from "node:path";
import type * as TS from "../../../resources/lsp/typescript/lib/typescript";
import {
  type IndexedReference,
  LANGUAGE_EXTENSIONS,
  parseMultilanguage,
} from "./multilanguage-parser";

export interface CodeSymbol {
  name: string;
  kind: string;
  line: number;
  endLine: number;
  signature: string;
}
interface IndexedFile {
  fingerprint: string;
  hash: string;
  symbols: CodeSymbol[];
  imports: string[];
  references?: IndexedReference[];
}
export interface IndexSnapshot {
  version: 1;
  files: Record<string, IndexedFile>;
}
export interface CodeIndexIO {
  list(): Promise<Array<{ path: string; fingerprint: string }>>;
  read(path: string): Promise<string>;
  load?(): IndexSnapshot | null;
  save?(snapshot: IndexSnapshot): void;
}

let compiler: typeof TS | undefined;
function typescript(): typeof TS {
  if (!compiler) {
    const require = createRequire(import.meta.url);
    const resource = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      resource && join(resource, "lsp", "typescript", "lib", "typescript.js"),
      join(import.meta.dirname, "../../resources/lsp/typescript/lib/typescript.js"),
      join(import.meta.dirname, "../../../resources/lsp/typescript/lib/typescript.js"),
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        compiler = require(candidate) as typeof TS;
        break;
      } catch {
        /* Try the bundled development resource. */
      }
    }
    if (!compiler) throw new Error("Bundled TypeScript parser is unavailable.");
  }
  return compiler;
}

/** A reversible history view, never a substitute for reading source before an edit. */
export function codeOutline(language: string, content: string): string | null {
  if (content.length > 256000) return null;
  try {
    const ts = typescript();
    const extension = /tsx|jsx/i.test(language) ? "tsx" : "ts";
    const source = ts.createSourceFile(
      `history.${extension}`,
      content,
      ts.ScriptTarget.Latest,
      true,
    );
    const edits: Array<{ start: number; end: number; text: string }> = [];
    const visit = (node: TS.Node) => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isConstructorDeclaration(node) ||
          ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node)) &&
        node.body &&
        ts.isBlock(node.body) &&
        node.body.getWidth(source) > 500
      ) {
        const evidence = node.body.statements
          .filter(
            (item) =>
              ts.isReturnStatement(item) || ts.isThrowStatement(item) || ts.isIfStatement(item),
          )
          .slice(0, 3)
          .map((item) => {
            const text = item.getText(source);
            return text.length <= 240 ? text : `${text.slice(0, 200)} /* excerpt */`;
          });
        edits.push({
          start: node.body.getStart(source),
          end: node.body.end,
          text: `{\n/* Historical outline: implementation omitted; retrieve original before editing. */\n${evidence.join("\n")}\n}`,
        });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!edits.length) return null;
    let result = content;
    for (const edit of edits.sort((a, b) => b.start - a.start))
      result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    return result;
  } catch {
    return null;
  }
}

export const INDEX_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ...Object.keys(LANGUAGE_EXTENSIONS),
]);

function parseFile(
  path: string,
  content: string,
): Pick<IndexedFile, "symbols" | "imports" | "references"> {
  if (LANGUAGE_EXTENSIONS[extname(path).toLowerCase()]) return parseMultilanguage(path, content);
  const ts = typescript();
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const symbols: CodeSymbol[] = [];
  const imports: string[] = [];
  const references: IndexedReference[] = [];
  const visit = (node: TS.Node, caller: string | null = null) => {
    let nextCaller = caller;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "require" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push(node.arguments[0].text);
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isVariableDeclaration(node)
    ) {
      const name = node.name?.getText(source);
      if (
        name &&
        (ts.isFunctionDeclaration(node) ||
          ts.isMethodDeclaration(node) ||
          (ts.isVariableDeclaration(node) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))))
      )
        nextCaller = name;
      if (name && symbols.length < 2000)
        symbols.push({
          name,
          kind: ts.SyntaxKind[node.kind],
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
          signature: node.getText(source).split(/\r?\n/)[0]?.slice(0, 180) ?? name,
        });
    }
    if (
      ts.isIdentifier(node) &&
      !(
        "name" in node.parent &&
        node.parent.name === node &&
        (ts.isDeclarationStatement(node.parent) ||
          ts.isVariableDeclaration(node.parent) ||
          ts.isParameter(node.parent) ||
          ts.isMethodDeclaration(node.parent))
      )
    ) {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      references.push({
        name: node.text,
        line: location.line + 1,
        column: location.character + 1,
        kind: "reference",
        caller,
        context: node.parent.getText(source).split(/\r?\n/)[0]?.slice(0, 180) ?? node.text,
      });
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = node.expression.getText(source).split(".").at(-1) ?? "";
      const location = source.getLineAndCharacterOfPosition(node.getStart(source));
      references.push({
        name,
        line: location.line + 1,
        column: location.character + 1,
        kind: "call",
        caller,
        context: node.getText(source).split(/\r?\n/)[0]?.slice(0, 180) ?? name,
      });
    }
    ts.forEachChild(node, (child) => visit(child, nextCaller));
  };
  visit(source);
  return { symbols, imports: [...new Set(imports)], references: references.slice(0, 20000) };
}

export class CodeIndexService {
  private readonly workspaces = new Map<string, IndexSnapshot>();
  private readonly refreshes = new Map<string, Promise<string>>();

  async query(
    key: string,
    args: {
      query?: string | undefined;
      path?: string | undefined;
      operation?: string | undefined;
      limit?: number | undefined;
      max_files?: number | undefined;
    },
    io: CodeIndexIO,
    signal: AbortSignal,
  ): Promise<string> {
    // Serialize refreshes for the same permission/sandbox scope; never share unapproved reads.
    const previous = this.refreshes.get(key);
    const pending = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        signal.throwIfAborted();
        return this.perform(key, args, io, signal);
      });
    this.refreshes.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.refreshes.get(key) === pending) this.refreshes.delete(key);
    }
  }

  private async perform(
    key: string,
    args: {
      query?: string | undefined;
      path?: string | undefined;
      operation?: string | undefined;
      limit?: number | undefined;
      max_files?: number | undefined;
    },
    io: CodeIndexIO,
    signal: AbortSignal,
  ): Promise<string> {
    const saved = this.workspaces.get(key) ?? io.load?.();
    const snapshot: IndexSnapshot = saved?.version === 1 ? saved : { version: 1, files: {} };
    const listed = await io.list();
    const candidates = listed.filter((entry) =>
      INDEX_EXTENSIONS.has(extname(entry.path).toLowerCase()),
    );
    const entries = candidates.slice(0, Math.min(20000, Math.max(1, args.max_files ?? 10000)));
    const next: IndexSnapshot = { version: 1, files: {} };
    let parsed = 0;
    const warnings: string[] = [];
    if (candidates.length > entries.length)
      warnings.push(
        `File limit reached: indexed at most ${entries.length} of ${candidates.length} candidates.`,
      );
    if (listed.length >= 25000)
      warnings.push(
        "Directory entry limit may have been reached (25000); narrow the scan path or depth.",
      );
    let totalSymbols = 0;
    for (const entry of entries) {
      signal.throwIfAborted();
      const old = snapshot.files[entry.path];
      if (old?.references && entry.fingerprint && old.fingerprint === entry.fingerprint) {
        next.files[entry.path] = old;
        totalSymbols += old.symbols.length;
        if (totalSymbols > 30000) {
          warnings.push("Symbol limit reached (30000).");
          break;
        }
        continue;
      }
      try {
        const text = await io.read(entry.path);
        if (text.length > 500_000) {
          warnings.push(`${entry.path}: too large`);
          continue;
        }
        const hash = createHash("sha256").update(text).digest("hex");
        next.files[entry.path] = {
          ...(old?.references && old.hash === hash ? old : parseFile(entry.path, text)),
          hash,
          fingerprint: entry.fingerprint,
        };
        totalSymbols += next.files[entry.path]?.symbols.length ?? 0;
        if (!old?.references || old.hash !== hash) parsed++;
        if (totalSymbols > 30000) {
          warnings.push("Symbol limit reached (30000).");
          break;
        }
      } catch (error) {
        warnings.push(`${entry.path}: ${String(error).slice(0, 160)}`);
      }
    }
    signal.throwIfAborted();
    this.workspaces.set(key, next);
    if (this.workspaces.size > 6)
      this.workspaces.delete(this.workspaces.keys().next().value as string);
    io.save?.(next);
    const limit = Math.min(200, Math.max(1, args.limit ?? 60));
    const query = args.query?.toLowerCase() ?? "";
    const path = args.path?.replaceAll("\\", "/");
    const symbols = Object.entries(next.files)
      .flatMap(([file, data]) =>
        !path || file === path || file.startsWith(`${path}/`)
          ? data.symbols
              .filter((s) => !query || s.name.toLowerCase().includes(query))
              .map((s) => ({ path: file, ...s }))
          : [],
      )
      .slice(0, limit);
    const references = Object.entries(next.files)
      .flatMap(([file, data]) =>
        (data.references ?? [])
          .filter(
            (reference) =>
              (!path || path === file) &&
              (!query ||
                (args.operation === "callees"
                  ? reference.caller?.toLowerCase() === query
                  : reference.name.toLowerCase() === query)),
          )
          .map((reference) => ({ path: file, ...reference })),
      )
      .filter(
        (reference) =>
          (args.operation !== "callers" && args.operation !== "callees") ||
          reference.kind === "call",
      );
    const graph = Object.entries(next.files)
      .flatMap(([file, data]) =>
        data.imports.map((target) => {
          const base = target.startsWith(".")
            ? posix.normalize(posix.join(posix.dirname(file), target))
            : target;
          const resolved = [
            base,
            ...(/\.[cm]?jsx?$/.test(base)
              ? [base.replace(/\.[cm]?jsx?$/, ".ts"), base.replace(/\.[cm]?jsx?$/, ".tsx")]
              : []),
            ...[".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"].map(
              (suffix) => base + suffix,
            ),
          ].find((candidate) => next.files[candidate]);
          return { from: file, to: resolved ?? target, resolved: Boolean(resolved) };
        }),
      )
      .filter(
        (edge) =>
          (!path || edge.from === path || edge.to === path) &&
          (!query ||
            edge.from.toLowerCase().includes(query) ||
            edge.to.toLowerCase().includes(query)),
      )
      .slice(0, limit);
    return JSON.stringify(
      {
        engine: "TypeScript AST + tree-sitter (JS/TS, Python, Go, Rust, Java, C/C++, C#)",
        resolution:
          "Syntax-level candidates; dynamic dispatch, overloads and cross-language bindings require LSP or source confirmation.",
        files: Object.keys(next.files).length,
        scannedCandidates: entries.length,
        reparsed: parsed,
        scope:
          "Bounded workspace scan; max_files configurable up to 20000. Query exact paths to narrow results.",
        ...(args.operation === "graph"
          ? { edges: graph }
          : ["references", "callers", "callees"].includes(args.operation ?? "")
            ? { references: references.slice(0, limit) }
            : { symbols }),
        warnings: warnings.slice(0, 10),
      },
      null,
      2,
    );
  }
}
