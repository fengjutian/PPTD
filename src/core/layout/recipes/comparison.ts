import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock, Emu } from "../../document-model";
import { layoutFlow } from "../../rendering/flow";
import { resolveChrome } from "../page-chrome";
import { ellipseElement, rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type ComparisonBlock = Extract<ContentBlock, { type: "comparison" }>;

const MIN_ITEMS = 2;
const MAX_ITEMS = 5;
const HEADER_IN = 0.36;
const PANEL_PADDING_IN = 0.22;
const ITEM_SIZE_PT = 18;
const MIN_ITEM_SIZE_PT = 14;
const MIN_GAP_PT = 10;
const MAX_GAP_PT = 18;
const MARKER_GUTTER = 0.022;
const VS_DIAMETER_IN = 0.42;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

function circleFrame(x: number, y: number, diameterIn: number) {
  const size = Math.round(diameterIn * 914_400);
  return {
    x: Math.round(x * 914_400) as Emu,
    y: Math.round(y * 914_400) as Emu,
    width: size as Emu,
    height: size as Emu,
  };
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
    const colors = ctx.colors;

    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleSize = fittedFontSize(title, titleFrame, ctx.tokens.type.titlePt, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "对比页标题放不下");
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
        {
          x: chrome.content.x,
          y: contentTop,
          width: chrome.content.width,
          height: Math.min(0.1, chrome.content.height * 0.18),
        },
        page,
      );
      const leadSize = fittedFontSize(lead, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
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

    const gap = 0.04;
    const columnWidth = (chrome.content.width - gap) / 2;
    const paddingX = PANEL_PADDING_IN / pageWidthIn;
    const paddingY = PANEL_PADDING_IN / pageHeightIn;
    const headerHeight = HEADER_IN / pageHeightIn;
    const copyWidth = Math.max(0.12, columnWidth - paddingX * 2 - MARKER_GUTTER);
    const availableHeight = chrome.contentBottom - contentTop;
    if (availableHeight < 0.3) return conflict("comparison", "对比页没有足够的内容区");

    const flowFor = (items: string[], size: number) =>
      layoutFlow({
        items,
        widthPt: copyWidth * pageWidthIn * 72,
        availableHeightPt: availableHeight * pageHeightIn * 72,
        preferredFontSizePt: size,
        minimumFontSizePt: size,
        minimumGapPt: MIN_GAP_PT,
        maximumGapPt: MAX_GAP_PT,
        verticalAlign: "top",
        lineHeightRatio: lineHeight,
        fontFamily: bodyFamily,
      });

    let itemSize = ITEM_SIZE_PT;
    let leftFlow = flowFor(leftItems, itemSize);
    let rightFlow = flowFor(rightItems, itemSize);
    while (
      itemSize > MIN_ITEM_SIZE_PT &&
      (leftFlow.overflow ||
        rightFlow.overflow ||
        Math.max(leftFlow.totalHeightPt, rightFlow.totalHeightPt) >
          (availableHeight - headerHeight - paddingY * 2) * pageHeightIn * 72)
    ) {
      itemSize -= 1;
      leftFlow = flowFor(leftItems, itemSize);
      rightFlow = flowFor(rightItems, itemSize);
    }
    if (leftFlow.overflow || rightFlow.overflow) return conflict("comparison", "对比要点在栏内放不下");

    const measuredCopy = Math.max(leftFlow.totalHeightPt, rightFlow.totalHeightPt) / (pageHeightIn * 72);
    const minimumCopy = Math.max(0.18, (availableHeight - headerHeight - paddingY * 2) * 0.45);
    const copyHeight = Math.min(availableHeight - headerHeight - paddingY * 2, Math.max(minimumCopy, measuredCopy));
    if (copyHeight <= 0) return conflict("comparison", "对比面板高度不足");
    const panelHeight = Math.min(availableHeight, headerHeight + paddingY * 2 + copyHeight);
    const panelTop = contentTop + (availableHeight - panelHeight) / 2;

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
      elements.push(
        rectElement(
          frameFromNormalized({ x: column.x, y: panelTop, width: columnWidth, height: panelHeight }, page),
          colors.card ?? colors.background,
        ),
      );
      elements.push(
        rectElement(
          frameFromNormalized({ x: column.x, y: panelTop, width: columnWidth, height: headerHeight }, page),
          colors.accent,
        ),
      );
      elements.push(
        textElement(
          column.label,
          frameFromNormalized(
            { x: column.x + 0.02, y: panelTop, width: columnWidth - 0.04, height: headerHeight },
            page,
          ),
          20,
          "#FFFFFF",
          true,
          "center",
          headingFamily,
          { lineHeight },
        ),
      );
      const rowsTop =
        panelTop + headerHeight + paddingY + (copyHeight - column.flow.totalHeightPt / (pageHeightIn * 72)) / 2;
      column.flow.rows.forEach((row, index) => {
        const rowY = rowsTop + pointsToNormalized(row.topPt, page.height);
        const rowHeight = pointsToNormalized(row.heightPt, page.height);
        const markerHeight = Math.min(0.05, rowHeight * 0.5);
        elements.push(
          rectElement(
            frameFromNormalized(
              {
                x: column.x + paddingX,
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
                x: column.x + paddingX + MARKER_GUTTER,
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
    elements.push(verticalRule(centerX, panelTop, panelHeight, 0.0014, page, colors.rule));
    const vsFrame = circleFrame(
      centerX * pageWidthIn - VS_DIAMETER_IN / 2,
      (panelTop + panelHeight / 2) * pageHeightIn - VS_DIAMETER_IN / 2,
      VS_DIAMETER_IN,
    );
    elements.push(ellipseElement(vsFrame, colors.accent));
    elements.push(textElement("VS", vsFrame, 14, "#FFFFFF", true, "center", headingFamily, { lineHeight: 1 }));

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
