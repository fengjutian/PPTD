import type { RecipeId } from "../../design/deck-concept";
import { asymmetricSplit } from "./asymmetric-split";
import { comparison } from "./comparison";
import { coverStatement } from "./cover-statement";
import { dataStory } from "./data-story";
import { chartStory } from "./chart-story";
import { tableStory } from "./table-story";
import { editorialIndex } from "./editorial-index";
import { fullBleedImage } from "./full-bleed-image";
import { imageLed } from "./image-led";
import { instrumentColumns } from "./instrument-columns";
import { paperColumn } from "./paper-column";
import { processRail } from "./process-rail";
import { quoteField } from "./quote-field";
import { sectionStatement } from "./section-statement";
import { sideImageText } from "./side-image-text";
import { timelineRail } from "./timeline-rail";
import { weightedSplit } from "./weighted-split";
import type { LayoutRecipe } from "./types";
export { RECIPE_CATALOG, recipeCatalogForConcept } from "./catalog";

const RECIPES: Readonly<Record<RecipeId, LayoutRecipe>> = {
  "cover-statement": coverStatement,
  "data-story": dataStory,
  "chart-story": chartStory,
  "table-story": tableStory,
  "editorial-index": editorialIndex,
  "asymmetric-split": asymmetricSplit,
  "image-led": imageLed,
  "full-bleed-image": fullBleedImage,
  "side-image-text": sideImageText,
  "process-rail": processRail,
  comparison: comparison,
  "weighted-split": weightedSplit,
  "timeline-rail": timelineRail,
  "quote-field": quoteField,
  "section-statement": sectionStatement,
  "paper-column": paperColumn,
  "instrument-columns": instrumentColumns,
};

export function findRecipe(id: RecipeId): LayoutRecipe | undefined {
  return RECIPES[id];
}

export function implementedRecipeIds(): RecipeId[] {
  return Object.keys(RECIPES) as RecipeId[];
}
