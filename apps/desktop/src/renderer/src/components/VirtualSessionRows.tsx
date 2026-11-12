import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";

export function VirtualSessionRows({ items }: { items: ReactNode[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 52,
    overscan: 6,
  });
  if (items.length <= 100) return <>{items}</>;
  return (
    <div
      ref={scroll}
      className="session-virtual-scroll"
      style={{ maxHeight: 420, overflowY: "auto" }}
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative", width: "100%" }}>
        {virtual.getVirtualItems().map((item) => (
          <div
            key={item.key}
            ref={virtual.measureElement}
            data-index={item.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            }}
          >
            {items[item.index]}
          </div>
        ))}
      </div>
    </div>
  );
}
