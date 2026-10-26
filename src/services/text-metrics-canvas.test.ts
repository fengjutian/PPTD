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
    expect(context.font).toBe('400 100px "Arial"');
  });

  it("measures a bold run with the bold face", () => {
    // A title is set in 700 weight; measuring it with the regular advance made
    // the file wrap a word later than the picture the reviewer approved.
    const context = fakeCanvas();
    const measurer = createCanvasTextMeasurer();
    measurer?.widthEm("标题", "Arial", true);
    expect(context.font).toBe('700 100px "Arial"');
    // The cache is keyed by weight, so the regular face is still measured as one.
    measurer?.widthEm("标题", "Arial", false);
    expect(context.font).toBe('400 100px "Arial"');
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
