import { describe, expect, it } from "vitest";
import { hexToHsl } from "../rendering/color-analysis";
import {
  defaultConceptIdForTheme,
  planThemePresetVariants,
  rankThemePresets,
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

  it("moves each pick away from the accent hues already chosen", () => {
    const plan = planThemePresetVariants(annualReport, 8);
    const hues = plan
      .map((choice) => accentHue(choice.presetId))
      .filter((hue): hue is number => hue !== undefined);
    for (let left = 0; left < hues.length; left += 1) {
      for (let right = left + 1; right < hues.length; right += 1) {
        expect(hueDistance(hues[left]!, hues[right]!)).toBeGreaterThanOrEqual(22);
      }
    }
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

function accentHue(presetId: string): number | undefined {
  const preset = findThemePreset(presetId);
  if (!preset) return undefined;
  const byName = new Map(preset.theme.colors.map((color) => [color.name, color.value]));
  for (const slot of ["accent", "accent2", "primary"]) {
    const value = byName.get(slot);
    const hsl = value ? hexToHsl(value) : undefined;
    if (hsl && hsl.s >= 0.15) return hsl.h;
  }
  return undefined;
}

function hueDistance(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}
