import type { IntentConflict } from "../../commands/design-intent";
import type { Emu } from "../../document-model";
import { layoutFlow } from "../../rendering/flow";
import { resolveChrome } from "../page-chrome";
import { readContentUnits } from "./content";
import { rectElement, textElement } from "./elements";
import {
  fittedFontSize,
  fittedFontSizeInRange,
  frameFromNormalized,
  ruleHeight,
  textFits,
  textHeightPt,
} from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

/**
 * The paper direction's prose page.
 *
 * The column direction already moved the measure inwards, but every content page
 * still drew the editorial list: numbers in a gutter, a rule between rows, 1.25
 * leading. A page that claims to read like a printed essay has to set its copy
 * like one — one measured column, wider leading, air between paragraphs and no
 * index, rule or numeral borrowed from the editorial system.
 */
const MIN_ITEMS = 2;
const MAX_ITEMS = 6;
/** Essay leading is wider than a slide's: the column is read, not scanned. */
const ESSAY_LINE_HEIGHT = 1.55;
/** The air between two paragraphs of the column, in points. */
const PARAGRAPH_GAP_PT = 18;
/** The most the gaps may grow before the column stops reading as one block. */
const MAX_PARAGRAPH_GAP_PT = 26;
/** The lead paragraph keeps a visible step back from the list below it. */
const LEAD_GAP = 0.035;
const MIN_BODY_PT = 13;
/** The title sits one step below the editorial deck: this page is read, not announced. */
const TITLE_FACTOR = 0.82;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const paperColumn: LayoutRecipe = {
  id: "paper-column",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("paper-column")) return false;
    if (options.hasAsset || options.hasArtwork || options.hasTemplate) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    if (facts.hasQuote || facts.hasComparison || facts.hasRowBlock) return false;
    // A column needs a column's worth of copy: one point is a statement page,
    // seven points are a list that should keep its index.
    return facts.itemCount >= MIN_ITEMS && facts.itemCount <= MAX_ITEMS;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "专栏页没有标题");
    const units = readContentUnits(ctx.content);
    if (units.items.length < MIN_ITEMS || units.items.length > MAX_ITEMS) {
      return conflict("items", `该页有 ${units.items.length} 条内容，专栏页只接受 ${MIN_ITEMS}–${MAX_ITEMS} 条`);
    }
    if (!units.bodyCovered && !units.lead) {
      return conflict("body", "正文无法归入段落，也没有可绘制的引导段");
    }

    const page = ctx.frame.page;
    const pageHeightIn = page.height / 914_400;
    const pageWidthIn = page.width / 914_400;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const colors = ctx.colors;
    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleCap = Math.max(20, Math.round(ctx.tokens.type.titlePt * TITLE_FACTOR));
    const titleSize = fittedFontSizeInRange(title, titleFrame, titleCap, 18, titleCap, headingFamily, 1.3);
    if (!textFits(title, titleFrame, titleSize, headingFamily, 1.3)) {
      return conflict("title", "标题在专栏宽度内放不下");
    }

    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: 1.3,
      }),
    ];
    if (chrome.showRule) {
      // The signature of this page is a hairline across the full measure, not
      // the editorial dash: the line belongs to the column, not to the title.
      elements.push(
        rectElement(
          frameFromNormalized(
            {
              x: chrome.content.x,
              y: chrome.rule.y,
              width: chrome.content.width,
              height: Math.max(0.0025, ruleHeight(ctx.tokens.rule.hairlinePt, page.height)),
            },
            page,
          ),
          colors.accent,
        ),
      );
    }

    let contentTop = chrome.contentTop;
    if (units.lead) {
      const leadFrame = frameFromNormalized(
        {
          x: chrome.content.x,
          y: contentTop,
          width: chrome.content.width,
          height: Math.min(0.2, chrome.content.height * 0.3),
        },
        page,
      );
      const leadSize = fittedFontSize(
        units.lead,
        leadFrame,
        Math.round(ctx.tokens.type.bodyPt * 1.12),
        MIN_BODY_PT,
        bodyFamily,
        ESSAY_LINE_HEIGHT,
      );
      if (!textFits(units.lead, leadFrame, leadSize, bodyFamily, ESSAY_LINE_HEIGHT)) {
        return conflict("body", "引导段在专栏顶部放不下");
      }
      const leadHeight = pointsToNormalized(
        textHeightPt(units.lead, leadFrame.width / 12_700, leadSize, bodyFamily, ESSAY_LINE_HEIGHT),
        page.height,
      );
      elements.push(
        textElement(
          units.lead,
          { ...leadFrame, height: Math.round((leadHeight + 0.004) * page.height) as Emu },
          leadSize,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "body", lineHeight: ESSAY_LINE_HEIGHT },
        ),
      );
      contentTop += leadHeight + LEAD_GAP;
    }

    const contentHeight = chrome.contentBottom - contentTop;
    if (contentHeight < 0.15) return conflict("items", "标题与正文之间没有足够的空间");
    const flow = layoutFlow({
      items: units.items,
      widthPt: chrome.content.width * pageWidthIn * 72,
      availableHeightPt: contentHeight * pageHeightIn * 72,
      preferredFontSizePt: Math.round(ctx.tokens.type.bodyPt * 1.3),
      minimumFontSizePt: MIN_BODY_PT,
      minimumGapPt: PARAGRAPH_GAP_PT,
      maximumGapPt: MAX_PARAGRAPH_GAP_PT,
      verticalAlign: "center",
      lineHeightRatio: ESSAY_LINE_HEIGHT,
      fontFamily: bodyFamily,
    });
    if (flow.overflow) return conflict("items", "专栏正文在页面内放不下");

    for (const row of flow.rows) {
      elements.push(
        textElement(
          row.text,
          frameFromNormalized(
            {
              x: chrome.content.x,
              y: contentTop + pointsToNormalized(row.topPt, page.height),
              width: chrome.content.width,
              height: Math.max(0.02, pointsToNormalized(row.heightPt, page.height)),
            },
            page,
          ),
          row.fontSizePt,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "decorative", lineHeight: ESSAY_LINE_HEIGHT },
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
