import { describe, expect, it } from "vitest";
import { applyCommand, type AiSlideDesign } from "../core/commands/commands";
import { createDocument, type PresentationDocument } from "../core/document-model";
import { runDesignQualityStage, summarizeQualityIssues } from "./design-quality-stage";
import type { VisualReview } from "./visual-alignment";
import { defaultPresentationVisualGoal } from "./visual-alignment";
import type { VisionReviewPort } from "./vision-review-port";

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
    // 降级不影响文稿产出。
    expect(result.document.slides).toHaveLength(1);
  });
});
