import { describe, expect, it } from "vitest";
import { inferThemePresetId, isKnownThemePreset } from "./theme-preset-inference";
import { DEFAULT_THEME_PRESET_ID, THEME_PRESETS } from "./theme-presets";

describe("theme preset inference", () => {
  it("maps a subject to the visual family it belongs to", () => {
    expect(inferThemePresetId("《岳阳楼记》教学课件")).toBe("paper-ink");
    expect(inferThemePresetId("青花瓷纹样与器型教学课件")).toBe("blue-white-porcelain");
    expect(inferThemePresetId("2026 年度经营汇报")).toBe("consulting-navy");
    expect(inferThemePresetId("城市叙事摄影展陈")).toBe("warm-paper");
    expect(inferThemePresetId("年度财务与投资回顾")).toBe("finance-gold");
    expect(inferThemePresetId("心血管健康科普")).toBe("medical-teal");
    expect(inferThemePresetId("基层党建与公共事务")).toBe("gov-red");
    expect(inferThemePresetId("AI 产品发布会")).toBe("tech-blue");
    expect(inferThemePresetId("品牌创意提案")).toBe("creative-orange");
    expect(inferThemePresetId("新员工培训课程")).toBe("education-green");
    expect(inferThemePresetId("研究生论文答辩")).toBe("academic-indigo");
    expect(inferThemePresetId("合规与内部审计")).toBe("legal-burgundy");
    expect(inferThemePresetId("美妆品牌新品发布")).toBe("fashion-rose");
    expect(inferThemePresetId("汽车制造与供应链")).toBe("industrial-steel");
    expect(inferThemePresetId("城市更新与建筑设计")).toBe("architecture-stone");
    expect(inferThemePresetId("摄影集与画册设计")).toBe("minimal-gray");
  });

  it("falls back to the default preset for an unknown subject", () => {
    expect(inferThemePresetId("秋天的颜色")).toBe(DEFAULT_THEME_PRESET_ID);
  });

  it("never returns an id that does not exist", () => {
    for (const topic of ["教学", "汇报", "展陈", "其它", ""]) {
      expect(isKnownThemePreset(inferThemePresetId(topic))).toBe(true);
    }
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(8);
  });
});
