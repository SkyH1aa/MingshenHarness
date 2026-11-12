import { type RefObject, useLayoutEffect, useState } from "react";
import { floatingPanelPosition, type PanelPosition } from "./floating-panel";

export function useFloatingPanel(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  options: {
    width?: number;
    minWidth?: number;
    maxHeight: number;
    preferAbove?: boolean;
    anchorComposer?: boolean;
  },
) {
  const [position, setPosition] = useState<PanelPosition>({
    top: 12,
    left: 12,
    width: 320,
    maxHeight: 0,
  });
  const { width, minWidth, maxHeight, preferAbove, anchorComposer } = options;
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const element = trigger.current;
      if (!element) return;
      const anchor = anchorComposer ? (element.closest(".composer") ?? element) : element;
      setPosition(
        floatingPanelPosition(
          anchor.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight },
          {
            ...(width === undefined ? {} : { width }),
            ...(minWidth === undefined ? {} : { minWidth }),
            maxHeight,
            ...(preferAbove === undefined ? {} : { preferAbove }),
          },
        ),
      );
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      place();
    };
    place();
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current.closest(".composer") ?? trigger.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open, trigger, panel, width, minWidth, maxHeight, preferAbove, anchorComposer]);
  return { ...position, position: "fixed" as const };
}
