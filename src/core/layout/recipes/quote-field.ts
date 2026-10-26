import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock, Emu } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement, verticalRule } from "./elements";
import {
  fittedFontSize,
  fittedFontSizeInRange,
  frameFromNormalized,
  headingMetrics,
  textFits,
  textHeightPt,
} from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type QuoteBlock = Extract<ContentBlock, { type: "quote" }>;

const MARK_SIZE_PT = 72;
const QUOTE_SIZE_PT = 36;
const QUOTE_MIN_SIZE_PT = 24;
const QUOTE_MAX_SIZE_PT = 44;
const ATTRIBUTION_SIZE_PT = 16;
const TITLE_SIZE_PT = 24;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

function comparable(value: string): string {
  return value.replace(/[\s，。；、,.!?！？：:；;"'“”‘’「」『』]/g, "");
}

export const quoteField: LayoutRecipe = {
  id: "quote-field",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("quote-field")) return false;
    if (options.hasAsset) return false;
    if (!facts.hasQuote) return false;
    if (facts.layout !== "quote") return false;
    return true;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "引文页没有标题");
    const block = ctx.content.blocks?.find((candidate): candidate is QuoteBlock => candidate.type === "quote");
    if (!block) return conflict("quote", "该页没有 quote 内容块");
    const quote = block.text.trim();
    if (!quote) return conflict("quote", "引文内容为空");
    const attribution = block.attribution?.trim();

    const page = ctx.frame.page;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const colors = ctx.colors;

    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleMetrics = headingMetrics(ctx.tokens.type.titleTrackingPt);
    const titleSize = fittedFontSize(
      title,
      titleFrame,
      Math.min(ctx.tokens.type.titlePt, TITLE_SIZE_PT),
      16,
      headingFamily,
      lineHeight,
      titleMetrics,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight, titleMetrics)) {
      return conflict("title", "引文页标题放不下");
    }
    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];
    if (chrome.showRule) elements.push(rectElement(frameFromNormalized(chrome.rule, page), colors.accent));

    let contentTop = chrome.contentTop;
    const body = ctx.content.body.trim();
    const bodyRepresented = !body || comparable(body).includes(comparable(quote));
    if (body && !bodyRepresented) {
      const leadFrame = frameFromNormalized(
        {
          x: chrome.content.x,
          y: contentTop,
          width: chrome.content.width,
          height: Math.min(0.1, chrome.content.height * 0.18),
        },
        page,
      );
      const leadSize = fittedFontSize(body, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(body, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "引文页引导段放不下");
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
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "body", lineHeight },
        ),
      );
      contentTop = contentTop + leadHeight + 0.03;
    }

    const contentHeight = chrome.contentBottom - contentTop;
    if (contentHeight < 0.3) return conflict("quote", "引文页没有足够的内容区");
    const quoteWidth = Math.min(chrome.content.width * 0.72, chrome.content.width - 0.15);
    const quoteX = chrome.content.x + 0.1;
    const markHeight = pointsToNormalized(MARK_SIZE_PT * lineHeight, page.height);
    const quoteBox = frameFromNormalized(
      { x: quoteX, y: contentTop, width: quoteWidth, height: contentHeight - markHeight - 0.08 },
      page,
    );
    const quoteSize = fittedFontSizeInRange(
      quote,
      quoteBox,
      QUOTE_SIZE_PT,
      QUOTE_MIN_SIZE_PT,
      QUOTE_MAX_SIZE_PT,
      headingFamily,
      lineHeight,
    );
    if (!textFits(quote, quoteBox, quoteSize, headingFamily, lineHeight)) {
      return conflict("quote", "引文在引文框里放不下");
    }
    const quoteHeight = pointsToNormalized(
      textHeightPt(quote, quoteBox.width / 12_700, quoteSize, headingFamily, lineHeight),
      page.height,
    );
    const attributionHeight = attribution ? pointsToNormalized(ATTRIBUTION_SIZE_PT * lineHeight, page.height) : 0;
    const groupHeight = markHeight + 0.02 + quoteHeight + (attribution ? 0.03 + attributionHeight : 0);
    if (groupHeight > contentHeight) return conflict("quote", "引文组超过内容区");
    const groupTop = contentTop + (contentHeight - groupHeight) / 2;
    elements.push(verticalRule(chrome.content.x + 0.02, groupTop, groupHeight, 0.006, page, colors.accent));
    elements.push(
      textElement(
        "“",
        frameFromNormalized({ x: chrome.content.x + 0.055, y: groupTop, width: 0.12, height: markHeight }, page),
        MARK_SIZE_PT,
        colors.accent,
        true,
        "left",
        "Georgia",
        { lineHeight },
      ),
    );
    elements.push(
      textElement(
        quote,
        frameFromNormalized(
          { x: quoteX, y: groupTop + markHeight + 0.02, width: quoteWidth, height: quoteHeight },
          page,
        ),
        quoteSize,
        colors.title,
        false,
        "left",
        headingFamily,
        { contentRef: "body", lineHeight },
      ),
    );
    if (attribution) {
      elements.push(
        textElement(
          `— ${attribution}`,
          frameFromNormalized(
            {
              x: quoteX,
              y: groupTop + markHeight + 0.02 + quoteHeight + 0.03,
              width: quoteWidth,
              height: attributionHeight,
            },
            page,
          ),
          ATTRIBUTION_SIZE_PT,
          colors.body,
          false,
          "left",
          bodyFamily,
          { lineHeight },
        ),
      );
    }

    return {
      elements,
      consumed: {
        title: true,
        body: true,
        items: 0,
        blockIds: [block.id],
      },
      conflicts: [],
    };
  },
};
