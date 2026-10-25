import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock, Emu, RectEmu } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { ellipseElement, rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits, textHeightPt } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type TimelineBlock = Extract<ContentBlock, { type: "timeline" }>;

const MIN_ITEMS = 3;
const MAX_ITEMS = 6;
const LABEL_WIDTH = 0.16;
const RAIL_OFFSET = 0.18;
const TEXT_OFFSET = 0.21;
const NODE_DIAMETER_IN = 0.12;
const LABEL_SIZE_PT = 16;
const TEXT_SIZE_PT = 16;
const MIN_TEXT_SIZE_PT = 12;
const MIN_GAP_PT = 12;
const MAX_GAP_PT = 28;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

function circleFrame(x: number, y: number, diameterIn: number): RectEmu {
  const size = Math.round(diameterIn * 914_400);
  return {
    x: Math.round(x * 914_400) as Emu,
    y: Math.round(y * 914_400) as Emu,
    width: size as Emu,
    height: size as Emu,
  };
}

export const timelineRail: LayoutRecipe = {
  id: "timeline-rail",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("timeline-rail")) return false;
    if (options.hasAsset) return false;
    if (!facts.hasTimeline) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    return true;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "时间线页没有标题");
    const block = ctx.content.blocks?.find((candidate): candidate is TimelineBlock => candidate.type === "timeline");
    if (!block) return conflict("timeline", "该页没有 timeline 内容块");
    if (block.items.length < MIN_ITEMS || block.items.length > MAX_ITEMS) {
      return conflict("timeline", `时间线只接受 ${MIN_ITEMS}–${MAX_ITEMS} 条`);
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
      return conflict("title", "时间线页标题放不下");
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
          width: chrome.content.width,
          height: Math.min(0.1, chrome.content.height * 0.18),
        },
        page,
      );
      const leadSize = fittedFontSize(lead, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(lead, leadFrame, leadSize, bodyFamily, lineHeight)) {
        return conflict("body", "时间线页引导段放不下");
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

    const labelX = chrome.content.x;
    const labelWidth = Math.min(LABEL_WIDTH, chrome.content.width * 0.2);
    const railX = chrome.content.x + RAIL_OFFSET;
    const textX = chrome.content.x + TEXT_OFFSET;
    const textWidth = Math.max(0.2, chrome.content.x + chrome.content.width - textX - 0.02);
    const contentHeight = chrome.contentBottom - contentTop;
    if (contentHeight < 0.25) return conflict("timeline", "时间线页没有足够的内容区");

    let textSize = TEXT_SIZE_PT;
    const labelSize = LABEL_SIZE_PT;
    const labelHeights = block.items.map((item) =>
      pointsToNormalized(
        textHeightPt(item.label, labelWidth * pageWidthIn * 72, labelSize, headingFamily, lineHeight),
        page.height,
      ),
    );
    const measureRows = (size: number) =>
      block.items.map(
        (item, index) =>
          Math.max(
            labelHeights[index]!,
            pointsToNormalized(
              textHeightPt(item.text, textWidth * pageWidthIn * 72, size, bodyFamily, lineHeight),
              page.height,
            ),
          ) + 0.008,
      );
    let rowHeights = measureRows(textSize);
    const total = (rows: number[], gap: number) =>
      rows.reduce((sum, height) => sum + height, 0) + gap * (rows.length - 1);
    const minGap = pointsToNormalized(MIN_GAP_PT, page.height);
    while (textSize > MIN_TEXT_SIZE_PT && total(rowHeights, minGap) > contentHeight) {
      textSize -= 1;
      rowHeights = measureRows(textSize);
    }
    if (total(rowHeights, minGap) > contentHeight) {
      return conflict("timeline", "时间线条目在内容区里放不下");
    }
    const leftover = contentHeight - total(rowHeights, minGap);
    const gap = Math.min(
      pointsToNormalized(MAX_GAP_PT, page.height),
      minGap + leftover / Math.max(1, rowHeights.length - 1),
    );
    const groupHeight = total(rowHeights, gap);
    const groupTop = contentTop + (contentHeight - groupHeight) / 2;
    elements.push(verticalRule(railX, groupTop, groupHeight, 0.006, page, colors.rule));

    let rowTop = groupTop;
    block.items.forEach((item, index) => {
      const rowHeight = rowHeights[index]!;
      const nodeCenterY = rowTop + Math.min(labelHeights[index]!, rowHeight) / 2;
      const node = circleFrame(
        railX * pageWidthIn - NODE_DIAMETER_IN / 2,
        nodeCenterY * pageHeightIn - NODE_DIAMETER_IN / 2,
        NODE_DIAMETER_IN,
      );
      elements.push(ellipseElement(node, colors.accent));
      elements.push(
        textElement(
          item.label,
          frameFromNormalized(
            { x: labelX, y: rowTop, width: Math.max(0.05, railX - labelX - 0.03), height: rowHeight },
            page,
          ),
          labelSize,
          colors.accent,
          true,
          "right",
          headingFamily,
          { lineHeight },
        ),
      );
      elements.push(
        textElement(
          item.text,
          frameFromNormalized({ x: textX, y: rowTop, width: textWidth, height: rowHeight }, page),
          textSize,
          colors.body,
          false,
          "left",
          bodyFamily,
          { contentRef: "decorative", lineHeight },
        ),
      );
      rowTop += rowHeight + gap;
    });

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
