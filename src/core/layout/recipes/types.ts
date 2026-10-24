import type { CompositionFacts, IntentConflict } from "../../commands/design-intent";
import type { AiVisualAsset } from "../../commands/visual-asset";
import type { DeckConcept, RecipeId } from "../../design/deck-concept";
import type { DesignTokens } from "../../design/design-tokens";
import type { Emu, RectEmu, SlideContent, SlideElement } from "../../document-model";
import type { PageChrome } from "../page-chrome";

/** A rectangle in page-relative units, 0–1 on both axes. */
export interface NormalizedFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecipeContext {
  content: SlideContent;
  facts: CompositionFacts;
  concept: DeckConcept;
  tokens: DesignTokens;
  /** Resolved inks for this page; recipes never read the raw template. */
  colors: {
    title: string;
    body: string;
    accent: string;
    background: string;
    rule: string;
    /** The surface a recipe may use for a card or panel. */
    card?: string;
  };
  frame: {
    title: RectEmu;
    content: RectEmu;
    safe: NormalizedFrame;
    page: { width: Emu; height: Emu };
  };
  page: { index: number; total: number };
  /** The shared title axis, rule and content region of this page. */
  chrome?: PageChrome;
  /** Page-level choices from the design; recipes may ignore them. */
  variant?: "left" | "right";
  focal?: "title" | "index" | "body";
  asset?: AiVisualAsset;
}

/**
 * What a recipe actually put on the page.
 *
 * `consumed` is a content-loss guard, not a statistic: the command compares it
 * with the reviewed content and refuses to write a page that quietly dropped a
 * point or a block.
 */
export interface RecipePlan {
  elements: SlideElement[];
  consumed: {
    title: boolean;
    body: boolean;
    items: number;
    blockIds: readonly string[];
  };
  conflicts: IntentConflict[];
  /** A recipe may give the picture a different frame than the default layout. */
  imageFrame?: NormalizedFrame;
}

export interface RecipeSupportOptions {
  hasArtwork: boolean;
  hasAsset: boolean;
  /** The role the renderer gave the picture, when a page has one. */
  assetRole?: "hero" | "side" | "band";
}

export interface LayoutRecipe {
  id: RecipeId;
  supports(facts: CompositionFacts, concept: DeckConcept, options: RecipeSupportOptions): boolean;
  plan(ctx: RecipeContext): RecipePlan | { conflict: IntentConflict };
}

export type RecipeSelectionOptions = RecipeSupportOptions;

export interface RecipeSelection {
  recipe: LayoutRecipe;
  id: RecipeId;
}
