import { afterEach, describe, expect, it } from "vitest";
import { estimateTextLines, measureTextWidthEm } from "./text-fit";
import { setTextMeasurer } from "./text-metrics";

afterEach(() => setTextMeasurer(undefined));

describe("text measurement port", () => {
  it("falls back to the rough estimate when no measurer is registered", () => {
    // The core has to work without a renderer, so the estimate is the fallback.
    expect(measureTextWidthEm("AAAA", "Arial")).toBeCloseTo(2.2);
    expect(measureTextWidthEm("覆盖", "Arial")).toBeCloseTo(2);
  });

  it("uses the measurer of the application when there is one", () => {
    setTextMeasurer({ widthEm: (text) => text.length * 0.5 });
    expect(measureTextWidthEm("AAAA", "Arial")).toBe(2);
    // Four characters of half an em fit on a line of two ems.
    expect(estimateTextLines("AAAA", 20, 10, "Arial")).toBe(1);
    expect(estimateTextLines("AAAA", 10, 10, "Arial")).toBe(2);
  });

  it("ignores a measurer that reports a width that makes no sense", () => {
    setTextMeasurer({ widthEm: () => Number.NaN });
    expect(measureTextWidthEm("AAAA", "Arial")).toBeCloseTo(2.2);
    setTextMeasurer({ widthEm: () => -1 });
    expect(measureTextWidthEm("AAAA", "Arial")).toBeCloseTo(2.2);
  });

  it("keeps the estimate when the caller does not name a font", () => {
    setTextMeasurer({ widthEm: () => 99 });
    expect(measureTextWidthEm("AAAA")).toBeCloseTo(2.2);
  });
});
