import type { DesignDraftCompileReport } from "../commands/ai-designed-draft";
import type {
  DesignCompileDiagnosticCode,
  DesignCompileOutcome,
} from "../layout/design-compiler";
import type { RecipeId } from "./deck-concept";

/** How often one concrete recipe was selected in a deck. */
export interface DesignRecipeUsage {
  recipe: RecipeId;
  pages: number;
}

/** A stable compile diagnostic and the pages that produced it. */
export interface DesignDiagnosticUsage {
  code: DesignCompileDiagnosticCode;
  severity: "info" | "warning" | "error";
  pages: number;
}

/** What happened to one planned page, without any reviewed copy. */
export interface DesignPageDecision {
  slideIndex: number;
  outcome: DesignCompileOutcome;
  requestedRecipe?: RecipeId;
  selectedRecipe?: RecipeId;
  /** True when the compiler used a recipe other than the one the plan asked for. */
  substituted: boolean;
}

/**
 * A flat summary of one design run.
 *
 * It intentionally contains only counts, recipe ids and diagnostic codes: the
 * quality report can be copied into a bug report without carrying the deck's
 * copy. The shape is stable so later phases can persist it as a local metric
 * without migrating a second format.
 */
export interface DesignMetrics {
  totalSlides: number;
  plannedSlides: number;
  /** Planned pages divided by all pages, clamped to 0–1. */
  coverage: number;
  accepted: number;
  adjusted: number;
  rejected: number;
  substituted: number;
  recipes: DesignRecipeUsage[];
  diagnostics: DesignDiagnosticUsage[];
  decisions: DesignPageDecision[];
}

const SEVERITY_RANK: Record<DesignDiagnosticUsage["severity"], number> = {
  info: 0,
  warning: 1,
  error: 2,
};

function higherSeverity(
  left: DesignDiagnosticUsage["severity"],
  right: DesignDiagnosticUsage["severity"],
): DesignDiagnosticUsage["severity"] {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

/**
 * Turns the compiler report into the numbers the quality report shows.
 *
 * `report.slides` is the source of truth for page counts: `plannedSlides` and
 * the per-page outcomes are written by the same summarizer, but a caller can
 * hand in a partially built report in tests. Deriving from the page list keeps
 * the summary internally consistent and prevents "planned 8, accepted 9".
 */
export function summarizeDesignMetrics(
  report: DesignDraftCompileReport,
  totalSlides: number,
): DesignMetrics {
  const total = Math.max(0, Math.trunc(totalSlides));
  const decisions: DesignPageDecision[] = report.slides
    .map(({ slideIndex, report: page }) => {
      const requested = page.requestedRecipe;
      const selected = page.selectedRecipe;
      return {
        slideIndex,
        outcome: page.outcome,
        ...(requested === undefined ? {} : { requestedRecipe: requested }),
        ...(selected === undefined ? {} : { selectedRecipe: selected }),
        substituted: requested !== undefined && selected !== undefined && requested !== selected,
      };
    })
    .sort((left, right) => left.slideIndex - right.slideIndex);

  const accepted = decisions.filter((decision) => decision.outcome === "accepted").length;
  const adjusted = decisions.filter((decision) => decision.outcome === "accepted-with-adjustments").length;
  const rejected = decisions.filter((decision) => decision.outcome === "rejected").length;
  const plannedSlides = decisions.length;
  const coverage = total === 0 ? 0 : Math.min(1, plannedSlides / total);

  const recipeCounts = new Map<RecipeId, number>();
  for (const decision of decisions) {
    if (decision.selectedRecipe === undefined) continue;
    recipeCounts.set(decision.selectedRecipe, (recipeCounts.get(decision.selectedRecipe) ?? 0) + 1);
  }
  const recipes = [...recipeCounts.entries()]
    .map(([recipe, pages]) => ({ recipe, pages }))
    .sort((left, right) => right.pages - left.pages || left.recipe.localeCompare(right.recipe));

  const diagnosticCounts = new Map<
    DesignCompileDiagnosticCode,
    { severity: DesignDiagnosticUsage["severity"]; pages: Set<number> }
  >();
  for (const { slideIndex, report: page } of report.slides) {
    for (const diagnostic of page.diagnostics) {
      const current = diagnosticCounts.get(diagnostic.code);
      if (current) {
        current.severity = higherSeverity(current.severity, diagnostic.severity);
        current.pages.add(slideIndex);
      } else {
        diagnosticCounts.set(diagnostic.code, {
          severity: diagnostic.severity,
          pages: new Set([slideIndex]),
        });
      }
    }
  }
  const diagnostics = [...diagnosticCounts.entries()]
    .map(([code, value]) => ({ code, severity: value.severity, pages: value.pages.size }))
    .sort((left, right) => right.pages - left.pages || left.code.localeCompare(right.code));

  return {
    totalSlides: total,
    plannedSlides,
    coverage,
    accepted,
    adjusted,
    rejected,
    substituted: decisions.filter((decision) => decision.substituted).length,
    recipes,
    diagnostics,
    decisions,
  };
}
