import { describe, expect, it } from "vitest";

import { defaultConceptForPreset, resolveDeckConcept } from "./deck-concept";
import { applyStyleProfileToThemeDirection, findStyleProfile, STYLE_PROFILES } from "./style-profiles";
import { themeDirectionForPreset } from "./theme-direction";
import { findThemePreset } from "./theme-presets";

describe("style profiles", () => {
  it("only references themes, concepts and recipes the renderer owns", () => {
    expect(STYLE_PROFILES).toHaveLength(18);
    expect(new Set(STYLE_PROFILES.map((profile) => profile.id)).size).toBe(STYLE_PROFILES.length);

    for (const profile of STYLE_PROFILES) {
      expect(findThemePreset(profile.themePresetId)).toBeDefined();
      expect(profile.allowedConcepts).toContain(profile.preferredConcept);
      const availableRecipes = new Set(
        profile.allowedConcepts.flatMap(
          (preset) =>
            resolveDeckConcept({
              concept: defaultConceptForPreset(preset),
              pageFacts: [],
              pageCount: 0,
            }).concept.recipes,
        ),
      );
      for (const recipe of profile.preferredRecipes) expect(availableRecipes).toContain(recipe);
    }
  });

  it("makes degraded capabilities explicit for glass and 3D styles", () => {
    const glass = findStyleProfile("glassmorphism")!;
    const threeDimensional = findStyleProfile("3d-visual")!;

    expect(glass.capability?.status).toBe("partial");
    expect(glass.capability?.note).toContain("背景模糊");
    expect(threeDimensional.capability?.status).toBe("partial");
    expect(threeDimensional.capability?.note).toContain("渲染图片");
  });

  it("adds style constraints without changing the selected theme identity", () => {
    const profile = findStyleProfile("futuristic")!;
    const preset = findThemePreset(profile.themePresetId)!;
    const base = themeDirectionForPreset(preset);
    const styled = applyStyleProfileToThemeDirection(base, profile)!;

    expect(styled.presetId).toBe(base.presetId);
    expect(styled.character).toContain("未来科技");
    expect(styled.imageStyle).toContain("精细 3D");
    expect(styled.forbiddenCombinations).toContain("廉价霓虹");
  });
});
