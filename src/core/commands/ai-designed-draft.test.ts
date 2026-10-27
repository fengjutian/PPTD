import { describe, expect, it } from "vitest";
import { createDocument } from "../document-model";
import { defaultEditorialConcept, resolveDeckConcept } from "../design/deck-concept";
import type { DocumentCommand } from "./commands";
import { applyAiDesignedDraft, inspectAiDesignedDraftCompilation } from "./ai-designed-draft";

const command: Extract<DocumentCommand, { type: "apply-ai-designed-draft" }> = {
  type: "apply-ai-designed-draft",
  title: "编译报告",
  slides: [
    {
      title: "四项判断",
      body: ["第一项判断", "第二项判断", "第三项判断", "第四项判断"].join("\n"),
      speakerNotes: "",
    },
  ],
  designConcept: resolveDeckConcept({
    concept: defaultEditorialConcept(),
    pageFacts: [
      {
        itemCount: 4,
        shortItems: true,
        longestItemLength: 6,
        bodyLength: 24,
        hasQuote: false,
        hasComparison: false,
        hasRowBlock: false,
        layout: "title-body",
      },
    ],
    pageCount: 1,
    id: "compile-report-test",
  }).concept,
  designs: [
    {
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
    },
  ],
};

describe("AI designed draft compile report", () => {
  it("summarizes page compiler results without mutating the inspected document", () => {
    const document = createDocument();
    const before = structuredClone(document);
    const report = inspectAiDesignedDraftCompilation(document, command);

    expect(report).toMatchObject({
      outcome: "accepted",
      plannedSlides: 1,
      acceptedSlides: 1,
      adjustedSlides: 0,
      rejectedSlides: 0,
    });
    expect(report.slides[0]).toMatchObject({
      slideIndex: 0,
      report: { selectedRecipe: "asymmetric-split" },
    });
    expect(document).toEqual(before);
  });

  it("does not claim that legacy pages were checked by the plan compiler", () => {
    const report = inspectAiDesignedDraftCompilation(createDocument(), {
      ...command,
      designs: [{ ...command.designs[0]!, designPlan: undefined }],
    });
    expect(report).toMatchObject({
      outcome: "accepted",
      plannedSlides: 0,
      acceptedSlides: 0,
      adjustedSlides: 0,
      rejectedSlides: 0,
    });
  });

  it("attaches an editable LayoutTree to every AI-generated page", () => {
    const document = createDocument();
    applyAiDesignedDraft(document, command);

    expect(document.layoutDefinitions).toHaveLength(1);
    expect(document.slides[0]?.layoutBinding?.definitionId).toBe(document.layoutDefinitions?.[0]?.id);
    expect(Object.keys(document.slides[0]?.layoutBinding?.slotBindings ?? {})).not.toHaveLength(0);
    expect(document.layoutDefinitions?.[0]?.tree.root.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "slot", layoutState: "detached" })]),
    );
  });
});
