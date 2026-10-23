import { describe, expect, it } from "vitest";
import { BUILTIN_ICONS, type BuiltinIconName } from "./icons";
import { iconOutline } from "./icon-geometry";

const NAMES = Object.keys(BUILTIN_ICONS) as BuiltinIconName[];

describe("built-in icon geometry", () => {
  it("converts every icon into finite points inside its frame", () => {
    for (const name of NAMES) {
      const points = iconOutline(name, 1, 1);
      expect(points.length).toBeGreaterThan(1);
      expect(points[0]).toMatchObject({ moveTo: true });
      for (const point of points) {
        if ("close" in point) continue;
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        // Curve handles sit slightly outside the glyph box on some arcs; a
        // small tolerance keeps the assertion about the drawing, not rounding.
        expect(point.x).toBeGreaterThanOrEqual(-0.01);
        expect(point.x).toBeLessThanOrEqual(1.01);
        expect(point.y).toBeGreaterThanOrEqual(-0.01);
        expect(point.y).toBeLessThanOrEqual(1.01);
        if ("curve" in point) {
          for (const value of [point.curve.x1, point.curve.y1, point.curve.x2, point.curve.y2]) {
            expect(Number.isFinite(value)).toBe(true);
          }
        }
      }
    }
  });

  it("scales the same outline to the frame it is given", () => {
    const small = iconOutline("chart", 0.24, 0.24);
    const large = iconOutline("chart", 1.2, 0.6);
    const smallMax = Math.max(...small.flatMap((point) => ("close" in point ? [] : [point.x, point.y])));
    const largeX = Math.max(...large.flatMap((point) => ("close" in point ? [] : [point.x])));
    const largeY = Math.max(...large.flatMap((point) => ("close" in point ? [] : [point.y])));
    expect(smallMax).toBeLessThanOrEqual(0.24);
    expect(largeX).toBeLessThanOrEqual(1.2);
    expect(largeY).toBeLessThanOrEqual(0.6);
  });

  it("closes the subpaths that the drawing closes", () => {
    // The target is two concentric circles around a dot.
    const target = iconOutline("target", 1, 1);
    expect(target.filter((point) => "close" in point)).toHaveLength(2);
    expect(target.filter((point) => "curve" in point).length).toBeGreaterThan(4);
  });
});
