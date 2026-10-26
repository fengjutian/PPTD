import type { RecipeId } from "./deck-concept";
import { RECIPE_CATALOG } from "../layout/recipes/catalog";

export const RECIPE_SPECIMEN_VERSION = "1";

export type RecipeSpecimenMode = "light" | "dark" | "capacity" | "template";

export interface RecipeSpecimenCase {
  id: string;
  recipeId: RecipeId;
  mode: RecipeSpecimenMode;
  expectedEditable: boolean;
  checks: readonly ("visual" | "capacity" | "template-fit" | "native-objects")[];
}

const MODES: readonly RecipeSpecimenMode[] = ["light", "dark", "capacity", "template"];

/** The complete baseline matrix; rendering tools may execute it in batches. */
export const RECIPE_SPECIMENS: readonly RecipeSpecimenCase[] = Object.values(RECIPE_CATALOG).flatMap((entry) =>
  MODES.map((mode) => ({
    id: `${entry.id}:${mode}`,
    recipeId: entry.id,
    mode,
    expectedEditable: true,
    checks:
      mode === "capacity"
        ? (["visual", "capacity", "native-objects"] as const)
        : mode === "template"
          ? (["visual", "template-fit", "native-objects"] as const)
          : (["visual", "native-objects"] as const),
  })),
);

export function recipeSpecimens(recipeId: RecipeId): RecipeSpecimenCase[] {
  return RECIPE_SPECIMENS.filter((specimen) => specimen.recipeId === recipeId);
}
