import { describe, expect, it } from "vitest";

import { createDocument } from "../document-model";
import { defaultEditorialConcept, resolveDeckConcept } from "../design/deck-concept";
import { applyCommand, type DocumentCommand } from "./commands";
import { buildDesignCandidates, designWithRecipe } from "./design-candidates";
import type { AiSlideDesign } from "./template-layouts";

const items = ["第一件事", "第二件事", "第三件事"];

const concept = resolveDeckConcept({
  concept: defaultEditorialConcept(),
  pageFacts: [
    {
      itemCount: items.length,
      shortItems: true,
      longestItemLength: 4,
      bodyLength: items.join("\n").length,
      hasQuote: false,
      hasComparison: false,
      hasRowBlock: false,
      hasMetric: false,
      hasChart: false,
      hasTimeline: false,
      hasProcess: false,
      hasTable: false,
      layout: "title-body",
    },
  ],
  pageCount: 1,
  id: "design-candidates-test",
}).concept;

const design: AiSlideDesign = {
  layout: "title-body",
  background: "#FFFFFF",
  accent: "#3366CC",
  titleColor: "#172033",
  bodyColor: "#364152",
  designPlan: {
    role: "claim",
    composition: { primitive: "stack" },
    density: "normal",
    templatePolicy: "ignore",
    recipe: "asymmetric-split",
  },
};

function sourceDocument() {
  const command: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }> = {
    type: "apply-ai-designed-draft",
    title: "候选测试",
    slides: [{ title: "三件事", body: items.join("\n"), speakerNotes: "" }],
    designConcept: concept,
    designs: [design],
  };
  const document = createDocument();
  applyCommand(document, command);
  return document;
}

describe("designWithRecipe", () => {
  it("keeps the plan and the legacy recipe field in sync without mutating the source", () => {
    const variant = designWithRecipe(design, "editorial-index");

    expect(variant.recipe).toBe("editorial-index");
    expect(variant.designPlan?.recipe).toBe("editorial-index");
    expect(design.recipe).toBeUndefined();
    expect(design.designPlan?.recipe).toBe("asymmetric-split");
  });
});

describe("buildDesignCandidates", () => {
  it("returns compiled recipe alternatives without changing the reviewed content", () => {
    const document = sourceDocument();
    const before = structuredClone(document);

    const result = buildDesignCandidates({
      document,
      slideIndex: 0,
      concept,
      design,
      limit: 2,
    });

    expect(result.slideIndex).toBe(0);
    expect(result.currentRecipe).toBe("asymmetric-split");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(2);
    expect(new Set(result.candidates.map((candidate) => candidate.recipe)).size).toBe(result.candidates.length);
    expect(result.candidates.every((candidate) => candidate.recipe !== "asymmetric-split")).toBe(true);
    for (const candidate of result.candidates) {
      const page = candidate.document.slides[0]!;
      expect(candidate.document.slides).toHaveLength(1);
      expect(page.content.title).toBe("三件事");
      expect(page.content.body).toBe(items.join("\n"));
      expect(candidate.report.slides).toHaveLength(1);
      expect(candidate.report.slides[0]?.report.outcome).not.toBe("rejected");
      expect(candidate.report.slides[0]?.report.selectedRecipe).toBe(candidate.recipe);
      expect(Array.isArray(candidate.audit)).toBe(true);
      expect(candidate.taste.issues).toBeDefined();
      expect(candidate.score).toBeGreaterThanOrEqual(0);
    }
    // The source deck is a read-only input: the caller keeps editing it.
    expect(document).toEqual(before);
  });

  it("requires a semantic plan before offering a variant", () => {
    const document = sourceDocument();
    const result = buildDesignCandidates({
      document,
      slideIndex: 0,
      concept,
      design: { ...design, designPlan: undefined },
    });

    expect(result.reason).toBe("DESIGN_CANDIDATE_PLAN_REQUIRED");
    expect(result.candidates).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("reports a missing page instead of throwing", () => {
    const result = buildDesignCandidates({
      document: createDocument(),
      slideIndex: 4,
      concept,
      design,
    });

    expect(result.reason).toBe("DESIGN_CANDIDATE_PAGE_MISSING");
    expect(result.candidates).toEqual([]);
  });

  it("clamps the requested number of candidates", () => {
    const document = sourceDocument();
    const result = buildDesignCandidates({
      document,
      slideIndex: 0,
      concept,
      design,
      limit: 99,
    });

    expect(result.candidates.length).toBeLessThanOrEqual(5);
  });
});
