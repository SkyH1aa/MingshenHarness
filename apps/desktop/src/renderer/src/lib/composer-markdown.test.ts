import { describe, expect, it } from "vitest";
import { COMPOSER_PREVIEW_LIMIT, composerMarkdown } from "./composer-markdown";

describe("composer Markdown", () => {
  it("renders mixed Markdown, tables and all supported math delimiters", () => {
    const source = [
      "## 公式",
      "**加粗**，*斜体*，`const x = 1`。",
      "- first",
      "- second",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "$x^2$ and \\(y^2\\)",
      "",
      "$$\\frac{a}{b}$$",
      "\\[\\sum_{i=1}^n i\\]",
    ].join("\n");
    const html = composerMarkdown(source);
    expect(html).toContain("<h2>");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<table>");
    expect(html?.match(/class="math-inline"/g)).toHaveLength(2);
    expect(html?.match(/class="math-block"/g)).toHaveLength(2);
    expect(html).not.toContain("katex-error");
  });
  it("keeps code and prices literal and handles incomplete or invalid math", () => {
    const html = composerMarkdown(
      "`$x^2$`\n\n```tex\n\\[x^2\\]\n```\n\nPrices $5 and $10. \\$x\\$\n\n$unfinished",
    );
    expect(html).not.toContain('class="math-');
    expect(html).toContain("$unfinished");
    expect(composerMarkdown("$\\frac{1}{$")).toContain("katex-error");
  });
  it("keeps pasted HTML and media inert before insertion into the document", () => {
    const html = composerMarkdown(
      '<img src="https://invalid.test/tracker" onerror="alert(1)">\n\n' +
        "<style>body { display:none }</style>\n\n" +
        "![diagram](https://invalid.test/image) [site](https://invalid.test) " +
        "[local](file:///C:/test.txt) [bad](javascript:alert(1)) <https://invalid.test>",
    );
    expect(html).not.toMatch(/<(?:img|style|script|iframe|video|audio)\b/);
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;img");
    expect(html).toContain("diagram");
    expect(html).toContain("site");
  });
  it("bounds text, syntax and formula work", () => {
    const text = "x".repeat(COMPOSER_PREVIEW_LIMIT);
    expect(composerMarkdown(text)).toContain(text);
    expect(composerMarkdown(`${text}x`)).toBeNull();
    expect(composerMarkdown("$x$ ".repeat(129))).toBeNull();
    expect(composerMarkdown("- item\n".repeat(600))).toBeNull();
  });
});
