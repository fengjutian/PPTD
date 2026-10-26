import { describe, expect, it } from "vitest";
import type { CompositionFacts } from "../../commands/design-intent";
import { inches, type ContentBlock, type SlideContent, type TextElement } from "../../document-model";
import {
  defaultConceptForPreset,
  defaultEditorialConcept,
  defaultInstrumentConcept,
  defaultPaperConcept,
  resolveDeckConcept,
  type DeckConcept,
} from "../../design/deck-concept";
import { deriveDesignTokens, deriveSemanticColors } from "../../design/design-tokens";
import { findThemePreset } from "../../design/theme-presets";
import { contrastRatio } from "../../rendering/contrast";
import { planPageChrome } from "../page-chrome";
import { asymmetricSplit } from "./asymmetric-split";
import { chartStory } from "./chart-story";
import { comparison } from "./comparison";
import { coverStatement } from "./cover-statement";
import { dataStory } from "./data-story";
import { editorialIndex } from "./editorial-index";
import { fullBleedImage } from "./full-bleed-image";
import { imageLed } from "./image-led";
import { instrumentColumns } from "./instrument-columns";
import { frameFromNormalized, rectsOverlap } from "./measure";
import { paperColumn } from "./paper-column";
import { processRail } from "./process-rail";
import { quoteField } from "./quote-field";
import { sectionStatement } from "./section-statement";
import { sideImageText } from "./side-image-text";
import { timelineRail } from "./timeline-rail";
import { weightedSplit } from "./weighted-split";
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
      panel: "#1F4E79",
      ...deriveSemanticColors({ surface: "#FFFFFF", ink: "#465368", accent: "#1F4E79" }),
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

  it("never sets the headline under the picture on an indented surface", () => {
    // A rail or column surface pushes the title axis to 0.17–0.22. With a fixed
    // 40% column the headline ran from there into the picture at 0.52 and
    // disappeared into it (white copy on a photograph).
    const pageContent: SlideContent = {
      title: "Alphabet 2023 年报：广告基本盘与 AI 第二曲线同时加速",
      body: "广告基本盘稳固，云与 AI 重塑增长路径",
      speakerNotes: "",
      status: "approved",
    };
    const ctx = context(pageContent, { facts: facts({ layout: "cover", itemCount: 0 }) });
    ctx.frame.title = { x: inches(2.93), y: inches(0.6), width: inches(9.5), height: inches(1.5) };
    ctx.chrome = planPageChrome({
      page,
      title: ctx.frame.title,
      content: ctx.frame.content,
      safe: ctx.frame.safe,
    });
    const result = plan(imageLed, ctx);
    const title = result.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(title?.type).toBe("text");
    if (title?.type !== "text" || !result.imageFrame) return;
    const titleRight = (title.frame.x + title.frame.width) / page.width;
    expect(titleRight).toBeLessThanOrEqual(result.imageFrame.x);
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

describe("full-bleed-image recipe", () => {
  const statement: SlideContent = {
    title: "一条河改变了一座城",
    body: "二十年治理的现场记录",
    speakerNotes: "",
    status: "approved",
  };

  function documentary(): DeckConcept {
    return resolveDeckConcept({
      concept: defaultConceptForPreset("documentary"),
      pageFacts: [facts()],
      pageCount: 1,
      id: "recipe-documentary",
    }).concept;
  }

  it("gives the picture the page and sets the copy on a raised plate", () => {
    const ctx = context(statement, { facts: facts({ layout: "cover", itemCount: 0 }) });
    ctx.concept = documentary();
    expect(
      fullBleedImage.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: true, assetRole: "hero" }),
    ).toBe(true);
    const result = plan(fullBleedImage, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, statement)).toBeUndefined();
    expect(result.imageFrame).toEqual({ x: 0, y: 0, width: 1, height: 1 });

    // The plate is a filled surface, not a rule: it spans the page width, covers
    // a real share of the height, and is the theme's raised tone rather than the
    // page background.
    const plate = result.elements.find(
      (element) =>
        element.type === "shape" && element.frame.width >= page.width - 1 && element.frame.height > page.height * 0.15,
    );
    expect(plate?.type).toBe("shape");
    expect(plate?.type === "shape" ? plate.style.fill : undefined).toBe(
      deriveSemanticColors({ surface: "#FFFFFF", ink: "#465368", accent: "#1F4E79" }).surfaceRaised,
    );
    // The plate lies over a photograph, so it carries the raised shadow token.
    // The token is what the exporter turns into `a:outerShdw`; a recipe that
    // wrote a blur value here would bypass the design system.
    expect(plate?.type === "shape" ? plate.style.shadow : undefined).toBe("raised");
    // The headline sits inside the plate, not on the picture above it.
    const title = result.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(title?.type).toBe("text");
    if (title?.type !== "text" || plate?.type !== "shape") return;
    expect(title.frame.y).toBeGreaterThanOrEqual(plate.frame.y);
    expect(title.frame.y + title.frame.height).toBeLessThanOrEqual(plate.frame.y + plate.frame.height + 1);
  });

  it("refuses a page with a list or without a picture", () => {
    const list = facts({ itemCount: 4 });
    expect(fullBleedImage.supports(list, documentary(), { hasArtwork: false, hasAsset: true, assetRole: "hero" })).toBe(
      false,
    );
    expect(fullBleedImage.supports(facts(), documentary(), { hasArtwork: false, hasAsset: false })).toBe(false);
  });

  it("refuses to paint over a template's own artwork without a picture placeholder", () => {
    expect(
      fullBleedImage.supports(facts({ itemCount: 0 }), documentary(), {
        hasArtwork: true,
        hasAsset: true,
        assetRole: "hero",
      }),
    ).toBe(false);
  });
});

describe("side-image-text recipe", () => {
  const pageContent = content(["品牌认知持续提升", "重点行业渗透加快", "客户续约保持稳定"]);

  it("keeps the copy column clear of the picture plate", () => {
    const ctx = context(pageContent, { facts: facts({ itemCount: 3 }) });
    expect(
      sideImageText.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: true, assetRole: "side" }),
    ).toBe(true);
    const result = plan(sideImageText, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, pageContent)).toBeUndefined();
    expect(result.imageFrame).toBeDefined();
    const picture = frameFromNormalized(result.imageFrame!, page);
    // The plate is inset: it starts below the header instead of bleeding off the
    // top edge, which is what the `image-led` composition does.
    expect(result.imageFrame!.y).toBeGreaterThan(0);
    for (const element of result.elements) {
      if (element.type !== "text") continue;
      expect(rectsOverlap(element.frame, picture)).toBe(false);
    }
  });

  it("keeps the shared title axis and puts the band behind the headline", () => {
    const ctx = context(pageContent, { facts: facts({ itemCount: 3 }) });
    const result = plan(sideImageText, ctx);
    const title = result.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(title?.type).toBe("text");
    if (title?.type !== "text") return;
    expect(title.frame.y).toBe(ctx.frame.title.y);

    const bandIndex = result.elements.findIndex(
      (element) => element.type === "shape" && element.frame.height > title.frame.height,
    );
    const titleIndex = result.elements.findIndex((element) => element.id === title.id);
    expect(bandIndex).toBeGreaterThanOrEqual(0);
    expect(bandIndex).toBeLessThan(titleIndex);
    const band = result.elements[bandIndex]!;
    expect(band.type === "shape" ? band.style.fill : undefined).toBe(
      deriveSemanticColors({ surface: "#FFFFFF", ink: "#465368", accent: "#1F4E79" }).accentSubtle,
    );
  });

  it("refuses a band picture and uses the template placeholder as given", () => {
    expect(sideImageText.supports(facts(), concept(), { hasArtwork: false, hasAsset: true, assetRole: "band" })).toBe(
      false,
    );
    const ctx = context(pageContent, { facts: facts({ itemCount: 3 }) });
    ctx.templateImage = { x: 0.56, y: 0.2, width: 0.38, height: 0.6 };
    const result = plan(sideImageText, ctx);
    expect(result.imageFrame).toEqual(ctx.templateImage);
    // A template's placeholder is its own rectangle: the recipe does not
    // reshape a frame it did not lay out.
    expect(result.imageShape).toBeUndefined();
  });

  it("asks for a soft-cornered plate on a free page", () => {
    const ctx = context(pageContent, { facts: facts({ itemCount: 3 }) });
    const result = plan(sideImageText, ctx);
    expect(result.imageShape).toBe("roundRect");
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

  it("sets each metric on a recessed card with a muted label", () => {
    const ctx = context(metricContent, {
      facts: facts({ itemCount: 0, hasRowBlock: true, hasMetric: true }),
    });
    const result = plan(dataStory, ctx);
    const cards = result.elements.filter(
      (element) =>
        element.type === "shape" &&
        element.style.fill === ctx.colors.surfaceSunken &&
        element.frame.height > page.height * 0.1,
    );
    // Three measurements, three cards: the page stops reading as a list.
    expect(cards).toHaveLength(3);
    // The label sits back so the number leads; the card is neutral, so the
    // muted ink still clears the contrast floor.
    for (const label of ["销售收入", "客户数", "平均交付"]) {
      const text = result.elements.find((element) => element.type === "text" && element.text === label);
      expect(text?.type === "text" ? text.style.color : undefined).toBe(ctx.colors.textMuted);
    }
  });

  it("keeps template artwork clear of the metric cards", () => {
    const ctx = context(metricContent, {
      facts: facts({ itemCount: 0, hasRowBlock: true, hasMetric: true }),
    });
    ctx.hasArtwork = true;
    const result = plan(dataStory, ctx);
    const fills = result.elements.flatMap((element) => (element.type === "shape" ? [element.style.fill] : []));
    expect(fills).not.toContain(ctx.colors.surfaceSunken);
  });

  it("draws a native chart when the metrics share a unit", () => {
    const numeric: SlideContent = {
      ...metricContent,
      blocks: [
        { id: "n1", type: "metric", label: "第一季度", value: "38" },
        { id: "n2", type: "metric", label: "第二季度", value: "52" },
        { id: "n3", type: "metric", label: "第三季度", value: "71" },
      ],
      body: "",
    };
    const ctx = context(numeric, {
      facts: facts({ itemCount: 0, hasRowBlock: true, hasMetric: true }),
    });
    ctx.chartKind = "line";
    const result = plan(dataStory, ctx);
    expect(consumptionProblem(result, numeric)).toBeUndefined();
    const chart = result.elements.find((element) => element.type === "chart");
    expect(chart?.type).toBe("chart");
    expect(chart?.type === "chart" ? chart.kind : "").toBe("line");
    expect(chart?.type === "chart" ? chart.contentBlockIds : []).toEqual(["n1", "n2", "n3"]);
    expect(result.consumed.blockIds).toEqual(["n1", "n2", "n3"]);
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

  it("splits a topic：conclusion title into an eyebrow and a headline", () => {
    const pageContent = {
      title: "Alphabet 2023 年报：广告基本盘与 AI 第二曲线同时加速",
      body: "广告基本盘稳固，云与 AI 重塑增长路径",
      speakerNotes: "",
      status: "approved" as const,
    };
    const result = plan(coverStatement, context(pageContent, { facts: facts({ layout: "cover", itemCount: 1 }) }));
    const texts = result.elements.filter((element): element is TextElement => element.type === "text");
    const headline = texts.find((element) => element.contentRef === "title")!;
    const eyebrow = texts.find((element) => element.contentRef === undefined && element.text.startsWith("Alphabet"))!;
    expect(eyebrow.text).toBe("Alphabet 2023 年报");
    expect(headline.text).toBe("广告基本盘与 AI 第二曲线同时加速");
    // The headline is a view of the same reviewed title: editing it writes back
    // into this range instead of replacing the whole field.
    expect(headline.contentRange).toEqual({
      start: pageContent.title.indexOf("：") + 1,
      end: pageContent.title.length,
    });
    // The eyebrow sits above the headline and is set smaller.
    expect(eyebrow.frame.y).toBeLessThan(headline.frame.y);
    expect(eyebrow.style.fontSizePt).toBeLessThan(headline.style.fontSizePt);
    expect(headline.frame.y + headline.frame.height).toBeLessThanOrEqual(Math.round(0.62 * page.height) + 1);
  });

  it("keeps one title when there is no topic label to lift", () => {
    const pageContent = {
      title: "年度销售汇报",
      body: "2026 财年 · 董事会",
      speakerNotes: "",
      status: "approved" as const,
    };
    const result = plan(coverStatement, context(pageContent, { facts: facts({ layout: "cover", itemCount: 1 }) }));
    const texts = result.elements.filter((element): element is TextElement => element.type === "text");
    const titles = texts.filter((element) => element.contentRef === "title");
    expect(titles).toHaveLength(1);
    expect(titles[0]!.text).toBe("年度销售汇报");
    expect(titles[0]!.contentRange).toBeUndefined();
  });

  it("paints the brand panel on a dark page instead of the light accent ink", () => {
    const pageContent = {
      title: "年度销售汇报",
      body: "2026 财年 · 董事会",
      speakerNotes: "",
      status: "approved" as const,
    };
    const ctx = context(pageContent, { facts: facts({ layout: "cover", itemCount: 1 }) });
    // A dark cover resolves its accents to the light ink that reads on it. The
    // field used to be filled with that ink, which painted a grey gradient and
    // left the white subtitle at 2:1.
    ctx.colors = { ...ctx.colors, accent: "#F7F9FC", title: "#F7F9FC", body: "#F7F9FC", panel: "#2563EB" };
    const result = plan(coverStatement, ctx);
    const field = result.elements.find((element) => element.type === "shape" && element.style.fillGradient);
    expect(field?.type === "shape" ? field.style.fill : "").toBe("#2563EB");
    for (const stop of field?.type === "shape" ? (field.style.fillGradient?.stops ?? []) : []) {
      expect(contrastRatio("#FFFFFF", stop.color), stop.color).toBeGreaterThanOrEqual(4.5);
    }
    const title = result.elements.find((element) => element.type === "text" && element.contentRef === "title");
    expect(title?.type === "text" ? title.style.color : "").toBe("#FFFFFF");
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

  it("draws four steps as one rail across a landscape page", () => {
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
    // Side by side on one line and spread across the content width: four short
    // steps in the left fifth of a 16:9 page read as a list in a corner.
    const centers = nodes.map((node) => node.frame.y + node.frame.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(page.height * 0.01);
    const lefts = nodes.map((node) => node.frame.x);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(page.width * 0.55);
  });

  it("keeps the vertical rail on a page that is not landscape", () => {
    const tall = { width: inches(7.5), height: inches(7.5) };
    const ctx = context(processContent, {
      facts: facts({ itemCount: 0, hasProcess: true, hasRowBlock: true, layout: "cards" }),
    });
    ctx.frame.page = tall;
    ctx.frame.title = { x: inches(0.6), y: inches(0.35), width: inches(6.3), height: inches(0.7) };
    ctx.frame.content = { x: inches(0.6), y: inches(1.4), width: inches(6.3), height: inches(5.3) };
    ctx.frame.safe = { x: 0.08, y: 0.05, width: 0.84, height: 0.9 };
    ctx.chrome = undefined;
    const result = plan(processRail, ctx);
    const nodes = result.elements.filter((element) => element.type === "shape" && element.shape === "ellipse");
    expect(nodes).toHaveLength(4);
    // Stacked: one column, four different heights.
    const centers = nodes.map((node) => node.frame.y + node.frame.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeGreaterThan(tall.height * 0.15);
    const lefts = nodes.map((node) => node.frame.x);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(tall.width * 0.05);
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

  it("sets each column on a recessed field under a solid accent header", () => {
    const ctx = context(comparisonContent, {
      facts: facts({ itemCount: 6, hasComparison: true, hasRowBlock: false, layout: "split" }),
    });
    const result = plan(comparison, ctx);
    const filled = (fill: string) =>
      result.elements.filter(
        (element) =>
          element.type === "shape" &&
          element.style.fill === fill &&
          element.frame.width > page.width * 0.2 &&
          element.frame.height > page.height * 0.04,
      );
    // One recessed field and one solid header field per column. The row markers
    // share the accent colour but are a few thousandths of the page wide.
    expect(filled(ctx.colors.surfaceSunken)).toHaveLength(2);
    expect(filled(ctx.colors.accentStrong)).toHaveLength(2);
    // The labels sit on the accent field, so they take its ink rather than the
    // accent ink, which may be a pale tone on a light page.
    for (const label of ["自建实验室", "委托检测"]) {
      const text = result.elements.find((element) => element.type === "text" && element.text === label);
      expect(text?.type === "text" ? text.style.color : undefined).toBe(ctx.colors.onAccent);
    }
    // The centre rule is a line, not a hairline: it is the only element that is
    // tall and a few thousandths of the page wide.
    const centre = result.elements.find(
      (element) =>
        element.type === "shape" &&
        element.frame.height > page.height * 0.5 &&
        element.frame.width < page.width * 0.005,
    );
    expect(centre?.type === "shape" ? centre.style.fill : undefined).toBe(ctx.colors.borderStrong);
  });

  it("keeps template artwork clear of the recessed field", () => {
    const ctx = context(comparisonContent, {
      facts: facts({ itemCount: 6, hasComparison: true, hasRowBlock: false, layout: "split" }),
    });
    ctx.hasArtwork = true;
    const result = plan(comparison, ctx);
    const fills = result.elements.flatMap((element) => (element.type === "shape" ? [element.style.fill] : []));
    // A filled panel would cover the artwork the template was chosen for; the
    // header field is a small mark and still goes on.
    expect(fills).not.toContain(ctx.colors.surfaceSunken);
    expect(
      result.elements.filter(
        (element) =>
          element.type === "shape" &&
          element.style.fill === ctx.colors.accentStrong &&
          element.frame.width > page.width * 0.2,
      ),
    ).toHaveLength(2);
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

describe("chart-story recipe", () => {
  const chartContent: SlideContent = {
    title: "收入连续三个季度回升",
    body: "",
    blocks: [
      {
        id: "chart-1",
        type: "chart",
        kind: "line",
        categories: ["第一季度", "第二季度", "第三季度"],
        values: [38, 52, 71],
        unit: "万元",
      },
    ],
    speakerNotes: "",
    status: "approved",
  };

  it("draws a native chart from the reviewed chart block", () => {
    const ctx = context(chartContent, {
      facts: facts({ itemCount: 0, hasChart: true, hasRowBlock: true, layout: "cards" }),
    });
    expect(chartStory.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(chartStory, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, chartContent)).toBeUndefined();
    expect(result.consumed.blockIds).toEqual(["chart-1"]);
    const chart = result.elements.find((element) => element.type === "chart");
    expect(chart?.type).toBe("chart");
    expect(chart?.type === "chart" ? chart.kind : "").toBe("line");
    expect(chart?.type === "chart" ? chart.contentBlockIds : []).toEqual(["chart-1"]);
  });

  it("puts a fitting takeaway beside the chart instead of over it", () => {
    const content: SlideContent = { ...chartContent, body: "收入连续三个季度回升。" };
    const ctx = context(content, {
      facts: facts({ itemCount: 0, hasChart: true, hasRowBlock: true, layout: "cards" }),
    });
    const result = plan(chartStory, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, content)).toBeUndefined();
    const chart = result.elements.find((element) => element.type === "chart");
    const body = result.elements.find((element) => element.type === "text" && element.contentRef === "body");
    expect(chart?.type).toBe("chart");
    expect(body?.type).toBe("text");
    if (chart?.type !== "chart" || body?.type !== "text") return;
    expect(body.frame.x).toBeGreaterThan(chart.frame.x + chart.frame.width);
  });
});

describe("weighted-split recipe", () => {
  const weightedContent: SlideContent = {
    title: "现金牛与第二曲线",
    body: "",
    blocks: [
      {
        id: "weighted-1",
        type: "comparison",
        leftLabel: "搜索与广告",
        rightLabel: "Google Cloud",
        leftItems: ["规模最大", "利润率高", "监管压力"],
        rightItems: ["增速双位数", "利润率转正", "持续投入"],
      },
    ],
    speakerNotes: "",
    status: "approved",
  };

  it("gives the primary column more width and type size", () => {
    const ctx = context(weightedContent, {
      facts: facts({ itemCount: 6, hasComparison: true, layout: "split" }),
    });
    ctx.ratio = 0.62;
    expect(weightedSplit.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(weightedSplit, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, weightedContent)).toBeUndefined();
    expect(result.consumed.blockIds).toEqual(["weighted-1"]);
    const texts = result.elements.filter((element): element is TextElement => element.type === "text");
    const left = texts.find((element) => element.text === "搜索与广告")!;
    const right = texts.find((element) => element.text === "Google Cloud")!;
    expect(left.style.fontSizePt).toBeGreaterThan(right.style.fontSizePt);
    expect(left.frame.width).toBeGreaterThan(right.frame.width);
    expect(texts.map((element) => element.text)).not.toContain("VS");
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
    // Side by side on one line: a history reads left to right on a wide page.
    const centers = nodes.map((node) => node.frame.y + node.frame.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(page.height * 0.01);
    const lefts = nodes.map((node) => node.frame.x);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeGreaterThan(page.width * 0.55);
    // Each date sits above its own dot, and its event below.
    const firstDate = result.elements.find((element) => element.type === "text" && element.text === "2018");
    expect(firstDate?.type === "text" ? firstDate.frame.y : 0).toBeLessThan(centers[0]!);
  });

  it("keeps the vertical rail on a page that is not landscape", () => {
    const tall = { width: inches(7.5), height: inches(7.5) };
    const ctx = context(timelineContent, {
      facts: facts({ itemCount: 5, hasTimeline: true, hasRowBlock: true, layout: "cards" }),
    });
    ctx.frame.page = tall;
    ctx.frame.title = { x: inches(0.6), y: inches(0.35), width: inches(6.3), height: inches(0.7) };
    ctx.frame.content = { x: inches(0.6), y: inches(1.4), width: inches(6.3), height: inches(5.3) };
    ctx.frame.safe = { x: 0.08, y: 0.05, width: 0.84, height: 0.9 };
    ctx.chrome = undefined;
    const result = plan(timelineRail, ctx);
    const nodes = result.elements.filter((element) => element.type === "shape" && element.shape === "ellipse");
    expect(nodes).toHaveLength(5);
    const centers = nodes.map((node) => node.frame.y + node.frame.height / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeGreaterThan(tall.height * 0.1);
    const lefts = nodes.map((node) => node.frame.x);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(tall.width * 0.05);
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

function directionConcept(preset: "paper" | "instrument"): DeckConcept {
  const seed = preset === "paper" ? defaultPaperConcept() : defaultInstrumentConcept();
  return resolveDeckConcept({ concept: seed, pageFacts: [facts()], pageCount: 1, id: preset }).concept;
}

function prosePage(title: string, items: string[]): SlideContent {
  return {
    title,
    body: items.join("\n"),
    blocks: [{ id: "bullets-1", type: "bullet-list", items }],
    speakerNotes: "",
    status: "approved",
  };
}

describe("paper-column recipe", () => {
  it("sets the points as one measured column, without an index or row rules", () => {
    const pageContent = prosePage("门店调整的判断", [
      "关闭低效门店释放租金",
      "把陈列面积让给高频品类",
      "用预约制降低高峰拥堵",
    ]);
    const ctx = context(pageContent, { facts: facts({ itemCount: 3 }) });
    ctx.concept = directionConcept("paper");
    expect(paperColumn.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(paperColumn, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, pageContent)).toBeUndefined();
    const texts = result.elements.filter((element): element is TextElement => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(
      expect.arrayContaining(["关闭低效门店释放租金", "把陈列面积让给高频品类", "用预约制降低高峰拥堵"]),
    );
    // No index and no separator per row: the page is read, not scanned.
    expect(texts.some((element) => /^0\d$/.test(element.text))).toBe(false);
    expect(result.elements.filter((element) => element.type === "shape")).toHaveLength(1);
    // One measure: every paragraph starts on the same axis.
    const paragraphX = new Set(
      texts.filter((element) => element.contentRef !== "title").map((element) => element.frame.x),
    );
    expect(paragraphX.size).toBe(1);
  });

  it("refuses a list that has no column shape", () => {
    const seven = prosePage("七个判断", ["一", "二", "三", "四", "五", "六", "七"]);
    const ctx = context(seven, { facts: facts({ itemCount: 7 }) });
    ctx.concept = directionConcept("paper");
    expect(paperColumn.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(false);
  });
});

describe("instrument-columns recipe", () => {
  it("puts every point in its own panel with an oversized index", () => {
    const pageContent = prosePage("三项核心指标", ["销售收入 38 万", "客户数 260 家", "平均交付 5 天"]);
    const ctx = context(pageContent, { facts: facts({ itemCount: 3, longestItemLength: 12 }) });
    ctx.concept = directionConcept("instrument");
    expect(instrumentColumns.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(true);
    const result = plan(instrumentColumns, ctx);
    expectInsidePage(result);
    expect(consumptionProblem(result, pageContent)).toBeUndefined();
    const texts = result.elements.filter((element): element is TextElement => element.type === "text");
    expect(texts.map((element) => element.text)).toEqual(expect.arrayContaining(["01", "02", "03"]));
    // One text column per point, not rows in a shared column.
    const copyColumns = new Set(
      texts
        .filter((element) => element.contentRef !== "title" && !/^0\d$/.test(element.text))
        .map((element) => element.frame.x),
    );
    expect(copyColumns.size).toBe(3);
    // A tier of hairlines above the indexes, and one separator between panels.
    const bars = result.elements.filter((element) => element.type === "shape");
    expect(bars.length).toBeGreaterThanOrEqual(5);
  });

  it("refuses a point that is a paragraph, not a panel", () => {
    const long = prosePage("两项对比", [
      "搜索广告仍然贡献了绝大部分的营收与现金流，是本季度最稳定的业务",
      "云业务增速更快但利润率仍低于广告",
    ]);
    const ctx = context(long, { facts: facts({ itemCount: 2, longestItemLength: 34 }) });
    ctx.concept = directionConcept("instrument");
    expect(instrumentColumns.supports(ctx.facts, ctx.concept, { hasArtwork: false, hasAsset: false })).toBe(false);
  });
});
