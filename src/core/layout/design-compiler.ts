import type { CompositionFacts, IntentConflict } from "../commands/design-intent";
import type { PageDesignPlan } from "../design/design-plan";
import type { DeckConcept, RecipeId } from "../design/deck-concept";
import type { DesignTokens } from "../design/design-tokens";
import type { RectEmu, SlideContent } from "../document-model";
import { colorLuminance } from "../rendering/contrast";
import { frameFromNormalized } from "./recipes/measure";
import { rectElement } from "./recipes/elements";
import { findRecipe } from "./recipes/registry";
import { directionOwnsRequest, isImageRecipe, supportedDirectionRecipe } from "./recipes/plan";
import type { NormalizedFrame, RecipeContext, RecipePlan, RecipeSupportOptions } from "./recipes/types";
import type { PageChrome } from "./page-chrome";

export interface DesignCompileInput {
  plan: PageDesignPlan;
  content: SlideContent;
  facts: CompositionFacts;
  concept: DeckConcept;
  /** Ordered, renderer-backed recipes required by the selected style. */
  stylePreferredRecipes?: readonly RecipeId[];
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
  /** Session-only evidence from the bounded AI layout Workbench. */
  layoutTrace?: DesignLayoutTrace;
}

export interface DesignLayoutTrace {
  coordinateSpace: "normalized-1000";
  operations: readonly {
    id: string;
    op: "inset" | "columns" | "rows" | "stack";
    source: string;
  }[];
  slots: readonly {
    id: string;
    rect: { x: number; y: number; width: number; height: number };
  }[];
  degradations: readonly { code: string; message: string }[];
}

export type DesignCompileOutcome = "accepted" | "accepted-with-adjustments" | "rejected";

export type DesignCompileDiagnosticCode =
  | "RECIPE_SELECTED"
  | "STYLE_RECIPE_SELECTED"
  | "DIRECTION_RECIPE_SUBSTITUTED"
  | "TEMPLATE_BODY_TAKEN_OVER"
  | "NO_COMPATIBLE_RECIPE"
  | "UNKNOWN_RECIPE"
  | "RECIPE_NOT_ALLOWED_BY_DIRECTION"
  | "VISUAL_ASSET_REQUIRED"
  | "TEMPLATE_UNAVAILABLE"
  | "RECIPE_CAPACITY_EXCEEDED"
  | "RECIPE_PLAN_REJECTED"
  | "RECIPE_RETRY_APPLIED"
  | "RECIPE_RETRY_FAILED";

export interface DesignCompileDiagnostic {
  code: DesignCompileDiagnosticCode;
  severity: "info" | "warning" | "error";
  intent: string;
  message: string;
  requestedRecipe?: RecipeId;
  selectedRecipe?: RecipeId;
  suggestedRecipes?: readonly RecipeId[];
}

export interface DesignCompileReport {
  outcome: DesignCompileOutcome;
  requestedRecipe?: RecipeId;
  selectedRecipe?: RecipeId;
  diagnostics: readonly DesignCompileDiagnostic[];
  /** Absent for legacy and manually-created plans that did not use the Workbench. */
  layoutTrace?: DesignLayoutTrace;
}

export type DesignCompileResult =
  | (RecipePlan & { compileReport: DesignCompileReport })
  | { conflict: IntentConflict; compileReport: DesignCompileReport };

function rejected(
  code: Extract<
    DesignCompileDiagnosticCode,
    | "NO_COMPATIBLE_RECIPE"
    | "UNKNOWN_RECIPE"
    | "RECIPE_NOT_ALLOWED_BY_DIRECTION"
    | "VISUAL_ASSET_REQUIRED"
    | "RECIPE_CAPACITY_EXCEEDED"
  >,
  intent: string,
  reason: string,
  recipes: {
    requestedRecipe?: RecipeId;
    selectedRecipe?: RecipeId;
    suggestedRecipes?: readonly RecipeId[];
  } = {},
): DesignCompileResult {
  return {
    conflict: { intent, reason },
    compileReport: {
      outcome: "rejected",
      ...recipes,
      diagnostics: [
        {
          code,
          severity: "error",
          intent,
          message: reason,
          ...recipes,
        },
      ],
    },
  };
}

/**
 * Returns only alternatives that the current direction can render and the
 * current content/assets can carry. These are executable options, not model
 * guesses; callers may safely offer them as a retry menu.
 */
function compatibleRecipeAlternatives(
  input: DesignCompileInput,
  supports: RecipeSupportOptions,
  excluded?: RecipeId,
): RecipeId[] {
  const ordered = [
    ...(input.stylePreferredRecipes ?? []),
    ...input.concept.recipes.filter((id) => !input.stylePreferredRecipes?.includes(id)),
  ];
  return ordered
    .filter((id) => id !== excluded)
    .filter((id) => (input.hasAsset ? true : !isImageRecipe(id)))
    .filter((id) => findRecipe(id)?.supports(input.facts, input.concept, supports) === true)
    .slice(0, 3);
}

/**
 * The compiler is the only place allowed to turn a design plan into geometry.
 *
 * The AI writes the plan; this function chooses the concrete recipe, keeps the
 * page on the shared chrome, and — for a template takeover — lays a clean
 * content surface over the template's body artwork while leaving the header,
 * Logo and footer in place.
 */
function compileDesignPlanCore(input: DesignCompileInput): DesignCompileResult {
  const supports: RecipeSupportOptions = {
    hasArtwork: input.hasArtwork,
    hasAsset: input.hasAsset,
    hasTemplate: input.hasTemplate,
    ...(input.templateImage ? { hasTemplateImage: true } : {}),
    ...(input.assetRole ? { assetRole: input.assetRole } : {}),
  };
  const recipeId = planRecipe(input.plan, input.facts, {
    concept: input.concept,
    options: supports,
    preferredRecipes: input.stylePreferredRecipes,
  });
  if (!recipeId) {
    return rejected("NO_COMPATIBLE_RECIPE", "designPlan.role", "设计计划没有可用的页面配方", {
      ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
      suggestedRecipes: compatibleRecipeAlternatives(input, supports),
    });
  }
  const recipe = findRecipe(recipeId);
  if (!recipe) {
    return rejected("UNKNOWN_RECIPE", "designPlan.recipe", `未知配方 ${recipeId}`, {
      ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
      selectedRecipe: recipeId,
      suggestedRecipes: compatibleRecipeAlternatives(input, supports, recipeId),
    });
  }
  if (!input.concept.recipes.includes(recipeId)) {
    return rejected(
      "RECIPE_NOT_ALLOWED_BY_DIRECTION",
      "designPlan.recipe",
      `配方 ${recipeId} 不在设计方向 ${input.concept.preset} 的允许集合内`,
      {
        ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
        selectedRecipe: recipeId,
        suggestedRecipes: compatibleRecipeAlternatives(input, supports, recipeId),
      },
    );
  }
  if (isImageRecipe(recipeId) && !input.hasAsset) {
    return rejected("VISUAL_ASSET_REQUIRED", "designPlan.recipe", `配方 ${recipeId} 需要可用的页面图片`, {
      ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
      selectedRecipe: recipeId,
      suggestedRecipes: compatibleRecipeAlternatives(input, supports, recipeId),
    });
  }
  if (!recipe.supports(input.facts, input.concept, supports)) {
    return rejected("RECIPE_CAPACITY_EXCEEDED", "designPlan.recipe", `内容装不下配方 ${recipeId}`, {
      ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
      selectedRecipe: recipeId,
      suggestedRecipes: compatibleRecipeAlternatives(input, supports, recipeId),
    });
  }

  const diagnostics: DesignCompileDiagnostic[] = [];
  if (input.plan.templatePolicy !== "ignore" && !input.hasTemplate) {
    diagnostics.push({
      code: "TEMPLATE_UNAVAILABLE",
      severity: "warning",
      intent: "designPlan.templatePolicy",
      message: `页面要求 ${input.plan.templatePolicy === "takeover" ? "接管" : "使用"}模板，但当前没有模板；已按设计方向直接构建页面`,
      selectedRecipe: recipeId,
    });
  }
  const selectedByStyle =
    input.stylePreferredRecipes?.includes(recipeId) === true &&
    (!input.plan.recipe || directionOwnsRequest(input.plan.recipe));
  if (selectedByStyle) {
    diagnostics.push({
      code: "STYLE_RECIPE_SELECTED",
      severity: input.plan.recipe && input.plan.recipe !== recipeId ? "warning" : "info",
      intent: "styleConstraint.preferredRecipes",
      message: `所选风格优先采用配方 ${recipeId}`,
      ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
      selectedRecipe: recipeId,
    });
  } else if (input.plan.recipe && input.plan.recipe !== recipeId) {
    diagnostics.push({
      code: "DIRECTION_RECIPE_SUBSTITUTED",
      severity: "warning",
      intent: "designPlan.recipe",
      message: `设计方向将配方 ${input.plan.recipe} 替换为 ${recipeId}`,
      requestedRecipe: input.plan.recipe,
      selectedRecipe: recipeId,
    });
  } else {
    diagnostics.push({
      code: "RECIPE_SELECTED",
      severity: "info",
      intent: input.plan.recipe ? "designPlan.recipe" : "designPlan.role",
      message: input.plan.recipe ? `采用指定配方 ${recipeId}` : `根据页面角色与内容选择配方 ${recipeId}`,
      ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
      selectedRecipe: recipeId,
    });
  }

  let chrome = input.chrome;
  let frame = input.frame;
  let colors = input.colors;
  const leading: RecipePlan["elements"] = [];

  if (input.plan.templatePolicy === "takeover" && input.hasTemplate) {
    diagnostics.push({
      code: "TEMPLATE_BODY_TAKEN_OVER",
      severity: "info",
      intent: "designPlan.templatePolicy",
      message: "保留模板页眉、Logo 与页脚，并由设计配方接管正文区域",
      selectedRecipe: recipeId,
    });
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
    hasArtwork: input.hasArtwork,
  });
  if (!("elements" in planned)) {
    return {
      ...planned,
      compileReport: {
        outcome: "rejected",
        ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
        selectedRecipe: recipeId,
        diagnostics: [
          ...diagnostics,
          {
            code: "RECIPE_PLAN_REJECTED",
            severity: "error",
            intent: planned.conflict.intent,
            message: planned.conflict.reason,
            ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
            selectedRecipe: recipeId,
            suggestedRecipes: compatibleRecipeAlternatives(input, supports, recipeId),
          },
        ],
      },
    };
  }
  return {
    ...planned,
    elements: [...leading, ...planned.elements],
    compileReport: {
      outcome: diagnostics.some((diagnostic) => diagnostic.severity === "warning")
        ? "accepted-with-adjustments"
        : "accepted",
      ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
      selectedRecipe: recipeId,
      diagnostics,
    },
  };
}

/** Compiles a plan and preserves the exact bounded Workbench evidence used for it. */
export function compileDesignPlan(input: DesignCompileInput): DesignCompileResult {
  const result = compileDesignPlanCore(input);
  if (!input.layoutTrace) return result;
  return {
    ...result,
    compileReport: { ...result.compileReport, layoutTrace: input.layoutTrace },
  };
}

/**
 * Tries one compiler-verified alternative after a refused plan.
 *
 * This is deliberately a separate entry point: callers that only want to
 * inspect the original plan keep using `compileDesignPlan`, while the page
 * builder opts into one bounded recovery attempt. Content and every other plan
 * field stay unchanged; only the concrete recipe is replaced.
 */
export function compileDesignPlanWithRetry(input: DesignCompileInput): DesignCompileResult {
  const initial = compileDesignPlan(input);
  if ("elements" in initial) return initial;

  const alternative = initial.compileReport.diagnostics
    .flatMap((diagnostic) => diagnostic.suggestedRecipes ?? [])
    .find((recipe, index, recipes) => recipes.indexOf(recipe) === index);
  if (!alternative) return initial;

  const retried = compileDesignPlan({
    ...input,
    plan: { ...input.plan, recipe: alternative },
  });
  const originalDiagnostics = initial.compileReport.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    severity: "warning" as const,
  }));
  if (!("elements" in retried)) {
    return {
      ...initial,
      compileReport: {
        ...initial.compileReport,
        diagnostics: [
          ...initial.compileReport.diagnostics,
          {
            code: "RECIPE_RETRY_FAILED",
            severity: "error",
            intent: "designPlan.recipe",
            message: `替代配方 ${alternative} 仍无法完成页面编译`,
            requestedRecipe: input.plan.recipe,
            selectedRecipe: alternative,
          },
          ...retried.compileReport.diagnostics,
        ],
      },
    };
  }

  return {
    ...retried,
    compileReport: {
      outcome: "accepted-with-adjustments",
      ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
      selectedRecipe: alternative,
      diagnostics: [
        ...originalDiagnostics,
        {
          code: "RECIPE_RETRY_APPLIED",
          severity: "warning",
          intent: "designPlan.recipe",
          message: `原配方无法落地，已自动改用 ${alternative} 并重新编译`,
          ...(input.plan.recipe ? { requestedRecipe: input.plan.recipe } : {}),
          selectedRecipe: alternative,
        },
        ...retried.compileReport.diagnostics,
      ],
    },
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
  preferredRecipes?: readonly RecipeId[];
}

function planRecipe(plan: PageDesignPlan, facts: CompositionFacts, direction?: PlanDirection): RecipeId | undefined {
  // A style is a compiler constraint, not a prompt hint. It may take over a
  // generic list request, but never a semantic recipe such as comparison,
  // process, timeline or chart.
  if (direction && (!plan.recipe || directionOwnsRequest(plan.recipe))) {
    for (const id of direction.preferredRecipes ?? []) {
      if (!direction.concept.recipes.includes(id)) continue;
      const recipe = findRecipe(id);
      if (recipe?.supports(facts, direction.concept, direction.options)) return id;
    }
  }
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
