import { describe, expect, it } from "vitest";
import { applyCommand, type AiSlideDesign } from "../core/commands/commands";
import { createDocument, type PresentationDocument } from "../core/document-model";
import { runDesignQualityStage, summarizeQualityIssues } from "./design-quality-stage";
import type { TemplateReviewTarget } from "./template-review-target";
import { applyTemplateToGoal } from "./template-review-target";
import type { VisualReview } from "./visual-alignment";
import { defaultPresentationVisualGoal } from "./visual-alignment";
import { DisabledVisionReviewPort, type VisionReviewPort } from "./vision-review-port";

const design = (overrides: Partial<AiSlideDesign> = {}): AiSlideDesign => ({
  layout: "title-body",
  background: "#FFFFFF",
  accent: "#0EA58C",
  titleColor: "#111827",
  bodyColor: "#293241",
  safeRegion: { x: 0.08, y: 0.12, width: 0.84, height: 0.72 },
  ...overrides,
});

const buildDocument = (designs: AiSlideDesign[]): PresentationDocument => {
  const document = createDocument();
  applyCommand(document, {
    type: "apply-ai-designed-draft",
    title: "质检",
    slides: designs.map((_, index) => ({ title: `标题${index + 1}`, body: "正文", speakerNotes: "" })),
    designs,
  });
  return document;
};

const passingReview: VisualReview = {
  overallScore: 90,
  hierarchyScore: 90,
  alignmentScore: 90,
  readabilityScore: 90,
  consistencyScore: 90,
  issues: [],
  slideGuidance: [
    {
      slideIndex: 0,
      safeRegion: { x: 0.08, y: 0.18, width: 0.84, height: 0.7 },
      logoRegions: [],
      busyRegions: [],
      focalPoint: { x: 0.5, y: 0.5 },
      recommendedLayout: "title-body",
    },
  ],
};

const visionPort = (review: () => Promise<VisualReview>): VisionReviewPort => ({
  available: true,
  review,
  planRepairs: async () => ({ repairs: [] }),
});

const renderStub = async () => ({
  slides: ["data:image/jpeg;base64,AA=="],
  contactSheet: "data:image/jpeg;base64,AA==",
});
const contrastStub = async () => ({ issues: [], unreadableSlides: [] as number[] });

const templateTarget = (): TemplateReviewTarget => ({
  name: "示例模板",
  page: { widthEmu: 12_192_000, heightEmu: 6_858_000 },
  grid: {
    left: 0.5,
    right: 0.9,
    top: 0.5,
    bottom: 0.9,
    titleX: 0.5,
    titleY: 0.5,
    titleWidth: 0.4,
    titleHeight: 0.1,
    bodyTop: 0.5,
    bodyBottom: 0.9,
  },
  layouts: [
    {
      name: "内页",
      grid: {
        left: 0.5,
        right: 0.9,
        top: 0.5,
        bottom: 0.9,
        titleX: 0.5,
        titleY: 0.5,
        titleWidth: 0.4,
        titleHeight: 0.1,
        bodyTop: 0.5,
        bodyBottom: 0.9,
      },
      titleSizePt: 28,
      bodySizePt: 16,
      freeComposition: false,
    },
  ],
  palette: ["#0EA58C"],
  titleSizePt: 28,
  bodySizePt: 16,
  alignment: "left-grid",
  confidence: "high",
  minimumFit: 90,
  tolerances: { axis: 0.01, axisY: 0.005, margin: 0.01, fontSizePt: 1.5 },
});

describe("设计质检阶段", () => {
  it("视觉模型报错时降级，并照常产出文档", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: visionPort(async () => {
        throw new Error("AI_VISION_REVIEW_FAILED:AI_REQUEST_TIMEOUT");
      }),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });

    // 关键点：评审失败不能让整次生成失败，PPT 仍然产出。
    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("视觉评审降级");
    // 也必须明确说出这一次根本没有做视觉评审，避免被理解成"检查过了没问题"。
    expect(result.notes.join("；")).toContain("本次未做视觉评审");
    expect(result.document.slides).toHaveLength(1);
    expect(result.passed).toBe(true);
    // 没有评审就没有结论：不能留下一个空的 VisualReview 冒充"已评审，无问题"。
    expect(result.visualReview).toBeUndefined();
    expect(result.visualReviewCoverage).toBeUndefined();
    expect(result.visualPassed).toBe(false);
  });

  it("把上传模板接入评审输入、达标判断和修复计划", async () => {
    const target = templateTarget();
    let seenTemplate: unknown;
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: applyTemplateToGoal(defaultPresentationVisualGoal(), target),
      template: target,
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, _indexes, _taskId, options) => {
          seenTemplate = options?.template;
          return passingReview;
        },
        planRepairs: async (_review, _goal, context) => {
          expect(context?.template).toEqual(target);
          return { repairs: [] };
        },
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });

    expect(seenTemplate).toEqual(target);
    expect(result.templateFit?.checked).toBe(true);
    expect(result.templateFit?.passed).toBe(false);
    // The visual model passed every dimension, but the deterministic template
    // check keeps the deck from being reported as accepted.
    expect(result.visualPassed).toBe(false);
    expect(result.notes.join("；")).toContain("模板符合度");
  });

  it("视觉评审关闭时仍然生成模板符合度报告", async () => {
    const target = templateTarget();
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: applyTemplateToGoal(defaultPresentationVisualGoal(), target),
      template: target,
      contentFingerprint: () => "content",
      vision: new DisabledVisionReviewPort(),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });

    expect(result.templateFit?.checked).toBe(true);
    expect(result.notes.join("；")).toContain("模板符合度");
    // 模板目标是确定性验收：即使视觉评审关闭，模板不符合也不能算通过。
    expect(result.visualPassed).toBe(false);
  });

  it("设置关闭视觉评审时说清楚这是主动选择，不把未评审当成通过", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: new DisabledVisionReviewPort(),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });

    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("视觉评审已在设置中关闭");
    expect(result.notes.join("；")).toContain("本次未做视觉评审");
    expect(result.visualReview).toBeUndefined();
    expect(result.visualReviewCoverage).toBeUndefined();
    // 用户主动关闭是选择，不是评审失败：界面不应因此弹报告。
    expect(result.visualPassed).toBeUndefined();
    expect(result.visualEvidence).toMatchObject({ renderer: "none", evidence: "indicator" });
  });

  it("文稿超过评审上限时说明未做视觉评审，而不是笼统降级", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: visionPort(async () => {
        throw new Error("AI_VISION_SLIDE_COUNT_INVALID");
      }),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });

    expect(result.notes.join("；")).toContain("本次未做视觉评审");
    expect(result.notes.join("；")).toContain("超过视觉评审上限");
    expect(result.visualPassed).toBe(false);
  });

  it("单批评审失败时保留其他批次的结果，并报告覆盖范围", async () => {
    const slides = Array.from({ length: 7 }, () => "data:image/jpeg;base64,AA==");
    const result = await runDesignQualityStage({
      initialDesigns: Array.from({ length: 7 }, () => design()),
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, indexes) => {
          if (indexes?.includes(6)) throw new Error("AI_REQUEST_TIMEOUT");
          return passingReview;
        },
        planRepairs: async () => ({ repairs: [] }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides,
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("视觉评审只覆盖 6/7 页");
    expect(result.document.slides).toHaveLength(7);
    // 覆盖范围要能作为结构化数据被界面读取，而不是只能从文案里猜。
    expect(result.visualReviewCoverage).toEqual({ reviewed: 6, total: 7 });
  });

  it("修复计划不能改动评审没有提到问题的页面", async () => {
    const review = {
      ...passingReview,
      overallScore: 70,
      issues: [
        {
          slideIndex: 0,
          severity: "warning" as const,
          issue: "misalignment" as const,
          elementIds: [],
          suggestion: "对齐",
        },
      ],
    };
    const result = await runDesignQualityStage({
      initialDesigns: [design(), design({ layout: "title-body" })],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async () => review,
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 1,
              layout: "cards",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "顺手改一页",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: ["data:image/jpeg;base64,AA==", "data:image/jpeg;base64,AA=="],
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    // 第 2 页没有问题，模型想改也不能改。
    expect(result.designs[1]!.layout).toBe("title-body");
  });

  it("把配方修复写回页面设计", async () => {
    const review = {
      ...passingReview,
      distinctivenessScore: 60,
      issues: [
        {
          slideIndex: 0,
          severity: "warning" as const,
          issue: "generic-layout" as const,
          elementIds: [],
          suggestion: "换成编号栏",
        },
      ],
    };
    let calls = 0;
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async () => {
          const next = calls === 0 ? review : { ...review, distinctivenessScore: 80 };
          calls += 1;
          return next;
        },
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 0,
              recipe: "editorial-index",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "等权卡片换成编号栏",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });
    expect(result.designs[0]!.recipe).toBe("editorial-index");
  });

  it("质量门未过时列出问题，并保留生成好的文档", async () => {
    // 像素检查认定这页文字读不清：修复会改墨色，但问题仍在时文档必须保留。
    const contrastIssue = { slideIndex: 0, elementId: "text-1", contrastRatio: 1.8, backgroundColor: "#101010" };
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: visionPort(async () => passingReview),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: async () => ({ issues: [contrastIssue], unreadableSlides: [] }),
    });

    expect(result.passed).toBe(false);
    expect(result.issues.some((issue) => issue.issue === "low-contrast")).toBe(true);
    // 未通过质量门不等于没有 PPT。
    expect(result.document.slides).toHaveLength(1);
    expect(summarizeQualityIssues(result.issues)).toContain("第 1 页");
  });

  it("用户取消时立即中止，不被降级逻辑吞掉", async () => {
    await expect(
      runDesignQualityStage({
        initialDesigns: [design()],
        buildDocument,
        goal: defaultPresentationVisualGoal(),
        contentFingerprint: () => "content",
        vision: visionPort(async () => passingReview),
        taskId: 1,
        isCancelled: () => true,
        renderForReview: renderStub,
        inspectContrast: contrastStub,
      }),
    ).rejects.toThrow("AI_GENERATION_CANCELLED");
  });

  it("像素采样不可用时降级为无对比度问题，而不是中断生成", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: visionPort(async () => passingReview),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: async () => {
        throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE");
      },
    });

    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("像素对比度检查不可用");
    expect(result.document.slides).toHaveLength(1);
  });

  it("确定性质量门自身报错时降级，不把没检查误报成通过", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: visionPort(async () => passingReview),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
      validateQuality: () => {
        throw new Error("QUALITY_GATE_FAILED");
      },
    });

    // passed 为 false 表示"没检查完"，文档仍然产出。
    expect(result.passed).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("确定性质量门不可用");
    expect(result.document.slides).toHaveLength(1);
  });

  it("评审看的是导出的真实 PPTX，而不是画布预览", async () => {
    const reviewed: string[][] = [];
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (render) => {
          reviewed.push(render.slides);
          return passingReview;
        },
        planRepairs: async () => ({ repairs: [] }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => {
        throw new Error("画布渲染不应被调用");
      },
      renderRealPptxForReview: async () => ({
        slides: ["data:image/jpeg;base64,UkVBTA=="],
        contactSheet: "data:image/jpeg;base64,U0hFRVQ=",
      }),
      inspectContrast: contrastStub,
    });

    expect(reviewed).toEqual([["data:image/jpeg;base64,UkVBTA=="]]);
    expect(result.notes.join("；")).toContain("视觉评审基于导出的 PPTX 真实渲染");
    expect(result.visualEvidence).toEqual({ renderer: "powerpoint", evidence: "final" });
    expect(result.degraded).toBe(false);
    // 评审结论与覆盖范围要原样带到结果里，供界面逐条展示模型建议。
    expect(result.visualReview).toEqual(passingReview);
    expect(result.visualReviewCoverage).toEqual({ reviewed: 1, total: 1 });
    expect(result.notes.join("；")).toContain("视觉评审最终评分 90");
  });

  it("只重画设计发生变化的页面，并复用上一轮画面", async () => {
    const calls: Array<{ slideIndexes?: number[]; previousSlides?: string[] }> = [];
    let reviewRound = 0;
    const result = await runDesignQualityStage({
      initialDesigns: [design(), design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async () => {
          reviewRound += 1;
          return reviewRound === 1
            ? {
                ...passingReview,
                overallScore: 70,
                issues: [
                  {
                    slideIndex: 0,
                    severity: "error" as const,
                    issue: "misalignment" as const,
                    elementIds: [],
                    suggestion: "换一种版式",
                  },
                ],
              }
            : passingReview;
        },
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 0,
              layout: "cards",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "第一页需要换版式",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderRealPptxForReview: async (_document, options) => {
        calls.push(options ?? {});
        if (!options?.slideIndexes) return { slides: ["page-0", "page-1"], contactSheet: "sheet" };
        const slides = [...(options.previousSlides ?? [])];
        for (const index of options.slideIndexes) slides[index] = `page-${index}-updated`;
        return { slides, contactSheet: "sheet" };
      },
      inspectContrast: contrastStub,
    });

    // 第一轮渲染整册，第二轮只请求第 1 页（索引 0），并带上上一轮画面。
    expect(calls[0]!.slideIndexes).toBeUndefined();
    expect(calls[1]!.slideIndexes).toEqual([0]);
    expect(calls[1]!.previousSlides).toEqual(["page-0", "page-1"]);
    expect(result.designs[0]!.layout).toBe("cards");
    expect(result.designs[1]!.layout).toBe("title-body");
  });

  it("整册总览单独评审，逐页批次不再重复携带缩略图", async () => {
    const pageOptions: Array<{ includeContactSheet?: boolean }> = [];
    let deckCalls = 0;
    const result = await runDesignQualityStage({
      initialDesigns: [design(), design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, _indexes, _taskId, options) => {
          pageOptions.push(options ?? {});
          // 逐页批次只看得到自己那几页，它对"跨页一致性"的判断不作数。
          return { ...passingReview, consistencyScore: 40 };
        },
        reviewDeck: async () => {
          deckCalls += 1;
          return { ...passingReview, consistencyScore: 95 };
        },
        planRepairs: async () => ({ repairs: [] }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: ["data:image/jpeg;base64,AA==", "data:image/jpeg;base64,AA=="],
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    expect(deckCalls).toBe(1);
    expect(pageOptions.every((entry) => entry.includeContactSheet === false)).toBe(true);
    // 跨页一致性只认看过整册的那一路，不被逐页批次的 40 分拉低。
    expect(result.visualReview?.consistencyScore).toBe(95);
  });

  it("总览评审失败时跨页一致性退回逐页批次，并如实报告这次降级", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async () => ({ ...passingReview, consistencyScore: 88 }),
        reviewDeck: async () => {
          throw new Error("AI_REQUEST_TIMEOUT");
        },
        planRepairs: async () => ({ repairs: [] }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });

    expect(result.visualReview?.consistencyScore).toBe(88);
    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("整册总览评审不可用");
  });

  it("未变化的页批次直接复用上一轮评审，不重复上传同一批图片", async () => {
    const pageCalls: number[][] = [];
    let deckCalls = 0;
    let reviewedFirstBatch = false;
    const result = await runDesignQualityStage({
      initialDesigns: Array.from({ length: 7 }, () => design()),
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, indexes) => {
          pageCalls.push([...(indexes ?? [])]);
          const firstFailing = indexes?.includes(0) && !reviewedFirstBatch;
          const slideScores = (indexes ?? []).map((slideIndex) => ({
            slideIndex,
            overallScore: firstFailing && slideIndex === 0 ? 70 : 90,
            hierarchyScore: 90,
            alignmentScore: 90,
            readabilityScore: 90,
          }));
          // 只有第一轮的第一批有问题；第 7 页所在批次一直是合格的。
          if (firstFailing) {
            reviewedFirstBatch = true;
            return {
              ...passingReview,
              overallScore: 70,
              slideScores,
              issues: [
                {
                  slideIndex: 0,
                  severity: "error" as const,
                  issue: "misalignment" as const,
                  elementIds: [],
                  suggestion: "换一种版式",
                },
              ],
            };
          }
          return { ...passingReview, slideScores };
        },
        reviewDeck: async () => {
          deckCalls += 1;
          return passingReview;
        },
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 0,
              layout: "cards",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "第一页需要换版式",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: Array.from({ length: 7 }, () => "data:image/jpeg;base64,AA=="),
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    // 第二轮只重新上传第 1 页；同一批其余页沿用上一轮逐页结论。
    expect(pageCalls).toEqual([[0, 1, 2, 3, 4, 5], [6], [0]]);
    // 整册总览每轮都要重看：任何一页变化都会改变总览。
    expect(deckCalls).toBe(2);
    expect(result.visualReviewCoverage).toEqual({ reviewed: 7, total: 7 });
    expect(result.designs[0]!.layout).toBe("cards");
  });

  it("页批次请求失败时保留未变化页的结论，但不把失败批算通过", async () => {
    const pageCalls: number[][] = [];
    let reviewedFirstBatch = false;
    let failedSubset = false;
    const result = await runDesignQualityStage({
      initialDesigns: Array.from({ length: 7 }, () => design()),
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, indexes) => {
          pageCalls.push([...(indexes ?? [])]);
          if (indexes?.length === 1 && indexes[0] === 0 && !failedSubset) {
            failedSubset = true;
            throw new Error("AI_VISION_REVIEW_FAILED:AI_REQUEST_TIMEOUT");
          }
          const firstFailing = indexes?.includes(0) && !reviewedFirstBatch;
          const slideScores = (indexes ?? []).map((slideIndex) => ({
            slideIndex,
            overallScore: firstFailing && slideIndex === 0 ? 70 : 90,
            hierarchyScore: 90,
            alignmentScore: 90,
            readabilityScore: 90,
          }));
          if (firstFailing) {
            reviewedFirstBatch = true;
            return {
              ...passingReview,
              overallScore: 70,
              slideScores,
              issues: [
                {
                  slideIndex: 0,
                  severity: "error" as const,
                  issue: "misalignment" as const,
                  elementIds: [],
                  suggestion: "换一种版式",
                },
              ],
            };
          }
          return { ...passingReview, slideScores };
        },
        reviewDeck: async () => passingReview,
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 0,
              layout: "cards",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "第一页需要换版式",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: Array.from({ length: 7 }, () => "data:image/jpeg;base64,AA=="),
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    // 第二轮只请求变化的第 1 页；它失败了，但第 1 批其余页仍有当前结论。
    expect(pageCalls).toEqual([[0, 1, 2, 3, 4, 5], [6], [0]]);
    expect(result.visualReviewCoverage).toEqual({ reviewed: 6, total: 7 });
    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("未评审页不能视为通过");
    expect(result.designs[0]!.layout).toBe("cards");
  });

  it("回退到更早一轮时，覆盖范围也跟着那一轮", async () => {
    let reviewedFirstBatch = false;
    let failedSubset = false;
    const result = await runDesignQualityStage({
      initialDesigns: Array.from({ length: 7 }, () => design()),
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, indexes) => {
          if (indexes?.length === 1 && indexes[0] === 0 && !failedSubset) {
            failedSubset = true;
            throw new Error("AI_VISION_REVIEW_FAILED:AI_REQUEST_TIMEOUT");
          }
          const firstFailing = indexes?.includes(0) && !reviewedFirstBatch;
          const slideScores = (indexes ?? []).map((slideIndex) => ({
            slideIndex,
            overallScore: firstFailing ? (slideIndex === 0 ? 70 : 60) : slideIndex === 6 ? 70 : 60,
            hierarchyScore: 90,
            alignmentScore: 90,
            readabilityScore: 90,
          }));
          if (firstFailing) {
            reviewedFirstBatch = true;
            return {
              ...passingReview,
              overallScore: 70,
              slideScores,
              issues: [
                {
                  slideIndex: 0,
                  severity: "error" as const,
                  issue: "misalignment" as const,
                  elementIds: [],
                  suggestion: "换一种版式",
                },
              ],
            };
          }
          return { ...passingReview, overallScore: 70, slideScores };
        },
        reviewDeck: async () => passingReview,
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 0,
              layout: "cards",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "第一页需要换版式",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: Array.from({ length: 7 }, () => "data:image/jpeg;base64,AA=="),
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    // 第二轮只覆盖了部分页且评分更低，循环回退到第一轮；覆盖范围也必须
    // 回到第一轮的 7/7，不能把第二轮的缺口算到最终结论上。
    expect(result.designs[0]!.layout).toBe("title-body");
    expect(result.visualReviewCoverage).toEqual({ reviewed: 7, total: 7 });
    expect(result.notes.join("；")).not.toContain("只覆盖");
  });

  it("模型没有逐页分数时退回整批复评，不按页猜测", async () => {
    const pageCalls: number[][] = [];
    let reviewedFirstBatch = false;
    const result = await runDesignQualityStage({
      initialDesigns: Array.from({ length: 13 }, () => design()),
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, indexes) => {
          pageCalls.push([...(indexes ?? [])]);
          if (indexes?.includes(0) && !reviewedFirstBatch) {
            reviewedFirstBatch = true;
            return {
              ...passingReview,
              overallScore: 70,
              issues: [
                {
                  slideIndex: 0,
                  severity: "error" as const,
                  issue: "misalignment" as const,
                  elementIds: [],
                  suggestion: "换一种版式",
                },
              ],
            };
          }
          return passingReview;
        },
        reviewDeck: async () => passingReview,
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 0,
              layout: "cards",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "第一页需要换版式",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: Array.from({ length: 13 }, () => "data:image/jpeg;base64,AA=="),
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    // 没有 slideScores 就无法把批次结论拆到页；第二轮只能重看整批。
    expect(pageCalls).toEqual([[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], [12], [0, 1, 2, 3, 4, 5]]);
    expect(result.visualReviewCoverage).toEqual({ reviewed: 13, total: 13 });
    expect(result.designs[0]!.layout).toBe("cards");
  });

  it("没有整册评审时仍只上传第二批次里变化的页，第一批保留缩略图", async () => {
    const pageCalls: number[][] = [];
    const contactSheets: boolean[] = [];
    let reviewedPage6 = false;
    const result = await runDesignQualityStage({
      initialDesigns: Array.from({ length: 13 }, () => design()),
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, indexes, _taskId, reviewOptions) => {
          pageCalls.push([...(indexes ?? [])]);
          contactSheets.push(reviewOptions?.includeContactSheet === true);
          const firstProblem = indexes?.includes(6) && !reviewedPage6;
          const slideScores = (indexes ?? []).map((slideIndex) => ({
            slideIndex,
            overallScore: firstProblem && slideIndex === 6 ? 70 : 90,
            hierarchyScore: 90,
            alignmentScore: 90,
            readabilityScore: 90,
          }));
          if (firstProblem) {
            reviewedPage6 = true;
            return {
              ...passingReview,
              overallScore: 70,
              slideScores,
              issues: [
                {
                  slideIndex: 6,
                  severity: "error" as const,
                  issue: "misalignment" as const,
                  elementIds: [],
                  suggestion: "换一种版式",
                },
              ],
            };
          }
          return { ...passingReview, slideScores };
        },
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 6,
              layout: "cards",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "第七页需要换版式",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: Array.from({ length: 13 }, () => "data:image/jpeg;base64,AA=="),
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    // 第一批必须整批重看以取得新的缩略图一致性；第二批次只上传第 7 页；
    // 第三批次没有变化，直接复用上一轮结论。
    expect(pageCalls).toEqual([[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], [12], [0, 1, 2, 3, 4, 5], [6]]);
    expect(contactSheets).toEqual([true, false, false, true, false]);
    expect(result.visualReviewCoverage).toEqual({ reviewed: 13, total: 13 });
    expect(result.designs[6]!.layout).toBe("cards");
  });

  it("没有整册评审时，携带缩略图的第一批不能复用旧结论", async () => {
    const pageCalls: number[][] = [];
    let reviewedSeventhPage = false;
    const result = await runDesignQualityStage({
      initialDesigns: Array.from({ length: 7 }, () => design()),
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, indexes) => {
          pageCalls.push([...(indexes ?? [])]);
          if (indexes?.includes(6) && !reviewedSeventhPage) {
            reviewedSeventhPage = true;
            return {
              ...passingReview,
              overallScore: 70,
              issues: [
                {
                  slideIndex: 6,
                  severity: "error" as const,
                  issue: "misalignment" as const,
                  elementIds: [],
                  suggestion: "换一种版式",
                },
              ],
            };
          }
          return passingReview;
        },
        planRepairs: async () => ({
          repairs: [
            {
              slideIndex: 6,
              layout: "cards",
              backgroundAction: "keep",
              hierarchyAction: "keep",
              obstacleRegions: [],
              elementActions: [],
              reason: "最后一页需要换版式",
            },
          ],
        }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: Array.from({ length: 7 }, () => "data:image/jpeg;base64,AA=="),
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    // 第 1 批的页面设计没变，但它带着缩略图；整套节奏变了，必须重新看。
    expect(pageCalls).toEqual([[0, 1, 2, 3, 4, 5], [6], [0, 1, 2, 3, 4, 5], [6]]);
    expect(result.designs[6]!.layout).toBe("cards");
  });

  it("汇总逐页评分，不把批次分数当成每页分数", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: Array.from({ length: 7 }, () => design()),
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async (_render, _goal, indexes) => ({
          ...passingReview,
          slideScores: (indexes ?? []).map((slideIndex) => ({
            slideIndex,
            overallScore: 90 + slideIndex,
            hierarchyScore: 90,
            alignmentScore: 90,
            readabilityScore: 90,
          })),
        }),
        planRepairs: async () => ({ repairs: [] }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => ({
        slides: Array.from({ length: 7 }, () => "data:image/jpeg;base64,AA=="),
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
      inspectContrast: contrastStub,
    });

    expect(result.visualReview?.slideScores?.map((item) => item.slideIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(result.visualReview?.slideScores?.[6]?.overallScore).toBe(96);
    expect(result.visualPassed).toBe(true);
  });

  it("逐页低分会拉低整册评分，但不会单独授权改版", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: {
        available: true,
        review: async () => ({
          ...passingReview,
          overallScore: 94,
          hierarchyScore: 94,
          slideScores: [
            {
              slideIndex: 0,
              overallScore: 70,
              hierarchyScore: 70,
              alignmentScore: 95,
              readabilityScore: 95,
            },
          ],
          issues: [],
        }),
        planRepairs: async () => ({ repairs: [] }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });

    // 批次的 94 分不能盖过同一批里第 1 页的 70 分。
    expect(result.visualReview?.overallScore).toBe(70);
    expect(result.visualReview?.hierarchyScore).toBe(70);
    expect(result.visualPassed).toBe(false);
    expect(result.notes.join("；")).toContain("逐页评分低于目标");
    expect(result.notes.join("；")).toContain("第 1 页（总分 70、层级 70）");
    // 没有具体问题就不改版：低分只影响结论和报告，不授权自动修复。
    expect(result.notes.join("；")).toContain("no-change");
    expect(result.designs[0]!.layout).toBe("title-body");
  });

  it("真实渲染不可用时降级到画布预览，并说清楚原因", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: visionPort(async () => passingReview),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      renderRealPptxForReview: async () => {
        throw new Error("REVIEW_RASTERER_UNAVAILABLE:program not found");
      },
      inspectContrast: contrastStub,
    });

    // 评审没看到真实产物，这是一次真实的降级，报告里必须写明。
    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("视觉评审改用画布预览渲染");
    expect(result.notes.join("；")).toContain("本机没有可用的 PowerPoint 渲染");
    expect(result.visualEvidence).toMatchObject({ renderer: "canvas", evidence: "layout" });
    // 降级不影响文稿产出。
    expect(result.document.slides).toHaveLength(1);
  });
});
