import { autoComposition, isCompositionLegal, type AiComposition, type CompositionFacts, type IntentConflict } from "./design-intent";

/**
 * The composition of a whole deck.
 *
 * A page that is drawn well can still make a deck that reads as one shape
 * repeated. The composition of a page is decided from that page's own content,
 * so two pages with the same shape of content get the same composition — and
 * a deck of twenty such pages is monotonous no matter how well each page is
 * drawn. That is what the thumbnails of a generated deck showed: page after
 * page with the same skeleton.
 *
 * The planner keeps the deck legible as a sequence. A composition may repeat,
 * but not indefinitely in a row. The model's explicit choice is still
 * respected: only the automatic choice is adjusted, because the automatic
 * choice was never a decision in the first place.
 */

/** 一页的事实与模型的要求。 */
export interface DeckPageFacts {
  /** 这一页的内容事实。 */
  facts: CompositionFacts;
  /** 模型明确要求的构图。 */
  requested?: AiComposition;
}

/** 整册的构图计划。 */
export interface DeckCompositionPlan {
  /** 每页最终采用的构图，顺序与文稿一致。 */
  compositions: AiComposition[];
  /** 因为节奏而调整过的构图，以及调整的原因。 */
  adjustments: Array<{ slideIndex: number; from: AiComposition; to: AiComposition; reason: string }>;
}

/** 同一个构图最多连续出现几页。 */
export const DEFAULT_MAX_CONSECUTIVE_COMPOSITIONS = 2;

/**
 * 备选构图的优先顺序。
 *
 * 调整只发生在内容装得下的构图之间，所以顺序里靠前的构图未必可用。真正的
 * 约束是内容：8 条长要点排不成卡片网格，2 条要点撑不起双栏。
 */
const COMPOSITION_PREFERENCE: readonly AiComposition[] = ["editorial", "columns", "grid", "stacked"];

/** 与最近几页都不同的、且这一页装得下的构图。 */
export function alternativeComposition(facts: CompositionFacts, avoid: readonly AiComposition[]): AiComposition | undefined {
  return COMPOSITION_PREFERENCE.find((candidate) => !avoid.includes(candidate) && isCompositionLegal(candidate, facts));
}

/**
 * Plans the composition of every page of a deck.
 *
 * The model keeps the last word on the pages it cared about. The pages it
 * left to the engine are the ones that get a rhythm: when the automatic
 * choice would repeat the previous page for a third time, a different legal
 * composition is used instead.
 */
export function planDeckCompositions(pages: DeckPageFacts[], options: { maxConsecutive?: number } = {}): DeckCompositionPlan {
  const maxConsecutive = Math.max(1, options.maxConsecutive ?? DEFAULT_MAX_CONSECUTIVE_COMPOSITIONS);
  const compositions: AiComposition[] = [];
  const adjustments: DeckCompositionPlan["adjustments"] = [];
  const recent: AiComposition[] = [];
  for (const [index, page] of pages.entries()) {
    const requested = page.requested;
    // The model asked for something the content cannot carry: the page keeps
    // the composition its own content implies, and the refusal is reported.
    const legal = requested === undefined || requested === "auto"
      ? true
      : isCompositionLegal(requested, page.facts);
    let chosen = legal && requested !== undefined && requested !== "auto" ? requested : autoComposition(page.facts);
    const explicit = legal && requested !== undefined && requested !== "auto";
    if (!explicit && recent.length > 0 && chosen === recent[0] && recent.filter((value) => value === chosen).length >= maxConsecutive) {
      const alternative = alternativeComposition(page.facts, recent.slice(0, maxConsecutive));
      if (alternative) {
        adjustments.push({
          slideIndex: index,
          from: chosen,
          to: alternative,
          reason: `连续 ${maxConsecutive + 1} 页使用同一构图会让整册看起来像一页的重复`,
        });
        chosen = alternative;
      }
    }
    compositions.push(chosen);
    recent.unshift(chosen);
    if (recent.length > maxConsecutive + 1) recent.pop();
  }
  return { compositions, adjustments };
}

/** 整册计划里被拒绝的意图。 */
export function deckIntentConflicts(pages: DeckPageFacts[]): IntentConflict[] {
  const conflicts: IntentConflict[] = [];
  pages.forEach((page, index) => {
    const requested = page.requested;
    if (!requested || requested === "auto") return;
    if (isCompositionLegal(requested, page.facts)) return;
    conflicts.push({ intent: `slide ${index + 1}: composition=${requested}`, reason: "该页的内容装不下这个构图，已改用内容自己决定的那一种" });
  });
  return conflicts;
}
