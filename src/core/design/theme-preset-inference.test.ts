import { describe, expect, it } from "vitest";
import { inferThemePresetId, isKnownThemePreset } from "./theme-preset-inference";
import { DEFAULT_THEME_PRESET_ID } from "./theme-presets";

describe("theme preset inference", () => {
  it("maps a subject to the visual family it belongs to", () => {
    expect(inferThemePresetId("《岳阳楼记》教学课件")).toBe("paper-ink");
    expect(inferThemePresetId("2026 年度经营汇报")).toBe("consulting-navy");
    expect(inferThemePresetId("城市叙事摄影展陈")).toBe("warm-paper");
  });

  it("falls back to the default preset for an unknown subject", () => {
    expect(inferThemePresetId("新产品发布")).toBe(DEFAULT_THEME_PRESET_ID);
  });

  it("never returns an id that does not exist", () => {
    for (const topic of ["教学", "汇报", "展陈", "其它", ""]) {
      expect(isKnownThemePreset(inferThemePresetId(topic))).toBe(true);
    }
  });
});
