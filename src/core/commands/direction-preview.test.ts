import { describe, expect, it } from "vitest";
import {
  buildDesignPreviewDocument,
  previewDesigns,
  previewFacts,
  previewSlides,
} from "../../../tools/design-preview/fixture";
import {
  defaultInstrumentConcept,
  defaultPaperConcept,
  defaultDocumentaryConcept,
  defaultEditorialConcept,
  resolveDeckConcept,
} from "../design/deck-concept";
import type { ShapeElement, TextElement } from "../document-model";
import { buildDirectionPreviewPages } from "./direction-preview";

function concept(source: ReturnType<typeof defaultEditorialConcept>) {
  return resolveDeckConcept({
    concept: source,
    pageFacts: previewFacts,
    pageCount: previewSlides.length,
    id: "preview-test",
  }).concept;
}

const editorial = concept(defaultEditorialConcept());
const documentary = concept(defaultDocumentaryConcept());
const paper = concept(defaultPaperConcept());
const instrument = concept(defaultInstrumentConcept());

function titleFrame(document: ReturnType<typeof buildDesignPreviewDocument>, slideIndex: number) {
  const title = document.slides[slideIndex]!.elements.find(
    (element): element is TextElement => element.type === "text" && element.contentRef === "title",
  )!;
  return {
    x: title.frame.x / document.pageSize.width,
    y: title.frame.y / document.pageSize.height,
    width: title.frame.width / document.pageSize.width,
  };
}

describe("direction preview", () => {
  it("builds one-page documents without touching the real deck", () => {
    const document = buildDesignPreviewDocument();
    const before = JSON.stringify(document);
    const previews = buildDirectionPreviewPages({
      document,
      concept: editorial,
      pageIndexes: [2, 3],
      designs: [previewDesigns[2]!, previewDesigns[3]!],
      commandBase: { themePresetId: "editorial-teal" },
    });
    expect(previews).toHaveLength(2);
    expect(previews.map((page) => page.index)).toEqual([2, 3]);
    expect(previews.every((page) => page.document.slides.length === 1)).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
  });

  it("keeps the title axis of the page it previews", () => {
    const document = buildDesignPreviewDocument();
    const full = titleFrame(document, 3);
    const [preview] = buildDirectionPreviewPages({
      document,
      concept: editorial,
      pageIndexes: [3],
      designs: [previewDesigns[3]!],
      commandBase: { themePresetId: "editorial-teal" },
    });
    const previewed = titleFrame(preview!.document, 0);
    // The one-page preview may rotate the deck rhythm slightly; the axis itself
    // must be the same page, not a default one.
    expect(Math.abs(previewed.x - full.x)).toBeLessThan(0.01);
    expect(Math.abs(previewed.y - full.y)).toBeLessThan(0.05);
  });

  it("shows the surface difference between directions", () => {
    const document = buildDesignPreviewDocument();
    const previewFor = (deckConcept: ReturnType<typeof concept>) =>
      buildDirectionPreviewPages({
        document,
        concept: deckConcept,
        pageIndexes: [3],
        designs: [previewDesigns[3]!],
        commandBase: { themePresetId: "editorial-teal" },
      })[0]!;
    expect(titleFrame(previewFor(editorial).document, 0).x).toBeCloseTo(0.07, 2);
    expect(titleFrame(previewFor(documentary).document, 0).x).toBeCloseTo(0.04, 2);
    // The paper direction centres a narrower column; the instrument direction
    // keeps the copy off the left edge and draws its rail there.
    expect(titleFrame(previewFor(paper).document, 0).x).toBeCloseTo(0.17, 2);
    const instrumentPreview = previewFor(instrument).document;
    expect(titleFrame(instrumentPreview, 0).x).toBeCloseTo(0.22, 2);
    const rail = instrumentPreview.slides[0]!.elements.find(
      (element): element is ShapeElement =>
        element.type === "shape" &&
        element.frame.width / instrumentPreview.pageSize.width < 0.006 &&
        element.frame.height / instrumentPreview.pageSize.height > 0.3 &&
        element.frame.x / instrumentPreview.pageSize.width < 0.2,
    );
    expect(rail).toBeDefined();
    expect(rail!.frame.x / instrumentPreview.pageSize.width).toBeCloseTo(0.185, 2);
  });

  it("keeps every cover title clear of the accent panel", () => {
    const document = buildDesignPreviewDocument();
    for (const deckConcept of [editorial, documentary, paper, instrument]) {
      const [preview] = buildDirectionPreviewPages({
        document,
        concept: deckConcept,
        pageIndexes: [0],
        designs: [previewDesigns[0]!],
        commandBase: { themePresetId: "editorial-teal" },
      });
      const title = titleFrame(preview!.document, 0);
      // The cover's right accent panel starts at 0.78. A centred or right-shifted
      // surface must shorten the title instead of running under the panel.
      expect(title.x + title.width).toBeLessThanOrEqual(0.78);
    }
  });

  it("rejects mismatched page and design counts", () => {
    const document = buildDesignPreviewDocument();
    expect(() =>
      buildDirectionPreviewPages({
        document,
        concept: editorial,
        pageIndexes: [1, 2],
        designs: [previewDesigns[1]!],
      }),
    ).toThrow("DIRECTION_PREVIEW_MISMATCH");
  });
});
