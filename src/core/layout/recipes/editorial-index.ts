import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { readContentUnits } from "./content";
import { rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, frameFromNormalized, ruleHeight, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

const TITLE = { x: 0.07, y: 0.09, width: 0.86, height: 0.15 };
const LEAD = { x: 0.07, y: 0.3, width: 0.86, height: 0.1 };
const ACCENT_RULE = { x: 0.07, y: 0.265, width: 0.08, height: 0.006 };
const CONTENT_BOTTOM = 0.89;
const CONTENT_TOP_WITH_LEAD = 0.4;
const CONTENT_TOP_WITHOUT_LEAD = 0.34;
const MIN_ROW_HEIGHT = 0.075;

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
    if (options.hasArtwork || options.hasAsset) return false;
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
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleFrame = frameFromNormalized(TITLE, page);
    const titleSize = fittedFontSize(title, titleFrame, ctx.tokens.type.titlePt, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "标题在标题轴内放不下");
    }

    const colors = ctx.colors;
    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight,
      }),
      rectElement(frameFromNormalized(ACCENT_RULE, page), colors.accent),
    ];

    let contentTop = CONTENT_TOP_WITHOUT_LEAD;
    if (units.lead) {
      const leadFrame = frameFromNormalized(LEAD, page);
      const leadSize = fittedFontSize(units.lead, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(units.lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "正文引导段放不进标题与条目之间");
      }
      elements.push(
        textElement(units.lead, leadFrame, leadSize, colors.body, false, "left", bodyFamily, {
          contentRef: "body",
          lineHeight,
        }),
      );
      contentTop = CONTENT_TOP_WITH_LEAD;
    }

    const contentHeight = CONTENT_BOTTOM - contentTop;
    const rowHeight = contentHeight / units.items.length;
    if (rowHeight < MIN_ROW_HEIGHT) {
      return conflict("items", "条目行高低于 0.075，编号栏会挤成一团");
    }

    elements.push(verticalRule(0.07, contentTop, contentHeight, 0.006, page, colors.accent));
    const separatorHeight = ruleHeight(ctx.tokens.rule.hairlinePt, page.height);
    const itemSize = ctx.tokens.type.bodyPt;

    for (let index = 0; index < units.items.length; index += 1) {
      const item = units.items[index]!;
      const rowY = contentTop + index * rowHeight;
      const separatorY = rowY + rowHeight - separatorHeight / 2;
      elements.push(
        rectElement(frameFromNormalized({ x: 0.07, y: separatorY, width: 0.86, height: separatorHeight }, page), colors.rule),
      );

      const indexFrame = frameFromNormalized({ x: 0.09, y: rowY, width: 0.08, height: rowHeight }, page);
      const indexText = String(index + 1).padStart(2, "0");
      const indexSize = fittedFontSize(
        indexText,
        indexFrame,
        Math.min(24, Math.max(18, itemSize + 2)),
        14,
        headingFamily,
        lineHeight,
      );
      const indexHeight = pointsToNormalized(
        textHeightPt(indexText, indexFrame.width / 12_700, indexSize, headingFamily, lineHeight),
        page.height,
      );
      elements.push(
        textElement(
          indexText,
          {
            x: indexFrame.x,
            y: Math.round((rowY + (rowHeight - indexHeight) / 2) * page.height) as Emu,
            width: indexFrame.width,
            height: Math.max(1, Math.round((indexHeight + 0.006) * page.height)) as Emu,
          },
          indexSize,
          colors.accent,
          true,
          "center",
          headingFamily,
          { lineHeight },
        ),
      );

      const textFrame = frameFromNormalized(
        { x: 0.19, y: rowY + 0.012, width: 0.73, height: rowHeight - 0.024 },
        page,
      );
      const size = fittedFontSize(item, textFrame, itemSize, 12, bodyFamily, lineHeight);
      if (!textFits(item, textFrame, size, bodyFamily, lineHeight)) {
        return conflict("items", `第 ${index + 1} 条要点在编号栏里放不下`);
      }
      const itemHeight = pointsToNormalized(
        textHeightPt(item, textFrame.width / 12_700, size, bodyFamily, lineHeight),
        page.height,
      );
      elements.push(
        textElement(
          item,
          {
            x: textFrame.x,
            y: Math.round((rowY + (rowHeight - itemHeight) / 2) * page.height) as Emu,
            width: textFrame.width,
            height: Math.max(1, Math.round((itemHeight + 0.006) * page.height)) as Emu,
          },
          size,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "decorative", lineHeight },
        ),
      );
    }

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
