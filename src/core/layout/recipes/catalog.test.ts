import { describe, expect, it } from "vitest";
import { implementedRecipeIds } from "./registry";
import { imageRecipeIds, RECIPE_CATALOG, recipeCatalogForConcept } from "./catalog";

describe("recipe catalog", () => {
  it("describes every implemented recipe exactly once", () => {
    expect(Object.keys(RECIPE_CATALOG).sort()).toEqual(implementedRecipeIds().sort());
    for (const [id, entry] of Object.entries(RECIPE_CATALOG)) {
      expect(entry.id).toBe(id);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.components.length).toBeGreaterThan(0);
    }
  });

  it("derives image recipes from renderer-backed metadata", () => {
    expect(imageRecipeIds().sort()).toEqual(["full-bleed-image", "image-led", "side-image-text"].sort());
  });

  it("only exposes recipes allowed by the selected direction", () => {
    const concept = { recipes: implementedRecipeIds().slice(0, 3) };
    const entries = recipeCatalogForConcept(concept);
    expect(entries.map((entry) => entry.id)).toEqual(concept.recipes);
    expect(entries.every((entry) => concept.recipes.includes(entry.id))).toBe(true);
  });
});
