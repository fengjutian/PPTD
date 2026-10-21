import { describe, expect, it } from "vitest";
import { affectedSlideIndexes, defaultPresentationVisualGoal, normalizeVisualReview, runVisualAlignmentLoop, visualRepairPlanSchema, type VisualReview } from "./visual-alignment";

const review = (score: number, errors = 0): VisualReview => ({ overallScore: score, hierarchyScore: score, alignmentScore: score, readabilityScore: score, consistencyScore: score, issues: Array.from({ length: errors }, () => ({ slideIndex: 0, severity: "error", issue: "misalignment", elementIds: [], suggestion: "对齐到共享网格" })), slideGuidance: [] });

describe("visual alignment loop", () => {
  it("stops when the target is reached", async () => {
    const result = await runVisualAlignmentLoop({ initial: { content: "frozen", design: 0 }, goal: defaultPresentationVisualGoal(), contentFingerprint: (value) => value.content, review: async () => review(92), repair: async (value) => value });
    expect(result).toMatchObject({ iterations: 1, stopReason: "target-reached" });
  });
  it("rejects repairs that change approved content", async () => {
    await expect(runVisualAlignmentLoop({ initial: { content: "frozen", design: 0 }, goal: defaultPresentationVisualGoal(), contentFingerprint: (value) => value.content, review: async () => review(60, 1), repair: async (value) => ({ ...value, content: "changed", design: 1 }) })).rejects.toThrow("VISUAL_ALIGNMENT_CONTENT_MUTATION");
  });
  it("stops after three improving iterations below target", async () => {
    let score = 60;
    const result = await runVisualAlignmentLoop({ initial: { content: "frozen", design: 0 }, goal: defaultPresentationVisualGoal(), contentFingerprint: (value) => value.content, review: async () => review(score += 5, 1), repair: async (value) => ({ ...value, design: value.design + 1 }) });
    expect(result).toMatchObject({ iterations: 3, stopReason: "iteration-limit" });
  });
  it("limits repair work to reported low-quality slides", () => {
    const result = affectedSlideIndexes({ ...review(70), issues: [{ slideIndex: 4, severity: "warning", issue: "repetitive-layout", elementIds: [], suggestion: "更换结构" }, { slideIndex: 2, severity: "error", issue: "misalignment", elementIds: [], suggestion: "对齐" }, { slideIndex: 4, severity: "error", issue: "poor-contrast", elementIds: [], suggestion: "提高对比度" }] });
    expect(result).toEqual([2, 4]);
    expect(visualRepairPlanSchema.parse({ repairs: [{ slideIndex: 2, layout: "quote", reason: "强化原文" }] }).repairs).toHaveLength(1);
  });
});

describe("visual review normalization", () => {
  it("fills missing guidance and replaces an illegal layout", () => {
    const result = normalizeVisualReview({ ...review(84), slideGuidance: [{ slideIndex: 1, safeRegion: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, logoRegions: [], busyRegions: [], focalPoint: { x: 0.4, y: 0.5 }, recommendedLayout: "magic-grid" }] }, [1, 2]);
    expect(result.slideGuidance.map((item) => item.slideIndex)).toEqual([1, 2]);
    expect(result.slideGuidance.every((item) => item.recommendedLayout === "title-body")).toBe(true);
  });

  it("clamps scores, points, and rectangles into the normalized page", () => {
    const result = normalizeVisualReview({ ...review(84), overallScore: 112, slideGuidance: [{ slideIndex: 0, safeRegion: { x: -0.2, y: 0.9, width: 1.4, height: 0.8 }, logoRegions: [{ x: 0.95, y: -1, width: 0.4, height: 2 }], busyRegions: [], focalPoint: { x: 4, y: -2 }, recommendedLayout: "cover" }] }, [0]);
    expect(result.overallScore).toBe(100);
    expect(result.slideGuidance[0]!.safeRegion).toMatchObject({ x: 0, y: 0.9, width: 1 });
    expect(result.slideGuidance[0]!.safeRegion.height).toBeCloseTo(0.1);
    expect(result.slideGuidance[0]!.logoRegions[0]).toMatchObject({ x: 0.95, y: 0, height: 1 });
    expect(result.slideGuidance[0]!.logoRegions[0]!.width).toBeCloseTo(0.05);
    expect(result.slideGuidance[0]!.focalPoint).toEqual({ x: 1, y: 0 });
  });

  it("drops findings for unrequested slides and rejects missing scores", () => {
    const result = normalizeVisualReview({ ...review(80), issues: [{ slideIndex: 9, severity: "error", issue: "misalignment", suggestion: "move" }] }, [0]);
    expect(result.issues).toEqual([]);
    expect(() => normalizeVisualReview({ overallScore: 80 }, [0])).toThrow("AI_VISION_RESPONSE_UNREPAIRABLE");
  });
});
