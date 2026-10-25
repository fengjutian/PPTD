import { describe, expect, it } from "vitest";
import { THEME_PRESETS } from "../core/design/theme-presets";
import type { TextElement } from "../core/document-model";
import { buildSpecimenDocument, SPECIMEN_PAGE_COUNT } from "./theme-specimen";

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

  it("builds for every built-in theme preset", () => {
    for (const preset of THEME_PRESETS) {
      const document = buildSpecimenDocument({ themePresetId: preset.id });
      expect(document.slides, preset.id).toHaveLength(8);
      expect(document.theme?.name).toBe(preset.theme.name);
    }
  });

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
});
