import type { IntentConflict } from "../../commands/design-intent";
import { layoutFlow } from "../../rendering/flow";
import type { Emu } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { readContentUnits } from "./content";
import { rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, frameFromNormalized, headingMetrics, ruleHeight, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

/** The most air a row may take before the list stops reading as one block. */
const MAX_ROW_GAP_PT = 36;
/** The tightest a row may sit before the list turns into a paragraph. */
const MIN_ROW_GAP_PT = 8;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const editorialIndex: LayoutRecipe = {
  id: "editorial-index",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("editorial-index")) return false;
    if (options.hasAsset) return false;
    if (facts.hasQuote || facts.hasComparison || facts.hasRowBlock) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    return facts.itemCount >= 3 && facts.itemCount <= 6 && facts.shortItems;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "页面没有标题，不能使用编号栏配方");
    const units = readContentUnits(ctx.content);
    if (units.items.length < 3 || units.items.length > 6) {
      return conflict("items", `该页有 ${units.items.length} 条要点，编号栏只接受 3–6 条`);
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
    const colors = ctx.colors;
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
      return conflict("title", "标题在标题轴内放不下");
    }

    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];
    if (chrome.showRule) elements.push(rectElement(frameFromNormalized(chrome.rule, page), colors.accent));

    let contentTop = chrome.contentTop;
    if (units.lead) {
      const leadFrame = frameFromNormalized(
        {
          x: chrome.content.x,
          y: contentTop,
          width: chrome.content.width * 0.72,
          height: Math.min(0.14, chrome.content.height * 0.25),
        },
        page,
      );
      const leadSize = fittedFontSize(
        units.lead,
        leadFrame,
        Math.min(ctx.tokens.type.bodyPt, 16),
        12,
        bodyFamily,
        lineHeight,
      );
      if (!textFits(units.lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "正文引导段放不进标题与条目之间");
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
      contentTop = contentTop + leadHeight + 0.035;
    }

    const numberWidth = Math.min(0.07, chrome.content.width * 0.12);
    const textX = chrome.content.x + numberWidth + 0.03;
    const textWidth = Math.max(0.2, chrome.content.width - numberWidth - 0.03);
    const contentHeight = chrome.contentBottom - contentTop;
    if (contentHeight < 0.2) return conflict("items", "标题与条目之间没有足够的正文区");
    const sparse = units.items.length <= 4 && units.items.every((item) => item.length <= 18);
    // A three-point page in the body size of a dense page leaves the lower half
    // empty: the list is correct and the page looks unfinished. A sparse list
    // therefore gets larger type and a wider row gap, both bounded — the page
    // fills because the copy is allowed to take the room it has, not because
    // the rows were stretched to fixed slots.
    const preferred = sparse
      ? Math.min(32, Math.max(18, Math.round(ctx.tokens.type.bodyPt * 1.8)))
      : Math.min(22, ctx.tokens.type.bodyPt + 1);
    // The column is measured, not divided. A three-point page used to give each
    // 17pt line a 1.35in row because the content area was split into equal
    // slots; the leftover space is now a bounded gap, and the block keeps the
    // height its copy actually needs.
    const flow = layoutFlow({
      items: units.items,
      widthPt: textWidth * pageWidthIn * 72,
      availableHeightPt: contentHeight * pageHeightIn * 72,
      preferredFontSizePt: preferred,
      minimumFontSizePt: 14,
      minimumGapPt: MIN_ROW_GAP_PT,
      // A sparse list may take more air, but the row pitch stays under the
      // bound the layout test pins: the gap is bounded by the page, not by the
      // urge to fill it.
      maximumGapPt: sparse ? 44 : MAX_ROW_GAP_PT,
      verticalAlign: "center",
      lineHeightRatio: lineHeight,
      fontFamily: bodyFamily,
    });
    if (flow.overflow) return conflict("items", "条目在编号栏里放不下");

    const rowGap = pointsToNormalized(flow.gapPt, page.height);
    const firstRowTop = contentTop + pointsToNormalized(flow.rows[0]?.topPt ?? 0, page.height);
    const lastRow = flow.rows[flow.rows.length - 1];
    const lastRowBottom = lastRow
      ? firstRowTop + pointsToNormalized(lastRow.topPt - (flow.rows[0]?.topPt ?? 0) + lastRow.heightPt, page.height)
      : firstRowTop;
    elements.push(
      verticalRule(
        chrome.content.x,
        firstRowTop,
        Math.max(0.01, lastRowBottom - firstRowTop),
        0.004,
        page,
        colors.accent,
      ),
    );

    const separatorHeight = ruleHeight(ctx.tokens.rule.hairlinePt, page.height);
    const numberSize = Math.max(16, Math.min(22, Math.round(flow.fontSizePt * 1.05)));

    flow.rows.forEach((row, index) => {
      const rowY = firstRowTop + pointsToNormalized(row.topPt - (flow.rows[0]?.topPt ?? 0), page.height);
      const rowHeight = pointsToNormalized(row.heightPt, page.height);
      const numberHeight = pointsToNormalized(numberSize * lineHeight, page.height);
      const numberFrame = frameFromNormalized(
        {
          x: chrome.content.x + 0.015,
          y: Math.max(chrome.content.y, rowY + (rowHeight - numberHeight) / 2),
          width: numberWidth,
          height: Math.max(0.02, numberHeight),
        },
        page,
      );
      elements.push(
        textElement(
          String(index + 1).padStart(2, "0"),
          numberFrame,
          Math.min(
            numberSize,
            fittedFontSize(String(index + 1).padStart(2, "0"), numberFrame, numberSize, 14, headingFamily, lineHeight),
          ),
          colors.accent,
          true,
          "left",
          headingFamily,
          { lineHeight },
        ),
      );
      elements.push(
        textElement(
          row.text,
          frameFromNormalized({ x: textX, y: rowY, width: textWidth, height: Math.max(0.02, rowHeight) }, page),
          row.fontSizePt,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "decorative", lineHeight },
        ),
      );
      if (index < flow.rows.length - 1) {
        const separatorY = rowY + rowHeight + rowGap / 2;
        elements.push(
          rectElement(
            frameFromNormalized(
              { x: chrome.content.x, y: separatorY, width: chrome.content.width, height: separatorHeight },
              page,
            ),
            colors.rule,
          ),
        );
      }
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
