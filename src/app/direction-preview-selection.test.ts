import { describe, expect, it } from "vitest";
import type { AiDraft } from "../services/ai-service";
import { directionPreviewIndexes } from "./direction-preview-selection";

const draft: AiDraft = {
  title: "方向选样",
  presentationBrief: {
    objective: "比较四种设计方向",
    audience: "管理层",
    scenario: "方案评审",
    expectedAction: "选择方向",
    coreConclusion: "四种骨架应明显不同",
    narrativeStrategy: "proposal",
    assumptions: [],
  },
  slides: [
    {
      title: "封面",
      body: "",
      speakerNotes: "",
      blocks: [],
      plan: { purpose: "开篇", conclusion: "方向选样", visualIntent: "hero", density: "low" },
    },
    {
      title: "列表",
      body: "一\n二\n三\n四",
      speakerNotes: "",
      blocks: [],
      plan: { purpose: "列举", conclusion: "四项", visualIntent: "structured-text", density: "medium" },
    },
    {
      title: "图片",
      body: "图片承担主要叙事",
      speakerNotes: "",
      blocks: [],
      plan: {
        purpose: "图像叙事",
        conclusion: "图片优先",
        visualIntent: "image-story",
        density: "low",
        visualAsset: { enabled: true, role: "hero", prompt: "现场照片", source: "model" },
      },
    },
    {
      title: "数据",
      body: "收入持续增长",
      speakerNotes: "",
      blocks: [{ type: "metric", label: "收入", value: "42%" }],
      plan: { purpose: "数据证据", conclusion: "收入增长", visualIntent: "data-chart", density: "medium" },
    },
    {
      title: "长文",
      body: "这是一段用于纸本专栏方向的长正文。".repeat(12),
      speakerNotes: "",
      blocks: [],
      plan: { purpose: "解释", conclusion: "连续阅读", visualIntent: "structured-text", density: "high" },
    },
  ],
};

describe("direction preview page selection", () => {
  it("uses different evidence pages for the four skeletons", () => {
    expect(directionPreviewIndexes(draft, "editorial")).toEqual([1, 2]);
    expect(directionPreviewIndexes(draft, "documentary")).toEqual([2, 1]);
    expect(directionPreviewIndexes(draft, "instrument")).toEqual([3, 1]);
    expect(directionPreviewIndexes(draft, "paper")).toEqual([4, 1]);
  });

  it("falls back to the first content page for a sparse deck", () => {
    const sparse: AiDraft = {
      title: "短稿",
      presentationBrief: draft.presentationBrief,
      slides: [draft.slides[0]!, { ...draft.slides[1]!, title: "正文", body: "一句话" }],
    };
    expect(directionPreviewIndexes(sparse, "documentary")).toEqual([1]);
  });
});
