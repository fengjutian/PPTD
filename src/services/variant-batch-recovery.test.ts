import { describe, expect, it } from "vitest";
import type { AiSlideDesign } from "../core/commands";
import { recoverMissingVisualAssets, variantFailureMessage } from "./variant-batch-recovery";

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
});
