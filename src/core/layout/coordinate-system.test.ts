import { describe, expect, it } from "vitest";
import { inches } from "../document-model";
import { layoutRect, layoutRectToEmu, pageCoordinateSystemFromChrome } from "./coordinate-system";
import { planPageChrome } from "./page-chrome";
import { validatePageCoordinateSystem } from "./layout-validator";

describe("page coordinate system", () => {
  it("converts normalized-1000 rectangles to deterministic integer EMU", () => {
    const page = { width: inches(13.333), height: inches(7.5) };
    expect(layoutRectToEmu(layoutRect(220, 85, 720, 120), page)).toEqual({
      x: Math.round(page.width * 0.22),
      y: Math.round(page.height * 0.085),
      width: Math.round(page.width * 0.72),
      height: Math.round(page.height * 0.12),
    });
  });

  it("reports a rail that crosses the title and content axes", () => {
    const page = { width: inches(13.333), height: inches(7.5) };
    const chrome = planPageChrome({
      page,
      title: { x: inches(2.93), y: inches(0.64), width: inches(9.6), height: inches(0.75) },
      content: { x: inches(2.93), y: inches(2.1), width: inches(9.6), height: inches(4.2) },
    });
    const valid = pageCoordinateSystemFromChrome(chrome, {
      safe: { x: 0.22, y: 0.085, width: 0.72, height: 0.845 },
      rail: { x: 0.185, y: 0.085, width: 0.004, height: 0.845 },
    });
    expect(validatePageCoordinateSystem(valid)).toEqual([]);

    const invalid = { ...valid, rail: layoutRect(250, 85, 4, 845) };
    expect(validatePageCoordinateSystem(invalid)).toContainEqual(
      expect.objectContaining({ code: "AXIS_MISMATCH", paths: ["rail", "title", "content"] }),
    );
  });
});
