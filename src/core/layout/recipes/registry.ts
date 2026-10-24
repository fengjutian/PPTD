import type { RecipeId } from "../../design/deck-concept";
import { asymmetricSplit } from "./asymmetric-split";
import { comparison } from "./comparison";
import { coverStatement } from "./cover-statement";
import { dataStory } from "./data-story";
import { editorialIndex } from "./editorial-index";
import { imageLed } from "./image-led";
import { processRail } from "./process-rail";
import { quoteField } from "./quote-field";
import { sectionStatement } from "./section-statement";
import { timelineRail } from "./timeline-rail";
import type { LayoutRecipe } from "./types";

const RECIPES: Readonly<Record<RecipeId, LayoutRecipe>> = {
  "cover-statement": coverStatement,
  "data-story": dataStory,
  "editorial-index": editorialIndex,
  "asymmetric-split": asymmetricSplit,
  "image-led": imageLed,
  "process-rail": processRail,
  comparison: comparison,
  "timeline-rail": timelineRail,
  "quote-field": quoteField,
  "section-statement": sectionStatement,
};

export function findRecipe(id: RecipeId): LayoutRecipe | undefined {
  return RECIPES[id];
}

export function implementedRecipeIds(): RecipeId[] {
  return Object.keys(RECIPES) as RecipeId[];
}
