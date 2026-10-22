import { colorLuminance, contrastRatioAgainstLuminance } from "../core/rendering/contrast";
import type { AiSlideDesign } from "../core/commands/commands";
import type { PresentationDocument } from "../core/document-model";
import { validatePresentationVisualQuality, type PresentationQualityIssue } from "./presentation-quality-gate";
import { inspectRenderedTextContrast, renderPresentationForVisualReview, type RenderedContrastIssue, type RenderedContrastReport } from "./presentation-renderer";
import { runVisualAlignmentLoop, type PresentationVisualGoal, type VisualReview } from "./visual-alignment";
import type { VisionReviewPort } from "./vision-review-port";

/** 一次请求最多评审的页数。 */
const REVIEW_BATCH_SIZE = 6;

export interface DesignQualityStageOptions {
  /** AI 设计阶段产出的逐页设计。 */
  initialDesigns: AiSlideDesign[];
  /** 用给定设计重建文档快照。视觉评审和质检都在快照上跑。 */
  buildDocument: (designs: AiSlideDesign[]) => PresentationDocument;
  goal: PresentationVisualGoal;
  /** 已审核内容的指纹：视觉修复不得改变它。 */
  contentFingerprint: (designs: AiSlideDesign[]) => string;
  vision: VisionReviewPort;
  taskId: number;
  isCancelled: () => boolean;
  /** 阶段进度回报，用于界面显示真实进度。 */
  onProgress?: (label: string, percent: number) => void;
  /** 渲染评审图。测试可替换，真实运行走画布渲染。 */
  renderForReview?: (document: PresentationDocument) => Promise<{ slides: string[]; contactSheet: string }>;
  /** 采样文字下方真实像素。测试可替换。 */
  inspectContrast?: (document: PresentationDocument) => Promise<RenderedContrastReport>;
  /** 确定性质量门。测试可替换。 */
  validateQuality?: (document: PresentationDocument, designs: AiSlideDesign[]) => { passed: boolean; issues: PresentationQualityIssue[] };
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
}

/** 取消不是失败：取消必须一路向上抛出，不能被降级逻辑吞掉。 */
export function isGenerationCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("AI_GENERATION_CANCELLED") || message.includes("AI_REQUEST_CANCELLED");
}

function mergeReviews(reviews: VisualReview[]): VisualReview {
  return {
    overallScore: Math.min(...reviews.map((item) => item.overallScore)),
    hierarchyScore: Math.min(...reviews.map((item) => item.hierarchyScore)),
    alignmentScore: Math.min(...reviews.map((item) => item.alignmentScore)),
    readabilityScore: Math.min(...reviews.map((item) => item.readabilityScore)),
    consistencyScore: Math.min(...reviews.map((item) => item.consistencyScore)),
    issues: reviews.flatMap((item) => item.issues),
    slideGuidance: reviews.flatMap((item) => item.slideGuidance),
  };
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
};

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
  const renderForReview = options.renderForReview ?? renderPresentationForVisualReview;
  const inspect = options.inspectContrast ?? inspectRenderedTextContrast;

  try {
    const aligned = await runVisualAlignmentLoop<AiSlideDesign[]>({
      initial: designs,
      goal: options.goal,
      contentFingerprint: options.contentFingerprint,
      review: async (current, goal, iteration) => {
        if (options.isCancelled()) throw new Error("AI_GENERATION_CANCELLED");
        options.onProgress?.(`视觉模型正在检查第 ${iteration} 轮`, 95 + iteration);
        const render = await renderForReview(options.buildDocument(current));
        // 逐页评审按每批 6 页切分。串行会让 20 页文稿排四队带图请求，
        // 每一队都要等上一队跑完；并行后墙钟时间接近单批耗时。
        const batches: number[][] = [];
        for (let start = 0; start < render.slides.length; start += REVIEW_BATCH_SIZE) {
          batches.push(render.slides.slice(start, start + REVIEW_BATCH_SIZE).map((_, offset) => start + offset));
        }
        const reviews = await Promise.all(batches.map((indexes) => options.vision.review(render, goal, indexes, options.taskId)));
        return mergeReviews(reviews);
      },
      repair: async (current, review, goal) => {
        const plan = await options.vision.planRepairs(review, goal);
        const repairs = new Map(plan.repairs.map((repair) => [repair.slideIndex, repair]));
        return current.map((slide, slideIndex) => {
          const repair = repairs.get(slideIndex);
          if (!repair) return slide;
          const backgroundTreatment: AiSlideDesign["backgroundTreatment"] = repair.backgroundAction === "keep" ? "none" : repair.backgroundAction === "simplify" ? "simplify" : "local-scrim";
          return {
            ...slide,
            layout: repair.layout ?? slide.layout,
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
    notes.push(`视觉评审 ${aligned.iterations} 轮，${aligned.stopReason}`);
  } catch (error) {
    if (isGenerationCancelled(error)) throw error;
    degraded = true;
    notes.push(`视觉评审降级：${error instanceof Error ? error.message : String(error)}`);
    options.onProgress?.("视觉评审不可用，继续用确定性校验", 96);
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
    notes.push(`第 ${contrast.unreadableSlides.map((index) => index + 1).join("、")} 页底图无法渲染，未做像素对比度检查`);
  }
  if (contrast.issues.length > 0) {
    // 修复真正承载文字的那层底图上的墨色。整页盖一层板会抹掉模板设计，
    // 那正是生成稿看起来像白纸的主因。
    const affectedSlides = new Map<number, RenderedContrastIssue[]>();
    contrast.issues.forEach((issue) => affectedSlides.set(issue.slideIndex, [...(affectedSlides.get(issue.slideIndex) ?? []), issue]));
    designs = designs.map((slide, slideIndex) => {
      const issues = affectedSlides.get(slideIndex);
      if (!issues) return slide;
      const luminance = colorLuminance(issues[0]!.backgroundColor) ?? 1;
      const onDark = (contrastRatioAgainstLuminance("#FFFFFF", luminance) ?? 0) >= (contrastRatioAgainstLuminance("#171A1F", luminance) ?? 0);
      // 墨色必须压过模板给占位符指定的颜色，否则修复会被模板覆盖，页面依旧不可读。
      return { ...slide, backgroundTreatment: "none", inkOverride: true, titleColor: onDark ? "#FFFFFF" : "#171A1F", bodyColor: onDark ? "#DCE3EA" : "#3E4650" };
    });
    document = options.buildDocument(designs);
    contrast = await inspectContrast(document);
  }
  if (contrast.issues.length > 0) {
    // 仍然不可读：底图在文字下方变化太大，改为给文字块单独加一层底板。
    const stubborn = new Set(contrast.issues.map((issue) => issue.slideIndex));
    designs = designs.map((slide, slideIndex) => (stubborn.has(slideIndex) ? { ...slide, backgroundTreatment: "local-scrim" } : slide));
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
  if (!passed) {
    const pages = [...new Set(issues.map((issue) => issue.slideIndex + 1))].join("、");
    notes.push(issues.length > 0
      ? `质量门发现 ${issues.length} 个问题，涉及第 ${pages} 页`
      : "质量门未能完成检查，问题清单不完整");
  }
  return { designs, document, notes, issues, passed, degraded };
}
