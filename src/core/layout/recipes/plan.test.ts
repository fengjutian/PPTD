import { describe, expect, it } from "vitest";
import type { CompositionFacts } from "../../commands/design-intent";
import { defaultEditorialConcept, resolveDeckConcept } from "../../design/deck-concept";
import { chooseRecipeId, planDeckRecipes, selectRecipe } from "./plan";

function facts(overrides: Partial<CompositionFacts> = {}): CompositionFacts {
  return {
    itemCount: 4,
    shortItems: true,
    longestItemLength: 20,
    bodyLength: 80,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "cards",
    ...overrides,
  };
}

function concept(typeContrast: "calm" | "strong" | "dramatic" = "strong") {
  return resolveDeckConcept({
    concept: { ...defaultEditorialConcept(), typeContrast },
    pageFacts: [facts()],
    pageCount: 1,
    id: "plan",
  }).concept;
}

const options = { hasArtwork: false, hasAsset: false };

describe("recipe planning", () => {
  it("chooses the index for short points and the split for longer points", () => {
    expect(chooseRecipeId(facts(), concept(), options)).toBe("editorial-index");
    expect(chooseRecipeId(facts({ shortItems: false, itemCount: 5, longestItemLength: 30 }), concept(), options)).toBe(
      "asymmetric-split",
    );
  });

  it("chooses the cover recipe for a cover", () => {
    expect(chooseRecipeId(facts({ layout: "cover", itemCount: 1 }), concept(), options)).toBe("cover-statement");
  });

  it("leaves structured pages to the legacy renderer", () => {
    expect(chooseRecipeId(facts({ hasRowBlock: true }), concept(), options)).toBeUndefined();
    expect(chooseRecipeId(facts(), concept(), { hasArtwork: true, hasAsset: false })).toBeUndefined();
  });

  it("reports a requested recipe the content cannot carry", () => {
    const result = selectRecipe({
      facts: facts({ itemCount: 7 }),
      concept: concept(),
      requested: "editorial-index",
      options,
    });
    expect(result.recipe).toBeUndefined();
    expect(result.conflict?.intent).toBe("recipe=editorial-index");
  });

  it("accepts a requested recipe that is legal", () => {
    const result = selectRecipe({
      facts: facts({ itemCount: 5, shortItems: false, longestItemLength: 30 }),
      concept: concept(),
      requested: "asymmetric-split",
      options,
    });
    expect(result.recipe?.id).toBe("asymmetric-split");
  });

  it("breaks a third consecutive automatic recipe when the alternative is legal", () => {
    const pages = Array.from({ length: 4 }, () => ({ facts: facts() }));
    const plan = planDeckRecipes(pages, concept(), options);
    expect(plan.recipes).toEqual(["editorial-index", "editorial-index", "asymmetric-split", "editorial-index"]);
    expect(plan.adjustments).toHaveLength(1);
  });

  it("does not rewrite an explicit legal choice for rhythm", () => {
    const pages = [
      { facts: facts(), requested: "editorial-index" as const },
      { facts: facts(), requested: "editorial-index" as const },
      { facts: facts(), requested: "editorial-index" as const },
    ];
    const plan = planDeckRecipes(pages, concept(), options);
    expect(plan.recipes).toEqual(["editorial-index", "editorial-index", "editorial-index"]);
    expect(plan.adjustments).toHaveLength(0);
  });
});
