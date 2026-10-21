import { describe, expect, it } from "vitest";
import { renderedContrastRatio } from "./presentation-renderer";

describe("rendered contrast calculation", () => {
  it("meets WCAG contrast for black on white", () => {
    expect(renderedContrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
  });

  it("detects nearly identical foreground and background colors", () => {
    expect(renderedContrastRatio([120, 120, 120], [126, 126, 126])).toBeLessThan(1.2);
  });
});
