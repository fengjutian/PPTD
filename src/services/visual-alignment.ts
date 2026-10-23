import { z } from "zod";

export const presentationVisualGoalSchema = z.object({
  style: z.enum(["business", "editorial", "academic", "training", "launch"]),
  mood: z.enum(["restrained", "modern", "energetic", "formal"]),
  density: z.enum(["low", "medium", "high"]),
  alignment: z.enum(["left-grid", "centered-grid"]),
  backgroundRhythm: z.object({
    coverVariants: z.number().int().min(1).max(2),
    contentVariants: z.number().int().min(1).max(3),
    repeatLimit: z.number().int().min(1).max(4),
  }),
  minimumScores: z.object({
    overall: z.number().min(0).max(100),
    hierarchy: z.number().min(0).max(100),
    alignment: z.number().min(0).max(100),
    readability: z.number().min(0).max(100),
    consistency: z.number().min(0).max(100),
  }),
});
export type PresentationVisualGoal = z.infer<typeof presentationVisualGoalSchema>;

export const visualReviewSchema = z.object({
  overallScore: z.number().min(0).max(100),
  hierarchyScore: z.number().min(0).max(100),
  alignmentScore: z.number().min(0).max(100),
  readabilityScore: z.number().min(0).max(100),
  consistencyScore: z.number().min(0).max(100),
  issues: z
    .array(
      z.object({
        slideIndex: z.number().int().nonnegative(),
        severity: z.enum(["error", "warning"]),
        issue: z.enum([
          "weak-hierarchy",
          "poor-contrast",
          "visual-imbalance",
          "background-conflict",
          "misalignment",
          "excessive-empty-space",
          "repetitive-layout",
        ]),
        elementIds: z.array(z.string()).default([]),
        suggestion: z.string().min(1).max(500),
      }),
    )
    .max(100),
  slideGuidance: z
    .array(
      z.object({
        slideIndex: z.number().int().nonnegative(),
        safeRegion: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().positive().max(1),
            height: z.number().positive().max(1),
          })
          .refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1),
        logoRegions: z
          .array(
            z.object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              width: z.number().positive().max(1),
              height: z.number().positive().max(1),
            }),
          )
          .max(8)
          .default([]),
        busyRegions: z
          .array(
            z.object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              width: z.number().positive().max(1),
              height: z.number().positive().max(1),
            }),
          )
          .max(8)
          .default([]),
        focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
        recommendedLayout: z.enum(["cover", "title-body", "split", "cards", "quote", "section", "summary"]),
      }),
    )
    .default([]),
});
export type VisualReview = z.infer<typeof visualReviewSchema>;

const visualIssueKinds = [
  "weak-hierarchy",
  "poor-contrast",
  "visual-imbalance",
  "background-conflict",
  "misalignment",
  "excessive-empty-space",
  "repetitive-layout",
] as const;
const visualLayouts = ["cover", "title-body", "split", "cards", "quote", "section", "summary"] as const;
type NormalizedRegion = VisualReview["slideGuidance"][number]["safeRegion"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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
  const scoreKeys = [
    "overallScore",
    "hierarchyScore",
    "alignmentScore",
    "readabilityScore",
    "consistencyScore",
  ] as const;
  const scores = Object.fromEntries(scoreKeys.map((key) => [key, normalizeScore(input[key])])) as Record<
    (typeof scoreKeys)[number],
    number | undefined
  >;
  if (scoreKeys.some((key) => scores[key] === undefined)) throw new Error("AI_VISION_RESPONSE_UNREPAIRABLE");

  const issues = (Array.isArray(input.issues) ? input.issues : [])
    .flatMap((candidate) => {
      if (!isRecord(candidate) || typeof candidate.slideIndex !== "number" || !expectedSet.has(candidate.slideIndex))
        return [];
      if (candidate.severity !== "error" && candidate.severity !== "warning") return [];
      if (
        typeof candidate.issue !== "string" ||
        !visualIssueKinds.includes(candidate.issue as (typeof visualIssueKinds)[number])
      )
        return [];
      if (typeof candidate.suggestion !== "string" || candidate.suggestion.trim().length === 0) return [];
      return [
        {
          slideIndex: candidate.slideIndex,
          severity: candidate.severity,
          issue: candidate.issue,
          elementIds: Array.isArray(candidate.elementIds)
            ? candidate.elementIds.filter((id): id is string => typeof id === "string").slice(0, 100)
            : [],
          suggestion: candidate.suggestion.trim().slice(0, 500),
        },
      ];
    })
    .slice(0, 100);

  const guidanceBySlide = new Map<number, VisualReview["slideGuidance"][number]>();
  for (const candidate of Array.isArray(input.slideGuidance) ? input.slideGuidance : []) {
    if (
      !isRecord(candidate) ||
      typeof candidate.slideIndex !== "number" ||
      !expectedSet.has(candidate.slideIndex) ||
      guidanceBySlide.has(candidate.slideIndex)
    )
      continue;
    const safeRegion = normalizeRegion(candidate.safeRegion) ?? { x: 0.08, y: 0.18, width: 0.84, height: 0.7 };
    const normalizeRegions = (value: unknown): NormalizedRegion[] =>
      Array.isArray(value)
        ? value
            .map(normalizeRegion)
            .filter((region): region is NormalizedRegion => region !== undefined)
            .slice(0, 8)
        : [];
    const focal =
      isRecord(candidate.focalPoint) &&
      typeof candidate.focalPoint.x === "number" &&
      Number.isFinite(candidate.focalPoint.x) &&
      typeof candidate.focalPoint.y === "number" &&
      Number.isFinite(candidate.focalPoint.y)
        ? { x: clamp(candidate.focalPoint.x, 0, 1), y: clamp(candidate.focalPoint.y, 0, 1) }
        : { x: 0.5, y: 0.5 };
    const recommendedLayout =
      typeof candidate.recommendedLayout === "string" &&
      visualLayouts.includes(candidate.recommendedLayout as (typeof visualLayouts)[number])
        ? (candidate.recommendedLayout as (typeof visualLayouts)[number])
        : candidate.slideIndex === 0
          ? "cover"
          : "title-body";
    guidanceBySlide.set(candidate.slideIndex, {
      slideIndex: candidate.slideIndex,
      safeRegion,
      logoRegions: normalizeRegions(candidate.logoRegions),
      busyRegions: normalizeRegions(candidate.busyRegions),
      focalPoint: focal,
      recommendedLayout,
    });
  }

  // Only the guidance the model actually produced is kept. Synthesizing entries
  // for pages the model said nothing about used to fabricate a safe region and a
  // `title-body` layout, which the rule-based repair then applied as if the
  // model had asked for it. Missing guidance must stay missing.
  const slideGuidance = [...guidanceBySlide.values()].sort((left, right) => left.slideIndex - right.slideIndex);
  return visualReviewSchema.parse({ ...scores, issues, slideGuidance });
}
export const visualRepairPlanSchema = z.object({
  repairs: z.array(
    z.object({
      slideIndex: z.number().int().nonnegative(),
      layout: z.enum(["cover", "title-body", "split", "cards", "quote", "section", "summary"]).optional(),
      backgroundAction: z.enum(["keep", "replace-compatible", "simplify"]).default("keep"),
      hierarchyAction: z.enum(["keep", "strengthen-title", "reduce-density", "increase-whitespace"]).default("keep"),
      safeRegion: z
        .object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().positive().max(1),
          height: z.number().positive().max(1),
        })
        .optional(),
      obstacleRegions: z
        .array(
          z.object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().positive().max(1),
            height: z.number().positive().max(1),
          }),
        )
        .max(16)
        .default([]),
      elementActions: z
        .array(
          z.discriminatedUnion("action", [
            z.object({
              action: z.literal("move"),
              target: z.enum(["title", "body", "region"]),
              frame: z.object({
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
                width: z.number().positive().max(1),
                height: z.number().positive().max(1),
              }),
              to: z
                .object({
                  x: z.number().min(0).max(1),
                  y: z.number().min(0).max(1),
                  width: z.number().positive().max(1),
                  height: z.number().positive().max(1),
                })
                .optional(),
            }),
            z.object({
              action: z.literal("resize"),
              target: z.enum(["title", "body", "region"]),
              frame: z.object({
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
                width: z.number().positive().max(1),
                height: z.number().positive().max(1),
              }),
              to: z
                .object({
                  x: z.number().min(0).max(1),
                  y: z.number().min(0).max(1),
                  width: z.number().positive().max(1),
                  height: z.number().positive().max(1),
                })
                .optional(),
            }),
            z.object({
              action: z.literal("restyle"),
              target: z.enum(["title", "body", "region"]),
              fontScale: z.number().min(0.75).max(1.5).optional(),
              color: z
                .string()
                .regex(/^#[0-9A-Fa-f]{6}$/)
                .optional(),
            }),
            z.object({
              action: z.literal("align"),
              target: z.enum(["title", "body", "region"]),
              frame: z.object({
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
                width: z.number().positive().max(1),
                height: z.number().positive().max(1),
              }),
              axis: z.enum(["left", "top"]).optional(),
            }),
            z.object({
              action: z.literal("changeLayout"),
              layout: z.enum(["cover", "title-body", "split", "cards", "quote", "section", "summary"]),
            }),
          ]),
        )
        .max(12)
        .default([]),
      reason: z.string().min(1).max(500),
    }),
  ),
});
export type VisualRepairPlan = z.infer<typeof visualRepairPlanSchema>;
type RepairAction = VisualRepairPlan["repairs"][number]["elementActions"][number];

const repairLayouts = ["cover", "title-body", "split", "cards", "quote", "section", "summary"] as const;
const repairBackgroundActions = ["keep", "replace-compatible", "simplify"] as const;
const repairHierarchyActions = ["keep", "strengthen-title", "reduce-density", "increase-whitespace"] as const;
const repairTargets = ["title", "body", "region"] as const;

/**
 * Repairs bounded model-output mistakes in a repair plan.
 *
 * The plan comes from a model that looked at pictures, so its coordinates are
 * checked before they reach the renderer: a rectangle that leaves the page, a
 * slide that does not exist, or an action the renderer does not know is
 * dropped instead of applied. A plan that says nothing useful is rejected
 * outright, so the caller can fall back to the deterministic rule table.
 */
/**
 * A rectangle a repair may act on.
 *
 * A repair is an action, not a suggestion: a rectangle that leaves the page is
 * rejected instead of being pulled back into it, because a clamped rectangle
 * means something different from the one the model asked for.
 */
function repairRegion(value: unknown): NormalizedRegion | undefined {
  if (!isRecord(value)) return undefined;
  const raw = [value.x, value.y, value.width, value.height];
  if (raw.some((part) => typeof part !== "number" || !Number.isFinite(part))) return undefined;
  const x = value.x as number;
  const y = value.y as number;
  const width = value.width as number;
  const height = value.height as number;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return undefined;
  if (x + width > 1 || y + height > 1) return undefined;
  return { x, y, width, height };
}

export function normalizeVisualRepairPlan(input: unknown, expectedSlideIndexes: number[]): VisualRepairPlan {
  if (!isRecord(input) || !Array.isArray(input.repairs)) throw new Error("AI_REPAIR_RESPONSE_UNREPAIRABLE");
  const expected = new Set(expectedSlideIndexes.filter((index) => Number.isInteger(index) && index >= 0));
  const repairs = input.repairs
    .flatMap((candidate): VisualRepairPlan["repairs"] => {
      if (!isRecord(candidate) || typeof candidate.slideIndex !== "number" || !expected.has(candidate.slideIndex))
        return [];
      const layout =
        typeof candidate.layout === "string" &&
        repairLayouts.includes(candidate.layout as (typeof repairLayouts)[number])
          ? (candidate.layout as (typeof repairLayouts)[number])
          : undefined;
      const backgroundAction =
        typeof candidate.backgroundAction === "string" &&
        repairBackgroundActions.includes(candidate.backgroundAction as (typeof repairBackgroundActions)[number])
          ? (candidate.backgroundAction as (typeof repairBackgroundActions)[number])
          : "keep";
      const hierarchyAction =
        typeof candidate.hierarchyAction === "string" &&
        repairHierarchyActions.includes(candidate.hierarchyAction as (typeof repairHierarchyActions)[number])
          ? (candidate.hierarchyAction as (typeof repairHierarchyActions)[number])
          : "keep";
      const safeRegion = candidate.safeRegion === undefined ? undefined : normalizeRegion(candidate.safeRegion);
      const obstacleRegions = (Array.isArray(candidate.obstacleRegions) ? candidate.obstacleRegions : [])
        .map(normalizeRegion)
        .filter((region): region is NormalizedRegion => region !== undefined)
        .slice(0, 16);
      const elementActions = (Array.isArray(candidate.elementActions) ? candidate.elementActions : [])
        .flatMap((action): RepairAction[] => {
          if (!isRecord(action) || typeof action.action !== "string" || typeof action.target !== "string") return [];
          if (!repairTargets.includes(action.target as (typeof repairTargets)[number])) return [];
          const target = action.target as (typeof repairTargets)[number];
          if (action.action === "changeLayout") {
            if (
              typeof action.layout !== "string" ||
              !repairLayouts.includes(action.layout as (typeof repairLayouts)[number])
            )
              return [];
            return [{ action: "changeLayout", layout: action.layout as (typeof repairLayouts)[number] }];
          }
          if (action.action === "restyle") {
            const fontScale =
              typeof action.fontScale === "number" && Number.isFinite(action.fontScale)
                ? clamp(action.fontScale, 0.75, 1.5)
                : undefined;
            const color =
              typeof action.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(action.color) ? action.color : undefined;
            if (fontScale === undefined && color === undefined) return [];
            return [
              {
                action: "restyle",
                target,
                ...(fontScale === undefined ? {} : { fontScale }),
                ...(color === undefined ? {} : { color }),
              },
            ];
          }
          if (action.action !== "move" && action.action !== "resize" && action.action !== "align") return [];
          const region = repairRegion(action.frame);
          // A region repair without a usable rectangle has no meaning: the model
          // wanted to point at a place and did not say where.
          if (!region) return [];
          if (action.action === "align") {
            const axis = action.axis === "top" ? "top" : "left";
            return [{ action: "align", target, frame: region, axis }];
          }
          // A move of a region needs a destination. Without one the action is
          // dropped instead of being applied to a guessed place.
          const to = action.to === undefined ? undefined : repairRegion(action.to);
          if (target === "region" && !to) return [];
          return [{ action: action.action, target, frame: region, ...(to === undefined ? {} : { to }) }];
        })
        .slice(0, 12);
      const reason = typeof candidate.reason === "string" ? candidate.reason.trim().slice(0, 500) : "";
      if (!reason) return [];
      // A repair that ends up doing nothing is not a repair. Keeping it would
      // make the plan look busier than it is and hide the fact that the model
      // did not actually say what to change.
      if (
        elementActions.length === 0 &&
        layout === undefined &&
        backgroundAction === "keep" &&
        hierarchyAction === "keep"
      )
        return [];
      return [
        {
          slideIndex: candidate.slideIndex,
          ...(layout === undefined ? {} : { layout }),
          backgroundAction,
          hierarchyAction,
          ...(safeRegion === undefined ? {} : { safeRegion }),
          obstacleRegions,
          elementActions,
          reason,
        },
      ];
    })
    .slice(0, 20);
  if (repairs.length === 0) throw new Error("AI_REPAIR_RESPONSE_UNREPAIRABLE");
  return visualRepairPlanSchema.parse({ repairs });
}
export interface VisualAlignmentResult<T> {
  value: T;
  review: VisualReview;
  iterations: number;
  stopReason: "target-reached" | "stagnated" | "regressed" | "no-change" | "iteration-limit";
  /** True when the returned value is an earlier, better design rather than the last repair. */
  reverted: boolean;
}

export async function runVisualAlignmentLoop<T>(options: {
  initial: T;
  goal: PresentationVisualGoal;
  contentFingerprint: (value: T) => string;
  /**
   * Design fingerprint, used to stop when a repair plan does not actually
   * change anything. Without it the loop would export, render, and review the
   * same deck again for no reason.
   */
  stateFingerprint?: (value: T) => string;
  review: (value: T, goal: PresentationVisualGoal, iteration: number) => Promise<VisualReview>;
  repair: (value: T, review: VisualReview, goal: PresentationVisualGoal) => Promise<T>;
  maxIterations?: number;
}): Promise<VisualAlignmentResult<T>> {
  const maxIterations = Math.min(3, Math.max(1, options.maxIterations ?? 3));
  const approvedContent = options.contentFingerprint(options.initial);
  let value = options.initial;
  let previousScore = -1;
  let lastReview: VisualReview | undefined;
  // A repair that lowers the score must not become the deck the user gets.
  // Remember the best design seen so far and return that when the loop cannot
  // improve any further.
  let bestValue = options.initial;
  let bestReview: VisualReview | undefined;
  let bestScore = -1;
  const settled = (iterations: number, stopReason: VisualAlignmentResult<T>["stopReason"]) => {
    const finalReview = bestReview ?? lastReview;
    if (!finalReview) throw new Error("VISUAL_ALIGNMENT_REVIEW_MISSING");
    return { value: bestValue, review: finalReview, iterations, stopReason, reverted: bestValue !== value };
  };
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const review = visualReviewSchema.parse(await options.review(value, options.goal, iteration));
    lastReview = review;
    if (review.overallScore > bestScore) {
      bestScore = review.overallScore;
      bestValue = value;
      bestReview = review;
    }
    const reached =
      review.overallScore >= options.goal.minimumScores.overall &&
      review.hierarchyScore >= options.goal.minimumScores.hierarchy &&
      review.alignmentScore >= options.goal.minimumScores.alignment &&
      review.readabilityScore >= options.goal.minimumScores.readability &&
      review.consistencyScore >= options.goal.minimumScores.consistency &&
      !review.issues.some((issue) => issue.severity === "error");
    if (reached) return { value, review, iterations: iteration, stopReason: "target-reached", reverted: false };
    if (previousScore >= 0 && review.overallScore - previousScore < 3)
      return settled(iteration, review.overallScore < previousScore ? "regressed" : "stagnated");
    if (iteration === maxIterations) return settled(iteration, "iteration-limit");
    previousScore = review.overallScore;
    const repaired = await options.repair(value, review, options.goal);
    if (options.contentFingerprint(repaired) !== approvedContent) throw new Error("VISUAL_ALIGNMENT_CONTENT_MUTATION");
    if (options.stateFingerprint && options.stateFingerprint(repaired) === options.stateFingerprint(value))
      return settled(iteration, "no-change");
    value = repaired;
  }
  throw new Error(lastReview ? "VISUAL_ALIGNMENT_ITERATION_INVALID" : "VISUAL_ALIGNMENT_REVIEW_MISSING");
}

export const defaultPresentationVisualGoal = (): PresentationVisualGoal => ({
  style: "editorial",
  mood: "modern",
  density: "medium",
  alignment: "left-grid",
  backgroundRhythm: { coverVariants: 1, contentVariants: 3, repeatLimit: 2 },
  minimumScores: { overall: 85, hierarchy: 82, alignment: 90, readability: 88, consistency: 85 },
});

/**
 * The pages a repair round may touch.
 *
 * Errors always count. Warnings only count when the deck is below the goal in
 * at least one dimension. Judging only the overall score let a deck with a
 * failing readability/hierarchy threshold pass this filter, so every warning
 * was discarded and the loop stopped with "no-change" while still below the
 * goal.
 */
export function affectedSlideIndexes(
  review: VisualReview,
  minimum: number | PresentationVisualGoal["minimumScores"] = 85,
): number[] {
  const belowTarget =
    typeof minimum === "number"
      ? review.overallScore < minimum
      : review.overallScore < minimum.overall ||
        review.hierarchyScore < minimum.hierarchy ||
        review.alignmentScore < minimum.alignment ||
        review.readabilityScore < minimum.readability ||
        review.consistencyScore < minimum.consistency;
  return [
    ...new Set(
      review.issues
        .filter((issue) => issue.severity === "error" || belowTarget)
        .map((issue) => issue.slideIndex),
    ),
  ].sort((left, right) => left - right);
}
