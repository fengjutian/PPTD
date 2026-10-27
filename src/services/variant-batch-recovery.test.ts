import { describe, expect, it } from "vitest";
import type { AiSlideDesign } from "../core/commands";
import { recoverMissingVisualAssets, summarizeVariantFailures, variantFailureMessage } from "./variant-batch-recovery";

const design = (overrides: Partial<AiSlideDesign> = {}): AiSlideDesign => ({
  layout: "title-body",
  background: "#FFFFFF",
  accent: "#2255AA",
  titleColor: "#111111",
  bodyColor: "#333333",
  ...overrides,
});

describe("variant batch recovery", () => {
  it("switches a missing image page to a no-image recipe", () => {
    const result = recoverMissingVisualAssets({
      designs: [design({ recipe: "image-led", visualAsset: { enabled: true, role: "side" } })],
      decisions: [{ enabled: true, role: "side" }],
      assets: [],
      itemCounts: [4],
    });
    expect(result.recoveredSlideIndexes).toEqual([0]);
    expect(result.designs[0]?.visualAsset?.enabled).toBe(false);
    expect(result.designs[0]?.recipe).toBe("cover-statement");
  });

  it("keeps an image composition when real pixels exist", () => {
    const original = design({ recipe: "image-led", visualAsset: { enabled: true, role: "side" } });
    const result = recoverMissingVisualAssets({
      designs: [original],
      decisions: [{ enabled: true, role: "side" }],
      assets: [
        {
          slideIndex: 0,
          dataUrl: "data:image/png;base64,AA==",
          mimeType: "image/png",
          naturalWidth: 10,
          naturalHeight: 10,
          altText: "图",
        },
      ],
      itemCounts: [4],
    });
    expect(result.designs[0]).toBe(original);
    expect(result.recoveredSlideIndexes).toEqual([]);
  });

  it("turns quality codes into a useful candidate failure", () => {
    expect(variantFailureMessage(new Error("VARIANT_QUALITY_GATE_FAILED:low-contrast,text-orphan"))).toEqual({
      code: "VARIANT_QUALITY_GATE_FAILED",
      message: "质量检查未通过：文字对比度不足、存在孤立文本",
    });
  });

  it("names the page for page-scoped reasons", () => {
    expect(
      variantFailureMessage(
        new Error("VARIANT_QUALITY_GATE_FAILED:SLIDE_UNDERFILLED:1,REAL_ASSET_REQUIRED:2,COVER_TEXT_OVERLAP:0"),
      ).message,
    ).toBe("质量检查未通过：第 2 页内容过空、第 3 页缺少配图、第 1 页封面文字重叠");
  });

  it("labels aesthetic dimensions instead of leaking their codes", () => {
    expect(
      variantFailureMessage(
        new Error(
          "VARIANT_QUALITY_GATE_FAILED:AESTHETIC_COVERAGE_LOW,AESTHETIC_VISUAL_ANCHOR_LOW,AESTHETIC_SCORE_BELOW_THRESHOLD",
        ),
      ).message,
    ).toBe("质量检查未通过：页面留白过多、缺少视觉锚点、综合审美评分不足");
  });

  it("keeps an unknown reason visible rather than dropping it", () => {
    expect(variantFailureMessage(new Error("VARIANT_QUALITY_GATE_FAILED:FUTURE_CHECK")).message).toBe(
      "质量检查未通过：FUTURE_CHECK",
    );
  });

  it("summarises a zero-output batch with the dominant reasons", () => {
    expect(
      summarizeVariantFailures(
        [
          { message: "质量检查未通过：文字对比度不足" },
          { message: "AI 请求超时" },
          { message: "质量检查未通过：文字对比度不足" },
        ],
        4,
      ),
    ).toBe("4 个版本都没有产出（质量检查未通过：文字对比度不足 ×2、AI 请求超时）");
  });

  it("still reports the count when no reason was recorded", () => {
    expect(summarizeVariantFailures([], 6)).toBe("6 个版本都没有产出");
  });
});
