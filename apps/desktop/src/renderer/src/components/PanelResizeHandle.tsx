import { useRef } from "react";
import { useLocale } from "../i18n";

export function PanelResizeHandle({
  side,
  value,
  min,
  max,
  onChange,
}: {
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  const en = useLocale() === "en";
  const drag = useRef<{ x: number; value: number; next: number } | null>(null);
  return (
    // biome-ignore lint/a11y/useSemanticElements: Interactive splitter implements the WAI-ARIA window splitter pattern.
    <div
      className={`panel-resize panel-resize--${side}`}
      role="separator"
      tabIndex={0}
      aria-label={en ? "Resize panel" : "调整面板宽度"}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, value, next: value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        start.next = Math.round(
          Math.min(
            max,
            Math.max(min, start.value + (event.clientX - start.x) * (side === "left" ? 1 : -1)),
          ),
        );
        event.currentTarget.parentElement?.style.setProperty(
          side === "left" ? "--sidebar-width" : "--inspector-width",
          `${start.next}px`,
        );
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        onChange(drag.current.next);
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
        onChange(value);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        onChange(
          event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : Math.min(
                  max,
                  Math.max(
                    min,
                    value + (event.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1),
                  ),
                ),
        );
      }}
    />
  );
}
