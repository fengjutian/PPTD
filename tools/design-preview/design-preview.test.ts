import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildPptx } from "../../src/features/pptx-export/export-pptx";
import type { ImageElement, TextElement } from "../../src/core/document-model";
import { lintTaste } from "../../src/core/design/taste-lint";
import { chartSeriesColors } from "../../src/core/design/chart-theme";
import { deriveSemanticColors } from "../../src/core/design/design-tokens";
import { findThemePreset } from "../../src/core/design/theme-presets";
import { colorLuminance, contrastRatio } from "../../src/core/rendering/contrast";
import { rectsOverlap } from "../../src/core/layout/recipes/measure";
import { auditSlideLayout } from "../../src/core/layout/layout-audit";
import { refitDocumentText } from "../../src/core/layout/text-refit";
import { buildDesignPreviewDocument, buildVocabularyPreviewDocument, previewPage, previewSlides } from "./fixture";

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

    // The picture page is a plate, not a bleed: it starts below the header and
    // keeps the page margin, and the copy column faces it. Bleeding the picture
    // off the page edge is the `image-led` composition, still available when a
    // page asks for it.
    const image = document.slides[9]!.elements.find(
      (element): element is ImageElement => element.type === "image" && element.placement === "content",
    )!;
    // The plate keeps the page margin on every side instead of bleeding off it,
    // and no copy runs under it: the two columns are separate.
    expect(image.frame.y).toBeGreaterThan(0);
    expect(image.frame.y + image.frame.height).toBeLessThanOrEqual(document.pageSize.height);
    expect(image.frame.x + image.frame.width).toBeLessThanOrEqual(document.pageSize.width);
    const covered = document.slides[9]!.elements.filter(
      (element) => element.type === "text" && rectsOverlap(element.frame, image.frame),
    );
    expect(covered).toHaveLength(0);
  });

  it("preserves every reviewed title", () => {
    const document = buildDesignPreviewDocument();
    document.slides.forEach((slide, index) => {
      expect(slide.content.title).toBe(previewSlides[index]!.title);
    });
    expect(previewPage.width).toBe(10);
  });

  it("carries the copy of every built-in page inside its frame", () => {
    // The recipes fit what they place, and the refit that runs after a design
    // must therefore have nothing to repair. A recipe that starts overflowing
    // its own frame fails here instead of relying on the file's autofit.
    for (const conceptPresetId of ["editorial", "documentary", "paper", "instrument"] as const) {
      const document = buildDesignPreviewDocument({ conceptPresetId });
      const report = auditSlideLayout(document);
      expect(
        report.issues.map((issue) => `${conceptPresetId}:第 ${issue.slideIndex + 1} 页:${issue.kind}`),
        `${conceptPresetId} 的版面问题`,
      ).toEqual([]);
      const refit = refitDocumentText(document);
      expect(refit.adjustments, `${conceptPresetId} 的自动重排`).toEqual([]);
      expect(refit.conflicts, `${conceptPresetId} 的容量冲突`).toEqual([]);
    }
  });

  it("carries the vocabulary pages inside their frames too", () => {
    const document = buildVocabularyPreviewDocument();
    expect(auditSlideLayout(document).issues).toEqual([]);
    expect(refitDocumentText(document).adjustments).toEqual([]);
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

describe("dark vocabulary baseline", () => {
  it("paints the chart series in the brand colour, not in the page ink", async () => {
    const document = buildVocabularyPreviewDocument();
    const result = await buildPptx(document, { prevalidatedIssues: [] });
    const files = unzipSync(result.bytes);
    const chartPart = Object.keys(files).find((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    expect(chartPart).toBeDefined();
    const xml = strFromU8(files[chartPart!]!).toUpperCase();
    // The accent ink of a dark page is near-white; the bar must be the brand
    // colour lifted off the page instead (ADR 0104).
    const [bar] = chartSeriesColors({ background: "#12233D", accent: "#F2F6FA", accentStrong: "#0F7869" }, 1);
    expect(xml).toContain(bar!.replace("#", ""));
    expect(xml).not.toContain("F2F6FA");
  });

  it("derives the roles from the dark page instead of the light preset", () => {
    const document = buildVocabularyPreviewDocument();
    const preset = findThemePreset("editorial-teal")!;
    const stored = (name: string) => preset.theme.colors.find((color) => color.name === name)?.value;
    const derived = deriveSemanticColors({ surface: "#12233D", ink: "#D7DEE8", accent: "#0F7869" });

    const comparison = document.slides[0]!;
    const fills = comparison.elements.flatMap((element) => (element.type === "shape" ? [element.style.fill] : []));
    // The leak this baseline exists for: a light preset on a dark page used to
    // hand out its own near-white raised surface while the page kept light copy.
    expect(fills).not.toContain(stored("surfaceRaised"));
    expect(fills).not.toContain(stored("surfaceSunken"));
    // The page's own recessed field and solid header are the dark-derived ones.
    expect(fills).toContain(derived.surfaceSunken);
    expect(fills).toContain(derived.accentStrong);
    // A raised surface on a dark page is lighter than the page, not near-white.
    expect(colorLuminance(derived.surfaceRaised)!).toBeGreaterThan(colorLuminance("#12233D")!);
    expect(colorLuminance(derived.surfaceRaised)!).toBeLessThan(colorLuminance(stored("surfaceRaised")!));
  });

  it("keeps the column labels readable on the solid accent field", () => {
    const document = buildVocabularyPreviewDocument();
    const comparison = document.slides[0]!;
    for (const label of ["自建团队", "外部合作"]) {
      const text = comparison.elements.find((element) => element.type === "text" && element.text === label);
      expect(text?.type).toBe("text");
      if (text?.type !== "text") return;
      const chip = comparison.elements.find(
        (element) =>
          element.type === "shape" &&
          element.frame.width > document.pageSize.width * 0.2 &&
          element.frame.height > document.pageSize.height * 0.04 &&
          Math.abs(element.frame.y - text.frame.y) < document.pageSize.height * 0.05,
      );
      expect(chip?.type).toBe("shape");
      if (chip?.type !== "shape") return;
      expect(contrastRatio(text.style.color, chip.style.fill)!).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives the dark picture pages a plate that is not the light preset's", () => {
    const document = buildVocabularyPreviewDocument();
    const preset = findThemePreset("editorial-teal")!;
    const storedRaised = preset.theme.colors.find((color) => color.name === "surfaceRaised")?.value;
    const cover = document.slides[2]!;
    const plate = cover.elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.width >= document.pageSize.width - 1 &&
        element.frame.height > document.pageSize.height * 0.15,
    );
    expect(plate?.type).toBe("shape");
    expect(plate?.type === "shape" ? plate.style.fill : undefined).not.toBe(storedRaised);
  });
});
