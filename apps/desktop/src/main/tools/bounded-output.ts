export const MAX_RECOVERABLE_CHARS = 4_000_000;

export function safePrefix(text: string, limit: number): string {
  let end = Math.min(text.length, limit);
  if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "") && /[\uDC00-\uDFFF]/.test(text[end] ?? "")) end--;
  return text.slice(0, end);
}

export class BoundedOutput {
  private head = "";
  private tail = "";
  private total = 0;
  constructor(private readonly limit = MAX_RECOVERABLE_CHARS) {}
  append(chunk: string): void {
    this.total += chunk.length;
    if (this.head.length < this.limit / 2) {
      const prefix = safePrefix(chunk, Math.floor(this.limit / 2) - this.head.length);
      this.head += prefix;
      chunk = chunk.slice(prefix.length);
    }
    this.tail += chunk;
    const remaining = this.limit - this.head.length;
    if (this.tail.length > remaining) {
      let start = this.tail.length - remaining;
      if (
        start > 0 &&
        /[\uDC00-\uDFFF]/.test(this.tail[start] ?? "") &&
        /[\uD800-\uDBFF]/.test(this.tail[start - 1] ?? "")
      )
        start--;
      this.tail = this.tail.slice(start);
    }
  }
  text(): string {
    const omitted = this.total - this.head.length - this.tail.length;
    return (
      this.head +
      (omitted > 0
        ? `\n[OUTPUT_CAPTURE_LIMIT: ${omitted} characters omitted between retained head and tail]\n`
        : "") +
      this.tail
    );
  }
}
