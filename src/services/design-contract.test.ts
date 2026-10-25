import { describe, expect, it } from "vitest";
import { aiPresentationDesignSchema, pageDesignPlanSchema } from "./ai-service";

/**
 * The plan fields that have a real consumer in the compiler or command layer.
 *
 * Adding a field to the AI contract requires wiring it and adding it here; a
 * field that only exists in the prompt is the bug this test guards against.
 */
const CONSUMED_PLAN_FIELDS = [
  "role",
  "composition",
  "density",
  "typeScale",
  "templatePolicy",
  "recipe",
  "focal",
  "chart",
] as const;

/**
 * Slide-level style entry points.
 *
 * "wired" is read by the compiler. "conditional" is read only on the legacy
 * path, when no designPlan is present. A new field must pick one and be added
 * here; the test fails on an undocumented addition.
 */
const SLIDE_STYLE_FIELDS = {
  layout: "wired",
  background: "wired",
  accent: "wired",
  titleColor: "wired",
  bodyColor: "wired",
  composition: "wired",
  recipe: "conditional",
  designPlan: "wired",
  variant: "conditional",
  focal: "conditional",
  visualNarrative: "wired",
  emphasis: "wired",
  densityTarget: "wired",
  palette: "wired",
  visualAsset: "wired",
} as const;

describe("AI design contract", () => {
  it("exposes only plan fields with a consumer", () => {
    expect(Object.keys(pageDesignPlanSchema.shape).sort()).toEqual([...CONSUMED_PLAN_FIELDS].sort());
    expect("emphasis" in pageDesignPlanSchema.shape).toBe(false);
  });

  it("documents every slide-level style field and its consumption", () => {
    const slide = aiPresentationDesignSchema.shape.slides.element.shape;
    expect(Object.keys(slide).sort()).toEqual(Object.keys(SLIDE_STYLE_FIELDS).sort());
    expect(SLIDE_STYLE_FIELDS.recipe).toBe("conditional");
  });
});
