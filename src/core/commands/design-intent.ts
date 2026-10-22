/**
 * The design intent an AI may express.
 *
 * The model never decides coordinates: ADR 0003 puts the geometry of a page
 * into a deterministic layout engine, because a model that places boxes by
 * hand produces pages nobody can edit. What the model may decide is the shape
 * of the page — which composition family it belongs to, which level of the
 * hierarchy carries the weight, how much white space the page is willing to
 * spend, and which slot of the template palette it paints itself with.
 *
 * Every field here is an intent, never a measurement. The renderer turns an
 * intent into numbers and is allowed to refuse an intent that contradicts the
 * reviewed content: a page that carries eight long points cannot be a card
 * grid, no matter what the model asked for. A refused intent is reported, not
 * silently applied.
 */

import { LAYOUT_CAPACITY, stripListPrefix } from "./layout-capacity";

/**
 * The composition family of a page.
 *
 * - "auto": the deterministic engine decides from the reviewed content.
 * - "stacked": one column, title above one block of copy.
 * - "columns": two columns side by side.
 * - "grid": a grid of equal cards.
 * - "editorial": a numbered column beside one visual anchor (a quote or the
 *   real count of the points of the page).
 * - "showcase": a large title with very little supporting copy.
 */
export type AiComposition = "auto" | "stacked" | "columns" | "grid" | "editorial";

/** Which level of the hierarchy carries the weight of the page. */
export type AiEmphasis = "balanced" | "title-dominant" | "body-dominant";

/** How much white space the page is willing to spend. */
export type AiDensityTarget = "airy" | "balanced" | "compact";

/**
 * A slot of the template palette.
 *
 * The model picks a slot, not a colour value. The template owns the actual
 * colours, so the generated deck stays inside the palette of the template it
 * was built with, and the choice the model made still has an effect.
 */
export type AiPaletteRole =
  | "surface"
  | "surface-alt"
  | "accent-1"
  | "accent-2"
  | "accent-3"
  | "primary"
  | "secondary"
  | "inverse"
  | "template-default";

/** The palette slots a page picks for its own four colours. */
export interface AiPalette {
  background?: AiPaletteRole;
  accent?: AiPaletteRole;
  title?: AiPaletteRole;
  body?: AiPaletteRole;
}

/** What the reviewed content of a page says about the composition it can carry. */
export interface CompositionFacts {
  /** How many points the page carries. */
  itemCount: number;
  /** Whether every point is short enough to sit on one line. */
  shortItems: boolean;
  /** The length of the longest point. */
  longestItemLength: number;
  /** The body copy of the page. */
  bodyLength: number;
  /** Whether the page carries a quote. */
  hasQuote: boolean;
  /** Whether the page carries a comparison. */
  hasComparison: boolean;
  /** Whether the page carries a row of steps, a timeline or a set of metrics. */
  hasRowBlock: boolean;
  /** The coarse layout the page was given. */
  layout: string;
}

/** Why an intent the model asked for could not be applied. */
export interface IntentConflict {
  /** The intent that was refused. */
  intent: string;
  /** The reason the intent could not be applied. */
  reason: string;
}

/** The intents of a page, after they have been checked against the content. */
export interface ResolvedPageDesign {
  /** The composition family the page is drawn in. */
  composition: AiComposition;
  /** Which level of the hierarchy carries the weight. */
  emphasis: AiEmphasis;
  /** How much white space the page spends. */
  density: AiDensityTarget;
  /** The intents that were refused, and why. */
  conflicts: IntentConflict[];
}

/** The factor a level of the hierarchy is scaled by. */
export interface EmphasisFactors {
  /** The factor the size of the title is scaled by. */
  title: number;
  /** The factor the size of the body copy is scaled by. */
  body: number;
}

/** The factor the spacing of a page is scaled by. */
export interface DensityFactors {
  /** The factor the gaps between items are scaled by. */
  gap: number;
  /** The ratio between the size of the type and the height of one line. */
  leading: number;
}

export const EMPHASIS_FACTORS: Record<AiEmphasis, EmphasisFactors> = {
  balanced: { title: 1, body: 1 },
  "title-dominant": { title: 1.18, body: 0.94 },
  "body-dominant": { title: 0.88, body: 1.1 },
};

export const DENSITY_FACTORS: Record<AiDensityTarget, DensityFactors> = {
  airy: { gap: 1.3, leading: 1.32 },
  balanced: { gap: 1, leading: 1.25 },
  compact: { gap: 0.8, leading: 1.15 },
};

/**
 * Whether a composition family can carry the content of the page.
 *
 * A card grid needs points that fit on a card. A numbered column with an
 * anchor needs three to five short points, because the anchor is a panel of
 * its own and the column beside it has to stay readable.
 */
export function isCompositionLegal(composition: AiComposition, facts: CompositionFacts): boolean {
  // A structured block draws its own page. The composition of such a page is
  // not a free choice: the block is the layout.
  if (facts.hasRowBlock || facts.hasComparison) return composition === "auto";
  switch (composition) {
    case "auto":
      return true;
    case "stacked":
      return true;
    case "columns":
      return facts.itemCount >= LAYOUT_CAPACITY.splitMinItems;
    case "grid":
      return facts.itemCount >= LAYOUT_CAPACITY.cardsMinItems
        && facts.itemCount <= LAYOUT_CAPACITY.cardsMaxItems
        && facts.longestItemLength <= LAYOUT_CAPACITY.cardItemLengthLimit;
    case "editorial":
      return facts.itemCount >= LAYOUT_CAPACITY.panelMinItems
        && facts.itemCount <= LAYOUT_CAPACITY.panelMaxItems
        && facts.shortItems;
    default:
      return false;
  }
}

/**
 * The composition a page carries when the model did not choose one.
 *
 * The rules mirror the page the renderer used to draw, so a deck that comes
 * from a model that knows nothing about compositions looks the way it always
 * did. A model that does choose gets its choice, as long as the content can
 * carry it.
 */
export function autoComposition(facts: CompositionFacts, options: { allowEditorial?: boolean } = {}): AiComposition {
  if (facts.hasRowBlock || facts.hasComparison) return "auto";
  const count = facts.itemCount;
  const editorialRange = count >= LAYOUT_CAPACITY.panelMinItems && count <= LAYOUT_CAPACITY.panelMaxItems && facts.shortItems;
  // A page with a quote beside its points is an editorial page: the quote is
  // the anchor of the column. A split page and a summary page are editorial
  // pages as well, because they are the pages that carry an anchor instead of
  // a second column of copy.
  if (options.allowEditorial !== false && editorialRange && (facts.hasQuote || facts.layout === "split" || facts.layout === "summary")) {
    return "editorial";
  }
  // A card page always becomes a grid. A title page becomes one only when its
  // points are short enough, and a split page becomes one only when it holds
  // the full six points of a grid.
  if (count >= LAYOUT_CAPACITY.cardsMinItems && count <= LAYOUT_CAPACITY.cardsMaxItems) {
    if (facts.layout === "cards") return "grid";
    if (facts.shortItems && (facts.layout === "title-body" || facts.layout === "summary") && count >= LAYOUT_CAPACITY.cardsGridMinItems) return "grid";
    if (facts.shortItems && facts.layout === "split" && count === LAYOUT_CAPACITY.cardsMaxItems) return "grid";
  }
  // A split page, and a card page that holds more points than a grid can
  // carry, are drawn as two columns.
  if (count > 1 && (facts.layout === "split" || (facts.layout === "cards" && count > LAYOUT_CAPACITY.cardsMaxItems))) return "columns";
  return "stacked";
}

/**
 * Resolves the intents of a page against the content it has to carry.
 *
 * The result is what the renderer draws. An intent that contradicts the
 * content is refused and reported, so the refusal is visible instead of
 * looking like the model was ignored.
 */
export function resolvePageDesign(input: {
  /** The composition the model asked for. */
  composition?: AiComposition;
  /** The emphasis the model asked for. */
  emphasis?: AiEmphasis;
  /** The density the model asked for. */
  densityTarget?: AiDensityTarget;
  /** What the reviewed content says about the page. */
  facts: CompositionFacts;
}): ResolvedPageDesign {
  const conflicts: IntentConflict[] = [];
  const requested = input.composition ?? "auto";
  let composition: AiComposition;
  if (requested === "auto") {
    composition = autoComposition(input.facts);
  } else if (isCompositionLegal(requested, input.facts)) {
    composition = requested;
  } else {
    composition = autoComposition(input.facts);
    conflicts.push({ intent: `composition=${requested}`, reason: describeCompositionConflict(requested, input.facts) });
  }
  return {
    composition,
    emphasis: input.emphasis ?? "balanced",
    density: input.densityTarget ?? "balanced",
    conflicts,
  };
}

/** The reason a composition cannot carry the content of the page. */
export function describeCompositionConflict(composition: AiComposition, facts: CompositionFacts): string {
  if (facts.hasRowBlock || facts.hasComparison) return "该页有结构化内容块，版式由内容块决定";
  switch (composition) {
    case "columns":
      return `该页只有 ${facts.itemCount} 条要点，撑不起双栏`;
    case "grid":
      return facts.itemCount > LAYOUT_CAPACITY.cardsMaxItems
        ? `该页有 ${facts.itemCount} 条要点，超过卡片网格的 ${LAYOUT_CAPACITY.cardsMaxItems} 条上限`
        : `该页最长的一条有 ${facts.longestItemLength} 字，超过卡片版式 ${LAYOUT_CAPACITY.cardItemLengthLimit} 字上限`;
    case "editorial":
      return facts.itemCount < LAYOUT_CAPACITY.panelMinItems || facts.itemCount > LAYOUT_CAPACITY.panelMaxItems
        ? `该页有 ${facts.itemCount} 条要点，不在 ${LAYOUT_CAPACITY.panelMinItems}–${LAYOUT_CAPACITY.panelMaxItems} 条的编辑式区间内`
        : "该页的要点过长，编号栏放不下";
    default:
      return "该构图与已审核内容不符";
  }
}

/**
 * The quoted line of a page that can carry it as a pull quote.
 *
 * The quote is copied from the reviewed copy, so it is a visual emphasis of
 * content that already exists and never a new claim.
 */
export function detectPullQuote(input: { quoteText?: string; items: readonly string[] }): string | undefined {
  const quoted = input.quoteText?.trim();
  if (quoted && quoted.length >= 6 && quoted.length <= 96) return quoted;
  return input.items
    .map(stripListPrefix)
    .filter((item) => item.length >= 6 && item.length <= 48 && /[“”"'‘’「」『』]/.test(item))
    .sort((left, right) => right.length - left.length)[0];
}
