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

  it("writes the four semantic roles into every preset", () => {
    // The roles are derived once and stored, so the page builder, the picker and
    // any future export read the same values instead of each mixing its own tint.
    const semantic = ["surfaceRaised", "border", "textMuted", "accentSubtle"];
    for (const preset of THEME_PRESETS) {
      const slots = new Map(preset.theme.colors.map((color) => [color.name, color.value]));
      for (const name of semantic) expect(slots.get(name)).toMatch(/^#[0-9A-F]{6}$/i);
      expect(slots.get("surfaceRaised")).not.toBe(slots.get("surface"));
      expect(new Set(preset.theme.colors.map((color) => color.name)).size).toBe(preset.theme.colors.length);
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

  it("provides the sourced blue-and-white porcelain palette", () => {
    const preset = findThemePreset("blue-white-porcelain");
    expect(preset?.name).toBe("青花瓷韵");
    expect(Object.fromEntries(preset!.theme.colors.map((item) => [item.name, item.value]))).toMatchObject({
      primary: "#2B333E",
      accent: "#1661AB",
      accent2: "#2376B7",
      accent3: "#D6A01D",
      surface: "#F7F4ED",
      surfaceAlt: "#D0DFE6",
    });
  });
});
