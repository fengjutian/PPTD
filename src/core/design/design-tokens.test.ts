import { describe, expect, it } from "vitest";
import { inches } from "../document-model";
import { findThemePreset } from "./theme-presets";
import { defaultEditorialConcept, resolveDeckConcept } from "./deck-concept";
import { deriveDesignTokens } from "./design-tokens";
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
    expect(tokens.fonts.heading).toBe("微软雅黑");
    expect(tokens.grid.margin).toBe(0.07);
  });

  it("uses type contrast only on the display and title levels", () => {
    const strong = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("strong"));
    const dramatic = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("dramatic"));
    const calm = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, concept("calm"));
    expect(dramatic.type.titlePt).toBeGreaterThan(strong.type.titlePt);
    expect(calm.type.titlePt).toBeLessThan(strong.type.titlePt);
    expect(dramatic.type.bodyPt).toBe(strong.type.bodyPt);
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
