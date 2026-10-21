import { describe, expect, it } from "vitest";
import { aiPresentationDesignSchema, slideBriefsSchema } from "./ai-service";

describe("MiniMax structured outputs", () => {
  it("accepts a typed slide brief without presentation content", () => {
    const result = slideBriefsSchema.parse({ briefs: [{ slideIndex: 0, purpose: "建立背景", conclusion: "理解作品背景有助于理解主题", visualIntent: "hero", density: "low" }] });
    expect(result.briefs[0]!.visualIntent).toBe("hero");
    expect(result.briefs[0]).not.toHaveProperty("body");
  });

  it("rejects arbitrary layouts from the design stage", () => {
    expect(() => aiPresentationDesignSchema.parse({ slides: [{ layout: "freeform", background: "#FFFFFF", accent: "#3366CC", titleColor: "#111111", bodyColor: "#333333" }] })).toThrow();
  });
});
