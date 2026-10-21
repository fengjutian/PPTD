import { describe, expect, it } from "vitest";
import { affectedSlideIndexes, defaultPresentationVisualGoal, runVisualAlignmentLoop, visualRepairPlanSchema, type VisualReview } from "./visual-alignment";

const review = (score: number, errors = 0): VisualReview => ({ overallScore: score, hierarchyScore: score, alignmentScore: score, readabilityScore: score, consistencyScore: score, issues: Array.from({ length: errors }, () => ({ slideIndex: 0, severity: "error", issue: "misalignment", elementIds: [], suggestion: "对齐到共享网格" })) });

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
