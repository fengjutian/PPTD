import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriVisionReviewPort, validateVisualRenderPayload } from "./vision-review-port";
import type { PresentationRender } from "./presentation-renderer";
import type { PresentationVisualGoal, VisualReview } from "./visual-alignment";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const JPEG = "data:image/jpeg;base64,AA==";

const render = (slideCount: number): PresentationRender => ({
  slides: Array.from({ length: slideCount }, () => JPEG),
  contactSheet: JPEG,
});

const goal = {
  minimumScores: { overall: 85, hierarchy: 80, alignment: 80, readability: 80, consistency: 80 },
} as unknown as PresentationVisualGoal;

const review = {
  overallScore: 70,
  hierarchyScore: 70,
  alignmentScore: 70,
  readabilityScore: 70,
  consistencyScore: 70,
  issues: [{ slideIndex: 0, severity: "warning", issue: "weak-hierarchy", elementIds: [], suggestion: "标题不够突出" }],
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
} as unknown as VisualReview;

describe("vision review payload", () => {
  it("accepts bounded JPEG slide renders", () => {
    expect(() =>
      validateVisualRenderPayload({
        slides: ["data:image/jpeg;base64,AA=="],
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
    ).not.toThrow();
  });
  it("accepts a deck longer than 20 pages, up to the rasterizer limit", () => {
    // 21–40 页的文稿以前会整份失去视觉评审，只留下一条语焉不详的降级说明。
    expect(() => validateVisualRenderPayload(render(21))).not.toThrow();
    expect(() => validateVisualRenderPayload(render(40))).not.toThrow();
  });
  it("rejects unsupported image payloads and empty decks", () => {
    expect(() => validateVisualRenderPayload({ slides: [], contactSheet: "data:image/jpeg;base64,AA==" })).toThrow(
      "AI_VISION_SLIDE_COUNT_INVALID",
    );
    expect(() =>
      validateVisualRenderPayload({
        slides: ["data:image/png;base64,AA=="],
        contactSheet: "data:image/jpeg;base64,AA==",
      }),
    ).toThrow("AI_VISION_IMAGE_INVALID");
  });
});

describe("视觉评审端口", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("把任务号带给后端，取消时能真正打断这次评审", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "load_app_settings") return null;
      if (command === "review_presentation_visuals") {
        return {
          overallScore: 90,
          hierarchyScore: 90,
          alignmentScore: 90,
          readabilityScore: 90,
          consistencyScore: 90,
          issues: [],
          slideGuidance: [],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const port = new TauriVisionReviewPort();
    await port.review(render(3), goal, [0, 1, 2], 77);

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "review_presentation_visuals");
    expect(call?.[1]).toMatchObject({ request: { taskId: 77, slideIndexes: [0, 1, 2] } });
  });

  it("整套缩略图只在需要的那一批发送，不随每批重复上传", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "load_app_settings") return null;
      if (command === "review_presentation_visuals") {
        return {
          overallScore: 90,
          hierarchyScore: 90,
          alignmentScore: 90,
          readabilityScore: 90,
          consistencyScore: 90,
          issues: [],
          slideGuidance: [],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const port = new TauriVisionReviewPort();
    await port.review(render(7), goal, [0], 1, { includeContactSheet: true });
    await port.review(render(7), goal, [1], 1, { includeContactSheet: false });

    const calls = vi
      .mocked(invoke)
      .mock.calls.filter((item) => item[0] === "review_presentation_visuals")
      .map((item) => (item[1] as { request: { contactSheet?: string } }).request);
    expect(calls[0]!.contactSheet).toBe(JPEG);
    // 缺省即不发送，而不是发送一个空字符串。
    expect(calls[1]!.contactSheet).toBeUndefined();
  });

  it("任务被取消时立刻放弃，不再重试一次", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "load_app_settings") return null;
      if (command === "review_presentation_visuals") throw new Error("AI_REQUEST_CANCELLED");
      throw new Error(`unexpected command: ${command}`);
    });

    const port = new TauriVisionReviewPort();
    await expect(port.review(render(2), goal, [0, 1], 3)).rejects.toThrow("AI_REQUEST_CANCELLED");
    // 一次取消不该变成两次请求。
    expect(vi.mocked(invoke).mock.calls.filter((item) => item[0] === "review_presentation_visuals")).toHaveLength(1);
  });

  it("修复计划由模型给出，模型能指着页面上的某一块说怎么改", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "load_app_settings") return null;
      if (command === "plan_presentation_repairs") {
        return {
          repairs: [
            {
              slideIndex: 1,
              elementActions: [
                { action: "align", target: "region", frame: { x: 0.3, y: 0.2, width: 0.5, height: 0.2 }, axis: "left" },
              ],
              reason: "右栏没有和标题共用左轴",
            },
          ],
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const port = new TauriVisionReviewPort();
    const plan = await port.planRepairs(review, goal, {
      deck: [
        { index: 0, title: "第一页", layout: "cards" },
        { index: 1, title: "第二页", layout: "title-body" },
      ],
      taskId: 9,
    });

    expect(plan.repairs[0]!.elementActions[0]).toMatchObject({ action: "align", target: "region", axis: "left" });
    // 修复计划把任务号带给后端，取消时能真正打断。
    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "plan_presentation_repairs");
    expect(call?.[1]).toMatchObject({ request: { taskId: 9 } });
  });

  it("模型给不出可用的修复计划时降级到规则表，评审照常继续", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "load_app_settings") return null;
      if (command === "plan_presentation_repairs") throw new Error("AI_PROVIDER_HTTP_ERROR:500");
      throw new Error(`unexpected command: ${command}`);
    });

    const port = new TauriVisionReviewPort();
    const plan = await port.planRepairs(review, goal, { deck: [{ index: 0, title: "第一页", layout: "cards" }] });

    // 降级后的计划仍然能用：规则表至少能改标题和正文。
    expect(plan.repairs.length).toBeGreaterThan(0);
  });

  it("模型不可用时，规则表只修评审提到问题的页面", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "load_app_settings") return null;
      if (command === "plan_presentation_repairs") throw new Error("AI_PROVIDER_HTTP_ERROR:500");
      throw new Error(`unexpected command: ${command}`);
    });

    const port = new TauriVisionReviewPort();
    const reviewWithGuidance = {
      ...review,
      // 第 1 页没有任何问题，但模型顺手给了 guidance。
      slideGuidance: [
        ...review.slideGuidance,
        {
          slideIndex: 1,
          safeRegion: { x: 0.08, y: 0.18, width: 0.84, height: 0.7 },
          logoRegions: [],
          busyRegions: [],
          focalPoint: { x: 0.5, y: 0.5 },
          recommendedLayout: "cards",
        },
      ],
    } as VisualReview;

    const plan = await port.planRepairs(reviewWithGuidance, goal, {
      deck: [
        { index: 0, title: "第一页", layout: "title-body" },
        { index: 1, title: "第二页", layout: "cards" },
      ],
    });

    expect(plan.repairs.map((repair) => repair.slideIndex)).toEqual([0]);
  });
});
