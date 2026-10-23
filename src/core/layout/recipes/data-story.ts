import type { IntentConflict } from "../../commands/design-intent";
import type { ContentBlock } from "../../document-model";
import { rectElement, textElement } from "./elements";
import { fittedFontSize, frameFromNormalized, textFits } from "./measure";
import type { LayoutRecipe, RecipeContext, RecipePlan } from "./types";

type MetricBlock = Extract<ContentBlock, { type: "metric" }>;

const TITLE = { x: 0.07, y: 0.09, width: 0.86, height: 0.14 };
const LEAD = { x: 0.07, y: 0.26, width: 0.8, height: 0.1 };
const RULE_Y = 0.38;
const VALUES_Y = 0.42;
const VALUES_HEIGHT = 0.27;
const LABELS_Y = 0.73;
const LABELS_HEIGHT = 0.1;
const METRICS_BOTTOM = 0.88;

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

export const dataStory: LayoutRecipe = {
  id: "data-story",

  supports(facts, concept, options) {
    if (!concept.recipes.includes("data-story")) return false;
    if (options.hasArtwork || options.hasAsset) return false;
    if (facts.layout === "cover" || facts.layout === "section" || facts.layout === "quote") return false;
    if (facts.hasQuote || facts.hasComparison) return false;
    if (facts.hasTimeline || facts.hasProcess || facts.hasTable) return false;
    return Boolean(facts.hasMetric);
  },

  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict } {
    const title = ctx.content.title.trim();
    if (!title) return conflict("title", "指标页没有标题");
    const metrics = (ctx.content.blocks ?? []).filter((block): block is MetricBlock => block.type === "metric");
    if (metrics.length === 0) return conflict("metrics", "该页没有可绘制的指标块");
    if (metrics.length > 3) return conflict("metrics", "指标页最多承载 3 个指标");

    const page = ctx.frame.page;
    const headingFamily = ctx.tokens.fonts.heading;
    const bodyFamily = ctx.tokens.fonts.body;
    const lineHeight = ctx.tokens.type.lineHeight;
    const titleFrame = frameFromNormalized(TITLE, page);
    const titleSize = fittedFontSize(title, titleFrame, ctx.tokens.type.titlePt, 18, headingFamily, lineHeight);
    if (!textFits(title, titleFrame, titleSize, headingFamily, lineHeight)) {
      return conflict("title", "指标页标题放不下");
    }

    const elements: RecipePlan["elements"] = [
      textElement(title, titleFrame, titleSize, ctx.colors.title, true, "left", headingFamily, {
        contentRef: "title",
        lineHeight,
      }),
    ];

    let bodyCovered = ctx.content.body.trim().length === 0;
    const body = ctx.content.body.trim();
    if (body) {
      // A body sentence that names all metrics is a summary of the same numbers;
      // drawing it again as a lead would duplicate the page's evidence.
      if (metrics.every((metric) => body.includes(metric.value) || body.includes(metric.label))) {
        bodyCovered = true;
      } else {
        const leadFrame = frameFromNormalized(LEAD, page);
        const leadSize = fittedFontSize(body, leadFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
        if (!textFits(body, leadFrame, leadSize, bodyFamily, lineHeight)) {
          return conflict("body", "指标页的说明文字放不下");
        }
        elements.push(
          textElement(body, leadFrame, leadSize, ctx.colors.body, false, "left", bodyFamily, {
            contentRef: "body",
            lineHeight,
          }),
        );
        bodyCovered = true;
      }
    }

    const columns = metrics.length;
    const gap = 0.035;
    const columnWidth = (0.86 - gap * (columns - 1)) / columns;
    const preferredValueSize = columns === 1 ? 96 : columns === 2 ? 72 : 56;
    for (let index = 0; index < metrics.length; index += 1) {
      const metric = metrics[index]!;
      const x = 0.07 + index * (columnWidth + gap);
      elements.push(
        rectElement(
          frameFromNormalized({ x, y: RULE_Y, width: Math.min(0.1, columnWidth * 0.3), height: 0.006 }, page),
          ctx.colors.accent,
        ),
      );
      const valueFrame = frameFromNormalized({ x, y: VALUES_Y, width: columnWidth, height: VALUES_HEIGHT }, page);
      const valueSize = fittedFontSize(metric.value, valueFrame, preferredValueSize, 28, headingFamily, lineHeight);
      if (!textFits(metric.value, valueFrame, valueSize, headingFamily, lineHeight)) {
        return conflict("metrics", `第 ${index + 1} 个指标数值放不下`);
      }
      elements.push(
        textElement(metric.value, valueFrame, valueSize, ctx.colors.accent, true, "left", headingFamily, {
          contentBlockRef: { blockId: metric.id, field: "value" },
          lineHeight,
        }),
      );

      const labelFrame = frameFromNormalized(
        { x, y: LABELS_Y, width: columnWidth, height: Math.min(LABELS_HEIGHT, METRICS_BOTTOM - LABELS_Y) },
        page,
      );
      const labelSize = fittedFontSize(metric.label, labelFrame, ctx.tokens.type.bodyPt, 12, bodyFamily, lineHeight);
      if (!textFits(metric.label, labelFrame, labelSize, bodyFamily, lineHeight)) {
        return conflict("metrics", `第 ${index + 1} 个指标标签放不下`);
      }
      elements.push(
        textElement(metric.label, labelFrame, labelSize, ctx.colors.body, false, "left", bodyFamily, {
          contentBlockRef: { blockId: metric.id, field: "label" },
          lineHeight,
        }),
      );
    }

    return {
      elements,
      consumed: {
        title: true,
        body: bodyCovered,
        items: 0,
        blockIds: metrics.map((metric) => metric.id),
      },
      conflicts: [],
    };
  },
};
