import { z } from "zod";

export const presentationVisualGoalSchema = z.object({
  style: z.enum(["business", "editorial", "academic", "training", "launch"]),
  mood: z.enum(["restrained", "modern", "energetic", "formal"]),
  density: z.enum(["low", "medium", "high"]),
  alignment: z.enum(["left-grid", "centered-grid"]),
  backgroundRhythm: z.object({ coverVariants: z.number().int().min(1).max(2), contentVariants: z.number().int().min(1).max(3), repeatLimit: z.number().int().min(1).max(4) }),
  minimumScores: z.object({ overall: z.number().min(0).max(100), hierarchy: z.number().min(0).max(100), alignment: z.number().min(0).max(100), readability: z.number().min(0).max(100), consistency: z.number().min(0).max(100) }),
});
export type PresentationVisualGoal = z.infer<typeof presentationVisualGoalSchema>;

export const visualReviewSchema = z.object({
  overallScore: z.number().min(0).max(100), hierarchyScore: z.number().min(0).max(100), alignmentScore: z.number().min(0).max(100), readabilityScore: z.number().min(0).max(100), consistencyScore: z.number().min(0).max(100),
  issues: z.array(z.object({ slideIndex: z.number().int().nonnegative(), severity: z.enum(["error", "warning"]), issue: z.enum(["weak-hierarchy", "poor-contrast", "visual-imbalance", "background-conflict", "misalignment", "excessive-empty-space", "repetitive-layout"]), elementIds: z.array(z.string()).default([]), suggestion: z.string().min(1).max(500) })).max(100),
  slideGuidance: z.array(z.object({
    slideIndex: z.number().int().nonnegative(),
    safeRegion: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1),
    logoRegions: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) })).max(8).default([]),
    busyRegions: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) })).max(8).default([]),
    focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
    recommendedLayout: z.enum(["cover", "title-body", "split", "cards", "quote", "section", "summary"]),
  })).max(20).default([]),
});
export type VisualReview = z.infer<typeof visualReviewSchema>;
export const visualRepairPlanSchema = z.object({
  repairs: z.array(z.object({
    slideIndex: z.number().int().nonnegative(),
    layout: z.enum(["cover", "title-body", "split", "cards", "quote", "section", "summary"]).optional(),
    backgroundAction: z.enum(["keep", "replace-compatible", "simplify"]).default("keep"),
    hierarchyAction: z.enum(["keep", "strengthen-title", "reduce-density", "increase-whitespace"]).default("keep"),
    safeRegion: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).optional(),
    reason: z.string().min(1).max(500),
  })).max(20),
});
export type VisualRepairPlan = z.infer<typeof visualRepairPlanSchema>;
export interface VisualAlignmentResult<T> { value: T; review: VisualReview; iterations: number; stopReason: "target-reached" | "stagnated" | "iteration-limit" }

export async function runVisualAlignmentLoop<T>(options: { initial: T; goal: PresentationVisualGoal; contentFingerprint: (value: T) => string; review: (value: T, goal: PresentationVisualGoal, iteration: number) => Promise<VisualReview>; repair: (value: T, review: VisualReview, goal: PresentationVisualGoal) => Promise<T>; maxIterations?: number }): Promise<VisualAlignmentResult<T>> {
  const maxIterations = Math.min(3, Math.max(1, options.maxIterations ?? 3));
  const approvedContent = options.contentFingerprint(options.initial);
  let value = options.initial; let previousScore = -1; let lastReview: VisualReview | undefined;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const review = visualReviewSchema.parse(await options.review(value, options.goal, iteration)); lastReview = review;
    const reached = review.overallScore >= options.goal.minimumScores.overall && review.hierarchyScore >= options.goal.minimumScores.hierarchy && review.alignmentScore >= options.goal.minimumScores.alignment && review.readabilityScore >= options.goal.minimumScores.readability && review.consistencyScore >= options.goal.minimumScores.consistency && !review.issues.some((issue) => issue.severity === "error");
    if (reached) return { value, review, iterations: iteration, stopReason: "target-reached" };
    if (previousScore >= 0 && review.overallScore - previousScore < 3) return { value, review, iterations: iteration, stopReason: "stagnated" };
    if (iteration === maxIterations) return { value, review, iterations: iteration, stopReason: "iteration-limit" };
    previousScore = review.overallScore;
    const repaired = await options.repair(value, review, options.goal);
    if (options.contentFingerprint(repaired) !== approvedContent) throw new Error("VISUAL_ALIGNMENT_CONTENT_MUTATION");
    value = repaired;
  }
  throw new Error(lastReview ? "VISUAL_ALIGNMENT_ITERATION_INVALID" : "VISUAL_ALIGNMENT_REVIEW_MISSING");
}

export const defaultPresentationVisualGoal = (): PresentationVisualGoal => ({ style: "editorial", mood: "modern", density: "medium", alignment: "left-grid", backgroundRhythm: { coverVariants: 1, contentVariants: 3, repeatLimit: 2 }, minimumScores: { overall: 85, hierarchy: 82, alignment: 90, readability: 88, consistency: 85 } });

export function affectedSlideIndexes(review: VisualReview): number[] {
  return [...new Set(review.issues.filter((issue) => issue.severity === "error" || review.overallScore < 85).map((issue) => issue.slideIndex))].sort((left, right) => left - right);
}
