import { describe, expect, it } from "vitest";
import {
  affectedSlideIndexes,
  defaultPresentationVisualGoal,
  normalizeVisualRepairPlan,
  normalizeVisualReview,
  runVisualAlignmentLoop,
  visualRepairPlanSchema,
  type VisualReview,
} from "./visual-alignment";

const review = (score: number, errors = 0): VisualReview => ({
  overallScore: score,
  hierarchyScore: score,
  alignmentScore: score,
  readabilityScore: score,
  consistencyScore: score,
  issues: Array.from({ length: errors }, () => ({
    slideIndex: 0,
    severity: "error",
    issue: "misalignment",
    elementIds: [],
    suggestion: "对齐到共享网格",
  })),
  slideGuidance: [],
});

describe("visual alignment loop", () => {
  it("stops when the target is reached", async () => {
    const result = await runVisualAlignmentLoop({
      initial: { content: "frozen", design: 0 },
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: (value) => value.content,
      review: async () => review(92),
      repair: async (value) => value,
    });
    expect(result).toMatchObject({ iterations: 1, stopReason: "target-reached" });
  });
  it("rejects repairs that change approved content", async () => {
    await expect(
      runVisualAlignmentLoop({
        initial: { content: "frozen", design: 0 },
        goal: defaultPresentationVisualGoal(),
        contentFingerprint: (value) => value.content,
        review: async () => review(60, 1),
        repair: async (value) => ({ ...value, content: "changed", design: 1 }),
      }),
    ).rejects.toThrow("VISUAL_ALIGNMENT_CONTENT_MUTATION");
  });
  it("stops after three improving iterations below target", async () => {
    let score = 60;
    const result = await runVisualAlignmentLoop({
      initial: { content: "frozen", design: 0 },
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: (value) => value.content,
      review: async () => review((score += 5), 1),
      repair: async (value) => ({ ...value, design: value.design + 1 }),
    });
    expect(result).toMatchObject({ iterations: 3, stopReason: "iteration-limit" });
  });
  it("rolls back a repair that lowers the score", async () => {
    let score = 60;
    const result = await runVisualAlignmentLoop({
      initial: { content: "frozen", design: 0 },
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: (value) => value.content,
      review: async () => {
        const current = score;
        score -= 10;
        return review(current, 1);
      },
      repair: async (value) => ({ ...value, design: value.design + 1 }),
    });
    // 第一轮 60，修复后第二轮 50：变差的修复不能成为最终设计。
    expect(result).toMatchObject({ value: { design: 0 }, stopReason: "regressed", reverted: true });
  });
  it("stops without another review when a repair changes nothing", async () => {
    let reviews = 0;
    const result = await runVisualAlignmentLoop({
      initial: { content: "frozen", design: 0 },
      goal: defaultPresentationVisualGoal(),
      contentFingerprint: (value) => value.content,
      stateFingerprint: (value) => JSON.stringify(value),
      review: async () => {
        reviews += 1;
        return review(60, 1);
      },
      repair: async (value) => ({ ...value }),
    });
    expect(result).toMatchObject({ stopReason: "no-change", iterations: 1 });
    expect(reviews).toBe(1);
  });
  it("limits repair work to reported low-quality slides", () => {
    const result = affectedSlideIndexes({
      ...review(70),
      issues: [
        { slideIndex: 4, severity: "warning", issue: "repetitive-layout", elementIds: [], suggestion: "更换结构" },
        { slideIndex: 2, severity: "error", issue: "misalignment", elementIds: [], suggestion: "对齐" },
        { slideIndex: 4, severity: "error", issue: "poor-contrast", elementIds: [], suggestion: "提高对比度" },
      ],
    });
    expect(result).toEqual([2, 4]);
    expect(
      visualRepairPlanSchema.parse({ repairs: [{ slideIndex: 2, layout: "quote", reason: "强化原文" }] }).repairs,
    ).toHaveLength(1);
  });

  it("keeps warnings repairable when only a non-overall score is below target", () => {
    const goal = defaultPresentationVisualGoal();
    const result = affectedSlideIndexes(
      {
        ...review(92),
        readabilityScore: 80,
        issues: [
          { slideIndex: 3, severity: "warning", issue: "poor-contrast", elementIds: [], suggestion: "提高对比度" },
        ],
      },
      goal.minimumScores,
    );
    // overall 已过 85，但 readability 仍低于 88；这个 warning 必须能修。
    expect(result).toEqual([3]);
  });
});

describe("修复计划的规范化", () => {
  it("保留模型指出的区域修复", () => {
    const plan = normalizeVisualRepairPlan(
      {
        repairs: [
          {
            slideIndex: 1,
            elementActions: [
              {
                action: "move",
                target: "region",
                frame: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
                to: { x: 0.5, y: 0.2, width: 0.4, height: 0.3 },
              },
            ],
            reason: "把左栏挪到右边",
          },
        ],
      },
      [0, 1],
    );
    expect(plan.repairs[0]!.elementActions[0]).toMatchObject({ action: "move", target: "region" });
  });

  it("丢掉页面不存在的修复", () => {
    expect(() => normalizeVisualRepairPlan({ repairs: [{ slideIndex: 9, reason: "不存在的页" }] }, [0, 1])).toThrow(
      "AI_REPAIR_RESPONSE_UNREPAIRABLE",
    );
  });

  it("丢掉没有目标位置的区域移动", () => {
    expect(() =>
      normalizeVisualRepairPlan(
        {
          repairs: [
            {
              slideIndex: 0,
              elementActions: [
                { action: "move", target: "region", frame: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 } },
              ],
              reason: "没有目的地",
            },
          ],
        },
        [0],
      ),
    ).toThrow("AI_REPAIR_RESPONSE_UNREPAIRABLE");
  });

  it("丢掉越出页面的坐标", () => {
    expect(() =>
      normalizeVisualRepairPlan(
        {
          repairs: [
            {
              slideIndex: 0,
              elementActions: [
                { action: "align", target: "region", frame: { x: 1.4, y: 0.2, width: 0.4, height: 0.3 } },
              ],
              reason: "越界",
            },
          ],
        },
        [0],
      ),
    ).toThrow("AI_REPAIR_RESPONSE_UNREPAIRABLE");
  });

  it("把不合法的动作换成保守的默认值", () => {
    const plan = normalizeVisualRepairPlan(
      {
        repairs: [
          {
            slideIndex: 0,
            layout: "not-a-layout",
            backgroundAction: "burn-it",
            hierarchyAction: "nope",
            elementActions: [{ action: "restyle", target: "title", fontScale: 9 }],
            reason: "测试",
          },
        ],
      },
      [0],
    );
    expect(plan.repairs[0]).toMatchObject({ backgroundAction: "keep", hierarchyAction: "keep" });
    expect(plan.repairs[0]!.layout).toBeUndefined();
    // 超出范围的字号比例被拉回合法区间。
    expect(plan.repairs[0]!.elementActions[0]).toMatchObject({ fontScale: 1.5 });
  });

  it("什么都不做的修复被丢掉", () => {
    expect(() => normalizeVisualRepairPlan({ repairs: [{ slideIndex: 0, reason: "没什么可改的" }] }, [0])).toThrow(
      "AI_REPAIR_RESPONSE_UNREPAIRABLE",
    );
  });
});

describe("visual review normalization", () => {
  it("keeps only the guidance the model actually produced", () => {
    const result = normalizeVisualReview(
      {
        ...review(84),
        slideGuidance: [
          {
            slideIndex: 1,
            safeRegion: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
            logoRegions: [],
            busyRegions: [],
            focalPoint: { x: 0.4, y: 0.5 },
            recommendedLayout: "magic-grid",
          },
        ],
      },
      [1, 2],
    );
    // 第 2 页模型没给指导，不能替它编一个 safeRegion 和版式。
    expect(result.slideGuidance.map((item) => item.slideIndex)).toEqual([1]);
    expect(result.slideGuidance[0]!.recommendedLayout).toBe("title-body");
  });

  it("clamps scores, points, and rectangles into the normalized page", () => {
    const result = normalizeVisualReview(
      {
        ...review(84),
        overallScore: 112,
        slideGuidance: [
          {
            slideIndex: 0,
            safeRegion: { x: -0.2, y: 0.9, width: 1.4, height: 0.8 },
            logoRegions: [{ x: 0.95, y: -1, width: 0.4, height: 2 }],
            busyRegions: [],
            focalPoint: { x: 4, y: -2 },
            recommendedLayout: "cover",
          },
        ],
      },
      [0],
    );
    expect(result.overallScore).toBe(100);
    expect(result.slideGuidance[0]!.safeRegion).toMatchObject({ x: 0, y: 0.9, width: 1 });
    expect(result.slideGuidance[0]!.safeRegion.height).toBeCloseTo(0.1);
    expect(result.slideGuidance[0]!.logoRegions[0]).toMatchObject({ x: 0.95, y: 0, height: 1 });
    expect(result.slideGuidance[0]!.logoRegions[0]!.width).toBeCloseTo(0.05);
    expect(result.slideGuidance[0]!.focalPoint).toEqual({ x: 1, y: 0 });
  });

  it("drops findings for unrequested slides and rejects missing scores", () => {
    const result = normalizeVisualReview(
      { ...review(80), issues: [{ slideIndex: 9, severity: "error", issue: "misalignment", suggestion: "move" }] },
      [0],
    );
    expect(result.issues).toEqual([]);
    expect(() => normalizeVisualReview({ overallScore: 80 }, [0])).toThrow("AI_VISION_RESPONSE_UNREPAIRABLE");
  });
});
