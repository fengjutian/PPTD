import { afterEach, describe, expect, it } from "vitest";
import { createCanvasTextMeasurer } from "./text-metrics-canvas";

const globalScope = globalThis as { document?: unknown };
const originalDocument = globalScope.document;

afterEach(() => {
  globalScope.document = originalDocument;
});

/** A canvas that measures every character as half of the font size. */
function fakeCanvas(): { font: string } {
  const context = {
    font: "",
    measureText: (text: string) => ({ width: text.length * 50 }),
  };
  globalScope.document = {
    createElement: () => ({ getContext: () => context }),
  };
  return context;
}

describe("canvas text measurer", () => {
  it("returns nothing when the environment has no canvas", () => {
    globalScope.document = undefined;
    expect(createCanvasTextMeasurer()).toBeUndefined();
  });

  it("returns the width of the text in em, independent of the size", () => {
    const context = fakeCanvas();
    const measurer = createCanvasTextMeasurer();
    expect(measurer?.widthEm("AAAA", "Arial")).toBe(2);
    expect(context.font).toBe('100px "Arial"');
  });

  it("escapes a font family that would break the font shorthand", () => {
    const context = fakeCanvas();
    const measurer = createCanvasTextMeasurer();
    measurer?.widthEm("A", 'Say"Hi"');
    expect(context.font).toContain('\\"');
  });

  it("measures an empty text as nothing", () => {
    fakeCanvas();
    const measurer = createCanvasTextMeasurer();
    expect(measurer?.widthEm("", "Arial")).toBe(0);
  });
});
