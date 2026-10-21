import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER_ID, findAiProvider } from "./ai-providers";
import { aiDraftSchema, aiPresentationDesignSchema, briefsFromDraft, constrainDesignToTemplate, describeAiError, slideBriefsSchema } from "./ai-service";

describe("AI structured outputs", () => {
  it("accepts a typed slide brief without presentation content", () => {
    const result = slideBriefsSchema.parse({ briefs: [{ slideIndex: 0, purpose: "建立背景", conclusion: "理解作品背景有助于理解主题", visualIntent: "hero", density: "low" }] });
    expect(result.briefs[0]!.visualIntent).toBe("hero");
    expect(result.briefs[0]).not.toHaveProperty("body");
  });

  it("rejects arbitrary layouts from the design stage", () => {
    expect(() => aiPresentationDesignSchema.parse({ slides: [{ layout: "freeform", background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" }] })).toThrow();
  });

  it("turns provider overload errors into a retryable user message", () => {
    expect(describeAiError("AI_PROVIDER_BUSY")).toContain("服务当前繁忙");
  });

  it("maps a missing credential to the settings hint", () => {
    expect(describeAiError("AI_API_KEY_MISSING")).toContain("API Key");
    expect(describeAiError("AI_PROVIDER_HTTP_ERROR:401")).toContain("API Key");
  });

  it("maps an unusable provider payload to a regeneration hint", () => {
    expect(describeAiError("AI_EMPTY_RESPONSE")).toContain("重新生成");
    expect(describeAiError("AI_JSON_INVALID: bad token")).toContain("重新生成");
  });

  it("migrates legacy drafts to presentation and slide briefs", () => {
    const draft = aiDraftSchema.parse({ title: "旧草稿", slides: [{ title: "第一页", body: "正文", speakerNotes: "" }] });
    expect(draft.presentationBrief.narrativeStrategy).toBe("general");
    expect(briefsFromDraft(draft)[0]).toMatchObject({ slideIndex: 0, visualIntent: "structured-text", density: "medium" });
    expect(draft.slides[0]!.blocks).toEqual([]);
  });

  it("accepts structured content blocks from the content planner", () => {
    const draft = aiDraftSchema.parse({ title: "结构化草稿", presentationBrief: { objective: "培训", audience: "学生", scenario: "课堂", expectedAction: "理解", coreConclusion: "掌握重点", narrativeStrategy: "training", assumptions: [] }, slides: [{ title: "重点", body: "第一点\n第二点", speakerNotes: "", plan: { purpose: "讲解重点", conclusion: "两点共同构成核心", visualIntent: "structured-text", density: "medium" }, blocks: [{ type: "bullet-list", items: ["第一点", "第二点"] }] }] });
    expect(draft.slides[0]!.blocks[0]).toMatchObject({ type: "bullet-list", items: ["第一点", "第二点"] });
  });

  it("uses template background and palette instead of AI-invented colors", () => {
    const design = aiPresentationDesignSchema.parse({ slides: [{ layout: "title-body", background: "#FF00FF", accent: "#00FF00", titleColor: "#123456", bodyColor: "#654321" }] });
    const constrained = constrainDesignToTemplate(design, { slideWidthEmu: null, slideHeightEmu: null, majorFont: null, minorFont: null, defaultBackgroundColor: "bg1", themeColors: [{ name: "bg1", value: "#F5F1E8" }, { name: "dk1", value: "#202020" }, { name: "accent1", value: "#C04A32" }], slides: [], layouts: [] });
    expect(constrained.slides[0]).toMatchObject({ background: "#F5F1E8", accent: "#C04A32", titleColor: "#202020", bodyColor: "#202020" });
  });
});

describe("AI provider directory", () => {
  it("falls back to the default provider for an unknown id", () => {
    expect(findAiProvider("not-a-provider").id).toBe(DEFAULT_AI_PROVIDER_ID);
    expect(findAiProvider("minimax").id).toBe("minimax");
  });

  it("always lists the default model inside the provider model list", () => {
    for (const provider of AI_PROVIDERS) {
      expect(provider.models).toContain(provider.defaultModel);
      expect(provider.baseUrl).toMatch(/^https:\/\//);
    }
  });
});
