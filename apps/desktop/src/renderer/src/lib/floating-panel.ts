export interface PanelPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function floatingPanelPosition(
  anchor: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
  options: { width?: number; minWidth?: number; maxHeight: number; preferAbove?: boolean },
): PanelPosition {
  const margin = 12;
  const gap = 6;
  const width = Math.max(
    0,
    Math.min(
      options.width ?? Math.max(anchor.width, options.minWidth ?? 0),
      viewport.width - margin * 2,
    ),
  );
  const below = Math.max(0, viewport.height - Math.max(margin, anchor.bottom + gap) - margin);
  const above = Math.max(0, Math.min(viewport.height - margin, anchor.top - gap) - margin);
  const useAbove = options.preferAbove
    ? above >= Math.min(options.maxHeight, 220) || above > below
    : below < Math.min(options.maxHeight, 220) && above > below;
  const maxHeight = Math.min(options.maxHeight, useAbove ? above : below);
  return {
    ...(useAbove
      ? {
          bottom: Math.max(
            margin,
            viewport.height - Math.min(anchor.top - gap, viewport.height - margin),
          ),
        }
      : {
          top: Math.max(
            margin,
            Math.min(anchor.bottom + gap, viewport.height - margin - maxHeight),
          ),
        }),
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    width,
    maxHeight,
  };
}

export function revealPanelItem(panel: HTMLElement, item: HTMLElement): void {
  const container = panel.getBoundingClientRect();
  const target = item.getBoundingClientRect();
  if (target.top < container.top + 4) panel.scrollTop -= container.top + 4 - target.top;
  else if (target.bottom > container.bottom - 4)
    panel.scrollTop += target.bottom - container.bottom + 4;
}
