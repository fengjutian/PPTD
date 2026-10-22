import { describe, expect, it } from "vitest";
import { cropGeometry, cropSourceRect } from "./image-crop";

describe("image crop", () => {
  it("keeps the picture in its frame when nothing is cropped", () => {
    expect(cropGeometry(undefined)).toEqual({ width: 1, height: 1, left: 0, top: 0 });
    expect(cropSourceRect(undefined)).toBeUndefined();
    expect(cropSourceRect({ top: 0, bottom: 0, left: 0, right: 0 })).toBeUndefined();
  });

  it("draws the picture larger than the frame so the cut away part stays hidden", () => {
    // A quarter of the left and a tenth of the top are cut away.
    const geometry = cropGeometry({ top: 0.1, bottom: 0, left: 0.25, right: 0 });
    expect(geometry.width).toBeCloseTo(1 / 0.75, 6);
    expect(geometry.height).toBeCloseTo(1 / 0.9, 6);
    expect(geometry.left).toBeCloseTo(-0.25 / 0.75, 6);
    expect(geometry.top).toBeCloseTo(-0.1 / 0.9, 6);
  });

  it("shows the visible region exactly at the frame size", () => {
    const geometry = cropGeometry({ top: 0.1, bottom: 0.2, left: 0.15, right: 0.25 });
    // The window of the source that stays visible has to land on the frame.
    const windowLeft = geometry.left + 0.15 * geometry.width;
    const windowRight = geometry.left + 0.75 * geometry.width;
    expect(windowLeft).toBeCloseTo(0, 6);
    expect(windowRight).toBeCloseTo(1, 6);
  });

  it("writes the source rectangle in the units OOXML expects", () => {
    expect(cropSourceRect({ top: 0.1, bottom: 0.2, left: 0.15, right: 0.25 })).toEqual({
      l: 15000,
      t: 10000,
      r: 25000,
      b: 20000,
    });
  });
});
