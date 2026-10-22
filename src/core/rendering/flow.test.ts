import { describe, expect, it } from "vitest";
import { layoutFlow, measureItemHeightPt } from "./flow";

const options = (overrides: Partial<Parameters<typeof layoutFlow>[0]> = {}) => ({
  items: ["一", "二"],
  widthPt: 200,
  availableHeightPt: 200,
  preferredFontSizePt: 20,
  minimumFontSizePt: 12,
  ...overrides,
});

describe("measured flow layout", () => {
  it("gives every item the same font size", () => {
    const flow = layoutFlow(options({ items: ["短", "很长很长很长很长很长很长很长的一条要点"] }));
    expect(flow.rows[0]!.fontSizePt).toBe(flow.rows[1]!.fontSizePt);
  });

  it("gives every item the same gap", () => {
    const flow = layoutFlow(options({ items: ["一", "二", "三", "四"], availableHeightPt: 400 }));
    const gaps = flow.rows
      .slice(1)
      .map((row, index) => row.topPt - (flow.rows[index]!.topPt + flow.rows[index]!.heightPt));
    expect(new Set(gaps.map((gap) => gap.toFixed(3))).size).toBe(1);
  });

  it("measures the rows instead of dividing the column into equal slots", () => {
    // A two-line item and a one-line item must not get the same height.
    const flow = layoutFlow(options({ items: ["一二三四五六七八十一二", "一二三四"] }));
    expect(flow.rows[0]!.heightPt).toBeGreaterThan(flow.rows[1]!.heightPt);
  });

  it("keeps the gap inside its limits", () => {
    const flow = layoutFlow(options({ items: ["一", "二"], availableHeightPt: 600, maximumGapPt: 20 }));
    expect(flow.gapPt).toBe(20);
  });

  it("centres a column that is shorter than the space it was given", () => {
    const flow = layoutFlow(
      options({ items: ["一", "二"], availableHeightPt: 400, maximumGapPt: 10, verticalAlign: "center" }),
    );
    expect(flow.rows[0]!.topPt).toBeGreaterThan(0);
  });

  it("keeps a column at the top when it is not centred", () => {
    const flow = layoutFlow(options({ items: ["一", "二"], availableHeightPt: 400, maximumGapPt: 10 }));
    expect(flow.rows[0]!.topPt).toBe(0);
  });

  it("shrinks the font size when the column does not fit", () => {
    const flow = layoutFlow(
      options({ items: ["一二三四五六七八九十".repeat(3), "一二三四五六七八九十".repeat(3)], availableHeightPt: 120 }),
    );
    expect(flow.fontSizePt).toBeLessThan(20);
    expect(flow.overflow).toBe(false);
  });

  it("reports an overflow when even the smallest font size does not fit", () => {
    const flow = layoutFlow(options({ items: ["一二三四五六七八九十".repeat(4)], availableHeightPt: 20 }));
    expect(flow.overflow).toBe(true);
  });

  it("measures the height of one item", () => {
    // 200 points of width at 20 points of font size hold ten characters, so
    // two characters take one line.
    expect(measureItemHeightPt("一二", 200, 20)).toBe(1 * 20 * 1.25);
  });
});
