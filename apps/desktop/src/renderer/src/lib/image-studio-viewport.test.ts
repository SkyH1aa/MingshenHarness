import { describe, expect, it, vi } from "vitest";
import { attachImageStudioWheelZoom, imageStudioZoomAt } from "./image-studio-viewport";

function wheel(deltaY: number, clientX = 110, clientY = 140, ctrlKey = false): WheelEvent {
  const event = new Event("wheel", { cancelable: true });
  Object.assign(event, { deltaY, clientX, clientY, ctrlKey });
  return event as WheelEvent;
}

function viewport(): HTMLElement {
  const target = new EventTarget();
  return Object.assign(target, {
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  }) as HTMLElement;
}

describe("image studio canvas wheel zoom", () => {
  it("keeps the world position beneath the pointer fixed and clamps zoom", () => {
    const canvas = { id: "canvas", zoom: 1, offsetX: 30, offsetY: 40 };
    expect(imageStudioZoomAt(canvas, 2, { x: 100, y: 120 })).toEqual({
      zoom: 2,
      offsetX: -40,
      offsetY: -40,
    });
    expect(imageStudioZoomAt(canvas, 100, { x: 0, y: 0 }).zoom).toBe(4);
    expect(imageStudioZoomAt(canvas, 0, { x: 0, y: 0 }).zoom).toBe(0.12);
  });

  it("registers a non-passive listener, follows the active canvas and cleans up", () => {
    const element = viewport();
    const add = vi.spyOn(element, "addEventListener");
    let active: { id: string; zoom: number; offsetX: number; offsetY: number } | null = null;
    const update = vi.fn(
      (id: string, patch: { zoom: number; offsetX: number; offsetY: number }) => {
        if (active?.id === id) active = { ...active, ...patch };
      },
    );
    const dispose = attachImageStudioWheelZoom(element, () => active, update);
    expect(add).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: false });

    const emptyWheel = wheel(1);
    expect(element.dispatchEvent(emptyWheel)).toBe(true);
    expect(update).not.toHaveBeenCalled();

    active = { id: "one", zoom: 1, offsetX: 0, offsetY: 0 };
    const first = wheel(1);
    expect(element.dispatchEvent(first)).toBe(false);
    expect(first.defaultPrevented).toBe(true);
    expect(update).toHaveBeenLastCalledWith("one", {
      zoom: 0.9,
      offsetX: 10,
      offsetY: 12,
    });

    active = { id: "two", zoom: 2, offsetX: 0, offsetY: 0 };
    const ctrlWheel = wheel(-1, 110, 140, true);
    expect(element.dispatchEvent(ctrlWheel)).toBe(false);
    expect(update).toHaveBeenLastCalledWith("two", {
      zoom: 2.2,
      offsetX: -10.000000000000014,
      offsetY: -12,
    });

    dispose();
    expect(element.dispatchEvent(wheel(-1))).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("uses the newly applied zoom for consecutive wheel events", () => {
    const element = viewport();
    let canvas = { id: "one", zoom: 1, offsetX: 0, offsetY: 0 };
    const dispose = attachImageStudioWheelZoom(
      element,
      () => canvas,
      (_id, patch) => {
        canvas = { ...canvas, ...patch };
      },
    );
    element.dispatchEvent(wheel(1));
    element.dispatchEvent(wheel(1));
    expect(canvas.zoom).toBeCloseTo(0.81);
    dispose();
  });
});
