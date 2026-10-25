import { describe, expect, it } from "vitest";
import { buildPptx } from "../../src/features/pptx-export/export-pptx";
import type { ImageElement, TextElement } from "../../src/core/document-model";
import { lintTaste } from "../../src/core/design/taste-lint";
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
    expect(texts(6)).toEqual(expect.arrayContaining(["自建团队", "委托合作"]));
    expect(texts(6)).not.toContain("VS");
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

  it("gives every direction different geometry, not just colours", () => {
    const editorial = buildDesignPreviewDocument({ conceptPresetId: "editorial" });
    const documentary = buildDesignPreviewDocument({ conceptPresetId: "documentary" });
    const paper = buildDesignPreviewDocument({ conceptPresetId: "paper" });
    const instrument = buildDesignPreviewDocument({ conceptPresetId: "instrument" });
    const titleX = (document: ReturnType<typeof buildDesignPreviewDocument>, index: number) => {
      const title = document.slides[index]!.elements.find(
        (element): element is TextElement => element.type === "text" && element.contentRef === "title",
      )!;
      return title.frame.x / document.pageSize.width;
    };
    // Full-bleed spends the margin, paper centres a narrower column, and the
    // instrument direction keeps the copy off the left rail.
    expect(titleX(editorial, 3)).toBeCloseTo(0.07, 2);
    expect(titleX(documentary, 3)).toBeCloseTo(0.04, 2);
    expect(titleX(paper, 3)).toBeCloseTo(0.17, 2);
    expect(titleX(instrument, 3)).toBeCloseTo(0.22, 2);
    // The editorial direction draws an accent rule under the title; documentary
    // does not, so the same content produces a different element count.
    expect(editorial.slides[3]!.elements.length).toBe(documentary.slides[3]!.elements.length + 1);
    // The two newer directions own a composition, not just a margin: the
    // instrument page puts one point per column, the editorial page keeps one
    // text column of numbered rows, and the paper column drops the index.
    const itemTexts = (document: ReturnType<typeof buildDesignPreviewDocument>) =>
      document.slides[3]!.elements.filter(
        (element): element is TextElement =>
          element.type === "text" &&
          element.contentRef === "decorative" &&
          !/^0\d$/.test(element.text.trim()) &&
          // The footer is decorative too; it sits below the content region.
          element.frame.y / document.pageSize.height < 0.85,
      );
    const itemColumns = (document: ReturnType<typeof buildDesignPreviewDocument>) =>
      new Set(itemTexts(document).map((element) => element.frame.x)).size;
    expect(itemColumns(editorial)).toBe(1);
    expect(itemColumns(paper)).toBe(1);
    expect(itemColumns(instrument)).toBe(4);
    expect(itemTexts(paper)).toHaveLength(4);
    const numerals = (document: ReturnType<typeof buildDesignPreviewDocument>) =>
      document.slides[3]!.elements.filter((element) => element.type === "text" && /^0\d$/.test(element.text.trim()))
        .length;
    expect(numerals(editorial)).toBe(4);
    expect(numerals(instrument)).toBe(4);
    expect(numerals(paper)).toBe(0);
  });

  it("passes the deterministic taste lint without a finding", () => {
    const document = buildDesignPreviewDocument();
    const report = lintTaste(document);
    // The fixture is the product's own output. A finding here is either a real
    // regression or a rule that fires on a deliberate choice; both must be
    // resolved before the rule ships.
    expect(report.issues).toEqual([]);
    // The cover is a full-bleed gradient and has no body copy. Both checks are
    // reported as skipped instead of pretending they ran.
    expect(report.skipped).toEqual(["full-bleed-artwork:color-whitespace", "typography:no-body"]);
  });

  it("exports ten pages as native objects", async () => {
    const document = buildDesignPreviewDocument();
    const result = await buildPptx(document, { prevalidatedIssues: [] });
    expect(result.report.slideCount).toBe(10);
    expect(result.report.package.valid).toBe(true);
    expect(result.report.package.slideCount).toBe(10);
    expect(result.report.nativeObjectCount).toBeGreaterThan(30);
    expect(result.bytes.byteLength).toBeGreaterThan(10_000);
    expect(result.report.tasteLint).toEqual({ hard: 0, soft: 0, codes: {} });
  }, 60_000);
});
