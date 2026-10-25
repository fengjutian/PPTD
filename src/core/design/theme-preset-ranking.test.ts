import { describe, expect, it } from "vitest";
import {
  defaultConceptIdForTheme,
  planThemePresetVariants,
  rankThemePresets,
  themePresetAccentHue,
  themePresetGenre,
  type ThemeContentSignals,
} from "./theme-preset-ranking";
import { DEFAULT_THEME_PRESET_ID, THEME_PRESETS, findThemePreset } from "./theme-presets";

const annualReport: ThemeContentSignals = {
  title: "Alphabet 2023 年报：广告基本盘与 AI 第二曲线",
  bodyText: "广告收入仍是基本盘，云业务首次实现年度盈利，生成式 AI 已同时进入搜索与广告。".repeat(8),
  slideCount: 6,
  chartCount: 2,
  tableCount: 1,
  metricCount: 3,
};

describe("theme preset ranking", () => {
  it("puts the subject family first and says why", () => {
    const ranked = rankThemePresets(annualReport);
    expect(ranked[0]?.presetId).toBe("finance-gold");
    expect(ranked[0]?.reason).toContain("财务与投资");
    expect(ranked[0]?.reason).toContain("图表或表格");
  });

  it("prefers a preset that owns the page types when no keyword matches", () => {
    const ranked = rankThemePresets({ title: "第三季度业务复盘", chartCount: 3, tableCount: 2 });
    const scores = new Map(ranked.map((choice) => [choice.presetId, choice.score]));
    expect(ranked[0]?.presetId).toBe("consulting-navy");
    expect(scores.get("consulting-navy")!).toBeGreaterThan(scores.get("paper-ink")!);
  });

  it("falls back to the general-purpose preset with no signal at all", () => {
    const ranked = rankThemePresets({ title: "秋天的颜色" });
    expect(ranked[0]?.presetId).toBe(DEFAULT_THEME_PRESET_ID);
    expect(ranked[0]?.reason).toContain("通用节奏");
  });

  it("prefers presets drawn for the same kind of occasion", () => {
    const ranked = rankThemePresets(annualReport);
    const position = (presetId: string) => ranked.findIndex((choice) => choice.presetId === presetId);
    expect(position("consulting-navy")).toBeLessThan(position("medical-teal"));
    expect(position("legal-burgundy")).toBeLessThan(position("education-green"));
    expect(position("finance-gold")).toBeLessThan(position("gov-red"));
  });

  it("reads the occasion from the preset's own scenarios", () => {
    expect(themePresetGenre("finance-gold")).toBe("business");
    expect(themePresetGenre("consulting-navy")).toBe("business");
    expect(themePresetGenre("legal-burgundy")).toBe("business");
    expect(themePresetGenre("medical-teal")).toBe("public");
    expect(themePresetGenre("paper-ink")).toBe("culture");
    expect(themePresetGenre("industrial-steel")).toBe("industry");
    expect(themePresetGenre("tech-blue")).toBeUndefined();
  });

  it("is deterministic", () => {
    expect(rankThemePresets(annualReport)).toEqual(rankThemePresets(annualReport));
    expect(planThemePresetVariants(annualReport, 8)).toEqual(planThemePresetVariants(annualReport, 8));
  });
});

describe("variant plan", () => {
  it("returns eight distinct templates, best first", () => {
    const plan = planThemePresetVariants(annualReport, 8);
    expect(plan).toHaveLength(8);
    expect(new Set(plan.map((choice) => choice.presetId)).size).toBe(8);
    expect(plan[0]?.presetId).toBe("finance-gold");
    for (const choice of plan) expect(findThemePreset(choice.presetId)).toBeDefined();
  });

  it("does not fill the batch with one colour family", () => {
    const plan = planThemePresetVariants(annualReport, 8);
    const hues = plan
      .map((choice) => themePresetAccentHue(choice.presetId))
      .filter((hue): hue is number => hue !== undefined);
    // At most two presets of the same accent family; a third is the same look
    // under another name.
    for (const hue of hues) {
      expect(hues.filter((other) => Math.abs(other - hue) < 18).length).toBeLessThanOrEqual(2);
    }
    expect(hues.length).toBeGreaterThanOrEqual(6);
  });

  it("clamps the requested count to the catalogue", () => {
    expect(planThemePresetVariants(annualReport, 0)).toHaveLength(1);
    expect(planThemePresetVariants(annualReport, 99)).toHaveLength(THEME_PRESETS.length);
  });
});

describe("concept fallback per theme", () => {
  it("pairs data presets with the instrument skeleton", () => {
    expect(defaultConceptIdForTheme("consulting-navy")).toBe("instrument");
    expect(defaultConceptIdForTheme("finance-gold")).toBe("instrument");
  });

  it("pairs literary presets with the paper skeleton and picture presets with documentary", () => {
    expect(defaultConceptIdForTheme("paper-ink")).toBe("paper");
    expect(defaultConceptIdForTheme("warm-paper")).toBe("documentary");
    expect(defaultConceptIdForTheme("editorial-teal")).toBe("editorial");
  });
});
