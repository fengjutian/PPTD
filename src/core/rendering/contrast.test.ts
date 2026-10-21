import { describe, expect, it } from "vitest";
import { contrastRatio, contrastRatioAgainstLuminance, fillForInk, readableTextColorOnRange } from "./contrast";

describe("contrast helpers", () => {
  it("reads a background luminance as the relative luminance it already is", () => {
    expect(contrastRatioAgainstLuminance("#FFFFFF", 0)).toBeCloseTo(21, 5);
    expect(contrastRatioAgainstLuminance("#000000", 0.5)).toBeCloseTo(11, 5);
    // The value is a relative luminance, so it must not be expanded from sRGB a
    // second time. Doing that reported 5.7 for a mid tone that really is 2.3
    // and let unreadable text pass the gate.
    expect(contrastRatioAgainstLuminance("#FFFFFF", 0.4)!).toBeLessThan(3);
    expect(contrastRatioAgainstLuminance("#FFFFFF", 1)!).toBeCloseTo(1, 5);
  });

  it("keeps an ink that reads on every patch of the background range", () => {
    const range = { darkest: 0.39, lightest: 0.58 };
    // White cannot carry a headline on that artwork, whatever the template asks for.
    expect(readableTextColorOnRange("#FFFFFF", range, true)).not.toBe("#FFFFFF");
    expect(readableTextColorOnRange("#171A1F", range, true)).toBe("#171A1F");
  });

  it("deepens a fill until it can carry white text", () => {
    const fill = fillForInk("#FFFFFF", "#15A590");
    expect(fill).not.toBe("#15A590");
    expect(contrastRatio("#FFFFFF", fill)!).toBeGreaterThanOrEqual(4.5);
    // A fill that already carries white is kept as it is.
    expect(fillForInk("#FFFFFF", "#0C7E6E")).toBe("#0C7E6E");
  });
});
