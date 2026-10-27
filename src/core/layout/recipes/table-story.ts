import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock, TableElement } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement } from "./elements";
import { fittedFontSizeInRange, frameFromNormalized, headingMetrics, textFits } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type TableBlock = Extract<ContentBlock, { type: "table-data" }>;

const conflict = (intent: string, reason: string): { conflict: IntentConflict } => ({ conflict: { intent, reason } });

export const tableStory: LayoutRecipe = {
  id: "table-story",

  supports(facts, concept, options) {
    return (
      concept.recipes.includes("table-story") &&
      facts.hasTable === true &&
      !options.hasAsset &&
      facts.layout !== "cover" &&
      facts.layout !== "section" &&
      facts.layout !== "quote"
    );
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const block = ctx.content.blocks?.find((candidate): candidate is TableBlock => candidate.type === "table-data");
    if (!block) return conflict("table", "该页没有 table-data 内容块");
    if (block.header.length > 8 || block.rows.length > 12) return conflict("table", "表格超过 8 列或 12 行的页面容量");
    const page = ctx.frame.page;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleMetrics = headingMetrics(ctx.tokens.type.titleTrackingPt);
    const titleSize = fittedFontSizeInRange(
      ctx.content.title,
      titleFrame,
      ctx.tokens.type.titlePt,
      18,
      Math.max(36, ctx.tokens.type.titlePt),
      headingFamily,
      ctx.tokens.type.titleLineHeight,
      titleMetrics,
    );
    if (!textFits(ctx.content.title, titleFrame, titleSize, headingFamily, ctx.tokens.type.titleLineHeight, titleMetrics)) {
      return conflict("title", "表格页标题放不下");
    }
    const elements: RecipePlan["elements"] = [
      textElement(ctx.content.title, titleFrame, titleSize, ctx.colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: ctx.tokens.type.titleLineHeight,
      }),
    ];
    if (chrome.showRule) elements.push(rectElement(frameFromNormalized(chrome.rule, page), ctx.colors.accent));
    let tableTop = chrome.contentTop;
    const body = ctx.content.body.trim();
    if (body) {
      const leadFrame = frameFromNormalized(
        { x: chrome.content.x, y: tableTop, width: chrome.content.width, height: 0.1 },
        page,
      );
      const bodySize = fittedFontSizeInRange(body, leadFrame, ctx.tokens.type.bodyPt, 11, 18, bodyFamily, 1.25);
      if (!textFits(body, leadFrame, bodySize, bodyFamily, 1.25)) return conflict("body", "表格页结论说明放不下");
      elements.push(
        textElement(body, leadFrame, bodySize, ctx.colors.body, false, "left", bodyFamily, {
          contentRef: "body",
          lineHeight: 1.25,
        }),
      );
      tableTop += 0.13;
    }
    if (chrome.contentBottom - tableTop < 0.28) return conflict("table", "表格可用高度不足");
    const table: TableElement = {
      id: crypto.randomUUID() as TableElement["id"],
      type: "table",
      contentBlockId: block.id,
      frame: frameFromNormalized(
        { x: chrome.content.x, y: tableTop, width: chrome.content.width, height: chrome.contentBottom - tableTop },
        page,
      ),
      rotationMilliDegree: 0,
      locked: false,
      style: {
        fontFamily: bodyFamily,
        fontSizePt: block.rows.length > 8 ? 10 : 12,
        headerFill: ctx.colors.accentStrong,
        headerTextColor: ctx.colors.onAccent,
        bodyTextColor: ctx.colors.body,
        borderColor: ctx.colors.border,
        firstColumnBold: true,
        bandingFill: ctx.colors.surfaceSunken,
        headerBold: true,
        cellPaddingPt: block.rows.length > 8 ? 3 : 5,
        borderWidthPt: 0.75,
      },
    };
    elements.push(table);
    return {
      elements,
      consumed: { title: true, body: true, items: 0, blockIds: [block.id] },
      conflicts: [],
    };
  },
};
