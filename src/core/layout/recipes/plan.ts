import type { CompositionFacts, IntentConflict } from "../../commands/design-intent";
import type { DeckConcept, RecipeId } from "../../design/deck-concept";
import type { SlideContent } from "../../document-model";
import { findRecipe } from "./registry";
import type { LayoutRecipe, RecipePlan, RecipeSelectionOptions } from "./types";

export interface RecipeRequest {
  facts: CompositionFacts;
  concept: DeckConcept;
  requested?: RecipeId;
  options: RecipeSelectionOptions;
}

export interface RecipeSelectionResult {
  recipe?: LayoutRecipe;
  conflict?: IntentConflict;
}

/**
 * The deterministic recipe a page would use if the model did not choose one.
 *
 * It mirrors the two recipes' content conditions, not their visual rules: a
 * page with three to six short points is an index, a page with two to five
 * longer points is a split. Anything else is left to the legacy renderer.
 */
export function chooseRecipeId(
  facts: CompositionFacts,
  concept: DeckConcept,
  options: RecipeSelectionOptions,
): RecipeId | undefined {
  if (options.hasArtwork) return undefined;
  if (options.hasAsset) return concept.recipes.includes("image-led") ? "image-led" : undefined;
  if (facts.layout === "cover" && concept.recipes.includes("cover-statement")) return "cover-statement";
  if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return undefined;
  if (
    facts.hasMetric &&
    !facts.hasTimeline &&
    !facts.hasProcess &&
    !facts.hasTable &&
    concept.recipes.includes("data-story")
  ) {
    return "data-story";
  }
  if (facts.hasQuote || facts.hasComparison || facts.hasRowBlock) return undefined;
  if (concept.recipes.includes("editorial-index") && facts.itemCount >= 3 && facts.itemCount <= 6 && facts.shortItems) {
    return "editorial-index";
  }
  if (
    concept.recipes.includes("asymmetric-split") &&
    facts.itemCount >= 2 &&
    facts.itemCount <= 5 &&
    facts.longestItemLength <= 48
  ) {
    return "asymmetric-split";
  }
  return undefined;
}

/**
 * Resolves the requested recipe against the concept and the content.
 *
 * A model may ask for a recipe the concept does not allow or the content cannot
 * carry. That is a reported conflict, not a silent substitution; the command
 * decides whether to fall back to the other recipe or to the legacy branch.
 */
export function selectRecipe(request: RecipeRequest): RecipeSelectionResult {
  if (request.requested) {
    if (!request.concept.recipes.includes(request.requested)) {
      return {
        conflict: {
          intent: `recipe=${request.requested}`,
          reason: "该页面配方不在当前设计方向允许的集合内",
        },
      };
    }
    const recipe = findRecipe(request.requested);
    if (!recipe) {
      return {
        conflict: { intent: `recipe=${request.requested}`, reason: "该页面配方还没有渲染实现" },
      };
    }
    if (!recipe.supports(request.facts, request.concept, request.options)) {
      return {
        conflict: {
          intent: `recipe=${request.requested}`,
          reason: "该页内容装不下所选配方，已回退到内容决定的版式",
        },
      };
    }
    return { recipe };
  }
  const id = chooseRecipeId(request.facts, request.concept, request.options);
  const recipe = id ? findRecipe(id) : undefined;
  return recipe && recipe.supports(request.facts, request.concept, request.options) ? { recipe } : {};
}

export interface RecipePageRequest {
  facts: CompositionFacts;
  requested?: RecipeId;
}

export interface DeckRecipePlan {
  recipes: Array<RecipeId | undefined>;
  adjustments: Array<{ slideIndex: number; from: RecipeId; to: RecipeId; reason: string }>;
}

const MAX_CONSECUTIVE = 2;

/**
 * Plans recipes across the deck.
 *
 * Explicit legal choices are kept. Automatic choices are adjusted only when the
 * same recipe would run for a third page and the other recipe is legal; the
 * alternative is never forced onto content that cannot carry it.
 */
export function planDeckRecipes(
  pages: readonly RecipePageRequest[],
  concept: DeckConcept,
  options: RecipeSelectionOptions,
): DeckRecipePlan {
  const recipes: Array<RecipeId | undefined> = [];
  const adjustments: DeckRecipePlan["adjustments"] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]!;
    const explicit =
      page.requested &&
      concept.recipes.includes(page.requested) &&
      findRecipe(page.requested)?.supports(page.facts, concept, options);
    let chosen = explicit ? page.requested : chooseRecipeId(page.facts, concept, options);
    const recent = recipes.slice(Math.max(0, index - MAX_CONSECUTIVE));
    if (chosen && !explicit && recent.length === MAX_CONSECUTIVE && recent.every((value) => value === chosen)) {
      const alternativeId =
        chosen === "editorial-index"
          ? "asymmetric-split"
          : chosen === "asymmetric-split"
            ? "editorial-index"
            : undefined;
      const alternative =
        alternativeId && concept.recipes.includes(alternativeId) ? findRecipe(alternativeId) : undefined;
      if (alternative?.supports(page.facts, concept, options)) {
        adjustments.push({
          slideIndex: index,
          from: chosen,
          to: alternativeId!,
          reason: `连续 ${MAX_CONSECUTIVE + 1} 页使用同一配方会让整册看起来像一页的重复`,
        });
        chosen = alternativeId;
      }
    }
    recipes.push(chosen);
  }
  return { recipes, adjustments };
}

/**
 * Checks that a recipe plan did not drop reviewed copy.
 *
 * The body check is deliberately about coverage, not about a second copy of the
 * text: a recipe may render the body as a lead paragraph or leave it represented
 * by the items. What it may not do is silently omit it.
 */
export function consumptionProblem(plan: RecipePlan, content: SlideContent): string | undefined {
  if (!plan.consumed.title) return "recipe did not consume the title";
  if (content.body.trim() && !plan.consumed.body) return "recipe did not consume the body";
  const bullet = content.blocks?.find((block) => block.type === "bullet-list");
  if (bullet?.type === "bullet-list" && plan.consumed.items !== bullet.items.length) {
    return `recipe consumed ${plan.consumed.items} items, content has ${bullet.items.length}`;
  }
  const expectedBlocks = (content.blocks ?? [])
    .filter((block) => block.type !== "paragraph")
    .map((block) => block.id)
    .sort();
  const consumedBlocks = [...plan.consumed.blockIds].sort();
  if (
    consumedBlocks.length !== expectedBlocks.length ||
    consumedBlocks.some((id, index) => id !== expectedBlocks[index])
  ) {
    return "recipe did not consume every structured block";
  }
  return undefined;
}
