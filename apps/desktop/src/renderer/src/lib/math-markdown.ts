import katex from "katex";
import type { TokenizerAndRendererExtension } from "marked";

function renderMath(value: string, displayMode: boolean): string {
  return katex.renderToString(value.trim(), {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false,
    output: "html",
  });
}

export const blockMath: TokenizerAndRendererExtension = {
  name: "blockMath",
  level: "block",
  start(source) {
    return /(?:^|\n)[ \t]{0,3}(?:\$\$|\\{1,2}\[|\$(?=[ \t]*\r?\n))/.exec(source)?.index;
  },
  tokenizer(source) {
    const match =
      /^[ \t]{0,3}\$\$[ \t]*\n?([\s\S]+?)\$\$[ \t]*(?:\r?\n|$)/.exec(source) ??
      /^[ \t]{0,3}\\{1,2}\[([\s\S]+?)\\{1,2}\][ \t]*(?:\r?\n|$)/.exec(source) ??
      /^[ \t]{0,3}\$[ \t]*\r?\n([\s\S]+?)\r?\n[ \t]{0,3}\$[ \t]*(?:\r?\n|$)/.exec(source);
    if (!match) return undefined;
    return { type: "blockMath", raw: match[0], text: match[1] ?? "" };
  },
  renderer(token) {
    return `<div class="math-block">${renderMath(String(token.text ?? ""), true)}</div>`;
  },
};

export const inlineMath: TokenizerAndRendererExtension = {
  name: "inlineMath",
  level: "inline",
  start(source) {
    return /\$|\\{1,2}\(/.exec(source)?.index;
  },
  tokenizer(source) {
    const match =
      /^\\{1,2}\(([^\n]+?)\\{1,2}\)/.exec(source) ??
      /^\$(?!\$)([^\s$\n](?:[^$\n]*?[^\s$\n])?)(?<!\\)\$(?!\d)/.exec(source);
    if (!match) return undefined;
    return { type: "inlineMath", raw: match[0], text: match[1] ?? "" };
  },
  renderer(token) {
    return `<span class="math-inline">${renderMath(String(token.text ?? ""), false)}</span>`;
  },
};
