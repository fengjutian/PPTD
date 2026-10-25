import { colorLuminance, contrastRatioAgainstLuminance } from "../core/rendering/contrast";
import type { AiElementRepair, AiSlideDesign } from "../core/commands/commands";
import {
  documentContentFingerprint as coreDocumentContentFingerprint,
  type PresentationDocument,
} from "../core/document-model";
import { validatePresentationVisualQuality, type PresentationQualityIssue } from "./presentation-quality-gate";
import {
  inspectRenderedTextContrast,
  renderPresentationForVisualReview,
  type RenderedContrastIssue,
  type RenderedContrastReport,
} from "./presentation-renderer";
import {
  affectedSlideIndexes,
  CONCEPT_SCORE_THRESHOLD,
  runVisualAlignmentLoop,
  type PresentationVisualGoal,
  type VisualReview,
} from "./visual-alignment";
import {
  checkTemplateFit,
  templateFitVisualIssues,
  templateTargetForPrompt,
  templateTargetForSlide,
  type TemplateFitReport,
  type TemplateReviewTarget,
} from "./template-review-target";
import { MAX_REVIEWED_SLIDES, type VisionReviewPort } from "./vision-review-port";

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

function mergeReviews(reviews: VisualReview[], overview?: VisualReview): VisualReview {
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

type SlideScore = NonNullable<VisualReview["slideScores"]>[number];

/** 逐页评审缓存：只有模型为每一页都返回了分数，才能安全地按页复用。 */
type SlideReviewCache = {
  source: "真实 PPTX" | "画布预览";
  slideCount: number;
  entries: Map<number, { signature: string; review: VisualReview }>;
};

type ReviewBatchPlan =
  | { kind: "reuse"; review: VisualReview }
  | { kind: "assemble"; review: VisualReview }
  | { kind: "full"; indexes: number[]; batchIndexes: number[] }
  | { kind: "subset"; indexes: number[]; batchIndexes: number[] };

/** 每轮评审的覆盖与降级信息；最终结论可能来自较早的一轮。 */
type ReviewRound = {
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
function splitBatchReview(review: VisualReview, indexes: number[]): Map<number, VisualReview> | undefined {
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
function slideReviewFromBatch(review: VisualReview, slideIndex: number, score?: SlideScore): VisualReview {
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
function batchReviewFromSlides(
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

/** 把视觉评审失败的错误码翻译成用户能读懂的一句话。 */
export function describeVisualReviewFailure(reason: string): string {
  if (reason.includes("AI_VISION_SLIDE_COUNT_INVALID")) return `文稿页数超过视觉评审上限（${MAX_REVIEWED_SLIDES} 页）`;
  if (reason.includes("AI_VISION_DISABLED")) return "视觉评审已在设置中关闭，只做确定性校验";
  if (reason.includes("VISUAL_ALIGNMENT_CONTENT_MUTATION")) return "视觉修复试图修改已审核内容，已拒绝该轮修复";
  return reason;
}

/** 把真实渲染失败的错误码翻译成用户能读懂的一句话。 */
export function describeRealRenderFailure(reason: string): string {
  if (reason.includes("REVIEW_RASTERER_UNAVAILABLE")) return "本机没有可用的 PowerPoint 渲染";
  if (reason.includes("REVIEW_RASTER_TIMEOUT")) return "PowerPoint 渲染超时";
  if (reason.includes("REVIEW_RASTER_FAILED")) return "PowerPoint 渲染失败";
  if (reason.includes("REVIEW_RASTER_TASK_FAILED")) return "PowerPoint 渲染任务未完成";
  if (reason.includes("EXPORT_VALIDATION_FAILED")) return "导出的文稿未通过校验";
  return reason;
}

function contrastIssues(issues: RenderedContrastIssue[]): PresentationQualityIssue[] {
  return issues.map((issue) => ({
    slideIndex: issue.slideIndex,
    elementIds: [issue.elementId],
    issue: "low-contrast" as const,
    message: `文字与承载背景的对比度不足（${issue.contrastRatio.toFixed(2)}:1）`,
  }));
}

const issueLabels: Record<PresentationQualityIssue["issue"], string> = {
  "out-of-bounds": "文本框超出页面边界",
  "text-overlap": "文本框互相重叠",
  "obstacle-overlap": "文本压住 Logo 或页脚",
  "low-contrast": "文字对比度不足",
  "text-overflow": "文本超出文本框容量",
  "underfilled-columns": "双栏正文只占页面上半部",
  "underfilled-page": "正文只占页面上半部，下方连续空白",
};

/**
 * 已审核内容的指纹：标题、正文、结构化块、备注和页序。
 *
 * 视觉修复的守卫必须从真实文档快照计算，而不是从闭包里某个生成时的草稿
 * 常量计算。否则比较两边的都是同一个常量，守卫永远不会触发。
 */
export function documentContentFingerprint(document: PresentationDocument): string {
  return coreDocumentContentFingerprint(document);
}

/** 把质量问题汇总成一句用户能读懂的话：哪些页、什么问题、多少处。 */
export function summarizeQualityIssues(issues: PresentationQualityIssue[]): string {
  if (issues.length === 0) return "";
  const byKind = new Map<PresentationQualityIssue["issue"], number[]>();
  issues.forEach((issue) => byKind.set(issue.issue, [...(byKind.get(issue.issue) ?? []), issue.slideIndex + 1]));
  return [...byKind.entries()]
    .map(([kind, pages]) => `${issueLabels[kind]} ${pages.length} 处（第 ${[...new Set(pages)].join("、")} 页）`)
    .join("；");
}

/**
 * AI 设计之后的质检阶段：视觉评审 → 像素对比度修复 → 确定性质量门。
 *
 * 这一段只做判断和修复，不决定"要不要给用户这份 PPT"。视觉模型不可用、
 * 底图无法渲染、厂商报错都只降级并记录原因；质量门未过时问题会被完整
 * 列出，但文档照常产出，由调用方决定如何提示。
 */
export async function runDesignQualityStage(options: DesignQualityStageOptions): Promise<DesignQualityStageResult> {
  const notes: string[] = [];
  let designs = options.initialDesigns;
  let degraded = false;
  /** 视觉评审是否达标；没有运行（例如用户关闭）时保持 undefined。 */
  let visualPassed: boolean | undefined;
  const renderForReview = options.renderForReview ?? renderPresentationForVisualReview;
  const inspect = options.inspectContrast ?? inspectRenderedTextContrast;
  /** 评审实际看到的画面来自哪里。 */
  let reviewSource: "真实 PPTX" | "画布预览" | undefined;
  /** 最终采用结论所在的那一轮，用于报告证据等级。 */
  let finalReviewRound: ReviewRound | undefined;
  /** Template fit measured on the adopted review round, if a template was supplied. */
  let adoptedTemplateFit: TemplateFitReport | undefined;
  /** 真实渲染走不通的原因。 */
  let realRenderFailure: string | undefined;
  /** 最近一轮评审实际覆盖的页数和总页数。 */
  let reviewedSlideCount = 0;
  let reviewSlideCount = 0;
  /** 每轮评审的覆盖与降级信息；返回的结论可能来自更早的一轮。 */
  const reviewRounds = new Map<number, ReviewRound>();
  /** 部分批次失败的原因，评审不能因为一批失败就整体作废。 */
  let partialReviewReason: string | undefined;
  /** 整册总览评审失败的原因。失败时跨页一致性只能退回批内评分。 */
  let deckReviewUnavailable: string | undefined;
  /** 上一轮成功渲染的设计与整册画面，用于只重画变化页。 */
  let lastRealRender: { designs: AiSlideDesign[]; slides: string[]; contactSheet: string } | undefined;
  /**
   * 上一轮逐页评审的批次签名与结论。
   *
   * 修复通常只动一两页，其余页面的渲染图与设计都没变；再上传一遍既费 token
   * 又拖慢墙钟时间。签名按整批设计计算：批内任何一页变了，整批重新评审。
   */
  let pageReviewCache:
    | {
        source: "真实 PPTX" | "画布预览";
        signatures: string[];
        reviews: Array<VisualReview | undefined>;
      }
    | undefined;
  /**
   * 逐页评审缓存。批内只有一两页变化时，只上传这些页，其余页沿用上一轮
   * 结论；模型没有返回逐页分数的页不会写进来，下一轮仍按整批重看。
   */
  let slideReviewCache: SlideReviewCache | undefined;
  /** 评审最终留下的结构化结论，随结果一起返回给界面。 */
  let visualReview: VisualReview | undefined;
  let visualReviewCoverage: { reviewed: number; total: number } | undefined;
  let contactSheet: string | undefined;
  let finalDeckReview: VisualReview | undefined;
  let reviewReuse: { reviewed: number; reused: number } | undefined;
  /**
   * 当前视觉评审轮次，供修复进度复用。
   *
   * 修复发生在同一轮评审之后，它本身不带轮次参数；从评审里记下来，修复
   * 进度才不会在第 2、3 轮时又跳回起点。
   */
  let currentIteration = 1;
  /**
   * 每轮评审占 4 个百分点：渲染、检查、修复各占一段，最多 3 轮。
   *
   * 质检阶段整体落在 84–99 之间，100 由调用方在真正完成后设置。第二轮和
   * 第三轮的百分比继续往上走，进度条不会因为"重来一遍"而倒退。
   */
  const roundBase = (iteration: number) => 84 + Math.min(iteration - 1, 2) * 4;

  try {
    const aligned = await runVisualAlignmentLoop<AiSlideDesign[]>({
      initial: designs,
      goal: options.goal,
      contentFingerprint: options.contentFingerprint,
      stateFingerprint: (value) => JSON.stringify(value),
      review: async (current, goal, iteration) => {
        currentIteration = iteration;
        if (options.isCancelled()) throw new Error("AI_GENERATION_CANCELLED");
        options.onProgress?.(`第 ${iteration} 轮视觉评审：导出并渲染真实 PPTX`, roundBase(iteration));
        realRenderFailure = undefined;
        // 本轮还没有产出任何评审结论。渲染失败时不能用上一轮的覆盖数字
        // 描述这一轮，否则会出现“未完成，但覆盖 7/7 页”的矛盾报告。
        reviewedSlideCount = 0;
        reviewSlideCount = 0;
        const document = options.buildDocument(current);
        // The deterministic template check runs on the same snapshot as the
        // rendered review. It is not a model score: it measures the title axis,
        // content bounds and placeholder type size against the uploaded
        // template, so a generous model cannot talk the deck past the template.
        const templateFit = options.template ? checkTemplateFit(document, options.template) : undefined;
        const promptTemplate = options.template ? templateTargetForPrompt(options.template, document) : undefined;
        // 优先评审真实导出的 PPTX。画布渲染是近似值：PowerPoint 自行断行，
        // 字体度量与估算略有出入，图表和表格更是由 PowerPoint 自己画的。
        // 只有真实渲染走不通时才退回画布预览。
        let real: { slides: string[]; contactSheet: string } | undefined;
        if (options.renderRealPptxForReview) {
          try {
            const previous = lastRealRender;
            // 只有设计真的变了的页需要重画。未变化的页沿用上一轮的图，
            // 缩略图墙仍由整册画面重新拼。
            const changed = previous
              ? current.flatMap((design, slideIndex) =>
                  JSON.stringify(design) === JSON.stringify(previous.designs[slideIndex]) ? [] : [slideIndex],
                )
              : undefined;
            if (previous && changed && changed.length === 0) {
              real = { slides: previous.slides, contactSheet: previous.contactSheet };
            } else {
              real = await options.renderRealPptxForReview(document, {
                slideIndexes: changed,
                previousSlides: previous?.slides,
              });
              lastRealRender = {
                designs: structuredClone(current),
                slides: real.slides,
                contactSheet: real.contactSheet,
              };
            }
          } catch (error) {
            if (isGenerationCancelled(error)) throw error;
            realRenderFailure = error instanceof Error ? error.message : String(error);
          }
        }
        const render = real ?? (await renderForReview(document));
        reviewSource = real ? "真实 PPTX" : "画布预览";
        // 逐页评审按每批 6 页切分。串行会让 20 页文稿排四队带图请求，
        // 每一队都要等上一队跑完；并行后墙钟时间接近单批耗时。
        const batches: number[][] = [];
        for (let start = 0; start < render.slides.length; start += REVIEW_BATCH_SIZE) {
          batches.push(render.slides.slice(start, start + REVIEW_BATCH_SIZE).map((_, offset) => start + offset));
        }
        options.onProgress?.(`第 ${iteration} 轮视觉评审：检查 ${render.slides.length} 页`, roundBase(iteration) + 3);
        // 一批超时或返回不合法，不应该把其他批次的结论一起扔掉：保留已经
        // 评审完的页，并把覆盖范围如实报告出来。
        reviewedSlideCount = 0;
        reviewSlideCount = render.slides.length;
        partialReviewReason = undefined;
        deckReviewUnavailable = undefined;
        // 每批的设计签名。批内没有变化时可以直接复用上一轮的评审结论，
        // 不必把同一批图片再上传一次。
        const signatures = batches.map((indexes) => JSON.stringify(indexes.map((slideIndex) => current[slideIndex])));
        const slideSignatures = current.map((design) => JSON.stringify(design));
        // 逐页缓存按渲染来源和页数隔离。换来源或页数变化时整份作废，
        // 避免把另一套画面或另一页的结论套到当前页上。
        if (
          !slideReviewCache ||
          slideReviewCache.source !== reviewSource ||
          slideReviewCache.slideCount !== render.slides.length
        ) {
          slideReviewCache = { source: reviewSource, slideCount: render.slides.length, entries: new Map() };
        }
        const slideCache = slideReviewCache;
        const hasDeckReview = options.vision.reviewDeck !== undefined;
        const reusable =
          pageReviewCache &&
          pageReviewCache.source === reviewSource &&
          pageReviewCache.signatures.length === signatures.length
            ? pageReviewCache
            : undefined;
        const plans = batches.map((batchIndexes, batchIndex): ReviewBatchPlan => {
          const cached = reusable?.reviews[batchIndex];
          // 没有专门的整册评审时，第一批携带缩略图，跨页一致性会随其他页
          // 变化；这一批必须重新看，不能复用上一轮的结论。
          const canReuse =
            cached !== undefined &&
            reusable?.signatures[batchIndex] === signatures[batchIndex] &&
            (hasDeckReview || batchIndex !== 0);
          if (canReuse) return { kind: "reuse", review: cached };
          // 第一批没有整册评审时不能只传变化页：缩略图必须重拼，跨页一致性
          // 只能由看过整册的那一批给出。
          if (!hasDeckReview && batchIndex === 0) {
            return { kind: "full", indexes: batchIndexes, batchIndexes };
          }
          // 只有缺少当前设计结论的页才需要上传。其余页的结论与当前设计
          // 一一对应，可以按页复用。
          const needsReview = batchIndexes.filter((slideIndex) => {
            const entry = slideCache.entries.get(slideIndex);
            return entry === undefined || entry.signature !== slideSignatures[slideIndex];
          });
          if (needsReview.length === 0) {
            // 整批都有当前结论，只是上一轮的批次请求失败了：直接拼回，
            // 不再为同一批图片多发一次请求。
            const bySlide = new Map<number, VisualReview>(
              batchIndexes.map((slideIndex) => [slideIndex, slideCache.entries.get(slideIndex)!.review] as const),
            );
            const assembled = batchReviewFromSlides(
              batchIndexes,
              bySlide,
              Math.min(...[...bySlide.values()].map((item) => item.consistencyScore)),
            );
            if (assembled) return { kind: "assemble", review: assembled };
          }
          if (needsReview.length > 0 && needsReview.length < batchIndexes.length) {
            return { kind: "subset", indexes: needsReview, batchIndexes };
          }
          return { kind: "full", indexes: batchIndexes, batchIndexes };
        });
        const pageReviews = plans.map((plan, batchIndex) => {
          if (plan.kind === "reuse" || plan.kind === "assemble") return Promise.resolve(plan.review);
          return options.vision.review(render, goal, plan.indexes, options.taskId, {
            // 有专门的整册评审时，逐页批次不再重复上传缩略图。
            includeContactSheet: !hasDeckReview && batchIndex === 0,
            ...(promptTemplate === undefined ? {} : { template: promptTemplate }),
          });
        });
        const deckReview = options.vision.reviewDeck
          ? options.vision.reviewDeck(
              render,
              goal,
              options.taskId,
              promptTemplate === undefined ? undefined : { template: promptTemplate },
            )
          : undefined;
        const outcomes = await Promise.allSettled([...pageReviews, ...(deckReview ? [deckReview] : [])]);
        const reviews: VisualReview[] = [];
        const collected: Array<VisualReview | undefined> = new Array(batches.length).fill(undefined);
        let overviewReview: VisualReview | undefined;
        outcomes.forEach((outcome, index) => {
          const isDeck = index >= batches.length;
          if (isDeck) {
            if (outcome.status === "fulfilled") {
              overviewReview = outcome.value;
              return;
            }
            if (isGenerationCancelled(outcome.reason)) throw outcome.reason;
            deckReviewUnavailable ??= outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
            return;
          }
          const plan = plans[index]!;
          if (outcome.status === "rejected") {
            if (isGenerationCancelled(outcome.reason)) throw outcome.reason;
            partialReviewReason ??= outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
            // 请求失败不等于已有的逐页结论失效：设计没变的页仍沿用上一轮
            // 结论。只把真正有当前结论的页计入覆盖；失败批次本身不写缓存，
            // 下一轮仍会重试缺少的页。
            if (plan.kind === "full" || plan.kind === "subset") {
              const salvaged = new Map<number, VisualReview>();
              for (const slideIndex of plan.batchIndexes) {
                const entry = slideCache.entries.get(slideIndex);
                if (entry && entry.signature === slideSignatures[slideIndex]) {
                  salvaged.set(slideIndex, entry.review);
                }
              }
              if (salvaged.size > 0) {
                const partial = batchReviewFromSlides(
                  [...salvaged.keys()].sort((left, right) => left - right),
                  salvaged,
                  Math.min(...[...salvaged.values()].map((item) => item.consistencyScore)),
                );
                if (partial) {
                  reviews.push(partial);
                  reviewedSlideCount += salvaged.size;
                }
              }
            }
            return;
          }
          let batchReview = outcome.value;
          let covered = batches[index]!.length;
          if (plan.kind === "reuse" || plan.kind === "assemble") {
            batchReview = plan.review;
          } else if (plan.kind === "subset") {
            const split = splitBatchReview(outcome.value, plan.indexes);
            const bySlide = new Map<number, VisualReview>();
            if (split) {
              for (const slideIndex of plan.indexes) {
                const review = split.get(slideIndex)!;
                slideCache.entries.set(slideIndex, { signature: slideSignatures[slideIndex]!, review });
                bySlide.set(slideIndex, review);
              }
            } else {
              // 模型没有给全逐页分数：这一轮只能用批次分近似被检查页，
              // 不写入逐页缓存，下一轮仍会重新检查它们。
              for (const slideIndex of plan.indexes) {
                bySlide.set(slideIndex, slideReviewFromBatch(outcome.value, slideIndex));
              }
            }
            for (const slideIndex of plan.batchIndexes) {
              if (bySlide.has(slideIndex)) continue;
              const entry = slideCache.entries.get(slideIndex);
              if (entry) bySlide.set(slideIndex, entry.review);
            }
            const combined = batchReviewFromSlides(plan.batchIndexes, bySlide, outcome.value.consistencyScore);
            if (combined) {
              batchReview = combined;
            } else {
              // 防御性回退：拼不出整批结论时只按真正检查过的页计覆盖，
              // 不能把没看的页算进覆盖率。
              batchReview = outcome.value;
              covered = plan.indexes.length;
            }
          } else {
            const split = splitBatchReview(outcome.value, plan.indexes);
            if (split) {
              for (const slideIndex of plan.indexes) {
                slideCache.entries.set(slideIndex, {
                  signature: slideSignatures[slideIndex]!,
                  review: split.get(slideIndex)!,
                });
              }
            }
          }
          collected[index] = batchReview;
          reviews.push(batchReview);
          if (!hasDeckReview && index === 0) overviewReview = batchReview;
          reviewedSlideCount += covered;
        });
        pageReviewCache = {
          source: reviewSource === "真实 PPTX" ? "真实 PPTX" : "画布预览",
          signatures,
          reviews: collected,
        };
        const requestedThisRound = plans.reduce(
          (total, plan) => total + (plan.kind === "full" || plan.kind === "subset" ? plan.indexes.length : 0),
          0,
        );
        reviewRounds.set(iteration, {
          coverage: { reviewed: reviewedSlideCount, total: reviewSlideCount },
          partialReason: partialReviewReason,
          deckUnavailable: deckReviewUnavailable,
          source: reviewSource === "真实 PPTX" ? "真实 PPTX" : "画布预览",
          realRenderFailure,
          contactSheet: render.contactSheet,
          deckReview: overviewReview,
          reviewReuse: {
            reviewed: requestedThisRound,
            reused: Math.max(0, render.slides.length - requestedThisRound),
          },
          ...(templateFit === undefined ? {} : { templateFit }),
        });
        if (reviews.length === 0) throw outcomes.find((outcome) => outcome.status === "rejected")?.reason;
        const merged = mergeReviews(reviews, overviewReview);
        if (!templateFit) return merged;
        return {
          ...merged,
          templateFitScore: templateFit.checked ? templateFit.score : 0,
          // Template findings are measured, not guessed. Put them first so a
          // model that already filled the issue cap cannot hide them from the
          // repair loop.
          issues: [...templateFitVisualIssues(templateFit), ...merged.issues].slice(0, 100),
        };
      },
      repair: async (current, review, goal) => {
        options.onProgress?.("视觉评审已收到问题，正在生成修复计划", roundBase(currentIteration) + 7);
        // 修复计划由模型出，模型需要知道每页的标题和当前版式才能决定改什么。
        const document = options.buildDocument(current);
        const promptTemplate = options.template ? templateTargetForPrompt(options.template, document) : undefined;
        const deck = current.map((design, index) => ({
          index,
          title: document.slides[index]?.content.title ?? "",
          layout: design.layout,
          ...(design.recipe === undefined ? {} : { recipe: design.recipe }),
        }));
        const plan = await options.vision.planRepairs(review, goal, {
          deck,
          ...(promptTemplate === undefined ? {} : { template: promptTemplate }),
          taskId: options.taskId,
        });
        // A repair plan may name any page, and a fallback plan may be broader
        // than the findings. Only pages the review actually flagged are allowed
        // to change; the rest keep the design the user already saw.
        const affected = new Set(affectedSlideIndexes(review, goal.minimumScores));
        const plannedRepairs = [...plan.repairs];
        // The model can miss a measured template violation. The deterministic
        // findings are authoritative, so add the repair action ourselves.
        if (options.template) {
          const bySlide = new Map(plannedRepairs.map((repair) => [repair.slideIndex, repair]));
          for (const issue of review.issues) {
            let action: Exclude<AiElementRepair, { action: "changeLayout" }> | undefined;
            if (issue.code === "template-title-axis") {
              const resolved = templateTargetForSlide(document, options.template, issue.slideIndex);
              action = {
                action: "move",
                target: "title",
                frame: {
                  x: resolved.grid.titleX,
                  y: resolved.grid.titleY,
                  width: resolved.grid.titleWidth,
                  height: resolved.grid.titleHeight,
                },
              };
            } else if (issue.code === "template-font" && issue.role !== undefined) {
              const template = options.template;
              const fontFamily =
                issue.role === "title"
                  ? (template.majorFont ?? template.minorFont)
                  : (template.minorFont ?? template.majorFont);
              if (fontFamily) action = { action: "restyle", target: issue.role, fontFamily };
            }
            if (!action) continue;
            const existing = bySlide.get(issue.slideIndex);
            const actions = existing?.elementActions ?? [];
            const duplicate = actions.some((candidate) => {
              if (candidate.action !== action!.action || candidate.target !== action!.target) return false;
              if (action!.action === "move") return true;
              if (candidate.action !== "restyle" || action!.action !== "restyle") return false;
              return candidate.fontFamily === action!.fontFamily;
            });
            if (duplicate) continue;
            const repair = existing ?? {
              slideIndex: issue.slideIndex,
              backgroundAction: "keep" as const,
              hierarchyAction: "keep" as const,
              obstacleRegions: [],
              elementActions: [],
              reason: "修复模板偏差",
            };
            bySlide.set(issue.slideIndex, { ...repair, elementActions: [...actions, action] });
          }
          plannedRepairs.splice(0, plannedRepairs.length, ...bySlide.values());
        }
        const repairs = new Map(
          plannedRepairs
            .filter((repair) => affected.has(repair.slideIndex))
            .map((repair) => [repair.slideIndex, repair]),
        );
        return current.map((slide, slideIndex) => {
          const repair = repairs.get(slideIndex);
          if (!repair) return slide;
          const backgroundTreatment: AiSlideDesign["backgroundTreatment"] =
            repair.backgroundAction === "keep"
              ? "none"
              : repair.backgroundAction === "simplify"
                ? "simplify"
                : "local-scrim";
          return {
            ...slide,
            layout: repair.layout ?? slide.layout,
            ...(repair.recipe === undefined ? {} : { recipe: repair.recipe }),
            safeRegion: repair.safeRegion ?? slide.safeRegion,
            obstacleRegions: repair.obstacleRegions,
            hierarchyAction: repair.hierarchyAction,
            backgroundTreatment,
            elementRepairs: repair.elementActions,
          };
        });
      },
    });
    designs = aligned.value;
    visualReview = aligned.review;
    // 返回的结论可能来自较早的一轮；覆盖范围和降级说明必须跟着那一轮，
    // 不能用最后一轮的数字去描述更早的结论。
    const finalRound = reviewRounds.get(aligned.bestIteration);
    finalReviewRound = finalRound;
    adoptedTemplateFit = finalRound?.templateFit;
    const finalCoverage = finalRound?.coverage ?? { reviewed: reviewedSlideCount, total: reviewSlideCount };
    visualReviewCoverage = finalCoverage;
    contactSheet = finalRound?.contactSheet;
    finalDeckReview = finalRound?.deckReview;
    reviewReuse = finalRound?.reviewReuse;
    const minimumTemplateFit = options.goal.minimumScores.templateFit ?? options.template?.minimumFit ?? 90;
    const templatePassed =
      options.template === undefined ||
      (adoptedTemplateFit?.checked === true && adoptedTemplateFit.score >= minimumTemplateFit);
    visualPassed =
      aligned.stopReason === "target-reached" &&
      finalCoverage.total > 0 &&
      finalCoverage.reviewed === finalCoverage.total &&
      templatePassed;
    notes.push(`视觉评审 ${aligned.iterations} 轮，${aligned.stopReason}`);
    if (options.template) {
      if (adoptedTemplateFit?.checked) {
        notes.push(
          `模板符合度 ${adoptedTemplateFit.score}/100（阈值 ${minimumTemplateFit}，${adoptedTemplateFit.issues.length} 处偏差，其中硬性问题 ${adoptedTemplateFit.hardFailures} 处）`,
        );
      } else {
        // A template was selected but no usable grid could be compiled. This is
        // not a pass: the deck was reviewed without the target the user chose.
        notes.push("模板符合度未执行：上传模板没有可用的标题或内容占位符，视觉结论不能视为已按模板验收");
      }
    }
    // 评分和建议是评审留下的结构化结论。用户既要能看到它，也要知道它来自
    // 哪一轮、覆盖了多少页，避免把"评审过了"理解成"页面一定好看"。
    notes.push(
      `视觉评审最终评分 ${aligned.review.overallScore}（层级 ${aligned.review.hierarchyScore}、对齐 ${aligned.review.alignmentScore}、可读性 ${aligned.review.readabilityScore}、一致性 ${aligned.review.consistencyScore}、重复控制 ${aligned.review.repetitionScore ?? "未评"}、主题匹配 ${aligned.review.themeFitScore ?? "未评"}、视觉焦点 ${aligned.review.visualFocusScore ?? "未评"}、独特性 ${aligned.review.distinctivenessScore ?? "未评"}），剩余 ${aligned.review.issues.length} 处建议`,
    );
    // 逐页低分会拉低整册评分，但分数本身不是修复授权。把低分页列出来，
    // 避免用户只看到总分下降却不知道是哪一页、也避免误以为系统已经改过它。
    const weakPages = (aligned.review.slideScores ?? []).filter(
      (score) =>
        score.overallScore < options.goal.minimumScores.overall ||
        score.hierarchyScore < options.goal.minimumScores.hierarchy ||
        score.alignmentScore < options.goal.minimumScores.alignment ||
        score.readabilityScore < options.goal.minimumScores.readability ||
        (options.goal.minimumScores.distinctiveness !== undefined &&
          score.distinctivenessScore !== undefined &&
          score.distinctivenessScore < options.goal.minimumScores.distinctiveness),
    );
    if (weakPages.length > 0) {
      const details = weakPages
        .slice(0, 3)
        .map((score) => {
          const failed: string[] = [];
          if (score.overallScore < options.goal.minimumScores.overall) failed.push(`总分 ${score.overallScore}`);
          if (score.hierarchyScore < options.goal.minimumScores.hierarchy) failed.push(`层级 ${score.hierarchyScore}`);
          if (score.alignmentScore < options.goal.minimumScores.alignment) failed.push(`对齐 ${score.alignmentScore}`);
          if (score.readabilityScore < options.goal.minimumScores.readability)
            failed.push(`可读性 ${score.readabilityScore}`);
          return `第 ${score.slideIndex + 1} 页（${failed.join("、")}）`;
        })
        .join("；");
      notes.push(
        `${weakPages.length} 页逐页评分低于目标：${details}${weakPages.length > 3 ? "…" : ""}；自动修复只处理评审给出的具体问题，没有因为分数单独改版`,
      );
    }
    if (aligned.reverted) notes.push("最后一轮修复没有提升评分，已保留评分更高的设计");
    if (finalRound?.deckUnavailable) {
      // 总览评审失败时跨页一致性由逐页批次代答，这不是等价结论，必须说明。
      degraded = true;
      notes.push(`整册总览评审不可用，跨页一致性退回逐页批次评分（${finalRound.deckUnavailable.slice(0, 200)}）`);
    }
    if (reviewReuse && reviewReuse.reused > 0) {
      notes.push(`定点复检上传 ${reviewReuse.reviewed} 页，复用 ${reviewReuse.reused} 页既有结论`);
    }
    if (finalCoverage.total > 0 && finalCoverage.reviewed < finalCoverage.total) {
      degraded = true;
      notes.push(
        `视觉评审只覆盖 ${finalCoverage.reviewed}/${finalCoverage.total} 页${finalRound?.partialReason ? `（${finalRound.partialReason.slice(0, 200)}）` : ""}，未评审页不能视为通过`,
      );
    }
    if (finalRound?.source === "真实 PPTX") {
      notes.push("视觉评审基于导出的 PPTX 真实渲染");
    } else if (finalRound?.realRenderFailure) {
      // 评审看到的不是用户最终会看到的画面，这是一次真实的降级，必须记下来。
      degraded = true;
      notes.push(`视觉评审改用画布预览渲染（${describeRealRenderFailure(finalRound.realRenderFailure)}）`);
    } else if (finalRound?.source === "画布预览") {
      notes.push("视觉评审基于画布预览渲染");
    }
  } catch (error) {
    if (isGenerationCancelled(error)) throw error;
    degraded = true;
    const message = error instanceof Error ? error.message : String(error);
    const reason = describeVisualReviewFailure(message);
    notes.push(`视觉评审降级：${reason}`);
    // 降级后最容易被误解成"检查过了没问题"：必须明确说出这次到底评审了多少。
    notes.push(
      reviewedSlideCount === 0
        ? "本次未做视觉评审"
        : `视觉评审未完成，只覆盖了 ${reviewedSlideCount}/${reviewSlideCount} 页`,
    );
    // 用户主动关闭视觉评审不算“未达标”，但任何一次尝试后的失败都不能
    // 让界面走完全通过的静默路径。
    if (!message.includes("AI_VISION_DISABLED")) visualPassed = false;
    options.onProgress?.("视觉评审不可用，继续用确定性校验", 88);
  }

  /** 像素采样失败只降级：没有采样结果不等于页面有问题，也不等于生成失败。 */
  const inspectContrast = async (document: PresentationDocument): Promise<RenderedContrastReport> => {
    try {
      return await inspect(document);
    } catch (error) {
      if (isGenerationCancelled(error)) throw error;
      degraded = true;
      notes.push(`像素对比度检查不可用：${error instanceof Error ? error.message : String(error)}`);
      return { issues: [], unreadableSlides: [] };
    }
  };

  let document = options.buildDocument(designs);
  let contrast = await inspectContrast(document);
  if (contrast.unreadableSlides.length > 0) {
    degraded = true;
    notes.push(
      `第 ${contrast.unreadableSlides.map((index) => index + 1).join("、")} 页底图无法渲染，未做像素对比度检查`,
    );
  }
  if (contrast.issues.length > 0) {
    // 修复真正承载文字的那层底图上的墨色。整页盖一层板会抹掉模板设计，
    // 那正是生成稿看起来像白纸的主因。
    const affectedSlides = new Map<number, RenderedContrastIssue[]>();
    contrast.issues.forEach((issue) =>
      affectedSlides.set(issue.slideIndex, [...(affectedSlides.get(issue.slideIndex) ?? []), issue]),
    );
    designs = designs.map((slide, slideIndex) => {
      const issues = affectedSlides.get(slideIndex);
      if (!issues) return slide;
      const luminance = colorLuminance(issues[0]!.backgroundColor) ?? 1;
      const onDark =
        (contrastRatioAgainstLuminance("#FFFFFF", luminance) ?? 0) >=
        (contrastRatioAgainstLuminance("#171A1F", luminance) ?? 0);
      // 墨色必须压过模板给占位符指定的颜色，否则修复会被模板覆盖，页面依旧不可读。
      return {
        ...slide,
        backgroundTreatment: "none",
        inkOverride: true,
        titleColor: onDark ? "#FFFFFF" : "#171A1F",
        bodyColor: onDark ? "#DCE3EA" : "#3E4650",
      };
    });
    document = options.buildDocument(designs);
    contrast = await inspectContrast(document);
  }
  if (contrast.issues.length > 0) {
    // 仍然不可读：底图在文字下方变化太大，改为给文字块单独加一层底板。
    const stubborn = new Set(contrast.issues.map((issue) => issue.slideIndex));
    designs = designs.map((slide, slideIndex) =>
      stubborn.has(slideIndex) ? { ...slide, backgroundTreatment: "local-scrim" } : slide,
    );
    document = options.buildDocument(designs);
    contrast = await inspectContrast(document);
  }

  const validateQuality = options.validateQuality ?? validatePresentationVisualQuality;
  // 质量门本身也不能把已经生成好的文档吞掉：它抛错时只降级，并把
  // passed 记为 false，避免把"没检查"误报成"没问题"。
  let gatePassed = false;
  let gateIssues: PresentationQualityIssue[] = [];
  try {
    const quality = validateQuality(document, designs);
    gatePassed = quality.passed;
    gateIssues = quality.issues;
  } catch (error) {
    if (isGenerationCancelled(error)) throw error;
    degraded = true;
    notes.push(`确定性质量门不可用：${error instanceof Error ? error.message : String(error)}`);
  }
  const issues = [...gateIssues, ...contrastIssues(contrast.issues)];
  const passed = gatePassed && issues.length === 0;
  // Template adherence is deterministic, so it still runs when the visual
  // review is disabled or fails. The report must say what the template check
  // found even when no model was involved.
  const templateFitReport = options.template ? checkTemplateFit(document, options.template) : undefined;
  if (options.template) {
    if (templateFitReport?.checked) {
      // A measured template violation is a failed acceptance even when the
      // visual model happened to give every dimension a passing score.
      if (!templateFitReport.passed) visualPassed = false;
      if (!notes.some((note) => note.startsWith("模板符合度"))) {
        notes.push(
          `模板符合度 ${templateFitReport.score}/100（阈值 ${templateFitReport.threshold}，${templateFitReport.issues.length} 处偏差，其中硬性问题 ${templateFitReport.hardFailures} 处）`,
        );
      }
    } else {
      // "Not executed" is not "passed": the user chose a template and the deck
      // could not be measured against it.
      visualPassed = false;
      if (!notes.some((note) => note.startsWith("模板符合度未执行"))) {
        degraded = true;
        notes.push("模板符合度未执行：上传模板没有可用的标题或内容占位符，视觉结论不能视为已按模板验收");
      }
    }
  }
  // Evidence follows the round whose conclusions were adopted, not the last
  // render attempt. A canvas preview must never be reported as a final render.
  const visualEvidence: ReviewEvidence = finalReviewRound
    ? finalReviewRound.source === "真实 PPTX"
      ? { renderer: "powerpoint", evidence: "final" }
      : {
          renderer: "canvas",
          evidence: "layout",
          ...(finalReviewRound.realRenderFailure ? { reason: finalReviewRound.realRenderFailure } : {}),
        }
    : {
        renderer: "none",
        evidence: "indicator",
        reason: visualReview ? "visual-evidence-unavailable" : "visual-review-unavailable",
      };
  if (!passed) {
    const pages = [...new Set(issues.map((issue) => issue.slideIndex + 1))].join("、");
    notes.push(
      issues.length > 0
        ? `质量门发现 ${issues.length} 个问题，涉及第 ${pages} 页`
        : "质量门未能完成检查，问题清单不完整",
    );
  }
  return {
    designs,
    document,
    notes,
    issues,
    passed,
    degraded,
    visualReview,
    visualReviewCoverage,
    visualPassed,
    contactSheet,
    visualEvidence,
    deckReview: finalDeckReview,
    reviewReuse,
    ...(templateFitReport === undefined ? {} : { templateFit: templateFitReport }),
  };
}
