import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";

interface PanelDrag {
  pointerId: number;
  coordinate: number;
  value: number;
  next: number;
  property: string;
  previousValue: string;
  previousPriority: string;
  previousAriaValue: string | null;
  parent: HTMLElement;
  handle: HTMLDivElement;
}

function restorePanelDrag(drag: PanelDrag) {
  if (drag.previousValue) {
    drag.parent.style.setProperty(drag.property, drag.previousValue, drag.previousPriority);
  } else {
    drag.parent.style.removeProperty(drag.property);
  }
  if (drag.previousAriaValue === null) drag.handle.removeAttribute("aria-valuenow");
  else drag.handle.setAttribute("aria-valuenow", drag.previousAriaValue);
}

export function PanelResizeHandle({
  side,
  value,
  min,
  max,
  onChange,
  onReset,
}: {
  side: "left" | "right" | "bottom";
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  onReset?(): void;
}) {
  const en = useLocale() === "en";
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<PanelDrag | null>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const bottom = side === "bottom";
  const label = bottom
    ? en
      ? "Resize task panel"
      : "调整任务区高度"
    : en
      ? "Resize panel"
      : "调整面板宽度";
  const description = bottom
    ? en
      ? `Use Up and Down to adjust, Home or End for minimum or maximum${onReset ? ", and Enter to restore the default" : ""}.`
      : `使用上、下方向键调整高度，Home 和 End 分别设为最小和最大${onReset ? "，Enter 恢复默认高度" : ""}。`
    : undefined;
  const clamp = (size: number) => Math.round(Math.min(max, Math.max(min, size)));
  const currentSize = (element: HTMLDivElement) => {
    if (!bottom) return value;
    const height = element.parentElement
      ?.querySelector<HTMLElement>(".task-host--docked")
      ?.getBoundingClientRect().height;
    return height && height > 0 ? clamp(height) : clamp(value);
  };
  const cancelDrag = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    restorePanelDrag(active);
    if (active.handle.hasPointerCapture(active.pointerId)) {
      active.handle.releasePointerCapture(active.pointerId);
    }
  }, []);
  const resetPanel = (element: HTMLDivElement) => {
    if (!bottom || !onReset) return;
    element.parentElement?.style.removeProperty("--orbit-task-height-override");
    onReset();
  };
  useEffect(() => () => cancelDrag(), [cancelDrag]);
  useEffect(() => {
    if (!bottom || !handle.current || typeof ResizeObserver === "undefined") return;
    const target = handle.current.parentElement?.querySelector<HTMLElement>(".task-host--docked");
    if (!target) return;
    const measure = () => {
      const height = target.getBoundingClientRect().height;
      if (height > 0) setMeasuredHeight(Math.round(height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [bottom]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: Interactive splitter implements the WAI-ARIA window splitter pattern.
    <div
      ref={handle}
      className={`panel-resize panel-resize--${side}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-description={description}
      title={description ? `${label}\n${description}` : label}
      aria-orientation={bottom ? "horizontal" : "vertical"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={bottom ? clamp(measuredHeight ?? value) : value}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const parent = event.currentTarget.parentElement;
        if (!parent) return;
        const initial = currentSize(event.currentTarget);
        const property = bottom
          ? "--orbit-task-height-override"
          : side === "left"
            ? "--sidebar-width"
            : "--inspector-width";
        drag.current = {
          pointerId: event.pointerId,
          coordinate: bottom ? event.clientY : event.clientX,
          value: initial,
          next: initial,
          property,
          previousValue: parent.style.getPropertyValue(property),
          previousPriority: parent.style.getPropertyPriority(property),
          previousAriaValue: event.currentTarget.getAttribute("aria-valuenow"),
          parent,
          handle: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        const coordinate = bottom ? event.clientY : event.clientX;
        const next = clamp(
          start.value + (coordinate - start.coordinate) * (side === "left" ? 1 : -1),
        );
        if (start.next === next) return;
        start.next = next;
        if (next === start.value) restorePanelDrag(start);
        else {
          start.parent.style.setProperty(start.property, `${next}px`);
          start.handle.setAttribute("aria-valuenow", String(next));
        }
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        drag.current = null;
        if (start.next === start.value) restorePanelDrag(start);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (start.next !== start.value) onChange(start.next);
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId === event.pointerId) cancelDrag();
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointerId === event.pointerId) cancelDrag();
      }}
      onDoubleClick={(event) => {
        if (!bottom || !onReset) return;
        cancelDrag();
        resetPanel(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          cancelDrag();
          return;
        }
        if (drag.current) return;
        if (bottom && event.key === "Enter" && onReset) {
          event.preventDefault();
          resetPanel(event.currentTarget);
          return;
        }
        const directions = bottom ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
        if (![...directions, "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const initial = currentSize(event.currentTarget);
        onChange(
          event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : clamp(
                  initial +
                    (bottom
                      ? event.key === "ArrowUp"
                        ? 16
                        : -16
                      : (event.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1)),
                ),
        );
      }}
    />
  );
}
