import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { layoutFlow } from "../../rendering/flow";
import { resolveChrome } from "../page-chrome";
import { readContentUnits } from "./content";
import { rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan, NormalizedFrame } from "./types";

const TITLE_WIDTH = 0.29;
const DIVIDER_X = 0.39;
const CONTENT_X = 0.44;
const CONTENT_WIDTH = 0.49;
const PAGE_NUMBER_HEIGHT = 0.05;
const MIN_ROW_GAP_PT = 10;
const MAX_ROW_GAP_PT = 24;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const asymmetricSplit: LayoutRecipe = {
  id: "asymmetric-split",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("asymmetric-split")) return false;
    if (options.hasAsset) return false;
    if (facts.hasQuote || facts.hasComparison || facts.hasRowBlock) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    return facts.itemCount >= 2 && facts.itemCount <= 5 && facts.longestItemLength <= 48;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "页面没有标题，不能使用非对称分栏");
    const units = readContentUnits(ctx.content);
    if (units.items.length < 2 || units.items.length > 5) {
      return conflict("items", `该页有 ${units.items.length} 条要点，非对称分栏只接受 2–5 条`);
    }
    if (!units.bodyCovered && !units.lead) {
      return conflict("body", "正文无法归入条目，也没有可绘制的引导段");
    }

    const page = ctx.frame.page;
    const pageHeightIn = page.height / 914_400;
    const pageWidthIn = page.width / 914_400;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const mirrored = ctx.variant === "right";
    const place = (rect: NormalizedFrame): NormalizedFrame =>
      mirrored ? { ...rect, x: 1 - rect.x - rect.width } : rect;

    const titleFrameNormalized = place({
      x: chrome.title.x,
      y: chrome.title.y,
      width: Math.min(TITLE_WIDTH, chrome.title.width),
      height: Math.max(0.16, chrome.title.height),
    });
    const titleFrame = frameFromNormalized(titleFrameNormalized, page);
    const preferredTitle = ctx.focal === "title" ? Math.round(ctx.tokens.type.titlePt * 1.1) : ctx.tokens.type.titlePt;
    const titleSize = fittedFontSize(title, titleFrame, preferredTitle, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "标题在左栏放不下");
    }

    const colors = ctx.colors;
    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];
    if (chrome.showRule)
      elements.push(
        rectElement(
          frameFromNormalized(
            place({ x: chrome.rule.x, y: chrome.rule.y, width: 0.12, height: chrome.rule.height }),
            page,
          ),
          colors.accent,
        ),
      );
    const dividerX = mirrored ? 1 - DIVIDER_X : DIVIDER_X;
    elements.push(
      verticalRule(dividerX, chrome.contentTop, chrome.contentBottom - chrome.contentTop, 0.0014, page, colors.rule),
    );

    const pageNumber = String(ctx.page.index + 1).padStart(2, "0");
    const pageNumberFrame = frameFromNormalized(
      place({
        x: chrome.content.x,
        y: Math.max(chrome.contentTop, chrome.contentBottom - PAGE_NUMBER_HEIGHT),
        width: 0.1,
        height: PAGE_NUMBER_HEIGHT,
      }),
      page,
    );
    const pageNumberSize = ctx.focal === "index" ? 24 : ctx.tokens.type.captionPt;
    elements.push(
      textElement(
        pageNumber,
        pageNumberFrame,
        pageNumberSize,
        ctx.focal === "index" ? colors.accent : colors.body,
        ctx.focal === "index",
        "left",
        headingFamily,
        { lineHeight },
      ),
    );

    let contentTop = chrome.contentTop;
    if (units.lead) {
      const leadFrame = frameFromNormalized(
        place({
          x: CONTENT_X,
          y: contentTop,
          width: CONTENT_WIDTH,
          height: Math.min(0.12, chrome.content.height * 0.22),
        }),
        page,
      );
      const leadSize = fittedFontSize(units.lead, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(units.lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "正文引导段放不进右栏");
      }
      const leadHeight = pointsToNormalized(
        textHeightPt(units.lead, leadFrame.width / 12_700, leadSize, bodyFamily, lineHeight),
        page.height,
      );
      elements.push(
        textElement(
          units.lead,
          {
            ...leadFrame,
            height: Math.round((leadHeight + 0.004) * page.height) as Emu,
          },
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

    const availableHeight = chrome.contentBottom - contentTop;
    if (availableHeight < 0.2) return conflict("items", "右栏没有足够的正文区");
    const preferred = ctx.focal === "body" ? ctx.tokens.type.bodyPt + 4 : ctx.tokens.type.bodyPt + 2;
    const flow = layoutFlow({
      items: units.items,
      widthPt: (CONTENT_WIDTH - 0.02) * pageWidthIn * 72,
      availableHeightPt: availableHeight * pageHeightIn * 72,
      preferredFontSizePt: Math.min(24, preferred),
      minimumFontSizePt: 12,
      minimumGapPt: MIN_ROW_GAP_PT,
      maximumGapPt: MAX_ROW_GAP_PT,
      verticalAlign: "top",
      lineHeightRatio: lineHeight,
      fontFamily: bodyFamily,
    });
    if (flow.overflow) return conflict("items", "右栏条目放不下");

    flow.rows.forEach((row, index) => {
      const rowY = contentTop + pointsToNormalized(row.topPt, page.height);
      const rowHeight = pointsToNormalized(row.heightPt, page.height);
      const markerHeight = Math.min(0.05, rowHeight * 0.5);
      elements.push(
        rectElement(
          frameFromNormalized(
            place({
              x: CONTENT_X,
              y: rowY + (rowHeight - markerHeight) / 2,
              width: 0.004,
              height: markerHeight,
            }),
            page,
          ),
          colors.accent,
        ),
      );
      elements.push(
        textElement(
          units.items[index]!,
          frameFromNormalized(
            place({ x: CONTENT_X + 0.03, y: rowY, width: CONTENT_WIDTH - 0.03, height: Math.max(0.02, rowHeight) }),
            page,
          ),
          row.fontSizePt,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "decorative", lineHeight },
        ),
      );
    });

    return {
      elements,
      consumed: {
        title: true,
        body: units.bodyCovered || Boolean(units.lead),
        items: units.items.length,
        blockIds: units.blockIds,
      },
      conflicts: [],
    };
  },
};
