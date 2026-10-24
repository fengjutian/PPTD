import { describe, expect, it } from "vitest";
import { buildPptx } from "../../src/features/pptx-export/export-pptx";
import type { ImageElement, TextElement } from "../../src/core/document-model";
import { buildDesignPreviewDocument, previewPage, previewSlides } from "./fixture";

/**
 * The repeatable half of the ten-page design review.
 *
 * It checks composition facts that a human would otherwise have to eyeball on a
 * contact sheet: one title axis, content reaching into the lower half, the
 * expected recipe objects, preserved titles, and a valid native export. The
 * rendered contact sheet is still the human half; this test only stops the
 * structural regressions that are cheap to detect.
 */
describe("ten-page design preview", () => {
  it("covers every recipe and keeps one title axis", () => {
    const document = buildDesignPreviewDocument();
    expect(document.slides).toHaveLength(10);

    const titleYs = document.slides
      .slice(2)
      .flatMap((slide) =>
        slide.elements
          .filter((element): element is TextElement => element.type === "text" && element.contentRef === "title")
          .map((element) => element.frame.y / document.pageSize.height),
      );
    expect(titleYs).toHaveLength(8);
    expect(Math.max(...titleYs) - Math.min(...titleYs)).toBeLessThanOrEqual(0.002);
  });

  it("keeps content in the lower half of every content page", () => {
    const document = buildDesignPreviewDocument();
    for (let index = 2; index < document.slides.length; index += 1) {
      const slide = document.slides[index]!;
      const bottom = Math.max(
        ...slide.elements
          .filter(
            (element) =>
              ((element.type === "text" && element.contentRef !== undefined) || element.type === "image") &&
              // Footers sit below the content region; counting them would hide a
              // page whose body stops halfway down.
              element.frame.y / document.pageSize.height < 0.9,
          )
          .map((element) => (element.frame.y + element.frame.height) / document.pageSize.height),
      );
      expect(bottom, `第 ${index + 1} 页内容底边`).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("draws the expected object for each recipe", () => {
    const document = buildDesignPreviewDocument();
    const texts = (index: number) =>
      document.slides[index]!.elements.filter((element): element is TextElement => element.type === "text").map(
        (element) => element.text,
      );
    const ellipses = (index: number) =>
      document.slides[index]!.elements.filter((element) => element.type === "shape" && element.shape === "ellipse");

    expect(texts(1)).toEqual(expect.arrayContaining(["02", "第二部分 门店效率"]));
    expect(texts(2)).toEqual(expect.arrayContaining(["01", "客流回升"]));
    expect(texts(4)).toEqual(expect.arrayContaining(["38 万", "260 家", "5 天"]));
    expect(ellipses(5)).toHaveLength(4);
    expect(texts(6)).toEqual(expect.arrayContaining(["自建团队", "委托合作", "VS"]));
    expect(ellipses(7)).toHaveLength(5);
    expect(texts(8)).toEqual(expect.arrayContaining(["“", "先天下之忧而忧，后天下之乐而乐。", "— 范仲淹"]));

    const image = document.slides[9]!.elements.find(
      (element): element is ImageElement => element.type === "image" && element.placement === "content",
    )!;
    expect(image.frame).toEqual({
      x: Math.round(document.pageSize.width * 0.52),
      y: 0,
      width: Math.round(document.pageSize.width * 0.48),
      height: document.pageSize.height,
    });
  });

  it("preserves every reviewed title", () => {
    const document = buildDesignPreviewDocument();
    document.slides.forEach((slide, index) => {
      expect(slide.content.title).toBe(previewSlides[index]!.title);
    });
    expect(previewPage.width).toBe(10);
  });

  it("exports ten pages as native objects", async () => {
    const document = buildDesignPreviewDocument();
    const result = await buildPptx(document, { prevalidatedIssues: [] });
    expect(result.report.slideCount).toBe(10);
    expect(result.report.package.valid).toBe(true);
    expect(result.report.package.slideCount).toBe(10);
    expect(result.report.nativeObjectCount).toBeGreaterThan(30);
    expect(result.bytes.byteLength).toBeGreaterThan(10_000);
  }, 60_000);
});
