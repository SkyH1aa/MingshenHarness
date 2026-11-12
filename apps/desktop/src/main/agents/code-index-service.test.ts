import { describe, expect, it, vi } from "vitest";
import { CodeIndexService, type IndexSnapshot } from "./code-index-service";

describe("incremental local code index", () => {
  it("indexes real AST symbols/import edges, reuses unchanged files and updates changed/deleted symbols", async () => {
    const files = new Map([
      [
        "a.ts",
        { version: "1", text: "export function add(a: number, b: number) { return a + b; }" },
      ],
      [
        "b.ts",
        { version: "1", text: "import { add } from './a'; export const total = add(1, 2);" },
      ],
    ]);
    let saved: IndexSnapshot | null = null;
    const read = vi.fn(async (path: string) => files.get(path)?.text ?? "");
    const io = {
      list: async () => [...files].map(([path, file]) => ({ path, fingerprint: file.version })),
      read,
      save: (value: IndexSnapshot) => {
        saved = value;
      },
      load: () => saved,
    };
    const index = new CodeIndexService();
    const signal = new AbortController().signal;
    const symbols = JSON.parse(await index.query("root", { query: "add" }, io, signal));
    expect(symbols.symbols).toEqual([
      expect.objectContaining({ path: "a.ts", name: "add", line: 1, kind: "FunctionDeclaration" }),
    ]);
    const graph = JSON.parse(await index.query("root", { operation: "graph" }, io, signal));
    expect(graph.edges).toContainEqual({ from: "b.ts", to: "a.ts", resolved: true });
    expect(graph.reparsed).toBe(0);
    expect(read).toHaveBeenCalledTimes(2);
    files.set("a.ts", { version: "2", text: "export class Replacement {}" });
    files.delete("b.ts");
    const changed = JSON.parse(await index.query("root", {}, io, signal));
    expect(changed.symbols.map((s: { name: string }) => s.name)).toEqual(["Replacement"]);
    expect(changed.reparsed).toBe(1);
    await new CodeIndexService().query("root", {}, io, signal);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("does not persist a cancelled partial refresh", async () => {
    const controller = new AbortController();
    const save = vi.fn();
    await expect(
      new CodeIndexService().query(
        "root",
        {},
        {
          list: async () => [{ path: "a.ts", fingerprint: "1" }],
          read: async () => {
            controller.abort();
            return "const a=1;";
          },
          save,
        },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
