import type { DeckConcept, RecipeId } from "../design/deck-concept";
import type { LayoutAuditIssue } from "../layout/layout-audit";
import { auditSlideLayout } from "../layout/layout-audit";
import { lintTaste, type TasteReport } from "../design/taste-lint";
import { stableStringify, type PresentationDocument, type Slide, type SlideContent } from "../document-model";

import { buildDesignedPage } from "./ai-designed-draft";
import { buildDesignPageCommand, type DirectionPreviewCommandBase } from "./direction-preview";
import type { AiSlideDesign } from "./template-layouts";
import type { DesignDraftCompileReport } from "./ai-designed-draft";

/** The page a candidate loop is asked to re-compose. */
export interface DesignCandidateRequest {
  /** The real deck. It is cloned per candidate and never modified. */
  document: PresentationDocument;
  slideIndex: number;
  concept: DeckConcept;
  /** The design currently on the page. A plan is required for verification. */
  design: AiSlideDesign;
  /** Theme/template context of the final application. */
  commandBase?: DirectionPreviewCommandBase;
  /** How many candidates to return. Defaults to 3; clamped to 1–5. */
  limit?: number;
  /**
   * Recipes to try, in preference order. Defaults to the concept's recipes.
   * The current recipe is always skipped.
   */
  recipes?: readonly RecipeId[];
}

export interface DesignCandidate {
  recipe: RecipeId;
  /** A one-page document produced by the real design command path. */
  document: PresentationDocument;
  /** The compile report of that same build, not a second inspection. */
  report: DesignDraftCompileReport;
  audit: readonly LayoutAuditIssue[];
  taste: TasteReport;
  /** Lower is better: hard audit issues cost more than advisory taste notes. */
  score: number;
}

export interface DesignCandidateFailure {
  recipe: RecipeId;
  code: string;
  message: string;
}

export interface DesignCandidateSet {
  slideIndex: number;
  /** The recipe the page uses today, when the design names one. */
  currentRecipe?: RecipeId;
  candidates: DesignCandidate[];
  /** Recipes that were tried and refused, with a stable reason code. */
  rejected: DesignCandidateFailure[];
  /** Why no candidate could be attempted, when that is the case. */
  reason?: "DESIGN_CANDIDATE_PAGE_MISSING" | "DESIGN_CANDIDATE_PLAN_REQUIRED";
}

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;

function errorCode(message: string): string {
  return /^([A-Z][A-Z0-9_]{2,63})(?::|$)/.exec(message.trim())?.[1] ?? "CANDIDATE_BUILD_FAILED";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The reviewed values of a page, with block ids removed.
 *
 * `apply-ai-designed-draft` re-creates the page's content blocks, so their
 * stable ids change by design. The values must not: a candidate that alters a
 * title, a table cell or a metric is not a design variant.
 */
function contentValueSignature(content: SlideContent): string {
  return stableStringify({
    title: content.title,
    body: content.body,
    speakerNotes: content.speakerNotes,
    blocks: (content.blocks ?? []).map(({ id: _id, ...block }) => block),
  });
}

/**
 * A stable description of what the page looks like.
 *
 * Element ids are random and image data URLs are irrelevant to composition, so
 * neither is included. Text, geometry, sizing and fills are: two recipes that
 * produce the same box layout are not two choices for the user.
 */
function layoutSignature(slide: Slide): string {
  return stableStringify(
    slide.elements.map((element) => {
      const base = { type: element.type, frame: element.frame };
      switch (element.type) {
        case "text":
          return {
            ...base,
            text: element.text,
            fontSizePt: element.style.fontSizePt,
            bold: element.style.bold,
            color: element.style.color,
            align: element.style.align,
            lineHeight: element.style.lineHeight,
          };
        case "shape":
          return {
            ...base,
            shape: element.shape,
            fill: element.style.fill,
            stroke: element.style.stroke,
            strokeWidthPt: element.style.strokeWidthPt,
          };
        case "image":
          return {
            ...base,
            placement: element.placement,
            crop: element.crop,
            frameShape: element.frameShape,
            tone: element.tone,
          };
        case "table":
          return { ...base, contentBlockId: element.contentBlockId, style: element.style };
        case "chart":
          return { ...base, kind: element.kind, contentBlockIds: element.contentBlockIds, style: element.style };
        case "line":
          return { ...base, direction: element.direction, style: element.style };
        case "icon":
          return { ...base, name: element.name, style: element.style };
        default:
          return base;
      }
    }),
  );
}

/**
 * A cheap deterministic ordering for candidates.
 *
 * A broken layout outranks a taste note, and a hard taste note outranks several
 * soft ones. The score is only a tie-breaker for the picker, never a quality
 * gate: the user still chooses, and the visual review remains the authority.
 */
function candidateScore(audit: readonly LayoutAuditIssue[], taste: TasteReport): number {
  const hard = taste.issues.filter((issue) => issue.severity === "hard").length;
  const soft = taste.issues.length - hard;
  return audit.length * 100 + hard * 20 + soft * 4;
}

/**
 * The design input for a page that asks for another recipe.
 *
 * Both the plan and the legacy recipe field are updated: a design with a plan
 * compiles through `designPlan`, while an older design only has the top-level
 * field. Callers that apply a chosen candidate use this so the two paths can
 * never disagree about which recipe was requested.
 */
export function designWithRecipe(design: AiSlideDesign, recipe: RecipeId): AiSlideDesign {
  return {
    ...design,
    recipe,
    ...(design.designPlan ? { designPlan: { ...design.designPlan, recipe } } : {}),
  };
}

function orderedRecipes(request: DesignCandidateRequest, current?: RecipeId): RecipeId[] {
  const requested = request.recipes ?? request.concept.recipes;
  const seen = new Set<RecipeId>();
  const result: RecipeId[] = [];
  for (const recipe of requested) {
    if (recipe === current || seen.has(recipe)) continue;
    seen.add(recipe);
    result.push(recipe);
  }
  return result;
}

/**
 * Compiles a small set of recipe alternatives for one page.
 *
 * Every candidate goes through the same command as a real page: the reviewed
 * draft, the deck concept, the page context and the template base. A recipe
 * that the compiler refuses, silently replaces, or that changes the reviewed
 * content is reported as a rejection rather than offered as a choice.
 *
 * The loop is deliberately synchronous and model-free. It answers "what can
 * this page become without touching its content?", not "what would a model
 * choose?"; a later caller may rank the returned candidates with pixels.
 */
export function buildDesignCandidates(request: DesignCandidateRequest): DesignCandidateSet {
  const slide = request.document.slides[request.slideIndex];
  if (!slide) {
    return {
      slideIndex: request.slideIndex,
      currentRecipe: undefined,
      candidates: [],
      rejected: [],
      reason: "DESIGN_CANDIDATE_PAGE_MISSING",
    };
  }
  const plan = request.design.designPlan;
  const currentRecipe = plan?.recipe ?? request.design.recipe;
  if (!plan) {
    // Without a plan there is no compile report to prove which recipe actually
    // drew the page; offering a variant would be a guess dressed as a choice.
    return {
      slideIndex: request.slideIndex,
      currentRecipe,
      candidates: [],
      rejected: [],
      reason: "DESIGN_CANDIDATE_PLAN_REQUIRED",
    };
  }
  const currentContent = contentValueSignature(slide.content);
  const currentSignature = layoutSignature(slide);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(request.limit ?? DEFAULT_LIMIT)));
  const rejected: DesignCandidateFailure[] = [];
  const accepted: DesignCandidate[] = [];

  for (const recipe of orderedRecipes(request, currentRecipe)) {
    const candidateDesign = designWithRecipe(request.design, recipe);
    try {
      const command = buildDesignPageCommand({
        document: request.document,
        concept: request.concept,
        pageIndex: request.slideIndex,
        design: candidateDesign,
        ...(request.commandBase ? { commandBase: request.commandBase } : {}),
      });
      const built = buildDesignedPage(request.document, command);
      const page = built.document.slides[0];
      const pageReport = built.report.slides[0]?.report;
      if (!page || !pageReport) {
        rejected.push({ recipe, code: "CANDIDATE_PLAN_NOT_COMPILED", message: "候选页没有产生编译报告" });
        continue;
      }
      if (pageReport.outcome === "rejected") {
        const first = pageReport.diagnostics.find((diagnostic) => diagnostic.severity === "error");
        rejected.push({
          recipe,
          code: first?.code ?? "CANDIDATE_RECIPE_REJECTED",
          message: first?.message ?? "候选配方被编译器拒绝",
        });
        continue;
      }
      if (pageReport.selectedRecipe !== recipe) {
        rejected.push({
          recipe,
          code: "CANDIDATE_RECIPE_SUBSTITUTED",
          message: `编译器改用了 ${pageReport.selectedRecipe ?? "未知配方"}`,
        });
        continue;
      }
      if (contentValueSignature(page.content) !== currentContent) {
        rejected.push({ recipe, code: "CANDIDATE_CONTENT_CHANGED", message: "候选页改变了已审核内容" });
        continue;
      }
      if (layoutSignature(page) === currentSignature) {
        rejected.push({ recipe, code: "CANDIDATE_LAYOUT_UNCHANGED", message: "候选配方与当前页面几何相同" });
        continue;
      }
      const audit = auditSlideLayout(built.document).issues;
      const taste = lintTaste(built.document);
      accepted.push({
        recipe,
        document: built.document,
        report: built.report,
        audit,
        taste,
        score: candidateScore(audit, taste),
      });
    } catch (error) {
      const message = messageOf(error);
      rejected.push({ recipe, code: errorCode(message), message });
    }
  }

  accepted.sort((left, right) => left.score - right.score);
  return {
    slideIndex: request.slideIndex,
    ...(currentRecipe === undefined ? {} : { currentRecipe }),
    candidates: accepted.slice(0, limit),
    rejected,
  };
}
