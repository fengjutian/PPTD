import { describe, expect, it } from "vitest";
import { defaultPresentationVisualGoal, runVisualAlignmentLoop, type VisualReview } from "./visual-alignment";

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
});
