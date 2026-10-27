import { describe, expect, it } from "vitest";

import { aiDraftSchema, aiSlideDesignSchema, isDesignEnvelope, parseAiPresentationDesign } from "./ai-contracts";

const draft = aiDraftSchema.parse({
  title: "设计修复测试",
  slides: [
    { title: "封面", body: "", speakerNotes: "" },
    {
      title: "两条要点",
      body: "第一点\n第二点",
      speakerNotes: "",
      blocks: [{ type: "bullet-list", items: ["第一点", "第二点"] }],
    },
  ],
});

const valid = {
  layout: "title-body" as const,
  background: "#FFFFFF",
  accent: "#3366CC",
  titleColor: "#172033",
  bodyColor: "#364152",
};

describe("parseAiPresentationDesign", () => {
  it("keeps a complete design untouched", () => {
    const { design, repairs } = parseAiPresentationDesign({ slides: [valid, { ...valid, layout: "summary" }] }, draft);

    expect(repairs).toEqual([]);
    expect(design.slides.map((slide) => slide.layout)).toEqual(["title-body", "summary"]);
  });

  it("replaces one invalid page and keeps its valid sibling", () => {
    const { design, repairs } = parseAiPresentationDesign(
      { slides: [valid, { ...valid, layout: "not-a-layout" }] },
      draft,
    );

    expect(design.slides[0]).toEqual(valid);
    expect(design.slides).toHaveLength(2);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({ slideIndex: 1, code: "DESIGN_SLIDE_INVALID" });
    expect(aiSlideDesignSchema.safeParse(design.slides[1]).success).toBe(true);
    expect(design.slides[1]?.layout).toBe("title-body");
  });

  it("fills a missing page instead of failing the deck", () => {
    const { design, repairs } = parseAiPresentationDesign({ slides: [valid] }, draft);

    expect(design.slides).toHaveLength(2);
    expect(repairs[0]).toMatchObject({ slideIndex: 1, code: "DESIGN_SLIDE_MISSING" });
    expect(design.slides[1]?.layout).toBe("title-body");
  });

  it("truncates extra pages and reports the first extra index", () => {
    const { design, repairs } = parseAiPresentationDesign(
      { slides: [valid, valid, { ...valid, layout: "cover" }] },
      draft,
    );

    expect(design.slides).toHaveLength(2);
    expect(repairs).toEqual([expect.objectContaining({ slideIndex: 2, code: "DESIGN_SLIDE_EXTRA" })]);
  });

  it("falls back to a cover for a short opening page", () => {
    const { design } = parseAiPresentationDesign({ slides: [{ layout: "invalid" }] }, draft);

    expect(design.slides[0]?.layout).toBe("cover");
    expect(design.slides[1]?.layout).toBe("title-body");
  });

  it("rejects a response that is not a design envelope", () => {
    expect(isDesignEnvelope({ slides: [valid] })).toBe(true);
    expect(isDesignEnvelope({ slides: "not-an-array" })).toBe(false);
    expect(() => parseAiPresentationDesign({ slides: [] }, draft)).toThrow("AI_DESIGN_INVALID");
    expect(() => parseAiPresentationDesign({ output: [valid] }, draft)).toThrow("AI_DESIGN_INVALID");
  });
});
