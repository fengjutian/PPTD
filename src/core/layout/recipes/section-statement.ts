import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { accentPanelGradient } from "../../design/shape-gradient";
import { rectElement, textElement } from "./elements";
import {
  fittedFontSize,
  fittedFontSizeWithoutOrphan,
  frameFromNormalized,
  headingMetrics,
  textFits,
  textHeightPt,
} from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

const PANEL = { x: 0, y: 0, width: 0.32, height: 1 };
const NUMBER = { x: 0.055, y: 0.3, width: 0.21, height: 0.2 };
const TITLE = { x: 0.4, y: 0.26, width: 0.52, height: 0.28 };
const RULE = { x: 0.4, y: 0.56, width: 0.12, height: 0.006 };
const BODY = { x: 0.4, y: 0.6, width: 0.52, height: 0.22 };

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const sectionStatement: LayoutRecipe = {
  id: "section-statement",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("section-statement")) return false;
    if (options.hasAsset) return false;
    if (options.hasArtwork || options.hasTemplate) return false;
    return facts.layout === "section";
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "章节页没有标题");
    const body = ctx.content.body.trim();
    const page = ctx.frame.page;
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const colors = ctx.colors;

    const titleFrame = frameFromNormalized(TITLE, page);
    // A section title is display type: it may give up to three points to avoid
    // a stranded last character, but never its size to a narrow frame.
    const titleMetrics = headingMetrics(ctx.tokens.type.titleTrackingPt);
    const titleSize = fittedFontSizeWithoutOrphan(
      title,
      titleFrame,
      40,
      28,
      headingFamily,
      lineHeight,
      3,
      3,
      titleMetrics,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight, titleMetrics)) {
      return conflict("title", "章节标题放不下");
    }

    const elements: RecipePlan["elements"] = [
      // The panel is a brand surface, not this page's accent ink: on a dark
      // chapter page the accent ink is near-white and the panel vanished.
      rectElement(frameFromNormalized(PANEL, page), colors.panel, accentPanelGradient(colors.panel)),
      textElement(
        String(ctx.page.index + 1).padStart(2, "0"),
        frameFromNormalized(NUMBER, page),
        92,
        "#FFFFFF",
        true,
        "left",
        headingFamily,
        { lineHeight: 1 },
      ),
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];

    if (body) {
      const bodyFrame = frameFromNormalized(BODY, page);
      const bodySize = fittedFontSize(body, bodyFrame, 20, 14, bodyFamily, lineHeight);
      if (!textFits(body, bodyFrame, bodySize, bodyFamily, lineHeight)) {
        return conflict("body", "章节说明放不下");
      }
      const bodyHeight = pointsToNormalized(
        textHeightPt(body, bodyFrame.width / 12_700, bodySize, bodyFamily, lineHeight),
        page.height,
      );
      elements.push(
        rectElement(frameFromNormalized(RULE, page), colors.accent),
        textElement(
          body,
          {
            ...bodyFrame,
            height: Math.max(0.04, Math.round((bodyHeight + 0.006) * page.height)) as Emu,
          },
          bodySize,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "body", lineHeight },
        ),
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
