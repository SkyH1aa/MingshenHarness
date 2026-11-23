const MAX_PROMPT_DECLARATION_DEPTH = 12;

export interface PromptDeclarationIssue {
  path: string;
  message: string;
}

export type BeforeModelRequestPromptPosition = "before" | "after";
export type BeforeModelRequestPromptFormat = "context" | "plain";

export interface BeforeModelRequestPrompt {
  text: string;
  position: BeforeModelRequestPromptPosition;
  format: BeforeModelRequestPromptFormat;
}

export function parseBeforeModelRequestPrompts(value: unknown): {
  texts: string[];
  prompts: BeforeModelRequestPrompt[];
  errors: PromptDeclarationIssue[];
} {
  const texts: string[] = [];
  const prompts: BeforeModelRequestPrompt[] = [];
  const errors: PromptDeclarationIssue[] = [];
  const seen = new WeakSet<object>();
  const walk = (candidate: unknown, path: string, depth: number): void => {
    if (!candidate || typeof candidate !== "object") return;
    if (depth > MAX_PROMPT_DECLARATION_DEPTH) {
      errors.push({ path, message: "BeforeModelRequest prompt declaration is nested too deeply." });
      return;
    }
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const [index, entry] of candidate.entries()) walk(entry, `${path}[${index}]`, depth + 1);
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (record.type === "prompt") {
      let valid = true;
      if (typeof record.text !== "string" || !record.text.replaceAll("\0", "").trim()) {
        errors.push({
          path: `${path}.text`,
          message: 'BeforeModelRequest type:"prompt" requires a non-empty string text field.',
        });
        valid = false;
      }
      const position = record.position === undefined ? "before" : record.position;
      if (position !== "before" && position !== "after") {
        errors.push({
          path: `${path}.position`,
          message:
            'BeforeModelRequest type:"prompt" position must be either "before" or "after" when provided.',
        });
        valid = false;
      }
      const format = record.format === undefined ? "context" : record.format;
      if (format !== "context" && format !== "plain") {
        errors.push({
          path: `${path}.format`,
          message:
            'BeforeModelRequest type:"prompt" format must be either "context" or "plain" when provided.',
        });
        valid = false;
      }
      if (valid) {
        const text = (record.text as string).trim();
        const prompt = {
          text,
          position: position as BeforeModelRequestPromptPosition,
          format: format as BeforeModelRequestPromptFormat,
        };
        texts.push(text);
        prompts.push(prompt);
      }
      return;
    }
    // Command/MCP inputs may contain prompt-like data; never treat those as hooks.
    if (record.type !== undefined) return;
    for (const [key, entry] of Object.entries(record)) walk(entry, `${path}.${key}`, depth + 1);
  };
  walk(value, "hooks.BeforeModelRequest", 0);
  return { texts, prompts, errors };
}
