import { describe, expect, it } from "vitest";
import { createDocument, inches } from "../core/document-model";
import type { AiSlideDesign } from "../core/commands";
import { candidateAestheticGate, compositionHomogeneity, scorePresentationAesthetics } from "./design-aesthetic-score";

const design = (overrides: Partial<AiSlideDesign> = {}): AiSlideDesign => ({
  layout: "title-body",
  background: "#FFFFFF",
  accent: "#2255AA",
  titleColor: "#111111",
  bodyColor: "#333333",
  ...overrides,
});

describe("design aesthetic score", () => {
  it("penalizes colour-only candidates with identical compositions", () => {
    const decks = [[design()], [design({ accent: "#AA2222" })], [design({ layout: "split" })]];
    expect(compositionHomogeneity(decks)[0]).toBeLessThan(50);
    expect(compositionHomogeneity(decks)[2]).toBeGreaterThan(compositionHomogeneity(decks)[0]!);
  });

  it("rejects a cover whose visible title and subtitle overlap", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.elements.push({
      ...structuredClone(slide.elements[0]!),
      id: crypto.randomUUID() as never,
      contentRef: "body",
      frame: { x: inches(0.8), y: inches(1), width: inches(7), height: inches(0.7) },
      text: "副标题",
    } as never);
    const gate = candidateAestheticGate({ document, designs: [design({ layout: "cover" })] });
    expect(gate.reasons).toContain("COVER_TEXT_OVERLAP:0");
    expect(gate.passed).toBe(false);
  });

  it("scores seven explicit dimensions", () => {
    const score = scorePresentationAesthetics({ document: createDocument(), designs: [design()] });
    expect(Object.keys(score.dimensions)).toEqual([
      "hierarchy",
      "balance",
      "rhythm",
      "homogeneity",
      "imageRelevance",
      "coverage",
      "visualAnchor",
    ]);
  });

  it("treats a deck that requests no pictures as neutral, not full marks", () => {
    const score = scorePresentationAesthetics({ document: createDocument(), designs: [design()] });
    expect(score.dimensions.imageRelevance).toBe(55);
  });
});
