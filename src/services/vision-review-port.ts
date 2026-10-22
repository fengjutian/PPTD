import { invoke } from "@tauri-apps/api/core";
import type { PresentationVisualGoal, VisualRepairPlan, VisualReview } from "./visual-alignment";
import { normalizeVisualRepairPlan, normalizeVisualReview, visualRepairPlanSchema } from "./visual-alignment";
import type { PresentationRender } from "./presentation-renderer";
import { loadSettings } from "./settings";

const MAX_VISUAL_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VISUAL_SLIDES = 20;

/** What the repair planner needs to know about the deck. */
export interface RepairPlanContext {
  /** 逐页现状：索引、标题和当前版式。 */
  deck: Array<{ index: number; title: string; layout: string }>;
  /** 生成任务号：取消时后端会中断该任务下所有在途请求。 */
  taskId?: number;
}

export function validateVisualRenderPayload(render: PresentationRender): void {
  if (render.slides.length < 1 || render.slides.length > MAX_VISUAL_SLIDES) throw new Error("AI_VISION_SLIDE_COUNT_INVALID");
  for (const image of [...render.slides, render.contactSheet]) {
    if (!image.startsWith("data:image/jpeg;base64,") || image.length > MAX_VISUAL_IMAGE_BYTES * 1.4) throw new Error("AI_VISION_IMAGE_INVALID");
  }
}

/** Provider-neutral boundary for a model that can inspect rendered slide images. */
export interface VisionReviewPort {
  readonly available: boolean;
  review(render: PresentationRender, goal: PresentationVisualGoal, slideIndexes?: number[], taskId?: number): Promise<VisualReview>;
  planRepairs(review: VisualReview, goal: PresentationVisualGoal, context?: RepairPlanContext): Promise<VisualRepairPlan>;
}

export class UnavailableVisionReviewPort implements VisionReviewPort {
  readonly available = false;
  async review(): Promise<VisualReview> {
    throw new Error("AI_VISION_UNSUPPORTED");
  }
  async planRepairs(): Promise<VisualRepairPlan> {
    throw new Error("AI_VISION_UNSUPPORTED");
  }
}

/**
 * The deterministic repair plan.
 *
 * This is the fallback for when the model cannot be asked, or answers with
 * something unusable. It maps the review's issue kinds onto a fixed set of
 * actions, which is why it can only ever say a handful of things.
 */
export function planRepairsByRule(review: VisualReview): VisualRepairPlan {
  const bySlide = new Map<number, VisualReview["issues"]>();
  review.issues.forEach((issue) => bySlide.set(issue.slideIndex, [...(bySlide.get(issue.slideIndex) ?? []), issue]));
  const guidance = new Map(review.slideGuidance.map((item) => [item.slideIndex, item]));
  const slideIndexes = new Set([...bySlide.keys(), ...guidance.keys()]);
  return visualRepairPlanSchema.parse({ repairs: [...slideIndexes].map((slideIndex) => {
    const issues = bySlide.get(slideIndex) ?? [];
    const guide = guidance.get(slideIndex);
    return {
    slideIndex,
    layout: guide?.recommendedLayout ?? (issues.some((issue) => issue.issue === "repetitive-layout") ? "title-body" : undefined),
    backgroundAction: issues.some((issue) => issue.issue === "background-conflict" || issue.issue === "poor-contrast") ? "replace-compatible" : "keep",
    hierarchyAction: issues.some((issue) => issue.issue === "weak-hierarchy") ? "strengthen-title" : issues.some((issue) => issue.issue === "excessive-empty-space") ? "increase-whitespace" : "keep",
    safeRegion: guide?.safeRegion,
    obstacleRegions: [...(guide?.logoRegions ?? []), ...(guide?.busyRegions ?? [])],
    elementActions: [
      ...(guide ? [{ action: "move" as const, target: "title" as const, frame: { x: guide.safeRegion.x, y: guide.safeRegion.y, width: guide.safeRegion.width, height: Math.min(0.14, guide.safeRegion.height * 0.22) } }] : []),
      ...(guide ? [{ action: "resize" as const, target: "body" as const, frame: { x: guide.safeRegion.x, y: guide.safeRegion.y + Math.min(0.18, guide.safeRegion.height * 0.28), width: guide.safeRegion.width, height: Math.max(0.08, guide.safeRegion.height - Math.min(0.18, guide.safeRegion.height * 0.28)) } }] : []),
      ...(issues.some((issue) => issue.issue === "weak-hierarchy") ? [{ action: "restyle" as const, target: "title" as const, fontScale: 1.15 }] : []),
      ...(guide ? [{ action: "changeLayout" as const, layout: guide.recommendedLayout }] : []),
    ],
    reason: issues.map((issue) => issue.suggestion).join("；"),
  }; }) });
}

export class TauriVisionReviewPort implements VisionReviewPort {
  readonly available = true;

  async review(render: PresentationRender, goal: PresentationVisualGoal, slideIndexes?: number[], taskId?: number): Promise<VisualReview> {
    validateVisualRenderPayload(render);
    const indexes = (slideIndexes ?? render.slides.map((_, index) => index)).slice(0, 6);
    if (indexes.length === 0 || indexes.some((index) => !render.slides[index])) throw new Error("AI_VISION_SLIDE_INDEX_INVALID");
    const settings = await loadSettings();
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await invoke<unknown>("review_presentation_visuals", { request: { goal, slideImages: indexes.map((index) => render.slides[index]!), contactSheet: render.contactSheet, slideIndexes: indexes, model: settings.aiModel, provider: settings.aiProviderId, repairHint: attempt === 0 ? undefined : "上一次响应不是可接受的严格 JSON，或缺少必填评分字段。请重新检查并严格遵循输出协议。", taskId } });
        return normalizeVisualReview(result, indexes);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        // 取消不是失败：立刻放弃，不再重试一次。
        if (message.includes("AI_REQUEST_CANCELLED")) throw error;
        // 超时说明这一次请求的规模超出预算，4xx 说明请求本身不合法。
        // 这两类错误重试一次只会让用户多等一轮，收益为零。
        if (message.includes("AI_REQUEST_TIMEOUT") || /AI_PROVIDER_HTTP_ERROR:4\d\d/.test(message)) break;
      }
    }
    // 保留真实原因：用户看到的降级提示必须能指出是超时、鉴权还是返回不合法。
    throw new Error(`AI_VISION_REVIEW_FAILED:${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  /**
   * Asks the model for the repair plan.
   *
   * The model looked at the rendered pages, so it is the only party that can
   * say what is actually wrong with them. The rule table can only translate
   * an issue kind into one of a few fixed actions; the model can point at a
   * region of the page and say what should happen to it.
   *
   * Returns undefined when the model cannot be asked or answers with
   * something unusable. The caller then falls back to the rule table.
   */
  private async planRepairsWithModel(review: VisualReview, goal: PresentationVisualGoal, context?: RepairPlanContext): Promise<VisualRepairPlan | undefined> {
    if (!context || context.deck.length === 0) return undefined;
    try {
      const settings = await loadSettings();
      const result = await invoke<unknown>("plan_presentation_repairs", { request: { review, goal, slides: context.deck, model: settings.aiModel, provider: settings.aiProviderId, taskId: context.taskId } });
      return normalizeVisualRepairPlan(result, context.deck.map((slide) => slide.index));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 取消不是失败：取消必须一路向上抛出，不能被降级逻辑吞掉。
      if (message.includes("AI_REQUEST_CANCELLED") || message.includes("AI_GENERATION_CANCELLED")) throw error;
      return undefined;
    }
  }

  async planRepairs(review: VisualReview, goal: PresentationVisualGoal, context?: RepairPlanContext): Promise<VisualRepairPlan> {
    const planned = await this.planRepairsWithModel(review, goal, context);
    return planned ?? planRepairsByRule(review);
  }
}
