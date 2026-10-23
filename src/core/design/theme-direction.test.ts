import { describe, expect, it } from "vitest";
import { defaultEditorialConcept, resolveDeckConcept } from "./deck-concept";
import type { CompositionFacts } from "../commands/design-intent";
import { findThemePreset } from "./theme-presets";
import { auditThemeDirection, themeDirectionForPreset } from "./theme-direction";

const facts: CompositionFacts = {
  itemCount: 4,
  shortItems: true,
  longestItemLength: 12,
  bodyLength: 30,
  hasQuote: false,
  hasComparison: false,
  hasRowBlock: false,
  layout: "title-body",
};

function concept() {
  return resolveDeckConcept({
    concept: defaultEditorialConcept(),
    pageFacts: [facts],
    pageCount: 1,
    id: "theme-direction",
  }).concept;
}

describe("theme direction", () => {
  it("packages the structured art direction without the human-facing prose", () => {
    const preset = findThemePreset("creative-orange")!;
    const direction = themeDirectionForPreset(preset);
    expect(direction.presetId).toBe("creative-orange");
    expect(direction.imageStyle).toContain("拼贴");
    expect(direction.colors.length).toBeGreaterThan(0);
    expect(direction.fonts.major).toBe(preset.theme.majorFont);
  });

  it("marks a direction partial when its image language has no recipe", () => {
    const audit = auditThemeDirection(themeDirectionForPreset(findThemePreset("creative-orange")!), concept());
    expect(audit.status).toBe("partial");
    expect(audit.unsupported).toContain("拼贴");
    expect(audit.notes.some((note) => note.includes("不会生效"))).toBe(true);
    expect(audit.notes.some((note) => note.includes("已发送"))).toBe(true);
  });

  it("reports a supported direction as sent", () => {
    const audit = auditThemeDirection(themeDirectionForPreset(findThemePreset("finance-gold")!), concept());
    expect(audit.status).toBe("sent");
    expect(audit.unsupported).toEqual([]);
  });

  it("reports an uploaded template as unmapped", () => {
    const audit = auditThemeDirection(undefined, concept());
    expect(audit.status).toBe("unmapped");
    expect(audit.notes[0]).toContain("上传模板");
  });
});
