import type { PresentationDocument } from "../core/document-model";
import type { PresentationRender } from "./presentation-renderer";
import { renderPresentationForVisualReview } from "./presentation-renderer";
import type { PresentationVisualGoal, VisualReview } from "./visual-alignment";
import type { VisionReviewPort } from "./vision-review-port";

const BATCH_SIZE = 6;

export interface ManualVisualReviewResult {
  review: VisualReview;
  deckReview?: VisualReview;
  render: PresentationRender;
  reviewedIndexes: number[];
  source: "真实 PPTX" | "画布预览";
  degradedReason?: string;
}

function mergeManualReviews(reviews: VisualReview[], deckReview?: VisualReview): VisualReview {
  const scores = reviews.flatMap((review) => review.slideScores ?? []).sort((a, b) => a.slideIndex - b.slideIndex);
  const minimum = (key: "overallScore" | "hierarchyScore" | "alignmentScore" | "readabilityScore") =>
    Math.min(...reviews.map((review) => review[key]), ...scores.map((score) => score[key]));
  return {
    overallScore: minimum("overallScore"),
    hierarchyScore: minimum("hierarchyScore"),
    alignmentScore: minimum("alignmentScore"),
    readabilityScore: minimum("readabilityScore"),
    consistencyScore: deckReview?.consistencyScore ?? Math.min(...reviews.map((review) => review.consistencyScore)),
    ...(deckReview?.repetitionScore !== undefined ? { repetitionScore: deckReview.repetitionScore } : {}),
    ...(deckReview?.themeFitScore !== undefined ? { themeFitScore: deckReview.themeFitScore } : {}),
    ...(reviews.some((review) => review.visualFocusScore !== undefined)
      ? { visualFocusScore: Math.min(...reviews.map((review) => review.visualFocusScore ?? review.hierarchyScore)) }
      : {}),
    issues: reviews.flatMap((review) => review.issues),
    slideGuidance: reviews.flatMap((review) => review.slideGuidance),
    ...(scores.length > 0 ? { slideScores: scores } : {}),
  };
}

export async function runManualVisualReview(options: {
  document: PresentationDocument;
  indexes: number[];
  goal: PresentationVisualGoal;
  vision: VisionReviewPort;
  taskId: number;
  renderReal?: (document: PresentationDocument) => Promise<PresentationRender>;
  renderCanvas?: (document: PresentationDocument) => Promise<PresentationRender>;
}): Promise<ManualVisualReviewResult> {
  const reviewedIndexes = [...new Set(options.indexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < options.document.slides.length)
    .sort((a, b) => a - b);
  if (reviewedIndexes.length === 0) throw new Error("VISUAL_REVIEW_SCOPE_EMPTY");

  let render: PresentationRender;
  let source: ManualVisualReviewResult["source"] = "真实 PPTX";
  let degradedReason: string | undefined;
  try {
    if (!options.renderReal) throw new Error("REVIEW_RASTERER_UNAVAILABLE");
    render = await options.renderReal(options.document);
  } catch (error) {
    degradedReason = error instanceof Error ? error.message : String(error);
    source = "画布预览";
    render = await (options.renderCanvas ?? renderPresentationForVisualReview)(options.document);
  }

  const batches: number[][] = [];
  for (let start = 0; start < reviewedIndexes.length; start += BATCH_SIZE)
    batches.push(reviewedIndexes.slice(start, start + BATCH_SIZE));
  const [pageOutcomes, deckOutcome] = await Promise.all([
    Promise.all(
      batches.map((indexes) =>
        options.vision.review(render, options.goal, indexes, options.taskId, { includeContactSheet: false }),
      ),
    ),
    options.vision.reviewDeck?.(render, options.goal, options.taskId),
  ]);
  return {
    review: mergeManualReviews(pageOutcomes, deckOutcome),
    deckReview: deckOutcome,
    render,
    reviewedIndexes,
    source,
    degradedReason,
  };
}
