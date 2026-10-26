import { describe, expect, it } from "vitest";
import { rankStyleProfiles } from "./style-profile-ranking";

describe("style profile ranking", () => {
  it("recommends a business data style for a structured annual report", () => {
    const [choice] = rankStyleProfiles(
      { title: "年度经营报告", bodyText: "收入 利润 风险", slideCount: 6, chartCount: 3, tableCount: 2 },
      "consulting-navy",
    );
    expect(choice?.profileId).toBe("corporate");
    expect(choice?.reason).toContain("经营与数据");
  });

  it("keeps the recommendation deterministic", () => {
    const signals = { title: "AI 产品发布", slideCount: 8, imageSlotCount: 3 };
    expect(rankStyleProfiles(signals, "tech-blue")).toEqual(rankStyleProfiles(signals, "tech-blue"));
  });
});
