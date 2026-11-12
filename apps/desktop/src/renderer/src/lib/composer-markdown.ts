import { Marked } from "marked";
import { blockMath, inlineMath } from "./math-markdown";

export const COMPOSER_PREVIEW_LIMIT = 30_000;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  extensions: [blockMath, inlineMath],
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ tokens }) {
      return this.parser.parseInline(tokens);
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

// Bound work before KaTeX renders. The original draft is never transformed.
export function composerMarkdown(source: string): string | null {
  if (source.length > COMPOSER_PREVIEW_LIMIT) return null;
  try {
    const tokens = markdown.lexer(source);
    let count = 0;
    let formulas = 0;
    markdown.walkTokens(tokens, (token) => {
      count++;
      if (token.type === "blockMath" || token.type === "inlineMath") formulas++;
    });
    if (count > 1024 || formulas > 128) return null;
    return markdown.parser(tokens);
  } catch {
    return null;
  }
}
