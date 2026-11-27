import type { ImageStudioCanvas } from "../../../shared/image-studio";

type CanvasViewport = Pick<ImageStudioCanvas, "id" | "zoom" | "offsetX" | "offsetY">;
type CanvasZoomPatch = Pick<ImageStudioCanvas, "zoom" | "offsetX" | "offsetY">;

export function imageStudioZoomAt(
  canvas: CanvasViewport,
  nextZoom: number,
  anchor: { x: number; y: number },
): CanvasZoomPatch {
  const zoom = Math.min(4, Math.max(0.12, nextZoom));
  const worldX = (anchor.x - canvas.offsetX) / canvas.zoom;
  const worldY = (anchor.y - canvas.offsetY) / canvas.zoom;
  return {
    zoom,
    offsetX: anchor.x - worldX * zoom,
    offsetY: anchor.y - worldY * zoom,
  };
}

export function attachImageStudioWheelZoom(
  viewport: HTMLElement,
  getCanvas: () => CanvasViewport | null,
  updateCanvas: (id: string, patch: CanvasZoomPatch) => void,
): () => void {
  const onWheel = (event: WheelEvent) => {
    const canvas = getCanvas();
    if (!canvas) return;
    if (event.cancelable) event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const patch = imageStudioZoomAt(canvas, canvas.zoom * (event.deltaY > 0 ? 0.9 : 1.1), {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    updateCanvas(canvas.id, patch);
  };
  viewport.addEventListener("wheel", onWheel, { passive: false });
  return () => viewport.removeEventListener("wheel", onWheel);
}
