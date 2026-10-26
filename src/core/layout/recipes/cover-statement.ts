import type { IntentConflict } from "../../commands/design-intent";
import { accentPanelGradient, mixHex } from "../../design/shape-gradient";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, fittedFontSizeWithoutOrphan, frameFromNormalized, textFits } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

const TITLE = { y: 0.22, width: 0.78, height: 0.32 };
const RULE = { y: 0.62, width: 0.12, height: 0.006 };
const SUBTITLE = { y: 0.69, width: 0.58, height: 0.1 };
/** Height of the eyebrow line above the headline, in page height. */
const EYEBROW_HEIGHT = 0.055;
/** The air between the eyebrow and the headline. */
const EYEBROW_GAP = 0.02;
/** An eyebrow longer than this is not a topic label, it is the headline. */
const MAX_EYEBROW_CHARS = 16;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

/**
 * Splits "topic：conclusion" into the two things it says.
 *
 * Returns `undefined` when the title has no full-width colon, when the part
 * before it is too short to read as a label, or when it is so long that setting
 * it small would be worse than leaving the title whole.
 */
function splitCoverTitle(title: string): { eyebrow: string; headline: string; headlineStart: number } | undefined {
  const colon = title.indexOf("：");
  if (colon <= 0) return undefined;
  const eyebrow = title.slice(0, colon).trim();
  const headlineStart = colon + 1;
  const headline = title.slice(headlineStart).trim();
  if (!headline || eyebrow.length < 2 || eyebrow.length > MAX_EYEBROW_CHARS) return undefined;
  return { eyebrow, headline, headlineStart };
}

export const coverStatement: LayoutRecipe = {
  id: "cover-statement",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("cover-statement")) return false;
    if (options.hasArtwork || options.hasAsset) return false;
    if (facts.layout !== "cover") return false;
    if (facts.hasQuote || facts.hasComparison || facts.hasRowBlock) return false;
    return true;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "封面没有标题");
    const subtitle = ctx.content.body.trim();
    const page = ctx.frame.page;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const paperCover = ctx.concept.motif === "paper";
    const instrumentCover = ctx.concept.motif === "instrument";

    // The cover is a full-bleed field of the brand panel. The panel tone is
    // never an ink resolved for this page: on a dark page that ink is nearly
    // white, which painted the cover as a grey gradient. Every stop is dark
    // enough for white copy, so the same ink works on all presets.
    const gradient = paperCover || instrumentCover ? undefined : accentPanelGradient(ctx.colors.panel);
    const field = paperCover || instrumentCover ? ctx.colors.background : ctx.colors.panel;
    const ink = paperCover || instrumentCover ? ctx.colors.title : "#FFFFFF";
    const secondaryInk = paperCover || instrumentCover ? ctx.colors.body : ink;
    const accentInk = paperCover || instrumentCover ? ctx.colors.accentStrong : ink;
    const coverTitle = {
      x: chrome.title.x,
      y: Math.max(TITLE.y, chrome.title.y + 0.04),
      width: Math.min(TITLE.width, Math.max(0.4, 1 - chrome.title.x - 0.07)),
      height: TITLE.height,
    };
    const subtitleFrameNormalized = {
      x: coverTitle.x,
      y: SUBTITLE.y,
      width: Math.min(SUBTITLE.width, coverTitle.width),
      height: SUBTITLE.height,
    };
    const ruleNormalized = { x: coverTitle.x, y: RULE.y, width: RULE.width, height: RULE.height };

    const titleFrame = frameFromNormalized(coverTitle, page);
    // A title written as "topic：conclusion" is two pieces of information: the
    // topic names the deck, the conclusion is the headline. Setting both at
    // display size is why long covers read as a wall of words. The topic becomes
    // an eyebrow and the conclusion keeps the headline — one reviewed title, two
    // views of it, and typing in the headline splices back into its range.
    const split = splitCoverTitle(title);
    const headline = split ? split.headline : title;
    const headlineFrame = split
      ? frameFromNormalized(
          {
            ...coverTitle,
            y: coverTitle.y + EYEBROW_HEIGHT + EYEBROW_GAP,
            height: Math.max(0.16, TITLE.height - EYEBROW_HEIGHT - EYEBROW_GAP),
          },
          page,
        )
      : titleFrame;
    // The size is fitted against the body leading, which is the conservative
    // measure: the headline renders tighter than that, so the block ends up
    // shorter than the box and never grows a line it did not have before.
    const titleSize = fittedFontSizeWithoutOrphan(
      headline,
      headlineFrame,
      Math.max(ctx.tokens.type.displayPt, 48),
      24,
      headingFamily,
      lineHeight,
    );
    if (!textFits(headline, headlineFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "封面标题在标题框内放不下");
    }

    const elements: RecipePlan["elements"] = [
      rectElement(frameFromNormalized({ x: 0, y: 0, width: 1, height: 1 }, page), field, gradient),
    ];
    if (paperCover) {
      elements.push(
        rectElement(frameFromNormalized({ x: coverTitle.x, y: 0.115, width: 0.08, height: 0.008 }, page), accentInk),
      );
    }
    if (instrumentCover) {
      elements.push(
        rectElement(frameFromNormalized({ x: 0, y: 0, width: 0.15, height: 1 }, page), ctx.colors.panel),
        rectElement(frameFromNormalized({ x: 0.168, y: 0.12, width: 0.006, height: 0.76 }, page), accentInk),
      );
    }
    if (split) {
      const eyebrowFrameNormalized = { ...coverTitle, height: EYEBROW_HEIGHT };
      const eyebrowFrame = frameFromNormalized(eyebrowFrameNormalized, page);
      const eyebrowSize = fittedFontSize(
        split.eyebrow,
        eyebrowFrame,
        Math.max(14, ctx.tokens.type.captionPt + 4),
        10,
        headingFamily,
        lineHeight,
      );
      elements.push(
        textElement(
          split.eyebrow,
          eyebrowFrame,
          eyebrowSize,
          paperCover || instrumentCover ? ctx.colors.textMuted : mixHex(ink, ctx.colors.panel, 0.22),
          false,
          "left",
          headingFamily,
          {
            lineHeight,
          },
        ),
      );
    }
    elements.push(
      textElement(headline, headlineFrame, titleSize, ink, true, "left", headingFamily, {
        contentRef: "title",
        ...(split ? { contentRange: { start: split.headlineStart, end: title.length } } : {}),
        lineHeight: titleLineHeight,
      }),
    );

    if (subtitle) {
      elements.push(rectElement(frameFromNormalized(ruleNormalized, page), accentInk));
      const subtitleFrame = frameFromNormalized(subtitleFrameNormalized, page);
      const subtitleSize = fittedFontSize(
        subtitle,
        subtitleFrame,
        ctx.tokens.type.subtitlePt,
        12,
        bodyFamily,
        lineHeight,
      );
      if (!textFits(subtitle, subtitleFrame, subtitleSize, bodyFamily, lineHeight)) {
        return conflict("body", "封面副标题在副标题框内放不下");
      }
      elements.push(
        textElement(subtitle, subtitleFrame, subtitleSize, secondaryInk, false, "left", bodyFamily, {
          contentRef: "body",
          lineHeight,
        }),
      );
    }

    return {
      elements,
      consumed: {
        title: true,
        body: true,
        items: 0,
        blockIds: [],
      },
      conflicts: [],
    };
  },
};
