import { describe, expect, it } from "vitest";
import { THEME_PRESETS, defaultThemePreset, findThemePreset } from "./theme-presets";

describe("built-in theme presets", () => {
  it("ships a coherent palette and font pairing for each preset", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(THEME_PRESETS.map((preset) => preset.id)).size).toBe(THEME_PRESETS.length);
    for (const preset of THEME_PRESETS) {
      expect(preset.theme.majorFont.length).toBeGreaterThan(0);
      expect(preset.theme.minorFont.length).toBeGreaterThan(0);
      for (const color of preset.theme.colors) expect(color.value).toMatch(/^#[0-9A-F]{6}$/i);
      expect(preset.theme.colors.some((color) => color.name === "accent")).toBe(true);
    }
  });

  it("descends from display to caption on every preset", () => {
    for (const preset of THEME_PRESETS) {
      const styles = preset.theme.textStyles!;
      expect(styles.display!.fontSizePt).toBeGreaterThanOrEqual(styles.title!.fontSizePt);
      expect(styles.title!.fontSizePt).toBeGreaterThan(styles.body!.fontSizePt);
      expect(styles.body!.fontSizePt).toBeGreaterThan(styles.caption!.fontSizePt);
    }
  });

  it("resolves the default preset by id", () => {
    const fallback = defaultThemePreset();
    expect(findThemePreset(fallback.id)).toBe(fallback);
    expect(findThemePreset("missing")).toBeUndefined();
  });
});
