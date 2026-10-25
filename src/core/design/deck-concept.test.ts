import { describe, expect, it } from "vitest";
import type { CompositionFacts } from "../commands/design-intent";
import {
  CONCEPT_PRESET_IDS,
  defaultDocumentaryConcept,
  defaultEditorialConcept,
  defaultInstrumentConcept,
  defaultPaperConcept,
  planConceptRhythm,
  resolveDeckConcept,
  variantConceptPresetId,
  type ConceptPresetId,
} from "./deck-concept";

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

describe("deck concept", () => {
  it("expands the editorial preset into the recipes the renderer has", () => {
    const resolved = resolveDeckConcept({
      concept: defaultEditorialConcept(),
      pageFacts: Array.from({ length: 10 }, () => facts()),
      pageCount: 10,
      id: "concept-1",
    });
    expect(resolved.concept.id).toBe("concept-1");
    expect(resolved.concept.motif).toBe("rules");
    expect(resolved.concept.surface).toBe("rules");
    expect(resolved.concept.recipes).toEqual([
      "cover-statement",
      "data-story",
      "chart-story",
      "image-led",
      "editorial-index",
      "asymmetric-split",
      "process-rail",
      "comparison",
      "weighted-split",
      "timeline-rail",
      "quote-field",
      "section-statement",
    ]);
    expect(resolved.concept.rhythm).toHaveLength(10);
    expect(resolved.concept.rhythm[0]).toBe("statement");
    expect(resolved.concept.rhythm[9]).toBe("close");
    expect(resolved.conflicts).toEqual([]);
  });

  it("resolves the documentary preset with its own surface and imagery", () => {
    const resolved = resolveDeckConcept({
      concept: defaultDocumentaryConcept(),
      pageFacts: [facts()],
      pageCount: 1,
      id: "concept-doc",
    });
    expect(resolved.concept.preset).toBe("documentary");
    expect(resolved.concept.surface).toBe("full-bleed");
    expect(resolved.concept.motif).toBe("documentary");
    expect(resolved.concept.imagery).toBe("hero");
    expect(resolved.conflicts).toEqual([]);
  });

  it("resolves the paper and instrument presets as separate skeletons", () => {
    const paper = resolveDeckConcept({
      concept: defaultPaperConcept(),
      pageFacts: [facts()],
      pageCount: 1,
      id: "concept-paper",
    });
    expect(paper.concept.preset).toBe("paper");
    expect(paper.concept.surface).toBe("column");
    expect(paper.concept.motif).toBe("paper");
    expect(paper.concept.imagery).toBe("none");
    expect(paper.conflicts).toEqual([]);

    const instrument = resolveDeckConcept({
      concept: defaultInstrumentConcept(),
      pageFacts: [facts()],
      pageCount: 1,
      id: "concept-instrument",
    });
    expect(instrument.concept.preset).toBe("instrument");
    expect(instrument.concept.surface).toBe("rail");
    expect(instrument.concept.motif).toBe("instrument");
    expect(instrument.concept.typeContrast).toBe("dramatic");
    expect(instrument.conflicts).toEqual([]);
  });

  it("clamps an imagery intent the preset cannot render", () => {
    const resolved = resolveDeckConcept({
      concept: { ...defaultDocumentaryConcept(), imagery: "none" },
      pageFacts: [facts()],
      pageCount: 1,
      id: "concept-2",
    });
    expect(resolved.concept.imagery).toBe("hero");
    expect(resolved.conflicts[0]?.intent).toBe("imagery=none");
    expect(resolved.conflicts[0]?.reason).toContain("hero");
  });

  it("falls back to editorial for an unknown preset", () => {
    const resolved = resolveDeckConcept({
      concept: { ...defaultEditorialConcept(), preset: "unknown" as ConceptPresetId },
      pageFacts: [facts()],
      pageCount: 1,
      id: "concept-3",
    });
    expect(resolved.concept.preset).toBe("editorial");
    expect(resolved.conflicts[0]?.intent).toBe("preset=unknown");
  });

  it("marks a structured page as evidence", () => {
    const rhythm = planConceptRhythm(
      [facts(), facts({ hasRowBlock: true, layout: "cards" }), facts({ itemCount: 1, shortItems: true }), facts()],
      4,
    );
    expect(rhythm).toEqual(["statement", "evidence", "quiet", "close"]);
  });

  it("only opens a quiet run when the page has one point", () => {
    const rhythm = planConceptRhythm(
      [facts(), facts(), facts({ itemCount: 4, shortItems: true }), facts(), facts()],
      5,
    );
    expect(rhythm[2]).toBe("quiet");
    const single = planConceptRhythm(
      [facts(), facts(), facts({ itemCount: 1, shortItems: true }), facts(), facts()],
      5,
    );
    expect(single[2]).toBe("statement");
  });

  it("rejects a rhythm whose length does not match the deck", () => {
    expect(() =>
      resolveDeckConcept({ concept: defaultEditorialConcept(), pageFacts: [facts()], pageCount: 2 }),
    ).toThrow("AI_CONCEPT_RHYTHM_INVALID");
  });

  it("keeps the preset list in step with the renderer", () => {
    expect(CONCEPT_PRESET_IDS).toEqual(["editorial", "documentary", "paper", "instrument"]);
  });

  it("gives every batch card its own skeleton, starting from the recommendation", () => {
    // A batch that swaps only colours makes six cards look alike; each card has
    // to pair its palette with a different composition.
    expect(variantConceptPresetId("editorial", 0)).toBe("editorial");
    expect(["documentary", "paper", "instrument"]).toContain(variantConceptPresetId("editorial", 1));
    const cards = Array.from({ length: 6 }, (_, index) => variantConceptPresetId("paper", index));
    expect(cards.slice(0, 4)).toEqual(["paper", "instrument", "editorial", "documentary"]);
    // Neighbouring cards never share the skeleton, and the rotation repeats
    // only after every renderable preset has been used.
    for (let index = 1; index < cards.length; index += 1) expect(cards[index]).not.toBe(cards[index - 1]);
    expect(cards[4]).toBe("paper");
    expect(cards[5]).toBe("instrument");
  });
});
