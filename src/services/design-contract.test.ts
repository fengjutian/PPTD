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

describe("AI design contract", () => {
  it("exposes only plan fields with a consumer", () => {
    expect(Object.keys(pageDesignPlanSchema.shape).sort()).toEqual([...CONSUMED_PLAN_FIELDS].sort());
    expect("emphasis" in pageDesignPlanSchema.shape).toBe(false);
  });

  it("keeps the slide-level style entry points the compiler reads", () => {
    const slide = aiPresentationDesignSchema.shape.slides.element.shape;
    for (const key of ["layout", "composition", "recipe", "designPlan", "visualNarrative", "palette", "visualAsset"]) {
      expect(slide).toHaveProperty(key);
    }
  });
});
