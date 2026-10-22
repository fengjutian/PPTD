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
  applyCommand(document, { type: "apply-ai-designed-draft", title: "质检", slides: [{ title: "标题", body: "正文", speakerNotes: "" }], designs });
  return document;
};

const passingReview: VisualReview = {
  overallScore: 90,
  hierarchyScore: 90,
  alignmentScore: 90,
  readabilityScore: 90,
  consistencyScore: 90,
  issues: [],
  slideGuidance: [{ slideIndex: 0, safeRegion: { x: 0.08, y: 0.18, width: 0.84, height: 0.7 }, logoRegions: [], busyRegions: [], focalPoint: { x: 0.5, y: 0.5 }, recommendedLayout: "title-body" }],
};

const visionPort = (review: () => Promise<VisualReview>): VisionReviewPort => ({
  available: true,
  review,
  planRepairs: async () => ({ repairs: [] }),
});

const renderStub = async () => ({ slides: ["data:image/jpeg;base64,AA=="], contactSheet: "data:image/jpeg;base64,AA==" });
const contrastStub = async () => ({ issues: [], unreadableSlides: [] as number[] });

describe("设计质检阶段", () => {
  it("视觉模型报错时降级，并照常产出文档", async () => {
    const result = await runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: visionPort(async () => { throw new Error("AI_VISION_REVIEW_FAILED:AI_REQUEST_TIMEOUT"); }),
      taskId: 1,
      isCancelled: () => false,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    });

    // 关键点：评审失败不能让整次生成失败，PPT 仍然产出。
    expect(result.degraded).toBe(true);
    expect(result.notes.join("；")).toContain("视觉评审降级");
    expect(result.document.slides).toHaveLength(1);
    expect(result.passed).toBe(true);
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
    await expect(runDesignQualityStage({
      initialDesigns: [design()],
      buildDocument,
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: () => "content",
      vision: visionPort(async () => passingReview),
      taskId: 1,
      isCancelled: () => true,
      renderForReview: renderStub,
      inspectContrast: contrastStub,
    })).rejects.toThrow("AI_GENERATION_CANCELLED");
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
      inspectContrast: async () => { throw new Error("VISUAL_RENDER_CONTEXT_UNAVAILABLE"); },
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
      validateQuality: () => { throw new Error("QUALITY_GATE_FAILED"); },
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
        review: async (render) => { reviewed.push(render.slides); return passingReview; },
        planRepairs: async () => ({ repairs: [] }),
      },
      taskId: 1,
      isCancelled: () => false,
      renderForReview: async () => { throw new Error("画布渲染不应被调用"); },
      renderRealPptxForReview: async () => ({ slides: ["data:image/jpeg;base64,UkVBTA=="], contactSheet: "data:image/jpeg;base64,U0hFRVQ=" }),
      inspectContrast: contrastStub,
    });

    expect(reviewed).toEqual([["data:image/jpeg;base64,UkVBTA=="]]);
    expect(result.notes.join("；")).toContain("视觉评审基于导出的 PPTX 真实渲染");
    expect(result.degraded).toBe(false);
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
      renderRealPptxForReview: async () => { throw new Error("REVIEW_RASTERER_UNAVAILABLE:program not found"); },
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
