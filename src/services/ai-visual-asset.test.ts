import { describe, expect, it } from "vitest";
import type { AiSlideDesign } from "../core/commands/commands";
import { planVisualAssets } from "./ai-visual-asset";

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
      intents: [{ enabled: false, prompt: "", role: "side" }],
    });

    expect(decisions[0]).toMatchObject({ enabled: false });
    expect(prompts.has(0)).toBe(false);
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
});
