import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DesignCandidateView } from "./app-shared";
import { DesignCandidateDialog } from "./DesignCandidateDialog";

const view: DesignCandidateView = {
  slideIndex: 2,
  options: [
    {
      recipe: "editorial-index",
      label: "编辑索引",
      image: "data:image/png;base64,preview",
      auditCount: 0,
      tasteHardCount: 0,
    },
    {
      recipe: "asymmetric-split",
      label: "非对称分栏",
      auditCount: 2,
      tasteHardCount: 1,
    },
  ],
  rejected: 4,
  usage: { opened: 7, picked: 3 },
};

describe("DesignCandidateDialog", () => {
  it("shows the page and every compiled option", () => {
    const markup = renderToStaticMarkup(<DesignCandidateDialog view={view} onPick={() => {}} onClose={() => {}} />);

    expect(markup).toContain("换一版 · 第 3 页");
    expect(markup).toContain("编辑索引");
    expect(markup).toContain("非对称分栏");
    expect(markup).toContain("无版面问题");
    expect(markup).toContain("2 处版面问题");
    expect(markup).toContain("另有 4 个配方");
    expect(markup).toContain("本机累计：打开 7 次，采用 3 次");
    expect(markup).toContain("data:image/png;base64,preview");
  });

  it("explains a missing plan instead of showing an empty grid", () => {
    const markup = renderToStaticMarkup(
      <DesignCandidateDialog
        view={{ slideIndex: 0, options: [], rejected: 0, reason: "DESIGN_CANDIDATE_PLAN_REQUIRED" }}
        onPick={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("没有语义设计计划");
    expect(markup).not.toContain("design-candidate-grid");
  });
});
