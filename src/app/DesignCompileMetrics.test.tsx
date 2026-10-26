import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DesignMetrics } from "../core/design/design-metrics";
import { DesignCompileMetrics } from "./DesignCompileMetrics";

const metrics: DesignMetrics = {
  totalSlides: 10,
  plannedSlides: 8,
  coverage: 0.8,
  accepted: 5,
  adjusted: 2,
  rejected: 1,
  substituted: 1,
  recipes: [
    { recipe: "editorial-index", pages: 4 },
    { recipe: "asymmetric-split", pages: 2 },
    { recipe: "data-story", pages: 1 },
  ],
  diagnostics: [
    { code: "RECIPE_CAPACITY_EXCEEDED", severity: "error", pages: 2 },
    { code: "DIRECTION_RECIPE_SUBSTITUTED", severity: "warning", pages: 1 },
  ],
  decisions: [
    {
      slideIndex: 0,
      outcome: "accepted",
      requestedRecipe: "editorial-index",
      selectedRecipe: "editorial-index",
      substituted: false,
    },
    {
      slideIndex: 1,
      outcome: "accepted-with-adjustments",
      requestedRecipe: "asymmetric-split",
      selectedRecipe: "editorial-index",
      substituted: true,
    },
    {
      slideIndex: 2,
      outcome: "rejected",
      requestedRecipe: "data-story",
      selectedRecipe: undefined,
      substituted: false,
    },
  ],
};

describe("DesignCompileMetrics", () => {
  it("shows plan coverage, outcomes, recipes, diagnostics and prompt version", () => {
    const markup = renderToStaticMarkup(<DesignCompileMetrics metrics={metrics} promptVersion="design-pages-v1" />);

    expect(markup).toContain("设计编译度量");
    expect(markup).toContain("8</b>/10 页按计划编译");
    expect(markup).toContain("采用 5");
    expect(markup).toContain("调整 2");
    expect(markup).toContain("拒绝 1");
    expect(markup).toContain("换配方 1");
    expect(markup).toContain("提示词 design-pages-v1");
    expect(markup).toContain("编辑索引×4");
    expect(markup).toContain("RECIPE_CAPACITY_EXCEEDED×2");
    expect(markup).toContain("每页配方决策（3 页）");
  });

  it("explains how each planned page got its recipe", () => {
    const markup = renderToStaticMarkup(<DesignCompileMetrics metrics={metrics} />);

    expect(markup).toContain("第 1 页");
    expect(markup).toContain("编辑索引");
    expect(markup).toContain("非对称分栏 → 编辑索引");
    expect(markup).toContain("指标故事 → 未选定");
    expect(markup).toContain("拒绝");
  });

  it("keeps the summary compact when no diagnostics or decisions exist", () => {
    const markup = renderToStaticMarkup(
      <DesignCompileMetrics
        metrics={{
          ...metrics,
          recipes: [],
          diagnostics: [],
          decisions: [],
        }}
      />,
    );

    expect(markup).toContain("8</b>/10 页按计划编译");
    expect(markup).not.toContain("每页配方决策");
    expect(markup).not.toContain("提示词");
  });
});
