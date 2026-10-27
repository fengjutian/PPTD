import type { IntentConflict } from "../../commands/design-intent";
import type { ChartElement, ContentBlock, Emu } from "../../document-model";
import { chartSeriesColors } from "../../design/chart-theme";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, frameFromNormalized, headingMetrics, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type ChartBlock = Extract<ContentBlock, { type: "chart" }>;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const chartStory: LayoutRecipe = {
  id: "chart-story",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("chart-story")) return false;
    if (options.hasAsset) return false;
    if (!facts.hasChart) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    return true;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "图表页没有标题");
    const block = ctx.content.blocks?.find((candidate): candidate is ChartBlock => candidate.type === "chart");
    if (!block) return conflict("chart", "该页没有 chart 内容块");

    const page = ctx.frame.page;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleMetrics = headingMetrics(ctx.tokens.type.titleTrackingPt);
    const titleSize = fittedFontSize(
      title,
      titleFrame,
      ctx.tokens.type.titlePt,
      18,
      headingFamily,
      lineHeight,
      titleMetrics,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight, titleMetrics)) {
      return conflict("title", "图表页标题放不下");
    }
    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, ctx.colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];
    if (chrome.showRule) elements.push(rectElement(frameFromNormalized(chrome.rule, page), ctx.colors.accent));

    let contentTop = chrome.contentTop;
    const body = ctx.content.body.trim();
    // A chart page reads better as "evidence + conclusion": the chart keeps the
    // left two thirds and the reviewed takeaway sits in a narrow right column.
    // When the sentence cannot fit there, it falls back to the old lead above.
    let chartWidth = chrome.content.width;
    if (body) {
      const columnGap = 0.035;
      const chartShare = 0.62;
      const takeawayX = chrome.content.x + chrome.content.width * chartShare + columnGap;
      const takeawayWidth = chrome.content.width * (1 - chartShare) - columnGap;
      const takeawayTop = contentTop + 0.07;
      const takeawayFrame = frameFromNormalized(
        { x: takeawayX, y: takeawayTop, width: takeawayWidth, height: chrome.contentBottom - takeawayTop },
        page,
      );
      const takeawaySize = fittedFontSize(
        body,
        takeawayFrame,
        Math.min(22, ctx.tokens.type.bodyPt + 4),
        13,
        bodyFamily,
        lineHeight,
      );
      if (textFits(body, takeawayFrame, takeawaySize, bodyFamily, lineHeight)) {
        chartWidth = chrome.content.width * chartShare;
        elements.push(
          rectElement(
            frameFromNormalized({ x: takeawayX, y: contentTop + 0.02, width: 0.08, height: 0.005 }, page),
            ctx.colors.accent,
          ),
        );
        elements.push(
          textElement(body, takeawayFrame, takeawaySize, ctx.colors.title, true, "left", bodyFamily, {
            contentRef: "body",
            lineHeight,
          }),
        );
      } else {
        const leadFrame = frameFromNormalized(
          { x: chrome.content.x, y: contentTop, width: chrome.content.width * 0.72, height: 0.16 },
          page,
        );
        const leadSize = fittedFontSize(
          body,
          leadFrame,
          Math.min(ctx.tokens.type.bodyPt, 16),
          12,
          bodyFamily,
          lineHeight,
        );
        if (!textFits(body, leadFrame, leadSize, bodyFamily, lineHeight)) {
          return conflict("body", "图表页说明放不下");
        }
        const leadHeight = pointsToNormalized(
          textHeightPt(body, leadFrame.width / 12_700, leadSize, bodyFamily, lineHeight),
          page.height,
        );
        elements.push(
          textElement(
            body,
            { ...leadFrame, height: Math.round((leadHeight + 0.004) * page.height) as Emu },
            leadSize,
            ctx.colors.body,
            false,
            "left",
            bodyFamily,
            { contentRef: "body", lineHeight },
          ),
        );
        contentTop += leadHeight + 0.03;
      }
    }

    const chartHeight = Math.min((chrome.contentBottom - contentTop) * 0.95, 0.72);
    const chart: ChartElement = {
      id: crypto.randomUUID() as ChartElement["id"],
      type: "chart",
      contentBlockIds: [block.id],
      // The reviewed block owns the values; the design plan may choose the
      // editable chart form that best communicates their relationship.
      kind: ctx.chartKind ?? block.kind,
      frame: frameFromNormalized(
        { x: chrome.content.x, y: contentTop + 0.02, width: chartWidth, height: chartHeight },
        page,
      ),
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: bodyFamily,
        fontSizePt: 12,
        textColor: ctx.colors.body,
        seriesColors: chartSeriesColors(ctx.colors, Math.max(1, block.series?.length ?? 1)),
        showLegend: (block.series?.length ?? 0) > 1,
        showValueLabels: true,
      },
    };
    elements.push(chart);

    return {
      elements,
      consumed: { title: true, body: true, items: 0, blockIds: [block.id] },
      conflicts: [],
    };
  },
};
