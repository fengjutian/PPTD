import { describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER_ID, findAiProvider } from "./ai-providers";
import { chooseSlideLayout, splitBodyItems } from "./ai-service";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

describe("content-aware layout selection", () => {
  const shortList =
    "1. 作品在什么背景下创作？\n2. 作者想回应什么？\n3. 当时的社会环境如何？\n4. 作品为何采用这种形式？\n5. 它后来产生了什么影响？";

  it("splits numbered copy into the units the page carries", () => {
    expect(splitBodyItems(shortList)).toHaveLength(5);
    expect(splitBodyItems("一、背景\n二、问题\n三、影响")).toHaveLength(3);
    expect(splitBodyItems("• 背景 • 问题 • 影响")).toHaveLength(3);
    expect(splitBodyItems("一个段落")).toEqual(["一个段落"]);
  });

  it("turns a short numbered list into cards instead of a plain text page", () => {
    expect(
      chooseSlideLayout({
        index: 1,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: shortList,
      }),
    ).toBe("cards");
  });

  it("keeps a continuous paragraph on a title-body page", () => {
    expect(
      chooseSlideLayout({
        index: 1,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "这是一段需要连续阅读的论述，不能安全拆成多个独立要点，因此保留单栏正文。",
      }),
    ).toBe("title-body");
  });

  it("uses two columns for long points and for lists that would overflow the card grid", () => {
    const longPoints = Array.from(
      { length: 3 },
      (_, index) => `${index + 1}. ${"这是一个较长的要点，需要保持完整语义并占据两栏中的一栏。".repeat(2)}`,
    ).join("\n");
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "high",
        body: longPoints,
      }),
    ).toBe("split");
    const sevenPoints = Array.from({ length: 7 }, (_, index) => `${index + 1}. 第${index + 1}个短要点`).join("\n");
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "cards",
        visualIntent: "structured-text",
        density: "medium",
        body: sevenPoints,
      }),
    ).toBe("split");
  });

  it("does not force a five-point overview into a cover", () => {
    const body = "1. 北宋名篇\n2. 庆历六年作\n3. 写景抒情\n4. 散文经典\n5. 语言优美";
    expect(chooseSlideLayout({ index: 0, requested: "cover", visualIntent: "hero", density: "medium", body })).toBe(
      "cards",
    );
    expect(
      chooseSlideLayout({ index: 0, requested: "title-body", visualIntent: "hero", density: "medium", body }),
    ).toBe("cards");
    expect(
      chooseSlideLayout({ index: 0, requested: "cover", visualIntent: "hero", density: "low", body: "课程导览" }),
    ).toBe("cover");
  });

  it("uses structured blocks when the body is a single summary paragraph", () => {
    const blocks = [{ type: "bullet-list" as const, items: ["第一点", "第二点", "第三点", "第四点", "第五点"] }];
    expect(
      chooseSlideLayout({
        index: 1,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "本页有五条结论。",
        blocks,
      }),
    ).toBe("cards");
  });

  it("treats a quote attached to a real list as a pull quote", () => {
    const blocks = [
      { type: "quote" as const, text: "先天下之忧而忧" },
      { type: "bullet-list" as const, items: ["第一点", "第二点", "第三点", "第四点", "第五点"] },
    ];
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "quote",
        visualIntent: "structured-text",
        density: "medium",
        body: "本页有五个要点。",
        blocks,
      }),
    ).toBe("cards");
  });

  it("lets quote and comparison blocks choose their own page shape", () => {
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "high",
        body: "原文",
        blocks: [{ type: "quote" as const, text: "原文摘录", attribution: "作者" }],
      }),
    ).toBe("quote");
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "方案比较",
        blocks: [
          { type: "comparison" as const, leftLabel: "甲", rightLabel: "乙", leftItems: ["稳定"], rightItems: ["快速"] },
        ],
      }),
    ).toBe("split");
  });

  it("keeps card-shaped blocks on a card layout even when body copy is empty", () => {
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "",
        blocks: [{ type: "metric" as const, label: "增长率", value: "42%" }],
      }),
    ).toBe("cards");
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "structured-text",
        density: "medium",
        body: "",
        blocks: [
          {
            type: "process" as const,
            items: [
              { label: "分析", text: "确认目标" },
              { label: "执行", text: "完成交付" },
            ],
          },
        ],
      }),
    ).toBe("cards");
  });

  it("honors a specific intent when the model falls back to title-body", () => {
    expect(
      chooseSlideLayout({
        index: 2,
        requested: "title-body",
        visualIntent: "comparison",
        density: "medium",
        body: "方案甲\n方案乙",
      }),
    ).toBe("split");
    expect(
      chooseSlideLayout({ index: 1, requested: "title-body", visualIntent: "quote", density: "low", body: "原文摘录" }),
    ).toBe("quote");
  });

  it("never puts a cover after the first page", () => {
    expect(
      chooseSlideLayout({ index: 3, requested: "cover", visualIntent: "hero", density: "low", body: "章节标题" }),
    ).toBe("section");
    expect(
      chooseSlideLayout({ index: 3, requested: "title-body", visualIntent: "hero", density: "low", body: "章节标题" }),
    ).toBe("section");
  });
});

describe("AI provider directory", () => {
  it("falls back to the default provider for an unknown id", () => {
    expect(findAiProvider("not-a-provider").id).toBe(DEFAULT_AI_PROVIDER_ID);
    expect(findAiProvider("minimax").id).toBe("minimax");
  });

  it("always lists the default model inside the provider model list", () => {
    for (const provider of AI_PROVIDERS) {
      expect(provider.models).toContain(provider.defaultModel);
      expect(provider.baseUrl).toMatch(/^https:\/\//);
    }
  });
});
