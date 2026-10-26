import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { layoutFlow } from "../../rendering/flow";
import { resolveChrome } from "../page-chrome";
import { readContentUnits } from "./content";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, fittedFontSizeWithoutOrphan, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

/** The picture plate, as a share of the content width. */
const PICTURE_SHARE = 0.42;
/** The air between the picture plate and the copy column. */
const COLUMN_GAP = 0.055;
/** A copy column narrower than this cannot carry a headline. */
const MIN_TEXT_WIDTH = 0.18;
/** The padding between the headline and the tinted band behind it. */
const BAND_PADDING = 0.016;
/** Five points is one page; six is a list and belongs to another recipe. */
const MAX_ITEMS = 5;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

/**
 * Two facing columns under the shared header: a picture plate and a copy column.
 *
 * `image-led` gives the picture the page edge — it bleeds off the top, the side
 * and the bottom — and keeps the copy in a narrow column beside it. This recipe
 * is the opposite bet: the picture is an inset plate that starts below the
 * header and keeps the page margin, the copy column faces it across a hairline,
 * and the headline sits on a tinted band (`accentSubtle`) on the *shared* title
 * axis. So a deck of picture pages alternates between "the photo is the page"
 * and "the photo is a plate on the page" without either of them losing the
 * header rhythm of the other content pages (ADR 0063).
 *
 * The band is a 12% accent tint, drawn before the headline so the ink sits on
 * top of it. It is deliberately small: a tint that covered the column would be
 * a page background, and body ink on it would no longer be the page's body ink.
 */
export const sideImageText: LayoutRecipe = {
  id: "side-image-text",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("side-image-text")) return false;
    if (!options.hasAsset) return false;
    if (options.hasArtwork && !options.hasTemplateImage) return false;
    // A band picture is a wide strip. Cropping it into a tall plate would throw
    // away most of the frame the picture was generated for.
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
    // A template page already states where its picture and its body go. Laying
    // a calculated plate over those regions is how the recipe used to refuse a
    // page whose body placeholder was narrower than the plate it wanted; the
    // template's own geometry is the composition, so it is used as given.
    const templateImage = ctx.templateImage;
    // On a narrow body placeholder the plate gives way to the copy instead of
    // the page being refused: the two columns are still columns, just smaller.
    const preferredPicture = Math.max(0.2, area.width * PICTURE_SHARE);
    const textWidth = templateImage ? area.width : Math.max(MIN_TEXT_WIDTH, area.width - preferredPicture - COLUMN_GAP);
    const pictureWidth = templateImage ? templateImage.width : Math.max(0.16, area.width - textWidth - COLUMN_GAP);
    if (textWidth < MIN_TEXT_WIDTH) return conflict("title", "对开图文页的文字栏太窄");
    // A `left` variant puts the plate on the left and the copy on the right, so
    // two picture pages in a row do not mirror the same side.
    const pictureLeft = ctx.variant === "left";
    const pictureX = templateImage ? templateImage.x : pictureLeft ? area.x : area.x + area.width - pictureWidth;
    const textX = templateImage || !pictureLeft ? area.x : area.x + pictureWidth + COLUMN_GAP;
    const separatorX = pictureLeft ? pictureX + pictureWidth + COLUMN_GAP / 2 : pictureX - COLUMN_GAP / 2;

    // The headline keeps the chrome title frame and is fitted inside it. Only
    // its width follows the copy column, so the page still starts where the
    // other content pages start.
    const titleWidth = Math.max(
      MIN_TEXT_WIDTH,
      Math.min(chrome.title.width, templateImage ? chrome.title.width : textWidth),
    );
    const titleProbe = frameFromNormalized(
      { x: chrome.title.x, y: chrome.title.y, width: titleWidth, height: chrome.title.height },
      page,
    );
    // The orphan guard is bounded for a content title: two or three points to
    // balance the last line, never the drop that used to shrink a claim page
    // just because one character dangled.
    const titleSize = fittedFontSizeWithoutOrphan(
      title,
      titleProbe,
      isCover ? Math.max(ctx.tokens.type.displayPt, 40) : ctx.tokens.type.titlePt,
      18,
      displayFamily,
      lineHeight,
      3,
      isCover ? Number.POSITIVE_INFINITY : 3,
    );
    if (!textFits(title, titleProbe, titleSize, displayFamily, lineHeight)) {
      return conflict("title", "对开图文页的标题在标题轴内放不下");
    }
    const titleHeight = pointsToNormalized(
      textHeightPt(title, titleWidth * pageWidthIn * 72, titleSize, displayFamily, titleLineHeight),
      page.height,
    );
    // The band is at least as tall as two lines of the fitted headline.
    //
    // Sizing it to the estimated text height was fragile: the estimator and
    // PowerPoint disagree by a character at the wrap boundary, and when they did
    // the second line fell outside the band — a tinted block with a word hanging
    // out of it. A two-line floor makes a one-line headline sit in a taller band
    // (reads as padding) instead of a two-line headline escaping a short one.
    const twoLines = (titleSize * titleLineHeight * 2) / (pageHeightIn * 72);
    const bandHeight = Math.max(titleHeight, chrome.title.height, twoLines) + BAND_PADDING * 2;
    const bandTop = chrome.title.y - BAND_PADDING;
    // The headline stays top-aligned on the shared title axis: centring it in
    // the band would move a one-line page's headline below a two-line page's,
    // and the axis is what makes two pages read as one deck.
    const titleTop = chrome.title.y;

    const elements: RecipePlan["elements"] = [
      // The band is behind the headline, not behind the whole title frame: it
      // marks the line block, and a tint that filled the frame would read as a
      // masthead.
      rectElement(
        frameFromNormalized(
          {
            x: chrome.title.x - BAND_PADDING,
            y: bandTop,
            width: Math.min(1 - chrome.title.x + BAND_PADDING, titleWidth + BAND_PADDING * 2),
            height: bandHeight,
          },
          page,
        ),
        ctx.colors.accentSubtle,
      ),
      // A template page already separates its own regions; drawing a second
      // hairline next to the template's would read as a stray rule.
      ...(templateImage
        ? []
        : [
            rectElement(
              frameFromNormalized(
                // 0.75pt expressed as a share of the page width: a column
                // separator is a hairline, and the export writes points anyway.
                { x: separatorX, y: area.y, width: 0.75 / 72 / pageWidthIn, height: area.height },
                page,
              ),
              // A separator that has to read as a line uses the stronger border:
              // the hairline tone is for a card edge, not for a column rule.
              ctx.colors.borderStrong,
            ),
          ]),
      textElement(
        title,
        frameFromNormalized({ x: chrome.title.x, y: titleTop, width: titleWidth, height: titleHeight + 0.004 }, page),
        titleSize,
        ctx.colors.title,
        true,
        "left",
        displayFamily,
        { contentRef: "title", lineHeight: titleLineHeight },
      ),
    ];

    let cursor = area.y;
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
      // The plate is a soft-cornered frame on a free page. On a template page
      // the picture sits in the template's own placeholder, and a template's
      // rectangle is not ours to reshape.
      ...(templateImage ? {} : { imageShape: "roundRect" as const }),
      imageFrame: ctx.templateImage ?? {
        x: pictureX,
        y: area.y,
        width: pictureWidth,
        height: area.height,
      },
    };
  },
};
