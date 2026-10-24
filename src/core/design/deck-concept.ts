import type { CompositionFacts, IntentConflict } from "../commands/design-intent";

/**
 * The design direction of a whole deck.
 *
 * A page can be laid out well and still add up to a deck without a point of
 * view. The concept is the deck-level decision: which visual language the pages
 * share, and which page recipes that language can actually render. It never
 * contains coordinates, font sizes or content.
 *
 * The model picks a preset and a small number of strengths; the preset catalog
 * is code. A preset that has no renderer is not part of the enum, so the model
 * cannot promise a picture the system cannot draw.
 */
export type ConceptPresetId = "editorial";

export type DeckMotif = "rules" | "blocks" | "instrument" | "documentary" | "signal" | "paper";
export type SurfaceStrategy = "flat" | "rules" | "panels" | "full-bleed";
export type ImageryStrategy = "none" | "hero" | "band" | "side" | "texture";
export type TypeContrast = "calm" | "strong" | "dramatic";
export type PageBeat = "statement" | "evidence" | "quiet" | "close";

/**
 * The recipes implemented in this version. The union grows only when the
 * renderer grows: a value in the contract is a promise that a page can be drawn.
 */
export type RecipeId =
  | "cover-statement"
  | "data-story"
  | "image-led"
  | "editorial-index"
  | "asymmetric-split"
  | "process-rail"
  | "comparison"
  | "timeline-rail"
  | "quote-field"
  | "section-statement";

export interface AiDeckConcept {
  preset: ConceptPresetId;
  /** Display name, for the picker and the report. */
  name: string;
  /** One sentence for the user; never read by the renderer. */
  idea: string;
  typeContrast: TypeContrast;
  imagery: ImageryStrategy;
  /** Why this direction fits the content, for the report. */
  rationale: string;
}

export interface DeckConcept extends AiDeckConcept {
  id: string;
  motif: DeckMotif;
  recipes: readonly RecipeId[];
  rhythm: readonly PageBeat[];
  surface: SurfaceStrategy;
}

interface ConceptPreset {
  motif: DeckMotif;
  surface: SurfaceStrategy;
  recipes: readonly RecipeId[];
  imagery: ImageryStrategy;
  typeContrast: TypeContrast;
}

const CONCEPT_PRESETS: Record<ConceptPresetId, ConceptPreset> = {
  editorial: {
    motif: "rules",
    surface: "rules",
    recipes: [
      "cover-statement",
      "data-story",
      "image-led",
      "editorial-index",
      "asymmetric-split",
      "process-rail",
      "comparison",
      "timeline-rail",
      "quote-field",
      "section-statement",
    ],
    imagery: "none",
    typeContrast: "strong",
  },
};

export const CONCEPT_PRESET_IDS = Object.keys(CONCEPT_PRESETS) as ConceptPresetId[];

export function defaultEditorialConcept(): AiDeckConcept {
  return {
    preset: "editorial",
    name: "编辑式",
    idea: "用细线、大字号和编号栏组织内容，不用卡片。",
    typeContrast: "strong",
    imagery: "none",
    rationale: "内容以判断和要点为主，没有可支撑的数字或图片。",
  };
}

export interface ResolveDeckConceptInput {
  concept: AiDeckConcept;
  /** Facts of every page, in page order. */
  pageFacts: readonly CompositionFacts[];
  pageCount: number;
  /** Stable id for tests; production uses a random id. */
  id?: string;
}

export interface ResolvedDeckConcept {
  concept: DeckConcept;
  conflicts: IntentConflict[];
}

/**
 * Expands the model's choice into the fields the renderer consumes.
 *
 * `imagery` is clamped to what the preset can render. A preset whose page
 * recipes cannot place a picture must not claim it can; the model's preference
 * becomes a reported conflict instead of a silently ignored field.
 */
export function resolveDeckConcept(input: ResolveDeckConceptInput): ResolvedDeckConcept {
  if (input.pageFacts.length !== input.pageCount) throw new Error("AI_CONCEPT_RHYTHM_INVALID");
  const conflicts: IntentConflict[] = [];
  const preset = CONCEPT_PRESETS[input.concept.preset] ?? CONCEPT_PRESETS.editorial;
  if (input.concept.preset !== "editorial") {
    conflicts.push({
      intent: `preset=${input.concept.preset}`,
      reason: "该设计方向还没有对应的渲染实现，已回退编辑式",
    });
  }
  if (input.concept.imagery !== preset.imagery) {
    conflicts.push({
      intent: `imagery=${input.concept.imagery}`,
      reason: "该设计方向当前只支持无配图，配图意图未生效",
    });
  }
  return {
    concept: {
      ...input.concept,
      preset: "editorial",
      id: input.id ?? crypto.randomUUID(),
      motif: preset.motif,
      surface: preset.surface,
      recipes: [...preset.recipes],
      imagery: preset.imagery,
      typeContrast: input.concept.typeContrast,
      rhythm: planConceptRhythm(input.pageFacts, input.pageCount),
    },
    conflicts,
  };
}

/**
 * Plans the beat of every page.
 *
 * The first page introduces, a structured page is evidence, and the last page
 * closes. Long runs of quiet pages are broken by a statement page only when the
 * content of that page is a single point, so the beat never invents emphasis.
 */
export function planConceptRhythm(facts: readonly CompositionFacts[], pageCount: number): PageBeat[] {
  if (facts.length !== pageCount) throw new Error("AI_CONCEPT_RHYTHM_INVALID");
  const beats: PageBeat[] = facts.map((page, index) => {
    if (index === 0) return "statement";
    if (page.hasRowBlock) return "evidence";
    if (index === pageCount - 1) return "close";
    return "quiet";
  });
  for (let index = 1; index < beats.length - 1; index += 1) {
    if (
      beats[index] === "quiet" &&
      beats[index - 1] === "quiet" &&
      beats[index + 1] === "quiet" &&
      facts[index]!.itemCount === 1
    ) {
      beats[index] = "statement";
    }
  }
  return beats;
}
