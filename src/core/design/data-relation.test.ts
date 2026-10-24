import { describe, expect, it } from "vitest";
import { isChartKindCompatible, preferredChartKind, resolveChartKind } from "./data-relation";

describe("data relation", () => {
  it("maps each relation to the chart kinds that can carry it", () => {
    expect(isChartKindCompatible("change", "line")).toBe(true);
    expect(isChartKindCompatible("change", "pie")).toBe(false);
    expect(isChartKindCompatible("proportion", "pie")).toBe(true);
    expect(isChartKindCompatible("comparison", "bar")).toBe(true);
    expect(isChartKindCompatible("magnitude", "line")).toBe(false);
  });

  it("prefers a readable kind for the number of points", () => {
    expect(preferredChartKind("proportion", 4)).toBe("pie");
    expect(preferredChartKind("proportion", 6)).toBe("bar");
    expect(preferredChartKind("change", 7)).toBe("line");
    expect(preferredChartKind("comparison", 3)).toBe("column");
    expect(preferredChartKind("comparison", 6)).toBe("bar");
  });

  it("keeps a compatible request and overrides an incompatible one", () => {
    expect(resolveChartKind({ relation: "comparison", requestedKind: "bar", pointCount: 3 })).toBe("bar");
    // A trend drawn as a pie is still a trend.
    expect(resolveChartKind({ relation: "change", requestedKind: "pie", pointCount: 5 })).toBe("line");
    expect(resolveChartKind({ relation: "proportion", requestedKind: "column", pointCount: 4 })).toBe("pie");
    // A pie is compatible with a proportion, but not with seven slices.
    expect(resolveChartKind({ relation: "proportion", requestedKind: "pie", pointCount: 7 })).toBe("bar");
  });

  it("preserves the legacy choice when no relation is given", () => {
    expect(resolveChartKind({ requestedKind: "line", pointCount: 8 })).toBe("line");
    expect(resolveChartKind({ pointCount: 3 })).toBe("column");
    expect(resolveChartKind({ pointCount: 8 })).toBe("bar");
  });
});
