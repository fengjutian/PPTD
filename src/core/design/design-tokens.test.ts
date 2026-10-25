import { describe, expect, it } from "vitest";
import { inches } from "../document-model";
import { findThemePreset } from "./theme-presets";
import { defaultEditorialConcept, resolveDeckConcept } from "./deck-concept";
import { deriveDesignTokens, deriveSemanticColors } from "./design-tokens";
import { colorLuminance, contrastRatio } from "../rendering/contrast";
import type { CompositionFacts } from "../commands/design-intent";

function concept(typeContrast: "calm" | "strong" | "dramatic") {
  const facts: CompositionFacts = {
    itemCount: 4,
    shortItems: true,
    longestItemLength: 20,
    bodyLength: 80,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "cards",
  };
  return resolveDeckConcept({
    concept: { ...defaultEditorialConcept(), typeContrast },
    pageFacts: [facts],
    pageCount: 1,
    id: "tokens",
  }).concept;
}

const page = { width: inches(13.333), height: inches(7.5) };

describe("design tokens", () => {
  it("takes the type scale from the theme", () => {
    const tokens = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("strong"));
    expect(tokens.type.titlePt).toBe(28);
    expect(tokens.type.bodyPt).toBe(16);
    expect(tokens.type.lineHeight).toBe(1.3);
    // Headlines are set tighter than body copy, inside a band that keeps two
    // lines from colliding.
    expect(tokens.type.titleLineHeight).toBeCloseTo(1.144, 3);
    expect(tokens.type.titleLineHeight).toBeLessThan(tokens.type.lineHeight);
    expect(tokens.type.titleLineHeight).toBeGreaterThanOrEqual(1.08);
    expect(tokens.fonts.heading).toBe("微软雅黑");
    expect(tokens.grid.margin).toBe(0.07);
  });

  it("defaults the display face to the heading face and follows the theme", () => {
    const theme = findThemePreset("consulting-navy")!.theme;
    const withoutDisplay = deriveDesignTokens(theme, page, concept("strong"));
    expect(withoutDisplay.fonts.display).toBe(withoutDisplay.fonts.heading);

    const withDisplay = deriveDesignTokens({ ...theme, displayFont: "思源宋体" }, page, concept("strong"));
    expect(withDisplay.fonts.display).toBe("思源宋体");
    // Only the display level changes: body copy keeps the theme's minor face.
    expect(withDisplay.fonts.body).toBe(withoutDisplay.fonts.body);
  });

  it("uses type contrast only on the display and title levels", () => {
    const strong = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("strong"));
    const dramatic = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("dramatic"));
    const calm = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("calm"));
    expect(dramatic.type.titlePt).toBeGreaterThan(strong.type.titlePt);
    expect(calm.type.titlePt).toBeLessThan(strong.type.titlePt);
    expect(dramatic.type.bodyPt).toBe(strong.type.bodyPt);
  });

  it("applies a bounded type-scale intent", () => {
    const normal = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("strong"));
    const compact = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("strong"), "compact");
    const expressive = deriveDesignTokens(
      findThemePreset("consulting-navy")!.theme,
      page,
      concept("strong"),
      "expressive",
    );
    expect(compact.type.titlePt).toBeLessThan(normal.type.titlePt);
    expect(expressive.type.titlePt).toBeGreaterThan(normal.type.titlePt);
    expect(expressive.type.bodyPt).toBeGreaterThan(normal.type.bodyPt);
  });

  it("keeps a taller page within a narrow spacing band", () => {
    const square = deriveDesignTokens(undefined, { width: inches(10), height: inches(7.5) }, concept("strong"));
    const tall = deriveDesignTokens(undefined, { width: inches(10), height: inches(10) }, concept("strong"));
    expect(tall.space.md).toBeGreaterThan(square.space.md);
    expect(tall.space.md / square.space.md).toBeLessThanOrEqual(1.25 / 0.8);
  });

  it("falls back to the renderer defaults without a theme", () => {
    const tokens = deriveDesignTokens(undefined, page, concept("strong"));
    expect(tokens.fonts.heading).toBe("Microsoft YaHei");
    expect(tokens.type.titlePt).toBe(30);
    expect(tokens.type.bodyPt).toBe(18);
    expect(tokens.type.lineHeight).toBe(1.25);
  });
});

describe("semantic color roles", () => {
  it("raises the surface away from the page on both light and dark pages", () => {
    const light = deriveSemanticColors({ surface: "#FFFFFF", ink: "#1E3550", accent: "#0F7869" });
    const dark = deriveSemanticColors({ surface: "#12233D", ink: "#E8EEF6", accent: "#2E75B6" });
    // A card has to be visible as a card: on a light page it darkens, on a dark
    // page it lightens. A single fixed mix would make one of the two vanish.
    expect(colorLuminance(light.surfaceRaised)!).toBeLessThan(colorLuminance("#FFFFFF")!);
    expect(colorLuminance(dark.surfaceRaised)!).toBeGreaterThan(colorLuminance("#12233D")!);
    // The hairline is stronger than the raised surface so a stroked card still
    // reads when it sits on the raised tone.
    expect(colorLuminance(light.border)!).toBeLessThan(colorLuminance(light.surfaceRaised)!);
    expect(colorLuminance(dark.border)!).toBeGreaterThan(colorLuminance(dark.surfaceRaised)!);
  });

  it("mutes the secondary ink without losing the page's hue and tints the accent", () => {
    const colors = deriveSemanticColors({ surface: "#FFFFFF", ink: "#1E3550", accent: "#0F7869" });
    // Secondary copy is lighter than body ink but still dark enough to read.
    expect(colorLuminance(colors.textMuted)!).toBeGreaterThan(colorLuminance("#1E3550")!);
    expect(contrastRatio(colors.textMuted, "#FFFFFF")!).toBeGreaterThan(4.5);
    // The tint stays close to the page so body ink on it stays the body ink.
    expect(contrastRatio(colors.accentSubtle, "#FFFFFF")!).toBeLessThan(1.3);
    expect(colors.accentSubtle).not.toBe("#FFFFFF");
  });
});
