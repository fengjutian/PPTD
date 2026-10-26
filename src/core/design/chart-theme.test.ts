import { describe, expect, it } from "vitest";
import { chartGridColor, chartSeriesColors } from "./chart-theme";
import { colorLuminance, contrastRatio } from "../rendering/contrast";

describe("chart theme", () => {
  it("lifts the series colour off a dark page instead of reusing the ink", () => {
    const dark = { background: "#12233D", accent: "#F2F6FA", accentStrong: "#0F7869" };
    const [bar] = chartSeriesColors(dark, 1);
    // The accent ink on a dark page is near-white; painting the bar with it is
    // what made the chart look like a default PowerPoint chart.
    expect(bar).not.toBe(dark.accent);
    expect((colorLuminance(bar!) ?? 0) > (colorLuminance(dark.background) ?? 1)).toBe(true);
    expect(contrastRatio(bar!, dark.background)!).toBeGreaterThan(2);
  });

  it("uses the solid accent on a light page", () => {
    const light = { background: "#FFFFFF", accent: "#0F7869", accentStrong: "#0F7869" };
    expect(chartSeriesColors(light, 1)[0]).toBe("#0F7869");
  });

  it("derives the grid from the page, not from a fixed grey", () => {
    const onWhite = chartGridColor("#FFFFFF");
    const onNavy = chartGridColor("#12233D");
    expect(contrastRatio(onWhite, "#FFFFFF")!).toBeLessThan(1.4);
    expect(contrastRatio(onNavy, "#12233D")!).toBeLessThan(1.6);
    // Both stay close to the page: a grid is a hint, not a ladder.
    expect(colorLuminance(onNavy)!).toBeGreaterThan(colorLuminance("#12233D")!);
  });

  it("fills every series even when the request outruns the palette", () => {
    const colors = chartSeriesColors({ background: "#FFFFFF", accent: "#0F7869" }, 5);
    expect(colors).toHaveLength(5);
    expect(new Set(colors).size).toBeGreaterThan(1);
    expect(colors.every((color) => /^#[0-9A-F]{6}$/.test(color))).toBe(true);
  });
});
