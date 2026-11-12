import { describe, expect, it } from "vitest";
import { CodeIndexService } from "./code-index-service";

describe("bundled multi-language syntax graph", () => {
  it.each([
    ["fixture.py", "def add(a, b):\n return a+b\ndef work():\n return add(1, 2)"],
    ["fixture.go", "package x\nfunc add(a int) int { return a }; func work(){add(1)}"],
    ["fixture.rs", "fn add(a:i32)->i32{a} fn work(){add(1);}"],
    ["fixture.java", "class X { int add(int a){return a;} int work(){return add(1);} }"],
    ["fixture.c", "int add(int a){return a;} int work(){return add(1);}"],
    ["fixture.cpp", "class X {int add(int a){return a;} int work(){return add(1);}};"],
    ["fixture.cs", "class X { int add(int a){return a;} int work(){return add(1);} }"],
    [
      "fixture.ts",
      "export function add(a:number){return a;} export function work(){return add(1);}",
    ],
  ])("finds definitions and call evidence in %s", async (path, source) => {
    const index = new CodeIndexService(),
      io = { list: async () => [{ path, fingerprint: "1" }], read: async () => source },
      signal = new AbortController().signal;
    const definitions = JSON.parse(
      await index.query(path, { operation: "definitions", query: "add" }, io, signal),
    );
    expect(definitions.symbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ path, name: "add" })]),
    );
    const callers = JSON.parse(
      await index.query(path, { operation: "callers", query: "add" }, io, signal),
    );
    expect(callers.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "add", kind: "call", caller: "work" }),
      ]),
    );
    const refs = JSON.parse(
      await index.query(path, { operation: "references", query: "add" }, io, signal),
    );
    expect(refs.references.length).toBeGreaterThan(0);
    const callees = JSON.parse(
      await index.query(path, { operation: "callees", query: "work" }, io, signal),
    );
    expect(callees.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "add", caller: "work", kind: "call" }),
      ]),
    );
    const self = JSON.parse(
      await index.query(path, { operation: "callees", query: "add" }, io, signal),
    );
    expect(self.references).toHaveLength(0);
  });
});
