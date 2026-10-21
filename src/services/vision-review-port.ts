import type { PresentationVisualGoal, VisualRepairPlan, VisualReview } from "./visual-alignment";
import type { PresentationRender } from "./presentation-renderer";

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
  review(render: PresentationRender, goal: PresentationVisualGoal, slideIndexes?: number[]): Promise<VisualReview>;
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
