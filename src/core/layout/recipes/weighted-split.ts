import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock } from "../../document-model";
import { layoutFlow } from "../../rendering/flow";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type ComparisonBlock = Extract<ContentBlock, { type: "comparison" }>;

const MIN_ITEMS = 2;
const MAX_ITEMS = 5;
const HEADER_IN = 0.62;
const ITEM_SIZE_PT = 20;
const SECONDARY_SIZE_PT = 16;
const MIN_ITEM_SIZE_PT = 14;
const MIN_GAP_PT = 10;
const MAX_GAP_PT = 42;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

export const weightedSplit: LayoutRecipe = {
  id: "weighted-split",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("weighted-split")) return false;
    if (options.hasAsset) return false;
    if (!facts.hasComparison) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    return true;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "加权对比页没有标题");
    const block = ctx.content.blocks?.find(
      (candidate): candidate is ComparisonBlock => candidate.type === "comparison",
    );
    if (!block) return conflict("comparison", "该页没有 comparison 内容块");
    const leftItems = block.leftItems.map((item) => item.trim()).filter(Boolean);
    const rightItems = block.rightItems.map((item) => item.trim()).filter(Boolean);
    if (
      leftItems.length < MIN_ITEMS ||
      rightItems.length < MIN_ITEMS ||
      leftItems.length > MAX_ITEMS ||
      rightItems.length > MAX_ITEMS
    ) {
      return conflict("comparison", `加权对比每侧只接受 ${MIN_ITEMS}–${MAX_ITEMS} 条`);
    }

    const page = ctx.frame.page;
    const pageWidthIn = page.width / 914_400;
    const pageHeightIn = page.height / 914_400;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const colors = ctx.colors;

    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleSize = fittedFontSize(title, titleFrame, ctx.tokens.type.titlePt, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "加权对比页标题放不下");
    }
    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight,
      }),
    ];
    if (chrome.showRule) elements.push(rectElement(frameFromNormalized(chrome.rule, page), colors.accent));

    let contentTop = chrome.contentTop;
    const lead = ctx.content.body.trim();
    if (lead) {
      const leadFrame = frameFromNormalized(
        { x: chrome.content.x, y: contentTop, width: chrome.content.width * 0.72, height: 0.16 },
        page,
      );
      const leadSize = fittedFontSize(
        lead,
        leadFrame,
        Math.min(ctx.tokens.type.bodyPt, 16),
        12,
        bodyFamily,
        lineHeight,
      );
      if (!textFits(lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "加权对比页引导段放不下");
      }
      elements.push(
        textElement(lead, leadFrame, leadSize, colors.body, false, "left", bodyFamily, {
          contentRef: "body",
          lineHeight,
        }),
      );
      contentTop += 0.16;
    }

    const gap = 0.06;
    const ratio = Math.min(0.68, Math.max(0.32, ctx.ratio ?? 0.62));
    const available = chrome.content.width - gap;
    const leftWidth = available * ratio;
    const rightWidth = available - leftWidth;
    const leftPrimary = ratio >= 0.5;
    const contentHeight = chrome.contentBottom - contentTop - 0.02;
    if (contentHeight < 0.3) return conflict("comparison", "加权对比页没有足够的内容区");
    const headerHeight = HEADER_IN / pageHeightIn;
    const copyArea = Math.max(0.15, contentHeight - headerHeight);

    const buildColumn = (items: string[], width: number, primary: boolean) => {
      const size = primary ? ITEM_SIZE_PT : SECONDARY_SIZE_PT;
      const copyWidth = width - 0.022;
      const flow = layoutFlow({
        items,
        widthPt: copyWidth * pageWidthIn * 72,
        availableHeightPt: copyArea * pageHeightIn * 72,
        preferredFontSizePt: size,
        minimumFontSizePt: MIN_ITEM_SIZE_PT,
        minimumGapPt: MIN_GAP_PT,
        maximumGapPt: MAX_GAP_PT,
        verticalAlign: "center",
        lineHeightRatio: lineHeight,
        fontFamily: bodyFamily,
      });
      return { items, width, primary, copyWidth, flow };
    };
    const columns = [
      { x: chrome.content.x, label: block.leftLabel, ...buildColumn(leftItems, leftWidth, leftPrimary) },
      {
        x: chrome.content.x + leftWidth + gap,
        label: block.rightLabel,
        ...buildColumn(rightItems, rightWidth, !leftPrimary),
      },
    ];
    if (columns.some((column) => column.flow.overflow)) {
      return conflict("comparison", "加权对比要点在栏内放不下");
    }

    const panelTop = contentTop;
    columns.forEach((column) => {
      const labelFrame = frameFromNormalized(
        { x: column.x, y: panelTop, width: column.width, height: Math.min(headerHeight, 0.42 / pageHeightIn) },
        page,
      );
      const labelSize = Math.min(
        column.primary ? 26 : 18,
        fittedFontSize(column.label, labelFrame, column.primary ? 26 : 18, 14, headingFamily, lineHeight),
      );
      elements.push(
        textElement(column.label, labelFrame, labelSize, colors.accent, true, "left", headingFamily, {
          lineHeight,
        }),
      );
      elements.push(
        rectElement(
          frameFromNormalized(
            { x: column.x, y: panelTop + 0.42 / pageHeightIn + 0.015, width: 0.12, height: 0.006 },
            page,
          ),
          colors.accent,
        ),
      );
      const rowsTop = panelTop + headerHeight;
      column.flow.rows.forEach((row, index) => {
        const rowY = rowsTop + row.topPt / 72 / pageHeightIn;
        const rowHeight = row.heightPt / 72 / pageHeightIn;
        const markerHeight = Math.min(0.05, rowHeight * 0.5);
        elements.push(
          rectElement(
            frameFromNormalized(
              { x: column.x, y: rowY + (rowHeight - markerHeight) / 2, width: 0.008, height: markerHeight },
              page,
            ),
            colors.accent,
          ),
        );
        elements.push(
          textElement(
            column.items[index]!,
            frameFromNormalized(
              { x: column.x + 0.022, y: rowY, width: column.copyWidth, height: Math.max(0.02, rowHeight) },
              page,
            ),
            row.fontSizePt,
            colors.body,
            false,
            "left",
            bodyFamily,
            { contentRef: "decorative", lineHeight },
          ),
        );
      });
    });

    const splitX = chrome.content.x + leftWidth + gap / 2;
    elements.push(verticalRule(splitX, panelTop, contentHeight, 0.0014, page, colors.rule));

    return {
      elements,
      consumed: { title: true, body: true, items: 0, blockIds: [block.id] },
      conflicts: [],
    };
  },
};
