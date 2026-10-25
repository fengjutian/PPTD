import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { layoutFlow } from "../../rendering/flow";
import { resolveChrome } from "../page-chrome";
import { readContentUnits } from "./content";
import { rectElement, textElement } from "./elements";
import {
  fittedFontSize,
  fittedFontSizeWithoutOrphan,
  frameFromNormalized,
  textFits,
  textHeightPt,
} from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

/** The picture column, as a share of the content width. */
const PICTURE_SHARE = 0.42;
/** The air between the picture column and the copy column. */
const COLUMN_GAP = 0.055;
/** A copy column narrower than this cannot carry a headline. */
const MIN_TEXT_WIDTH = 0.3;
/** The padding between the headline and the tinted band behind it. */
const BAND_PADDING = 0.018;
/** Five points is one page; six is a list and belongs to another recipe. */
const MAX_ITEMS = 5;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

/**
 * Two facing columns: a picture plate on one side, a measured copy column on
 * the other.
 *
 * `image-led` gives the picture the page edge and keeps the copy in a narrow
 * column beside it. This recipe is the opposite bet: both columns are inset by
 * the page margin, the picture is a framed plate rather than a bleed, and the
 * headline sits on a tinted band (`accentSubtle`) with a hairline separating the
 * columns. The result reads as an opened spread instead of a slide with a photo
 * on it, which is what a deck of ten `image-led` pages was missing.
 *
 * The band is drawn before the headline, so the ink sits on top of it: a tint
 * that is only 12% accent keeps body ink readable, and the band is small enough
 * that it cannot become the page's background.
 */
export const sideImageText: LayoutRecipe = {
  id: "side-image-text",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("side-image-text")) return false;
    if (!options.hasAsset) return false;
    if (options.hasArtwork && !options.hasTemplateImage) return false;
    // A band picture is a wide strip. Cropping it into a tall column would
    // throw away most of the frame the picture was generated for.
    if (options.assetRole === "band") return false;
    if (facts.hasRowBlock || facts.hasComparison || facts.hasQuote) return false;
    if (facts.layout === "quote") return false;
    return facts.itemCount <= MAX_ITEMS;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "对开图文页没有标题");
    const units = readContentUnits(ctx.content);
    if (units.items.length > MAX_ITEMS) {
      return conflict("items", `对开图文页最多承载 ${MAX_ITEMS} 条要点`);
    }
    if (!units.bodyCovered && !units.lead) {
      return conflict("body", "正文无法归入图片旁的文字栏");
    }

    const page = ctx.frame.page;
    const pageWidthIn = page.width / 914_400;
    const pageHeightIn = page.height / 914_400;
    const chrome = resolveChrome(ctx);
    const displayFamily = ctx.tokens.fonts.display;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const isCover = ctx.facts.layout === "cover";
    const area = chrome.content;
    const pictureWidth = Math.max(0.24, area.width * PICTURE_SHARE);
    const textWidth = area.width - pictureWidth - COLUMN_GAP;
    if (textWidth < MIN_TEXT_WIDTH) return conflict("title", "对开图文页的文字栏太窄");
    // A `left` variant puts the picture on the left and the copy on the right,
    // so two picture pages in a row do not mirror the same side.
    const pictureLeft = ctx.variant === "left";
    const pictureX = pictureLeft ? area.x : area.x + area.width - pictureWidth;
    const textX = pictureLeft ? area.x + pictureWidth + COLUMN_GAP : area.x;
    const separatorX = pictureLeft ? pictureX + pictureWidth + COLUMN_GAP / 2 : pictureX - COLUMN_GAP / 2;

    // The headline is fitted against the copy column and the band is drawn
    // around the result: a band sized first would clip a long title.
    const titleProbe = frameFromNormalized(
      { x: textX, y: area.y, width: textWidth, height: Math.max(0.16, Math.min(0.34, area.height * 0.44)) },
      page,
    );
    const titleSize = (isCover ? fittedFontSizeWithoutOrphan : fittedFontSize)(
      title,
      titleProbe,
      isCover ? Math.max(ctx.tokens.type.displayPt, 40) : ctx.tokens.type.titlePt,
      18,
      displayFamily,
      lineHeight,
    );
    if (!textFits(title, titleProbe, titleSize, displayFamily, lineHeight)) {
      return conflict("title", "对开图文页的标题放不下");
    }
    const titleHeight = pointsToNormalized(
      textHeightPt(title, textWidth * pageWidthIn * 72, titleSize, displayFamily, titleLineHeight),
      page.height,
    );
    const bandTop = area.y;
    const bandHeight = titleHeight + BAND_PADDING * 2;

    const elements: RecipePlan["elements"] = [
      rectElement(
        frameFromNormalized({ x: textX, y: bandTop, width: textWidth, height: bandHeight }, page),
        ctx.colors.accentSubtle,
      ),
      rectElement(
        frameFromNormalized(
          // 0.75pt expressed as a share of the page width: a column separator is
          // a hairline, not a 2px border, and the export writes points anyway.
          { x: separatorX, y: area.y, width: 0.75 / 72 / pageWidthIn, height: area.height },
          page,
        ),
        ctx.colors.border,
      ),
      textElement(
        title,
        frameFromNormalized(
          { x: textX, y: bandTop + BAND_PADDING, width: textWidth, height: titleHeight + 0.004 },
          page,
        ),
        titleSize,
        ctx.colors.title,
        true,
        "left",
        displayFamily,
        { contentRef: "title", lineHeight: titleLineHeight },
      ),
    ];

    let cursor = bandTop + bandHeight + 0.03;
    if (units.lead) {
      const leadHeight = pointsToNormalized(
        textHeightPt(units.lead, textWidth * pageWidthIn * 72, ctx.tokens.type.bodyPt, bodyFamily, lineHeight),
        page.height,
      );
      const leadFrame = frameFromNormalized(
        { x: textX, y: cursor, width: textWidth, height: leadHeight + 0.004 },
        page,
      );
      const leadSize = fittedFontSize(units.lead, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(units.lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "对开图文页的引导段放不下");
      }
      elements.push(
        textElement(units.lead, leadFrame, leadSize, ctx.colors.body, false, "left", bodyFamily, {
          contentRef: "body",
          lineHeight,
        }),
      );
      cursor += leadHeight + 0.03;
    }

    const items = units.items;
    if (items.length > 0) {
      const availableHeight = area.y + area.height - cursor;
      if (availableHeight < 0.07) return conflict("items", "对开图文页的要点行高不足");
      const flow = layoutFlow({
        items,
        widthPt: textWidth * pageWidthIn * 72,
        availableHeightPt: availableHeight * pageHeightIn * 72,
        preferredFontSizePt: ctx.tokens.type.bodyPt + 2,
        minimumFontSizePt: 12,
        minimumGapPt: 10,
        maximumGapPt: 26,
        verticalAlign: "top",
        lineHeightRatio: lineHeight,
        fontFamily: bodyFamily,
      });
      if (flow.overflow) return conflict("items", "对开图文页的要点在文字栏里放不下");
      flow.rows.forEach((row) => {
        elements.push(
          textElement(
            row.text,
            frameFromNormalized(
              {
                x: textX,
                y: cursor + pointsToNormalized(row.topPt, page.height),
                width: textWidth,
                height: pointsToNormalized(row.heightPt, page.height),
              },
              page,
            ),
            row.fontSizePt,
            ctx.colors.body,
            false,
            "left",
            bodyFamily,
            { contentRef: "decorative", lineHeight },
          ),
        );
      });
    } else if (units.body) {
      const bodyFrame = frameFromNormalized(
        { x: textX, y: cursor, width: textWidth, height: Math.max(0.06, area.y + area.height - cursor) },
        page,
      );
      const size = fittedFontSize(units.body, bodyFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(units.body, bodyFrame, size, bodyFamily, lineHeight)) {
        return conflict("body", "对开图文页的正文放不下");
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
      imageFrame: ctx.templateImage ?? {
        x: pictureX,
        y: area.y,
        width: pictureWidth,
        height: area.height,
      },
    };
  },
};
