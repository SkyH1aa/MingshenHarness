import { Check, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tr } from "../i18n/index";

export function CopyButton({
  text,
  label,
  className = "message-action",
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copying" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: A changed copy payload invalidates feedback and pending clipboard results.
  useEffect(() => {
    setState("idle");
    setError(null);
    return () => {
      attempt.current += 1;
      if (reset.current) clearTimeout(reset.current);
    };
  }, [text]);

  const copy = async () => {
    const current = ++attempt.current;
    if (reset.current) clearTimeout(reset.current);
    setState("copying");
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      if (current !== attempt.current) return;
      setState("copied");
      reset.current = setTimeout(() => setState("idle"), 1400);
    } catch (cause) {
      if (current !== attempt.current) return;
      setState("idle");
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <span className="copy-control">
      <button
        className={className}
        type="button"
        aria-label={label}
        title={state === "copied" ? tr("已复制") : label}
        disabled={!text || state === "copying"}
        onClick={() => void copy()}
      >
        {state === "copying" ? (
          <LoaderCircle className="spin" aria-hidden="true" size={14} />
        ) : state === "copied" ? (
          <Check aria-hidden="true" size={14} />
        ) : (
          <Copy aria-hidden="true" size={14} />
        )}
      </button>
      <span className="visually-hidden" role="status">
        {state === "copied" ? tr("已复制") : ""}
      </span>
      {error ? (
        <span className="copy-control__error" role="alert" title={error}>
          {tr("复制失败，请重试")}
        </span>
      ) : null}
    </span>
  );
}
