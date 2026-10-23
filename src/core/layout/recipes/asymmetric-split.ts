import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { readContentUnits } from "./content";
import { rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan, NormalizedFrame } from "./types";

const TITLE = { x: 0.07, y: 0.09, width: 0.29, height: 0.26 };
const TITLE_RULE = { x: 0.07, y: 0.38, width: 0.12, height: 0.006 };
const PAGE_NUMBER = { x: 0.07, y: 0.82, width: 0.1, height: 0.05 };
const DIVIDER = { x: 0.39, y: 0.09, width: 0.0014, height: 0.81 };
const LEAD = { x: 0.44, y: 0.11, width: 0.49, height: 0.12 };
const CONTENT_BOTTOM = 0.89;
const MIN_ROW_HEIGHT = 0.1;

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
    if (options.hasArtwork || options.hasAsset) return false;
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
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const mirrored = ctx.variant === "right";
    const place = (rect: NormalizedFrame): NormalizedFrame =>
      mirrored ? { ...rect, x: 1 - rect.x - rect.width } : rect;

    const titleFrame = frameFromNormalized(place(TITLE), page);
    const preferredTitle = ctx.focal === "title" ? Math.round(ctx.tokens.type.titlePt * 1.1) : ctx.tokens.type.titlePt;
    const titleSize = fittedFontSize(title, titleFrame, preferredTitle, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "标题在左栏放不下");
    }

    const colors = ctx.colors;
    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight,
      }),
      rectElement(frameFromNormalized(place(TITLE_RULE), page), colors.accent),
      verticalRule(
        place(DIVIDER).x,
        DIVIDER.y,
        DIVIDER.height,
        DIVIDER.width,
        page,
        colors.rule,
      ),
    ];

    const pageNumber = String(ctx.page.index + 1).padStart(2, "0");
    const pageNumberFrame = frameFromNormalized(place(PAGE_NUMBER), page);
    const pageNumberSize =
      ctx.focal === "index"
        ? fittedFontSize(pageNumber, pageNumberFrame, 24, 12, headingFamily, lineHeight)
        : fittedFontSize(pageNumber, pageNumberFrame, ctx.tokens.type.captionPt, 9, headingFamily, lineHeight);
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

    let contentTop = 0.11;
    if (units.lead) {
      const leadFrame = frameFromNormalized(place(LEAD), page);
      const leadSize = fittedFontSize(units.lead, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(units.lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "正文引导段放不进右栏");
      }
      elements.push(
        textElement(units.lead, leadFrame, leadSize, colors.body, false, "left", bodyFamily, {
          contentRef: "body",
          lineHeight,
        }),
      );
      const leadHeight = pointsToNormalized(
        textHeightPt(units.lead, leadFrame.width / 12_700, leadSize, bodyFamily, lineHeight),
        page.height,
      );
      contentTop = 0.11 + leadHeight + 0.03;
    }

    const contentHeight = CONTENT_BOTTOM - contentTop;
    const rowHeight = contentHeight / units.items.length;
    if (rowHeight < MIN_ROW_HEIGHT) {
      return conflict("items", "非对称分栏的条目行高低于 0.1，正文会挤成一团");
    }

    const itemBaseSize =
      ctx.focal === "body" ? Math.min(22, ctx.tokens.type.bodyPt + 2) : ctx.tokens.type.bodyPt;
    for (let index = 0; index < units.items.length; index += 1) {
      const item = units.items[index]!;
      const rowY = contentTop + index * rowHeight;
      const textFrame = frameFromNormalized(
        place({ x: 0.47, y: rowY + 0.015, width: 0.46, height: rowHeight - 0.03 }),
        page,
      );
      const size = fittedFontSize(item, textFrame, itemBaseSize, 12, bodyFamily, lineHeight);
      if (!textFits(item, textFrame, size, bodyFamily, lineHeight)) {
        return conflict("items", `第 ${index + 1} 条要点在右栏放不下`);
      }
      const itemHeight = pointsToNormalized(
        textHeightPt(item, textFrame.width / 12_700, size, bodyFamily, lineHeight),
        page.height,
      );
      const barHeight = Math.min(0.08, rowHeight * 0.5);
      elements.push(
        rectElement(
          frameFromNormalized(
            place({ x: 0.44, y: rowY + (rowHeight - barHeight) / 2, width: 0.006, height: barHeight }),
            page,
          ),
          colors.accent,
        ),
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
