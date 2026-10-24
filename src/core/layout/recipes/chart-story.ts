import type { IntentConflict } from "../../commands/design-intent";
import type { ChartElement, ContentBlock, Emu } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits, textHeightPt } from "./measure";
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
    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleSize = fittedFontSize(title, titleFrame, ctx.tokens.type.titlePt, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "图表页标题放不下");
    }
    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, ctx.colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight,
      }),
    ];
    if (chrome.showRule) elements.push(rectElement(frameFromNormalized(chrome.rule, page), ctx.colors.accent));

    let contentTop = chrome.contentTop;
    const body = ctx.content.body.trim();
    if (body) {
      const leadFrame = frameFromNormalized(
        { x: chrome.content.x, y: contentTop, width: chrome.content.width * 0.72, height: 0.16 },
        page,
      );
      const leadSize = fittedFontSize(body, leadFrame, Math.min(ctx.tokens.type.bodyPt, 16), 12, bodyFamily, lineHeight);
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

    const chartHeight = Math.min((chrome.contentBottom - contentTop) * 0.86, 0.64);
    const chart: ChartElement = {
      id: crypto.randomUUID() as ChartElement["id"],
      type: "chart",
      contentBlockIds: [block.id],
      kind: block.kind,
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
      consumed: { title: true, body: true, items: 0, blockIds: [block.id] },
      conflicts: [],
    };
  },
};
