import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock, Emu } from "../../document-model";
import { layoutFlow } from "../../rendering/flow";
import { resolveChrome } from "../page-chrome";
import { rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, anyEndsInOrphan, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type ComparisonBlock = Extract<ContentBlock, { type: "comparison" }>;

const MIN_ITEMS = 2;
const MAX_ITEMS = 5;
const HEADER_IN = 0.62;
const ITEM_SIZE_PT = 18;
const MIN_ITEM_SIZE_PT = 14;
const MIN_GAP_PT = 10;
const MAX_GAP_PT = 42;
const MARKER_GUTTER = 0.022;
/** The inset that keeps the column label off the edge of its accent field. */
const HEADER_PADDING = 0.018;
/**
 * How far below the preferred size a list may shrink to avoid a stranded last
 * line. More than this and the page reads as one that changed size by accident.
 */
const ORPHAN_ALLOWANCE_PT = 3;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

export const comparison: LayoutRecipe = {
  id: "comparison",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("comparison")) return false;
    if (options.hasAsset) return false;
    if (!facts.hasComparison) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    return true;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "对比页没有标题");
    const block = ctx.content.blocks?.find(
      (candidate): candidate is ComparisonBlock => candidate.type === "comparison",
    );
    if (!block) return conflict("comparison", "该页没有 comparison 内容块");
    const leftItems = block.leftItems.filter((item) => item.trim());
    const rightItems = block.rightItems.filter((item) => item.trim());
    if (
      leftItems.length < MIN_ITEMS ||
      leftItems.length > MAX_ITEMS ||
      rightItems.length < MIN_ITEMS ||
      rightItems.length > MAX_ITEMS
    ) {
      return conflict("comparison", `对比两栏各接受 ${MIN_ITEMS}–${MAX_ITEMS} 条`);
    }

    const page = ctx.frame.page;
    const pageWidthIn = page.width / 914_400;
    const pageHeightIn = page.height / 914_400;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const colors = ctx.colors;

    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleSize = fittedFontSize(title, titleFrame, ctx.tokens.type.titlePt, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "对比页标题放不下");
    }
    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight: titleLineHeight,
      }),
    ];
    if (chrome.showRule) elements.push(rectElement(frameFromNormalized(chrome.rule, page), colors.accent));

    let contentTop = chrome.contentTop;
    const lead = ctx.content.body.trim();
    if (lead) {
      const leadFrame = frameFromNormalized(
        {
          x: chrome.content.x,
          y: contentTop,
          width: chrome.content.width * 0.72,
          height: Math.min(0.16, chrome.content.height * 0.25),
        },
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
        return conflict("body", "对比页引导段放不下");
      }
      const leadHeight = pointsToNormalized(
        textHeightPt(lead, leadFrame.width / 12_700, leadSize, bodyFamily, lineHeight),
        page.height,
      );
      elements.push(
        textElement(
          lead,
          { ...leadFrame, height: Math.round((leadHeight + 0.004) * page.height) as Emu },
          leadSize,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "body", lineHeight },
        ),
      );
      contentTop = contentTop + leadHeight + 0.03;
    }

    const gap = 0.06;
    const columnWidth = (chrome.content.width - gap) / 2;
    const paddingX = 0.02;
    const headerHeight = HEADER_IN / pageHeightIn;
    const copyWidth = Math.max(0.12, columnWidth - paddingX - MARKER_GUTTER);
    const availableHeight = chrome.contentBottom - contentTop - 0.02;
    if (availableHeight < 0.3) return conflict("comparison", "对比页没有足够的内容区");
    const copyArea = Math.max(0.15, availableHeight - headerHeight);

    const flowFor = (items: string[], size: number) =>
      layoutFlow({
        items,
        widthPt: copyWidth * pageWidthIn * 72,
        availableHeightPt: copyArea * pageHeightIn * 72,
        preferredFontSizePt: size,
        minimumFontSizePt: size,
        minimumGapPt: MIN_GAP_PT,
        maximumGapPt: MAX_GAP_PT,
        verticalAlign: "center",
        lineHeightRatio: lineHeight,
        fontFamily: bodyFamily,
      });

    // A column that ends on a single character ("…贡献有 / 限") reads as a
    // mistake. Both columns share one size, so the fix is a point or two for the
    // whole list, not a different size for the one item that broke badly.
    const copyWidthPt = copyWidth * pageWidthIn * 72;
    const orphanAt = (size: number) =>
      size > ITEM_SIZE_PT - ORPHAN_ALLOWANCE_PT &&
      (anyEndsInOrphan(leftItems, copyWidthPt, size, bodyFamily) ||
        anyEndsInOrphan(rightItems, copyWidthPt, size, bodyFamily));

    let itemSize = ITEM_SIZE_PT;
    let leftFlow = flowFor(leftItems, itemSize);
    let rightFlow = flowFor(rightItems, itemSize);
    while (
      itemSize > MIN_ITEM_SIZE_PT &&
      (leftFlow.overflow ||
        rightFlow.overflow ||
        Math.max(leftFlow.totalHeightPt, rightFlow.totalHeightPt) > copyArea * pageHeightIn * 72 ||
        orphanAt(itemSize))
    ) {
      itemSize -= 1;
      leftFlow = flowFor(leftItems, itemSize);
      rightFlow = flowFor(rightItems, itemSize);
    }
    if (leftFlow.overflow || rightFlow.overflow) return conflict("comparison", "对比要点在栏内放不下");

    const panelTop = contentTop;
    const panelHeight = availableHeight;
    const columns = [
      { x: chrome.content.x, label: block.leftLabel, items: leftItems, flow: leftFlow },
      {
        x: chrome.content.x + columnWidth + gap,
        label: block.rightLabel,
        items: rightItems,
        flow: rightFlow,
      },
    ];
    columns.forEach((column) => {
      const headerFrame = {
        x: column.x,
        y: panelTop,
        width: columnWidth,
        height: Math.min(headerHeight, 0.42 / pageHeightIn),
      };
      // A recessed field behind each column is what makes the two sides read as
      // two zones instead of two lists on the same page. It is skipped on a
      // template page: a filled panel would cover the artwork the user chose,
      // which a text element does not.
      if (!ctx.hasArtwork) {
        elements.push(
          rectElement(
            frameFromNormalized(
              {
                x: Math.max(chrome.content.x - 0.01, headerFrame.x - 0.014),
                y: panelTop,
                width: headerFrame.width + 0.028,
                height: panelHeight,
              },
              page,
            ),
            ctx.colors.surfaceSunken,
          ),
        );
      }
      // The label sits on a solid accent field rather than in accent ink on the
      // page: the field carries `onAccent`, so the label is readable whatever
      // the accent is, and a pale brand tone is deepened instead of unreadable.
      elements.push(rectElement(frameFromNormalized(headerFrame, page), ctx.colors.accentStrong));
      const labelFrame = frameFromNormalized(
        {
          x: headerFrame.x + HEADER_PADDING,
          y: headerFrame.y + HEADER_PADDING * 0.5,
          width: Math.max(0.1, headerFrame.width - HEADER_PADDING * 2),
          height: Math.max(0.02, headerFrame.height - HEADER_PADDING),
        },
        page,
      );
      const labelSize = Math.min(22, fittedFontSize(column.label, labelFrame, 22, 16, headingFamily, lineHeight));
      elements.push(
        textElement(column.label, labelFrame, labelSize, ctx.colors.onAccent, true, "left", headingFamily, {
          lineHeight,
        }),
      );
      column.flow.rows.forEach((row, index) => {
        const rowY = panelTop + headerHeight + pointsToNormalized(row.topPt, page.height);
        const rowHeight = pointsToNormalized(row.heightPt, page.height);
        const markerHeight = Math.min(0.05, rowHeight * 0.5);
        elements.push(
          rectElement(
            frameFromNormalized(
              {
                x: column.x,
                y: rowY + (rowHeight - markerHeight) / 2,
                width: 0.008,
                height: markerHeight,
              },
              page,
            ),
            colors.accent,
          ),
        );
        elements.push(
          textElement(
            column.items[index]!,
            frameFromNormalized(
              {
                x: column.x + MARKER_GUTTER,
                y: rowY,
                width: copyWidth,
                height: Math.max(0.02, rowHeight),
              },
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

    const centerX = chrome.content.x + chrome.content.width / 2;
    elements.push(verticalRule(centerX, panelTop, panelHeight, 0.0014, page, colors.borderStrong));

    return {
      elements,
      consumed: {
        title: true,
        body: true,
        items: 0,
        blockIds: [block.id],
      },
      conflicts: [],
    };
  },
};
