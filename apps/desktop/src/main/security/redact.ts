export function redactSecrets(text: string, secrets: string[] = []): string {
  let output = text;
  for (const secret of secrets.filter((value) => value.length >= 4))
    output = output.split(secret).join("[REDACTED]");
  return output
    .replace(/(Bearer\s+)[^\s"'<>]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|authorization|password)["']?\s*[:=]\s*["']?)[^\s,"'<>}]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)\b/g,
      "[REDACTED]",
    );
}
