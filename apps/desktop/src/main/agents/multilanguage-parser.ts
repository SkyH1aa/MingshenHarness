import { extname } from "node:path";
import c from "@ast-grep/lang-c";
import cpp from "@ast-grep/lang-cpp";
import csharp from "@ast-grep/lang-csharp";
import go from "@ast-grep/lang-go";
import java from "@ast-grep/lang-java";
import python from "@ast-grep/lang-python";
import rust from "@ast-grep/lang-rust";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";

export interface IndexedReference {
  name: string;
  line: number;
  column: number;
  kind: "reference" | "call";
  caller: string | null;
  context: string;
}
export interface ParsedCode {
  symbols: Array<{ name: string; kind: string; line: number; endLine: number; signature: string }>;
  imports: string[];
  references: IndexedReference[];
  language?: string;
}
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "csharp",
};
let registered = false;
const definitions = new Set([
  "function_definition",
  "class_definition",
  "function_declaration",
  "method_declaration",
  "type_spec",
  "function_item",
  "struct_item",
  "enum_item",
  "trait_item",
  "type_item",
  "const_item",
  "static_item",
  "class_declaration",
  "interface_declaration",
  "enum_declaration",
  "struct_declaration",
  "record_declaration",
  "constructor_declaration",
  "namespace_definition",
]);
const calls = new Set([
  "call",
  "call_expression",
  "method_invocation",
  "object_creation_expression",
  "invocation_expression",
]);
const identifiers = new Set(["identifier", "field_identifier", "type_identifier", "name"]);

function named(node: SgNode): SgNode | null {
  const name = node.field("name");
  if (name) return name;
  const declarator = node.field("declarator");
  if (declarator)
    return (
      declarator.field("declarator") ??
      declarator.find({ rule: { any: [{ kind: "identifier" }, { kind: "field_identifier" }] } })
    );
  return null;
}

export function parseMultilanguage(path: string, content: string): ParsedCode {
  if (!registered) {
    // Native dlopen cannot traverse Electron's virtual ASAR filesystem.
    const languages = Object.fromEntries(
      Object.entries({ python, go, rust, java, c, cpp, csharp }).map(([name, grammar]) => [
        name,
        {
          ...grammar,
          libraryPath: grammar.libraryPath.replace(/\.asar([\\/])/, ".asar.unpacked$1"),
        },
      ]),
    );
    registerDynamicLanguage(languages);
    registered = true;
  }
  const language = LANGUAGE_EXTENSIONS[extname(path).toLowerCase()];
  if (!language) throw new Error("Unsupported indexed language.");
  const root = parse(language, content).root();
  const symbols: ParsedCode["symbols"] = [];
  const references: IndexedReference[] = [];
  const imports: string[] = [];
  const declarationIds = new Set<number>();
  const walk = (node: SgNode, caller: string | null) => {
    const kind = String(node.kind());
    let currentCaller = caller;
    if (definitions.has(kind)) {
      const name = named(node);
      if (name) {
        declarationIds.add(name.id());
        const range = node.range();
        symbols.push({
          name: name.text(),
          kind,
          line: range.start.line + 1,
          endLine: range.end.line + 1,
          signature: node.text().split(/\r?\n/)[0]?.slice(0, 180) ?? name.text(),
        });
        currentCaller = name.text();
      }
    }
    if (
      /^(?:import_statement|import_from_statement|import_declaration|use_declaration|preproc_include)$/.test(
        kind,
      )
    ) {
      const value = node.field("source") ?? node.field("module_name") ?? node.field("path");
      imports.push(value?.text().replace(/^["'<]|["'>]$/g, "") ?? node.text().slice(0, 200));
    }
    if (calls.has(kind)) {
      const target = node.field("function") ?? node.field("name") ?? node.field("type");
      if (target) {
        const range = target.range();
        const name =
          target
            .text()
            .split(/\.|::|->/)
            .at(-1) ?? target.text();
        references.push({
          name,
          line: range.start.line + 1,
          column: range.start.column + 1,
          kind: "call",
          caller: currentCaller,
          context: node.text().split(/\r?\n/)[0]?.slice(0, 180) ?? name,
        });
      }
    }
    if (node.isNamedLeaf() && identifiers.has(kind) && !declarationIds.has(node.id())) {
      const range = node.range();
      references.push({
        name: node.text(),
        line: range.start.line + 1,
        column: range.start.column + 1,
        kind: "reference",
        caller: currentCaller,
        context: node.parent()?.text().split(/\r?\n/)[0]?.slice(0, 180) ?? node.text(),
      });
    }
    for (const child of node.namedChildren()) walk(child, currentCaller);
  };
  walk(root, null);
  return {
    symbols: symbols.slice(0, 2000),
    imports: [...new Set(imports)],
    references: references.slice(0, 20000),
    language,
  };
}
