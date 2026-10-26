import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { layoutFlow } from "../../rendering/flow";
import { resolveChrome } from "../page-chrome";
import { readContentUnits } from "./content";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, fittedFontSizeWithoutOrphan, frameFromNormalized, headingMetrics, textFits } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

const PICTURE_X = 0.52;
/** The air between the copy column and the picture. */
const COLUMN_GAP = 0.04;
/** The widest copy column an image page uses, whatever the surface allows. */
const TEXT_COLUMN = 0.4;
/** A column narrower than this cannot carry a headline. */
const MIN_TITLE_WIDTH = 0.24;
/** The picture never gives up more than this share of the page to the copy. */
const MAX_PICTURE_X = 0.7;

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
    // A picture needs a frame. On a template page the frame is the template's
    // own picture placeholder; a flat page uses the right half of the page.
    if (!options.hasAsset) return false;
    if (options.hasArtwork && !options.hasTemplateImage) return false;
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
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const isCover = ctx.facts.layout === "cover";
    const templateImage = ctx.templateImage;
    const textX = chrome.title.x;
    // The picture takes the right side of the page, and the copy may not run
    // under it. The title axis moves with the direction's surface (a rail or a
    // column pushes it inward), so the frame that stays on the page is derived
    // from where the picture starts — not from a fixed 40% width, which put the
    // headline underneath the picture on those surfaces.
    const pictureX = templateImage
      ? PICTURE_X
      : Math.max(PICTURE_X, Math.min(MAX_PICTURE_X, textX + TEXT_COLUMN + COLUMN_GAP));
    const titleWidth = templateImage
      ? Math.max(0.25, chrome.title.width)
      : Math.max(MIN_TITLE_WIDTH, Math.min(TEXT_COLUMN, pictureX - textX - COLUMN_GAP));
    const titleFrameNormalized = {
      x: textX,
      y: chrome.title.y,
      width: titleWidth,
      height: templateImage ? Math.max(0.1, chrome.title.height) : Math.max(0.2, chrome.title.height),
    };
    const titleFrame = frameFromNormalized(titleFrameNormalized, page);
    // Fitted against the body leading (conservative), rendered with the tighter
    // headline leading: the copy block gets shorter without the size growing
    // into an extra line the frame cannot hold.
    // The orphan guard is bounded for a content title: two or three points to
    // balance the last line, never the drop that used to shrink a claim page
    // just because one character dangled.
    const titleMetrics = headingMetrics(ctx.tokens.type.titleTrackingPt);
    const titleSize = fittedFontSizeWithoutOrphan(
      title,
      titleFrame,
      isCover ? Math.max(ctx.tokens.type.displayPt, 40) : ctx.tokens.type.titlePt,
      18,
      headingFamily,
      lineHeight,
      3,
      isCover ? Number.POSITIVE_INFINITY : 3,
      titleMetrics,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight, titleMetrics)) {
      return conflict("title", "图文页标题在图片旁放不下");
    }

    const elements: RecipePlan["elements"] = [
      ...(chrome.showRule
        ? [
            rectElement(
              frameFromNormalized({ x: textX, y: chrome.rule.y, width: 0.12, height: chrome.rule.height }, page),
              ctx.colors.accent,
            ),
          ]
        : []),
      textElement(title, titleFrame, titleSize, ctx.colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];

    let itemTop = templateImage ? chrome.contentTop : Math.max(chrome.contentTop, chrome.rule.y + 0.05);
    if (units.lead) {
      const leadFrame = frameFromNormalized({ x: textX, y: itemTop, width: titleWidth, height: 0.13 }, page);
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
      const pageWidthIn = page.width / 914_400;
      const pageHeightIn = page.height / 914_400;
      const availableHeight = chrome.contentBottom - itemTop;
      if (availableHeight < 0.07) return conflict("items", "图文页要点行高不足");
      const flow = layoutFlow({
        items,
        widthPt: titleWidth * pageWidthIn * 72,
        availableHeightPt: availableHeight * pageHeightIn * 72,
        preferredFontSizePt: ctx.tokens.type.bodyPt + 2,
        minimumFontSizePt: 12,
        minimumGapPt: 10,
        maximumGapPt: 28,
        verticalAlign: "top",
        lineHeightRatio: lineHeight,
        fontFamily: bodyFamily,
      });
      if (flow.overflow) return conflict("items", "图文页要点在文字区里放不下");
      flow.rows.forEach((row) => {
        elements.push(
          textElement(
            row.text,
            frameFromNormalized(
              {
                x: textX,
                y: itemTop + pointsToNormalized(row.topPt, page.height),
                width: titleWidth,
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
        { x: textX, y: itemTop, width: titleWidth, height: chrome.contentBottom - itemTop },
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
      imageFrame: templateImage ?? { x: pictureX, y: 0, width: 1 - pictureX, height: 1 },
    };
  },
};
