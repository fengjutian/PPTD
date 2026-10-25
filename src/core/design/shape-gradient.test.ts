import { describe, expect, it } from "vitest";
import { contrastRatio } from "../rendering/contrast";
import { THEME_PRESETS } from "./theme-presets";
import { accentPanelGradient, gradientCss, gradientLinePoints, mixHex, rgba } from "./shape-gradient";

describe("shape gradients", () => {
  it("mixes toward white and black", () => {
    expect(mixHex("#A62B1F", "#FFFFFF", 0)).toBe("#A62B1F");
    expect(mixHex("#A62B1F", "#FFFFFF", 1)).toBe("#FFFFFF");
    const light = mixHex("#A62B1F", "#FFFFFF", 0.18);
    expect(light).not.toBe("#A62B1F");
  });

  it("builds a three-stop accent field with ordered offsets", () => {
    const gradient = accentPanelGradient("#A62B1F");
    expect(gradient.stops).toHaveLength(3);
    expect(gradient.stops[0]!.offset).toBeLessThan(gradient.stops[1]!.offset);
    expect(gradient.stops[1]!.offset).toBeLessThan(gradient.stops[2]!.offset);
    expect(gradient.stops[1]!.color).not.toBe("#A62B1F");
  });

  it("keeps white cover copy readable on every preset accent", () => {
    for (const preset of THEME_PRESETS) {
      const accent = preset.theme.colors.find((color) => color.name === "accent")?.value;
      expect(accent, preset.id).toBeTruthy();
      if (!accent) continue;
      for (const stop of accentPanelGradient(accent).stops) {
        expect(contrastRatio("#FFFFFF", stop.color), `${preset.id} ${stop.color}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("turns a DrawingML angle into CSS and canvas endpoints", () => {
    expect(gradientCss(accentPanelGradient("#A62B1F"))).toContain("linear-gradient(135deg");
    const points = gradientLinePoints(45, 100, 50);
    expect(points.x1).toBeLessThan(points.x2);
    expect(points.y1).toBeLessThan(points.y2);
    expect(points.x2 - points.x1).toBeGreaterThan(70);
    expect(points.y2 - points.y1).toBeGreaterThan(70);
  });

  it("maps transparency to an alpha channel", () => {
    expect(rgba("#A62B1F", 0)).toBe("rgba(166, 43, 31, 1.000)");
    expect(rgba("#A62B1F", 40)).toBe("rgba(166, 43, 31, 0.600)");
  });
});
