import { describe, expect, it } from "vitest";
import { auditTypeScale, deriveDesignTokens, TYPE_SCALE_BAND } from "./design-tokens";
import { THEME_PRESETS, findThemePreset } from "./theme-presets";
import { defaultConceptForPreset, resolveDeckConcept } from "./deck-concept";

const page = { width: 12_192_000 as never, height: 6_858_000 as never };

describe("type scale band", () => {
  it("keeps every preset inside the band", () => {
    const outside: Array<{ preset: string; findings: string[] }> = [];
    for (const preset of THEME_PRESETS) {
      const theme = findThemePreset(preset.id)?.theme;
      const concept = resolveDeckConcept({
        concept: defaultConceptForPreset((preset as { concept?: string }).concept as never ?? (preset.id as never)),
        pageFacts: [],
        pageCount: 0,
        id: "band-check",
      }).concept;
      const tokens = deriveDesignTokens(theme, page, concept);
      const findings = auditTypeScale(tokens.type);
      if (findings.length > 0) outside.push({ preset: preset.id, findings });
    }
    // The presets are code-owned values: a scale outside the band is a mistake
    // to fix, not a style to accept.
    expect(outside).toEqual([]);
  });

  it("calls a headline that barely clears the body too small", () => {
    const findings = auditTypeScale({ displayPt: 34, titlePt: 20, bodyPt: 18 });
    expect(findings).toContain("TYPE_SCALE_TITLE_TO_BODY");
  });

  it("calls a body that shrank to a caption too small", () => {
    const findings = auditTypeScale({ displayPt: 48, titlePt: 36, bodyPt: 12 });
    expect(findings).toContain("TYPE_SCALE_TITLE_TO_BODY");
    expect(TYPE_SCALE_BAND.titleToBody[1]).toBe(2.2);
  });

  it("accepts the band's edges and rejects a hair outside them", () => {
    const edge = TYPE_SCALE_BAND.titleToBody[1];
    expect(auditTypeScale({ displayPt: 48, titlePt: 16 * edge, bodyPt: 16 })).toEqual([]);
    expect(auditTypeScale({ displayPt: 48, titlePt: 16 * (edge + 0.1), bodyPt: 16 })).toContain(
      "TYPE_SCALE_TITLE_TO_BODY",
    );
  });
});
