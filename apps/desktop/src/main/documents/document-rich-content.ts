import { Math as OfficeMath } from "docx";
import { latexToMath } from "docx/math";
import katex from "katex";
import { Marked, type TokenizerAndRendererExtension } from "marked";

export function escapeDocumentHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function equationSource(source: string): string {
  if (source.length > 10000) throw new Error("EQUATION_TOO_LARGE: maximum 10000 characters.");
  let depth = 0;
  for (const char of source) {
    if (char === "{" && ++depth > 64) throw new Error("EQUATION_TOO_DEEP: maximum nesting 64.");
    if (char === "}") depth--;
  }
  const text = source.trim();
  for (const [start, end] of [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ] as const) {
    if (text.startsWith(start) && text.endsWith(end))
      return text.slice(start.length, -end.length).trim();
  }
  return text;
}

export function nativeEquation(source: string): OfficeMath {
  try {
    return new OfficeMath({ children: latexToMath(equationSource(source)) });
  } catch (error) {
    throw new Error(
      `NATIVE_EQUATION_UNSUPPORTED: ${String(error)}. Use supported LaTeX; no text/image fallback was written.`,
    );
  }
}

export function equationHtml(
  source: string,
  display: boolean,
  format: "docx" | "pdf",
  align: "left" | "center" | "right" | "justify" = "center",
  paragraphStyle = "",
): string {
  const latex = equationSource(source);
  if (format === "docx") {
    nativeEquation(latex);
    const tag = display ? "div" : "span";
    return `<${tag} data-latex="${escapeDocumentHtml(latex)}">${escapeDocumentHtml(latex)}</${tag}>`;
  }
  const html = katex.renderToString(latex, {
    displayMode: display,
    output: "mathml",
    throwOnError: true,
    trust: false,
    strict: "error",
    maxExpand: 1000,
    maxSize: 20,
  });
  return display
    ? `<div class="document-equation" style="text-align:${align}${paragraphStyle ? `;${escapeDocumentHtml(paragraphStyle)}` : ""}">${html}</div>`
    : html;
}

export function documentMarkdown(source: string, format: "docx" | "pdf"): string {
  if (source.length > 100000)
    throw new Error("MARKDOWN_TOO_LARGE: maximum 100000 characters per block.");
  let mathCount = 0;
  let tokenCount = 0;
  const math = (display: boolean): TokenizerAndRendererExtension => ({
    name: display ? "documentBlockMath" : "documentInlineMath",
    level: display ? "block" : "inline",
    start(text) {
      return (display ? /(?:^|\n)[ \t]{0,3}(?:\$\$|\\\[)/ : /\$|\\\(/).exec(text)?.index;
    },
    tokenizer(text) {
      const match = display
        ? (/^[ \t]{0,3}\$\$[ \t]*\n?([\s\S]+?)\$\$[ \t]*(?:\r?\n|$)/.exec(text) ??
          /^[ \t]{0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\r?\n|$)/.exec(text))
        : (/^\\\(([^\n]+?)\\\)/.exec(text) ??
          /^\$(?!\$)([^\s$\n](?:[^$\n]*?[^\s$\n])?)(?<!\\)\$(?!\d)/.exec(text));
      if (!match) return undefined;
      if (++mathCount > 128) throw new Error("MARKDOWN_TOO_MANY_EQUATIONS: maximum 128 per block.");
      return {
        type: display ? "documentBlockMath" : "documentInlineMath",
        raw: match[0],
        text: match[1],
      };
    },
    renderer(token) {
      return equationHtml(String(token.text), display, format);
    },
  });
  const parser = new Marked({
    gfm: true,
    extensions: [math(true), math(false)],
    walkTokens() {
      if (++tokenCount > 5000) throw new Error("MARKDOWN_TOO_COMPLEX: maximum 5000 tokens.");
    },
    renderer: {
      html({ text }) {
        return escapeDocumentHtml(text);
      },
      image() {
        throw new Error(
          "MARKDOWN_IMAGE: use a structured image block with an approved local PNG/JPEG path.",
        );
      },
      link({ href, tokens }) {
        if (!/^(?:https?:|mailto:)/i.test(href))
          throw new Error("MARKDOWN_LINK: only HTTP(S) and mailto links are supported.");
        return `<a href="${escapeDocumentHtml(href)}">${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  return parser.parse(source, { async: false });
}
