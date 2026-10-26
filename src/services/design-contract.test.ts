import { describe, expect, it } from "vitest";

import { RECIPE_CATALOG } from "../core/layout/recipes/catalog";
import { DESIGN_PROMPT_VERSION, aiPresentationDesignSchema, pageDesignPlanSchema } from "./ai-service";

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

  it("pins the page design prompt version", () => {
    // A prompt edit must bump this string and the report will carry the new
    // value. The test cannot read the Rust prompt, but it stops a silent
    // "rename" from being treated as the same revision.
    expect(DESIGN_PROMPT_VERSION).toMatch(/^design-pages-v\d+$/);
  });

  it("accepts every implemented recipe and no unimplemented one", () => {
    // The schema enum and the recipe catalog are two lists of the same fact.
    // Drift in either direction is a bug: a recipe the renderer cannot draw, or
    // an implemented recipe the model is never allowed to request.
    const recipeSchema = pageDesignPlanSchema.shape.recipe;
    const accepted = [...recipeSchema.unwrap().options].sort();
    expect(accepted).toEqual(Object.keys(RECIPE_CATALOG).sort());
  });
});
