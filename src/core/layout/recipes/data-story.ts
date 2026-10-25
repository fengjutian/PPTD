import type { IntentConflict } from "../../commands/design-intent";
import type { ChartElement, ContentBlock, Emu } from "../../document-model";
import { parseMetricValue } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement } from "./elements";
import { fittedFontSizeInRange, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type MetricBlock = Extract<ContentBlock, { type: "metric" }>;

/** The space between a value and the label that names it, in page height. */
const LABEL_GAP = 0.018;
/** The shortest accent rule above a metric group. */
const RULE_GAP = 0.05;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const dataStory: LayoutRecipe = {
  id: "data-story",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("data-story")) return false;
    if (options.hasAsset) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    if (facts.hasQuote || facts.hasComparison) return false;
    if (facts.hasTimeline || facts.hasProcess || facts.hasTable) return false;
    return Boolean(facts.hasMetric);
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "指标页没有标题");
    const metrics = (ctx.content.blocks ?? []).filter((block): block is MetricBlock => block.type === "metric");
    if (metrics.length === 0) return conflict("metrics", "该页没有可绘制的指标块");
    if (metrics.length > 3) return conflict("metrics", "指标页最多承载 3 个指标");

    const page = ctx.frame.page;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleSize = fittedFontSizeInRange(
      title,
      titleFrame,
      ctx.tokens.type.titlePt,
      18,
      Math.max(ctx.tokens.type.titlePt, 36),
      headingFamily,
      lineHeight,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "指标页标题放不下");
    }

    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, ctx.colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];
    if (chrome.showRule) elements.push(rectElement(frameFromNormalized(chrome.rule, page), ctx.colors.accent));

    let contentTop = chrome.contentTop;
    let bodyCovered = ctx.content.body.trim().length === 0;
    const body = ctx.content.body.trim();
    if (body) {
      // A body sentence that names all metrics is a summary of the same numbers;
      // drawing it again as a lead would duplicate the page's evidence.
      if (metrics.every((metric) => body.includes(metric.value) || body.includes(metric.label))) {
        bodyCovered = true;
      } else {
        const leadFrame = frameFromNormalized(
          {
            x: chrome.content.x,
            y: contentTop,
            width: chrome.content.width,
            height: Math.min(0.12, chrome.content.height * 0.22),
          },
          page,
        );
        const leadSize = fittedFontSizeInRange(
          body,
          leadFrame,
          ctx.tokens.type.bodyPt,
          12,
          Math.max(ctx.tokens.type.bodyPt, 22),
          bodyFamily,
          lineHeight,
        );
        if (!textFits(body, leadFrame, leadSize, bodyFamily, lineHeight)) {
          return conflict("body", "指标页的说明文字放不下");
        }
        const leadHeight = pointsToNormalized(
          textHeightPt(body, leadFrame.width / 12_700, leadSize, bodyFamily, lineHeight),
          page.height,
        );
        elements.push(
          textElement(
            body,
            {
              ...leadFrame,
              height: Math.round((leadHeight + 0.004) * page.height) as Emu,
            },
            leadSize,
            ctx.colors.body,
            false,
            "left",
            bodyFamily,
            { contentRef: "body", lineHeight },
          ),
        );
        contentTop = contentTop + leadHeight + 0.03;
        bodyCovered = true;
      }
    }

    // When the metrics share a unit they are a real series, not three unrelated
    // numbers. Draw a native, editable chart and keep the labels/numbers beside
    // it; the chart points at the reviewed metric blocks, so it cannot invent a
    // number of its own.
    const parsedMetrics = metrics.map((metric) => parseMetricValue(metric.value));
    const chartable =
      parsedMetrics.every((parsed) => parsed !== undefined) &&
      parsedMetrics.every((parsed) => parsed!.unit === parsedMetrics[0]!.unit);
    const chartHeight = Math.min((chrome.contentBottom - contentTop) * 0.92, 0.68);
    if (metrics.length >= 2 && chartable) {
      const chart: ChartElement = {
        id: crypto.randomUUID() as ChartElement["id"],
        type: "chart",
        contentBlockIds: metrics.map((metric) => metric.id),
        kind: ctx.chartKind ?? "column",
        frame: frameFromNormalized(
          { x: chrome.content.x, y: contentTop + 0.02, width: chrome.content.width, height: chartHeight },
          page,
        ),
        rotationMilliDegree: 0,
        locked: false,
        style: {
          fontFamily: bodyFamily,
          fontSizePt: 12,
          textColor: ctx.colors.body,
          seriesColors: [ctx.colors.accent],
          showLegend: false,
          showValueLabels: true,
        },
      };
      elements.push(chart);
      return {
        elements,
        consumed: { title: true, body: bodyCovered, items: 0, blockIds: metrics.map((metric) => metric.id) },
        conflicts: [],
      };
    }

    const columns = metrics.length;
    const gap = 0.035;
    const columnWidth = (chrome.content.width - gap * (columns - 1)) / columns;
    const preferredValueSize = columns === 1 ? 84 : columns === 2 ? 68 : 56;
    const maximumValueSize = columns === 1 ? 96 : columns === 2 ? 80 : 72;
    const availableHeight = chrome.contentBottom - contentTop;
    if (availableHeight < 0.2) return conflict("metrics", "标题与指标之间没有足够的空间");

    // Measure the value and place the label under it. The old page pinned the
    // label to y = 0.73 while the value was top-aligned in a 0.27-high frame,
    // which left a 1.5in hole between a number and its own name.
    const measured = metrics.map((metric) => {
      const sampleFrame = frameFromNormalized(
        { x: 0, y: 0, width: columnWidth, height: Math.min(0.3, availableHeight * 0.55) },
        page,
      );
      const valueSize = fittedFontSizeInRange(
        metric.value,
        sampleFrame,
        preferredValueSize,
        28,
        maximumValueSize,
        headingFamily,
        lineHeight,
      );
      const valueHeight = pointsToNormalized(
        textHeightPt(metric.value, sampleFrame.width / 12_700, valueSize, headingFamily, lineHeight),
        page.height,
      );
      const labelFrame = frameFromNormalized(
        { x: 0, y: 0, width: columnWidth, height: Math.min(0.1, availableHeight * 0.2) },
        page,
      );
      const labelSize = fittedFontSizeInRange(
        metric.label,
        labelFrame,
        ctx.tokens.type.bodyPt,
        12,
        Math.max(ctx.tokens.type.bodyPt, 20),
        bodyFamily,
        lineHeight,
      );
      const labelHeight = pointsToNormalized(
        textHeightPt(metric.label, labelFrame.width / 12_700, labelSize, bodyFamily, lineHeight),
        page.height,
      );
      return { metric, valueSize, valueHeight, labelSize, labelHeight };
    });

    const groupHeight = Math.max(...measured.map((item) => item.valueHeight + LABEL_GAP + item.labelHeight));
    if (groupHeight + RULE_GAP > availableHeight) {
      return conflict("metrics", "指标组的高度超过内容区");
    }
    const groupTop = contentTop + (availableHeight - groupHeight) / 2;

    measured.forEach((item, index) => {
      const x = chrome.content.x + index * (columnWidth + gap);
      const ruleY = groupTop - RULE_GAP;
      elements.push(
        rectElement(
          frameFromNormalized({ x, y: ruleY, width: Math.min(0.1, columnWidth * 0.3), height: 0.006 }, page),
          ctx.colors.accent,
        ),
      );
      const valueFrame = frameFromNormalized(
        { x, y: groupTop, width: columnWidth, height: Math.max(0.03, item.valueHeight) },
        page,
      );
      elements.push(
        textElement(item.metric.value, valueFrame, item.valueSize, ctx.colors.accent, true, "left", headingFamily, {
          contentBlockRef: { blockId: item.metric.id, field: "value" },
          lineHeight,
        }),
      );
      elements.push(
        textElement(
          item.metric.label,
          frameFromNormalized(
            {
              x,
              y: groupTop + item.valueHeight + LABEL_GAP,
              width: columnWidth,
              height: Math.max(0.02, item.labelHeight),
            },
            page,
          ),
          item.labelSize,
          ctx.colors.body,
          false,
          "left",
          bodyFamily,
          { contentBlockRef: { blockId: item.metric.id, field: "label" }, lineHeight },
        ),
      );
    });

    return {
      elements,
      consumed: {
        title: true,
        body: bodyCovered,
        items: 0,
        blockIds: metrics.map((metric) => metric.id),
      },
      conflicts: [],
    };
  },
};
