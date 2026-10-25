import { describe, expect, it, vi } from "vitest";
import { createDocument, createSlide, emu } from "../core/document-model";
import { defaultPresentationVisualGoal, type VisualReview } from "./visual-alignment";
import { runManualVisualReview } from "./manual-visual-review";
import type { TemplateReviewTarget } from "./template-review-target";

const review = (indexes: number[]): VisualReview => ({
  overallScore: 90,
  hierarchyScore: 91,
  alignmentScore: 92,
  readabilityScore: 93,
  consistencyScore: 80,
  issues: [],
  slideGuidance: [],
  slideScores: indexes.map((slideIndex) => ({
    slideIndex,
    overallScore: 90,
    hierarchyScore: 91,
    alignmentScore: 92,
    readabilityScore: 93,
  })),
});

describe("manual visual review", () => {
  it("reviews only the selected pages while always refreshing the deck overview", async () => {
    const document = createDocument();
    document.slides.push(createSlide(1));
    const pageCalls: number[][] = [];
    const deck = { ...review([]), consistencyScore: 95, repetitionScore: 94, themeFitScore: 93 };
    const result = await runManualVisualReview({
      document,
      indexes: [1],
      goal: defaultPresentationVisualGoal(),
      taskId: 7,
      renderReal: async () => ({ slides: ["one", "two"], contactSheet: "sheet" }),
      vision: {
        available: true,
        review: vi.fn(async (_render, _goal, indexes = []) => {
          pageCalls.push(indexes);
          return review(indexes);
        }),
        reviewDeck: vi.fn(async () => deck),
        planRepairs: vi.fn(),
      },
    });
    expect(pageCalls).toEqual([[1]]);
    expect(result.reviewedIndexes).toEqual([1]);
    expect(result.review.consistencyScore).toBe(95);
    expect(result.render.contactSheet).toBe("sheet");
  });

  it("measures the uploaded template instead of trusting a passing model review", async () => {
    const document = createDocument();
    // The default title sits away from the template's 0.05 axis.
    document.slides[0]!.elements[0]!.frame = {
      ...document.slides[0]!.elements[0]!.frame,
      x: emu(Math.round(0.2 * document.pageSize.width)),
    };
    const target: TemplateReviewTarget = {
      name: "内页模板",
      page: { widthEmu: document.pageSize.width, heightEmu: document.pageSize.height },
      grid: {
        left: 0.05,
        right: 0.95,
        top: 0.08,
        bottom: 0.92,
        titleX: 0.05,
        titleY: 0.08,
        titleWidth: 0.9,
        titleHeight: 0.12,
        bodyTop: 0.25,
        bodyBottom: 0.9,
      },
      layouts: [
        {
          name: "内页",
          grid: {
            left: 0.05,
            right: 0.95,
            top: 0.08,
            bottom: 0.92,
            titleX: 0.05,
            titleY: 0.08,
            titleWidth: 0.9,
            titleHeight: 0.12,
            bodyTop: 0.25,
            bodyBottom: 0.9,
          },
          titleSizePt: 28,
          bodySizePt: 16,
          freeComposition: false,
        },
      ],
      palette: ["#111111"],
      alignment: "left-grid",
      confidence: "high",
      minimumFit: 90,
      tolerances: { axis: 0.01, axisY: 0.005, margin: 0.01, fontSizePt: 1.5, colorChannel: 12 },
    };
    let seenTemplate: unknown;
    const result = await runManualVisualReview({
      document,
      indexes: [0],
      goal: defaultPresentationVisualGoal(),
      template: target,
      taskId: 8,
      renderReal: async () => ({ slides: ["one"], contactSheet: "sheet" }),
      vision: {
        available: true,
        review: vi.fn(async (_render, _goal, indexes = [], _taskId, options) => {
          seenTemplate = options?.template;
          return review(indexes);
        }),
        reviewDeck: vi.fn(async () => review([])),
        planRepairs: vi.fn(),
      },
    });

    expect(seenTemplate).toBeDefined();
    expect(result.templateFit?.checked).toBe(true);
    expect(result.templateFit?.passed).toBe(false);
    expect(result.templateFit?.hardFailures).toBeGreaterThan(0);
    expect(result.review.templateFitScore).toBe(result.templateFit?.score);
    expect(result.review.issues.some((issue) => issue.issue === "misalignment")).toBe(true);
  });
});
