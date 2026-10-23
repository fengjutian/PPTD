import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { readContentUnits } from "./content";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

const TEXT = { x: 0.07, y: 0.1, width: 0.4, height: 0.78 };
const TITLE = { x: 0.07, y: 0.12, width: 0.4, height: 0.26 };
const RULE = { x: 0.07, y: 0.41, width: 0.12, height: 0.006 };
const ITEMS_TOP = 0.46;
const ITEMS_BOTTOM = 0.89;
const IMAGE = { x: 0.52, y: 0, width: 0.48, height: 1 };

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const imageLed: LayoutRecipe = {
  id: "image-led",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("image-led")) return false;
    if (!options.hasAsset || options.hasArtwork) return false;
    if (options.assetRole === "band") return false;
    if (facts.hasQuote || facts.hasComparison || facts.hasRowBlock) return false;
    if (facts.layout === "section" || facts.layout === "quote") return false;
    return facts.itemCount <= 4;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "图文页没有标题");
    const units = readContentUnits(ctx.content);
    if (units.items.length > 4) return conflict("items", "图文页最多承载 4 条要点");
    if (!units.bodyCovered && !units.lead) {
      return conflict("body", "正文无法归入图片旁的文字区");
    }

    const page = ctx.frame.page;
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const isCover = ctx.facts.layout === "cover";
    const titleFrame = frameFromNormalized(TITLE, page);
    const titleSize = fittedFontSize(
      title,
      titleFrame,
      isCover ? Math.max(ctx.tokens.type.displayPt, 40) : ctx.tokens.type.titlePt,
      18,
      headingFamily,
      lineHeight,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "图文页标题在图片旁放不下");
    }

    const elements: RecipePlan["elements"] = [
      rectElement(frameFromNormalized(RULE, page), ctx.colors.accent),
      textElement(title, titleFrame, titleSize, ctx.colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight,
      }),
    ];

    let itemTop = ITEMS_TOP;
    if (units.lead) {
      const leadFrame = frameFromNormalized({ x: TEXT.x, y: itemTop, width: TEXT.width, height: 0.13 }, page);
      const leadSize = fittedFontSize(units.lead, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(units.lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "图文页引导段放不下");
      }
      elements.push(
        textElement(units.lead, leadFrame, leadSize, ctx.colors.body, false, "left", bodyFamily, {
          contentRef: "body",
          lineHeight,
        }),
      );
      itemTop += 0.17;
    }

    const items = units.items;
    if (items.length > 0) {
      const area = ITEMS_BOTTOM - itemTop;
      const rowHeight = area / items.length;
      if (rowHeight < 0.07) return conflict("items", "图文页要点行高不足");
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        const frame = frameFromNormalized(
          { x: TEXT.x, y: itemTop + index * rowHeight + 0.01, width: TEXT.width, height: rowHeight - 0.02 },
          page,
        );
        const size = fittedFontSize(item, frame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
        if (!textFits(item, frame, size, bodyFamily, lineHeight)) {
          return conflict("items", `图文页第 ${index + 1} 条要点放不下`);
        }
        const height = pointsToNormalized(
          textHeightPt(item, frame.width / 12_700, size, bodyFamily, lineHeight),
          page.height,
        );
        elements.push(
          textElement(
            item,
            {
              x: frame.x,
              y: Math.round((itemTop + index * rowHeight + (rowHeight - height) / 2) * page.height) as Emu,
              width: frame.width,
              height: Math.max(1, Math.round((height + 0.006) * page.height)) as Emu,
            },
            size,
            ctx.colors.body,
            false,
            "left",
            bodyFamily,
            { contentRef: "decorative", lineHeight },
          ),
        );
      }
    } else if (units.body) {
      const bodyFrame = frameFromNormalized(
        { x: TEXT.x, y: itemTop, width: TEXT.width, height: ITEMS_BOTTOM - itemTop },
        page,
      );
      const size = fittedFontSize(units.body, bodyFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(units.body, bodyFrame, size, bodyFamily, lineHeight)) {
        return conflict("body", "图文页正文放不下");
      }
      elements.push(
        textElement(units.body, bodyFrame, size, ctx.colors.body, false, "left", bodyFamily, {
          contentRef: "body",
          lineHeight,
        }),
      );
    }

    return {
      elements,
      consumed: {
        title: true,
        body: units.bodyCovered || Boolean(units.lead) || items.length === 0,
        items: items.length,
        blockIds: units.blockIds,
      },
      conflicts: [],
      imageFrame: IMAGE,
    };
  },
};
