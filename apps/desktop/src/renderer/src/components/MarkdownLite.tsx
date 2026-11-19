import DOMPurify from "dompurify";
import { Marked, type TokenizerAndRendererExtension } from "marked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr } from "../i18n/index";
import { blockMath, inlineMath } from "../lib/math-markdown";
import { CopyButton } from "./CopyButton";

interface MarkdownLiteProps {
  text: string;
  workspacePath?: string | null;
  onOpenError?: (message: string) => void;
  onOpenFile?: (path: string) => void;
  documentNavigation?: boolean;
  allowLocalFiles?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const localFilePath: TokenizerAndRendererExtension = {
  name: "localFilePath",
  level: "inline",
  start(source) {
    const match = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|file:\/\/\/)/.exec(source);
    return match?.index;
  },
  tokenizer(source) {
    const quoted = /^(["'])((?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|file:\/\/\/)[^"'\r\n]+)\1/.exec(
      source,
    );
    const rawPath =
      quoted?.[2] ??
      /^((?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|file:\/\/\/)[^\r\n<>"|?*`]+?)(?=[\s，。；;、）)\]}>]|$)/.exec(
        source,
      )?.[1];
    if (!rawPath) {
      return undefined;
    }
    return {
      type: "localFilePath",
      raw: quoted?.[0] ?? rawPath,
      text: rawPath.replace(/[.,，。；;]+$/, ""),
    };
  },
  renderer(token) {
    const path = String(token.text ?? "");
    return `<a class="file-link" href="#" data-mingshen-file="${escapeHtml(
      path,
    )}"><code>${escapeHtml(path)}</code></a>`;
  },
};

const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({
  extensions: [blockMath, inlineMath, localFilePath],
  renderer: {
    codespan({ text }) {
      if (
        /^(?:[A-Za-z]:[\\/]|\\\\|file:\/\/\/)/.test(text) ||
        /^(?:[\w .@-]+[\\/])*[\w .@-]+\.[A-Za-z0-9]{1,16}$/.test(text)
      ) {
        return `<a class="file-link" href="#" data-mingshen-file="${escapeHtml(
          text,
        )}"><code>${escapeHtml(text)}</code></a>`;
      }
      return `<code>${escapeHtml(text)}</code>`;
    },
  },
});

function filePathFromHref(href: string): string | null {
  if (/^(?:[A-Za-z]:[\\/]|\\\\|file:\/\/\/)/.test(href)) {
    return href.replace(/^file:\/\/\//i, "");
  }
  if (
    href &&
    !/^[a-z][a-z\d+.-]*:|^#|^\/\//i.test(href) &&
    /[\\/]|\.[a-z\d]{1,16}(?:[?#]|$)/i.test(href)
  ) {
    try {
      return decodeURIComponent(href.split(/[?#]/)[0] ?? href);
    } catch {
      return href;
    }
  }
  return null;
}

export function MarkdownLite({
  text,
  workspacePath,
  onOpenError,
  onOpenFile,
  documentNavigation = false,
  allowLocalFiles = true,
}: MarkdownLiteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [codeTargets, setCodeTargets] = useState<{ element: HTMLElement; text: string }[]>([]);
  const html = useMemo(() => {
    const generated = markdown.parse(text, { async: false });
    const clean = DOMPurify.sanitize(generated, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["data-mingshen-file"],
    });
    if (!documentNavigation && !clean.includes("<pre")) return clean;
    const template = document.createElement("template");
    template.innerHTML = clean;
    for (const pre of template.content.querySelectorAll("pre")) {
      const code = pre.querySelector(":scope > code");
      if (!code) continue;
      const block = document.createElement("div");
      block.className = "markdown-code-block";
      const toolbar = document.createElement("div");
      toolbar.className = "markdown-code-toolbar";
      const language = document.createElement("span");
      language.textContent = /(?:^|\s)language-([^\s]+)/.exec(code.className)?.[1] ?? "";
      const slot = document.createElement("span");
      slot.className = "markdown-code-copy-slot";
      toolbar.append(language, slot);
      pre.replaceWith(block);
      block.append(toolbar, pre);
    }
    const used = new Map<string, number>();
    for (const heading of documentNavigation
      ? template.content.querySelectorAll("h1,h2,h3,h4,h5,h6")
      : []) {
      const base = (heading.textContent || "section")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-");
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      heading.id = count ? `${base}-${count}` : base;
    }
    return template.innerHTML;
  }, [text, documentNavigation]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Rebind portals after sanitized HTML replaces the code-block DOM.
  useLayoutEffect(() => {
    setCodeTargets(
      Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(".markdown-code-copy-slot") ?? [],
      ).map((element) => ({
        element,
        text: element.parentElement?.nextElementSibling?.querySelector("code")?.textContent ?? "",
      })),
    );
  }, [html]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const openTarget = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a");
      if (!target) {
        return;
      }
      const href = target.getAttribute("href") ?? "";
      if (documentNavigation && href.startsWith("#")) {
        event.preventDefault();
        let anchor = href.slice(1);
        try {
          anchor = decodeURIComponent(anchor);
        } catch {
          return;
        }
        [...container.querySelectorAll<HTMLElement>("[id]")]
          .find((element) => element.id === anchor)
          ?.scrollIntoView({ block: "start" });
        return;
      }
      const filePath = target.dataset.mingshenFile || filePathFromHref(href);
      if (filePath) {
        event.preventDefault();
        if (!allowLocalFiles) {
          onOpenError?.(tr("当前模式不支持打开本地文件。"));
          return;
        }
        if (onOpenFile) {
          onOpenFile(filePath);
          return;
        }
        void window.mingshen.openLocalPath(filePath, workspacePath).catch((error) => {
          onOpenError?.(error instanceof Error ? error.message : String(error));
        });
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        void window.mingshen.openExternalUrl(href).catch((error) => {
          onOpenError?.(error instanceof Error ? error.message : String(error));
        });
      }
    };
    container.addEventListener("click", openTarget);
    return () => container.removeEventListener("click", openTarget);
  }, [allowLocalFiles, onOpenError, onOpenFile, workspacePath, documentNavigation]);

  return (
    <>
      <div
        ref={containerRef}
        className="rich-text markdown-body"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Marked output is sanitized by DOMPurify.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {codeTargets.map(({ element, text: code }, index) =>
        createPortal(<CopyButton text={code} label={tr("复制代码")} />, element, String(index)),
      )}
    </>
  );
}
