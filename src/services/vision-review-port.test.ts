import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriVisionReviewPort, validateVisualRenderPayload } from "./vision-review-port";
import type { PresentationRender } from "./presentation-renderer";
import type { PresentationVisualGoal } from "./visual-alignment";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const JPEG = "data:image/jpeg;base64,AA==";

const render = (slideCount: number): PresentationRender => ({
  slides: Array.from({ length: slideCount }, () => JPEG),
  contactSheet: JPEG,
});

const goal = {
  minimumScores: { overall: 85, hierarchy: 80, alignment: 80, readability: 80, consistency: 80 },
} as unknown as PresentationVisualGoal;

describe("vision review payload", () => {
  it("accepts bounded JPEG slide renders", () => {
    expect(() => validateVisualRenderPayload({ slides: ["data:image/jpeg;base64,AA=="], contactSheet: "data:image/jpeg;base64,AA==" })).not.toThrow();
  });
  it("rejects unsupported image payloads and empty decks", () => {
    expect(() => validateVisualRenderPayload({ slides: [], contactSheet: "data:image/jpeg;base64,AA==" })).toThrow("AI_VISION_SLIDE_COUNT_INVALID");
    expect(() => validateVisualRenderPayload({ slides: ["data:image/png;base64,AA=="], contactSheet: "data:image/jpeg;base64,AA==" })).toThrow("AI_VISION_IMAGE_INVALID");
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
        return { overallScore: 90, hierarchyScore: 90, alignmentScore: 90, readabilityScore: 90, consistencyScore: 90, issues: [], slideGuidance: [] };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const port = new TauriVisionReviewPort();
    await port.review(render(3), goal, [0, 1, 2], 77);

    const call = vi.mocked(invoke).mock.calls.find((item) => item[0] === "review_presentation_visuals");
    expect(call?.[1]).toMatchObject({ request: { taskId: 77, slideIndexes: [0, 1, 2] } });
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
});
