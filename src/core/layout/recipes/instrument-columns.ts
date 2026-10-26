import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { layoutRectToNormalized, normalizedToLayoutRect } from "../geometry/coordinate-system";
import { layoutColumns } from "../geometry/layout-functions";
import { readContentUnits } from "./content";
import { rectElement, textElement, verticalRule } from "./elements";
import {
  fittedFontSize,
  fittedFontSizeInRange,
  frameFromNormalized,
  ruleHeight,
  textFits,
  textHeightPt,
} from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

/**
 * The instrument direction's claim page.
 *
 * Three or four reviewed points used to be drawn as the editorial list again,
 * one under another, and the direction that promised "numbers and contrast own
 * the page" produced a page of paragraphs. Here each point becomes a panel of
 * the instrument grid: a hairline, an oversized index and the copy beneath it,
 * side by side. Nothing is added to the content — the index is the order the
 * reviewer already wrote down.
 */
const MIN_ITEMS = 2;
const MAX_ITEMS = 4;
/** A point longer than this is prose; it belongs to the column page. */
const MAX_ITEM_LENGTH = 30;
/** The index numeral is the page's visual anchor, not a label. */
const NUMERAL_LINE_HEIGHT = 1.02;
/** The numeral takes this share of the height the grid has, within bounds. */
const NUMERAL_SHARE = 0.16;
const MIN_NUMERAL_PT = 38;
const MAX_NUMERAL_PT = 72;
/** Air between the numeral and the copy under it, in page height. */
const NUMERAL_GAP = 0.03;
/** The closing rule sits this far below the last baseline, in page height. */
const CLOSING_GAP = 0.014;
const MIN_TEXT_PT = 13;
const MAX_TEXT_PT = 30;
/** The share of the leftover height that sits above the grid. */
const BALANCE_SHARE = 0.3;
/** A lead sentence sits between the title and the panel grid. */
const LEAD_GAP = 0.035;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const instrumentColumns: LayoutRecipe = {
  id: "instrument-columns",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("instrument-columns")) return false;
    if (options.hasAsset || options.hasArtwork || options.hasTemplate) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    if (facts.hasQuote || facts.hasComparison || facts.hasRowBlock) return false;
    return facts.itemCount >= MIN_ITEMS && facts.itemCount <= MAX_ITEMS && facts.longestItemLength <= MAX_ITEM_LENGTH;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "仪表页没有标题");
    const units = readContentUnits(ctx.content);
    if (units.items.length < MIN_ITEMS || units.items.length > MAX_ITEMS) {
      return conflict("items", `该页有 ${units.items.length} 条内容，仪表页只接受 ${MIN_ITEMS}–${MAX_ITEMS} 条`);
    }
    const longest = units.items.reduce((length, item) => Math.max(length, item.length), 0);
    if (longest > MAX_ITEM_LENGTH) return conflict("items", "要点太长，放不进仪表栏");
    if (!units.bodyCovered && !units.lead) {
      return conflict("body", "正文无法归入面板，也没有可绘制的引导段");
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
    // The direction is dramatic, so the title is allowed past the deck's own
    // title size when the frame can still carry it.
    const titleSize = fittedFontSizeInRange(
      title,
      titleFrame,
      ctx.tokens.type.titlePt,
      18,
      ctx.tokens.type.titlePt + 8,
      headingFamily,
      lineHeight,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "标题在标题轴内放不下");
    }

    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];
    if (chrome.showRule) {
      elements.push(rectElement(frameFromNormalized(chrome.rule, page), colors.accent));
    }

    let contentTop = chrome.contentTop;
    if (units.lead) {
      const leadFrame = frameFromNormalized(
        {
          x: chrome.content.x,
          y: contentTop,
          width: chrome.content.width * 0.82,
          height: Math.min(0.16, chrome.content.height * 0.25),
        },
        page,
      );
      const leadSize = fittedFontSize(
        units.lead,
        leadFrame,
        ctx.tokens.type.bodyPt,
        MIN_TEXT_PT,
        bodyFamily,
        lineHeight,
      );
      if (!textFits(units.lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "引导段在面板上方放不下");
      }
      const leadHeight = pointsToNormalized(
        textHeightPt(units.lead, leadFrame.width / 12_700, leadSize, bodyFamily, lineHeight),
        page.height,
      );
      elements.push(
        textElement(
          units.lead,
          { ...leadFrame, height: Math.round((leadHeight + 0.004) * page.height) as Emu },
          leadSize,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "body", lineHeight },
        ),
      );
      contentTop += leadHeight + LEAD_GAP;
    }

    const count = units.items.length;
    const columnSlots = layoutColumns(normalizedToLayoutRect(chrome.content), count, "md").map(layoutRectToNormalized);
    const columnWidth = Math.min(...columnSlots.map((slot) => slot.width));
    const tickHeight = Math.max(0.003, ruleHeight(ctx.tokens.rule.hairlinePt, page.height));
    const available = chrome.contentBottom - contentTop;
    if (available < 0.2) return conflict("items", "标题与面板之间没有足够的高度");
    // The numeral scales with the room the grid has: on a 16:9 page the board is
    // expected to fill the lower half, not to sit in a band at the top.
    const numeralPt = Math.min(
      MAX_NUMERAL_PT,
      Math.max(MIN_NUMERAL_PT, Math.round(available * pageHeightIn * 72 * NUMERAL_SHARE)),
    );
    const numeralHeight = pointsToNormalized(numeralPt * NUMERAL_LINE_HEIGHT, page.height);
    const widthPt = columnWidth * pageWidthIn * 72;

    // The whole grid shares one size, measured on its longest cell: a grid whose
    // cells shrink independently reads as a table of unrelated fragments.
    const tallest = (size: number) =>
      Math.max(...units.items.map((item) => textHeightPt(item, widthPt, size, bodyFamily, lineHeight)));
    const roomPt = available * pageHeightIn * 72 - (tickHeight + numeralHeight + NUMERAL_GAP) * pageHeightIn * 72;
    let textSize = Math.min(MAX_TEXT_PT, ctx.tokens.type.bodyPt + 6);
    while (textSize > MIN_TEXT_PT && tallest(textSize) > roomPt) textSize -= 1;
    if (tallest(textSize) > roomPt) return conflict("items", "面板里的要点放不下");

    // The panel block sits slightly above the centre of the region it was given:
    // a board that hugs the top leaves the page looking half-filled.
    const blockHeightPt = (tickHeight + numeralHeight + NUMERAL_GAP) * pageHeightIn * 72 + tallest(textSize);
    const balance = Math.max(0, available * pageHeightIn * 72 - blockHeightPt) * BALANCE_SHARE;
    const panelTop = contentTop + pointsToNormalized(balance, page.height);
    const textTop = panelTop + tickHeight + numeralHeight + NUMERAL_GAP;
    const textBottom =
      textTop +
      Math.max(
        ...units.items.map((item) =>
          pointsToNormalized(textHeightPt(item, widthPt, textSize, bodyFamily, lineHeight), page.height),
        ),
      );

    units.items.forEach((item, index) => {
      const slot = columnSlots[index]!;
      const x = slot.x;
      const slotWidth = slot.width;
      elements.push(
        rectElement(frameFromNormalized({ x, y: panelTop, width: slotWidth, height: tickHeight }, page), colors.accent),
      );
      elements.push(
        textElement(
          String(index + 1).padStart(2, "0"),
          frameFromNormalized({ x, y: panelTop + tickHeight, width: slotWidth, height: numeralHeight }, page),
          numeralPt,
          colors.accent,
          true,
          "left",
          headingFamily,
          { lineHeight: NUMERAL_LINE_HEIGHT },
        ),
      );
      elements.push(
        textElement(
          item,
          frameFromNormalized(
            {
              x,
              y: textTop,
              width: slotWidth,
              height: Math.max(0.02, textBottom - textTop),
            },
            page,
          ),
          textSize,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "decorative", lineHeight },
        ),
      );
      if (index > 0) {
        const previous = columnSlots[index - 1]!;
        const separatorX = (previous.x + previous.width + x) / 2;
        elements.push(
          verticalRule(
            separatorX,
            panelTop,
            Math.max(0.02, textBottom - panelTop + CLOSING_GAP),
            0.004,
            page,
            colors.rule,
          ),
        );
      }
    });

    // A closing hairline turns four floating columns into one board. Without it
    // the copy ended mid-page and the white space below read as a mistake. It
    // sits one gap below the last baseline so it cannot strike through it.
    elements.push(
      rectElement(
        frameFromNormalized(
          {
            x: chrome.content.x,
            y: Math.min(chrome.contentBottom, textBottom + CLOSING_GAP),
            width: chrome.content.width,
            height: tickHeight,
          },
          page,
        ),
        colors.rule,
      ),
    );

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
