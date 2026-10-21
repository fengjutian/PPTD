import { describe, expect, it } from "vitest";
import { aiPresentationDesignSchema, describeAiError, slideBriefsSchema } from "./ai-service";

describe("MiniMax structured outputs", () => {
  it("accepts a typed slide brief without presentation content", () => {
    const result = slideBriefsSchema.parse({ briefs: [{ slideIndex: 0, purpose: "建立背景", conclusion: "理解作品背景有助于理解主题", visualIntent: "hero", density: "low" }] });
    expect(result.briefs[0]!.visualIntent).toBe("hero");
    expect(result.briefs[0]).not.toHaveProperty("body");
  });

  it("rejects arbitrary layouts from the design stage", () => {
    expect(() => aiPresentationDesignSchema.parse({ slides: [{ layout: "freeform", background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" }] })).toThrow();
  });

  it("turns provider overload errors into a retryable user message", () => {
    expect(describeAiError("AI_PROVIDER_BUSY")).toContain("服务当前繁忙");
  });
});
