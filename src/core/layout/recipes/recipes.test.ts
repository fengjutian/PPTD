import { describe, expect, it } from "vitest";
import type { CompositionFacts } from "../../commands/design-intent";
import { inches, type ContentBlock, type SlideContent } from "../../document-model";
import { defaultEditorialConcept, resolveDeckConcept, type DeckConcept } from "../../design/deck-concept";
import { deriveDesignTokens } from "../../design/design-tokens";
import { findThemePreset } from "../../design/theme-presets";
import { asymmetricSplit } from "./asymmetric-split";
import { coverStatement } from "./cover-statement";
import { dataStory } from "./data-story";
import { editorialIndex } from "./editorial-index";
import { imageLed } from "./image-led";
import { consumptionProblem } from "./plan";
import type { RecipeContext, RecipePlan } from "./types";

const page = { width: inches(13.333), height: inches(7.5) };

function facts(overrides: Partial<CompositionFacts> = {}): CompositionFacts {
  return {
    itemCount: 4,
    shortItems: true,
    longestItemLength: 20,
    bodyLength: 100,
    hasQuote: false,
    hasComparison: false,
    hasRowBlock: false,
    layout: "cards",
    ...overrides,
  };
}

function concept(typeContrast: "calm" | "strong" | "dramatic" = "strong"): DeckConcept {
  return resolveDeckConcept({
    concept: { ...defaultEditorialConcept(), typeContrast },
    pageFacts: [facts()],
    pageCount: 1,
    id: "recipe-test",
  }).concept;
}

function content(items: string[], body = items.join("\n")): SlideContent {
  const blocks: ContentBlock[] | undefined = items.length
    ? [{ id: "bullets-1", type: "bullet-list", items }]
    : undefined;
  return {
    title: "百度销售整体保持增长并持续优化结构",
    body,
    ...(blocks ? { blocks } : {}),
    speakerNotes: "",
    status: "approved",
  };
}

function context(
  pageContent: SlideContent,
  options: {
    variant?: "left" | "right";
    focal?: "title" | "index" | "body";
    facts?: CompositionFacts;
    typeContrast?: "calm" | "strong" | "dramatic";
  } = {},
): RecipeContext {
  const deckConcept = concept(options.typeContrast);
  const bullet = pageContent.blocks?.find(
    (block): block is Extract<ContentBlock, { type: "bullet-list" }> => block.type === "bullet-list",
  );
  const pageFacts = options.facts ?? facts({ itemCount: bullet?.items.length ?? 1 });
  const tokens = deriveDesignTokens(findThemePreset("consulting-navy")!.theme, page, deckConcept);
  const title = { x: inches(0.93), y: inches(0.675), width: inches(11.47), height: inches(1.125) };
  return {
    content: pageContent,
    facts: pageFacts,
    concept: deckConcept,
    tokens,
    colors: {
      title: "#12233D",
      body: "#465368",
      accent: "#1F4E79",
      background: "#FFFFFF",
      rule: "#E2E7EC",
    },
    frame: {
      title,
      content: { x: inches(0.93), y: inches(2.55), width: inches(11.47), height: inches(4.125) },
      safe: { x: 0.07, y: 0.09, width: 0.86, height: 0.8 },
      page,
    },
    page: { index: 0, total: 10 },
    ...(options.variant ? { variant: options.variant } : {}),
    ...(options.focal ? { focal: options.focal } : {}),
  };
}

function plan(recipe: typeof editorialIndex | typeof asymmetricSplit, ctx: RecipeContext): RecipePlan {
  const result = recipe.plan(ctx);
  if (!("elements" in result)) throw new Error(`unexpected conflict: ${result.conflict.reason}`);
  return result;
}

function signature(planResult: RecipePlan): unknown {
  return planResult.elements.map((element) => ({
    type: element.type,
    frame: element.frame,
    ...(element.type === "text" ? { text: element.text, style: element.style } : {}),
    ...(element.type === "shape" ? { shape: element.shape, style: element.style } : {}),
  }));
}

function expectInsidePage(planResult: RecipePlan): void {
  for (const element of planResult.elements) {
    expect(element.frame.x).toBeGreaterThanOrEqual(0);
    expect(element.frame.y).toBeGreaterThanOrEqual(0);
    expect(element.frame.x + element.frame.width).toBeLessThanOrEqual(page.width);
    expect(element.frame.y + element.frame.height).toBeLessThanOrEqual(page.height);
  }
}

describe("editorial-index recipe", () => {
  it("draws four short points as numbered rows without white cards", () => {
    const pageContent = content([
      "销售收入保持正增长",
      "移动端成为增长引擎",
      "资源向高质量业务倾斜",
      "管理转向质量与效率",
    ]);
    const ctx = context(pageContent, { facts: facts({ itemCount: 4 }) });
    expect(editorialIndex.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(editorialIndex, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, pageContent)).toBeUndefined();
    expect(result.consumed.items).toBe(4);
    expect(
      result.elements
        .filter((element) => element.type === "text")
        .map((element) => (element.type === "text" ? element.text : "")),
    ).toEqual(expect.arrayContaining(["01", "02", "03", "04", "销售收入保持正增长"]));
    const whiteCards = result.elements.filter(
      (element) => element.type === "shape" && element.style.fill.toUpperCase() === "#FFFFFF",
    );
    expect(whiteCards).toHaveLength(0);
  });

  it("draws uncovered body copy as a lead without duplicating the points", () => {
    const pageContent = content(
      ["销售收入保持正增长", "移动端成为增长引擎", "资源向高质量业务倾斜"],
      "本页先给出结论，再展开三项证据。",
    );
    const result = plan(editorialIndex, context(pageContent, { facts: facts({ itemCount: 3 }) }));
    expect(consumptionProblem(result, pageContent)).toBeUndefined();
    const texts = result.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    expect(texts).toContain("本页先给出结论，再展开三项证据。");
    expect(texts.filter((text) => text === "本页先给出结论，再展开三项证据。")).toHaveLength(1);
  });

  it("refuses seven points instead of dropping one", () => {
    const pageContent = content(["一", "二", "三", "四", "五", "六", "七"]);
    const result = editorialIndex.plan(context(pageContent, { facts: facts({ itemCount: 7 }) }));
    expect("conflict" in result).toBe(true);
  });

  it("is deterministic", () => {
    const pageContent = content(["一", "二", "三", "四"]);
    const ctx = context(pageContent, { facts: facts({ itemCount: 4 }) });
    expect(signature(plan(editorialIndex, ctx))).toEqual(
      signature(plan(editorialIndex, context(pageContent, { facts: facts({ itemCount: 4 }) }))),
    );
  });
});

describe("image-led recipe", () => {
  it("lays copy into the text area the picture left behind", () => {
    const pageContent = content(["品牌认知持续提升", "重点行业渗透加快", "客户续约保持稳定"]);
    const ctx = context(pageContent, { facts: facts({ itemCount: 3 }) });
    ctx.frame.content = {
      x: inches(0.93),
      y: inches(1.2),
      width: inches(6.2),
      height: inches(5.2),
    };
    expect(imageLed.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: true, assetRole: "side" })).toBe(
      true,
    );
    const result = plan(imageLed, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, pageContent)).toBeUndefined();
    expect(result.imageFrame).toEqual({ x: 0.52, y: 0, width: 0.48, height: 1 });
    const texts = result.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    expect(texts).toEqual(expect.arrayContaining(["品牌认知持续提升", "重点行业渗透加快", "客户续约保持稳定"]));
  });

  it("requires an actual picture", () => {
    expect(imageLed.supports(facts(), concept(), { hasArtwork: false, hasAsset: false })).toBe(false);
  });
});

describe("data-story recipe", () => {
  const metricContent: SlideContent = {
    title: "本季度三项核心指标",
    body: "销售收入 38 万，客户数 260 家，平均交付 5 天。",
    blocks: [
      { id: "m1", type: "metric", label: "销售收入", value: "38 万" },
      { id: "m2", type: "metric", label: "客户数", value: "260 家" },
      { id: "m3", type: "metric", label: "平均交付", value: "5 天" },
    ],
    speakerNotes: "",
    status: "approved",
  };

  it("draws three metrics as large numbers with editable bindings", () => {
    const ctx = context(metricContent, {
      facts: facts({ itemCount: 0, hasRowBlock: true, hasMetric: true }),
    });
    expect(dataStory.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(dataStory, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, metricContent)).toBeUndefined();
    expect(result.consumed.blockIds).toEqual(["m1", "m2", "m3"]);
    const texts = result.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    expect(texts).toEqual(expect.arrayContaining(["38 万", "260 家", "5 天", "销售收入", "客户数", "平均交付"]));
    const metricValues = result.elements.filter(
      (element) => element.type === "text" && element.contentBlockRef?.field === "value",
    );
    expect(metricValues).toHaveLength(3);
  });

  it("refuses a fourth metric", () => {
    const four = {
      ...metricContent,
      blocks: [...metricContent.blocks!, { id: "m4", type: "metric", label: "第四项", value: "1" }] as ContentBlock[],
    };
    const result = dataStory.plan(
      context(four, { facts: facts({ itemCount: 0, hasRowBlock: true, hasMetric: true }) }),
    );
    expect("conflict" in result).toBe(true);
  });

  it("refuses a process page", () => {
    expect(
      dataStory.supports(facts({ hasRowBlock: true, hasMetric: true, hasProcess: true }), concept(), {
        hasArtwork: false,
        hasAsset: false,
      }),
    ).toBe(false);
  });
});

describe("cover-statement recipe", () => {
  it("draws a cover with a large title and a subtitle", () => {
    const pageContent = {
      title: "年度销售汇报",
      body: "2026 财年 · 董事会",
      speakerNotes: "",
      status: "approved" as const,
    };
    const ctx = context(pageContent, {
      facts: facts({ layout: "cover", itemCount: 1 }),
    });
    expect(coverStatement.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(coverStatement, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, pageContent)).toBeUndefined();
    const title = result.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(title?.type === "text" ? title.style.fontSizePt : 0).toBeGreaterThanOrEqual(40);
    const texts = result.elements
      .filter((element) => element.type === "text")
      .map((element) => (element.type === "text" ? element.text : ""));
    expect(texts).toEqual(expect.arrayContaining(["年度销售汇报", "2026 财年 · 董事会"]));
  });

  it("refuses a content page", () => {
    expect(coverStatement.supports(facts(), concept(), { hasArtwork: false, hasAsset: false })).toBe(false);
  });
});

describe("asymmetric-split recipe", () => {
  const items = [
    "销售收入在统计周期内实现同比正增长",
    "增长主要由核心业务与重点客户贡献",
    "季度增速存在波动但趋势持续向好",
    "收入质量同步改善，结构优化显现",
    "移动端与头部客户成为主要增长引擎",
  ];

  it("draws five longer points in an asymmetric split", () => {
    const pageContent = content(items);
    const ctx = context(pageContent, {
      facts: facts({ itemCount: 5, shortItems: false, longestItemLength: 24, layout: "split" }),
    });
    expect(asymmetricSplit.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(asymmetricSplit, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, pageContent)).toBeUndefined();
    expect(result.consumed.items).toBe(5);
    const title = result.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(title?.type).toBe("text");
  });

  it("mirrors the columns for variant=right", () => {
    const pageContent = content(items);
    const left = plan(
      asymmetricSplit,
      context(pageContent, { facts: facts({ itemCount: 5, shortItems: false }), variant: "left" }),
    );
    const right = plan(
      asymmetricSplit,
      context(pageContent, { facts: facts({ itemCount: 5, shortItems: false }), variant: "right" }),
    );
    const leftTitle = left.elements.find((element) => element.type === "text" && element.contentRef === "title")!;
    const rightTitle = right.elements.find((element) => element.type === "text" && element.contentRef === "title")!;
    expect(
      Math.abs(rightTitle.frame.x + rightTitle.frame.width - (page.width - leftTitle.frame.x)),
    ).toBeLessThanOrEqual(1);
  });

  it("makes the title larger when the page focal point is the title", () => {
    const pageContent = content(items);
    const balanced = plan(asymmetricSplit, context(pageContent, { facts: facts({ itemCount: 5, shortItems: false }) }));
    const focused = plan(
      asymmetricSplit,
      context(pageContent, { facts: facts({ itemCount: 5, shortItems: false }), focal: "title" }),
    );
    const size = (result: RecipePlan) => {
      const title = result.elements.find((element) => element.type === "text" && element.contentRef === "title");
      return title?.type === "text" ? title.style.fontSizePt : 0;
    };
    expect(size(focused)).toBeGreaterThanOrEqual(size(balanced));
  });

  it("refuses structured content", () => {
    expect(
      asymmetricSplit.supports(facts({ hasRowBlock: true }), concept(), { hasArtwork: false, hasAsset: false }),
    ).toBe(false);
  });
});
