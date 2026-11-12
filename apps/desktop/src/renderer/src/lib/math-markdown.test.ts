import { Marked } from "marked";
import { describe, expect, it } from "vitest";
import { blockMath, inlineMath } from "./math-markdown";

const markdown = new Marked({ gfm: true, breaks: true, extensions: [blockMath, inlineMath] });
const parse = (value: string) => markdown.parse(value, { async: false });

describe("Markdown mathematics", () => {
  it.each([
    "$\n\\dim_{\\mathrm H} K=3.\n$",
    "Preceding paragraph.\n\n$\n\n\\dim_{\\mathrm H} K=3.\n\n$\n\nFollowing paragraph.",
    "$$\n\\dim_{\\mathrm H} K=3.\n$$",
    "\\[\\dim_{\\mathrm H} K=3.\\]",
    "\\\\[\\dim_{\\mathrm H} K=3.\\\\]",
  ])("renders block delimiters without leaking TeX: %s", (source) => {
    const result = parse(source);
    expect(result).toContain('class="math-block"');
    expect(result).toContain("katex-display");
    expect(result).not.toContain("katex-error");
  });
  it.each(["$x^2$", "\\(x^2\\)", "\\\\(x^2\\\\)"])("renders inline mathematics: %s", (source) => {
    expect(parse(source)).toContain('class="math-inline"');
  });
  it("preserves code, currency, escaped dollars and matrix row separators", () => {
    for (const source of [
      "`\\(literal\\)`",
      "```tex\n\\[x^2\\]\n```",
      "Prices are $5 and $10.",
      "Escaped \\$x\\$.",
      "Prices are $5 and $10. Escaped \\$x\\$.",
    ])
      expect(parse(source)).not.toContain('class="math-');
    expect(parse("$$\\begin{matrix}a&b\\\\c&d\\end{matrix}$$")).not.toContain("katex-error");
  });
});
