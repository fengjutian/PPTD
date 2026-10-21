import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER_ID, findAiProvider } from "./ai-providers";
import { aiDraftSchema, aiPresentationDesignSchema, briefsFromDraft, chooseSlideLayout, constrainDesignToTemplate, describeAiError, slideBriefsSchema, splitBodyItems } from "./ai-service";
import { contrastRatio } from "../core/rendering/contrast";

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

  it("explains that a failed visual quality gate blocks the generated deck", () => {
    expect(describeAiError("AI_VISUAL_QUALITY_GATE_FAILED: 第 2 页仍有 3 个排版问题")).toContain("已阻止进入编辑器");
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
    expect(constrained.slides[0]).toMatchObject({ background: "#F5F1E8", accent: "#C04A32", titleColor: "#202020" });
    // The body stays inside the template palette but steps one level back, so a
    // page keeps a readable hierarchy instead of two identical blocks of text.
    expect(constrained.slides[0]!.bodyColor).not.toBe("#654321");
    expect(constrained.slides[0]!.bodyColor).not.toBe(constrained.slides[0]!.titleColor);
    expect(contrastRatio(constrained.slides[0]!.bodyColor, "#F5F1E8")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("content-aware layout selection", () => {
  const shortList = "1. 作品在什么背景下创作？\n2. 作者想回应什么？\n3. 当时的社会环境如何？\n4. 作品为何采用这种形式？\n5. 它后来产生了什么影响？";

  it("splits numbered copy into the units the page carries", () => {
    expect(splitBodyItems(shortList)).toHaveLength(5);
    expect(splitBodyItems("一、背景\n二、问题\n三、影响")).toHaveLength(3);
    expect(splitBodyItems("• 背景 • 问题 • 影响")).toHaveLength(3);
    expect(splitBodyItems("一个段落")).toEqual(["一个段落"]);
  });

  it("turns a short numbered list into cards instead of a plain text page", () => {
    expect(chooseSlideLayout({ index: 1, requested: "title-body", visualIntent: "structured-text", density: "medium", body: shortList })).toBe("cards");
  });

  it("keeps a continuous paragraph on a title-body page", () => {
    expect(chooseSlideLayout({ index: 1, requested: "title-body", visualIntent: "structured-text", density: "medium", body: "这是一段需要连续阅读的论述，不能安全拆成多个独立要点，因此保留单栏正文。" })).toBe("title-body");
  });

  it("uses two columns for long points and for lists that would overflow the card grid", () => {
    const longPoints = Array.from({ length: 3 }, (_, index) => `${index + 1}. ${"这是一个较长的要点，需要保持完整语义并占据两栏中的一栏。".repeat(2)}`).join("\n");
    expect(chooseSlideLayout({ index: 2, requested: "title-body", visualIntent: "structured-text", density: "high", body: longPoints })).toBe("split");
    const sevenPoints = Array.from({ length: 7 }, (_, index) => `${index + 1}. 第${index + 1}个短要点`).join("\n");
    expect(chooseSlideLayout({ index: 2, requested: "cards", visualIntent: "structured-text", density: "medium", body: sevenPoints })).toBe("split");
  });

  it("does not force a five-point overview into a cover", () => {
    const body = "1. 北宋名篇\n2. 庆历六年作\n3. 写景抒情\n4. 散文经典\n5. 语言优美";
    expect(chooseSlideLayout({ index: 0, requested: "cover", visualIntent: "hero", density: "medium", body })).toBe("cards");
    expect(chooseSlideLayout({ index: 0, requested: "cover", visualIntent: "hero", density: "low", body: "课程导览" })).toBe("cover");
  });

  it("uses structured blocks when the body is a single summary paragraph", () => {
    const blocks = [{ type: "bullet-list" as const, items: ["第一点", "第二点", "第三点", "第四点", "第五点"] }];
    expect(chooseSlideLayout({ index: 1, requested: "title-body", visualIntent: "structured-text", density: "medium", body: "本页有五条结论。", blocks })).toBe("cards");
  });

  it("treats a quote attached to a real list as a pull quote", () => {
    const blocks = [
      { type: "quote" as const, text: "先天下之忧而忧" },
      { type: "bullet-list" as const, items: ["第一点", "第二点", "第三点", "第四点", "第五点"] },
    ];
    expect(chooseSlideLayout({ index: 2, requested: "quote", visualIntent: "structured-text", density: "medium", body: "本页有五个要点。", blocks })).toBe("cards");
  });

  it("lets quote and comparison blocks choose their own page shape", () => {
    expect(chooseSlideLayout({
      index: 2,
      requested: "title-body",
      visualIntent: "structured-text",
      density: "high",
      body: "原文",
      blocks: [{ type: "quote" as const, text: "原文摘录", attribution: "作者" }],
    })).toBe("quote");
    expect(chooseSlideLayout({
      index: 2,
      requested: "title-body",
      visualIntent: "structured-text",
      density: "medium",
      body: "方案比较",
      blocks: [{ type: "comparison" as const, leftLabel: "甲", rightLabel: "乙", leftItems: ["稳定"], rightItems: ["快速"] }],
    })).toBe("split");
  });

  it("keeps card-shaped blocks on a card layout even when body copy is empty", () => {
    expect(chooseSlideLayout({
      index: 2,
      requested: "title-body",
      visualIntent: "structured-text",
      density: "medium",
      body: "",
      blocks: [{ type: "metric" as const, label: "增长率", value: "42%" }],
    })).toBe("cards");
    expect(chooseSlideLayout({
      index: 2,
      requested: "title-body",
      visualIntent: "structured-text",
      density: "medium",
      body: "",
      blocks: [{ type: "process" as const, items: [{ label: "分析", text: "确认目标" }, { label: "执行", text: "完成交付" }] }],
    })).toBe("cards");
  });

  it("honors a specific intent when the model falls back to title-body", () => {
    expect(chooseSlideLayout({ index: 2, requested: "title-body", visualIntent: "comparison", density: "medium", body: "方案甲\n方案乙" })).toBe("split");
    expect(chooseSlideLayout({ index: 1, requested: "title-body", visualIntent: "quote", density: "low", body: "原文摘录" })).toBe("quote");
  });

  it("never puts a cover after the first page", () => {
    expect(chooseSlideLayout({ index: 3, requested: "cover", visualIntent: "hero", density: "low", body: "章节标题" })).toBe("section");
    expect(chooseSlideLayout({ index: 3, requested: "title-body", visualIntent: "hero", density: "low", body: "章节标题" })).toBe("section");
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
