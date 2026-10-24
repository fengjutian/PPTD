import type { IntentConflict } from "../../commands/design-intent";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

const TITLE = { x: 0.07, y: 0.18, width: 0.66, height: 0.34 };
const ACCENT_BAR = { x: 0, y: 0, width: 0.035, height: 1 };
const ACCENT_PANEL = { x: 0.78, y: 0, width: 0.22, height: 1 };

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

    // The cover keeps its own composition, but it starts from the shared title
    // axis instead of a private y. A cover that ignores the deck's chrome is
    // how one deck ends up with two different left margins.
    const coverTitle = {
      x: chrome.title.x,
      y: Math.min(0.7, chrome.title.y + 0.06),
      width: Math.min(TITLE.width, Math.max(0.3, chrome.title.width)),
      height: TITLE.height,
    };
    const subtitleFrameNormalized = {
      x: coverTitle.x,
      y: Math.min(0.8, coverTitle.y + coverTitle.height + 0.1),
      width: Math.min(0.55, coverTitle.width),
      height: 0.14,
    };
    const ruleNormalized = {
      x: coverTitle.x,
      y: Math.max(coverTitle.y + 0.1, subtitleFrameNormalized.y - 0.07),
      width: 0.12,
      height: 0.006,
    };

    const titleFrame = frameFromNormalized(coverTitle, page);
    const titleSize = fittedFontSize(
      title,
      titleFrame,
      Math.max(ctx.tokens.type.displayPt, 40),
      24,
      headingFamily,
      lineHeight,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "封面标题在标题框内放不下");
    }

    const elements: RecipePlan["elements"] = [
      rectElement(frameFromNormalized(ACCENT_BAR, page), ctx.colors.accent),
      rectElement(frameFromNormalized(ACCENT_PANEL, page), ctx.colors.accent),
      rectElement(frameFromNormalized(ruleNormalized, page), ctx.colors.accent),
      textElement(title, titleFrame, titleSize, ctx.colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight,
      }),
    ];

    if (subtitle) {
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
        textElement(subtitle, subtitleFrame, subtitleSize, ctx.colors.body, false, "left", bodyFamily, {
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
