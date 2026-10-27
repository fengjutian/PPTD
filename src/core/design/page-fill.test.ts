import { describe, expect, it } from "vitest";
import { createDocument, createSlide, inches } from "../document-model";
import type { ElementId, RectEmu, ShapeElement, TextElement } from "../document-model";
import { measureDeckFill } from "./page-fill";
import type { AiSlideDesign } from "../commands";

const design = (overrides: Partial<AiSlideDesign> = {}): AiSlideDesign => ({
  layout: "title-body",
  background: "#FFFFFF",
  accent: "#2255AA",
  titleColor: "#111111",
  bodyColor: "#333333",
  ...overrides,
});

function text(source: TextElement, frame: RectEmu, value: string, fontSizePt = 18): TextElement {
  return {
    ...structuredClone(source),
    id: crypto.randomUUID() as ElementId,
    frame,
    text: value,
    style: { ...source.style, fontSizePt },
  };
}

function plate(frame: RectEmu): ShapeElement {
  return {
    id: crypto.randomUUID() as ElementId,
    type: "shape",
    shape: "rectangle",
    frame,
    rotationMilliDegree: 0,
    locked: false,
    origin: "user",
    style: { fill: "#F2F4F8", stroke: "#DDE2EA", strokeWidthPt: 0, radiusPt: 0 },
  };
}

describe("measured page fill", () => {
  it("counts a sparse page as underfilled and a plate as a visual anchor", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    const title = slide.elements[0] as TextElement;
    slide.elements.push(text(title, { x: inches(1), y: inches(2), width: inches(4), height: inches(0.5) }, "一句正文"));
    const sparse = measureDeckFill(document, [design()]);
    expect(sparse.contentCoverage).toBeLessThan(0.1);
    expect(sparse.underfilledPages).toEqual([0]);
    expect(sparse.anchorRatio).toBe(0);

    slide.elements.push(plate({ x: inches(6), y: inches(1.5), width: inches(4), height: inches(3) }));
    const filled = measureDeckFill(document, [design()]);
    expect(filled.contentCoverage).toBeGreaterThan(sparse.contentCoverage);
    expect(filled.anchorRatio).toBe(1);
    expect(filled.slides[0]!.hasVisualAnchor).toBe(true);
  });

  it("does not let a full-bleed field rescue an empty page", () => {
    const document = createDocument();
    const slide = document.slides[0]!;
    slide.elements.push(
      plate({ x: inches(0), y: inches(0), width: document.pageSize.width, height: document.pageSize.height }),
    );
    const fill = measureDeckFill(document, [design()]);
    expect(fill.slides[0]!.hasVisualAnchor).toBe(false);
    expect(fill.slides[0]!.coverage).toBeLessThan(0.1);
    expect(fill.underfilledPages).toEqual([0]);
  });

  it("excludes covers, section pages and quotes from the density target", () => {
    const document = createDocument();
    document.slides.push(createSlide(2));
    const fill = measureDeckFill(document, [design({ layout: "cover" }), design({ layout: "quote" })]);
    expect(fill.contentCoverage).toBe(1);
    expect(fill.anchorRatio).toBe(1);
    expect(fill.underfilledPages).toEqual([]);
  });
});
