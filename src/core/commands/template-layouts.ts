/**
 * Template layout selection.
 *
 * A PPTX template expresses its design intent through named layouts that carry
 * placeholder geometry. Layout names are frequently localized (Chinese vendor
 * templates ship "内页（浅色）1", "篇章页1", "封面1"), so selection cannot rely on
 * English keywords alone: it has to combine the name with the geometry the
 * layout actually declares.
 */

import type { SlideLayoutCapabilities } from "../document-model";
import type { BackgroundRange } from "../rendering/contrast";
import type { PageDesignPlan } from "../design/design-plan";
import type { RecipeId } from "../design/deck-concept";
import type { AiComposition, AiDensityTarget, AiEmphasis, AiPalette } from "./design-intent";
import type { AiVisualAsset } from "./visual-asset";
import type { AiVisualNarrative } from "./visual-narrative";

export interface AiNormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type AiLayoutKind = "cover" | "title-body" | "split" | "cards" | "quote" | "section" | "summary";
/**
 * What a repair acts on.
 *
 * "title" and "body" name a role. "region" names a rectangle on the page: the
 * review model looks at a picture, so the only thing it can honestly point at
 * is a place. A region repair applies to every generated element that falls
 * inside that rectangle.
 */
export type AiElementRepairTarget = "title" | "body" | "region";
export type AiElementRepair =
  | {
      action: "move" | "resize";
      target: AiElementRepairTarget;
      /** For a region: the place the block is now. For a role: the new place. */
      frame: AiNormalizedRect;
      /**
       * For a region: where the block should go. Without it a move has no
       * destination, so the action is skipped rather than guessed.
       */
      to?: AiNormalizedRect;
    }
  | {
      action: "restyle";
      target: AiElementRepairTarget;
      /** For a region: the rectangle whose text is restyled. */
      frame?: AiNormalizedRect;
      fontScale?: number;
      color?: string;
      /** Template theme font a repair may restore. */
      fontFamily?: string;
      /** Paragraph alignment a repair may restore. */
      textAlign?: "left" | "center" | "right";
      /** Line height multiple a repair may restore. */
      lineHeight?: number;
    }
  /** Aligns the target to an edge of the given frame. */
  | { action: "align"; target: AiElementRepairTarget; frame: AiNormalizedRect; axis?: "left" | "top" }
  | { action: "changeLayout"; layout: AiLayoutKind };
export interface AiSlideDesign {
  layout: AiLayoutKind;
  background: string;
  accent: string;
  titleColor: string;
  bodyColor: string;
  /**
   * The composition family the page asked for. The renderer checks the request
   * against the reviewed content and refuses it when the content cannot carry
   * it, so this is an intent and never a command.
   */
  composition?: AiComposition;
  /**
   * The deterministic page recipe that draws this page. Absent means legacy
   * composition selection; an unknown or illegal recipe is refused and the
   * renderer falls back to the legacy branch.
   */
  recipe?: RecipeId;
  /**
   * The semantic plan written by the design agent. When present the compiler
   * owns the page geometry; `recipe` remains a hint for old plans.
   */
  designPlan?: PageDesignPlan;
  /** A recipe-local variant, for example a mirrored split. */
  variant?: "left" | "right";
  /** Which element the recipe should treat as the page's first visual entry. */
  focal?: "title" | "index" | "body";
  /** The page's communication strategy; layout and coordinates remain deterministic. */
  visualNarrative?: AiVisualNarrative;
  /** Which level of the hierarchy carries the weight of the page. */
  emphasis?: AiEmphasis;
  /** How much white space the page is willing to spend. */
  densityTarget?: AiDensityTarget;
  /**
   * The slots of the template palette the page paints itself with. The model
   * picks a slot instead of a colour value, so the generated deck stays inside
   * the palette of its template while the choice still has an effect.
   */
  palette?: AiPalette;
  /**
   * Whether this page carries a picture, and what the picture shows.
   *
   * The model decides that a page wants an image and describes the image; the
   * renderer decides where the image goes. A model that placed pictures by
   * hand would produce pages nobody can edit.
   */
  visualAsset?: AiVisualAsset;
  safeRegion?: AiNormalizedRect;
  obstacleRegions?: AiNormalizedRect[];
  hierarchyAction?: "keep" | "strengthen-title" | "reduce-density" | "increase-whitespace";
  /**
   * - "none": keep the rendered template artwork as the page background.
   * - "local-scrim": keep the artwork but lay a solid panel behind the text block.
   * - "simplify": drop the artwork and fall back to the template's flat background.
   */
  backgroundTreatment?: "none" | "local-scrim" | "simplify";
  /**
   * When true the design's own colors win over the ink the template assigned
   * to its placeholders. The contrast repair sets this, because a repair that
   * the template ink always overrules could never take effect.
   */
  inkOverride?: boolean;
  elementRepairs?: AiElementRepair[];
}
export interface AiTemplateRegion {
  role: "title" | "body" | "image";
  frame: AiNormalizedRect;
  /** Ink the template designer assigned to this placeholder. */
  textColor?: string;
  /** Font size in points the template designer assigned to this placeholder. */
  fontSizePt?: number;
}
export interface AiTemplateDecoration {
  shape: "rectangle" | "ellipse";
  fill: string;
  frame: AiNormalizedRect;
}
export interface AiTemplateLayout {
  index: number;
  name?: string;
  backgroundColor?: string;
  backgroundImageDataUrl?: string;
  decorations?: AiTemplateDecoration[];
  regions: AiTemplateRegion[];
  /** Luminance range of the rendered artwork under the title and content placeholders. */
  backgroundLuminance?: { title?: BackgroundRange; body?: BackgroundRange };
}

export type TemplateLayoutIntent = "cover" | "section" | "split" | "cards" | "quote" | "image" | "body";

export interface BackgroundRhythm {
  coverVariants: number;
  contentVariants: number;
  repeatLimit: number;
}

export const DEFAULT_BACKGROUND_RHYTHM: BackgroundRhythm = { coverVariants: 1, contentVariants: 3, repeatLimit: 2 };

/**
 * Localized and English layout names that express the same intent. Chinese vendor
 * templates do not contain "cover" or "content", so matching on English alone left
 * every layout of the 昆佰泰 template scoring zero.
 */
const INTENT_KEYWORDS: Record<TemplateLayoutIntent, readonly string[]> = {
  cover: ["title slide", "cover", "封面", "标题幻灯片", "扉页"],
  section: ["section", "章节", "节标题", "篇章", "过渡", "分隔"],
  split: ["comparison", "two content", "双栏", "比较", "对比", "两栏", "左右"],
  cards: ["content", "卡片", "流程", "时间线", "要点", "内页"],
  quote: ["quote", "引言", "引用", "金句"],
  image: ["picture", "image", "photo", "图文", "图片", "图像", "配图"],
  body: ["title and content", "标题和内容", "正文", "内页", "图文", "content"],
};

/** A content area large enough to carry a page of readable body copy. */
const WIDE_CONTENT_MIN_WIDTH = 0.55;
const WIDE_CONTENT_MIN_HEIGHT = 0.2;
/** A title placeholder large enough to hold a real heading instead of a sliver. */
const USABLE_TITLE_MIN_WIDTH = 0.3;
const USABLE_TITLE_MIN_HEIGHT = 0.045;

export function titleRegionOf(regions: AiTemplateRegion[]): AiTemplateRegion | undefined {
  return regions.find((region) => region.role === "title");
}

export function bodyRegionsOf(regions: AiTemplateRegion[]): AiTemplateRegion[] {
  return regions.filter((region) => region.role === "body");
}

/**
 * The body region that actually carries page content. Templates commonly declare
 * a short subtitle placeholder next to the real content area, and the first body
 * region in document order is that subtitle, not the content box.
 */
export function contentRegionOf(regions: AiTemplateRegion[]): AiTemplateRegion | undefined {
  return [...bodyRegionsOf(regions)].sort(
    (left, right) => right.frame.width * right.frame.height - left.frame.width * left.frame.height,
  )[0];
}

/** Two body regions that sit side by side and can carry a two-column page. */
export function columnRegionsOf(regions: AiTemplateRegion[]): [AiTemplateRegion, AiTemplateRegion] | undefined {
  const bodies = bodyRegionsOf(regions).filter((region) => region.frame.width >= 0.18 && region.frame.height >= 0.18);
  for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
      const first = bodies[leftIndex]!;
      const second = bodies[rightIndex]!;
      const left = first.frame.x <= second.frame.x ? first : second;
      const right = left === first ? second : first;
      if (left.frame.x + left.frame.width <= right.frame.x + 0.01 && Math.abs(left.frame.y - right.frame.y) < 0.18)
        return [left, right];
    }
  }
  return undefined;
}

export function templateTitleRegion(layout: AiTemplateLayout): AiTemplateRegion | undefined {
  return titleRegionOf(layout.regions);
}

export function templateBodyRegions(layout: AiTemplateLayout): AiTemplateRegion[] {
  return bodyRegionsOf(layout.regions);
}

export function templateContentRegion(layout: AiTemplateLayout): AiTemplateRegion | undefined {
  return contentRegionOf(layout.regions);
}

/** The picture placeholder of a layout, when the template has one. */
export function templateImageRegion(layout: AiTemplateLayout): AiTemplateRegion | undefined {
  return layout.regions.find((region) => region.role === "image");
}

export function templateColumnRegions(layout: AiTemplateLayout): [AiTemplateRegion, AiTemplateRegion] | undefined {
  return columnRegionsOf(layout.regions);
}

export function templateRectsOverlap(left: AiNormalizedRect, right: AiNormalizedRect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

/**
 * Whether the template already prints something in the footer band.
 *
 * A slide-number, date or footer placeholder arrives as a thin text-bearing
 * shape at the bottom of the layout. The analyzer has no role for it, so it is
 * read as a body region; drawing a generated page number on top of it would
 * print two numbers on the same line.
 */
export function templateLayoutHasFooterMarker(layout: AiTemplateLayout): boolean {
  return layout.regions.some((region) => region.frame.y >= 0.9 && region.frame.height <= 0.09);
}

/** A layout is unusable when its title collides with one of its own body placeholders. */
export function templateRegionsCollide(layout: AiTemplateLayout): boolean {
  const title = templateTitleRegion(layout);
  if (!title) return true;
  return templateBodyRegions(layout).some((body) => templateRectsOverlap(title.frame, body.frame));
}

function isWideContent(frame: AiNormalizedRect | undefined): boolean {
  return Boolean(frame && frame.width >= WIDE_CONTENT_MIN_WIDTH && frame.height >= WIDE_CONTENT_MIN_HEIGHT);
}

function nameMatches(layout: AiTemplateLayout, intent: TemplateLayoutIntent): boolean {
  const name = (layout.name ?? "").toLowerCase();
  return INTENT_KEYWORDS[intent].some((keyword) => name.includes(keyword));
}

/**
 * Layouts that can physically carry the requested intent. Geometry is the hard
 * filter, the name only breaks ties between equally usable layouts.
 */
export function templateLayoutCandidates(
  layouts: AiTemplateLayout[],
  intent: TemplateLayoutIntent,
): AiTemplateLayout[] {
  const titled = layouts.filter((layout) => templateTitleRegion(layout));
  // A layout whose own title collides with its body can never carry editable
  // text, so it is dropped instead of being used as a last resort.
  const pool = titled.filter((layout) => !templateRegionsCollide(layout));
  switch (intent) {
    case "cover":
    case "section":
      return pool;
    case "split": {
      const columns = pool.filter((layout) => templateColumnRegions(layout));
      if (columns.length > 0) return columns;
      // Without real columns the page still needs a content shaped layout; a
      // cover or back cover would squeeze the copy into its subtitle slot.
      const wide = pool.filter((layout) => isWideContent(templateContentRegion(layout)?.frame));
      return wide.length > 0 ? wide : pool.filter((layout) => templateContentRegion(layout));
    }
    case "quote":
      return pool;
    case "image": {
      // A layout with a real picture placeholder is the only one that can carry
      // a generated image without covering the copy. When the template has
      // none, fall back to a body layout and let the legacy branch draw the page.
      const withImage = pool.filter((layout) => templateImageRegion(layout) && templateContentRegion(layout));
      if (withImage.length > 0) return withImage;
      const wide = pool.filter((layout) => isWideContent(templateContentRegion(layout)?.frame));
      return wide.length > 0 ? wide : pool.filter((layout) => templateContentRegion(layout));
    }
    default: {
      const wide = pool.filter((layout) => isWideContent(templateContentRegion(layout)?.frame));
      return wide.length > 0 ? wide : pool.filter((layout) => templateContentRegion(layout));
    }
  }
}

export function templateLayoutScore(layout: AiTemplateLayout, intent: TemplateLayoutIntent): number {
  const keyword = nameMatches(layout, intent);
  const content = templateContentRegion(layout)?.frame;
  const title = templateTitleRegion(layout)?.frame;
  const usableTitle = Boolean(
    title && title.width >= USABLE_TITLE_MIN_WIDTH && title.height >= USABLE_TITLE_MIN_HEIGHT,
  );
  switch (intent) {
    case "cover":
      return (keyword ? 100 : 0) + (content && !isWideContent(content) ? 20 : 0);
    case "section":
      return (keyword ? 100 : 0) + (content && !isWideContent(content) ? 15 : 0);
    case "split":
      return (keyword ? 100 : 0) + (templateColumnRegions(layout) ? 40 : 0) + (isWideContent(content) ? 20 : 0);
    case "quote":
      return (keyword ? 100 : 0) + (isWideContent(content) ? 20 : 0);
    case "image":
      return (
        (keyword ? 80 : 0) +
        (templateImageRegion(layout) ? 40 : 0) +
        (isWideContent(content) ? 20 : 0) +
        (usableTitle ? 10 : 0)
      );
    default:
      return (keyword ? 40 : 0) + (isWideContent(content) ? 40 : 0) + (usableTitle ? 20 : 0);
  }
}

/**
 * Chooses one template layout per slide.
 *
 * The result is a sequence, not an independent pick per slide: consecutive pages
 * should not repeat the same artwork, and the same layout should not appear more
 * than `repeatLimit` times in a row. `contentVariants`/`coverVariants` bound how
 * many distinct layouts the rotation may draw from.
 */
export function planTemplateLayouts(input: {
  layouts: AiTemplateLayout[];
  intents: TemplateLayoutIntent[];
  rhythm?: BackgroundRhythm;
}): Array<AiTemplateLayout | undefined> {
  const rhythm = input.rhythm ?? DEFAULT_BACKGROUND_RHYTHM;
  const usage = new Map<number, number>();
  let previousIndex: number | undefined;
  let previousRun = 0;
  return input.intents.map((intent) => {
    const candidates = templateLayoutCandidates(input.layouts, intent);
    if (candidates.length === 0) return undefined;
    const variantCount = Math.max(1, intent === "cover" ? rhythm.coverVariants : rhythm.contentVariants);
    const pool = [...candidates]
      .sort(
        (left, right) =>
          templateLayoutScore(right, intent) - templateLayoutScore(left, intent) || left.index - right.index,
      )
      .slice(0, variantCount);
    const eligible = pool.filter((layout) => !(layout.index === previousIndex && previousRun >= rhythm.repeatLimit));
    const usable = eligible.length > 0 ? eligible : pool;
    const chosen = [...usable].sort((left, right) => {
      const leftUsage = usage.get(left.index) ?? 0;
      const rightUsage = usage.get(right.index) ?? 0;
      if (leftUsage !== rightUsage) return leftUsage - rightUsage;
      const score = templateLayoutScore(right, intent) - templateLayoutScore(left, intent);
      if (score !== 0) return score;
      return left.index - right.index;
    })[0];
    if (!chosen) return undefined;
    usage.set(chosen.index, (usage.get(chosen.index) ?? 0) + 1);
    if (chosen.index === previousIndex) previousRun += 1;
    else {
      previousIndex = chosen.index;
      previousRun = 1;
    }
    return chosen;
  });
}

/**
 * What a layout can hold, read from its placeholders.
 *
 * The regions themselves are not persisted — they describe one rendering of the
 * template — but what they mean for composition is: a page that needs a picture
 * cannot use a layout that has no picture placeholder. Persisting the summary
 * is what lets the export say so (FR-V3 的前置).
 */
export function layoutCapabilities(regions: readonly AiTemplateRegion[]): SlideLayoutCapabilities {
  const bodies = regions.filter((region) => region.role === "body").length;
  return {
    hasTitle: regions.some((region) => region.role === "title"),
    hasBody: bodies > 0,
    hasImage: regions.some((region) => region.role === "image"),
    columns: bodies >= 2 ? 2 : 1,
    free: bodies === 0,
  };
}
