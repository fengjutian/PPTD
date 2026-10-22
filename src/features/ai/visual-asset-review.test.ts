import { describe, expect, it } from "vitest";
import type { AiDraft } from "../../services/ai-service";
import { hasStructuredBlock, requestsTextInImage, visualAssetIssues } from "./visual-asset-review";

/** 一页带配图意图的草稿。 */
function draftWith(visualAsset: AiDraft["slides"][number]["plan"]["visualAsset"], blocks: AiDraft["slides"][number]["blocks"] = []): AiDraft {
  return {
    title: "季度业务回顾",
    presentationBrief: {
      objective: "回顾季度经营",
      audience: "管理层",
      scenario: "季度复盘",
      expectedAction: "确认下一步重点",
      coreConclusion: "增长仍在但质量下降",
      narrativeStrategy: "management-report",
      assumptions: [],
    },
    slides: [{
      title: "营收达成预算目标",
      body: "正文内容",
      speakerNotes: "",
      plan: { purpose: "页面目的", conclusion: "单一结论", visualIntent: "image-story", density: "medium", visualAsset },
      blocks,
    }],
  };
}

describe("配图意图的合规检查", () => {
  it("画面描述里要求出现文字时给出提示", () => {
    // 生成图里的文字几乎总是错的，这是配图最常见也最容易被忽略的失败。
    expect(requestsTextInImage("一块写着「季度增长」的指示牌")).toBe(true);
    expect(requestsTextInImage("带有大标题的数据看板")).toBe(true);
    expect(requestsTextInImage("一间明亮的现代化数据中心，几何线条构成的上升箭头")).toBe(false);
  });

  it("配了图却没有画面描述时给出提示", () => {
    const issues = visualAssetIssues(draftWith({ enabled: true, prompt: "   ", role: "side" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ slideIndex: 0, kind: "image-empty-prompt" });
  });

  it("页面已有结构化内容块时不再配图", () => {
    const draft = draftWith(
      { enabled: true, prompt: "明亮的现代化数据中心", role: "side" },
      [{ type: "timeline", items: [{ label: "一月", text: "启动" }] }],
    );
    expect(hasStructuredBlock(draft.slides[0]!)).toBe(true);
    const issues = visualAssetIssues(draft);
    expect(issues.some((issue) => issue.kind === "image-on-structured-page")).toBe(true);
  });

  it("整册配图超过上限时给出提示", () => {
    const slides = Array.from({ length: 5 }, () => ({
      title: "标题",
      body: "正文",
      speakerNotes: "",
      plan: { purpose: "目的", conclusion: "结论", visualIntent: "image-story" as const, density: "medium" as const, visualAsset: { enabled: true, prompt: "明亮的现代化数据中心", role: "side" as const } },
      blocks: [],
    }));
    const draft: AiDraft = { ...draftWith(undefined), slides };
    const issues = visualAssetIssues(draft);
    expect(issues.filter((issue) => issue.kind === "image-over-limit")).toHaveLength(1);
  });

  it("关掉配图的页面不产生任何问题", () => {
    expect(visualAssetIssues(draftWith({ enabled: false, prompt: "", role: "side" }))).toEqual([]);
  });

  it("没有配图意图的旧草稿不受影响", () => {
    const draft: AiDraft = { ...draftWith(undefined) };
    expect(draft.slides[0]!.plan.visualAsset).toBeUndefined();
    expect(visualAssetIssues(draft)).toEqual([]);
  });
});
