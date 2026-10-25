import { describe, expect, it } from "vitest";
import type { CompositionFacts } from "../../commands/design-intent";
import { defaultConceptForPreset, defaultEditorialConcept, resolveDeckConcept } from "../../design/deck-concept";
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

  it("draws the direction's own composition on the same content", () => {
    const direction = (preset: "editorial" | "paper" | "instrument") =>
      resolveDeckConcept({
        concept: defaultConceptForPreset(preset),
        pageFacts: [facts()],
        pageCount: 1,
        id: preset,
      }).concept;
    const page = facts({ itemCount: 4, longestItemLength: 18 });
    expect(chooseRecipeId(page, direction("editorial"), options)).toBe("editorial-index");
    expect(chooseRecipeId(page, direction("paper"), options)).toBe("paper-column");
    expect(chooseRecipeId(page, direction("instrument"), options)).toBe("instrument-columns");
    // The instrument grid only takes four points; five falls back to the shared
    // list instead of forcing a fifth panel.
    expect(chooseRecipeId(facts({ itemCount: 5, longestItemLength: 18 }), direction("instrument"), options)).toBe(
      "editorial-index",
    );
    // A model asking for the editorial list on a direction page gets the
    // direction's page: the request describes "a list", not the index.
    expect(
      selectRecipe({ facts: page, concept: direction("paper"), requested: "editorial-index", options }).recipe?.id,
    ).toBe("paper-column");
    // The same request keeps the index on the editorial direction.
    expect(
      selectRecipe({ facts: page, concept: direction("editorial"), requested: "editorial-index", options }).recipe?.id,
    ).toBe("editorial-index");
  });

  it("chooses the data story for a metric page", () => {
    expect(chooseRecipeId(facts({ hasRowBlock: true, hasMetric: true }), concept(), options)).toBe("data-story");
  });

  it("chooses the structured recipes before the list recipes", () => {
    expect(chooseRecipeId(facts({ hasComparison: true, itemCount: 6 }), concept(), options)).toBe("comparison");
    expect(chooseRecipeId(facts({ hasProcess: true, hasRowBlock: true, itemCount: 0 }), concept(), options)).toBe(
      "process-rail",
    );
    expect(chooseRecipeId(facts({ hasTimeline: true, hasRowBlock: true, itemCount: 5 }), concept(), options)).toBe(
      "timeline-rail",
    );
    expect(chooseRecipeId(facts({ hasQuote: true, layout: "quote", itemCount: 1 }), concept(), options)).toBe(
      "quote-field",
    );
    expect(chooseRecipeId(facts({ layout: "section", itemCount: 1 }), concept(), options)).toBe("section-statement");
  });

  it("picks the picture composition from the content shape", () => {
    // A page with a few points and a side picture opens as two facing columns.
    expect(
      chooseRecipeId(facts({ itemCount: 3 }), concept(), {
        hasArtwork: false,
        hasAsset: true,
        assetRole: "side",
      }),
    ).toBe("side-image-text");
    // A statement page gives the picture the page and sets the copy on a plate.
    // Only the documentary direction carries that composition, so the set it is
    // resolved against decides whether the request is even legal.
    const documentary = resolveDeckConcept({
      concept: defaultConceptForPreset("documentary"),
      pageFacts: [facts({ itemCount: 1, layout: "cover" })],
      pageCount: 1,
      id: "plan-documentary",
    }).concept;
    expect(
      chooseRecipeId(facts({ itemCount: 1, layout: "cover" }), documentary, {
        hasArtwork: false,
        hasAsset: true,
        assetRole: "hero",
      }),
    ).toBe("full-bleed-image");
    // A band picture is a wide strip: it cannot become a tall column, and a
    // four-point page is not a statement. No recipe claims it, so the page keeps
    // the legacy layout that plans the band itself.
    expect(
      chooseRecipeId(facts({ itemCount: 4 }), concept(), {
        hasArtwork: false,
        hasAsset: true,
        assetRole: "band",
      }),
    ).toBeUndefined();
  });

  it("leaves structured pages to the legacy renderer", () => {
    expect(chooseRecipeId(facts({ hasRowBlock: true }), concept(), options)).toBeUndefined();
  });

  it("still chooses a content recipe on a template artwork page", () => {
    expect(chooseRecipeId(facts(), concept(), { hasArtwork: true, hasAsset: false })).toBe("editorial-index");
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

  it("falls back to the content's own recipe when the request no longer fits", () => {
    // The model asked for a plain cover, then attached a hero picture: the
    // request is refused, and the page becomes the picture-led cover instead of
    // dropping to the legacy branch.
    const result = selectRecipe({
      facts: facts({ layout: "cover", itemCount: 0 }),
      concept: concept(),
      requested: "cover-statement",
      options: { hasArtwork: false, hasAsset: true, assetRole: "hero" },
    });
    expect(result.recipe?.id).toBe("image-led");
    expect(result.conflict?.intent).toBe("recipe=cover-statement");
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
