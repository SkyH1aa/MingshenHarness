import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { catalogMoveBefore } from "./model-catalog";

interface DropTarget {
  id: string;
  position: "before" | "after";
}
interface Press {
  id: string;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  axis: "x" | "y";
  target: DropTarget | null;
  timer: ReturnType<typeof setTimeout> | null;
  frame: number | null;
}
interface Options {
  providerIds: string[];
  onMove: (providerId: string, beforeProviderId: string | null) => Promise<void>;
  disabled: boolean;
}

const HOLD_MS = 340;
const SCROLL_MARGIN = 30;

export function useProviderOrderDrag<T extends HTMLElement = HTMLElement>(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const containerRef = useRef<T>(null);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const stop = () => {
    const current = press.current;
    press.current = null;
    cleanup.current();
    cleanup.current = () => {};
    if (current?.timer) clearTimeout(current.timer);
    if (current?.frame !== null && current?.frame !== undefined)
      cancelAnimationFrame(current.frame);
    if (current?.element.hasPointerCapture(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId);
    }
    setDraggingId(null);
    setDropTarget(null);
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => stopRef.current(), []);
  useEffect(() => {
    if (options.disabled) stopRef.current();
  }, [options.disabled]);

  const pointerDown = (id: string, event: PointerEvent<HTMLElement>) => {
    if (
      latest.current.disabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    stop();
    suppressClick.current = false;
    const container = containerRef.current;
    if (!container) return;
    const layout = getComputedStyle(container);
    const current: Press = {
      id,
      pointerId: event.pointerId,
      element: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      axis:
        ["flex", "inline-flex"].includes(layout.display) && layout.flexDirection.startsWith("row")
          ? "x"
          : "y",
      target: null,
      timer: null,
      frame: null,
    };
    press.current = current;

    const scrollParent = () => {
      let element: HTMLElement | null = container;
      while (element) {
        const style = getComputedStyle(element);
        const overflow = current.axis === "y" ? style.overflowY : style.overflowX;
        const scrollable =
          current.axis === "y"
            ? element.scrollHeight > element.clientHeight
            : element.scrollWidth > element.clientWidth;
        if (/(auto|scroll)/.test(overflow) && scrollable) return element;
        element = element.parentElement;
      }
      return null;
    };
    const updateTarget = () => {
      const rect = container.getBoundingClientRect();
      const viewport = scrollParent()?.getBoundingClientRect() ?? rect;
      const inside =
        current.x >= Math.max(0, viewport.left, rect.left) &&
        current.x <= Math.min(innerWidth, viewport.right, rect.right) &&
        current.y >= Math.max(0, viewport.top, rect.top) &&
        current.y <= Math.min(innerHeight, viewport.bottom, rect.bottom);
      const rows = [...container.querySelectorAll<HTMLElement>("[data-provider-order-id]")].filter(
        (row) => row.dataset.providerOrderId !== id,
      );
      let next: DropTarget | null = null;
      if (inside) {
        for (const row of rows) {
          const box = row.getBoundingClientRect();
          const before =
            current.axis === "y"
              ? current.y < box.top + box.height / 2
              : current.x < box.left + box.width / 2;
          if (before) {
            next = { id: row.dataset.providerOrderId ?? "", position: "before" };
            break;
          }
        }
        if (!next && rows.length) {
          next = { id: rows.at(-1)?.dataset.providerOrderId ?? "", position: "after" };
        }
      }
      if (next?.id !== current.target?.id || next?.position !== current.target?.position) {
        current.target = next;
        setDropTarget(next);
      }
    };
    const frame = () => {
      if (press.current !== current || !current.active) return;
      const scroller = scrollParent();
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const coordinate = current.axis === "y" ? current.y : current.x;
        const start = current.axis === "y" ? rect.top : rect.left;
        const end = current.axis === "y" ? rect.bottom : rect.right;
        const crossInside =
          current.axis === "y"
            ? current.x >= rect.left && current.x <= rect.right
            : current.y >= rect.top && current.y <= rect.bottom;
        const delta =
          coordinate < start + SCROLL_MARGIN && coordinate >= start
            ? -Math.ceil((start + SCROLL_MARGIN - coordinate) / 4)
            : coordinate > end - SCROLL_MARGIN && coordinate <= end
              ? Math.ceil((coordinate - end + SCROLL_MARGIN) / 4)
              : 0;
        if (crossInside && delta) {
          if (current.axis === "y") scroller.scrollTop += delta;
          else scroller.scrollLeft += delta;
        }
      }
      updateTarget();
      current.frame = requestAnimationFrame(frame);
    };
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== current.pointerId) return;
      current.x = next.clientX;
      current.y = next.clientY;
      if (!current.active) {
        if (Math.hypot(current.x - current.startX, current.y - current.startY) > 8) stop();
        return;
      }
      next.preventDefault();
      updateTarget();
    };
    const finish = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== current.pointerId) return;
      if (current.active) {
        next.preventDefault();
        current.x = next.clientX;
        current.y = next.clientY;
        updateTarget();
      }
      const before =
        current.active && current.target
          ? catalogMoveBefore(
              latest.current.providerIds,
              id,
              current.target.id,
              current.target.position,
            )
          : undefined;
      stop();
      if (before !== undefined && !latest.current.disabled) {
        void latest.current.onMove(id, before).catch(() => undefined);
      }
    };
    const cancel = () => stop();
    const key = (next: globalThis.KeyboardEvent) => {
      if (next.key !== "Escape") return;
      if (current.active) {
        next.preventDefault();
        next.stopImmediatePropagation();
      }
      stop();
    };
    const cancelPointer = (next: globalThis.PointerEvent) => {
      if (next.pointerId === current.pointerId) stop();
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancelPointer);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    cleanup.current = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancelPointer);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    };
    current.timer = setTimeout(() => {
      if (press.current !== current || latest.current.disabled || !current.element.isConnected)
        return;
      current.active = true;
      suppressClick.current = true;
      setDraggingId(id);
      try {
        current.element.setPointerCapture(current.pointerId);
      } catch {
        // Document listeners also retain a drag when capture is unavailable.
      }
      updateTarget();
      current.frame = requestAnimationFrame(frame);
    }, HOLD_MS);
  };

  return {
    containerRef,
    draggingId,
    rowProps: (id: string) => ({
      "data-provider-order-id": id,
      "data-dragging": draggingId === id ? "true" : undefined,
      "data-drop-position": dropTarget?.id === id ? dropTarget.position : undefined,
      onPointerDown: (event: PointerEvent<HTMLElement>) => pointerDown(id, event),
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
      onDragStart: (event: DragEvent<HTMLElement>) => event.preventDefault(),
    }),
    handleProps: (id: string) => ({
      "aria-disabled": options.disabled,
      "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight",
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (
          !event.altKey ||
          !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (latest.current.disabled) return;
        const ids = latest.current.providerIds;
        const index = ids.indexOf(id);
        const direction = ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1;
        const target = ids[index + direction];
        if (!target) return;
        const before = catalogMoveBefore(ids, id, target, direction < 0 ? "before" : "after");
        if (before !== undefined) void latest.current.onMove(id, before).catch(() => undefined);
      },
    }),
  };
}
