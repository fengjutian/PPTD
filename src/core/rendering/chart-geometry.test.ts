import { describe, expect, it } from "vitest";
import { chartPlotArea, chartValueY, niceChartDomain } from "./chart-geometry";

describe("chart geometry", () => {
  it("reserves gutters for labels on every side", () => {
    const plot = chartPlotArea(400, 200, 12);
    expect(plot.left).toBeGreaterThan(0);
    expect(plot.top).toBeGreaterThan(0);
    expect(plot.bottom).toBeLessThan(200);
    expect(plot.right).toBeLessThan(400);
    expect(plot.width).toBeGreaterThan(0);
    expect(plot.height).toBeGreaterThan(0);
  });

  it("rounds 0..128 to a readable 0..150 domain", () => {
    const domain = niceChartDomain(0, 128);
    expect(domain).toEqual({ min: 0, max: 150, step: 50 });
  });

  it("keeps plotted values inside the plot area", () => {
    const plot = chartPlotArea(400, 200, 12);
    const domain = niceChartDomain(0, 128);
    expect(chartValueY(0, domain, plot)).toBeCloseTo(plot.bottom);
    expect(chartValueY(150, domain, plot)).toBeCloseTo(plot.top);
    const top = chartValueY(128, domain, plot);
    expect(top).toBeGreaterThan(plot.top);
    expect(top).toBeLessThan(plot.bottom);
  });

  it("handles negative values without flipping the plot", () => {
    const plot = chartPlotArea(400, 200, 12);
    const domain = niceChartDomain(-12, 40);
    expect(domain.min).toBeLessThanOrEqual(-12);
    expect(domain.max).toBeGreaterThanOrEqual(40);
    for (const value of [-12, 0, 40]) {
      const y = chartValueY(value, domain, plot);
      expect(y).toBeGreaterThanOrEqual(plot.top);
      expect(y).toBeLessThanOrEqual(plot.bottom);
    }
  });
});
