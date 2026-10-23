import type { RecipeId } from "../../design/deck-concept";
import { asymmetricSplit } from "./asymmetric-split";
import { editorialIndex } from "./editorial-index";
import type { LayoutRecipe } from "./types";

const RECIPES: Readonly<Record<RecipeId, LayoutRecipe>> = {
  "editorial-index": editorialIndex,
  "asymmetric-split": asymmetricSplit,
};

export function findRecipe(id: RecipeId): LayoutRecipe | undefined {
  return RECIPES[id];
}

export function implementedRecipeIds(): RecipeId[] {
  return Object.keys(RECIPES) as RecipeId[];
}
