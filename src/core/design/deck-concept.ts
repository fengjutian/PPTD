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
export type ConceptPresetId = "editorial" | "documentary";

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
  | "chart-story"
  | "image-led"
  | "editorial-index"
  | "asymmetric-split"
  | "process-rail"
  | "comparison"
  | "weighted-split"
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
  /**
   * The imagery roles this direction may use. `imagery` is the strategy chosen
   * for the deck; this list is what the command layer clamps a page request to.
   */
  imageryRoles: readonly ImageryStrategy[];
}

interface ConceptPreset {
  motif: DeckMotif;
  surface: SurfaceStrategy;
  recipes: readonly RecipeId[];
  /**
   * The imagery strategies the preset can render. A single value made every
   * preset text-only or image-only; the resolver clamps the model's intent to
   * this list instead of rejecting it outright.
   */
  imagery: readonly ImageryStrategy[];
  typeContrast: TypeContrast;
}

const EDITORIAL_RECIPES: readonly RecipeId[] = [
  "cover-statement",
  "data-story",
  "chart-story",
  "image-led",
  "editorial-index",
  "asymmetric-split",
  "process-rail",
  "comparison",
  "weighted-split",
  "timeline-rail",
  "quote-field",
  "section-statement",
];

const CONCEPT_PRESETS: Record<ConceptPresetId, ConceptPreset> = {
  editorial: {
    motif: "rules",
    surface: "rules",
    recipes: EDITORIAL_RECIPES,
    imagery: ["none", "hero", "band", "side"],
    typeContrast: "strong",
  },
  documentary: {
    motif: "documentary",
    surface: "full-bleed",
    recipes: EDITORIAL_RECIPES,
    // A documentary direction exists to give the picture the page; a text-only
    // request is clamped to a picture rather than silently becoming editorial.
    imagery: ["hero", "band", "side"],
    typeContrast: "calm",
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

export function defaultDocumentaryConcept(): AiDeckConcept {
  return {
    preset: "documentary",
    name: "纪实全幅",
    idea: "让真实图片占住页面，文字退到边缘，像一篇图片报道。",
    typeContrast: "calm",
    imagery: "hero",
    rationale: "内容有真实场景或数据图像，图比字更能说明问题。",
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
  const preset = CONCEPT_PRESETS[input.concept.preset];
  if (!preset) {
    conflicts.push({
      intent: `preset=${input.concept.preset}`,
      reason: "该设计方向还没有对应的渲染实现，已回退编辑式",
    });
  }
  const resolvedPreset = preset ?? CONCEPT_PRESETS.editorial;
  const resolvedPresetId: ConceptPresetId = preset ? input.concept.preset : "editorial";
  // Clamp the model's imagery intent to what the preset can draw. A clamped
  // value is reported, never silently accepted: the report has to explain why
  // the page does not use the picture the model asked for.
  const imagery = resolvedPreset.imagery.includes(input.concept.imagery)
    ? input.concept.imagery
    : resolvedPreset.imagery[0]!;
  if (imagery !== input.concept.imagery) {
    conflicts.push({
      intent: `imagery=${input.concept.imagery}`,
      reason: `该方向只支持 ${resolvedPreset.imagery.join("/")}，已回退 ${imagery}`,
    });
  }
  return {
    concept: {
      ...input.concept,
      preset: resolvedPresetId,
      id: input.id ?? crypto.randomUUID(),
      motif: resolvedPreset.motif,
      surface: resolvedPreset.surface,
      recipes: [...resolvedPreset.recipes],
      imagery,
      imageryRoles: [...resolvedPreset.imagery],
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
