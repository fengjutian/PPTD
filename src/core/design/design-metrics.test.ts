import { describe, expect, it } from "vitest";

import type { DesignDraftCompileReport } from "../commands/ai-designed-draft";
import type {
  DesignCompileDiagnostic,
  DesignCompileDiagnosticCode,
  DesignCompileOutcome,
  DesignCompileReport,
} from "../layout/design-compiler";
import type { RecipeId } from "./deck-concept";
import { summarizeDesignMetrics } from "./design-metrics";

function diagnostic(
  code: DesignCompileDiagnosticCode,
  severity: DesignCompileDiagnostic["severity"],
  message = code,
): DesignCompileDiagnostic {
  return { code, severity, intent: "designPlan.recipe", message };
}

function page(
  slideIndex: number,
  outcome: DesignCompileOutcome,
  options: {
    requestedRecipe?: RecipeId;
    selectedRecipe?: RecipeId;
    diagnostics?: DesignCompileDiagnostic[];
  } = {},
): DesignDraftCompileReport["slides"][number] {
  const report: DesignCompileReport = {
    outcome,
    ...(options.requestedRecipe === undefined ? {} : { requestedRecipe: options.requestedRecipe }),
    ...(options.selectedRecipe === undefined ? {} : { selectedRecipe: options.selectedRecipe }),
    diagnostics: options.diagnostics ?? [],
  };
  return { slideIndex, report };
}

describe("summarizeDesignMetrics", () => {
  it("summarizes outcomes, substitutions, recipes and diagnostics", () => {
    const report: DesignDraftCompileReport = {
      outcome: "rejected",
      plannedSlides: 4,
      acceptedSlides: 1,
      adjustedSlides: 2,
      rejectedSlides: 1,
      slides: [
        page(0, "accepted", {
          requestedRecipe: "editorial-index",
          selectedRecipe: "editorial-index",
          diagnostics: [diagnostic("RECIPE_SELECTED", "info")],
        }),
        page(1, "accepted-with-adjustments", {
          requestedRecipe: "asymmetric-split",
          selectedRecipe: "editorial-index",
          diagnostics: [diagnostic("DIRECTION_RECIPE_SUBSTITUTED", "warning")],
        }),
        page(2, "accepted-with-adjustments", {
          requestedRecipe: "asymmetric-split",
          selectedRecipe: "editorial-index",
          diagnostics: [diagnostic("RECIPE_CAPACITY_EXCEEDED", "error")],
        }),
        page(3, "rejected", {
          requestedRecipe: "data-story",
          selectedRecipe: "data-story",
          diagnostics: [diagnostic("RECIPE_CAPACITY_EXCEEDED", "error")],
        }),
      ],
    };

    const metrics = summarizeDesignMetrics(report, 10);

    expect(metrics.totalSlides).toBe(10);
    expect(metrics.plannedSlides).toBe(4);
    expect(metrics.coverage).toBeCloseTo(0.4);
    expect(metrics.accepted).toBe(1);
    expect(metrics.adjusted).toBe(2);
    expect(metrics.rejected).toBe(1);
    expect(metrics.substituted).toBe(2);
    // The rejected page names data-story in its report, but the compiler fell
    // back to the legacy branch; it did not draw that recipe.
    expect(metrics.recipes).toEqual([{ recipe: "editorial-index", pages: 3 }]);
    expect(metrics.diagnostics).toEqual([
      { code: "RECIPE_CAPACITY_EXCEEDED", severity: "error", pages: 2 },
      { code: "DIRECTION_RECIPE_SUBSTITUTED", severity: "warning", pages: 1 },
      { code: "RECIPE_SELECTED", severity: "info", pages: 1 },
    ]);
    expect(metrics.decisions.map((decision) => decision.slideIndex)).toEqual([0, 1, 2, 3]);
  });

  it("derives page counts from the page list instead of trusting stale totals", () => {
    const report: DesignDraftCompileReport = {
      outcome: "accepted",
      plannedSlides: 99,
      acceptedSlides: 99,
      adjustedSlides: 0,
      rejectedSlides: 0,
      slides: [page(0, "accepted", { selectedRecipe: "quote-field" })],
    };

    const metrics = summarizeDesignMetrics(report, 8);

    expect(metrics.plannedSlides).toBe(1);
    expect(metrics.accepted).toBe(1);
    expect(metrics.coverage).toBeCloseTo(0.125);
  });

  it("returns an empty summary when the design planned no pages", () => {
    const metrics = summarizeDesignMetrics(
      {
        outcome: "accepted",
        plannedSlides: 0,
        acceptedSlides: 0,
        adjustedSlides: 0,
        rejectedSlides: 0,
        slides: [],
      },
      0,
    );

    expect(metrics).toMatchObject({
      totalSlides: 0,
      plannedSlides: 0,
      coverage: 0,
      accepted: 0,
      adjusted: 0,
      rejected: 0,
      substituted: 0,
      recipes: [],
      diagnostics: [],
      decisions: [],
    });
  });

  it("keeps the highest severity when the same diagnostic repeats", () => {
    const report: DesignDraftCompileReport = {
      outcome: "accepted-with-adjustments",
      plannedSlides: 1,
      acceptedSlides: 0,
      adjustedSlides: 1,
      rejectedSlides: 0,
      slides: [
        page(0, "accepted-with-adjustments", {
          selectedRecipe: "editorial-index",
          diagnostics: [
            diagnostic("TEMPLATE_UNAVAILABLE", "info"),
            diagnostic("TEMPLATE_UNAVAILABLE", "warning"),
            diagnostic("TEMPLATE_UNAVAILABLE", "error"),
          ],
        }),
      ],
    };

    const metrics = summarizeDesignMetrics(report, 1);

    expect(metrics.diagnostics).toEqual([{ code: "TEMPLATE_UNAVAILABLE", severity: "error", pages: 1 }]);
  });

  it("keeps a rejected page visible without inventing a selected recipe", () => {
    const report: DesignDraftCompileReport = {
      outcome: "rejected",
      plannedSlides: 2,
      acceptedSlides: 0,
      adjustedSlides: 0,
      rejectedSlides: 2,
      slides: [
        page(0, "rejected", { requestedRecipe: "comparison" }),
        page(1, "rejected", { requestedRecipe: "process-rail", selectedRecipe: "process-rail" }),
      ],
    };

    const metrics = summarizeDesignMetrics(report, 2);

    expect(metrics.accepted).toBe(0);
    expect(metrics.adjusted).toBe(0);
    expect(metrics.rejected).toBe(2);
    expect(metrics.decisions[0]?.selectedRecipe).toBeUndefined();
    expect(metrics.decisions[1]?.selectedRecipe).toBe("process-rail");
    // Even a named recipe is not "used" when the page was refused.
    expect(metrics.recipes).toEqual([]);
  });

  it("clamps coverage when a report carries more planned pages than the deck", () => {
    const report: DesignDraftCompileReport = {
      outcome: "accepted",
      plannedSlides: 2,
      acceptedSlides: 2,
      adjustedSlides: 0,
      rejectedSlides: 0,
      slides: [page(0, "accepted"), page(1, "accepted")],
    };

    expect(summarizeDesignMetrics(report, 1).coverage).toBe(1);
  });

  it("counts contract repairs separately from ignored extra slides", () => {
    const metrics = summarizeDesignMetrics(
      {
        outcome: "accepted",
        plannedSlides: 0,
        acceptedSlides: 0,
        adjustedSlides: 0,
        rejectedSlides: 0,
        slides: [],
      },
      5,
      [{ code: "DESIGN_SLIDE_INVALID" }, { code: "DESIGN_SLIDE_MISSING" }, { code: "DESIGN_SLIDE_EXTRA" }],
    );

    expect(metrics.repairedSlides).toBe(2);
    expect(metrics.ignoredSlides).toBe(1);
    expect(metrics.repairCodes).toEqual({ invalid: 1, missing: 1, extra: 1 });
  });
});
