import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, type ShapeElement } from "../../core/document-model";
import { ShapeView, pathFor } from "./ShapeView";

function shape(overrides: Partial<ShapeElement> = {}): ShapeElement {
  const element = createDocument().slides[0]!.elements[0]!;
  return {
    id: element.id,
    type: "shape",
    shape: "triangle",
    frame: { x: 0 as never, y: 0 as never, width: 100 as never, height: 80 as never },
    rotationMilliDegree: 0,
    locked: false,
    style: { fill: "#ffffff", stroke: "#000000", strokeWidthPt: 1, radiusPt: 0 },
    ...overrides,
  };
}

describe("shape view", () => {
  it("draws a preset shape as an SVG outline", () => {
    const markup = renderToStaticMarkup(<ShapeView element={shape()} scale={1 as never} />);
    expect(markup).toContain("shape-vector");
    expect(markup).toContain("<path");
    expect(markup).toContain("M 50 0");
  });

  it("closes every preset path", () => {
    for (const kind of [
      "triangle",
      "diamond",
      "pentagon",
      "hexagon",
      "chevron",
      "arrow",
      "star",
      "parallelogram",
      "trapezoid",
    ] as const) {
      const path = pathFor(kind, 100, 80);
      expect(path.startsWith("M ")).toBe(true);
      expect(path.endsWith(" Z")).toBe(true);
    }
  });
});
