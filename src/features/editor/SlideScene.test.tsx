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

  it("marks a text whose copy does not fit its frame", () => {
    // The canvas clips the last line silently; the dashed edge is what tells the
    // reader that the box, not the copy, is wrong.
    const slide = slideWithText();
    const element = slide.elements[0]!;
    if (element.type !== "text") throw new Error("expected a text element");
    element.text = "搜索与广告业务规模大、利润率高，是 Alphabet 当前的现金牛，但增速持续放缓";
    element.style = { ...element.style, fontSizePt: 18, lineHeight: 1.25 };
    // A one-line-tall frame holding three lines of copy.
    element.frame = { x: emu(914_400), y: emu(914_400), width: emu(4_572_000), height: emu(228_600) };
    const overflowing = renderToStaticMarkup(
      <SlideElementFrame element={element} scale={sceneScale(240, PAGE_WIDTH)}>
        <span />
      </SlideElementFrame>,
    );
    expect(overflowing).toContain("text-overflow");
    // A frame that holds the copy carries no warning.
    element.frame = { x: emu(914_400), y: emu(914_400), width: emu(4_572_000), height: emu(3_810_000) };
    const fitting = renderToStaticMarkup(
      <SlideElementFrame element={element} scale={sceneScale(240, PAGE_WIDTH)}>
        <span />
      </SlideElementFrame>,
    );
    expect(fitting).not.toContain("text-overflow");
  });

  it("leaves a hidden element out of a page preview", () => {
    const slide = slideWithText();
    slide.elements[0]!.hidden = true;
    const markup = renderToStaticMarkup(
      <SlideScene slide={slide} pageWidth={PAGE_WIDTH} pageHeight={PAGE_HEIGHT} scale={sceneScale(240, PAGE_WIDTH)} />,
    );
    expect(markup).not.toContain("标题");
  });
});
