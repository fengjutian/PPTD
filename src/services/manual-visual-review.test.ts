import { describe, expect, it, vi } from "vitest";
import { createDocument, createSlide } from "../core/document-model";
import { defaultPresentationVisualGoal, type VisualReview } from "./visual-alignment";
import { runManualVisualReview } from "./manual-visual-review";

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
});
