import type { CompositionFacts, IntentConflict } from "../commands/design-intent";
import type { PageDesignPlan } from "../design/design-plan";
import type { DeckConcept, RecipeId } from "../design/deck-concept";
import type { DesignTokens } from "../design/design-tokens";
import type { RectEmu, SlideContent } from "../document-model";
import { colorLuminance } from "../rendering/contrast";
import { frameFromNormalized } from "./recipes/measure";
import { rectElement } from "./recipes/elements";
import { findRecipe } from "./recipes/registry";
import { directionOwnsRequest, supportedDirectionRecipe } from "./recipes/plan";
import type { NormalizedFrame, RecipeContext, RecipePlan, RecipeSupportOptions } from "./recipes/types";
import type { PageChrome } from "./page-chrome";

export interface DesignCompileInput {
  plan: PageDesignPlan;
  content: SlideContent;
  facts: CompositionFacts;
  concept: DeckConcept;
  tokens: DesignTokens;
  colors: RecipeContext["colors"];
  frame: RecipeContext["frame"];
  page: RecipeContext["page"];
  chrome: PageChrome;
  templateImage?: NormalizedFrame;
  hasTemplate: boolean;
  hasArtwork: boolean;
  hasAsset: boolean;
  assetRole?: "hero" | "side" | "band";
}

function conflict(intent: string, reason: string): { conflict: IntentConflict } {
  return { conflict: { intent, reason } };
}

/**
 * The compiler is the only place allowed to turn a design plan into geometry.
 *
 * The AI writes the plan; this function chooses the concrete recipe, keeps the
 * page on the shared chrome, and — for a template takeover — lays a clean
 * content surface over the template's body artwork while leaving the header,
 * Logo and footer in place.
 */
export function compileDesignPlan(input: DesignCompileInput): RecipePlan | { conflict: IntentConflict } {
  const supports: RecipeSupportOptions = {
    hasArtwork: input.hasArtwork,
    hasAsset: input.hasAsset,
    hasTemplate: input.hasTemplate,
    ...(input.templateImage ? { hasTemplateImage: true } : {}),
    ...(input.assetRole ? { assetRole: input.assetRole } : {}),
  };
  const recipeId = planRecipe(input.plan, input.facts, { concept: input.concept, options: supports });
  if (!recipeId) return conflict("designPlan.role", "设计计划没有可用的页面配方");
  const recipe = findRecipe(recipeId);
  if (!recipe) return conflict("designPlan.recipe", `未知配方 ${recipeId}`);
  if (!recipe.supports(input.facts, input.concept, supports)) {
    return conflict("designPlan.recipe", `内容装不下配方 ${recipeId}`);
  }

  let chrome = input.chrome;
  let frame = input.frame;
  let colors = input.colors;
  const leading: RecipePlan["elements"] = [];

  if (input.plan.templatePolicy === "takeover" && input.hasTemplate) {
    const surface = takeoverSurface(input.chrome, input.frame.safe);
    leading.push(rectElement(frameFromNormalized(surface, input.frame.page), input.colors.background));
    const inset = 0.05;
    const content = {
      x: surface.x + inset,
      y: surface.y + inset,
      width: Math.max(0.1, surface.width - inset * 2),
      height: Math.max(0.1, surface.height - inset * 2),
    };
    chrome = { ...input.chrome, content, contentTop: content.y, contentBottom: content.y + content.height };
    frame = {
      ...input.frame,
      content: frameFromNormalized(content, input.frame.page),
      safe: { x: surface.x, y: surface.y, width: surface.width, height: surface.height },
    };
    // The surface is the design's own background, so its inks must be derived
    // from that colour — the template's body ink was chosen for white cards.
    const dark = (colorLuminance(input.colors.background) ?? 1) < 0.45;
    colors = {
      ...input.colors,
      body: dark ? "#DCE3EA" : "#3E4650",
      accent: dark && (colorLuminance(input.colors.accent) ?? 1) < 0.32 ? "#DCE3EA" : input.colors.accent,
    };
  }

  const planned = recipe.plan({
    content: input.content,
    facts: input.facts,
    concept: input.concept,
    tokens: input.tokens,
    colors,
    frame,
    page: input.page,
    chrome,
    ...(input.plan.composition.ratio === undefined ? {} : { ratio: input.plan.composition.ratio }),
    ...(input.plan.chart === undefined ? {} : { chartKind: input.plan.chart.kind }),
    ...(recipeFocal(input.plan) ? { focal: recipeFocal(input.plan) } : {}),
    ...(input.templateImage ? { templateImage: input.templateImage } : {}),
  });
  if (!("elements" in planned)) return planned;
  return {
    ...planned,
    elements: [...leading, ...planned.elements],
  };
}

/** The clean surface a takeover draws over the template body. */
function takeoverSurface(chrome: PageChrome, safe: NormalizedFrame): NormalizedFrame {
  const left = Math.max(0.02, safe.x - 0.02);
  const right = Math.min(0.98, safe.x + safe.width + 0.02);
  const top = Math.max(0.11, Math.min(0.2, chrome.contentTop - 0.03));
  const bottom = Math.min(0.9, chrome.contentBottom + 0.02);
  return { x: left, y: top, width: Math.max(0.2, right - left), height: Math.max(0.2, bottom - top) };
}

interface PlanDirection {
  concept: DeckConcept;
  options: RecipeSupportOptions;
}

function planRecipe(plan: PageDesignPlan, facts: CompositionFacts, direction?: PlanDirection): RecipeId | undefined {
  // A direction owns a composition of its own. It is checked before the role
  // table and before a shared-list request, otherwise `paper` and `instrument`
  // would keep drawing the editorial list on every content page.
  const own = direction ? supportedDirectionRecipe(facts, direction.concept, direction.options) : undefined;
  if (plan.recipe) {
    // A request for a shared list on a page the direction draws itself is a
    // request about the content shape, not about the editorial index.
    return own && directionOwnsRequest(plan.recipe) ? own : plan.recipe;
  }
  if (own) return own;
  switch (plan.role) {
    case "cover":
      return "cover-statement";
    case "section":
      return "section-statement";
    case "comparison":
      return plan.composition.ratio !== undefined && Math.abs(plan.composition.ratio - 0.5) >= 0.05
        ? "weighted-split"
        : "comparison";
    case "process":
      return "process-rail";
    case "timeline":
      return "timeline-rail";
    case "quote":
      return "quote-field";
    case "summary":
      // A dense summary prefers the asymmetric split even when the copy is short:
      // the author asked for more page coverage, not more air.
      if (plan.density === "dense") return "asymmetric-split";
      return facts.shortItems ? "editorial-index" : "asymmetric-split";
    case "claim":
      if (facts.hasChart) return "chart-story";
      if (facts.hasMetric) return "data-story";
      if (facts.hasComparison) return "comparison";
      if (facts.hasProcess) return "process-rail";
      if (facts.hasTimeline) return "timeline-rail";
      // Dense text pages use the asymmetric split; sparse pages keep the
      // editorial index when the copy is short.
      if (plan.density === "dense") return "asymmetric-split";
      return facts.shortItems ? "editorial-index" : "asymmetric-split";
  }
}

/**
 * Maps the plan's focal object to the recipe-level focal knob.
 *
 * The plan names what the page is about (a number, a chart, a picture); the
 * recipe only understands which typographic layer should grow. Everything that
 * is not the title is carried by the body layer.
 */
function recipeFocal(plan: PageDesignPlan): "title" | "index" | "body" | undefined {
  switch (plan.focal?.kind) {
    case "title":
      return "title";
    case "number":
    case "image":
    case "chart":
      return "body";
    default:
      return undefined;
  }
}

/** Exposed for the command layer's debug report and tests. */
export function planRecipeId(
  plan: PageDesignPlan,
  facts: CompositionFacts,
  direction?: PlanDirection,
): RecipeId | undefined {
  return planRecipe(plan, facts, direction);
}

/** The content frame that a takeover page actually uses. */
export function takeoverContentFrame(input: { chrome: PageChrome; frame: RecipeContext["frame"] }): RectEmu {
  const surface = takeoverSurface(input.chrome, input.frame.safe);
  const inset = 0.05;
  return frameFromNormalized(
    {
      x: surface.x + inset,
      y: surface.y + inset,
      width: Math.max(0.1, surface.width - inset * 2),
      height: Math.max(0.1, surface.height - inset * 2),
    },
    input.frame.page,
  );
}
