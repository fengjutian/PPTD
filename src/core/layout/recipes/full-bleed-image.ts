import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { readContentUnits } from "./content";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, fittedFontSizeWithoutOrphan, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

/** The side margin of the copy that sits on the plate. */
const PLATE_INSET = 0.07;
/** The copy column on the plate never runs past this share of the page. */
const PLATE_TEXT_WIDTH = 0.62;
/** Padding above the headline and below the last line on the plate. */
const PLATE_PADDING = 0.055;
/** The air between the headline and the line under it. */
const PLATE_BLOCK_GAP = 0.02;
/** A plate shorter than this is a caption bar, not a place to set a headline. */
const MIN_PLATE_HEIGHT = 0.26;
/** Items are secondary on this page: two at most, or it is not a statement. */
const MAX_ITEMS = 2;
/** The bright mark that ties the plate to the accent of the deck. */
const ACCENT_BAR = { width: 0.09, heightPt: 2.5 };

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

/**
 * The page as a picture, with the copy set on a solid plate.
 *
 * Every other picture recipe puts the copy *beside* the image, because the
 * renderer has no transparency: text drawn straight onto a photograph is
 * readable only by luck, and a translucent scrim cannot be expressed as a
 * native shape. This recipe takes the honest version of the same composition —
 * the picture owns the top of the page, and the copy sits on an opaque plate
 * that the theme supplies. The plate is `surfaceRaised`, so it reads as a
 * separate plane on every palette instead of a white bar on a light one.
 *
 * The frame is deliberately a cover page: a photograph with a headline plate
 * and at most two short lines. A page with a list, a chart or a comparison is
 * refused here and keeps its own recipe; the image does not get to delete the
 * structure of the content.
 */
export const fullBleedImage: LayoutRecipe = {
  id: "full-bleed-image",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("full-bleed-image")) return false;
    if (!options.hasAsset) return false;
    // A template's own artwork and the picture would fight for the same page.
    // A template picture placeholder is different: the frame is the template's
    // and the picture fills it, so the composition still holds.
    if (options.hasArtwork && !options.hasTemplateImage) return false;
    if (facts.hasRowBlock || facts.hasComparison || facts.hasQuote) return false;
    if (facts.layout === "quote") return false;
    return facts.itemCount <= MAX_ITEMS;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "全幅图页没有标题");
    const units = readContentUnits(ctx.content);
    if (units.items.length > MAX_ITEMS) {
      return conflict("items", `全幅图页最多承载 ${MAX_ITEMS} 条要点`);
    }
    if (!units.bodyCovered && !units.lead) {
      return conflict("body", "正文无法归入图片上方的文字板");
    }

    const page = ctx.frame.page;
    const pageWidthIn = page.width / 914_400;
    const chrome = resolveChrome(ctx);
    const displayFamily = ctx.tokens.fonts.display;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const isCover = ctx.facts.layout === "cover";
    const textX = Math.max(PLATE_INSET, chrome.title.x);
    const textWidth = Math.min(PLATE_TEXT_WIDTH, 1 - textX - PLATE_INSET);
    if (textWidth < 0.3) return conflict("title", "全幅图页的标题列太窄");

    // The headline is fitted into a band, and the plate is then drawn around
    // what the copy actually needs. The other order — a fixed plate and a
    // headline squeezed into it — is how a long title becomes 22pt on a page
    // that has room for 40.
    const titleProbe = frameFromNormalized(
      { x: textX, y: 0, width: textWidth, height: Math.max(0.16, Math.min(0.3, chrome.title.height)) },
      page,
    );
    const titleSize = (isCover ? fittedFontSizeWithoutOrphan : fittedFontSize)(
      title,
      titleProbe,
      isCover ? Math.max(ctx.tokens.type.displayPt, 40) : ctx.tokens.type.titlePt,
      20,
      displayFamily,
      lineHeight,
    );
    if (!textFits(title, titleProbe, titleSize, displayFamily, lineHeight)) {
      return conflict("title", "全幅图页标题在文字板里放不下");
    }
    const titleHeight = pointsToNormalized(
      textHeightPt(title, textWidth * pageWidthIn * 72, titleSize, displayFamily, titleLineHeight),
      page.height,
    );

    let lead = "";
    let leadSize = ctx.tokens.type.bodyPt;
    let leadHeight = 0;
    if (units.lead) {
      lead = units.lead;
      leadSize = Math.min(ctx.tokens.type.bodyPt, 16);
      leadHeight = pointsToNormalized(
        textHeightPt(lead, textWidth * pageWidthIn * 72, leadSize, bodyFamily, lineHeight),
        page.height,
      );
    }
    const itemLines = units.items.length > 0 ? units.items : [];
    const itemSize = Math.max(12, Math.min(ctx.tokens.type.bodyPt, 15));
    const itemHeights = itemLines.map((item) =>
      pointsToNormalized(
        textHeightPt(item, textWidth * pageWidthIn * 72, itemSize, bodyFamily, lineHeight),
        page.height,
      ),
    );
    const itemsGap = itemLines.length > 0 ? 0.014 : 0;
    // The accent mark needs its own band above the headline. Drawn at the same
    // y as the copy it crossed the first line's ascenders; the block below
    // reserves the mark plus the air under it before the headline starts.
    const barHeight = pointsToNormalized(ACCENT_BAR.heightPt, page.height);
    const barBlock = chrome.showRule ? barHeight + 0.016 : 0;

    const plateHeight = Math.max(
      MIN_PLATE_HEIGHT,
      PLATE_PADDING * 2 +
        barBlock +
        titleHeight +
        (lead ? PLATE_BLOCK_GAP + leadHeight : 0) +
        (itemLines.length > 0
          ? itemsGap + itemHeights.reduce((total, height) => total + height, 0) + itemsGap * (itemLines.length - 1)
          : 0),
    );
    if (plateHeight > 0.62) return conflict("body", "全幅图页的文字板会吃掉大半个画面");
    const plateTop = 1 - plateHeight;

    const elements: RecipePlan["elements"] = [
      rectElement(
        frameFromNormalized({ x: 0, y: plateTop, width: 1, height: plateHeight }, page),
        ctx.colors.surfaceRaised,
        undefined,
        // The plate lies over a photograph; a soft shadow is what makes it read
        // as a separate plane rather than a crop line.
        { shadow: "raised" },
      ),
      // A hairline along the top edge is what makes the plate read as a plane
      // laid over the picture rather than a crop of it.
      rectElement(
        frameFromNormalized({ x: 0, y: plateTop, width: 1, height: pointsToNormalized(0.75, page.height) }, page),
        ctx.colors.border,
      ),
    ];
    if (chrome.showRule) {
      elements.push(
        rectElement(
          frameFromNormalized(
            {
              x: textX,
              y: plateTop + PLATE_PADDING,
              width: ACCENT_BAR.width,
              height: barHeight,
            },
            page,
          ),
          ctx.colors.accent,
        ),
      );
    }

    let cursor = plateTop + PLATE_PADDING + barBlock;
    elements.push(
      textElement(
        title,
        frameFromNormalized({ x: textX, y: cursor, width: textWidth, height: titleHeight + 0.004 }, page),
        titleSize,
        ctx.colors.title,
        true,
        "left",
        displayFamily,
        { contentRef: "title", lineHeight: titleLineHeight },
      ),
    );
    cursor += titleHeight;

    if (lead) {
      cursor += PLATE_BLOCK_GAP;
      elements.push(
        textElement(
          lead,
          frameFromNormalized({ x: textX, y: cursor, width: textWidth, height: leadHeight + 0.004 }, page),
          leadSize,
          ctx.colors.textMuted,
          false,
          "left",
          bodyFamily,
          { contentRef: "body", lineHeight },
        ),
      );
      cursor += leadHeight;
    }

    if (itemLines.length > 0) {
      cursor += itemsGap;
      itemLines.forEach((item, index) => {
        const rowHeight = itemHeights[index]!;
        elements.push(
          textElement(
            item,
            frameFromNormalized({ x: textX, y: cursor, width: textWidth, height: rowHeight + 0.004 }, page),
            itemSize,
            ctx.colors.textMuted,
            false,
            "left",
            bodyFamily,
            { contentRef: "decorative", lineHeight },
          ),
        );
        cursor += rowHeight + itemsGap;
      });
    }

    return {
      elements,
      consumed: {
        title: true,
        body: units.bodyCovered || Boolean(units.lead) || itemLines.length === 0,
        items: itemLines.length,
        blockIds: units.blockIds,
      },
      conflicts: [],
      imageFrame: ctx.templateImage ?? { x: 0, y: 0, width: 1, height: 1 },
    };
  },
};
