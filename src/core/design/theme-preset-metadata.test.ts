import { describe, expect, it } from "vitest";
import { THEME_PRESETS } from "./theme-presets";
import { themePresetMetadata } from "./theme-preset-metadata";

describe("theme preset metadata", () => {
  it("provides complete design-agent metadata for every preset", () => {
    for (const preset of THEME_PRESETS) {
      const metadata = themePresetMetadata(preset.id);
      expect(metadata.scenarios.length).toBeGreaterThan(0);
      expect(metadata.audiences.length).toBeGreaterThan(0);
      expect(metadata.recommendedPageTypes).toContain("cover");
      expect(metadata.fontFallbacks.eastAsian.length).toBeGreaterThan(1);
      expect(metadata.chartPalette.length).toBeGreaterThanOrEqual(4);
      expect(metadata.forbiddenCombinations.length).toBeGreaterThan(0);
    }
  });
});
