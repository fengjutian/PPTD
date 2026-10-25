import { describe, expect, it } from "vitest";
import type { AiSlideDesign } from "../core/commands/commands";
import { planAssetTopUp, planVisualAssets } from "./ai-visual-asset";

/** 一页最简单的设计：标题正文页。 */
function design(overrides: Partial<AiSlideDesign> = {}): AiSlideDesign {
  return {
    layout: "title-body",
    composition: "stacked",
    emphasis: "balanced",
    densityTarget: "balanced",
    palette: { background: "surface", accent: "accent-1", title: "primary", body: "secondary" },
    background: "#FFFFFF",
    accent: "#3366CC",
    titleColor: "#111111",
    bodyColor: "#333333",
    ...overrides,
  } as AiSlideDesign;
}

describe("配图计划", () => {
  it("审核过的配图意图优先于设计阶段的建议", () => {
    const { decisions, prompts } = planVisualAssets({
      designs: [design({ visualAsset: { enabled: true, prompt: "设计阶段给的画面", role: "hero" } })],
      itemCounts: [2],
      deterministicBlocks: [false],
      topic: "季度业务回顾",
      intents: [{ enabled: true, prompt: "用户审核时写的画面", role: "side" }],
    });

    expect(decisions[0]).toMatchObject({ enabled: true, role: "side" });
    expect(prompts.get(0)).toContain("用户审核时写的画面");
    expect(prompts.get(0)).not.toContain("设计阶段给的画面");
  });

  it("用户在审核页关掉配图，这一页就不配", () => {
    const { decisions, prompts } = planVisualAssets({
      designs: [design({ visualAsset: { enabled: true, prompt: "设计阶段给的画面", role: "hero" } })],
      itemCounts: [2],
      deterministicBlocks: [false],
      topic: "季度业务回顾",
      intents: [{ enabled: false, prompt: "", role: "side", source: "user" }],
    });

    expect(decisions[0]).toMatchObject({ enabled: false });
    expect(prompts.has(0)).toBe(false);
  });

  it("模型说不用配图，不压住设计阶段的建议", () => {
    // 实测一册四页的真实产出：模型只给封面配了图，其余三页都写 enabled=false，
    // 而设计阶段本会给其中两页配图。按模型的话就把图全压没了。
    const { decisions } = planVisualAssets({
      designs: [design({ layout: "cover", visualAsset: { enabled: true, prompt: "设计阶段给的画面", role: "hero" } })],
      itemCounts: [0],
      deterministicBlocks: [false],
      topic: "季度业务回顾",
      intents: [{ enabled: false, prompt: "", role: "side", source: "model" }],
    });

    expect(decisions[0]).toMatchObject({ enabled: true, role: "hero" });
  });

  it("没有配图意图时用设计阶段的建议", () => {
    const { decisions, prompts } = planVisualAssets({
      designs: [design({ layout: "cover", visualAsset: { enabled: true, prompt: "设计阶段给的画面", role: "hero" } })],
      itemCounts: [0],
      deterministicBlocks: [false],
      topic: "季度业务回顾",
    });

    expect(decisions[0]).toMatchObject({ enabled: true, role: "hero" });
    expect(prompts.get(0)).toContain("设计阶段给的画面");
  });

  it("审核过的意图为空描述时退回设计阶段的描述", () => {
    const { prompts } = planVisualAssets({
      designs: [design({ visualAsset: { enabled: true, prompt: "设计阶段给的画面", role: "hero" } })],
      itemCounts: [2],
      deterministicBlocks: [false],
      topic: "季度业务回顾",
      intents: [{ enabled: true, prompt: "   ", role: "side" }],
    });

    expect(prompts.get(0)).toContain("设计阶段给的画面");
  });

  it("内容阶段主动要求配图时，模型给的描述进提示词", () => {
    const { decisions, prompts } = planVisualAssets({
      designs: [design()],
      itemCounts: [2],
      deterministicBlocks: [false],
      topic: "季度业务回顾",
      intents: [{ enabled: true, prompt: "一间明亮的现代化数据中心", role: "side" }],
    });

    expect(decisions[0]).toMatchObject({ enabled: true, role: "side" });
    expect(prompts.get(0)).toContain("一间明亮的现代化数据中心");
  });
});

describe("配图补缺", () => {
  it("只买批量还没买过的那几页", () => {
    // 批量已经生成过 0 页和 2 页的图，保留那一版时不能再买一次同样的照片。
    const topUp = planAssetTopUp({
      decisions: [
        { enabled: true, role: "hero" },
        { enabled: true, role: "side" },
        { enabled: true, role: "band" },
        { enabled: false, reason: "该页有结构化内容块" },
      ],
      covered: new Set([0, 2]),
    });

    expect(topUp.targets).toBe(1);
    expect(topUp.decisions[1]).toMatchObject({ enabled: true, role: "side" });
    // 已经买过的页和原本就不配图的页都不再下单。
    expect(topUp.decisions[0]).toMatchObject({ enabled: false });
    expect(topUp.decisions[2]).toMatchObject({ enabled: false });
    expect(topUp.decisions[3]).toMatchObject({ enabled: false });
  });

  it("整册都有图时一张都不再生成", () => {
    const topUp = planAssetTopUp({
      decisions: [{ enabled: true, role: "hero" }],
      covered: new Set([0]),
    });
    expect(topUp.targets).toBe(0);
  });
});
