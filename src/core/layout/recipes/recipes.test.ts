import { describe, expect, it } from "vitest";
import type { CompositionFacts } from "../../commands/design-intent";
import { inches, type ContentBlock, type SlideContent, type TextElement } from "../../document-model";
import { defaultEditorialConcept, resolveDeckConcept, type DeckConcept } from "../../design/deck-concept";
import { deriveDesignTokens } from "../../design/design-tokens";
import { findThemePreset } from "../../design/theme-presets";
import { planPageChrome } from "../page-chrome";
import { asymmetricSplit } from "./asymmetric-split";
import { comparison } from "./comparison";
import { coverStatement } from "./cover-statement";
import { dataStory } from "./data-story";
import { editorialIndex } from "./editorial-index";
import { imageLed } from "./image-led";
import { processRail } from "./process-rail";
import { quoteField } from "./quote-field";
import { sectionStatement } from "./section-statement";
import { timelineRail } from "./timeline-rail";
import { consumptionProblem } from "./plan";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

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

function plan(recipe: LayoutRecipe, ctx: RecipeContext): RecipePlan {
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

  it("groups a sparse column instead of stretching it to the bottom", () => {
    const items = ["销售收入保持正增长", "移动端成为增长引擎", "资源向高质量业务倾斜"];
    const pageContent = content(items);
    const result = plan(editorialIndex, context(pageContent, { facts: facts({ itemCount: 3 }) }));
    const rows = result.elements
      .filter((element): element is TextElement => element.type === "text" && items.includes(element.text))
      .sort((left, right) => left.frame.y - right.frame.y);
    expect(rows).toHaveLength(3);
    const first = rows[0]!;
    const second = rows[1]!;
    // 17pt in a 1.35in equal slot was the old rhythm; the measured column is
    // allowed to be airy, but the row pitch must stay below 0.16 of the page.
    expect((second.frame.y - first.frame.y) / page.height).toBeLessThan(0.16);
    // A sparse column can use a larger size than dense running copy.
    expect(first.style.fontSizePt).toBeGreaterThanOrEqual(20);
    // The group is centred inside the content region, not pinned to its top.
    expect(first.frame.y).toBeGreaterThan(inches(2.55));
  });

  it("runs on a template artwork page without a second header rule", () => {
    const items = ["销售收入保持正增长", "移动端成为增长引擎", "资源向高质量业务倾斜"];
    const pageContent = content(items);
    const ctx = context(pageContent, { facts: facts({ itemCount: 3 }) });
    ctx.chrome = planPageChrome({
      page,
      title: ctx.frame.title,
      content: ctx.frame.content,
      safe: ctx.frame.safe,
      showRule: false,
    });
    expect(editorialIndex.supports(ctx.facts, ctx.concept, { hasArtwork: true, hasAsset: false })).toBe(true);
    const result = plan(editorialIndex, ctx);
    const headerRules = result.elements.filter(
      (element) =>
        element.type === "shape" &&
        element.frame.width >= page.width * 0.1 &&
        element.frame.width <= page.width * 0.13 &&
        element.frame.height <= inches(0.02),
    );
    expect(headerRules).toHaveLength(0);
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

  it("uses the template picture placeholder when the template has one", () => {
    const pageContent = content(["品牌认知持续提升", "重点行业渗透加快", "客户续约保持稳定"]);
    const ctx = context(pageContent, { facts: facts({ itemCount: 3 }) });
    ctx.frame.title = { x: inches(0.63), y: inches(0.2), width: inches(5.8), height: inches(0.5) };
    ctx.frame.content = { x: inches(0.63), y: inches(1.5), width: inches(5.8), height: inches(4.8) };
    ctx.chrome = planPageChrome({
      page,
      title: ctx.frame.title,
      content: ctx.frame.content,
      safe: ctx.frame.safe,
      showRule: false,
    });
    ctx.templateImage = { x: 0.56, y: 0.2, width: 0.38, height: 0.6 };
    expect(
      imageLed.supports(ctx.facts, ctx.concept, {
        hasArtwork: true,
        hasAsset: true,
        hasTemplateImage: true,
        assetRole: "side",
      }),
    ).toBe(true);
    const result = plan(imageLed, ctx);
    expect(result.imageFrame).toEqual(ctx.templateImage);
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

  it("puts each label directly under its value instead of a fixed y", () => {
    const ctx = context(metricContent, {
      facts: facts({ itemCount: 0, hasRowBlock: true, hasMetric: true }),
    });
    const result = plan(dataStory, ctx);
    const values = result.elements.filter(
      (element): element is TextElement => element.type === "text" && element.contentBlockRef?.field === "value",
    );
    const labels = result.elements.filter(
      (element): element is TextElement => element.type === "text" && element.contentBlockRef?.field === "label",
    );
    expect(values).toHaveLength(3);
    expect(labels).toHaveLength(3);
    values.forEach((value, index) => {
      const label = labels[index]!;
      const gap = (label.frame.y - (value.frame.y + value.frame.height)) / page.height;
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(0.05);
    });
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

  it("starts the right column at the content axis instead of centring it", () => {
    const pageContent = content(items);
    const ctx = context(pageContent, { facts: facts({ itemCount: 5, shortItems: false, layout: "split" }) });
    const result = plan(asymmetricSplit, ctx);
    const firstRow = result.elements
      .filter((element): element is TextElement => element.type === "text" && items.includes(element.text))
      .sort((left, right) => left.frame.y - right.frame.y)[0]!;
    const contentTop = (2.55 / 7.5) * page.height;
    expect(Math.abs(firstRow.frame.y - contentTop) / page.height).toBeLessThan(0.03);
  });
});

describe("process-rail recipe", () => {
  const processContent: SlideContent = {
    title: "标准交付流程",
    body: "",
    blocks: [
      {
        id: "process-1",
        type: "process",
        items: [
          { label: "样本前处理", text: "48 小时内完成建库" },
          { label: "上机测序", text: "Illumina NovaSeq 平台" },
          { label: "生信分析", text: "自动化流程与人工复核" },
          { label: "报告交付", text: "临床级报告与解读" },
        ],
      },
    ],
    speakerNotes: "",
    status: "approved",
  };

  it("draws four steps as one vertical rail with editable bindings", () => {
    const ctx = context(processContent, {
      facts: facts({ itemCount: 0, hasProcess: true, hasRowBlock: true, layout: "cards" }),
    });
    expect(processRail.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(processRail, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, processContent)).toBeUndefined();
    expect(result.consumed.blockIds).toEqual(["process-1"]);
    const texts = result.elements
      .filter((element): element is TextElement => element.type === "text")
      .map((element) => element.text);
    expect(texts).toEqual(
      expect.arrayContaining(["01", "02", "03", "04", "样本前处理", "上机测序", "生信分析", "报告交付"]),
    );
    const nodes = result.elements.filter((element) => element.type === "shape" && element.shape === "ellipse");
    expect(nodes).toHaveLength(4);
  });

  it("refuses a seventh step instead of compressing it", () => {
    const seven = {
      ...processContent,
      blocks: [
        {
          id: "process-1",
          type: "process" as const,
          items: Array.from({ length: 7 }, (_, index) => ({ label: `步骤${index + 1}`, text: "说明" })),
        },
      ],
    };
    const result = processRail.plan(
      context(seven, { facts: facts({ itemCount: 0, hasProcess: true, hasRowBlock: true }) }),
    );
    expect("conflict" in result).toBe(true);
  });
});

describe("comparison recipe", () => {
  const comparisonContent: SlideContent = {
    title: "两种合作模式对比",
    body: "",
    blocks: [
      {
        id: "comparison-1",
        type: "comparison",
        leftLabel: "自建实验室",
        rightLabel: "委托检测",
        leftItems: ["长期成本更低", "数据完全自主", "需 6 个月建设期"],
        rightItems: ["启动快", "无需设备投入", "依赖外部排期"],
      },
    ],
    speakerNotes: "",
    status: "approved",
  };

  it("draws two equal columns with a centre mark", () => {
    const ctx = context(comparisonContent, {
      facts: facts({ itemCount: 6, hasComparison: true, hasRowBlock: false, layout: "split" }),
    });
    expect(comparison.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(comparison, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, comparisonContent)).toBeUndefined();
    expect(result.consumed.blockIds).toEqual(["comparison-1"]);
    const texts = result.elements
      .filter((element): element is TextElement => element.type === "text")
      .map((element) => element.text);
    expect(texts).toEqual(
      expect.arrayContaining(["自建实验室", "委托检测", "长期成本更低", "数据完全自主", "启动快", "依赖外部排期"]),
    );
    expect(texts).not.toContain("VS");
    const ellipses = result.elements.filter((element) => element.type === "shape" && element.shape === "ellipse");
    expect(ellipses).toHaveLength(0);
  });

  it("refuses six points in one column", () => {
    const six = {
      ...comparisonContent,
      blocks: [
        {
          id: "comparison-1",
          type: "comparison" as const,
          leftLabel: "甲",
          rightLabel: "乙",
          leftItems: ["一", "二", "三", "四", "五", "六"],
          rightItems: ["一", "二"],
        },
      ],
    };
    const result = comparison.plan(
      context(six, { facts: facts({ itemCount: 8, hasComparison: true, layout: "split" }) }),
    );
    expect("conflict" in result).toBe(true);
  });
});

describe("timeline-rail recipe", () => {
  const timelineContent: SlideContent = {
    title: "公司发展历程",
    body: "",
    blocks: [
      {
        id: "timeline-1",
        type: "timeline",
        items: [
          { label: "2018", text: "公司成立，完成首轮融资" },
          { label: "2020", text: "自建测序平台投入运行" },
          { label: "2021", text: "合作医院突破 100 家" },
          { label: "2023", text: "年检测样本量超过 30 万" },
          { label: "2025", text: "三代测序产品线全面上线" },
        ],
      },
    ],
    speakerNotes: "",
    status: "approved",
  };

  it("draws dates, nodes and events along one rail", () => {
    const ctx = context(timelineContent, {
      facts: facts({ itemCount: 5, hasTimeline: true, hasRowBlock: true, layout: "cards" }),
    });
    expect(timelineRail.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(timelineRail, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, timelineContent)).toBeUndefined();
    expect(result.consumed.blockIds).toEqual(["timeline-1"]);
    const texts = result.elements
      .filter((element): element is TextElement => element.type === "text")
      .map((element) => element.text);
    expect(texts).toEqual(expect.arrayContaining(["2018", "2025", "公司成立，完成首轮融资"]));
    const nodes = result.elements.filter((element) => element.type === "shape" && element.shape === "ellipse");
    expect(nodes).toHaveLength(5);
  });

  it("refuses seven dates", () => {
    const seven = {
      ...timelineContent,
      blocks: [
        {
          id: "timeline-1",
          type: "timeline" as const,
          items: Array.from({ length: 7 }, (_, index) => ({ label: `第${index}年`, text: "事件" })),
        },
      ],
    };
    const result = timelineRail.plan(
      context(seven, { facts: facts({ itemCount: 7, hasTimeline: true, hasRowBlock: true }) }),
    );
    expect("conflict" in result).toBe(true);
  });
});

describe("quote-field recipe", () => {
  const quoteContent: SlideContent = {
    title: "岳阳楼记",
    body: "",
    blocks: [
      {
        id: "quote-1",
        type: "quote",
        text: "先天下之忧而忧，后天下之乐而乐。",
        attribution: "范仲淹",
      },
    ],
    speakerNotes: "",
    status: "approved",
  };

  it("draws a large quote with its mark and attribution", () => {
    const ctx = context(quoteContent, {
      facts: facts({ itemCount: 1, hasQuote: true, layout: "quote" }),
    });
    expect(quoteField.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(quoteField, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, quoteContent)).toBeUndefined();
    expect(result.consumed.blockIds).toEqual(["quote-1"]);
    const texts = result.elements
      .filter((element): element is TextElement => element.type === "text")
      .map((element) => element.text);
    expect(texts).toEqual(expect.arrayContaining(["“", "先天下之忧而忧，后天下之乐而乐。", "— 范仲淹"]));
    const quote = result.elements.find(
      (element): element is TextElement =>
        element.type === "text" && element.text === "先天下之忧而忧，后天下之乐而乐。",
    )!;
    expect(quote.style.fontSizePt).toBeGreaterThanOrEqual(28);
  });
});

describe("section-statement recipe", () => {
  const sectionContent: SlideContent = {
    title: "第二部分 交付能力",
    body: "从样本前处理到报告解读的完整链路。",
    speakerNotes: "",
    status: "approved",
  };

  it("draws a chapter number, title and one sentence", () => {
    const ctx = context(sectionContent, { facts: facts({ itemCount: 1, layout: "section" }) });
    ctx.page = { index: 1, total: 10 };
    expect(sectionStatement.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(sectionStatement, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, sectionContent)).toBeUndefined();
    const texts = result.elements
      .filter((element): element is TextElement => element.type === "text")
      .map((element) => element.text);
    expect(texts).toEqual(expect.arrayContaining(["02", sectionContent.title, sectionContent.body]));
    expect(result.elements.some((element) => element.type === "shape")).toBe(true);
  });

  it("does not draw over a template section page", () => {
    const ctx = context(sectionContent, { facts: facts({ itemCount: 1, layout: "section" }) });
    expect(
      sectionStatement.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false, hasTemplate: true }),
    ).toBe(false);
  });
});
