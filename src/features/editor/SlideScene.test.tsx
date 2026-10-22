import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDocument, emu, type Slide } from "../../core/document-model";
import { SlideElementContent, SlideElementFrame, SlideScene } from "./SlideScene";
import { ptToPx, sceneScale } from "./scene-metrics";

const PAGE_WIDTH = emu(12_192_000);
const PAGE_HEIGHT = emu(6_858_000);

function slideWithText(): Slide {
  const document = createDocument();
  const slide = document.slides[0]!;
  slide.background = "#101820";
  const element = slide.elements[0]!;
  if (element.type !== "text") throw new Error("expected a text element");
  element.text = "标题";
  element.style = { ...element.style, fontSizePt: 20 };
  element.frame = { x: emu(914_400), y: emu(914_400), width: emu(4_572_000), height: emu(914_400) };
  return slide;
}

/** The font size the markup carries, in pixels. */
function fontSizeOf(markup: string): number {
  const match = /font-size:([\d.]+)px/.exec(markup);
  if (!match) throw new Error(`no font size in markup: ${markup}`);
  return Number(match[1]);
}

describe("slide scene", () => {
  it("reads the scale of a surface as the pixels one EMU covers", () => {
    expect(sceneScale(960, 12_192_000)).toBeCloseTo(960 / 12_192_000, 12);
    // A surface that has not been measured yet has no scale.
    expect(sceneScale(0, 12_192_000)).toBe(0);
  });

  it("turns a length in points into the pixels of the surface", () => {
    const scale = sceneScale(960, 12_192_000);
    // A page of 13.33 inches drawn 960 pixels wide has 72 pixels per inch.
    expect(ptToPx(72, scale)).toBeCloseTo(72, 6);
  });

  it("draws the text of a page with the size it has on the canvas", () => {
    const slide = slideWithText();
    const canvasScale = sceneScale(960, PAGE_WIDTH);
    const markup = renderToStaticMarkup(
      <SlideElementContent element={slide.elements[0]!} slide={slide} scale={canvasScale} />,
    );
    expect(fontSizeOf(markup)).toBeCloseTo(20, 6);
  });

  it("keeps the proportions of a page when the preview draws it smaller", () => {
    const slide = slideWithText();
    const canvasScale = sceneScale(960, PAGE_WIDTH);
    const previewScale = sceneScale(240, PAGE_WIDTH);
    const canvas = renderToStaticMarkup(
      <SlideElementContent element={slide.elements[0]!} slide={slide} scale={canvasScale} />,
    );
    const preview = renderToStaticMarkup(
      <SlideElementContent element={slide.elements[0]!} slide={slide} scale={previewScale} />,
    );
    // The preview is the canvas drawn a quarter as wide, so every length of
    // the text is a quarter as long.
    expect(fontSizeOf(preview)).toBeCloseTo(fontSizeOf(canvas) / 4, 6);
  });

  it("places an element where the document says it is", () => {
    const slide = slideWithText();
    const scale = sceneScale(240, PAGE_WIDTH);
    const markup = renderToStaticMarkup(
      <SlideElementFrame element={slide.elements[0]!} scale={scale}>
        <span />
      </SlideElementFrame>,
    );
    expect(Number(/left:([\d.]+)px/.exec(markup)![1])).toBeCloseTo(914_400 * scale, 6);
    expect(Number(/top:([\d.]+)px/.exec(markup)![1])).toBeCloseTo(914_400 * scale, 6);
    expect(Number(/width:([\d.]+)px/.exec(markup)![1])).toBeCloseTo(4_572_000 * scale, 6);
  });

  it("draws the page with the background of the document", () => {
    const slide = slideWithText();
    const markup = renderToStaticMarkup(
      <SlideScene slide={slide} pageWidth={PAGE_WIDTH} pageHeight={PAGE_HEIGHT} scale={sceneScale(240, PAGE_WIDTH)} />,
    );
    expect(markup).toContain("background:#101820");
  });
});
