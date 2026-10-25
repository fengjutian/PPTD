import type { IntentConflict } from "../../commands/design-intent";
import { accentPanelGradient } from "../../design/shape-gradient";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

const TITLE = { y: 0.22, width: 0.78, height: 0.32 };
const RULE = { y: 0.62, width: 0.12, height: 0.006 };
const SUBTITLE = { y: 0.69, width: 0.58, height: 0.1 };

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
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

    // The cover is a full-bleed field of the brand panel. The panel tone is
    // never an ink resolved for this page: on a dark page that ink is nearly
    // white, which painted the cover as a grey gradient. Every stop is dark
    // enough for white copy, so the same ink works on all presets.
    const gradient = accentPanelGradient(ctx.colors.panel);
    const ink = "#FFFFFF";
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
    const titleSize = fittedFontSize(
      title,
      titleFrame,
      Math.max(ctx.tokens.type.displayPt, 48),
      24,
      headingFamily,
      lineHeight,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "封面标题在标题框内放不下");
    }

    const elements: RecipePlan["elements"] = [
      rectElement(frameFromNormalized({ x: 0, y: 0, width: 1, height: 1 }, page), ctx.colors.panel, gradient),
      textElement(title, titleFrame, titleSize, ink, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight,
      }),
    ];

    if (subtitle) {
      elements.push(rectElement(frameFromNormalized(ruleNormalized, page), ink));
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
        textElement(subtitle, subtitleFrame, subtitleSize, ink, false, "left", bodyFamily, {
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
