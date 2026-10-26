import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock, Emu, RectEmu } from "../../document-model";
import { resolveChrome } from "../page-chrome";
import { ellipseElement, rectElement, textElement, verticalRule } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits, textHeightPt } from "./measure";`nimport { railStations } from "./rail-geometry";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type ProcessBlock = Extract<ContentBlock, { type: "process" }>;

const MIN_STEPS = 3;
const MAX_STEPS = 6;
const NODE_DIAMETER_IN = 0.3;
const RAIL_OFFSET = 0.035;
const TEXT_OFFSET = 0.06;
const MIN_GAP_PT = 12;
const MAX_GAP_PT = 32;
const LABEL_SIZE_PT = 20;
const TEXT_SIZE_PT = 16;
const MIN_TEXT_SIZE_PT = 12;

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

export const processRail: LayoutRecipe = {
  id: "process-rail",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("process-rail")) return false;
    if (options.hasAsset) return false;
    if (!facts.hasProcess) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    return true;
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "流程页没有标题");
    const block = ctx.content.blocks?.find((candidate): candidate is ProcessBlock => candidate.type === "process");
    if (!block) return conflict("process", "该页没有 process 内容块");
    if (block.items.length < MIN_STEPS || block.items.length > MAX_STEPS) {
      return conflict("process", `流程轨只接受 ${MIN_STEPS}–${MAX_STEPS} 步`);
    }

    const page = ctx.frame.page;
    const pageHeightIn = page.height / 914_400;
    const pageWidthIn = page.width / 914_400;
    const chrome = resolveChrome(ctx);
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleLineHeight = ctx.tokens.type.titleLineHeight;
    const colors = ctx.colors;

    const titleFrame = frameFromNormalized(chrome.title, page);
    const titleSize = fittedFontSize(title, titleFrame, ctx.tokens.type.titlePt, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "流程页标题放不下");
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
        return conflict("body", "流程页引导段放不下");
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

    const railX = chrome.content.x + RAIL_OFFSET;
    const textX = railX + TEXT_OFFSET;
    const textWidth = Math.max(0.2, chrome.content.x + chrome.content.width - textX - 0.02);
    const contentHeight = chrome.contentBottom - contentTop;
    if (contentHeight < 0.25) return conflict("process", "流程页没有足够的内容区");

    // A landscape page has room for the steps side by side. The vertical rail
    // used to put four short steps in the left fifth of a 16:9 page and leave
    // the rest blank: it read as a list squeezed into a corner. Tall pages keep
    // the vertical rail, where a row of four columns would be unreadable.
    if (page.width / page.height >= 1.3) {
      const columns = block.items.length;
      const gap = 0.045;
      const stations = railStations(chrome.content, columns, gap);
      const columnWidth = stations[0]?.width ?? chrome.content.width;
      const diameter = 0.26;
      // The circle is a length (inches) while everything else here is a share
      // of the page height. Converting once keeps the node on the rail and the
      // labels under it instead of a third of a page away.
      const diameterNorm = diameter / pageHeightIn;
      const labelGap = 0.03;
      const textGap = 0.008;
      const labelSizes = block.items.map((item) =>
        fittedFontSize(
          item.label,
          frameFromNormalized({ x: 0, y: 0, width: columnWidth, height: 0.12 }, page),
          LABEL_SIZE_PT,
          14,
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
      let textSize = Math.min(TEXT_SIZE_PT, 15);
      let textHeights = textHeightsAt(textSize);
      const blockHeightAt = () =>
        diameterNorm + labelGap + Math.max(...labelHeights) + textGap + Math.max(...textHeights);
      while (textSize > MIN_TEXT_SIZE_PT && blockHeightAt() > contentHeight) {
        textSize -= 1;
        textHeights = textHeightsAt(textSize);
      }
      const blockHeight = blockHeightAt();
      if (blockHeight > contentHeight) {
        return conflict("process", "流程步骤在内容区里放不下");
      }
      const groupTop = contentTop + (contentHeight - blockHeight) / 2;
      const railY = groupTop + diameterNorm / 2;
      elements.push(
        rectElement(
          frameFromNormalized(
            { x: chrome.content.x, y: railY - 0.003, width: chrome.content.width, height: 0.006 },
            page,
          ),
          colors.accent,
        ),
      );
      block.items.forEach((item, index) => {
        const x = stations[index]?.x ?? chrome.content.x;
        const node = circleFrame(x * pageWidthIn, railY * pageHeightIn - diameter / 2, diameter);
        elements.push(ellipseElement(node, colors.accent));
        elements.push(
          textElement(String(index + 1).padStart(2, "0"), node, 11, "#FFFFFF", true, "center", headingFamily, {
            lineHeight: 1,
          }),
        );
        const labelTop = railY + diameterNorm / 2 + labelGap;
        elements.push(
          textElement(
            item.label,
            frameFromNormalized(
              { x, y: labelTop, width: columnWidth, height: Math.max(0.02, labelHeights[index]!) + 0.004 },
              page,
            ),
            labelSizes[index]!,
            colors.title,
            true,
            "left",
            headingFamily,
            { lineHeight },
          ),
        );
        elements.push(
          textElement(
            item.text,
            frameFromNormalized(
              {
                x,
                y: labelTop + labelHeights[index]! + textGap,
                width: columnWidth,
                height: Math.max(0.02, textHeights[index]!),
              },
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
    const labelSizes = block.items.map((item) =>
      fittedFontSize(
        item.label,
        frameFromNormalized({ x: textX, y: contentTop, width: textWidth, height: 0.12 }, page),
        LABEL_SIZE_PT,
        14,
        headingFamily,
        lineHeight,
      ),
    );
    const labelHeights = block.items.map((item, index) =>
      pointsToNormalized(
        textHeightPt(item.label, textWidth * pageWidthIn * 72, labelSizes[index]!, headingFamily, lineHeight),
        page.height,
      ),
    );
    const measureRows = (size: number) =>
      block.items.map(
        (item, index) =>
          labelHeights[index]! +
          0.008 +
          pointsToNormalized(
            textHeightPt(item.text, textWidth * pageWidthIn * 72, size, bodyFamily, lineHeight),
            page.height,
          ),
      );
    let rowHeights = measureRows(textSize);
    const total = (rows: number[], gap: number) =>
      rows.reduce((sum, height) => sum + height, 0) + gap * (rows.length - 1);
    const minGap = pointsToNormalized(MIN_GAP_PT, page.height);
    // Shrink the descriptions before shrinking the labels: the step name is the
    // reading anchor, the sentence is what gives way.
    while (textSize > MIN_TEXT_SIZE_PT && total(rowHeights, minGap) > contentHeight) {
      textSize -= 1;
      rowHeights = measureRows(textSize);
    }
    if (total(rowHeights, minGap) > contentHeight) {
      return conflict("process", "流程步骤在内容区里放不下");
    }
    const leftover = contentHeight - total(rowHeights, minGap);
    const gap = Math.min(
      pointsToNormalized(MAX_GAP_PT, page.height),
      minGap + leftover / Math.max(1, rowHeights.length - 1),
    );
    const groupHeight = total(rowHeights, gap);
    const groupTop = contentTop + (contentHeight - groupHeight) / 2;
    elements.push(verticalRule(railX, groupTop, groupHeight, 0.006, page, colors.accent));

    let rowTop = groupTop;
    block.items.forEach((item, index) => {
      const labelSize = labelSizes[index]!;
      const labelHeight = labelHeights[index]!;
      const textHeight = Math.max(0.02, rowHeights[index]! - labelHeight - 0.008);
      const nodeCenterX = railX;
      const nodeCenterY = rowTop + labelHeight / 2;
      const node = circleFrame(
        nodeCenterX * pageWidthIn - NODE_DIAMETER_IN / 2,
        nodeCenterY * pageHeightIn - NODE_DIAMETER_IN / 2,
        NODE_DIAMETER_IN,
      );
      elements.push(ellipseElement(node, colors.accent));
      elements.push(
        textElement(String(index + 1).padStart(2, "0"), node, 12, "#FFFFFF", true, "center", headingFamily, {
          lineHeight: 1,
        }),
      );
      elements.push(
        textElement(
          item.label,
          frameFromNormalized({ x: textX, y: rowTop, width: textWidth, height: labelHeight }, page),
          labelSize,
          colors.title,
          true,
          "left",
          headingFamily,
          { lineHeight },
        ),
      );
      elements.push(
        textElement(
          item.text,
          frameFromNormalized(
            { x: textX, y: rowTop + labelHeight + 0.008, width: textWidth, height: textHeight },
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
      rowTop += rowHeights[index]! + gap;
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
