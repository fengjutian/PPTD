import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER_ID, findAiProvider } from "./ai-providers";
import {
  aiDraftSchema,
  aiDeckConceptSchema,
  aiDeckDirectionsSchema,
  aiOutlineSchema,
  aiPresentationDesignSchema,
  aiSlideBatchSchema,
  briefsFromDraft,
  cancelAiGeneration,
  chooseSlideLayout,
  compositionFactsFromDraft,
  constrainDesignToTemplate,
  describeAiError,
  extractSourceFacts,
  generateDeckDirections,
  generatePresentationDraft,
  generatePresentationDesign,
  mergeStreamProgress,
  polishPresentationTopic,
  reviewDeckContent,
  rewritePresentationSlide,
  slideBriefsSchema,
  splitSlideContent,
  suggestImagePrompts,
  suggestSlideTitles,
  writeSpeakerNotes,
  splitBodyItems,
  visualAssetForBrief,
  type AiGenerationProgress,
} from "./ai-service";
import { contrastRatio } from "../core/rendering/contrast";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

describe("AI structured outputs", () => {
  it("fills non-content defaults when a model returns a partial outline or batch", () => {
    const outline = aiOutlineSchema.parse({
      title: "销售分析",
      presentationBrief: { objective: "分析销售表现" },
      pages: [{ index: 0, title: "销售表现保持增长", purpose: "说明总体趋势" }],
    });
    const batch = aiSlideBatchSchema.parse({
      slides: [{ body: "核心业务保持增长，区域表现存在差异。" }],
    });

    expect(outline.presentationBrief.objective).toBe("分析销售表现");
    expect(outline.presentationBrief.narrativeStrategy).toBe("general");
    expect(batch.slides[0]).toMatchObject({
      title: "",
      speakerNotes: "",
      body: "核心业务保持增长，区域表现存在差异。",
    });
  });

  it("旧草稿没有核实标记也能解析，标记按块保存", () => {
    const legacy = aiDraftSchema.parse({ title: "标题", slides: [{ title: "页", body: "正文", speakerNotes: "" }] });
    expect(legacy.slides[0]!.checks).toBeUndefined();

    const checked = aiDraftSchema.parse({
      title: "标题",
      slides: [
        {
          title: "页",
          body: "正文",
          speakerNotes: "",
          checks: [{ blockIndex: 2, kind: "number" }],
        },
      ],
    });
    expect(checked.slides[0]!.checks).toEqual([{ blockIndex: 2, kind: "number", status: "unverified" }]);
  });

  it("accepts only the concept presets the renderer implements", () => {
    const concept = aiDeckConceptSchema.parse({
      preset: "editorial",
      name: "编辑式",
      idea: "用细线和大字号组织内容。",
      typeContrast: "strong",
      imagery: "none",
      rationale: "内容以判断和要点为主。",
    });
    expect(concept.preset).toBe("editorial");
    expect(
      aiDeckConceptSchema.parse({
        ...concept,
        preset: "documentary",
        name: "纪实全幅",
        typeContrast: "calm",
        imagery: "hero",
      }).preset,
    ).toBe("documentary");
    expect(() =>
      aiDeckConceptSchema.parse({
        ...concept,
        preset: "instrument",
      }),
    ).toThrow();
  });

  it("requires two directions with different presets", () => {
    const editorial = {
      preset: "editorial",
      name: "编辑式",
      idea: "用细线和大字号组织内容。",
      typeContrast: "strong",
      imagery: "none",
      rationale: "内容以判断和要点为主。",
    };
    const parsed = aiDeckDirectionsSchema.parse({
      directions: [
        editorial,
        { ...editorial, preset: "documentary", name: "纪实", imagery: "hero", typeContrast: "calm" },
      ],
    });
    expect(parsed.directions.map((direction) => direction.preset)).toEqual(["editorial", "documentary"]);
    // The same skeleton twice is a colour swap, not a choice.
    expect(() => aiDeckDirectionsSchema.parse({ directions: [editorial, editorial] })).toThrow();
    expect(() => aiDeckDirectionsSchema.parse({ directions: [editorial] })).toThrow();
  });

  it("sorts proposed directions by catalog order, not model order", async () => {
    const draft = aiDraftSchema.parse({
      title: "方向",
      slides: [{ title: "第一页", body: "正文", speakerNotes: "" }],
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      directions: [
        {
          preset: "documentary",
          name: "纪实",
          idea: "让图片占住页面。",
          typeContrast: "calm",
          imagery: "hero",
          rationale: "内容有现场照片。",
        },
        {
          preset: "editorial",
          name: "编辑式",
          idea: "用细线组织内容。",
          typeContrast: "strong",
          imagery: "none",
          rationale: "内容以判断为主。",
        },
      ],
    });
    const template = {
      slideWidthEmu: null,
      slideHeightEmu: null,
      themeColors: [],
      majorFont: null,
      minorFont: null,
      defaultBackgroundColor: null,
      slides: [],
      layouts: [],
    };
    const result = await generateDeckDirections(draft, briefsFromDraft(draft), template, { taskId: 7 });
    expect(result.map((direction) => direction.preset)).toEqual(["editorial", "documentary"]);
    expect(invoke).toHaveBeenCalledWith(
      "generate_deck_directions",
      expect.objectContaining({ request: expect.objectContaining({ taskId: 7 }) }),
    );
  });

  it("wraps an invalid direction payload in a stable code", async () => {
    const draft = aiDraftSchema.parse({
      title: "方向",
      slides: [{ title: "第一页", body: "正文", speakerNotes: "" }],
    });
    vi.mocked(invoke).mockResolvedValueOnce({ directions: [] });
    const template = {
      slideWidthEmu: null,
      slideHeightEmu: null,
      themeColors: [],
      majorFont: null,
      minorFont: null,
      defaultBackgroundColor: null,
      slides: [],
      layouts: [],
    };
    await expect(generateDeckDirections(draft, briefsFromDraft(draft), template)).rejects.toThrow(
      "AI_DIRECTIONS_INVALID",
    );
  });

  it("keeps the optional recipe fields on a design", () => {
    const design = aiPresentationDesignSchema.parse({
      slides: [
        {
          layout: "summary",
          background: "#FFFFFF",
          accent: "#1F4E79",
          titleColor: "#12233D",
          bodyColor: "#465368",
          recipe: "editorial-index",
          designPlan: {
            role: "claim",
            composition: { primitive: "split", ratio: 0.38 },
            density: "normal",
            templatePolicy: "takeover",
            recipe: "asymmetric-split",
          },
          variant: "left",
          focal: "title",
        },
      ],
    });
    expect(design.slides[0]).toMatchObject({
      recipe: "editorial-index",
      designPlan: {
        role: "claim",
        composition: { primitive: "split", ratio: 0.38 },
        density: "normal",
        templatePolicy: "takeover",
      },
      variant: "left",
      focal: "title",
    });
  });

  it("accepts the process and comparison recipes", () => {
    for (const recipe of ["process-rail", "comparison"] as const) {
      const design = aiPresentationDesignSchema.parse({
        slides: [
          {
            layout: "cards",
            background: "#FFFFFF",
            accent: "#1F4E79",
            titleColor: "#12233D",
            bodyColor: "#465368",
            recipe,
          },
        ],
      });
      expect(design.slides[0]?.recipe).toBe(recipe);
    }
  });

  it("derives page facts for the concept planner without changing content", () => {
    const draft = aiDraftSchema.parse({
      title: "销售分析",
      slides: [
        {
          title: "销售保持增长",
          body: "一\n二\n三",
          speakerNotes: "",
          blocks: [{ type: "bullet-list", items: ["一", "二", "三"] }],
        },
      ],
    });
    const facts = compositionFactsFromDraft(draft);
    expect(facts[0]).toMatchObject({
      itemCount: 3,
      shortItems: true,
      longestItemLength: 1,
      bodyLength: 5,
      hasQuote: false,
      hasComparison: false,
      hasRowBlock: false,
      layout: "title-body",
    });
  });

  it("accepts a chart content block with categories and values", () => {
    const draft = aiDraftSchema.parse({
      title: "收入趋势",
      slides: [
        {
          title: "收入连续三个季度回升",
          body: "",
          speakerNotes: "",
          blocks: [
            {
              type: "chart",
              kind: "line",
              categories: ["第一季度", "第二季度", "第三季度"],
              values: [38, 52, 71],
              unit: "万元",
            },
          ],
        },
      ],
    });
    expect(draft.slides[0]!.blocks[0]).toMatchObject({ type: "chart", kind: "line", values: [38, 52, 71] });
  });

  it("keeps the content-stage visual brief", () => {
    const draft = aiDraftSchema.parse({
      title: "收入趋势",
      slides: [
        {
          title: "收入连续三个季度回升",
          body: "第一季度 12 万，第二季度 18 万，第三季度 24 万",
          speakerNotes: "",
          plan: {
            purpose: "证明收入回升",
            conclusion: "连续三个季度增长",
            visualIntent: "structured-text",
            density: "medium",
            visualBrief: {
              form: "chart",
              brief: "按季度展示收入变化的柱状图，数字来自本页正文",
              aspect: "16:9",
            },
          },
        },
      ],
    });
    expect(draft.slides[0]?.plan.visualBrief).toMatchObject({ form: "chart", aspect: "16:9" });
  });

  it("uses visualBrief to turn an image page into a concrete picture prompt", () => {
    const asset = visualAssetForBrief({
      form: "image",
      brief: "一间自然光下的现代实验室，桌面有样本与仪器，构图留白",
      title: "精准医疗",
      visualIntent: "image-story",
    });
    expect(asset).toMatchObject({ enabled: true, role: "side" });
    expect(asset?.prompt).toContain("自然光下的现代实验室");
  });

  it("does not put a stock photo on a chart or no-visual page", () => {
    expect(
      visualAssetForBrief({
        form: "chart",
        title: "收入趋势",
        visualIntent: "data-chart",
      }),
    ).toEqual({ enabled: false });
    expect(
      visualAssetForBrief({
        form: "none",
        asset: { enabled: true, prompt: "旧图" },
        title: "结论",
        visualIntent: "summary",
      }),
    ).toEqual({ enabled: false });
  });

  it("accepts drafts with more than twenty pages", () => {
    const draft = aiDraftSchema.parse({
      title: "长篇演示",
      slides: Array.from({ length: 25 }, (_, index) => ({
        title: `第 ${index + 1} 页`,
        body: "正文",
        speakerNotes: "",
      })),
    });
    expect(draft.slides).toHaveLength(25);
  });
  it("reads the picture intent a slide carries", () => {
    const draft = aiDraftSchema.parse({
      title: "季度业务回顾",
      slides: [
        {
          title: "营收达成预算目标",
          body: "正文",
          speakerNotes: "",
          plan: {
            purpose: "目的",
            conclusion: "结论",
            visualIntent: "image-story",
            density: "medium",
            visualAsset: { enabled: true, prompt: "一间明亮的现代化数据中心", role: "side" },
          },
        },
      ],
    });
    expect(draft.slides[0]!.plan.visualAsset).toMatchObject({
      enabled: true,
      prompt: "一间明亮的现代化数据中心",
      role: "side",
    });
  });

  it("keeps drafts that carry no picture intent usable", () => {
    const draft = aiDraftSchema.parse({
      title: "季度业务回顾",
      slides: [{ title: "营收达成预算目标", body: "正文", speakerNotes: "" }],
    });
    expect(draft.slides[0]!.plan.visualAsset).toBeUndefined();
  });

  it("accepts a typed slide brief without presentation content", () => {
    const result = slideBriefsSchema.parse({
      briefs: [
        {
          slideIndex: 0,
          purpose: "建立背景",
          conclusion: "理解作品背景有助于理解主题",
          visualIntent: "hero",
          density: "low",
        },
      ],
    });
    expect(result.briefs[0]!.visualIntent).toBe("hero");
    expect(result.briefs[0]).not.toHaveProperty("body");
  });

  it("rejects arbitrary layouts from the design stage", () => {
    expect(() =>
      aiPresentationDesignSchema.parse({
        slides: [
          { layout: "freeform", background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" },
        ],
      }),
    ).toThrow();
  });

  it("turns provider overload errors into a retryable user message", () => {
    expect(describeAiError("AI_PROVIDER_BUSY")).toContain("服务当前繁忙");
  });

  it("maps a missing credential to the settings hint", () => {
    expect(describeAiError("AI_API_KEY_MISSING")).toContain("API Key");
    expect(describeAiError("AI_PROVIDER_HTTP_ERROR:401")).toContain("API Key");
  });

  it("explains that a failed visual quality gate still keeps the generated deck", () => {
    expect(describeAiError("AI_VISUAL_QUALITY_GATE_FAILED: 第 2 页仍有 3 个排版问题")).toContain("未通过视觉质量检查");
  });

  it("explains why the visual review was skipped instead of hiding the cause", () => {
    expect(describeAiError("AI_VISION_REVIEW_FAILED:AI_REQUEST_TIMEOUT")).toContain("视觉评审不可用");
    expect(describeAiError("AI_VISION_REVIEW_FAILED:AI_REQUEST_TIMEOUT")).toContain("AI_REQUEST_TIMEOUT");
  });

  it("maps an unusable provider payload to a regeneration hint", () => {
    expect(describeAiError("AI_EMPTY_RESPONSE")).toContain("重新生成");
    expect(describeAiError("AI_JSON_INVALID: bad token")).toContain("重新生成");
  });

  it("migrates legacy drafts to presentation and slide briefs", () => {
    const draft = aiDraftSchema.parse({
      title: "旧草稿",
      slides: [{ title: "第一页", body: "正文", speakerNotes: "" }],
    });
    expect(draft.presentationBrief.narrativeStrategy).toBe("general");
    expect(briefsFromDraft(draft)[0]).toMatchObject({
      slideIndex: 0,
      visualIntent: "structured-text",
      density: "medium",
    });
    expect(draft.slides[0]!.blocks).toEqual([]);
  });

  it("accepts structured content blocks from the content planner", () => {
    const draft = aiDraftSchema.parse({
      title: "结构化草稿",
      presentationBrief: {
        objective: "培训",
        audience: "学生",
        scenario: "课堂",
        expectedAction: "理解",
        coreConclusion: "掌握重点",
        narrativeStrategy: "training",
        assumptions: [],
      },
      slides: [
        {
          title: "重点",
          body: "第一点\n第二点",
          speakerNotes: "",
          plan: {
            purpose: "讲解重点",
            conclusion: "两点共同构成核心",
            visualIntent: "structured-text",
            density: "medium",
          },
          blocks: [{ type: "bullet-list", items: ["第一点", "第二点"] }],
        },
      ],
    });
    expect(draft.slides[0]!.blocks[0]).toMatchObject({ type: "bullet-list", items: ["第一点", "第二点"] });
  });

  it("uses template background and palette instead of AI-invented colors", () => {
    const design = aiPresentationDesignSchema.parse({
      slides: [
        { layout: "title-body", background: "#FF00FF", accent: "#00FF00", titleColor: "#123456", bodyColor: "#654321" },
      ],
    });
    const constrained = constrainDesignToTemplate(design, {
      slideWidthEmu: null,
      slideHeightEmu: null,
      majorFont: null,
      minorFont: null,
      defaultBackgroundColor: "bg1",
      themeColors: [
        { name: "bg1", value: "#F5F1E8" },
        { name: "dk1", value: "#202020" },
        { name: "accent1", value: "#C04A32" },
      ],
      slides: [],
      layouts: [],
    });
    expect(constrained.slides[0]).toMatchObject({ background: "#F5F1E8", accent: "#C04A32", titleColor: "#202020" });
    // The body stays inside the template palette but steps one level back, so a
    // page keeps a readable hierarchy instead of two identical blocks of text.
    expect(constrained.slides[0]!.bodyColor).not.toBe("#654321");
    expect(constrained.slides[0]!.bodyColor).not.toBe(constrained.slides[0]!.titleColor);
    expect(contrastRatio(constrained.slides[0]!.bodyColor, "#F5F1E8")).toBeGreaterThanOrEqual(4.5);
  });

  it("lets the model pick a slot of the template palette instead of inventing a colour", () => {
    const template = {
      slideWidthEmu: null,
      slideHeightEmu: null,
      majorFont: null,
      minorFont: null,
      defaultBackgroundColor: "bg1",
      themeColors: [
        { name: "bg1", value: "#F5F1E8" },
        { name: "dk1", value: "#202020" },
        { name: "accent1", value: "#C04A32" },
        { name: "accent2", value: "#2F6F8F" },
      ],
      slides: [],
      layouts: [],
    };
    const design = aiPresentationDesignSchema.parse({
      slides: [
        {
          layout: "title-body",
          background: "#FF00FF",
          accent: "#00FF00",
          titleColor: "#123456",
          bodyColor: "#654321",
          palette: { accent: "accent-2" },
        },
      ],
    });
    const constrained = constrainDesignToTemplate(design, template);
    // The slot the model chose decides the accent, and the slots it did not
    // choose still come from the template.
    expect(constrained.slides[0]!.accent).toBe("#2F6F8F");
    expect(constrained.slides[0]!.background).toBe("#F5F1E8");
    expect(constrained.slides[0]!.titleColor).toBe("#202020");
  });

  it("lets the model paint a page with a slot of the template palette", () => {
    const template = {
      slideWidthEmu: null,
      slideHeightEmu: null,
      majorFont: null,
      minorFont: null,
      defaultBackgroundColor: "bg1",
      themeColors: [
        { name: "bg1", value: "#F5F1E8" },
        { name: "dk1", value: "#202020" },
        { name: "lt1", value: "#FFFFFF" },
        { name: "accent1", value: "#C04A32" },
      ],
      slides: [],
      layouts: [],
    };
    const design = aiPresentationDesignSchema.parse({
      slides: [
        {
          layout: "section",
          background: "#FF00FF",
          accent: "#00FF00",
          titleColor: "#123456",
          bodyColor: "#654321",
          palette: { background: "primary", title: "inverse" },
        },
      ],
    });
    const constrained = constrainDesignToTemplate(design, template);
    expect(constrained.slides[0]!.background).toBe("#202020");
    // A dark page needs light ink, so the ink follows the background the page
    // ended up with instead of the ink of the template.
    expect(constrained.slides[0]!.titleColor).toBe("#FFFFFF");
    expect(contrastRatio(constrained.slides[0]!.titleColor, constrained.slides[0]!.background)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("refuses a palette slot that the template does not have without losing the template palette", () => {
    const template = {
      slideWidthEmu: null,
      slideHeightEmu: null,
      majorFont: null,
      minorFont: null,
      defaultBackgroundColor: "bg1",
      themeColors: [
        { name: "bg1", value: "#F5F1E8" },
        { name: "dk1", value: "#202020" },
        { name: "accent1", value: "#C04A32" },
      ],
      slides: [],
      layouts: [],
    };
    const design = aiPresentationDesignSchema.parse({
      slides: [
        {
          layout: "title-body",
          background: "#FF00FF",
          accent: "#00FF00",
          titleColor: "#123456",
          bodyColor: "#654321",
          palette: { accent: "accent-3" },
        },
      ],
    });
    const constrained = constrainDesignToTemplate(design, template);
    expect(constrained.slides[0]!.accent).toBe("#C04A32");
  });
});

describe("content-aware layout selection", () => {
  const shortList =
    "1. 作品在什么背景下创作？\n2. 作者想回应什么？\n3. 当时的社会环境如何？\n4. 作品为何采用这种形式？\n5. 它后来产生了什么影响？";

  it("splits numbered copy into the units the page carries", () => {
    expect(splitBodyItems(shortList)).toHaveLength(5);
    expect(splitBodyItems("一、背景\n二、问题\n三、影响")).toHaveLength(3);
    expect(splitBodyItems("• 背景 • 问题 • 影响")).toHaveLength(3);
    expect(splitBodyItems("一个段落")).toEqual(["一个段落"]);
  });

  it("turns a short numbered list into cards instead of a plain text page", () => {
    expect(
      chooseSlideLayout({
        index: 1,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: shortList,
      }),
    ).toBe("cards");
  });

  it("keeps a continuous paragraph on a title-body page", () => {
    expect(
      chooseSlideLayout({
        index: 1,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "这是一段需要连续阅读的论述，不能安全拆成多个独立要点，因此保留单栏正文。",
      }),
    ).toBe("title-body");
  });

  it("uses two columns for long points and for lists that would overflow the card grid", () => {
    const longPoints = Array.from(
      { length: 3 },
      (_, index) => `${index + 1}. ${"这是一个较长的要点，需要保持完整语义并占据两栏中的一栏。".repeat(2)}`,
    ).join("\n");
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "high",
        body: longPoints,
      }),
    ).toBe("split");
    const sevenPoints = Array.from({ length: 7 }, (_, index) => `${index + 1}. 第${index + 1}个短要点`).join("\n");
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "cards",
        visualIntent: "structured-text",
        density: "medium",
        body: sevenPoints,
      }),
    ).toBe("split");
  });

  it("does not force a five-point overview into a cover", () => {
    const body = "1. 北宋名篇\n2. 庆历六年作\n3. 写景抒情\n4. 散文经典\n5. 语言优美";
    expect(chooseSlideLayout({ index: 0, requested: "cover", visualIntent: "hero", density: "medium", body })).toBe(
      "cards",
    );
    expect(
      chooseSlideLayout({ index: 0, requested: "title-body", visualIntent: "hero", density: "medium", body }),
    ).toBe("cards");
    expect(
      chooseSlideLayout({ index: 0, requested: "cover", visualIntent: "hero", density: "low", body: "课程导览" }),
    ).toBe("cover");
  });

  it("uses structured blocks when the body is a single summary paragraph", () => {
    const blocks = [{ type: "bullet-list" as const, items: ["第一点", "第二点", "第三点", "第四点", "第五点"] }];
    expect(
      chooseSlideLayout({
        index: 1,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "本页有五条结论。",
        blocks,
      }),
    ).toBe("cards");
  });

  it("treats a quote attached to a real list as a pull quote", () => {
    const blocks = [
      { type: "quote" as const, text: "先天下之忧而忧" },
      { type: "bullet-list" as const, items: ["第一点", "第二点", "第三点", "第四点", "第五点"] },
    ];
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "quote",
        visualIntent: "structured-text",
        density: "medium",
        body: "本页有五个要点。",
        blocks,
      }),
    ).toBe("cards");
  });

  it("lets quote and comparison blocks choose their own page shape", () => {
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "high",
        body: "原文",
        blocks: [{ type: "quote" as const, text: "原文摘录", attribution: "作者" }],
      }),
    ).toBe("quote");
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "方案比较",
        blocks: [
          { type: "comparison" as const, leftLabel: "甲", rightLabel: "乙", leftItems: ["稳定"], rightItems: ["快速"] },
        ],
      }),
    ).toBe("split");
  });

  it("keeps card-shaped blocks on a card layout even when body copy is empty", () => {
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "",
        blocks: [{ type: "metric" as const, label: "增长率", value: "42%" }],
      }),
    ).toBe("cards");
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "",
        blocks: [
          {
            type: "process" as const,
            items: [
              { label: "分析", text: "确认目标" },
              { label: "执行", text: "完成交付" },
            ],
          },
        ],
      }),
    ).toBe("cards");
  });

  it("honors a specific intent when the model falls back to title-body", () => {
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "comparison",
        density: "medium",
        body: "方案甲\n方案乙",
      }),
    ).toBe("split");
    expect(
      chooseSlideLayout({ index: 1, requested: "title-body", visualIntent: "quote", density: "low", body: "原文摘录" }),
    ).toBe("quote");
  });

  it("never puts a cover after the first page", () => {
    expect(
      chooseSlideLayout({ index: 3, requested: "cover", visualIntent: "hero", density: "low", body: "章节标题" }),
    ).toBe("section");
    expect(
      chooseSlideLayout({ index: 3, requested: "title-body", visualIntent: "hero", density: "low", body: "章节标题" }),
    ).toBe("section");
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

describe("多页草稿的分批编排", () => {
  const outlineFor = (count: number) => ({
    title: "岳阳楼记课件",
    pages: Array.from({ length: count }, (_, index) => ({
      index,
      title: `第 ${index + 1} 页标题`,
      purpose: `承担第 ${index + 1} 个沟通任务`,
    })),
  });
  const batchFor = (startIndex: number, count: number) => ({
    slides: Array.from({ length: count }, (_, offset) => ({
      title: `模型自拟标题 ${startIndex + offset + 1}`,
      body: `第 ${startIndex + offset + 1} 页正文`,
      speakerNotes: "备注",
      plan: { purpose: "页面目的", conclusion: "单一结论", visualIntent: "structured-text", density: "medium" },
      blocks: [{ type: "bullet-list", items: [`要点 ${startIndex + offset + 1}`] }],
    })),
  });

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("先取大纲，再并行分批写正文，最后按大纲顺序合并", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "generate_presentation_outline") return outlineFor(12);
      if (command === "generate_presentation_slides_batch") {
        const request = (args as { request: { startIndex: number; count: number } }).request;
        return batchFor(request.startIndex, request.count);
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const progress: AiGenerationProgress[] = [];
    const draft = await generatePresentationDraft("岳阳楼记", 12, { onProgress: (value) => progress.push(value) });

    expect(draft.slides).toHaveLength(12);
    // 页面标题以已定稿的大纲为准，模型自拟标题不会覆盖大纲。
    expect(draft.slides[0]!.title).toBe("第 1 页标题");
    expect(draft.slides[11]!.title).toBe("第 12 页标题");
    expect(draft.slides[11]!.body).toBe("第 12 页正文");
    expect(draft.slides[3]!.blocks[0]).toMatchObject({ type: "bullet-list" });
    expect(
      vi.mocked(invoke).mock.calls.filter((call) => call[0] === "generate_presentation_slides_batch"),
    ).toHaveLength(3);
    expect(progress.some((item) => item.stage === "outline")).toBe(true);
    expect(progress[progress.length - 1]).toMatchObject({ completed: 3, total: 3 });
  });

  it("按大纲的 index 排序，正文不会配到错误的标题下", async () => {
    const shuffled = outlineFor(7);
    shuffled.pages.reverse();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "generate_presentation_outline") return shuffled;
      if (command === "generate_presentation_slides_batch") {
        const request = (args as { request: { startIndex: number; count: number } }).request;
        return batchFor(request.startIndex, request.count);
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const draft = await generatePresentationDraft("主题", 7);

    expect(draft.slides.map((slide) => slide.title)).toEqual(
      Array.from({ length: 7 }, (_, index) => `第 ${index + 1} 页标题`),
    );
    expect(draft.slides.map((slide) => slide.body)).toEqual(
      Array.from({ length: 7 }, (_, index) => `第 ${index + 1} 页正文`),
    );
  });

  it("报告生成失败的具体阶段和字段，而不是只说格式错误", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation_outline") {
        return {
          title: "销售分析",
          pages: [{ index: 0, title: "销售保持增长" }],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const error = await generatePresentationDraft("销售分析", 10).catch((reason: unknown) => reason);
    expect(describeAiError(error)).toBe("AI 返回的演示大纲未通过校验：pages.0.purpose 缺少必填字段");
  });

  it("页数不多时保持一次请求，不额外调用大纲", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation") {
        return {
          title: "短稿",
          slides: Array.from({ length: 4 }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            body: "正文",
            speakerNotes: "",
          })),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const draft = await generatePresentationDraft("主题", 4);

    expect(draft.slides).toHaveLength(4);
    expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual(["generate_presentation"]);
  });

  it("用户取消后停止后续分批", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation_outline") return outlineFor(12);
      if (command === "generate_presentation_slides_batch") return batchFor(0, 5);
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(generatePresentationDraft("主题", 12, { isCancelled: () => true })).rejects.toThrow(
      "AI_GENERATION_CANCELLED",
    );
    expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual(["generate_presentation_outline"]);
  });

  it("把任务号带给后端，取消指令也走同一条通道", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "generate_presentation_outline") return outlineFor(12);
      if (command === "generate_presentation_slides_batch") {
        const request = (args as { request: { startIndex: number; count: number } }).request;
        return batchFor(request.startIndex, request.count);
      }
      if (command === "cancel_ai_generation") return true;
      throw new Error(`unexpected command: ${command}`);
    });

    await generatePresentationDraft("主题", 12, { taskId: 42 });
    const batchCall = vi.mocked(invoke).mock.calls.find((call) => call[0] === "generate_presentation_slides_batch");
    expect(batchCall?.[1]).toMatchObject({ request: { taskId: 42 } });

    // 取消必须打到后端：只停界面等待，模型会继续生成一份没人要的草稿。
    await expect(cancelAiGeneration(42)).resolves.toBe(true);
    expect(vi.mocked(invoke).mock.calls.at(-1)).toEqual(["cancel_ai_generation", { taskId: 42 }]);
  });

  it("开启流式进度，让后端边写边汇报", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation") {
        return {
          title: "短稿",
          slides: Array.from({ length: 4 }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            body: "正文",
            speakerNotes: "",
          })),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    await generatePresentationDraft("主题", 4, { taskId: 9 });

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "generate_presentation");
    expect(call?.[1]).toMatchObject({ request: { taskId: 9, streamProgress: true } });
  });

  it("设计阶段同样走流式，界面才能显示已设计几页", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("AI_DESIGN_REQUEST_FAILED: 连接中断"));
    const draft = aiDraftSchema.parse({
      title: "短稿",
      slides: [{ title: "第一页", body: "正文", speakerNotes: "" }],
    });
    const template = {
      slideWidthEmu: null,
      slideHeightEmu: null,
      themeColors: [],
      majorFont: null,
      minorFont: null,
      defaultBackgroundColor: null,
      slides: [],
      layouts: [],
    };

    await expect(generatePresentationDesign(draft, briefsFromDraft(draft), template)).rejects.toThrow(
      "AI_DESIGN_REQUEST_FAILED",
    );

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "generate_presentation_design");
    expect(call?.[1]).toMatchObject({ request: { streamProgress: true } });
  });

  it("有素材时把事实清单带给后端，并挂到草稿上", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation") {
        return {
          title: "百度年报",
          slides: Array.from({ length: 3 }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            body: "正文",
            speakerNotes: "",
          })),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const facts = [
      { id: "F1", statement: "2024 年智能云收入 320 亿元", figure: "320 亿元" },
      { id: "F2", statement: "2024 年在线营销收入 730 亿元" },
    ];

    const draft = await generatePresentationDraft("百度年报", 3, { facts });

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "generate_presentation");
    expect(call?.[1]).toMatchObject({ request: { facts } });
    // 事实跟着草稿走：审核页据此显示每页引用了什么。
    expect(draft.sourceFacts).toEqual(facts);
  });

  it("没有素材时不带事实字段，也不改变草稿", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "generate_presentation") {
        return {
          title: "短稿",
          slides: Array.from({ length: 3 }, (_, index) => ({
            title: `第 ${index + 1} 页`,
            body: "正文",
            speakerNotes: "",
          })),
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const draft = await generatePresentationDraft("主题", 3);

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "generate_presentation");
    expect((call?.[1] as { request: Record<string, unknown> }).request.facts).toBeUndefined();
    expect(draft.sourceFacts).toBeUndefined();
  });

  it("抽取素材事实时重新编号并去掉重复条目", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "extract_source_facts") {
        return {
          facts: [
            { id: "F7", statement: "2024 年智能云收入 320 亿元", figure: "320 亿元", period: "2024 年" },
            { statement: "2024 年在线营销收入 730 亿元" },
            { statement: "2024 年在线营销收入 730 亿元" },
          ],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const facts = await extractSourceFacts("百度年报", "素材原文");

    expect(facts.map((fact) => fact.id)).toEqual(["F1", "F2"]);
    expect(facts[0]).toMatchObject({ statement: "2024 年智能云收入 320 亿元", figure: "320 亿元" });
  });

  it("润色主题时只替换输入文字，不启动草稿生成", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "polish_presentation_topic")
        return "为产品团队制作季度复盘，面向管理层说明成果、问题与下一步行动。";
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(polishPresentationTopic("做个季度复盘")).resolves.toContain("季度复盘");
    expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual(["polish_presentation_topic"]);
  });

  it("单页重写只带这一页的事实，候选版本不写回草稿", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") {
        return {
          slide: {
            body: "模型写的正文",
            speakerNotes: " 先讲结论 ",
            blocks: [{ type: "bullet-list", items: ["搜索广告仍是利润来源", "云业务首次全年盈利"] }],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const suggestion = await rewritePresentationSlide({
      topic: "Alphabet 2023 年报",
      deckTitle: "Alphabet 2023 年报",
      outline: ["封面", "广告基本盘稳固，云与 AI 重塑增长路径", "反垄断裁决与资本开支"],
      slideIndex: 1,
      slide: {
        title: "广告基本盘稳固，云与 AI 重塑增长路径",
        body: "旧正文",
        speakerNotes: "旧备注",
        plan: {
          purpose: "说明两条业务线",
          conclusion: "广告稳、云与 AI 增长",
          visualIntent: "structured-text",
          density: "medium",
        },
        blocks: [{ type: "paragraph", text: "旧正文" }],
      },
      instruction: "更精炼",
      taskId: 7,
    });

    // 块才是渲染器真正画的东西；正文跟着块重算，审核页的计数才不会和画面分叉。
    expect(suggestion.body).toBe("搜索广告仍是利润来源\n云业务首次全年盈利");
    expect(suggestion.speakerNotes).toBe("先讲结论");
    expect(suggestion.blocks).toHaveLength(1);
    const request = vi.mocked(invoke).mock.calls.find((call) => call[0] === "rewrite_presentation_slide")?.[1] as {
      request: Record<string, unknown>;
    };
    expect(request.request).toMatchObject({ slideIndex: 1, instruction: "更精炼", taskId: 7 });
    expect(request.request).toMatchObject({ model: expect.any(String), provider: expect.any(String) });
  });

  it("重写时带着素材事实，并把新的引用带回来", async () => {
    const facts = [{ id: "F1", statement: "2024 年智能云收入 320 亿元", figure: "320 亿元" }];
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") {
        return {
          slide: {
            body: "2024 年智能云收入 320 亿元",
            speakerNotes: "",
            blocks: [{ type: "bullet-list", items: ["2024 年智能云收入 320 亿元"] }],
            factRefs: ["F1"],
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const suggestion = await rewritePresentationSlide({
      topic: "百度年报",
      deckTitle: "百度年报",
      outline: ["封面", "智能云成为第二增长曲线"],
      slideIndex: 1,
      slide: {
        title: "智能云成为第二增长曲线",
        body: "旧正文",
        speakerNotes: "",
        plan: { purpose: "说明云业务", conclusion: "云是第二曲线", visualIntent: "structured-text", density: "medium" },
        blocks: [{ type: "paragraph", text: "旧正文" }],
      },
      facts,
    });

    const request = vi.mocked(invoke).mock.calls.find((call) => call[0] === "rewrite_presentation_slide")?.[1] as {
      request: Record<string, unknown>;
    };
    expect(request.request).toMatchObject({ facts });
    // 新版本自己给出引用，替换这一页时才会跟着更新，而不是沿用旧引用。
    expect(suggestion.factRefs).toEqual(["F1"]);
  });

  it("模型只给内容块时，正文按块重算", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") {
        return { slide: { blocks: [{ type: "paragraph", text: "只给了块，没给正文" }] } };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const suggestion = await rewritePresentationSlide({
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    });

    expect(suggestion.body).toBe("只给了块，没给正文");
    expect(suggestion.speakerNotes).toBe("");
  });

  it("模型没给内容块时，用正文还原一种块", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") return { slide: { body: "第一行\n第二行", speakerNotes: "" } };
      throw new Error(`unexpected command: ${command}`);
    });

    const suggestion = await rewritePresentationSlide({
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    });

    expect(suggestion.blocks).toEqual([{ type: "bullet-list", items: ["第一行", "第二行"] }]);
  });

  it("空结果不当作可替换的版本", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "rewrite_presentation_slide") return { slide: { body: "  ", speakerNotes: "", blocks: [] } };
      throw new Error(`unexpected command: ${command}`);
    });

    const error = await rewritePresentationSlide({
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "旧正文",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    }).catch((reason: unknown) => reason);

    expect(describeAiError(error)).toBe("AI 没有返回可用的正文，请重新生成");
  });

  it("标题候选会剔掉当前标题和重复项", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "suggest_slide_titles")
        return { titles: ["旧标题", "广告仍是利润来源", "广告仍是利润来源", "云业务首次全年盈利"] };
      throw new Error(`unexpected command: ${command}`);
    });

    const titles = await suggestSlideTitles({
      topic: "主题",
      deckTitle: "标题",
      outline: ["旧标题"],
      slideIndex: 0,
      slide: {
        title: "旧标题",
        body: "正文",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    });

    expect(titles).toEqual(["广告仍是利润来源", "云业务首次全年盈利"]);
  });

  it("备注单独生成，空备注不当作可用结果", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "write_speaker_notes") return { speakerNotes: " 先讲结论，再讲依据。 " };
      throw new Error(`unexpected command: ${command}`);
    });

    await expect(
      writeSpeakerNotes({
        topic: "主题",
        deckTitle: "标题",
        outline: ["标题"],
        slideIndex: 0,
        slide: {
          title: "标题",
          body: "正文",
          speakerNotes: "",
          plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
          blocks: [],
        },
      }),
    ).resolves.toBe("先讲结论，再讲依据。");

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "write_speaker_notes") return { speakerNotes: "   " };
      throw new Error(`unexpected command: ${command}`);
    });
    const error = await writeSpeakerNotes({
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "正文",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    }).catch((reason: unknown) => reason);

    expect(describeAiError(error)).toBe("AI 没有写出可用的演讲备注，请重试");
  });

  it("画面描述候选去重，空结果不当作可用描述", async () => {
    const input = {
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "正文",
        speakerNotes: "",
        plan: {
          purpose: "目的",
          conclusion: "结论",
          visualIntent: "structured-text" as const,
          density: "medium" as const,
        },
        blocks: [],
      },
    };

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "suggest_image_prompts")
        return { prompts: ["一间明亮的现代化数据中心", "一间明亮的现代化数据中心", "抽象几何线条构成的上升箭头"] };
      throw new Error(`unexpected command: ${command}`);
    });
    await expect(suggestImagePrompts(input)).resolves.toEqual([
      "一间明亮的现代化数据中心",
      "抽象几何线条构成的上升箭头",
    ]);

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "suggest_image_prompts") return { prompts: ["  ", "  "] };
      throw new Error(`unexpected command: ${command}`);
    });
    const error = await suggestImagePrompts(input).catch((reason: unknown) => reason);
    expect(describeAiError(error)).toBe("AI 没有给出可用的画面描述，请重试");
  });

  it("拆页返回两页，正文按各自的块重算", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "split_slide_content")
        return {
          pages: [
            {
              title: "第一页标题",
              body: "旧的投影",
              speakerNotes: "",
              plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
              blocks: [{ type: "bullet-list", items: ["要点一", "要点二"] }],
            },
            {
              title: "第二页标题",
              body: "",
              speakerNotes: "备注",
              plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
              blocks: [{ type: "paragraph", text: "第二页正文" }],
            },
          ],
        };
      throw new Error(`unexpected command: ${command}`);
    });

    const pages = await splitSlideContent({
      topic: "主题",
      deckTitle: "标题",
      outline: ["第一页标题"],
      slideIndex: 0,
      slide: {
        title: "第一页标题",
        body: "正文",
        speakerNotes: "",
        plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
        blocks: [],
      },
    });

    expect(pages.map((page) => page.title)).toEqual(["第一页标题", "第二页标题"]);
    expect(pages[0]!.body).toBe("要点一\n要点二");
    expect(pages[1]!.body).toBe("第二页正文");
  });

  it("拆出来的两页标题相同或有一页为空都算失败", async () => {
    const input = {
      topic: "主题",
      deckTitle: "标题",
      outline: ["标题"],
      slideIndex: 0,
      slide: {
        title: "标题",
        body: "正文",
        speakerNotes: "",
        plan: {
          purpose: "目的",
          conclusion: "结论",
          visualIntent: "structured-text" as const,
          density: "medium" as const,
        },
        blocks: [],
      },
    };
    const page = (title: string, blocks: unknown[]) => ({
      title,
      body: "正文",
      speakerNotes: "",
      plan: { purpose: "目的", conclusion: "结论", visualIntent: "structured-text", density: "medium" },
      blocks,
    });

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "split_slide_content")
        return {
          pages: [
            page("同一页", [{ type: "paragraph", text: "第一段" }]),
            page("同一页", [{ type: "paragraph", text: "第二段" }]),
          ],
        };
      throw new Error(`unexpected command: ${command}`);
    });
    const duplicate = await splitSlideContent(input).catch((reason: unknown) => reason);
    expect(describeAiError(duplicate)).toBe("AI 拆出的两页标题相同，请重试");

    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "split_slide_content")
        return { pages: [page("第一页", [{ type: "paragraph", text: "第一段" }]), page("第二页", [])] };
      throw new Error(`unexpected command: ${command}`);
    });
    const empty = await splitSlideContent(input).catch((reason: unknown) => reason);
    expect(describeAiError(empty)).toBe("AI 拆出的页面没有内容，请重试");
  });

  it("整册审稿剔掉越界页码和重复条目，也不改任何文字", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "review_deck_content")
        return {
          issues: [
            { slideIndex: 0, severity: "warning", kind: "duplicate", message: "与第 2 页重复" },
            { slideIndex: 0, severity: "warning", kind: "duplicate", message: "与第 2 页重复" },
            { slideIndex: 9, severity: "error", kind: "broken-flow", message: "页码越界" },
            { slideIndex: 1, severity: "error", kind: "missing-conclusion", message: "这一页没有结论" },
          ],
        };
      throw new Error(`unexpected command: ${command}`);
    });

    const issues = await reviewDeckContent({
      deckTitle: "标题",
      presentationBrief: aiDraftSchema.parse({
        title: "标题",
        slides: [{ title: "甲", body: "乙", speakerNotes: "" }],
      }).presentationBrief,
      slides: [
        { title: "甲", body: "乙", speakerNotes: "" },
        { title: "丙", body: "丁", speakerNotes: "" },
      ],
      taskId: 3,
    });

    expect(issues.map((issue) => issue.slideIndex)).toEqual([0, 1]);
  });
});

describe("流式进度汇总", () => {
  it("把并行批次的页数相加，同一批次重复上报时取最新值", () => {
    const totals = new Map<string, { received: number; pages: number }>();

    const first = mergeStreamProgress(totals, { taskId: 1, key: "batch-0", phase: "content", received: 100, pages: 1 });
    const second = mergeStreamProgress(totals, { taskId: 1, key: "batch-5", phase: "content", received: 80, pages: 1 });
    const again = mergeStreamProgress(totals, { taskId: 1, key: "batch-0", phase: "content", received: 240, pages: 3 });

    expect(first).toEqual({ pages: 1, received: 100 });
    expect(second).toEqual({ pages: 2, received: 180 });
    // 同一批次不会把页数重复累加。
    expect(again).toEqual({ pages: 4, received: 320 });
  });

  it("大纲阶段不计入已写页数", () => {
    const totals = new Map<string, { received: number; pages: number }>();

    const outline = mergeStreamProgress(totals, {
      taskId: 1,
      key: "outline",
      phase: "outline",
      received: 400,
      pages: 0,
    });

    expect(outline.pages).toBe(0);
  });
});
