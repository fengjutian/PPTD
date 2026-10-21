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

const visualIssueKinds = ["weak-hierarchy", "poor-contrast", "visual-imbalance", "background-conflict", "misalignment", "excessive-empty-space", "repetitive-layout"] as const;
const visualLayouts = ["cover", "title-body", "split", "cards", "quote", "section", "summary"] as const;
type NormalizedRegion = VisualReview["slideGuidance"][number]["safeRegion"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

function normalizeScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return clamp(value, 0, 100);
}

function normalizeRegion(value: unknown): NormalizedRegion | undefined {
  if (!isRecord(value)) return undefined;
  const raw = [value.x, value.y, value.width, value.height];
  if (raw.some((part) => typeof part !== "number" || !Number.isFinite(part))) return undefined;
  const x = clamp(value.x as number, 0, 0.98);
  const y = clamp(value.y as number, 0, 0.98);
  const width = clamp(value.width as number, 0.02, 1 - x);
  const height = clamp(value.height as number, 0.02, 1 - y);
  return { x, y, width, height };
}

/** Repairs bounded model-output mistakes without inventing visual findings. */
export function normalizeVisualReview(input: unknown, expectedSlideIndexes: number[]): VisualReview {
  if (!isRecord(input)) throw new Error("AI_VISION_RESPONSE_UNREPAIRABLE");
  const expected = [...new Set(expectedSlideIndexes)].filter((index) => Number.isInteger(index) && index >= 0);
  if (expected.length === 0) throw new Error("AI_VISION_SLIDE_INDEX_INVALID");
  const expectedSet = new Set(expected);
  const scoreKeys = ["overallScore", "hierarchyScore", "alignmentScore", "readabilityScore", "consistencyScore"] as const;
  const scores = Object.fromEntries(scoreKeys.map((key) => [key, normalizeScore(input[key])])) as Record<(typeof scoreKeys)[number], number | undefined>;
  if (scoreKeys.some((key) => scores[key] === undefined)) throw new Error("AI_VISION_RESPONSE_UNREPAIRABLE");

  const issues = (Array.isArray(input.issues) ? input.issues : []).flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.slideIndex !== "number" || !expectedSet.has(candidate.slideIndex)) return [];
    if (candidate.severity !== "error" && candidate.severity !== "warning") return [];
    if (typeof candidate.issue !== "string" || !visualIssueKinds.includes(candidate.issue as (typeof visualIssueKinds)[number])) return [];
    if (typeof candidate.suggestion !== "string" || candidate.suggestion.trim().length === 0) return [];
    return [{ slideIndex: candidate.slideIndex, severity: candidate.severity, issue: candidate.issue, elementIds: Array.isArray(candidate.elementIds) ? candidate.elementIds.filter((id): id is string => typeof id === "string").slice(0, 100) : [], suggestion: candidate.suggestion.trim().slice(0, 500) }];
  }).slice(0, 100);

  const guidanceBySlide = new Map<number, VisualReview["slideGuidance"][number]>();
  for (const candidate of Array.isArray(input.slideGuidance) ? input.slideGuidance : []) {
    if (!isRecord(candidate) || typeof candidate.slideIndex !== "number" || !expectedSet.has(candidate.slideIndex) || guidanceBySlide.has(candidate.slideIndex)) continue;
    const safeRegion = normalizeRegion(candidate.safeRegion) ?? { x: 0.08, y: 0.18, width: 0.84, height: 0.7 };
    const normalizeRegions = (value: unknown): NormalizedRegion[] => (Array.isArray(value) ? value.map(normalizeRegion).filter((region): region is NormalizedRegion => region !== undefined).slice(0, 8) : []);
    const focal = isRecord(candidate.focalPoint) && typeof candidate.focalPoint.x === "number" && Number.isFinite(candidate.focalPoint.x) && typeof candidate.focalPoint.y === "number" && Number.isFinite(candidate.focalPoint.y)
      ? { x: clamp(candidate.focalPoint.x, 0, 1), y: clamp(candidate.focalPoint.y, 0, 1) }
      : { x: 0.5, y: 0.5 };
    const recommendedLayout = typeof candidate.recommendedLayout === "string" && visualLayouts.includes(candidate.recommendedLayout as (typeof visualLayouts)[number])
      ? candidate.recommendedLayout as (typeof visualLayouts)[number]
      : candidate.slideIndex === 0 ? "cover" : "title-body";
    guidanceBySlide.set(candidate.slideIndex, { slideIndex: candidate.slideIndex, safeRegion, logoRegions: normalizeRegions(candidate.logoRegions), busyRegions: normalizeRegions(candidate.busyRegions), focalPoint: focal, recommendedLayout });
  }

  const slideGuidance = expected.map((slideIndex) => guidanceBySlide.get(slideIndex) ?? ({ slideIndex, safeRegion: { x: 0.08, y: 0.18, width: 0.84, height: 0.7 }, logoRegions: [], busyRegions: [], focalPoint: { x: 0.5, y: 0.5 }, recommendedLayout: slideIndex === 0 ? "cover" as const : "title-body" as const }));
  return visualReviewSchema.parse({ ...scores, issues, slideGuidance });
}
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
