import { invoke } from "@tauri-apps/api/core";
import type { PresentationVisualGoal, VisualRepairPlan, VisualReview } from "./visual-alignment";
import {
  affectedSlideIndexes,
  normalizeVisualRepairPlan,
  normalizeVisualReview,
  visualRepairPlanSchema,
} from "./visual-alignment";
import type { PresentationRender } from "./presentation-renderer";
import type { TemplateReviewTarget } from "./template-review-target";
import { loadSettings } from "./settings";

const MAX_VISUAL_IMAGE_BYTES = 6 * 1024 * 1024;
/**
 * How many rendered pages a review may cover.
 *
 * This used to be 20 while the rasterizer already produced up to 40 pages, so
 * a 21-page deck silently lost its visual review entirely. The limit now
 * matches what the rasterizer can deliver; larger decks are reported as
 * unreviewed instead of failing inside a batch.
 */
export const MAX_REVIEWED_SLIDES = 40;

/** What the repair planner needs to know about the deck. */
export interface RepairPlanContext {
  /** 逐页现状：索引、标题和当前版式。 */
  deck: Array<{ index: number; title: string; layout: string }>;
  /** 上传模板的可测量目标；修复必须回到这些轴线。 */
  template?: TemplateReviewTarget;
  /** 生成任务号：取消时后端会中断该任务下所有在途请求。 */
  taskId?: number;
}

export function validateVisualRenderPayload(render: PresentationRender): void {
  if (render.slides.length < 1 || render.slides.length > MAX_REVIEWED_SLIDES)
    throw new Error("AI_VISION_SLIDE_COUNT_INVALID");
  for (const image of [...render.slides, render.contactSheet]) {
    if (!image.startsWith("data:image/jpeg;base64,") || image.length > MAX_VISUAL_IMAGE_BYTES * 1.4)
      throw new Error("AI_VISION_IMAGE_INVALID");
  }
}

/** Provider-neutral boundary for a model that can inspect rendered slide images. */
export interface VisionReviewPort {
  readonly available: boolean;
  review(
    render: PresentationRender,
    goal: PresentationVisualGoal,
    slideIndexes?: number[],
    taskId?: number,
    options?: { includeContactSheet?: boolean; template?: TemplateReviewTarget },
  ): Promise<VisualReview>;
  /**
   * 整套总览评审：只看跨页一致性、节奏和重复度，不产生逐页几何。
   *
   * 可选实现。没有它时调用方退回“第一批附带缩略图”的旧行为，跨页一致性
   * 也就只能取那一批的评分。
   */
  reviewDeck?(
    render: PresentationRender,
    goal: PresentationVisualGoal,
    taskId?: number,
    options?: { template?: TemplateReviewTarget },
  ): Promise<VisualReview>;
  planRepairs(
    review: VisualReview,
    goal: PresentationVisualGoal,
    context?: RepairPlanContext,
  ): Promise<VisualRepairPlan>;
}

export class UnavailableVisionReviewPort implements VisionReviewPort {
  readonly available = false;
  async review(): Promise<VisualReview> {
    throw new Error("AI_VISION_UNSUPPORTED");
  }
  async reviewDeck(): Promise<VisualReview> {
    throw new Error("AI_VISION_UNSUPPORTED");
  }
  async planRepairs(): Promise<VisualRepairPlan> {
    throw new Error("AI_VISION_UNSUPPORTED");
  }
}

/**
 * 用户在设置里关闭了视觉评审。
 *
 * 这不是失败，而是一项隐私选择：生成流程不允许把页面渲染图发送给模型
 * 服务。接口保持与正常端口一致，让质检阶段照常降级到确定性校验。
 */
export class DisabledVisionReviewPort implements VisionReviewPort {
  readonly available = false;
  async review(): Promise<VisualReview> {
    throw new Error("AI_VISION_DISABLED");
  }
  async reviewDeck(): Promise<VisualReview> {
    throw new Error("AI_VISION_DISABLED");
  }
  async planRepairs(): Promise<VisualRepairPlan> {
    throw new Error("AI_VISION_DISABLED");
  }
}

/**
 * The deterministic repair plan.
 *
 * This is the fallback for when the model cannot be asked, or answers with
 * something unusable. It maps the review's issue kinds onto a fixed set of
 * actions, which is why it can only ever say a handful of things.
 */
export function planRepairsByRule(
  review: VisualReview,
  minimum: number | PresentationVisualGoal["minimumScores"] = 85,
): VisualRepairPlan {
  const bySlide = new Map<number, VisualReview["issues"]>();
  review.issues.forEach((issue) => bySlide.set(issue.slideIndex, [...(bySlide.get(issue.slideIndex) ?? []), issue]));
  const guidance = new Map(review.slideGuidance.map((item) => [item.slideIndex, item]));
  /** A rule-table frame must stay inside the page, like a model-provided one. */
  const pageFrame = (frame: { x: number; y: number; width: number; height: number }) => {
    const width = Math.min(1, Math.max(0.02, frame.width));
    const height = Math.min(1, Math.max(0.02, frame.height));
    return {
      x: Math.min(Math.max(0, frame.x), 1 - width),
      y: Math.min(Math.max(0, frame.y), 1 - height),
      width,
      height,
    };
  };
  // The rule table may only answer the pages the review actually flagged. It
  // used to walk every guidance entry, and normalization used to invent one
  // for every page, so a failed model call ended up re-laying out the whole
  // deck — moving titles and shrinking body text on pages nobody complained
  // about. A page without a finding has nothing to repair here.
  const repairs = affectedSlideIndexes(review, minimum).flatMap((slideIndex) => {
    const issues = bySlide.get(slideIndex) ?? [];
    if (issues.length === 0) return [];
    const guide = guidance.get(slideIndex);
    const hierarchyAction = issues.some((issue) => issue.issue === "weak-hierarchy")
      ? ("strengthen-title" as const)
      : issues.some((issue) => issue.issue === "excessive-empty-space")
        ? ("increase-whitespace" as const)
        : ("keep" as const);
    const backgroundAction = issues.some(
      (issue) => issue.issue === "background-conflict" || issue.issue === "poor-contrast",
    )
      ? ("replace-compatible" as const)
      : ("keep" as const);
    const layout =
      guide?.recommendedLayout ??
      (issues.some((issue) => issue.issue === "repetitive-layout") ? ("title-body" as const) : undefined);
    const elementActions = [
      ...(guide
        ? [
            {
              action: "move" as const,
              target: "title" as const,
              frame: pageFrame({
                x: guide.safeRegion.x,
                y: guide.safeRegion.y,
                width: guide.safeRegion.width,
                height: Math.min(0.14, guide.safeRegion.height * 0.22),
              }),
            },
            {
              action: "resize" as const,
              target: "body" as const,
              frame: pageFrame({
                x: guide.safeRegion.x,
                y: guide.safeRegion.y + Math.min(0.18, guide.safeRegion.height * 0.28),
                width: guide.safeRegion.width,
                height: Math.max(0.08, guide.safeRegion.height - Math.min(0.18, guide.safeRegion.height * 0.28)),
              }),
            },
          ]
        : []),
      ...(issues.some((issue) => issue.issue === "weak-hierarchy")
        ? [{ action: "restyle" as const, target: "title" as const, fontScale: 1.15 }]
        : []),
      ...(guide ? [{ action: "changeLayout" as const, layout: guide.recommendedLayout }] : []),
    ];
    // A finding the rule table has no coordinate for is still a finding, but it
    // is not permission to invent geometry. If nothing can be acted on, the
    // page is left alone.
    if (
      layout === undefined &&
      backgroundAction === "keep" &&
      hierarchyAction === "keep" &&
      elementActions.length === 0
    )
      return [];
    return [
      {
        slideIndex,
        ...(layout === undefined ? {} : { layout }),
        backgroundAction,
        hierarchyAction,
        ...(guide === undefined
          ? {}
          : { safeRegion: guide.safeRegion, obstacleRegions: [...guide.logoRegions, ...guide.busyRegions] }),
        elementActions,
        reason: issues
          .map((issue) => issue.suggestion)
          .join("；")
          .slice(0, 500),
      },
    ];
  });
  return visualRepairPlanSchema.parse({ repairs });
}

export class TauriVisionReviewPort implements VisionReviewPort {
  readonly available = true;

  /**
   * Sends one review request and normalizes the answer, retrying once for
   * transport-level noise.
   *
   * Retrying is only useful when the model answered with something unusable:
   * a timeout means the request was too large, and a 4xx means it was invalid,
   * so both would fail again the same way. Cancellation must not be retried at
   * all.
   */
  private async requestReview(payload: Record<string, unknown>, expected: number[]): Promise<VisualReview> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await invoke<unknown>("review_presentation_visuals", {
          request: {
            ...payload,
            repairHint:
              attempt === 0
                ? undefined
                : "上一次响应不是可接受的严格 JSON，或缺少必填评分字段。请重新检查并严格遵循输出协议。",
          },
        });
        return normalizeVisualReview(result, expected);
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

  async review(
    render: PresentationRender,
    goal: PresentationVisualGoal,
    slideIndexes?: number[],
    taskId?: number,
    options?: { includeContactSheet?: boolean; template?: TemplateReviewTarget },
  ): Promise<VisualReview> {
    validateVisualRenderPayload(render);
    // The deck overview is the same picture for every batch. Sending it with
    // each request multiplied the most expensive image by the number of
    // batches; the caller sends it once, with the first batch.
    const includeContactSheet = options?.includeContactSheet ?? true;
    const indexes = (slideIndexes ?? render.slides.map((_, index) => index)).slice(0, 6);
    if (indexes.length === 0 || indexes.some((index) => !render.slides[index]))
      throw new Error("AI_VISION_SLIDE_INDEX_INVALID");
    const settings = await loadSettings();
    return this.requestReview(
      {
        goal,
        ...(options?.template === undefined ? {} : { template: options.template }),
        slideImages: indexes.map((index) => render.slides[index]!),
        ...(includeContactSheet ? { contactSheet: render.contactSheet } : {}),
        slideIndexes: indexes,
        model: settings.aiModel,
        provider: settings.aiProviderId,
        taskId,
      },
      indexes,
    );
  }

  /**
   * Reviews the deck as a whole from the contact sheet alone.
   *
   * Cross-page consistency is not observable from a batch of six pages; the
   * batch that happened to hold the overview used to answer for the whole
   * deck. This call is the only one that sees every page at once, so it is the
   * only one whose consistency score is used. Per-page geometry is explicitly
   * out of scope here.
   */
  async reviewDeck(
    render: PresentationRender,
    goal: PresentationVisualGoal,
    taskId?: number,
    options?: { template?: TemplateReviewTarget },
  ): Promise<VisualReview> {
    validateVisualRenderPayload(render);
    const indexes = render.slides.map((_, index) => index);
    const settings = await loadSettings();
    return this.requestReview(
      {
        goal,
        ...(options?.template === undefined ? {} : { template: options.template }),
        slideImages: [],
        contactSheet: render.contactSheet,
        slideIndexes: indexes,
        deckOnly: true,
        model: settings.aiModel,
        provider: settings.aiProviderId,
        taskId,
      },
      indexes,
    );
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
  private async planRepairsWithModel(
    review: VisualReview,
    goal: PresentationVisualGoal,
    context?: RepairPlanContext,
  ): Promise<VisualRepairPlan | undefined> {
    if (!context || context.deck.length === 0) return undefined;
    try {
      const settings = await loadSettings();
      const result = await invoke<unknown>("plan_presentation_repairs", {
        request: {
          review,
          goal,
          slides: context.deck,
          ...(context.template === undefined ? {} : { template: context.template }),
          model: settings.aiModel,
          provider: settings.aiProviderId,
          taskId: context.taskId,
        },
      });
      return normalizeVisualRepairPlan(
        result,
        context.deck.map((slide) => slide.index),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 取消不是失败：取消必须一路向上抛出，不能被降级逻辑吞掉。
      if (message.includes("AI_REQUEST_CANCELLED") || message.includes("AI_GENERATION_CANCELLED")) throw error;
      return undefined;
    }
  }

  async planRepairs(
    review: VisualReview,
    goal: PresentationVisualGoal,
    context?: RepairPlanContext,
  ): Promise<VisualRepairPlan> {
    const planned = await this.planRepairsWithModel(review, goal, context);
    return planned ?? planRepairsByRule(review, goal.minimumScores);
  }
}
