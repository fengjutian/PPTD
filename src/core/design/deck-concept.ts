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
export type ConceptPresetId = "editorial" | "documentary" | "paper" | "instrument";

export type DeckMotif = "rules" | "blocks" | "instrument" | "documentary" | "signal" | "paper";
export type SurfaceStrategy = "flat" | "rules" | "panels" | "full-bleed" | "column" | "rail";
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
  /**
   * The other two ways a picture can own a page.
   *
   * `image-led` gives the picture the page edge and keeps the copy beside it.
   * `full-bleed-image` makes the page the picture and sets the copy on a solid
   * plate; `side-image-text` frames the picture as an inset plate and opens a
   * measured copy column next to it. Without them a deck of ten picture pages
   * was ten copies of one composition, and the visual review had nothing to
   * alternate with.
   */
  | "full-bleed-image"
  | "side-image-text"
  | "editorial-index"
  | "asymmetric-split"
  | "process-rail"
  | "comparison"
  | "weighted-split"
  | "timeline-rail"
  | "quote-field"
  | "section-statement"
  /**
   * Compositions only one direction draws.
   *
   * The four directions used to share all twelve recipes, so they differed in
   * margins and type scale but never in how a page was built. These two are the
   * direction's own page: a measured prose column for `paper`, an instrument
   * grid of indexes for `instrument`. They are selected by the command layer
   * from the concept, never requested by the model.
   */
  | "paper-column"
  | "instrument-columns";

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
  "side-image-text",
  "editorial-index",
  "asymmetric-split",
  "process-rail",
  "comparison",
  "weighted-split",
  "timeline-rail",
  "quote-field",
  "section-statement",
];

/**
 * The documentary direction is the one that spends the page on a picture, so it
 * is the only one whose recipe set includes the full-bleed composition.
 *
 * A full-bleed photo on the `paper` direction would contradict the narrow
 * measured column the user picked; on `instrument` it would contradict the rail.
 * The vocabulary is per direction on purpose — the cover path can still promote
 * a side picture on any preset, but the page-level composition stays inside the
 * direction.
 */
const DOCUMENTARY_RECIPES: readonly RecipeId[] = [...EDITORIAL_RECIPES, "full-bleed-image"];

/** The editorial set plus the prose column the paper direction draws itself. */
const PAPER_RECIPES: readonly RecipeId[] = [...EDITORIAL_RECIPES, "paper-column"];
/** The editorial set plus the index grid the instrument direction draws itself. */
const INSTRUMENT_RECIPES: readonly RecipeId[] = [...EDITORIAL_RECIPES, "instrument-columns"];

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
  // The paper direction spends the page on a measured, centred column. It is a
  // skeleton difference, not a colour: the title axis, the measure and the
  // accent rule all move inward, so the same copy reads as an essay spread.
  paper: {
    motif: "paper",
    surface: "column",
    recipes: PAPER_RECIPES,
    // Covers in every preset may promote a side/band request to a hero. Hero is
    // listed so the clamp table matches what the cover path can actually draw;
    // the prompt still keeps image-led pages on documentary.
    imagery: ["none", "side", "hero"],
    typeContrast: "calm",
  },
  // The instrument direction sets the copy off to the right of a rail and lets
  // the type scale carry the numbers. Data pages keep their charts; the rail is
  // drawn by the command layer so every recipe shares one geometry.
  instrument: {
    motif: "instrument",
    surface: "rail",
    recipes: INSTRUMENT_RECIPES,
    imagery: ["none", "band", "hero"],
    typeContrast: "dramatic",
  },
};

export const CONCEPT_PRESET_LABELS: Readonly<Record<ConceptPresetId, string>> = {
  editorial: "编辑式",
  documentary: "纪实全幅",
  paper: "纸本专栏",
  instrument: "数据仪表",
};

export const CONCEPT_PRESET_IDS = Object.keys(CONCEPT_PRESETS) as ConceptPresetId[];

/**
 * The skeleton a batch card pairs with its palette.
 *
 * Card 0 is the direction the model recommended; the rest rotate through the
 * other renderable skeletons. A batch that only swaps colours is a palette
 * picker wearing a deck preview: the cards cannot be told apart, and the user
 * is choosing a hue while believing they are choosing a look.
 *
 * The rotation is deterministic so the same deck keeps the same cards between
 * runs, and so two neighbouring cards never share both palette and composition.
 */
export function variantConceptPresetId(base: ConceptPresetId, index: number): ConceptPresetId {
  const order = CONCEPT_PRESET_IDS;
  const start = Math.max(0, order.indexOf(base));
  const step = Math.max(0, Math.trunc(index));
  return order[(start + step) % order.length]!;
}

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

export function defaultPaperConcept(): AiDeckConcept {
  return {
    preset: "paper",
    name: "纸本专栏",
    idea: "把内容收进居中的窄栏，用字号和留白控制阅读节奏。",
    typeContrast: "calm",
    imagery: "none",
    rationale: "内容以长段判断为主，窄栏比满版更适合连续阅读。",
  };
}

export function defaultInstrumentConcept(): AiDeckConcept {
  return {
    preset: "instrument",
    name: "数据仪表",
    idea: "让数字和对比占住视线，文字收进右侧栏内。",
    typeContrast: "dramatic",
    imagery: "none",
    rationale: "内容有指标和对比，读者先看数再读解释。",
  };
}

/** The default concept of a preset, for fixtures and the specimen builder. */
export function defaultConceptForPreset(preset: ConceptPresetId): AiDeckConcept {
  switch (preset) {
    case "documentary":
      return defaultDocumentaryConcept();
    case "paper":
      return defaultPaperConcept();
    case "instrument":
      return defaultInstrumentConcept();
    default:
      return defaultEditorialConcept();
  }
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
