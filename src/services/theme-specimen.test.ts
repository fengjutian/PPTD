import { describe, expect, it } from "vitest";
import { THEME_PRESETS } from "../core/design/theme-presets";
import type { TextElement } from "../core/document-model";
import { buildSpecimenDocument, buildThemeCoverPreviewDocument, SPECIMEN_PAGE_COUNT } from "./theme-specimen";

describe("theme specimens", () => {
  it("draws the eight page roles the picker promises", () => {
    const document = buildSpecimenDocument();
    expect(document.slides).toHaveLength(SPECIMEN_PAGE_COUNT);
    expect(document.slides).toHaveLength(8);
    expect(document.slides[4]!.elements.some((element) => element.type === "table")).toBe(true);
    expect(document.slides[5]!.elements.some((element) => element.type === "chart")).toBe(true);
    expect(
      document.slides[6]!.elements.some((element) => element.type === "image" && element.placement === "content"),
    ).toBe(true);
    const metricText = document.slides[3]!.elements.filter(
      (element): element is TextElement => element.type === "text",
    ).map((element) => element.text);
    expect(metricText).toEqual(expect.arrayContaining(["38 万", "260 家"]));
  });

  it(
    "builds for every built-in theme preset",
    () => {
      for (const preset of THEME_PRESETS) {
        const document = buildSpecimenDocument({ themePresetId: preset.id });
        expect(document.slides, preset.id).toHaveLength(8);
        expect(document.theme?.name).toBe(preset.theme.name);
      }
    },
    15_000,
  );

  it("reflects the concept surface, not just the palette", () => {
    const editorial = buildSpecimenDocument({ conceptPresetId: "editorial" });
    const documentary = buildSpecimenDocument({ conceptPresetId: "documentary" });
    const paper = buildSpecimenDocument({ conceptPresetId: "paper" });
    const instrument = buildSpecimenDocument({ conceptPresetId: "instrument" });
    const titleX = (document: ReturnType<typeof buildSpecimenDocument>) => {
      const title = document.slides[3]!.elements.find(
        (element): element is TextElement => element.type === "text" && element.contentRef === "title",
      )!;
      return title.frame.x / document.pageSize.width;
    };
    expect(titleX(editorial)).toBeCloseTo(0.07, 2);
    expect(titleX(documentary)).toBeCloseTo(0.04, 2);
    expect(titleX(paper)).toBeCloseTo(0.17, 2);
    expect(titleX(instrument)).toBeCloseTo(0.22, 2);
  });

  it("builds the picker preview through the real cover recipe with reviewed copy", () => {
    const document = buildThemeCoverPreviewDocument({
      themePresetId: "finance-gold",
      conceptPresetId: "instrument",
      title: "Alphabet 2023 年报：广告基本盘与 AI 第二曲线同时加速",
      subtitle: "稳健、可信、精致",
    });
    expect(document.slides).toHaveLength(1);
    const texts = document.slides[0]!.elements.filter(
      (element): element is TextElement => element.type === "text",
    );
    expect(texts.some((element) => element.text.includes("广告基本盘"))).toBe(true);
    expect(texts.some((element) => element.text === "稳健、可信、精致")).toBe(true);
    expect(document.slides[0]!.elements.some((element) => element.type === "shape")).toBe(true);
  });

  it("gives paper and instrument covers different composition, not only different colours", () => {
    const common = { themePresetId: "finance-gold", title: "年度经营判断", subtitle: "管理层汇报" };
    const paper = buildThemeCoverPreviewDocument({ ...common, conceptPresetId: "paper" });
    const instrument = buildThemeCoverPreviewDocument({ ...common, conceptPresetId: "instrument" });
    const paperShapes = paper.slides[0]!.elements.filter((element) => element.type === "shape");
    const instrumentShapes = instrument.slides[0]!.elements.filter((element) => element.type === "shape");
    expect(instrumentShapes.length).toBeGreaterThan(paperShapes.length);
    expect(
      instrumentShapes.some(
        (element) => element.frame.height > instrument.pageSize.height * 0.7 && element.frame.width < instrument.pageSize.width * 0.02,
      ),
    ).toBe(true);
  });
});
