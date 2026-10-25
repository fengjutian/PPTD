import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

import {
  aiDraftSchema,
  aiDeckConceptSchema,
  aiDeckDirectionsSchema,
  aiOutlineSchema,
  aiPresentationDesignSchema,
  aiSlideBatchSchema,
  briefsFromDraft,
  compositionFactsFromDraft,
  constrainDesignToTemplate,
  describeAiError,
  generateDeckDirections,
  slideBriefsSchema,
  visualAssetForBrief,
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
    for (const preset of ["documentary", "paper", "instrument"] as const) {
      expect(aiDeckConceptSchema.parse({ ...concept, preset }).preset).toBe(preset);
    }
    expect(() =>
      aiDeckConceptSchema.parse({
        ...concept,
        preset: "collage",
      }),
    ).toThrow();
  });

  it("requires four directions with different presets", () => {
    const editorial = {
      preset: "editorial",
      name: "编辑式",
      idea: "用细线和大字号组织内容。",
      typeContrast: "strong",
      imagery: "none",
      rationale: "内容以判断和要点为主。",
    };
    const documentary = { ...editorial, preset: "documentary", name: "纪实", imagery: "hero", typeContrast: "calm" };
    const paper = { ...editorial, preset: "paper", name: "纸本", imagery: "none", typeContrast: "calm" };
    const instrument = { ...editorial, preset: "instrument", name: "仪表", imagery: "band", typeContrast: "dramatic" };
    const parsed = aiDeckDirectionsSchema.parse({
      directions: [editorial, documentary, paper, instrument],
    });
    expect(parsed.directions.map((direction) => direction.preset)).toEqual([
      "editorial",
      "documentary",
      "paper",
      "instrument",
    ]);
    // The same skeleton twice is a colour swap, not a fifth choice.
    expect(() => aiDeckDirectionsSchema.parse({ directions: [editorial, editorial, paper, instrument] })).toThrow();
    // A short list would make the gate promise four options and show three.
    expect(() => aiDeckDirectionsSchema.parse({ directions: [editorial, documentary, paper] })).toThrow();
  });

  it("sorts proposed directions by catalog order, not model order", async () => {
    const draft = aiDraftSchema.parse({
      title: "方向",
      slides: [{ title: "第一页", body: "正文", speakerNotes: "" }],
    });
    vi.mocked(invoke).mockResolvedValueOnce({
      directions: [
        {
          preset: "instrument",
          name: "仪表",
          idea: "让数字先说话。",
          typeContrast: "dramatic",
          imagery: "none",
          rationale: "内容有指标和对比。",
        },
        {
          preset: "documentary",
          name: "纪实",
          idea: "让图片占住页面。",
          typeContrast: "calm",
          imagery: "hero",
          rationale: "内容有现场照片。",
        },
        {
          preset: "paper",
          name: "纸本",
          idea: "把论述收进窄栏。",
          typeContrast: "calm",
          imagery: "none",
          rationale: "内容有长段判断。",
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
    const result = await generateDeckDirections(draft, briefsFromDraft(draft), template, {
      taskId: 7,
      preferences: [{ text: "想要更像杂志", scope: "deck" }],
    });
    expect(result.map((direction) => direction.preset)).toEqual(["editorial", "documentary", "paper", "instrument"]);
    expect(invoke).toHaveBeenCalledWith(
      "generate_deck_directions",
      expect.objectContaining({
        request: expect.objectContaining({
          taskId: 7,
          preferences: [{ text: "想要更像杂志", scope: "deck" }],
        }),
      }),
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

  it("normalises a string designPlan.focal instead of failing the page", () => {
    const designPlan = {
      role: "claim" as const,
      composition: { primitive: "stack" as const },
      density: "normal" as const,
      templatePolicy: "use" as const,
    };
    const title = aiPresentationDesignSchema.parse({
      slides: [
        {
          layout: "cards",
          background: "#FFFFFF",
          accent: "#1F4E79",
          titleColor: "#12233D",
          bodyColor: "#465368",
          designPlan: { ...designPlan, focal: "title" },
        },
      ],
    });
    // The page-level focal enum is the field the model meant; the plan object
    // gets the equivalent kind instead of rejecting the whole design.
    expect(title.slides[0]?.designPlan?.focal).toEqual({ kind: "title" });

    const number = aiPresentationDesignSchema.parse({
      slides: [
        {
          layout: "cards",
          background: "#FFFFFF",
          accent: "#1F4E79",
          titleColor: "#12233D",
          bodyColor: "#465368",
          designPlan: { ...designPlan, focal: "number" },
        },
      ],
    });
    expect(number.slides[0]?.designPlan?.focal).toEqual({ kind: "number" });

    const body = aiPresentationDesignSchema.parse({
      slides: [
        {
          layout: "cards",
          background: "#FFFFFF",
          accent: "#1F4E79",
          titleColor: "#12233D",
          bodyColor: "#465368",
          designPlan: { ...designPlan, focal: "body" },
        },
      ],
    });
    // A typographic layer name is not a focal object; drop the hint, keep the page.
    expect(body.slides[0]?.designPlan?.focal).toBeUndefined();
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
