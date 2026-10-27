import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock, Emu, RectEmu } from "../../document-model";
import { layoutRectToNormalized, normalizedToLayoutRect } from "../geometry/coordinate-system";
import { layoutRows } from "../geometry/layout-functions";
import { resolveChrome } from "../page-chrome";
import { ellipseElement, rectElement, textElement, verticalRule } from "./elements";
import {
  anyEndsInOrphan,
  fittedFontSize,
  frameFromNormalized,
  headingMetrics,
  textFits,
  textHeightPt,
} from "./measure";
import { railStations } from "./rail-geometry";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type TimelineBlock = Extract<ContentBlock, { type: "timeline" }>;

const MIN_ITEMS = 3;
const MAX_ITEMS = 6;
const NODE_DIAMETER_IN = 0.2;
const LABEL_SIZE_PT = 20;
const TEXT_SIZE_PT = 20;
const MIN_TEXT_SIZE_PT = 12;
/** Below this size a row of stations breaks worse than a vertical rail does. */
const HORIZONTAL_MIN_TEXT_PT = 14;
/** A timeline block may use this share of the content height before copy shrinks. */
const CONTENT_FILL = 0.86;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

function pointsToNormalized(points: number, pageHeight: Emu): number {
  return points / 72 / (pageHeight / 914_400);
}

/** Deterministic rows for the vertical timeline fallback. */
export function timelineVerticalSlots(content: { x: number; y: number; width: number; height: number }, count: number) {
  return layoutRows(normalizedToLayoutRect(content), count, "sm");
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
    const titleMetrics = headingMetrics(ctx.tokens.type.titleTrackingPt);
    const titleSize = fittedFontSize(
      title,
      titleFrame,
      ctx.tokens.type.titlePt,
      18,
      headingFamily,
      lineHeight,
      titleMetrics,
    );
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight, titleMetrics)) {
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

    const contentHeight = chrome.contentBottom - contentTop;
    if (contentHeight < 0.25) return conflict("timeline", "时间线页没有足够的内容区");
    const contentSlot = normalizedToLayoutRect({
      x: chrome.content.x,
      y: contentTop,
      width: chrome.content.width,
      height: contentHeight,
    });
    const labelX = contentSlot.x / 1000;
    const labelWidth = Math.min(0.16, (contentSlot.width / 1000) * 0.2);
    const railX = (contentSlot.x + 180) / 1000;
    const textX = (contentSlot.x + 210) / 1000;
    const textWidth = Math.max(0.2, (contentSlot.x + contentSlot.width - 16) / 1000 - textX);

    // A landscape page reads a history left to right. The vertical rail put five
    // dates in a column on the left and left the other two thirds of the page
    // empty; a horizontal axis uses the width the page actually has.
    //
    // A row of stations only works while the columns are wide enough to set an
    // event without stranding its last character. Five or six stations across a
    // 16:9 page are not: the row would have to drop to 12pt to break cleanly,
    // which is smaller than the body copy around it. Those pages keep the
    // vertical rail, where the events get three quarters of the page width.
    const rowStations = railStations(chrome.content, block.items.length, "xl");
    const rowColumnPt = (rowStations[0]?.width ?? chrome.content.width) * pageWidthIn * 72;
    const readableRowSize = (() => {
      for (let size = TEXT_SIZE_PT; size >= MIN_TEXT_SIZE_PT; size -= 1) {
        if (
          !anyEndsInOrphan(
            block.items.map((item) => item.text),
            rowColumnPt,
            size,
            bodyFamily,
          )
        )
          return size;
      }
      return MIN_TEXT_SIZE_PT - 1;
    })();
    if (page.width / page.height >= 1.3 && readableRowSize >= HORIZONTAL_MIN_TEXT_PT) {
      const stations = rowStations;
      const columnWidth = stations[0]?.width ?? chrome.content.width;
      const diameter = 0.18;
      const diameterNorm = diameter / pageHeightIn;
      const labelGap = 0.022;
      const textGap = 0.012;
      const labelSizes = block.items.map((item) =>
        fittedFontSize(
          item.label,
          frameFromNormalized({ x: 0, y: 0, width: columnWidth, height: 0.08 }, page),
          LABEL_SIZE_PT,
          12,
          headingFamily,
          lineHeight,
        ),
      );
      const labelHeights = block.items.map((item, index) =>
        pointsToNormalized(
          textHeightPt(item.label, columnWidth * pageWidthIn * 72, labelSizes[index]!, headingFamily, lineHeight),
          page.height,
        ),
      );
      const textHeightsAt = (size: number) =>
        block.items.map((item) =>
          pointsToNormalized(
            textHeightPt(item.text, columnWidth * pageWidthIn * 72, size, bodyFamily, lineHeight),
            page.height,
          ),
        );
      // The orphan search picks a readable size; the height pass may only take
      // it down. Starting at 20pt unconditionally would let a large column
      // strand a character on its own line.
      let textSize = Math.min(TEXT_SIZE_PT, readableRowSize);
      let textHeights = textHeightsAt(textSize);
      const blockHeightAt = () =>
        Math.max(...labelHeights) + labelGap + diameterNorm + textGap + Math.max(...textHeights);
      while (textSize > MIN_TEXT_SIZE_PT && blockHeightAt() > contentHeight * CONTENT_FILL) {
        textSize -= 1;
        textHeights = textHeightsAt(textSize);
      }
      const blockHeight = blockHeightAt();
      if (blockHeight > contentHeight) return conflict("timeline", "时间线条目在内容区里放不下");
      const groupTop = contentTop + (contentHeight - blockHeight) / 2;
      const maxLabelHeight = Math.max(...labelHeights);
      const railY = groupTop + maxLabelHeight + labelGap + diameterNorm / 2;
      const textTop = railY + diameterNorm / 2 + textGap;
      elements.push(
        rectElement(
          frameFromNormalized(
            { x: chrome.content.x, y: railY - 0.003, width: chrome.content.width, height: 0.006 },
            page,
          ),
          colors.borderStrong,
        ),
      );
      block.items.forEach((item, index) => {
        const station = stations[index]!;
        elements.push(
          textElement(
            item.label,
            frameFromNormalized(
              {
                x: station.x,
                y: railY - diameterNorm / 2 - labelGap - labelHeights[index]!,
                width: station.width,
                height: Math.max(0.02, labelHeights[index]!),
              },
              page,
            ),
            labelSizes[index]!,
            colors.accent,
            true,
            "left",
            headingFamily,
            { lineHeight },
          ),
        );
        elements.push(
          ellipseElement(
            circleFrame(station.x * pageWidthIn, railY * pageHeightIn - diameter / 2, diameter),
            colors.accent,
          ),
        );
        elements.push(
          textElement(
            item.text,
            frameFromNormalized(
              { x: station.x, y: textTop, width: station.width, height: Math.max(0.02, textHeights[index]!) },
              page,
            ),
            textSize,
            colors.body,
            false,
            "left",
            bodyFamily,
            { contentRef: "decorative", lineHeight },
          ),
        );
      });
      return {
        elements,
        consumed: { title: true, body: true, items: 0, blockIds: [block.id] },
        conflicts: [],
      };
    }

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
    const rowSlots = timelineVerticalSlots(
      { x: chrome.content.x, y: contentTop, width: chrome.content.width, height: contentHeight },
      block.items.length,
    );
    while (textSize > MIN_TEXT_SIZE_PT && rowHeights.some((height, index) => height > rowSlots[index]!.height / 1000)) {
      textSize -= 1;
      rowHeights = measureRows(textSize);
    }
    if (rowHeights.some((height, index) => height > rowSlots[index]!.height / 1000)) {
      return conflict("timeline", "时间线条目在内容区里放不下");
    }
    const placedRows = rowSlots.map((slot, index) => {
      const normalized = layoutRectToNormalized(slot);
      const height = rowHeights[index]!;
      return { top: normalized.y + (normalized.height - height) / 2, height };
    });
    const firstNodeY = placedRows[0]!.top + Math.min(labelHeights[0]!, placedRows[0]!.height) / 2;
    const lastIndex = placedRows.length - 1;
    const lastNodeY =
      placedRows[lastIndex]!.top + Math.min(labelHeights[lastIndex]!, placedRows[lastIndex]!.height) / 2;
    elements.push(verticalRule(railX, firstNodeY, lastNodeY - firstNodeY, 0.006, page, colors.rule));

    block.items.forEach((item, index) => {
      const rowTop = placedRows[index]!.top;
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
