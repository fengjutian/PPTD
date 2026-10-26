import { describe, expect, it } from "vitest";
import { implementedRecipeIds } from "../layout/recipes/registry";
import { RECIPE_SPECIMENS, recipeSpecimens } from "./recipe-specimens";

describe("recipe specimen matrix", () => {
  it("gives every implemented recipe four quality baselines", () => {
    for (const recipeId of implementedRecipeIds()) {
      expect(recipeSpecimens(recipeId).map((item) => item.mode)).toEqual(["light", "dark", "capacity", "template"]);
    }
    expect(RECIPE_SPECIMENS).toHaveLength(implementedRecipeIds().length * 4);
  });

  it("requires native-object checks for every specimen", () => {
    expect(RECIPE_SPECIMENS.every((item) => item.expectedEditable && item.checks.includes("native-objects"))).toBe(
      true,
    );
  });
});
