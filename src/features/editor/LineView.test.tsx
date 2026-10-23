import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LineView } from "./LineView";
import { emu, type LineElement } from "../../core/document-model";

const line = (direction: LineElement["direction"]): LineElement => ({
  id: crypto.randomUUID() as never,
  type: "line",
  direction,
  frame: { x: emu(0), y: emu(0), width: emu(100), height: emu(200) },
  rotationMilliDegree: 0,
  locked: false,
  origin: "user",
  style: { stroke: "#3366CC", strokeWidthPt: 2, startArrow: "none", endArrow: "none", dashed: false },
});

describe("LineView", () => {
  it("draws a vertical line from the top of its frame to the bottom", () => {
    const markup = renderToStaticMarkup(<LineView element={line("vertical")} scale={0.01} />);
    // width = 1px, height = 2px at this scale.
    expect(markup).toContain('x1="0.5" y1="0" x2="0.5" y2="2"');
  });

  it("draws a horizontal line across the vertical middle of its frame", () => {
    const markup = renderToStaticMarkup(<LineView element={line("horizontal")} scale={0.01} />);
    expect(markup).toContain('x1="0" y1="1" x2="1" y2="1"');
  });
});
