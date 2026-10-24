import { describe, expect, it } from "vitest";
import {
  buildDesignPreviewDocument,
  previewDesigns,
  previewFacts,
  previewSlides,
} from "../../../tools/design-preview/fixture";
import { defaultDocumentaryConcept, defaultEditorialConcept, resolveDeckConcept } from "../design/deck-concept";
import type { TextElement } from "../document-model";
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

function titleFrame(document: ReturnType<typeof buildDesignPreviewDocument>, slideIndex: number) {
  const title = document.slides[slideIndex]!.elements.find(
    (element): element is TextElement => element.type === "text" && element.contentRef === "title",
  )!;
  return { x: title.frame.x / document.pageSize.width, y: title.frame.y / document.pageSize.height };
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
    const [editorialPreview] = buildDirectionPreviewPages({
      document,
      concept: editorial,
      pageIndexes: [3],
      designs: [previewDesigns[3]!],
      commandBase: { themePresetId: "editorial-teal" },
    });
    const [documentaryPreview] = buildDirectionPreviewPages({
      document,
      concept: documentary,
      pageIndexes: [3],
      designs: [previewDesigns[3]!],
      commandBase: { themePresetId: "editorial-teal" },
    });
    expect(titleFrame(editorialPreview!.document, 0).x).toBeCloseTo(0.07, 2);
    expect(titleFrame(documentaryPreview!.document, 0).x).toBeCloseTo(0.04, 2);
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
