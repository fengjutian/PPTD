import { invoke } from "@tauri-apps/api/core";
import type { PresentationVisualGoal, VisualRepairPlan, VisualReview } from "./visual-alignment";
import { normalizeVisualReview, visualRepairPlanSchema } from "./visual-alignment";
import type { PresentationRender } from "./presentation-renderer";
import { loadSettings } from "./settings";

const MAX_VISUAL_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_VISUAL_SLIDES = 20;

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
  planRepairs(review: VisualReview, goal: PresentationVisualGoal): Promise<VisualRepairPlan>;
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
        // 取消不是失败：立刻放弃，不再重试一次。
        if (error instanceof Error && error.message.includes("AI_REQUEST_CANCELLED")) throw error;
      }
    }
    throw new Error("AI_VISION_REVIEW_RETRY_EXHAUSTED", { cause: lastError });
  }

  async planRepairs(review: VisualReview, _goal: PresentationVisualGoal): Promise<VisualRepairPlan> {
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
}
