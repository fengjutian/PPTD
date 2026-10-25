import type { AiSlideDesign } from "../core/commands/commands";
import { type PresentationDocument } from "../core/document-model";
import { type PresentationQualityIssue } from "./presentation-quality-gate";
import { type RenderedContrastReport } from "./presentation-renderer";
import { CONCEPT_SCORE_THRESHOLD, type PresentationVisualGoal, type VisualReview } from "./visual-alignment";
import { type TemplateFitReport, type TemplateReviewTarget } from "./template-review-target";
import { type VisionReviewPort } from "./vision-review-port";

/** 一次请求最多评审的页数。 */
const REVIEW_BATCH_SIZE = 6;

export interface DesignQualityStageOptions {
  /** AI 设计阶段产出的逐页设计。 */
  initialDesigns: AiSlideDesign[];
  /** 用给定设计重建文档快照。视觉评审和质检都在快照上跑。 */
  buildDocument: (designs: AiSlideDesign[]) => PresentationDocument;
  goal: PresentationVisualGoal;
  /**
   * The uploaded template compiled into a measurable target. When present the
   * review prompt, the deterministic fit check, the repair planner and the
   * report all use it; absent means the deck was generated from a preset.
   */
  template?: TemplateReviewTarget;
  /** 已审核内容的指纹：视觉修复不得改变它。 */
  contentFingerprint: (designs: AiSlideDesign[]) => string;
  vision: VisionReviewPort;
  taskId: number;
  isCancelled: () => boolean;
  /** 阶段进度回报，用于界面显示真实进度。 */
  onProgress?: (label: string, percent: number) => void;
  /** 渲染评审图。测试可替换，真实运行走画布渲染。 */
  renderForReview?: (document: PresentationDocument) => Promise<{ slides: string[]; contactSheet: string }>;
  /**
   * 渲染导出后的真实 PPTX。评审模型看的应该是用户最终会看到的画面，而不是
   * 画布上的一次近似重绘。本机没有 PowerPoint 时命令失败，评审降级到画布
   * 渲染继续进行。
   */
  renderRealPptxForReview?: (
    document: PresentationDocument,
    options?: { slideIndexes?: number[]; previousSlides?: string[] },
  ) => Promise<{ slides: string[]; contactSheet: string }>;
  /** 采样文字下方真实像素。测试可替换。 */
  inspectContrast?: (document: PresentationDocument) => Promise<RenderedContrastReport>;
  /** 确定性质量门。测试可替换。 */
  validateQuality?: (
    document: PresentationDocument,
    designs: AiSlideDesign[],
  ) => { passed: boolean; issues: PresentationQualityIssue[] };
}

export interface DesignQualityStageResult {
  designs: AiSlideDesign[];
  document: PresentationDocument;
  /** 人类可读的阶段说明：评审轮次、降级原因、质量门结果。 */
  notes: string[];
  /** 未通过质量门的具体问题。 */
  issues: PresentationQualityIssue[];
  /** 质量门是否通过。通过与否都不影响文档产出。 */
  passed: boolean;
  /** 是否发生过降级（视觉评审不可用、底图无法渲染等）。 */
  degraded: boolean;
  /**
   * 视觉评审的最终结论：评分、逐页建议和模型给出的安全区。
   *
   * 这是评审过程留下的唯一结构化记录。整体降级到确定性校验时为 undefined，
   * 调用方不能把"没有结论"当成"检查通过"。
   */
  visualReview?: VisualReview;
  /** 最终采用的评审轮次实际覆盖的页数与总页数。未评审时为空。 */
  visualReviewCoverage?: { reviewed: number; total: number };
  /**
   * 视觉评审是否达到目标且覆盖全部页面。
   *
   * `undefined` 表示没有运行（例如用户关闭了视觉评审）；`false` 表示运行了但
   * 未达标、覆盖不完整或整体失败。调用方不能用确定性质检通过代替这一项。
   */
  visualPassed?: boolean;
  /** 最终采用轮次的整册缩略图墙，可直接在报告中展示。 */
  contactSheet?: string;
  /**
   * Deterministic template adherence of the adopted round. Undefined when the
   * deck was generated without an uploaded template.
   */
  templateFit?: TemplateFitReport;
  /**
   * What the visual conclusion is actually based on.
   *
   * "final" means the exported PPTX was rasterized by PowerPoint; "layout"
   * means the canvas approximation was reviewed; "indicator" means no visual
   * review ran and only deterministic checks contributed.
   */
  visualEvidence?: ReviewEvidence;
  /** 只看整册缩略图所得的节奏、一致性和主题结论。 */
  deckReview?: VisualReview;
  /** 最终采用轮次中逐页评审的请求与复用数量。 */
  reviewReuse?: { reviewed: number; reused: number };
}

/** 取消不是失败：取消必须一路向上抛出，不能被降级逻辑吞掉。 */
export interface ReviewEvidence {
  renderer: "powerpoint" | "canvas" | "none";
  evidence: "final" | "layout" | "indicator";
  /** Why the stronger evidence was not available. */
  reason?: string;
}

export function isGenerationCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("AI_GENERATION_CANCELLED") || message.includes("AI_REQUEST_CANCELLED");
}

export function mergeReviews(reviews: VisualReview[], overview?: VisualReview): VisualReview {
  // 逐页评分按页合并；同一页出现多次时保留最后一个，不重复累加。
  const slideScores = [
    ...new Map(reviews.flatMap((item) => item.slideScores ?? []).map((item) => [item.slideIndex, item])).values(),
  ].sort((left, right) => left.slideIndex - right.slideIndex);
  // 批次分是模型对一批页的整体判断，不能盖过它自己给出的低分页。把逐页
  // 分数也放进最小值，弱页才不会因为同批其他页好看而被静默放行。逐页分数
  // 仍然不单独授权修复：修复只由具体问题（issues）触发。
  const minimumScore = (key: "overallScore" | "hierarchyScore" | "alignmentScore" | "readabilityScore") =>
    Math.min(...reviews.map((item) => item[key]), ...slideScores.map((item) => item[key]));
  return {
    overallScore: minimumScore("overallScore"),
    hierarchyScore: minimumScore("hierarchyScore"),
    alignmentScore: minimumScore("alignmentScore"),
    readabilityScore: minimumScore("readabilityScore"),
    // Cross-page consistency is only observable from the deck overview. Take it
    // from the batch that actually saw the contact sheet; other batches only
    // compared themselves.
    consistencyScore: overview?.consistencyScore ?? Math.min(...reviews.map((item) => item.consistencyScore)),
    ...(overview?.repetitionScore !== undefined || reviews.some((item) => item.repetitionScore !== undefined)
      ? {
          repetitionScore:
            overview?.repetitionScore ??
            Math.min(...reviews.map((item) => item.repetitionScore ?? item.consistencyScore)),
        }
      : {}),
    ...(overview?.themeFitScore !== undefined || reviews.some((item) => item.themeFitScore !== undefined)
      ? {
          themeFitScore:
            overview?.themeFitScore ?? Math.min(...reviews.map((item) => item.themeFitScore ?? item.consistencyScore)),
        }
      : {}),
    ...(reviews.some((item) => item.visualFocusScore !== undefined)
      ? { visualFocusScore: Math.min(...reviews.map((item) => item.visualFocusScore ?? item.hierarchyScore)) }
      : {}),
    ...(reviews.some((item) => item.distinctivenessScore !== undefined) ||
    slideScores.some((item) => item.distinctivenessScore !== undefined)
      ? {
          distinctivenessScore: Math.min(
            ...reviews.map((item) => item.distinctivenessScore ?? item.overallScore),
            ...slideScores.map((item) => item.distinctivenessScore ?? item.overallScore),
          ),
        }
      : {}),
    ...(overview?.conceptScore !== undefined ||
    reviews.some((item) => item.conceptScore !== undefined) ||
    slideScores.some((item) => item.conceptScore !== undefined)
      ? {
          conceptScore:
            overview?.conceptScore ??
            Math.min(
              ...reviews.map((item) => item.conceptScore ?? 100),
              ...slideScores.map((item) => item.conceptScore ?? 100),
            ),
        }
      : {}),
    ...(overview?.conceptCapApplied ||
    reviews.some((item) => item.conceptCapApplied) ||
    slideScores.some((item) => item.conceptScore !== undefined && item.conceptScore < CONCEPT_SCORE_THRESHOLD)
      ? { conceptCapApplied: true }
      : {}),
    issues: reviews.flatMap((item) => item.issues),
    slideGuidance: reviews.flatMap((item) => item.slideGuidance),
    ...(slideScores.length > 0 ? { slideScores } : {}),
  };
}

export type SlideScore = NonNullable<VisualReview["slideScores"]>[number];

/** 逐页评审缓存：只有模型为每一页都返回了分数，才能安全地按页复用。 */
export type SlideReviewCache = {
  source: "真实 PPTX" | "画布预览";
  slideCount: number;
  entries: Map<number, { signature: string; review: VisualReview }>;
};

export type ReviewBatchPlan =
  | { kind: "reuse"; review: VisualReview }
  | { kind: "assemble"; review: VisualReview }
  | { kind: "full"; indexes: number[]; batchIndexes: number[] }
  | { kind: "subset"; indexes: number[]; batchIndexes: number[] };

/** 每轮评审的覆盖与降级信息；最终结论可能来自较早的一轮。 */
export type ReviewRound = {
  coverage: { reviewed: number; total: number };
  partialReason?: string;
  deckUnavailable?: string;
  source?: "真实 PPTX" | "画布预览";
  realRenderFailure?: string;
  contactSheet?: string;
  deckReview?: VisualReview;
  reviewReuse?: { reviewed: number; reused: number };
  /** Deterministic template fit measured on the same document snapshot. */
  templateFit?: TemplateFitReport;
};

/**
 * 把一次批次响应拆成单页结论。
 *
 * 只有请求的每一页都有 `slideScores` 时才拆：少一页就无法判断缺失页的
 * 分数，宁可回退到整批口径，也不能把批次分当成单页分。
 */
export function splitBatchReview(review: VisualReview, indexes: number[]): Map<number, VisualReview> | undefined {
  const scores = new Map((review.slideScores ?? []).map((score) => [score.slideIndex, score]));
  const split = new Map<number, VisualReview>();
  for (const slideIndex of indexes) {
    const score = scores.get(slideIndex);
    if (!score) return undefined;
    split.set(slideIndex, slideReviewFromBatch(review, slideIndex, score));
  }
  return split;
}

/**
 * 从一次批次响应里取单页结论。
 *
 * 有该页分数时用该页分数；没有时只能用批次分近似，因此这种结论不会写进
 * 逐页缓存，下一轮仍会重新检查该页。
 */
export function slideReviewFromBatch(review: VisualReview, slideIndex: number, score?: SlideScore): VisualReview {
  const ownScore = score ?? review.slideScores?.find((item) => item.slideIndex === slideIndex);
  return {
    overallScore: ownScore?.overallScore ?? review.overallScore,
    hierarchyScore: ownScore?.hierarchyScore ?? review.hierarchyScore,
    alignmentScore: ownScore?.alignmentScore ?? review.alignmentScore,
    readabilityScore: ownScore?.readabilityScore ?? review.readabilityScore,
    consistencyScore: review.consistencyScore,
    ...(ownScore?.distinctivenessScore === undefined ? {} : { distinctivenessScore: ownScore.distinctivenessScore }),
    ...(ownScore?.conceptScore === undefined ? {} : { conceptScore: ownScore.conceptScore }),
    issues: review.issues.filter((issue) => issue.slideIndex === slideIndex),
    slideGuidance: review.slideGuidance.filter((item) => item.slideIndex === slideIndex),
    ...(ownScore ? { slideScores: [ownScore] } : {}),
  };
}

/** 用逐页结论拼回一批的结论；分数取页分数的最小值，保持保守口径。 */
export function batchReviewFromSlides(
  indexes: number[],
  reviews: Map<number, VisualReview>,
  consistencyScore: number,
): VisualReview | undefined {
  const ordered = indexes.map((slideIndex) => reviews.get(slideIndex));
  if (ordered.some((item) => item === undefined)) return undefined;
  const present = ordered as VisualReview[];
  const slideScores = present
    .flatMap((item) => item.slideScores ?? [])
    .sort((left, right) => left.slideIndex - right.slideIndex);
  return {
    overallScore: Math.min(...present.map((item) => item.overallScore)),
    hierarchyScore: Math.min(...present.map((item) => item.hierarchyScore)),
    alignmentScore: Math.min(...present.map((item) => item.alignmentScore)),
    readabilityScore: Math.min(...present.map((item) => item.readabilityScore)),
    consistencyScore,
    ...(present.some((item) => item.distinctivenessScore !== undefined)
      ? {
          distinctivenessScore: Math.min(...present.map((item) => item.distinctivenessScore ?? item.overallScore)),
        }
      : {}),
    ...(present.some((item) => item.conceptScore !== undefined)
      ? { conceptScore: Math.min(...present.map((item) => item.conceptScore ?? 100)) }
      : {}),
    issues: present.flatMap((item) => item.issues),
    slideGuidance: present.flatMap((item) => item.slideGuidance),
    ...(slideScores.length > 0 ? { slideScores } : {}),
  };
}
